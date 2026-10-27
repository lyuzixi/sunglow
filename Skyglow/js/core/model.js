/* ---------------- model.py ---------------- */
const GRADES = ["基本不烧", "微烧", "小烧", "小到中烧", "中到大烧", "大烧"];
const GRADE_COLORS = ["#5b6477", "#8a6f5a", "#b5764a", "#d4823c", "#e8603c", "#f2402f"];

const DECKS = [
  { key: "high", label: "高云", base: 8.6, thickness: 1.6, w: 1.00 },
  { key: "mid", label: "中云", base: 5.2, thickness: 1.2, w: 0.95 },
  { key: "low", label: "低云", base: null, thickness: 0.8, w: 0.45 },
];

const DEFAULT_MODEL = {
  version: "physics-v1",
  features: ["canvas", "canvas_high", "light", "horizon", "purity", "aod", "precip"],
  mean: [0, 0, 0, 0, 0, 0, 0],
  std: [1, 1, 1, 1, 1, 1, 1],
  coef: [0.15, 0.30, 0.10, 0.25, 0.10, -0.06, -0.15],
  intercept: -0.55,
  prob_a: 1.55, prob_b: 0.75,
  thresholds: [0.9, 1.6, 2.3, 3.0, 3.8],
  prob_cuts: [0.08, 0.16, 0.26, 0.38, 0.52],
};

