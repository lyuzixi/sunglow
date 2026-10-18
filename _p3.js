/* =========================================================================
   Part 3：物理模型
   气溶胶垂直分布 / 光学等效地表高度 / 光路消光积分 / CIE 色度 / 云层与几何
   ========================================================================= */

/* ---- 气溶胶消光系数标高：由边界层高度估计，限制在教程给出的 0.5~4 km ---- */
function aerosolScaleHeight(blhM) {
  const km = isNum(blhM) ? blhM / 1000 : 1.5;
  return clamp(km * 0.75, 0.6, 4.0);
}

/* ---- 光学等效地表高度（教程 1.3.3 / 附录查询表）
   气溶胶消光系数随高度指数衰减 σ(z)=σ0·e^(-z/Hs)，σ0 = AOD/Hs
   光线“无法穿透”的高度： z = Hs·ln(AOD/(Hs·k_th))                       ---- */
function equivGroundHeight(aod, HsKm, kth) {
  kth = kth || K_TH;
  if (!isNum(aod) || aod <= 0 || !isNum(HsKm) || HsKm <= 0) return 0;
  const z = HsKm * Math.log(aod / (HsKm * kth));
  return clamp(isFinite(z) ? z : 0, 0, 14);
}

/* ---- 波长相关的消光系数（海平面, km^-1）---- */
function sigmaRayleigh0(lam) { return (RAY_OD550_V / H_RAY) * Math.pow(550 / lam, 4); }
function sigmaAerosol0(aod, Hs, lam) { return (aod / Hs) * Math.pow(550 / lam, ANGSTROM); }

/* ---- 沿抛物线光路 z(x) = h + x·tanθ + x²/(2R) 的消光光学厚度积分
   h  : 云底高度 km（即观测点上空被照明的高度）
   th : 该时刻太阳高度角（弧度，日落之后为负）
   物理含义：阳光自远处掠地/掠云边界射来，穿过整层大气到达本地云底      ---- */
function pathOpticalDepth(h, th, aod, Hs, lam) {
  const sR = sigmaRayleigh0(lam), sA = sigmaAerosol0(aod, Hs, lam);
  const t0 = Math.tan(th);
  const N = 420, XMAX = 1400, dx = XMAX / N;
  let tau = 0;
  for (let i = 0; i < N; i++) {
    const x = (i + 0.5) * dx;
    let z = h + x * t0 + x * x / (2 * RE);
    if (!(z > -50)) break;
    if (z > 110) break;                 // 已离开大气层
    if (z < 0) z = 0;                   // 掠地情形
    const dzdx = t0 + x / RE;
    const dl = Math.sqrt(1 + dzdx * dzdx) * dx;
    tau += (sR * Math.exp(-z / H_RAY) + sA * Math.exp(-z / Hs)) * dl;
  }
  return tau;
}

/* ---- 颜色：CIE 1931 色度函数（Wyman 多高斯解析近似） ---- */
function _g(x, mu, s1, s2) {
  return x < mu ? Math.exp(-0.5 * Math.pow((x - mu) / s1, 2)) : Math.exp(-0.5 * Math.pow((x - mu) / s2, 2));
}
const cmfX = w => 1.056 * _g(w, 599.8, 37.9, 31.0) + 0.362 * _g(w, 442.0, 16.0, 26.7) - 0.065 * _g(w, 501.1, 20.4, 26.2);
const cmfY = w => 0.821 * _g(w, 568.8, 46.9, 40.5) + 0.286 * _g(w, 530.9, 16.3, 31.1);
const cmfZ = w => 1.217 * _g(w, 437.0, 11.8, 36.0) + 0.681 * _g(w, 459.0, 26.0, 13.8);
/* 太阳黑体光谱（5778K，相对值） */
function sunSpectrum(lam) {
  const c1 = 3.7418e-16, c2 = 1.4388e-2, l = lam * 1e-9;
  return c1 / (Math.pow(l, 5) * (Math.exp(c2 / (l * 5778)) - 1));
}

/* 沿光路求透射光谱并换算为颜色
   照明 = 直射阳光(沿光路消光) + 天空漫射光
   气溶胶增多时直射光被大幅度削弱、而漫射光占的比重上升，霞光因此变“白”、饱和度下降，
   这正是重霾天“污烧”的成因（教程 2.4.1）。
   返回：{tau550, T550, lumRel, rgb, hex, sat, hue, name} */
const DIFF_AMP = 0.06;      // 天空漫射光相对直射光的量级
const DIFF_PATH = 0.30;     // 漫射光的等效光程比例（远小于直射光，故光谱更“白”）
const WASH_A = 0.62;        // “污烧”最大冲淡系数
const LUM_REF = 0.06;       // 明亮区间下沿（与 brightnessLevel 的分级阈值一致）
const AOD_SKY = 0.55;       // 天空背景散射光饱和所对应的 AOD
const CHROMA_REF = 0.155;   // 饱和霞光的 OKLab 色度参考值（用于归一颜色质量）
/* 满太阳（无消光）的相对亮度参考，用于把 lumRaw 归一为 0~1 的相对亮度 */
const LUM_FULL = (function () { let s = 0; for (let lam = 400; lam <= 700; lam += 5) s += sunSpectrum(lam) * cmfY(lam); return s || 1; })();

