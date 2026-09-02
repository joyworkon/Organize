//! 刘海激发器（docs/notch-trigger-plan.md 定稿 v2 + v1.1 迭代）：
//! 每块显示器顶部居中一个 `notch-trigger-{i}` 胶囊窗（主屏贴刘海，副屏为
//! 透明把手）+ 单个 `notch-panel` 速记面板，加载 web 侧同一路由
//! `/desktop/notch`（按窗口 label 分角色）。窗口均为自有窗口，不需要辅助
//! 功能权限。
//!
//! 状态机（v1.1 重做）：hover 判定不再依赖胶囊窗口的 DOM mouseenter——
//! 应用未激活时 WKWebView 收不到可靠鼠标事件（v1 实测「必须点一下才弹」
//! 的根因），改为 Rust 侧全局轮询 cursor_position() 对照各胶囊窗矩形；
//! 胶囊窗 set_ignore_cursor_events(true) 纯视觉穿透。光标停留 150ms
//! （HOVER_DWELL）展开面板并聚焦（tao set_focus 自带 activateIgnoringOtherApps，
//! 未激活也能夺焦）；失焦 120ms 宽限 / Esc / 保存成功 → 收起。
//! ⌘⇧M 兜底 toggle（见 main.rs 的 global_shortcuts）。
//!
//! 数据链路零新后端：速记/待办/快速入口全部复用既有 web API 与事件，
//! web 侧实现见 apps/web/components/desktop/notch/。
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{
    AppHandle, Emitter, Listener, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

/// hover 停留判定：光标进入胶囊区后至少悬这么久才算有意悬停（方案决策 1）
const HOVER_DWELL: Duration = Duration::from_millis(150);
/// 失焦收起宽限：误点面板外部后 120ms 内点回不收起（兼作收起动画时长）
const BLUR_GRACE: Duration = Duration::from_millis(120);
/// 主显示器几何轮询间隔：外接屏插拔 / 分辨率变化后重算胶囊位置（方案 §6）
const MONITOR_POLL: Duration = Duration::from_secs(5);
/// 光标采样间隔：80ms 足够顺滑（150ms 判定下最多 2 个采样误差）且 CPU 可忽略
const CURSOR_POLL: Duration = Duration::from_millis(80);
/// 命中判定的外扩边距（逻辑像素）：胶囊边缘几像素的误擦过也算
const HIT_INSET: f64 = 2.0;

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
    /// 光标当前是否悬在某块胶囊热区内（Rust 轮询判定，不再走 DOM 事件）
    hovered: bool,
    /// 面板是否处于展开态
    expanded: bool,
    /// 主显示器是否有刘海（NSScreen.safeAreaInsets.top > 0，方案默认值 4）
    has_notch: bool,
    /// hover 进入时刻（150ms 停留判定用）
    hovered_since: Option<Instant>,
    /// 面板当前挂在哪块屏上（reposition 用；None = 主屏）
    panel_monitor: Option<usize>,
}

