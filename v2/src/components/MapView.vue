<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { state, savePrefs, mapBox } from "../state";
import { t, ageText } from "../core/i18n";
import { clamp, isNum, haversineKm } from "../core/math";
import {
  glowColor, glowRgb, glowAlpha, glowBandOf, glowGradientCss,
  GLOW_ANCHORS, GLOW_BANDS, LOW_CUT, LOW_FADE, CONTOUR_LEVELS
} from "../core/ramp";
import { nearestCity, CITIES, cityTier, type City } from "../core/city";
import { pointName, regionName } from "../core/citylang";
import {
  buildLocalGrid, dimOf, divergeOf, currentModel, mapCacheAge, MAP_GRID_KM,
  type GridPt, type MapPoint, type MapDateBox, type MapDim
} from "../core/mapdata";
import { loadMapData, MODEL_NAME, type LoadMapResult } from "../core/mapload";
import { addCmpPt, rowFromResult, type CompareRow } from "../core/compare";
import { runForecast, pointCacheGet } from "../core/forecast";
import { cityTz, todayInTz, addDaysIso } from "../core/tz";
import FoldNote from "./FoldNote.vue";
import Select from "./Select.vue";
import {
  paintField, drawGraticule, drawRangeDashed, drawAziLayer, drawCityLabels,
  newFieldCache, trendValueAt, fieldProbeAt,
  occBandOf, OCC_BAND_NAMES, type CityLabel, type DrawnLabel, type Rect4
} from "../core/maprender";
import { eventAzimuth, dirWordOf } from "../core/astro";
import { typeDetail } from "../core/physics";

/* ---------------- 地图实例 / 投影 ---------------- */
const box = ref<HTMLDivElement | null>(null);
const mapHost = ref<HTMLDivElement | null>(null);
const cv = ref<HTMLCanvasElement | null>(null);
const sdkReady = ref(false);
const sdkFail = ref(false);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let TMapNS: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let map: any = null;
let projFn: ((lat: number, lon: number) => { x: number; y: number }) | null = null;

const TMAP_HOST = (import.meta as { env?: Record<string, string> }).env?.VITE_TMAP_SERVICE_HOST || "";

function loadSdk(): Promise<boolean> {
  return new Promise((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (w.TMap && w.TMap.Map) {
      TMapNS = w.TMap;
      resolve(true);
      return;
    }
    w._TMapSecurityConfig = { serviceHost: TMAP_HOST || "__TMAP_SERVICE_HOST__" };
    const s = document.createElement("script");
    s.src = "https://map.qq.com/api/gljs?v=1.exp&libraries=visualization";
    const timer = setTimeout(() => resolve(false), 9000);
    s.onload = () => {
      clearTimeout(timer);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      TMapNS = (window as any).TMap;
      resolve(!!(TMapNS && TMapNS.Map));
    };
    s.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    document.head.appendChild(s);
  });
}

/* 投影：必须用 projectToContainer（V1同口径）。早前误用 map.project()，
   该方法在 GL JS 里不存在 ⇒ 静默回退成静态投影 ⇒ 图层不跟地图走（用户反馈的 bug）。 */
function ptOf(p: unknown): { x: number; y: number } | null {
  if (!p) return null;
  const o = p as { getX?: () => number; getY?: () => number; x?: number; y?: number };
  const x = typeof o.getX === "function" ? o.getX() : o.x;
  const y = typeof o.getY === "function" ? o.getY() : o.y;
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

function initProjection() {
  if (map && TMapNS) {
    projFn = (lat, lon) => {
      try {
        const q = ptOf(map.projectToContainer(new TMapNS.LatLng(lat, lon)));
        if (q) return q;
      } catch { /* ignore */ }
      return fallbackProj(lat, lon);
    };
    /* 地图一动，覆盖层立即重贴合（只重算屏幕位置，不重新取数） */
    ["bounds_changed", "zoom_changed", "center_changed", "drag", "idle",
      "tilesloaded", "pitch_changed", "rotation_changed"].forEach((ev) => {
      try { map.on && map.on(ev, schedulePaint); } catch { /* ignore */ }
    });
    return;
  }
  projFn = fallbackProj;
}

function fallbackProj(lat: number, lon: number) {
  const el = box.value;
  const w = el ? el.clientWidth : 800, h = el ? el.clientHeight : 480;
  const c = gridCenter.value;
  const kmPerLat = 110.574;
  const kmPerLon = 111.32 * Math.max(0.2, Math.cos((c.lat * Math.PI) / 180));
  const scale = Math.min(w, h) / (2 * 560); // 覆盖 ~560km 半径
  return {
    x: w / 2 + (lon - c.lon) * kmPerLon * scale,
    y: h / 2 - (lat - c.lat) * kmPerLat * scale
  };
}

/* ---------------- 底图文字与自绘地名 ----------------
   腾讯 GL 底图的地名只有中文（没有英 / 繁选项；高德有英文但无繁体，且要换源）。
   所以英 / 繁模式下关掉底图的 point（POI 文字）与 label（道路文字）要素，改由
   画布自绘当前语言的地名；中文模式保留底图自带地名（自绘会与之叠字）。
   离线回退（SDK 未就绪）时底图本来只是一片底色，同样自绘 —— 否则图面上一处
   地名都没有，连方向参照都没了。

   案 C·2（2026-10-22 拍板）：自绘层在街区级是窟窿 —— 缩到 zoom≥12 那层是
   一张无字街道图。跨度 ≤120 km 时自动交棒：关自绘、开底图文字（字是中文，
   这条路任何合规图源都填不满，代价已拍板接受）；跨回 >132 km 再恢复自绘。
   开/关阈值错开 12 km 是滞回：setBaseMap 会重建底图（瓦片重载、短暂闪白），
   纯阈值在 120 附近来回缩放会连续触发。切换静默，不加提示。 */
const BASE_FULL = ["base", "point", "label", "building2d"];
const BASE_NO_TEXT = ["base", "building2d"];
const LABEL_MAX = 48;
const AUTO_TEXT_ON_KM = 120;   // ≤120 开底图文字
const AUTO_TEXT_OFF_KM = 132;  // >132 才切回自绘（滞回带内保持现状）

/** 当前是否处于「街区级 → 底图文字接管」状态（简体下无意义但无副作用） */
const baseTextOn = ref(false);

function baseMapConf(lang: string) {
  return {
    type: "vector",
    features: lang === "zh" || baseTextOn.value ? BASE_FULL : BASE_NO_TEXT
  };
}

/** 按跨度推进滞回状态机；状态翻转且确实影响配置时重建底图 */
function evalAutoText(span: number): boolean {
  const want = baseTextOn.value ? span <= AUTO_TEXT_OFF_KM : span <= AUTO_TEXT_ON_KM;
  if (want !== baseTextOn.value) {
    baseTextOn.value = want;
    /* 简体的配置与该状态无关；离线回退没有底图可换 —— 都不必重建 */
    if (state.lang !== "zh" && !sdkFail.value) applyBaseMap();
  }
  return want;
}

function applyBaseMap() {
  if (!map) return;
  try {
    if (typeof map.setBaseMap === "function") map.setBaseMap(baseMapConf(state.lang));
  } catch { /* 老版本 SDK 没有这个接口：底图文字只能留在中文，自绘层照常给译名 */ }
}

/* 腾讯 GL 默认把缩放与姿态控件堆在右上角 —— 自绘地名最容易被它盖掉半截
   （实测「Taipei」正压在 +/− 按钮下面）。挪到右下：功能全保留，右上让给地名。 */
function relocateChrome() {
  const C = TMapNS && TMapNS.constants;
  if (!map || !C || !C.DEFAULT_CONTROL_ID || !C.CONTROL_POSITION) return;
  for (const id of [C.DEFAULT_CONTROL_ID.ZOOM, C.DEFAULT_CONTROL_ID.ROTATION]) {
    try { map.getControl(id).setPosition(C.CONTROL_POSITION.BOTTOM_RIGHT); }
    catch { /* 没有控件接口就维持原位，最多少一条边角地名 */ }
  }
}

/* SDK 控件（缩放钮 / 罗盘 / 比例尺 / 腾讯 logo 与审图号）浮在画布之上。
   自绘地名撞上去会被吃掉半截（实测右下角「Shanwei」「Guangzhou」被压成
   「…nwei」「Guangzh」）。把它们的实际占位量出来当避让区 —— 类名是腾讯 SDK
   自己的，取不到就退化成「不避让」，不会画错。 */
const CHROME_SEL = [
  ".tmap-zoom-control", ".compass-circle-background", ".tmap-scale-control",
  ".tmap-scale-text", ".logo-text", "a"
].join(",");

function chromeRects(w: number, h: number): Rect4[] {
  const host = mapHost.value, c = cv.value;
  if (!host || !c) return [];
  const cr = c.getBoundingClientRect();
  const out: Rect4[] = [];
  host.querySelectorAll(CHROME_SEL).forEach((el) => {
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) return;
    const x0 = b.left - cr.left, y0 = b.top - cr.top;
    if (x0 > w || y0 > h || x0 + b.width < 0 || y0 + b.height < 0) return;
    out.push([
      Math.max(0, x0 - 2), Math.max(0, y0 - 2),
      Math.min(w, x0 + b.width + 2), Math.min(h, y0 + b.height + 2)
    ]);
  });
  return out;
}

