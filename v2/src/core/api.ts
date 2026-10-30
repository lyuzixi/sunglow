/* =========================================================================
   SUNGLOW v2 · 数据层（Open-Meteo 直连 + 本地 mock）
   口径来源：V1 _p4.js API 参数与 jget 重试语义。
   地图代理占位符 __TMAP_SERVICE_HOST__ 保留（部署时由构建注入）。
   ========================================================================= */
import { API_FORECAST, API_AQ, API_TZ, type SeriesReader } from "./scoring";
import { isNum, clamp } from "./math";
import { wallIsoToReal, estimateOffsetSec } from "./tz";

/** 地图代理占位符 —— 产物不得含密钥；部署时替换 */
export const TMAP_SERVICE_HOST = "__TMAP_SERVICE_HOST__";

export interface HourlyPoint {
  ms: number;
  [k: string]: number | null;
}

export interface ForecastBundle {
  hourly: Record<string, Array<number | null>>;
  times: number[];
  timezone: string;
  tzOffsetSec: number;
  source: "live" | "mock";
}

const HOURLY_VARS = [
  "temperature_2m", "dew_point_2m", "relative_humidity_2m",
  "cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
  "visibility", "surface_pressure", "pressure_msl",
  "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m",
  "freezing_level_height", "boundary_layer_height",
  "precipitation", "cape", "shortwave_radiation"
];

const AQ_VARS = ["aod", "pm10", "pm2_5", "us_aqi"];

function buildUrl(lat: number, lon: number, days: number): string {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: HOURLY_VARS.join(","),
    forecast_days: String(clamp(days, 1, 16)),
    timezone: API_TZ
  });
  return API_FORECAST + "?" + p.toString();
}

function buildAqUrl(lat: number, lon: number, days: number): string {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: AQ_VARS.join(","),
    forecast_days: String(clamp(days, 1, 16)),
    timezone: API_TZ
  });
  return API_AQ + "?" + p.toString();
}

/* 重试次数与 mapload.ts 的 jget 保持同一口径：429 不重试，其它最多再补 1 次 */
async function jget(url: string, tries = 2, timeoutMs = 6000): Promise<unknown> {
  for (let k = 0; k < tries; k++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, { mode: "cors", signal: ac.signal });
      if (r.status === 429) {
        const e = new Error("rate-limited") as Error & { code: string };
        e.code = "429";
        throw e;
      }
      if (!r.ok) throw new Error("http " + r.status);
      return await r.json();
    } catch (e) {
      if ((e as { code?: string }).code === "429") throw e;
      if (k === tries - 1) throw e;
      await new Promise((r2) => setTimeout(r2, 400 * (k + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function parseHourly(
  j: unknown, key: string
): { hourly: Record<string, Array<number | null>>; times: number[]; tzOffsetSec: number } {
  void key;
  const d = j as {
    hourly?: Record<string, unknown>;
    utc_offset_seconds?: number;
  };
  const hh = d.hourly || {};
  const tzOffsetSec = isNum(d.utc_offset_seconds) ? d.utc_offset_seconds : 0;
  const timeArr = (hh.time || []) as string[];
  /* timezone=auto 下 time 列是城市当地墙钟 —— 用响应自己的偏移折回真实时间戳 */
  const times = timeArr.map((s) => wallIsoToReal(String(s), tzOffsetSec));
  const hourly: Record<string, Array<number | null>> = {};
  for (const v of HOURLY_VARS.concat(AQ_VARS)) {
    const arr = hh[v];
    hourly[v] = Array.isArray(arr)
      ? (arr as unknown[]).map((x) => (isNum(x) ? x : null))
      : times.map(() => null);
  }
  return { hourly, times, tzOffsetSec };
}

export function makeReader(
  bundle: ForecastBundle
): SeriesReader & { nearest(key: string, ms: number): number | null } {
  const { hourly, times } = bundle;
  return {
    at(key: string, ms: number): number | null {
      const arr = hourly[key];
      if (!arr || !arr.length) return null;
      // 小时序列：线性插值
      // times 是升序毫秒
      if (ms <= times[0]) return arr[0];
      if (ms >= times[times.length - 1]) return arr[arr.length - 1];
      let lo = 0, hi = times.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= ms) lo = mid; else hi = mid;
      }
      const t0 = times[lo], t1 = times[hi];
      const a = arr[lo], b = arr[hi];
      if (!isNum(a)) return isNum(b) ? b : null;
      if (!isNum(b)) return a;
      const f = t1 === t0 ? 0 : (ms - t0) / (t1 - t0);
      return a + (b - a) * f;
    },
    nearest(key: string, ms: number): number | null {
      const arr = hourly[key];
      if (!arr || !arr.length) return null;
      let best = 0, bd = Infinity;
      for (let i = 0; i < times.length; i++) {
        const d = Math.abs(times[i] - ms);
        if (d < bd) { bd = d; best = i; }
      }
      return arr[best];
    }
  };
}

/** 真实取数：预报 + 空气质量（AOD）。总量限时，失败即抛错交给上层走 mock。 */
export async function fetchForecastBundle(
  lat: number, lon: number, days = 7
): Promise<ForecastBundle> {
  const j = (await jget(buildUrl(lat, lon, days), 2, 5000)) as {
    hourly?: Record<string, unknown>; utc_offset_seconds?: number;
    timezone?: string;
  };
  const parsed = parseHourly(j, "forecast");
  let hourly = parsed.hourly;
  try {
    const jq = (await jget(buildAqUrl(lat, lon, days), 1, 3500)) as unknown;
    const pa = parseHourly(jq, "aq");
    hourly = { ...hourly, ...pa.hourly };
  } catch { /* AQ 可选 */ }
  return {
    hourly,
    times: parsed.times,
    timezone: (j && (j as { timezone?: string }).timezone) || API_TZ,
    tzOffsetSec: parsed.tzOffsetSec,
    source: "live"
  };
}

/** 给整段取数加总预算，超出即抛错（上层回落 mock） */
export function withBudget<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("fetch-budget")), ms)
    )
  ]);
}