type SharedState = Mutex<NotchState>;

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

    // 每块显示器顶部居中一个胶囊：主屏盖刘海，副屏做透明把手（v1.1）
    let monitor_count = app
        .available_monitors()
        .map(|monitors| monitors.len())
        .unwrap_or(1);
    for index in 0..monitor_count.max(1) {
        // 探针：确认 webview 是否到达页面加载完成（区分「没发请求」与「请求了但没水合」）
        let probe = move |window: WebviewWindow, payload: tauri::webview::PageLoadPayload| {
            eprintln!("[notch] trigger-{index} page_load event={:?} url={:?}", payload.event(), window.url().ok());
        };
        let trigger = WebviewWindowBuilder::new(
            app,
            trigger_label(index),
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
        .on_page_load(probe)
        // 纯视觉热区：鼠标事件穿透，hover 由 Rust 光标轮询判定（v1.1）。
        // 穿透同时避免胶囊挡住菜单栏点击。
        // 先隐藏：等 web 侧上报「隐藏激发器」设置（notch-trigger-visibility）后
        // 再决定显隐，避免已隐藏设置下启动闪现胶囊
        .visible(false)
        .build()?;
        // NOTE: set_ignore_cursor_events 暂缓——头部嫌疑：该调用走主线程
        // DispatchQueue.exec_async，在 setup 阶段（主线程正忙）可能死锁，
        // 阻断后续 webview 加载/水合。穿透与否待 hover 链路验证后再定。

        // 胶囊要盖在系统菜单栏/刘海区域上：always_on_top 只是 floating 级（3），
        // 会被菜单栏压住，需要抬到 NSStatusWindowLevel（25，菜单栏同级）
        if let Err(error) = raise_to_status_level(&trigger) {
            eprintln!("[notch] 胶囊窗口({index})层级设置失败: {error}");
        }
    }

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

    {
        let state = app.state::<SharedState>();
        state.lock().unwrap().has_notch = detect_notch();
    }

    reposition(app);
    spawn_monitor_poll(app.clone());
    spawn_cursor_poll(app.clone());

    // web → rust 事件桥（emit/listen，与托盘 navigate 同模式，走 capabilities
    // 的 core:event 权限，无需为自定义命令开 ACL）
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
        for index in 0..trigger_count(&handle) {
            if let Some(trigger) = handle.get_webview_window(&trigger_label(index)) {
                let _ = if visible { trigger.show() } else { trigger.hide() };
                // 穿透在 show 之后设置：先让 webview 正常加载，再切纯视觉模式
                if visible {
                    let _ = trigger.set_ignore_cursor_events(true);
                }
            }
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

/// 胶囊窗 label：每块屏一个（notch-trigger-0 = 主屏）
fn trigger_label(index: usize) -> String {
    format!("notch-trigger-{index}")
}

/// 当前实际存在的胶囊窗数量（显示器热插拔后以窗口为准）
fn trigger_count(app: &AppHandle) -> usize {
    (0..8)
        .take_while(|index| app.get_webview_window(&trigger_label(*index)).is_some())
        .count()
}

/// 光标全局轮询（v1.1 核心）：应用未激活时 WKWebView 收不到可靠鼠标事件，
/// hover 改由 Rust 侧采样 cursor_position() 对照各胶囊窗矩形判定。
/// 判定与屏幕无关、无需辅助功能权限；「在胶囊区停留 ≥HOVER_DWELL」才展开。
fn spawn_cursor_poll(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(CURSOR_POLL);
        if app.state::<SharedState>().lock().unwrap().expanded {
            // 展开态不再判定 hover（收起由失焦/Esc/保存驱动）
            continue;
        }
        let cursor = match app.cursor_position() {
            Ok(position) => position,
            Err(_) => continue,
        };
        let hit = hit_trigger(&app, cursor);
        let should_expand = {
            let state = app.state::<SharedState>();
            let mut guard = state.lock().unwrap();
            let (next_hovered, entered_changed) = match (hit, guard.hovered) {
                (true, true) => (true, false),
                (true, false) => (true, true),
                (false, true) => (false, true),
                (false, false) => (false, false),
            };
            if entered_changed {
                guard.hovered = next_hovered;
                guard.hovered_since = next_hovered.then(Instant::now);
                // 视觉反馈：胶囊透明度 15% → 40%。广播给所有胶囊窗（各自
                // 监听同名事件，行为一致），与窗口显隐无关
                let _ = app.emit("notch-hover-broadcast", serde_json::json!({ "entered": next_hovered }));
            }
            match (hit, guard.hovered_since) {
                (true, Some(since)) => since.elapsed() >= HOVER_DWELL,
                _ => false,
            }
        };
        if should_expand && claim_expand(&app) {
            eprintln!("[notch] hover dwell reached, expanding");
            // 面板挂在光标所在屏：副屏把手 hover 时面板从副屏顶部落下
            app.state::<SharedState>().lock().unwrap().panel_monitor =
                monitor_index_at(&app, cursor);
            show_panel(&app);
        }
    });
}

/// 光标是否落在任一胶囊窗矩形内（物理坐标比较，外扩 HIT_INSET 容差）
fn hit_trigger(app: &AppHandle, cursor: tauri::PhysicalPosition<f64>) -> bool {
    (0..trigger_count(app)).any(|index| {
        app.get_webview_window(&trigger_label(index))
            .and_then(|trigger| {
                let position = trigger.outer_position().ok()?;
                let size = trigger.outer_size().ok()?;
                Some((position, size))
            })
            .is_some_and(|(position, size)| {
                let scale = app
                    .get_webview_window(&trigger_label(index))
                    .and_then(|trigger| trigger.scale_factor().ok())
                    .unwrap_or(1.0);
                let inset = HIT_INSET * scale;
                let left = position.x as f64 - inset;
                let right = position.x as f64 + size.width as f64 + inset;
                let top = position.y as f64 - inset;
                let bottom = position.y as f64 + size.height as f64 + inset;
                cursor.x >= left && cursor.x <= right && cursor.y >= top && cursor.y <= bottom
            })
    })
}

