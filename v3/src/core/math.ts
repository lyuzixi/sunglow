/* =========================================================================
   GLOWCAST v2 · 基础常量 / 数学工具
   口径来源：原版 _p2.js（v2/vendor/src-verbatim/_p2.js）—— 函数体逐语义移植。
   ========================================================================= */

export const RE = 6371.0;            // 地球平均半径 km
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const RAY_OD550_V = 0.0975;   // 550nm 整层瑞利光学厚度
export const H_RAY = 8.0;            // 瑞利散射标高 km
export const ANGSTROM = 1.3;         // 气溶胶 Ångström 波长指数
export const K_TH = 0.02;            // 550nm 气溶胶消光系数阈值 km^-1

export const clamp = (v: number, a: number, b: number): number =>
  v < a ? a : v > b ? b : v;
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const isNum = (v: unknown): v is number =>
  typeof v === "number" && isFinite(v);
export const nz = (v: unknown, d: number): number => (isNum(v) ? v : d);

/* HTML 转义（输出侧） */
const ESC_MAP: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
};
export function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}
/* 输入侧白名单（URL 来源的人造地名） */
export function safeLabel(s: unknown, max = 40): string {
  if (typeof s !== "string") return "";
  return s.replace(/[^\p{L}\p{N} ·・.\-()（）]/gu, "").slice(0, max);
}

