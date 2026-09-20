import { useEffect, useMemo, useState } from "react";
import { Activity, Search, XCircle } from "lucide-react";
import { api, type Connection } from "../lib/api";
import { useStore } from "../lib/store";
import { formatBytes } from "../lib/format";
import { Empty } from "../components/bits";

export default function Connections() {
  const toast = useStore((s) => s.toast);
  const refreshCounters = useStore((s) => s.refreshCounters);
  const [rows, setRows] = useState<Connection[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const data = await api.getConnections();
        if (alive) setRows(data.connections ?? []);
      } catch {
        if (alive) setRows([]);
      }
    };
    pull();
    const id = setInterval(pull, 1800);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? rows.filter((row) => {
          const host = row.metadata.host || row.metadata.destinationIP || "";
          return (
            host.toLowerCase().includes(needle) ||
            (row.metadata.process ?? "").toLowerCase().includes(needle) ||
            row.chains.join(" ").toLowerCase().includes(needle)
          );
        })
      : rows;
    return [...list].sort((a, b) => b.download + b.upload - (a.download + a.upload));
  }, [rows, query]);

  async function closeAll() {
    try {
      await api.closeAllConnections();
      await refreshCounters();
      toast("已断开全部连接");
    } catch (e) {
      toast(String(e), "err");
    }
  }

  async function closeOne(id: string) {
    try {
      await api.closeConnection(id);
      setRows((current) => current.filter((row) => row.id !== id));
    } catch (e) {
      toast(String(e), "err");
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">04 / CONNECTIONS</div>
          <h1 className="title">连接</h1>
          <div className="subtitle">正在进行的请求，按流量从大到小排列</div>
        </div>
        <div className="head-actions">
          <button className="btn danger" onClick={closeAll} disabled={rows.length === 0}>
            <XCircle />
            全部断开
          </button>
        </div>
      </div>

      <section className="card">
        <div className="toolbar">
          <label className="field round grow">
            <Search />
            <input
              id="conn-search"
              value={query}
              placeholder="按域名、进程或节点筛选"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <span className="card-desc">
            {filtered.length} / {rows.length} 条
          </span>
        </div>

        {filtered.length === 0 ? (
          <Empty
            icon={<Activity />}
            title={rows.length === 0 ? "暂时没有连接" : "没有匹配的连接"}
            desc={
              rows.length === 0
                ? "打开一个网页或应用，这里会实时显示它走了哪个节点。"
                : "换个关键词试试。"
            }
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>目标</th>
                <th>进程</th>
                <th>规则</th>
                <th>出站</th>
                <th className="r">上行</th>
                <th className="r">下行</th>
                <th style={{ width: 52 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((row) => {
                const host = row.metadata.host || row.metadata.destinationIP || "--";
                const process = (row.metadata.process ?? "").replace(/\.exe$/i, "") || "--";
                const chain = row.chains[0] ?? "--";
                return (
                  <tr key={row.id}>
                    <td className="ell" style={{ width: "32%" }} title={`${host}:${row.metadata.destinationPort}`}>
                      {host}
                      <span className="sub">:{row.metadata.destinationPort}</span>
                    </td>
                    <td className="ell sub" style={{ width: "15%" }} title={row.metadata.processPath}>
                      {process}
                    </td>
                    <td className="sub">{row.rule}</td>
                    <td className="ell" style={{ width: "18%" }} title={row.chains.join(" ← ")}>
                      {chain}
                    </td>
                    <td className="r num sub">{formatBytes(row.upload)}</td>
                    <td className="r num">{formatBytes(row.download)}</td>
                    <td className="r">
                      <button
                        className="btn icon sm"
                        aria-label="断开这条连接"
                        onClick={() => closeOne(row.id)}
                      >
                        <XCircle />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {filtered.length > 200 && (
          <div className="table-foot">
            <span>只显示流量最大的 200 条</span>
          </div>
        )}
      </section>
    </>
  );
}
