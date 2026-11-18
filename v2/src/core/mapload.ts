/* =========================================================================
   SUNGLOW v2 · 地图取数编排（口径与V1 _p6.js loadMapData 一致）
   显式触发 / 缓存快路径 / cacheOnly 绝不取数 / 顺序请求组间留白 /
   429 两类分级文案 / 请求令牌收敛界面副作用。
   ========================================================================= */
import { clamp, isNum, sleep } from "./math";
import { makeSeries, mergeSeries, type Series } from "./series";
import {
  MAP_TZ, TRANSECT, buildPointMeta, scoreGridPoint, finalizeRefGap,
  mapCacheGet, mapCachePut,
  type GridPt, type MapDateBox, type MapPeriodBox, type MapPoint, type PointMeta
} from "./mapdata";
import { API_AQ, API_FORECAST } from "./scoring";
import { cityTz, rememberTz } from "./tz";
import { t } from "./i18n";

export const MODEL_NAME = { gfs: "gfs_seamless", ec: "ecmwf_ifs025" };
/* 地图批量采样用的字段集（**10 个**，仍落在计费下限档：
   计费权重 = max(1, 变量数/10) × max(1, 天数/14)，10 个变量仍是 1.0 而不是 1.1 以上，
   所以补上露点不花一分额度）。与单点侧 F_VARS 刻意分开 —— 不要合并成一份，
   否则 152~169 个坐标的权重从 1.0 涨到 1.4（见V1 _p4.js 的额度说明）。 */
export const F_MAP_VARS = [
  "temperature_2m", "dew_point_2m", "relative_humidity_2m",
  "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "visibility",
  "pressure_msl", "boundary_layer_height", "freezing_level_height"
];

/* 单点精细预报所需字段（只请求真正参与计算的量，减少载荷）。
   wind 两项喂 alongComponent → geom 与「云边界风速分量」；cape/precip 喂
   「对流活动」与 stab 的对流/降水折减。v2 迁移时误用了 F_MAP_VARS，这四项
   因此恒为空 —— 这里按V1 F_VARS 原样恢复。 */
export const F_VARS = [
  "temperature_2m", "dew_point_2m", "relative_humidity_2m",
  "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "visibility",
  "pressure_msl", "wind_speed_10m", "wind_direction_10m",
  "boundary_layer_height", "freezing_level_height",
  "precipitation", "cape"
];

/* 单次尝试上限：跨境 RTT 正常 350ms、17 点 14 变量的一批实测 1~4s（慢时 7s），
   10s 足够容纳"能通但慢"的正常请求；卡死的握手由它兜住，再交给下一次尝试。 */
const JGET_TIMEOUT_MS = 10000;

/* 重试策略（2026-11-19 多用户「取不到数」事件后第二次调整）
   为什么放宽：api.open-meteo.com 在国内只有一条 A 记录（OVH 机房，跨境 RTT ~350ms），
   会出现「TCP 连上了、TLS 握手卡住」的间歇黑障（实测凌晨可达数分钟，期间所有用户
   同时失败），也会出现整体连不上。旧策略只补 1 次、单次 12s，任何一次黑障就等于
   全站「这次没有取到数据」。
   现行行为：
   · 429 —— 不重试。服务端已明确拒绝，限流期间再打只会更糟（这条不能动）。
   · 其它 4xx —— 不重试：参数/额度类错误重试多少次都一样。
   · 超时 / 网络错误 / 5xx —— 最多 3 次尝试，退避 500ms / 1500ms（带抖动，避免
     多用户同拍重试把上游打更狠）。
   最坏请求数：普通错误 3 次，限流 / 4xx 1 次。 */
const JGET_ATTEMPTS = 3;
const JGET_BACKOFF_MS = [500, 1500];
const RETRY_AFTER_CAP_MS = 3000;

/* 退避抖动：±35%，同一秒内涌入的用户不会同时重启请求 */
function backoffMs(i: number): number {
  const base = JGET_BACKOFF_MS[Math.min(i, JGET_BACKOFF_MS.length - 1)];
  return Math.round(base * (0.65 + Math.random() * 0.7));
}

export class MapFetchError extends Error {
  friendly?: string;
  fatal?: boolean;
  status?: number;
  timeout?: boolean;
  retryAfter?: number;
}