/// 光标所在屏的索引（0 = 主屏）；找不到时回退主屏
fn monitor_index_at(app: &AppHandle, cursor: tauri::PhysicalPosition<f64>) -> Option<usize> {
    let monitors = app.available_monitors().ok()?;
    let target = monitors
        .iter()
        .position(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            let (x, y) = (position.x as f64, position.y as f64);
            let (w, h) = (size.width as f64, size.height as f64);
            cursor.x >= x && cursor.x <= x + w && cursor.y >= y && cursor.y <= y + h
        })
        .or(Some(0));
    target
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
        // tao set_focus 内部 makeKeyAndOrderFront + activateIgnoringOtherApps，
        // 应用未激活（速记主场景）也能把面板带到前台
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
        guard.hovered = false;
        guard.hovered_since = None;
    }
    eprintln!("[notch] panel collapsed");
    if let Some(panel) = app.get_webview_window("notch-panel") {
        let _ = panel.hide();
    }
}

/// 多屏定位（v1.1）：每块屏顶部居中一个胶囊（主屏贴刘海，副屏透明把手），
/// 面板吊在 panel_monitor 指定屏（None = 主屏）的胶囊下方。
fn reposition(app: &AppHandle) {
    let Ok(monitors) = app.available_monitors() else {
        return;
    };
    if monitors.is_empty() {
        return;
    }
    // available_monitors 顺序不定，主屏排第 0：与 trigger_label 索引对齐
    let primary = app.primary_monitor().ok().flatten();
    let primary_id = primary.as_ref().and_then(|monitor| monitor.name());
    let mut ordered: Vec<&tauri::Monitor> = monitors.iter().collect();
    ordered.sort_by_key(|monitor| {
        // 主屏恒为 0，其余按位置稳定排序（插拔后索引漂移可接受：胶囊均等价）
        let is_primary = primary_id.as_deref().is_some_and(|id| monitor.name().as_deref() == Some(id));
        match is_primary {
            true => (0, monitor.position().x),
            false => (1, monitor.position().x),
        }
    });

    for (index, monitor) in ordered.iter().enumerate() {
        let Some(trigger) = app.get_webview_window(&trigger_label(index)) else {
            break; // 窗口数是启动时按屏数建好的，超出即不再有
        };
        let scale = monitor.scale_factor();
        let size = monitor.size();
        let origin = monitor.position();
        let center_x = origin.x as f64 + (size.width as f64 - TRIGGER_SIZE.0 * scale) / 2.0;
        let _ = trigger.set_position(tauri::PhysicalPosition::new(
            center_x as i32,
            origin.y,
        ));

        if index == panel_monitor_index(app) {
            let y = origin.y + ((TRIGGER_SIZE.1 + PANEL_GAP) * scale) as i32;
            if let Some(panel) = app.get_webview_window("notch-panel") {
                let panel_x =
                    origin.x as f64 + (size.width as f64 - PANEL_SIZE.0 * scale) / 2.0;
                let _ = panel.set_position(tauri::PhysicalPosition::new(
                    panel_x as i32,
                    y,
                ));
            }
        }
    }
}

/// 面板应挂载的屏索引：hover 展开时光标所在屏；⌘⇧M 兜底为主屏（None）
fn panel_monitor_index(app: &AppHandle) -> usize {
    app.state::<SharedState>().lock().unwrap().panel_monitor.unwrap_or(0)
}

fn spawn_monitor_poll(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last: Option<Vec<(i32, i32, u32, u32)>> = None;
        loop {
            std::thread::sleep(MONITOR_POLL);
            if let Ok(monitors) = app.available_monitors() {
                let mut keys: Vec<(i32, i32, u32, u32)> = monitors
                    .iter()
                    .map(|monitor| {
                        let origin = monitor.position();
                        let size = monitor.size();
                        (origin.x, origin.y, size.width, size.height)
                    })
                    .collect();
                keys.sort();
                if last != Some(keys.clone()) {
                    last = Some(keys);
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
