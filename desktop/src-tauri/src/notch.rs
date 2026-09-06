//! Native capture windows. All AppKit geometry and reconciliation run on the main thread.
//! A camera is an occlusion, never a drawable control. Plain-screen handles are opt-in.
use super::notch_geometry::{self as geometry, Rect, Screen};
use super::notch_session::{Mode, Session};
use objc2::{runtime::AnyObject, MainThreadMarker};
use objc2_app_kit::{NSEvent, NSScreen, NSWindow, NSWindowCollectionBehavior, NSWorkspace};
use objc2_foundation::{
    ns_string, NSNotificationCenter, NSNumber, NSOperatingSystemVersion, NSPoint, NSProcessInfo,
    NSRect, NSSize,
};
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
struct State {
    screens: Vec<Screen>,
    triggers: HashSet<u32>,
    enabled: bool,
    plain: bool,
    suspended: bool,
    session: Session,
    target: Option<u32>,
    panel_rect: Rect,
    hover: Option<u32>,
    since: Option<Instant>,
    away: Option<Instant>,
    rearm: bool,
}
#[derive(serde::Deserialize)]
struct Visibility {
    visible: bool,
    #[serde(default)]
    plain_displays: bool,
}
#[derive(serde::Deserialize)]
struct SessionPayload {
    session: u64,
    #[serde(default)]
    busy: bool,
}
#[derive(serde::Serialize, Clone)]
struct PanelInfo {
    session: u64,
    mode: Mode,
    reduce_motion: bool,
    reduce_transparency: bool,
}
#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(deny_unknown_fields)]
struct DataChanged {
    topic: Topic,
    origin: Origin,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    user_id: Option<String>,
}
#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
enum Topic {
    Memos,
    Tasks,
    Notes,
}
#[derive(serde::Serialize, serde::Deserialize, Clone)]
enum Origin {
    #[serde(rename = "main")]
    Main,
    #[serde(rename = "notch-panel")]
    Panel,
}

