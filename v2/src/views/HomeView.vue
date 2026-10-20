<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import HeroSection from "../components/HeroSection.vue";
import ConclusionCard from "../components/ConclusionCard.vue";
import SkyBand from "../components/SkyBand.vue";
import TrendSection from "../components/TrendSection.vue";
import MapView from "../components/MapView.vue";
import ModelsPanel from "../components/ModelsPanel.vue";
import FactorsPanel from "../components/FactorsPanel.vue";
import CalibPanel from "../components/CalibPanel.vue";
import { state } from "../state";
import { runForecast } from "../core/forecast";
import { snapEncode, snapDecode, type SnapInput, type SnapData } from "../core/snap";
import { t } from "../core/i18n";
import { armReveal } from "../composables/useReveal";
import { applyUrlState, syncUrl, baseQuery } from "../core/urlstate";

const snapUrl = ref("");
const snapMsg = ref("");
const copied = ref(false);
const snapView = ref<SnapData | null>(null);

async function run() {
  state.loading = true;
  state.error = "";
  try {
    const r = await runForecast({
      city: state.city,
      dateStr: state.dateStr,
      period: state.period
    });
    if (!r.ok) {
      state.error = r.error;
      state.result = null;
    } else {
      state.result = r;
      refreshSnap();
      syncUrl();
    }
  } catch (e) {
    state.error = String(e);
  } finally {
    state.loading = false;
  }
}

function refreshSnap() {
  const r = state.result;
  if (!r) {
    snapUrl.value = "";
    return;
  }
  const input: SnapInput = {
    dateStr: r.dateStr,
    period: r.period,
    lat: r.city.lat,
    lon: r.city.lon,
    name: r.city.name,
    region: r.city.region,
    P: r.P,
    Q: r.Q,
    consist: r.consist,
    dvI: r.dvI,
    spread: r.spread,
    spreadQ: r.spreadQ,
    primaryLevel: r.sRT.primary.level,
    primaryType: r.sRT.primary.type,
    primaryBase: r.sRT.primary.base,
    dKm: r.sRT.d,
    durMin: r.sRT.geom.dur,
    factors: r.factorRows.map((x) => ({ k: x[0], v: x[1], s: x[2] }))
  };
  const s = snapEncode(input);
  snapUrl.value = s
    ? location.href.split("#")[0].split("?")[0] + baseQuery() + "&snap=" + s
    : "";
  // 解码自检
  if (s) {
    const d = snapDecode(s);
    snapMsg.value = d
      ? `快照互通 OK · P=${Math.round(d.P)} Q=${Math.round(d.Q)}`
      : "快照解码失败";
  }
}

async function copySnap() {
  if (!snapUrl.value) return;
  try {
    await navigator.clipboard.writeText(snapUrl.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1800);
  } catch {
    snapMsg.value = "复制失败，请手动复制";
  }
}

/* URL 带 snap= 时优先展示快照（不重新取数、不烧额度） */
function tryLoadSnap(): boolean {
  const u = applyUrlState();
  if (u.snap) {
    snapView.value = u.snap;
    const d = u.snap;
    snapMsg.value = `这是 ${d.date} ${d.period === "am" ? "朝霞" : "晚霞"} 的计算结果（快照）· P=${Math.round(d.P)} Q=${Math.round(d.Q)}`;
    return true;
  }
  return false;
}

watch(
  () => [state.city.name, state.dateStr, state.period],
  () => {
    snapUrl.value = "";
  }
);

onMounted(() => {
  if (!tryLoadSnap()) run();
  armReveal();
});
</script>

<template>
  <HeroSection @run="run" />

  <div class="wrap" style="margin-top: -8px; margin-bottom: 8px">
    <div v-if="snapMsg" class="pill" style="gap: 10px">
      <span>{{ snapMsg }}</span>
      <button v-if="snapUrl" class="btn btn-ghost" style="padding: 2px 10px" @click="copySnap">
        {{ copied ? t("已复制") : t("复制链接") }}
      </button>
    </div>
  </div>

  <!-- 快照结果卡：与原版 renderSnap 同信息集，打开快照不重新取数 -->
  <section v-if="snapView" class="section" style="padding-top: 8px">
    <div class="wrap">
      <div class="glass snap-card">
        <div class="pill">快照模式 · SNAP_VER=1 互通</div>
        <h2 style="margin: 12px 0 6px">
          {{ snapView.name }} {{ snapView.date }}
          {{ snapView.period === "am" ? "朝霞" : "晚霞" }}
        </h2>
        <p class="snap-sub">
          生成于 {{ new Date(snapView.gen).toLocaleString() }} ·
          打开快照链接不会重新取数，因此不消耗接口额度。
        </p>
        <div class="snap-grid">
          <div class="metric">
            <span class="num" style="color: var(--acc-1)">{{ Math.round(snapView.P) }}%</span>
            <span class="lab">出现概率</span>
          </div>
          <div class="metric">
            <span class="num" style="color: var(--acc-2)">{{ Math.round(snapView.Q) }}</span>
            <span class="lab">观赏质量</span>
          </div>
          <div class="metric">
            <span class="num" style="color: var(--acc-3)">{{ snapView.consist }}</span>
            <span class="lab">一致性</span>
          </div>
          <div class="metric">
            <span class="num" style="color: var(--tx-2)">
              {{ snapView.dvI != null ? snapView.dvI.toFixed(1) : "—" }}
            </span>
            <span class="lab">分歧 ΔI</span>
          </div>
        </div>
        <div v-if="snapView.factors.length" class="snap-fac">
          <div v-for="f in snapView.factors" :key="f.k" class="sf">
            <span>{{ f.k }}</span>
            <b>{{ f.v }}</b>
            <i :style="{ width: f.s * 100 + '%' }" />
          </div>
        </div>
        <button class="btn btn-primary" style="margin-top: 16px" @click="snapView = null; run()">
          按当前条件重新计算
        </button>
      </div>
    </div>
  </section>

  <template v-else>
    <ConclusionCard class="reveal" />
    <SkyBand class="reveal" />
    <TrendSection class="reveal" />
    <MapView class="reveal" />
    <ModelsPanel class="reveal" />
    <FactorsPanel class="reveal" />
    <CalibPanel class="reveal" />
  </template>

  <section class="section" style="padding-top: 0">
    <div class="wrap">
      <div class="glass" style="padding: 26px 28px; display: flex; flex-wrap: wrap; gap: 18px; align-items: center; justify-content: space-between">
        <div>
          <h3 style="margin: 0 0 6px">{{ t("分享快照") }}</h3>
          <p style="margin: 0; color: var(--tx-2); font-size: var(--fs-small)">
            生成的链接与原版互通（SNAP_VER=1），对方无需重新取数即可查看。
          </p>
        </div>
        <button class="btn btn-primary" :disabled="!snapUrl" @click="copySnap">
          {{ copied ? t("已复制") : t("复制链接") }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.snap-card {
  padding: 26px 28px;
}
.snap-sub {
  color: var(--tx-2);
  font-size: var(--fs-small);
  margin: 0 0 18px;
}
.snap-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}
@media (max-width: 640px) {
  .snap-grid { grid-template-columns: repeat(2, 1fr); }
}
.snap-fac {
  margin-top: 18px;
  display: grid;
  gap: 8px;
}
.sf {
  display: grid;
  grid-template-columns: 120px 1fr 90px;
  gap: 10px;
  align-items: center;
  font-size: var(--fs-small);
  color: var(--tx-2);
}
.sf i {
  height: 5px;
  border-radius: 3px;
  background: var(--spectrum);
}
</style>