/** 纵向可视跨度（km）：按投影实测，不依赖 SDK 的 zoom 语义（各家 zoom 不同口径） */
function visibleSpanKm(): number {
  const el = box.value;
  const h = el ? el.clientHeight : 480;
  const proj = projFn || fallbackProj;
  const c = gridCenter.value;
  const a = proj(c.lat, c.lon), b = proj(c.lat + 1, c.lon);
  const pxPerDeg = Math.abs(b.y - a.y);
  if (!(pxPerDeg > 0.5)) return 1120;
  return (h / pxPerDeg) * 110.574;
}

/** 分级：>800 km 只看省会（约 30 个）> 250 km 加地级市 > 更近才全量 */
function labelTierMax(span: number): 0 | 1 | 2 {
  if (span > 800) return 0;
  if (span > 250) return 1;
  return 2;
}

function labelCandidates(span: number): CityLabel[] {
  const el = box.value;
  if (!el) return [];
  const w = el.clientWidth, h = el.clientHeight;
  const proj = projFn || fallbackProj;
  const maxTier = labelTierMax(span);
  const out: CityLabel[] = [];
  for (const c of CITIES) {
    const tier = cityTier(c.name);
    if (tier > maxTier) continue;
    const s = proj(c.lat, c.lon);
    if (s.x < 0 || s.x > w || s.y < 0 || s.y > h) continue;
    out.push({ text: pointName(c.name, state.lang), x: s.x, y: s.y, tier });
  }
  /* 省会先排：避让是贪心的，顺序即优先级 */
  out.sort((a, b) => a.tier - b.tier);
  return out.slice(0, LABEL_MAX);
}

/** 自绘地名的实际落笔统计（探针读它判分级是否生效、文字是否出界、有没有压控件） */
const labelsInfo = reactive({
  span: 0, tierMax: 0 as 0 | 1 | 2, drawn: 0,
  names: [] as string[],
  geo: [] as DrawnLabel[],
  avoid: [] as Rect4[],
  box: { w: 0, h: 0 }
});

/* 色面缓存（跨帧持有）：热力场/云纹/等值线段只跟数据有关，拖动缩放只贴图 */
const fieldCache = newFieldCache();

/* ---------------- 网格与数据 ---------------- */
const gridCenter = computed(() => ({
  lat: state.city.lat,
  lon: state.city.lon
}));
const gridPts = ref<GridPt[]>([]);
function rebuildGrid() {
  gridPts.value = buildLocalGrid(gridCenter.value.lat, gridCenter.value.lon, (la, lo) =>
    nearestCity(la, lo, CITIES)
  );
}

/* mapBox 在 state.ts 共享：多观测点对比要据此判断「地图选点是否免额度」 */
const loading = ref(false);
const progress = ref("");
const error = ref("");
const retryable = ref(true);
const loadToken = ref(0);
/* 当前图面的数据来源：cache = 吃缓存（带年龄小字 + 重取入口）/ live = 刚取 */
const srcKind = ref<"" | "cache" | "live">("");
const cacheAgeMs = ref<number | null>(null);

const dateOptions = computed(() => {
  const out: Array<{ v: string; label: string }> = [];
  /* 「今天 / 明天」按城市当地时间算：北京时间 10-21 时，纽约可能还是 10-20 */
  const today = todayInTz(cityTz(state.city.lat, state.city.lon));
  for (let k = -2; k <= 7; k++) {
    const v = addDaysIso(today, k);
    out.push({
      v,
      label: k === 0 ? t("今天") + " " + v.slice(5)
        : k === 1 ? t("明天") + " " + v.slice(5) : v.slice(5)
    });
  }
  return out;
});


const curBox = computed(() => {
  if (!mapBox.value) return null;
  return state.mapPeriod === "am" ? mapBox.value.am : mapBox.value.pm;
});
const curPts = computed<MapPoint[]>(() => curBox.value?.pts ?? []);
const curModel = computed(() => currentModel({ pts: curPts.value }, state.mapModel));

function valOf(p: MapPoint): number | null {
  return dimOf(p, state.mapDim as MapDim, curModel.value);
}

/** 图面来源统一落点：吃缓存记年龄小字，新取的标「刚刚取数」 */
function applyBox(b: MapDateBox, fromCache: boolean) {
  mapBox.value = b;
  error.value = "";
  retryable.value = true;
  tip.on = false;
  pin.value = null;
  if (fromCache) {
    srcKind.value = "cache";
    cacheAgeMs.value = mapCacheAge(b.am.dateS, gridCenter.value.lat, gridCenter.value.lon);
  } else {
    srcKind.value = "live";
    cacheAgeMs.value = null;
  }
  nextTick(() => paint());
}

/** 缓存优先：命中就直接画，不发请求；force = 用户点「重新取数」才绕开缓存 */
async function load(force = false) {
  const seq = ++loadToken.value;
  const still = () => seq === loadToken.value;
  loading.value = true;
  error.value = "";
  progress.value = "";
  const res: LoadMapResult = await loadMapData({
    lat: gridCenter.value.lat,
    lon: gridCenter.value.lon,
    dateS: state.mapDateS,
    pts: gridPts.value,
    force,
    onProgress: (txt) => {
      if (still()) progress.value = txt;
    },
    stillCurrent: still
  });
  if (!still()) return;
  loading.value = false;
  if (res.ok) {
    applyBox(res.box, res.fromCache);
  } else if (res.reason === "error") {
    error.value = res.message;
    retryable.value = res.retryable;
  } else if (res.reason === "cache-only") {
    error.value = "";
  }
}

/* 缓存命中自动绘制（例外路径：不烧额度） */
async function autoFromCache() {
  const seq = ++loadToken.value;
  const still = () => seq === loadToken.value;
  const res = await loadMapData({
    lat: gridCenter.value.lat,
    lon: gridCenter.value.lon,
    dateS: state.mapDateS,
    pts: gridPts.value,
    cacheOnly: true,
    stillCurrent: still
  });
  if (still() && res.ok) applyBox(res.box, true);
}

/** 换日期/换地点后清空图面，绝不让新标签顶着旧数据 */
function clearBox() {
  mapBox.value = null;
  srcKind.value = "";
  cacheAgeMs.value = null;
  error.value = "";
  tip.on = false;
  pin.value = null;
}

/* 换地点：MAP_KEEP_KM 内沿用，超出整批作废 */
watch(
  () => state.city.name,
  (n, o) => {
    if (n === o) return;
    rebuildGrid();
    clearBox();
    if (map && TMapNS) {
      try {
        map.setCenter(new TMapNS.LatLng(gridCenter.value.lat, gridCenter.value.lon));
        map.setZoom(6);
      } catch { /* ignore */ }
    }
    void autoFromCache();
    schedulePaint();
  }
);
/* 换日期：只试缓存，绝不自动取数（显式触发纪律）。
   未命中就清空并提示 —— 宁可空着，也不能让新日期顶着旧日期的图。 */
watch(() => state.mapDateS, () => {
  clearBox();
  void autoFromCache();
  schedulePaint();
});
watch(() => state.mapPeriod, () => schedulePaint());
/* 换语言：底图文字要素要跟着重新下发，自绘地名也要重画（不属于数据变更） */
watch(() => state.lang, () => {
  applyBaseMap();
  schedulePaint();
});
watch(() => state.mapModel, () => { savePrefs(); schedulePaint(); });
watch(() => state.mapDim, () => { savePrefs(); schedulePaint(); });
watch(
  () => [state.theme, state.numLabels, state.showTx, state.showGrid, state.showPts, state.showContours],
  () => {
    savePrefs();
    schedulePaint();
  }
);

/* ---------------- 绘制 ---------------- */
let paintRaf = 0;
function schedulePaint() {
  if (paintRaf) return;
  paintRaf = requestAnimationFrame(() => {
    paintRaf = 0;
    paint();
  });
}

