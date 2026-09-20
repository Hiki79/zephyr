mod core;
mod mihomo;
mod profiles;
mod settings;
mod sysproxy_win;
mod tray;

use crate::core::CoreManager;
use crate::mihomo::Mihomo;
use crate::profiles::{Profile, ProfileList};
use crate::settings::Settings;
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct Dirs {
    pub root: PathBuf,
    pub profiles: PathBuf,
    pub runtime: PathBuf,
    pub settings_file: PathBuf,
    pub profiles_file: PathBuf,
}

pub struct AppState {
    pub dirs: Dirs,
    pub settings: Mutex<Settings>,
    pub profiles: Mutex<ProfileList>,
    pub core: Mutex<CoreManager>,
}

impl AppState {
    fn snapshot_settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    fn client(&self) -> Mihomo {
        let s = self.snapshot_settings();
        Mihomo::new(s.ctrl_port, &s.secret)
    }

    fn save_settings(&self) {
        let s = self.snapshot_settings();
        let _ = s.save(&self.dirs.settings_file);
    }

    fn save_profiles(&self) {
        let list = self.profiles.lock().unwrap().clone();
        let _ = list.save(&self.dirs.profiles_file);
    }
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

// ---------------------------------------------------------------- status

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    running: bool,
    started_at: i64,
    mixed_port: u16,
    ctrl_port: u16,
    secret: String,
    mode: String,
    system_proxy: bool,
    system_proxy_actual: bool,
    tun: bool,
    /// What the core actually bound, which may differ from the setting.
    listening_port: Option<u16>,
    profile_name: Option<String>,
    profile_uid: Option<String>,
    core_version: Option<String>,
    last_error: Option<String>,
}

#[tauri::command]
async fn get_status(state: State<'_, AppState>) -> Result<Status, String> {
    let settings = state.snapshot_settings();
    let (running, started_at, last_error, listening_port) = {
        let core = state.core.lock().unwrap();
        (core.running, core.started_at, core.last_error.clone(), core.listening_port)
    };
    let profile = {
        let list = state.profiles.lock().unwrap();
        settings.current_profile.as_ref().and_then(|uid| {
            list.items.iter().find(|p| &p.uid == uid).map(|p| (p.uid.clone(), p.name.clone()))
        })
    };

    let client = Mihomo::new(settings.ctrl_port, &settings.secret);
    let core_version = client
        .version()
        .await
        .ok()
        .and_then(|v| v.get("version").and_then(|s| s.as_str()).map(String::from));

    let system_proxy_actual = sysproxy_win::current()
        .map(|(enable, host, port)| enable && host.contains("127.0.0.1") && port == settings.mixed_port)
        .unwrap_or(false);

    Ok(Status {
        running: running && core_version.is_some(),
        started_at,
        mixed_port: settings.mixed_port,
        ctrl_port: settings.ctrl_port,
        secret: settings.secret.clone(),
        mode: settings.mode.clone(),
        system_proxy: settings.system_proxy,
        system_proxy_actual,
        tun: settings.tun,
        listening_port,
        profile_uid: profile.as_ref().map(|p| p.0.clone()),
        profile_name: profile.map(|p| p.1),
        core_version,
        last_error,
    })
}

// ---------------------------------------------------------------- settings

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Settings {
    state.snapshot_settings()
}

/// Apply a partial settings change. Everything that can be changed without a
/// core restart is done live; only the flags that live in the config file
/// (TUN, ports, LAN) force a restart.
#[tauri::command]
async fn patch_settings(app: AppHandle, patch: Value) -> Result<Settings, String> {
    apply_settings_patch(&app, patch).await
}

