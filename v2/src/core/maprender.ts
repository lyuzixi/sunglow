/* =========================================================================
   SUNGLOW v2 · 地图图层渲染（2026-10-22 整体重做，同日二次返工色面形态）
   -------------------------------------------------------------------------
   与V1 _p6.js 的分歧点（都是用户拍板的「真实准确」要求）：
   ① **场重建**：IDW（核宽写死 1/(d²+120²)）→ **自适应核 Shepard**
      （modified Shepard / Franke–Little，核半径 = 第 K 近邻距离）。
      IDW 的问题不是"不好看"，是它必须靠一个手调正则化项才能不出现牛眼，
      而那个项一改尺度就换一种伪影；Shepard 的核宽由**采样密度自己决定**，
      无须拍参数，且是凸组合（不会算出 >100 或 <0）。
   ② **精度可检验**：新增留一法交叉验证（LOO-CV），把「这张图到底有多准」
      变成一个可断言的数字，而不是靠肉眼。
   ③ **色面铺满 + 距离淡出**（返工项，取代「凸包裁切 + 70km 羽化」）：
      上一版色面只覆盖采样范围，边界是一条看得见的折线，整张图就是**一块
      红斑贴在底图上**。现在色面一直铺到视口外，靠「离最近采样点距离」
      smoothstep 收到 alpha=0（60→300km），栅格边界落在 alpha 已为 0 处，
      于是没有可见边界。**低值不再透明**（见 ramp.ts），靠淡蓝紫把整片填满。
   ④ **连续色面**，不再 7 档量化 —— 硬边量化会把平滑的场切成同心环。
      等值线默认**不画**（SunsetBot 的图上没有，画了只会像划痕）。
   ⑤ **云纹改语义**：从「云量」改成「上游光路遮挡」（与评分 block 同源），
      且默认关闭 —— 叠加在色面上会把高值区压成褐红，先保住色面本体。
   ⑥ **不确定性进色面**：离采样点远 → 降饱和（只降饱和，透明度交给③）。

   保留：栅格缓存（数据不变成图不重算）、marching squares 实现（供开关调用）、
   自绘地名层、方位线层。
   ========================================================================= */
import { clamp, haversineKm, destPoint } from "./math";
import {
  CONTOUR_LEVELS, glowRgb, glowAlpha
} from "./ramp";

/* ---- 遮挡层（原「云纹」）四档：0–25 通透 / 25–50 轻度 / 50–75 明显 / 75–100 严重 ---- */
export const TX_RGB = [26, 36, 58];
export const TX_BAND_HI = 25;
export const TX_BAND_A = [0, 0.12, 0.2, 0.3];
export const OCC_BAND_NAMES = ["通透", "轻度遮挡", "明显遮挡", "严重遮挡"];
export const CONT_RGB = [38, 27, 20];

/* ---- 场参数（2026-10-22 二次重做：铺满 + 距离淡出，取消凸包） ----
   上一版用「凸包 + 70km 羽化 + 100km 可达距离」把色面裁成一块，实测视觉上
   就是**一块红斑贴在底图上**，边界是一条能看出来的折线。现在改成：
   色面一直铺到视口外，靠「离最近采样点的距离」连续衰减到 alpha=0 ——
   栅格边界永远落在 alpha 已经为 0 的地方，所以**不存在可见边界**。
   淡出带必须够长（≥3 个格距），否则又变成一条看得见的圈。 */
const FIELD_STEP = 0.05;        // 栅格分辨率（度，约 5.5 km）
const FADE_NEAR_KM = 60;        // 此距离内不衰减（80km 格距下格心最大 ~57km）
const FADE_FAR_KM = 320;        // 到此距离完全淡出（约 4 个格距）
const RASTER_PAD_KM = 350;      // 栅格外扩：盖住淡出完成后的余量
const FIELD_BLUR = 1;           // alpha 蒙版模糊半径（格，≈5.5 km）
/** 显示平滑半径（格）：8 格 ≈ 44km，两遍 ≈ 0.8 个格距的等效核 */
const DISPLAY_BLUR = 8;
const K_NEIGH = 9;              // Shepard 近邻数（取 9 用 8，第 9 个定核半径）
const K_RADIUS_PAD = 1.06;      // 核半径 = 第 K 近距离 × 1.06（让第 K 个也有权重）

/* ---- 可信度参数 ---- */
const CONF_NEAR_KM = 30;        // 最近采样点在此距离内：不扣分
const CONF_FAR_KM = 100;        // 到了可达上限：距离项扣满
const CONF_DIST_W = 0.55;       // 距离项最大扣分
const GAP_SOFT = 35;            // 两套模型差多少算"分歧大"（分）
const CONF_GAP_W = 0.3;         // 分歧项最大扣分
const RESID_SOFT = 25;          // 最近采样点自身留一法残差多少算不可信（分）
const CONF_RESID_W = 0.15;

/** 遮挡层只在中高值区出现：低值区谈"被挡住"没有意义，只会糊住底图 */
const OCC_MIN_V = 35;

export type Proj = (lat: number, lon: number) => { x: number; y: number };

export interface FieldPt {
  lat: number;
  lon: number;
  /** 当前维度的值（null = 该点该维度无值，不参与插值） */
  v: number | null;
  /** 云量（低云 + 0.85 中云），卡片文案用；色面不再用它 */
  cld?: number | null;
  /** 光路遮挡度 0–100（100 = 上游完全挡死） */
  occ?: number | null;
  /** 两套独立估计的差值 0–100（越大越不可信） */
  gap?: number | null;
}

export interface PaintOpts {
  pts: FieldPt[];
  proj: Proj;
  w: number;
  h: number;
  dark: boolean;
  dpr: number;
  /** 遮挡层（原云纹层），默认开 */
  showOcclusion: boolean;
  /** 25/50/75 三条语义等值线，默认开 */
  showContours: boolean;
  /** 色面缓存（调用方持有、跨帧复用）：栅格在地理空间里固定不变 */
  cache: FieldCache;
}

/** 诊断用：留一法残差大的采样点（不再单独画光斑层 —— 场本身已经过点，
    这里只作为"该处最不可信"的量化指标，供探针与可信度扣分使用） */
