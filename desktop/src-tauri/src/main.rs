#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

#[cfg(target_os = "macos")]
mod notch;

/// 显示并聚焦主窗口（托盘「显示主窗口」「打开速记」、⌘⇧S 与 macOS Dock 图标点击共用）。
fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 全局快捷键注册清单：⌘⇧S 快速保存（全平台）+ ⌘⇧M 刘海速记面板（仅 macOS）。
#[cfg(target_os = "macos")]
fn global_shortcuts() -> Vec<&'static str> {
    vec!["CmdOrCtrl+Shift+S", "CmdOrCtrl+Shift+M"]
}

#[cfg(not(target_os = "macos"))]
fn global_shortcuts() -> Vec<&'static str> {
    vec!["CmdOrCtrl+Shift+S"]
}

/// deep link → 应用内路径（白名单两段式，复用前端既有 navigate 通道）：
/// organize://note/<id> → /notes/<id>；organize://task/<id> → /tasks/<id>
/// （路由段与 app/(main)/notes/[id]、app/(main)/tasks/[id] 一致）。
/// id 只允许字母数字与连字符（UUID 形态），拒绝查询串/路径穿越/其余 host，
/// 保证经 navigate 事件只能跳应用内详情页。
fn deep_link_path(raw: &str) -> Option<String> {
    let url = tauri::Url::parse(raw).ok()?;
    if url.scheme() != "organize" {
        return None;
    }
    let host = url.host_str()?;
    let segment = url.path().trim_start_matches('/').split('/').next()?;
    if segment.is_empty()
        || segment.len() > 64
        || !segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return None;
    }
    match host {
        "note" => Some(format!("/notes/{segment}")),
        "task" => Some(format!("/tasks/{segment}")),
        _ => None,
    }
}

/// 冷启动专用：webview 尚未加载、前端 NavigateBridge 未开始监听时直接 emit
/// 会丢失事件。分段重试（2s/5s/10s）覆盖远程页面慢加载；Next 路由对相同
/// 路径的重复 push 是 no-op，多次投递无害。热启动（应用已在跑）不走这里，
/// single-instance 回调直接单次 emit。
fn emit_navigate_cold_start<R: tauri::Runtime>(app: &tauri::AppHandle<R>, path: String) {
    let handle = app.clone();
    std::thread::spawn(move || {
        for delay_ms in [2000, 5000, 10000] {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
            let _ = handle.emit("navigate", &path);
        }
    });
}

