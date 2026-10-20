/* =========================================================================
   GLOWCAST v2 · 地图图层渲染（纯函数）
   图层序（与原版一致）：经纬网(0) → 色面(1) → 云纹(2) → 等值线(3)
   → 范围虚线(3.5) → 方位环(5) → 直标(6) → 图钉(7)
   色阶 SPECTRUM_RAMP（v2 决策换新尺）；云纹/经纬网/羽化常量与原版同值。
   ========================================================================= */
import { clamp, lerp, isNum, haversineKm } from "./math";
import { rampColor } from "./ramp";

/* ---- 云纹 / 等值线常量（与原版 _p6.js 同值） ---- */
export const TX_RGB = [30, 42, 68];
export const TX_BAND_HI = 25;
export const TX_BAND_A = [0, 0.13, 0.22, 0.35];
export const TX_BAND_NAMES = ["晴", "少云", "多云", "阴"];
export const CONT_RGB = [38, 27, 20];
const EDGE_NOISE_KM = 26;
const FIELD_OUT_KM = 70;
const FIELD_FULL = 90;

export type Proj = (lat: number, lon: number) => { x: number; y: number };
export type ValAt = (lat: number, lon: number) => number | null;

/* ---- 云纹四档：txBandOf(v) = min(3, floor(v/25))，晴档不画 ---- */
export function txBandOf(v: number): number {
  return Math.min(3, Math.max(0, Math.floor(v / TX_BAND_HI)));
}

/* ---- 格哈希确定性噪声（羽化边缘用） ---- */
function hash2(ix: number, iy: number): number {
  let h = ix * 374761393 + iy * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

export interface FieldOpts {
  proj: Proj;
  valAt: ValAt;
  /** 样本点凸包（公里坐标转屏幕由 proj 完成；这里传经纬度点列） */
  hull: Array<{ lat: number; lon: number }>;
  center: { lat: number; lon: number };
  w: number; h: number;
  step?: number;          // 栅格步长 px
  dark: boolean;
}

/** 羽化权重：凸包内 1，向外按 FIELD_OUT_KM 线性淡出并叠有机噪声 */
function hullWeight(
  lat: number, lon: number, hull: Array<{ lat: number; lon: number }>,
  center: { lat: number; lon: number }
): number {
  if (!hull.length) return 0;
  /* 凸判定（点集通常近似圆形/凸多边形）：用「到凸包中心的最大半径 + 噪声」近似 */
  let maxR = 0;
  for (const p of hull) {
    const d = haversineKm(lat, lon, p.lat, p.lon);
    if (d > maxR) maxR = d;
  }
  const dC = haversineKm(lat, lon, center.lat, center.lon);
  /* 到最近样本点的距离决定羽化 */
  let dNear = 1e9;
  for (const p of hull) {
    const d = haversineKm(lat, lon, p.lat, p.lon);
    if (d < dNear) dNear = d;
  }
  if (dNear > FIELD_FULL + FIELD_OUT_KM) return 0;
  if (dNear <= FIELD_FULL) return 1;
  const t = 1 - (dNear - FIELD_FULL) / FIELD_OUT_KM;
  /* 有机噪声：按羽化进度缩放（包内恒 0） */
  const ix = Math.round(lat * 10), iy = Math.round(lon * 10);
  const noise = (hash2(ix, iy) - 0.5) * 2 * (EDGE_NOISE_KM / FIELD_OUT_KM);
  return clamp(t + noise * (1 - t), 0, 1);
}

/** 色面：栅格 IDW 取值 + 羽化 alpha */
export function drawField(
  ctx: CanvasRenderingContext2D, o: FieldOpts
): Array<{ lat: number; lon: number; v: number }> {
  const step = o.step ?? 10;
  const cells: Array<{ lat: number; lon: number; v: number }> = [];
  for (let y = 0; y < o.h; y += step) {
    for (let x = 0; x < o.w; x += step) {
      /* 反投影：用邻近样本点经纬度插值（局部小图可近似线性）——
         为避免逐格反投影的开销，值直接在「屏幕栅格 → 最近样本」空间取。 */
      const v = valAtScreen(o, x + step / 2, y + step / 2);
      if (v == null) continue;
      const alpha = weightAtScreen(o, x + step / 2, y + step / 2);
      if (alpha <= 0.02) continue;
      const col = rampColor(v);
      ctx.globalAlpha = alpha * (o.dark ? 0.75 : 0.72);
      ctx.fillStyle = col;
      ctx.fillRect(x, y, step + 1, step + 1);
      cells.push({ lat: 0, lon: 0, v });
    }
  }
  ctx.globalAlpha = 1;
  return cells;
}

/* 屏幕栅格取值：找屏幕空间最近的样本点做 IDW（投影近似为局部线性） */
interface ScreenGrid {
  spts: Array<{ x: number; y: number; lat: number; lon: number; v: number | null; cld: number | null }>;
}

const gridCache = new WeakMap<object, ScreenGrid>();

export function buildScreenGrid(
  pts: Array<{ lat: number; lon: number; v: number | null; cld: number | null }>,
  proj: Proj
): ScreenGrid {
  return {
    spts: pts.map((p) => ({
      ...p,
      ...proj(p.lat, p.lon),
      v: p.v,
      cld: p.cld
    }))
  };
}

function nearestOf(g: ScreenGrid, x: number, y: number, maxPx: number) {
  let near = 1e9, best = -1;
  for (let i = 0; i < g.spts.length; i++) {
    const s = g.spts[i];
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < near) { near = d; best = i; }
  }
  return near <= maxPx ? best : -1;
}

