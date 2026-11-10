<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { state } from "../state";
import { t } from "../core/i18n";
import { searchCity, type City } from "../core/city";
import { cityName, cityWithRegion, regionName } from "../core/citylang";
import DatePicker from "./DatePicker.vue";
import heroPhoto from "../assets/hero-photo.webp";

const q = ref("");
const suggestions = ref<City[]>([]);
const showSug = ref(false);
const heroEl = ref<HTMLElement | null>(null);

const res = computed(() => state.result);
const P = computed(() => (res.value ? Math.round(res.value.P) : null));
const Q = computed(() => (res.value ? Math.round(res.value.Q) : null));
const bandOn = computed(() => state.heroPhotoMode === "band");
const fullOn = computed(() => state.heroPhotoMode === "full");
const windowOn = computed(() => state.heroPhotoMode === "window");

function onInput() {
  suggestions.value = q.value.trim() ? searchCity(q.value, 8) : [];
  showSug.value = suggestions.value.length > 0;
}
function pick(c: City) {
  state.city = c;
  q.value = "";
  showSug.value = false;
  state.result = null;
}
function useGeo() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((pos) => {
    const { latitude, longitude } = pos.coords;
    const hit = searchCity("", 1)[0];
    void hit;
    // 就近城市
    import("../core/city").then(({ nearestCity }) => {
      const n = nearestCity(latitude, longitude);
      if (n) {
        state.city = n.city;
        state.result = null;
      }
    });
  });
}

/* 沉浸式开场：星空渐入 */
onMounted(() => {
  heroEl.value?.classList.add("in");
});
</script>

