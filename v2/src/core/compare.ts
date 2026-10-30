/* =========================================================================
   SUNGLOW v2 · 多观测点对比（2026-10-21）
   场景：同一天同一时段，多个地点的霞光条件横向排行榜（grill 拍板）。
   纪律：
   · 当前地点自动加入第一张卡，复用主结果，零取数，不占 4 个名额。
   · 地图选点：观测场该日期已加载时直接用 MapPoint，零额度。
   · 搜索 / 经纬度：走 runForecast（缓存优先），每点 ≈51 次加权调用。
   · 取数三档与全局一致：auto 只看缓存绝不取数 / click 缓存优先 / force 绕开。
   · 列表持久化 SUNGLOW.v2.cmp.v1（与 pref 分键），「清空对比」才清。
   ========================================================================= */
import { ref } from "vue";
import {
  runForecast, pointCacheGet, pointCacheAge,
  type ForecastResult
} from "./forecast";
import { ensConfOf, mixedIndex, type EnsBand } from "./scoring";
import { isNum } from "./math";
import type { MapPoint } from "./mapdata";
import type { City } from "./city";

export const CMP_KEY = "SUNGLOW.v2.cmp.v1";
export const CMP_MAX = 4;

export interface ComparePt {
  name: string;
  prov: string;
  lat: number;
  lon: number;
  src: "search" | "ll" | "map";
}

/* ---- 列表（跨组件共享：MapView 加点、ComparePanel 展示） ---- */
function readList(): ComparePt[] {
  try {
    const raw = localStorage.getItem(CMP_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (x): x is ComparePt =>
          !!x && typeof (x as ComparePt).lat === "number" &&
          typeof (x as ComparePt).lon === "number" &&
          typeof (x as ComparePt).name === "string" &&
          ["search", "ll", "map"].includes((x as ComparePt).src)
      )
      .slice(0, CMP_MAX);
  } catch {
    return [];
  }
}

export const cmpList = ref<ComparePt[]>(readList());
export const cmpFlash = ref(""); /* 加入/满员/重复 的瞬时提示 */

function persist() {
  try {
    localStorage.setItem(CMP_KEY, JSON.stringify(cmpList.value));
  } catch { /* 存储满等：忽略，列表仍在内存 */ }
}

const samePt = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.abs(a.lat - b.lat) < 0.005 && Math.abs(a.lon - b.lon) < 0.005;

export function addCmpPt(p: ComparePt): "ok" | "dup" | "full" {
  if (cmpList.value.some((x) => samePt(x, p))) return "dup";
  if (cmpList.value.length >= CMP_MAX) return "full";
  cmpList.value = [...cmpList.value, p];
  persist();
  return "ok";
}
export function removeCmpPt(i: number) {
  cmpList.value = cmpList.value.filter((_, k) => k !== i);
  persist();
}
export function clearCmp() {
  cmpList.value = [];
  persist();
}

/* ---- 展示行：两个数据来源统一成一个形状 ---- */
export interface CompareRow {
  /** 排序键：综合分 0–100（= mixedIndex 同口径） */
  score: number;
  grade: string;
  P: number;
  Q: number;
  type: string;
  cover: number;
  /** 三层云量 [低, 中, 高] —— 云型长格式；地图点/主结果都带，缺失显云型名 */
  covers: [number, number, number] | null;
  /** 霞色名（词典键），空串表示缺数 */
  color: string;
  /** 持续分钟数 */
  dur: number | null;
  dvI: number | null;
  conf: EnsBand | null;
  /** 数据来源标签（词典键） */
  origin: string;
  /** 是否免费来源（主结果 / 地图选点） */
  free: boolean;
  /** 缓存状态：null = 主结果实时；true/false = 取数路径 */
  fromCache: boolean | null;
  ageMs: number | null;
  missing: boolean;
  pt: ComparePt | null; /* 主地点为 null */
}

