/* =========================================================================
   GLOWCAST v3「追光航志」· 趋势 / 机会日历数据
   口径来源：原版 _p5.js loadTrend / computeTrend —— 一次取 n 天（朝/晚样带
   共 34 坐标 × 3 路），逐日注入 computeFromBundle 算 P/Q，落盘只存算好的 rows
   （原始响应约 MB 级，缓存存它会立刻撑爆配额 —— 原版账目一致）。
   存储：glowcast.v3.trend.v1.{date}@{lat,lon}，TTL 3h，LRU 3 条。
   ========================================================================= */
import { ymd, isNum } from "./math";
import {
  apiForecast, apiAQ, makeMockResponses, API_TZ
} from "./api";
import {
  TRANSECT, MODEL_NAME, F_VARS, AQ_VARS,
  TREND_DAYS, TREND_CACHE_PREFIX, TREND_CACHE_FAMILY, TREND_CACHE_MAX, CACHE_TTL
} from "./consts";
import { computeFromBundle, transectFor, makeMockBundle, type PointBundle } from "./forecast";

export interface TrendCell { P: number; Q: number; grade: string; ec: boolean }
export interface TrendRow {
  date: string;
  am: TrendCell | null;
  pm: TrendCell | null;
}
export interface TrendData {
  lat: number; lon: number; day0: number; name: string;
  n: number; rows: TrendRow[]; ecOK: boolean; aqOK: boolean;
  src: "live" | "mock";
}

function trendKeyOf(lat: number, lon: number, dayMs: number): string {
  return TREND_CACHE_PREFIX + ymd(new Date(dayMs)) + "@" + lat.toFixed(1) + "," + lon.toFixed(1);
}
export function trendCacheGet(lat: number, lon: number, dayMs: number): TrendData | null {
  try {
    const s = localStorage.getItem(trendKeyOf(lat, lon, dayMs));
    if (!s) return null;
    const j = JSON.parse(s);
    if (!j || !j.obj || Date.now() - j.ts > CACHE_TTL) return null;
    const o = j.obj as TrendData;
    if (!o.rows || !o.rows.length) return null;
    return o;
  } catch { return null; }
}
export function trendCachePut(lat: number, lon: number, dayMs: number, obj: TrendData): void {
  try {
    localStorage.setItem(trendKeyOf(lat, lon, dayMs), JSON.stringify({ ts: Date.now(), obj }));
    trendSweep(lat, lon);
  } catch { /* ignore */ }
}
function trendSweep(lat: number, lon: number): void {
  const cur = "@" + lat.toFixed(1) + "," + lon.toFixed(1);
  try {
    const mine: string[] = [];
    const dead: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(TREND_CACHE_PREFIX)) continue;
      if (k.endsWith(cur)) mine.push(k); else dead.push(k);
    }
    dead.forEach((k) => localStorage.removeItem(k));
    if (mine.length > TREND_CACHE_MAX) {
      mine.sort();
      for (const k of mine.slice(0, mine.length - TREND_CACHE_MAX)) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}
export function dropStaleTrendFamily(): void {
  try {
    const dead: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(TREND_CACHE_FAMILY) && !k.startsWith(TREND_CACHE_PREFIX)) dead.push(k);
    }
    dead.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

const N = TRANSECT.length;

/** 取趋势（含快路径：缓存命中零请求；cacheOnly 只查缓存） */
export async function loadTrend(opts: {
  lat: number; lon: number; name: string;
  day0: number;
  cacheOnly?: boolean;
  useMock?: boolean;
  onStep?: (txt: string) => void;
}): Promise<TrendData | null> {
  const { lat, lon, name, day0 } = opts;
  const hit = trendCacheGet(lat, lon, day0);
  if (hit) return hit;
  if (opts.cacheOnly) return null;

  const ptsAM = transectFor(lat, lon, day0, "am");
  const ptsPM = transectFor(lat, lon, day0, "pm");
  const all = ptsAM.concat(ptsPM);
  const sD = ymd(new Date(day0));
  const maxIdx = Math.floor((Date.now() + 15 * 86400000 - day0) / 86400000) + 1;
  const nDay = Math.max(1, Math.min(TREND_DAYS, maxIdx));
  const eD = ymd(new Date(day0 + (nDay - 1) * 86400000));

  let gD: Array<Record<string, unknown>>;
  let eD2: Array<Record<string, unknown>> | null;
  let aD: Array<Record<string, unknown>> | null;
  let src: "live" | "mock" = "live";
  try {
    if (opts.useMock) throw new Error("mock");
    opts.onStep?.("GFS");
    const gP = apiForecast(MODEL_NAME.gfs, all, sD, eD, API_TZ);
    const eP = apiForecast(MODEL_NAME.ec, all, sD, eD, API_TZ).catch(() => null);
    const aP = apiAQ(all, sD, eD, API_TZ).catch(() => null);
    [gD, eD2, aD] = await Promise.all([gP, eP, aP]);
    opts.onStep?.("计算");
  } catch {
    src = "mock";
    gD = makeMockResponses(all, sD, nDay, F_VARS);
    eD2 = makeMockResponses(all, sD, nDay, F_VARS);
    aD = makeMockResponses(all, sD, nDay, AQ_VARS);
  }

  const cut = (arr: Array<Record<string, unknown>> | null, from: number) =>
    arr ? arr.slice(from, from + N) : null;
  const bundleOf = (per: "am" | "pm"): PointBundle => ({
    gfsD: cut(gD, per === "am" ? 0 : N) as Array<Record<string, unknown>>,
    ecD: cut(eD2, per === "am" ? 0 : N),
    aqD: cut(aD, per === "am" ? 0 : N)
  });

  const rows: TrendRow[] = [];
  for (let k = 0; k < nDay; k++) {
    const dMs = day0 + k * 86400000;
    const ds = ymd(new Date(dMs));
    const row: TrendRow = { date: ds, am: null, pm: null };
    for (const per of ["am", "pm"] as const) {
      try {
        const r = computeFromBundle({
          lat, lon, dateStr: ds, period: per, name,
          bundle: bundleOf(per),
          pts: per === "am" ? ptsAM : ptsPM,
          src
        });
        if (r.ok) {
          row[per] = { P: r.P, Q: r.Q, grade: r.grade, ec: !!r.sE };
        }
      } catch { /* 该格放弃 */ }
    }
    rows.push(row);
  }

  const data: TrendData = {
    lat, lon, day0, name, n: nDay, rows,
    ecOK: !!eD2, aqOK: !!aD, src
  };
  if (rows.some((r) => r.am || r.pm)) trendCachePut(lat, lon, day0, data);
  return data;
}

/** 离线直接出 mock 趋势（不发请求） */
export function mockTrend(lat: number, lon: number, name: string, day0: number): TrendData {
  void makeMockBundle;
  const rows: TrendRow[] = [];
  for (let k = 0; k < TREND_DAYS; k++) {
    const dMs = day0 + k * 86400000;
    const ds = ymd(new Date(dMs));
    const row: TrendRow = { date: ds, am: null, pm: null };
    for (const per of ["am", "pm"] as const) {
      const r = computeFromBundle({
        lat, lon, dateStr: ds, period: per, name,
        bundle: makeMockBundle(lat, lon, ds, per),
        src: "mock"
      });
      if (r.ok) row[per] = { P: r.P, Q: r.Q, grade: r.grade, ec: !!r.sE };
    }
    rows.push(row);
  }
  void isNum;
  return { lat, lon, day0, name, n: TREND_DAYS, rows, ecOK: true, aqOK: true, src: "mock" };
}