const tip = reactive({
  on: false, x: 0, y: 0,
  p: null as MapPoint | null
});
/* 方位图层探针支撑：head=「晚霞方位 西 275°」文案，geo=射线/标签落点 */
const aziInfo = reactive<{
  az: number | null;
  head: string;
  geo: { cx: number; cy: number; tx: number; ty: number } | null;
}>({ az: null, head: "", geo: null });
const pin = ref<MapPoint | null>(null);
/* 悬停吸附目标：悬停时高亮「点击将会选中的点」，让半环距的吸附圈可见 */
const hoverMark = ref<{ x: number; y: number } | null>(null);
/* 定格卡：随选中点走（paint 时按投影重算位置），按钮在这张卡上才稳定可点 */
const pinCard = reactive<{ on: boolean; x: number; y: number; flip: boolean }>({
  on: false, x: 0, y: 0, flip: false
});
/* 地图点选加入多观测点对比（该日期盒已加载 ⇒ 零额度） */
const cmpMsg = ref("");
let cmpMsgTimer = 0;
function addPinToCompare() {
  const p = pin.value;
  if (!p) return;
  const r = addCmpPt({ name: p.name, prov: p.prov, lat: p.lat, lon: p.lon, src: "map" });
  cmpMsg.value = r === "ok" ? "已加入对比" : r === "dup" ? "该点已在对比中" : "对比列表已满（最多 4 个）";
  window.clearTimeout(cmpMsgTimer);
  cmpMsgTimer = window.setTimeout(() => (cmpMsg.value = ""), 1800);
}
/* 选点变化必须立刻重绘：图钉与定格卡的位置都在 paint() 里按投影重算。
   旧版没这条 —— 图钉要等下一个地图事件才出现（陈旧 bug，被选点探针抓住）。 */
watch(pin, () => schedulePaint());

/* ---------------- 城市标签选点（2026-10-22） ----------------
   网格只有 121 个点（80 km 步长），城市名有 486 个：点「广州市」时最近的格点
   可能在几十公里外，按「最近城市」规则叫「清远市附近」（旧 120 km 网格实测屏距
   18.6 px，落进吸附圈；密到 80 km 后仍要借邻市的名字）—— 疏密差一个量级，
   调半径永远救不了。所以城市名单独命中，
   且**标签优先**：命中的城市有缓存就出数，否则给一个「取该城市数据」按钮，点了
   才发请求（显式触发；单点≈2 次请求，写 6h 点缓存，同城重复点不再取）。
   当前城市自己有 0 环格点，直接给格点卡 —— 同一份数据、零请求、零延迟。 */
interface CityPin { city: City; row: CompareRow | null; busy: boolean; err: string }
const pinCity = ref<CityPin | null>(null);
const tipCity = ref<City | null>(null);

/* 字宽按真实字体量：命中区必须跟着屏幕上那几个字的宽度走（英文名比中文长得多） */
const CITY_FONT = [
  "600 12.5px Inter, system-ui, sans-serif",
  "500 11.5px Inter, system-ui, sans-serif",
  "400 10.5px Inter, system-ui, sans-serif"
];
const labelW = new Map<string, number>();
function labelWidth(text: string, tier: number): number {
  const key = tier + "|" + text;
  const hit = labelW.get(key);
  if (hit != null) return hit;
  let w = text.length * 11;
  const ctx = cv.value ? cv.value.getContext("2d") : null;
  if (ctx) {
    ctx.save();
    ctx.font = CITY_FONT[tier];
    w = ctx.measureText(text).width;
    ctx.restore();
  }
  labelW.set(key, w);
  return w;
}

/* 显示名 → 城市：自绘层只留了文字，反查用这张按语言重建的索引 */
let nameIdxLang = "";
let nameIdx = new Map<string, City>();
function cityByName(text: string): City | null {
  if (nameIdxLang !== state.lang) {
    nameIdxLang = state.lang;
    nameIdx = new Map(CITIES.map((c) => [pointName(c.name, state.lang), c] as [string, City]));
  }
  return nameIdx.get(text) || null;
}

/* 城市锚点的屏幕位置（paint 每帧作废，鼠标事件里惰性重算一次） */
let projEpoch = 0;
let csEpoch = -1;
let csList: Array<{ c: City; x: number; y: number; tw: number; tier: 0 | 1 | 2 }> = [];
function cityScreenList(): typeof csList {
  if (csEpoch === projEpoch) return csList;
  csEpoch = projEpoch;
  const el = box.value;
  const out: typeof csList = [];
  csList = out;
  if (!el) return out;
  const proj = projFn || fallbackProj;
  const w = el.clientWidth, h = el.clientHeight;
  for (const c of CITIES) {
    const s = proj(c.lat, c.lon);
    if (s.x < 2 || s.x > w - 2 || s.y < 2 || s.y > h - 2) continue;
    const tier = cityTier(c.name);
    out.push({ c, x: s.x, y: s.y, tw: labelWidth(pointName(c.name, state.lang), tier), tier });
  }
  return out;
}

function cityAt(x: number, y: number): City | null {
  /* 1) 自绘层（英/繁 + 离线回退）：直接用真实落笔矩形，最准 */
  for (const g of labelsInfo.geo) {
    if (x >= g.x0 - 5 && x <= g.x1 + 5 && y >= g.y - 11 && y <= g.y + 11) {
      const c = cityByName(g.text);
      if (c) return c;
    }
  }
  /* 2) 底图地名（简体）：腾讯把名字水平居中、压在上方（实拍量过：锚点就是文字块
        的下沿中线），所以命中区是以锚点为下沿的居中矩形。 */
  let best: City | null = null, bd = Infinity;
  for (const s of cityScreenList()) {
    const halfW = s.tw / 2 + 8;
    if (x < s.x - halfW || x > s.x + halfW) continue;
    if (y < s.y - 19 || y > s.y + 7) continue;
    const d = Math.hypot(x - s.x, y - s.y) + s.tier * 8; /* 叠字时省会优先 */
    if (d < bd) { bd = d; best = s.c; }
  }
  return best;
}

const cityPtOf = (c: City) =>
  ({ name: c.name, prov: c.region, lat: c.lat, lon: c.lon, src: "map" as const });

/** 城市卡的数据：只读点缓存（6h，与主结果/对比同源），绝不触发取数 */
function cityRowOf(c: City): CompareRow | null {
  const hit = pointCacheGet(c.lat, c.lon, state.dateStr, state.period);
  return hit ? rowFromResult({ ...hit, src: "cache" }, "地图选点", false, cityPtOf(c)) : null;
}

function selectCity(c: City) {
  pin.value = null;
  cmpMsg.value = "";
  const g = gridCenter.value;
  /* 就是当前城市：0 环格点就是它自己，给格点卡（同数据、零请求、瞬时） */
  if (Math.abs(c.lat - g.lat) < 0.02 && Math.abs(c.lon - g.lon) < 0.02) {
    const h = homePoint();
    if (h) { pinCity.value = null; pin.value = h; return; }
  }
  pinCity.value = { city: c, row: cityRowOf(c), busy: false, err: "" };
}

async function fetchCityData() {
  const pc = pinCity.value;
  if (!pc || pc.busy) return;
  pc.busy = true;
  pc.err = "";
  const wantName = pc.city.name, wantDate = state.dateStr, wantPeriod = state.period;
  const r = await runForecast({
    city: { name: pc.city.name, region: pc.city.region, lat: pc.city.lat, lon: pc.city.lon },
    dateStr: wantDate, period: wantPeriod
  });
  const cur = pinCity.value;
  /* 取数期间换了城市/日期/时段：结果作废，别把别的点写进这张卡 */
  if (!cur || cur.city.name !== wantName || state.dateStr !== wantDate || state.period !== wantPeriod)
    return;
  cur.busy = false;
  if (!r.ok) { cur.err = "取数失败"; return; }
  cur.row = rowFromResult(r, "地图选点", false, cityPtOf(cur.city));
}

/* 排行榜点一行 = 选这个格点（顺带清掉城市选择，两张卡不能同时在场） */
function pickRank(p: MapPoint) {
  pinCity.value = null;
  pin.value = p;
}

function addCityToCompare() {
  const pc = pinCity.value;
  if (!pc) return;
  const r = addCmpPt(cityPtOf(pc.city));
  cmpMsg.value = r === "ok" ? "已加入对比" : r === "dup" ? "该点已在对比中" : "对比列表已满（最多 4 个）";
  window.clearTimeout(cmpMsgTimer);
  cmpMsgTimer = window.setTimeout(() => (cmpMsg.value = ""), 1800);
}

/* 换日期/时段：城市卡重新判一次缓存 —— 只读缓存，绝不自动取数 */
watch(
  () => state.dateStr + "|" + state.period,
  () => {
    const pc = pinCity.value;
    if (pc) { pc.row = cityRowOf(pc.city); pc.err = ""; }
  }
);
watch(pinCity, () => schedulePaint());
const fs = ref(false);
const rankAll = ref(false);

const ranked = computed(() => {
  const arr = curPts.value
    .map((p) => ({ p, v: valOf(p) }))
    .filter((x) => isNum(x.v))
    .sort((a, b) => (b.v as number) - (a.v as number));
  return rankAll.value ? arr : arr.slice(0, 4);
});

