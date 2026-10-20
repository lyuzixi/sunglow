/* =========================================================================
   GLOWCAST v2 · 预报编排
   把「取数 → 样带 → 三套算法 → 综合」串成一次可渲染的结果。
   模型口径：GFS/EC 走统计判据模型（scoreStat，参数微扰制造分歧），
   光追走纯物理模型（scoreRay）。权重 W_ENS 与原版一致。
   ========================================================================= */
import { clamp, isNum, nz, destPoint, haversineKm, ymd, wgeo } from "./math";
import { sunEvents, sunAltRate, solarPosition, type SunEvents } from "./astro";
import {
  buildEnv, scoreStat, scoreRay, ensConfOf, mixedIndex, gradeOf,
  W_ENS, type Env, type StatResult, type RayResult, type EnsBand, type SeriesReader
} from "./scoring";
import { analyseTransect, type TransectPt } from "./physics";
import {
  fetchForecastBundle, makeMockBundle, makeReader, pressureTrend, alongComponent,
  withBudget
} from "./api";
import { MODEL_NAME, F_MAP_VARS, apiForecastBatched, apiAQBatched, TRANSECT } from "./mapload";
import { MAP_TZ } from "./mapdata";
import { makeSeries, mergeSeries, type Series } from "./series";
import { primaryDeckOf } from "./scoring";
import type { City } from "./city";

export interface ModelRow {
  id: "gfs" | "ec" | "rt";
  label: string;
  P: number;
  Q: number;
}

export interface ForecastResult {
  ok: true;
  dateStr: string;
  period: "am" | "pm";
  city: City;
  evName: string;
  evMs: number;
  evAz: number;
  events: SunEvents;
  leadH: number;
  omega: number;
  envM: Env;
  sRT: RayResult;
  sG: StatResult;
  sE: StatResult | null;
  models: ModelRow[];
  P: number;
  Q: number;
  grade: string;
  consist: number;
  dvI: number | null;
  spread: number | null;
  spreadQ: number | null;
  conf: EnsBand;
  factorRows: Array<[string, number, number]>;
  src: "live" | "mock" | "cache";
}
export interface ForecastFail { ok: false; error: string }

const MODEL_LABEL: Record<string, string> = {
  gfs: "GFS 统计", ec: "EC 统计", rt: "光追物理"
};

/** 沿日落/日落方位取样带（一次多点调用） */
async function fetchTransect(
  lat: number, lon: number, az: number, days: number
): Promise<Array<{ lat: number; lon: number; reader: ReturnType<typeof makeReader> }>> {
  const pts: Array<{ lat: number; lon: number }> = [{ lat, lon }];
  for (let k = 1; k <= 8; k++) {
    const p = destPoint(lat, lon, az, k * 25);
    pts.push(p);
  }
  const lats = pts.map((p) => p.lat.toFixed(4)).join(",");
  const lons = pts.map((p) => p.lon.toFixed(4)).join(",");
  const vars = [
    "temperature_2m", "dew_point_2m", "cloud_cover_low",
    "cloud_cover_mid", "cloud_cover_high", "visibility",
    "boundary_layer_height", "pressure_msl"
  ].join(",");
  const url =
    "https://api.open-meteo.com/v1/forecast?latitude=" +
    lats + "&longitude=" + lons +
    "&hourly=" + vars + "&forecast_days=" + clamp(days, 1, 16) + "&timezone=auto";
  const j = (await (await fetch(url)).json()) as unknown;
  // 多点返回是数组
  const arr = Array.isArray(j) ? j : [j];
  return arr.map((item, i) => {
    const hh = (item as { hourly?: Record<string, unknown> }).hourly || {};
    const times = ((hh.time || []) as string[]).map((s) =>
      Date.parse(String(s).length === 16 ? s + ":00" : s)
    );
    const hourly: Record<string, Array<number | null>> = {};
    for (const v of vars.split(",")) {
      const a = hh[v];
      hourly[v] = Array.isArray(a)
        ? (a as unknown[]).map((x) => (isNum(x) ? x : null))
        : times.map(() => null);
    }
    return {
      lat: pts[i].lat, lon: pts[i].lon,
      reader: makeReader({ hourly, times, timezone: "auto", tzOffsetSec: 0, source: "live" })
    };
  });
}

