<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { state, refresh, refreshTrend, setCity, todayStr } from "../state";
import { t } from "../core/i18n";
import { searchCity } from "../core/city";
import type { City } from "../core/city";
import ConclusionBar from "../components/ConclusionBar.vue";
import MapStage from "../components/MapStage.vue";
import CalendarWing from "../components/CalendarWing.vue";
import ConfidenceWing from "../components/ConfidenceWing.vue";

const q = ref("");
const open = ref(false);
const hits = computed<City[]>(() => (q.value.trim() ? searchCity(q.value.trim(), 8) : []));

function pickCity(c: City) {
  open.value = false;
  q.value = "";
  void setCity(c);
}

onMounted(() => {
  void refresh();
  void refreshTrend();
});
</script>

<template>
  <main>
    <!-- 地点选择条（结论条上方，指挥台的"设定"行） -->
    <div class="wrap" style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding-top: 18px; padding-bottom: 2px">
      <label style="font-family: var(--f-mono); font-size: 11px; letter-spacing: 0.12em; color: var(--tx-3)">
        {{ t("地点") }}
      </label>
      <div style="position: relative">
        <input
          v-model="q"
          :placeholder="t('搜索城市')"
          style="width: 220px; padding: 7px 10px; border: 1px solid var(--line-strong); border-radius: 3px; background: var(--bg-panel); color: var(--tx); font: inherit; font-size: 13px"
          @focus="open = true"
        >
        <div
          v-if="open && hits.length"
          style="position: absolute; top: 40px; left: 0; width: 260px; border: 1px solid var(--line-strong); border-radius: 4px; background: var(--bg-panel); z-index: 30; box-shadow: var(--shadow)"
        >
          <button
            v-for="c in hits"
            :key="c.name"
            style="display: block; width: 100%; text-align: left; padding: 8px 12px; font-size: 13px; color: var(--tx-2)"
            @click="pickCity(c)"
          >{{ c.name }} <span style="color: var(--tx-3); font-size: 11px">{{ c.region }}</span></button>
        </div>
      </div>
      <span style="font-family: var(--f-mono); font-size: 11px; color: var(--tx-3)">
        {{ state.dateStr || todayStr() }} · {{ state.city ? state.city.lat.toFixed(2) + "°N " + state.city.lon.toFixed(2) + "°E" : "" }}
      </span>
      <span v-if="state.src === 'mock'" class="mock-flag">{{ t("MOCK 模式") }}</span>
    </div>

    <ConclusionBar />

    <div class="wrap console">
      <CalendarWing />
      <MapStage />
      <ConfidenceWing />
    </div>
  </main>
</template>
