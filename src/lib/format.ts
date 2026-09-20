/** Bytes as a human number plus its unit, kept apart so the UI can style them. */
export function splitBytes(bytes: number): [string, string] {
  if (!Number.isFinite(bytes) || bytes <= 0) return ["0", "B"];
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exp);
  const digits = value >= 100 || exp === 0 ? 0 : value >= 10 ? 1 : 2;
  return [value.toFixed(digits), units[exp]];
}

export function formatBytes(bytes: number): string {
  const [value, unit] = splitBytes(bytes);
  return `${value} ${unit}`;
}

/** Per-second rate, e.g. `8.4 MB/s`. */
export function splitRate(bytesPerSecond: number): [string, string] {
  const [value, unit] = splitBytes(bytesPerSecond);
  return [value, `${unit}/s`];
}

/** `3 小时 12 分` — how long the core has been up. */
export function formatUptime(startedAt: number): string {
  if (!startedAt) return "未启动";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - startedAt);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}

/** `03:12:44` — the monospaced clock in the title bar. */
export function formatClock(startedAt: number): string {
  if (!startedAt) return "--:--:--";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - startedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
}

export function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return "长期有效";
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function daysLeft(unixSeconds: number): number | null {
  if (!unixSeconds) return null;
  return Math.ceil((unixSeconds * 1000 - Date.now()) / 86400000);
}

/** `2 小时前` — relative time for the last subscription update. */
export function formatAgo(unixSeconds: number): string {
  if (!unixSeconds) return "从未更新";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

export type DelayTone = "ok" | "mid" | "bad" | "none";

/** Green under 150 ms, amber under 300 ms, red beyond, grey when untested. */
export function delayTone(ms: number | undefined | null): DelayTone {
  if (ms === undefined || ms === null || ms <= 0) return "none";
  if (ms < 150) return "ok";
  if (ms < 300) return "mid";
  return "bad";
}

export function delayText(ms: number | undefined | null): string {
  if (ms === undefined || ms === null) return "--";
  if (ms <= 0) return "超时";
  return `${ms} ms`;
}

const REGIONS: { code: string; name: string; test: RegExp }[] = [
  { code: "HK", name: "香港", test: /香港|hong ?kong|\bhk\b|🇭🇰/i },
  { code: "TW", name: "台湾", test: /台湾|台灣|taiwan|\btw\b|🇹🇼/i },
  { code: "SG", name: "新加坡", test: /新加坡|狮城|singapore|\bsg\b|🇸🇬/i },
  { code: "JP", name: "日本", test: /日本|东京|東京|大阪|japan|\bjp\b|🇯🇵/i },
  { code: "KR", name: "韩国", test: /韩国|韓國|首尔|korea|\bkr\b|🇰🇷/i },
  { code: "US", name: "美国", test: /美国|美國|洛杉矶|圣何塞|西雅图|纽约|united states|\bus\b|🇺🇸/i },
  { code: "UK", name: "英国", test: /英国|伦敦|united kingdom|\buk\b|\bgb\b|🇬🇧/i },
  { code: "DE", name: "德国", test: /德国|法兰克福|germany|\bde\b|🇩🇪/i },
  { code: "FR", name: "法国", test: /法国|巴黎|france|\bfr\b|🇫🇷/i },
  { code: "NL", name: "荷兰", test: /荷兰|阿姆斯特丹|netherlands|\bnl\b|🇳🇱/i },
  { code: "RU", name: "俄罗斯", test: /俄罗斯|莫斯科|russia|\bru\b|🇷🇺/i },
  { code: "MY", name: "马来西亚", test: /马来|malaysia|\bmy\b|🇲🇾/i },
  { code: "TR", name: "土耳其", test: /土耳其|turkey|\btr\b|🇹🇷/i },
  { code: "AR", name: "阿根廷", test: /阿根廷|argentina|\bar\b|🇦🇷/i },
  { code: "IN", name: "印度", test: /印度|india|\bin\b|🇮🇳/i },
  { code: "AU", name: "澳大利亚", test: /澳大利亚|悉尼|australia|\bau\b|🇦🇺/i },
  { code: "CA", name: "加拿大", test: /加拿大|canada|\bca\b|🇨🇦/i },
];

/**
 * Group nodes by region from their names. Windows has no flag font, so the UI
 * shows a two-letter code instead of an emoji flag.
 */
export function regionOf(name: string): { code: string; name: string } {
  for (const region of REGIONS) {
    if (region.test.test(name)) return { code: region.code, name: region.name };
  }
  return { code: "··", name: "其他" };
}

/** `IEPL · 0.5x` — the small grey line under a node name. */
export function nodeMeta(name: string, type: string): string {
  const rate = name.match(/(\d+(?:\.\d+)?)\s*[xX×]/);
  const parts = [type];
  if (rate) parts.push(`${rate[1]}x`);
  return parts.join(" · ");
}
