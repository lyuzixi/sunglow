/* =========================================================================
   GLOWCAST v2 · 天文计算
   口径来源：V1 _p2.js solarPosition/solarNoonMs/sunEvents，_p3.js sunAltRate。
   NOAA 低精度算法（~0.01°）—— 数值逐语义移植，禁止"顺手优化"。
   ========================================================================= */
import { DEG, RAD, clamp } from "./math";

export interface SolarPos {
  altitude: number;   // deg
  azimuth: number;    // deg，自正北顺时针
  declination: number;
  hourAngle: number;
}

export function solarPosition(ms: number, lat: number, lon: number): SolarPos {
  const jd = ms / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lam));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  let H = gmst * 15 * DEG + lon * DEG - ra;
  H = ((H + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const phi = lat * DEG;
  const sinAlt = clamp(
    Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H),
    -1, 1
  );
  const alt = Math.asin(sinAlt);
  let az = Math.acos(
    clamp(
      (Math.sin(decl) - sinAlt * Math.sin(phi)) /
        (Math.cos(alt) * Math.cos(phi) || 1e-9),
      -1, 1
    )
  );
  if (H > 0) az = 2 * Math.PI - az;
  return {
    altitude: alt * RAD,
    azimuth: az * RAD,
    declination: decl * RAD,
    hourAngle: H * RAD
  };
}

export function solarNoonMs(dayMs: number, lat: number, lon: number): number {
  let best = dayMs, bestAlt = -999;
  for (let k = 0; k < 288; k++) {
    const t = dayMs + k * 5 * 60000;
    const a = solarPosition(t, lat, lon).altitude;
    if (a > bestAlt) { bestAlt = a; best = t; }
  }
  for (let it = 0; it < 24; it++) {
    const a1 = solarPosition(best - 240000, lat, lon).altitude;
    const a2 = solarPosition(best + 240000, lat, lon).altitude;
    if (a2 > a1) best += 60000; else best -= 60000;
  }
  return best;
}

export interface SunEvents {
  noonMs: number;
  riseMs: number | null;
  setMs: number | null;
  polarDay: boolean;
  polarNight: boolean;
}

export function sunEvents(
  dayMs: number, lat: number, lon: number
): SunEvents {
  const noon = solarNoonMs(dayMs, lat, lon);
  const altNoon = solarPosition(noon, lat, lon).altitude;
  const H0 = -0.833;
  if (altNoon < H0) {
    return { noonMs: noon, riseMs: null, setMs: null, polarDay: false, polarNight: true };
  }
  function cross(dir: number): number | null {
    let t = noon, prev = altNoon;
    for (let k = 1; k <= 1440; k++) {
      const tt = noon + dir * k * 60000;
      const a = solarPosition(tt, lat, lon).altitude;
      if (prev >= H0 && a < H0) {
        let lo = tt - dir * 60000, hi = tt;
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          const am = solarPosition(mid, lat, lon).altitude;
          if (am < H0) hi = mid; else lo = mid;
        }
        return (lo + hi) / 2;
      }
      prev = a;
      t = tt;
    }
    return null;
  }
  const setMs = cross(1), riseMs = cross(-1);
  return {
    noonMs: noon,
    riseMs,
    setMs,
    polarDay: riseMs === null || setMs === null,
    polarNight: false
  };
}

/** 太阳高度角变化率（度/分钟） */
export function sunAltRate(ms: number, lat: number, lon: number): number {
  const a1 = solarPosition(ms - 6 * 60000, lat, lon).altitude;
  const a2 = solarPosition(ms + 6 * 60000, lat, lon).altitude;
  return Math.abs((a2 - a1) / 12) || 0.2;
}

/**
 * 当日朝/晚霞事件方位角（度，正北 0、顺时针）。
 * 口径与V1 _p6.js azimEventOf 同源：零取数纯天文，极昼/极夜用正午+12h 兜底。
 */
export function eventAzimuth(
  dateS: string, per: "am" | "pm", lat: number, lon: number
): number | null {
  try {
    const [Y, M, D] = String(dateS).split("-").map(Number);
    if (![Y, M, D].every((x) => isFinite(x) && x > 0)) return null;
    const ev = sunEvents(Date.UTC(Y, M - 1, D), lat, lon);
    const ms0 = per === "am" ? ev.riseMs : ev.setMs;
    const ms = ms0 == null ? ev.noonMs + 12 * 3600000 : ms0;
    const az = solarPosition(ms, lat, lon).azimuth;
    return isFinite(az) ? ((az % 360) + 360) % 360 : null;
  } catch {
    return null;
  }
}

/** 8 方位词（词典键）。与V1 dirWordOf 同式：45° 一档、四舍五入。 */
export const DIR_WORDS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
export function dirWordOf(brg: number): string {
  return DIR_WORDS[Math.round((((brg % 360) + 360) % 360) / 45) % 8];
}
