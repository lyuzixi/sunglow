<script setup lang="ts">
import { ref } from "vue";
import { state, savePrefs, FOLD_KEYS } from "../state";
import { t } from "../core/i18n";

const open = ref(false);

/* 地图显示开关（云纹/经纬网/直标/采样点）已移到观测场面板，不再进全局设置 */
const BOOL_SHOWN = ["hour12", "calibOff"] as const;

const BOOL_LABEL: Record<string, string> = {
  numLabels: "数值直标",
  showPts: "采样点",
  showTx: "云纹层",
  showGrid: "经纬网",
  hour12: "12 小时制",
  calibOff: "关闭校准记录"
};
const FOLD_LABEL: Record<string, string> = {
  rayFold: "收起光追详情",
  notesFold: "收起附注",
  heroFold: "收起结论卡",
  trendFold: "收起趋势",
  legendFold: "收起图例"
};

function toggle(k: string) {
  (state as unknown as Record<string, boolean>)[k] =
    !(state as unknown as Record<string, boolean>)[k];
  if (k === "calibOff") state.calibOn = !state.calibOff;
  savePrefs();
}
function toggleFold(k: string) {
  state.folds[k] = !state.folds[k];
  savePrefs();
}
function setUnits(u: "metric" | "imperial") {
  state.units = u;
  savePrefs();
}
</script>

<template>
  <div class="settings">
    <button class="btn btn-ghost" @click="open = !open" :aria-expanded="open">
      ⚙ {{ t("设置") }}
    </button>
    <div v-if="open" class="panel glass">
      <div class="grp">
        <div class="grp-h">{{ t("单位") }}</div>
        <div class="seg" role="group" aria-label="单位">
          <button :class="{ on: state.units === 'metric' }" @click="setUnits('metric')">
            {{ t("公制 (km / m / ℃)") }}
          </button>
          <button :class="{ on: state.units === 'imperial' }" @click="setUnits('imperial')">
            {{ t("英制 (mi / ft / ℉)") }}
          </button>
        </div>
      </div>

      <div class="grp">
        <div class="grp-h">{{ t("显示") }}</div>
        <label v-for="k in BOOL_SHOWN" :key="k" class="row">
          <input
            type="checkbox"
            :checked="(state as any)[k]"
            @change="toggle(k)"
          />
          <span>{{ t(BOOL_LABEL[k] || k) }}</span>
        </label>
      </div>

      <div class="grp">
        <div class="grp-h">{{ t("折叠默认") }}</div>
        <label v-for="k in FOLD_KEYS" :key="k" class="row">
          <input
            type="checkbox"
            :checked="!!state.folds[k]"
            @change="toggleFold(k)"
          />
          <span>{{ t(FOLD_LABEL[k] || k) }}</span>
        </label>
      </div>

      <p class="note">
        {{ t("偏好存 glowcast.v2.pref，与原版 sunsetbot.pref.v1 相互独立。位置、日期与地图时段不持久化。") }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.settings {
  position: relative;
}
.panel {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  width: min(320px, 88vw);
  padding: 16px;
  z-index: 200;
  max-height: 70vh;
  overflow: auto;
}
.grp {
  margin-bottom: 14px;
}
.grp-h {
  font-size: var(--fs-tiny);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--tx-3);
  margin-bottom: 8px;
}
.row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 5px 0;
  font-size: var(--fs-small);
  color: var(--tx-2);
  cursor: pointer;
}
.seg {
  display: inline-flex;
  padding: 3px;
  border-radius: var(--r-full);
  border: 1px solid var(--stroke-2);
  background: var(--bg-glass);
}
.seg button {
  padding: 6px 12px;
  border-radius: var(--r-full);
  font-size: var(--fs-tiny);
  color: var(--tx-2);
}
.seg button.on {
  background: var(--spectrum);
  color: var(--tx-inv);
}
.note {
  margin: 0;
  font-size: var(--fs-tiny);
  color: var(--tx-3);
  line-height: 1.7;
}
.note code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-glass-2);
}
</style>
