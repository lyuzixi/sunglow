/* =========================================================================
   GLOWCAST v2 · 地图数据层（口径与原版 _p6.js 对齐）
   57 点局部网格 / 缓存 v6 语义 / 四维度取值 / IDW / 云量淡纹。
   原版基准：MAP_RADIUS_KM=500、MAP_GRID_KM=120、缓存 sunsetbot.map.v6.。
   v2 存储族：glowcast.v2.map.v6.*（独立命名空间，同版本语义）。
   ========================================================================= */
import {
  clamp, isNum, nz, haversineKm, destPoint, wgeo
} from "./math";
import { solarPosition, sunEvents, sunAltRate } from "./astro";
import {
  buildEnv, scoreStat, scoreRay, gradeOf, mixedIndex, W_ENS, API_TZ, primaryDeckOf
} from "./scoring";
import { analyseTransect, cloudBlockOf } from "./physics";
import { makeSeries, mergeSeries, type Series } from "./series";

/* ---- 网格参数（与原版一致） ---- */
export const MAP_RADIUS_KM = 500;
export const MAP_GRID_KM = 120;
export const MAP_KEEP_KM = MAP_GRID_KM;
export const MAP_FOLLOW_ZOOM = 6;
export const MAP_TZ = API_TZ;

/* ---- 值场参数（与原版一致） ---- */
export const FIELD_OUT_KM = 70;      // 凸包外羽化长度
export const EDGE_NOISE_KM = 26;     // 羽化边缘有机噪声
export const FIELD_REACH_KM = 120;   // IDW 最远可信距离
export const FIELD_FULL = 90;        // 完全可信距离
export const MAP_IDW_MAX = FIELD_REACH_KM;
export const CITY_NEAR_KM = 60;
export const DV_MODELS = ["gfs", "ec", "rt"] as const;

/* ---- 样带（与单点同构 0…400 km / 17 点） ---- */
export const TRANSECT = [
  0, 25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400
];

/* ---- 缓存（v6 语义：键带坐标 + 版本族清理 + LRU） ---- */
export const MAP_CACHE_PREFIX = "glowcast.v2.map.v6.";
export const MAP_CACHE_FAMILY = "glowcast.v2.map.";
export const MAP_CACHE_TTL = 3 * 3600000;
export const MAP_CACHE_MAX = 6;

export function mapKeyOf(dateS: string, lat: number, lon: number): string {
  return MAP_CACHE_PREFIX + dateS + "@" + lat.toFixed(1) + "," + lon.toFixed(1);
}

export interface MapPoint {
  name: string; prov: string;
  lat: number; lon: number;
  P: number; Q: number;
  p: { ens: number; gfs: number | null; ec: number | null; rt: number };
  q: { ens: number; gfs: number | null; ec: number | null; rt: number };
  grade: string; type: string; cover: number;
  base: number; d: number | null; dur: number;
  aod: number; cld: number; T550: number;
  color: string;
}
export interface MapPeriodBox {
  pts: MapPoint[]; dateS: string; period: "am" | "pm"; note: string;
}
export interface MapDateBox {
  am: MapPeriodBox; pm: MapPeriodBox;
}

export function mapCacheGet(dateS: string, lat: number, lon: number): MapDateBox | null {
  try {
    const s = localStorage.getItem(mapKeyOf(dateS, lat, lon));
    if (!s) return null;
    const j = JSON.parse(s);
    if (!j || !j.obj || Date.now() - j.ts > MAP_CACHE_TTL) return null;
    const probe =
      (j.obj.pm && j.obj.pm.pts && j.obj.pm.pts[0]) ||
      (j.obj.am && j.obj.am.pts && j.obj.am.pts[0]);
    if (!probe || !probe.p || !probe.q) return null;
    return j.obj;
  } catch {
    return null;
  }
}

