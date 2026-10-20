/* =========================================================================
   GLOWCAST v3「追光航志」· 预报编排
   口径来源：原版 _p5.js computeAll 计算段 + _p4.js 评分入口 —— 逐语义移植：
     · 样带 = TRANSECT 17 点（0…400 km），沿该时段事件方位构造
     · 三路取数：GFS / ECMWF-IFS / 气溶胶（各自独立，EC 失败退化为两路）
     · 综合 = W_ENS 加权几何平均（wgeo）；分歧 = mixedIndex 极差（dvI）
     · 一致性 = clamp(100 − dvI×1.9)；可信度 = ensConfOf(dvI)
   V3 新能力（Top3 推荐 / 到场窗口 / 机会日历）只从本模块输出推导，不另立公式。
   ========================================================================= */
import {
  clamp, isNum, nz, ymd, destPoint, sunsetSpeedKmph
} from "./math";
import { sunEvents, sunAltRate, solarPosition, type SunEvents } from "./astro";
import {
  buildEnv, scoreStat, scoreRay, primaryDeck, ensConfOf, mixedIndex, gradeOf,
  W_ENS, cloudBlockOf, type Env, type StatResult, type RayResult, type EnsBand
} from "./scoring";
import { analyseTransect, type TransectPt, type TransectResult } from "./physics";
import {
  apiForecast, apiAQ, apiForecastBatched, apiAQBatched, makeSeries, mergeSeries,
  makeMockResponses, withBudget, API_TZ, type Series
} from "./api";
import {
  TRANSECT, MODEL_NAME, F_VARS, AQ_VARS,
  BUDGET_POINT, BUDGET_TRANSECT
} from "./consts";

export interface ModelRow {
  id: "gfs" | "ec" | "rt";
  label: string;
  P: number; Q: number; I: number;
}

export interface SkyCloudSlice { t: number; b: number }

export interface Computed {
  ok: true;
  dateStr: string;
  period: "am" | "pm";
  lat: number; lon: number; name: string;
  evName: string;
  evMs: number;
  evAz: number;
  events: SunEvents;
  leadH: number;
  omega: number;
  v: number;                 // 日落线速度 km/min（sunsetSpeedKmph 原始值）
  dP: number | null;
  envM: Env;
  envG: Env;
  sRT: RayResult;
  sG: StatResult;
  sE: StatResult | null;
  trM: TransectResult;
  models: ModelRow[];
  P: number; Q: number;
  grade: string;
  consist: number;
  dvI: number | null;
  spread: number | null;
  spreadQ: number | null;
  conf: EnsBand;
  factorRows: Array<[string, number, number]>;
  skyCloud: SkyCloudSlice[] | null;
  cld: number;               // 云量淡纹（低+中云合成遮挡）
  aod: number;
  dur: number;               // 火烧窗口时长（分钟，fireGeometry.dur 基线输出）
  notes: Array<[string, string]>;
  src: "live" | "mock";
}
export interface ComputedFail { ok: false; error: string }

export type PointBundle = {
  gfsD: Array<Record<string, unknown>>;
  ecD: Array<Record<string, unknown>> | null;
  aqD: Array<Record<string, unknown>> | null;
};

/** 沿事件方位的样带点（17 点） */
export function transectFor(
  lat: number, lon: number, dayMs: number, period: "am" | "pm"
): Array<{ lat: number; lon: number }> {
  const ev = sunEvents(dayMs, lat, lon);
  const tMs = (period === "am" ? ev.riseMs : ev.setMs) ?? dayMs + 12 * 3600000;
  const az = solarPosition(tMs, lat, lon).azimuth;
  return TRANSECT.map((d) => (d === 0 ? { lat, lon } : destPoint(lat, lon, az, d)));
}