/// The body of `patch_settings`, also called by the tray menu.
pub async fn apply_settings_patch(app: &AppHandle, patch: Value) -> Result<Settings, String> {
    let state = app.state::<AppState>();
    let before = state.snapshot_settings();

    let merged: Settings = {
        let mut base = serde_json::to_value(&before).map_err(err)?;
        if let (Some(base_map), Some(patch_map)) = (base.as_object_mut(), patch.as_object()) {
            for (key, value) in patch_map {
                base_map.insert(key.clone(), value.clone());
            }
        }
        serde_json::from_value(base).map_err(err)?
    };

    *state.settings.lock().unwrap() = merged.clone();
    state.save_settings();

    let needs_restart = merged.mixed_port != before.mixed_port
        || merged.ctrl_port != before.ctrl_port
        || merged.tun != before.tun
        || merged.allow_lan != before.allow_lan
        || merged.ipv6 != before.ipv6
        || merged.unified_delay != before.unified_delay
        || merged.log_level != before.log_level;

    if needs_restart {
        restart_core_inner(app, &state).await?;
    } else if merged.mode != before.mode {
        // Mode is hot-swappable through the API.
        state.client().patch_mode(&merged.mode).await.map_err(err)?;
    }

    // Keep the Windows setting in step with the toggle and the port.
    if merged.system_proxy != before.system_proxy
        || (merged.system_proxy && merged.mixed_port != before.mixed_port)
    {
        sysproxy_win::apply(merged.system_proxy, merged.mixed_port, &merged.bypass).map_err(err)?;
    }

    let _ = app.emit("zephyr://settings", &merged);
    tray::sync(app);
    Ok(merged)
}

// ---------------------------------------------------------------- core

/// Another Clash client may hold our preferred ports. Move to free ones and
/// persist the change, so the settings page shows the port actually in use.
fn resolve_ports(state: &State<'_, AppState>) -> (Settings, Option<(u16, u16)>) {
    let before = state.snapshot_settings();
    let mixed = core::pick_free_port(before.mixed_port);
    let ctrl = if core::port_is_free(before.ctrl_port) {
        before.ctrl_port
    } else {
        core::pick_free_port(before.ctrl_port)
    };

    if mixed == before.mixed_port && ctrl == before.ctrl_port {
        return (before, None);
    }

    {
        let mut settings = state.settings.lock().unwrap();
        settings.mixed_port = mixed;
        settings.ctrl_port = ctrl;
    }
    state.save_settings();
    (state.snapshot_settings(), Some((before.mixed_port, mixed)))
}

async fn restart_core_inner(app: &AppHandle, state: &State<'_, AppState>) -> Result<(), String> {
    let (settings, moved) = resolve_ports(state);
    if let Some((from, to)) = moved {
        let _ = app.emit("zephyr://port-moved", serde_json::json!({ "from": from, "to": to }));
    }
    let config = core::write_runtime_config(&state.dirs.runtime, &state.dirs.profiles, &settings)
        .map_err(err)?;

    {
        let mut core = state.core.lock().unwrap();
        core.start(app, &state.dirs.runtime, &config).map_err(err)?;
    }

    let client = Mihomo::new(settings.ctrl_port, &settings.secret);
    let ready = client.wait_ready(30).await;
    let listening = if ready { client.mixed_port().await } else { None };
    {
        let mut core = state.core.lock().unwrap();
        core.running = ready;
        core.listening_port = listening;
        core.last_error = match (ready, listening) {
            (false, _) => Some("内核启动后没有响应".into()),
            (true, None) | (true, Some(0)) => Some(format!(
                "端口 {} 被其他程序占用，代理没有启动",
                settings.mixed_port
            )),
            _ => None,
        };
    }
    let _ = app.emit("zephyr://core", ready);

    if !ready {
        return Err("内核启动后没有响应，请查看日志".into());
    }
    Ok(())
}

#[tauri::command]
async fn restart_core(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    restart_core_inner(&app, &state).await
}

// ---------------------------------------------------------------- profiles

#[tauri::command]
fn get_profiles(state: State<'_, AppState>) -> ProfileList {
    state.profiles.lock().unwrap().clone()
}

