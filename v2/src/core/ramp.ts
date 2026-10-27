/* =========================================================================
   GLOWCAST v2 · 光谱色阶
   与V1 HEAT_RAMP（白→黄→橙→红）不同 —— 用户选定「换新色阶（与光效统一）」。
   本尺与视觉方向 A（大气光谱观测站）的光谱渐变同源：
   深靛 → 品红 → 琥珀 → 电离青（高值端最亮）。
   注意：预报评分算法口径不变，仅地图/图表着色换尺。
   ========================================================================= */
import { clamp, lerp } from "./math";

/** 光谱色阶锚点（0% → 100%）。高值端用最亮的电离青白。 */
export const SPECTRUM_RAMP = [
  "#101a33",  // 0%   深空靛
  "#2b2352",  // 14%  紫罗兰
  "#7a2d6b",  // 29%  洋红紫
  "#d13d6e",  // 43%  品红
  "#ff6a4d",  // 57%  珊瑚橙
  "#ff9c3f",  // 71%  琥珀
  "#ffd76a",  // 86%  金
  "#eafcff"   // 100% 电离青白
];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16)
  ];
}

/** 0–100 取色（逐段 sRGB 线性插值，与V1 rampColor 同构） */
export function rampColor(v: number): string {
  const c = SPECTRUM_RAMP;
  const x = (clamp(v, 0, 100) / 100) * (c.length - 1);
  const i = clamp(Math.floor(x), 0, c.length - 2);
  const f = x - i;
  const a = hexToRgb(c[i]), b = hexToRgb(c[i + 1]);
  const to2 = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return (
    "#" +
    to2(lerp(a[0], b[0], f)) +
    to2(lerp(a[1], b[1], f)) +
    to2(lerp(a[2], b[2], f))
  );
}

/** CSS 渐变串（图例色条用） */
export function rampGradientCss(): string {
  return (
    "linear-gradient(90deg," +
    SPECTRUM_RAMP.map((c, i) => `${c} ${(i / (SPECTRUM_RAMP.length - 1)) * 100}%`).join(",") +
    ")"
  );
}

/** 主光谱渐变（品牌光效：品红→琥珀→电离青） */
export const SPECTRUM_MAIN = ["#ff4d82", "#ff9c3f", "#2ed5e8"] as const;
export function spectrumCss(angle = 90): string {
  return `linear-gradient(${angle}deg, ${SPECTRUM_MAIN.join(", ")})`;
}

/* =========================================================================
   GLOW_RAMP（2026-10-22 二次重做：对齐 SunsetBot 全光谱）
   -------------------------------------------------------------------------
   上一版走「米白→黄→橙→深红 + 低值完全不着色」，实测出来是**一块孤零零的
   红斑浮在底图上**，不像天气场 —— 原因不是插值，是配色把低值全丢掉了：
   低值透明 + 色面只覆盖采样范围 ⇒ 视觉上只剩中间那一团。

   现在照报告 §5.3（SunsetBot 分级色带）与 HTML 报告 §4.2（「概率场常用
   蓝→绿→黄→橙→红」）改成**冷→暖全光谱**：低值给深蓝紫，靠它把整片填满；
   中值绿/黄；高值橙/红/品红。低值**有色、只是很淡**（alpha 从 0.06 起），
   于是「不烧」不再等于「空白」，而是「淡淡一层蓝」。

   与旧版的三处口径变化：
   ① 不再有 LOW_CUT 硬截断（那会在低值边界切出一道看得见的圈）；
      低值只是 alpha 很小，连续趋近于 0。
   ② 色相从单暖色系扩成蓝紫→蓝→青→绿→黄→橙→红→品红，共 10 锚点；
      「越红越烧」的直觉保住，但低端有了冷暖对比，整张图才有场的层次。
   ③ alpha 由**分数**（这一层）与**离采样点距离**（maprender 的 fade）相乘；
      分数决定「多浓」，距离决定「多可信」，两件事不混在一起。
   ========================================================================= */