/** 三路取数（17 点一次多坐标请求）—— 与原版 computeAll 的取数段同构 */
export async function fetchPointBundle(
  lat: number, lon: number, dateStr: string, period: "am" | "pm",
  onStep?: (txt: string) => void
): Promise<PointBundle> {
  const [Y, M, D] = dateStr.split("-").map(Number);
  const dayMs = Date.UTC(Y, M - 1, D);
  const pts = transectFor(lat, lon, dayMs, period);
  const sD = ymd(new Date(dayMs - 86400000));
  const eD = ymd(new Date(dayMs + 86400000));
  onStep?.("GFS");
  const gfsP = apiForecast(MODEL_NAME.gfs, pts, sD, eD, API_TZ, "sunrise,sunset");
  const ecP = apiForecast(MODEL_NAME.ec, pts, sD, eD, API_TZ).catch(() => null);
  const aqP = apiAQ(pts, sD, eD, API_TZ).catch(() => null);
  const [gfsD, ecD, aqD] = await Promise.all([gfsP, ecP, aqP]);
  return { gfsD, ecD, aqD };
}

/** 确定性 mock bundle（离线回落；三路齐全，接口同形） */
export function makeMockBundle(
  lat: number, lon: number, dateStr: string, period: "am" | "pm"
): PointBundle {
  const [Y, M, D] = dateStr.split("-").map(Number);
  const dayMs = Date.UTC(Y, M - 1, D);
  const pts = transectFor(lat, lon, dayMs, period);
  const sD = ymd(new Date(dayMs - 86400000));
  const gfsD = makeMockResponses(pts, sD, 3, F_VARS);
  const ecD = makeMockResponses(pts, sD, 3, F_VARS);
  const aqD = makeMockResponses(pts, sD, 3, AQ_VARS);
  return { gfsD, ecD, aqD };
}

