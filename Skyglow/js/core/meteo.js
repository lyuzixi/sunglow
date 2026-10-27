/* ---------------- endpoints & constants ---------------- */
const OM_FORECAST = "https://api.open-meteo.com/v1/forecast";
const OM_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const OM_AIR = "https://air-quality-api.open-meteo.com/v1/air-quality";
const OM_GEO = "https://geocoding-api.open-meteo.com/v1/search";
const WA_API = "https://api.weatherapi.com/v1/forecast.json";

const SOURCES = [
  { id: "openmeteo", label: "Open-Meteo", short: "OM", tag: "best match", color: "#ff8a4c",
    tokens: ["best_match", "archive_best_match", ""] },
  { id: "ecmwf", label: "ECMWF IFS", short: "IFS", tag: "0.25°", color: "#6f8fb8", tokens: ["ecmwf_ifs025"] },
  { id: "gfs", label: "GFS", short: "GFS", tag: "seamless", color: "#5ad19a", tokens: ["gfs_seamless"] },
  { id: "icon", label: "ICON", short: "ICON", tag: "seamless", color: "#c58ad6", tokens: ["icon_seamless"] },
];
const MODELS_PARAM = "best_match,ecmwf_ifs025,gfs_seamless,icon_seamless";
/* Open-Meteo 的配额按「格点数 × 变量数 × 天数」加权，浏览器没有服务端缓存兜底，
   所以只取模型真正读取的 7 个变量（露点/风/降水概率不参与打分）。 */
const VARS = "cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,"
  + "relative_humidity_2m,precipitation,boundary_layer_height";
const AZ_VARS = "cloud_cover_low,cloud_cover_mid,cloud_cover_high,boundary_layer_height";

const RINGS = [120, 250, 380];
const AZIMUTHS = [0, 45, 90, 135, 180, 225, 270, 315];
const AZ_DISTANCES = [60, 140, 240, 380];
const AZ_TRANSECT = [40, 80, 120, 160, 200, 240, 280, 320, 360, 400, 450, 500, 550];
const DIR_NAMES = ["北", "北东北", "东北", "东东北", "东", "东东南", "东南", "南东南",
  "南", "南西南", "西南", "西西南", "西", "西西北", "西北", "北西北"];


/* ---------------- storage cache ---------------- */
const CACHE_TTL = 30 * 60 * 1000;

function cacheGet(key) {
  try {
    const raw = localStorage.getItem("skyglow:" + key);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (Date.now() - o.t > (o.ttl || CACHE_TTL)) return null;
    return o.v;
  } catch (e) { return null; }
}
function cachePut(key, v, ttl) {
  try { localStorage.setItem("skyglow:" + key, JSON.stringify({ t: Date.now(), v, ttl: ttl || CACHE_TTL })); }
  catch (e) { /* quota */ }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* The browser has no server-side circuit breaker, so retry 429s with backoff.
   Open-Meteo counts one request as N locations; a 25-point bundle is heavy. */
async function getJSON(url, ttl, tries) {
  const hit = cacheGet(url);
  if (hit) return hit;
  const max = tries || 3;
  let last = "";
  for (let k = 0; k < max; k++) {
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      last = "网络不可达";
      if (k < max - 1) { await sleep(1200 * (k + 1)); continue; }
      throw new Error(last);
    }
    if (res.ok) {
      const data = await res.json();
      if (data && data.error) throw new Error(data.reason || "上游返回错误");
      cachePut(url, data, ttl);
      return data;
    }
    if (res.status === 429) {
      let reason = "";
      try { const j = await res.json(); reason = String(j.reason || j.error || ""); } catch (e) { /* ignore */ }
      if (/hourly/i.test(reason)) {
        throw new Error("Open-Meteo 小时额度耗尽：免费额度按小时重置，请下个整点后再试");
      }
      last = "Open-Meteo 限流（429）：同一 IP 每分钟请求过多";
      if (k < max - 1) { await sleep(4000 * (k + 1)); continue; }
    } else if (res.status >= 500) {
      last = "上游暂时不可用（HTTP " + res.status + "）";
      if (k < max - 1) { await sleep(2000 * (k + 1)); continue; }
    } else {
      throw new Error("HTTP " + res.status);
    }
  }
  throw new Error(last);
}