export function mapCachePut(
  dateS: string, lat: number, lon: number, obj: MapDateBox, stillWanted: () => boolean
): void {
  const run = () => {
    if (!stillWanted()) return;
    try {
      localStorage.setItem(mapKeyOf(dateS, lat, lon), JSON.stringify({ ts: Date.now(), obj }));
      mapCacheSweep(lat, lon);
    } catch { /* 配额不足 */ }
  };
  if (typeof requestIdleCallback === "function")
    (window as unknown as { requestIdleCallback: (f: () => void, o?: object) => void })
      .requestIdleCallback(run, { timeout: 250 });
  else setTimeout(run, 0);
}

/** 键族清理：升版本时清掉上一版残留；LRU 保留最近 MAP_CACHE_MAX 条（豁免当前地点） */
export function mapCacheSweep(lat?: number, lon?: number): void {
  try {
    const keep: Array<{ k: string; ts: number }> = [];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (!k.startsWith(MAP_CACHE_FAMILY)) continue;
      if (!k.startsWith(MAP_CACHE_PREFIX)) {
        localStorage.removeItem(k); // 上一版残留
        continue;
      }
      let ts = 0;
      try {
        const j = JSON.parse(localStorage.getItem(k) || "null");
        ts = j && j.ts ? j.ts : 0;
      } catch { /* 坏条目直接删 */ }
      const cur = lat != null && k.endsWith("@" + lat.toFixed(1) + "," + (lon ?? 0).toFixed(1));
      if (cur) continue; // 当前地点豁免
      keep.push({ k, ts });
    }
    keep.sort((a, b) => b.ts - a.ts);
    for (let i = MAP_CACHE_MAX; i < keep.length; i++) localStorage.removeItem(keep[i].k);
  } catch { /* 隐私模式 */ }
}

/* ---- 点位命名（gridName 三档） ---- */
function gridName(
  la: number, lo: number,
  nc: { city: { name: string; lon: number; lat: number }; distKm: number } | null,
  kmStep = 10
): string {
  if (!nc) return la.toFixed(2) + "," + lo.toFixed(2);
  const c = nc.city, km = nc.distKm;
  if (km < 15) return c.name;
  if (km < CITY_NEAR_KM) return c.name + "附近";
  const dx = (lo - c.lon) * Math.cos((la * Math.PI) / 180), dy = la - c.lat;
  const DIRS = ["东", "东北", "北", "西北", "西", "西南", "南", "东南"];
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const dir = DIRS[Math.round(((ang + 360) % 360) / 45) % 8];
  return c.name + " " + dir + " " + Math.round(km / kmStep) * kmStep + " km";
}

export interface GridPt {
  lat: number; lon: number; name: string; prov: string;
  [k: string]: unknown;
}

/** 57 点局部网格（判圆用公里偏移，与原版 buildLocalGrid 一致） */
export function buildLocalGrid(
  lat: number, lon: number,
  nearest: (la: number, lo: number) => { city: { name: string; lon: number; lat: number; region?: string }; distKm: number } | null
): GridPt[] {
  const dLa = MAP_GRID_KM / 110.574;
  const dLo = MAP_GRID_KM / (111.32 * Math.max(0.15, Math.cos((lat * Math.PI) / 180)));
  const nSide = Math.floor(MAP_RADIUS_KM / MAP_GRID_KM);
  const out: GridPt[] = [];
  const names: string[] = [];
  for (let i = -nSide; i <= nSide; i++) {
    for (let j = -nSide; j <= nSide; j++) {
      const kx = j * MAP_GRID_KM, ky = i * MAP_GRID_KM;
      if (kx * kx + ky * ky > MAP_RADIUS_KM * MAP_RADIUS_KM + 1e-6) continue;
      const la = clamp(lat + i * dLa, -85, 85);
      const lo = ((lon + j * dLo + 540) % 360) - 180;
      const nc = nearest(la, lo);
      let name = gridName(la, lo, nc, 10);
      /* 撞名去重：同名后来者退回 1 km 精度 */
      if (names.indexOf(name) >= 0) name = gridName(la, lo, nc, 1);
      names.push(name);
      out.push({
        lat: la, lon: lo, name,
        prov: nc && nc.city.region ? nc.city.region : ""
      });
    }
  }
  return out;
}