/** 纯计算段：bundle → 结果（趋势注入与单点共用；与原版 computeAll 同口径） */
export function computeFromBundle(opts: {
  lat: number; lon: number; dateStr: string; period: "am" | "pm";
  name: string;
  bundle: PointBundle;
  pts?: Array<{ lat: number; lon: number }>;
  src?: "live" | "mock";
}): Computed | ComputedFail {
  const { lat, lon, dateStr, period, name } = opts;
  const [Y, M, D] = dateStr.split("-").map(Number);
  const dayMs = Date.UTC(Y, M - 1, D);
  const ev = sunEvents(dayMs, lat, lon);
  const fix = (m: number | null) => (m == null ? ev.noonMs + 12 * 3600000 : m);
  const evMs = period === "am" ? fix(ev.riseMs) : fix(ev.setMs);
  const evName = period === "am" ? "日出" : "日落";
  const evAz = solarPosition(evMs, lat, lon).azimuth;
  const omega = sunAltRate(evMs, lat, lon);
  const v = sunsetSpeedKmph(Math.abs(lat), new Date(dayMs));
  const notes: Array<[string, string]> = [];

  const { gfsD, ecD, aqD } = opts.bundle;
  if (!gfsD || !gfsD.length) return { ok: false, error: "GFS 数据缺失" };
  const serG = gfsD.map(makeSeries);
  const serE = ecD ? ecD.map(makeSeries) : null;
  const serA = aqD ? aqD.map(makeSeries) : null;

  const tMs = evMs;
  const envG = buildEnv(serG[0], tMs);
  let envE: Env | null = serE ? buildEnv(serE[0], tMs) : null;
  if (envE) {
    const fallbackFields: string[] = [];
    (["vis", "fz", "blh", "ws", "cape", "precip"] as const).forEach((k) => {
      const e = envE as unknown as Record<string, number | null>;
      const g = envG as unknown as Record<string, number | null>;
      if (!isNum(e[k]) && isNum(g[k])) { e[k] = g[k]; fallbackFields.push(k); }
    });
  }
  const aodMain = serA && serA[0] ? serA[0].at("aerosol_optical_depth", tMs) : null;
  const aodUse = isNum(aodMain) ? clamp(aodMain, 0.005, 5) : 0.25;
  (envG as unknown as Record<string, number>).aod = aodUse;
  if (envE) (envE as unknown as Record<string, number>).aod = aodUse;
  if (!isNum(aodMain)) notes.push(["warn", "未取到 AOD（气溶胶光学厚度），按 0.25 估算。"]);

  const pts = opts.pts || transectFor(lat, lon, dayMs, period);
  const mk = (serArr: Series[] | null): TransectPt[] =>
    TRANSECT.map((d, i) => ({
      d,
      cLow: serArr && serArr[i] ? serArr[i].at("cloud_cover_low", tMs) : null,
      cMid: serArr && serArr[i] ? serArr[i].at("cloud_cover_mid", tMs) : null,
      cHigh: serArr && serArr[i] ? serArr[i].at("cloud_cover_high", tMs) : null,
      vis: serArr && serArr[i] ? serArr[i].at("visibility", tMs) : null,
      rh: serArr && serArr[i] ? serArr[i].at("relative_humidity_2m", tMs) : null,
      aod: serA && serA[i] ? serA[i].at("aerosol_optical_depth", tMs) : null
    }));
  const trG = mk(serG);
  const trE = serE ? mk(serE) : null;

  const dP = null; // 压力趋势为展示层增强项，一期不参与评分（原版 ctx.dP 仅提示）
  const ctx = { v, omega, aod: aodUse, lat, lon, period, tMs, dP };

  const pdG = primaryDeck(envG);
  const aG = analyseTransect(trG, pdG.primary.key as "cLow" | "cMid" | "cHigh");
  const sG = scoreStat(envG, aG, ctx);

  let sE: StatResult | null = null;
  if (envE && trE) {
    const pdE = primaryDeck(envE);
    sE = scoreStat(envE, analyseTransect(trE, pdE.primary.key as "cLow" | "cMid" | "cHigh"), ctx);
  }

  /* 综合场（GFS/EC 逐时平均）→ 光追 */
  const envM = {} as unknown as Record<string, number | null | string[]>;
  (["T", "Td", "RH", "cTot", "cLow", "cMid", "cHigh", "vis", "P", "Pmsl", "ws", "wd", "gust", "fz", "blh", "precip", "cape", "aod"] as const)
    .forEach((k) => {
      const a = (envG as unknown as Record<string, number | null>)[k];
      const b = envE ? (envE as unknown as Record<string, number | null>)[k] : null;
      envM[k] = (isNum(a) && isNum(b)) ? ((a as number) + (b as number)) / 2 : (isNum(a) ? a : (isNum(b) ? b : null));
    });
  envM.tMs = tMs;
  envM.missing = envG.missing;
  const envMx = envM as unknown as Env;

  const trM: TransectPt[] = TRANSECT.map((d, i) => {
    const o: Record<string, number | null> = { d };
    (["cLow", "cMid", "cHigh", "vis", "rh", "aod"] as const).forEach((k) => {
      const a = (trG[i] as unknown as Record<string, number | null>)[k];
      const b = trE ? (trE[i] as unknown as Record<string, number | null>)[k] : null;
      o[k] = (isNum(a) && isNum(b)) ? ((a as number) + (b as number)) / 2 : (isNum(a) ? a : (isNum(b) ? b : null));
    });
    return o as unknown as TransectPt;
  });
  const pdM = primaryDeck(envMx);
  const aM = analyseTransect(trM, pdM.primary.key as "cLow" | "cMid" | "cHigh");
  const sRT = scoreRay(envMx, aM, ctx);

  /* 综合 = W_ENS 加权几何平均（原版口径） */
  const parts: Array<{ k: "gfs" | "ec" | "rt"; P: number; Q: number; w: number; I: number }> = [
    { k: "gfs", P: sG.P, Q: sG.Q, w: W_ENS.gfs, I: 0 }
  ];
  if (sE) parts.push({ k: "ec", P: sE.P, Q: sE.Q, w: W_ENS.ec, I: 0 });
  parts.push({ k: "rt", P: sRT.P, Q: sRT.Q, w: W_ENS.rt, I: 0 });
  const P = clamp(wgeoOf(parts.map((p) => [p.P, p.w] as [number, number])), 0, 100);
  const Q = clamp(wgeoOf(parts.map((p) => [p.Q, p.w] as [number, number])), 0, 100);
  parts.forEach((x) => { x.I = mixedIndex(x.P, x.Q); });
  const spanOf = (arr: number[]) => (arr.length >= 2 ? Math.max(...arr) - Math.min(...arr) : null);
  const spread = spanOf(parts.map((x) => x.P));
  const spreadQ = spanOf(parts.map((x) => x.Q));
  const dvI = spanOf(parts.map((x) => x.I));
  const consist = clamp(100 - nz(dvI, 0) * 1.9, 0, 100);
  const conf = ensConfOf(dvI);

  const leadH = (tMs - Date.now()) / 3600000;
  if (leadH > 120) notes.push(["warn", `预报时效约 ${Math.round(leadH)} 小时，远超 36 小时建议上限，结论仅供参考。`]);
  else if (leadH > 36) notes.push(["warn", `预报时效约 ${Math.round(leadH)} 小时，建议临近时再复核一次。`]);

  /* 天色带云量切片：事件前后各 2 小时、逐时遮挡层（低+中云） */
  const skyCloud: SkyCloudSlice[] | null = (() => {
    const out: SkyCloudSlice[] = [];
    for (let k = -2; k <= 2; k++) {
      const t = tMs + k * 3600000;
      const avg = (v: string) => {
        const a = serG[0] ? serG[0].at(v, t) : null;
        const b = serE && serE[0] ? serE[0].at(v, t) : null;
        return (isNum(a) && isNum(b)) ? ((a as number) + (b as number)) / 2 : (isNum(a) ? a : (isNum(b) ? b : null));
      };
      const lo = avg("cloud_cover_low"), mi = avg("cloud_cover_mid");
      if (!isNum(lo) && !isNum(mi)) continue;
      out.push({ t, b: clamp((isNum(lo) ? lo : 0) + (isNum(mi) ? mi : 0), 0, 100) });
    }
    return out.length ? out : null;
  })();

  const primary = sRT.primary;
  const factorRows: Array<[string, number, number]> = [
    ["cover", primary.cover, nz(sRT.coverF, 0)],
    ["base", primary.base, nz(sG.f.base, 0)],
    ["heq", sRT.Heq, 0.5],
    ["heff", sRT.hEff ?? 0, 0.5],
    ["dedge", nz(sRT.d, 0), nz(sRT.geomF, 0)],
    ["block", nz(sG.f.block, 1) * 100, nz(sG.f.block, 1)],
    ["aod", nz(sRT.aodUp, 0), nz(sRT.aeroF, 0)],
    ["vis", nz(envMx.vis, 0), nz(sG.f.vis, 0)],
    ["rh", nz(envMx.RH, 0), nz(sG.f.hum, 0)],
    ["wind", nz(v, 0), 0.5],
    ["cape", nz(envMx.cape, 0), 0.5]
  ];

  const models: ModelRow[] = parts.map((p) => ({
    id: p.k,
    label: p.k === "gfs" ? "GFS 统计" : p.k === "ec" ? "EC 统计" : "光追物理",
    P: p.P, Q: p.Q, I: p.I
  }));

  return {
    ok: true,
    dateStr, period, lat, lon, name,
    evName, evMs, evAz, events: ev,
    leadH, omega, v, dP,
    envM: envMx, envG,
    sRT, sG, sE, trM: aM,
    models, P, Q,
    grade: gradeOf(Q),
    consist, dvI, spread, spreadQ, conf,
    factorRows, skyCloud,
    cld: cloudBlockOf(envMx),
    aod: aodUse,
    dur: sRT.geom ? sRT.geom.dur : 0,
    notes,
    src: opts.src ?? "live"
  };
}

