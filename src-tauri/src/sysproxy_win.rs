use anyhow::{anyhow, Result};
use sysproxy::Sysproxy;
use crate::settings::ProxySnapshot;

/// Point the Windows system proxy at our own mixed port, or clear it.
pub fn apply(enable: bool, port: u16, bypass: &str) -> Result<()> {
    let mut proxy = Sysproxy::get_system_proxy().unwrap_or(Sysproxy {
        enable: false,
        host: "127.0.0.1".into(),
        port,
        bypass: bypass.to_string(),
    });

    proxy.enable = enable;
    if enable {
        proxy.host = "127.0.0.1".into();
        proxy.port = port;
        proxy.bypass = bypass.to_string();
    }

    proxy
        .set_system_proxy()
        .map_err(|e| anyhow!("设置系统代理失败: {e}"))
}

/// What Windows currently has set, so the UI can show the truth rather than
/// what we last asked for.
pub fn current() -> Option<(bool, String, u16)> {
    Sysproxy::get_system_proxy()
        .ok()
        .map(|p| (p.enable, p.host, p.port))
}

pub fn snapshot() -> Option<ProxySnapshot> {
    let proxy = Sysproxy::get_system_proxy().ok()?;
    Some(ProxySnapshot { enable: proxy.enable, host: proxy.host, port: proxy.port, bypass: proxy.bypass })
}

pub fn is_ours(port: u16) -> bool {
    current().map(|(enable, host, current_port)| enable && host.eq_ignore_ascii_case("127.0.0.1") && current_port == port).unwrap_or(false)
}

pub fn restore(snapshot: &ProxySnapshot) -> Result<()> {
    let proxy = Sysproxy { enable: snapshot.enable, host: snapshot.host.clone(), port: snapshot.port, bypass: snapshot.bypass.clone() };
    proxy.set_system_proxy().map_err(|e| anyhow!("恢复系统代理失败: {e}"))
}
