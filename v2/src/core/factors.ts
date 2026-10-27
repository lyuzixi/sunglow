/* =========================================================================
   主要因素 —— 展示口径的唯一来源（2026-10-21 详细化）
   -------------------------------------------------------------------------
   对齐V1 _p5b.js renderFactors：
   1. 数值是**富文本**（`高积云 · 21%`、`无明显云边界`、`（上限 xx）`、`CAPE … · 降水 … mm`），
      不是裸数字；缺失显 `—` 而不是 0。
   2. 每项带**判定**：有利 / 中性 / 不利 / 数据缺失（阈值 0.78 / 0.5，与V1 pill 同式）。
   3. 描述是**多句长文案**（含条件分支、公式、采样说明）。
   4. 共 13 项，第 13 项「模式一致性」（ΔI/ΔP/ΔQ + 档位文案）。
   这些 trap 曲线是**展示曲线**（V1 renderFactors 自带的一套），与 scoreStat 里
   喂给 P 的算法曲线同形但用途不同 —— 快照「最决定性的几个因素」用的也是这套分
   （V1 snapRows 与 renderFactors 同源），所以只有这一份，别在别处再抄。
   ========================================================================= */
import { t } from "./i18n";
import { isNum, clamp, trap, nz } from "./math";
import { typeDetail } from "./physics";
import { uAlt, uDist, uSpeed } from "./units";

/** （键, 原始数值, 展示得分）—— 与V1 State.factorRows 同构；null = 缺数据 */
export type FacRow = [string, number | null, number | null];

/** facRowsOf 的输入：都是计算期就知道的原始量 */
export interface FacCtx {
  type: string; level: number; base: number; cover: number;
  Heq: number | null; Hs: number | null; hEff: number | null;
  d: number | null; xMax: number | null; geomOk: boolean;
  lowBlock: number | null;
  aod: number | null;
  vis: number | null; rh: number | null;
  dP: number | null; windComp: number | null;
  cape: number | null; precip: number | null;
  consist: number; dvI: number | null; spread: number | null; spreadQ: number | null;
}

/* 展示曲线（与V1 renderFactors 逐点一致）。这里刻意不复用 scoring.ts 的 f.*：
   那是喂给 P 的算法因子（block 会叠中云、stab 会按对流/降水折减），展示层要的是
   「这一项本身」的原始档位。 */
