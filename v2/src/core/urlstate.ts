/* =========================================================================
   SUNGLOW v2 · URL 状态同步（口径对齐V1 syncUrl/readUrl/baseQuery）
   快照 snap= 与查询状态共存；只存内部键值，解码前限长逐字段校验。
   ========================================================================= */
import { state, savePrefs, hasSavedMapDate } from "../state";
import { snapDecode, type SnapData } from "./snap";
import { safeLabel, clamp } from "./math";
import { PACK_PARAM, activePackRaw } from "./snapshot";

export function baseQuery(): string {
  return (
    "?name=" + encodeURIComponent(safeLabel(state.city.name, 24)) +
    "&lat=" + state.city.lat.toFixed(4) +
    "&lon=" + state.city.lon.toFixed(4) +
    "&date=" + state.dateStr +
    "&period=" + state.period
  );
}

/* 对外分享用的正式站点。分享链接必须指向别人打得开的线上地址：从本地
   （file:// 双击、localhost / 127.0.0.1 预览面板）打开时，location.href 是
   本机路径或回环地址，发出去别人打不开；这时统一换成正式站点。
   部署在其它可公开访问的域名时仍用当前页面地址，不作替换。 */
export const SHARE_SITE = "https://sunglow.cloud/";
export function shareBaseUrl(): string {
  if (typeof location === "undefined") return SHARE_SITE;
  const h = location.hostname || "";
  const local =
    location.protocol === "file:" ||
    h === "" || h === "localhost" || h === "127.0.0.1" || h === "::1" ||
    h === "0.0.0.0" || h.endsWith(".local");
  return local ? SHARE_SITE : location.href.split("#")[0].split("?")[0];
}

/**
 * 全功能快照包放在 **hash 查询串**里：`#/?pack=…`。
 * 本项目本来就是 hash 路由，hash 不会随 HTTP 请求发给服务器 —— 实测线上
 * 站点超过 8 KB 的普通 query 会直接 414，而 10 KB 的 pack 走 hash 一切正常。
 * 兼容两种入口：新的 hash query，以及早期/外部拼接的普通 query。
 */
export function readPackRaw(): string {
  if (typeof location === "undefined") return "";
  const h = location.hash || "";
  const qi = h.indexOf("?");
  if (qi >= 0) {
    const v = new URLSearchParams(h.slice(qi + 1)).get(PACK_PARAM);
    if (v) return v;
  }
  return new URLSearchParams(location.search).get(PACK_PARAM) || "";
}

/** 把 pack 补回 hash（站内路由切换会重写 hash，重算时顺手把它带回来） */
function hashWithPack(): string {
  const h = typeof location === "undefined" ? "" : location.hash || "";
  const raw = readPackRaw() || activePackRaw();
  if (!raw) return h;
  const qi = h.indexOf("?");
  const path = (qi >= 0 ? h.slice(0, qi) : h) || "#/";
  const p = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : "");
  p.set(PACK_PARAM, raw);
  return path + "?" + p.toString();
}

export function syncUrl(): void {
  if (typeof history === "undefined" || typeof location === "undefined") return;
  const base = location.href.split("#")[0].split("?")[0];
  const snapRaw = new URLSearchParams(location.search).get("snap");
  const url = base + baseQuery() + (snapRaw ? "&snap=" + snapRaw : "");
  try {
    history.replaceState(null, "", url + hashWithPack());
  } catch { /* file:// 某些内核会拒绝 */ }
}

export interface UrlState {
  name?: string;
  lat?: number;
  lon?: number;
  date?: string;
  period?: "am" | "pm";
  snap?: SnapData;
  /** 全功能快照包原文（base64url）；长度上限由 installSharePack 再校验 */
  pack?: string;
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
  const pack = readPackRaw();
  if (pack) out.pack = pack;
  return out;
}

/** 把 URL 状态应用到 store（初始化时调用一次） */
export function applyUrlState(): UrlState {
  const u = readUrl();
  if (u.date) state.dateStr = u.date;
  /* 分享链接明确给了日期、而本机没有保存过观测场日期时，让观测场一起对齐；
     用户自己选过的日期优先（hasSavedMapDate），不能被 URL 冲掉。 */
  if (u.date && !hasSavedMapDate()) state.mapDateS = u.date;
  if (u.period) state.period = u.period;
  return u;
}

export { savePrefs };
