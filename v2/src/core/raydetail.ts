/* =========================================================================
   SUNGLOW v2 · 光追细节的中间量（页面卡片与合成分享卡共用）
   ---------------------------------------------------------------------------
   这些量本来写在 RayDetail.vue 的 computed 里。合成卡要画同一份推导，
   复制一遍必然漂移，所以抽到这里：**只算数，不管排版**。
   页面用 SVG、分享卡用 canvas，各自把归一化结果映射到自己的坐标系。
   ========================================================================= */
import { t } from "./i18n";
import { uAlt, uDist } from "./units";
import { clamp, clamp01, isNum } from "./math";
import type { ForecastResult } from "./forecast";

export interface RayRow { k: string; v: string }

const n1 = (v: number | null | undefined, d = 1): string =>
  isNum(v) ? v.toFixed(d) : "—";

export function fmtDur(min: number): string {
  if (!isNum(min)) return "—";
  if (min <= 0) return t("0 分");
  const m = Math.floor(min), s = Math.round((min - m) * 60);
  return m > 0 ? t("{m} 分 {s} 秒", { m, s }) : t("{s} 秒", { s });
}

/** 关键量表格：13 行，口径与页面一致 */
export function rayRows(r: ForecastResult): RayRow[] {
  const s = r.sRT, g = s.geom;
  return [
    { k: "主云型", v: `${t(s.primary.type)} · ${t(s.primary.name)}` },
    { k: "云底高度", v: uAlt(s.primary.base * 1000) },
    { k: "云量", v: `${Math.round(s.primary.cover)}%` },
    { k: "视线距离", v: uDist(s.d, 0) },
    { k: "几何窗口", v: `${Math.round(g.dur)} ${t("分钟")}` },
    { k: "亮度等级", v: t(s.bright.txt) },
    { k: "峰值透射率 T(550nm)", v: s.peak.T550.toExponential(2) },
    { k: "峰值路径光学厚度 τ", v: s.peak.tau550.toFixed(1) },
    { k: "峰值颜色", v: `${t(s.peak.name)} · ${t("饱和")} ${Math.round(s.peak.sat * 100)}%` },
    { k: "色相跨距（颜色丰富度）", v: `${s.hueSpread.toFixed(0)}°` },
    { k: "气溶胶标高 Hs", v: `${n1(s.Hs, 2)} km` },
    { k: "近边界角（云遮挡）", v: `${n1(g.thNearDeg, 2)}°` },
    { k: "远边界角（地球遮挡）", v: `${n1(g.thFarDeg, 2)}°` }
  ];
}

export interface RayFactor { k: string; raw: string; v: number }
export function rayFactors(r: ForecastResult): RayFactor[] {
  const s = r.sRT;
  return [
    { k: "几何", raw: `${t("边界")} ${uDist(s.d, 0)}`, v: s.geomF },
    { k: "云量", raw: `${Math.round(s.primary.cover)}%`, v: s.coverF },
    { k: "通透度", raw: `AOD ${s.aodUp.toFixed(2)}`, v: s.aeroF }
  ];
}

export interface RayCurvePoint {
  /** 事件后分钟数 */
  min: number;
  /** 相对亮度（已按峰值归一，0–1） */
  lum: number;
  /** OKLab 彩度（已按峰值归一，0–1） */
  chroma: number;
  hex: string;
}
export interface RayCurve {
  points: RayCurvePoint[];
  maxMin: number;
  peakMin: number;
  maxC: number;
  axis: [string, string, string];
}

/** 强度-彩度时间曲线：与V1 rayCurve 同式，只输出归一化点 */
export function rayCurve(r: ForecastResult): RayCurve | null {
  const sm = r.sRT.samples || [];
  if (sm.length < 2) return null;
  const g = r.sRT.geom;
  const om = isNum(r.omega) && r.omega > 0.01 ? r.omega : 0.2;
  const okGeo = isNum(g.thNearDeg) && isNum(g.thFarDeg);
  const mins = sm.map((x, i) =>
    okGeo ? (g.thNearDeg + x.t * (g.thFarDeg - g.thNearDeg)) / om : i * 3
  );
  const mx = Math.max(Math.max(...mins) * 1.06, 0.5);
  const maxL = Math.max(...sm.map((x) => x.lumRel || 0)) || 1;
  const maxC = Math.max(...sm.map((x) => x.chroma || 0)) || 1;
  let pk = 0;
  for (let i = 1; i < sm.length; i++) if ((sm[i].lumRel || 0) > (sm[pk].lumRel || 0)) pk = i;
  return {
    points: sm.map((x, i) => ({
      min: mins[i],
      lum: clamp01((x.lumRel || 0) / maxL),
      chroma: clamp01((x.chroma || 0) / maxC),
      hex: x.hex
    })),
    maxMin: mx,
    peakMin: mins[pk],
    maxC,
    axis: [t("0 分"), fmtDur(mx / 2), fmtDur(mx)]
  };
}

export interface RayTimelineOk {
  ok: true;
  /** 起止在轴上的比例（0–1），轴长为 end / 0.88 */
  startFrac: number;
  endFrac: number;
  start: string;
  end: string;
}
export interface RayTimelineBad { ok: false; warn: string }
export type RayTimeline = RayTimelineOk | RayTimelineBad;

/** 本地云底被照亮时段（火烧云三角） */
export function rayTimeline(r: ForecastResult): RayTimeline {
  const g = r.sRT.geom;
  if (!g.ok) {
    const why = isNum(r.sRT.d)
      ? t("云边界距离 {d} 已超过霞光深入距离上限 {m}（该云盘范围内阳光无法从云底下方射入）", {
          d: uDist(r.sRT.d), m: uDist(g.xMax)
        })
      : t("日出/日落方向 400 km 内没有找到可承载霞光的云盘");
    return {
      ok: false,
      warn: t("几何条件不成立：{why}。光追结果按最接近的掠射情形估算，仅作参考。", { why })
    };
  }
  const om = isNum(r.omega) && r.omega > 0 ? r.omega : 0.2;
  const t0 = g.thNearDeg / om, t1 = g.thFarDeg / om;
  const mx = Math.max(t1 * 1.12, 0.8);
  return {
    ok: true,
    startFrac: clamp(t0 / mx, 0, 1),
    endFrac: clamp(t1 / mx, 0, 1),
    start: fmtDur(t0),
    end: fmtDur(t1)
  };
}
