/* =========================================================================
   GLOWCAST v2 · 全局状态
   偏好键：glowcast.v2.pref（独立命名空间，不碰原版 sunsetbot.pref.v1）
   ========================================================================= */
import { reactive, computed } from "vue";
import { detectLang, setLang, type Lang } from "./core/i18n";
import type { City } from "./core/city";
import type { ForecastResult } from "./core/forecast";
import { cityByName, CITIES } from "./core/city";

export type ThemeMode = "dark" | "light" | "system";

export const PREF_KEY = "glowcast.v2.pref";

/* ---- 偏好白名单（口径对齐原版 PREF_BOOL/PREF_STR） ---- */
export const PREF_BOOL = [
  "numLabels", "showPts", "showTx", "showGrid", "hour12", "calibOff"
] as const;
export const FOLD_KEYS = [
  "rayFold", "notesFold", "heroFold", "trendFold", "legendFold"
] as const;
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

function prefBool(k: string, dflt: boolean): boolean {
  return typeof prefs[k] === "boolean" ? (prefs[k] as boolean) : dflt;
}
function prefStr<T extends string>(k: string, dflt: T): T {
  const list = PREF_STR[k];
  return list && list.indexOf(prefs[k] as string) >= 0 ? (prefs[k] as T) : dflt;
}

export const state = reactive<AppState>({
  lang: prefStr<Lang>("lang", detectLang()),
  theme: (() => {
    const raw = prefStr<string>("theme", "dark");
    return (raw === "auto" ? "system" : raw) as ThemeMode;
  })(),
  city:
    (typeof prefs.cityName === "string" && cityByName(prefs.cityName)) ||
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
  numLabels: prefBool("numLabels", true),
  showPts: prefBool("showPts", true),
  showTx: prefBool("showTx", true),
  showGrid: prefBool("showGrid", true),
  hour12: prefBool("hour12", false),
  calibOff: prefBool("calibOff", false),
  folds: (() => {
    const out: Record<string, boolean> = {};
    for (const k of FOLD_KEYS) out[k] = prefBool(k, false);
    return out;
  })()
});

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
