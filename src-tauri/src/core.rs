use crate::settings::Settings;
use anyhow::{anyhow, Result};
use serde_yaml_ng::{Mapping, Value};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Config used before the user has added any subscription, so the core is
/// always up and the UI always has something to talk to.
const BLANK_PROFILE: &str = r#"
proxies: []
proxy-groups:
  - name: 节点选择
    type: select
    proxies: [DIRECT]
rules:
  - MATCH,DIRECT
"#;

pub struct CoreManager {
    pub child: Option<CommandChild>,
    pub running: bool,
    pub started_at: i64,
    /// The proxy port the core actually bound; 0 or None means it could not.
    pub listening_port: Option<u16>,
    pub last_error: Option<String>,
    /// Kill-on-close job every spawned core is assigned to, so no core can
    /// outlive this process, and `stop()` can end all of them at once.
    job: Option<crate::procs::Job>,
}

impl Default for CoreManager {
    fn default() -> Self {
        Self {
            child: None,
            running: false,
            started_at: 0,
            listening_port: None,
            last_error: None,
            job: crate::procs::Job::new(),
        }
    }
}

fn yaml_str(s: &str) -> Value {
    Value::String(s.to_string())
}

fn as_mapping(value: Value) -> Mapping {
    match value {
        Value::Mapping(m) => m,
        _ => Mapping::new(),
    }
}

/// Merge our runtime settings on top of the subscription YAML.
pub fn build_config(profile_yaml: &str, settings: &Settings) -> Result<String> {
    let parsed: Value = serde_yaml_ng::from_str(profile_yaml)
        .map_err(|e| anyhow!("配置不是合法的 YAML: {e}"))?;
    let mut root = as_mapping(parsed);

    // Ports, plus the API the UI drives the core through.
    root.insert(yaml_str("mixed-port"), Value::Number(settings.mixed_port.into()));
    root.insert(
        yaml_str("external-controller"),
        yaml_str(&format!("127.0.0.1:{}", settings.ctrl_port)),
    );
    root.insert(yaml_str("secret"), yaml_str(&settings.secret));
    root.insert(yaml_str("mode"), yaml_str(&settings.mode));
    root.insert(yaml_str("log-level"), yaml_str(&settings.log_level));
    root.insert(yaml_str("allow-lan"), Value::Bool(settings.allow_lan));
    root.insert(yaml_str("ipv6"), Value::Bool(settings.ipv6));
    root.insert(yaml_str("unified-delay"), Value::Bool(settings.unified_delay));
    root.insert(yaml_str("tcp-concurrent"), Value::Bool(true));
    root.insert(yaml_str("find-process-mode"), yaml_str("strict"));
    root.insert(yaml_str("global-client-fingerprint"), yaml_str("chrome"));

    // Remember which node each group had selected across restarts.
    let mut profile_block = Mapping::new();
    profile_block.insert(yaml_str("store-selected"), Value::Bool(true));
    profile_block.insert(yaml_str("store-fake-ip"), Value::Bool(true));
    root.insert(yaml_str("profile"), Value::Mapping(profile_block));

    // TUN: a virtual adapter capturing everything, admin rights required.
    let mut tun = Mapping::new();
    tun.insert(yaml_str("enable"), Value::Bool(settings.tun));
    tun.insert(yaml_str("stack"), yaml_str("mixed"));
    tun.insert(yaml_str("device"), yaml_str("zephyr0"));
    tun.insert(yaml_str("auto-route"), Value::Bool(true));
    tun.insert(yaml_str("auto-detect-interface"), Value::Bool(true));
    tun.insert(yaml_str("strict-route"), Value::Bool(false));
    tun.insert(
        yaml_str("dns-hijack"),
        Value::Sequence(vec![yaml_str("any:53"), yaml_str("tcp://any:53")]),
    );
    root.insert(yaml_str("tun"), Value::Mapping(tun));

    // Only supply DNS when the subscription does not bring its own.
    let has_dns = root
        .get(&yaml_str("dns"))
        .and_then(|d| d.as_mapping())
        .map(|m| m.get(&yaml_str("enable")).and_then(|v| v.as_bool()).unwrap_or(false))
        .unwrap_or(false);
    if !has_dns {
        root.insert(yaml_str("dns"), default_dns());
    }

    Ok(serde_yaml_ng::to_string(&Value::Mapping(root))?)
}

fn default_dns() -> Value {
    let mut dns = Mapping::new();
    dns.insert(yaml_str("enable"), Value::Bool(true));
    dns.insert(yaml_str("listen"), yaml_str("127.0.0.1:1053"));
    dns.insert(yaml_str("ipv6"), Value::Bool(false));
    dns.insert(yaml_str("enhanced-mode"), yaml_str("fake-ip"));
    dns.insert(yaml_str("fake-ip-range"), yaml_str("198.18.0.1/16"));
    dns.insert(
        yaml_str("fake-ip-filter"),
        Value::Sequence(vec![
            yaml_str("*.lan"),
            yaml_str("*.local"),
            yaml_str("localhost.ptlogin2.qq.com"),
            yaml_str("+.msftconnecttest.com"),
            yaml_str("+.msftncsi.com"),
            yaml_str("stun.*.*"),
            yaml_str("time.*.com"),
        ]),
    );
    dns.insert(
        yaml_str("default-nameserver"),
        Value::Sequence(vec![yaml_str("223.5.5.5"), yaml_str("119.29.29.29")]),
    );
    dns.insert(
        yaml_str("nameserver"),
        Value::Sequence(vec![
            yaml_str("https://dns.alidns.com/dns-query"),
            yaml_str("https://doh.pub/dns-query"),
        ]),
    );
    Value::Mapping(dns)
}