/* ---- 模型取值与分歧（与原版一致） ---- */
export function modelP(o: { p?: Record<string, number | null> }, mk: string): number | null {
  return o && o.p ? (isNum(o.p[mk]) ? (o.p[mk] as number) : null) : null;
}
export function modelQ(o: { q?: Record<string, number | null> }, mk: string): number | null {
  return o && o.q ? (isNum(o.q[mk]) ? (o.q[mk] as number) : null) : null;
}
export function divergeOf(o: {
  p?: Record<string, number | null>; q?: Record<string, number | null>;
}): number | null {
  let lo = Infinity, hi = -Infinity, n = 0;
  for (const k of DV_MODELS) {
    const P = modelP(o, k), Q = modelQ(o, k);
    if (!isNum(P) || !isNum(Q)) continue;
    const v = mixedIndex(P, Q);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    n++;
  }
  return n >= 2 ? hi - lo : null;
}
export type MapDim = "mix" | "p" | "q" | "dv";
export function dimOf(o: MapPoint, dim: MapDim, mk = "ens"): number | null {
  if (dim === "dv") return divergeOf(o);
  const P = modelP(o, mk), Q = modelQ(o, mk);
  if (dim === "p") return P;
  if (dim === "q") return Q;
  if (isNum(P) && isNum(Q)) return mixedIndex(P, Q);
  return isNum(P) ? P : Q;
}
export function currentModel(
  d: { pts?: MapPoint[] }, want: string
): string {
  if (!d || !d.pts) return "ens";
  const n = (mk: string) =>
    d.pts!.filter((o) =>
      mk === "ens"
        ? isNum(o.P) || isNum(modelP(o, "ens"))
        : isNum(modelP(o, mk)) && isNum(modelQ(o, mk))
    ).length;
  return n(want) > 0 ? want : "ens";
}

/* ---- IDW（反距离平方加权，仅累加有值点） ---- */
export interface IdwPlan {
  exact?: number; idx?: number[]; w?: number[]; sw?: number; best?: number;
}
export function idwPlan(
  lat: number, lon: number, pts: Array<{ lat: number; lon: number }>
): IdwPlan | null {
  const idx: number[] = [], w: number[] = [];
  let sw = 0, near = 1e9, best = -1;
  for (let i = 0; i < pts.length; i++) {
    const d = haversineKm(lat, lon, pts[i].lat, pts[i].lon);
    if (d < near) { near = d; best = i; }
    if (d < 1e-6) return { exact: i };
    const ww = 1 / (d * d);
    idx.push(i); w.push(ww); sw += ww;
  }
  return near > MAP_IDW_MAX ? null : { idx, w, sw, best };
}
export function idwOf(plan: IdwPlan | null, vals: Array<number | null>): number | null {
  if (!plan) return null;
  if (plan.exact != null) return vals[plan.exact];
  let sw = 0, sv = 0;
  const idx = plan.idx!, w = plan.w!;
  for (let j = 0; j < idx.length; j++) {
    const v = vals[idx[j]];
    if (!isNum(v)) continue;
    sw += w[j]; sv += w[j] * v;
  }
  return sw ? sv / sw : null;
}

/* ---- 云量淡纹：低云 + 中云×0.85 合成遮挡（0–100），与色面综合口径同源 ---- */
export { cloudBlockOf };

/* ---- 网格点评分（与原版 loadMapData 的 once() 同构） ---- */
export interface PointMeta {
  city: GridPt;
  riseMs: number; setMs: number;
  azR: number; azS: number;
  v: number; omR: number; omS: number;
}

