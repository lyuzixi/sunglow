/* =========================================================================
   GLOWCAST v3「追光航志」· 观测决策推导（V3 新能力，只从基线输出推导）
   --------------------------------------------------------------------------
   不发明新评分公式。全部输入来自：
     · MapPoint（逐点 P/Q/grade/cld/dur —— 原版口径的 mapdata 输出）
     · sunEvents / solarPosition（天文基线）
     · FireGeom.dur（火烧窗口时长，分钟）
   推导规则（展示层，写清楚便于审阅）：
     · 排序 = mixedIndex(P,Q) 降序（与原版「最值得去」日历同源，那边按 Q，
       V3 取综合指数 I，理由：决策问的是"值不值得跑一趟"，概率与质量都要看）
     · 朝向 = 该点事件时刻太阳方位角 evAz（astro 基线）
     · 窗口 = [evMs − 25min, evMs + max(dur, 8)min]
       （日落/日出前 25 分钟到位是黄金时段尾巴；dur 是火三角几何算出的持续时间）
     · 到位建议 = 窗口起点 − 20 min（找机位、架三脚架的余量）
   ========================================================================= */
import { isNum, haversineKm } from "./math";
import { solarPosition, sunEvents } from "./astro";
import { mixedIndex } from "./scoring";
import type { MapPoint } from "./mapdata";

export interface Spot {
  rank: number;
  name: string;
  prov: string;
  lat: number;
  lon: number;
  distKm: number;
  P: number;
  Q: number;
  I: number;
  grade: string;
  cld: number;
  /** 事件时刻太阳方位角（正北=0，顺时针） */
  az: number;
  azLabel: string;
  /** 最佳观赏窗口 [start,end]（ms） */
  winStart: number;
  winEnd: number;
  /** 到位建议时刻（ms） */
  arriveBy: number;
  durMin: number;
  color: string;
}

const DIRS8 = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
export function azLabel(az: number): string {
  const i = Math.round(((az % 360) + 360) % 360 / 45) % 8;
  return DIRS8[i] + " " + Math.round(((az % 360) + 360) % 360) + "°";
}

const LEAD_MIN = 25;
const ARRIVE_EARLY_MIN = 20;
const BASE_DUR_MIN = 8;

/** 从观测场点集推导 Top-N 推荐（去哪拍） */
export function topSpots(
  pts: MapPoint[],
  opts: {
    centerLat: number; centerLon: number;
    evMs: number; period: "am" | "pm";
    dayMs: number;
    n?: number;
  }
): Spot[] {
  const n = opts.n ?? 3;
  const ranked = pts
    .filter((p) => isNum(p.P) && isNum(p.Q))
    .map((p) => ({ p, I: mixedIndex(p.P, p.Q) }))
    .sort((a, b) => b.I - a.I)
    .slice(0, n);

  return ranked.map((x, i) => {
    const p = x.p;
    const az = solarPosition(opts.evMs, p.lat, p.lon).azimuth;
    const durMin = isNum(p.dur) && p.dur > 0 ? p.dur : BASE_DUR_MIN;
    const winStart = opts.evMs - LEAD_MIN * 60000;
    const winEnd = opts.evMs + Math.max(durMin, BASE_DUR_MIN) * 60000;
    return {
      rank: i + 1,
      name: p.name,
      prov: p.prov,
      lat: p.lat,
      lon: p.lon,
      distKm: haversineKm(opts.centerLat, opts.centerLon, p.lat, p.lon),
      P: p.P, Q: p.Q, I: x.I,
      grade: p.grade,
      cld: p.cld,
      az,
      azLabel: azLabel(az),
      winStart,
      winEnd,
      arriveBy: winStart - ARRIVE_EARLY_MIN * 60000,
      durMin: Math.round(durMin),
      color: p.color
    };
  });
}

/** 机会日历一格（趋势行 → 决策读法） */
export interface DayCell {
  dateS: string;
  weekday: number;              // 0=周日
  am: { P: number; Q: number; grade: string } | null;
  pm: { P: number; Q: number; grade: string } | null;
  /** 该日最强一档的综合指数（排序用） */
  I: number;
  bestPeriod: "am" | "pm" | null;
}

export function dayCells(
  rows: Array<{ date: string; am: { P: number; Q: number; grade: string } | null; pm: { P: number; Q: number; grade: string } | null }>
): DayCell[] {
  return rows.map((r) => {
    const cand: Array<{ per: "am" | "pm"; P: number; Q: number; grade: string }> = [];
    if (r.am && isNum(r.am.Q)) cand.push({ per: "am", ...r.am });
    if (r.pm && isNum(r.pm.Q)) cand.push({ per: "pm", ...r.pm });
    cand.sort((a, b) => mixedIndex(b.P, b.Q) - mixedIndex(a.P, a.Q));
    const top = cand[0] || null;
    const [Y, M, D] = r.date.split("-").map(Number);
    return {
      dateS: r.date,
      weekday: new Date(Date.UTC(Y, M - 1, D)).getUTCDay(),
      am: r.am,
      pm: r.pm,
      I: top ? mixedIndex(top.P, top.Q) : -1,
      bestPeriod: top ? top.per : null
    };
  });
}

/** 排出「最值得去」的前 N 个时段（跨日跨时段，与原版 F3 日历同思路） */
export function bestSlots(
  rows: Array<{ date: string; am: { P: number; Q: number } | null; pm: { P: number; Q: number } | null }>,
  n = 3
): Array<{ dateS: string; period: "am" | "pm"; I: number }> {
  const flat: Array<{ dateS: string; period: "am" | "pm"; I: number }> = [];
  rows.forEach((r) => {
    (["am", "pm"] as const).forEach((per) => {
      const c = r[per];
      if (c && isNum(c.Q)) flat.push({ dateS: r.date, period: per, I: mixedIndex(c.P, c.Q) });
    });
  });
  return flat.sort((a, b) => b.I - a.I).slice(0, n);
}

/** 事件时刻（供窗口/倒计时复用） */
export function eventOfDay(dayMs: number, lat: number, lon: number, period: "am" | "pm"): number {
  const ev = sunEvents(dayMs, lat, lon);
  const fix = (m: number | null) => (m == null ? ev.noonMs + 12 * 3600000 : m);
  return period === "am" ? fix(ev.riseMs) : fix(ev.setMs);
}
