/* P0 编排层：把原版单文件页的取数 / 评分散件拼成 web/app.js 认识的 payload。
   所有函数只依赖全局 core 模块（MODEL / NN / SOURCES / fetchBundle / assess ...），
   不碰 DOM，方便后续 P1 继续扩展。 */

function svcIso(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
}
function svcTodayMs() {
  const n = new Date();
  return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
}
function svcDateParts(dateStr) {
  const p = dateStr.split("-").map(Number);
  return { y: p[0], m: p[1], d: p[2], ms: Date.UTC(p[0], p[1] - 1, p[2]) };
}
function svcSourcesMeta() {
  return SOURCES.map(s => ({ id: s.id, label: s.label, short: s.short, tag: s.tag, color: s.color }));
}
function svcTimelineFor(r) {
  return (r || []).map(x => ({ m: x.minute, v: x.view, e: x.elev }));
}
/* bestWindow 的 start/end 是 UTC ISO；web 的 hhmm() 直接截 ISO 的 11–16 位，
   所以这里换成「当地墙钟 ISO」，避免日落窗口被显示成 UTC 上午。 */
function svcWindowLocal(win, offsetSec) {
  if (!win) return null;
  const localIso = iso => {
    const ms = Date.parse(iso);
    if (!isFinite(ms)) return iso;
    return new Date(ms + offsetSec * 1000).toISOString().slice(0, 16);
  };
  return Object.assign({}, win, { start: localIso(win.start), end: localIso(win.end) });
}
function svcRiskFromWa(wa, w) {
  if (!wa) return null;
  const ours = Math.max(w.cc_low || 0, w.cc_mid || 0, w.cc_high || 0);
  if (wa.cloud_total != null && Math.abs(ours - wa.cloud_total) >= 35) {
    return "校验源总云量 " + wa.cloud_total + "% 与我们诊断的 "
      + Math.round(ours) + "% 相差较大，该时刻云量存在不确定性";
  }
  if ((wa.chance_of_rain || 0) >= 60) {
    return "校验源给出 " + wa.chance_of_rain + "% 降水概率（"
      + (wa.condition || "降水") + "），雨幕可能压低能见度与色彩纯度";
  }
  return null;
}

