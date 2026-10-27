/* =========================================================================
   GLOWCAST v2 · 城市时区
   ---------------------------------------------------------------------------
   口径：一律以「所选城市当地的墙钟」为准，浏览器时区只在完全不知道城市时兜底。

   · 权威来源：Open-Meteo 响应里的 `timezone`（IANA 名）与 `utc_offset_seconds`。
     两者同时留着 —— IANA 名用于显示（Intl 能算夏令时），数值用于快照编码与缓存。
   · 首屏未知时：按经度估算（lon/15 取整小时；中国全境行政统一 +8，先特判）。
     估算值只在「取数之前定默认日期」这类场景用，接口一回来就校准并被记住。
   · 序列时间统一存真实时间戳（epoch ms）；只有显示的最后一刻才换算成城市墙钟。
     这样太阳时刻（真实几何解）与气象序列（接口墙钟）落在同一个域里，不会再错位。
   ========================================================================= */
import { clamp, isNum, pad2 } from "./math";

export interface TzInfo {
  /** IANA 名，如 "America/New_York"；经度估算态为 null */
  iana: string | null;
  /** 参考时刻的 UTC 偏移（秒，东正） */
  offsetSec: number;
  /** true = 经度估算，尚未被接口校准 */
  est: boolean;
}

const HOUR_MS = 3600000;
const TZ_CACHE_PREFIX = "glowcast.v2.tz.";

/* 中国全境（含新疆、西藏）行政统一 UTC+8 —— 经度估算在这里必然偏差 2 小时以上 */
const CN = { lat0: 18, lat1: 54, lon0: 73, lon1: 135.2 };

/** 经度估算偏移：只用于「接口还没回来」的时刻 */
export function estimateOffsetSec(lat: number, lon: number): number {
  if (lat >= CN.lat0 && lat <= CN.lat1 && lon >= CN.lon0 && lon <= CN.lon1) return 8 * 3600;
  return clamp(Math.round(lon / 15), -12, 14) * 3600;
}

/** 浏览器自身偏移（秒，东正） */
export function browserOffsetSec(): number {
  try {
    return -new Date().getTimezoneOffset() * 60;
  } catch {
    return 0;
  }
}

/* ---------- 记住实测偏移（按坐标 0.1° ≈ 11km 归档） ---------- */

function keyOf(lat: number, lon: number): string {
  return TZ_CACHE_PREFIX + lat.toFixed(1) + "," + lon.toFixed(1);
}

export function rememberedTz(lat: number, lon: number): TzInfo | null {
  try {
    const raw = localStorage.getItem(keyOf(lat, lon));
    if (!raw) return null;
    const j = JSON.parse(raw) as { i?: unknown; o?: unknown };
    if (!j || !isNum(j.o)) return null;
    const off = j.o as number;
    /* 真实时区偏移一定是 15 分钟的整数倍；不是就说明是算坏的脏值，丢掉 */
    if (Math.abs(off) > 14 * 3600 || off % 900 !== 0) return null;
    const iana = typeof j.i === "string" && j.i ? j.i : null;
    return { iana, offsetSec: off, est: false };
  } catch {
    return null;
  }
}

export function rememberTz(
  lat: number, lon: number, iana: string | null, offsetSec: number
): void {
  if (!isNum(offsetSec)) return;
  try {
    localStorage.setItem(
      keyOf(lat, lon),
      JSON.stringify({ i: iana || "", o: Math.round(offsetSec) })
    );
  } catch { /* 隐私模式 */ }
}

/** 城市时区：记住的实测值 > 经度估算 */
export function cityTz(lat: number, lon: number): TzInfo {
  const m = rememberedTz(lat, lon);
  if (m) return m;
  return { iana: null, offsetSec: estimateOffsetSec(lat, lon), est: true };
}

/* ---------- IANA → 偏移（夏令时按当刻算） ---------- */

const dtfCache = new Map<string, Intl.DateTimeFormat>();
const offMemo = new Map<string, number>();

function dtfOf(iana: string): Intl.DateTimeFormat {
  let f = dtfCache.get(iana);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: iana, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    dtfCache.set(iana, f);
  }
  return f;
}

