/* =========================================================================
   GLOWCAST v2 · 模式序列（原版 _p4.js makeSeries/mergeSeries 移植）
   Open-Meteo 响应 → 可按时间取值的序列；两套模式逐时平均出综合场。
   ========================================================================= */
import { isNum } from "./math";

export interface Series {
  at(key: string, ms: number): number | null;
  raw: Record<string, { t: number; v: number | null }[]>;
}

/** Open-Meteo 逐小时响应 → 序列（时间轴取响应 time 列） */
export function makeSeries(data: {
  hourly?: Record<string, unknown>;
}): Series {
  const hh = data.hourly || {};
  const times = ((hh.time || []) as string[]).map((s) =>
    Date.parse(String(s).length === 16 ? s + ":00" : s)
  );
  const raw: Series["raw"] = {};
  for (const key of Object.keys(hh)) {
    if (key === "time") continue;
    const arr = hh[key];
    raw[key] = Array.isArray(arr)
      ? (arr as unknown[]).map((v, i) => ({
          t: times[i] ?? 0,
          v: isNum(v) ? (v as number) : null
        }))
      : [];
  }
  return {
    raw,
    at(key: string, ms: number): number | null {
      const rows = raw[key];
      if (!rows || !rows.length) return null;
      if (ms <= rows[0].t) return rows[0].v;
      if (ms >= rows[rows.length - 1].t) return rows[rows.length - 1].v;
      let lo = 0, hi = rows.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].t <= ms) lo = mid; else hi = mid;
      }
      const a = rows[lo].v, b = rows[hi].v;
      if (!isNum(a)) return b;
      if (!isNum(b)) return a;
      const t0 = rows[lo].t, t1 = rows[hi].t;
      const f = t1 === t0 ? 0 : (ms - t0) / (t1 - t0);
      return a + (b - a) * f;
    }
  };
}

/** 两套模式逐时平均（综合场） */
export function mergeSeries(a: Series | null, b: Series | null): Series | null {
  if (!a) return b;
  if (!b) return a;
  const keys = new Set([...Object.keys(a.raw), ...Object.keys(b.raw)]);
  const raw: Series["raw"] = {};
  for (const k of keys) {
    const ra = a.raw[k] || [], rb = b.raw[k] || [];
    const map = new Map<number, Array<number | null>>();
    for (const r of ra) {
      const cur = map.get(r.t) || [null, null];
      cur[0] = r.v;
      map.set(r.t, cur);
    }
    for (const r of rb) {
      const cur = map.get(r.t) || [null, null];
      cur[1] = r.v;
      map.set(r.t, cur);
    }
    const ts = [...map.keys()].sort((x, y) => x - y);
    raw[k] = ts.map((t) => {
      const [x, y] = map.get(t)!;
      const v = isNum(x) && isNum(y) ? (x + y) / 2 : isNum(x) ? x : isNum(y) ? y : null;
      return { t, v };
    });
  }
  return {
    raw,
    at(key: string, ms: number): number | null {
      const rows = raw[key];
      if (!rows || !rows.length) return null;
      if (ms <= rows[0].t) return rows[0].v;
      if (ms >= rows[rows.length - 1].t) return rows[rows.length - 1].v;
      let lo = 0, hi = rows.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].t <= ms) lo = mid; else hi = mid;
      }
      const a = rows[lo].v, b = rows[hi].v;
      if (!isNum(a)) return b;
      if (!isNum(b)) return a;
      const t0 = rows[lo].t, t1 = rows[hi].t;
      const f = t1 === t0 ? 0 : (ms - t0) / (t1 - t0);
      return a + (b - a) * f;
    }
  };
}
