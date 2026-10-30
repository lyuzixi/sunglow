/* =========================================================================
   SUNGLOW v2 · 预报编排
   把「取数 → 样带 → 三套算法 → 综合」串成一次可渲染的结果。
   模型口径：GFS/EC 走统计判据模型（scoreStat，参数微扰制造分歧），
   光追走纯物理模型（scoreRay）。权重 W_ENS 与V1一致。
   ========================================================================= */
import { clamp, isNum, nz, destPoint, haversineKm, ymd, wgeo } from "./math";
import { sunEvents, sunAltRate, solarPosition, type SunEvents } from "./astro";
import {
  buildEnv, scoreStat, scoreRay, ensConfOf, mixedIndex, gradeOf,
  W_ENS, type Env, type StatResult, type RayResult, type EnsBand, type SeriesReader
} from "./scoring";
import { analyseTransect, type TransectPt } from "./physics";
import { facRowsOf, type FacRow } from "./factors";
import {
  fetchForecastBundle, makeMockBundle, makeReader, pressureTrend, alongComponent,
  withBudget
} from "./api";
import { MODEL_NAME, F_VARS, apiForecastBatched, apiAQBatched, TRANSECT } from "./mapload";
import { MAP_TZ } from "./mapdata";
import { makeSeries, mergeSeries, type Series } from "./series";
import { primaryDeckOf } from "./scoring";
import type { City } from "./city";
import {
  cityTz, rememberTz, wallIsoToReal, tzAt, type TzInfo
} from "./tz";

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
  /** 该结果所属城市时区 —— 页面上所有时刻都按它显示 */
  tz: TzInfo;
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
  factorRows: FacRow[];
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
    const offRaw = (item as { utc_offset_seconds?: number }).utc_offset_seconds;
    const off = isNum(offRaw) ? offRaw : 0;
    const times = ((hh.time || []) as string[]).map((s) => wallIsoToReal(String(s), off));
    const hourly: Record<string, Array<number | null>> = {};
    for (const v of vars.split(",")) {
      const a = hh[v];
      hourly[v] = Array.isArray(a)
        ? (a as unknown[]).map((x) => (isNum(x) ? x : null))
        : times.map(() => null);
    }
    return {
      lat: pts[i].lat, lon: pts[i].lon,
      reader: makeReader({ hourly, times, timezone: "", tzOffsetSec: off, source: "live" })
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
   17 个样带点 × 3 路（51 次加权调用）。TTL 6 小时，LRU 上限 12 条。
   ========================================================================= */
/* v3：单点取数改回 F_VARS（补回 wind/cape/precip）—— 旧缓存里这两项恒为空，一律作废 */
const POINT_CACHE_PREFIX = "SUNGLOW.v2.point.v3.";
/* 6 小时：GFS/EC 本身 6 小时一轮，3 小时的 TTL 等于有一半时间在重复取同一份数据 */
const POINT_CACHE_TTL = 6 * 3600000;
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
    /* 时区字段缺失 = 跨版本的旧结构，时刻不可信；偏移不是 15 分钟整数倍的
       是算坏的脏缓存，同样作废 */
    const z = o.tz as TzInfo | undefined;
    if (!z || typeof z.offsetSec !== "number") return null;
    if (Math.abs(z.offsetSec) > 14 * 3600 || z.offsetSec % 900 !== 0) return null;
    return o;
  } catch {
    return null;
  }
}

