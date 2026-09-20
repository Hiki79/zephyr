import { invoke } from "@tauri-apps/api/core";

export type Settings = {
  mixedPort: number;
  ctrlPort: number;
  secret: string;
  mode: "rule" | "global" | "direct";
  systemProxy: boolean;
  tun: boolean;
  allowLan: boolean;
  ipv6: boolean;
  unifiedDelay: boolean;
  autoStart: boolean;
  silentStart: boolean;
  currentProfile: string | null;
  bypass: string;
  testUrl: string;
  autoUpdateHours: number;
  logLevel: string;
};

export type Status = {
  running: boolean;
  startedAt: number;
  mixedPort: number;
  ctrlPort: number;
  secret: string;
  mode: Settings["mode"];
  systemProxy: boolean;
  systemProxyActual: boolean;
  tun: boolean;
  profileName: string | null;
  profileUid: string | null;
  coreVersion: string | null;
  lastError: string | null;
};

export type Profile = {
  uid: string;
  name: string;
  url: string;
  updated: number;
  upload: number;
  download: number;
  total: number;
  expire: number;
  home: string | null;
  nodeCount: number;
};

/** One entry of mihomo's /proxies map: either a node or a group. */
export type ProxyItem = {
  name: string;
  type: string;
  now?: string;
  all?: string[];
  udp?: boolean;
  history?: { time: string; delay: number }[];
};

export type ProxiesResponse = { proxies: Record<string, ProxyItem> };

export type Connection = {
  id: string;
  upload: number;
  download: number;
  start: string;
  chains: string[];
  rule: string;
  rulePayload: string;
  metadata: {
    network: string;
    type: string;
    sourceIP: string;
    destinationIP: string;
    host: string;
    destinationPort: string;
    process?: string;
    processPath?: string;
  };
};

export type ConnectionsResponse = {
  downloadTotal: number;
  uploadTotal: number;
  connections: Connection[] | null;
};

export type Rule = { type: string; payload: string; proxy: string; size?: number };

export const api = {
  getStatus: () => invoke<Status>("get_status"),
  getSettings: () => invoke<Settings>("get_settings"),
  patchSettings: (patch: Partial<Settings>) => invoke<Settings>("patch_settings", { patch }),
  restartCore: () => invoke<void>("restart_core"),

  getProfiles: () => invoke<{ items: Profile[] }>("get_profiles"),
  addProfile: (url: string) => invoke<Profile>("add_profile", { url }),
  updateProfile: (uid: string) => invoke<Profile>("update_profile", { uid }),
  selectProfile: (uid: string) => invoke<void>("select_profile", { uid }),
  deleteProfile: (uid: string) => invoke<void>("delete_profile", { uid }),
  renameProfile: (uid: string, name: string) => invoke<void>("rename_profile", { uid, name }),

  getProxies: () => invoke<ProxiesResponse>("get_proxies"),
  selectNode: (group: string, node: string) => invoke<void>("select_node", { group, node }),
  testNode: (node: string) => invoke<number>("test_node", { node }),
  testGroup: (group: string) => invoke<Record<string, number>>("test_group", { group }),

  getRules: () => invoke<{ rules: Rule[] }>("get_rules"),
  getConnections: () => invoke<ConnectionsResponse>("get_connections"),
  closeConnection: (id: string) => invoke<void>("close_connection", { id }),
  closeAllConnections: () => invoke<void>("close_all_connections"),
  openConfigDir: () => invoke<void>("open_config_dir"),
};
