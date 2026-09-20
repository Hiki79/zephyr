import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Search, Trash2 } from "lucide-react";
import { useStore } from "../lib/store";
import { Empty, Switch } from "../components/bits";

export default function Logs() {
  const logs = useStore((s) => s.logs);
  const clearLogs = useStore((s) => s.clearLogs);
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const viewRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return logs;
    return logs.filter((line) => line.text.toLowerCase().includes(needle));
  }, [logs, query]);

  useEffect(() => {
    if (!follow) return;
    const view = viewRef.current;
    if (view) view.scrollTop = view.scrollHeight;
  }, [filtered, follow]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">06 / LOGS</div>
          <h1 className="title">日志</h1>
          <div className="subtitle">内核自启动以来的输出，只保留最近 600 行</div>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={clearLogs} disabled={logs.length === 0}>
            <Trash2 />
            清空
          </button>
        </div>
      </div>

      <section className="card" style={{ height: "calc(100% - 92px)", display: "flex", flexDirection: "column" }}>
        <div className="toolbar">
          <label className="field round grow">
            <Search />
            <input
              id="log-search"
              value={query}
              placeholder="筛选日志内容"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <span className="card-desc">自动滚动</span>
          <Switch label="自动滚动到底部" checked={follow} onChange={setFollow} />
          <span className="card-desc">
            {filtered.length} / {logs.length} 行
          </span>
        </div>

        {filtered.length === 0 ? (
          <Empty
            icon={<FileText />}
            title={logs.length === 0 ? "还没有日志" : "没有匹配的行"}
            desc={
              logs.length === 0
                ? "内核启动后，它的输出会实时出现在这里。"
                : "换个关键词试试。"
            }
          />
        ) : (
          <div className="log-view" ref={viewRef}>
            {filtered.map((line) => (
              <div className={`log-line ${line.level}`} key={line.id}>
                <span className="log-time">{line.time}</span>
                <span className="log-text">{line.text}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