/* ---------------- time helpers ---------------- */
function dateInOffset(ms, offsetSec) {
  const d = new Date(ms + offsetSec * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
    hh: d.getUTCHours(), mm: d.getUTCMinutes(), wd: d.getUTCDay() };
}
const isoDate = o => o.y + "-" + pad2(o.m) + "-" + pad2(o.d);
function hhmmLocal(ms, offsetSec) {
  const o = dateInOffset(ms, offsetSec);
  return pad2(o.hh) + ":" + pad2(o.mm);
}
function parseLocalMs(s) {          // "2026-10-18T00:00" treated as wall clock
  return Date.parse(s + "Z");
}
function hhmmWall(wallMs) {         // wall-clock ms -> "HH:MM"
  const d = new Date(wallMs);
  return pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes());
}

/* ---------------- Open-Meteo sampling ---------------- */
function samplePoints(lat, lon) {
  const pts = [{ id: "c", lat, lon, dist: 0, az: 0 }];
  for (const d of RINGS) {
    for (const az of AZIMUTHS) {
      const dlat = (d / 111.32) * Math.cos(az * Math.PI / 180);
      const dlon = (d / (111.32 * Math.cos(lat * Math.PI / 180))) * Math.sin(az * Math.PI / 180);
      pts.push({ id: d + "-" + az, lat: lat + dlat, lon: lon + dlon, dist: d, az });
    }
  }
  return pts;
}

function seriesFor(h, varName, tokens) {
  for (const t of tokens) {
    const key = varName + (t ? "_" + t : "");
    if (h[key] && h[key].length) return h[key];
  }
  return null;
}

function batchUrl(base, pts, start, end, hourly, models) {
  const lats = pts.map(p => p.lat.toFixed(4)).join(",");
  const lons = pts.map(p => p.lon.toFixed(4)).join(",");
  return base + "?latitude=" + lats + "&longitude=" + lons
    + "&start_date=" + start + "&end_date=" + end
    + "&hourly=" + hourly
    + (models ? "&models=" + MODELS_PARAM : "")
    + "&timezone=auto";
}

async function fetchBundle(lat, lon, start, end, archive, ptsIn, opts) {
  const pts = ptsIn || samplePoints(lat, lon);
  const url = batchUrl(archive ? OM_ARCHIVE : OM_FORECAST, pts, start, end, VARS, true);
  let data = await getJSON(url, CACHE_TTL);
  if (!Array.isArray(data)) data = [data];
  if (data.length !== pts.length) throw new Error("格点返回数量不匹配");

  let aq = null;
  /* 七日趋势跨 9 天，空气质量端点会 400；七日不需要 AOD，直接跳过。 */
  if (!(opts && opts.skipAq)) {
    try {
      const aqUrl = batchUrl(OM_AIR, pts, start, end, "aerosol_optical_depth", false);
      aq = await getJSON(aqUrl, CACHE_TTL);
      if (!Array.isArray(aq)) aq = [aq];
    } catch (e) { aq = null; }
  }

  const offset = data[0].utc_offset_seconds || 0;
  return {
    offset,
    tz: data[0].timezone,
    elevation: data[0].elevation,
    points: pts.map((p, i) => {
      const h = data[i].hourly || {};
      const rec = { id: p.id, dist: p.dist, az: p.az, time: h.time || [], sources: {} };
      for (const s of SOURCES) {
        const toks = s.tokens;
        rec.sources[s.id] = {
          cc_low: seriesFor(h, "cloud_cover_low", toks),
          cc_mid: seriesFor(h, "cloud_cover_mid", toks),
          cc_high: seriesFor(h, "cloud_cover_high", toks),
          // 只与上面 VARS 的 7 项对应；其余变量已不请求
          rh: seriesFor(h, "relative_humidity_2m", toks),
          precip: seriesFor(h, "precipitation", toks),
          blh: seriesFor(h, "boundary_layer_height", toks),
          vis: seriesFor(h, "visibility", toks),
        };
      }
      rec.aod = (aq && aq[i] && aq[i].hourly && aq[i].hourly.aerosol_optical_depth) || [];
      return rec;
    }),
  };
}

