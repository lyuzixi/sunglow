/* ---------------- spectrum.py ---------------- */
const RAYLEIGH_TAU_550 = 0.098;
const AEROSOL_ANGSTROM = 1.3;
const AEROSOL_SCALE_HEIGHT = 1.4;
const RAYLEIGH_SCALE_HEIGHT = 7.5;
const AEROSOL_AIRMASS_GAIN = 12.0;
const SUN_TEMP = 5778.0;

function planck(lamNm, temp = SUN_TEMP) {
  const lam = lamNm * 1e-9;
  const h = 6.62607015e-34, c = 2.99792458e8, k = 1.380649e-23;
  return (2 * h * c * c / lam ** 5) / (Math.exp(h * c / (lam * k * temp)) - 1);
}

function gauss(x, mu, s1, s2) {
  const s = x < mu ? s1 : s2;
  return Math.exp(-0.5 * ((x - mu) / s) ** 2);
}

function cieXyz(lam) {
  const x = 1.056 * gauss(lam, 599.8, 37.9, 31.0)
    + 0.362 * gauss(lam, 442.0, 16.0, 26.7)
    - 0.065 * gauss(lam, 501.1, 20.4, 26.2);
  const y = 0.821 * gauss(lam, 568.8, 46.9, 40.5)
    + 0.286 * gauss(lam, 530.9, 16.3, 31.1);
  const z = 1.217 * gauss(lam, 437.0, 11.8, 36.0)
    + 0.681 * gauss(lam, 459.0, 26.0, 13.8);
  return [x, y, z];
}

const LAMBDAS = Array.from({ length: 61 }, (_, i) => 400 + 5 * i);
const CMF = LAMBDAS.map(l => cieXyz(l));
const PLANCK_N = LAMBDAS.map(l => planck(l));
const MAXP = Math.max(...PLANCK_N);

function xyzToLinearRgb(x, y, z) {
  return [3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.2040 * y + 1.0570 * z];
}

function gamma(c) {
  c = Math.max(0.0, Math.min(1.0, c));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function airmass(sunElev, cloudBaseKm) {
  const tangentRay = 38.0 * Math.exp(-cloudBaseKm / RAYLEIGH_SCALE_HEIGHT);
  const tangentAer = AEROSOL_AIRMASS_GAIN * Math.exp(-cloudBaseKm / AEROSOL_SCALE_HEIGHT);
  if (sunElev >= 0) {
    const s = Math.max(Math.sin(sunElev * Math.PI / 180), 0.005);
    return [Math.min(tangentRay, 1.0 / s), Math.min(tangentAer, 0.75 / s), cloudBaseKm];
  }
  const alpha = -sunElev * Math.PI / 180;
  const hT = Math.max(0.0, cloudBaseKm - R_EARTH * alpha * alpha / 2.0);
  return [38.0 * Math.exp(-hT / RAYLEIGH_SCALE_HEIGHT),
    AEROSOL_AIRMASS_GAIN * Math.exp(-hT / AEROSOL_SCALE_HEIGHT), hT];
}

function deckLight(cloudBaseKm, sunElev, aod) {
  let mRay, mAer, hT;
  if (sunElev >= -0.05 && cloudBaseKm <= 0.05) {
    [mRay, mAer, hT] = airmass(Math.max(sunElev, 0.0), 0.001);
  } else {
    [mRay, mAer, hT] = airmass(sunElev, cloudBaseKm);
  }
  aod = Math.max(0.0, aod == null ? 0.15 : aod);

  let X = 0, Y = 0, Z = 0, Xw = 0, Yw = 0, Zw = 0;
  let t470 = 1.0, t620 = 1.0, tau550 = 0.0;
  for (let i = 0; i < LAMBDAS.length; i++) {
    const lam = LAMBDAS[i];
    const tau = RAYLEIGH_TAU_550 * Math.pow(550.0 / lam, 4.1) * mRay
      + aod * Math.pow(550.0 / lam, AEROSOL_ANGSTROM) * mAer;
    const T = Math.exp(-tau);
    const base = PLANCK_N[i] / MAXP;
    const spec = base * T;
    const [cx, cy, cz] = CMF[i];
    X += spec * cx; Y += spec * cy; Z += spec * cz;
    Xw += base * cx; Yw += base * cy; Zw += base * cz;
    if (lam === 550) tau550 = tau;
    if (lam === 470) t470 = T;
    if (lam === 620) t620 = T;
  }

  const lum = Y / Math.max(Yw, 1e-9);
  if (lum <= 1e-9) {
    return { lum: 0.0, rgb: [120, 90, 80], redness: 1.0, tau550, tangent_km: hT, m_ray: mRay, m_aer: mAer };
  }
  const denom = Math.max(X + Y + Z, 1e-12);
  const cx = X / denom, cy = Y / denom;
  const Yn = Math.max(lum, 1e-6);
  const Xn = cx / Math.max(cy, 1e-6) * Yn;
  const Zn = (1.0 - cx - cy) / Math.max(cy, 1e-6) * Yn;
  let [r, g, b] = xyzToLinearRgb(Xn, Yn, Zn);
  r = Math.max(0, r); g = Math.max(0, g); b = Math.max(0, b);
  const mx = Math.max(r, g, b, 1e-9);
  r /= mx; g /= mx; b /= mx;
  const shade = 0.55 + 0.45 * Math.min(1.0, Math.pow(lum / 0.25, 0.35));
  const rgb = [r, g, b].map(c => Math.round(255 * gamma(c) * shade));
  return { lum, rgb, redness: t620 / Math.max(t470, 1e-9), tau550, tangent_km: hT, m_ray: mRay, m_aer: mAer };
}

function colourName(rgb, lum) {
  if (lum < 0.004) return "暗红余晖";
  const [r, g, b] = rgb;
  if (r > 200 && g > 150 && b < 120) return "金黄";
  if (r > 210 && g > 110) return "橘黄";
  if (r > 190 && g > 60) return "橘红";
  if (r > 150 && b < 110) return "绯红";
  return "玫瑰红";
}

