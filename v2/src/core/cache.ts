/* =========================================================================
   GLOWCAST v2 · 取数缓存总览（设置面板用）
   只扫 localStorage 前缀，不依赖各业务模块，避免循环引用。
   三族：单点预报 / 观测场地图 / 十日趋势。校准记录不在其中（那是数据，不是缓存）。
   ========================================================================= */
const FAMILIES = {
  point: "glowcast.v2.point.",
  map: "glowcast.v2.map.",
  trend: "glowcast.v2.trend."
} as const;

export type CacheKind = keyof typeof FAMILIES;

export interface CacheStat {
  n: number;
  bytes: number;
  oldest: number | null;
}

export interface CacheReport {
  point: CacheStat;
  map: CacheStat;
  trend: CacheStat;
  totalBytes: number;
}

function statOf(prefix: string): CacheStat {
  let n = 0, bytes = 0, oldest: number | null = null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const v = localStorage.getItem(k) || "";
      n++;
      bytes += k.length + v.length;
      try {
        const ts = (JSON.parse(v) || {}).ts;
        if (typeof ts === "number" && (oldest == null || ts < oldest)) oldest = ts;
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return { n, bytes, oldest };
}

export function cacheReport(): CacheReport {
  const point = statOf(FAMILIES.point);
  const map = statOf(FAMILIES.map);
  const trend = statOf(FAMILIES.trend);
  return { point, map, trend, totalBytes: point.bytes + map.bytes + trend.bytes };
}

export function clearCache(kind: CacheKind | "all"): number {
  const prefixes =
    kind === "all" ? Object.values(FAMILIES) : [FAMILIES[kind]];
  let n = 0;
  try {
    const del: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && prefixes.some((p) => k.startsWith(p))) del.push(k);
    }
    del.forEach((k) => { localStorage.removeItem(k); n++; });
  } catch { /* ignore */ }
  return n;
}

export function fmtBytes(b: number): string {
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  return (b / 1024 / 1024).toFixed(1) + " MB";
}