#[tauri::command]
async fn add_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<Profile, String> {
    let profile = profiles::fetch(&url, None, &state.dirs.profiles).await.map_err(err)?;

    let first = {
        let mut list = state.profiles.lock().unwrap();
        list.items.push(profile.clone());
        list.items.len() == 1
    };
    state.save_profiles();

    if first {
        state.settings.lock().unwrap().current_profile = Some(profile.uid.clone());
        state.save_settings();
        restart_core_inner(&app, &state).await?;
    }

    let _ = app.emit("zephyr://profiles", ());
    Ok(profile)
}

#[tauri::command]
async fn update_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    uid: String,
) -> Result<Profile, String> {
    let url = {
        let list = state.profiles.lock().unwrap();
        list.items
            .iter()
            .find(|p| p.uid == uid)
            .map(|p| p.url.clone())
            .ok_or_else(|| "找不到这个订阅".to_string())?
    };

    let fresh = profiles::fetch(&url, Some(uid.clone()), &state.dirs.profiles)
        .await
        .map_err(err)?;

    {
        let mut list = state.profiles.lock().unwrap();
        if let Some(slot) = list.items.iter_mut().find(|p| p.uid == uid) {
            // Keep the name the user may have renamed to.
            let kept = slot.name.clone();
            *slot = fresh.clone();
            if !kept.trim().is_empty() {
                slot.name = kept;
            }
        }
    }
    state.save_profiles();

    let is_current = state.snapshot_settings().current_profile.as_deref() == Some(uid.as_str());
    if is_current {
        restart_core_inner(&app, &state).await?;
    }

    let _ = app.emit("zephyr://profiles", ());
    Ok(fresh)
}

#[tauri::command]
async fn select_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    uid: String,
) -> Result<(), String> {
    state.settings.lock().unwrap().current_profile = Some(uid);
    state.save_settings();
    restart_core_inner(&app, &state).await?;
    let _ = app.emit("zephyr://profiles", ());
    Ok(())
}

#[tauri::command]
async fn delete_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    uid: String,
) -> Result<(), String> {
    {
        let mut list = state.profiles.lock().unwrap();
        list.items.retain(|p| p.uid != uid);
    }
    state.save_profiles();
    let _ = std::fs::remove_file(state.dirs.profiles.join(format!("{}.yaml", uid)));

    let was_current = state.snapshot_settings().current_profile.as_deref() == Some(uid.as_str());
    if was_current {
        let next = state.profiles.lock().unwrap().items.first().map(|p| p.uid.clone());
        state.settings.lock().unwrap().current_profile = next;
        state.save_settings();
        restart_core_inner(&app, &state).await?;
    }

    let _ = app.emit("zephyr://profiles", ());
    Ok(())
}

#[tauri::command]
fn rename_profile(state: State<'_, AppState>, uid: String, name: String) -> Result<(), String> {
    {
        let mut list = state.profiles.lock().unwrap();
        if let Some(slot) = list.items.iter_mut().find(|p| p.uid == uid) {
            slot.name = name;
        }
    }
    state.save_profiles();
    Ok(())
}

// ---------------------------------------------------------------- proxies

#[tauri::command]
async fn get_proxies(state: State<'_, AppState>) -> Result<Value, String> {
    state.client().proxies().await.map_err(err)
}

#[tauri::command]
async fn select_node(
    app: AppHandle,
    state: State<'_, AppState>,
    group: String,
    node: String,
) -> Result<(), String> {
    state.client().select(&group, &node).await.map_err(err)?;
    let _ = app.emit("zephyr://proxies", ());
    Ok(())
}

#[tauri::command]
async fn test_node(state: State<'_, AppState>, node: String) -> Result<u32, String> {
    let test_url = state.snapshot_settings().test_url;
    state.client().delay(&node, &test_url, 5000).await.map_err(err)
}

