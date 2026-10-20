/* =========================================================================
   GLOWCAST v3「追光航志」· 观测场（局部网格逐点评分）
   口径来源：原版 _p6.js buildLocalGrid / gridName / loadMapData 的 once() 段 ——
   逐语义移植：500 km 半径 / 120 km 间距圆盘（约 57 点），每点三路取数后
   跑同一套 scoreStat / scoreRay / wgeo 综合；样带外点用云场 IDW 插值。
   V3 差异：画布航图渲染（不依赖 TMap），Top3 推荐与窗口从本模块输出推导。
   ========================================================================= */
import {
  clamp, isNum, nz, ymd, destPoint, haversineKm, sunsetSpeedKmph, hexA
} from "./math";
import { sunEvents, sunAltRate, solarPosition } from "./astro";
import {
  buildEnv, scoreStat, scoreRay, primaryDeck, cloudBlockOf, mixedIndex, gradeOf,
  W_ENS, type Env
} from "./scoring";
import { analyseTransect, type TransectPt } from "./physics";
import {
  apiForecastBatched, apiAQBatched, makeSeries, mergeSeries,
  makeMockResponses, API_TZ, type Series
} from "./api";
import { nearestCity, type City } from "./city";
import {
  TRANSECT, MODEL_NAME, F_MAP_VARS, AQ_VARS,
  MAP_RADIUS_KM, MAP_GRID_KM, FIELD_REACH_KM,
  MAP_CACHE_PREFIX, MAP_CACHE_FAMILY, CACHE_TTL, MAP_CACHE_MAX
} from "./consts";
import { rampColor } from "./ramp";

export interface GridPt {
  lat: number; lon: number; name: string; region: string;
}

export interface MapPoint {
  name: string; prov: string; lat: number; lon: number;
  P: number; Q: number;
  p: { ens: number; gfs: number; ec: number | null; rt: number };
  q: { ens: number; gfs: number; ec: number | null; rt: number };
  grade: string; type: string; cover: number; base: number;
  d: number | null; dur: number; aod: number; cld: number;
  T550: number; color: string;
  distKm: number;                  // 距查询点（V3 新增字段，推荐排序用）
}

export interface MapPeriodData {
  pts: MapPoint[]; dateS: string; period: "am" | "pm"; note: string;
}
export interface MapBox {
  am: MapPeriodData; pm: MapPeriodData;
}

/* ---- 网格命名（原版 gridName / coordName 三档命名 + 去重兜底） ---- */
const CITY_NEAR_KM = 60;
function coordName(la: number, lo: number): string {
  return Math.abs(la).toFixed(1) + "°" + (la >= 0 ? "N" : "S") + " "
    + Math.abs(lo).toFixed(1) + "°" + (lo >= 0 ? "E" : "W");
}
function gridName(la: number, lo: number, nc: { city: City; distKm: number } | null, kmStep?: number): string {
  if (!nc) return coordName(la, lo);
  const c = nc.city, km = nc.distKm;
  if (km < 15) return c.name;
  if (km < CITY_NEAR_KM) return c.name + "附近";
  const dx = (lo - c.lon) * Math.cos(la * Math.PI / 180), dy = la - c.lat;
  const DIRS = ["东", "东北", "北", "西北", "西", "西南", "南", "东南"];
  const ang = Math.atan2(dy, dx) * 180 / Math.PI;
  const dir = DIRS[Math.round(((ang + 360) % 360) / 45) % 8];
  const step = kmStep || 10;
  return c.name + " " + dir + " " + (Math.round(km / step) * step) + " km";
}

/** 局部网格（原版 buildLocalGrid：判圆用公里偏移，避免高纬椭圆） */
export function buildLocalGrid(lat: number, lon: number): GridPt[] {
  const dLa = MAP_GRID_KM / 110.574;
  const dLo = MAP_GRID_KM / (111.32 * Math.max(0.15, Math.cos(lat * Math.PI / 180)));
  const nSide = Math.floor(MAP_RADIUS_KM / MAP_GRID_KM);
  const out: GridPt[] = [];
  const ncs: Array<{ city: City; distKm: number } | null> = [];
  for (let i = -nSide; i <= nSide; i++) {
    for (let j = -nSide; j <= nSide; j++) {
      const kx = j * MAP_GRID_KM, ky = i * MAP_GRID_KM;
      if (kx * kx + ky * ky > MAP_RADIUS_KM * MAP_RADIUS_KM + 1e-6) continue;
      const la = clamp(lat + i * dLa, -85, 85);
      const lo = ((lon + j * dLo + 540) % 360) - 180;
      const nc = nearestCity(la, lo);
      ncs.push(nc);
      out.push({
        lat: la, lon: lo,
        name: gridName(la, lo, nc),
        region: nc ? nc.city.region : ""
      });
    }
  }
  const used: Record<string, number> = Object.create(null);
  out.forEach((p, i) => {
    if (used[p.name]) p.name = gridName(p.lat, p.lon, ncs[i], 1);
    used[p.name] = 1;
  });
  return out;
}

