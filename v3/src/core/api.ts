/* =========================================================================
   GLOWCAST v3「追光航志」· 数据层（Open-Meteo 直连 + 确定性 mock 回落）
   口径来源：原版 _p4.js（apiForecast / apiAQ / apiForecastBatched / seriesFrom /
   makeSeries / mergeSeries）逐语义移植。多坐标请求按坐标计费，顺序 + 组间留白。
   地图走画布航图，不需要 TMap 代理/密钥（与原版 TMap 路线的差异见 README）。
   ========================================================================= */
import { isNum, nz, clamp } from "./math";
import { F_VARS, F_MAP_VARS, AQ_VARS, MODEL_NAME } from "./consts";

export { F_VARS, F_MAP_VARS, AQ_VARS, MODEL_NAME };

export const API_FORECAST = "https://api.open-meteo.com/v1/forecast";
export const API_AQ = "https://air-quality-api.open-meteo.com/v1/air-quality";
export const API_TZ = "auto";

export interface Series {
  t: number[];
  h: Record<string, Array<number | null>>;
  at(key: string, ms: number): number | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** jget：3 次重试 + 单次超时；429 立即上抛（分类由上层做） */
async function jget(url: string, tries = 3, timeoutMs = 8000): Promise<unknown> {
  let last: unknown = null;
  for (let k = 0; k < tries; k++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, { mode: "cors", signal: ac.signal });
      if (r.status === 429) {
        const e = new Error("rate-limited") as Error & { status: number };
        e.status = 429;
        throw e;
      }
      if (!r.ok) throw new Error("http " + r.status);
      return await r.json();
    } catch (e) {
      last = e;
      if ((e as { status?: number }).status === 429) throw e;
      if (k === tries - 1) throw e;
      await sleep(400 * (k + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

function qs(p: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams();
  for (const k of Object.keys(p)) {
    if (p[k] !== undefined && p[k] !== null) u.set(k, String(p[k]));
  }
  return u.toString();
}

function firstValid(arr: Array<number | null>, idx: number, dir: number): number | null {
  for (let i = idx; i >= 0 && i < arr.length; i += dir) if (isNum(arr[i])) return arr[i] as number;
  return null;
}

/** 逐时序列（按真实时间线性插值）—— 原版 seriesFrom 逐语义 */
export function seriesFrom(
  t: number[], h: Record<string, Array<number | null>>
): Series {
  return {
    t, h,
    at(key, ms) {
      const arr = h[key];
      if (!arr || !t.length) return null;
      if (ms <= t[0]) return firstValid(arr, 0, 1);
      const n = t.length;
      if (ms >= t[n - 1]) return firstValid(arr, n - 1, -1);
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= ms) lo = m; else hi = m; }
      const a = arr[lo], b = arr[hi];
      if (isNum(a) && isNum(b)) {
        const f = (ms - t[lo]) / (t[hi] - t[lo]);
        return a + (b - a) * f;
      }
      return isNum(a) ? a : (isNum(b) ? b : null);
    }
  };
}

/** API 一条响应 → Series（utc_offset_seconds 对齐本地墙钟） */
export function makeSeries(data: {
  utc_offset_seconds?: number;
  hourly?: Record<string, unknown>;
}): Series {
  const off = nz(data.utc_offset_seconds, 0) * 1000;
  const hh = data.hourly || {};
  const t = ((hh.time || []) as string[]).map((s) => Date.parse(s + "Z") - off);
  const h: Record<string, Array<number | null>> = {};
  for (const k of Object.keys(hh)) {
    const arr = hh[k];
    h[k] = Array.isArray(arr)
      ? (arr as unknown[]).map((x) => (isNum(x) ? x : null))
      : t.map(() => null);
  }
  return seriesFrom(t, h);
}

/** 两套模式逐时平均（综合场，光追/地图综合用）—— 原版 mergeSeries 逐语义 */
export function mergeSeries(a: Series | null, b: Series | null): Series | null {
  if (!a) return b;
  if (!b) return a;
  const keys: Record<string, number> = {};
  Object.keys(a.h).forEach((k) => { keys[k] = 1; });
  Object.keys(b.h).forEach((k) => { keys[k] = 1; });
  const h: Record<string, Array<number | null>> = {};
  Object.keys(keys).forEach((k) => {
    const A = a.h[k], B = b.h[k];
    if (k === "time" || !A) { h[k] = B || A; return; }
    if (!B) { h[k] = A; return; }
    h[k] = A.map((v, i) => (isNum(v) && isNum(B[i])) ? ((v as number) + (B[i] as number)) / 2 : (isNum(v) ? v : B[i]));
  });
  return seriesFrom(a.t, h);
}

interface Pt { lat: number; lon: number }

/** 通用多坐标数值预报请求（vars 可指定精简字段集）—— 原版 apiForecast */
export async function apiForecast(
  model: string, pts: Pt[], startD: string, endD: string, tz?: string,
  extraDaily?: string, vars?: string[]
): Promise<Array<Record<string, unknown>>> {
  const p = {
    latitude: pts.map((x) => x.lat.toFixed(4)).join(","),
    longitude: pts.map((x) => x.lon.toFixed(4)).join(","),
    hourly: (vars || F_VARS).join(","),
    start_date: startD, end_date: endD,
    timezone: tz || API_TZ,
    models: model
  } as Record<string, string | number | undefined>;
  if (extraDaily) p.daily = extraDaily;
  const d = await jget(API_FORECAST + "?" + qs(p));
  return Array.isArray(d) ? (d as Array<Record<string, unknown>>) : [d as Record<string, unknown>];
}

/** 空气质量（AOD 等）—— 原版 apiAQ */
export async function apiAQ(
  pts: Pt[], startD: string, endD: string, tz?: string
): Promise<Array<Record<string, unknown>>> {
  const p = {
    latitude: pts.map((x) => x.lat.toFixed(4)).join(","),
    longitude: pts.map((x) => x.lon.toFixed(4)).join(","),
    hourly: AQ_VARS.join(","),
    start_date: startD, end_date: endD,
    timezone: tz || API_TZ
  };
  const d = await jget(API_AQ + "?" + qs(p));
  return Array.isArray(d) ? (d as Array<Record<string, unknown>>) : [d as Record<string, unknown>];
}

/** 批量（按 240 点分批，控制单次载荷与 URL 长度）—— 原版 apiForecastBatched */
export async function apiForecastBatched(
  model: string, pts: Pt[], startD: string, endD: string, tz: string | undefined, vars?: string[]
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < pts.length; i += 240) {
    const chunk = pts.slice(i, i + 240);
    const r = await apiForecast(model, chunk, startD, endD, tz, undefined, vars);
    out.push(...r);
    if (i + 240 < pts.length) await sleep(250);
  }
  return out;
}

export async function apiAQBatched(
  pts: Pt[], startD: string, endD: string, tz?: string
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < pts.length; i += 240) {
    const chunk = pts.slice(i, i + 240);
    const r = await apiAQ(chunk, startD, endD, tz);
    out.push(...r);
    if (i + 240 < pts.length) await sleep(250);
  }
  return out;
}

