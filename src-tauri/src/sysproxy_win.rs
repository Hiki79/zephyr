use anyhow::{anyhow, Result};
use sysproxy::Sysproxy;

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