function mockTransect(
  lat: number, lon: number, az: number,
  mainReader: ReturnType<typeof makeReader>, tMs: number
): TransectPt[] {
  const out: TransectPt[] = [];
  const baseCov = nz(mainReader.at("cloud_cover_mid", tMs), 40);
  for (let k = 0; k <= 8; k++) {
    const d = k * 25;
    const p = k === 0 ? { lat, lon } : destPoint(lat, lon, az, d);
    // 距离越远，云量平滑变化（确定性）
    const wob = Math.sin((k + lat + lon) * 0.7) * 18;
    out.push({
      d,
      cLow: clamp(nz(mainReader.at("cloud_cover_low", tMs), 20) - k * 2 + wob * 0.4, 0, 100),
      cMid: clamp(baseCov + wob, 0, 100),
      cHigh: clamp(nz(mainReader.at("cloud_cover_high", tMs), 30) + wob * 0.6, 0, 100),
      aod: 0.12 + 0.02 * k,
      vis: nz(mainReader.at("visibility", tMs), 20000)
    });
    void p;
  }
  return out;
}

/* =========================================================================
   单点取数缓存（B1 口径）：日期 + 时段 + 坐标（0.1°，约 11 km）
   —— 页面每次打开都会跑一次单点预报，没有这层缓存就等于每次开页都重取
   17 个样带点 × 3 路（≈50+ 加权调用）。TTL 3 小时，LRU 上限 12 条。
   ========================================================================= */
const POINT_CACHE_PREFIX = "glowcast.v2.point.v1.";
const POINT_CACHE_TTL = 3 * 3600000;
const POINT_CACHE_MAX = 12;

function pointKeyOf(lat: number, lon: number, dateStr: string, period: string): string {
  return POINT_CACHE_PREFIX + dateStr + "|" + period + "@" + lat.toFixed(1) + "," + lon.toFixed(1);
}

export function pointCacheGet(
  lat: number, lon: number, dateStr: string, period: "am" | "pm"
): ForecastResult | null {
  try {
    const s2 = localStorage.getItem(pointKeyOf(lat, lon, dateStr, period));
    if (!s2) return null;
    const j = JSON.parse(s2);
    if (!j || !j.obj || Date.now() - j.ts > POINT_CACHE_TTL) return null;
    const o = j.obj as ForecastResult;
    /* 结构校验：P/Q 必须是数、models 非空、日期时段对得上 —— 缺一项就当没缓存 */
    if (typeof o.P !== "number" || typeof o.Q !== "number") return null;
    if (!Array.isArray(o.models) || !o.models.length) return null;
    if (o.dateStr !== dateStr || o.period !== period) return null;
    return o;
  } catch {
    return null;
  }
}

export function pointCachePut(
  lat: number, lon: number, dateStr: string, period: "am" | "pm", obj: ForecastResult
): void {
  try {
    localStorage.setItem(pointKeyOf(lat, lon, dateStr, period), JSON.stringify({ ts: Date.now(), obj }));
    pointCacheSweep();
  } catch { /* 配额不足 / 隐私模式 */ }
}

/** LRU：同族键超过 POINT_CACHE_MAX 就淘汰最旧的 */
export function pointCacheSweep(): void {
  try {
    const keys: Array<{ k: string; ts: number }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(POINT_CACHE_PREFIX)) continue;
      let ts = 0;
      try { ts = (JSON.parse(localStorage.getItem(k) || "null") || {}).ts || 0; } catch { /* ignore */ }
      keys.push({ k, ts });
    }
    keys.sort((a, b) => b.ts - a.ts);
    for (let i = POINT_CACHE_MAX; i < keys.length; i++) localStorage.removeItem(keys[i].k);
  } catch { /* ignore */ }
}

export function pointCacheClear(): number {
  let n = 0;
  try {
    const del: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(POINT_CACHE_PREFIX)) del.push(k);
    }
    del.forEach((k) => { localStorage.removeItem(k); n++; });
  } catch { /* ignore */ }
  return n;
}

