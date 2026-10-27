<script setup lang="ts">
import { state, savePrefs } from "../state";
import { t } from "../core/i18n";
import { cacheReport, clearCache, fmtBytes } from "../core/cache";
import { ref as vueRef, onMounted as vueMounted } from "vue";

/* 开合由顶栏统一管（顶栏同一时刻只开一个浮层），这里只声明状态 */
const open = defineModel<boolean>({ default: false });
const emit = defineEmits<{ toggle: [] }>();
const cache = vueRef(cacheReport());
const cleared = vueRef("");
function refreshCache() { cache.value = cacheReport(); }
function doClear(kind: "point" | "map" | "trend" | "all") {
  const n = clearCache(kind);
  cleared.value = t("已清除") + " " + n + " " + t("条");
  refreshCache();
}
vueMounted(refreshCache);

/* 地图显示开关（云纹/经纬网/直标/采样点）在观测场面板；「关闭校准记录」开关已删，
   校准的开关唯一入口在实况校准卡（setCalibOn，切换即写偏好）。 */
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
    <button class="icon-btn" @click.stop="emit('toggle')" :aria-expanded="open" :aria-label="t('设置')" :title="t('设置')">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
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
        <p class="note">{{ t("缓存按「日期+时段+坐标」分键，单点/地图/趋势均 6 小时有效；清除后下次计算会重新取数。") }}</p>
      </div>

      <p class="note">
        {{ t("偏好存 glowcast.v2.pref，与V1 sunsetbot.pref.v1 相互独立。位置、日期与地图时段不持久化。") }}
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
/* ≤860px（导航切抽屉的同一断点）：设置按钮右侧只剩两个图标，面板再按 320px
   往左展开会顶穿视口左边界。这里把定位上下文从按钮换成整条顶栏，
   面板贴视口左右各 12px、在 420px 处封顶，纵向高度按顶栏实际高度扣减。 */
@media (max-width: 860px) {
  .settings { position: static; }
  .panel {
    left: 12px;
    right: 12px;
    top: calc(100% + 8px);
    width: auto;
    max-width: 420px;
    margin-left: auto;
    max-height: calc(100vh - 108px);
    max-height: calc(100dvh - 108px);
    z-index: 260;
  }
  /* 面板挂在 .topbar 里，顶栏自身的 backdrop-filter 形成 backdrop root，
     子元素的磨砂取样不到顶栏之外的页面内容 —— 半透明玻璃底会把英雄区大字
     透上来。手机端面板面积大、正压在正文上，这里换成实色卡片底 + 高光渐变。 */
  .panel,
  .panel.glass {
    background: linear-gradient(180deg, var(--glass-sheen), transparent 46%) var(--bg-card-solid);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
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