#[tauri::command]
async fn test_group(state: State<'_, AppState>, group: String) -> Result<Value, String> {
    let test_url = state.snapshot_settings().test_url;
    state.client().group_delay(&group, &test_url, 5000).await.map_err(err)
}

#[tauri::command]
async fn get_rules(state: State<'_, AppState>) -> Result<Value, String> {
    state.client().rules().await.map_err(err)
}

#[tauri::command]
async fn get_connections(state: State<'_, AppState>) -> Result<Value, String> {
    state.client().connections().await.map_err(err)
}

#[tauri::command]
async fn close_connection(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.client().close_connection(&id).await.map_err(err)
}

#[tauri::command]
async fn close_all_connections(state: State<'_, AppState>) -> Result<(), String> {
    state.client().close_all_connections().await.map_err(err)
}

#[tauri::command]
fn open_config_dir(state: State<'_, AppState>) -> Result<(), String> {
    let path = state.dirs.root.clone();
    std::process::Command::new("explorer")
        .arg(path)
        .spawn()
        .map_err(err)?;
    Ok(())
}

// ---------------------------------------------------------------- traffic

/// Follow one of the core's streaming endpoints and republish each line to the
/// window. Reconnects on its own, so a core restart is just a short gap.
fn spawn_stream_bridge(app: AppHandle, path: &'static str, event: &'static str) {
    tauri::async_runtime::spawn(async move {
        use futures_util::StreamExt;
        loop {
            let (port, secret) = {
                let state = app.state::<AppState>();
                let s = state.settings.lock().unwrap();
                (s.ctrl_port, s.secret.clone())
            };

            let request = reqwest::Client::builder()
                .no_proxy()
                .build()
                .ok()
                .map(|c| {
                    c.get(format!("http://127.0.0.1:{}{}", port, path))
                        .bearer_auth(&secret)
                        .send()
                });

            if let Some(pending) = request {
                if let Ok(resp) = pending.await {
                    let mut stream = resp.bytes_stream();
                    let mut buffer = String::new();
                    while let Some(Ok(chunk)) = stream.next().await {
                        buffer.push_str(&String::from_utf8_lossy(&chunk));
                        while let Some(index) = buffer.find('\n') {
                            let line: String = buffer.drain(..=index).collect();
                            let line = line.trim().to_string();
                            if line.is_empty() {
                                continue;
                            }
                            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                                let _ = app.emit(event, value);
                            }
                        }
                    }
                }
            }

            tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
        }
    });
}

/// The core serves `/logs` over WebSocket only, and authenticates with a
/// header rather than a query parameter, so the webview cannot subscribe to it
/// directly. Bridge it here and republish each line as a window event.
fn spawn_log_bridge(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        use futures_util::StreamExt;
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;

        loop {
            let (port, secret) = {
                let state = app.state::<AppState>();
                let s = state.settings.lock().unwrap();
                (s.ctrl_port, s.secret.clone())
            };

            let connected = async {
                let mut request =
                    format!("ws://127.0.0.1:{}/logs?level=info", port).into_client_request().ok()?;
                let value = format!("Bearer {}", secret).parse().ok()?;
                request.headers_mut().insert("Authorization", value);
                tokio_tungstenite::connect_async(request).await.ok()
            }
            .await;

            if let Some((stream, _)) = connected {
                let (_, mut read) = stream.split();
                while let Some(Ok(message)) = read.next().await {
                    if let Ok(text) = message.into_text() {
                        if text.trim().is_empty() {
                            continue;
                        }
                        if let Ok(value) = serde_json::from_str::<Value>(&text) {
                            let _ = app.emit("zephyr://log", value);
                        }
                    }
                }
            }

            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        }
    });
}