export function facRowsOf(c: FacCtx): FacRow[] {
  const coverSc = trap(c.cover, [[0, 0], [8, 0.12], [22, 0.62], [38, 1], [75, 1], [88, 0.5], [100, 0.22]]);
  const baseSc = trap(c.base, [[0.1, 0.05], [0.6, 0.24], [1.2, 0.55], [2, 0.8], [3, 1], [9, 1], [13, 0.68]]);
  const heqSc = isNum(c.Heq) ? trap(c.Heq, [[0, 1], [0.8, 1], [1.5, 0.8], [2.5, 0.5], [3.5, 0.3], [5, 0.12], [8, 0.03]]) : null;
  const heffSc = isNum(c.hEff) ? trap(c.hEff, [[0, 0.03], [0.4, 0.25], [1, 0.6], [2, 0.85], [4, 1], [10, 1]]) : null;
  /* dedge：无云盘 / 无边界时是 0.05（不利），不是「数据缺失」——
     没有边界意味着没有可承载霞光的云盘，这是负面结论而非缺数据。 */
  const dSc = c.geomOk && isNum(c.d) && isNum(c.xMax)
    ? clamp(1 - (c.d as number) / Math.max(c.xMax as number, 1), 0, 1) * 0.6 + 0.4
    : 0.05;
  const blockSc = isNum(c.lowBlock)
    ? trap(c.lowBlock, [[0, 1], [25, 0.95], [45, 0.72], [65, 0.4], [85, 0.18], [100, 0.1]])
    : null;
  const aeroSc = isNum(c.aod)
    ? trap(c.aod, [[0, 1], [0.1, 1], [0.2, 0.88], [0.3, 0.72], [0.5, 0.52], [0.8, 0.26], [1.2, 0.12], [3, 0.03]])
    : null;
  const visSc = isNum(c.vis) ? trap(c.vis / 1000, [[0.4, 0.05], [2, 0.2], [5, 0.42], [10, 0.66], [20, 0.92], [30, 1], [80, 1]]) : null;
  const humSc = isNum(c.rh) ? trap(c.rh, [[5, 0.7], [20, 0.92], [40, 1], [75, 1], [88, 0.78], [95, 0.45], [100, 0.3]]) : null;
  const stabSc = isNum(c.dP) ? trap(c.dP, [[0, 1], [0.6, 1], [1.2, 0.8], [2.5, 0.52], [6, 0.3]]) : null;
  const compSc = isNum(c.windComp) ? trap(c.windComp, [[0, 1], [8, 1], [15, 0.75], [22, 0.5], [32, 0.3], [50, 0.15]]) : null;
  const convSc = isNum(c.cape) ? trap(c.cape, [[0, 1], [300, 1], [800, 0.8], [1500, 0.55], [3000, 0.32]]) : null;

  return [
    ["cover", isNum(c.cover) ? c.cover : null, coverSc],
    ["base", isNum(c.base) ? c.base : null, baseSc],
    ["heq", isNum(c.Heq) ? c.Heq : null, heqSc],
    ["heff", isNum(c.hEff) ? c.hEff : null, heffSc],
    ["dedge", isNum(c.d) ? c.d : null, dSc],
    ["block", isNum(c.lowBlock) ? c.lowBlock : null, blockSc],
    ["aod", isNum(c.aod) ? c.aod : null, aeroSc],
    ["vis", isNum(c.vis) ? c.vis : null, visSc],
    ["rh", isNum(c.rh) ? c.rh : null, humSc],
    ["stab", isNum(c.dP) ? c.dP : null, stabSc],
    ["wind", isNum(c.windComp) ? c.windComp : null, compSc],
    ["cape", isNum(c.cape) ? c.cape : null, convSc],
    ["consist", null, clamp(nz(c.consist, 0) / 100, 0, 1)]
  ];
}

/** 渲染期需要的结果面（ForecastResult 结构性满足；避免与 forecast.ts 循环导入） */
export interface FacRes {
  sRT: {
    primary: { type: string; level: number; base: number; cover: number };
    /** 三层云盘（低/中/高序）—— 云型长格式「卷云（低云 0% / 中云 0% / 高云 48%）」 */
    decks: Array<{ cover: number }>;
    Heq: number; Hs: number; hEff: number | null;
    d: number | null; geom: { xMax: number; ok: boolean };
    aodUp: number | null;
  };
  envM: { cape: number | null; precip: number | null };
  factorRows: Array<[string, number | null, number | null]>;
  consist: number; dvI: number | null; spread: number | null; spreadQ: number | null;
  conf: { lv: string; txt: string; hint: string };
}

export interface FacDef {
  key: string; name: string;
  fmt: (v: number | null, r: FacRes) => string;
  desc: (v: number | null, r: FacRes) => string;
}

const n1 = (v: number | null, d = 1): string => (isNum(v) ? v.toFixed(d) : "—");

