/* =========================================================================
   GLOWCAST v2 · URL 状态同步（口径对齐原版 syncUrl/readUrl/baseQuery）
   快照 snap= 与查询状态共存；只存内部键值，解码前限长逐字段校验。
   ========================================================================= */
import { state, savePrefs } from "../state";
import { snapDecode, type SnapData } from "./snap";
import { safeLabel, clamp } from "./math";

export function baseQuery(): string {
  return (
    "?name=" + encodeURIComponent(safeLabel(state.city.name, 24)) +
    "&lat=" + state.city.lat.toFixed(4) +
    "&lon=" + state.city.lon.toFixed(4) +
    "&date=" + state.dateStr +
    "&period=" + state.period
  );
}

export function syncUrl(): void {
  if (typeof history === "undefined" || typeof location === "undefined") return;
  const base = location.href.split("#")[0].split("?")[0];
  const snapRaw = new URLSearchParams(location.search).get("snap");
  const url = base + baseQuery() + (snapRaw ? "&snap=" + snapRaw : "");
  try {
    history.replaceState(null, "", url + location.hash);
  } catch { /* file:// 某些内核会拒绝 */ }
}

export interface UrlState {
  name?: string;
  lat?: number;
  lon?: number;
  date?: string;
  period?: "am" | "pm";
  snap?: SnapData;
}

export function readUrl(): UrlState {
  const out: UrlState = {};
  if (typeof location === "undefined") return out;
  const q = new URLSearchParams(location.search);
  const name = q.get("name");
  if (name) out.name = safeLabel(name, 24);
  const lat = parseFloat(q.get("lat") || "");
  const lon = parseFloat(q.get("lon") || "");
  if (isFinite(lat) && Math.abs(lat) <= 90) out.lat = clamp(lat, -90, 90);
  if (isFinite(lon) && Math.abs(lon) <= 180) out.lon = clamp(lon, -180, 180);
  const date = q.get("date");
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) out.date = date;
  const period = q.get("period");
  if (period === "am" || period === "pm") out.period = period;
  const snapRaw = q.get("snap");
  if (snapRaw && snapRaw.length <= 2000) {
    const d = snapDecode(snapRaw);
    if (d) out.snap = d;
  }
  return out;
}

/** 把 URL 状态应用到 store（初始化时调用一次） */
export function applyUrlState(): UrlState {
  const u = readUrl();
  if (u.date) state.dateStr = u.date;
  if (u.period) state.period = u.period;
  return u;
}

export { savePrefs };
