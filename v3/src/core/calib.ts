/* =========================================================================
   GLOWCAST v3 ·（自 v2 已验证移植起点） F4 本地校准
   口径来源：原版 _p5.js 校准存储。四条硬边界原样保留：
   ① 只展示不回改模型  ② 样本不够不给结论（CALIB_MIN_N=8 / CALIB_MIN_BUCKET=3）
   ③ a=-1 不进统计  ④ 关掉 ≠ 删除（开关与清空分离）
   存储键独立命名空间：glowcast.v3.calib
   ========================================================================= */
import { clamp, isNum } from "./math";

export const CALIB_KEY = "glowcast.v3.calib";
export const CALIB_GRID_DEG = 0.5;
export const CALIB_BUCKET = 20;
export const CALIB_HIT_MIN = 2;
export const CALIB_MIN_N = 8;
export const CALIB_MIN_BUCKET = 3;
export const CALIB_MAX = 200;
export const CALIB_AFTER_H = -1;
export const CALIB_MARKS = [-1, 0, 1, 2, 3, 4];

export interface CalibRow {
  lat: number; lon: number; date: string; period: "am" | "pm";
  P: number; Q: number; a: number; t: number;
}

function calibClean(o: unknown): CalibRow | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  if (!isNum(r.lat) || (r.lat as number) < -90 || (r.lat as number) > 90) return null;
  if (!isNum(r.lon) || (r.lon as number) < -180 || (r.lon as number) > 180) return null;
  if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return null;
  if (r.period !== "am" && r.period !== "pm") return null;
  if (!isNum(r.P) || !isNum(r.Q) || !isNum(r.a)) return null;
  const a = Math.round(r.a as number);
  if (CALIB_MARKS.indexOf(a) < 0) return null;
  return {
    lat: Math.round((r.lat as number) * 1000) / 1000,
    lon: Math.round((r.lon as number) * 1000) / 1000,
    date: r.date, period: r.period,
    P: clamp(r.P as number, 0, 100),
    Q: clamp(r.Q as number, 0, 100),
    a,
    t: isNum(r.t) ? (r.t as number) : 0
  };
}

export function calibRead(): CalibRow[] {
  const out: CalibRow[] = [];
  try {
    const j = JSON.parse(localStorage.getItem(CALIB_KEY) || "null");
    const list = j && Array.isArray(j.rows) ? j.rows : null;
    if (!list) return out;
    for (let i = 0; i < list.length && out.length < CALIB_MAX; i++) {
      const r = calibClean(list[i]);
      if (r) out.push(r);
    }
  } catch { /* 隐私模式等，静默降级 */ }
  return out;
}

export function calibSave(rows: CalibRow[]): void {
  try {
    localStorage.setItem(CALIB_KEY, JSON.stringify({ v: 1, rows }));
  } catch { /* 配额不足 */ }
}

export function calibGroupOf(lat: number, lon: number): string {
  const k = 1 / CALIB_GRID_DEG;
  return Math.round(lat * k) + "," + Math.round(lon * k);
}

export function calibCanAnnotate(leadH: number | null | undefined): boolean {
  return isNum(leadH) && leadH <= CALIB_AFTER_H;
}

export function calibBucketOf(P: number): number {
  return clamp(Math.floor(clamp(P, 0, 100) / CALIB_BUCKET), 0, 100 / CALIB_BUCKET - 1);
}

export function calibFindGroup(rows: CalibRow[], lat: number, lon: number): CalibRow[] {
  const g = calibGroupOf(lat, lon);
  return rows.filter((r) => r.a >= 0 && calibGroupOf(r.lat, r.lon) === g);
}

export function calibFind(
  rows: CalibRow[], lat: number, lon: number, date: string, period: string
): CalibRow | null {
  const g = calibGroupOf(lat, lon);
  const hit = rows.filter(
    (r) => r.date === date && r.period === period && calibGroupOf(r.lat, r.lon) === g
  );
  return hit.length ? hit[hit.length - 1] : null;
}

export function calibSet(
  rows: CalibRow[],
  lat: number, lon: number, date: string, period: "am" | "pm",
  P: number, Q: number, a: number
): CalibRow | null {
  const g = calibGroupOf(lat, lon);
  const rec = calibClean({ lat, lon, date, period, P, Q, a, t: Date.now() });
  if (!rec) return null;
  const next = rows.slice();
  let at = -1;
  for (let i = next.length - 1; i >= 0; i--) {
    if (
      next[i].date === date && next[i].period === period &&
      calibGroupOf(next[i].lat, next[i].lon) === g
    ) { at = i; break; }
  }
  if (at >= 0) next[at] = rec; else next.push(rec);
  while (next.length > CALIB_MAX) next.shift();
  calibSave(next);
  return rec;
}

export interface CalibStats {
  bucket: number; lo: number; hi: number;
  nAll: number; nBucket: number; hit: number;
  obs: number | null; pred: number | null;
  delta: number | null; enough: boolean;
}

export function calibStats(
  rows: CalibRow[], lat: number, lon: number, P: number
): CalibStats {
  const group = calibFindGroup(rows, lat, lon);
  const bucket = calibBucketOf(P);
  const inB = group.filter((r) => calibBucketOf(r.P) === bucket);
  let sumP = 0, hit = 0;
  for (const r of inB) {
    sumP += r.P;
    if (r.a >= CALIB_HIT_MIN) hit++;
  }
  const nBucket = inB.length;
  const obs = nBucket ? (hit / nBucket) * 100 : null;
  const pred = nBucket ? sumP / nBucket : null;
  return {
    bucket, lo: bucket * CALIB_BUCKET, hi: (bucket + 1) * CALIB_BUCKET,
    nAll: group.length, nBucket, hit, obs, pred,
    delta: obs === null || pred === null ? null : obs - pred,
    enough: group.length >= CALIB_MIN_N && nBucket >= CALIB_MIN_BUCKET
  };
}
