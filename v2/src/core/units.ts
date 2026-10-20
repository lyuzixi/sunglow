/* =========================================================================
   GLOWCAST v2 · 单位换算（公制 / 英制）
   口径对齐原版 uDist/uAlt/uSpeed/uTemp：只影响显示，不影响任何计算。
   ========================================================================= */
import { state } from "../state";

export const isImperial = (): boolean => state.units === "imperial";

/** 距离：输入 km */
export function uDist(km: number | null | undefined, digits = 0): string {
  if (km == null || !isFinite(km)) return "—";
  if (isImperial()) {
    const mi = km * 0.621371;
    return mi.toFixed(mi < 10 ? 1 : digits) + " mi";
  }
  return km.toFixed(km < 10 ? 1 : digits) + " km";
}

/** 高度/厚度：输入米 */
export function uAlt(m: number | null | undefined): string {
  if (m == null || !isFinite(m)) return "—";
  if (isImperial()) return Math.round(m * 3.28084) + " ft";
  if (m >= 1000) return (m / 1000).toFixed(m >= 10000 ? 0 : 2) + " km";
  return Math.round(m) + " m";
}

/** 风速：输入 m/s */
export function uSpeed(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) return "—";
  if (isImperial()) return (ms * 2.23694).toFixed(1) + " mph";
  return (ms * 3.6).toFixed(1) + " km/h";
}

/** 温度：输入 ℃ */
export function uTemp(c: number | null | undefined): string {
  if (c == null || !isFinite(c)) return "—";
  if (isImperial()) return (c * 1.8 + 32).toFixed(1) + " °F";
  return c.toFixed(1) + " °C";
}

/** 时间：hour12 开关 */
export function uClock(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) return "—";
  const d = new Date(ms);
  if (state.hour12) {
    const h = d.getHours() % 12 || 12;
    const ap = d.getHours() < 12 ? "AM" : "PM";
    return String(h).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + " " + ap;
  }
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
