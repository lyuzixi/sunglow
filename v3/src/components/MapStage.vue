<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { state, refreshMap } from "../state";
import { t } from "../core/i18n";
import { rampColorA, rampGradientCss, CHART_RAMP } from "../core/ramp";
import { isNum, clamp } from "../core/math";
import type { MapPoint } from "../core/mapdata";

const cv = ref<HTMLCanvasElement | null>(null);
const pop = ref<{ x: number; y: number; p: MapPoint } | null>(null);
const hover = ref<number>(-1);

const dimLabel = computed(() => (state.period === "am" ? t("朝霞时段") : t("晚霞时段")));

interface Proj {
  x: (lon: number) => number;
  y: (lat: number) => number;
  scale: number;
  W: number; H: number;
}

function makeProj(W: number, H: number): Proj {
  const c = state.city!;
  const kLat = 110.574;
  const kLon = 111.32 * Math.max(0.15, Math.cos(c.lat * Math.PI / 180));
  const scale = Math.min(W, H) / 2 / 620; // 620 km ≈ 500km 半径 + 余量
  return {
    x: (lon: number) => W / 2 + (lon - c.lon) * kLon * scale,
    y: (lat: number) => H / 2 - (lat - c.lat) * kLat * scale,
    scale, W, H
  };
}

function drawNorthRose(ctx: CanvasRenderingContext2D, x: number, y: number, dark: boolean) {
  const r = 17;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = dark ? "rgba(234,240,242,0.55)" : "rgba(14,34,51,0.55)";
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -r - 4); ctx.lineTo(-4.5, -r + 6); ctx.lineTo(4.5, -r + 6); ctx.closePath();
  ctx.fill();
  ctx.font = "600 9px " + '"IBM Plex Mono", monospace';
  ctx.textAlign = "center";
  ctx.fillText("N", 0, r + 12);
  ctx.restore();
}

function drawScaleBar(ctx: CanvasRenderingContext2D, p: Proj, dark: boolean) {
  const km = 100;
  const px = km * p.scale;
  const x = 22, y = p.H - 26;
  ctx.save();
  ctx.strokeStyle = dark ? "rgba(234,240,242,0.55)" : "rgba(14,34,51,0.55)";
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + px, y);
  ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
  ctx.moveTo(x + px, y - 4); ctx.lineTo(x + px, y + 4);
  ctx.stroke();
  ctx.font = "400 9px " + '"IBM Plex Mono", monospace';
  ctx.textAlign = "left";
  ctx.fillText(km + " km", x, y - 8);
  ctx.restore();
}