async function svcPredict(params) {
  const lat = +params.lat, lon = +params.lon;
  const dateStr = params.date || svcIso(svcTodayMs());
  const name = params.name || (lat.toFixed(2) + ", " + lon.toFixed(2));
  const refresh = params.refresh === "1" || params.refresh === 1 || params.refresh === true;

  if (!refresh) {
    const hit = Store.getPoint(lat, lon, dateStr);
    if (hit) return Object.assign({}, hit.v, { cache: { hit: true, age: Math.round(hit.age), ttl: hit.ttl } });
  }

  const dp = svcDateParts(dateStr);
  const todayMs = svcTodayMs();
  if (Math.abs(dp.ms - todayMs) / 86400000 > 10) {
    throw new Error("所选日期距今天超过 10 天，预报模式覆盖不到");
  }
  const archive = dp.ms < todayMs - 2 * 86400000;
  const bundle = await fetchBundle(lat, lon, svcIso(dp.ms - 86400000), svcIso(dp.ms + 86400000), archive);
  const off = bundle.offset;
  const offH = off / 3600;
  const locToday = dateInOffset(Date.now(), off);
  const lead = Math.round((dp.ms - Date.UTC(locToday.y, locToday.m - 1, locToday.d)) / 86400000);
  const waKey = getWaKey();
  const waSamples = {};
  let waErr = null;

  const results = {};
  for (const mode of ["sunrise", "sunset"]) {
    const ev = eventTimes(lat, lon, dp.y, dp.m, dp.d, offH, 2, mode)[mode];
    if (ev == null) { results[mode] = null; continue; }
    const pos = solarPosition(lat, lon, ev);
    const elev = pos[0], az = pos[1];
    const localMs = ev + off * 1000;

    let wa = null;
    if (waKey) {
      try { wa = await waSampleAt(lat, lon, localMs, off, waKey); }
      catch (e) { waErr = e.message; }
    }
    waSamples[mode] = wa;

    const per = {};
    for (const s of SOURCES) {
      const centre = bundle.points[0];
      if (!sourceAvailable(centre, s.id, localMs)) {
        per[s.id] = { id: s.id, error: "该源在此刻无分层云量", origin: "none" };
        continue;
      }
      const w = assemble(bundle, localMs, az, s.id);
      const filled = fillAux(w, wa);
      const r = assess(w, elev, mode, MODEL);
      const tlRaw = timeline(w, ev, lat, lon, MODEL);
      const win = bestWindow(tlRaw);
      const nnP = nnScore(w, elev);
      const risks = [];
      const waRisk = svcRiskFromWa(wa, w);
      if (waRisk) risks.push(waRisk);
      per[s.id] = Object.assign(r, {
        id: s.id, origin: "relay",
        nn: nnP == null ? null : { p: round(nnP, 4), delta: round(nnP - r.probability, 4) },
        time: new Date(ev).toISOString(),
        time_label: hhmmWall(localMs),
        window: svcWindowLocal(win, off),
        confidence: round(confidence(lead, "relay", w), 2),
        reasons: reasons(w, r),
        risks,
        timeline: svcTimelineFor(tlRaw),
        context: {
          cloud_low: Math.round(w.cc_low || 0), cloud_mid: Math.round(w.cc_mid || 0),
          cloud_high: Math.round(w.cc_high || 0),
          cloud_low_up: Math.round(w.cc_low_up || 0),
          aod: w.aod == null ? null : round(w.aod, 3),
          rh: Math.round(w.rh || 0),
          vis_km: w.vis == null ? null : round(w.vis / 1000, 1),
        },
        aux_from: Object.keys(filled).length ? filled : undefined,
        aux_check: wa ? {
          cloud_ours: Math.round(Math.max(w.cc_low || 0, w.cc_mid || 0, w.cc_high || 0)),
          cloud_aux: wa.cloud_total,
          cloud_gap: wa.cloud_total == null ? null
            : Math.round(Math.abs(Math.max(w.cc_low || 0, w.cc_mid || 0, w.cc_high || 0) - wa.cloud_total)),
          vis_aux_km: wa.visibility_km, rh_aux: wa.humidity,
          rain_chance: wa.chance_of_rain, precip_aux: wa.precip_mm,
          condition: wa.condition, time: wa.time,
        } : undefined,
      });
    }

    const ok = Object.values(per).filter(v => !v.error);
    results[mode] = {
      time: new Date(ev).toISOString(),
      time_label: hhmmWall(localMs),
      azimuth: round(az, 1), sun_elev: round(elev, 3),
      sources: per,
      wa_error: waErr,
      consensus: ok.length ? {
        mean: round(ok.reduce((a, v) => a + v.probability, 0) / ok.length, 4),
        min: round(Math.min(...ok.map(v => v.probability)), 4),
        max: round(Math.max(...ok.map(v => v.probability)), 4),
        n: ok.length,
      } : null,
    };
  }

  const waStatus = weatherApiStatus();
  if (waKey) waStatus.samples = waSamples;
  if (waErr) waStatus.error = waErr;

  const payload = {
    location: { name, lat, lon, elevation: bundle.elevation },
    date: dateStr, offset: off, tz: bundle.tz,
    results,
    sources_meta: svcSourcesMeta(),
    weatherapi: waStatus,
    model_version: MODEL.version,
    source: archive ? "ERA5 archive" : "Open-Meteo forecast",
    cache: { hit: false, age: 0, ttl: Store.ttlFor(dateStr) },
    relay: null,
    direct: null, direct_ready: {},
    generated_at: new Date().toISOString(),
  };
  Store.putPoint(lat, lon, dateStr, payload);
  return payload;
}

