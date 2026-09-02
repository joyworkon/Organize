//! 刘海激发器（docs/notch-trigger-plan.md 定稿 v2）：
//! `notch-trigger`（180×28 纯黑胶囊，覆盖刘海）+ `notch-panel`（380×520 速记
//! 面板）两个自有小窗，加载 web 侧同一路由 `/desktop/notch`（按窗口 label
//! 分角色）。窗口均为自有窗口，不需要辅助功能权限。
//!
//! 状态机（方案决策 1）：胶囊 mouseenter 上报 → Rust 侧 150ms 停留判定
//! （快速划过不触发）→ 展开面板并聚焦；面板失焦 120ms 宽限 / Esc / 保存成功
//! → 收起。⌘⇧M 兜底 toggle（见 main.rs 的 global_shortcuts）。
//!
//! 数据链路零新后端：速记/待办/快速入口全部复用既有 web API 与事件，
//! web 侧实现见 apps/web/components/desktop/notch/。
use std::sync::Mutex;
use std::time::Duration;

use tauri::{
    AppHandle, Emitter, Listener, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

/// hover 停留判定：mouseenter 后至少悬这么久才算有意悬停（方案决策 1）
const HOVER_DWELL: Duration = Duration::from_millis(150);
/// 失焦收起宽限：误点面板外部后 120ms 内点回不收起（兼作收起动画时长）
const BLUR_GRACE: Duration = Duration::from_millis(120);
/// 主显示器几何轮询间隔：外接屏插拔 / 分辨率变化后重算胶囊位置（方案 §6）
const MONITOR_POLL: Duration = Duration::from_secs(5);

const TRIGGER_SIZE: (f64, f64) = (180.0, 28.0);
const PANEL_SIZE: (f64, f64) = (380.0, 520.0);
/// 胶囊与面板的间距（逻辑像素）
const PANEL_GAP: f64 = 8.0;

/// 面板快速入口跳转白名单——web 侧 lib/desktop/notch.ts 的 NOTCH_OPEN_PATHS
/// 镜像；主窗口接收端另有 sanitizeNavigatePath 兜底，这里是第一道闸
const OPEN_PATH_WHITELIST: [&str; 6] =
    ["/memos", "/library", "/notes", "/tasks", "/settings", "/login"];

#[derive(Default)]
struct NotchState {
    /// 鼠标当前是否悬在胶囊上
    hovered: bool,
    /// 面板是否处于展开态
    expanded: bool,
    /// 主显示器是否有刘海（NSScreen.safeAreaInsets.top > 0，方案默认值 4）
    has_notch: bool,
}

type SharedState = Mutex<NotchState>;

#[derive(serde::Deserialize)]
struct HoverPayload {
    entered: bool,
}

#[derive(serde::Deserialize)]
struct VisibilityPayload {
    visible: bool,
}

#[derive(serde::Serialize, Clone)]
struct NotchInfoPayload {
    has_notch: bool,
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    app.manage(SharedState::default());

    let trigger = WebviewWindowBuilder::new(
        app,
        "notch-trigger",
        WebviewUrl::App("desktop/notch".into()),
    )
    .title("Organize 速记")
    .inner_size(TRIGGER_SIZE.0, TRIGGER_SIZE.1)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible_on_all_workspaces(true)
    .shadow(false)
    .resizable(false)
    // 先隐藏：等 web 侧上报「隐藏激发器」设置（notch-trigger-visibility）后
    // 再决定显隐，避免已隐藏设置下启动闪现胶囊
    .visible(false)
    .build()?;

    let _panel = WebviewWindowBuilder::new(
        app,
        "notch-panel",
        WebviewUrl::App("desktop/notch".into()),
    )
    .title("Organize 速记面板")
    .inner_size(PANEL_SIZE.0, PANEL_SIZE.1)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible_on_all_workspaces(true)
    .shadow(false)
    .resizable(false)
    .visible(false)
    .build()?;

    // 胶囊要盖在系统菜单栏/刘海区域上：always_on_top 只是 floating 级（3），
    // 会被菜单栏压住，需要抬到 NSStatusWindowLevel（25，菜单栏同级）
    if let Err(error) = raise_to_status_level(&trigger) {
        eprintln!("[notch] 胶囊窗口层级设置失败: {error}");
    }

    {
        let state = app.state::<SharedState>();
        state.lock().unwrap().has_notch = detect_notch();
    }

    reposition(app);
    spawn_monitor_poll(app.clone());

    // web → rust 事件桥（emit/listen，与托盘 navigate 同模式，走 capabilities
    // 的 core:event 权限，无需为自定义命令开 ACL）
    let handle = app.clone();
    app.listen("notch-hover", move |event| {
        let Ok(HoverPayload { entered }) = serde_json::from_str(event.payload()) else {
            return;
        };
        eprintln!("[notch] hover entered={entered}");
        on_hover(&handle, entered);
    });

    let handle = app.clone();
    app.listen("notch-collapse", move |_| {
        eprintln!("[notch] collapse requested by web");
        collapse(&handle);
    });

    let handle = app.clone();
    app.listen("notch-trigger-visibility", move |event| {
        let Ok(VisibilityPayload { visible }) = serde_json::from_str(event.payload()) else {
            return;
        };
        eprintln!("[notch] trigger visibility {visible}");
        if let Some(trigger) = handle.get_webview_window("notch-trigger") {
            let _ = if visible { trigger.show() } else { trigger.hide() };
        }
        // 回执刘海检测结论：触发方（胶囊页/设置页）此时监听已挂好，
        // 见 notch-trigger.tsx 里「先 listen 再 emit」的握手顺序。
        // 用广播而非 emit_to 定向：JS listen 默认只匹配 Any 目标事件，
        // notch-info 只有胶囊页监听，无串扰
        let has_notch = handle.state::<SharedState>().lock().unwrap().has_notch;
        let _ = handle.emit("notch-info", NotchInfoPayload { has_notch });
    });

    let handle = app.clone();
    app.listen("notch-open-path", move |event| {
        let Ok(path) = serde_json::from_str::<String>(event.payload()) else {
            return;
        };
        eprintln!("[notch] open path {path}");
        if !OPEN_PATH_WHITELIST.contains(&path.as_str()) {
            return;
        }
        super::show_main_window(&handle);
        let _ = handle.emit("navigate", path);
        collapse(&handle);
    });

    Ok(())
}

/// ⌘⇧M：toggle 面板（方案决策 4 的兜底入口）
pub fn toggle(app: &AppHandle) {
    let expanded = app.state::<SharedState>().lock().unwrap().expanded;
    if expanded {
        collapse(app);
    } else if claim_expand(app) {
        show_panel(app);
    }
}

/// 面板失焦后的宽限收起（on_window_event 里 spawn 调用）
pub fn blur_collapse_after_grace(handle: AppHandle) {
    std::thread::sleep(BLUR_GRACE);
    // 宽限期内点回面板（重新拿到焦点）则不收起
    if let Some(panel) = handle.get_webview_window("notch-panel") {
        if panel.is_focused().unwrap_or(false) {
            eprintln!("[notch] blur grace: refocused, keep panel");
            return;
        }
    }
    eprintln!("[notch] blur grace elapsed, collapsing");
    collapse(&handle);
}

fn on_hover(app: &AppHandle, entered: bool) {
    app.state::<SharedState>().lock().unwrap().hovered = entered;
    if !entered {
        return;
    }
    let handle = app.clone();
    // 150ms 停留判定在 Rust 侧做：判定期间 mouseleave 到达则 hovered 已被
    // 置 false，不展开（快速划过不触发）
    std::thread::spawn(move || {
        std::thread::sleep(HOVER_DWELL);
        let should_expand = {
            let state = handle.state::<SharedState>();
            let guard = state.lock().unwrap();
            guard.hovered && !guard.expanded
        };
        eprintln!("[notch] dwell finished, should_expand={should_expand}");
        if should_expand && claim_expand(&handle) {
            show_panel(&handle);
        }
    });
}

/// 原子认领「展开」：已在展开态时返回 false（hover 判定与 ⌘⇧M 竞争时只赢一次）
fn claim_expand(app: &AppHandle) -> bool {
    let state = app.state::<SharedState>();
    let mut guard = state.lock().unwrap();
    if guard.expanded {
        false
    } else {
        guard.expanded = true;
        true
    }
}

fn show_panel(app: &AppHandle) {
    // 每次展开都重算位置：显示器几何可能已变（轮询之外的兜底）
    reposition(app);
    if let Some(panel) = app.get_webview_window("notch-panel") {
        let _ = panel.show();
        let _ = panel.set_focus();
        eprintln!("[notch] panel shown");
        // 面板页据此重放入场动画、刷新数据并聚焦输入框。广播而非 emit_to
        // 定向（JS listen 默认只匹配 Any 目标）；notch-panel-shown 事件名
        // 只有面板页监听，无串扰
        let _ = app.emit("notch-panel-shown", ());
    }
}

fn collapse(app: &AppHandle) {
    {
        let state = app.state::<SharedState>();
        let mut guard = state.lock().unwrap();
        if !guard.expanded {
            return;
        }
        guard.expanded = false;
    }
    eprintln!("[notch] panel collapsed");
    if let Some(panel) = app.get_webview_window("notch-panel") {
        let _ = panel.hide();
    }
}

/// 主显示器顶部水平居中定位：胶囊贴顶（y=0 即刘海/菜单栏顶缘），面板吊在
/// 胶囊下方。只跟主显示器（方案默认值 5：刘海只存在于内建屏，通常为主屏）。
fn reposition(app: &AppHandle) {
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return;
    };
    let scale = monitor.scale_factor();
    let size = monitor.size();
    let origin = monitor.position();
    let center_x = |width: f64| origin.x as f64 + (size.width as f64 - width * scale) / 2.0;

    if let Some(trigger) = app.get_webview_window("notch-trigger") {
        let _ = trigger.set_position(tauri::PhysicalPosition::new(
            center_x(TRIGGER_SIZE.0) as i32,
            origin.y,
        ));
    }
    if let Some(panel) = app.get_webview_window("notch-panel") {
        let y = origin.y + ((TRIGGER_SIZE.1 + PANEL_GAP) * scale) as i32;
        let _ = panel.set_position(tauri::PhysicalPosition::new(
            center_x(PANEL_SIZE.0) as i32,
            y,
        ));
    }
}