export const FAC_DEFS: FacDef[] = [
  {
    key: "cover", name: "云量类型与覆盖度",
    fmt: (v, r) => isNum(v)
      ? typeDetail(r.sRT.primary.type, r.sRT.decks.map((d) => d.cover))
      : "—",
    desc: (_v, r) => {
      const p = r.sRT.primary;
      return t("{type}属{deck}，云底约 {base}。{tail}", {
        type: t(p.type), deck: t(["低云", "中云", "高云"][p.level] || "中云"),
        base: uAlt(p.base * 1000),
        tail: t(p.cover < 20 ? "云量偏少，可能没有足够云体承接霞光。"
          : p.cover > 90 ? "云量接近全覆盖，阳光难以穿透，易形成闷烧或无霞。"
            : "云量处于理想区间，云块之间既能透光又能承接低角度阳光。")
      });
    }
  },
  {
    key: "base", name: "云底高度",
    fmt: (v) => isNum(v) ? uAlt(v * 1000) : "—",
    desc: () => t("云底越高，霞光可出现的范围与色相变化越丰富；云底越低，霞光越局限于橘红且持续时间短。")
  },
  {
    key: "heq", name: "光学等效地表高度",
    fmt: (v) => isNum(v) ? uDist(v, 2) : "—",
    desc: (_v, r) => t("气溶胶把光线“垫高”的等效地表高度，由 AOD 与气溶胶标高 Hs={v} km 计算（z=Hs·ln(AOD/(Hs·k₀))）。该值越大，等效云底越低，霞光越难形成。",
      { v: n1(r.sRT.Hs, 2) })
  },
  {
    key: "heff", name: "等效云底高度",
    fmt: (v) => isNum(v) ? uDist(v, 2) : "—",
    desc: () => t("云底高度减去光学等效地表高度后的有效高度，是几何判定的真正输入。")
  },
  {
    key: "dedge", name: "云边界距离",
    fmt: (v, r) => isNum(v)
      ? uDist(v) + t("（上限 {v}）", { v: uDist(r.sRT.geom.xMax) })
      : t("无明显云边界"),
    desc: () => t("沿日出/日落方位以 25 km 间隔采样（地图批量估算时以采样网格插值代替实地采样）得到的云盘外缘距离。必须小于霞光深入距离 2√(2Rh)，阳光才能从云底下方照进来；距离越远，颜色越红、开始越晚。")
  },
  {
    key: "block", name: "光路上游低层云遮挡",
    fmt: (v) => isNum(v) ? Math.round(v) + "%" : "—",
    desc: () => t("低云位于霞光光路下方，是最常见的“翻车”原因：低云量高会把阳光彻底挡住。")
  },
  {
    key: "aod", name: "气溶胶光学厚度 AOD",
    fmt: (v) => isNum(v) ? n1(v, 2) + "（550nm）" : "—",
    desc: (v) => t(!isNum(v) ? "本项数据缺失。"
      : v < 0.2 ? "气溶胶很少，瑞利散射占主导，阳光颜色纯净、饱和度高，水晶天。"
        : v < 0.5 ? "气溶胶一般，天空通透度普通，颜色饱和度会略降。"
          : v < 0.8 ? "气溶胶较多，天空偏霾，会明显削弱霞光的亮度与饱和度。"
            : "气溶胶大量存在，属“污烧”，低角度霞光细节会被灰霾吞掉。")
  },
  {
    key: "vis", name: "能见度",
    fmt: (v) => isNum(v) ? uDist(v / 1000, 1) : "—",
    desc: () => t("反映底层大气通透程度。能见度低于 5 km 时地面附近霾/雾显著，霞光的低角度部分会被遮挡。")
  },
  {
    key: "rh", name: "2m 相对湿度",
    fmt: (v) => isNum(v) ? Math.round(v) + "%" : "—",
    desc: () => t("湿度适中利于云的存在与散射；相对湿度过高（>90%）会形成雾并放大气溶胶消光，反而使天空浑浊；过低则可能没有云。")
  },
  {
    key: "stab", name: "气压稳定性",
    fmt: (v) => isNum(v) ? "|ΔP/Δt| = " + v.toFixed(2) + " hPa/h" : "—",
    desc: () => t("气压稳定说明天气系统移动缓慢，云边界位置可预测；气压快速变化意味着云况随时可能改变，预报不确定性大。")
  },
  {
    key: "wind", name: "云边界风速分量",
    fmt: (v) => isNum(v) ? uSpeed(v) : "—",
    desc: () => t("云边界沿日出/日落方向的速度分量。经验上 <15 m/s 云边界位置不确定度小，>30 m/s 则很大（云边界会明显推移）。")
  },
  {
    key: "cape", name: "对流活动",
    fmt: (v, r) =>
      (isNum(v) ? "CAPE " + Math.round(v) + " J/kg" : "—")
      + (isNum(r.envM.precip) ? t(" · 降水 {v} mm", { v: r.envM.precip.toFixed(1) }) : ""),
    desc: () => t("对流强时局地积云/积雨云发展，会随机遮挡光路；但积雨云云砧本身也可能形成漂亮的云砧晚霞。")
  },
  {
    key: "consist", name: "模式一致性",
    fmt: (_v, r) => isNum(r.dvI)
      ? `${t(r.conf.lv)} · ΔI ${Math.round(r.dvI)}（ΔP ${Math.round(nz(r.spread, 0))} · ΔQ ${Math.round(nz(r.spreadQ, 0))}）`
      : t("数据不足"),
    desc: (_v, r) => isNum(r.dvI)
      ? t("{txt}，{detail}。{hint}", {
        txt: t(r.conf.txt), detail: ensConfDetail(r.spread, r.spreadQ), hint: t(r.conf.hint)
      })
      : t("不足两套算法给出结果，无法评估模型一致性。")
  }
];