export interface Spike {
  lat: number;
  lon: number;
  v: number;
  resid: number;
  rKm: number;
}

/* ---- 色面缓存 ----
   栅格（热力色面 / 遮挡层 / 等值线段）只由采样数据决定，在地理空间里是固定
   的一张图 —— 与拖动/缩放无关。构建一次，拖动/缩放期间每帧只做一次仿射
   drawImage（GPU 贴图），数据变化才重建。 */
export interface FieldCache {
  pts: FieldPt[] | null;
  latTop: number;
  lonLeft: number;
  step: number;
  cols: number;
  rows: number;
  field: HTMLCanvasElement | null;
  cloud: HTMLCanvasElement | null;
  /** 等值线段，栅格索引空间 (c1,r1,c2,r2)，绘制期再投影到屏幕 */
  segs: Float32Array | null;
  nSegs: number;
  spikes: Spike[];
  /** 留一法交叉验证结果（精度门槛，探针可断） */
  cv: { n: number; rmse: number; mae: number; maxAbs: number; nnRmse: number } | null;
  /** 构建耗时（ms）与栅格规模，用于性能回归 */
  builtMs: number;
  buildCount: number;
  /** 可信度分布：供探针断「降饱和确实生效」 */
  conf: { min: number; mean: number; lowShare: number } | null;
}

export function newFieldCache(): FieldCache {
  return {
    pts: null, latTop: 0, lonLeft: 0, step: 0, cols: 0, rows: 0,
    field: null, cloud: null, segs: null, nSegs: 0, spikes: [],
    cv: null, builtMs: 0, buildCount: 0, conf: null
  };
}

function samePts(a: FieldPt[] | null, b: FieldPt[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) {
    if (a[i].lat !== b[i].lat || a[i].lon !== b[i].lon ||
        !Object.is(a[i].v, b[i].v) || !Object.is(a[i].cld, b[i].cld) ||
        !Object.is(a[i].occ, b[i].occ) || !Object.is(a[i].gap, b[i].gap)) return false;
  }
  return true;
}

/* ---- 遮挡分档 ---- */
export function occBandOf(v: number): number {
  return Math.min(3, Math.max(0, Math.floor(clamp(v, 0, 100) / TX_BAND_HI)));
}

/* ---- 带掩膜的盒式模糊（可分离，K 格，多遍 ≈ 高斯） ----
   只平均 mask=1 的格子，权重归一化到"有效格数"，否则边缘会被 0 拉黑。 */
function blurMasked(
  vals: Float32Array, mask: Uint8Array, cols: number, rows: number,
  K: number, passes: number
): Float32Array {
  let cur = vals;
  const n = vals.length;
  for (let p = 0; p < passes; p++) {
    const tmp = new Float32Array(n);
    const tmpW = new Float32Array(n);
    for (let r = 0; r < rows; r++) {
      const o = r * cols;
      for (let c = 0; c < cols; c++) {
        let s = 0, w = 0;
        for (let k = -K; k <= K; k++) {
          const cc = c + k;
          if (cc < 0 || cc >= cols) continue;
          const j = o + cc;
          if (!mask[j]) continue;
          s += cur[j]; w++;
        }
        tmp[o + c] = w ? s / w : 0;
        tmpW[o + c] = w;
      }
    }
    const out = new Float32Array(n);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        let s = 0, w = 0;
        for (let k = -K; k <= K; k++) {
          const rr = r + k;
          if (rr < 0 || rr >= rows) continue;
          const j = rr * cols + c;
          if (!mask[j]) continue;
          s += tmp[j] * tmpW[j]; w += tmpW[j];
        }
        out[r * cols + c] = w ? s / w : 0;
      }
    }
    cur = out;
  }
  return cur;
}

/* ---- 盒式模糊（可分离，K 格；用于 alpha 蒙版） ---- */
function boxBlur(a: Float32Array, cols: number, rows: number, K: number): void {
  if (K <= 0) return;
  const tmp = new Float32Array(a.length);
  const win = 2 * K + 1;
  for (let r = 0; r < rows; r++) {
    const o = r * cols;
    for (let c = 0; c < cols; c++) {
      let s2 = 0;
      for (let k = -K; k <= K; k++) {
        const cc = c + k;
        if (cc >= 0 && cc < cols) s2 += a[o + cc];
      }
      tmp[o + c] = s2 / win;
    }
  }
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      let s2 = 0;
      for (let k = -K; k <= K; k++) {
        const rr = r + k;
        if (rr >= 0 && rr < rows) s2 += tmp[rr * cols + c];
      }
      a[r * cols + c] = s2 / win;
    }
  }
}

/* ---- 平面点（km 坐标） ---- */
type P2 = { x: number; y: number };

/* =========================================================================
   自适应核 Shepard（modified Shepard, Franke–Little 1982）
   -------------------------------------------------------------------------
   w_i = ((R − d_i) / (R·d_i))² ，R = 第 K 近邻距离（随局部密度自适应）
   v(x) = Σ w_i v_i / Σ w_i
   性质（都是我们要的）：
   · 凸组合 → 结果恒在邻域值的 [min,max] 内，**不会过冲**；
   · 核半径由数据自己决定 → 不存在"核宽调多少"这个魔数；
   · d→0 时 w→∞ → 采样点处取真值（这是"准确"，不是"牛眼"：
     牛眼来自 1/d² 的等值线同心化 + 硬边量化，而不是过点本身）；
   · 权重在 R 处连续降到 0 → C¹ 平滑，不产生折痕。
   ========================================================================= */
interface Knn {
  ids: number[];
  /** 已按距离升序 */
  d: number[];
}
interface SpatialIndex {
  cellKm: number;
  buckets: Map<number, number[]>;
  pkm: P2[];
}

function bucketKey(cx: number, cy: number): number {
  /* 有符号 16 位拼键：国家尺度内 cx/cy 都在 ±数百，够用且比字符串快 */
  return ((cx + 32768) << 16) | ((cy + 32768) & 0xffff);
}

