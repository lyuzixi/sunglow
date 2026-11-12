/* =========================================================================
   SUNGLOW v2 · 全局状态
   偏好键：SUNGLOW.v2.pref（独立命名空间，不碰V1 sunsetbot.pref.v1）
   ========================================================================= */
import { reactive, computed, ref } from "vue";
import { detectLang, setLang, type Lang } from "./core/i18n";
import type { City } from "./core/city";
import type { ForecastResult } from "./core/forecast";
import type { MapDateBox } from "./core/mapdata";
import { cityByName, CITIES } from "./core/city";
import { cityTz, todayInTz } from "./core/tz";
import {
  COMPOSE_DEFAULT_ON, COMPOSE_DEFAULT_ORDER, isComposeId, type ComposeModId
} from "./core/composemods";

export type ThemeMode = "dark" | "light" | "system";

export const PREF_KEY = "SUNGLOW.v2.pref";

/* ---- 偏好白名单（口径对齐V1 PREF_BOOL/PREF_STR） ---- */
export const PREF_BOOL = [
  "numLabels", "showPts", "showTx", "showGrid", "showContours", "hour12", "calibOff"
] as const;
/* 折叠目标分三类，默认值不同：
   · 整卡（光追详情 / 附注）—— 卡头有胶囊按钮，默认**展开**
   · 影响因素 —— 标题行有胶囊按钮，13 项卡很长，默认**收起**
   · 卡内说明块（结论 / 趋势 / 图例）—— 原生 details，默认**收起**
   设置页不再提供「折叠默认」开关，之后一律按用户在页面上手点的结果记忆。 */
export const FOLD_KEYS = [
  "rayFold", "notesFold", "heroFold", "trendFold", "legendFold", "factorsFold"
] as const;
/** 首次访问（偏好里没有该键）时的初始状态，true = 收起 */
export const FOLD_DEFAULT: Record<string, boolean> = {
  rayFold: false,
  notesFold: false,
  heroFold: true,
  trendFold: true,
  legendFold: true,
  factorsFold: true
};
export const PREF_STR: Record<string, readonly string[]> = {
  units: ["metric", "imperial"],
  mapDim: ["mix", "p", "q", "dv"],
  mapModel: ["ens", "gfs", "ec", "rt"],
  theme: ["auto", "light", "dark"],
  lang: ["zh", "hant", "en"],
  heroPhotoMode: ["off", "band", "full", "window"]
};

export interface AppState {
  lang: Lang;
  theme: ThemeMode;
  city: City;
  dateStr: string;
  period: "am" | "pm";
  result: ForecastResult | null;
  loading: boolean;
  error: string;
  useMock: boolean;
  mapDim: "mix" | "p" | "q" | "dv";
  mapModel: "ens" | "gfs" | "ec" | "rt";
  mapDateS: string;
  mapPeriod: "am" | "pm";
  calibOn: boolean;
  units: "metric" | "imperial";
  numLabels: boolean;
  showPts: boolean;
  showTx: boolean;
  showGrid: boolean;
  showContours: boolean;
  hour12: boolean;
  calibOff: boolean;
  /** 首屏照片模式：off 原深空 / band M2 报头带 / full M3 全幅 / window M4 天幕窗 */
  heroPhotoMode: "off" | "band" | "full" | "window";
  /** 合成分享卡：已勾选的模块 id（顺序另存 cmpOrder，拖拽后写入） */
  cmpOn: ComposeModId[];
  cmpOrder: ComposeModId[];
  folds: Record<string, boolean>;
}

function todayStr(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0")
  );
}

