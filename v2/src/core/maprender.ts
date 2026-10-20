/* =========================================================================
   GLOWCAST v2 · 地图图层渲染
   色面口径对齐原版 _p6.js（用户反馈「改成原版那样」）：
   · 0.05° 栅格（约 5.5 km）
   · 凸包定边界 + FIELD_OUT_KM(70) 羽化 + 确定性噪声
   · IDW 反距离平方，FIELD_REACH_KM(120) 上限
   · HEAT_RAMP 白→黄→橙→红，N_BANDS(7) 档量化、固定 0–100 刻度
   渲染：ImageData 栅格 → 离屏画布 → 仿射拉伸 + 双线性（杜绝方块感）
   ========================================================================= */
import { clamp, haversineKm } from "./math";
import {
  HEAT_RAMP, N_BANDS, bandOf, heatBandColor, heatColor, heatGradientCss
} from "./ramp";

/* ---- 云纹 / 等值线常量（与原版 _p6.js 同值） ---- */
export const TX_RGB = [30, 42, 68];
export const TX_BAND_HI = 25;
export const TX_BAND_A = [0, 0.13, 0.22, 0.35];
export const TX_BAND_NAMES = ["晴", "少云", "多云", "阴"];
export const CONT_RGB = [38, 27, 20];

/* ---- 值场参数（原版同值） ---- */
const FIELD_STEP = 0.05;        // 栅格分辨率（度，约 5.5 km）
const FIELD_OUT_KM = 110;       // 凸包外羽化长度（v2 观感调宽：原版般柔和云团）
const EDGE_NOISE_KM = 26;       // 羽化边缘噪声幅度
const FIELD_REACH_KM = 120;     // IDW 最远可信距离
export const FIELD_FULL = 90;
const FIELD_BLUR = 2;          // 遮罩模糊半径（格，≈11 km，原版同值）
const FIELD_OPACITY = 0.82;    // 覆盖层不透明度（保留底图可读性）

export type Proj = (lat: number, lon: number) => { x: number; y: number };

export interface FieldPt {
  lat: number;
  lon: number;
  v: number | null;
  cld: number | null;
}

export interface PaintOpts {
  pts: FieldPt[];
  proj: Proj;
  w: number;
  h: number;
  dark: boolean;
  showCloud: boolean;
  showContours: boolean;
}

/* ---- 云纹分档 ---- */
export function txBandOf(v: number): number {
  return Math.min(3, Math.max(0, Math.floor(v / TX_BAND_HI)));
}

/* ---- 确定性噪声 ---- */
function hash2(ix: number, iy: number): number {
  let h = ix * 374761393 + iy * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

/* ---- 盒式模糊（可分离，K 格） ---- */
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

/* ---- 凸包（km 平面，单调链） ---- */
type P2 = { x: number; y: number };
function convexHull(pts: P2[]): P2[] {
  const p = pts.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (p.length < 3) return p;
  const cross = (o: P2, a: P2, b: P2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: P2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0)
      lower.pop();
    lower.push(q);
  }
  const upper: P2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0)
      upper.pop();
    upper.push(q);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/** 凸包半边平面（外法线）：sd = max(nx*x + ny*y - c) ≤ 0 表示在包内 */
function hullHalfPlanes(hull: P2[]): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dy / len, ny = -dx / len;
    out.push([nx, ny, nx * a.x + ny * a.y]);
  }
  return out;
}

