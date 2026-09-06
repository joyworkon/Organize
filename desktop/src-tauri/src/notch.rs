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
//! ⌘⇧M 兜底 toggle（见 main.rs 的 global_shortcuts）。用户在设置里隐藏激发器时
//! （web 上报 notch-trigger-visibility），hover 热区随胶囊一起失效，展开入口只剩 ⌘⇧M。
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
/// 收起延迟：光标离开面板+胶囊区后宽限这么久（覆盖滑过缝隙的瞬间）再自动收起
const COLLAPSE_DELAY: Duration = Duration::from_millis(300);
/// 「靠近」判定区：光标距胶囊边缘 ≤ 该值（逻辑像素）时触发副屏把手/主屏箭头提示
const NEAR_INSET: f64 = 48.0;
/// K01：web 面板上报活动（输入/组合中/保存中）后的忙碌保持时长。
/// 每次上报顺延；超时无上报视为空闲，恢复光标离开自动收起。
const ACTIVITY_TTL: Duration = Duration::from_millis(1500);

/// trigger 窗口需额外容纳主屏刘海下方的靠近提示箭头；可见胶囊仍固定在顶部。
const TRIGGER_SIZE: (f64, f64) = (180.0, 40.0);
const CAPSULE_HEIGHT: f64 = 28.0;
const PANEL_SIZE: (f64, f64) = (380.0, 520.0);
/// 胶囊与面板的间距（逻辑像素）
const PANEL_GAP: f64 = 8.0;

/// 面板快速入口跳转白名单——web 侧 lib/desktop/notch.ts 的 NOTCH_OPEN_PATHS
/// 镜像；主窗口接收端另有 sanitizeNavigatePath 兜底，这里是第一道闸
const OPEN_PATH_WHITELIST: [&str; 6] = [
    "/memos",
    "/library",
    "/notes",
    "/tasks",
    "/settings",
    "/login",
];

/// K04：uuid 形态深链校验（/notes/<uuid>、/tasks?task=<uuid>）——
/// 只放行合法 uuid，与 web 侧 isNotchOpenPathAllowed 镜像
fn is_uuid(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    for (index, ch) in bytes.iter().enumerate() {
        match index {
            8 | 13 | 18 | 23 => {
                if *ch != b'-' {
                    return false;
                }
            }
            _ => {
                if !(*ch as char).is_ascii_hexdigit() {
                    return false;
                }
            }
        }
    }
    true
}

fn is_open_path_allowed(path: &str) -> bool {
    if OPEN_PATH_WHITELIST.contains(&path) {
        return true;
    }
    if let Some(id) = path.strip_prefix("/notes/") {
        return is_uuid(id);
    }
    if let Some(rest) = path.strip_prefix("/tasks?task=") {
        return is_uuid(rest);
    }
    false
}

#[derive(Default)]
struct NotchState {
    /// 面板是否处于展开态
    expanded: bool,
    /// 本机主屏是否带刘海：detect_notch() 依赖 MainThreadMarker，只有主线程拿得到，
    /// 故 setup 阶段算一次缓存；后台线程的 reposition 复用此值，不重算
    has_hardware_notch: bool,
    /// 每块 trigger 所在屏是否有刘海（主屏 safeAreaInsets.top；外接屏默认无刘海）
    has_notch_by_trigger: Vec<bool>,
    /// 胶囊当前是否可见：由 web 侧 notch-trigger-visibility 上报。
    /// 隐藏时 hover 热区一并失效（⌘⇧M 仍是兜底入口）；启动默认 false，
    /// 与窗口 .visible(false) 一致，避免设置里已隐藏时启动瞬间还能误触发
    trigger_visible: bool,
    /// 光标当前命中/靠近的胶囊索引（None = 都不在）
    active_trigger: Option<usize>,
    /// 进入当前胶囊的时刻（150ms 停留判定用）
    active_since: Option<Instant>,
    /// 展开后光标离开「面板+全部胶囊」区的时刻（300ms 延迟收起用）
    away_since: Option<Instant>,
    /// 面板当前挂在哪块屏上（reposition 用；None = 主屏）
    panel_monitor: Option<usize>,
    /// K01：面板忙碌截止时刻（web 输入/组合/保存中周期性上报 notch-activity）。
    /// 忙碌期间光标离开不自动收起，键盘输入不被打断。
    busy_until: Option<Instant>,
    /// K01：本次展开是否由 ⌘⇧M 显式触发。sticky 期间不看光标离开，
    /// 由 Esc/保存/再按 ⌘⇧M/失焦（blur 宽限）负责关闭。
    sticky_open: bool,
    /// K01：收起时光标仍压在热区上 → 需先离开一次才允许再次悬停展开
    /// （防 Esc/保存收起后被持续悬停立即重开的「抢焦循环」）。
    rearm_required: bool,
}