/** 总量限时：超时抛错（上层走 mock 回落） */
export function withBudget<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const e = new Error("timeout") as Error & { timeout: boolean };
      e.timeout = true;
      reject(e);
    }, ms);
    p.then((v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); });
  });
}

/* ---- 确定性 mock（离线/失败回落；界面标 MOCK） ---- */
function mockHourly(lat: number, lon: number, startD: string, days: number, vars: string[]) {
  const t0 = Date.parse(startD + "T00:00:00");
  const times: number[] = [];
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) times.push(t0 + d * 86400000 + h * 3600000);
  }
  const seed = Math.abs(Math.sin(lat * 12.9898 + lon * 78.233) * 43758.5453) % 1;
  const hourly: Record<string, Array<number | null>> = {};
  for (const v of vars) {
    hourly[v] = times.map((ms, i) => {
      const hr = (ms / 3600000) % 24;
      const wave = Math.sin((i / 24 + seed) * Math.PI * 2);
      switch (v) {
        case "temperature_2m": return 18 + 6 * Math.sin((hr - 14) / 24 * Math.PI * 2) + wave;
        case "dew_point_2m": return 12 + 4 * wave;
        case "relative_humidity_2m": return clamp(55 + 20 * wave, 10, 100);
        case "cloud_cover_low": return clamp(30 + 25 * wave, 0, 100);
        case "cloud_cover_mid": return clamp(38 + 30 * Math.sin((i / 18 + seed) * Math.PI * 2), 0, 100);
        case "cloud_cover_high": return clamp(42 + 28 * Math.cos((i / 20 + seed) * Math.PI * 2), 0, 100);
        case "visibility": return clamp(22000 - 8000 * wave, 2000, 40000);
        case "pressure_msl": return 1012 + 6 * wave;
        case "surface_pressure": return 1004 + 6 * wave;
        case "wind_speed_10m": return clamp(2.5 + 2 * wave, 0, 20);
        case "wind_direction_10m": return (220 + 60 * wave + 360) % 360;
        case "wind_gusts_10m": return clamp(5 + 3 * wave, 0, 30);
        case "boundary_layer_height": return clamp(1200 + 500 * wave, 200, 3000);
        case "freezing_level_height": return clamp(2800 + 400 * wave, 0, 6000);
        case "precipitation": return 0;
        case "cape": return clamp(200 + 150 * wave, 0, 2000);
        case "shortwave_radiation": return clamp(600 * Math.max(0, Math.sin((hr - 6) / 12 * Math.PI)), 0, 900);
        case "aerosol_optical_depth": return clamp(0.12 + 0.1 * Math.abs(wave), 0.01, 3);
        case "pm2_5": return clamp(18 + 12 * wave, 1, 200);
        case "pm10": return clamp(30 + 16 * wave, 1, 300);
        case "dust": return clamp(5 + 5 * wave, 0, 100);
        case "us_aqi": return clamp(50 + 20 * wave, 0, 200);
        default: return null;
      }
    });
  }
  return { hourly, times };
}

/** 单点/样带 mock 响应（与 API 同形，makeSeries 可直接吃） */
export function makeMockResponses(
  pts: Pt[], startD: string, days: number, vars: string[]
): Array<Record<string, unknown>> {
  return pts.map((p) => {
    const { hourly, times } = mockHourly(p.lat, p.lon, startD, days, vars);
    const hh: Record<string, unknown> = {
      time: times.map((ms) => new Date(ms).toISOString().slice(0, 16))
    };
    for (const v of vars) hh[v] = hourly[v];
    return { utc_offset_seconds: 0, hourly: hh };
  });
}