export const GLOW_ANCHORS: Array<[number, string]> = [
  [0, "#c9dcf2"],    // 0    极浅蓝（无霞）—— 浅色底图上必须"轻"，深蓝会变成一层脏紫
  [10, "#a8c8ea"],   // 10   浅蓝
  [20, "#7fb0dc"],   // 20   蓝
  [32, "#5fc6d8"],   // 32   青
  [44, "#5fd39a"],   // 44   青绿
  [54, "#8fd44a"],   // 54   浅绿
  [64, "#cfe03a"],   // 64   黄绿
  [72, "#ffd23f"],   // 72   黄
  [82, "#ff9b2b"],   // 82   橙
  [91, "#f23a28"],   // 91   红
  [100, "#c4005e"]   // 100  品红（世纪大烧）
];

/** 低值端不再硬截断，只保留这个分数用于图例标注「从这往下基本不烧」 */
export const LOW_CUT = 12;
/** @deprecated 旧的低值淡入上界，现已由 ALPHA_STOPS 连续控制；保留导出只为兼容老引用 */
export const LOW_FADE = 26;

/** 等值线（默认不画；SunsetBot 的图上没有等值线，画了只会像划痕） */
export const CONTOUR_LEVELS = [25, 50, 75];

/** 分数 → 色面不透明度（连续）。低值很淡但**不是 0**：整片都有色，才看得出
    「这是一张场」而不是「一块红斑」。真正把远处收掉的是 maprender 的距离 fade。 */
const ALPHA_STOPS: Array<[number, number]> = [
  [0, 0.1], [12, 0.15], [25, 0.23], [40, 0.34], [50, 0.43],
  [62, 0.54], [75, 0.63], [88, 0.75], [100, 0.86]
];

/** 四档语义分级（图例与卡片文案共用；与 QUALITY_BANDS 不是一回事，
    这里分的是「色面上的强度」，不是单点的观赏质量等级） */
export const GLOW_BANDS: Array<{ max: number; key: string }> = [
  { max: 25, key: "不烧" },
  { max: 50, key: "小烧" },
  { max: 75, key: "中烧" },
  { max: 100, key: "大烧" }
];

/** 0–100 取色（连续，逐段 sRGB 线性插值） */
export function glowRgb(v: number): [number, number, number] {
  const x = clamp(v, 0, 100);
  const A = GLOW_ANCHORS;
  for (let i = 1; i < A.length; i++) {
    if (x <= A[i][0]) {
      const [v0, c0] = A[i - 1], [v1, c1] = A[i];
      const f = v1 === v0 ? 0 : (x - v0) / (v1 - v0);
      const a = hexToRgb(c0), b = hexToRgb(c1);
      return [
        Math.round(lerp(a[0], b[0], f)),
        Math.round(lerp(a[1], b[1], f)),
        Math.round(lerp(a[2], b[2], f))
      ];
    }
  }
  return hexToRgb(A[A.length - 1][1]);
}

/** 不透明色（排行榜圆点、卡片色块用；地图色面请走 glowRgb + glowAlpha） */
export function glowColor(v: number): string {
  const c = glowRgb(v);
  const to2 = (n: number) => n.toString(16).padStart(2, "0");
  return "#" + to2(c[0]) + to2(c[1]) + to2(c[2]);
}

/** 该分数的色面不透明度（连续，低值不归零）。距离衰减在 maprender 里乘上去。 */
export function glowAlpha(v: number): number {
  const x = clamp(v, 0, 100);
  const S = ALPHA_STOPS;
  if (x <= S[0][0]) return S[0][1];
  for (let i = 1; i < S.length; i++) {
    if (x <= S[i][0]) {
      const [v0, a0] = S[i - 1], [v1, a1] = S[i];
      const f = v1 === v0 ? 0 : (x - v0) / (v1 - v0);
      return lerp(a0, a1, f);
    }
  }
  return S[S.length - 1][1];
}

/** 图例色条：与地图上看到的一模一样（含低值透明段） */
export function glowGradientCss(angle = 90): string {
  const stops: string[] = [];
  for (let v = 0; v <= 100; v += 4) {
    const c = glowRgb(v);
    const a = glowAlpha(v);
    stops.push(`rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(2)}) ${v}%`);
  }
  return `linear-gradient(${angle}deg,` + stops.join(",") + ")";
}

/** 分数落在哪一档语义分级 */
export function glowBandOf(v: number): number {
  for (let i = 0; i < GLOW_BANDS.length; i++) if (v < GLOW_BANDS[i].max) return i;
  return GLOW_BANDS.length - 1;
}