async function svcOutlook(params) {
  const lat = +params.lat, lon = +params.lon;
  const days = Math.max(1, Math.min(14, +(params.days || 7)));
  const startMs = svcTodayMs();
  const bundle = await fetchBundle(lat, lon, svcIso(startMs), svcIso(startMs + (days + 1) * 86400000), false, null, { skipAq: true });
  const off = bundle.offset;
  const offH = off / 3600;
  const locToday = dateInOffset(Date.now(), off);
  const out = [];
  for (let i = 0; i <= days; i++) {
    const dt = new Date(Date.UTC(locToday.y, locToday.m - 1, locToday.d + i));
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    const dateStr = y + "-" + pad2(m) + "-" + pad2(d);
    const row = { date: dateStr, weekday: "周" + "日一二三四五六"[dt.getUTCDay()] };
    for (const mode of ["sunrise", "sunset"]) {
      const ev = eventTimes(lat, lon, y, m, d, offH, 3, mode)[mode];
      if (ev == null) { row[mode] = null; continue; }
      const pos = solarPosition(lat, lon, ev);
      const az = pos[1];
      const localMs = ev + off * 1000;
      const per = {};
      for (const s of SOURCES) {
        if (!sourceAvailable(bundle.points[0], s.id, localMs)) {
          per[s.id] = { error: "无数据" };
          continue;
        }
        const w = assemble(bundle, localMs, az, s.id);
        const r = assess(w, pos[0], mode, MODEL);
        per[s.id] = { p: r.probability, grade: r.grade, hex: r.colour.hex };
      }
      const ok = Object.values(per).filter(v => !v.error);
      const prim = per.openmeteo && !per.openmeteo.error ? per.openmeteo : (ok[0] || {});
      row[mode] = {
        time: hhmmLocal(ev, off),
        sources: per,
        probability: prim.p == null ? null : prim.p,
        grade: prim.grade, hex: prim.hex,
        spread: ok.length > 1
          ? Math.round((Math.max(...ok.map(v => v.p)) - Math.min(...ok.map(v => v.p))) * 100) : null,
      };
    }
    out.push(row);
  }
  return { days: out, cache: { hit: false, age: 0, ttl: 6 * 3600 } };
}

