/* =========================================================================
   GLOWCAST v2 · 基础常量 / 数学工具
   口径来源：V1 _p2.js（v2/vendor/src-verbatim/_p2.js）—— 函数体逐语义移植。
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
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