export function scoreGridPoint(
  ci: number,
  evMs: number, om: number, az: number,
  meta: PointMeta[],
  sG: (Series | null)[],
  sE: (Series | null)[] | null,
  sM: (Series | null)[],
  sA: (Series | null)[] | null
): MapPoint | null {
  const cityPts = meta.map((m) => ({ lat: m.city.lat, lon: m.city.lon }));
  const fieldAt = (sers: (Series | null)[], key: string, ms: number) =>
    sers.map((s) => (s ? s.at(key, ms) : null));
  const trOf = (sers: (Series | null)[] | null) => {
    if (!sers || !sers[ci]) return null;
    const base = meta[ci].city;
    const cv = (k: string) => sers[ci]!.at(k, evMs);
    const rows = [
      {
        d: 0,
        cLow: cv("cloud_cover_low"), cMid: cv("cloud_cover_mid"),
        cHigh: cv("cloud_cover_high"),
        vis: cv("visibility"), rh: cv("relative_humidity_2m"), aod: null as number | null
      }
    ];
    for (let i = 1; i < TRANSECT.length; i++) {
      const d = TRANSECT[i];
      const tp = destPoint(base.lat, base.lon, az, d);
      const plan = idwPlan(tp.lat, tp.lon, cityPts);
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
  const sAod = (a: (Series | null)[] | null) =>
    a && a[ci] ? a[ci]!.at("aerosol_optical_depth", evMs) : null;
  const trG = trOf(sG), trE = trOf(sE), trM = trOf(sM);
  if (!trG) return null;
  const aodUse = isNum(sAod(sA)) ? clamp(sAod(sA) as number, 0.005, 5) : 0.25;
  [trG, trE, trM].forEach((tr) => {
    if (tr) tr.forEach((x) => { x.aod = aodUse; });
  });
  const envOf = (sers: (Series | null)[] | null) => {
    const env = buildEnv(sers && sers[ci] ? sers[ci] : null, evMs);
    env.aod = aodUse;
    return env;
  };
  const envG = envOf(sG), envE = sE ? envOf(sE) : null, envM = envOf(sM);
  if (envE)
    (["fz", "blh", "vis", "cape", "precip"] as const).forEach((k) => {
      if (!isNum(envE[k]) && isNum(envG[k])) envE[k] = envG[k];
    });
  const cld = cloudBlockOf(envM);
  const ctx = { v: meta[ci].v, omega: om, aod: aodUse, dP: null };
  const lv = (o: { primary: { key: string } }) =>
    o.primary.key as "cLow" | "cMid" | "cHigh";
  const rt = scoreRay(envM, analyseTransect(trM, lv(primaryDeckOf(envM))), ctx);
  const sGs = scoreStat(envG, analyseTransect(trG, lv(primaryDeckOf(envG))), ctx);
  const sEs = envE
    ? scoreStat(envE, analyseTransect(trE, lv(primaryDeckOf(envE))), ctx)
    : null;
  const p = { ens: 0, gfs: sGs.P, ec: sEs ? sEs.P : null, rt: rt.P };
  const q = { ens: 0, gfs: sGs.Q, ec: sEs ? sEs.Q : null, rt: rt.Q };
  const parts: Array<[number, number]> = [[sGs.P, W_ENS.gfs]];
  if (sEs) parts.push([sEs.P, W_ENS.ec]);
  parts.push([rt.P, W_ENS.rt]);
  const partsQ: Array<[number, number]> = [[sGs.Q, W_ENS.gfs]];
  if (sEs) partsQ.push([sEs.Q, W_ENS.ec]);
  partsQ.push([rt.Q, W_ENS.rt]);
  const P = wgeo(parts);
  const Q = wgeo(partsQ);
  p.ens = P; q.ens = Q;
  return {
    name: meta[ci].city.name, prov: meta[ci].city.prov,
    lat: meta[ci].city.lat, lon: meta[ci].city.lon,
    P, Q, p, q,
    grade: gradeOf(Q),
    type: rt.primary.type, cover: rt.primary.cover,
    base: rt.primary.base, d: rt.d, dur: rt.geom.dur,
    aod: aodUse, cld,
    T550: rt.peak.T550,
    color: ""
  };
}

/** 逐点生成 meta（事件时刻/方位/速度/高度角变化率） */
export function buildPointMeta(dayMs: number, pts: GridPt[]): PointMeta[] {
  return pts.map((c) => {
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
}

/* 日出日落线速度查表（与原版 _p2.js 一致） */
const SPD_LAT = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
const SPD_TAB = [
  [21.6,22.6,23.2,22.9,21.9,21.3,21.6,22.5,23.1,22.9,22.0,21.3],
  [21.5,22.5,23.1,22.8,21.8,21.2,21.4,22.4,23.1,22.8,21.9,21.2],
  [21.2,22.3,22.8,22.5,21.6,20.9,21.2,22.1,22.8,22.6,21.6,20.9],
  [20.8,21.8,22.4,22.1,21.1,20.4,20.7,21.6,22.3,22.1,21.2,20.5],
  [20.1,21.2,21.8,21.4,20.4,19.7,20.0,21.0,21.7,21.5,20.5,19.8],
  [19.3,20.4,21.0,20.6,19.6,18.9,19.1,20.2,21.0,20.7,19.7,18.9],
  [18.3,19.4,20.1,19.7,18.6,17.8,18.1,19.2,20.0,19.8,18.7,17.9],
  [17.1,18.3,19.0,18.6,17.4,16.6,16.9,18.1,18.9,18.7,17.6,16.7],
  [15.7,17.1,17.8,17.3,16.1,15.1,15.5,16.8,17.7,17.4,16.2,15.3],
  [14.2,15.6,16.4,15.9,14.5,13.5,13.9,15.3,16.3,16.1,14.7,13.7],
  [12.4,14.1,14.9,14.4,12.8,11.6,12.1,13.7,14.8,14.5,13.1,11.9],
  [10.5,12.4,13.3,12.7,10.9,9.5,10.0,11.9,13.2,12.9,11.2,9.8],
  [8.2,10.5,11.6,10.9,8.7,6.8,7.6,10.0,11.5,11.1,9.1,7.4]
];
export function sunsetSpeedKmph(absLat: number, dateUTC: Date): number {
  const m = dateUTC.getUTCMonth() + 1;
  const d = dateUTC.getUTCDate();
  const colF = m - 1 + clamp((d - 15) / 30, -0.5, 0.5);
  const c0 = clamp(Math.floor(colF), 0, 11), c1 = clamp(c0 + 1, 0, 11), tc = clamp(colF - c0, 0, 1);
  const la = clamp(absLat, 0, 60);
  let r0 = 0, r1 = 1;
  for (let i = 1; i < SPD_LAT.length; i++)
    if (la <= SPD_LAT[i]) { r0 = i - 1; r1 = i; break; }
  const tr = SPD_LAT[r1] === SPD_LAT[r0] ? 0 : (la - SPD_LAT[r0]) / (SPD_LAT[r1] - SPD_LAT[r0]);
  const v0 = SPD_TAB[r0][c0] + (SPD_TAB[r0][c1] - SPD_TAB[r0][c0]) * tc;
  const v1 = SPD_TAB[r1][c0] + (SPD_TAB[r1][c1] - SPD_TAB[r1][c0]) * tc;
  let v = v0 + (v1 - v0) * tr;
  if (absLat > 60)
    v = Math.max(4, (v * Math.cos((clamp(absLat, 60, 80) * Math.PI) / 180)) / Math.cos((60 * Math.PI) / 180));
  return v;
}

export { makeSeries, mergeSeries };
export type { Series };