async function svcAzimuth(params) {
  const lat = +params.lat, lon = +params.lon;
  const dateStr = params.date;
  const mode = params.mode === "sunrise" ? "sunrise" : "sunset";
  const dp = svcDateParts(dateStr);
  const offsetSec = params.offset != null ? +params.offset : 8 * 3600;
  const ev = eventTimes(lat, lon, dp.y, dp.m, dp.d, offsetSec / 3600, 5, mode)[mode];
  if (ev == null) throw new Error("该日无有效时刻");
  const pos = solarPosition(lat, lon, ev);
  const elev = pos[0], sunAz = pos[1];

  const pts = [];
  for (let i = 0; i < 16; i++) {
    const az = i * 22.5;
    for (const dist of AZ_DISTANCES) {
      const la = lat + Math.cos(az * Math.PI / 180) * dist / 111;
      const lo = lon + Math.sin(az * Math.PI / 180) * dist
        / (111 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
      pts.push([round(la, 3), round(lo, 3), i, dist]);
    }
  }
  for (const dist of AZ_TRANSECT) {
    const la = lat + Math.cos(sunAz * Math.PI / 180) * dist / 111;
    const lo = lon + Math.sin(sunAz * Math.PI / 180) * dist
      / (111 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
    pts.push([round(la, 3), round(lo, 3), -1, dist]);
  }

  const url = OM_FORECAST + "?latitude=" + pts.map(p => p[0].toFixed(3)).join(",")
    + "&longitude=" + pts.map(p => p[1].toFixed(3)).join(",")
    + "&start_date=" + dateStr + "&end_date=" + dateStr
    + "&hourly=" + AZ_VARS + "&models=" + MODELS_PARAM + "&timezone=UTC";
  let data = await getJSON(url, CACHE_TTL);
  if (!Array.isArray(data)) data = [data];

  const perSource = {};
  for (const s of SOURCES) {
    const rows = pts.map((p, i) => {
      const h = (data[i] && data[i].hourly) || {};
      const times = h.time || [];
      const get = vn => seriesFor(h, vn, s.tokens);
      return {
        dir: p[2], dist: p[3],
        low: interp(get("cloud_cover_low"), times, ev),
        mid: interp(get("cloud_cover_mid"), times, ev),
        high: interp(get("cloud_cover_high"), times, ev),
        blh: interp(get("boundary_layer_height"), times, ev),
      };
    });
    if (rows.every(r => r.low == null && r.mid == null && r.high == null)) {
      perSource[s.id] = { id: s.id, error: "数据获取失败" };
      continue;
    }
    const dirs = [];
    for (let i = 0; i < 16; i++) {
      const sub = rows.filter(r => r.dir === i);
      let num = 0, den = 0;
      let best = { deck: -1, dist: null, cover: 0 };
      for (const r of sub) {
        const uMid = Math.min(1, (r.mid || 0) / 100);
        const uHigh = Math.min(1, (r.high || 0) / 100);
        const deck = Math.max(1 - Math.exp(-3.7 * uMid), 1 - Math.exp(-3.1 * uHigh));
        const wgt = Math.exp(-Math.pow((r.dist - 200) / 170, 2));
        num += wgt * deck; den += wgt;
        if (deck > best.deck) best = { deck, dist: r.dist, cover: (r.mid || 0) + (r.high || 0) };
      }
      const canvas = den ? num / den : 0;
      const near = sub.filter(r => r.dist <= 140);
      const block = near.length ? Math.max(...near.map(r => r.low || 0)) / 100 : 0;
      const delta = Math.abs((sunAz - i * 22.5 + 180) % 360 - 180);
      const sector = delta < 90 ? Math.pow(Math.cos(delta * Math.PI / 360), 2) : 0;
      const score = 100 * canvas * (1 - 0.7 * block) * (0.22 + 0.78 * sector);
      dirs.push({
        az: i * 22.5, name: DIR_NAMES[i],
        score: round(Math.max(0, Math.min(100, score)), 1),
        dist: best.dist, cover: round(Math.min(100, best.cover), 0),
        canvas: round(canvas, 3), block: round(block, 2),
      });
    }
    const transect = rows.filter(r => r.dir === -1)
      .map(r => ({ dist: r.dist, mid: r.mid, high: r.high, low: r.low, blh: r.blh }));
    const bases = deckBases({ blh: (transect[1] && transect[1].blh) || 600 });
    const h = bases.high;
    const reach = 2 * Math.sqrt(2 * 6371.0 * h);
    let edge = null;
    for (const t of transect) {
      if ((t.high || 0) + (t.mid || 0) >= 50) { edge = t.dist; break; }
    }
    perSource[s.id] = {
      id: s.id, dirs,
      best: dirs.reduce((a, b) => (b.score > a.score ? b : a)),
      transect, cloud_base: h, glow_reach: round(reach), edge,
    };
  }
  const ok = Object.values(perSource).filter(v => !v.error);
  return {
    sun_az: round(sunAz, 1), sun_elev: round(elev, 2),
    sources: perSource,
    failed: Object.keys(perSource).filter(k => perSource[k].error),
    sources_meta: svcSourcesMeta(),
    consensus: ok.length ? {
      best_dir: ok.reduce((a, b) => (b.best.score > a.best.score ? b : a)).best.name,
      score_min: Math.min(...ok.map(v => v.best.score)),
      score_max: Math.max(...ok.map(v => v.best.score)),
    } : null,
    source: "Open-Meteo forecast",
  };
}

const SkyglowService = {
  predict: svcPredict,
  outlook: svcOutlook,
  azimuth: svcAzimuth,
  glowMap: params => SkyglowGlowMap.build(params),
};
