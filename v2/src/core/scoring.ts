/* =========================================================================
   GLOWCAST v2 · 评分模型
   口径来源：V1 _p4.js —— buildEnv / scoreStat / scoreRay / 等级 / 可信度。
   阈值、权重、隶属函数逐点对齐，禁止调整。
   ========================================================================= */
import {
  clamp, isNum, nz, trap, logistic, wgeo, RAD
} from "./math";
import {
  aerosolScaleHeight, equivGroundHeight, fireGeometry, rayTraceColor,
  brightnessLevel, CHROMA_REF, cloudDecks,
  type Deck, type FireGeom, type RayColor, type BrightLevel
} from "./physics";

export const API_FORECAST = "https://api.open-meteo.com/v1/forecast";
export const API_AQ = "https://air-quality-api.open-meteo.com/v1/air-quality";
export const API_TZ = "auto";

/* ---------- 环境场 ---------- */
export interface Env {
  tMs: number;
  T: number | null; Td: number | null; RH: number | null;
  cTot: number | null; cLow: number | null; cMid: number | null; cHigh: number | null;
  vis: number | null; P: number | null; Pmsl: number | null;
  ws: number | null; wd: number | null; gust: number | null;
  fz: number | null; blh: number | null;
  precip: number | null; cape: number | null; sw: number | null;
  /** 小时降水概率（%）—— 只有参考模型（refmodel）用，主口径不读它 */
  pp?: number | null;
  aod?: number | null;
  missing: string[];
  [k: string]: unknown;
}

export interface SeriesReader {
  at(key: string, ms: number): number | null;
}

export function buildEnv(
  sr: SeriesReader | null, tMs: number, extra?: Partial<Env>
): Env {
  const missing: string[] = [];
  const g = (key: string, opt?: boolean): number | null => {
    const v = sr ? sr.at(key, tMs) : null;
    if (!isNum(v)) { if (!opt) missing.push(key); return null; }
    return v;
  };
  const env: Env = {
    tMs,
    T: g("temperature_2m"), Td: g("dew_point_2m"), RH: g("relative_humidity_2m"),
    cTot: g("cloud_cover", true), cLow: g("cloud_cover_low"),
    cMid: g("cloud_cover_mid"), cHigh: g("cloud_cover_high"),
    vis: g("visibility"), P: g("surface_pressure", true),
    Pmsl: g("pressure_msl"),
    ws: g("wind_speed_10m"), wd: g("wind_direction_10m"),
    gust: g("wind_gusts_10m", true),
    fz: g("freezing_level_height"), blh: g("boundary_layer_height"),
    precip: g("precipitation", true), cape: g("cape", true),
    sw: g("shortwave_radiation", true),
    pp: g("precipitation_probability", true),
    missing
  };
  if (isNum(env.T) && !isNum(env.Td)) {
    env.Td = env.T - (100 - clamp(nz(env.RH, 60), 1, 100)) / 5;
    missing.push("dew_point_2m");
  }
  if (isNum(env.RH)) env.RH = clamp(env.RH, 0, 100);
  if (isNum(env.vis)) env.vis = clamp(env.vis, 0, 200000);
  (["cTot", "cLow", "cMid", "cHigh"] as const).forEach((k) => {
    if (isNum(env[k])) env[k] = clamp(env[k] as number, 0, 100);
  });
  if (extra) Object.assign(env, extra);
  return env;
}

/* ---------- 统计判据模型 ---------- */
export const W_STAT = {
  cover: 0.2, type: 0.16, base: 0.12, geom: 0.16, aero: 0.12,
  vis: 0.08, hum: 0.05, stab: 0.06, block: 0.05
};

export interface ScoreCtx {
  v: number;       // 云边界移动速度 km/min
  omega: number;   // 太阳高度角变化率 deg/min
  dP: number | null;
  aod?: number | null;
}

export interface StatResult {
  P: number; Q: number;
  primary: Deck; decks: Deck[]; noCloud: boolean;
  hEff: number | null; Heq: number; Hs: number;
  aodUp: number | null; d: number | null;
  geom: FireGeom;
  f: Record<string, number | null>;
  s: number; missF: string[]; notes: string[];
}

function primaryDeck(env: Env) {
  const decks = cloudDecks(env);
  let primary: Deck | null = null;
  for (const d of decks) if (d.cover >= 20) primary = d;
  let noCloud = false;
  if (!primary) {
    primary = decks.reduce((a, b) => (b.cover > a.cover ? b : a));
    noCloud = true;
  }
  return { decks, primary: primary as Deck, noCloud };
}
/** 对外别名（地图评分路径用它取主云盘层名） */
export function primaryDeckOf(env: Env) {
  return primaryDeck(env);
}