const DIM_LABEL: Record<string, string> = {
  mix: "综合指数", p: "出现概率", q: "观赏质量", dv: "模型分歧"
};
const MODEL_LABEL2: Record<string, string> = {
  ens: "多模型综合", gfs: "GFS", ec: "ECMWF", rt: "光追", ref: "参考（5 因子）"
};
/** 四档语义各自的代表取样点（图例圆点用；0–25 档取 18，避开透明段） */
/* 四档语义在图例上的取色点（与 GLOW_BANDS 的分档中点对齐：
   不烧 12=蓝紫 / 小烧 44=青绿 / 中烧 70=黄 / 大烧 90=红） */
const GLOW_BAND_DOT = [12, 44, 70, 90];

/* 模型下拉的选项：文案在这里翻好，Select 只负责渲染 */
const modelOptions = computed(() =>
  (["ens", "gfs", "ec", "rt", "ref"] as const).map((m) => ({ v: m as string, label: t(MODEL_LABEL2[m]) }))
);

function paint() {
  const c = cv.value, el = box.value;
  if (!c || !el) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = el.clientWidth, h = el.clientHeight;
  /* 只在尺寸真变了才动 c.width —— 每帧重设会强制清空并重新分配 backing store */
  const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
  c.style.width = w + "px"; c.style.height = h + "px";
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const dark = document.documentElement.dataset.theme !== "light";
  const proj = projFn || fallbackProj;
  const center = gridCenter.value;
  const pts = curPts.value;
  /* 投影随视野变：城市命中用的屏幕坐标缓存整表作废（见 cityScreenList） */
  projEpoch++;

  if (state.showGrid) drawGraticule(ctx, proj, center, w, h, dark);

  if (pts.length) {
    paintField(ctx, {
      pts: pts.map((p) => ({
        lat: p.lat, lon: p.lon, v: valOf(p),
        cld: p.cld, occ: p.occ, gap: p.refGap
      })),
      proj, w, h, dark, dpr,
      showOcclusion: !!state.showTx,
      /* 等值线默认不画：SunsetBot 的图上没有这层，叠在色面上只会像划痕 */
      showContours: !!state.showContours,
      /* 色面缓存：拖动/缩放每帧只贴图不再做插值（见 maprender.ts FieldCache） */
      cache: fieldCache
    });
  }

  /* 自绘地名：底图文字已关（英 / 繁远景区）或根本没有底图（离线回退）时由这层给。
     英 / 繁缩进街区级（案 C·2）时底图中文文字接管，自绘整层退出防叠字。 */
  const span = visibleSpanKm();
  evalAutoText(span);
  labelsInfo.span = Math.round(span);
  labelsInfo.tierMax = labelTierMax(span);
  if ((state.lang !== "zh" && !baseTextOn.value) || sdkFail.value) {
    const cands = labelCandidates(span);
    labelsInfo.names = cands.slice(0, 12).map((x) => x.text);
    labelsInfo.avoid = chromeRects(w, h);
    labelsInfo.geo = drawCityLabels(ctx, { labels: cands, dark, w, h, avoid: labelsInfo.avoid });
    labelsInfo.drawn = labelsInfo.geo.length;
    labelsInfo.box = { w, h };
  } else {
    labelsInfo.names = [];
    labelsInfo.geo = [];
    labelsInfo.avoid = [];
    labelsInfo.drawn = 0;
  }

  /* 范围虚线 */
  drawRangeDashed(ctx, proj, center, 500, 110.574);

  /* 事件方位线 + 距离环（V1 M1 同口径，零取数纯天文）：
     射线指向当日朝/晚霞方位，100–400 km 虚线环给距离参照 —— 提示卡说
     「云边界 425 km」时，方向必须在图上看得见。 */
  const az = eventAzimuth(state.mapDateS, state.mapPeriod, center.lat, center.lon);
  aziInfo.az = az;
  aziInfo.head = "";
  if (az != null) {
    const head = `${state.mapPeriod === "am" ? t("朝霞方位") : t("晚霞方位")} ${t(dirWordOf(az))} ${Math.round(az)}°`;
    aziInfo.head = head;
    const geo = drawAziLayer(ctx, proj, {
      lat: center.lat, lon: center.lon, az,
      head,
      ringLabel: (km) => km + " km",
      dark, w, h
    });
    aziInfo.geo = geo;
  } else {
    aziInfo.geo = null;
  }

  /* 方位环（日落/日出方位指示） */
  drawAzRing(ctx, proj(center.lat, center.lon), w, h);

  /* 采样点层：真实数据的落点。色面是插值出来的，用户要判断「这片有没有根据」，
     唯一能看的就是采样点在哪、有多密。所以这里**只标位置、不标数值** ——
     点上真值已经由色面本身保证（Shepard 过点），再染一遍色反而会跟底色融成一片
     （实测：按值填色时核心区红点压在红色面上直接看不见）。
     做法是「反差芯 + 反色发丝光环」：深色芯配白环、浅色芯配黑环，
     于是无论底下是白底图、黄带还是深红核心，点都读得出来。 */
  if (state.showPts && pts.length) {
    const core = dark ? "rgba(242,246,255,0.88)" : "rgba(16,24,40,0.88)";
    const halo = dark ? "rgba(4,8,16,0.55)" : "rgba(255,255,255,0.9)";
    for (const p of pts) {
      const s = proj(p.lat, p.lon);
      if (s.x < -12 || s.x > w + 12 || s.y < -12 || s.y > h + 12) continue;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3.1, 0, Math.PI * 2);
      ctx.strokeStyle = halo;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.7, 0, Math.PI * 2);
      ctx.fillStyle = core;
      ctx.fill();
    }
  }

  /* 直标 */
  if (state.numLabels && pts.length) {
    ctx.font = "600 11px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const p of pts) {
      const v = valOf(p);
      if (!isNum(v)) continue;
      const s = proj(p.lat, p.lon);
      if (s.x < -30 || s.x > w + 30 || s.y < -20 || s.y > h + 20) continue;
      ctx.fillStyle = dark ? "rgba(233,238,251,0.92)" : "rgba(17,26,44,0.92)";
      ctx.strokeStyle = dark ? "rgba(4,8,16,0.7)" : "rgba(255,255,255,0.8)";
      ctx.lineWidth = 3;
      const txt = Math.round(v).toString();
      ctx.strokeText(txt, s.x, s.y - 8);
      ctx.fillText(txt, s.x, s.y - 8);
    }
    ctx.textAlign = "left";
  }

  /* 悬停吸附目标：淡环标出「点击将选中的点」（吸附圈随视野自适应，见交互区注释） */
  if (hoverMark.value && !pin.value && !pinCity.value) {
    const m = hoverMark.value;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 13, 0, Math.PI * 2);
    ctx.strokeStyle = dark ? "rgba(255,255,255,0.65)" : "rgba(17,26,44,0.55)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* 图钉 + 定格卡位置：每帧按当前投影重算，拖动/缩放时卡跟着点走。
     城市选点的锚点就是城市坐标（该点没有网格数据，图钉用另一套配色 + 虚线圈）。 */
  const anchor = pin.value
    ? { s: proj(pin.value.lat, pin.value.lon), city: false }
    : pinCity.value
      ? { s: proj(pinCity.value.city.lat, pinCity.value.city.lon), city: true }
      : null;
  if (anchor) {
    const s = anchor.s;
    const CARD_W = 210, CARD_H = 250;
    let flip = false;
    let cx = s.x + 14;
    if (cx + CARD_W > w - 8) { flip = true; cx = s.x - 14; }
    pinCard.x = cx;
    /* 城市卡贴下方：底图地名压在城市锚点上方，卡放上面正好把刚点的名字盖住 */
    pinCard.y = Math.min(
      Math.max(anchor.city ? s.y + 12 : s.y - 10, 8),
      Math.max(8, h - CARD_H)
    );
    pinCard.flip = flip;
    pinCard.on = s.x >= 0 && s.x <= w && s.y >= 0 && s.y <= h;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = anchor.city ? "#7c6bff" : "#ff4d82";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(s.x, s.y, 12, 0, Math.PI * 2);
    ctx.strokeStyle = anchor.city ? "rgba(124,107,255,0.6)" : "rgba(255,77,130,0.55)";
    ctx.lineWidth = 2;
    if (anchor.city) ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    pinCard.on = false;
  }
}

function drawAzRing(
  ctx: CanvasRenderingContext2D,
  c: { x: number; y: number }, w: number, h: number
): void {
  if (c.x < 0 || c.x > w || c.y < 0 || c.y > h) return;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, 26, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,156,63,0.9)";
  ctx.beginPath();
  ctx.arc(0, -26, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "600 9px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText("N", 0, -32);
  ctx.restore();
}

