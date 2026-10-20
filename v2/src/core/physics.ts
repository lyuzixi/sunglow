/* =========================================================================
   GLOWCAST v2 · 物理模型
   口径来源：原版 _p3.js —— 气溶胶垂直分布 / 光学等效地表高度 / 光路消光积分 /
   CIE 色度 / 云层与几何。函数体逐语义移植。
   ========================================================================= */
import {
  RE, DEG, RAD, RAY_OD550_V, H_RAY, ANGSTROM, K_TH,
  clamp, clamp01, lerp, isNum, nz
} from "./math";

/* ---- 气溶胶消光系数标高 ---- */
export function aerosolScaleHeight(blhM: number | null | undefined): number {
  const km = isNum(blhM) ? blhM / 1000 : 1.5;
  return clamp(km * 0.75, 0.6, 4.0);
}

/* ---- 光学等效地表高度 ---- */
export function equivGroundHeight(
  aod: number | null | undefined, HsKm: number, kth = K_TH
): number {
  if (!isNum(aod) || aod <= 0 || !isNum(HsKm) || HsKm <= 0) return 0;
  const z = HsKm * Math.log(aod / (HsKm * kth));
  return clamp(isFinite(z) ? z : 0, 0, 14);
}

function sigmaRayleigh0(lam: number): number {
  return (RAY_OD550_V / H_RAY) * Math.pow(550 / lam, 4);
}
function sigmaAerosol0(aod: number, Hs: number, lam: number): number {
  return (aod / Hs) * Math.pow(550 / lam, ANGSTROM);
}

function pathOpticalDepth(
  h: number, th: number, aod: number, Hs: number, lam: number
): number {
  const sR = sigmaRayleigh0(lam), sA = sigmaAerosol0(aod, Hs, lam);
  const t0 = Math.tan(th);
  const N = 420, XMAX = 1400, dx = XMAX / N;
  let tau = 0;
  for (let i = 0; i < N; i++) {
    const x = (i + 0.5) * dx;
    let z = h + x * t0 + (x * x) / (2 * RE);
    if (!(z > -50)) break;
    if (z > 110) break;
    if (z < 0) z = 0;
    const dzdx = t0 + x / RE;
    const dl = Math.sqrt(1 + dzdx * dzdx) * dx;
    tau += (sR * Math.exp(-z / H_RAY) + sA * Math.exp(-z / Hs)) * dl;
  }
  return tau;
}

/* ---- CIE 1931 色度函数（Wyman 多高斯解析近似） ---- */
function _g(x: number, mu: number, s1: number, s2: number): number {
  return x < mu
    ? Math.exp(-0.5 * Math.pow((x - mu) / s1, 2))
    : Math.exp(-0.5 * Math.pow((x - mu) / s2, 2));
}
const cmfX = (w: number) =>
  1.056 * _g(w, 599.8, 37.9, 31.0) +
  0.362 * _g(w, 442.0, 16.0, 26.7) -
  0.065 * _g(w, 501.1, 20.4, 26.2);
const cmfY = (w: number) =>
  0.821 * _g(w, 568.8, 46.9, 40.5) + 0.286 * _g(w, 530.9, 16.3, 31.1);
const cmfZ = (w: number) =>
  1.217 * _g(w, 437.0, 11.8, 36.0) + 0.681 * _g(w, 459.0, 26.0, 13.8);

function sunSpectrum(lam: number): number {
  const c1 = 3.7418e-16, c2 = 1.4388e-2, l = lam * 1e-9;
  return c1 / (Math.pow(l, 5) * (Math.exp(c2 / (l * 5778)) - 1));
}

export const DIFF_AMP = 0.06;
export const DIFF_PATH = 0.3;
export const WASH_A = 0.62;
export const LUM_REF = 0.06;
export const AOD_SKY = 0.55;
export const CHROMA_REF = 0.155;
const LUM_FULL = (() => {
  let s = 0;
  for (let lam = 400; lam <= 700; lam += 5) s += sunSpectrum(lam) * cmfY(lam);
  return s || 1;
})();

export interface RayColor {
  tau550: number; T550: number; lumRel: number; wash: number;
  rgb: [number, number, number]; hex: string;
  sat: number; hue: number; chroma: number; name: string;
}

