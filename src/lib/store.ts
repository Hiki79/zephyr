import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { api, type Profile, type ProxyItem, type Settings, type Status } from "./api";

export type Page = "overview" | "proxies" | "profiles" | "rules" | "connections" | "logs" | "settings";

export type TrafficSample = { up: number; down: number };
export type LogLine = { id: number; time: string; text: string; level: "info" | "warn" | "error" };
export type Toast = { id: number; text: string; kind: "ok" | "err" };

const HISTORY = 60;
const MAX_LOGS = 600;

type State = {
  page: Page;
  ready: boolean;

  status: Status | null;
  settings: Settings | null;
  profiles: Profile[];
  proxies: Record<string, ProxyItem>;
  connectionCount: number;
  memory: number;
  totalUp: number;
  totalDown: number;

  traffic: TrafficSample[];
  logs: LogLine[];
  toasts: Toast[];

  busy: Record<string, boolean>;

  setPage: (page: Page) => void;
  toast: (text: string, kind?: "ok" | "err") => void;
  dismissToast: (id: number) => void;
  setBusy: (key: string, value: boolean) => void;

  refreshStatus: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  refreshProfiles: () => Promise<void>;
  refreshProxies: () => Promise<void>;
  refreshCounters: () => Promise<void>;

  patchSettings: (patch: Partial<Settings>) => Promise<void>;
  selectNode: (group: string, node: string) => Promise<void>;
  clearLogs: () => void;

  boot: () => Promise<void>;
};

let toastSeq = 0;
let logSeq = 0;
let booted = false;

function levelOf(line: string): LogLine["level"] {
  const lower = line.toLowerCase();
  if (lower.includes("[error]") || lower.includes("level=error")) return "error";
  if (lower.includes("[warn") || lower.includes("level=warn")) return "warn";
  return "info";
}

