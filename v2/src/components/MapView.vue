<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { state, savePrefs } from "../state";
import { t } from "../core/i18n";
import { clamp, isNum, haversineKm } from "../core/math";
import { heatColor, heatGradientCss, HEAT_RAMP } from "../core/ramp";
import { nearestCity, CITIES } from "../core/city";
import {
  buildLocalGrid, dimOf, divergeOf, currentModel,
  type GridPt, type MapPoint, type MapDateBox, type MapDim
} from "../core/mapdata";
import { loadMapData, MODEL_NAME, type LoadMapResult } from "../core/mapload";
import {
  paintField, drawGraticule, drawRangeDashed, txBandOf, TX_BAND_NAMES
} from "../core/maprender";

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

/* 投影：必须用 projectToContainer（原版同口径）。早前误用 map.project()，
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

const mapBox = ref<MapDateBox | null>(null);
const loading = ref(false);
const progress = ref("");
const error = ref("");
const retryable = ref(true);
const loadToken = ref(0);

const dateOptions = computed(() => {
  const out: Array<{ v: string; label: string }> = [];
  for (let k = -2; k <= 7; k++) {
    const d = new Date(Date.now() + k * 86400000);
    const v =
      d.getFullYear() +
      "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
    out.push({ v, label: k === 0 ? t("今天") + " " + v.slice(5) : k === 1 ? t("明天") + " " + v.slice(5) : v.slice(5) });
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
    mapBox.value = res.box;
    error.value = "";
    nextTick(() => paint());
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
  if (still() && res.ok) {
    mapBox.value = res.box;
    nextTick(() => paint());
  }
}

/* 换地点：MAP_KEEP_KM 内沿用，超出整批作废 */
watch(
  () => state.city.name,
  (n, o) => {
    if (n === o) return;
    rebuildGrid();
    mapBox.value = null;
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
watch(() => state.mapDateS, () => { mapBox.value = mapBox.value; void load(false); });
watch(() => state.mapPeriod, () => schedulePaint());
watch(() => state.mapModel, () => { savePrefs(); schedulePaint(); });
watch(() => state.mapDim, () => { savePrefs(); schedulePaint(); });
watch(
  () => [state.theme, state.numLabels, state.showTx, state.showGrid, state.showPts],
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
const pin = ref<MapPoint | null>(null);
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
  ens: "多模型综合", gfs: "GFS", ec: "ECMWF", rt: "光追"
};

function paint() {
  const c = cv.value, el = box.value;
  if (!c || !el) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = el.clientWidth, h = el.clientHeight;
  c.width = w * dpr; c.height = h * dpr;
  c.style.width = w + "px"; c.style.height = h + "px";
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const dark = document.documentElement.dataset.theme !== "light";
  const proj = projFn || fallbackProj;
  const center = gridCenter.value;
  const pts = curPts.value;

  if (state.showGrid) drawGraticule(ctx, proj, center, w, h, dark);

  if (pts.length) {
    paintField(ctx, {
      pts: pts.map((p) => ({ lat: p.lat, lon: p.lon, v: valOf(p), cld: p.cld })),
      proj, w, h, dark, dpr,
      showCloud: !!state.showTx,
      showContours: true
    });
  }

  /* 范围虚线 */
  drawRangeDashed(ctx, proj, center, 500, 110.574);

  /* 方位环（日落/日出方位指示） */
  drawAzRing(ctx, proj(center.lat, center.lon), w, h);

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

  /* 图钉 */
  if (pin.value) {
    const s = proj(pin.value.lat, pin.value.lon);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#ff4d82";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(s.x, s.y, 12, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,77,130,0.55)";
    ctx.lineWidth = 2;
    ctx.stroke();
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

/* ---------------- 交互 ---------------- */
function onMove(e: MouseEvent) {
  if (!curPts.value.length) return;
  const el = box.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const proj = projFn || fallbackProj;
  let best: MapPoint | null = null, bd = 26;
  for (const p of curPts.value) {
    const s = proj(p.lat, p.lon);
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bd) { bd = d; best = p; }
  }
  if (best) {
    tip.on = true;
    tip.x = x; tip.y = y;
    tip.p = best;
  } else {
    tip.on = false;
    tip.p = null;
  }
}
function onClick(e: MouseEvent) {
  if (tip.p) {
    pin.value = tip.p;
    return;
  }
  pin.value = null;
}
function onTouchEnd(e: TouchEvent) {
  if (e.touches.length) return;
  tip.on = false;
}

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
  window.addEventListener("keydown", onKey);
  const ok = await loadSdk();
  sdkReady.value = ok;
  sdkFail.value = !ok;
  if (ok && mapHost.value) {
    try {
      map = new TMapNS.Map(mapHost.value, {
        center: new TMapNS.LatLng(gridCenter.value.lat, gridCenter.value.lon),
        zoom: 6,
        viewMode: "2D"
      });
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
    <div class="wrap-wide">
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
          <select v-model="state.mapDateS" class="sel" aria-label="日期">
            <option v-for="d in dateOptions" :key="d.v" :value="d.v">{{ t(d.label) }}</option>
          </select>
          <div class="seg" role="group" aria-label="时段">
            <button :class="{ on: state.mapPeriod === 'am' }" @click="state.mapPeriod = 'am'">朝霞</button>
            <button :class="{ on: state.mapPeriod === 'pm' }" @click="state.mapPeriod = 'pm'">晚霞</button>
          </div>
          <div class="seg" role="group" aria-label="维度">
            <button
              v-for="d in (['mix', 'p', 'q', 'dv'] as MapDim[])"
              :key="d"
              :class="{ on: state.mapDim === d }"
              @click="state.mapDim = d"
            >
              {{ t(DIM_LABEL[d]) }}
            </button>
          </div>
          <select v-model="state.mapModel" class="sel" aria-label="模型">
            <option v-for="m in (['ens', 'gfs', 'ec', 'rt'] as const)" :key="m" :value="m">
              {{ t(MODEL_LABEL2[m]) }}
            </option>
          </select>
          <button class="btn btn-primary" :disabled="loading" @click="load(true)">
            {{ loading ? t("取数中…") : t("加载地图") }}
          </button>
          <button class="btn btn-ghost" @click="toggleFs">{{ fs ? t("退出全屏") : t("全屏") }}</button>
        </div>

        <!-- 地图显示开关：统一放在观测场内（不再进全局设置） -->
        <div class="map-opts">
          <label><input v-model="state.showTx" type="checkbox" />{{ t("云纹层") }}</label>
          <label><input v-model="state.showGrid" type="checkbox" />{{ t("经纬网") }}</label>
          <label><input v-model="state.numLabels" type="checkbox" />{{ t("数值直标") }}</label>
          <label><input v-model="state.showPts" type="checkbox" />{{ t("采样点") }}</label>
        </div>

        <!-- 图面 -->
        <div class="canvas-host">
          <div ref="box" class="map-box" @mousemove="onMove" @click="onClick" @touchend="onTouchEnd">
            <div ref="mapHost" class="map-host" />
            <canvas ref="cv" class="overlay" />

            <!-- 悬停提示卡 -->
            <div
              v-if="tip.on && tip.p"
              class="tip glass-soft"
              :style="{ left: tip.x + 14 + 'px', top: tip.y + 14 + 'px' }"
            >
              <b>{{ tip.p.name }}</b>
              <div class="tip-rows">
                <span>{{ t(DIM_LABEL[state.mapDim]) }}</span>
                <b>{{ fmtV(valOf(tip.p)) }}</b>
                <span>{{ t("概率") }}</span><b>{{ fmtV(tip.p.p[curModel] ?? tip.p.P) }}</b>
                <span>{{ t("质量") }}</span><b>{{ fmtV(tip.p.q[curModel] ?? tip.p.Q) }}</b>
                <span>{{ t("云型") }}</span><b>{{ tip.p.type }}</b>
                <span>{{ t("云纹") }}</span><b>{{ t(TX_BAND_NAMES[txBandOf(tip.p.cld)]) }}</b>
                <span>{{ t("分歧") }}</span><b>{{ divergeOf(tip.p) != null ? divergeOf(tip.p)!.toFixed(1) : "—" }}</b>
              </div>
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
              <div v-for="(r, i) in ranked" :key="r.p.name + i" class="rank-row" @click="pin = r.p">
                <i :style="{ background: heatColor(r.v as number) }" />
                <span class="nm">{{ r.p.name }}</span>
                <b>{{ fmtV(r.v) }}</b>
              </div>
            </div>
            <div v-else class="rank-empty">{{ t("待取数") }}</div>
            <!-- 图例 -->
            <div class="legend">
              <div class="grad" :style="{ background: heatGradientCss() }" />
              <div class="ticks"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
              <div class="tx-key">
                <span v-for="(n, i) in TX_BAND_NAMES" :key="n">
                  <i :style="{ opacity: [0.06, 0.35, 0.62, 0.95][i] }" />{{ t(n) }}
                </span>
              </div>
            </div>
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
            {{ t("色阶") }} HEAT（{{ HEAT_RAMP.length }} {{ t("锚点") }}）·
            {{ t("SDK 已就绪") }} / {{ t("SDK 未就绪（矢量层可用）") }} ·
            {{ t("代理") }} {{ TMAP_HOST || "__TMAP_SERVICE_HOST__" }}
          </template>
          <template v-else>
            <span class="hint">{{ t("点击「加载地图」取周边网格点数据（显式触发，不自动烧额度）") }}</span>
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
.sel {
  padding: 8px 12px;
  border-radius: var(--r-full);
  border: 1px solid var(--stroke-2);
  background: var(--bg-glass);
  color: var(--tx-1);
  font-size: var(--fs-small);
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
/* 底图宿主：SDK 渲染在这里。深色主题反相 —— 与原版 .mapwrap.dark 同口径
   invert(1) hue-rotate(180deg)；只翻底图，叠加画布（.overlay）不在其内。 */
.map-host {
  position: absolute;
  inset: 0;
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
</style>