export function rayTraceColor(
  h: number, th: number, aod: number, Hs: number
): RayColor {
  let X = 0, Y = 0, Z = 0, tau550 = 0, lumRaw = 0;
  for (let lam = 400; lam <= 700; lam += 5) {
    const tau = pathOpticalDepth(h, th, aod, Hs, lam);
    const T = Math.exp(-clamp(tau, 0, 60));
    const Tsky = Math.exp(-clamp(tau * DIFF_PATH, 0, 60));
    const S = sunSpectrum(lam);
    const w = S * (T + DIFF_AMP * Tsky);
    X += w * cmfX(lam); Y += w * cmfY(lam); Z += w * cmfZ(lam);
    lumRaw += w * cmfY(lam);
    if (lam === 550) tau550 = tau;
  }
  let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  let g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  let b = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  r = Math.max(0, r); g = Math.max(0, g); b = Math.max(0, b);
  const mx = Math.max(r, g, b) || 1e-12;
  let nr = r / mx, ng = g / mx, nb = b / mx;
  const lumRel = lumRaw / LUM_FULL;
  const skyRel = clamp01(aod / AOD_SKY);
  const dimness = clamp01(1 - lumRel / LUM_REF);
  const wash = clamp01(WASH_A * (0.3 + 0.7 * skyRel) * (0.2 + 0.8 * dimness));
  const gray = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
  nr = lerp(nr, gray, wash); ng = lerp(ng, gray, wash); nb = lerp(nb, gray, wash);
  const to255 = (v: number) => Math.round(255 * Math.pow(clamp(v, 0, 1), 1 / 2.2));
  const R = to255(nr), G = to255(ng), B = to255(nb);
  const hex = "#" + [R, G, B].map((v) => v.toString(16).padStart(2, "0")).join("");
  const mxx = Math.max(nr, ng, nb), mnn = Math.min(nr, ng, nb), dd = mxx - mnn;
  let hue = 0;
  if (dd > 1e-9) {
    if (mxx === nr) hue = 60 * (((ng - nb) / dd) % 6);
    else if (mxx === ng) hue = 60 * ((nb - nr) / dd + 2);
    else hue = 60 * ((nr - ng) / dd + 4);
  }
  if (hue < 0) hue += 360;
  const sat = mxx > 1e-9 ? dd / mxx : 0;
  const chroma = oklabChroma(nr, ng, nb);
  const T550 = Math.exp(-clamp(tau550, 0, 60));
  return {
    tau550, T550, lumRel, wash, rgb: [R, G, B], hex, sat, hue, chroma,
    name: colorName(hue, sat, T550)
  };
}

export function oklabChroma(r: number, g: number, b: number): number {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return Math.hypot(A, B);
}

export function colorName(hue: number, sat: number, T550: number): string {
  if (sat < 0.1) return T550 < 0.004 ? "灰暗无彩" : "灰白（大气浑浊）";
  if (hue < 12) return "深红 / 暗红";
  if (hue < 25) return "红";
  if (hue < 36) return "橘红";
  if (hue < 46) return "橙色";
  if (hue < 55) return "金黄 / 橘黄";
  if (hue < 68) return "淡黄";
  if (hue >= 320) return "粉紫";
  return "黄绿（少见）";
}

/* ---- 云层识别 ---- */
export interface Deck {
  key: string; level: number; name: string;
  base: number; cover: number;
  type: string; typeScore: number;
}
export const DECK_TYPE_SCORE: Record<string, number> = {
  "层云/雾": 0.12, "层积云": 0.58, "积云": 0.42,
  "高积云": 0.86, "高层云": 0.94, "卷层云": 1.0, "卷云": 0.95
};
function deckTypeName(level: number, h: number, cover: number): string {
  if (level === 0) {
    if (h < 0.35) return "层云/雾";
    if (h < 2.0) return "层积云";
    return "积云";
  }
  if (level === 1) return h < 4.2 ? "高积云" : "高层云";
  return cover >= 70 ? "卷层云" : "卷云";
}

export interface EnvLike {
  T?: number | null; Td?: number | null; fz?: number | null;
  cLow?: number | null; cMid?: number | null; cHigh?: number | null;
}

export function cloudDecks(env: EnvLike): Deck[] {
  const dT = isNum(env.T) && isNum(env.Td) ? Math.max(0, env.T - env.Td) : 3;
  const lcl = clamp(0.125 * dT, 0.03, 4.0);
  const fz = isNum(env.fz) ? clamp(env.fz / 1000, 0.2, 7.0) : null;
  const hLow = clamp(lcl, 0.03, 2.5);
  const hMid = fz != null ? clamp(0.55 * fz, 2.6, 6.0) : 3.6;
  const hHigh = fz != null ? clamp(1.65 * fz, 5.5, 12.0) : 8.5;
  const d: Deck[] = [
    { key: "cLow", level: 0, name: "低云", base: hLow, cover: nz(env.cLow, 0), type: "", typeScore: 0.5 },
    { key: "cMid", level: 1, name: "中云", base: hMid, cover: nz(env.cMid, 0), type: "", typeScore: 0.5 },
    { key: "cHigh", level: 2, name: "高云", base: hHigh, cover: nz(env.cHigh, 0), type: "", typeScore: 0.5 }
  ];
  d.forEach((x) => {
    x.type = deckTypeName(x.level, x.base, x.cover);
    x.typeScore = DECK_TYPE_SCORE[x.type] ?? 0.5;
  });
  return d;
}

