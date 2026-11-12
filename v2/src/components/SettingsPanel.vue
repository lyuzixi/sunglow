<script setup lang="ts">
import { state, savePrefs, setLangAndSave, setThemeAndSave, type ThemeMode } from "../state";
import { t, LANGS, LANG_NAMES, type Lang } from "../core/i18n";
import { cacheReport, clearCache, fmtBytes } from "../core/cache";
import { openFeedback } from "../composables/useFeedback";
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
function setHeroMode(m: "off" | "band" | "full" | "window") {
  state.heroPhotoMode = m;
  savePrefs();
}
/* 语言与主题 2026-11-10 从顶栏搬进设置：顶栏两个图标位让给导航与徽标，
   这两项本来就是「偶尔改一次」的偏好，放在设置里更顺。
   写入仍走 state 的唯一入口（setLangAndSave / setThemeAndSave），别在这里各写一份。 */
function setTheme(m: ThemeMode) {
  setThemeAndSave(m);
}
function setLang(l: Lang) {
  setLangAndSave(l);
}
/** 从设置菜单进入关于 / 反馈前，先收起面板，避免浮层互相压住 */
function closePanel() {
  open.value = false;
}
function openFeedbackFromSettings() {
  closePanel();
  openFeedback();
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
        <div class="grp-h">{{ t("界面") }}</div>
        <div class="sub-h">{{ t("主题") }}</div>
        <div class="seg seg-photo" role="group" :aria-label="t('主题')">
          <button :class="{ on: state.theme === 'dark' }" @click="setTheme('dark')">
            {{ t("深色") }}
          </button>
          <button :class="{ on: state.theme === 'light' }" @click="setTheme('light')">
            {{ t("浅色") }}
          </button>
          <button :class="{ on: state.theme === 'system' }" @click="setTheme('system')">
            {{ t("跟随系统") }}
          </button>
        </div>

        <div class="sub-h">{{ t("语言") }}</div>
        <div class="seg seg-photo" role="group" :aria-label="t('语言')">
          <button
            v-for="l in LANGS"
            :key="l"
            :class="{ on: state.lang === l }"
            @click="setLang(l)"
          >
            {{ LANG_NAMES[l] }}
          </button>
        </div>
      </div>

      <div class="grp">
        <div class="grp-h">{{ t("外观") }}</div>
        <div class="sub-h">{{ t("照片背景") }}</div>
        <div class="seg seg-photo" role="group" :aria-label="t('照片背景')">
          <button :class="{ on: state.heroPhotoMode === 'off' }" @click="setHeroMode('off')">
            {{ t("关闭") }}
          </button>
          <button :class="{ on: state.heroPhotoMode === 'band' }" @click="setHeroMode('band')">
            {{ t("报头带") }}
          </button>
          <button :class="{ on: state.heroPhotoMode === 'full' }" @click="setHeroMode('full')">
            {{ t("全幅") }}
          </button>
          <button :class="{ on: state.heroPhotoMode === 'window' }" @click="setHeroMode('window')">
            {{ t("天幕窗") }}
          </button>
        </div>
        <p class="note">{{ t("照片模式：报头带在首屏顶部显示实拍照片；全幅铺满首屏；天幕窗把照片收进右侧玻璃窗。") }}</p>
      </div>

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
        {{ t("偏好只存在本机浏览器，与经典原版的偏好互不影响。位置、日期与地图时段不持久化。") }}
      </p>

      <div class="grp">
        <div class="grp-h">{{ t("关于与支持") }}</div>
        <div class="crow">
          <router-link class="btn btn-ghost sm" to="/about" @click="closePanel">
            {{ t("关于 / 隐私") }}
          </router-link>
          <button class="btn btn-ghost sm" @click="openFeedbackFromSettings">
            {{ t("反馈") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 设置面板：液态玻璃（顶栏磨砂已改由伪元素承担，这里能真正采样页面内容）。
   两层高光：右上柔光 + 顶部竖向薄光，再压 1px 内侧高光，避免只像一块半透明色块。 */
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .panel {
    background:
      radial-gradient(120% 72% at 18% 0%, var(--glass-sheen), transparent 58%),
      linear-gradient(180deg, var(--glass-sheen), transparent 46%),
      var(--glass);
    backdrop-filter: saturate(1.7) blur(26px);
    -webkit-backdrop-filter: saturate(1.7) blur(26px);
    border: 1px solid var(--stroke-2);
    box-shadow:
      0 26px 70px -30px rgba(8, 14, 26, 0.55),
      inset 0 1px 0 var(--glass-hi);
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
  /* 手机端面板面积大、正压在正文上：保持同一套玻璃，但顶栏磨砂已拆到
     伪元素，不再形成 backdrop root —— 这里能真正采样并模糊页面内容。
     不支持 backdrop-filter 的浏览器在下方退回实色底。 */
}
.grp {
  margin-bottom: 14px;
}
/* 不支持 backdrop-filter 时的兜底：实色卡片底 + 高光渐变，避免半透明糊片 */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .panel,
  .panel.glass {
    background: linear-gradient(180deg, var(--glass-sheen), transparent 46%) var(--bg-card-solid);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
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
.seg-photo {
  display: flex;
  width: 100%;
}
.seg-photo button {
  flex: 1 1 auto;
  padding: 6px 8px;
  white-space: nowrap;
}
.cstat {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: var(--fs-tiny);
  color: var(--tx-2);
  margin-bottom: 8px;
}
.crow { display: flex; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
.crow a.btn { text-decoration: none; }
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