fn spawn_monitor_poll(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last: Option<(i32, i32, u32, u32)> = None;
        loop {
            std::thread::sleep(MONITOR_POLL);
            if let Ok(Some(monitor)) = app.primary_monitor() {
                let size = monitor.size();
                let origin = monitor.position();
                let key = (origin.x, origin.y, size.width, size.height);
                if last != Some(key) {
                    last = Some(key);
                    reposition(&app);
                }
            }
        }
    });
}

/// 把胶囊窗口抬到 NSStatusWindowLevel（25），与系统菜单栏同层，
/// 否则胶囊会被菜单栏盖住、永远不可见。
fn raise_to_status_level(window: &WebviewWindow) -> tauri::Result<()> {
    let raw = window.ns_window()? as *mut objc2_app_kit::NSWindow;
    let ns_window = unsafe { &*raw };
    let level: objc2_app_kit::NSWindowLevel = 25;
    ns_window.setLevel(level);
    Ok(())
}

/// 有刘海屏检测（方案默认值 4）：主屏 safeAreaInsets.top > 0。
/// setup 在主线程执行，MainThreadMarker 可安全取得。
fn detect_notch() -> bool {
    let Some(mtm) = objc2::MainThreadMarker::new() else {
        return false;
    };
    objc2_app_kit::NSScreen::mainScreen(mtm)
        .map(|screen| screen.safeAreaInsets().top > 0.0)
        .unwrap_or(false)
}
