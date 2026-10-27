/* =========================================================================
   GLOWCAST v2 · 地图取数编排（口径与V1 _p6.js loadMapData 一致）
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
import { API_AQ } from "./scoring";
import { cityTz, rememberTz } from "./tz";
import { t } from "./i18n";

export const MODEL_NAME = { gfs: "gfs_seamless", ec: "ecmwf_ifs025" };
export const F_MAP_VARS = [
  "temperature_2m", "dew_point_2m", "relative_humidity_2m",
  "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "visibility",
  "pressure_msl", "boundary_layer_height", "freezing_level_height"
];

const JGET_TIMEOUT_MS = 12000;

/* 重试策略（2026-10 额度审计后收紧）
   旧行为：无论什么错都重试 3 次。429 被限流时这么打，等于把请求量再放大 3 倍
   —— 这正是「额度掉得比预期快」最隐蔽的一处来源；超时也照样连打 12s × 3。
   新行为：
   · 429 —— 不重试。服务端已明确拒绝，限流期间再打只会更糟。
   · 有 retry-after 的错误 —— 按服务端建议等，但超过 3s 就直接报错交上层。
   · 超时 / 网络错误 / 5xx —— 最多再补 1 次。
   最坏请求数：普通错误 2 次（旧 3 次），限流 1 次（旧 3 次）。 */
const JGET_RETRY_MAX = 1;
const RETRY_AFTER_CAP_MS = 3000;

export class MapFetchError extends Error {
  friendly?: string;
  fatal?: boolean;
  status?: number;
  timeout?: boolean;
  retryAfter?: number;
}

async function jget(url: string): Promise<unknown> {
  let lastErr: MapFetchError | null = null;
  for (let i = 0; i <= JGET_RETRY_MAX; i++) {
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
      if (i < JGET_RETRY_MAX) {
        /* 服务端给了 retry-after 就听它的；等太久（>3s）不如直接报错让用户重试 */
        const wait = lastErr?.retryAfter ?? 400 * (i + 1);
        if (wait > RETRY_AFTER_CAP_MS) throw lastErr;
        await sleep(wait);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new MapFetchError("network");
}

type Pt = { lat: number; lon: number };

function batchUrl(
  model: string | null, pts: Pt[], startD: string, endD: string, tz: string, vars: string
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
  return "https://api.open-meteo.com/v1/forecast?" + p.toString();
}

/** 多点批量取数：单请求多坐标（Open-Meteo 逗号多点），>30 点分批，批间留白 */
async function batched(
  model: string | null, pts: Pt[], startD: string, endD: string, tz: string, vars: string
): Promise<unknown[]> {
  const out: unknown[] = [];
  const N = 30;
  for (let i = 0; i < pts.length; i += N) {
    const part = pts.slice(i, i + N);
    const j = await jget(batchUrl(model, part, startD, endD, tz, vars));
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
  const j = await batched(null, pts, startD, endD, tz, "aerosol_optical_depth");
  return j.map((x) => {
    const s = makeSeries(x as { hourly?: Record<string, unknown> });
    return s.raw["aerosol_optical_depth"] ? s : null;
  });
}
void API_AQ;

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
    if (!sA) notes.push("气溶胶（AOD）数据缺失，已按默认值 0.25 估算");
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

    mapCachePut(dateS, lat, lon, box, stillCurrent);
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