/* base64url（快照链接用） */
export function b64uEnc(s: string): string {
  const bytes = new TextEncoder().encode(String(s));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64uDec(s: string): string {
  let t = String(s ?? "")
    .replace(/-/g, "+").replace(/_/g, "/")
    .replace(/[^A-Za-z0-9+/]/g, "");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* 梯形隶属函数 */
export function trap(x: number, pts: Array<[number, number]>): number | null {
  if (!isNum(x)) return null;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return x1 === x0 ? y1 : lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  return pts[pts.length - 1][1];
}
export const logistic = (x: number): number => 1 / (1 + Math.exp(-x));

/* 加权几何平均（一票否决特性） */
export const FLOOR_F = 0.02;
export function wgeo(items: Array<[number | null, number]>): number {
  let e = 0, s = 0;
  for (const [v, w] of items) {
    if (v == null || !isNum(v)) continue;
    s += w;
    e += w * Math.log(Math.max(v, FLOOR_F));
  }
  return s > 0 ? Math.exp(e / s) : 0;
}

/* 日期工具 */
export const pad2 = (n: number): string => String(n).padStart(2, "0");
export function ymd(d: Date): string {
  return (
    d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate())
  );
}
export function fmtHM(hoursFloat: number | null | undefined): string {
  if (!isNum(hoursFloat)) return "—";
  let h = Math.floor(hoursFloat), m = Math.round((hoursFloat - h) * 60);
  if (m === 60) { h++; m = 0; }
  h = ((h % 24) + 24) % 24;
  return pad2(h) + ":" + pad2(m);
}

/* 球面距离 / 方位推点 */
export function haversineKm(la1: number, lo1: number, la2: number, lo2: number): number {
  const dLa = (la2 - la1) * DEG, dLo = (lo2 - lo1) * DEG;
  const a =
    Math.sin(dLa / 2) ** 2 +
    Math.cos(la1 * DEG) * Math.cos(la2 * DEG) * Math.sin(dLo / 2) ** 2;
  return 2 * RE * Math.asin(Math.min(1, Math.sqrt(a)));
}

/* =========================================================================
   日出/日落线速度查表（km/分钟）—— 口径逐字来自原版 _p2.js SPD_LAT/SPD_TAB
   行：纬度 0/5/…/60（南纬取同纬度）；列：每月 15 日基准。
   ========================================================================= */
const SPD_LAT = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
const SPD_TAB = [
  [21.6, 22.6, 23.2, 22.9, 21.9, 21.3, 21.6, 22.5, 23.1, 22.9, 22.0, 21.3],
  [21.5, 22.5, 23.1, 22.8, 21.8, 21.2, 21.4, 22.4, 23.1, 22.8, 21.9, 21.2],
  [21.2, 22.3, 22.8, 22.5, 21.6, 20.9, 21.2, 22.1, 22.8, 22.6, 21.6, 20.9],
  [20.8, 21.8, 22.4, 22.1, 21.1, 20.4, 20.7, 21.6, 22.3, 22.1, 21.2, 20.5],
  [20.1, 21.2, 21.8, 21.4, 20.4, 19.7, 20.0, 21.0, 21.7, 21.5, 20.5, 19.8],
  [19.3, 20.4, 21.0, 20.6, 19.6, 18.9, 19.1, 20.2, 21.0, 20.7, 19.7, 18.9],
  [18.3, 19.4, 20.1, 19.7, 18.6, 17.8, 18.1, 19.2, 20.0, 19.8, 18.7, 17.9],
  [17.1, 18.3, 19.0, 18.6, 17.4, 16.6, 16.9, 18.1, 18.9, 18.7, 17.6, 16.7],
  [15.7, 17.1, 17.8, 17.3, 16.1, 15.1, 15.5, 16.8, 17.7, 17.4, 16.2, 15.3],
  [14.2, 15.6, 16.4, 15.9, 14.5, 13.5, 13.9, 15.3, 16.3, 16.1, 14.7, 13.7],
  [12.4, 14.1, 14.9, 14.4, 12.8, 11.6, 12.1, 13.7, 14.8, 14.5, 13.1, 11.9],
  [10.5, 12.4, 13.3, 12.7, 10.9, 9.5, 10.0, 11.9, 13.2, 12.9, 11.2, 9.8],
  [8.2, 10.5, 11.6, 10.9, 8.7, 6.8, 7.6, 10.0, 11.5, 11.1, 9.1, 7.4]
];

/** 日出/日落线速度（km/分钟）—— 与原版 sunsetSpeedKmph 逐语义一致 */
export function sunsetSpeedKmph(absLat: number, dateUTC: Date): number {
  const m = dateUTC.getUTCMonth() + 1;
  const d = dateUTC.getUTCDate();
  const colF = (m - 1) + clamp((d - 15) / 30, -0.5, 0.5);
  const c0 = clamp(Math.floor(colF), 0, 11), c1 = clamp(c0 + 1, 0, 11), tc = clamp(colF - c0, 0, 1);
  const la = clamp(absLat, 0, 60);
  let r0 = 0, r1 = 1;
  for (let i = 1; i < SPD_LAT.length; i++) if (la <= SPD_LAT[i]) { r0 = i - 1; r1 = i; break; }
  const tr = SPD_LAT[r1] === SPD_LAT[r0] ? 0 : (la - SPD_LAT[r0]) / (SPD_LAT[r1] - SPD_LAT[r0]);
  const v0 = lerp(SPD_TAB[r0][c0], SPD_TAB[r0][c1], tc);
  const v1 = lerp(SPD_TAB[r1][c0], SPD_TAB[r1][c1], tc);
  let v = lerp(v0, v1, tr);
  if (absLat > 60) v = Math.max(4, v * Math.cos(clamp(absLat, 60, 80) * DEG) / Math.cos(60 * DEG));
  return v;
}

/* hex → rgba（色面注记用；口径与原版 hexA 一致） */
export function hex2rgb(h: string): [number, number, number] {
  const s = h.replace("#", "");
  const n = parseInt(s.length === 3 ? s.replace(/./g, (c) => c + c) : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function hexA(h: string, a: number): string {
  const [r, g, b] = hex2rgb(h);
  return `rgba(${r},${g},${b},${a})`;
}
export function destPoint(
  lat: number, lon: number, azDeg: number, distKm: number
): { lat: number; lon: number } {
  const d = distKm / RE, brg = azDeg * DEG, la1 = lat * DEG, lo1 = lon * DEG;
  const la2 = Math.asin(
    Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(brg)
  );
  const lo2 =
    lo1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(d) * Math.cos(la1),
      Math.cos(d) - Math.sin(la1) * Math.sin(la2)
    );
  return { lat: la2 * RAD, lon: ((lo2 * RAD + 540) % 360) - 180 };
}
