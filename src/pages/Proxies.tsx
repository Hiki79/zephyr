import { useEffect, useMemo, useState } from "react";
import { Globe, Search, Zap } from "lucide-react";
import { api } from "../lib/api";
import {
  groupLatency,
  latencyOf,
  resolveChain,
  selectGroups,
  useStore,
} from "../lib/store";
import { nodeMeta, regionOf } from "../lib/format";
import { Delay, Empty, Switch } from "../components/bits";

export default function Proxies() {
  const proxies = useStore((s) => s.proxies);
  const selectNode = useStore((s) => s.selectNode);
  const refreshProxies = useStore((s) => s.refreshProxies);
  const toast = useStore((s) => s.toast);
  const setPage = useStore((s) => s.setPage);

  const groups = useMemo(() => selectGroups(proxies), [proxies]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hideDead, setHideDead] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (groups.length === 0) {
      if (activeName !== null) setActiveName(null);
      return;
    }
    if (!activeName || !groups.some((g) => g.name === activeName)) {
      setActiveName(groups[0].name);
    }
  }, [groups, activeName]);

  const active = activeName ? proxies[activeName] : undefined;
  const switchable = active?.type === "Selector";

  // Bucket the group's nodes by the region their name implies.
  const regions = useMemo(() => {
    if (!active?.all) return [];
    const needle = query.trim().toLowerCase();
    const buckets = new Map<string, { code: string; name: string; nodes: string[] }>();

    for (const nodeName of active.all) {
      if (needle && !nodeName.toLowerCase().includes(needle)) continue;
      const latency = latencyOf(proxies[nodeName]);
      if (hideDead && latency !== undefined && latency <= 0) continue;

      const region = regionOf(nodeName);
      const bucket = buckets.get(region.code) ?? { ...region, nodes: [] };
      bucket.nodes.push(nodeName);
      buckets.set(region.code, bucket);
    }
    return [...buckets.values()];
  }, [active, proxies, query, hideDead]);

  const visibleCount = regions.reduce((sum, r) => sum + r.nodes.length, 0);

  async function testGroup() {
    if (!active) return;
    setTesting(true);
    try {
      await api.testGroup(active.name);
      await refreshProxies();
      toast(`${active.name} 测速完成`);
    } catch (e) {
      toast(String(e), "err");
    } finally {
      setTesting(false);
    }
  }

  if (groups.length === 0) {
    return (
      <>
        <div className="page-head">
          <div>
            <div className="kicker">02 / PROXIES</div>
            <h1 className="title">节点</h1>
            <div className="subtitle">策略组与节点都来自当前订阅</div>
          </div>
        </div>
        <section className="card">
          <Empty
            icon={<Globe />}
            title="还没有可用的节点"
            desc="添加一个订阅之后，它的策略组和节点会出现在这里。"
            action={
              <button className="btn primary" onClick={() => setPage("profiles")}>
                去添加订阅
              </button>
            }
          />
        </section>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">02 / PROXIES</div>
          <h1 className="title">节点</h1>
          <div className="subtitle">
            {groups.length} 个策略组 · 当前 {active?.name ?? "--"} 指向{" "}
            {resolveChain(proxies, active?.now)}
          </div>
        </div>
      </div>

      <div className="proxy-layout">
        <aside>
          <div className="section-head">
            <span className="section-label">策略组</span>
          </div>
          <div className="group-list">
            {groups.map((group) => (
              <button
                key={group.name}
                className={`group-item ${group.name === activeName ? "on" : ""}`}
                onClick={() => setActiveName(group.name)}
              >
                <div className="group-item-top">
                  <span className="group-item-name">{group.name}</span>
                  <Delay ms={groupLatency(proxies, group)} className="group-item-ms" />
                </div>
                <div className="group-item-sub">{resolveChain(proxies, group.now)}</div>
              </button>
            ))}
          </div>
        </aside>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>
                {active?.name} <span className="count">({active?.all?.length ?? 0})</span>
              </h2>
              <div className="card-desc">
                {switchable
                  ? `当前 ${active?.now ?? "--"}`
                  : `${active?.type} 组由内核自动选择，不能手动切换`}
              </div>
            </div>
            <div className="card-actions">
              <span className="tag">{active?.type}</span>
              <button className="btn" onClick={testGroup} disabled={testing}>
                <Zap className={testing ? "spin" : ""} />
                测速
              </button>
            </div>
          </div>

          <div className="toolbar">
            <label className="field round grow">
              <Search />
              <input
                id="node-search"
                value={query}
                placeholder="查找节点，例如 香港、IEPL、0.5x"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <span className="card-desc">隐藏超时</span>
            <Switch label="隐藏超时节点" checked={hideDead} onChange={setHideDead} />
          </div>

          {visibleCount === 0 ? (
            <div className="table-foot">没有匹配的节点，换个关键词试试。</div>
          ) : (
            regions.map((region) => {
              const measured = region.nodes
                .map((name) => latencyOf(proxies[name]))
                .filter((ms): ms is number => typeof ms === "number" && ms > 0);
              const avg = measured.length
                ? Math.round(measured.reduce((a, b) => a + b, 0) / measured.length)
                : null;

              return (
                <div className="region" key={region.code}>
                  <div className="region-head">
                    <span className="region-code">{region.code}</span>
                    <span className="region-name">{region.name}</span>
                    <span className="region-meta">
                      {region.nodes.length} 个节点{avg !== null ? ` · 平均 ${avg} ms` : ""}
                    </span>
                  </div>
                  <div className="node-grid">
                    {region.nodes.map((nodeName) => {
                      const node = proxies[nodeName];
                      const isCurrent = active?.now === nodeName;
                      return (
                        <button
                          key={nodeName}
                          className={`node ${isCurrent ? "on" : ""}`}
                          disabled={!switchable}
                          onClick={() => activeName && selectNode(activeName, nodeName)}
                        >
                          <span style={{ minWidth: 0 }}>
                            <span className="node-name">{nodeName}</span>
                            <span className="node-meta" style={{ display: "block" }}>
                              {nodeMeta(nodeName, node?.type ?? "--")}
                            </span>
                          </span>
                          <Delay ms={latencyOf(node)} className="node-ms" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}

          <div className="table-foot">
            <span>
              显示 {visibleCount} / {active?.all?.length ?? 0} 个节点
            </span>
            <span>150 ms 以内为绿，300 ms 以内为橙</span>
          </div>
        </section>
      </div>
    </>
  );
}