/* ---- 沿样带的云边界分析 ---- */
export interface TransectPt {
  d: number; cLow?: number | null; cMid?: number | null; cHigh?: number | null;
  aod?: number | null; vis?: number | null;
}
export interface TransectResult {
  ok: boolean; reason?: string;
  dNear?: number | null; dFar?: number | null; openEnded?: boolean; hasDeck: boolean;
  upstreamAod?: number | null;
  upstreamLowMax?: number | null;
  upstreamMidMax?: number | null;
  upstreamVisMin?: number | null;
  deckIdx?: [number, number];
}

export function analyseTransect(
  transect: TransectPt[] | null | undefined, levelKey: "cLow" | "cMid" | "cHigh"
): TransectResult {
  if (!transect || !transect.length)
    return { ok: false, reason: "无样带数据", hasDeck: false };
  const cov = (i: number) => nz(transect[i][levelKey], 0);
  const TH = 25;
  const runs: Array<[number, number]> = [];
  let i = 0;
  while (i < transect.length) {
    if (cov(i) >= TH) {
      let j = i;
      while (j + 1 < transect.length && cov(j + 1) >= TH) j++;
      runs.push([i, j]); i = j + 1;
    } else i++;
  }
  if (!runs.length) {
    return {
      ok: false, reason: "日出/日落方向 400km 内无明显云盘",
      dNear: null, dFar: null, hasDeck: false
    };
  }
  let main: [number, number] | null = null;
  for (const r of runs) if (r[0] === 0) { main = r; break; }
  if (!main) main = runs[runs.length - 1];
  const step = transect.length > 1 ? transect[1].d - transect[0].d : 25;
  const dNear = transect[main[0]].d === 0 ? 0 : Math.max(0, transect[main[0]].d - step / 2);
  const lastIdx = main[1];
  const dFar =
    lastIdx === transect.length - 1
      ? transect[lastIdx].d + step
      : transect[lastIdx].d + step / 2;
  const openEnded = lastIdx === transect.length - 1;
  let aSum = 0, aN = 0, lowMax = 0, midMax = 0, visMin = 1e9;
  for (const p of transect) {
    if (p.d > Math.max(dFar, 120)) continue;
    if (isNum(p.aod)) { aSum += p.aod; aN++; }
    lowMax = Math.max(lowMax, nz(p.cLow, 0));
    midMax = Math.max(midMax, nz(p.cMid, 0));
    const v = nz(p.vis, 1e9);
    if (v < visMin) visMin = v;
  }
  return {
    ok: true, dNear, dFar, openEnded, hasDeck: true,
    upstreamAod: aN ? aSum / aN : null,
    upstreamLowMax: lowMax,
    upstreamMidMax: midMax,
    upstreamVisMin: visMin === 1e9 ? null : visMin,
    deckIdx: main
  };
}

/* ---- 火烧云三角几何 ---- */
export interface FireGeom {
  xMax: number; thFar: number; thNear: number;
  thFarDeg: number; thNearDeg: number; ok: boolean; dur: number;
}
export function fireGeometry(
  hEffKm: number | null, dFarKm: number | null,
  vKmin: number, omegaDegMin: number
): FireGeom {
  const xMax = 2 * Math.sqrt(2 * RE * Math.max(hEffKm || 0, 0));
  const thFar = Math.sqrt(Math.max(0, 2 * (hEffKm || 0) / RE));
  const thNear = isNum(dFarKm) ? dFarKm / (2 * RE) : Infinity;
  const ok =
    isNum(hEffKm) && hEffKm > 0.05 && isNum(dFarKm) && thNear < thFar;
  const dur = ok
    ? (thFar - thNear) / (Math.abs(omegaDegMin) * DEG || 1)
    : 0;
  return {
    xMax, thFar, thNear,
    thFarDeg: thFar * RAD, thNearDeg: thNear * RAD,
    ok, dur
  };
}

/* ---- 云量淡纹：低云 + 中云×0.85 合成遮挡（0–100）—— 地图云纹层用 ---- */
export function cloudBlockOf(env: {
  cLow?: number | null; cMid?: number | null;
}): number {
  const a = isNum(env.cLow) ? clamp(env.cLow, 0, 100) : 0;
  const b = (isNum(env.cMid) ? clamp(env.cMid, 0, 100) : 0) * 0.85;
  return clamp(a + b - (a * b) / 100, 0, 100);
}

/* ---- 亮度分级 ---- */
export interface BrightLevel { txt: string; score: number }
export function brightnessLevel(T550: number): BrightLevel {
  if (T550 >= 0.2) return { txt: "极亮（可能过曝、色泽偏白）", score: 72 };
  if (T550 >= 0.06) return { txt: "明亮（最佳区间）", score: 100 };
  if (T550 >= 0.02) return { txt: "明亮偏弱（仍清晰可见）", score: 90 };
  if (T550 >= 0.002) return { txt: "较暗（闷烧）", score: 58 };
  if (T550 >= 0.001) return { txt: "很暗（观赏价值低）", score: 28 };
  if (T550 >= 0.0002) return { txt: "极暗（基本看不到）", score: 8 };
  return { txt: "完全不可见", score: 0 };
}