/* ---------- 光路遮挡因子（0–1，1=完全通透；越小越挡光） ----------
   报告 §2.3 的「光源段」判据：本地云幕要被低角度阳光点亮，太阳来向上游
   不能有低云（对中/高云幕）与中云（对高云幕）挡着。
   抽成独立函数是为了让**地图的「遮挡层」与评分的 block 因子同源**——
   两处各写一遍迟早会漂移，而它们必须说的是同一件事。 */
export function blockFactor(
  level: number,
  upstreamLowMax: number | null | undefined,
  upstreamMidMax: number | null | undefined
): number {
  let block = 1;
  if (level > 0) {
    const lw = isNum(upstreamLowMax) ? (upstreamLowMax as number) : null;
    if (isNum(lw))
      block *= trap(lw, [[0, 1], [25, 0.95], [45, 0.72], [65, 0.4], [85, 0.18], [100, 0.1]]) ?? 1;
  }
  if (level > 1) {
    const md = isNum(upstreamMidMax) ? (upstreamMidMax as number) : null;
    if (isNum(md))
      block *= trap(md, [[0, 1], [30, 0.94], [55, 0.78], [80, 0.48], [95, 0.26]]) ?? 1;
  }
  return block;
}

export function scoreStat(
  env: Env,
  tr: {
    hasDeck: boolean; dFar?: number | null;
    upstreamAod?: number | null;
    upstreamLowMax?: number | null;
    upstreamMidMax?: number | null;
  },
  ctx: ScoreCtx
): StatResult {
  const notes: string[] = [];
  const pd = primaryDeck(env);
  const { decks, primary, noCloud } = pd;

  const Hs = aerosolScaleHeight(env.blh);
  const aodUp = isNum(tr.upstreamAod) ? tr.upstreamAod : nz(env.aod, NaN);
  const aodNum = isNum(aodUp) ? aodUp : null;
  const Heq = equivGroundHeight(aodNum, Hs);
  const hEff = isNum(primary.base) ? primary.base - Heq : null;
  const d = tr.hasDeck ? tr.dFar ?? null : null;
  const geom = fireGeometry(hEff, d, ctx.v, ctx.omega);

  const f: Record<string, number | null> = {};
  f.cover = trap(primary.cover, [[0, 0], [8, 0.12], [22, 0.62], [38, 1], [75, 1], [88, 0.5], [100, 0.22]]);
  f.type = primary.typeScore;
  f.base = trap(primary.base, [[0.1, 0.05], [0.6, 0.24], [1.2, 0.55], [2, 0.8], [3, 1], [9, 1], [13, 0.68]]);
  if (!tr.hasDeck) f.geom = 0.06;
  else if (!isNum(d)) f.geom = 0.2;
  else f.geom = trap(d / Math.max(geom.xMax, 1), [[0, 0.72], [0.12, 0.95], [0.55, 1], [0.9, 0.62], [1, 0.4], [1.5, 0.08], [3, 0.02]]);
  f.aero = isNum(aodNum)
    ? trap(aodNum, [[0, 1], [0.1, 1], [0.2, 0.88], [0.3, 0.72], [0.5, 0.52], [0.8, 0.26], [1.2, 0.12], [3, 0.03]])
    : null;
  f.vis = isNum(env.vis)
    ? trap(env.vis / 1000, [[0.4, 0.05], [2, 0.2], [5, 0.42], [10, 0.66], [20, 0.92], [30, 1], [80, 1]])
    : null;
  f.hum = isNum(env.RH)
    ? trap(env.RH, [[5, 0.7], [20, 0.92], [40, 1], [75, 1], [88, 0.78], [95, 0.45], [100, 0.3]])
    : null;
  let stab = isNum(ctx.dP)
    ? trap(ctx.dP, [[0, 1], [0.6, 1], [1.2, 0.8], [2.5, 0.52], [6, 0.3]])
    : null;
  if (stab != null) {
    if (isNum(env.cape) && env.cape > 1500) stab *= 0.78;
    if (isNum(env.precip) && env.precip > 1) stab *= 0.82;
  }
  f.stab = stab;
  /* 遮挡：有样带上游就用上游，没有就退回本地该层云量（与V1 `?? env.cLow` 同义） */
  f.block = blockFactor(
    primary.level,
    isNum(tr.upstreamLowMax) ? tr.upstreamLowMax : env.cLow,
    isNum(tr.upstreamMidMax) ? tr.upstreamMidMax : env.cMid
  );

  const missF: string[] = [];
  for (const k in W_STAT) if (f[k] == null) missF.push(k);
  const S = wgeo([
    [f.cover, W_STAT.cover], [f.type, W_STAT.type], [f.base, W_STAT.base],
    [f.geom, W_STAT.geom], [f.aero, W_STAT.aero], [f.vis, W_STAT.vis],
    [f.hum, W_STAT.hum], [f.stab, W_STAT.stab], [f.block, W_STAT.block]
  ]);
  let P = 100 * logistic(6.5 * (S - 0.62));
  if (noCloud) P = Math.min(P, 8);
  if (primary.cover < 12) P = Math.min(P, 22);
  P = clamp(P, 2, 97);

  const qCover = trap(primary.cover, [[0, 0], [15, 0.3], [35, 0.9], [55, 1], [75, 0.9], [90, 0.55], [100, 0.35]]);
  const qBase = trap(primary.base, [[0.2, 0.05], [1, 0.3], [2, 0.6], [3.5, 0.9], [6, 1], [10, 0.95], [13, 0.7]]);
  const qGeom = f.geom;
  const qDur = trap(geom.dur, [[0, 0.05], [1, 0.5], [3, 0.85], [6, 1], [20, 1]]);
  const qAero = f.aero == null ? 0.7 : f.aero;
  let Q = 100 * wgeo([
    [qCover, 0.24], [primary.typeScore, 0.2], [qBase, 0.16],
    [qGeom, 0.14], [qAero, 0.14], [qDur, 0.12]
  ]);
  if (noCloud) Q = Math.min(Q, 10);
  Q = clamp(Q, 0, 100);

  return {
    P, Q, primary, decks, noCloud, hEff, Heq, Hs,
    aodUp: aodNum, d, geom, f, s: S, missF, notes
  };
}