/* =========================================================================
   本地 mock：无网络 / 演示模式。用确定性伪随机生成一套自洽的环境场。
   ========================================================================= */
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeMockBundle(lat: number, lon: number, days = 7): ForecastBundle {
  const rnd = mulberry32(Math.round(lat * 1000) ^ Math.round(lon * 1000));
  /* 对齐到城市当地整点，日变化相位才落在当地 14 时（mock 也要跟城市时区走） */
  const off = estimateOffsetSec(lat, lon);
  const start =
    Math.floor((Date.now() - 12 * 3600000 + off * 1000) / 3600000) * 3600000 - off * 1000;
  const n = days * 24;
  const times: number[] = [];
  const hourly: Record<string, Array<number | null>> = {};
  for (const v of HOURLY_VARS.concat(AQ_VARS)) hourly[v] = [];
  for (let i = 0; i < n; i++) {
    const ms = start + i * 3600000;
    times.push(ms);
    const hourOfDay = ((((ms + off * 1000) / 3600000) % 24) + 24) % 24;
    const diurnal = Math.sin(((hourOfDay - 14) / 24) * Math.PI * 2);
    const cl = clamp(30 + 45 * rnd() + 25 * diurnal, 0, 100);
    hourly["temperature_2m"].push(12 + 10 * diurnal + 4 * rnd());
    hourly["dew_point_2m"].push(6 + 8 * diurnal + 3 * rnd());
    hourly["relative_humidity_2m"].push(clamp(55 + 25 * rnd(), 10, 100));
    hourly["cloud_cover"].push(cl);
    hourly["cloud_cover_low"].push(clamp(cl * (0.3 + 0.5 * rnd()), 0, 100));
    hourly["cloud_cover_mid"].push(clamp(cl * (0.2 + 0.6 * rnd()), 0, 100));
    hourly["cloud_cover_high"].push(clamp(cl * (0.15 + 0.7 * rnd()), 0, 100));
    hourly["visibility"].push(clamp(8000 + 20000 * rnd(), 500, 40000));
    hourly["surface_pressure"].push(1008 + 8 * rnd());
    hourly["pressure_msl"].push(1012 + 8 * rnd());
    hourly["wind_speed_10m"].push(2 + 8 * rnd());
    hourly["wind_direction_10m"].push(360 * rnd());
    hourly["wind_gusts_10m"].push(5 + 12 * rnd());
    hourly["freezing_level_height"].push(2200 + 1200 * rnd());
    hourly["boundary_layer_height"].push(600 + 1400 * rnd());
    hourly["precipitation"].push(rnd() > 0.85 ? rnd() * 2 : 0);
    hourly["cape"].push(rnd() > 0.7 ? rnd() * 800 : 0);
    hourly["shortwave_radiation"].push(Math.max(0, 800 * diurnal * (1 - cl / 140)));
    hourly["aod"].push(0.05 + 0.35 * rnd());
    hourly["pm10"].push(10 + 60 * rnd());
    hourly["pm2_5"].push(5 + 40 * rnd());
    hourly["us_aqi"].push(20 + 80 * rnd());
  }
  return {
    hourly, times,
    timezone: "", tzOffsetSec: off, source: "mock"
  };
}

/** 气压稳定性：事件前后 1 小时变化率 */
export function pressureTrend(
  reader: SeriesReader | null, tMs: number
): number | null {
  if (!reader) return null;
  const a = reader.at("pressure_msl", tMs - 3600000);
  const b = reader.at("pressure_msl", tMs + 3600000);
  if (!isNum(a) || !isNum(b)) return null;
  return Math.abs(b - a) / 2;
}

/** 风向风速的方位分量 */
export function alongComponent(
  ws: number | null, wd: number | null, az: number | null
): number | null {
  if (!isNum(ws) || !isNum(wd) || !isNum(az)) return null;
  const d = Math.abs(((wd - az + 540) % 360) - 180);
  return Math.abs(ws * Math.cos((d * Math.PI) / 180));
}
