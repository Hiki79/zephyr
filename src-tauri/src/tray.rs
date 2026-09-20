use crate::AppState;
use serde_json::json;
use tauri::menu::{CheckMenuItem, MenuBuilder, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

/// Handles to the checkable tray items, so the menu can be kept in step with
/// the app's real state whether it changed from the window or the tray.
pub struct TrayState {
    sys_proxy: CheckMenuItem<Wry>,
    tun: CheckMenuItem<Wry>,
    mode_rule: CheckMenuItem<Wry>,
    mode_global: CheckMenuItem<Wry>,
    mode_direct: CheckMenuItem<Wry>,
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示 Zephyr", true, None::<&str>)?;
    let sys_proxy =
        CheckMenuItem::with_id(app, "sys_proxy", "系统代理", true, false, None::<&str>)?;
    let tun = CheckMenuItem::with_id(app, "tun", "TUN 模式", true, false, None::<&str>)?;
    let mode_rule = CheckMenuItem::with_id(app, "mode_rule", "规则", true, false, None::<&str>)?;
    let mode_global =
        CheckMenuItem::with_id(app, "mode_global", "全局", true, false, None::<&str>)?;
    let mode_direct =
        CheckMenuItem::with_id(app, "mode_direct", "直连", true, false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 Zephyr", true, None::<&str>)?;

    let menu = MenuBuilder::new(app)
        .item(&show)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&sys_proxy)
        .item(&tun)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&mode_rule)
        .item(&mode_global)
        .item(&mode_direct)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&quit)
        .build()?;

    app.manage(TrayState {
        sys_proxy,
        tun,
        mode_rule,
        mode_global,
        mode_direct,
    });

    let mut builder = TrayIconBuilder::with_id("zephyr-tray")
        .tooltip("Zephyr")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            // Left click brings the window back; right click opens the menu.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;

    sync(app);
    Ok(())
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "show" => show_window(app),
        "quit" => app.exit(0),
        "sys_proxy" => toggle_bool(app, "systemProxy"),
        "tun" => toggle_bool(app, "tun"),
        "mode_rule" => set_mode(app, "rule"),
        "mode_global" => set_mode(app, "global"),
        "mode_direct" => set_mode(app, "direct"),
        _ => {}
    }
}

pub fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn toggle_bool(app: &AppHandle, key: &str) {
    let current = {
        let state = app.state::<AppState>();
        let settings = state.settings.lock().unwrap();
        match key {
            "systemProxy" => settings.system_proxy,
            "tun" => settings.tun,
            _ => false,
        }
    };
    let patch = json!({ key: !current });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = crate::apply_settings_patch(&app, patch).await {
            use tauri::Emitter;
            let _ = app.emit("zephyr://toast", json!({ "text": e, "kind": "err" }));
        }
        // The checkbox flips itself on click; re-sync to the truth in case the
        // change was rejected (e.g. no proxy port to hand to the system).
        sync(&app);
    });
}

fn set_mode(app: &AppHandle, mode: &str) {
    let patch = json!({ "mode": mode });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = crate::apply_settings_patch(&app, patch).await;
        sync(&app);
    });
}

/// Reflect the current settings onto the tray's checkmarks.
pub fn sync(app: &AppHandle) {
    let (sys_proxy, tun, mode) = {
        let state = app.state::<AppState>();
        let settings = state.settings.lock().unwrap();
        (settings.system_proxy, settings.tun, settings.mode.clone())
    };
    if let Some(tray) = app.try_state::<TrayState>() {
        let _ = tray.sys_proxy.set_checked(sys_proxy);
        let _ = tray.tun.set_checked(tun);
        let _ = tray.mode_rule.set_checked(mode == "rule");
        let _ = tray.mode_global.set_checked(mode == "global");
        let _ = tray.mode_direct.set_checked(mode == "direct");
    }
}