export function rowFromResult(r: ForecastResult, origin: string, free: boolean, pt: ComparePt | null = null): CompareRow {
  return {
    score: mixedIndex(r.P, r.Q),
    grade: r.grade,
    P: r.P,
    Q: r.Q,
    type: r.sRT.primary.type,
    cover: r.sRT.primary.cover,
    covers: r.sRT.decks && r.sRT.decks.length >= 3
      ? [r.sRT.decks[0].cover, r.sRT.decks[1].cover, r.sRT.decks[2].cover]
      : null,
    color: r.sRT.peak && r.sRT.peak.name ? r.sRT.peak.name : "",
    dur: isNum(r.sRT.geom?.dur) ? r.sRT.geom.dur : null,
    dvI: r.dvI,
    conf: r.conf,
    origin,
    free,
    fromCache: r.src === "cache" ? true : r.src === "live" ? false : null,
    ageMs: r.src === "cache" ? pointCacheAge(r.city.lat, r.city.lon, r.dateStr, r.period) : null,
    missing: false,
    pt
  };
}

export function rowFromMapPoint(mp: MapPoint): CompareRow {
  const dv = divergeLike(mp);
  return {
    score: mixedIndex(mp.P, mp.Q),
    grade: mp.grade,
    P: mp.P,
    Q: mp.Q,
    type: mp.type,
    cover: mp.cover,
    covers: mp.covers ?? null,
    color: mp.color || "",
    dur: isNum(mp.dur) ? mp.dur : null,
    dvI: dv,
    conf: dv == null ? null : ensConfOf(dv),
    origin: "地图选点",
    free: true,
    fromCache: null,
    ageMs: null,
    missing: false,
    pt: { name: mp.name, prov: mp.prov, lat: mp.lat, lon: mp.lon, src: "map" }
  };
}

/** 与 mapdata.divergeOf 同口径（不引入对 MapView 的依赖） */
function divergeLike(mp: MapPoint): number | null {
  const cand: Array<[number | null, number | null]> = [
    [mp.p.gfs, mp.q.gfs],
    [mp.p.ec, mp.q.ec],
    [mp.p.rt, mp.q.rt]
  ];
  let lo = Infinity, hi = -Infinity, n = 0;
  for (const [P, Q] of cand) {
    if (!isNum(P) || !isNum(Q)) continue;
    const v = mixedIndex(P, Q);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    n++;
  }
  return n >= 2 ? hi - lo : null;
}

export function rowMissing(pt: ComparePt): CompareRow {
  return {
    score: NaN, grade: "", P: NaN, Q: NaN, type: "", cover: NaN, covers: null, color: "",
    dur: null, dvI: null, conf: null,
    origin: pt.src === "search" ? "搜索" : pt.src === "ll" ? "经纬度" : "地图选点",
    free: false, fromCache: null, ageMs: null, missing: true, pt
  };
}

/* ---- 单点取数（三档语义与全局一致） ----
   auto : 只看缓存，绝不发请求；未命中返回 missing
   click: 缓存优先（runForecast 内建），未命中才取数
   force: 绕开缓存 */
export async function ensureRow(
  pt: ComparePt,
  opts: {
    dateStr: string;
    period: "am" | "pm";
    mode: "auto" | "click" | "force";
    stillCurrent: () => boolean;
  }
): Promise<CompareRow> {
  const { dateStr, period, mode, stillCurrent } = opts;
  const city: City = { name: pt.name, region: pt.prov, lat: pt.lat, lon: pt.lon };
  if (mode === "auto") {
    const hit = pointCacheGet(pt.lat, pt.lon, dateStr, period);
    if (hit && stillCurrent()) return rowFromResult({ ...hit, src: "cache" }, originOf(pt), false, pt);
    return rowMissing(pt);
  }
  const r = await runForecast({ city, dateStr, period, force: mode === "force" });
  if (!stillCurrent()) return rowMissing(pt);
  if (!r.ok) return rowMissing(pt);
  return rowFromResult(r, originOf(pt), false, pt);
}

export function originOf(pt: ComparePt): string {
  return pt.src === "search" ? "搜索" : pt.src === "ll" ? "经纬度" : "地图选点";
}
