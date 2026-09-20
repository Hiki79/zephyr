import { useState } from "react";
import { Check, Layers, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api, type Profile } from "../lib/api";
import { useStore } from "../lib/store";
import { daysLeft, formatAgo, formatBytes, formatDate, splitBytes } from "../lib/format";
import { Dialog, Empty } from "../components/bits";

export default function Profiles() {
  const profiles = useStore((s) => s.profiles);
  const status = useStore((s) => s.status);
  const refreshProfiles = useStore((s) => s.refreshProfiles);
  const refreshProxies = useStore((s) => s.refreshProxies);
  const refreshStatus = useStore((s) => s.refreshStatus);
  const toast = useStore((s) => s.toast);

  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Profile | null>(null);

  async function addProfile() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const profile = await api.addProfile(trimmed);
      await Promise.all([refreshProfiles(), refreshStatus(), refreshProxies()]);
      setAdding(false);
      setUrl("");
      toast(`已添加 ${profile.name}，${profile.nodeCount} 个节点`);
    } catch (e) {
      toast(String(e), "err");
    } finally {
      setSaving(false);
    }
  }

  async function update(profile: Profile) {
    setBusyUid(profile.uid);
    try {
      await api.updateProfile(profile.uid);
      await Promise.all([refreshProfiles(), refreshProxies()]);
      toast(`${profile.name} 已更新`);
    } catch (e) {
      toast(String(e), "err");
    } finally {
      setBusyUid(null);
    }
  }

  async function use(profile: Profile) {
    setBusyUid(profile.uid);
    try {
      await api.selectProfile(profile.uid);
      await Promise.all([refreshStatus(), refreshProxies()]);
      toast(`已切换到 ${profile.name}`);
    } catch (e) {
      toast(String(e), "err");
    } finally {
      setBusyUid(null);
    }
  }

  async function remove(profile: Profile) {
    setConfirmDelete(null);
    setBusyUid(profile.uid);
    try {
      await api.deleteProfile(profile.uid);
      await Promise.all([refreshProfiles(), refreshStatus(), refreshProxies()]);
      toast(`已删除 ${profile.name}`);
    } catch (e) {
      toast(String(e), "err");
    } finally {
      setBusyUid(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">03 / SUBSCRIPTIONS</div>
          <h1 className="title">订阅</h1>
          <div className="subtitle">管理机场链接，查看流量、到期与更新记录</div>
        </div>
        <div className="head-actions">
          <button className="btn primary" onClick={() => setAdding(true)}>
            <Plus />
            添加订阅
          </button>
        </div>
      </div>

      {profiles.length === 0 ? (
        <section className="card">
          <Empty
            icon={<Layers />}
            title="还没有订阅"
            desc="粘贴机场给的 Clash 订阅链接，Zephyr 会拉取节点并自动启动内核。"
            action={
              <button className="btn primary" onClick={() => setAdding(true)}>
                <Plus />
                添加订阅
              </button>
            }
          />
        </section>
      ) : (
        <div className="stack">
          {profiles.map((profile) => {
            const used = profile.upload + profile.download;
            const percent = profile.total > 0 ? Math.min(100, (used / profile.total) * 100) : 0;
            const left = daysLeft(profile.expire);
            const isCurrent = status?.profileUid === profile.uid;
            const busy = busyUid === profile.uid;
            const [usedValue, usedUnit] = splitBytes(used);

            return (
              <section className="card profile-card" key={profile.uid}>
                <div className="profile-top">
                  <div style={{ minWidth: 0 }}>
                    <div className="profile-name">
                      {profile.name}
                      {isCurrent ? <span className="tag green">使用中</span> : null}
                    </div>
                    <div className="profile-url">{profile.url}</div>
                  </div>
                  <div className="card-actions">
                    {!isCurrent && (
                      <button className="btn sm" onClick={() => use(profile)} disabled={busy}>
                        <Check />
                        启用
                      </button>
                    )}
                    <button className="btn sm" onClick={() => update(profile)} disabled={busy}>
                      <RefreshCw className={busy ? "spin" : ""} />
                      更新
                    </button>
                    <button
                      className="btn sm danger"
                      onClick={() => setConfirmDelete(profile)}
                      disabled={busy}
                    >
                      <Trash2 />
                      删除
                    </button>
                  </div>
                </div>

                <div className="profile-body">
                  <div>
                    <div className="k">已用流量</div>
                    <div className="v">
                      {usedValue} <span className="unit">{usedUnit}</span>
                      {profile.total > 0 ? (
                        <span className="unit"> / {formatBytes(profile.total)}</span>
                      ) : null}
                    </div>
                    {profile.total > 0 ? (
                      <div className="bar">
                        <i
                          className={percent >= 95 ? "over" : percent >= 80 ? "warn" : ""}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <div className="k">到期时间</div>
                    <div className="v">{formatDate(profile.expire)}</div>
                    <div className="card-desc">
                      {left === null ? "订阅未提供" : left > 0 ? `还剩 ${left} 天` : "已过期"}
                    </div>
                  </div>
                  <div>
                    <div className="k">节点数量</div>
                    <div className="v">{profile.nodeCount}</div>
                  </div>
                  <div>
                    <div className="k">上次更新</div>
                    <div className="v">{formatAgo(profile.updated)}</div>
                    <div className="card-desc">{formatDate(profile.updated)}</div>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {adding && (
        <Dialog
          title="添加订阅"
          onClose={() => setAdding(false)}
          footer={
            <>
              <button className="btn" onClick={() => setAdding(false)}>
                取消
              </button>
              <button className="btn primary" onClick={addProfile} disabled={saving || !url.trim()}>
                {saving ? "正在拉取…" : "添加"}
              </button>
            </>
          }
        >
          <label htmlFor="sub-url">订阅链接</label>
          <div className="field">
            <input
              id="sub-url"
              value={url}
              autoFocus
              placeholder="https://example.com/api/v1/client/subscribe?token=..."
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addProfile()}
            />
          </div>
          <p className="dialog-hint">
            需要 Clash / mihomo 格式的链接。第一个添加的订阅会自动启用。
          </p>
        </Dialog>
      )}

      {confirmDelete && (
        <Dialog
          title="删除订阅"
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmDelete(null)}>
                取消
              </button>
              <button className="btn danger" onClick={() => remove(confirmDelete)}>
                删除
              </button>
            </>
          }
        >
          <p className="dialog-hint">
            确定删除「{confirmDelete.name}」吗？它的配置文件会一起删掉，这个操作不能撤销。
          </p>
        </Dialog>
      )}
    </>
  );
}