/* ---------- 光追算法 ---------- */
export interface RaySample extends RayColor {
  t: number; magDeg: number; th: number; invalid?: boolean;
}
export interface RayResult {
  P: number; Q: number;
  primary: Deck; decks: Deck[]; noCloud: boolean;
  Heq: number; Hs: number; aodUp: number;
  hEff: number; hRaw: number; noLight: boolean;
  d: number | null; geom: FireGeom;
  samples: RaySample[]; peak: RaySample; best: RaySample; last: RaySample;
  bright: BrightLevel; satScore: number; colorRich: number; hueSpread: number;
  geomF: number; coverF: number; aeroF: number; S: number;
  qColor: number; maxChroma: number; qDur: number;
}

export function scoreRay(
  env: Env,
  tr: { hasDeck: boolean; dFar?: number | null; upstreamAod?: number | null },
  ctx: ScoreCtx
): RayResult {
  const pd = primaryDeck(env);
  const { decks, primary } = pd;

  const Hs = aerosolScaleHeight(env.blh);
  const aodUp = isNum(tr.upstreamAod) ? tr.upstreamAod : nz(env.aod, 1.2);
  const Heq = equivGroundHeight(aodUp, Hs);
  const hRaw = primary.base - Heq;
  const hEff = Math.max(0.02, hRaw);
  const noLight = !isNum(hRaw) || hRaw <= 0.05;
  const d = tr.hasDeck ? tr.dFar ?? null : null;
  const geom = fireGeometry(hEff, d, ctx.v, ctx.omega);

  const samples: RaySample[] = [];
  if (geom.ok) {
    const ts = [0, 0.3, 0.55, 0.78, 1.0];
    for (const t of ts) {
      const mag = geom.thNear + t * (geom.thFar - geom.thNear);
      samples.push({
        t, magDeg: mag * RAD, th: -mag,
        ...rayTraceColor(primary.base, -mag, aodUp, Hs)
      });
    }
  } else {
    const mag = Math.min(geom.thFar || 0.02, Math.max(geom.thNear || 0, 0.0001));
    samples.push({
      t: 0, magDeg: mag * RAD, th: -mag, invalid: true,
      ...rayTraceColor(primary.base, -mag, aodUp, Hs)
    });
  }

  const peak = samples[0];
  const best = samples.reduce((a, b) => (b.sat > a.sat ? b : a), samples[0]);
  const last = samples[samples.length - 1];
  const bright = brightnessLevel(peak.T550);
  const satScore = clamp((peak.sat - 0.12) / 0.55, 0, 1) * 100;
  const hueSpread =
    Math.max(...samples.map((s) => s.hue)) - Math.min(...samples.map((s) => s.hue));
  const colorRich = clamp(hueSpread / 45, 0, 1) * 100;

  const coverF =
    trap(primary.cover, [[0, 0], [10, 0.16], [25, 0.6], [40, 0.92], [70, 1], [88, 0.55], [100, 0.26]]) ?? 0;
  let geomF: number;
  if (!tr.hasDeck) geomF = 0.05;
  else if (!isNum(d)) geomF = 0.2;
  else geomF = trap(d / Math.max(geom.xMax, 1), [[0, 0.7], [0.12, 0.95], [0.55, 1], [0.9, 0.6], [1, 0.38], [1.5, 0.07], [3, 0.02]]) ?? 0;
  const aeroF = isNum(aodUp)
    ? trap(aodUp, [[0, 1], [0.1, 1], [0.2, 0.9], [0.3, 0.75], [0.5, 0.55], [0.8, 0.28], [1.2, 0.12], [3, 0.03]]) ?? 0.7
    : 0.7;

  const S = 0.4 * geomF + 0.22 * (bright.score / 100) + 0.16 * (satScore / 100) + 0.1 * coverF + 0.12 * aeroF;
  let P = 100 * logistic(7 * (S - 0.46));
  if (pd.noCloud) P = Math.min(P, 8);
  if (primary.cover < 12) P = Math.min(P, 22);
  P = clamp(P, 2, 97);

  const qDur = trap(geom.dur, [[0, 0.06], [1, 0.5], [3, 0.85], [6, 1], [20, 1]]) ?? 0;
  const maxChroma = samples.reduce((a, b) => Math.max(a, b.chroma || 0), 0);
  const qColor = clamp(maxChroma / CHROMA_REF, 0, 1);
  let Q = 100 * wgeo([
    [bright.score / 100, 0.26],
    [qColor, 0.22],
    [aeroF, 0.2],
    [primary.typeScore, 0.16],
    [qDur, 0.08],
    [coverF, 0.08]
  ]);
  if (!geom.ok) Q = Math.min(Q, 55);
  if (noLight) { P = Math.min(P, 12); Q = Math.min(Q, 15); }
  if (pd.noCloud) Q = Math.min(Q, 10);
  Q = clamp(Q, 0, 99);

  return {
    P, Q, primary, decks, noCloud: pd.noCloud, Heq, Hs, aodUp,
    hEff, hRaw, noLight, d, geom,
    samples, peak, best, last,
    bright, satScore, colorRich, hueSpread,
    geomF, coverF, aeroF, S, qColor, maxChroma, qDur
  };
}