export const useStore = create<State>((set, get) => ({
  page: "overview",
  ready: false,

  status: null,
  settings: null,
  profiles: [],
  proxies: {},
  connectionCount: 0,
  memory: 0,
  totalUp: 0,
  totalDown: 0,

  traffic: Array.from({ length: HISTORY }, () => ({ up: 0, down: 0 })),
  logs: [],
  toasts: [],
  busy: {},

  setPage: (page) => set({ page }),

  toast: (text, kind = "ok") => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => get().dismissToast(id), kind === "err" ? 5200 : 2800);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setBusy: (key, value) => set((s) => ({ busy: { ...s.busy, [key]: value } })),

  refreshStatus: async () => {
    try {
      set({ status: await api.getStatus() });
    } catch {
      /* the core may be mid-restart; the next tick will pick it up */
    }
  },

  refreshSettings: async () => {
    try {
      set({ settings: await api.getSettings() });
    } catch {
      /* ignore */
    }
  },

  refreshProfiles: async () => {
    try {
      const list = await api.getProfiles();
      set({ profiles: list.items ?? [] });
    } catch {
      /* ignore */
    }
  },

  refreshProxies: async () => {
    try {
      const data = await api.getProxies();
      set({ proxies: data?.proxies ?? {} });
    } catch {
      set({ proxies: {} });
    }
  },

  refreshCounters: async () => {
    try {
      const conns = await api.getConnections();
      set({
        connectionCount: conns.connections?.length ?? 0,
        totalUp: conns.uploadTotal ?? 0,
        totalDown: conns.downloadTotal ?? 0,
      });
    } catch {
      /* ignore */
    }
  },

  patchSettings: async (patch) => {
    try {
      const next = await api.patchSettings(patch);
      set({ settings: next });
      await get().refreshStatus();
    } catch (e) {
      get().toast(String(e), "err");
      await get().refreshSettings();
      throw e;
    }
  },

  selectNode: async (group, node) => {
    // Show the new node immediately, then confirm against the core.
    set((s) => {
      const current = s.proxies[group];
      if (!current) return {};
      return { proxies: { ...s.proxies, [group]: { ...current, now: node } } };
    });
    try {
      await api.selectNode(group, node);
    } catch (e) {
      get().toast(String(e), "err");
    }
    await get().refreshProxies();
  },

  clearLogs: () => set({ logs: [] }),

  boot: async () => {
    if (booted) return;
    booted = true;

    await Promise.all([get().refreshStatus(), get().refreshSettings(), get().refreshProfiles()]);
    await get().refreshProxies();
    await get().refreshCounters();
    set({ ready: true });

    listen<{ up: number; down: number }>("zephyr://traffic", (event) => {
      const sample = { up: event.payload?.up ?? 0, down: event.payload?.down ?? 0 };
      set((s) => ({ traffic: [...s.traffic.slice(1 - HISTORY), sample] }));
    });

    const pushLog = (text: string, level: LogLine["level"]) => {
      if (!text.trim()) return;
      const line: LogLine = {
        id: ++logSeq,
        time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        text,
        level,
      };
      set((s) => ({ logs: [...s.logs.slice(-(MAX_LOGS - 1)), line] }));
    };

    // The core's own log stream: routing decisions, DNS, connection errors.
    listen<{ type: string; payload: string }>("zephyr://log", (event) => {
      const type = (event.payload?.type ?? "info").toLowerCase();
      const level: LogLine["level"] =
        type === "error" ? "error" : type === "warning" || type === "warn" ? "warn" : "info";
      pushLog(event.payload?.payload ?? "", level);
    });

    // Anything the core writes before its API is up, plus crash output.
    // Its routine logfmt lines duplicate the log stream above, so drop those.
    const isLogfmtEcho = (line: string) => /^time=".*"\s+level=\w+\s+msg=/.test(line.trim());
    listen<string>("core://stdout", (event) => {
      const text = event.payload ?? "";
      if (isLogfmtEcho(text)) return;
      pushLog(text, levelOf(text));
    });

    listen<{ inuse: number }>("zephyr://memory", (event) => {
      set({ memory: event.payload?.inuse ?? 0 });
    });

    listen<{ from: number; to: number }>("zephyr://port-moved", (event) => {
      const { from, to } = event.payload ?? { from: 0, to: 0 };
      get().toast(`端口 ${from} 被占用，已改用 ${to}`, "err");
      get().refreshSettings();
    });

    // The tray can change proxy / TUN / mode; keep the window in step.
    listen<Settings>("zephyr://settings", (event) => {
      if (event.payload) set({ settings: event.payload });
      get().refreshStatus();
    });

    listen<{ text: string; kind: "ok" | "err" }>("zephyr://toast", (event) => {
      if (event.payload?.text) get().toast(event.payload.text, event.payload.kind ?? "ok");
    });

    listen("zephyr://core", () => {
      get().refreshStatus();
      get().refreshProxies();
    });

    listen("zephyr://profiles", () => {
      get().refreshProfiles();
      get().refreshStatus();
    });

    listen("zephyr://proxies", () => get().refreshProxies());

    // The core reports traffic by push; everything else is polled slowly.
    setInterval(() => {
      get().refreshStatus();
      get().refreshCounters();
    }, 4000);
    setInterval(() => get().refreshProxies(), 12000);
  },
}));

/** Groups in config order, with the plain nodes filtered out. */
export function selectGroups(proxies: Record<string, ProxyItem>): ProxyItem[] {
  const isGroup = (p: ProxyItem) => Array.isArray(p.all) && p.all.length > 0;
  const global = proxies["GLOBAL"];
  const ordered = global?.all?.filter((name) => proxies[name] && isGroup(proxies[name])) ?? [];
  if (ordered.length > 0) return ordered.map((name) => proxies[name]);
  return Object.values(proxies).filter(isGroup).filter((p) => p.name !== "GLOBAL");
}

/** Last measured latency of a node, 0 when it timed out. */
export function latencyOf(item: ProxyItem | undefined): number | undefined {
  if (!item?.history?.length) return undefined;
  return item.history[item.history.length - 1]?.delay;
}

/** A group shows the latency of whichever node it currently points at. */
export function groupLatency(
  proxies: Record<string, ProxyItem>,
  group: ProxyItem,
  depth = 0
): number | undefined {
  if (depth > 4 || !group.now) return undefined;
  const target = proxies[group.now];
  if (!target) return undefined;
  if (Array.isArray(target.all) && target.all.length > 0) {
    return groupLatency(proxies, target, depth + 1);
  }
  return latencyOf(target);
}

/** `节点选择 → 香港 IEPL 01` for groups that point at another group. */
export function resolveChain(
  proxies: Record<string, ProxyItem>,
  name: string | undefined,
  depth = 0
): string {
  if (!name) return "--";
  const target = proxies[name];
  if (!target || depth > 4) return name;
  if (Array.isArray(target.all) && target.all.length > 0 && target.now) {
    return `${name} → ${resolveChain(proxies, target.now, depth + 1)}`;
  }
  return name;
}
