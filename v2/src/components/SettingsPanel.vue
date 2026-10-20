<script setup lang="ts">
import { ref } from "vue";
import { state, savePrefs, FOLD_KEYS } from "../state";
import { t } from "../core/i18n";
import { cacheReport, clearCache, fmtBytes } from "../core/cache";
import { ref as vueRef, onMounted as vueMounted } from "vue";

const open = ref(false);
const cache = vueRef(cacheReport());
const cleared = vueRef("");
function refreshCache() { cache.value = cacheReport(); }
function doClear(kind: "point" | "map" | "trend" | "all") {
  const n = clearCache(kind);
  cleared.value = t("已清除") + " " + n + " " + t("条");
  refreshCache();
}
vueMounted(refreshCache);

/* 地图显示开关（云纹/经纬网/直标/采样点）已移到观测场面板，不再进全局设置 */
const BOOL_SHOWN = ["calibOff"] as const;

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
function setHour12(on: boolean) {
  state.hour12 = on;
  savePrefs();
}
function setUnits(u: "metric" | "imperial") {
  state.units = u;
  savePrefs();
}
</script>

<template>
  <div class="settings">
    <button class="btn btn-ghost ico" @click="open = !open" :aria-expanded="open" :aria-label="t('设置')" :title="t('设置')">
      ⚙
    </button>
    <div v-if="open" class="panel glass">
      <div class="grp">
        <div class="grp-h">{{ t("单位") }}</div>
        <div class="seg" role="group" :aria-label="t('单位')">
          <button :class="{ on: state.units === 'metric' }" @click="setUnits('metric')">
            {{ t("公制 (km / m / ℃)") }}
          </button>
          <button :class="{ on: state.units === 'imperial' }" @click="setUnits('imperial')">
            {{ t("英制 (mi / ft / ℉)") }}
          </button>
        </div>

        <div class="sub-h">{{ t("时间格式") }}</div>
        <div class="seg" role="group" :aria-label="t('时间格式')">
          <button :class="{ on: !state.hour12 }" @click="setHour12(false)">
            {{ t("24 小时制") }}
          </button>
          <button :class="{ on: state.hour12 }" @click="setHour12(true)">
            {{ t("12 小时制") }}
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

      <div class="grp">
        <div class="grp-h">{{ t("取数缓存") }}</div>
        <div class="cstat">
          <span>{{ t("单点预报") }} {{ cache.point.n }}</span>
          <span>{{ t("观测场") }} {{ cache.map.n }}</span>
          <span>{{ t("趋势") }} {{ cache.trend.n }}</span>
          <span>{{ fmtBytes(cache.totalBytes) }}</span>
        </div>
        <div class="crow">
          <button class="btn btn-ghost sm" @click="doClear('all')">{{ t("清除全部缓存") }}</button>
          <button class="btn btn-ghost sm" @click="refreshCache()">{{ t("刷新统计") }}</button>
        </div>
        <p v-if="cleared" class="ok">{{ cleared }}</p>
        <p class="note">{{ t("缓存按「日期+时段+坐标」分键，单点 3 小时、地图/趋势 3 小时有效；清除后下次计算会重新取数。") }}</p>
      </div>

      <p class="note">
        {{ t("偏好存 glowcast.v2.pref，与原版 sunsetbot.pref.v1 相互独立。位置、日期与地图时段不持久化。") }}
      </p>
    </div>
  </div>
</template>

<style scoped>
/* 设置面板：液态玻璃（与移动端目录同一配方：高光渐变 + 磨砂提饱和 + 内侧 1px 高光） */
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .panel {
    background: linear-gradient(180deg, var(--glass-sheen), transparent 46%) var(--glass);
    backdrop-filter: saturate(1.55) blur(18px);
    -webkit-backdrop-filter: saturate(1.55) blur(18px);
    border: 1px solid var(--stroke-2);
    box-shadow: 0 24px 60px -26px rgba(8, 14, 26, 0.5), inset 0 1px 0 var(--glass-hi);
  }
}
.sub-h {
  margin: 12px 0 6px;
  font-size: 11.5px;
  color: var(--tx-3);
  letter-spacing: 0.02em;
}
.ico { padding: 6px 10px; line-height: 1; }
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
.cstat {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: var(--fs-tiny);
  color: var(--tx-2);
  margin-bottom: 8px;
}
.crow { display: flex; gap: 8px; margin-bottom: 6px; }
.ok { margin: 0 0 8px; font-size: var(--fs-tiny); color: var(--q-good); }
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
