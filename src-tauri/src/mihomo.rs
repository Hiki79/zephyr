use anyhow::{anyhow, Result};
use serde_json::Value;

/// Thin client over the mihomo RESTful API (the `external-controller` port).
#[derive(Clone)]
pub struct Mihomo {
    base: String,
    secret: String,
}

impl Mihomo {
    pub fn new(port: u16, secret: &str) -> Self {
        Self { base: format!("http://127.0.0.1:{}", port), secret: secret.to_string() }
    }

    pub fn base_url(&self) -> &str {
        &self.base
    }

    pub fn secret(&self) -> &str {
        &self.secret
    }

    fn client(timeout: u64) -> Result<reqwest::Client> {
        Ok(reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(timeout))
            .no_proxy()
            .build()?)
    }

    async fn get_json(&self, path: &str, timeout: u64) -> Result<Value> {
        let resp = Self::client(timeout)?
            .get(format!("{}{}", self.base, path))
            .bearer_auth(&self.secret)
            .send()
            .await?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(anyhow!("内核返回 {}: {}", status.as_u16(), body));
        }
        Ok(serde_json::from_str(&body).unwrap_or(Value::Null))
    }

    pub async fn version(&self) -> Result<Value> {
        self.get_json("/version", 3).await
    }

    pub async fn proxies(&self) -> Result<Value> {
        self.get_json("/proxies", 8).await
    }

    pub async fn providers(&self) -> Result<Value> {
        self.get_json("/providers/proxies", 8).await
    }

    pub async fn rules(&self) -> Result<Value> {
        self.get_json("/rules", 8).await
    }

    pub async fn connections(&self) -> Result<Value> {
        self.get_json("/connections", 8).await
    }

    pub async fn configs(&self) -> Result<Value> {
        self.get_json("/configs", 5).await
    }

    pub async fn memory(&self) -> Result<Value> {
        self.get_json("/memory", 3).await
    }

    /// Pick a node inside a `select` group.
    pub async fn select(&self, group: &str, node: &str) -> Result<()> {
        let resp = Self::client(8)?
            .put(format!("{}/proxies/{}", self.base, urlencode(group)))
            .bearer_auth(&self.secret)
            .json(&serde_json::json!({ "name": node }))
            .send()
            .await?;
        if !resp.status().is_success() {
            let code = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow!("切换节点失败 ({}): {}", code, body));
        }
        Ok(())
    }

    /// Latency of one node in milliseconds.
    pub async fn delay(&self, node: &str, test_url: &str, timeout_ms: u32) -> Result<u32> {
        let url = format!(
            "{}/proxies/{}/delay?timeout={}&url={}",
            self.base,
            urlencode(node),
            timeout_ms,
            urlencode(test_url)
        );
        let resp = Self::client(((timeout_ms / 1000) + 5) as u64)?
            .get(url)
            .bearer_auth(&self.secret)
            .send()
            .await?;
        let status = resp.status();
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            return Err(anyhow!("超时"));
        }
        body.get("delay")
            .and_then(|d| d.as_u64())
            .map(|d| d as u32)
            .ok_or_else(|| anyhow!("超时"))
    }

    /// Latency for every node in a group, in one call the core parallelises.
    pub async fn group_delay(&self, group: &str, test_url: &str, timeout_ms: u32) -> Result<Value> {
        let url = format!(
            "{}/group/{}/delay?timeout={}&url={}",
            self.base,
            urlencode(group),
            timeout_ms,
            urlencode(test_url)
        );
        let resp = Self::client(((timeout_ms / 1000) + 25) as u64)?
            .get(url)
            .bearer_auth(&self.secret)
            .send()
            .await?;
        Ok(resp.json().await.unwrap_or(Value::Null))
    }

    /// Switch rule / global / direct without restarting the core.
    pub async fn patch_mode(&self, mode: &str) -> Result<()> {
        let resp = Self::client(5)?
            .patch(format!("{}/configs", self.base))
            .bearer_auth(&self.secret)
            .json(&serde_json::json!({ "mode": mode }))
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(anyhow!("切换模式失败"));
        }
        Ok(())
    }

    pub async fn close_connection(&self, id: &str) -> Result<()> {
        let _ = Self::client(5)?
            .delete(format!("{}/connections/{}", self.base, urlencode(id)))
            .bearer_auth(&self.secret)
            .send()
            .await?;
        Ok(())
    }

    pub async fn close_all_connections(&self) -> Result<()> {
        let _ = Self::client(5)?
            .delete(format!("{}/connections", self.base))
            .bearer_auth(&self.secret)
            .send()
            .await?;
        Ok(())
    }

    /// Ready once the core answers /version, polled while it boots.
    pub async fn wait_ready(&self, attempts: u32) -> bool {
        for _ in 0..attempts {
            if self.version().await.is_ok() {
                return true;
            }
            tokio::time::sleep(std::time::Duration::from_millis(220)).await;
        }
        false
    }
}

/// Percent-encode a path segment. Group names are Chinese and contain spaces.
fn urlencode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}