/* ---------------- 交互 ----------------
   悬停 = 只读小卡：跟随鼠标、无按钮、pointer-events:none 不挡地图。
   点击 = 就近吸附选点，提示卡**定格**在选中点旁（不跟随鼠标），
   「加入对比」按钮位置稳定可点；点空白处（圈内无格点）取消选择。
   触屏点按与桌面点击走同一套 selectAt。

   吸附半径必须**随视野自适应且不超过半环距**：网格步长 = `MAP_GRID_KM`（现 80km），
   默认视野（跨度 ~1063km、画布 480px 高）环距只有 ~36px —— 固定 60/48px 的圈比
   半个环距还大，点「广州市」稍有偏差就落进佛山/东莞的最近区，弹出的卡
   是周边城市（用户报「点击广州市不显示广州市」的根因，偏移点击实测复现：
   30px 就吸到「澳门附近/云浮市附近」）。半径压到半环距以内后，偏差出圈
   = 不吸附（无反应），绝不弹一个意外的地名。 */
/* 环距必须与网格常量**同源**：这里曾经写死 120（=旧格距）而格距后来改成 80，
   于是吸附圈悄悄变成 1.5 个半环距 —— 直接 import，不留副本。 */
const MAP_GRID = MAP_GRID_KM;

function snapRadii(): {
  pick: number; hover: number; homePick: number; homeHover: number;
} {
  const el = box.value;
  const h = el ? el.clientHeight : 480;
  const span = Math.max(1, visibleSpanKm());
  const ringPx = (MAP_GRID / span) * h;
  return {
    /* 其余格点：半环距以内才吸（Voronoi 诚实，绝不跨区） */
    pick: Math.min(90, Math.max(22, ringPx * 0.5)),
    hover: Math.min(56, Math.max(16, ringPx * 0.42)),
    /* 当前城市（0 环）主场特权：用户点的是底图上「广州市」那个名字，而远景
       环距只有 ~54px，标签文字稍偏就几何上更靠近邻市格点（实测偏 30px 就
       弹「惠州市/澳门附近」）。对本市格点放宽到近整环距 —— 点本市附近必弹
       本市；其它格点没有同名歧义，维持诚实半径。 */
    homePick: Math.min(120, Math.max(30, ringPx * 0.95)),
    homeHover: Math.min(80, Math.max(24, ringPx * 0.8))
  };
}

/* 本市格点：网格中心经浮点运算后与 city 坐标不严格相等（=== 匹配实测失败），
   所以按「屏幕上离本市投影最近的格点、8px 以内」认领。 */
function homePoint(): MapPoint | null {
  if (!curPts.value.length) return null;
  const proj = projFn || fallbackProj;
  const c = gridCenter.value;
  const hc = proj(c.lat, c.lon);
  let home: MapPoint | null = null, hd = 8;
  for (const p of curPts.value) {
    const s = proj(p.lat, p.lon);
    const d = Math.hypot(s.x - hc.x, s.y - hc.y);
    if (d < hd) { hd = d; home = p; }
  }
  return home;
}

function nearestPt(x: number, y: number, rad: number, homeRad = 0): MapPoint | null {
  if (!curPts.value.length) return null;
  const proj = projFn || fallbackProj;
  /* 主场特权：点击落在本市格点邻域内直接吸本市（见 snapRadii 注释） */
  if (homeRad > 0) {
    const c = gridCenter.value;
    const hc = proj(c.lat, c.lon);
    if (Math.hypot(hc.x - x, hc.y - y) <= homeRad) {
      const home = homePoint();
      if (home) return home;
    }
  }
  let best: MapPoint | null = null, bd = rad;
  for (const p of curPts.value) {
    const s = proj(p.lat, p.lon);
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function onMove(e: MouseEvent) {
  const el = box.value;
  if (!el) return;
  /* 定格卡在场时悬停卡退场，避免两卡同屏互相遮挡 */
  if (pin.value || pinCity.value) { tip.on = false; tip.p = null; tipCity.value = null; hoverMark.value = null; return; }
  const r = el.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  /* 城市名优先：命中就只读地报城市名（旧行为会报 40 km 外的邻市格点，误导） */
  const c = cityAt(x, y);
  if (c) {
    tip.on = true;
    tip.x = x; tip.y = y;
    tip.p = null;
    tipCity.value = c;
    const s = (projFn || fallbackProj)(c.lat, c.lon);
    hoverMark.value = { x: s.x, y: s.y };
    return;
  }
  tipCity.value = null;
  const R = snapRadii();
  const best = nearestPt(x, y, R.hover, R.homeHover);
  if (best) {
    tip.on = true;
    tip.x = x; tip.y = y;
    tip.p = best;
    const s = (projFn || fallbackProj)(best.lat, best.lon);
    hoverMark.value = { x: s.x, y: s.y };
  } else {
    tip.on = false;
    tip.p = null;
    hoverMark.value = null;
  }
}

function selectAt(x: number, y: number) {
  /* 定格卡接管，悬停小卡立刻收起（否则旧卡冻结在屏幕上等下一次 mousemove） */
  tip.on = false;
  tip.p = null;
  tipCity.value = null;
  hoverMark.value = null;
  const c = cityAt(x, y);
  if (c) { selectCity(c); return; }
  pinCity.value = null;
  const R = snapRadii();
  pin.value = nearestPt(x, y, R.pick, R.homePick); /* 圈外 = 取消当前选择 */
  if (!pin.value) cmpMsg.value = "";
}

/* 定格卡上的点击：按钮自己处理（addPinToCompare / fetchCityData / addCityToCompare），
   点卡空白 = 取消选择 —— 卡钉在点旁会盖住右下一片地图，吞掉那片区域的点击；
   「点空白关掉它」比「点了没反应」诚实，也顺手恢复被挡区域的交互。
   stopPropagation 必须有：不然卡内点击继续冒泡到 map-box 的 onClick，
   pin 刚清掉又被 selectAt 吸回。 */
function onPinCardClick(e: MouseEvent) {
  e.stopPropagation();
  if ((e.target as HTMLElement | null)?.closest(".tip-add")) return;
  pin.value = null;
  pinCity.value = null;
  cmpMsg.value = "";
}

function onPtEvent(e: { clientX: number; clientY: number }) {
  const el = box.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  selectAt(e.clientX - r.left, e.clientY - r.top);
}

function onClick(e: MouseEvent) { onPtEvent(e); }
function onTouchEnd(e: TouchEvent) {
  const t = e.changedTouches && e.changedTouches[0];
  if (t) onPtEvent(t); /* 拖图结束的 touchend 浏览器不派发 click，这里兜住点按即选 */
}
function onLeave() { tip.on = false; tip.p = null; tipCity.value = null; hoverMark.value = null; }

function toggleFs() {
  fs.value = !fs.value;
  nextTick(() => {
    schedulePaint();
    if (map) setTimeout(() => map.resize && map.resize(), 60);
  });
}

/* ---------------- 生命周期 ---------------- */
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && fs.value) toggleFs();
}

