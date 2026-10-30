/* =========================================================================
   SUNGLOW v2 · 天色带（单一来源）
   原来这段算在 SkyBand.vue 里，分享图要复用同一份结果，就抽成纯函数：
   页面与导出图各算一遍的后果是「图上说的和屏上说的不一样」，那是硬伤。
   口径不变：五段固定曙暮光序列，段宽＝该段真实时长（太阳高度角 0/−6/−12/−18/−20°）；
   霞光窗口 = 云边界 θnear → 地球遮挡 θfar。
   ========================================================================= */
import { solarPosition } from "./astro";
import { uClock } from "./units";
import { t } from "./i18n";
import { todayInTz, isForeignTz, tzLabel } from "./tz";
import type { ForecastResult } from "./forecast";

export interface SkySeg { cls: string; m: number; title: string }
export interface SkyMark { p: number; name: string; time: string; cls: string }

export interface SkyBandData {
  segs: SkySeg[];
  win: { left: number; width: number } | null;
  marks: SkyMark[];
  glowX: number;
  nowPct: number | null;
  nowText: string;
  tzHint: string;
  /** 带子覆盖的真实时刻区间（分享图要用同一条时间轴算百分比） */
  startMs: number;
  endMs: number;
}

/**
 * @param r          一次预报结果
 * @param nowMs      当前真实时刻（epoch ms）
 * @param dateStr    页面上选中的日期（城市当地日），用于判断「此刻」是否落在带内
 */
export function skyBandOf(
  r: ForecastResult, nowMs: number, dateStr: string
): SkyBandData | null {
  const isAM = r.period === "am";
  const dir = isAM ? -1 : 1; // 时间推进方向
  const evMs = r.evMs;
  const altOf = (ms: number) => solarPosition(ms, r.city.lat, r.city.lon).altitude;
  const cross = (target: number, d: number): number | null => {
    let lo = evMs, hi = evMs + d * 6 * 3600000;
    const f = (ms: number) => altOf(ms) - target;
    if (!(f(lo) * f(hi) <= 0)) return null;
    for (let i = 0; i < 44; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) * f(lo) > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const tEdge = cross(2, -dir);
  const t6 = cross(-6, dir), t12 = cross(-12, dir);
  const t18 = cross(-18, dir), t20 = cross(-20, dir);
  if (tEdge == null || t6 == null || t12 == null || t18 == null || t20 == null) return null;
  const tStart = Math.min(tEdge, t20), tEnd = Math.max(tEdge, t20);
  const span = tEnd - tStart;
  if (!(span > 60000)) return null;

  const seg = (cls: string, a: number, b: number, title: string) => ({
    cls, m: Math.max(0.01, (b - a) / 60000), title
  });
  const segs = isAM
    ? [seg("s-night", tStart, t18, t("夜间")),
       seg("s-astro", t18, t12, t("天文曙暮光")),
       seg("s-naut", t12, t6, t("航海曙暮光")),
       seg("s-civil", t6, evMs, t("民用曙暮光")),
       seg("s-day", evMs, tEnd, t("白昼余晖"))]
    : [seg("s-day", tStart, evMs, t("白昼余晖")),
       seg("s-civil", evMs, t6, t("民用曙暮光")),
       seg("s-naut", t6, t12, t("航海曙暮光")),
       seg("s-astro", t12, t18, t("天文曙暮光")),
       seg("s-night", t18, tEnd, t("夜间"))];

  /* 霞光窗口：θnear（云边界）→ θfar（地球遮挡） */
  let win: { left: number; width: number } | null = null;
  const g = r.sRT.geom;
  if (g && g.ok && isFinite(g.thNearDeg) && isFinite(g.thFarDeg)) {
    const a = cross(-g.thNearDeg, dir), b = cross(-g.thFarDeg, dir);
    if (a != null && b != null) {
      const ws = Math.max(tStart, Math.min(a, b));
      const we = Math.min(tEnd, Math.max(a, b));
      if (we > ws) {
        win = {
          left: ((ws - tStart) / span) * 100,
          width: ((we - ws) / span) * 100
        };
      }
    }
  }

  const pct = (ms: number) => ((ms - tStart) / span) * 100;
  /* 「现在」游标：日期与时刻都必须按城市当地时间比，否则跨时区时游标永远不出现 */
  const tz = r.tz;
  const today = tz ? todayInTz(tz, nowMs) : dateStr;
  const nowIn = dateStr === today && nowMs >= tStart && nowMs <= tEnd;

  const nameOf = (k: "ev" | "a" | "b" | "c") =>
    isAM
      ? { ev: t("日出"), a: t("渐亮"), b: t("淡蓝"), c: t("天亮") }[k]
      : { ev: t("日落"), a: t("渐暗"), b: t("深蓝"), c: t("天黑") }[k];

  const marks: SkyMark[] = [
    { p: pct(evMs), name: nameOf("ev"), time: uClock(evMs, tz), cls: "an-l" },
    { p: pct(t6), name: nameOf("a"), time: uClock(t6, tz), cls: "" },
    { p: pct(t12), name: nameOf("b"), time: uClock(t12, tz), cls: "" },
    { p: pct(t18), name: nameOf("c"), time: uClock(t18, tz), cls: "an-r" }
  ];

  return {
    segs, win, marks,
    glowX: win ? win.left + win.width / 2 : 50,
    nowPct: nowIn ? pct(nowMs) : null,
    nowText: nowIn ? uClock(nowMs, tz) : "",
    tzHint: tz && isForeignTz(tz) ? tzLabel(tz) : "",
    startMs: tStart,
    endMs: tEnd
  };
}
