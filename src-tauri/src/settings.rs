use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// Clash Verge defaults to 7897, so start somewhere else.
fn d_mixed_port() -> u16 { 7899 }
fn d_ctrl_port() -> u16 { 9097 }
fn d_mode() -> String { "rule".into() }
fn d_bypass() -> String {
    "localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*;<local>".into()
}
fn d_test_url() -> String { "https://www.gstatic.com/generate_204".into() }
fn d_auto_update() -> u32 { 24 }
fn d_log_level() -> String { "info".into() }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "d_mixed_port")]
    pub mixed_port: u16,
    #[serde(default = "d_ctrl_port")]
    pub ctrl_port: u16,
    pub secret: String,
    #[serde(default = "d_mode")]
    pub mode: String,
    pub system_proxy: bool,
    pub tun: bool,
    pub allow_lan: bool,
    pub ipv6: bool,
    pub unified_delay: bool,
    pub auto_start: bool,
    pub silent_start: bool,
    pub current_profile: Option<String>,
    #[serde(default = "d_bypass")]
    pub bypass: String,
    #[serde(default = "d_test_url")]
    pub test_url: String,
    #[serde(default = "d_auto_update")]
    pub auto_update_hours: u32,
    #[serde(default = "d_log_level")]
    pub log_level: String,
    /// Groups the overview's policy-routing card shows; empty means the first few.
    pub pinned_groups: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            mixed_port: d_mixed_port(),
            ctrl_port: d_ctrl_port(),
            secret: random_secret(),
            mode: d_mode(),
            system_proxy: false,
            tun: false,
            allow_lan: false,
            ipv6: false,
            unified_delay: true,
            auto_start: false,
            silent_start: false,
            current_profile: None,
            bypass: d_bypass(),
            test_url: d_test_url(),
            auto_update_hours: d_auto_update(),
            log_level: d_log_level(),
            pinned_groups: Vec::new(),
        }
    }
}

pub fn random_secret() -> String {
    use rand::Rng;
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::thread_rng();
    (0..24).map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char).collect()
}

impl Settings {
    pub fn load(path: &PathBuf) -> Self {
        match std::fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self, path: &PathBuf) -> anyhow::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }
}
