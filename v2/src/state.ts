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

export type ThemeMode = "dark" | "light" | "system";

export const PREF_KEY = "SUNGLOW.v2.pref";

/* ---- 偏好白名单（口径对齐V1 PREF_BOOL/PREF_STR） ---- */
export const PREF_BOOL = [
  "numLabels", "showPts", "showTx", "showGrid", "showContours", "hour12", "calibOff"
] as const;
/* 折叠目标分两类，默认值不同：
   · 整卡（光追详情 / 附注）—— 卡头有胶囊按钮，默认**展开**
   · 卡内说明块（结论 / 趋势 / 图例）—— 原生 details，默认**收起**
   设置页不再提供「折叠默认」开关，之后一律按用户在页面上手点的结果记忆。 */
export const FOLD_KEYS = [
  "rayFold", "notesFold", "heroFold", "trendFold", "legendFold"
] as const;
/** 首次访问（偏好里没有该键）时的初始状态，true = 收起 */
export const FOLD_DEFAULT: Record<string, boolean> = {
  rayFold: false,
  notesFold: false,
  heroFold: true,
  trendFold: true,
  legendFold: true
};
export const PREF_STR: Record<string, readonly string[]> = {
  units: ["metric", "imperial"],
  mapDim: ["mix", "p", "q", "dv"],
  mapModel: ["ens", "gfs", "ec", "rt"],
  theme: ["auto", "light", "dark"],
  lang: ["zh", "hant", "en"]
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

function prefBool(k: string, dflt: boolean): boolean {
  return typeof prefs[k] === "boolean" ? (prefs[k] as boolean) : dflt;
}
function prefStr<T extends string>(k: string, dflt: T): T {
  const list = PREF_STR[k];
  return list && list.indexOf(prefs[k] as string) >= 0 ? (prefs[k] as T) : dflt;
}

/** 观测场地图当前日期盒 —— MapView 写入，多观测点对比读取（地图选点免额度的依据） */
export const mapBox = ref<MapDateBox | null>(null);

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
  mapDateS: todayStr(),
  mapPeriod: "pm",
  calibOn: !prefBool("calibOff", false),
  units: prefStr("units", "metric"),
  numLabels: prefBool("numLabels", false),
  /* 采样点默认关：默认视图只呈现色面本身，采样落点是要主动打开去「查账」的工具 */
  showPts: prefBool("showPts", false),
  /* 遮挡层 / 等值线默认关：先保住色面本体不被打扰，要查细节再自己打开 */
  showTx: prefBool("showTx", false),
  showGrid: prefBool("showGrid", true),
  showContours: prefBool("showContours", false),
  hour12: prefBool("hour12", false),
  calibOff: prefBool("calibOff", false),
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
      units: state.units,
      mapDim: state.mapDim,
      mapModel: state.mapModel,
      calibOff: state.calibOff
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
