import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Cpu,
  Download,
  Monitor,
  RefreshCw,
  Route,
  Shield,
  Upload,
  Zap,
} from "lucide-react";
import { api } from "../lib/api";
import { groupLatency, resolveChain, selectGroups, useStore } from "../lib/store";
import { formatBytes, formatUptime, splitRate } from "../lib/format";
import TrafficChart from "../components/TrafficChart";
import { Delay, Segmented, Switch, useTick } from "../components/bits";

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

  const latest = traffic[traffic.length - 1] ?? { up: 0, down: 0 };
  const [downValue, downUnit] = splitRate(latest.down);
  const [upValue, upUnit] = splitRate(latest.up);

  const groups = useMemo(() => selectGroups(proxies), [proxies]);
  // The summary is deliberately short: the first few groups, nothing more.
  const summary = groups.slice(0, 4);

  const running = status?.running ?? false;
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

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">01 / OVERVIEW</div>
          <h1 className="title">连接总览</h1>
          <div className="subtitle">
            {currentProfile ? `当前订阅 ${currentProfile.name}` : "尚未添加订阅"}
            {" · "}
            {running ? "内核运行中" : status?.lastError ?? "内核未运行"}
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
                <i className={`dot ${running ? "green" : "red"}`} />
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
              <span>混合端口 {status?.mixedPort ?? "--"}</span>
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
                  {settings?.systemProxy
                    ? `已接管 · 127.0.0.1:${status?.mixedPort ?? ""}`
                    : "未接管系统流量"}
                </div>
              </div>
              <Switch
                label="系统代理"
                checked={settings?.systemProxy ?? false}
                disabled={!running}
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
                策略路由 <span className="count">({groups.length})</span>
              </h2>
              <div className="card-desc">直接在这里换节点，改动立即生效</div>
            </div>
            <div className="card-actions">
              <button className="btn sm" onClick={() => setPage("proxies")}>
                全部节点
              </button>
            </div>
          </div>

          {summary.length === 0 ? (
            <div className="table-foot">还没有策略组，添加订阅后这里会列出来。</div>
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
    </>
  );
}
