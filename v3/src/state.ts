/* =========================================================================
   GLOWCAST v3「追光航志」· 应用状态与动作
   偏好存储 glowcast.v3.pref（白名单：lang / theme / city）；
   位置与日期不持久化（与原版同约定：每次开页回默认）。
   取数纪律沿原版：**显式触发**（结论/趋势开页自动、观测场等用户点），
   缓存命中自动绘制是唯一例外。
   ========================================================================= */
import { reactive, readonly } from "vue";
import { PREF_KEY } from "./core/consts";
import { detectLang, setLang, type Lang } from "./core/i18n";
import { searchCity, cityByName, type City } from "./core/city";
import { runForecast, type Computed, type ComputedFail } from "./core/forecast";
import {
  loadMapField, mapCacheGet, mapCachePut, dropStaleMapFamily,
  buildLocalGrid, type MapBox
} from "./core/mapdata";
import {
  loadTrend, dropStaleTrendFamily, type TrendData
} from "./core/trend";
import { topSpots, eventOfDay, type Spot } from "./core/suggest";

export type ThemePref = "auto" | "light" | "dark";
export type Period = "am" | "pm";

interface Pref {
  lang?: Lang;
  theme?: ThemePref;
  cityName?: string;
}

function prefRead(): Pref {
  try {
    const j = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
    return (j && typeof j === "object") ? j as Pref : {};
  } catch { return {}; }
}
function prefWrite(patch: Pref): void {
  const cur = prefRead();
  const next: Pref = {
    lang: patch.lang ?? cur.lang,
    theme: patch.theme ?? cur.theme,
    cityName: patch.cityName ?? cur.cityName
  };
  try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch { /* ignore */ }
}

function systemDark(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function isDark(pref: ThemePref): boolean {
  return pref === "dark" || (pref === "auto" && systemDark());
}

export const state = reactive({
  lang: "zh" as Lang,
  theme: "auto" as ThemePref,
  city: null as City | null,
  dateStr: "",
  period: "pm" as Period,
  nowMs: Date.now(),
  /* 单点结论 */
  result: null as Computed | null,
  resultLoading: false,
  resultError: "",
  src: "live" as "live" | "mock",
  /* 观测场 */
  mapPts: [] as ReturnType<typeof buildLocalGrid>,
  mapBox: null as MapBox | null,
  mapLoading: false,
  mapError: "",
  mapNote: "",
  /* 趋势 / 机会日历 */
  trend: null as TrendData | null,
  trendLoading: false,
  /* 推荐 */
  spots: [] as Spot[]
});

let seqResult = 0, seqMap = 0;

export function todayStr(): string {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export function initState(): void {
  const p = prefRead();
  const lang = p.lang || detectLang();
  setLang(lang);
  state.lang = lang;
  state.theme = p.theme || "auto";
  applyTheme();
  /* 调试/探针句柄：不进 UI，仅供自动化验证读取内部状态 */
  if (typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>).__v3 = state;
  }
  const city = (p.cityName && cityByName(p.cityName)) || cityByName("北京市") || searchCity("北京")[0];
  state.city = city;
  state.dateStr = todayStr();
  dropStaleMapFamily();
  dropStaleTrendFamily();

  if (typeof window !== "undefined" && window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => { if (state.theme === "auto") applyTheme(); };
    if (mq.addEventListener) mq.addEventListener("change", on);
  }
  setInterval(() => { state.nowMs = Date.now(); }, 30000);
}

export function applyTheme(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = isDark(state.theme) ? "dark" : "light";
}
export function setTheme(t: ThemePref): void {
  state.theme = t;
  prefWrite({ theme: t });
  applyTheme();
}
export function setLangPref(l: Lang): void {
  state.lang = l;
  setLang(l);
  prefWrite({ lang: l });
}
export function setCity(c: City): void {
  state.city = c;
  prefWrite({ cityName: c.name });
  state.mapBox = null;
  state.mapNote = "";
  state.trend = null;
  void refresh();
}

export function setPeriod(per: Period): void {
  state.period = per;
  void refresh();
}
export function setDate(dateStr: string): void {
  state.dateStr = dateStr;
  void refresh();
}

/** 结论主流程（开页/换城市/换日期/换时段触发） */
export async function refresh(): Promise<void> {
  const city = state.city;
  if (!city) return;
  const seq = ++seqResult;
  state.resultLoading = true;
  state.resultError = "";
  const r = await runForecast({
    lat: city.lat, lon: city.lon, name: city.name,
    dateStr: state.dateStr, period: state.period,
    onStep: (s) => { if (seq === seqResult) state.resultError = ""; void s; }
  });
  if (seq !== seqResult) return;
  state.resultLoading = false;
  if (r.ok) {
    state.result = r;
    state.src = r.src;
  } else {
    state.resultError = r.error;
    state.result = null;
  }
  /* 推荐随结论更新（无观测场数据时用空表，等 loadMap 后重推） */
  void deriveSpots();
}

/** 机会日历（开页自动：先查缓存，miss 则取数 —— 趋势一次取数换 7 天，与原版同取舍） */
export async function refreshTrend(force = false): Promise<void> {
  const city = state.city;
  if (!city) return;
  const [Y, M, D] = state.dateStr.split("-").map(Number);
  const day0 = Date.UTC(Y, M - 1, D);
  state.trendLoading = true;
  const t = await loadTrend({
    lat: city.lat, lon: city.lon, name: city.name, day0,
    useMock: state.src === "mock"
  });
  state.trendLoading = false;
  state.trend = t;
  void force;
}

/** 观测场取数（显式触发；缓存命中自动绘制） */
export async function refreshMap(force = false): Promise<void> {
  const city = state.city;
  if (!city) return;
  const seq = ++seqMap;
  /* 缓存命中 → 直接绘制 */
  if (!force) {
    const hit = mapCacheGet(city.lat, city.lon, state.dateStr);
    if (hit) {
      state.mapBox = hit;
      state.mapError = "";
      state.mapNote = hit.pm.note;
      void deriveSpots();
      return;
    }
  }
  state.mapLoading = true;
  state.mapError = "";
  try {
    const box = await loadMapField({
      lat: city.lat, lon: city.lon, dateS: state.dateStr,
      onStep: (s) => { void s; }
    });
    if (seq !== seqMap) return;
    state.mapBox = box;
    state.mapNote = box.pm.note;
    mapCachePut(city.lat, city.lon, state.dateStr, box);
    void deriveSpots();
  } catch (e) {
    if (seq !== seqMap) return;
    state.mapError = e instanceof Error ? e.message : String(e);
  } finally {
    if (seq === seqMap) state.mapLoading = false;
  }
}

/** Top3 推荐（从观测场 + 事件时刻推导） */
export function deriveSpots(): void {
  const city = state.city;
  const box = state.mapBox;
  if (!city || !box) { state.spots = []; return; }
  const per = box[state.period];
  const [Y, M, D] = state.dateStr.split("-").map(Number);
  const dayMs = Date.UTC(Y, M - 1, D);
  const evMs = eventOfDay(dayMs, city.lat, city.lon, state.period);
  state.spots = topSpots(per.pts, {
    centerLat: city.lat, centerLon: city.lon,
    evMs, period: state.period, dayMs, n: 3
  });
}

/** 供组件只读取用（解包 reactive） */
export function snapshot(): typeof state {
  return state;
}
