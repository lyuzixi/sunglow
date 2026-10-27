/* =========================================================================
   GLOWCAST v2 · 参考模型（五因子加权，报告 §4.2 r-ayin 路线 / §7.2 Step 4）
   -------------------------------------------------------------------------
   定位：**独立旁证**，不是主口径。

   为什么不并入主模型：
   · 本项目的硬约束是「算法V1唯一权威」——`ens` 与 `dv`（三模型分歧）
     的口径必须与 `_p4.js` 逐字一致，`scripts/probe-consist.mjs` 是活守卫；
   · 五因子没有任何光路项（不看上游 300 km 遮挡、不看云底能否被低角度
     阳光照到、不看太阳几何），严格度低于 `scoring.scoreStat`；
   · 报告 §9.1 已明确：r-ayin 的两篇学术依据疑似虚构引用，权重是手工设的、
     未经混淆矩阵验证。把它当唯一依据不诚实，当第二个独立意见则有用。

   所以本模型的唯一用途是「交叉验证」：与物理核并列显示、差值驱动色面
   降饱和（差得越多越虚），**绝不参与加权、不改任何既有数字**。

   因子与权重严格照报告 §7.2 Step 4：
     云型 35% / 能见度(通透) 25% / 湿度 15% / 降水 10% / 总云量 15%
   缺项按「已给项重归一化」处理，不拿常数顶替 —— 缺项即未知，不该偷偷
   按中位数补齐（那是把假设当观测）。
   ========================================================================= */
import { clamp, isNum, trap } from "./math";
import type { Env } from "./scoring";

export const REF_W = {
  cloudType: 0.35, transparency: 0.25, humidity: 0.15,
  precip: 0.1, cloudCover: 0.15
} as const;

export interface RefFactors {
  cloudType: number | null;
  transparency: number | null;
  humidity: number | null;
  precip: number | null;
  cloudCover: number | null;
}
export interface RefResult {
  /** 0–1 原始五因子加权分 */
  S: number;
  /** 0–100（= 100S），与主口径同刻度，便于并列显示 */
  v: number;
  factors: RefFactors;
  /** 缺项键名（用于卡片提示「参考分缺 AOD」这类情况） */
  missing: string[];
}

/** 高斯隶属（湿度最优区间用，报告给的是 50±15） */
function gauss(x: number, mu: number, sigma: number): number {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z);
}

/**
 * 五因子参考分。
 * 只读 env（不再查样带）：它是「不依赖光路几何」的对照物，正因如此才独立。
 */
export function refScore(env: Env): RefResult {
  const missing: string[] = [];
  const f: RefFactors = {
    cloudType: null, transparency: null, humidity: null,
    precip: null, cloudCover: null
  };

  /* 因子 1 · 云型配置：高云主导度 + 中高云总量是否落在 10–85 的画布带 */
  if (isNum(env.cHigh) && isNum(env.cMid) && isNum(env.cLow)) {
    const hi = clamp(env.cHigh, 0, 100);
    const mid = clamp(env.cMid, 0, 100);
    const lo = clamp(env.cLow, 0, 100);
    const dominance = hi / Math.max(hi + mid + lo, 1);
    const canvas = trap(hi + mid, [[10, 0], [30, 1], [60, 1], [85, 0.35]]) ?? 0;
    f.cloudType = clamp(0.6 * dominance + 0.4 * canvas, 0, 1);
  } else missing.push("cHigh/cMid/cLow");

  /* 因子 2 · 通透度：能见度 0.5 + AOD 0.5（AOD 缺则只取能见度） */
  const visF = isNum(env.vis)
    ? trap(env.vis, [[0, 0], [5000, 0.3], [15000, 0.8], [30000, 1], [200000, 1]])
    : null;
  const aodF = isNum(env.aod)
    ? trap(env.aod, [[0, 1], [0.1, 1], [0.2, 0.9], [0.4, 0.6], [0.6, 0.3], [1, 0], [3, 0]])
    : null;
  if (visF != null && aodF != null) f.transparency = 0.5 * visF + 0.5 * aodF;
  else if (visF != null) f.transparency = visF;
  else if (aodF != null) { f.transparency = aodF; missing.push("visibility"); }
  else missing.push("visibility/aod");

  /* 因子 3 · 湿度：40–60% 最优，>85% 判霾 */
  if (isNum(env.RH)) {
    const rh = clamp(env.RH, 0, 100);
    f.humidity = rh < 85 ? clamp(gauss(rh, 50, 15), 0, 1) : 0.1;
  } else missing.push("relative_humidity_2m");

  /* 因子 4 · 降水：>50% 直接判没戏（报告原是日降水概率，这里用小时概率） */
  if (isNum(env.pp)) {
    f.precip = env.pp < 30 ? 1 : env.pp < 50 ? 0.5 : 0;
  } else missing.push("precipitation_probability");

  /* 因子 5 · 总云量修正：15–60 最优 */
  if (isNum(env.cTot)) f.cloudCover = trap(env.cTot, [[10, 0], [15, 1], [60, 1], [80, 0]]) ?? 0;
  else if (isNum(env.cHigh) && isNum(env.cMid) && isNum(env.cLow))
    /* 没给总云量就用三层合成（并集），不是简单相加 */
    f.cloudCover = trap(
      clamp(env.cLow + env.cMid * (1 - env.cLow / 100) +
        env.cHigh * (1 - clamp(env.cLow + env.cMid, 0, 100) / 100), 0, 100),
      [[10, 0], [15, 1], [60, 1], [80, 0]]
    ) ?? 0;
  else missing.push("cloud_cover");

  let sw = 0, sv = 0;
  for (const k of Object.keys(REF_W) as Array<keyof typeof REF_W>) {
    const val = f[k];
    if (val == null || !isNum(val)) continue;
    sw += REF_W[k];
    sv += REF_W[k] * val;
  }
  const S = sw > 0 ? clamp(sv / sw, 0, 1) : 0;
  return { S, v: 100 * S, factors: f, missing };
}