/** 判定 pill（与V1 pill() 同阈值） */
export function judgmentOf(score: number | null): { key: string; cls: string } {
  if (!isNum(score)) return { key: "数据缺失", cls: "j-miss" };
  if (score >= 0.78) return { key: "有利", cls: "j-ok" };
  if (score >= 0.5) return { key: "中性", cls: "j-mid" };
  return { key: "不利", cls: "j-bad" };
}

/** 分歧落在哪个轴上（V1 ensConfDetail 同式） */
export function ensConfDetail(spreadP: number | null, spreadQ: number | null): string {
  const a = nz(spreadP, 0), b = nz(spreadQ, 0);
  if (Math.max(a, b) < 8) return t("两方面分歧都很小");
  const mainIsP = a >= b;
  return t("分歧主要在{v1}（{a} 分），{v2}较一致（{b} 分）", {
    v1: t(mainIsP ? "出现概率" : "观赏质量"), a: Math.round(Math.max(a, b)),
    v2: t(mainIsP ? "观赏质量" : "出现概率"), b: Math.round(Math.min(a, b))
  });
}

export interface FacDisplayRow {
  key: string; name: string; val: string;
  score: number | null; desc: string;
  judge: string; judgeCls: string;
}

/** 因素面板的完整展示行 */
export function facDisplayRows(r: FacRes): FacDisplayRow[] {
  const val = new Map<string, number | null>();
  for (const row of r.factorRows) val.set(row[0], row[1]);
  const score = new Map<string, number | null>();
  for (const row of r.factorRows) score.set(row[0], row[2]);
  return FAC_DEFS.map((d) => {
    /* consist 的原始值不在 factorRows（快照也不存它），得分在 */
    const v = d.key === "consist" ? null : val.has(d.key) ? val.get(d.key)! : null;
    const s = score.has(d.key) ? score.get(d.key)! : null;
    const j = judgmentOf(s);
    return {
      key: d.key,
      name: t(d.name),
      val: d.fmt(v, r),
      score: s,
      desc: d.desc(v, r),
      judge: t(j.key),
      judgeCls: j.cls
    };
  });
}

/* ---- 快照（snap）因素小条：fmt 只吃原始数值（快照里没有完整结果） ----
   与V1 SNAP_FACTORS 同口径：等价字符串，不要在别处再拼一份。 */
export const SNAP_FAC_NAME: Record<string, string> = {
  cover: "云量类型与覆盖度", base: "云底高度", heq: "光学等效地表高度",
  heff: "等效云底高度", dedge: "云边界距离", block: "光路上游低层云遮挡",
  aod: "气溶胶光学厚度 AOD", vis: "能见度", rh: "2m 相对湿度",
  stab: "气压稳定性", wind: "云边界风速分量", cape: "对流活动"
};

export function snapFacFmt(k: string, v: number | null): string {
  if (!isNum(v)) return "—";
  switch (k) {
    case "cover": case "block": case "rh": return Math.round(v) + "%";
    case "base": return uAlt(v * 1000);
    case "heq": case "heff": return uDist(v, 2);
    case "dedge": return uDist(v);
    case "aod": return n1(v, 2);
    case "vis": return uDist(v / 1000, 1);
    case "stab": return "|ΔP/Δt| = " + v.toFixed(2) + " hPa/h";
    case "wind": return uSpeed(v);
    case "cape": return "CAPE " + Math.round(v) + " J/kg";
    default: return String(v);
  }
}