onMounted(async () => {
  rebuildGrid();
  /* 先按回退投影画一帧：SDK 最短也要几百毫秒，失败要等 9s 超时 ——
     那段空窗里图面上连地名都没有，英 / 繁模式尤其难看。 */
  schedulePaint();
  window.addEventListener("keydown", onKey);
  const ok = await loadSdk();
  sdkReady.value = ok;
  sdkFail.value = !ok;
  if (ok && mapHost.value) {
    try {
      map = new TMapNS.Map(mapHost.value, {
        center: new TMapNS.LatLng(gridCenter.value.lat, gridCenter.value.lon),
        zoom: 6,
        viewMode: "2D",
        baseMap: baseMapConf(state.lang)
      });
      relocateChrome();
    } catch {
      sdkFail.value = true;
      map = null;
    }
  }
  initProjection();
  /* 调试钩子：投影真值核验（容器中心应投影到容器中心） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__gcProj = (la: number, lo: number) => (projFn ? projFn(la, lo) : null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__gcMap = () => map;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__gcBox = () => (box.value ? { w: box.value.clientWidth, h: box.value.clientHeight } : null);
  /* 方位图层调试钩子：探针读 head 文案与射线落点 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__gcAzi = () => ({ az: aziInfo.az, head: aziInfo.head, geo: aziInfo.geo });
  /* 自绘地名调试钩子：不传参按当前跨度，传参可强行试分级（探针用） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__gcLabels = (span?: number) => {
    const s = isNum(span) ? (span as number) : visibleSpanKm();
    const cands = labelCandidates(s);
    return {
      span: Math.round(s), tierMax: labelTierMax(s),
      drawn: labelsInfo.drawn, total: cands.length,
      names: cands.slice(0, 12).map((x) => x.text),
      tiers: cands.map((x) => x.tier),
      geo: labelsInfo.geo, box: labelsInfo.box,
      /* 控件避让区：探针据此断言没有一条地名压在缩放钮 / 罗盘 / 比例尺 / logo 上 */
      avoid: labelsInfo.avoid
    };
  };
  /* 点位名钩子：探针验「广州市 东南 30 km」这类生成式名字的本地化 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__gcName = (s: string) => pointName(s, state.lang);
  /* 底图要素钩子：conf = 我们下发的配置，applied = SDK 回报（离线时 null）。
     baseTextOn = 案 C·2 街区级自动接管状态；span = 当前可视跨度。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__gcBaseMap = () => {
    let applied: string[] | null = null;
    try {
      const b = map && typeof map.getBaseMap === "function" ? map.getBaseMap() : null;
      if (b && Array.isArray(b.features)) applied = b.features;
    } catch { /* 无此接口 */ }
    return {
      conf: baseMapConf(state.lang).features, applied,
      baseTextOn: baseTextOn.value, span: Math.round(visibleSpanKm())
    };
  };
  /* 案 C·2 滞回状态机钩子：传一个假跨度推进状态机（同步，不等真实缩放），
     返回推进后的状态与配置。探针据此断「开→滞回带→关」的全程。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__gcAutoText = (span: number) => {
    const on = evalAutoText(span);
    return { span, baseTextOn: on, conf: baseMapConf(state.lang).features };
  };
  /* 色面诊断钩子：当前维度的采样原值（lat/lon/v/cld 升序）。
     热力场的圆斑是不是插值伪影，只能拿真值对着看 —— 别靠肉眼猜。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__gcPts = () => ({
    dim: state.mapDim, model: curModel.value,
    spikes: fieldCache.spikes.map((s) => ({
      lat: s.lat, lon: s.lon, v: s.v,
      resid: Math.round(s.resid * 10) / 10, rKm: Math.round(s.rKm)
    })),
    pts: curPts.value.map((p) => ({
      name: p.name, lat: p.lat, lon: p.lon,
      v: valOf(p), cld: p.cld, P: p.P, Q: p.Q,
      occ: p.occ, ref: p.ref, refGap: p.refGap
    })).sort((a, b) => a.lat - b.lat || a.lon - b.lon)
  });
  /* 精度与可信度钩子（本次重做的验收口径）：
     cv = 留一法交叉验证（rmse 必须明显低于 nnRmse 这个"最近邻基线"才算插值有用）；
     conf = 可信度分布；builtMs = 栅格构建耗时（拖动不该触发重建）。
     传 lat/lon 时附带该点插值结果与最近采样距离。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__gcCV = (la?: number, lo?: number) => {
    const out: Record<string, unknown> = {
      cv: fieldCache.cv, conf: fieldCache.conf,
      builtMs: fieldCache.builtMs, buildCount: fieldCache.buildCount,
      cols: fieldCache.cols, rows: fieldCache.rows,
      cells: fieldCache.cols * fieldCache.rows,
      /* 栅格地理跨度（度）：断「色面是否真的铺到视口外」用它，别靠肉眼 */
      spanDeg: { lon: fieldCache.cols * fieldCache.step, lat: fieldCache.rows * fieldCache.step },
      n: curPts.value.length
    };
    if (isNum(la) && isNum(lo)) {
      out.at = fieldProbeAt(la as number, lo as number, curPts.value.map((p) => ({
        lat: p.lat, lon: p.lon, v: valOf(p), occ: p.occ, gap: p.refGap
      })));
    }
    return out;
  };
  /* 趋势面取值：探针用它断「采样点附近是否缓变」（旧算法在点上会钉死值） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__gcTrend = (lat: number, lon: number) =>
    trendValueAt(lat, lon, curPts.value.map((p) => ({
      lat: p.lat, lon: p.lon, v: valOf(p), cld: p.cld
    })));
  /* 任意点集上的趋势值：探针用它造「一个 85 分孤峰 + 周围 10 分」的合成数据，
     断「Shepard 在采样点上取真值、离开后单调回落」—— 线上数据全是同一套
     桩值，断不出这条。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__gcFieldProbe = (
    list: Array<{ lat: number; lon: number; v: number }>, lat: number, lon: number
  ): number | null => trendValueAt(
    lat, lon, list.map((p) => ({ lat: p.lat, lon: p.lon, v: p.v, cld: null }))
  );
  /* 色阶探针：给定分数返回实际填色与透明度。低值不再归零（那一版是全图的
     低值都透明，视觉上只剩中间一团红），只能靠它断「低值到底还有没有色」。 */
  (window as any).__gcRamp = (v: number) => ({
    v, color: glowColor(v), rgb: glowRgb(v), alpha: glowAlpha(v),
    band: glowBandOf(v), lowCut: LOW_CUT, lowFade: LOW_FADE,
    contourLevels: CONTOUR_LEVELS.slice(), bands: GLOW_BANDS.length
  });
  /* 选点调试钩子：给定 map-box 局部坐标，返回吸附半径、最近点与其距离。
     around = 140px 内的格点清单（名字+距离，升序）——「点了这个城市弹那个城市」
     这类偏差只能靠它看清几何，别靠猜。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__gcSnap = (x: number, y: number) => {
    const r = snapRadii();
    const proj = projFn || fallbackProj;
    let best: MapPoint | null = null, bd = Infinity;
    const around: Array<{ name: string; d: number; x: number; y: number }> = [];
    for (const p of curPts.value) {
      const s = proj(p.lat, p.lon);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) { bd = d; best = p; }
      if (d <= 140) around.push({ name: p.name, d: Math.round(d * 10) / 10, x: Math.round(s.x), y: Math.round(s.y) });
    }
    around.sort((a, b) => a.d - b.d);
    return {
      radii: r, span: Math.round(visibleSpanKm()),
      nearest: best ? { name: best.name, dist: Math.round(bd * 10) / 10 } : null,
      around: around.slice(0, 6),
      /* 同一坐标上的城市名命中：与格点吸附互相独立，探针据此断「标签优先」 */
      city: (() => {
        const c = cityAt(x, y);
        return c ? { name: c.name, region: c.region, lat: c.lat, lon: c.lon } : null;
      })(),
      pinCity: pinCity.value ? pinCity.value.city.name : null,
      pin: pin.value ? pin.value.name : null,
      home: (() => {
        const c = gridCenter.value;
        const hc = (projFn || fallbackProj)(c.lat, c.lon);
        const hit = curPts.value.find((p) => p.lat === c.lat && p.lon === c.lon);
        return {
          dHome: Math.round(Math.hypot(hc.x - x, hc.y - y) * 10) / 10,
          exact: !!hit,
          homeName: hit ? hit.name : null,
          sampleLat: curPts.value.length ? curPts.value[0].lat : null,
          wantLat: c.lat
        };
      })()
    };
  };
  await autoFromCache();
  schedulePaint();
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  if (paintRaf) cancelAnimationFrame(paintRaf);
  try { map && map.destroy && map.destroy(); } catch { /* ignore */ }
});
watch(() => fs.value, () => nextTick(() => schedulePaint()));

function fmtV(v: number | null): string {
  return isNum(v) ? Math.round(v).toString() : "—";
}
</script>

