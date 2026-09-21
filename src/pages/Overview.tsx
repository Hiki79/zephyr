import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Cpu,
  Download,
  ListChecks,
  Monitor,
  RefreshCw,
  Route,
  Shield,
  Square,
  SquareCheck,
  Upload,
  Zap,
} from "lucide-react";
import { api } from "../lib/api";
import { groupLatency, resolveChain, selectGroups, useStore } from "../lib/store";
import { formatBytes, formatUptime, splitRate } from "../lib/format";
import TrafficChart from "../components/TrafficChart";
import { Delay, Dialog, Segmented, Switch, useTick } from "../components/bits";

/** How many groups the routing card shows until the user has picked their own. */
const DEFAULT_SUMMARY = 4;

export default function Overview() {
  useTick();
  const status = useStore((s) => s.status);
  const settings = useStore((s) => s.settings);
  const proxies = useStore((s) => s.proxies);
  const traffic = useStore((s) => s.traffic);
  const connectionCount = useStore((s) => s.connectionCount);
  const memory = useStore((s) => s.memory);
  const totalUp = useStore((s) => s.totalUp);
  const totalDown = useStore((s) => s.totalDown);
  const patchSettings = useStore((s) => s.patchSettings);
  const selectNode = useStore((s) => s.selectNode);
  const setPage = useStore((s) => s.setPage);
  const toast = useStore((s) => s.toast);
  const profiles = useStore((s) => s.profiles);
  const refreshProxies = useStore((s) => s.refreshProxies);
  const refreshProfiles = useStore((s) => s.refreshProfiles);

  const [updating, setUpdating] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const latest = traffic[traffic.length - 1] ?? { up: 0, down: 0 };
  const [downValue, downUnit] = splitRate(latest.down);
  const [upValue, upUnit] = splitRate(latest.up);

  const groups = useMemo(() => selectGroups(proxies), [proxies]);
  // The card is a curated summary: the groups the user pinned, in config
  // order, or the first few until they have picked any. The proxies page
  // always shows everything.
  const pinned = settings?.pinnedGroups ?? [];
  const summary =
    pinned.length === 0
      ? groups.slice(0, DEFAULT_SUMMARY)
      : groups.filter((group) => pinned.includes(group.name));

  const running = status?.running ?? false;
  const proxyDown = running && !(status?.listeningPort && status.listeningPort > 0);
  const currentProfile = profiles.find((p) => p.uid === status?.profileUid);

  async function updateSubscription() {
    if (!currentProfile) {
      setPage("profiles");
      return;
    }
    setUpdating(true);
    try {
      await api.updateProfile(currentProfile.uid);
      await Promise.all([refreshProfiles(), refreshProxies()]);
      toast(`${currentProfile.name} 已更新`);
    } catch (e) {
      toast(String(e), "err");
    } finally {
      setUpdating(false);
    }
  }

  function openPicker() {
    // Start from what the card shows now, so the defaults come pre-checked.
    setDraft(summary.map((group) => group.name));
    setPicking(true);
  }

  function toggleDraft(name: string) {
    setDraft((d) => (d.includes(name) ? d.filter((n) => n !== name) : [...d, name]));
  }

  async function savePicker(next: string[]) {
    setSaving(true);
    try {
      await patchSettings({ pinnedGroups: next });
      setPicking(false);
      toast(
        next.length === 0
          ? `已恢复默认，显示前 ${DEFAULT_SUMMARY} 个分组`
          : `策略路由现在显示 ${next.length} 个分组`
      );
    } catch {
      /* the store already showed the error */
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">01 / OVERVIEW</div>
          <h1 className="title">连接总览</h1>
          <div className="subtitle">
            {currentProfile ? `当前订阅 ${currentProfile.name}` : "尚未添加订阅"}
            {" · "}
            {proxyDown
              ? (status?.lastError ?? "代理端口没有启动")
              : running
                ? "内核运行中"
                : (status?.lastError ?? "内核未运行")}
          </div>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => refreshProxies()}>
            <RefreshCw />
            刷新
          </button>
          <button className="btn primary" onClick={updateSubscription} disabled={updating}>
            <Download className={updating ? "spin" : ""} />
            {currentProfile ? "更新订阅" : "添加订阅"}
          </button>
        </div>
      </div>

      <div className="stack">
        <div className="overview-grid">
          <section className="hero">
            <div className="hero-top">
              <div className="hero-label">
                <i className={`dot ${proxyDown ? "orange" : running ? "green" : "red"}`} />
                NETWORK / LIVE
              </div>
              <div className="hero-window">最近 60 秒</div>
            </div>

            <div className="hero-stats">
              <div className="hero-stat">
                <div className="hero-stat-label">
                  <ArrowDown />
                  下载速率
                </div>
                <div className="hero-stat-value">
                  <b>{downValue}</b>
                  <span>{downUnit}</span>
                </div>
              </div>
              <div className="hero-stat">
                <div className="hero-stat-label">
                  <ArrowUp />
                  上传速率
                </div>
                <div className="hero-stat-value">
                  <b>{upValue}</b>
                  <span>{upUnit}</span>
                </div>
              </div>
            </div>

            <TrafficChart samples={traffic} />

            <div className="hero-foot">
              <span>
                {proxyDown ? "代理端口未启动" : `混合端口 ${status?.listeningPort ?? status?.mixedPort ?? "--"}`}
              </span>
              <span className="hero-legend">
                <span>
                  <i style={{ background: "#ffffff" }} />
                  下行
                </span>
                <span>
                  <i style={{ background: "rgba(255,255,255,0.5)" }} />
                  上行
                </span>
              </span>
            </div>
          </section>

          <section className="card activity">
            <div className="activity-head">
              <span className="section-label">ACTIVITY</span>
              <button className="btn icon sm" onClick={() => setPage("connections")} aria-label="查看连接">
                <ChevronRight />
              </button>
            </div>
            <div className="activity-big">
              <b>{connectionCount}</b>
              <span>活动连接</span>
            </div>
            <div className="activity-list">
              <div className="activity-row">
                <Download />
                <span>本次累计下载</span>
                <b>{formatBytes(totalDown)}</b>
              </div>
              <div className="activity-row">
                <Upload />
                <span>本次累计上传</span>
                <b>{formatBytes(totalUp)}</b>
              </div>
              <div className="activity-row">
                <Cpu />
                <span>内核内存</span>
                <b>{formatBytes(memory)}</b>
              </div>
              <div className="activity-row">
                <Zap />
                <span>运行时长</span>
                <b>{running ? formatUptime(status?.startedAt ?? 0) : "未启动"}</b>
              </div>
            </div>
          </section>
        </div>

        <section className="card">
          <div className="controls">
            <div className="control">
              <span className={`control-icon ${settings?.systemProxy ? "on" : ""}`}>
                <Monitor />
              </span>
              <div className="control-text">
                <div className="control-title">系统代理</div>
                <div className="control-sub">
                  {proxyDown
                    ? "代理端口未启动，无法接管"
                    : settings?.systemProxy
                      ? `已接管 · 127.0.0.1:${status?.listeningPort ?? status?.mixedPort ?? ""}`
                      : "未接管系统流量"}
                </div>
              </div>
              <Switch
                label="系统代理"
                checked={settings?.systemProxy ?? false}
                disabled={!running || proxyDown}
                onChange={(next) => patchSettings({ systemProxy: next }).catch(() => {})}
              />
            </div>

            <div className="control">
              <span className={`control-icon ${settings?.tun ? "on" : ""}`}>
                <Shield />
              </span>
              <div className="control-text">
                <div className="control-title">TUN 增强模式</div>
                <div className="control-sub">接管设备的全部网络流量</div>
              </div>
              <Switch
                label="TUN 模式"
                checked={settings?.tun ?? false}
                disabled={!running}
                onChange={(next) => {
                  patchSettings({ tun: next })
                    .then(() => toast(next ? "TUN 已开启" : "TUN 已关闭"))
                    .catch(() => {});
                }}
              />
            </div>

            <div className="control">
              <span className="control-icon on">
                <Route />
              </span>
              <div className="control-text">
                <div className="control-title">出站模式</div>
                <div className="control-sub">
                  {settings?.mode === "rule"
                    ? "按规则分流，国内直连"
                    : settings?.mode === "global"
                      ? "全部流量走当前节点"
                      : "全部流量不走代理"}
                </div>
              </div>
              <Segmented
                value={settings?.mode ?? "rule"}
                options={[
                  { value: "rule", label: "规则" },
                  { value: "global", label: "全局" },
                  { value: "direct", label: "直连" },
                ]}
                onChange={(mode) => patchSettings({ mode }).catch(() => {})}
              />
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>
                策略路由{" "}
                <span className="count">
                  ({summary.length} / {groups.length})
                </span>
              </h2>
              <div className="card-desc">
                {pinned.length === 0
                  ? "直接在这里换节点，改动立即生效 · 现在显示前几个分组，可以自己选"
                  : "直接在这里换节点，改动立即生效 · 显示的是你选的分组"}
              </div>
            </div>
            <div className="card-actions">
              <button className="btn sm" onClick={openPicker} disabled={groups.length === 0}>
                <ListChecks />
                选择分组
              </button>
              <button className="btn sm" onClick={() => setPage("proxies")}>
                全部节点
              </button>
            </div>
          </div>

          {groups.length === 0 ? (
            <div className="table-foot">还没有策略组，添加订阅后这里会列出来。</div>
          ) : summary.length === 0 ? (
            <div className="table-foot">
              <span>你选的分组在当前订阅里都不存在，重新选一下。</span>
              <button className="btn sm" onClick={openPicker}>
                重新选择
              </button>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>策略组</th>
                  <th>当前节点</th>
                  <th className="r">延迟</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((group) => {
                  const switchable = group.type === "Selector";
                  return (
                    <tr key={group.name}>
                      <td>
                        <div className="group-cell">
                          <Route />
                          <span>{group.name}</span>
                          <span className="tag">{group.type}</span>
                        </div>
                      </td>
                      <td>
                        {switchable ? (
                          <select
                            className="picker"
                            value={group.now ?? ""}
                            onChange={(e) => selectNode(group.name, e.target.value)}
                          >
                            {(group.all ?? []).map((node) => (
                              <option key={node} value={node}>
                                {node}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="sub">{resolveChain(proxies, group.now)}</span>
                        )}
                      </td>
                      <td className="r">
                        <Delay ms={groupLatency(proxies, group)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {picking && (
        <Dialog
          title="选择要显示的分组"
          onClose={() => setPicking(false)}
          footer={
            <>
              <span className="pick-count">
                {draft.length === 0 ? "至少勾选一个分组" : `已选 ${draft.length} / ${groups.length}`}
              </span>
              <button className="btn" onClick={() => savePicker([])} disabled={saving}>
                恢复默认
              </button>
              <button className="btn" onClick={() => setPicking(false)} disabled={saving}>
                取消
              </button>
              <button
                className="btn primary"
                onClick={() => savePicker(draft)}
                disabled={saving || draft.length === 0}
              >
                保存
              </button>
            </>
          }
        >
          <div className="dialog-hint">
            勾选的分组会出现在总览的策略路由卡片里，顺序跟订阅一致。节点页始终显示全部分组。
          </div>
          <div className="pick-list">
            {groups.map((group) => {
              const on = draft.includes(group.name);
              return (
                <button
                  key={group.name}
                  type="button"
                  className={`pick-row ${on ? "on" : ""}`}
                  aria-pressed={on}
                  onClick={() => toggleDraft(group.name)}
                >
                  {on ? <SquareCheck /> : <Square />}
                  <span style={{ minWidth: 0 }}>
                    <span className="pick-name">{group.name}</span>
                    <span className="pick-sub">{resolveChain(proxies, group.now)}</span>
                  </span>
                  <span className="tag">{group.type}</span>
                </button>
              );
            })}
          </div>
        </Dialog>
      )}
    </>
  );
}