export async function runForecast(opts: {
  city: City;
  dateStr: string;
  period: "am" | "pm";
  useMock?: boolean;
  force?: boolean;
}): Promise<ForecastResult | ForecastFail> {
  const { city, dateStr, period } = opts;
  /* 命中缓存直接返回，一个请求都不发（显式重算传 force） */
  if (!opts.force && !opts.useMock) {
    const hit = pointCacheGet(city.lat, city.lon, dateStr, period);
    if (hit) return { ...hit, src: "cache" };
  }
  const [Y, M, D] = dateStr.split("-").map(Number);
  const dayMs = Date.UTC(Y, M - 1, D);
  let src: "live" | "mock" = "live";

  const events = sunEvents(dayMs, city.lat, city.lon);
  const evMs =
    (period === "am" ? events.riseMs : events.setMs) ?? dayMs + 12 * 3600000;
  const evName = period === "am" ? "日出" : "日落";
  const evAz = solarPosition(evMs, city.lat, city.lon).azimuth;
  const omega = sunAltRate(evMs, city.lat, city.lon);
  const leadH = (evMs - Date.now()) / 3600000;

  /* ---- 取数：沿样带 17 点 ×（GFS / EC / AQ）—— 与原版单点口径同构 ---- */
  const transectPts = TRANSECT.map((d) => {
    const p = d === 0 ? { lat: city.lat, lon: city.lon } : destPoint(city.lat, city.lon, evAz, d);
    return { lat: p.lat, lon: p.lon, d };
  });
  const ptsLL = transectPts.map((p) => ({ lat: p.lat, lon: p.lon }));

  let sG: (Series | null)[] = ptsLL.map(() => null);
  let sE: (Series | null)[] | null = null;
  let sA: (Series | null)[] | null = null;
  try {
    if (opts.useMock) throw new Error("mock");
    sG = await withBudget(
      apiForecastBatched(MODEL_NAME.gfs, ptsLL, dateStr, dateStr, MAP_TZ, F_MAP_VARS),
      12000
    ) as Series[];
    sE = await apiForecastBatched(
      MODEL_NAME.ec, ptsLL, dateStr, dateStr, MAP_TZ, F_MAP_VARS
    ).catch(() => null);
    sA = await apiAQBatched(ptsLL, dateStr, dateStr, MAP_TZ).catch(() => null);
  } catch {
    src = "mock";
    const bundle = makeMockBundle(city.lat, city.lon, 8);
    const rd = makeReader(bundle);
    sG = ptsLL.map(() => rd as unknown as Series);
    sE = null;
    sA = null;
  }
  const sM: (Series | null)[] = sG.map((g, i) => mergeSeries(g, sE ? sE[i] : null));

  const aodRow = (sA && sA[0] ? sA[0].at("aerosol_optical_depth", evMs) : null);
  const aodUse = isNum(aodRow) ? clamp(aodRow, 0.005, 5) : 0.25;

  /* 样带：d=0 真实值，其余点按各自取数（17 点全真实）—— 各模型各建一条 */
  const trOf = (sers: (Series | null)[] | null) => {
    if (!sers) return null;
    return transectPts.map((tp, i) => ({
      d: tp.d,
      cLow: sers[i] ? sers[i]!.at("cloud_cover_low", evMs) : null,
      cMid: sers[i] ? sers[i]!.at("cloud_cover_mid", evMs) : null,
      cHigh: sers[i] ? sers[i]!.at("cloud_cover_high", evMs) : null,
      vis: sers[i] ? sers[i]!.at("visibility", evMs) : null,
      rh: null,
      aod: aodUse
    }));
  };
  const trG = trOf(sG), trE = trOf(sE), trM = trOf(sM);

  const envOf = (sers: (Series | null)[] | null) => {
    const env = buildEnv(sers && sers[0] ? sers[0] : null, evMs);
    env.aod = aodUse;
    return env;
  };
  const envG = envOf(sG), envE = sE ? envOf(sE) : null, envM = envOf(sM);
  if (envE)
    (["fz", "blh", "vis", "cape", "precip"] as const).forEach((k) => {
      if (!isNum(envE[k]) && isNum(envG[k])) envE[k] = envG[k];
    });

  const dP = pressureTrend((sG[0] as unknown as SeriesReader) ?? null, evMs);
  const ws = envM.ws, wd = envM.wd;
  const v = alongComponent(ws, wd, evAz);
  const vKmin = isNum(v) ? v / 60 : 1.5;
  const ctx = { v: vKmin, omega, dP, aod: aodUse };

  const lv = (o: { primary: { key: string } }) =>
    o.primary.key as "cLow" | "cMid" | "cHigh";
  const sRT = scoreRay(envM, analyseTransect(trM, lv(primaryDeckOf(envM))), ctx);
  const sGv = scoreStat(envG, analyseTransect(trG, lv(primaryDeckOf(envG))), ctx);
  const sEv = envE
    ? scoreStat(envE, analyseTransect(trE, lv(primaryDeckOf(envE))), ctx)
    : null;

  const rows: ModelRow[] = (
    [
      { id: "gfs", label: MODEL_LABEL.gfs, P: sGv.P, Q: sGv.Q },
      { id: "ec", label: MODEL_LABEL.ec, P: sEv ? sEv.P : NaN, Q: sEv ? sEv.Q : NaN },
      { id: "rt", label: MODEL_LABEL.rt, P: sRT.P, Q: sRT.Q }
    ] as ModelRow[]
  ).filter((r) => isNum(r.P));

  /* 综合＝非空子集按 W_ENS 的加权几何平均（与原版 once() 一致） */
  const parts: Array<[number, number]> = [[sGv.P, W_ENS.gfs]];
  if (sEv) parts.push([sEv.P, W_ENS.ec]);
  parts.push([sRT.P, W_ENS.rt]);
  const partsQ: Array<[number, number]> = [[sGv.Q, W_ENS.gfs]];
  if (sEv) partsQ.push([sEv.Q, W_ENS.ec]);
  partsQ.push([sRT.Q, W_ENS.rt]);
  const P = wgeo(parts);
  const Q = wgeo(partsQ);

  const idxs = rows.map((r) => mixedIndex(r.P, r.Q));
  const dvI = Math.max(...idxs) - Math.min(...idxs);
  const spread = Math.max(...rows.map((r) => r.P)) - Math.min(...rows.map((r) => r.P));
  const spreadQ = Math.max(...rows.map((r) => r.Q)) - Math.min(...rows.map((r) => r.Q));
  const validN = rows.filter((r) => isNum(r.P)).length;
  const dvFinal = validN >= 2 ? dvI : null;
  const conf = ensConfOf(dvFinal);

  const consist = clamp(100 - (dvFinal ?? 20), 0, 100);

  /* 因素行（键, 原始值, 得分）—— 供快照与因素面板 */
  const primary = sRT.primary;
  const factorRows: Array<[string, number, number]> = [
    ["cover", primary.cover, nz(sRT.coverF, 0)],
    ["base", primary.base, nz(sGv.f.base, 0)],
    ["heq", sRT.Heq, 0.5],
    ["heff", sRT.hEff, 0.5],
    ["dedge", nz(sRT.d, 0), nz(sRT.geomF, 0)],
    ["block", nz(sGv.f.block, 1) * 100, nz(sGv.f.block, 1)],
    ["aod", nz(sRT.aodUp, 0), nz(sRT.aeroF, 0)],
    ["vis", nz(envM.vis, 0), nz(sGv.f.vis, 0)],
    ["rh", nz(envM.RH, 0), nz(sGv.f.hum, 0)],
    ["stab", nz(dP, 0), nz(sGv.f.stab, 0)],
    ["wind", nz(v, 0), 0.5],
    ["cape", nz(envM.cape, 0), 0.5]
  ];

  const out: ForecastResult = {
    ok: true,
    dateStr, period, city,
    evName, evMs, evAz, events,
    leadH, omega,
    envM, sRT, sG: sGv, sE: sEv,
    models: rows,
    P, Q,
    grade: gradeOf(Q),
    consist,
    dvI: dvFinal,
    spread, spreadQ,
    conf,
    factorRows,
    src
  };
  /* 只有真实取数的结果才落缓存（mock 不写，避免"假数据被当成真预报"） */
  if (src === "live") pointCachePut(city.lat, city.lon, dateStr, period, out);
  return out;
}

export function gradeWord(g: string): string {
  return g;
}
export { ymd };