function idwScreen(g: ScreenGrid, x: number, y: number, pick: (s: ScreenGrid["spts"][0]) => number | null): number | null {
  let sw = 0, sv = 0;
  for (const s of g.spts) {
    const v = pick(s);
    if (!isNum(v)) continue;
    const d2 = (s.x - x) ** 2 + (s.y - y) ** 2 + 1;
    const w = 1 / d2;
    sw += w; sv += w * v;
  }
  return sw ? sv / sw : null;
}

let _grid: ScreenGrid | null = null;
let _stepPx = 120; // 约 120km 间距在屏幕上的近似像素

export function setRenderGrid(g: ScreenGrid, stepPx: number) {
  _grid = g;
  _stepPx = stepPx;
  gridCache.set(g, g);
}

function valAtScreen(_o: FieldOpts, x: number, y: number): number | null {
  if (!_grid) return null;
  return idwScreen(_grid, x, y, (s) => s.v);
}
function weightAtScreen(_o: FieldOpts, x: number, y: number): number {
  if (!_grid) return 0;
  const i = nearestOf(_grid, x, y, _stepPx * 2.2);
  if (i < 0) return 0;
  const s = _grid.spts[i];
  const d = Math.hypot(s.x - x, s.y - y);
  if (d <= _stepPx * 0.9) return 1;
  const t = 1 - (d - _stepPx * 0.9) / (_stepPx * 1.3);
  const ix = Math.round(x / 4), iy = Math.round(y / 4);
  const noise = (hash2(ix, iy) - 0.5) * 0.55;
  return clamp(t + noise * (1 - t), 0, 1);
}

/** 云纹：四档 alpha 平涂（晴档 0 不画），档界即边界 */
export function drawCloudTexture(
  ctx: CanvasRenderingContext2D, w: number, h: number, step = 12
): void {
  if (!_grid) return;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const cld = idwScreen(_grid, x + step / 2, y + step / 2, (s) => s.cld);
      if (cld == null) continue;
      const band = txBandOf(cld);
      const a = TX_BAND_A[band];
      if (a <= 0) continue;
      const alpha = weightAtScreen(null as unknown as FieldOpts, x, y);
      if (alpha <= 0.02) continue;
      ctx.globalAlpha = a * alpha * 0.9;
      ctx.fillStyle = `rgb(${TX_RGB[0]},${TX_RGB[1]},${TX_RGB[2]})`;
      ctx.fillRect(x, y, step + 1, step + 1);
    }
  }
  ctx.globalAlpha = 1;
}

/** 等值线：等值平滑折线（阈值处的游走线），线色深暖灰 */
export function drawContours(
  ctx: CanvasRenderingContext2D, w: number, h: number, levels = [20, 40, 60, 80]
): void {
  if (!_grid) return;
  const step = 14;
  ctx.lineWidth = 1;
  ctx.strokeStyle = `rgba(${CONT_RGB[0]},${CONT_RGB[1]},${CONT_RGB[2]},0.55)`;
  for (const lv of levels) {
    ctx.beginPath();
    for (let y = 0; y < h - step; y += step) {
      for (let x = 0; x < w - step; x += step) {
        const a = idwScreen(_grid, x, y, (s) => s.v);
        const b = idwScreen(_grid, x + step, y, (s) => s.v);
        const c = idwScreen(_grid, x, y + step, (s) => s.v);
        if (a == null || b == null || c == null) continue;
        if ((a - lv) * (b - lv) < 0) {
          const t = (lv - a) / (b - a);
          ctx.moveTo(x + t * step, y);
          ctx.lineTo(x + t * step, y + step);
        }
        if ((a - lv) * (c - lv) < 0) {
          const t = (lv - a) / (c - a);
          ctx.moveTo(x, y + t * step);
          ctx.lineTo(x + step, y + t * step);
        }
      }
    }
    ctx.stroke();
  }
}

/** 经纬网两层：3px 近白光晕 + 1px 深灰芯线（像素反差 ≥28） */
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
  /* 每 2° 一条经纬线，投影后裁剪到画布 */
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

/** 范围虚线：样本点凸包外接（极坐标外推），B1 兜底视觉 */
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
    const dLon = (radiusKm * Math.sin(rad)) / (lat2km * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
    const p = proj(center.lat + dLat, center.lon + dLon);
    if (a === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

export { lerp };