type SharedState = Mutex<NotchState>;

#[derive(serde::Deserialize)]
struct VisibilityPayload {
    visible: bool,
}

#[derive(serde::Serialize, Clone)]
struct NotchInfoPayload {
    trigger: usize,
    has_notch: bool,
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    app.manage(SharedState::default());

    // 每块显示器顶部居中一个胶囊：主屏盖刘海，副屏做透明把手（v1.1；K02 抽出 build_trigger_window 共用）
    let monitor_count = app
        .available_monitors()
        .map(|monitors| monitors.len())
        .unwrap_or(1);
    for index in 0..monitor_count.max(1) {
        if let Err(error) = build_trigger_window(app, index) {
            eprintln!("[notch] 胶囊窗口({index})创建失败: {error}");
        }
    }

    let _panel =
        WebviewWindowBuilder::new(app, "notch-panel", WebviewUrl::App("desktop/notch".into()))
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

    // 刘海硬件检测只能在主线程做（detect_notch 依赖 MainThreadMarker）：
    // setup 跑在主线程，这里算一次缓存，reposition 在后台线程复用它
    app.state::<SharedState>()
        .lock()
        .unwrap()
        .has_hardware_notch = detect_notch();

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

    // K01：面板活动心跳——忙碌期 tick_expanded 不做「光标离开」自动收起
    let handle = app.clone();
    app.listen("notch-activity", move |_| {
        let state = handle.state::<SharedState>();
        let mut guard = state.lock().unwrap();
        guard.busy_until = Some(Instant::now() + ACTIVITY_TTL);
    });

    // K03：数据变更桥——任一 webview 发 notch-data-changed，
    // 广播 organize-data-changed 给全部窗口（panel ↔ 主窗口互相同步）
    let handle = app.clone();
    app.listen("notch-data-changed", move |event| {
        eprintln!("[notch] data changed bridge");
        let _ = handle.emit("organize-data-changed", event.payload());
    });