/// Write the runtime config that mihomo is actually started with.
pub fn write_runtime_config(
    runtime_dir: &Path,
    profiles_dir: &Path,
    settings: &Settings,
) -> Result<PathBuf> {
    let source = match &settings.current_profile {
        Some(uid) => {
            let path = profiles_dir.join(format!("{}.yaml", uid));
            std::fs::read_to_string(&path).unwrap_or_else(|_| BLANK_PROFILE.to_string())
        }
        None => BLANK_PROFILE.to_string(),
    };
    let merged = build_config(&source, settings)?;
    std::fs::create_dir_all(runtime_dir)?;
    let target = runtime_dir.join("config.yaml");
    std::fs::write(&target, merged)?;
    Ok(target)
}

impl CoreManager {
    pub fn stop(&mut self) {
        // Ending the whole job also catches a core that a racing restart
        // spawned but never got recorded in `self.child`.
        if let Some(job) = &self.job {
            job.terminate();
        }
        if let Some(child) = self.child.take() {
            let _ = child.kill();
        }
        self.running = false;
        self.started_at = 0;
    }

    pub fn start(&mut self, app: &AppHandle, runtime_dir: &Path, config: &Path) -> Result<()> {
        self.stop();

        let sidecar = app
            .shell()
            .sidecar("mihomo")
            .map_err(|e| anyhow!("找不到内核程序: {e}"))?;

        let (mut rx, child) = sidecar
            .args([
                "-d",
                &runtime_dir.to_string_lossy(),
                "-f",
                &config.to_string_lossy(),
            ])
            .spawn()
            .map_err(|e| anyhow!("内核启动失败: {e}"))?;

        // Tie the core's lifetime to ours. If the job could not be created
        // (very old Windows), fall back to plain child tracking.
        if self.job.is_none() {
            self.job = crate::procs::Job::new();
        }
        if let Some(job) = &self.job {
            job.assign(child.pid());
        }

        self.child = Some(child);
        self.running = true;
        self.started_at = chrono::Utc::now().timestamp();
        self.last_error = None;

        // Drain the core stdout/stderr so its pipe never fills up.
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            use tauri::Emitter;
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                        let text = String::from_utf8_lossy(&line).trim().to_string();
                        if !text.is_empty() {
                            let _ = handle.emit("core://stdout", text);
                        }
                    }
                    CommandEvent::Terminated(payload) => {
                        let _ = handle.emit("core://terminated", payload.code);
                        break;
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }
}

/// Where Tauri places the bundled core: next to our own executable, both in
/// `tauri dev` (target dir) and in the installed app.
pub fn sidecar_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    Some(exe.parent()?.join("mihomo.exe"))
}

/// Kill cores a previous instance of *this* install left behind (it crashed,
/// or the installer force-killed it before its exit hook ran). Matches on the
/// full path, so another client's mihomo is never touched.
pub fn kill_stale_cores() -> usize {
    match sidecar_path() {
        Some(path) => crate::procs::kill_processes_at(&path),
        None => 0,
    }
}

/// True when nothing else on this machine is already listening on the port.
pub fn port_is_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Another Clash client may already hold the preferred port. Walk forward to
/// the first free one rather than starting a core with no proxy listener.
pub fn pick_free_port(preferred: u16) -> u16 {
    if port_is_free(preferred) {
        return preferred;
    }
    for candidate in preferred.saturating_add(1)..preferred.saturating_add(40) {
        if port_is_free(candidate) {
            return candidate;
        }
    }
    preferred
}

/// mihomo downloads its own geo databases on first run, but that needs a working
/// connection. When another Clash client on this machine already has them, copy
/// them over so the first start is instant.
pub fn seed_geo_files(runtime_dir: &Path) {
    let wanted = ["geoip.dat", "geosite.dat", "geoip.metadb", "Country.mmdb", "ASN.mmdb"];
    let donors = [
        PathBuf::from("D:/Apps/Stelliberty/data/core"),
        roaming_dir().join("io.github.clash-verge-rev.clash-verge-rev"),
    ];
    let _ = std::fs::create_dir_all(runtime_dir);

    for name in wanted {
        let target = runtime_dir.join(name);
        if target.exists() {
            continue;
        }
        for donor in &donors {
            // Match case-insensitively: clients disagree on Country.mmdb vs country.mmdb.
            let Ok(entries) = std::fs::read_dir(donor) else { continue };
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().eq_ignore_ascii_case(name) {
                    let _ = std::fs::copy(entry.path(), &target);
                    break;
                }
            }
            if target.exists() {
                break;
            }
        }
    }
}

fn roaming_dir() -> PathBuf {
    std::env::var("APPDATA").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("."))
}

/// A killed core lets go of its ports a moment after `kill` returns. Wait for
/// them to come free so the next probe only ever sees other programs; give up
/// after `max` and let the probe decide.
pub async fn wait_ports_released(ports: &[u16], max: std::time::Duration) {
    let started = std::time::Instant::now();
    while started.elapsed() < max {
        if ports.iter().all(|port| port_is_free(*port)) {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(60)).await;
    }
}