// ---------------------------------------------------------------- setup

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .setup(|app| {
            let root = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let dirs = Dirs {
                profiles: root.join("profiles"),
                runtime: root.join("runtime"),
                settings_file: root.join("settings.json"),
                profiles_file: root.join("profiles.json"),
                root,
            };
            std::fs::create_dir_all(&dirs.profiles).ok();
            std::fs::create_dir_all(&dirs.runtime).ok();
            core::seed_geo_files(&dirs.runtime);

            let settings = Settings::load(&dirs.settings_file);
            let profile_list = ProfileList::load(&dirs.profiles_file);
            settings.save(&dirs.settings_file).ok();

            app.manage(AppState {
                dirs,
                settings: Mutex::new(settings),
                profiles: Mutex::new(profile_list),
                core: Mutex::new(CoreManager::default()),
            });

            // Tray icon and menu. Must come after the state is managed, since
            // the tray reads settings to draw its checkmarks.
            tray::build(app.handle())?;

            // Closing the window hides it to the tray; quitting is done from the
            // tray menu, so the core keeps running in the background.
            if let Some(window) = app.get_webview_window("main") {
                let win = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win.hide();
                    }
                });
            }

            // Boot the core, then bring the system proxy back if it was on.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = handle.state::<AppState>();
                let (settings, moved) = resolve_ports(&state);
                if let Some((from, to)) = moved {
                    let _ = handle
                        .emit("zephyr://port-moved", serde_json::json!({ "from": from, "to": to }));
                }

                match core::write_runtime_config(&state.dirs.runtime, &state.dirs.profiles, &settings)
                {
                    Ok(config) => {
                        let started = {
                            let mut core = state.core.lock().unwrap();
                            core.start(&handle, &state.dirs.runtime, &config)
                        };
                        if let Err(e) = started {
                            let mut core = state.core.lock().unwrap();
                            core.last_error = Some(e.to_string());
                        } else {
                            let client = Mihomo::new(settings.ctrl_port, &settings.secret);
                            let ready = client.wait_ready(40).await;
                            let listening = if ready { client.mixed_port().await } else { None };
                            let mut core = state.core.lock().unwrap();
                            core.running = ready;
                            core.listening_port = listening;
                            core.last_error = match (ready, listening) {
                                (false, _) => Some("内核启动后没有响应".into()),
                                (true, None) | (true, Some(0)) => Some(format!(
                                    "端口 {} 被其他程序占用，代理没有启动",
                                    settings.mixed_port
                                )),
                                _ => None,
                            };
                        }
                    }
                    Err(e) => {
                        let mut core = state.core.lock().unwrap();
                        core.last_error = Some(e.to_string());
                    }
                }

                let listening = state.core.lock().unwrap().listening_port;
                if settings.system_proxy && matches!(listening, Some(p) if p > 0) {
                    let _ = sysproxy_win::apply(true, settings.mixed_port, &settings.bypass);
                }
                let _ = handle.emit("zephyr://core", true);
                tray::sync(&handle);
            });

            spawn_stream_bridge(app.handle().clone(), "/traffic", "zephyr://traffic");
            spawn_stream_bridge(app.handle().clone(), "/memory", "zephyr://memory");
            spawn_log_bridge(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            get_settings,
            patch_settings,
            restart_core,
            get_profiles,
            add_profile,
            update_profile,
            select_profile,
            delete_profile,
            rename_profile,
            get_proxies,
            select_node,
            test_node,
            test_group,
            get_rules,
            get_connections,
            close_connection,
            close_all_connections,
            open_config_dir,
        ])
        .build(tauri::generate_context!())
        .expect("error while running zephyr")
        .run(|app, event| {
            // Never leave the core running or the system proxy pointing at a
            // dead port once the window is gone.
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                let state = app.state::<AppState>();
                let settings = state.settings.lock().unwrap().clone();
                if settings.system_proxy {
                    let _ = sysproxy_win::apply(false, settings.mixed_port, &settings.bypass);
                }
                state.core.lock().unwrap().stop();
            }
        });
}
