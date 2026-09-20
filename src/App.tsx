import { useEffect, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Activity,
  FileText,
  Globe,
  Layers,
  LayoutGrid,
  Settings as SettingsIcon,
  SlidersHorizontal,
} from "lucide-react";
import { selectGroups, useStore, type Page } from "./lib/store";
import { formatClock } from "./lib/format";
import { Toasts, useTick } from "./components/bits";
import Overview from "./pages/Overview";
import Proxies from "./pages/Proxies";
import Profiles from "./pages/Profiles";
import Connections from "./pages/Connections";
import Rules from "./pages/Rules";
import Logs from "./pages/Logs";
import SettingsPage from "./pages/Settings";

const NAV: { page: Page; num: string; label: string; icon: typeof LayoutGrid }[] = [
  { page: "overview", num: "01", label: "总览", icon: LayoutGrid },
  { page: "proxies", num: "02", label: "节点", icon: Globe },
  { page: "profiles", num: "03", label: "订阅", icon: Layers },
  { page: "connections", num: "04", label: "连接", icon: Activity },
  { page: "rules", num: "05", label: "规则", icon: SlidersHorizontal },
  { page: "logs", num: "06", label: "日志", icon: FileText },
  { page: "settings", num: "07", label: "设置", icon: SettingsIcon },
];

export default function App() {
  useTick();
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  const boot = useStore((s) => s.boot);
  const status = useStore((s) => s.status);
  const proxies = useStore((s) => s.proxies);
  const profiles = useStore((s) => s.profiles);
  const connectionCount = useStore((s) => s.connectionCount);

  useEffect(() => {
    boot();
  }, [boot]);

  const groupCount = useMemo(() => selectGroups(proxies).length, [proxies]);

  const counts: Partial<Record<Page, number>> = {
    proxies: groupCount,
    profiles: profiles.length,
    connections: connectionCount,
  };

  const appWindow = getCurrentWindow();
  const running = status?.running ?? false;

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-brand">
          <span className="nav-mark">Z</span>
          <span className="nav-word">zephyr.</span>
        </div>
        <div className="nav-rule" />
        <div className="nav-label">MENU</div>

        <div className="nav-list">
          {NAV.map((item) => {
            const Icon = item.icon;
            const count = counts[item.page];
            return (
              <button
                key={item.page}
                className={`nav-item ${page === item.page ? "on" : ""}`}
                onClick={() => setPage(item.page)}
              >
                <Icon />
                <span>{item.label}</span>
                {count !== undefined && count > 0 ? (
                  <span className="nav-count">{count}</span>
                ) : (
                  <span className="nav-num">{item.num}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="nav-foot">
          <div className="nav-kv">
            <span>内核</span>
            <b>mihomo</b>
          </div>
          <div className="nav-kv">
            <span>版本</span>
            <b>{status?.coreVersion ? status.coreVersion.replace(/^v*/, "v") : "--"}</b>
          </div>
          <div className="nav-stamp">ZEPHYR FOR WINDOWS</div>
        </div>
      </nav>

      <div className="main">
        <header className="titlebar">
          <div className="titlebar-drag" onMouseDown={() => appWindow.startDragging()} />
          <div className="titlebar-meta">
            <span>
              <i className={`dot ${running ? "green" : "red"}`} style={{ marginRight: 6 }} />
              {running ? "运行中" : "未运行"}
            </span>
            <span className="mono num">{formatClock(status?.startedAt ?? 0)}</span>
          </div>
          <div className="caption">
            <button className="cap" aria-label="最小化" onClick={() => appWindow.minimize()}>
              <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                <path d="M0 5h10" />
              </svg>
            </button>
            <button className="cap" aria-label="最大化" onClick={() => appWindow.toggleMaximize()}>
              <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="0.5" y="0.5" width="9" height="9" rx="1" />
              </svg>
            </button>
            <button className="cap close" aria-label="关闭" onClick={() => appWindow.close()}>
              <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                <path d="M0 0l10 10M10 0L0 10" />
              </svg>
            </button>
          </div>
        </header>

        <main className="page">
          {page === "overview" && <Overview />}
          {page === "proxies" && <Proxies />}
          {page === "profiles" && <Profiles />}
          {page === "connections" && <Connections />}
          {page === "rules" && <Rules />}
          {page === "logs" && <Logs />}
          {page === "settings" && <SettingsPage />}
        </main>
      </div>

      <Toasts />
    </div>
  );
}