function buildIndex(pkm: P2[], cellKm: number): SpatialIndex {
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < pkm.length; i++) {
    const cx = Math.floor(pkm[i].x / cellKm);
    const cy = Math.floor(pkm[i].y / cellKm);
    const k = bucketKey(cx, cy);
    const arr = buckets.get(k);
    if (arr) arr.push(i); else buckets.set(k, [i]);
  }
  return { cellKm, buckets, pkm };
}

/** K 近邻（环形扩张；返回按距离升序的前 K 个） */
function knearest(idx: SpatialIndex, X: number, Y: number, K: number): Knn {
  const { cellKm, buckets, pkm } = idx;
  const cx = Math.floor(X / cellKm), cy = Math.floor(Y / cellKm);
  const ids: number[] = [];
  const d2s: number[] = [];
  const push = (bx: number, by: number) => {
    const arr = buckets.get(bucketKey(bx, by));
    if (!arr) return;
    for (const i of arr) {
      const dx = X - pkm[i].x, dy = Y - pkm[i].y;
      ids.push(i); d2s.push(dx * dx + dy * dy);
    }
  };
  for (let ring = 0; ring <= 10; ring++) {
    if (ring === 0) push(cx, cy);
    else {
      for (let i = -ring; i <= ring; i++) { push(cx + i, cy - ring); push(cx + i, cy + ring); }
      for (let j = -ring + 1; j <= ring - 1; j++) { push(cx - ring, cy + j); push(cx + ring, cy + j); }
    }
    if (ids.length >= K) {
      /* 已收集到 K 个：若第 K 近的距离小于当前环内切半径，则不可能再有更近的点 */
      const kth = nthSmallest(d2s, K);
      if (kth <= ((ring * cellKm) * (ring * cellKm)) * 0.5) break;
    }
  }
  /* 排序（n 很小，插入排序即可） */
  const order: number[] = [];
  for (let i = 0; i < ids.length; i++) order.push(i);
  order.sort((a, b) => d2s[a] - d2s[b]);
  const outIds: number[] = [], outD: number[] = [];
  for (let k = 0; k < Math.min(K, order.length); k++) {
    outIds.push(ids[order[k]]);
    outD.push(Math.sqrt(d2s[order[k]]));
  }
  return { ids: outIds, d: outD };
}

function nthSmallest(a: number[], k: number): number {
  /* k 很小（≤9），直接扫 k 遍最小值比排序整表便宜 */
  let best = Infinity, prev = -Infinity;
  for (let r = 0; r < k; r++) {
    best = Infinity;
    for (let i = 0; i < a.length; i++) if (a[i] > prev && a[i] < best) best = a[i];
    if (!isFinite(best)) return Infinity;
    prev = best;
  }
  return best;
}

/** Shepard 权重与插值（同一组权重可复用给多个属性） */
function shepard(x: number, y: number, knn: Knn): { ids: number[]; w: number[]; exact: number; near: number } {
  const ids = knn.ids, d = knn.d;
  if (!ids.length) return { ids: [], w: [], exact: -1, near: Infinity };
  if (d[0] < 1e-6) return { ids: [ids[0]], w: [1], exact: 0, near: 0 };
  const R = d[d.length - 1] * K_RADIUS_PAD || 1;
  const w: number[] = [];
  let sw = 0;
  for (let i = 0; i < ids.length; i++) {
    const di = d[i];
    const t = R - di;
    /* 第 K 个邻居本会取到 0 权，R 上浮 6% 后仍有极小权重，保证权重和稳定 */
    const wi = t > 0 ? (t * t) / (R * R * di * di) : 0;
    w.push(wi); sw += wi;
  }
  if (!sw) { w[0] = 1; sw = 1; }
  return { ids, w, exact: -1, near: d[0] };
}

/** 用一组权重取属性值（跳过 null 值并按权重重归一化） */
function blend(ids: number[], w: number[], vals: Array<number | null | undefined>): number | null {
  let sw = 0, sv = 0;
  for (let i = 0; i < ids.length; i++) {
    const v = vals[ids[i]];
    if (v == null || !isFinite(v)) continue;
    sw += w[i]; sv += w[i] * v;
  }
  return sw > 0 ? sv / sw : null;
}

/** 留一法：用其余点插值预测每个采样点自己（交叉验证 + 可信度） */
function looResiduals(pkm: P2[], vals: number[], cellKm: number): number[] {
  const out: number[] = new Array(vals.length).fill(0);
  for (let i = 0; i < pkm.length; i++) {
    const idxOther = buildIndexOfAllExcept(pkm, i, cellKm);
    if (!idxOther) { out[i] = 0; continue; }
    const knn = knearest(idxOther.idx, pkm[i].x, pkm[i].y, K_NEIGH);
    if (!knn.ids.length) { out[i] = 0; continue; }
    const s = shepard(pkm[i].x, pkm[i].y, knn);
    const pred = blend(s.ids, s.w, vals);
    out[i] = pred == null ? 0 : vals[i] - pred;
  }
  return out;
}

/** 只用于留一法的临时索引：把第 i 个点从桶里摘掉 */
function buildIndexOfAllExcept(pkm: P2[], skip: number, cellKm: number): { idx: SpatialIndex } | null {
  if (pkm.length < 3) return null;
  const buckets = new Map<number, number[]>();
  for (let j = 0; j < pkm.length; j++) {
    if (j === skip) continue;
    const cx = Math.floor(pkm[j].x / cellKm);
    const cy = Math.floor(pkm[j].y / cellKm);
    const k = bucketKey(cx, cy);
    const arr = buckets.get(k);
    if (arr) arr.push(j); else buckets.set(k, [j]);
  }
  return { idx: { cellKm, buckets, pkm } };
}

/* ---- 场求值（栅格构建与探针共用同一套，避免"探针量的"和"看到的"不是一回事） ---- */
interface FieldSample {
  v: number | null;
  occ: number | null;
  gap: number | null;
  near: number;
  resid: number;
}