function sigmoid(x) {
  if (x < -60) return 0.0;
  if (x > 60) return 1.0;
  return 1.0 / (1.0 + Math.exp(-x));
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function logit(p, eps = 0.012) {
  p = clamp(p, eps, 1 - eps);
  return Math.log(p / (1 - p));
}
const round = (v, n) => {
  const f = Math.pow(10, n);
  return Math.round(v * f) / f;
};

function deckBases(w) {
  const blh = w.blh || 0;
  return { low: blh ? clamp(blh / 1000.0, 0.45, 2.2) : 1.2, mid: 5.2, high: 8.6 };
}

function canvasCurve(key, cover) {
  const u = clamp(cover / 100.0, 0, 1);
  if (key === "high") return 1.0 - Math.exp(-3.1 * u);
  if (key === "mid") {
    let c = 1.0 - Math.exp(-3.7 * u);
    if (u > 0.94) c *= 0.86;
    return c;
  }
  return 0.52 * (1.0 - Math.exp(-1.5 * u));
}

function featuresFromWeather(w, sunElev) {
  const bases = deckBases(w);
  const aod = clamp(w.aod == null ? 0.15 : w.aod, 0.02, 1.2);
  const aodUp = clamp(w.aod_up == null ? aod : w.aod_up, 0.02, 1.5);

  const decks = DECKS.map(d => {
    const baseKm = bases[d.key];
    const cover = w["cc_" + d.key] || 0.0;
    const effH = baseKm + 0.45 * d.thickness;
    const limit = illuminationLimit(effH);
    const gate = 1.0 / (1.0 + Math.exp(-(sunElev - limit) / 0.7));
    const canvas = canvasCurve(d.key, cover) * d.w * gate;
    const light = deckLight(effH, sunElev, d.key === "low" ? aod : aodUp);
    return {
      key: d.key, label: d.label, cover, base_km: baseKm, canvas,
      lit: sunElev >= limit, light, weight: d.w, limit,
    };
  });

  const totalW = decks.reduce((s, x) => s + x.canvas, 0);
  let canvas, lightVal, rgb;
  if (totalW > 1e-6) {
    canvas = 1.0 - decks.reduce((p, x) => p * (1.0 - x.canvas), 1.0);
    lightVal = decks.reduce((s, x) => s + x.canvas * x.light.lum, 0) / totalW;
    rgb = [0, 1, 2].map(i => decks.reduce((s, x) => s + x.canvas * x.light.rgb[i], 0) / totalW);
  } else {
    canvas = 0.0; lightVal = 0.0; rgb = [108, 96, 92];
  }

  const lowUp = clamp((w.cc_low_up != null ? w.cc_low_up : (w.cc_low || 0)) / 100.0, 0, 1);
  const midUp = clamp((w.cc_mid_up != null ? w.cc_mid_up : (w.cc_mid || 0)) / 100.0, 0, 1);
  let horizon = 1.0 - 0.85 * sigmoid((lowUp - 0.62) / 0.10);
  horizon *= 1.0 - 0.25 * sigmoid((midUp - 0.85) / 0.08);
  horizon *= 1.0 - 0.30 * sigmoid((clamp((w.cc_low || 0) / 100.0, 0, 1) - 0.80) / 0.08);
  horizon = clamp(horizon, 0.05, 1.0);

  const rh = w.rh == null ? 60.0 : w.rh;
  let visKm;
  if (w.vis == null) {
    const growth = Math.pow(1.0 - clamp(rh, 5, 99) / 100.0, -0.55);
    const bExt = aod / 1.4 * growth + 0.012;
    visKm = clamp(3.912 / bExt, 1.0, 80.0);
  } else {
    visKm = w.vis / 1000.0;
  }

  const precip = w.precip || 0.0;
  let purity = (0.62 + 0.38 * sigmoid((visKm - 12) / 4.0))
    * (1.0 - 0.28 * sigmoid((rh - 92) / 4.0));
  if (precip >= 0.05) purity *= precip < 0.6 ? 0.55 : 0.28;
  purity = clamp(purity, 0.05, 1.0);

  return {
    canvas: clamp(canvas, 0, 0.999),
    canvas_high: clamp(decks[0].canvas, 0, 0.999),
    canvas_mid: clamp(decks[1].canvas, 0, 0.999),
    canvas_low: clamp(decks[2].canvas, 0, 0.999),
    light: clamp(lightVal, 0, 1),
    horizon, purity, aod, precip,
    rgb: rgb.map(c => Math.round(c)),
    decks, bases, low_up: lowUp, mid_up: midUp,
  };
}

function rawFeatures(f) {
  return [logit(f.canvas), logit((f.canvas_high || 0) * 1.6),
    Math.log(Math.max(f.light, 0.004)), logit(f.horizon), logit(f.purity),
    f.aod, f.precip >= 0.2 ? 1.0 : 0.0];
}

function intensityOf(f, model) {
  const x = rawFeatures(f);
  let z = model.intercept;
  for (let i = 0; i < x.length; i++) {
    z += model.coef[i] * (x[i] - model.mean[i]) / (model.std[i] || 1.0);
  }
  return z;
}
const probabilityOf = (idx, model) => sigmoid(model.prob_a * (idx - model.prob_b));

function gradeFromIndex(idx, model) {
  let g = 0;
  model.thresholds.forEach((th, i) => { if (idx >= th) g = i + 1; });
  return g;
}

function assess(w, sunElev, event, model) {
  const f = featuresFromWeather(w, sunElev);
  const idx = clamp(intensityOf(f, model), -1.0, 6.5);
  const p = probabilityOf(idx, model);
  const g = gradeFromIndex(idx, model);
  const lum = f.light, rgb = f.rgb;
  const hex = "#" + rgb.map(c => c.toString(16).padStart(2, "0")).join("");
  return {
    probability: round(p, 4), index: round(idx, 3),
    grade: g, grade_label: GRADES[g], grade_color: GRADE_COLORS[g],
    colour: { rgb, hex, name: colourName(rgb, lum), luminance: round(lum, 4) },
    features: {
      canvas: round(f.canvas, 4), light: round(lum, 4), horizon: round(f.horizon, 4),
      purity: round(f.purity, 4), aod: round(f.aod, 3), precip: round(f.precip, 2),
    },
    decks: f.decks.map(d => ({
      key: d.key, label: d.label, cover: round(d.cover, 1), base_km: round(d.base_km, 2),
      canvas: round(d.canvas, 3), lit: d.lit, luminance: round(d.light.lum, 4),
      rgb: d.light.rgb, tangent_km: round(d.light.tangent_km, 2),
    })),
    event, sun_elev: round(sunElev, 3), model_version: model.version,
  };
}

function contrast(elev) { return 1.0 / (1.0 + Math.exp((elev - 0.6) / 1.5)); }

function timeline(w, eventMs, lat, lon, model, before = 35, after = 55, step = 1) {
  const ref = contrast(solarPosition(lat, lon, eventMs)[0]);
  const out = [];
  for (let m = -before; m <= after; m += step) {
    const t = eventMs + m * 60000;
    const [elev, az] = solarPosition(lat, lon, t);
    const r = assess(w, elev, "sunset", model);
    const shape = Math.min(1.0, contrast(elev) / Math.max(ref, 0.25));
    out.push({
      minute: m, time: new Date(t).toISOString(), elev: round(elev, 3), az: round(az, 1),
      probability: r.probability, view: round(Math.min(1.0, r.probability * shape), 4),
      grade: r.grade, luminance: r.features.light, rgb: r.colour.rgb,
    });
  }
  return out;
}

function bestWindow(tl) {
  if (!tl || !tl.length) return null;
  const pk = Math.max(...tl.map(x => x.view));
  if (pk < 0.08) return null;
  const thr = Math.max(0.10, pk * 0.45);
  let best = [], cur = [];
  for (const x of tl) {
    if (x.view >= thr && x.luminance > 0.012 && x.elev < 4.5) cur.push(x);
    else { if (cur.length > best.length) best = cur; cur = []; }
  }
  if (cur.length > best.length) best = cur;
  if (!best.length) return null;
  const peak = best.reduce((a, b) => (b.view > a.view ? b : a));
  return {
    start_min: best[0].minute, end_min: best[best.length - 1].minute,
    peak_min: peak.minute,
    peak_probability: round(Math.max(...best.map(x => x.view)), 3),
    start: best[0].time, end: best[best.length - 1].time, duration: best.length,
  };
}