    let handle = app.clone();
    app.listen("notch-trigger-visibility", move |event| {
        let Ok(VisibilityPayload { visible }) = serde_json::from_str(event.payload()) else {
            return;
        };
        eprintln!("[notch] trigger visibility {visible}");
        handle
            .state::<SharedState>()
            .lock()
            .unwrap()
            .trigger_visible = visible;
        for index in 0..trigger_count(&handle) {
            if let Some(trigger) = handle.get_webview_window(&trigger_label(index)) {
                let _ = if visible {
                    trigger.show()
                } else {
                    trigger.hide()
                };
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
        let has_notch_by_trigger = handle
            .state::<SharedState>()
            .lock()
            .unwrap()
            .has_notch_by_trigger
            .clone();
        for (trigger, has_notch) in has_notch_by_trigger.into_iter().enumerate() {
            let _ = handle.emit("notch-info", NotchInfoPayload { trigger, has_notch });
        }
    });

    let handle = app.clone();
    app.listen("notch-open-path", move |event| {
        let Ok(path) = serde_json::from_str::<String>(event.payload()) else {
            return;
        };
        eprintln!("[notch] open path {path}");
        if !is_open_path_allowed(&path) {
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
        // K01：显式入口展开 → sticky 模式，不因光标不在面板而进入收起倒计时
        app.state::<SharedState>().lock().unwrap().sticky_open = true;
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

/// 光标全局轮询（v1.2 重写）：
/// - 折叠态：判定光标是否命中某胶囊，同一块停留 ≥HOVER_DWELL → 展开
/// - 展开态：持续追踪光标，「离开面板+所有胶囊 ≥COLLAPSE_DELAY」→ 收起；
///   「命中另一块屏的胶囊」→ 面板切屏重挂
/// - 命中/靠近状态广播给胶囊窗（hover 加宽 + 靠近出箭头提示）
fn spawn_cursor_poll(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(CURSOR_POLL);
        let cursor = match app.cursor_position() {
            Ok(position) => position,
            Err(_) => continue,
        };
        let (expanded, trigger_visible) = {
            let state = app.state::<SharedState>();
            let guard = state.lock().unwrap();
            (guard.expanded, guard.trigger_visible)
        };
        // 胶囊被隐藏时热区一并失效：命中/靠近恒为 None，展开入口只剩 ⌘⇧M。
        // 展开态仍要跑 tick_expanded，否则面板收不起来
        let hit = if trigger_visible {
            hit_trigger(&app, cursor)
        } else {
            None
        };
        // 「靠近」仅折叠态广播：展开后光标本来就在胶囊下方活动，广播无意义
        let near = if expanded || !trigger_visible {
            None
        } else {
            near_trigger(&app, cursor)
        };
        if expanded {
            tick_expanded(&app, cursor, hit);
        } else {
            tick_collapsed(&app, cursor, hit, near);
        }
    });
}

/// 折叠态 tick：命中判定 + 150ms 停留展开 + hover/靠近视觉广播
fn tick_collapsed(
    app: &AppHandle,
    cursor: tauri::PhysicalPosition<f64>,
    hit: Option<usize>,
    near: Option<usize>,
) {
    let should_expand = {
        let state = app.state::<SharedState>();
        let mut guard = state.lock().unwrap();
        let changed = guard.active_trigger != hit;
        if changed {
            guard.active_trigger = hit;
            guard.active_since = hit.map(|_| Instant::now());
        }
        // K01：光标仍压在热区上时收起过的，必须先离开一次才允许重新悬停展开
        let rearm_block = guard.rearm_required && hit.is_some();
        if guard.rearm_required && hit.is_none() {
            guard.rearm_required = false;
        }
        let entered = hit.is_some();
        let _ = app.emit(
            "notch-hover-broadcast",
            serde_json::json!({ "entered": entered, "trigger": hit, "near": near }),
        );
        match (hit, guard.active_since) {
            (Some(_), Some(since)) => !rearm_block && since.elapsed() >= HOVER_DWELL,
            _ => false,
        }
    };
    if should_expand && claim_expand(app) {
        eprintln!("[notch] hover dwell reached, expanding (trigger={hit:?})");
        // 面板挂在光标所在屏：副屏把手 hover 时面板从副屏顶部落下
        app.state::<SharedState>().lock().unwrap().panel_monitor = monitor_index_at(app, cursor);
        show_panel(app);
    }
}

/// 展开态 tick：离开自动收起 + 跨屏切换
fn tick_expanded(app: &AppHandle, cursor: tauri::PhysicalPosition<f64>, hit: Option<usize>) {
    let in_panel = cursor_in_panel(app, cursor);
    let inside = in_panel || hit.is_some();

    let (should_collapse, switch_to) = {
        let state = app.state::<SharedState>();
        let mut guard = state.lock().unwrap();
        let current_monitor = guard.panel_monitor.unwrap_or(0);

        // 跨屏切换：命中另一块屏的胶囊（直接命中即切，无需停留）
        let switch_to = hit.filter(|&index| index != current_monitor);

        if inside {
            guard.away_since = None;
        } else if guard.away_since.is_none() {
            guard.away_since = Some(Instant::now());
        }
        // K01：忙碌期按「光标仍在场」处理；sticky（⌘⇧M 显式展开）完全不看光标，
        // 由 Esc/保存/⌘⇧M/失焦（blur 宽限）负责关闭
        let busy = guard.busy_until.is_some_and(|until| Instant::now() < until);
        let leave_based_collapse = !guard.sticky_open && !busy;
        let should_collapse = leave_based_collapse
            && switch_to.is_none()
            && guard
                .away_since
                .is_some_and(|since| since.elapsed() >= COLLAPSE_DELAY);
        (should_collapse, switch_to)
    };

    if let Some(index) = switch_to {
        // K01：sticky/忙碌时不因光标扫过副屏胶囊而切换面板位置
        let sticky_or_busy = {
            let state = app.state::<SharedState>();
            let guard = state.lock().unwrap();
            guard.sticky_open || guard.busy_until.is_some_and(|until| Instant::now() < until)
        };
        if !sticky_or_busy {
            eprintln!("[notch] cross-monitor hover, switching panel to trigger-{index}");
            app.state::<SharedState>().lock().unwrap().panel_monitor = Some(index);
            reposition(app);
        }
        return;
    }
    if should_collapse {
        eprintln!("[notch] cursor left panel+triggers, collapsing");
        collapse(app);
    }
}

/// 光标是否落在面板矩形内
fn cursor_in_panel(app: &AppHandle, cursor: tauri::PhysicalPosition<f64>) -> bool {
    app.get_webview_window("notch-panel")
        .and_then(|panel| {
            let position = panel.outer_position().ok()?;
            let size = panel.outer_size().ok()?;
            Some((position, size))
        })
        .is_some_and(|(position, size)| {
            let inset = 2.0;
            cursor.x >= position.x as f64 - inset
                && cursor.x <= position.x as f64 + size.width as f64 + inset
                && cursor.y >= position.y as f64 - inset
                && cursor.y <= position.y as f64 + size.height as f64 + inset
        })
}

/// 光标落在哪个胶囊窗矩形内（物理坐标比较，外扩 HIT_INSET 容差）
fn hit_trigger(app: &AppHandle, cursor: tauri::PhysicalPosition<f64>) -> Option<usize> {
    trigger_hit_with_inset(app, cursor, HIT_INSET)
}

/// 光标是否靠近某胶囊（外扩 NEAR_INSET）：仅折叠态用于箭头/把手提示
fn near_trigger(app: &AppHandle, cursor: tauri::PhysicalPosition<f64>) -> Option<usize> {
    trigger_hit_with_inset(app, cursor, NEAR_INSET)
}

/// 按外扩边距求命中的胶囊索引
fn trigger_hit_with_inset(
    app: &AppHandle,
    cursor: tauri::PhysicalPosition<f64>,
    inset_logical: f64,
) -> Option<usize> {
    (0..trigger_count(app)).find(|index| {
        app.get_webview_window(&trigger_label(*index))
            .and_then(|trigger| {
                let position = trigger.outer_position().ok()?;
                let size = trigger.outer_size().ok()?;
                Some((position, size))
            })
            .is_some_and(|(position, size)| {
                let scale = app
                    .get_webview_window(&trigger_label(*index))
                    .and_then(|trigger| trigger.scale_factor().ok())
                    .unwrap_or(1.0);
                let inset = inset_logical * scale;
                let left = position.x as f64 - inset;
                let right = position.x as f64 + size.width as f64 + inset;
                let top = position.y as f64 - inset;
                let bottom = position.y as f64 + size.height as f64 + inset;
                cursor.x >= left && cursor.x <= right && cursor.y >= top && cursor.y <= bottom
            })
    })
}

/// K02：统一的显示器排序（主屏恒为索引 0，其余按 x 坐标）。
/// reposition 与 monitor_index_at 共用同一映射，插拔/切主屏后索引不漂移错位。
fn ordered_monitors(app: &AppHandle) -> Option<Vec<tauri::Monitor>> {
    let monitors = app.available_monitors().ok()?;
    let primary = app.primary_monitor().ok().flatten();
    let primary_id = primary.as_ref().and_then(|monitor| monitor.name());
    let mut ordered: Vec<tauri::Monitor> = monitors;
    ordered.sort_by_key(|monitor| {
        let is_primary = primary_id
            .as_deref()
            .is_some_and(|id| monitor.name().as_deref() == Some(id));
        match is_primary {
            true => (0, monitor.position().x),
            false => (1, monitor.position().x),
        }
    });
    Some(ordered)
}

/// 光标所在屏的索引（0 = 主屏）；找不到时回退主屏。
/// K02：使用与 reposition 相同的排序，索引含义始终一致。
fn monitor_index_at(app: &AppHandle, cursor: tauri::PhysicalPosition<f64>) -> Option<usize> {
    let ordered = ordered_monitors(app)?;
    let target = ordered
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
    // 先取光标（系统调用不持有状态锁）
    let cursor_now = app.cursor_position().ok();
    {
        let state = app.state::<SharedState>();
        let mut guard = state.lock().unwrap();
        if !guard.expanded {
            return;
        }
        guard.expanded = false;
        guard.active_trigger = None;
        guard.active_since = None;
        guard.away_since = None;
        guard.sticky_open = false;
        guard.busy_until = None;
        // K01：光标仍压在热区上 → 封锁再次悬停展开直至先离开
        if cursor_now.is_some_and(|cursor| hit_trigger(app, cursor).is_some()) {
            guard.rearm_required = true;
        }
    }
    eprintln!("[notch] panel collapsed");
    if let Some(panel) = app.get_webview_window("notch-panel") {
        let _ = panel.hide();
    }
}

/// 多屏定位（v1.1）：每块屏顶部居中一个胶囊（主屏贴刘海，副屏透明把手），
/// 面板吊在 panel_monitor 指定屏（None = 主屏）的胶囊下方。
fn reposition(app: &AppHandle) {
    let Some(monitors) = ordered_monitors(app) else {
        return;
    };
    if monitors.is_empty() {
        return;
    }
    // K02：窗口数与屏数对齐——新增屏补建胶囊，拔掉的屏回收多余胶囊。
    // 窗口创建/销毁需主线程，从轮询线程转投
    let desired = monitors.len();
    let existing = trigger_count(app);
    if desired > existing {
        let app_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            for index in existing..desired {
                if let Err(error) = build_trigger_window(&app_main, index) {
                    eprintln!("[notch] 胶囊窗口({index})补建失败: {error}");
                }
            }
        });
    } else if desired < existing {
        let app_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            for index in desired..existing {
                if let Some(extra) = app_main.get_webview_window(&trigger_label(index)) {
                    eprintln!("[notch] 回收多余胶囊窗口 trigger-{index}");
                    let _ = extra.close();
                }
            }
        });
    }

