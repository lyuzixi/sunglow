/* =========================================================================
   GLOWCAST v2 · 光谱色阶
   与原版 HEAT_RAMP（白→黄→橙→红）不同 —— 用户选定「换新色阶（与光效统一）」。
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

/** 0–100 取色（逐段 sRGB 线性插值，与原版 rampColor 同构） */
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
