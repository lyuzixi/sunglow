/* =========================================================================
   SUNGLOW v2 · 合成分享卡的模块清单（无依赖，供 state / 渲染 / 面板共用）
   编号只用于沟通，展示顺序由用户拖拽决定（COMPOSE_DEFAULT_ORDER 只是初值）。
   ========================================================================= */
export type ComposeModId =
  | "sky" | "window" | "trend" | "map" | "models"
  | "facCloud" | "facPath" | "facAir" | "facDyn"
  | "rayRows" | "raySwatch" | "rayTime" | "rayCurve" | "qr";

export interface ComposeModDef {
  id: ComposeModId;
  name: string;
  group: string;
  /** 锚定在结论层上方（天色带），不参与拖拽 */
  anchored?: boolean;
}

export const COMPOSE_MODULES: ComposeModDef[] = [
  { id: "sky", name: "天色带", group: "视觉", anchored: true },
  { id: "window", name: "最佳观赏窗口", group: "视觉" },
  { id: "trend", name: "十日趋势", group: "数据" },
  { id: "map", name: "观测场缩略", group: "数据" },
  { id: "models", name: "模型卡", group: "数据" },
  { id: "facCloud", name: "云体条件", group: "影响因素" },
  { id: "facPath", name: "光路几何", group: "影响因素" },
  { id: "facAir", name: "大气通透", group: "影响因素" },
  { id: "facDyn", name: "动力与对流", group: "影响因素" },
  { id: "rayRows", name: "光追关键量", group: "光追推导" },
  { id: "raySwatch", name: "光谱色样", group: "光追推导" },
  { id: "rayTime", name: "照亮时间轴", group: "光追推导" },
  { id: "rayCurve", name: "亮度·彩度曲线", group: "光追推导" },
  { id: "qr", name: "二维码", group: "其他" }
];

export const COMPOSE_IDS: ComposeModId[] = COMPOSE_MODULES.map((m) => m.id);
export const COMPOSE_DEFAULT_ORDER: ComposeModId[] = COMPOSE_IDS.slice();
/** 首次打开：极简（天色带 + 二维码） */
export const COMPOSE_DEFAULT_ON: ComposeModId[] = ["sky", "qr"];

export function isComposeId(v: unknown): v is ComposeModId {
  return typeof v === "string" && (COMPOSE_IDS as string[]).includes(v);
}