<template>
  <section id="field" class="section">
    <!-- 2026-10-21 拍板：观测场与其它分区同宽（.wrap 1180），不再用 wrap-wide 1320 -->
    <div class="wrap">
      <div class="section-head">
        <h2>{{ t("观测场") }}</h2>
        <div class="sub">
          {{ t(DIM_LABEL[state.mapDim]) }} · {{ t(MODEL_LABEL2[curModel]) }}
          <span v-if="curBox?.note" class="note-dot" :title="curBox.note">●</span>
        </div>
      </div>

      <div class="map-panel glass" :class="{ fs }">
        <!-- 控制条 -->
        <div class="ctl">
          <Select v-model="state.mapDateS" :options="dateOptions" :aria-label="t('日期')" />
          <div class="seg" role="group" :aria-label="t('时段')">
            <button :class="{ on: state.mapPeriod === 'am' }" @click="state.mapPeriod = 'am'">{{ t("朝霞") }}</button>
            <button :class="{ on: state.mapPeriod === 'pm' }" @click="state.mapPeriod = 'pm'">{{ t("晚霞") }}</button>
          </div>
          <div class="seg" role="group" :aria-label="t('维度')">
            <button
              v-for="d in (['mix', 'p', 'q', 'dv'] as MapDim[])"
              :key="d"
              :class="{ on: state.mapDim === d }"
              @click="state.mapDim = d"
            >
              {{ t(DIM_LABEL[d]) }}
            </button>
          </div>
          <Select v-model="state.mapModel" :options="modelOptions" :aria-label="t('模型')" />
          <button class="btn btn-primary" :disabled="loading" @click="load(false)">
            {{ loading ? t("取数中…") : t("加载地图") }}
          </button>
          <div v-if="srcKind && !loading" class="fresh">
            <span class="fresh-t">
              {{ srcKind === "cache" ? t("缓存 · {age}前", { age: ageText(cacheAgeMs ?? 0) }) : t("刚刚取数") }}
            </span>
            <button v-if="srcKind === 'cache'" class="linkbtn" :disabled="loading" @click="load(true)">
              {{ t("重新取数") }}
            </button>
          </div>
          <button class="btn btn-ghost" @click="toggleFs">{{ fs ? t("退出全屏") : t("全屏") }}</button>
        </div>

        <!-- 地图显示开关：统一放在观测场内（不再进全局设置） -->
        <div class="map-opts">
          <label><input v-model="state.showTx" type="checkbox" />{{ t("遮挡层") }}</label>
          <label><input v-model="state.showGrid" type="checkbox" />{{ t("经纬网") }}</label>
          <label><input v-model="state.numLabels" type="checkbox" />{{ t("数值直标") }}</label>
          <label><input v-model="state.showPts" type="checkbox" />{{ t("采样点") }}</label>
          <label><input v-model="state.showContours" type="checkbox" />{{ t("等值线") }}</label>
        </div>

        <!-- 图面 -->
        <div class="canvas-host">
          <div
            ref="box"
            class="map-box"
            @mousemove="onMove"
            @mouseleave="onLeave"
            @click="onClick"
            @touchend="onTouchEnd"
          >
            <div ref="mapHost" class="map-host" />
            <canvas ref="cv" class="overlay" />

            <!-- 悬停提示卡（只读、不挡地图；按钮在定格卡上） -->
            <div
              v-if="tip.on && tip.p"
              class="tip glass-soft"
              :style="{ left: tip.x + 14 + 'px', top: tip.y + 14 + 'px' }"
            >
              <b>{{ pointName(tip.p.name, state.lang) }}</b>
              <div class="tip-rows">
                <span>{{ t(DIM_LABEL[state.mapDim]) }}</span>
                <b>{{ fmtV(valOf(tip.p)) }}</b>
                <span>{{ t("概率") }}</span><b>{{ fmtV(tip.p.p[curModel] ?? tip.p.P) }}</b>
                <span>{{ t("质量") }}</span><b>{{ fmtV(tip.p.q[curModel] ?? tip.p.Q) }}</b>
                <span>{{ t("云型") }}</span><b>{{ typeDetail(tip.p.type, tip.p.covers) }}</b>
                <span>{{ t("遮挡") }}</span><b>{{ t(OCC_BAND_NAMES[occBandOf(tip.p.occ)]) }}</b>
                <span>{{ t("参考模型") }}</span><b>{{ fmtV(tip.p.ref) }}</b>
                <span>{{ t("分歧") }}</span><b>{{ divergeOf(tip.p) != null ? divergeOf(tip.p)!.toFixed(1) : "—" }}</b>
              </div>
            </div>

            <!-- 悬停城市名：只报城市本身（该点没有网格数据，别报 40 km 外的邻市格点） -->
            <div
              v-if="tip.on && tipCity"
              class="tip glass-soft"
              :style="{ left: tip.x + 14 + 'px', top: tip.y + 14 + 'px' }"
            >
              <b>{{ pointName(tipCity.name, state.lang) }}</b>
              <div class="tip-rows">
                <span class="tip-note">{{ t("该城市不是网格点，点击可取该城市数据") }}</span>
              </div>
            </div>

            <!-- 定格卡：点击选点后钉在选中点旁，「加入对比」在这里稳定可点 -->
            <div
              v-if="pin && pinCard.on"
              class="pincard glass-soft"
              :class="{ flip: pinCard.flip }"
              :style="{ left: pinCard.x + 'px', top: pinCard.y + 'px' }"
              @click="onPinCardClick"
              @touchend.stop
            >
              <b>{{ pointName(pin.name, state.lang) }}</b>
              <div class="tip-rows">
                <span>{{ t(DIM_LABEL[state.mapDim]) }}</span>
                <b>{{ fmtV(valOf(pin)) }}</b>
                <span>{{ t("概率") }}</span><b>{{ fmtV(pin.p[curModel] ?? pin.P) }}</b>
                <span>{{ t("质量") }}</span><b>{{ fmtV(pin.q[curModel] ?? pin.Q) }}</b>
                <span>{{ t("云型") }}</span><b>{{ typeDetail(pin.type, pin.covers) }}</b>
                <span>{{ t("遮挡") }}</span><b>{{ t(OCC_BAND_NAMES[occBandOf(pin.occ)]) }}</b>
                <span>{{ t("参考模型") }}</span><b>{{ fmtV(pin.ref) }}</b>
                <span>{{ t("分歧") }}</span><b>{{ divergeOf(pin) != null ? divergeOf(pin)!.toFixed(1) : "—" }}</b>
              </div>
              <button class="tip-add" @click="addPinToCompare">＋ {{ t("加入对比") }}</button>
              <span v-if="cmpMsg" class="tip-cmpmsg">{{ t(cmpMsg) }}</span>
            </div>

            <!-- 城市定格卡：点的是「有名字的城市」而不是网格点。
                 有缓存（或已取过）直接出数字；否则只给一个显式取数入口 ——
                 城市锚点与网格点不是同一个坐标，取数必须由用户按下去（单点≈2 次请求）。 -->
            <div
              v-if="pinCity && pinCard.on"
              class="pincard glass-soft pincard-city"
              :class="{ flip: pinCard.flip }"
              :style="{ left: pinCard.x + 'px', top: pinCard.y + 'px' }"
              @click="onPinCardClick"
              @touchend.stop
            >
              <b>{{ pointName(pinCity.city.name, state.lang) }}</b>
              <div class="tip-sub">
                {{ regionName(pinCity.city.region, state.lang) }} · {{ t("非网格点") }}
              </div>
              <div v-if="pinCity.row" class="tip-rows">
                <span>{{ t("综合指数") }}</span><b>{{ fmtV(pinCity.row.score) }}</b>
                <span>{{ t("概率") }}</span><b>{{ fmtV(pinCity.row.P) }}</b>
                <span>{{ t("质量") }}</span><b>{{ fmtV(pinCity.row.Q) }}</b>
                <span>{{ t("云型") }}</span>
                <b>{{ typeDetail(pinCity.row.type, pinCity.row.covers) }}</b>
                <span>{{ t("时长") }}</span>
                <b>{{ pinCity.row.dur != null ? Math.round(pinCity.row.dur) + " min" : "—" }}</b>
                <span>{{ t("分歧") }}</span>
                <b>{{ pinCity.row.dvI != null ? pinCity.row.dvI.toFixed(1) : "—" }}</b>
              </div>
              <div v-else-if="pinCity.busy" class="tip-rows">
                <span class="tip-note">{{ t("取数中…") }}</span>
              </div>
              <div v-else class="tip-rows">
                <span class="tip-note">
                  {{ pinCity.err ? t(pinCity.err) : t("取数约 51 次加权调用 · 缓存 6 小时") }}
                </span>
              </div>
              <button
                v-if="pinCity.row"
                class="tip-add"
                @click.stop="addCityToCompare"
              >＋ {{ t("加入对比") }}</button>
              <button
                v-else
                class="tip-add"
                :disabled="pinCity.busy"
                @click.stop="fetchCityData"
              >{{ pinCity.busy ? t("取数中…") : pinCity.err ? t("重试") : t("取该城市数据") }}</button>
              <span v-if="cmpMsg" class="tip-cmpmsg">{{ t(cmpMsg) }}</span>
            </div>
          </div>

          <!-- 排行榜 -->
          <div class="rank glass-soft">
            <div class="rank-h">
              <span>▲ {{ t(DIM_LABEL[state.mapDim]) }} TOP</span>
              <button class="btn btn-ghost sm" @click="rankAll = !rankAll">
                {{ rankAll ? t("收起") : t("查看全部") }}
              </button>
            </div>
            <div v-if="ranked.length" class="rank-list">
              <div v-for="(r, i) in ranked" :key="r.p.name + i" class="rank-row" @click="pickRank(r.p)">
                <i :style="{ background: glowColor(r.v as number) }" />
                <span class="nm">{{ pointName(r.p.name, state.lang) }}</span>
                <b>{{ fmtV(r.v) }}</b>
              </div>
            </div>
            <div v-else class="rank-empty">{{ t("待取数") }}</div>
            <!-- 图例：色条与地图上看到的完全一致（低值也有淡淡一层蓝） -->
            <div class="legend">
              <div class="band-key">
                <span v-for="(b, i) in GLOW_BANDS" :key="b.key">
                  <i :style="{ background: glowColor(GLOW_BAND_DOT[i]) }" />{{ t(b.key) }}
                </span>
              </div>
              <div class="grad" :style="{ background: glowGradientCss() }" />
              <div class="ticks"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
              <div v-if="state.showTx" class="tx-key">
                <span v-for="(n, i) in OCC_BAND_NAMES" :key="n">
                  <i :style="{ opacity: [0.06, 0.32, 0.58, 0.9][i] }" />{{ t(n) }}
                </span>
              </div>
            </div>

            <FoldNote fold-key="legendFold" title="说明 · 色面、遮挡与可信度怎么读">
              <p>{{ t("色面用固定 0–100 绝对刻度，不随当天数据拉伸，所以不同日期、不同地点的颜色可以直接比较：蓝紫＝基本不烧，绿黄＝小烧，橙红＝中烧到大烧，品红＝世纪大烧。") }}</p>
              <p>{{ t("色面越淡越不可信：离最近采样点越远（超过 60 km 起衰减，300 km 外完全淡出），颜色就越淡越灰。淡不等于弱，是「不知道」——所以色面会一直铺到视口外，而不是在一圈边界上突然断掉。") }}</p>
              <p>{{ t("遮挡层画的是「上游光路被挡」的程度，只在中高值区出现：太阳来向上低云/中云越多，越挡光。默认关闭，要查细节再自己打开。") }}</p>
              <p>{{ t("勾上「采样点」会标出全部采样落点：色面是插值＋一次显示平滑的结果，点上的数字才是原始实测。要看某个点的准数，点它。") }}</p>
              <p>{{ t("换地点或换日期都要点「加载地图」才取数，页面不会自动请求，以免消耗额度。") }}</p>
            </FoldNote>
          </div>
        </div>

        <!-- 状态条 -->
        <div class="status">
          <template v-if="loading">
            <span class="dot-live" />{{ progress || t("取数中…") }}
          </template>
          <template v-else-if="error">
            <span class="err">{{ error }}</span>
            <button v-if="retryable" class="btn btn-ghost sm" @click="load(true)">{{ t("重试") }}</button>
          </template>
          <template v-else-if="curPts.length">
            {{ curPts.length }} {{ t("个网格点") }} · {{ t("缓存") }} {{ t(MODEL_LABEL2[curModel]) }} ·
            {{ t("色阶") }} GLOW（{{ GLOW_ANCHORS.length }} {{ t("锚点") }} · {{ t("连续") }}）·
            {{ t("SDK 已就绪") }} / {{ t("SDK 未就绪（矢量层可用）") }} ·
            {{ t("代理") }} {{ TMAP_HOST || "__TMAP_SERVICE_HOST__" }}
          </template>
          <template v-else>
            <span class="hint">{{ t("该日期尚未取数，点「加载地图」开始（显式触发，不自动烧额度）") }}</span>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.map-panel {
  padding: 14px;
  position: relative;
}
.map-panel.fs {
  position: fixed;
  inset: 0;
  z-index: 2100;
  border-radius: 0;
  padding: 12px;
}
.ctl {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
.seg {
  display: inline-flex;
  padding: 3px;
  border-radius: var(--r-full);
  border: 1px solid var(--stroke-2);
  background: var(--bg-glass);
}
.seg button {
  padding: 6px 13px;
  border-radius: var(--r-full);
  font-size: var(--fs-small);
  color: var(--tx-2);
}
.seg button.on {
  background: var(--spectrum);
  color: var(--tx-inv);
  font-weight: 600;
}
.canvas-host {
  display: grid;
  gap: 12px;
}
@media (min-width: 980px) {
  .canvas-host { grid-template-columns: 1fr 260px; }
}
.map-box {
  position: relative;
  border-radius: var(--r-md);
  overflow: hidden;
  border: 1px solid var(--stroke);
  background: #0a1322;
  height: 480px;
  cursor: crosshair;
}
/* 底图宿主：SDK 渲染在这里。深色主题反相 —— 与V1 .mapwrap.dark 同口径
   invert(1) hue-rotate(180deg)；只翻底图，叠加画布（.overlay）不在其内。
   z-index:0 是硬约束：腾讯 SDK 的交互容器自带 z-index:1000（canvas z=2），
   map-host 不设层叠上下文的话，SDK 的 1000 会同场压过我们的 tip(40)/
   定格卡(41) —— 真实点击全被 SDK 吃掉（「加入对比」点不了的第二个根因，
   elementFromPoint 实测命中 SDK DIV 而非按钮）。V1「#map 须 z-index:0」
   同一款坑。封进 0 层后，SDK 内部任意 z 都出不了 map-host。 */
.map-host {
  position: absolute;
  inset: 0;
  z-index: 0;
}
[data-theme="dark"] .map-host {
  filter: invert(1) hue-rotate(180deg);
}
.map-panel.fs .map-box { height: calc(100vh - 150px); }
.overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.map-opts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin: -4px 0 10px;
  font-size: var(--fs-tiny);
  color: var(--tx-2);
}
.map-opts label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.map-opts input { accent-color: var(--acc-1); }
.tip {
  position: absolute;
  z-index: 40;
  min-width: 170px;
  padding: 10px 12px;
  pointer-events: none;
  font-size: var(--fs-tiny);
}
.tip b { font-size: var(--fs-small); }
.tip-rows {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  margin-top: 6px;
  color: var(--tx-2);
}
.tip-rows b { text-align: right; color: var(--tx-1); }
.tip-add {
  margin-top: 8px;
  width: 100%;
  border: 1px solid var(--stroke-2);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: var(--fs-tiny);
  background: var(--bg-glass-2);
  color: var(--tx-1);
  cursor: pointer;
}
.tip-add:hover { border-color: var(--acc-3); color: var(--acc-3); }
/* 城市卡：卡片顶部一行「省/区 · 非网格点」，说明这张卡的数据来源与网格点不同 */
.tip-sub { margin-top: 2px; font-size: var(--fs-tiny); color: var(--tx-2); }
.tip-note { grid-column: 1 / -1; color: var(--tx-2); line-height: 1.45; }
.pincard-city { border-color: color-mix(in srgb, #7c6bff 45%, var(--stroke-2)); }
.pincard-city .tip-add { border-color: color-mix(in srgb, #7c6bff 45%, var(--stroke-2)); }
.pincard-city .tip-add:disabled { opacity: .6; cursor: default; }
.tip-cmpmsg { display: block; margin-top: 6px; font-size: var(--fs-tiny); color: var(--q-good); text-align: center; }
/* 定格卡：点击选点后钉在选中点旁。与悬停卡的区别是**接收指针事件**——
   卡内点击被 @click.stop 挡住不落到地图（否则一点卡就取消选择），
   按钮才真正可点。左侧翻面用 flip（点贴近右缘时）。 */
.pincard {
  position: absolute;
  z-index: 41;
  min-width: 190px;
  max-width: 230px;
  padding: 10px 12px;
  font-size: var(--fs-tiny);
}
.pincard.flip { transform: translateX(-100%); }
.rank {
  padding: 12px;
  align-self: start;
}
.rank-h {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--fs-tiny);
  letter-spacing: 0.08em;
  color: var(--tx-3);
  margin-bottom: 8px;
}
.rank-list { display: grid; gap: 4px; }
.rank-row {
  display: grid;
  grid-template-columns: 10px 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 5px 6px;
  border-radius: 8px;
  font-size: var(--fs-small);
  cursor: pointer;
}
.rank-row:hover { background: var(--bg-glass-2); }
.rank-row i { width: 10px; height: 10px; border-radius: 3px; }
.rank-row .nm {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rank-empty {
  color: var(--tx-3);
  font-size: var(--fs-tiny);
  padding: 10px 0;
}
.legend {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--stroke);
}
.legend .grad {
  height: 8px;
  border-radius: var(--r-full);
  /* 浅色底卡上「低值透明」看不出来 —— 给一条极淡的槽底，才看得出色条从哪开始 */
  box-shadow: inset 0 0 0 1px var(--stroke);
}
.band-key {
  display: flex;
  gap: 12px;
  margin-bottom: 7px;
  font-size: 0.66rem;
  color: var(--tx-3);
}
.band-key i {
  display: inline-block;
  width: 9px; height: 9px;
  margin-right: 4px;
  border-radius: 50%;
  vertical-align: -1px;
}
.legend .ticks {
  display: flex;
  justify-content: space-between;
  font-size: 0.62rem;
  color: var(--tx-3);
  margin-top: 3px;
}
.tx-key {
  display: flex;
  gap: 10px;
  margin-top: 8px;
  font-size: 0.66rem;
  color: var(--tx-3);
}
.tx-key i {
  display: inline-block;
  width: 9px; height: 9px;
  margin-right: 4px;
  background: rgb(30, 42, 68);
  border-radius: 2px;
}
.status {
  margin-top: 10px;
  font-size: var(--fs-tiny);
  color: var(--tx-3);
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.status .err { color: var(--q-bad); }
.dot-live {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--acc-3);
  animation: pulseGlow 1.6s infinite;
}
.sm { padding: 3px 10px; font-size: var(--fs-tiny); }
.note-dot { color: var(--q-mid); margin-left: 6px; }
.hint { color: var(--tx-3); }
/* 缓存来源小字 + 「重新取数」文字入口（旁路，不占主按钮位） */
.fresh {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-tiny);
  color: var(--tx-3);
  white-space: nowrap;
}
.linkbtn {
  font-size: var(--fs-tiny);
  color: var(--acc-2);
  text-decoration: underline;
  text-underline-offset: 3px;
  padding: 2px 4px;
  border-radius: var(--r-sm);
}
.linkbtn:hover { color: var(--acc-1); }
.linkbtn:disabled { opacity: 0.5; }
</style>