/** 色面 + 云纹 + 等值线（一次栅格遍历产出三层） */
export function paintField(ctx: CanvasRenderingContext2D, o: PaintOpts): void {
  const good = o.pts.filter((p) => p.v != null && isFinite(p.v));
  if (!good.length) return;

  const lat0 = good.reduce((s, p) => s + p.lat, 0) / good.length;
  const lon0 = good.reduce((s, p) => s + p.lon, 0) / good.length;
  const cosLat = Math.max(0.2, Math.cos((lat0 * Math.PI) / 180));
  const kmX = (lon: number) => (lon - lon0) * 111.32 * cosLat;
  const kmY = (lat: number) => (lat - lat0) * 110.574;

  const pkm = good.map((p) => ({ x: kmX(p.lon), y: kmY(p.lat) }));
  const planes = hullHalfPlanes(convexHull(pkm));
  const hasHull = planes.length >= 3;

  /* 留足羽化带：凸包顶点可能恰好落在外接框上，padding 不足会在画布边形成硬切线 */
  const padKm = FIELD_OUT_KM * 2.2;
  const padLat = padKm / 110.574;
  const padLon = padKm / (111.32 * cosLat);
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

  const vals = good.map((p) => clamp(p.v as number, 0, 100));
  const clds = good.map((p) => (p.cld == null ? 0 : clamp(p.cld, 0, 100)));

  const lut = new Uint8Array(N_BANDS * 3);
  for (let k = 0; k < N_BANDS; k++) {
    const c = heatBandColor(k);
    lut[k * 3] = c[0]; lut[k * 3 + 1] = c[1]; lut[k * 3 + 2] = c[2];
  }

  const nCell = cols * rows;
  const img = new ImageData(cols, rows);
  const data = img.data;
  const bands = new Int8Array(nCell).fill(-1);
  const inner = new Uint8Array(nCell);
  const fvals = new Float32Array(nCell).fill(NaN);
  const alphaArr = new Float32Array(nCell);

  const latTop = latMax, lonLeft = lonMin;
  for (let r = 0; r < rows; r++) {
    const lat = latTop - (r + 0.5) * step;
    const Y = kmY(lat);
    for (let c = 0; c < cols; c++) {
      const oi = r * cols + c;
      const lon = lonLeft + (c + 0.5) * step;
      const X = kmX(lon);

      let sd = -1e9;
      if (hasHull) {
        for (let k = 0; k < planes.length; k++) {
          const d = planes[k][0] * X + planes[k][1] * Y - planes[k][2];
          if (d > sd) sd = d;
        }
        if (sd > FIELD_OUT_KM) continue;
      }

      let sw = 0, sv = 0, sc = 0, near = 1e9, exact = -1;
      for (let i = 0; i < good.length; i++) {
        const d = Math.hypot(X - pkm[i].x, Y - pkm[i].y);
        if (d < near) near = d;
        if (d < 1e-6) { exact = i; break; }
        /* 正则化 w=1/(d²+900)（≈30 km）：原版纯 1/d² 时采样点被钉死成小圆盘，
           加一个尺度项后相邻点之间自然过渡成云团状 */
        const w = 1 / (d * d + 900);
        sw += w; sv += w * vals[i]; sc += w * clds[i];
      }
      let v: number, cv: number;
      if (exact >= 0) { v = vals[exact]; cv = clds[exact]; }
      else {
        if (!hasHull && near > FIELD_REACH_KM) continue;
        if (!sw) continue;
        v = sv / sw; cv = sc / sw;
      }

      const band = bandOf(v);
      bands[oi] = band;
      inner[oi] = 1;
      fvals[oi] = v;

      /* 羽化：包内 1；包外按进度衰减 + 双晶格噪声（包界处噪声恒为 0） */
      let a = 1;
      if (sd > 0) {
        const t = 1 - sd / FIELD_OUT_KM;
        const n1 = hash2(Math.round(X / 187), Math.round(Y / 187)) - 0.5;
        const n2 = hash2(Math.round(X / 72) + 911, Math.round(Y / 72) - 37) - 0.5;
        const noise = (n1 * 0.7 + n2 * 0.3) * 2 * (EDGE_NOISE_KM / FIELD_OUT_KM);
        a = clamp(t + noise * (1 - t), 0, 1);
        a = a * a * (3 - 2 * a);   // smoothstep（原版同式）
      }
      alphaArr[oi] = a;
    }
  }

  /* 遮罩模糊（原版 FIELD_BLUR=2）：凸包边界是折线，模糊给羽化收边 */
  boxBlur(alphaArr, cols, rows, FIELD_BLUR);
  for (let oi = 0; oi < nCell; oi++) {
    if (bands[oi] < 0) continue;
    const o4 = oi * 4;
    data[o4] = lut[bands[oi] * 3];
    data[o4 + 1] = lut[bands[oi] * 3 + 1];
    data[o4 + 2] = lut[bands[oi] * 3 + 2];
    const a = Math.max(0, Math.min(1, alphaArr[oi]));
    data[o4 + 3] = a > 0.004 ? Math.round(255 * a * FIELD_OPACITY) : 0;
  }

  /* 仿射映射：栅格索引 → 屏幕（局部等角可当仿射） */
  const A = o.proj(latTop - step / 2, lonLeft + step / 2);
  const B = o.proj(latTop - step / 2, lonLeft + step * 1.5);
  const C = o.proj(latTop - step * 1.5, lonLeft + step / 2);
  const a = B.x - A.x, cB = B.y - A.y;
  const b = C.x - A.x, d = C.y - A.y;
  const e = A.x - a * 0.5, f = A.y - cB * 0.5;

  const off = document.createElement("canvas");
  off.width = cols;
  off.height = rows;
  const octx = off.getContext("2d");
  if (!octx) return;
  octx.putImageData(img, 0, 0);

  ctx.save();
  ctx.setTransform(a, b, cB, d, e, f);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(off, 0, 0);
  ctx.restore();

  const scr = (cc2: number, rr: number) => ({
    x: e + a * cc2 + b * rr,
    y: f + cB * cc2 + d * rr
  });

  /* ---- 云纹（四档，晴档不画） ---- */
  if (o.showCloud) {
    const cimg = new ImageData(cols, rows);
    const cd = cimg.data;
    for (let r = 0; r < rows; r++) {
      const lat = latTop - (r + 0.5) * step;
      const Y = kmY(lat);
      for (let c = 0; c < cols; c++) {
        const oi = r * cols + c;
        if (!inner[oi]) continue;
        const X = kmX(lonLeft + (c + 0.5) * step);
        let sd = -1e9;
        for (let k = 0; k < planes.length; k++) {
          const dd = planes[k][0] * X + planes[k][1] * Y - planes[k][2];
          if (dd > sd) sd = dd;
        }
        let cv = 0, sw = 0;
        for (let i = 0; i < good.length; i++) {
          const dd = Math.hypot(X - pkm[i].x, Y - pkm[i].y);
          if (dd < 1e-6) { cv = clds[i]; sw = 1; break; }
          const w = 1 / (dd * dd + 900);
          cv += w * clds[i]; sw += w;
        }
        if (!sw) continue;
        cv /= sw;
        const base = TX_BAND_A[txBandOf(cv)];
        if (base <= 0) continue;
        let a2 = 1;
        if (sd > 0) a2 = clamp(1 - sd / FIELD_OUT_KM, 0, 1);
        const o4 = oi * 4;
        cd[o4] = TX_RGB[0];
        cd[o4 + 1] = TX_RGB[1];
        cd[o4 + 2] = TX_RGB[2];
        cd[o4 + 3] = Math.round(base * a2 * 255 * 0.9);
      }
    }
    const coff = document.createElement("canvas");
    coff.width = cols; coff.height = rows;
    const cctx = coff.getContext("2d");
    if (cctx) {
      cctx.putImageData(cimg, 0, 0);
      ctx.save();
      ctx.setTransform(a, b, cB, d, e, f);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(coff, 0, 0);
      ctx.restore();
    }
  }

  /* ---- 等值线：在数值场上做 marching squares（插值取点 ⇒ 平滑曲线，原版同法） ---- */
  if (o.showContours) {
    const levels: number[] = [];
    for (let k = 0; k + 1 < N_BANDS; k++) levels.push(((k + 1) * 100) / N_BANDS);
    ctx.save();
    ctx.strokeStyle = `rgba(${CONT_RGB[0]},${CONT_RGB[1]},${CONT_RGB[2]},0.5)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const pt = (c: number, r: number) => scr(c, r);
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
          const idx = (v00 > t ? 8 : 0) | (v10 > t ? 4 : 0) | (v11 > t ? 2 : 0) | (v01 > t ? 1 : 0);
          const TAB: Array<Array<[number, number]> | null> = [
            null, [[3, 0]], [[0, 1]], [[3, 1]],
            [[1, 2]], null, [[0, 2]], null,
            [[2, 3]], null, null, [[2, 0]],
            [[1, 3]], null, null, null
          ];
          const edges = [e0, e1, e2, e3];
          let pairs = TAB[idx];
          if (idx === 5 || idx === 10) {
            const mid = (v00 + v10 + v11 + v01) / 4 > t;
            pairs = (idx === 5) !== mid ? [[0, 1], [2, 3]] : [[0, 3], [1, 2]];
          }
          if (!pairs) continue;
          for (const [ia, ib] of pairs) {
            const A2 = edges[ia], B2 = edges[ib];
            if (!A2 || !B2) continue;
            const p1 = pt(A2.c, A2.r), p2 = pt(B2.c, B2.r);
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
          }
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  }
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

export { heatColor, heatGradientCss, HEAT_RAMP, haversineKm };