    // 用 setup 缓存的硬件结论，绝不在此重算 detect_notch()：本函数会在光标轮询 /
    // 显示器轮询的后台线程上被调用，那里取不到 MainThreadMarker，重算会把刘海判成 false
    {
        let state = app.state::<SharedState>();
        let mut guard = state.lock().unwrap();
        let has_hardware_notch = guard.has_hardware_notch;
        guard.has_notch_by_trigger = (0..monitors.len())
            .map(|index| index == 0 && has_hardware_notch)
            .collect();
    }

    for (index, monitor) in monitors.iter().enumerate() {
        let Some(trigger) = app.get_webview_window(&trigger_label(index)) else {
            continue; // K02：屏被拔掉的瞬间窗口可能已不在——跳过而非中断后续屏
        };
        let scale = monitor.scale_factor();
        let size = monitor.size();
        let origin = monitor.position();
        let center_x = origin.x as f64 + (size.width as f64 - TRIGGER_SIZE.0 * scale) / 2.0;
        let _ = trigger.set_position(tauri::PhysicalPosition::new(center_x as i32, origin.y));

        if index == panel_monitor_index(app) {
            // 面板从可见胶囊下缘下落；trigger 窗口额外高度仅供提示箭头，不能下推面板。
            let y = origin.y + ((CAPSULE_HEIGHT + PANEL_GAP) * scale) as i32;
            if let Some(panel) = app.get_webview_window("notch-panel") {
                let panel_x = origin.x as f64 + (size.width as f64 - PANEL_SIZE.0 * scale) / 2.0;
                let _ = panel.set_position(tauri::PhysicalPosition::new(panel_x as i32, y));
            }
        }
    }
}