type Shared = Mutex<State>;
fn on_main(app: &AppHandle, f: impl FnOnce(AppHandle) + Send + 'static) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || f(handle));
}
fn native_rect(r: Rect) -> NSRect {
    NSRect::new(NSPoint::new(r.x, r.y), NSSize::new(r.width, r.height))
}
fn rect(r: NSRect) -> Rect {
    Rect {
        x: r.origin.x,
        y: r.origin.y,
        width: r.size.width,
        height: r.size.height,
    }
}
fn pointer() -> (f64, f64) {
    let p = NSEvent::mouseLocation();
    (p.x, p.y)
}
fn label(id: u32) -> String {
    format!("notch-trigger-{id}")
}
fn with_window(app: &AppHandle, name: &str, f: impl FnOnce(&NSWindow)) {
    assert!(MainThreadMarker::new().is_some());
    if let Some(w) = app.get_webview_window(name) {
        if let Ok(raw) = w.ns_window() {
            unsafe {
                f(&*(raw as *const NSWindow));
            }
        }
    }
}
fn snapshot() -> Vec<Screen> {
    let Some(mtm) = MainThreadMarker::new() else {
        return vec![];
    };
    let supported =
        NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(NSOperatingSystemVersion {
            majorVersion: 12,
            minorVersion: 0,
            patchVersion: 0,
        });
    NSScreen::screens(mtm)
        .iter()
        .filter_map(|s| {
            let object = s
                .deviceDescription()
                .objectForKey(ns_string!("NSScreenNumber"))?;
            let id = object.downcast_ref::<NSNumber>()?.unsignedIntValue();
            let frame = rect(s.frame());
            let visible = rect(s.visibleFrame());
            let top = if supported {
                s.safeAreaInsets().top
            } else {
                0.0
            };
            let notch = if supported {
                geometry::camera_gap(
                    frame,
                    top,
                    rect(s.auxiliaryTopLeftArea()),
                    rect(s.auxiliaryTopRightArea()),
                )
            } else {
                None
            };
            Some(Screen {
                id,
                frame,
                usable: geometry::usable_area(frame, visible, top)?,
                notch,
                scale: s.backingScaleFactor(),
            })
        })
        .collect()
}
fn publish_panel(app: &AppHandle) {
    let (session, mode) = {
        let s = app.state::<Shared>();
        let g = s.lock().unwrap();
        (g.session.id, g.session.mode)
    };
    let ws = NSWorkspace::sharedWorkspace();
    let _ = app.emit(
        "notch-panel-shown",
        PanelInfo {
            session,
            mode,
            reduce_motion: ws.accessibilityDisplayShouldReduceMotion(),
            reduce_transparency: ws.accessibilityDisplayShouldReduceTransparency(),
        },
    );
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    app.manage(Shared::default());
    WebviewWindowBuilder::new(app, "notch-panel", WebviewUrl::App("desktop/notch".into()))
        .title("Organize 快速记录")
        .inner_size(380.0, 520.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .accept_first_mouse(true)
        .focused(false)
        .shadow(false)
        .resizable(false)
        .visible(false)
        .build()?;
    with_window(app, "notch-panel", |w| {
        w.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Transient
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
    });
    let a = app.clone();
    app.listen("notch-trigger-visibility", move |e| {
        if let Ok(v) = serde_json::from_str::<Visibility>(e.payload()) {
            on_main(&a, move |a| {
                {
                    let s = a.state::<Shared>();
                    let mut g = s.lock().unwrap();
                    g.enabled = v.visible;
                    g.plain = v.plain_displays;
                }
                reconcile(&a);
            });
        }
    });
    for event in ["notch-collapse", "notch-edit", "notch-state"] {
        let a = app.clone();
        app.listen(event, move |e| {
            if let Ok(p) = serde_json::from_str::<SessionPayload>(e.payload()) {
                on_main(&a, move |a| {
                    if event == "notch-collapse" {
                        collapse(&a, p.session);
                        return;
                    }
                    let accepted = {
                        let s = a.state::<Shared>();
                        let mut g = s.lock().unwrap();
                        if !g.session.accepts(p.session) {
                            false
                        } else {
                            if event == "notch-edit" {
                                g.session.mode = Mode::Editing;
                            } else {
                                g.session.busy = p.busy;
                            }
                            true
                        }
                    };
                    if accepted && event == "notch-edit" {
                        if let Some(w) = a.get_webview_window("notch-panel") {
                            let _ = w.set_focusable(true);
                            let _ = w.set_focus();
                        }
                        publish_panel(&a);
                    }
                });
            }
        });
    }
    let a = app.clone();
    app.listen("notch-panel-ready", move |_| {
        on_main(&a, |a| publish_panel(&a))
    });
    let a = app.clone();
    app.listen("notch-data-changed", move |e| {
        // emit serializes values: never pass event.payload() (an already serialized string).
        if let Ok(payload) = serde_json::from_str::<DataChanged>(e.payload()) {
            let _ = a.emit("organize-data-changed", payload);
        }
    });
    let a = app.clone();
    app.listen("notch-open-path", move |e| {
        if let Ok(path) = serde_json::from_str::<String>(e.payload()) {
            if is_open_path_allowed(&path) {
                on_main(&a, move |a| {
                    close(&a);
                    super::show_main_window(&a);
                    super::navigate(&a, path);
                });
            }
        }
    });
    observe(app);
    reconcile(app);
    let app = app.clone();
    std::thread::spawn(move || {
        let pending = Arc::new(AtomicBool::new(false));
        let mut refresh = Instant::now();
        loop {
            let active = {
                let s = app.state::<Shared>();
                let g = s.lock().unwrap();
                !g.suspended
                    && ((g.enabled && !g.triggers.is_empty()) || g.session.mode == Mode::Preview)
            };
            std::thread::sleep(Duration::from_millis(if active { 100 } else { 1000 }));
            if pending.swap(true, Ordering::AcqRel) {
                continue;
            }
            let refresh_now = refresh.elapsed() >= Duration::from_secs(2);
            if refresh_now {
                refresh = Instant::now();
            }
            let flag = pending.clone();
            let a = app.clone();
            if app
                .run_on_main_thread(move || {
                    if refresh_now {
                        reconcile(&a);
                    }
                    if active {
                        tick(&a);
                    }
                    flag.store(false, Ordering::Release);
                })
                .is_err()
            {
                break;
            }
        }
    });
    Ok(())
}

/// Observers are retained for this process lifetime by the notification centers.
fn observe(app: &AppHandle) {
    let ws = NSWorkspace::sharedWorkspace();
    let centers = [
        (
            NSNotificationCenter::defaultCenter(),
            vec![("NSApplicationDidChangeScreenParametersNotification", 0)],
        ),
        (
            ws.notificationCenter(),
            vec![
                ("NSWorkspaceWillSleepNotification", 1),
                ("NSWorkspaceSessionDidResignActiveNotification", 1),
                ("NSWorkspaceDidWakeNotification", 2),
                ("NSWorkspaceSessionDidBecomeActiveNotification", 2),
                ("NSWorkspaceActiveSpaceDidChangeNotification", 3),
                (
                    "NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification",
                    0,
                ),
            ],
        ),
    ];
    for (center, names) in centers {
        for (name, action) in names {
            let a = app.clone();
            let block = block2::RcBlock::new(
                move |_: std::ptr::NonNull<objc2_foundation::NSNotification>| {
                    on_main(&a, move |a| {
                        if action != 0 {
                            close(&a);
                        }
                        if action == 1 || action == 2 {
                            a.state::<Shared>().lock().unwrap().suspended = action == 1;
                        }
                        reconcile(&a);
                        publish_panel(&a);
                    });
                },
            );
            unsafe {
                let _ = center.addObserverForName_object_queue_usingBlock(
                    Some(&objc2_foundation::NSString::from_str(name)),
                    None::<&AnyObject>,
                    None,
                    &block,
                );
            }
        }
    }
}

fn reconcile(app: &AppHandle) {
    let screens = snapshot();
    let (old, enabled, plain, suspended, target, mode) = {
        let s = app.state::<Shared>();
        let g = s.lock().unwrap();
        (
            g.triggers.clone(),
            g.enabled,
            g.plain,
            g.suspended,
            g.target,
            g.session.mode,
        )
    };
    let desired: HashSet<u32> = screens
        .iter()
        .filter(|s| enabled && !suspended && geometry::trigger_frame(s, plain).is_some())
        .map(|s| s.id)
        .collect();
    for id in old.difference(&desired) {
        if let Some(w) = app.get_webview_window(&label(*id)) {
            let _ = w.destroy();
        }
    }
    let mut actual = HashSet::new();
    for screen in screens.iter().filter(|s| desired.contains(&s.id)) {
        let name = label(screen.id);
        if app.get_webview_window(&name).is_none() {
            if WebviewWindowBuilder::new(app, &name, WebviewUrl::App("desktop/notch".into()))
                .title("Organize 快速记录入口")
                .inner_size(96.0, 6.0)
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .visible_on_all_workspaces(true)
                .focused(false)
                .focusable(false)
                .shadow(false)
                .resizable(false)
                .visible(false)
                .build()
                .is_err()
            {
                continue;
            }
        }
        let frame = geometry::trigger_frame(screen, plain).unwrap();
        with_window(app, &name, |w| {
            w.setFrame_display(native_rect(frame), false);
            w.setCollectionBehavior(
                NSWindowCollectionBehavior::CanJoinAllSpaces
                    | NSWindowCollectionBehavior::Transient
                    | NSWindowCollectionBehavior::IgnoresCycle,
            );
        });
        if let Some(w) = app.get_webview_window(&name) {
            let _ = w.set_ignore_cursor_events(true);
            let _ = w.show();
            actual.insert(screen.id);
        }
    }
    let selected = geometry::target_screen(&screens, target, pointer());
    let id = selected.map(|s| s.id);
    let frame = selected.and_then(geometry::panel_frame);
    if let Some(frame) = frame {
        with_window(app, "notch-panel", |w| {
            if rect(w.frame()) != frame {
                w.setFrame_display(native_rect(frame), false);
            }
        });
    }
    {
        let s = app.state::<Shared>();
        let mut g = s.lock().unwrap();
        g.screens = screens;
        g.triggers = actual;
        g.target = id;
        g.panel_rect = frame.unwrap_or_default();
    }
    if (frame.is_none() || suspended) && mode != Mode::Hidden {
        close(app);
    }
}
fn show(app: &AppHandle, mode: Mode, target: Option<u32>) {
    {
        let s = app.state::<Shared>();
        let mut g = s.lock().unwrap();
        if g.suspended {
            return;
        }
        g.target = target;
    }
    reconcile(app);
    if !app.state::<Shared>().lock().unwrap().panel_rect.valid() {
        super::show_main_window(app);
        return;
    }
    if let Some(w) = app.get_webview_window("notch-panel") {
        let _ = w.set_focusable(mode == Mode::Editing);
        if w.show().is_err() {
            return;
        }
        {
            let s = app.state::<Shared>();
            let mut g = s.lock().unwrap();
            g.session.open(mode);
            g.away = None;
        }
        if mode == Mode::Editing {
            let _ = w.set_focus();
        }
        publish_panel(app);
    }
}
pub fn toggle(app: &AppHandle) {
    if app.try_state::<Shared>().is_none() {
        super::show_main_window(app);
        return;
    }
    on_main(app, |a| {
        let mode = a.state::<Shared>().lock().unwrap().session.mode;
        if mode == Mode::Editing {
            close(&a);
        } else {
            let target = {
                let s = a.state::<Shared>();
                let g = s.lock().unwrap();
                geometry::target_screen(&g.screens, None, pointer()).map(|s| s.id)
            };
            show(&a, Mode::Editing, target);
        }
    });
}
pub fn close(app: &AppHandle) {
    let Some(s) = app.try_state::<Shared>() else {
        return;
    };
    let id = s.lock().unwrap().session.id;
    collapse(app, id);
}
fn collapse(app: &AppHandle, id: u64) {
    let closed = {
        let s = app.state::<Shared>();
        let mut g = s.lock().unwrap();
        if g.session.close(id) {
            g.rearm = true;
            g.hover = None;
            g.since = None;
            g.away = None;
            true
        } else {
            false
        }
    };
    if closed {
        if let Some(w) = app.get_webview_window("notch-panel") {
            let _ = w.hide();
        }
        publish_panel(app);
    }
}
pub fn blur_collapse_after_grace(app: AppHandle) {
    let id = app.state::<Shared>().lock().unwrap().session.id;
    std::thread::sleep(Duration::from_millis(180));
    on_main(&app, move |a| {
        let can = a
            .state::<Shared>()
            .lock()
            .unwrap()
            .session
            .can_blur_close(id);
        if can
            && !a
                .get_webview_window("notch-panel")
                .is_some_and(|w| w.is_focused().unwrap_or(false))
        {
            collapse(&a, id);
        }
    });
}
fn tick(app: &AppHandle) {
    let p = pointer();
    let now = Instant::now();
    let (open, close_id) = {
        let s = app.state::<Shared>();
        let mut g = s.lock().unwrap();
        if g.suspended {
            return;
        }
        let hit = g
            .screens
            .iter()
            .filter(|s| g.triggers.contains(&s.id))
            .find(|s| geometry::trigger_frame(s, g.plain).is_some_and(|r| r.contains(p.0, p.1)))
            .map(|s| s.id);
        if hit.is_none() {
            g.rearm = false;
        }
        if hit != g.hover {
            g.hover = hit;
            g.since = hit.map(|_| now);
        }
        if g.session.mode == Mode::Hidden {
            (
                if !g.rearm
                    && g.since
                        .is_some_and(|t| now.duration_since(t) >= Duration::from_millis(350))
                {
                    hit
                } else {
                    None
                },
                None,
            )
        } else if g.session.mouse_may_close() {
            if hit.is_some() || g.panel_rect.contains(p.0, p.1) {
                g.away = None;
            } else if g.away.is_none() {
                g.away = Some(now);
            }
            (
                None,
                if g.away
                    .is_some_and(|t| now.duration_since(t) >= Duration::from_millis(400))
                {
                    Some(g.session.id)
                } else {
                    None
                },
            )
        } else {
            (None, None)
        }
    };
    if let Some(id) = open {
        show(app, Mode::Preview, Some(id));
    }
    if let Some(id) = close_id {
        collapse(app, id);
    }
}
fn is_open_path_allowed(path: &str) -> bool {
    if [
        "/memos",
        "/library",
        "/notes",
        "/tasks",
        "/settings",
        "/login",
    ]
    .contains(&path)
    {
        return true;
    }
    path.strip_prefix("/notes/")
        .or_else(|| path.strip_prefix("/tasks?task="))
        .is_some_and(|s| {
            s.len() == 36
                && s.bytes().enumerate().all(|(i, c)| {
                    if [8, 13, 18, 23].contains(&i) {
                        c == b'-'
                    } else {
                        c.is_ascii_hexdigit()
                    }
                })
        })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bridge_emits_an_object_not_a_json_string() {
        let payload: DataChanged =
            serde_json::from_str(r#"{"topic":"memos","origin":"notch-panel","user_id":"u1"}"#)
                .unwrap();
        let value = serde_json::to_value(payload).unwrap();
        assert!(value.is_object());
        assert_eq!(value["topic"], "memos");
        assert!(
            serde_json::from_str::<DataChanged>(r#"{"topic":"evil","origin":"main"}"#).is_err()
        );
    }
}
