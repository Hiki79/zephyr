use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Profile {
    pub uid: String,
    pub name: String,
    pub url: String,
    /// unix seconds of the last successful update
    pub updated: i64,
    pub upload: u64,
    pub download: u64,
    pub total: u64,
    /// unix seconds; 0 when the provider does not report one
    pub expire: i64,
    pub home: Option<String>,
    /// how many proxies the downloaded config carries
    pub node_count: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ProfileList {
    pub items: Vec<Profile>,
}

impl ProfileList {
    pub fn load(path: &PathBuf) -> Self {
        match std::fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self, path: &PathBuf) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }
}

pub fn new_uid() -> String {
    use rand::Rng;
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    let tail: String = (0..8).map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char).collect();
    format!("p{}", tail)
}

/// Parse the `subscription-userinfo` response header.
/// Example: `upload=1234; download=5678; total=100000; expire=1799999999`
fn parse_userinfo(raw: &str, profile: &mut Profile) {
    for part in raw.split(';') {
        let part = part.trim();
        let Some((key, value)) = part.split_once('=') else { continue };
        let value = value.trim();
        match key.trim().to_ascii_lowercase().as_str() {
            "upload" => profile.upload = value.parse().unwrap_or(0),
            "download" => profile.download = value.parse().unwrap_or(0),
            "total" => profile.total = value.parse().unwrap_or(0),
            "expire" => profile.expire = value.parse().unwrap_or(0),
            _ => {}
        }
    }
}

/// Pull a subscription and write its YAML next to the other profiles.
/// `uid` is reused when refreshing an existing profile.
pub async fn fetch(url: &str, uid: Option<String>, dir: &Path) -> Result<Profile> {
    let client = reqwest::Client::builder()
        .user_agent("clash-verge/v2.4.2")
        .timeout(std::time::Duration::from_secs(45))
        .build()?;

    let resp = client.get(url).send().await?;
    if !resp.status().is_success() {
        return Err(anyhow!("订阅服务器返回 {}", resp.status().as_u16()));
    }

    let headers = resp.headers().clone();
    let mut profile = Profile {
        uid: uid.unwrap_or_else(new_uid),
        url: url.to_string(),
        updated: chrono::Utc::now().timestamp(),
        ..Default::default()
    };

    if let Some(value) = headers.get("subscription-userinfo").and_then(|v| v.to_str().ok()) {
        parse_userinfo(value, &mut profile);
    }
    if let Some(value) = headers.get("profile-web-page-url").and_then(|v| v.to_str().ok()) {
        profile.home = Some(value.to_string());
    }
    // `content-disposition: attachment; filename="My Sub.yaml"` carries the display name
    if let Some(value) = headers.get("content-disposition").and_then(|v| v.to_str().ok()) {
        if let Some(rest) = value.split("filename*=UTF-8''").nth(1) {
            let decoded = percent_decode(rest.trim().trim_matches('"'));
            profile.name = strip_ext(&decoded);
        } else if let Some(rest) = value.split("filename=").nth(1) {
            profile.name = strip_ext(rest.trim().trim_matches('"'));
        }
    }

    let body = resp.text().await?;
    let parsed: serde_yaml_ng::Value = serde_yaml_ng::from_str(&body)
        .map_err(|e| anyhow!("订阅不是合法的 YAML：{e}"))?;
    let proxies = parsed.get("proxies").and_then(|p| p.as_sequence()).map(|s| s.len()).unwrap_or(0);
    if proxies == 0 {
        return Err(anyhow!("订阅里没有 proxies 字段，可能不是 Clash 格式"));
    }
    profile.node_count = proxies;

    if profile.name.trim().is_empty() {
        profile.name = host_of(url);
    }

    std::fs::create_dir_all(dir)?;
    std::fs::write(dir.join(format!("{}.yaml", profile.uid)), &body)?;
    Ok(profile)
}

fn strip_ext(name: &str) -> String {
    name.trim_end_matches(".yaml").trim_end_matches(".yml").trim().to_string()
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&input[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn host_of(url: &str) -> String {
    url.split("://")
        .nth(1)
        .and_then(|rest| rest.split('/').next())
        .unwrap_or("订阅")
        .to_string()
}
