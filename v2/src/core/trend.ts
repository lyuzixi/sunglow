/* =========================================================================
   SUNGLOW v2 · 七日趋势取数（口径对齐V1 loadTrend/computeTrend）
   34 点（朝/晚样带各 17）× 多日三路（GFS/EC/AQ）→ 逐日 P/Q。
   缓存只存算好的 rows（原始响应太大，一条就撑爆 localStorage）。
   ========================================================================= */
import { isNum, clamp, ymd, sleep } from "./math";
import { sunEvents, sunAltRate, solarPosition } from "./astro";
import { destPoint } from "./math";
import {
  buildPointMeta, scoreGridPoint, TRANSECT, MAP_TZ,
  type GridPt
} from "./mapdata";
import {
  apiForecastBatched, apiAQBatched, MODEL_NAME, F_MAP_VARS
} from "./mapload";
import { makeSeries, mergeSeries, type Series } from "./series";
import { sunEvents as _se } from "./astro";
import { gradeOf } from "./scoring";
import { cityTz, rememberTz, type TzInfo } from "./tz";

void _se;

export const TREND_CACHE_PREFIX = "SUNGLOW.v2.trend.";
export const TREND_CACHE_TTL = 6 * 3600000;
export const TREND_N = 10;

export interface TrendRow {
  date: string;
  period: "am" | "pm";
  P: number;
  Q: number;
  grade: string;
}

export function trendKeyOf(day0: number, lat: number, lon: number): string {
  return TREND_CACHE_PREFIX + ymd(new Date(day0)) + "@" + lat.toFixed(1) + "," + lon.toFixed(1);
}

export function trendCacheGet(day0: number, lat: number, lon: number): TrendRow[] | null {
  try {
    const s = localStorage.getItem(trendKeyOf(day0, lat, lon));
    if (!s) return null;
    const j = JSON.parse(s);
    if (!j || !j.rows || Date.now() - j.ts > TREND_CACHE_TTL) return null;
    return j.rows as TrendRow[];
  } catch {
    return null;
  }
}
/** 缓存条目的年龄（毫秒）；没有可用条目返回 null */
export function trendCacheAge(day0: number, lat: number, lon: number): number | null {
  try {
    const s = localStorage.getItem(trendKeyOf(day0, lat, lon));
    if (!s) return null;
    const j = JSON.parse(s);
    if (!j || !j.rows || !j.ts) return null;
    const age = Date.now() - j.ts;
    return age < 0 || age > TREND_CACHE_TTL ? null : age;
  } catch {
    return null;
  }
}

export function trendCachePut(
  day0: number, lat: number, lon: number, rows: TrendRow[]
): void {
  try {
    localStorage.setItem(trendKeyOf(day0, lat, lon), JSON.stringify({ ts: Date.now(), rows }));
  } catch { /* 配额 */ }
}

/** 朝/晚样带点（TRANSECT 0…400 km，与单点同构） */
export function transectFor(
  lat: number, lon: number, dayMs: number, period: "am" | "pm"
): GridPt[] {
  const ev = sunEvents(dayMs, lat, lon);
  const evMs = (period === "am" ? ev.riseMs : ev.setMs) ?? dayMs + 12 * 3600000;
  const az = solarPosition(evMs, lat, lon).azimuth;
  return TRANSECT.map((d) => {
    const p = d === 0 ? { lat, lon } : destPoint(lat, lon, az, d);
    return { lat: p.lat, lon: p.lon, name: d === 0 ? "query" : "t" + d, prov: "" };
  });
}

export interface TrendLoadResult {
  ok: boolean;
  rows?: TrendRow[];
  message?: string;
  fatal?: boolean;
  /** true = 直接吃缓存，没发任何请求 */
  fromCache?: boolean;
  /** 缓存年龄（毫秒），仅 fromCache 时有意义 */
  ageMs?: number;
}

