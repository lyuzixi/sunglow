/* ---------------- solar.py ---------------- */
/* 从原版单文件页第 369–370 行带过来的全局常量（原本在 solar 段之前）。 */
const R_EARTH = 6371.0088;
const REFRACTION = -0.833;

function julian(ms) { return ms / 86400000.0 + 2440587.5; }

function solarPosition(lat, lon, ms) {
  const jd = julian(ms);
  const T = (jd - 2451545.0) / 36525.0;
  const L0 = ((280.46646 + 36000.76983 * T + 0.0003032 * T * T) % 360.0 + 360.0) % 360.0;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  const Mr = M * Math.PI / 180;
  const C = ((1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mr)
    + (0.019993 - 0.000101 * T) * Math.sin(2 * Mr)
    + 0.000289 * Math.sin(3 * Mr));
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lam = trueLong - 0.00569 - 0.00478 * Math.sin(omega * Math.PI / 180);
  const eps0 = 23.0 + (26.0 + (21.448 - 46.815 * T - 0.00059 * T * T + 0.001813 * T ** 3) / 60.0) / 60.0;
  const eps = eps0 + 0.00256 * Math.cos(omega * Math.PI / 180);
  const decl = Math.asin(Math.sin(eps * Math.PI / 180) * Math.sin(lam * Math.PI / 180));
  const y = Math.tan(eps * Math.PI / 360.0) ** 2;
  const L0r = L0 * Math.PI / 180;
  const eqtime = 4.0 * (180 / Math.PI) * (
    y * Math.sin(2 * L0r) - 2.0 * e * Math.sin(Mr)
    + 4.0 * e * y * Math.sin(Mr) * Math.cos(2 * L0r)
    - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr));

  const d = new Date(ms);
  const utcMin = d.getUTCHours() * 60.0 + d.getUTCMinutes() + d.getUTCSeconds() / 60.0;
  const tst = ((utcMin + eqtime + 4.0 * lon) % 1440.0 + 1440.0) % 1440.0;
  const ha = tst / 4.0 - 180.0;

  const latr = lat * Math.PI / 180;
  const har = ha * Math.PI / 180;
  let cosz = Math.sin(latr) * Math.sin(decl) + Math.cos(latr) * Math.cos(decl) * Math.cos(har);
  cosz = Math.max(-1.0, Math.min(1.0, cosz));
  const zen = Math.acos(cosz) * 180 / Math.PI;
  const elev = 90.0 - zen;

  const sinz = Math.sin(zen * Math.PI / 180);
  let az;
  if (sinz < 1e-9) {
    az = 0.0;
  } else {
    let v = (Math.cos(latr) * Math.sin(decl)
      - Math.sin(latr) * Math.cos(decl) * Math.cos(har)) / Math.max(1e-9, Math.cos(elev * Math.PI / 180));
    v = Math.max(-1.0, Math.min(1.0, v));
    az = Math.acos(v) * 180 / Math.PI;
    if (ha > 0) az = (360.0 - az) % 360.0;
  }
  return [elev, az];
}

/* Local civil date at a fixed UTC offset -> epoch ms of local midnight. */
function localMidnightMs(y, m, day, offsetHours) {
  return Date.UTC(y, m - 1, day, 0, 0, 0) - offsetHours * 3600000;
}

function findCrossing(lat, lon, startMs, hoursSpan, rising, stepMin) {
  let prevT = startMs;
  let prevE = solarPosition(lat, lon, prevT)[0];
  const n = Math.floor(hoursSpan * 60 / stepMin);
  for (let i = 1; i <= n; i++) {
    const t = startMs + i * stepMin * 60000;
    const e = solarPosition(lat, lon, t)[0];
    const crossed = rising ? (prevE < REFRACTION && REFRACTION <= e)
      : (prevE >= REFRACTION && REFRACTION > e);
    if (crossed) {
      let lo = prevT, hi = t;
      for (let k = 0; k < 18; k++) {
        const mid = lo + (hi - lo) / 2;
        const em = solarPosition(lat, lon, mid)[0];
        if ((em < REFRACTION) === rising) lo = mid; else hi = mid;
      }
      return lo + (hi - lo) / 2;
    }
    prevT = t; prevE = e;
  }
  return null;
}

function eventTimes(lat, lon, y, m, day, offsetHours, stepMin = 2, which = null) {
  const start = localMidnightMs(y, m, day, offsetHours);
  return {
    sunrise: which === "sunset" ? null : findCrossing(lat, lon, start, 24.0, true, stepMin),
    sunset: which === "sunrise" ? null : findCrossing(lat, lon, start, 24.0, false, stepMin),
  };
}

function illuminationLimit(cloudBaseKm) {
  if (cloudBaseKm <= 0) return 0.0;
  return -(180 / Math.PI) * Math.sqrt(2.0 * cloudBaseKm / R_EARTH);
}