<template>
  <section class="hero" :class="{ 'photo-hero': bandOn, 'photo-hero-full': fullOn, 'photo-hero-window': windowOn }">
    <div
      v-if="bandOn"
      class="photo-band"
      :style="{ backgroundImage: `url(${heroPhoto})` }"
    >
      <span class="photo-tag" aria-hidden="true">SUNGLOW · SPECTRUM</span>
      <span class="photo-credit">{{ t("广州 · 珠江 · 实拍") }}</span>
    </div>
    <div
      v-else-if="fullOn"
      class="photo-full"
      :style="{ backgroundImage: `url(${heroPhoto})` }"
    >
      <span class="photo-credit">{{ t("广州 · 珠江 · 实拍") }}</span>
    </div>

    <div class="hero-bg" aria-hidden="true">
      <div class="ring r1" />
      <div class="ring r2" />
      <div class="ring r3" />
      <div class="sweep" />
    </div>

    <div class="wrap hero-in">
      <div class="hero-copy anim-rise">
        <div class="pill" style="margin-bottom: 18px">
          <span class="dot" />
          {{ t("大气光谱观测站") }} · {{ t("多模型综合") }}
        </div>
        <h1 class="hero-title">
          霞光档案
          <span class="spectrum-text glow">SUNGLOW</span>
        </h1>
        <p class="hero-edition">{{ t("Spectrum Edition · 光谱观测版") }}</p>
        <p class="hero-sub">
          <span class="hero-slogan">{{ t("让每一次追霞，都有迹可循") }}</span>
          <span class="hero-sub-tech">{{ t("沉浸式预报体验 —— GFS / ECMWF / 光追物理三套算法，把今晚的天空写成一份可以出发的理由。") }}</span>
        </p>
        <p class="hero-note">{{ t("概率预报 · 仅供参考") }}</p>

        <div class="hero-controls">
          <div class="field" style="min-width: 210px; position: relative">
            <span aria-hidden="true">◎</span>
            <input
              v-model="q"
              :placeholder="t('搜索城市')"
              @input="onInput"
              @focus="onInput"
              :aria-label="t('搜索城市')"
            />
            <button class="mini" @click="useGeo" :title="t('使用我的位置')" :aria-label="t('使用我的位置')">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 21.5s6.5-5.8 6.5-11a6.5 6.5 0 1 0-13 0c0 5.2 6.5 11 6.5 11z" />
                <circle cx="12" cy="10.2" r="2.4" />
              </svg>
            </button>
            <div v-if="showSug" class="sug glass">
              <button v-for="c in suggestions" :key="c.name" @click="pick(c)">
                <b>{{ cityName(c.name, state.lang) }}</b>
                <span>{{ regionName(c.region, state.lang) }}</span>
              </button>
            </div>
          </div>

          <div class="field" style="min-width: 150px">
            <span aria-hidden="true">▤</span>
            <DatePicker v-model="state.dateStr" :aria-label="t('日期')" />
          </div>

          <div class="seg" role="group" :aria-label="t('时段')">
            <button
              :class="{ on: state.period === 'am' }"
              :aria-pressed="state.period === 'am'"
              @click="state.period = 'am'; state.result = null"
            >
              {{ t("朝霞") }}
            </button>
            <button
              :class="{ on: state.period === 'pm' }"
              :aria-pressed="state.period === 'pm'"
              @click="state.period = 'pm'; state.result = null"
            >
              {{ t("晚霞") }}
            </button>
          </div>

          <button class="btn btn-primary" :disabled="state.loading" @click="$emit('run')">
            {{ state.loading ? t("加载中") + "…" : t("计算") }}
          </button>
        </div>

        <div class="hero-city">
          {{ cityWithRegion(state.city.name, state.city.region, state.lang) }}
          <span v-if="res">· {{ res.dateStr }} {{ res.period === "am" ? t("朝霞") : t("晚霞") }}</span>
          <span v-if="res && res.src === 'mock'" class="pill" style="margin-left: 8px">MOCK</span>
        </div>
      </div>

      <div
        class="hero-dial anim-rise anim-rise-2"
        aria-live="polite"
        :style="windowOn ? { backgroundImage: `url(${heroPhoto})` } : undefined"
      >
        <span v-if="windowOn" class="window-cap">{{ t("广州 · 珠江 · 实拍") }}</span>
        <div class="dial">
          <svg viewBox="0 0 220 220" class="dial-svg">
            <defs>
              <linearGradient id="dg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#ff4d82" />
                <stop offset="0.5" stop-color="#ff9c3f" />
                <stop offset="1" stop-color="#2ed5e8" />
              </linearGradient>
            </defs>
            <circle cx="110" cy="110" r="92" class="dial-track" />
            <circle
              cx="110" cy="110" r="92"
              class="dial-arc"
              stroke="url(#dg)"
              :stroke-dasharray="2 * Math.PI * 92"
              :stroke-dashoffset="
                2 * Math.PI * 92 * (1 - (P ?? 0) / 100)
              "
            />
          </svg>
          <div class="dial-center">
            <b class="glow">{{ P ?? "—" }}<i>%</i></b>
            <span>{{ t("出现概率") }}</span>
          </div>
        </div>
        <div class="dial-side">
          <div class="metric">
            <span class="num" style="font-size: 1.55rem">{{ Q ?? "—" }}</span>
            <span class="lab">{{ t("观赏质量") }}</span>
          </div>
          <div class="hairline" style="margin: 12px 0" />
          <div class="metric">
            <span class="num" style="font-size: 1.15rem; color: var(--tx-2)">
              {{ res ? t(res.grade) : "—" }}
            </span>
            <span class="lab">{{ t("等级") }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  padding: clamp(32px, 6vw, 84px) 0 clamp(28px, 5vw, 72px);
  overflow: hidden;
}
/* ---- 首屏照片报头（实验）：M2 标题咬合 ---- */
.photo-hero { padding-top: 0; }
.photo-hero .hero-bg { display: none; }
.photo-band {
  position: relative;
  width: 100%;
  height: clamp(380px, 52vh, 520px);
  background-size: cover;
  background-position: 50% 58%;
  overflow: hidden;
  /* 下缘淡到透明（统一曲线）：页面背景是固定的霞光环 + 星尘，淡进实色会切出假底板 */
  -webkit-mask-image: linear-gradient(180deg, #000 46%, rgba(0, 0, 0, 0.86) 62%, rgba(0, 0, 0, 0.58) 76%, rgba(0, 0, 0, 0.26) 89%, transparent 100%);
  mask-image: linear-gradient(180deg, #000 46%, rgba(0, 0, 0, 0.86) 62%, rgba(0, 0, 0, 0.58) 76%, rgba(0, 0, 0, 0.26) 89%, transparent 100%);
}
.photo-band::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--photo-veil);
  pointer-events: none;
}
.photo-tag {
  position: absolute;
  left: 24px;
  top: 18px;
  z-index: 2;
  font-family: var(--font-display);
  font-size: var(--fs-tiny);
  letter-spacing: 0.18em;
  color: var(--photo-tag);
  text-shadow: var(--photo-credit-shadow);
}
.photo-credit {
  position: absolute;
  right: 24px;
  top: 18px;
  z-index: 2;
  font-size: var(--fs-tiny);
  letter-spacing: 0.06em;
  color: var(--photo-credit);
  text-shadow: var(--photo-credit-shadow);
}
.photo-hero .hero-in {
  margin-top: calc(-1 * clamp(170px, 24vh, 240px));
  position: relative;
  z-index: 2;
}
.photo-hero .hero-dial { position: relative; }
.photo-hero .hero-dial::before {
  content: "";
  position: absolute;
  inset: -26px;
  z-index: -1;
  border-radius: 50%;
  background: var(--photo-dial-halo);
  pointer-events: none;
}
.photo-hero .field {
  background: var(--photo-field-bg);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
/* ---- M3：全幅照片背景 ---- */
.photo-hero-full .hero-bg { display: none; }
.photo-full {
  position: absolute;
  inset: 0;
  z-index: 0;
  background-size: cover;
  background-position: 50% 30%;
  overflow: hidden;
  /* 下缘淡到透明，而不是淡进一个实色：页面背景是固定的霞光环 + 星尘（main.css body::before/::after），
     用实色收口会在交界处切出一块与页面不同的底板。 */
  -webkit-mask-image: linear-gradient(180deg, #000 0%, #000 60%, rgba(0, 0, 0, 0.62) 78%, rgba(0, 0, 0, 0.24) 91%, rgba(0, 0, 0, 0.06) 97%, transparent 100%);
  mask-image: linear-gradient(180deg, #000 0%, #000 60%, rgba(0, 0, 0, 0.62) 78%, rgba(0, 0, 0, 0.24) 91%, rgba(0, 0, 0, 0.06) 97%, transparent 100%);
}
.photo-full::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--photo-full-veil);
  pointer-events: none;
}
.photo-hero-full .hero-in { position: relative; z-index: 2; }
.photo-hero-full .hero-dial { position: relative; }
.photo-hero-full .hero-dial::before {
  content: "";
  position: absolute;
  inset: -26px;
  z-index: -1;
  border-radius: 50%;
  background: var(--photo-dial-halo);
  pointer-events: none;
}
.photo-hero-full .field {
  background: var(--photo-field-bg);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.photo-hero-full .photo-credit { top: auto; bottom: 16px; right: 24px; }
.photo-hero-full .city { color: var(--tx-2); text-shadow: var(--photo-credit-shadow); }
.photo-hero .dial-center span,
.photo-hero-full .dial-center span,
.photo-hero .metric .lab,
.photo-hero-full .metric .lab { color: var(--tx-2); }
/* ---- M4：右侧天幕窗 ---- */
.photo-hero-window .hero-bg { display: none; }
.photo-hero-window .hero-dial {
  position: relative;
  flex-direction: column;
  gap: 16px;
  min-height: 440px;
  padding: 22px;
  border-radius: var(--r-lg);
  border: 1px solid var(--stroke-2);
  overflow: hidden;
  background-size: cover;
  background-position: 50% 58%;
  box-shadow: var(--card-sh);
}
.photo-hero-window .hero-dial::before {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--photo-window-veil);
  pointer-events: none;
}
.photo-hero-window .dial,
.photo-hero-window .dial-side { position: relative; z-index: 2; }
.photo-hero-window .dial { width: min(220px, 52vw); }
.photo-hero-window .dial-side {
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 10px 20px;
  border-radius: var(--r-md);
  border: 1px solid var(--stroke);
  background: var(--photo-window-metric-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.photo-hero-window .dial-side .hairline {
  width: 1px;
  height: 30px;
  margin: 0;
  background: var(--stroke-2);
}
.photo-hero-window .dial-center span { color: var(--tx-2); }
.window-cap {
  position: absolute;
  left: 22px;
  top: 18px;
  z-index: 2;
  font-size: var(--fs-tiny);
  letter-spacing: 0.14em;
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 1px 12px rgba(2, 6, 16, 0.92);
}
@media (max-width: 980px) {
  .photo-hero-window .hero-dial {
    min-height: 400px;
    width: 100%;
    padding: 40px 22px 22px;
  }
}
.hero-bg {
  position: absolute; inset: 0;
  pointer-events: none;
}
.ring {
  position: absolute;
  border-radius: 50%;
  border: 1px solid var(--stroke);
}
.r1 {
  width: 520px; height: 520px;
  right: -140px; top: -120px;
  background: radial-gradient(circle, rgba(255, 77, 130, 0.10), transparent 66%);
}
.r2 {
  width: 380px; height: 380px;
  right: -40px; top: 40px;
  background: radial-gradient(circle, rgba(46, 213, 232, 0.09), transparent 66%);
}
.r3 {
  width: 240px; height: 240px;
  right: 90px; top: 130px;
  background: radial-gradient(circle, rgba(255, 156, 63, 0.10), transparent 66%);
}
.sweep {
  position: absolute;
  left: 0; right: 0; top: 38%;
  height: 1px;
  background: var(--spectrum);
  opacity: 0.28;
}
.hero-in {
  position: relative;
  display: grid;
  gap: clamp(28px, 5vw, 56px);
  align-items: center;
}
/* grid 子项默认 min-width:auto 会被长词/表单撑破容器（实测 394 > 340） */
.hero-in > * {
  min-width: 0;
}
.hero-copy {
  overflow-wrap: anywhere;
}
@media (min-width: 980px) {
  .hero-in { grid-template-columns: 1.15fr 0.85fr; }
}
.hero-title {
  font-size: var(--fs-hero);
  margin: 0 0 14px;
  letter-spacing: -0.03em;
  font-weight: 650;
  overflow-wrap: anywhere;
}
.hero-edition {
  margin: -6px 0 18px;
  color: var(--tx-2);
  font-family: var(--font-display);
  font-size: var(--fs-small);
  letter-spacing: 0.08em;
}
@media (max-width: 560px) {
  .hero-title {
    font-size: clamp(1.9rem, 10vw, 2.6rem);
  }
  .hero-controls {
    gap: 8px;
  }
  .hero-controls .field {
    min-width: 0 !important;
    flex: 1 1 150px;
  }
  .hero-controls .btn {
    flex: 1 1 100%;
    justify-content: center;
    margin-top: 2px;
  }
  .photo-band::after { background: var(--photo-veil-sm); }
  .photo-tag { left: 16px; top: 14px; }
  .photo-credit { right: 16px; top: 14px; }
  .photo-hero .hero-in { margin-top: -110px; }
  .photo-full::after { background: var(--photo-full-veil-sm); }
  .photo-hero-full .photo-credit { top: auto; right: 16px; bottom: 12px; }
}
.hero-sub {
  color: var(--tx-2);
  font-size: var(--fs-lead);
  max-width: 540px;
  margin: 0 0 26px;
}
/* 品牌 slogan 主句 + 原技术说明降为辅助行 */
.hero-slogan {
  display: block;
  color: var(--tx-1);
  font-size: calc(var(--fs-lead) + 0.16rem);
  font-weight: 600;
  letter-spacing: 0.01em;
}
.hero-sub-tech {
  display: block;
  margin-top: 6px;
  color: var(--tx-3);
  font-size: var(--fs-small);
}
/* 统一免责标语（首页 / 结论卡 / 页脚同一句）：紧贴副标题，不挤开操作区。
   底纹是首屏照片上的浅色白纱（≈ --bg-base #f2f5fb），--tx-3 在它上面只有 4.45:1，
   卡在 AA 线下；改用 --tx-2：浅色 6.89:1、深色 9.06:1，且仍是全页最弱的一级文字。 */
.hero-note {
  margin: -18px 0 22px;
  color: var(--tx-2);
  font-size: var(--fs-tiny);
  letter-spacing: 0.02em;
}
.hero-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.mini {
  width: 26px; height: 26px;
  border-radius: 50%;
  color: var(--tx-2);
  border: 1px solid var(--stroke-2);
  font-size: 0.8rem;
  display: inline-flex; align-items: center; justify-content: center;
}
.mini:hover { color: var(--acc-3); border-color: var(--acc-3); }
.sug {
  position: absolute;
  top: calc(100% + 8px); left: 0; right: 0;
  max-height: 260px; overflow: auto;
  z-index: 50;
  padding: 6px;
}
.sug button {
  display: flex; justify-content: space-between; width: 100%;
  padding: 8px 12px; border-radius: 8px;
  color: var(--tx-1); font-size: var(--fs-small);
}
.sug button:hover { background: var(--bg-glass-2); }
.sug span { color: var(--tx-3); font-size: var(--fs-tiny); }
.seg {
  display: inline-flex;
  padding: 3px;
  border-radius: var(--r-full);
  border: 1px solid var(--stroke-2);
  background: var(--bg-glass);
}
.seg button {
  padding: 7px 16px;
  border-radius: var(--r-full);
  font-size: var(--fs-small);
  color: var(--tx-2);
  transition: all var(--t-fast);
}
.seg button.on {
  background: var(--spectrum);
  color: var(--tx-inv);
  font-weight: 600;
}
.hero-city {
  margin-top: 16px;
  color: var(--tx-3);
  font-size: var(--fs-small);
}
.dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--acc-3);
  box-shadow: 0 0 8px var(--acc-3);
  animation: pulseGlow 2.4s infinite;
}
.hero-dial {
  display: flex;
  gap: 22px;
  align-items: center;
  justify-content: center;
  padding: 18px;
}
.dial {
  position: relative;
  width: min(240px, 58vw);
  aspect-ratio: 1;
  animation: floatSlow 7s ease-in-out infinite;
}
.dial-svg {
  width: 100%; height: 100%;
  transform: rotate(-90deg);
}
.dial-track {
  fill: none;
  stroke: var(--stroke);
  stroke-width: 10;
}
.dial-arc {
  fill: none;
  stroke-width: 10;
  stroke-linecap: round;
  filter: drop-shadow(0 0 14px rgba(255, 110, 150, 0.45));
  transition: stroke-dashoffset 1s var(--ease-out);
}
.dial-center {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 4px;
}
.dial-center b {
  font-family: var(--font-display);
  font-size: clamp(2.4rem, 6vw, 3.4rem);
  font-weight: 650;
  letter-spacing: -0.03em;
  line-height: 1;
}
.dial-center b i {
  font-style: normal;
  font-size: 0.42em;
  margin-left: 2px;
  color: var(--tx-2);
}
.dial-center span {
  font-size: var(--fs-tiny);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--tx-3);
}
.dial-side { min-width: 110px; }
</style>