/** 某个真实时刻在该 IANA 时区下的偏移（含夏令时）；失败回落 0 */
export function offsetAt(iana: string, realMs: number): number {
  const ck = iana + "|" + Math.floor(realMs / HOUR_MS);
  const hit = offMemo.get(ck);
  if (hit != null) return hit;
  let off = 0;
  try {
    const parts = dtfOf(iana).formatToParts(new Date(realMs));
    const g = (t: string): number => {
      const p = parts.find((x) => x.type === t);
      return p ? Number(p.value) : NaN;
    };
    const wall = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
    /* Intl 的秒是**截断**的，而太阳时刻可能带小数毫秒（二分法出来的）——
       必须先把真实时刻截到整秒再相减，否则会稳定少算 1 秒，
       再被 Math.round 放大成整秒误差（实测 28800 → 28799）。 */
    const utcSec = Math.floor(realMs / 1000) * 1000;
    if (isFinite(wall)) off = (wall - utcSec) / 1000;
  } catch {
    off = 0;
  }
  if (offMemo.size > 600) offMemo.clear();
  offMemo.set(ck, off);
  return off;
}

/** 把时区校准到该时刻（夏令时边界两侧偏移不同） */
export function tzAt(tz: TzInfo, realMs: number): TzInfo {
  if (!tz.iana) return tz;
  const o = offsetAt(tz.iana, realMs);
  return o === tz.offsetSec ? tz : { ...tz, offsetSec: o };
}

/** 从接口响应里的 timezone / utc_offset_seconds 造 TzInfo */
export function tzFromApi(
  iana: unknown, offsetSec: unknown
): TzInfo | null {
  const off = isNum(offsetSec) ? (offsetSec as number) : null;
  if (off == null) return null;
  return {
    iana: typeof iana === "string" && iana ? iana : null,
    offsetSec: clamp(off, -14 * 3600, 14 * 3600),
    est: false
  };
}

/* ---------- 墙钟 ↔ 真实时刻 ---------- */

/** 接口返回的是城市当地墙钟（无后缀）；转成真实时间戳 */
export function wallIsoToReal(iso: string, offsetSec: number): number {
  const s = String(iso);
  /* 已带时区标记就按原样解析 */
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) return Date.parse(s);
  const wall = Date.parse(s.length === 16 ? s + ":00Z" : s + "Z");
  return isFinite(wall) ? wall - offsetSec * 1000 : NaN;
}

export function wallToReal(wallMs: number, offsetSec: number): number {
  return wallMs - offsetSec * 1000;
}

export function realToWall(realMs: number, offsetSec: number): number {
  return realMs + offsetSec * 1000;
}

/* ---------- 显示 ---------- */

/** 真实时刻 → 城市墙钟的 HH:MM（hour12 走 12 小时制） */
export function fmtClock(realMs: number, tz: TzInfo, hour12: boolean): string {
  const d = new Date(realToWall(realMs, tz.offsetSec));
  const h = d.getUTCHours(), mi = d.getUTCMinutes();
  if (hour12) {
    const hh = h % 12 || 12;
    return pad2(hh) + ":" + pad2(mi) + " " + (h < 12 ? "AM" : "PM");
  }
  return pad2(h) + ":" + pad2(mi);
}

/** 真实时刻 → 城市墙钟的 YYYY-MM-DD */
export function dateInTz(realMs: number, tz: TzInfo): string {
  const d = new Date(realToWall(realMs, tz.offsetSec));
  return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
}

/** 城市当地的「今天」 */
export function todayInTz(tz: TzInfo, nowMs = Date.now()): string {
  return dateInTz(nowMs, tz);
}

/** 日期字符串加减天数（纯日历运算，不碰时区） */
export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86400000;
  const dt = new Date(t);
  return dt.getUTCFullYear() + "-" + pad2(dt.getUTCMonth() + 1) + "-" + pad2(dt.getUTCDate());
}

/** UTC+9 / UTC−4 / UTC+5:30（负号用真正的减号，避免和连字符混淆） */
export function tzLabel(tz: TzInfo): string {
  const off = Math.round(tz.offsetSec / 60);
  const sign = off < 0 ? "\u2212" : "+";
  const a = Math.abs(off);
  const h = Math.floor(a / 60), m = a % 60;
  return "UTC" + sign + h + (m ? ":" + pad2(m) : "");
}

/** 城市时区是否与浏览器不同（差 30 分钟以上才算） */
export function isForeignTz(tz: TzInfo): boolean {
  return Math.abs(tz.offsetSec - browserOffsetSec()) >= 1800;
}