async function jget(url: string): Promise<unknown> {
  let lastErr: MapFetchError | null = null;
  for (let i = 0; i < JGET_ATTEMPTS; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), JGET_TIMEOUT_MS);
    try {
      const r = await fetch(url, { mode: "cors", signal: ac.signal });
      if (r.ok) return await r.json();
      const err = new MapFetchError("HTTP " + r.status);
      err.status = r.status;
      const ra = parseInt(r.headers.get("retry-after") || "", 10);
      if (isNum(ra)) err.retryAfter = clamp(ra, 1, 20) * 1000;
      if (r.status === 429) {
        let body = "";
        try { body = await r.text(); } catch { /* ignore */ }
        if (/daily/i.test(body) && /limit|exceed|quota|rate/i.test(body)) {
          err.fatal = true;
          err.friendly =
            "今日气象数据额度已用尽。Open-Meteo 免费层按「出口 IP」计（每日 10,000 次 / 每小时 5,000 次），不是按账号 —— 若你在公司、学校或代理等共享网络下，很可能是同一出口 IP 的其他使用者消耗掉的。额度会在次日重置，之后即可恢复。";
        } else {
          err.friendly =
            "气象接口暂时限流（短时并发过高），约一分钟内会自动恢复。";
        }
      }
      throw err;
    } catch (e) {
      const err = e as MapFetchError;
      if (err && err.name === "AbortError") {
        const te = new MapFetchError("timeout");
        te.timeout = true;
        lastErr = te;
      } else {
        lastErr = err;
      }
      if (lastErr && lastErr.fatal) throw lastErr;
      /* 429 一律重试 —— 这里绝不能写反：限流时重复请求只会加长封禁 */
      if (lastErr && lastErr.status === 429) throw lastErr;
      /* 其它 4xx 是「请求本身不对」，重试没有意义（还会白烧额度） */
      if (lastErr && isNum(lastErr.status) && lastErr.status! >= 400 && lastErr.status! < 500) {
        throw lastErr;
      }
      if (i < JGET_ATTEMPTS - 1) {
        /* 服务端给了 retry-after 就听它的；等太久（>3s）不如直接报错让用户重试 */
        const wait = lastErr?.retryAfter ?? backoffMs(i);
        if (wait > RETRY_AFTER_CAP_MS) throw lastErr;
        await sleep(wait);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  /* 重试用尽：把"是超时/断网"说清楚，上层文案才能给对（旧版一律回落成
     「没有响应或网络中断」，用户没法判断是自己断网还是上游线路问题） */
  if (lastErr && !lastErr.friendly) {
    lastErr.friendly = lastErr.timeout
      ? `气象接口连接超时（连续 ${JGET_ATTEMPTS} 次尝试都卡在握手/响应）。这通常是上游线路短时不通，等一两分钟点「重新计算」即可。`
      : `气象取数连续 ${JGET_ATTEMPTS} 次失败（网络错误）。请检查网络后点「重新计算」。`;
  }
  throw lastErr || new MapFetchError("network");
}

type Pt = { lat: number; lon: number };

function batchUrl(
  model: string | null, pts: Pt[], startD: string, endD: string, tz: string, vars: string,
  /* 数据源基地址：默认预报接口；气溶胶必须走空气质量接口（预报接口不提供该字段） */
  base = API_FORECAST
): string {
  const p = new URLSearchParams({
    latitude: pts.map((x) => x.lat.toFixed(4)).join(","),
    longitude: pts.map((x) => x.lon.toFixed(4)).join(","),
    hourly: vars,
    start_date: startD,
    end_date: endD,
    timezone: tz
  });
  if (model) p.set("models", model);
  return base + "?" + p.toString();
}

/** 多点批量取数：单请求多坐标（Open-Meteo 逗号多点），>30 点分批，批间留白 */
async function batched(
  model: string | null, pts: Pt[], startD: string, endD: string, tz: string, vars: string,
  base = API_FORECAST
): Promise<unknown[]> {
  const out: unknown[] = [];
  const N = 30;
  for (let i = 0; i < pts.length; i += N) {
    const part = pts.slice(i, i + N);
    const j = await jget(batchUrl(model, part, startD, endD, tz, vars, base));
    out.push(...(Array.isArray(j) ? j : [j]));
    if (i + N < pts.length) await sleep(300);
  }
  return out;
}

export async function apiForecastBatched(
  model: string | null, pts: Pt[], startD: string, endD: string, tz: string, vars: string[]
): Promise<Series[]> {
  const j = await batched(model, pts, startD, endD, tz, vars.join(","));
  return j.map((x) => makeSeries(x as { hourly?: Record<string, unknown> }));
}

export async function apiAQBatched(
  pts: Pt[], startD: string, endD: string, tz: string
): Promise<(Series | null)[]> {
  /* aerosol_optical_depth 只在空气质量接口上提供；打到预报接口只会回 24 个空值 */
  const j = await batched(null, pts, startD, endD, tz, "aerosol_optical_depth", API_AQ);
  return j.map((x) => {
    const s = makeSeries(x as { hourly?: Record<string, unknown> });
    return s.raw["aerosol_optical_depth"] ? s : null;
  });
}

/* =========================================================================
   loadMapData：一次完整取数（121 点 × GFS/EC/AQ）→ am/pm 两时段点集
   ========================================================================= */
export interface LoadMapOpts {
  lat: number; lon: number;
  dateS: string;
  pts: GridPt[];
  force?: boolean;
  cacheOnly?: boolean;
  onProgress?: (txt: string) => void;
  stillCurrent: () => boolean;
}

export type LoadMapResult =
  | { ok: true; box: MapDateBox; fromCache: boolean }
  | { ok: false; reason: "cache-only" | "stale"; }
  | { ok: false; reason: "error"; message: string; fatal: boolean; retryable: boolean };

export async function loadMapData(
  opts: LoadMapOpts
): Promise<LoadMapResult> {
  const { lat, lon, dateS, pts, cacheOnly, onProgress, stillCurrent } = opts;
  const load = (t: string) => onProgress && onProgress(t);

  /* 快路径：缓存命中 */
  if (!opts.force) {
    const c = mapCacheGet(dateS, lat, lon);
    if (c && c.am && c.pm) return { ok: true, box: c, fromCache: true };
  }
  /* cacheOnly：只查缓存，绝不取数（快路径之后、网络之前 —— 硬保证） */
  if (cacheOnly) return { ok: false, reason: "cache-only" };

  load(t("正在取模式数据（周边 {n} 个网格点，朝/晚霞共用）…", { n: pts.length }));
  try {
    const [Y, M, D] = dateS.split("-").map(Number);
    /* 太阳事件锚在城市当地零点（不是 UTC 零点），24 小时搜索窗才一定含当地正午 */
    const dayMs = Date.UTC(Y, M - 1, D) - cityTz(lat, lon).offsetSec * 1000;
    const meta: PointMeta[] = buildPointMeta(dayMs, pts);
    const cityPts = pts.map((c) => ({ lat: c.lat, lon: c.lon }));

    load(t("正在取 GFS 模式数据…"));
    const sG = await apiForecastBatched(MODEL_NAME.gfs, cityPts, dateS, dateS, MAP_TZ, F_MAP_VARS);
    if (!stillCurrent()) return { ok: false, reason: "stale" };
    /* 接口回的时区是权威值，记住它 */
    const tzLive = sG.find((x): x is Series => !!x)?.tz;
    if (tzLive && !tzLive.est) rememberTz(lat, lon, tzLive.iana, tzLive.offsetSec);
    await sleep(300);
    if (!stillCurrent()) return { ok: false, reason: "stale" };

    load(t("正在取 ECMWF 模式数据…"));
    const eD2 = await apiForecastBatched(
      MODEL_NAME.ec, cityPts, dateS, dateS, MAP_TZ, F_MAP_VARS
    ).catch(() => null);
    if (!stillCurrent()) return { ok: false, reason: "stale" };
    await sleep(300);
    if (!stillCurrent()) return { ok: false, reason: "stale" };

    load(t("正在取气溶胶数据…"));
    const sA = await apiAQBatched(cityPts, dateS, dateS, MAP_TZ).catch(() => null);
    if (!stillCurrent()) return { ok: false, reason: "stale" };

    load(t("正在计算 {n} 个网格点…", { n: pts.length }));
    const sE = eD2 as (Series[] | null);
    const sM: (Series | null)[] = sG.map((g, i) => mergeSeries(g, sE ? sE[i] : null));

    const notes: string[] = [];
    if (!sE) notes.push("ECMWF-IFS 模式本次未能取到数据");
    if (!sA) notes.push("气溶胶数据缺失，颜色浓淡已按默认值估算");
    const note = notes.join("；");

    const box: MapDateBox = {
      am: { pts: [], dateS, period: "am", note },
      pm: { pts: [], dateS, period: "pm", note }
    };
    meta.forEach((m, ci) => {
      const pm = scoreGridPoint(ci, m.setMs, m.omS, m.azS, meta, sG, sE, sM, sA);
      const am = scoreGridPoint(ci, m.riseMs, m.omR, m.azR, meta, sG, sE, sM, sA);
      if (pm) box.pm.pts.push(pm);
      if (am) box.am.pts.push(am);
    });
    if (!stillCurrent()) return { ok: false, reason: "stale" };
    /* 分歧度要按「同一时段的全图分布」标准化后才成立，只能全部点算完再填 */
    finalizeRefGap(box.am.pts);
    finalizeRefGap(box.pm.pts);

    mapCachePut(dateS, lat, lon, box);
    return { ok: true, box, fromCache: false };
  } catch (e) {
    if (!stillCurrent()) return { ok: false, reason: "stale" };
    const err = e as MapFetchError;
    const message =
      err.friendly ||
      (err.timeout
        ? "气象接口响应超时，请检查网络后重试；若长期如此，可能是当前网络到接口的链路不稳定。"
        : err.status === 429
          ? "气象接口暂时限流（同一 IP 请求过于频繁），请稍候 1 分钟后重试。"
          : `地图数据获取失败（${err.message || "网络异常"}）。`);
    return {
      ok: false, reason: "error", message,
      fatal: !!err.fatal,
      retryable: !err.fatal
    };
  }
}

export type { MapPoint, MapPeriodBox, MapDateBox };
export { TRANSECT };