/// 面板应挂载的屏索引：hover 展开时光标所在屏；⌘⇧M 兜底为主屏（None）
fn panel_monitor_index(app: &AppHandle) -> usize {
    app.state::<SharedState>()
        .lock()
        .unwrap()
        .panel_monitor
        .unwrap_or(0)
}

fn spawn_monitor_poll(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last: Option<Vec<(i32, i32, u32, u32)>> = None;
        let mut last_primary: Option<String> = None;
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
                // K02：主屏身份变化（内外屏切主屏/合盖）→ 刘海结论重算（需主线程）
                let primary_name: Option<String> = app
                    .primary_monitor()
                    .ok()
                    .flatten()
                    .and_then(|monitor| monitor.name().cloned());
                if last.is_some() && primary_name != last_primary {
                    let app_main = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        app_main.state::<SharedState>().lock().unwrap().has_hardware_notch =
                            detect_notch();
                        eprintln!("[notch] primary monitor changed, re-detected notch");
                    });
                }
                last_primary = primary_name;
                if last != Some(keys.clone()) {
                    last = Some(keys);
                    reposition(&app);
                }
            }
        }
    });
}

/// 按索引构建一枚胶囊窗口（init 与 K02 热插拔补建共用）
fn build_trigger_window(app: &AppHandle, index: usize) -> tauri::Result<WebviewWindow> {
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
    // 纯视觉热区：鼠标事件穿透，hover 由 Rust 光标轮询判定（v1.1）。
    // 先隐藏：等 web 侧上报「隐藏激发器」设置后再决定显隐与穿透
    .visible(false)
    .build()?;

    // 胶囊要盖在系统菜单栏/刘海区域上：always_on_top 只是 floating 级（3），
    // 会被菜单栏压住，需要抬到 NSStatusWindowLevel（25，菜单栏同级）
    if let Err(error) = raise_to_status_level(&trigger) {
        eprintln!("[notch] 胶囊窗口({index})层级设置失败: {error}");
    }
    // 热插拔补建的窗口跟启动时已显示的胶囊保持同一可见状态
    let visible = app.state::<SharedState>().lock().unwrap().trigger_visible;
    if visible {
        let _ = trigger.show();
        let _ = trigger.set_ignore_cursor_events(true);
    }
    Ok(trigger)
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