function makeSampler(ptsv: FieldPt[]) {
  const good = ptsv.filter((p) => p.v != null && isFinite(p.v as number));
  const lat0 = good.reduce((s, p) => s + p.lat, 0) / good.length;
  const lon0 = good.reduce((s, p) => s + p.lon, 0) / good.length;
  const cosLat = Math.max(0.2, Math.cos((lat0 * Math.PI) / 180));
  const kmX = (lon: number) => (lon - lon0) * 111.32 * cosLat;
  const kmY = (lat: number) => (lat - lat0) * 110.574;
  const pkm = good.map((p) => ({ x: kmX(p.lon), y: kmY(p.lat) }));
  const vals = good.map((p) => clamp(p.v as number, 0, 100));
  const occs = good.map((p) => (p.occ == null ? NaN : clamp(p.occ, 0, 100)));
  const gaps = good.map((p) => (p.gap == null ? NaN : clamp(p.gap, 0, 100)));
  /* 核宽尺度取"平均最近邻距离"，只用于空间索引的桶尺寸，不影响插值结果 */
  const cellKm = (() => {
    let sum = 0, n = 0;
    for (let i = 0; i < pkm.length; i++) {
      let best = Infinity;
      for (let j = 0; j < pkm.length; j++) {
        if (i === j) continue;
        const dx = pkm[i].x - pkm[j].x, dy = pkm[i].y - pkm[j].y;
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
      if (isFinite(best)) { sum += Math.sqrt(best); n++; }
    }
    return n ? Math.max(20, sum / n) : 80;
  })();
  const idx = buildIndex(pkm, cellKm);
  const resid = looResiduals(pkm, vals, cellKm);
  return {
    good, lat0, lon0, cosLat, kmX, kmY, pkm, vals, occs, gaps, cellKm, idx, resid,
    at(X: number, Y: number): FieldSample {
      const knn = knearest(idx, X, Y, K_NEIGH);
      const s = shepard(X, Y, knn);
      const near = s.near;
      /* 最近邻残差：该处周围"数据自己有多不稳" */
      const nearestId = s.ids.length ? s.ids[0] : -1;
      return {
        v: blend(s.ids, s.w, vals),
        occ: blend(s.ids, s.w, occs),
        gap: blend(s.ids, s.w, gaps),
        near,
        resid: nearestId >= 0 && s.exact < 0 ? Math.abs(resid[nearestId] || 0) : 0
      };
    }
  };
}

/** 距离衰减：near ≤ NEAR 满量，NEAR→FAR 用 smoothstep 收到 0。
    这是「哪里是算的、哪里是猜的」唯一诚实的表达 —— 淡不等于没有，是不确定。 */
function fadeOf(nearKm: number): number {
  if (nearKm <= FADE_NEAR_KM) return 1;
  if (nearKm >= FADE_FAR_KM) return 0;
  const t = (nearKm - FADE_NEAR_KM) / (FADE_FAR_KM - FADE_NEAR_KM);
  const s = 1 - t;
  return s * s * (3 - 2 * s);
}

/** 可信度 0–1：距离 + 两套模型分歧 + 最近点自身残差 */
function confidenceOf(s: FieldSample): number {
  const distT = clamp((s.near - CONF_NEAR_KM) / (CONF_FAR_KM - CONF_NEAR_KM), 0, 1);
  const gapT = clamp((s.gap == null ? 0 : s.gap) / GAP_SOFT, 0, 1);
  const resT = clamp(s.resid / RESID_SOFT, 0, 1);
  return clamp(
    1 - distT * CONF_DIST_W - gapT * CONF_GAP_W - resT * CONF_RESID_W,
    0.2, 1
  );
}

/** 构建色面栅格（只在采样数据变化时执行一次）：强度 + 遮挡 + 等值线段 */
function buildFieldRaster(o: PaintOpts): void {
  const cache = o.cache;
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const S = makeSampler(o.pts);
  const good = S.good;
  if (!good.length) return;

  /* 栅格范围 = 采样 bbox + 淡出完成距离。栅格边界外 alpha 已经恒为 0，
     所以边界不可见，也不会因为拖动/缩放而需要重建。 */
  const padKm = RASTER_PAD_KM;
  const padLat = padKm / 110.574;
  const padLon = padKm / (111.32 * S.cosLat);
  const latMin = Math.min(...good.map((p) => p.lat)) - padLat;
  const latMax = Math.max(...good.map((p) => p.lat)) + padLat;
  const lonMin = Math.min(...good.map((p) => p.lon)) - padLon;
  const lonMax = Math.max(...good.map((p) => p.lon)) + padLon;

  let step = FIELD_STEP;
  const MAX_CELLS = 160000;
  let cols = Math.ceil((lonMax - lonMin) / step);
  let rows = Math.ceil((latMax - latMin) / step);
  while (cols * rows > MAX_CELLS) {
    step *= 1.4;
    cols = Math.ceil((lonMax - lonMin) / step);
    rows = Math.ceil((latMax - latMin) / step);
  }
  if (cols < 2 || rows < 2) return;

  const nCell = cols * rows;
  const img = new ImageData(cols, rows);
  const data = img.data;
  const inner = new Uint8Array(nCell);
  const fvals = new Float32Array(nCell).fill(NaN);
  const alphaArr = new Float32Array(nCell);
  const confArr = new Float32Array(nCell);
  const occArr = new Float32Array(nCell).fill(NaN);

  /* conf 统计**按可见度加权**：色面铺满后栅格里一大半是淡到看不见的外推区，
     按格点平均会把均值拖到 0.47 —— 那个数字不代表用户看到的东西。
     权重用最终 alpha，等于回答「你实际看见的这片，可信度多少」。 */
  let confSum = 0, confW = 0, confN = 0, confMin = 1, confLowW = 0;

  const latTop = latMax, lonLeft = lonMin;
  for (let r = 0; r < rows; r++) {
    const lat = latTop - (r + 0.5) * step;
    const Y = S.kmY(lat);
    for (let c = 0; c < cols; c++) {
      const oi = r * cols + c;
      const lon = lonLeft + (c + 0.5) * step;
      const X = S.kmX(lon);

      const s = S.at(X, Y);
      if (s.v == null) continue;
      /* 距离淡出代替原来的「可达距离硬截断 + 凸包裁切」 */
      const fade = fadeOf(s.near);
      if (fade <= 0.002) continue;

      const conf = confidenceOf(s);
      /* 透明度 = 分数浓淡 × 距离可信度。两件事各管一段，不再互相冒充。 */
      const a = glowAlpha(s.v) * fade;
      alphaArr[oi] = a;

      confSum += conf * a; confW += a; confN++;
      if (conf < confMin) confMin = conf;
      if (conf < 0.6) confLowW += a;

      fvals[oi] = s.v;
      occArr[oi] = s.occ == null ? NaN : s.occ;
      confArr[oi] = conf;
      inner[oi] = 1;
    }
  }

  if (!confN) return;

  /* 轻模糊：抹掉栅格台阶，别抹掉结构（1 格 ≈ 5.5km） */
  boxBlur(alphaArr, cols, rows, FIELD_BLUR);

  /* ---- 显示平滑：把「9 / 90 两档」的台阶摊成坡 ----
     80km 网格上相邻点是 9 和 90（`noCloud` 与 `cover<12` 是硬截断），实测整张
     网格只有这两档，中间只有云边界那一格有过渡值。照原样画出来就是**一块红
     贴在一块蓝上**，边界 15px 内走完 80 分 —— 这是网格分辨率造成的台阶，
     不是真实的天气结构。用 ~1 个格距的核摊开：宽 300km 的真实高值带原样
     保留，只有那一格过渡被拉成 2–3 格的坡。
     注意：**只作用于栅格**，卡片/排行榜/探针拿到的仍是原始值。 */
  const svals = blurMasked(fvals, inner, cols, rows, DISPLAY_BLUR, 2);

  /* 图像：连续色 + 低可信降饱和（只降饱和，不压透明度 —— 那件事交给 fade） */
  for (let oi = 0; oi < nCell; oi++) {
    const a = alphaArr[oi];
    if (!(a > 0.002)) continue;
    if (!isFinite(fvals[oi])) continue;
    const v = svals[oi];
    const rgb = glowRgb(v);
    /* 降饱和：往亮度灰上靠，避免"低可信区照样鲜亮"误导读图 */
    const g = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    const mix = (1 - confArr[oi]) * 0.35;
    const o4 = oi * 4;
    data[o4] = Math.round(rgb[0] + (g - rgb[0]) * mix);
    data[o4 + 1] = Math.round(rgb[1] + (g - rgb[1]) * mix);
    data[o4 + 2] = Math.round(rgb[2] + (g - rgb[2]) * mix);
    data[o4 + 3] = Math.round(255 * Math.min(1, a));
  }

  const off = document.createElement("canvas");
  off.width = cols;
  off.height = rows;
  const octx = off.getContext("2d");
  if (!octx) return;
  octx.putImageData(img, 0, 0);
  cache.field = off;
  cache.latTop = latTop;
  cache.lonLeft = lonLeft;
  cache.step = step;
  cache.cols = cols;
  cache.rows = rows;

  /* ---- 遮挡层（原云纹）：只在中高值区、低强度出现 ----
     语义已从「云量」改成「上游光路遮挡」：云量与色面同源同插值，等于自己压
     自己；而要回答的是报告 §2.3 的问题 —— 太阳来向上有没有云挡住。 */
  cache.cloud = null;
  if (o.showOcclusion) {
    const cimg = new ImageData(cols, rows);
    const cd = cimg.data;
    for (let oi = 0; oi < nCell; oi++) {
      if (!inner[oi]) continue;
      const v = fvals[oi], oc = occArr[oi];
      if (!isFinite(v) || !isFinite(oc) || v < OCC_MIN_V) continue;
      const base = TX_BAND_A[occBandOf(oc)];
      if (base <= 0) continue;
      const o4 = oi * 4;
      cd[o4] = TX_RGB[0];
      cd[o4 + 1] = TX_RGB[1];
      cd[o4 + 2] = TX_RGB[2];
      /* 越靠高值区越"实"一点，但整体保持很轻：遮挡是背景信息，不是主角 */
      cd[o4 + 3] = Math.round(base * Math.min(1, alphaArr[oi] * 1.4) * 255 * 0.85);
    }
    const coff = document.createElement("canvas");
    coff.width = cols; coff.height = rows;
    const cctx = coff.getContext("2d");
    if (cctx) {
      cctx.putImageData(cimg, 0, 0);
      cache.cloud = coff;
    }
  }

  /* ---- 等值线：只在 25 / 50 / 75 三条语义边界上做 marching squares ----
     段落在栅格索引空间缓存，绘制期再随视野投影。 */
  const segs: number[] = [];
  {
    const levels = CONTOUR_LEVELS;
    for (let r = 0; r + 1 < rows; r++) {
      for (let c = 0; c + 1 < cols; c++) {
        const o00 = r * cols + c, o10 = o00 + 1, o01 = o00 + cols, o11 = o01 + 1;
        const w00 = fvals[o00], w10 = fvals[o10], w11 = fvals[o11], w01 = fvals[o01];
        if (!isFinite(w00) || !isFinite(w10) || !isFinite(w11) || !isFinite(w01)) continue;
        if (alphaArr[o00] < 0.02) continue;
        const v00 = clamp(w00, 0, 100), v10 = clamp(w10, 0, 100);
        const v11 = clamp(w11, 0, 100), v01 = clamp(w01, 0, 100);
        const lo = Math.min(v00, v10, v11, v01);
        const hi = Math.max(v00, v10, v11, v01);
        if (!(hi > lo)) continue;
        for (const t of levels) {
          if (!(t > lo && t < hi)) continue;
          const e0 = v10 !== v00 ? { c: c + (t - v00) / (v10 - v00), r } : null;
          const e1 = v11 !== v10 ? { c: c + 1, r: r + (t - v10) / (v11 - v10) } : null;
          const e2 = v01 !== v11 ? { c: c + 1 - (t - v11) / (v01 - v11), r: r + 1 } : null;
          const e3 = v00 !== v01 ? { c, r: r + 1 - (t - v01) / (v00 - v01) } : null;
          const idxBits = (v00 > t ? 8 : 0) | (v10 > t ? 4 : 0) | (v11 > t ? 2 : 0) | (v01 > t ? 1 : 0);
          const TAB: Array<Array<[number, number]> | null> = [
            null, [[3, 2]], [[2, 1]], [[3, 1]],
            [[0, 1]], null, [[0, 2]], [[3, 0]],
            [[0, 3]], [[0, 2]], null, [[0, 1]],
            [[3, 1]], [[1, 2]], [[2, 3]], null
          ];
          const edges = [e0, e1, e2, e3];
          let pairs = TAB[idxBits];
          if (idxBits === 5 || idxBits === 10) {
            const mid = (v00 + v10 + v11 + v01) / 4 > t;
            const a: Array<[number, number]> = [[0, 1], [2, 3]];
            const b: Array<[number, number]> = [[0, 3], [1, 2]];
            pairs = idxBits === 5 ? (mid ? a : b) : (mid ? b : a);
          }
          if (!pairs) continue;
          for (const [ia, ib] of pairs) {
            const A2 = edges[ia], B2 = edges[ib];
            if (!A2 || !B2) continue;
            segs.push(A2.c, A2.r, B2.c, B2.r);
          }
        }
      }
    }
  }
  cache.segs = Float32Array.from(segs);
  cache.nSegs = segs.length / 4;

  /* ---- 交叉验证（精度门槛）----
     RMSE：留一法预测 vs 真值；nnRmse：直接用"最近邻的值"预测（最笨的基线）。
     Shepard 的 RMSE 必须明显低于最近邻基线，否则说明插值没带来信息。 */
  let se = 0, ae = 0, mx = 0, nnSe = 0;
  for (let i = 0; i < good.length; i++) {
    const e = S.resid[i];
    se += e * e; ae += Math.abs(e); mx = Math.max(mx, Math.abs(e));
    let bn = Infinity, bv = 0;
    for (let j = 0; j < good.length; j++) {
      if (i === j) continue;
      const dx = S.pkm[i].x - S.pkm[j].x, dy = S.pkm[i].y - S.pkm[j].y;
      const d = dx * dx + dy * dy;
      if (d < bn) { bn = d; bv = S.vals[j]; }
    }
    nnSe += (S.vals[i] - bv) * (S.vals[i] - bv);
  }
  const nn = good.length;
  cache.cv = {
    n: nn,
    rmse: Math.sqrt(se / nn),
    mae: ae / nn,
    maxAbs: mx,
    nnRmse: Math.sqrt(nnSe / nn)
  };

  /* ---- 残差诊断（不再单独画光斑：场本身过点，光斑层会重复且造回圆）---- */
  const spikes: Spike[] = [];
  for (let i = 0; i < good.length; i++) {
    const res = S.resid[i];
    if (Math.abs(res) >= 15) {
      spikes.push({ lat: good[i].lat, lon: good[i].lon, v: S.vals[i], resid: res, rKm: 40 });
    }
  }
  for (const s of spikes) {
    let nd = Infinity;
    for (const t of spikes) {
      if (t === s) continue;
      const dy = (t.lat - s.lat) * 110.574;
      const dx = (t.lon - s.lon) * 111.32 * Math.cos((s.lat * Math.PI) / 180);
      const d = Math.hypot(dx, dy);
      if (d < nd) nd = d;
    }
    if (isFinite(nd)) s.rKm = clamp(nd * 0.5, 40, 70);
  }
  cache.spikes = spikes;

  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  cache.builtMs = Math.round(t1 - t0);
  cache.buildCount++;
  cache.conf = {
    min: confMin,
    mean: confSum / Math.max(1e-6, confW),
    lowShare: confLowW / Math.max(1e-6, confW)
  };
  /* 逐点值拷贝做比对键：pts 每帧都是新映射出来的对象，按值比才命中 */
  cache.pts = o.pts.map((p) => ({
    lat: p.lat, lon: p.lon, v: p.v, cld: p.cld, occ: p.occ, gap: p.gap
  }));
}

/** 色面 + 遮挡 + 等值线：栅格走缓存（数据变了才重建），每帧只做仿射贴图。 */
export function paintField(ctx: CanvasRenderingContext2D, o: PaintOpts): void {
  const good = o.pts.filter((p) => p.v != null && isFinite(p.v));
  if (!good.length) return;
  const cache = o.cache;
  if (!cache.field || !samePts(cache.pts, o.pts) || (o.showOcclusion && !cache.cloud)) {
    buildFieldRaster(o);
  }
  if (!cache.field) return;

  /* 仿射映射：栅格索引 → 屏幕（局部等角可当仿射），每帧随视野重算 */
  const A = o.proj(cache.latTop - cache.step / 2, cache.lonLeft + cache.step / 2);
  const B = o.proj(cache.latTop - cache.step / 2, cache.lonLeft + cache.step * 1.5);
  const C = o.proj(cache.latTop - cache.step * 1.5, cache.lonLeft + cache.step / 2);
  const a = B.x - A.x, cB = B.y - A.y;
  const b = C.x - A.x, d = C.y - A.y;
  /* 像素 (0,0) 的**中心**落在 A 上：要同时减去两个方向的半个像素；
     ctx 已被 setTransform(dpr) 抬到 CSS 像素坐标，proj 给的就是 CSS 像素。 */
  const e = A.x - (a + b) * 0.5, f = A.y - (cB + d) * 0.5;

  ctx.save();
  ctx.transform(a, b, cB, d, e, f);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cache.field, 0, 0);
  if (o.showOcclusion && cache.cloud) ctx.drawImage(cache.cloud, 0, 0);
  ctx.restore();

  const scr = (cc2: number, rr: number) => ({
    x: e + a * cc2 + b * rr,
    y: f + cB * cc2 + d * rr
  });

  if (o.showContours && cache.segs) {
    ctx.save();
    /* 等值线用低饱和中性色：它是"边界"不是"数据"，别跟色面抢注意力 */
    ctx.strokeStyle = `rgba(${CONT_RGB[0]},${CONT_RGB[1]},${CONT_RGB[2]},${o.dark ? 0.42 : 0.34})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const s = cache.segs;
    for (let i = 0; i < cache.nSegs; i++) {
      const p1 = scr(s[i * 4], s[i * 4 + 1]), p2 = scr(s[i * 4 + 2], s[i * 4 + 3]);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

/** 场在任意坐标处的值（与栅格同一口径、同一插值器）。诊断与探针用它。 */
export function trendValueAt(lat: number, lon: number, pts: FieldPt[]): number | null {
  const good = pts.filter((p) => p.v != null && isFinite(p.v as number));
  if (!good.length) return null;
  const S = makeSampler(good);
  return S.at(S.kmX(lon), S.kmY(lat)).v;
}

/** 场在任意坐标处的完整取值（值 / 遮挡 / 可信度 / 最近距离），探针用 */
export function fieldProbeAt(
  lat: number, lon: number, pts: FieldPt[]
): { v: number | null; occ: number | null; gap: number | null; near: number; conf: number } | null {
  const good = pts.filter((p) => p.v != null && isFinite(p.v as number));
  if (!good.length) return null;
  const S = makeSampler(good);
  const s = S.at(S.kmX(lon), S.kmY(lat));
  return { v: s.v, occ: s.occ, gap: s.gap, near: s.near, conf: confidenceOf(s) };
}

/* ---- 经纬网两层：3px 光晕 + 1px 芯线 ---- */
export function drawGraticule(
  ctx: CanvasRenderingContext2D,
  proj: Proj,
  center: { lat: number; lon: number },
  w: number, h: number,
  dark: boolean
): void {
  const halo = dark ? "rgba(220,232,255,0.55)" : "rgba(255,255,255,0.85)";
  const core = dark ? "rgba(30,42,64,0.62)" : "rgba(40,56,84,0.62)";
  const lines: Array<[number, number, number, number]> = [];
  for (let dLon = -6; dLon <= 6; dLon += 2) {
    const lon = center.lon + dLon * 1.6;
    const a = proj(center.lat - 5, lon), b = proj(center.lat + 5, lon);
    lines.push([a.x, a.y, b.x, b.y]);
  }
  for (let dLat = -4; dLat <= 4; dLat += 2) {
    const lat = center.lat + dLat;
    const a = proj(lat, center.lon - 8), b = proj(lat, center.lon + 8);
    lines.push([a.x, a.y, b.x, b.y]);
  }
  ctx.lineCap = "butt";
  for (const [x1, y1, x2, y2] of lines) {
    if (
      (x1 < -50 && x2 < -50) || (x1 > w + 50 && x2 > w + 50) ||
      (y1 < -50 && y2 < -50) || (y1 > h + 50 && y2 > h + 50)
    ) continue;
    ctx.beginPath();
    ctx.strokeStyle = halo;
    ctx.lineWidth = 3;
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = core;
    ctx.lineWidth = 1;
    ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
    ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
    ctx.stroke();
  }
}

/* ---- 范围虚线（500 km 圈） ---- */
export function drawRangeDashed(
  ctx: CanvasRenderingContext2D, proj: Proj,
  center: { lat: number; lon: number }, radiusKm: number,
  lat2km: number
): void {
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let a = 0; a <= 360; a += 6) {
    const rad = (a * Math.PI) / 180;
    const dLat = (radiusKm * Math.cos(rad)) / lat2km;
    const dLon = (radiusKm * Math.sin(rad)) /
      (lat2km * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
    const p = proj(center.lat + dLat, center.lon + dLon);
    if (a === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/* =========================================================================
   自绘地名层（2026-10-22，多语言需求）
   -------------------------------------------------------------------------
   腾讯底图的地名是中文且**没有**英 / 繁选项（高德有英文、但无繁体）。所以
   英 / 繁模式关掉底图的 point/label 要素，改由这里用 486 个城市点自己画 ——
   画在当前语言的显示名上，中文字体与画布其它文字同一套（Inter + 系统栈）。

   分级按「可视纵向跨度（km）」判，不按 SDK 的 zoom 数值：腾讯的 zoom 语义
   与 Leaflet / MapLibre 不同，而我们自己也能算出跨度 —— 换 SDK 或走离线
   回退投影时判据都不变。调用方只负责把候选点筛好（含层级与文字），
   这里只做排版：点 + 名，贪心避让，越界不画。
   ========================================================================= */
export interface CityLabel {
  text: string;
  x: number;
  y: number;
  /** 0 省会 / 1 地级市 / 2 其余 —— 只影响字重与点径，不影响避让优先级 */
  tier: 0 | 1 | 2;
}

/** 实际落笔的一条（探针据此断言文字没被画到框外/半截） */
export interface DrawnLabel {
  text: string;
  /** 文字左右边界（CSS px） */
  x0: number; x1: number;
  y: number;
  align: "left" | "right";
}

/** 画布坐标系里的矩形 [x0, y0, x1, y1] —— 供 avoid 之类的避让区描述 */
export type Rect4 = [number, number, number, number];

/** 返回真正画出的那几条（不是候选数：避让掉的不算） */
export function drawCityLabels(
  ctx: CanvasRenderingContext2D,
  o: {
    labels: CityLabel[]; dark: boolean; w: number; h: number;
    /** 必须躲开的区域（SDK 控件：缩放钮、罗盘、比例尺、腾讯 logo 与审图号） */
    avoid?: Rect4[];
  }
): DrawnLabel[] {
  const { labels, dark, w, h } = o;
  const avoid = o.avoid || [];
  const dotCol = dark ? "rgba(226,234,250,0.9)" : "rgba(28,40,62,0.85)";
  const textCol = dark ? "rgba(232,238,250,0.96)" : "rgba(20,30,48,0.92)";
  const haloCol = dark ? "rgba(6,10,20,0.85)" : "rgba(255,255,255,0.92)";
  const dotR = [2.8, 2.1, 1.7];
  const fontOf = (tier: number) =>
    tier === 0 ? "600 12.5px Inter, system-ui, sans-serif"
      : tier === 1 ? "500 11.5px Inter, system-ui, sans-serif"
        : "400 10.5px Inter, system-ui, sans-serif";

  const taken: Array<[number, number, number, number]> = [];
  const over = (r: Rect4, q: Rect4) =>
    !(r[0] > q[2] || r[2] < q[0] || r[1] > q[3] || r[3] < q[1]);
  const hits = (r: Rect4) => taken.some((q) => over(r, q)) || avoid.some((q) => over(r, q));
  const inAvoid = (x: number, y: number) =>
    avoid.some((q) => x >= q[0] - 2 && x <= q[2] + 2 && y >= q[1] - 2 && y <= q[3] + 2);

  const out: DrawnLabel[] = [];
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  for (const l of labels) {
    if (l.x < 6 || l.x > w - 6 || l.y < 6 || l.y > h - 6) continue;
    /* 圆点本身落在控件底下就别画了 —— 只剩个名没有点，等于凭空多出一座城 */
    if (inAvoid(l.x, l.y)) continue;
    const tier = l.tier, r0 = dotR[tier];
    ctx.font = fontOf(tier);
    const tw = ctx.measureText(l.text).width;
    /* 两个候选位轮流试：右置优先，右边放不下或撞上控件就翻到左侧右对齐。
       早先只按「出不出画布」选边、选完被控件压住就直接丢弃 —— 于是右下角
       会出现「…nwei」这种被缩放钮吃掉半截的字（2026-10-22 修）。 */
    let x0 = 0, align: CanvasTextAlign = "left", rect: Rect4 = [0, 0, 0, 0], placed = false;
    for (const side of ["right", "left"] as const) {
      if (side === "right") {
        const x = l.x + r0 + 3;
        if (x + tw > w - 3) continue;
        const r: Rect4 = [l.x - r0 - 1, l.y - 8, x + tw + 2, l.y + 8];
        if (hits(r)) continue;
        x0 = x; align = "left"; rect = r; placed = true; break;
      }
      const x = l.x - r0 - 3;
      if (x - tw < 3) continue;
      const r: Rect4 = [x - tw - 2, l.y - 8, l.x + r0 + 1, l.y + 8];
      if (hits(r)) continue;
      x0 = x; align = "right"; rect = r; placed = true; break;
    }
    if (!placed) continue;
    taken.push(rect);

    ctx.beginPath();
    ctx.arc(l.x, l.y, r0, 0, Math.PI * 2);
    ctx.fillStyle = dotCol;
    ctx.fill();

    /* 描边光晕打底：底图深浅不定，单靠 fill 会在浅色陆地上糊掉 */
    ctx.textAlign = align;
    ctx.strokeStyle = haloCol;
    ctx.lineWidth = 3;
    ctx.strokeText(l.text, x0, l.y);
    ctx.fillStyle = textCol;
    ctx.fillText(l.text, x0, l.y);
    out.push({
      text: l.text,
      x0: align === "left" ? x0 : x0 - tw,
      x1: align === "left" ? x0 + tw : x0,
      y: l.y, align
    });
  }
  ctx.restore();
  return out;
}

/* =========================================================================
   事件方位线 + 距离环（2026-10-21，口径对齐V1 _p6.js drawAzimuthLayer）
   -------------------------------------------------------------------------
   这套模型的核心几何就是方向 —— 样带沿当日朝/晚霞方位量出去，图面上必须给
   方向与距离参照：射线指向事件方位，100/200/300/400 km 虚线环按球面 destPoint
   取 24 顶点投影连线（不是屏幕画圆），刻度标在射线与环的交点上（那才是
   「这条线上 200 km 处」）。零取数纯天文，方位由调用方算好传入。
   ========================================================================= */
const AZI_RINGS = [100, 200, 300, 400];

export function drawAziLayer(
  ctx: CanvasRenderingContext2D,
  proj: Proj,
  o: {
    lat: number; lon: number;
    az: number;
    head: string;
    ringLabel: (km: number) => string;
    dark: boolean;
    w: number; h: number;
  }
): { cx: number; cy: number; tx: number; ty: number } {
  const { lat, lon, az, head, dark, w, h } = o;
  const ringCol = dark ? "rgba(150,162,182,0.55)" : "rgba(120,132,150,0.5)";
  const rayCol = "rgba(192,122,16,0.9)";
  const tickCol = dark ? "rgba(222,232,250,0.85)" : "rgba(52,64,88,0.9)";
  const headCol = dark ? "rgba(255,186,110,0.95)" : "rgba(160,88,10,0.95)";

  ctx.save();
  ctx.lineCap = "butt";

  /* 距离环：24 顶点（15° 一档）球面折线 */
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = ringCol;
  const rayTips: Array<{ x: number; y: number; km: number }> = [];
  for (const R of AZI_RINGS) {
    ctx.beginPath();
    let drew = false;
    for (let i = 0; i <= 24; i++) {
      const p = destPoint(lat, lon, az + i * 15, R);
      const q = proj(p.lat, p.lon);
      if (!drew) { ctx.moveTo(q.x, q.y); drew = true; } else ctx.lineTo(q.x, q.y);
    }
    if (drew) ctx.stroke();
    const t0 = proj(destPoint(lat, lon, az, R).lat, destPoint(lat, lon, az, R).lon);
    rayTips.push({ x: t0.x, y: t0.y, km: R });
  }

  /* 方位射线：中心 → 400 km 处 */
  const c = proj(lat, lon);
  const tip = proj(destPoint(lat, lon, az, AZI_RINGS[AZI_RINGS.length - 1]).lat,
    destPoint(lat, lon, az, AZI_RINGS[AZI_RINGS.length - 1]).lon);
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = rayCol;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();

  /* 刻度：标在射线与环的交点旁 */
  ctx.setLineDash([]);
  ctx.font = "600 10px ui-monospace,Menlo,Consolas,monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = tickCol;
  for (const rt of rayTips) {
    if (rt.x < -40 || rt.x > w + 40 || rt.y < -20 || rt.y > h + 20) continue;
    ctx.fillText(o.ringLabel(rt.km), rt.x + 6, rt.y - 4);
  }

  /* 线端标签：晚霞方位 西 275° */
  if (tip.x > -80 && tip.x < w + 80 && tip.y > -30 && tip.y < h + 30) {
    ctx.font = "700 11px Inter, system-ui, sans-serif";
    ctx.fillStyle = headCol;
    ctx.fillText(head, tip.x + 8, tip.y + 14);
  }
  ctx.restore();
  return { cx: c.x, cy: c.y, tx: tip.x, ty: tip.y };
}

export { glowRgb, glowAlpha, haversineKm };