export async function loadTrend(opts: {
  lat: number; lon: number;
  dateStr: string;
  cacheOnly?: boolean;
  /** 跳过缓存直接重取（用户点「重新取数」时用） */
  force?: boolean;
  onProgress?: (txt: string) => void;
  stillCurrent: () => boolean;
}): Promise<TrendLoadResult> {
  const { lat, lon, dateStr, cacheOnly, onProgress, stillCurrent } = opts;
  const [Y, M, D] = dateStr.split("-").map(Number);
  /* day0 留在 UTC 域（日期字符串与缓存键都靠它）；太阳事件另用一个锚在
     城市当地零点的真实时刻，两个域不要混 */
  const day0 = Date.UTC(Y, M - 1, D);
  const tz0 = cityTz(lat, lon);
  const dayAnchor = day0 - tz0.offsetSec * 1000;

  if (!opts.force) {
    const hit = trendCacheGet(day0, lat, lon);
    if (hit) {
      return { ok: true, rows: hit, fromCache: true, ageMs: trendCacheAge(day0, lat, lon) ?? 0 };
    }
  }
  if (cacheOnly) return { ok: false };

  const ptsAM = transectFor(lat, lon, dayAnchor, "am");
  const ptsPM = transectFor(lat, lon, dayAnchor, "pm");
  const all = ptsAM.concat(ptsPM);
  const sD = dateStr;
  const eD = ymd(new Date(day0 + (TREND_N - 1) * 86400000));
  onProgress && onProgress(
    `正在取 ${TREND_N} 天数据（${all.length} 个坐标 × 3 路，朝/晚霞共用）…`
  );

  try {
    const [gD, eD2, aD] = await Promise.all([
      apiForecastBatched(MODEL_NAME.gfs, all, sD, eD, MAP_TZ, F_MAP_VARS),
      apiForecastBatched(MODEL_NAME.ec, all, sD, eD, MAP_TZ, F_MAP_VARS).catch(() => null),
      apiAQBatched(all, sD, eD, MAP_TZ).catch(() => null)
    ]);
    if (!stillCurrent()) return { ok: false };

    /* 接口回来的时区是权威值，记住它（下次开页默认日期就不用经度估算） */
    const tzLive = (gD as Series[]).find((x): x is Series => !!x)?.tz;
    if (tzLive && !tzLive.est) rememberTz(lat, lon, tzLive.iana, tzLive.offsetSec);

    const rows: TrendRow[] = [];
    for (let k = 0; k < TREND_N; k++) {
      const dayMs = dayAnchor + k * 86400000;
      const dateS = ymd(new Date(day0 + k * 86400000));
      for (const period of (["am", "pm"] as const)) {
        const pts = period === "am" ? ptsAM : ptsPM;
        const off = period === "am" ? 0 : ptsAM.length;
        const meta = buildPointMeta(dayMs, pts);
        const m = meta[0];
        const evMs = period === "am" ? m.riseMs : m.setMs;
        const om = period === "am" ? m.omR : m.omS;
        const az = period === "am" ? m.azR : m.azS;
        /* 该时段的序列切片：all = ptsAM + ptsPM，各 17 点 */
        const sG = gD.slice(off, off + pts.length);
        const sE = eD2 ? (eD2 as Series[]).slice(off, off + pts.length) : null;
        const sA = aD ? (aD as (Series | null)[]).slice(off, off + pts.length) : null;
        const sM = sG.map((g, i) => mergeSeries(g, sE ? sE[i] : null));
        const pt = scoreGridPoint(0, evMs, om, az, meta, sG, sE, sM, sA);
        if (pt && isNum(pt.P) && isNum(pt.Q)) {
          rows.push({
            date: dateS,
            period,
            P: clamp(pt.P, 0, 100),
            Q: clamp(pt.Q, 0, 100),
            grade: gradeOf(pt.Q)
          });
        }
      }
    }
    if (!stillCurrent()) return { ok: false };
    if (rows.length) trendCachePut(day0, lat, lon, rows);
    return { ok: true, rows, fromCache: false };
  } catch (e) {
    const err = e as { friendly?: string; fatal?: boolean; timeout?: boolean; message?: string };
    return {
      ok: false,
      message: err.friendly || (err.timeout ? "气象接口响应超时，请检查网络后重试。" : `趋势数据获取失败：${err.message || "网络异常"}`),
      fatal: !!err.fatal
    };
  }
}

export { sleep, makeSeries };
