#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

/// 显示并聚焦主窗口（托盘「显示主窗口」「打开速记」与 macOS Dock 图标点击共用）。
fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // 全局快捷键只注册一次（Builder 上不再挂 global-shortcut 插件，重复注册会 panic）：
            // Cmd/Ctrl+Shift+S → 向前端发 quick-save 事件，触发快速保存链接。
            // with_shortcuts 在插件 setup 时完成系统级注册（此前只挂 handler、
            // 未注册快捷键，事件永远不会触发）。
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_shortcuts(["CmdOrCtrl+Shift+S"])?
                    .with_handler(move |app, _shortcut, event| {
                        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                            // 快捷键随时可能按下，先把驻留中的主窗口带回来再弹层。
                            show_main_window(app);
                            let _ = app.emit("quick-save", ());
                        }
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
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关窗驻留：拦下主窗口关闭请求改为隐藏，配合托盘形成常驻体验。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
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