fn main() {
    tauri::Builder::default()
        // single-instance 必须最先注册（官方要求）：二次启动时把携带的
        // organize:// URL 转发给首实例并唤起主窗（Windows 任务栏/开始菜单
        // 再次点击、其他应用调起 deep link 都走这里）
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            show_main_window(app);
            if let Some(path) = args.iter().rev().find_map(|arg| deep_link_path(arg)) {
                let _ = app.emit("navigate", path);
            }
        }))
        .plugin(tauri_plugin_notification::init())
        // 自动更新（W2）：更新清单指 Release 的 latest.json，签名公钥在 tauri.conf.json；
        // 重启落盘由 process 插件的 relaunch 承担（前端 components/desktop/updater.tsx 驱动）
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            // 全局快捷键只注册一次（Builder 上不再挂 global-shortcut 插件，重复注册会 panic）：
            // with_shortcuts 在插件 setup 时完成系统级注册（此前只挂 handler、
            // 未注册快捷键，事件永远不会触发）。
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_shortcuts(global_shortcuts())?
                    .with_handler(|app, shortcut, event| {
                        if event.state != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                            return;
                        }
                        // ⌘⇧M：toggle 刘海速记面板（notch-trigger-plan 决策 4）
                        #[cfg(target_os = "macos")]
                        {
                            if let Ok(panel_toggle) =
                                "CmdOrCtrl+Shift+M".parse::<tauri_plugin_global_shortcut::Shortcut>()
                            {
                                if shortcut == &panel_toggle {
                                    notch::toggle(app);
                                    return;
                                }
                            }
                        }
                        #[cfg(not(target_os = "macos"))]
                        let _ = shortcut;
                        // ⌘⇧S：快捷键随时可能按下，先把驻留中的主窗口带回来再弹层。
                        show_main_window(app);
                        let _ = app.emit("quick-save", ());
                    })
                    .build(),
            )?;

            // 托盘常驻：点红色关闭只是隐藏窗口（见 on_window_event），
            // 应用驻留菜单栏，托盘「退出」才真正退出。
            let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let memos = MenuItem::with_id(app, "memos", "打开速记", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出 Organize", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &memos, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().expect("app icon missing").clone())
                .tooltip("Organize")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "memos" => {
                        show_main_window(app);
                        let _ = app.emit("navigate", "/memos");
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // 刘海激发器：初始化失败不拖垮主功能（胶囊是增强入口，⌘⇧M 面板
            // 也依赖这两窗口，但托盘/主窗口不受影响）
            #[cfg(target_os = "macos")]
            if let Err(error) = notch::init(app.handle()) {
                eprintln!("[notch] 初始化失败（忽略，不影响主功能）: {error}");
            }

            // deep link 冷启动：进程首次启动即被 organize:// 唤起（首实例无二次
            // 启动，single-instance 回调不会触发），走分段重试投递给前端
            use tauri_plugin_deep_link::DeepLinkExt;
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                if let Some(path) = urls.iter().find_map(|url| deep_link_path(url.as_str())) {
                    emit_navigate_cold_start(app.handle(), path);
                }
            }

            // 小窗创建可能把键窗口带偏到胶囊上（180×28 抢走键盘焦点），
            // 启动收尾把焦点还给主窗口
            #[cfg(target_os = "macos")]
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_focus();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关窗驻留：拦下所有窗口的关闭请求改为隐藏，配合托盘形成常驻体验。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
                return;
            }
            // 面板失焦 → 120ms 宽限后收起（误点外部瞬间点回不收起）
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::Focused(false) = event {
                if window.label() == "notch-panel" {
                    let handle = window.app_handle().clone();
                    std::thread::spawn(move || notch::blur_collapse_after_grace(handle));
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS：应用无可视窗口时点击 Dock 图标 → 重新显示主窗口。
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                if !has_visible_windows {
                    show_main_window(app);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::deep_link_path;

    #[test]
    fn parses_note_and_task_to_app_paths() {
        assert_eq!(
            deep_link_path("organize://note/550e8400-e29b-41d4-a716-446655440000").as_deref(),
            Some("/notes/550e8400-e29b-41d4-a716-446655440000")
        );
        assert_eq!(
            deep_link_path("organize://task/abc-123").as_deref(),
            Some("/tasks/abc-123")
        );
        // 查询串与多余段被丢弃，只保留首段 id
        assert_eq!(
            deep_link_path("organize://note/note-1?src=share").as_deref(),
            Some("/notes/note-1")
        );
        assert_eq!(
            deep_link_path("organize://task/t1/extra").as_deref(),
            Some("/tasks/t1")
        );
    }

    #[test]
    fn rejects_schemes_hosts_and_unsafe_ids() {
        // 非 organize scheme
        assert!(deep_link_path("https://note/abc").is_none());
        assert!(deep_link_path("http://organize/note/abc").is_none());
        // 白名单外 host（不允许任意路径注入 navigate 通道）
        assert!(deep_link_path("organize://settings/x").is_none());
        assert!(deep_link_path("organize://evil/abc").is_none());
        // 空 id / 路径穿越 / 特殊字符 / 超长
        assert!(deep_link_path("organize://note/").is_none());
        assert!(deep_link_path("organize://note/..%2Fsettings").is_none());
        assert!(deep_link_path("organize://note/not%20safe").is_none());
        assert!(deep_link_path(&format!("organize://note/{}", "a".repeat(65))).is_none());
        // 非 UTF-8 解析失败的输入由 Url::parse 兜底拒绝
        assert!(deep_link_path("not a url").is_none());
    }
}