function loadPrefs(): Record<string, unknown> {
  try {
    const j = JSON.parse(localStorage.getItem(PREF_KEY) || "null");
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

const prefs = loadPrefs();

/** 用户是否手动选过城市（决定是否启用定位默认） */
export const hasSavedCity = (): boolean =>
  typeof prefs.cityName === "string" && !!cityByName(prefs.cityName);

/**
 * 观测场日期是否已保存、且仍落在可选窗口内（与 MapView 日期选择器的 -2~+7 天同窗）。
 * 缓存键含日期：以前 mapDateS 每次启动都重置成「今天」，隔天或换过日期再打开
 * 就直接 miss，页面显示「该日期尚未取数」，看起来像缓存丢了（2026-11-11）。
 * 超出窗口（隔一周回来）仍回落到今天，避免开局停在一张过期日期上。
 * 读的是启动时的偏好快照，语义即「本次打开时有没有可用的上次日期」。
 */
export function hasSavedMapDate(): boolean {
  const raw = prefs.mapDateS;
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const diff =
    (Date.parse(raw + "T00:00:00Z") - Date.parse(todayStr() + "T00:00:00Z")) / 86400000;
  return Number.isFinite(diff) && diff >= -2 && diff <= 7;
}

function prefBool(k: string, dflt: boolean): boolean {
  return typeof prefs[k] === "boolean" ? (prefs[k] as boolean) : dflt;
}
/* 经纬网默认改为关闭（2026-11）。旧偏好里的 true 多半沿自旧默认值而非用户主动开启，
   所以首次加载做一次迁移把经纬网置为关；之后用户手动打开仍会正常持久化。 */
const GRID_OFF_MIGRATED_KEY = "SUNGLOW.v2.gridOffMigrated";
function prefShowGrid(): boolean {
  try {
    if (!localStorage.getItem(GRID_OFF_MIGRATED_KEY)) {
      localStorage.setItem(GRID_OFF_MIGRATED_KEY, "1");
      /* 立刻把迁移结果写回偏好，否则下一次刷新又会读到旧的 true */
      prefs.showGrid = false;
      localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
      return false;
    }
  } catch { /* 隐私模式：不做迁移，沿用已存偏好 */ }
  return prefBool("showGrid", false);
}
function prefStr<T extends string>(k: string, dflt: T): T {
  const list = PREF_STR[k];
  return list && list.indexOf(prefs[k] as string) >= 0 ? (prefs[k] as T) : dflt;
}

/** 观测场地图当前日期盒 —— MapView 写入，多观测点对比读取（地图选点免额度的依据） */
export const mapBox = ref<MapDateBox | null>(null);
/** 数据到达戳：趋势 / 地图加载完成后 +1。合成分享卡据此刷新「缓存就绪」，
    否则勾选框会一直停在「先在上方加载…」——数据到了面板却不知道。 */
export const dataStamp = ref(0);

/* 合成卡选择迁移：旧版是 5 个布尔（cmpSky/cmpTrend/…），新版是模块 id 数组。
   没存过就落到「极简」默认值；储过空数组表示用户故意全关，尊重它。 */
const LEGACY_CMP: Array<[string, ComposeModId]> = [
  ["cmpSky", "sky"], ["cmpTrend", "trend"], ["cmpMap", "map"],
  ["cmpFac", "facCloud"], ["cmpQr", "qr"]
];
function loadCmpOn(): ComposeModId[] {
  const raw = prefs.cmpOn;
  if (Array.isArray(raw)) return raw.filter(isComposeId);
  const legacy = LEGACY_CMP
    .filter(([k]) => typeof prefs[k] === "boolean" && prefs[k])
    .map(([, id]) => id);
  return legacy.length ? legacy : COMPOSE_DEFAULT_ON.slice();
}
/** 顺序：老偏好里没有的新模块自动追加到末尾，不打断用户已调好的顺序 */
function loadCmpOrder(): ComposeModId[] {
  const raw = prefs.cmpOrder;
  const out: ComposeModId[] = Array.isArray(raw) ? raw.filter(isComposeId) : [];
  for (const id of COMPOSE_DEFAULT_ORDER) if (!out.includes(id)) out.push(id);
  return out;
}

export const state = reactive<AppState>({
  lang: prefStr<Lang>("lang", detectLang()),
  theme: (() => {
    const raw = prefStr<string>("theme", "system");
    return (raw === "auto" ? "system" : raw) as ThemeMode;
  })(),
  city:
    (typeof prefs.cityName === "string" && cityByName(prefs.cityName)) ||
    cityByName("广州市") ||
    CITIES[0],
  dateStr: todayStr(),
  period: "pm",
  result: null,
  loading: false,
  error: "",
  useMock: false,
  mapDim: prefStr("mapDim", "mix"),
  mapModel: prefStr("mapModel", "ens"),
  mapDateS: hasSavedMapDate() ? (prefs.mapDateS as string) : todayStr(),
  mapPeriod: "pm",
  calibOn: !prefBool("calibOff", false),
  units: prefStr("units", "metric"),
  numLabels: prefBool("numLabels", false),
  /* 采样点默认关：默认视图只呈现色面本身，采样落点是要主动打开去「查账」的工具 */
  showPts: prefBool("showPts", false),
  /* 遮挡层 / 等值线默认关：先保住色面本体不被打扰，要查细节再自己打开 */
  showTx: prefBool("showTx", false),
  showGrid: prefShowGrid(),
  showContours: prefBool("showContours", false),
  hour12: prefBool("hour12", false),
  calibOff: prefBool("calibOff", false),
  heroPhotoMode: prefStr<"off" | "band" | "full" | "window">("heroPhotoMode", "off"),
  cmpOn: loadCmpOn(),
  cmpOrder: loadCmpOrder(),
  folds: (() => {
    const out: Record<string, boolean> = {};
    for (const k of FOLD_KEYS) out[k] = prefBool(k, FOLD_DEFAULT[k]);
    return out;
  })()
});

/** 城市切换后把「今天」重新对齐到新的城市：
    只在该字段仍然等于旧城市的今天时才改，避免覆盖用户手选的日期。 */
export function reanchorToday(prev: City): void {
  const oldT = todayInTz(cityTz(prev.lat, prev.lon));
  const newT = todayInTz(cityTz(state.city.lat, state.city.lon));
  if (oldT === newT) return;
  if (state.dateStr === oldT) state.dateStr = newT;
  if (state.mapDateS === oldT) state.mapDateS = newT;
}

export function savePrefs(): void {
  try {
    const out: Record<string, unknown> = {
      lang: state.lang,
      theme: state.theme === "system" ? "auto" : state.theme,
      cityName: state.city.name,
      mapDateS: state.mapDateS,
      units: state.units,
      mapDim: state.mapDim,
      mapModel: state.mapModel,
      heroPhotoMode: state.heroPhotoMode,
      calibOff: state.calibOff,
      cmpOn: state.cmpOn,
      cmpOrder: state.cmpOrder
    };
    for (const k of PREF_BOOL) {
      if (k === "calibOff") out[k] = state.calibOff;
      else out[k] = (state as unknown as Record<string, boolean>)[k];
    }
    for (const k of FOLD_KEYS) out[k] = !!state.folds[k];
    localStorage.setItem(PREF_KEY, JSON.stringify(out));
  } catch { /* 隐私模式 */ }
}

/** 校准开关唯一入口（实况校准卡）。calibOn 是 UI 语义，calibOff 是存储键
    （历史偏好就是它，反转存储以兼容老数据）—— 两边在这里同步，别在别处各自改。 */
export function setCalibOn(on: boolean): void {
  if (state.calibOn === on) return;
  state.calibOn = on;
  state.calibOff = !on;
  savePrefs();
}

/** 折叠态语义：folds[key] = true 表示「收起」。展开/收起双向同步偏好（与V1一致）。 */export function setFold(key: string, folded: boolean): void {
  if (!(FOLD_KEYS as readonly string[]).includes(key)) return;
  if (state.folds[key] === folded) return;
  state.folds[key] = folded;
  savePrefs();
}
export function toggleFold(key: string): void {
  if (!(FOLD_KEYS as readonly string[]).includes(key)) return;
  setFold(key, !state.folds[key]);
}
export function isFolded(key: string): boolean {
  return !!state.folds[key];
}

setLang(state.lang);

export function applyTheme(): void {
  const prefersLight =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-color-scheme: light)").matches;
  const dark =
    state.theme === "dark" || (state.theme === "system" && !prefersLight);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function setLangAndSave(l: Lang): void {
  state.lang = l;
  setLang(l);
  savePrefs();
}

export function setThemeAndSave(t: ThemeMode): void {
  state.theme = t;
  savePrefs();
  applyTheme();
}

export const isDark = computed(() => {
  if (state.theme === "dark") return true;
  if (state.theme === "light") return false;
  return (
    typeof matchMedia !== "undefined" &&
    !matchMedia("(prefers-color-scheme: light)").matches
  );
});