/* Interpolate a series that starts at times[0], at a local wall-clock instant. */
function interp(series, times, localMs) {
  if (!series || !series.length || !times || !times.length) return null;
  const delta = (localMs - parseLocalMs(times[0])) / 3600000;
  const i = Math.floor(delta);
  const f = delta - i;
  if (i < 0 || i + 1 >= series.length) return series[Math.max(0, Math.min(i, series.length - 1))];
  const a = series[i], b = series[i + 1];
  if (a == null) return b;
  if (b == null) return a;
  return a * (1 - f) + b * f;
}

function sourceAvailable(centre, sid, localMs) {
  const s = centre.sources[sid] || {};
  let got = 0;
  for (const k of ["cc_low", "cc_mid", "cc_high"]) {
    if (interp(s[k], centre.time, localMs) != null) got++;
  }
  return got === 3;
}

function assemble(bundle, localMs, sunAz, sid) {
  const weights = [], vals = { cc_low: [], cc_mid: [], cc_high: [] };
  let centre = null;
  for (const p of bundle.points) {
    const s = p.sources[sid] || {};
    const dd = Math.abs((sunAz - p.az + 180) % 360 - 180);
    const aw = dd < 80 ? Math.pow(Math.cos(dd * Math.PI / 360), 2) : 0;
    weights.push(aw * Math.exp(-p.dist / 260));
    for (const k of ["cc_low", "cc_mid", "cc_high"]) {
      vals[k].push(interp(s[k], p.time, localMs));
    }
    if (p.dist === 0) centre = p;
  }

  const wmean = key => {
    let num = 0, den = 0;
    weights.forEach((w, i) => {
      const v = vals[key][i];
      if (v == null) return;
      num += w * v; den += w;
    });
    return den > 0.2 ? num / den : null;
  };

  const s = centre.sources[sid] || {};
  const w = {};
  for (const key of ["cc_low", "cc_mid", "cc_high", "rh", "precip", "blh", "vis"]) {
    w[key] = interp(s[key], centre.time, localMs);
  }
  for (const key of ["cc_low", "cc_mid", "cc_high"]) {
    const up = wmean(key);
    w[key + "_up"] = up == null ? w[key] : up;
  }

  const aod = interp(centre.aod, centre.time, localMs);
  let num = 0, den = 0;
  weights.forEach((wt, i) => {
    const v = interp(bundle.points[i].aod, bundle.points[i].time, localMs);
    if (v == null) return;
    num += wt * v; den += wt;
  });
  const aodUp = den > 0.2 ? num / den : null;
  w.aod = aod == null ? aodUp : aod;
  w.aod_up = aodUp == null ? w.aod : aodUp;

  const sample = [];
  weights.forEach((wt, i) => {
    const mid = vals.cc_mid[i], high = vals.cc_high[i];
    if (wt > 0.04 && mid != null && high != null) sample.push(0.5 * (mid + high));
  });
  if (sample.length >= 4) {
    const mu = sample.reduce((a, b) => a + b, 0) / sample.length;
    w.spread = Math.sqrt(sample.reduce((a, b) => a + (b - mu) ** 2, 0) / sample.length);
  } else {
    w.spread = null;
  }
  return w;
}