/* wgeo 本地实现（与 math.wgeo 同公式；避免与 scoring 的 FLOOR_F 耦合变动） */
function wgeoOf(items: Array<[number, number]>): number {
  let e = 0, s = 0;
  for (const [v, w] of items) {
    if (!isNum(v)) continue;
    s += w;
    e += w * Math.log(Math.max(v, 0.02));
  }
  return s > 0 ? Math.exp(e / s) : 0;
}

/** 单点主流程：取数（限时预算）→ 计算；失败走确定性 mock */
export async function runForecast(opts: {
  lat: number; lon: number; name: string;
  dateStr: string; period: "am" | "pm";
  useMock?: boolean;
  onStep?: (txt: string) => void;
}): Promise<Computed | ComputedFail> {
  let bundle: PointBundle;
  let src: "live" | "mock" = "live";
  try {
    if (opts.useMock) throw new Error("mock");
    bundle = await withBudget(
      fetchPointBundle(opts.lat, opts.lon, opts.dateStr, opts.period, opts.onStep),
      BUDGET_POINT
    );
  } catch {
    src = "mock";
    bundle = makeMockBundle(opts.lat, opts.lon, opts.dateStr, opts.period);
  }
  const r = computeFromBundle({ ...opts, bundle, src });
  return r;
}

export { BUDGET_TRANSECT };