function rayTraceColor(h, th, aod, Hs) {
  let X = 0, Y = 0, Z = 0, tau550 = 0, lumRaw = 0;
  const steps = [];
  for (let lam = 400; lam <= 700; lam += 5) {
    const tau = pathOpticalDepth(h, th, aod, Hs, lam);
    const T = Math.exp(-clamp(tau, 0, 60));
    const Tsky = Math.exp(-clamp(tau * DIFF_PATH, 0, 60));
    const S = sunSpectrum(lam);
    const w = S * (T + DIFF_AMP * Tsky);
    X += w * cmfX(lam); Y += w * cmfY(lam); Z += w * cmfZ(lam);
    lumRaw += w * cmfY(lam);
    if (lam === 550) { tau550 = tau; }
    steps.push({ lam, tau, T });
  }
  /* XYZ(D65) → 线性 sRGB */
  let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  let g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  let b = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
  r = Math.max(0, r); g = Math.max(0, g); b = Math.max(0, b);
  const mx = Math.max(r, g, b) || 1e-12;
  /* 亮度归一的色样（模拟拍摄时调整曝光，便于观察色相与饱和度） */
  let nr = r / mx, ng = g / mx, nb = b / mx;
  const lumRel = lumRaw / LUM_FULL;
  /* 重霾“污烧”（教程 2.4.1）：气溶胶散射让天空背景变亮变白，
     与被大幅削弱的直射霞光相互竞争，人眼感知到的彩度因此下降。
     冲淡强度同时取决于「气溶胶多寡」与「直射光被削弱到什么程度」 */
  const skyRel = clamp01(aod / AOD_SKY);
  const dimness = clamp01(1 - lumRel / LUM_REF);
  const wash = clamp01(WASH_A * (0.30 + 0.70 * skyRel) * (0.20 + 0.80 * dimness));
  const gray = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
  nr = lerp(nr, gray, wash); ng = lerp(ng, gray, wash); nb = lerp(nb, gray, wash);
  const to255 = v => Math.round(255 * Math.pow(clamp(v, 0, 1), 1 / 2.2));
  const R = to255(nr), G = to255(ng), B = to255(nb);
  const hex = "#" + [R, G, B].map(v => v.toString(16).padStart(2, "0")).join("");
  /* HSV（用于色相命名） */
  const rn = nr, gn = ng, bn = nb;
  const mxx = Math.max(rn, gn, bn), mnn = Math.min(rn, gn, bn), dd = mxx - mnn;
  let hue = 0;
  if (dd > 1e-9) {
    if (mxx === rn) hue = 60 * (((gn - bn) / dd) % 6);
    else if (mxx === gn) hue = 60 * ((bn - rn) / dd + 2);
    else hue = 60 * ((rn - gn) / dd + 4);
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

/* OKLab 色度（感知意义上的“彩度”，灰色为 0） */
function oklabChroma(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return Math.hypot(A, B);
}

function colorName(hue, sat, T550) {
  if (sat < 0.10) return T550 < 0.004 ? "灰暗无彩" : "灰白（大气浑浊）";
  if (hue < 12) return "深红 / 暗红";
  if (hue < 25) return "红";
  if (hue < 36) return "橘红";
  if (hue < 46) return "橙色";
  if (hue < 55) return "金黄 / 橘黄";
  if (hue < 68) return "淡黄";
  if (hue >= 320) return "粉紫";
  return "黄绿（少见）";
}

/* ---- 云层识别：由温湿、0℃层高度估算各层云底高度 ----
   说明：数值模式不给逐层云底，这里用抬升凝结高度（T-Td 差）与 0℃层高度做经验参数化 */
function cloudDecks(env) {
  const dT = (isNum(env.T) && isNum(env.Td)) ? Math.max(0, env.T - env.Td) : 3;
  const lcl = clamp(0.125 * dT, 0.03, 4.0);                 // km
  const fz = isNum(env.fz) ? clamp(env.fz / 1000, 0.2, 7.0) : null;
  const hLow = clamp(lcl, 0.03, 2.5);
  const hMid = fz != null ? clamp(0.55 * fz, 2.6, 6.0) : 3.6;
  const hHigh = fz != null ? clamp(1.65 * fz, 5.5, 12.0) : 8.5;
  const d = [
    { key: "cLow", level: 0, name: "低云", base: hLow, cover: nz(env.cLow, 0) },
    { key: "cMid", level: 1, name: "中云", base: hMid, cover: nz(env.cMid, 0) },
    { key: "cHigh", level: 2, name: "高云", base: hHigh, cover: nz(env.cHigh, 0) }
  ];
  d.forEach(x => { x.type = deckTypeName(x.level, x.base, x.cover); x.typeScore = DECK_TYPE_SCORE[x.type] ?? 0.5; });
  return d;
}
const DECK_TYPE_SCORE = {
  "层云/雾": 0.12, "层积云": 0.58, "积云": 0.42,
  "高积云": 0.86, "高层云": 0.94, "卷层云": 1.00, "卷云": 0.95
};
function deckTypeName(level, h, cover) {
  if (level === 0) {
    if (h < 0.35) return "层云/雾";
    if (h < 2.0) return "层积云";
    return "积云";
  }
  if (level === 1) return h < 4.2 ? "高积云" : "高层云";
  return cover >= 70 ? "卷层云" : "卷云";
}

/* ---- 沿样带的云边界分析 ----
   输入 transect: [{d, cLow, cMid, cHigh, aod, vis, rh, T, Td, ...}]
   返回发光云盘的近边界/远边界、上游 AOD、低云遮挡等                    */
function analyseTransect(transect, levelKey) {
  if (!transect || !transect.length) return { ok: false, reason: "无样带数据" };
  const cov = i => nz(transect[i][levelKey], 0);
  const TH = 25;
  const runs = [];
  let i = 0;
  while (i < transect.length) {
    if (cov(i) >= TH) {
      let j = i; while (j + 1 < transect.length && cov(j + 1) >= TH) j++;
      runs.push([i, j]); i = j + 1;
    } else i++;
  }
  if (!runs.length) {
    return { ok: false, reason: "日出/日落方向 400km 内无明显云盘", dNear: null, dFar: null, hasDeck: false };
  }
  /* 选择承载霞光的主云盘：优先本地已在云下的连续云盘（起点为 0） */
  let main = null;
  for (const r of runs) if (r[0] === 0) { main = r; break; }
  if (!main) main = runs[runs.length - 1];                   // 否则取最外侧云盘
  const step = transect.length > 1 ? (transect[1].d - transect[0].d) : 25;
  const dNear = transect[main[0]].d === 0 ? 0 : Math.max(0, transect[main[0]].d - step / 2);
  const lastIdx = main[1];
  const dFar = (lastIdx === transect.length - 1)
    ? transect[lastIdx].d + step                   // 云盘延伸到样带之外
    : transect[lastIdx].d + step / 2;
  const openEnded = (lastIdx === transect.length - 1);
  /* 上游（光路）平均 AOD 与其它层次遮挡 */
  let aSum = 0, aN = 0, lowMax = 0, midMax = 0, visMin = 1e9;
  for (const p of transect) {
    if (p.d > Math.max(dFar, 120)) continue;
    if (isNum(p.aod)) { aSum += p.aod; aN++; }
    lowMax = Math.max(lowMax, nz(p.cLow, 0));
    midMax = Math.max(midMax, nz(p.cMid, 0));
    const v = nz(p.vis, 1e9); if (v < visMin) visMin = v;
  }
  return {
    ok: true, dNear, dFar, openEnded, hasDeck: true,
    upstreamAod: aN ? aSum / aN : null,
    upstreamLowMax: lowMax, upstreamMidMax: midMax, upstreamVisMin: visMin === 1e9 ? null : visMin,
    deckIdx: main
  };
}

/* ---- 火烧云三角几何 ---- */
function fireGeometry(hEffKm, dFarKm, vKmin, omegaDegMin) {
  const xMax = 2 * Math.sqrt(2 * RE * Math.max(hEffKm, 0));       // 霞光深入距离 km
  const thFar = Math.sqrt(Math.max(0, 2 * hEffKm / RE));           // rad 地球遮挡边界
  const thNear = isNum(dFarKm) ? dFarKm / (2 * RE) : Infinity;     // rad 云边界遮挡边界
  const ok = isNum(hEffKm) && hEffKm > 0.05 && isNum(dFarKm) && thNear < thFar;
  const dur = ok ? (thFar - thNear) / (Math.abs(omegaDegMin) * DEG || 1) : 0;  // 分钟
  return { xMax, thFar, thNear, thFarDeg: thFar * RAD, thNearDeg: thNear * RAD, ok, dur };
}

/* ---- 太阳高度角变化率（度/分钟） ---- */
function sunAltRate(ms, lat, lon) {
  const a1 = solarPosition(ms - 6 * 60000, lat, lon).altitude;
  const a2 = solarPosition(ms + 6 * 60000, lat, lon).altitude;
  return Math.abs((a2 - a1) / 12) || 0.2;
}

/* ---- 亮度分级（教程 FAQ：按 550nm 透射率划分） ---- */
function brightnessLevel(T550) {
  if (T550 >= 0.20) return { txt: "极亮（可能过曝、色泽偏白）", score: 72 };
  if (T550 >= 0.06) return { txt: "明亮（最佳区间）", score: 100 };
  if (T550 >= 0.020) return { txt: "明亮偏弱（仍清晰可见）", score: 90 };
  if (T550 >= 0.002) return { txt: "较暗（闷烧）", score: 58 };
  if (T550 >= 0.001) return { txt: "很暗（观赏价值低）", score: 28 };
  if (T550 >= 0.0002) return { txt: "极暗（基本看不到）", score: 8 };
  return { txt: "完全不可见", score: 0 };
}