/** 缓存条目的年龄（毫秒）；没有可用条目返回 null。用于「缓存 · N 分钟前」提示。 */
export function pointCacheAge(
  lat: number, lon: number, dateStr: string, period: "am" | "pm"
): number | null {
  try {
    const s = localStorage.getItem(pointKeyOf(lat, lon, dateStr, period));
    if (!s) return null;
    const j = JSON.parse(s);
    if (!j || !isNum(j.ts)) return null;
    const age = Date.now() - j.ts;
    return age < 0 || age > POINT_CACHE_TTL ? null : age;
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
  /* 日期键（UTC 域，只用来算日序与缓存键）与太阳事件锚点（城市当地零点）分开：
     锚点必须落在城市当地的 0 点，sunEvents 的 24 小时搜索窗才一定包含当地正午。 */
  const dayMs = Date.UTC(Y, M - 1, D);
  const tz0 = cityTz(city.lat, city.lon);
  const dayAnchor = dayMs - tz0.offsetSec * 1000;
  let src: "live" | "mock" = "live";

  const events = sunEvents(dayAnchor, city.lat, city.lon);
  const evMs =
    (period === "am" ? events.riseMs : events.setMs) ?? dayAnchor + 12 * 3600000;
  const evName = period === "am" ? "日出" : "日落";
  const evAz = solarPosition(evMs, city.lat, city.lon).azimuth;
  const omega = sunAltRate(evMs, city.lat, city.lon);
  const leadH = (evMs - Date.now()) / 3600000;

  /* ---- 取数：沿样带 17 点 ×（GFS / EC / AQ）—— 与V1单点口径同构 ---- */
  const transectPts = TRANSECT.map((d) => {
    const p = d === 0 ? { lat: city.lat, lon: city.lon } : destPoint(city.lat, city.lon, evAz, d);
    return { lat: p.lat, lon: p.lon, d };
  });
  const ptsLL = transectPts.map((p) => ({ lat: p.lat, lon: p.lon }));

  let sG: (Series | null)[] = ptsLL.map(() => null);
  let sE: (Series | null)[] | null = null;
  let sA: (Series | null)[] | null = null;
  let tz: TzInfo = tz0;
  try {
    if (opts.useMock) throw new Error("mock");
    sG = await withBudget(
      apiForecastBatched(MODEL_NAME.gfs, ptsLL, dateStr, dateStr, MAP_TZ, F_VARS),
      12000
    ) as Series[];
    sE = await apiForecastBatched(
      MODEL_NAME.ec, ptsLL, dateStr, dateStr, MAP_TZ, F_VARS
    ).catch(() => null);
    sA = await apiAQBatched(ptsLL, dateStr, dateStr, MAP_TZ).catch(() => null);
  } catch {
    src = "mock";
    const bundle = makeMockBundle(city.lat, city.lon, 8);
    const rd = makeReader(bundle);
    sG = ptsLL.map(() => rd as unknown as Series);
    sE = null;
    sA = null;
    tz = { iana: null, offsetSec: bundle.tzOffsetSec, est: true };
  }
  /* 接口回来的时区是权威值：校准并记住（同一坐标下次开页就不用再估） */
  const tzLive = sG.find((x): x is Series => !!x)?.tz;
  if (src === "live" && tzLive && !tzLive.est) {
    tz = tzAt(tzLive, evMs);
    rememberTz(city.lat, city.lon, tz.iana, tz.offsetSec);
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
  /* aM 是合并样带的分析结果：block 因素的原始值（上游低云最大量）要从这里拿 */
  const aM = analyseTransect(trM, lv(primaryDeckOf(envM)));
  const sRT = scoreRay(envM, aM, ctx);
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

  /* 综合＝非空子集按 W_ENS 的加权几何平均（与V1 once() 一致） */
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

  /* 一致性＝100 − ΔI×1.9（V1同式）：斜率 1.9 是口径的一部分，缺了会把分歧大幅低估 */
  const consist = clamp(100 - (dvFinal ?? 0) * 1.9, 0, 100);

  /* 因素行（键, 原始值, 展示得分）—— 供快照与因素面板。
     原始值一律保留 null（缺数就是缺数，不许压成 0 —— 否则面板会把「无边界」
     画成 0 km）。展示曲线与富文本值的口径唯一来源是 core/factors.ts。 */
  const factorRows: FacRow[] = facRowsOf({
    type: sRT.primary.type, level: sRT.primary.level,
    base: sRT.primary.base, cover: sRT.primary.cover,
    Heq: isNum(sRT.Heq) ? sRT.Heq : null,
    Hs: isNum(sRT.Hs) ? sRT.Hs : null,
    hEff: isNum(sRT.hEff) ? sRT.hEff : null,
    d: isNum(sRT.d) ? sRT.d : null,
    xMax: isNum(sRT.geom.xMax) ? sRT.geom.xMax : null,
    geomOk: !!sRT.geom.ok,
    lowBlock: isNum(aM.upstreamLowMax) ? aM.upstreamLowMax
      : isNum(envM.cLow) ? envM.cLow : null,
    aod: isNum(sRT.aodUp) ? sRT.aodUp : null,
    vis: isNum(envM.vis) ? envM.vis : null,
    rh: isNum(envM.RH) ? envM.RH : null,
    dP: isNum(dP) ? dP : null,
    windComp: isNum(v) ? v : null,
    cape: isNum(envM.cape) ? envM.cape : null,
    precip: isNum(envM.precip) ? envM.precip : null,
    consist, dvI: dvFinal, spread, spreadQ
  });

  const out: ForecastResult = {
    ok: true,
    dateStr, period, city, tz,
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