/* ---------- 等级与可信度 ---------- */
export interface QualityBand {
  key: string; min: number; max: number; color: string; dark: string;
}
export const QUALITY_BANDS: QualityBand[] = [
  { key: "优", min: 80, max: 100, color: "#178a52", dark: "#5fce97" },
  { key: "良", min: 65, max: 79, color: "#5f9a1b", dark: "#9ac765" },
  { key: "一般", min: 45, max: 64, color: "#c07a10", dark: "#e2b45e" },
  { key: "差", min: 0, max: 44, color: "#c0392b", dark: "#f2796a" }
];
export const QUALITY_LABEL: Record<string, string> = {
  "优": "优秀", "良": "良好", "一般": "一般", "差": "较差"
};
export function gradeOf(q: number | null | undefined): string {
  const v = isNum(q) ? q : 0;
  for (const b of QUALITY_BANDS) if (v >= b.min) return b.key;
  return QUALITY_BANDS[QUALITY_BANDS.length - 1].key;
}

export interface EnsBand {
  key: string; max: number; lv: string;
  color: string; bg: string; bd: string;
  dark: { color: string; bg: string; bd: string };
  txt: string; hint: string;
}
export const ENS_CONF_BANDS: EnsBand[] = [
  {
    key: "hi", max: 18, lv: "高",
    color: "#178a52", bg: "#e9f7ef", bd: "#bfe7d2",
    dark: { color: "#5fce97", bg: "#122a20", bd: "#1f4735" },
    txt: "三套算法结论接近", hint: "可信度较高，可直接据此安排。"
  },
  {
    key: "mid", max: 35, lv: "中",
    color: "#c07a10", bg: "#fdf3e3", bd: "#f2ddba",
    dark: { color: "#e2b45e", bg: "#2a2314", bd: "#463a1e" },
    txt: "三套算法存在一定分歧", hint: "分歧在可接受范围内，建议结合临近云图复核。"
  },
  {
    key: "lo", max: Infinity, lv: "低",
    color: "#c0392b", bg: "#fdeceb", bd: "#f5cdc9",
    dark: { color: "#f2796a", bg: "#2d1a18", bd: "#4d2a26" },
    txt: "三套算法分歧较大", hint: "请谨慎采信，临近日再确认一次。"
  }
];
export function ensConfOf(dv: number | null | undefined): EnsBand {
  if (!isNum(dv)) return ENS_CONF_BANDS[1];
  for (const b of ENS_CONF_BANDS) if (dv < b.max) return b;
  return ENS_CONF_BANDS[ENS_CONF_BANDS.length - 1];
}

export const W_ENS = { gfs: 0.3, ec: 0.34, rt: 0.36 };

/** 综合指数 I = 0.55P + 0.45Q（0–100）—— 与V1 _p4.js mixedIndex 逐字一致，
 *  也是地图「分歧」维度 divergeOf 的同一口径。 */
export function mixedIndex(P: number, Q: number): number {
  return clamp(0.55 * P + 0.45 * Q, 0, 100);
}
