#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Emitter;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // 全局快捷键只注册一次（Builder 上不再挂 global-shortcut 插件，重复注册会 panic）：
            // Cmd/Ctrl+Shift+S → 向前端发 quick-save 事件，触发快速保存链接。
            // with_shortcuts 在插件 setup 时完成系统级注册（此前只挂 handler、
            // 未注册快捷键，事件永远不会触发）。
            let handle = app.handle().clone();
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_shortcuts(["CmdOrCtrl+Shift+S"])?
                    .with_handler(move |_app, _shortcut, event| {
                        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                            let _ = handle.emit("quick-save", ());
                        }
                    })
                    .build(),
            )?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