function draw() {
  const el = cv.value;
  if (!el || !state.city) return;
  const ctx = el.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = el.clientWidth, H = el.clientHeight;
  if (!W || !H) return;
  el.width = W * dpr;
  el.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const dark = document.documentElement.dataset.theme !== "light";
  const p = makeProj(W, H);

  /* 图纸底 */
  ctx.fillStyle = dark ? "#0B1C2B" : "#DCE6EC";
  ctx.fillRect(0, 0, W, H);

  /* 经纬网（光晕 + 芯线两层） */
  const c = state.city;
  const kLon = 111.32 * Math.max(0.15, Math.cos(c.lat * Math.PI / 180));
  const stepDeg = 1;
  const lon0 = Math.floor(c.lon - 620 / kLon), lon1 = Math.ceil(c.lon + 620 / kLon);
  const lat0 = Math.floor(c.lat - 620 / 110.574), lat1 = Math.ceil(c.lat + 620 / 110.574);
  ctx.font = "400 9px " + '"IBM Plex Mono", monospace';
  for (let lo = lon0; lo <= lon1; lo += stepDeg) {
    const x = p.x(lo);
    ctx.strokeStyle = dark ? "rgba(234,240,242,0.05)" : "rgba(14,34,51,0.05)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ctx.strokeStyle = dark ? "rgba(234,240,242,0.12)" : "rgba(14,34,51,0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let la = lat0; la <= lat1; la += stepDeg) {
    const y = p.y(la);
    ctx.strokeStyle = dark ? "rgba(234,240,242,0.05)" : "rgba(14,34,51,0.05)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.strokeStyle = dark ? "rgba(234,240,242,0.12)" : "rgba(14,34,51,0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillStyle = dark ? "rgba(159,194,210,0.55)" : "rgba(61,90,112,0.7)";
    ctx.fillText(Math.abs(la) + "°" + (la >= 0 ? "N" : "S"), 6, y - 4);
  }
  for (let lo = lon0; lo <= lon1; lo += stepDeg) {
    ctx.fillStyle = dark ? "rgba(159,194,210,0.55)" : "rgba(61,90,112,0.7)";
    ctx.fillText(Math.abs(lo) + "°" + (lo >= 0 ? "E" : "W"), p.x(lo) + 4, 12);
  }

  /* 值场：逐点径向渐变（航图色阶） */
  const pts = state.mapBox ? state.mapBox[state.period].pts : [];
  const gridPx = 120 * p.scale;
  for (const pt of pts) {
    const x = p.x(pt.lon), y = p.y(pt.lat);
    const v = state.period === "am" ? pt.q.ens : pt.p.ens;
    const vv = isNum(v) ? v : 0;
    const r = gridPx * 1.22;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rampColorA(vv, dark ? 0.5 : 0.42));
    g.addColorStop(1, rampColorA(vv, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  /* 观测点描点 */
  for (const pt of pts) {
    const x = p.x(pt.lon), y = p.y(pt.lat);
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = dark ? "rgba(234,240,242,0.5)" : "rgba(14,34,51,0.45)";
    ctx.fill();
  }

  /* Top3 pin + 朝向线 */
  state.spots.forEach((s, i) => {
    const x = p.x(s.lon), y = p.y(s.lat);
    /* 朝向线：指向太阳方位（方位角 0=北，顺时针） */
    const rad = (s.az - 90) * Math.PI / 180;
    const L = 52;
    ctx.strokeStyle = i === hover.value ? (dark ? "#F7EDE2" : "#0E2233") : (dark ? "rgba(217,164,65,0.85)" : "rgba(154,116,23,0.85)");
    ctx.lineWidth = i === hover.value ? 2 : 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(rad) * L, y + Math.sin(rad) * L);
    ctx.stroke();
    /* 箭头 */
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(rad) * L, y + Math.sin(rad) * L);
    ctx.lineTo(x + Math.cos(rad + 2.6) * 8, y + Math.sin(rad + 2.6) * 8);
    ctx.lineTo(x + Math.cos(rad - 2.6) * 8, y + Math.sin(rad - 2.6) * 8);
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle as string;
    ctx.fill();
    /* pin */
    ctx.beginPath();
    ctx.arc(x, y, i === hover.value ? 8 : 6.5, 0, Math.PI * 2);
    ctx.fillStyle = dark ? "#D9A441" : "#9A7417";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = dark ? "#0B1C2B" : "#DCE6EC";
    ctx.stroke();
    ctx.fillStyle = dark ? "#0B1C2B" : "#F2F6F8";
    ctx.font = "600 9px " + '"IBM Plex Mono", monospace';
    ctx.textAlign = "center";
    ctx.fillText(String(i + 1), x, y + 3);
    /* 名称 */
    ctx.font = "500 10px " + '"IBM Plex Sans", sans-serif';
    ctx.fillStyle = dark ? "#EAF0F2" : "#0E2233";
    ctx.textAlign = "left";
    ctx.fillText(s.name, x + 10, y - 8);
  });

  /* 中心（查询点） */
  const cx = p.x(c.lon), cy = p.y(c.lat);
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fillStyle = dark ? "#EAF0F2" : "#0E2233";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 11, 0, Math.PI * 2);
  ctx.strokeStyle = dark ? "rgba(234,240,242,0.5)" : "rgba(14,34,51,0.4)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.font = "600 11px " + '"IBM Plex Sans", sans-serif';
  ctx.fillStyle = dark ? "#EAF0F2" : "#0E2233";
  ctx.textAlign = "center";
  ctx.fillText(c.name, cx, cy + 26);

  drawNorthRose(ctx, W - 34, 34, dark);
  drawScaleBar(ctx, p, dark);

  /* 图廓角标注 */
  ctx.font = "400 9px " + '"IBM Plex Mono", monospace';
  ctx.fillStyle = dark ? "rgba(159,194,210,0.6)" : "rgba(61,90,112,0.75)";
  ctx.textAlign = "right";
  ctx.fillText("GLOWCAST V3 · " + dimLabel.value + " · 0–100", W - 12, H - 12);
}

function onCanvasClick(e: MouseEvent) {
  const el = cv.value;
  if (!el || !state.mapBox) return;
  const rect = el.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const p = makeProj(el.clientWidth, el.clientHeight);
  const pts = state.mapBox[state.period].pts;
  let best: MapPoint | null = null, bd = 26;
  let bx = 0, by = 0;
  for (const pt of pts) {
    const x = p.x(pt.lon), y = p.y(pt.lat);
    const d = Math.hypot(x - mx, y - my);
    if (d < bd) { bd = d; best = pt; bx = x; by = y; }
  }
  if (best) {
    pop.value = {
      x: clamp(bx + 14, 8, el.clientWidth - 240),
      y: clamp(by - 20, 8, el.clientHeight - 150),
      p: best
    };
  } else {
    pop.value = null;
  }
}

function onCanvasMove(e: MouseEvent) {
  const el = cv.value;
  if (!el || !state.mapBox) return;
  const rect = el.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const p = makeProj(el.clientWidth, el.clientHeight);
  const pts = state.mapBox[state.period].pts;
  let hi = -1, bd = 20;
  pts.forEach((pt, i) => {
    const d = Math.hypot(p.x(pt.lon) - mx, p.y(pt.lat) - my);
    if (d < bd) { bd = d; hi = i; }
  });
  if (hi !== hover.value) {
    hover.value = hi;
    draw();
  }
}

const nPts = computed(() => state.mapPts.length || 57);
const callCost = computed(() => 3 * nPts.value);

let ro: ResizeObserver | null = null;
onMounted(async () => {
  await nextTick();
  draw();
  ro = new ResizeObserver(() => draw());
  if (cv.value) ro.observe(cv.value);
});
onUnmounted(() => ro?.disconnect());
watch(
  [() => state.mapBox, () => state.period, () => state.theme, () => state.city?.name, () => state.spots],
  () => setTimeout(draw, 20),
  { deep: false }
);
</script>

<template>
  <section id="stage" class="stage order-map">
    <div class="stage-bar">
      <div class="panel-h" style="margin: 0; border: none; padding: 0">
        <h2>{{ t("观测场") }}</h2>
        <span class="sub">{{ t("去哪拍") }}</span>
      </div>
      <button
        class="btn ghost"
        :disabled="state.mapLoading"
        @click="refreshMap(true)"
      >{{ state.mapLoading ? t("正在取数") + "…" : state.mapBox ? t("刷新数据") : t("加载周边观测场") }}</button>
      <div class="legend">
        <span>0</span>
        <div class="grad" :style="{ background: rampGradientCss() }" />
        <span>100</span>
        <span style="margin-left: 8px">({{ CHART_RAMP.length }} {{ t("锚点") }})</span>
      </div>
    </div>

    <div class="stage-canvas">
      <canvas ref="cv" :aria-label="t('观测场')" @click="onCanvasClick" @mousemove="onCanvasMove" />

      <div v-if="!state.mapBox && !state.mapLoading" class="map-idle">
        <p>
          {{ t("观测场尚未加载") }}。
          {{ t("一次取周边 {r} km 内的 {n} 个网格点，约 {c} 个计费调用", { r: 500, n: nPts, c: callCost }) }}。
          {{ t("取数后按日期缓存 3 小时，同日再看不再计费。") }}
        </p>
        <button class="btn" @click="refreshMap()">{{ t("加载周边观测场") }}</button>
      </div>
      <div v-else-if="state.mapLoading" class="map-idle">
        <p>{{ t("正在取数") }}…</p>
      </div>

      <div v-if="pop" class="map-pop" :style="{ left: pop.x + 'px', top: pop.y + 'px' }">
        <h4>{{ pop.p.name }}</h4>
        <div class="kv">{{ t("出现概率") }} <b>{{ Math.round(pop.p.P) }}</b> · {{ t("观赏质量") }} <b>{{ Math.round(pop.p.Q) }}</b></div>
        <div class="kv">{{ t("综合指数") }} <b>{{ Math.round(0.55 * pop.p.P + 0.45 * pop.p.Q) }}</b> · {{ t("等级") }} {{ t(pop.p.grade) }}</div>
        <div class="kv">{{ t("距查询点") }} <b>{{ pop.p.distKm.toFixed(1) }} km</b> · {{ t("云量") }} <b>{{ Math.round(pop.p.cld) }}%</b></div>
      </div>
    </div>

    <div class="spots-strip">
      <button
        v-for="(s, i) in state.spots"
        :key="s.name"
        class="spot-card"
        :class="{ on: hover === i }"
        @mouseenter="hover = i; $nextTick(draw)"
        @click="pop = null"
      >
        <div class="rank">#{{ s.rank }} · {{ t("推荐观测点") }}</div>
        <h4>{{ s.name }}</h4>
        <div class="kv">
          {{ t("朝向") }} <b>{{ s.azLabel }}</b><br>
          {{ t("窗口") }} <b>{{ new Date(s.winStart).toTimeString().slice(0, 5) }}–{{ new Date(s.winEnd).toTimeString().slice(0, 5) }}</b><br>
          {{ t("到位建议") }} <b>{{ new Date(s.arriveBy).toTimeString().slice(0, 5) }}</b> · {{ t("距查询点") }} <b>{{ s.distKm.toFixed(1) }} km</b>
        </div>
      </button>
      <div v-if="!state.spots.length" class="spot-card" style="cursor: default">
        <div class="rank">—</div>
        <h4>{{ state.mapBox ? t("暂无数据") : t("观测场尚未加载") }}</h4>
        <div class="kv">{{ t("加载周边观测场") }} {{ t("后显示") }}</div>
      </div>
    </div>
  </section>
</template>
