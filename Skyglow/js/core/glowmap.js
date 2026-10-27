/* P1 地图场：把 Python glowmap.py 的 608 / 169 格点链路搬到浏览器。
   只做取数 + 插值 + 逐点评分；渲染仍由 web/maps.js 负责。 */
const SkyglowGlowMap = (() => {
  const NAT = { bbox: [73.5, 18, 135, 54], step: 2.0 };
  const LOCAL_STEP = 0.25;
  const LOCAL_HALF = 1.5;
  const CHUNK = 203;
  /* 空气质量端点 203 坐标实测可用；与预报共用同一批大小。 */
  const AQ_CHUNK = 203;
  const MAP_VARS = "cloud_cover_low,cloud_cover_mid,cloud_cover_high";
  const RAY_ANGLES = [[-30, 0.22], [0, 0.56], [30, 0.22]];
  const RAY_DISTS = [[140, 0.45], [280, 0.33], [420, 0.22]];

  function grid(bbox, step) {
    const nx = Math.round((bbox[2] - bbox[0]) / step) + 1;
    const ny = Math.round((bbox[3] - bbox[1]) / step) + 1;
    const pts = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        pts.push({ lat: bbox[1] + j * step, lon: bbox[0] + i * step });
      }
    }
    return { pts, nx, ny };
  }

  function chunk(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  /* 小并发池：2 路并行 + 250ms 间隔，既比全串行快，也不至于像 6 路齐发那样撞 429。 */
  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
        await sleep(250);
      }
    }
    const n = Math.min(limit, items.length);
    await Promise.all(Array.from({ length: n }, () => worker()));
    return out;
  }

  async function fetchSeries(pts, dateStr, useForecast) {
    const base = useForecast ? OM_FORECAST : OM_ARCHIVE;
    const parts = chunk(pts, CHUNK);

    /* 预报批小并发取，再按原顺序拼回；批内坐标数已控制在 203（URL < 3.2 KB）。 */
    const batches = await mapLimit(parts, 2, async part => {
      const lats = part.map(p => p.lat.toFixed(3)).join(",");
      const lons = part.map(p => p.lon.toFixed(3)).join(",");
      const url = base + "?latitude=" + lats + "&longitude=" + lons
        + "&start_date=" + dateStr + "&end_date=" + dateStr
        + "&hourly=" + MAP_VARS + "&models=" + MODELS_PARAM + "&timezone=UTC";
      let data = await getJSON(url, CACHE_TTL);
      if (!Array.isArray(data)) data = [data];
      if (data.length !== part.length) throw new Error("格点返回数量不匹配");
      return data.map(d => {
        const h = d.hourly || {};
        const rec = { time: h.time || [], sources: {}, aod: [] };
        for (const s of SOURCES) {
          rec.sources[s.id] = {
            cc_low: seriesFor(h, "cloud_cover_low", s.tokens),
            cc_mid: seriesFor(h, "cloud_cover_mid", s.tokens),
            cc_high: seriesFor(h, "cloud_cover_high", s.tokens),
          };
        }
        return rec;
      });
    });
    const out = [];
    batches.forEach(b => out.push(...b));

    /* AOD 也按小并发取；某一批失败只丢该批，不阻断地图 */
    const aqParts = chunk(pts, AQ_CHUNK);
    const aqBatches = await mapLimit(aqParts, 2, async part => {
      try {
        const lats = part.map(p => p.lat.toFixed(3)).join(",");
        const lons = part.map(p => p.lon.toFixed(3)).join(",");
        const url = OM_AIR + "?latitude=" + lats + "&longitude=" + lons
          + "&start_date=" + dateStr + "&end_date=" + dateStr
          + "&hourly=aerosol_optical_depth&timezone=UTC";
        let aq = await getJSON(url, CACHE_TTL);
        if (!Array.isArray(aq)) aq = [aq];
        return aq;
      } catch (e) {
        return null;
      }
    });
    aqBatches.forEach((aq, ci) => {
      if (!aq) return;
      aq.forEach((a, i) => {
        const idx = ci * AQ_CHUNK + i;
        if (idx >= 0 && idx < out.length) {
          out[idx].aod = (a.hourly && a.hourly.aerosol_optical_depth) || [];
        }
      });
    });
    return out;
  }

  function fieldsAtEvents(series, events) {
    const out = {};
    for (const s of SOURCES) {
      out[s.id] = { cc_low: [], cc_mid: [], cc_high: [], aod: [] };
    }
    series.forEach((rec, k) => {
      const t = events[k];
      for (const s of SOURCES) {
        const src = rec.sources[s.id] || {};
        for (const key of ["cc_low", "cc_mid", "cc_high"]) {
          out[s.id][key].push(t == null ? null : interp(src[key], rec.time, t));
        }
        out[s.id].aod.push(t == null ? null : interp(rec.aod, rec.time, t));
      }
    });
    return out;
  }

  function bilinear(flat, nx, ny, lat0, lon0, step, lat, lon) {
    if (!flat) return null;
    const fx = (lon - lon0) / step;
    const fy = (lat - lat0) / step;
    const x0 = Math.max(0, Math.min(nx - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(ny - 1, Math.floor(fy)));
    const x1 = Math.min(nx - 1, x0 + 1);
    const y1 = Math.min(ny - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0));
    const ty = Math.max(0, Math.min(1, fy - y0));
    const vs = [flat[y0 * nx + x0], flat[y0 * nx + x1], flat[y1 * nx + x0], flat[y1 * nx + x1]];
    if (vs.some(v => v == null)) return null;
    return ((vs[0] * (1 - tx) + vs[1] * tx) * (1 - ty)
      + (vs[2] * (1 - tx) + vs[3] * tx) * ty);
  }

  function upstream(fields, nx, ny, lat0, lon0, step, lat, lon, az) {
    const out = {};
    for (const key of ["cc_low", "cc_mid", "cc_high"]) {
      let num = 0, den = 0;
      for (const [dang, wa] of RAY_ANGLES) {
        const a = (az + dang) * Math.PI / 180;
        for (const [dist, wd] of RAY_DISTS) {
          const la = lat + Math.cos(a) * dist / 111;
          const lo = lon + Math.sin(a) * dist
            / (111 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
          const v = bilinear(fields[key], nx, ny, lat0, lon0, step, la, lo);
          if (v == null) continue;
          const w = wa * wd;
          num += w * v; den += w;
        }
      }
      out[key] = den > 0.1 ? num / den : null;
    }
    return out;
  }

  function assessGrid(pts, nx, ny, lon0, lat0, step, series, events, mode, fields) {
    const res = {};
    for (const s of SOURCES) res[s.id] = { probs: [], grades: [] };
    pts.forEach((p, k) => {
      const t = events[k];
      for (const s of SOURCES) {
        const fld = fields[s.id] || {};
        const lo = fld.cc_low || [], mid = fld.cc_mid || [], hi = fld.cc_high || [];
        if (t == null || lo[k] == null || mid[k] == null || hi[k] == null) {
          res[s.id].probs.push(null);
          res[s.id].grades.push(null);
          continue;
        }
        const pos = solarPosition(p.lat, p.lon, t);
        const elev = pos[0], az = pos[1];
        const w = {
          cc_low: lo[k], cc_mid: mid[k], cc_high: hi[k],
          rh: null, precip: 0, blh: null,
          aod: (fld.aod || [])[k] == null ? null : fld.aod[k], vis: null,
        };
        const up = upstream(fld, nx, ny, lat0, lon0, step, p.lat, p.lon, az);
        w.cc_low_up = up.cc_low == null ? w.cc_low : up.cc_low;
        w.cc_mid_up = up.cc_mid == null ? w.cc_mid : up.cc_mid;
        w.cc_high_up = up.cc_high == null ? w.cc_high : up.cc_high;
        w.aod_up = w.aod;
        const r = assess(w, elev, mode, MODEL);
        res[s.id].probs.push(round(r.probability, 3));
        res[s.id].grades.push(r.grade);
      }
    });
    return res;
  }

  function meta() {
    return SOURCES.map(s => ({ id: s.id, label: s.label, short: s.short, tag: s.tag, color: s.color }));
  }

  function failedOf(res) {
    return SOURCES.map(s => s.id).filter(sid => res[sid].probs.every(v => v == null));
  }

  async function build(params) {
    const scope = params.scope === "local" ? "local" : "national";
    const dateStr = params.date;
    const mode = params.mode === "sunrise" ? "sunrise" : "sunset";
    const lat = +params.lat, lon = +params.lon;
    const hit = Store.getMap(scope, dateStr, mode, lat, lon);
    if (hit) {
      return Object.assign({}, hit.v, {
        cached: true, cache: { hit: true, age: Math.round(hit.age), ttl: hit.ttl },
      });
    }

    const d = new Date(dateStr + "T00:00:00Z");
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, dd = d.getUTCDate();
    const today = new Date();
    const todayMs = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const selMs = Date.UTC(y, m - 1, dd);
    const useForecast = selMs >= todayMs - 86400000;
    const offsetHours = params.offset != null ? +params.offset / 3600 : 8;

    let bbox, step, center = null;
    if (scope === "national") {
      bbox = NAT.bbox.slice(); step = NAT.step;
    } else {
      step = LOCAL_STEP;
      const lon0 = Math.round((lon - LOCAL_HALF) / step) * step;
      const lat0 = Math.round((lat - LOCAL_HALF) / step) * step;
      bbox = [lon0, lat0, lon0 + 2 * LOCAL_HALF, lat0 + 2 * LOCAL_HALF];
      center = [lat, lon];
    }
    const g = grid(bbox, step);
    const series = await fetchSeries(g.pts, dateStr, useForecast);
    const events = g.pts.map(p =>
      eventTimes(p.lat, p.lon, y, m, dd, offsetHours, 10, mode)[mode]);
    const fields = fieldsAtEvents(series, events);
    const res = assessGrid(g.pts, g.nx, g.ny, bbox[0], bbox[1], step, series, events, mode, fields);

    const payload = {
      scope, date: dateStr, mode, bbox, step, nx: g.nx, ny: g.ny,
      center, sources: res, failed: failedOf(res), sources_meta: meta(),
      source: useForecast ? "Open-Meteo forecast" : "ERA5 archive",
      generated_at: new Date().toISOString(), cached: false,
    };
    Store.putMap(scope, dateStr, mode, lat, lon, payload);
    return payload;
  }

  return { build };
})();