/* ---- 缓存（glowcast.v3.map.v1.{date}@{lat,lon}；LRU；结构校验） ---- */
function mapKeyOf(lat: number, lon: number, dateS: string): string {
  return MAP_CACHE_PREFIX + dateS + "@" + lat.toFixed(1) + "," + lon.toFixed(1);
}
export function mapCacheGet(lat: number, lon: number, dateS: string): MapBox | null {
  try {
    const s = localStorage.getItem(mapKeyOf(lat, lon, dateS));
    if (!s) return null;
    const j = JSON.parse(s);
    if (!j || !j.obj || Date.now() - j.ts > CACHE_TTL) return null;
    const probe = (j.obj.pm && j.obj.pm.pts && j.obj.pm.pts[0]) ||
      (j.obj.am && j.obj.am.pts && j.obj.am.pts[0]);
    if (!probe || probe.p === undefined || probe.q === undefined) return null;
    return j.obj as MapBox;
  } catch { return null; }
}
export function mapCachePut(lat: number, lon: number, dateS: string, obj: MapBox): void {
  try {
    localStorage.setItem(mapKeyOf(lat, lon, dateS), JSON.stringify({ ts: Date.now(), obj }));
    mapCacheSweep(lat, lon);
  } catch { /* 配额/隐私模式忽略 */ }
}
/** 淘汰：同族键里非当前坐标、或超出容量的旧条目（键尾 @lat,lon 判据与原版一致） */
function mapCacheSweep(lat: number, lon: number): void {
  const cur = "@" + lat.toFixed(1) + "," + lon.toFixed(1);
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(MAP_CACHE_PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      if (!k.endsWith(cur)) {
        try { localStorage.removeItem(k); } catch { /* ignore */ }
      }
    }
    const mine = keys.filter((k) => k.endsWith(cur));
    if (mine.length > MAP_CACHE_MAX) {
      mine.sort();
      for (const k of mine.slice(0, mine.length - MAP_CACHE_MAX)) {
        try { localStorage.removeItem(k); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}
/** 升版本时清掉同族旧前缀残留（dropStalePrefixFamily 同构） */
export function dropStaleMapFamily(): void {
  try {
    const dead: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(MAP_CACHE_FAMILY) && !k.startsWith(MAP_CACHE_PREFIX)) dead.push(k);
    }
    dead.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

/* ---- 取数 + 逐点评分（原版 loadMapData 的计算段） ---- */
export async function loadMapField(opts: {
  lat: number; lon: number; dateS: string;
  pts?: GridPt[];
  onStep?: (txt: string) => void;
  useMock?: boolean;
}): Promise<MapBox> {
  const { lat, lon, dateS } = opts;
  const [Y, M, D] = dateS.split("-").map(Number);
  const dayMs = Date.UTC(Y, M - 1, D);
  const ptList = opts.pts || buildLocalGrid(lat, lon);
  const cityPts = ptList.map((c) => ({ lat: c.lat, lon: c.lon }));

  const meta = ptList.map((c) => {
    const ev = sunEvents(dayMs, c.lat, c.lon);
    const fix = (m: number | null) => (m == null ? ev.noonMs + 12 * 3600000 : m);
    const riseMs = fix(ev.riseMs), setMs = fix(ev.setMs);
    return {
      city: c, riseMs, setMs,
      azR: solarPosition(riseMs, c.lat, c.lon).azimuth,
      azS: solarPosition(setMs, c.lat, c.lon).azimuth,
      v: sunsetSpeedKmph(Math.abs(c.lat), new Date(dayMs)),
      omR: sunAltRate(riseMs, c.lat, c.lon),
      omS: sunAltRate(setMs, c.lat, c.lon)
    };
  });

  let gD: Array<Record<string, unknown>>;
  let eD2: Array<Record<string, unknown>> | null;
  let aD: Array<Record<string, unknown>> | null;
  const sD = dateS, eD = dateS;
  if (opts.useMock) {
    gD = makeMockResponses(cityPts, sD, 2, F_MAP_VARS);
    eD2 = makeMockResponses(cityPts, sD, 2, F_MAP_VARS);
    aD = makeMockResponses(cityPts, sD, 2, AQ_VARS);
  } else {
    try {
      opts.onStep?.("GFS");
      gD = await apiForecastBatched(MODEL_NAME.gfs, cityPts, sD, eD, API_TZ, F_MAP_VARS);
      opts.onStep?.("EC");
      eD2 = await apiForecastBatched(MODEL_NAME.ec, cityPts, sD, eD, API_TZ, F_MAP_VARS).catch(() => null);
      opts.onStep?.("AOD");
      aD = await apiAQBatched(cityPts, sD, eD, API_TZ).catch(() => null);
    } catch {
      gD = makeMockResponses(cityPts, sD, 2, F_MAP_VARS);
      eD2 = makeMockResponses(cityPts, sD, 2, F_MAP_VARS);
      aD = makeMockResponses(cityPts, sD, 2, AQ_VARS);
    }
  }

  const sG = gD.map(makeSeries);
  const sE = eD2 ? eD2.map(makeSeries) : null;
  const sA = aD ? aD.map(makeSeries) : null;
  const sM: Array<Series | null> = sG.map((g, i) => mergeSeries(g, sE ? sE[i] : null));

  const fieldAt = (sers: Array<Series | null>, key: string, ms: number) =>
    sers.map((s) => (s ? s.at(key, ms) : null));
  const idwPlan = (la: number, lo: number) => {
    const idx: number[] = [], w: number[] = [];
    let sw = 0, near = 1e9, best = -1;
    for (let i = 0; i < cityPts.length; i++) {
      const d = haversineKm(la, lo, cityPts[i].lat, cityPts[i].lon);
      if (d < near) { near = d; best = i; }
      if (d < 1e-6) return { exact: i };
      const ww = 1 / (d * d);
      idx.push(i); w.push(ww); sw += ww;
    }
    return near > FIELD_REACH_KM ? null : { idx, w, sw, best };
  };
  const idwOf = (
    plan: { exact?: number; idx?: number[]; w?: number[]; sw?: number } | null,
    vals: Array<number | null>
  ): number | null => {
    if (!plan) return null;
    if (plan.exact != null) return vals[plan.exact];
    const idx = plan.idx || [], w = plan.w || [];
    let sw = 0, sv = 0;
    for (let j = 0; j < idx.length; j++) {
      const v = vals[idx[j]];
      if (!isNum(v)) continue;
      sw += w[j]; sv += w[j] * v;
    }
    return sw ? sv / sw : null;
  };

  const notes: string[] = [];
  if (!sE) notes.push("ECMWF-IFS 模式本次未能取到数据");
  if (!sA) notes.push("气溶胶（AOD）数据缺失，已按默认值 0.25 估算");
  const note = notes.join("；");

  const box: MapBox = {
    am: { pts: [], dateS, period: "am", note },
    pm: { pts: [], dateS, period: "pm", note }
  };

  const once = (
    ci: number, evMs: number, om: number, az: number
  ): MapPoint | null => {
    const trOf = (sers: Array<Series | null> | null): TransectPt[] | null => {
      if (!sers || !sers[ci]) return null;
      const base = meta[ci].city;
      const cv = (k: string) => (sers[ci] as Series).at(k, evMs);
      const rows: TransectPt[] = [{
        d: 0, cLow: cv("cloud_cover_low"), cMid: cv("cloud_cover_mid"), cHigh: cv("cloud_cover_high"),
        vis: cv("visibility"), rh: cv("relative_humidity_2m"), aod: null
      }];
      for (let i = 1; i < TRANSECT.length; i++) {
        const d = TRANSECT[i];
        const tp = destPoint(base.lat, base.lon, az, d);
        const plan = idwPlan(tp.lat, tp.lon);
        rows.push({
          d,
          cLow: idwOf(plan, fieldAt(sers, "cloud_cover_low", evMs)),
          cMid: idwOf(plan, fieldAt(sers, "cloud_cover_mid", evMs)),
          cHigh: idwOf(plan, fieldAt(sers, "cloud_cover_high", evMs)),
          vis: idwOf(plan, fieldAt(sers, "visibility", evMs)),
          rh: null, aod: null
        });
      }
      return rows;
    };
    const sAod = (a: Array<Series | null> | null) =>
      (a && a[ci]) ? (a[ci] as Series).at("aerosol_optical_depth", evMs) : null;
    const trG = trOf(sG), trE = trOf(sE), trM = trOf(sM);
    if (!trG) return null;
    const aodUse = isNum(sAod(sA)) ? clamp(sAod(sA) as number, 0.005, 5) : 0.25;
    [trG, trE, trM].forEach((tr) => { if (tr) tr.forEach((x) => { x.aod = aodUse; }); });
    const envOf = (sers: Array<Series | null>): Env => {
      const env = buildEnv(sers && sers[ci] ? sers[ci] : null, evMs);
      env.aod = aodUse;
      return env;
    };
    const envG = envOf(sG), envE = sE ? envOf(sE) : null, envM = envOf(sM);
    if (envE) {
      (["fz", "blh", "vis", "cape", "precip"] as const).forEach((k) => {
        const e = envE as unknown as Record<string, number | null>;
        const g = envG as unknown as Record<string, number | null>;
        if (!isNum(e[k]) && isNum(g[k])) e[k] = g[k];
      });
    }
    const cld = cloudBlockOf(envM);
    const ctx = { v: meta[ci].v, omega: om, aod: aodUse, dP: null };
    const rt = scoreRay(envM, analyseTransect(trM, primaryDeck(envM).primary.key as "cLow" | "cMid" | "cHigh"), ctx);
    const sGs = scoreStat(envG, analyseTransect(trG, primaryDeck(envG).primary.key as "cLow" | "cMid" | "cHigh"), ctx);
    const sEs = envE ? scoreStat(envE, analyseTransect(trE, primaryDeck(envE).primary.key as "cLow" | "cMid" | "cHigh"), ctx) : null;
    const p = { ens: 0, gfs: sGs.P, ec: sEs ? sEs.P : null, rt: rt.P };
    const q = { ens: 0, gfs: sGs.Q, ec: sEs ? sEs.Q : null, rt: rt.Q };
    const parts: Array<[number, number]> = [[sGs.P, W_ENS.gfs]];
    const partsQ: Array<[number, number]> = [[sGs.Q, W_ENS.gfs]];
    if (sEs) { parts.push([sEs.P, W_ENS.ec]); partsQ.push([sEs.Q, W_ENS.ec]); }
    parts.push([rt.P, W_ENS.rt]); partsQ.push([rt.Q, W_ENS.rt]);
    const P = wgeo(parts), Q = wgeo(partsQ);
    p.ens = P; q.ens = Q;
    return {
      name: meta[ci].city.name, prov: meta[ci].city.region,
      lat: meta[ci].city.lat, lon: meta[ci].city.lon,
      P, Q, p, q, grade: gradeOf(Q), type: rt.primary.type, cover: rt.primary.cover,
      base: rt.primary.base, d: rt.d, dur: rt.geom.dur, aod: aodUse, cld,
      T550: rt.peak.T550,
      color: hexA(rampColor(mixedIndex(P, Q)), 0.95),
      distKm: haversineKm(lat, lon, meta[ci].city.lat, meta[ci].city.lon)
    };
  };

  meta.forEach((m, ci) => {
    const pm = once(ci, m.setMs, m.omS, m.azS);
    const am = once(ci, m.riseMs, m.omR, m.azR);
    if (pm) box.pm.pts.push(pm);
    if (am) box.am.pts.push(am);
  });
  return box;
}

function wgeo(items: Array<[number, number]>): number {
  let e = 0, s = 0;
  for (const [v, w] of items) {
    if (!isNum(v)) continue;
    s += w;
    e += w * Math.log(Math.max(v, 0.02));
  }
  return s > 0 ? Math.exp(e / s) : 0;
}

/** 快路径：内存/磁盘缓存 → 场数据；miss 时 cacheOnly=true 只查不取 */
export function mapFieldCacheOnly(
  lat: number, lon: number, dateS: string
): MapBox | null {
  return mapCacheGet(lat, lon, dateS);
}
