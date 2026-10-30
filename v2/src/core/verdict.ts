/* =========================================================================
   SUNGLOW v2 · 结论口径（单一来源）
   页面结论卡与导出图片必须说同一句话、给同一个数：
   · 切换器选中哪一路，主数字就是哪一路（非综合时图上标出模型名）
   · 结论措辞只在这里定义一次
   ========================================================================= */
import { gradeOf } from "./scoring";
import { isNum } from "./math";
import type { ForecastResult } from "./forecast";

export type ModelSel = "ens" | "gfs" | "ec" | "rt";

/** 结论卡切换器的选项（顺序即显示顺序） */
export const MODEL_ITEMS: Array<{ id: ModelSel; label: string }> = [
  { id: "ens", label: "多模型综合" },
  { id: "gfs", label: "GFS" },
  { id: "ec", label: "ECMWF" },
  { id: "rt", label: "光追" }
];

export interface VerdictView {
  P: number;
  Q: number;
  grade: string;
  /** 未翻译的标签，显示时再 t() */
  label: string;
  single: boolean;
}

/** 把「结果 + 当前选中模型」折成页面要的四个数 */
export function verdictViewOf(r: ForecastResult, sel: ModelSel): VerdictView {
  if (sel === "ens") {
    return { P: r.P, Q: r.Q, grade: r.grade, label: "多模型综合", single: false };
  }
  const m = r.models.find((x) => x.id === sel);
  if (!m || !isNum(m.P)) {
    return { P: r.P, Q: r.Q, grade: r.grade, label: "多模型综合", single: false };
  }
  return { P: m.P, Q: m.Q, grade: gradeOf(m.Q), label: m.label, single: true };
}

/** 一句话结论（页面标题里那句，也印在分享图上） */
export function conclWord(p: number): string {
  if (p >= 70) return "大概率出现";
  if (p >= 45) return "值得期待";
  if (p >= 25) return "可以一试";
  return "希望不大";
}
