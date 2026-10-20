/* =========================================================================
   GLOWCAST v3「追光航志」· 地图色阶（航图新尺）
   决策记录（2026-10-20）：色面固定 0–100 绝对刻度不动，只换色相锚点 ——
   深蓝 → 潮青 → 黄昏金 → 珊瑚 → 暖白（与暮色航图皮肤同源）。
   亮度随数值大体单调上升（航图读图习惯：越亮=越值得跑）。
   与原版 HEAT_RAMP（白→黄→橙→红）、V2 SPECTRUM_RAMP 均不同，三版各自成尺。
   ========================================================================= */
import { clamp, isNum, lerp, hex2rgb } from "./math";

export interface RampStop { v: number; c: string }

export const CHART_RAMP: RampStop[] = [
  { v: 0, c: "#123048" },     // 深蓝（图纸深水）
  { v: 18, c: "#1C4A66" },
  { v: 36, c: "#2E6F7E" },    // 潮线青
  { v: 52, c: "#6D97A0" },    // 低饱和过渡（避免绿灰浑浊）
  { v: 68, c: "#C89B4B" },    // 黄昏金（深）
  { v: 82, c: "#D9A441" },    // 黄昏金
  { v: 92, c: "#E2725B" },    // 珊瑚霞
  { v: 100, c: "#F7EDE2" }    // 暖白
];

/** 数值 → 色（0–100 绝对刻度；越界截断）→ rgb() 字符串 */
function rampRGB(v: number): [number, number, number] {
  const x = isNum(v) ? clamp(v, 0, 100) : 0;
  const s = CHART_RAMP;
  if (x <= s[0].v) return hex2rgb(s[0].c);
  for (let i = 1; i < s.length; i++) {
    if (x <= s[i].v) {
      const a = s[i - 1], b = s[i];
      const t = (x - a.v) / (b.v - a.v || 1);
      const ca = hex2rgb(a.c), cb = hex2rgb(b.c);
      return [
        Math.round(lerp(ca[0], cb[0], t)),
        Math.round(lerp(ca[1], cb[1], t)),
        Math.round(lerp(ca[2], cb[2], t))
      ];
    }
  }
  return hex2rgb(s[s.length - 1].c);
}
export function rampColor(v: number): string {
  const [r, g, b] = rampRGB(v);
  return `rgb(${r},${g},${b})`;
}
/** 带 alpha 的色（画布色面渐变用） */
export function rampColorA(v: number, a: number): string {
  const [r, g, b] = rampRGB(v);
  return `rgba(${r},${g},${b},${a})`;
}

/** CSS 渐变（图例条） */
export function rampGradientCss(): string {
  return `linear-gradient(90deg, ${CHART_RAMP.map((s) => `${s.c} ${s.v}%`).join(", ")})`;
}
