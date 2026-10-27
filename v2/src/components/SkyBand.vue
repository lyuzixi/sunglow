<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue";
import { state } from "../state";
import { t } from "../core/i18n";
import { skyBandOf } from "../core/skyband";

/* 天色带（内联版，供结论卡使用）
   算法在 core/skyband.ts —— 保存图片要用同一份结果，不能各算一遍。
   这里只管尺寸测量、「此刻」每分钟刷新与窄屏降级。 */
const res = computed(() => state.result);
const hostW = ref(800);
const axisEl = ref<HTMLDivElement | null>(null);
const nowMs = ref(Date.now());
let timer = 0;

onMounted(() => {
  timer = window.setInterval(() => (nowMs.value = Date.now()), 60000);
  measure();
  window.addEventListener("resize", measure);
});
onUnmounted(() => {
  clearInterval(timer);
  window.removeEventListener("resize", measure);
});
function measure() {
  if (axisEl.value) hostW.value = axisEl.value.clientWidth;
}

const band = computed(() => {
  const r = res.value;
  return r ? skyBandOf(r, nowMs.value, state.dateStr) : null;
});

/* fitAxis：窄屏降级（幂等）—— 隐藏分界名称，只留时刻 */
const showNames = computed(() => hostW.value >= 560);
</script>

<template>
  <div v-if="band" class="skywrap">
    <div class="sky">
      <div
        v-for="(s, i) in band.segs"
        :key="i"
        class="s"
        :class="s.cls"
        :style="{ flexGrow: s.m }"
        :title="s.title"
      />
      <div class="glow" :style="{ '--x': band.glowX + '%' }" />
      <div
        v-if="band.win"
        class="win"
        :style="{ left: band.win.left + '%', width: band.win.width + '%' }"
        :title="t('霞光窗口')"
      />
      <div v-if="band.nowPct != null" class="now" :style="{ left: band.nowPct + '%' }" />
      <div class="grain" />
    </div>

    <div ref="axisEl" class="skyaxis two" :class="{ tonly: !showNames }">
      <span
        v-for="(m, i) in band.marks"
        :key="i"
        class="mk"
        :class="m.cls"
        :style="{ left: m.p + '%' }"
      >
        <i class="nm">{{ m.name }}</i><b>{{ m.time }}</b>
      </span>
      <span
        v-if="band.nowPct != null"
        class="mk nowlbl"
        :class="band.nowPct > 82 ? 'an-r' : band.nowPct < 18 ? 'an-l' : 'an-m'"
        :style="{ left: band.nowPct + '%' }"
      >
        {{ t("此刻") }} {{ band.nowText }}
      </span>
    </div>

    <div class="skyfoot">
      <span>{{ t("五段曙暮光：白昼余晖 / 民用 / 航海 / 天文 / 夜间") }}</span>
      <span v-if="band.win">{{ t("底部橙条＝霞光窗口") }}</span>
      <span v-if="band.tzHint" class="tzf">{{ t("当地时间") }} {{ band.tzHint }}</span>
    </div>
  </div>
</template>

<style scoped>
.skywrap { margin: 0 0 16px; }
/* 带子两侧出血，由卡片圆角裁齐（与V1 .sky 同构） */
.sky {
  display: flex;
  height: 84px;
  margin: 0 -26px;
  overflow: hidden;
  position: relative;
}
.sky .s { display: block; min-width: 1px; }
.s-day { background: var(--dusk-day); }
.s-civil { background: var(--dusk-civil); }
.s-naut { background: var(--dusk-nautical); }
.s-astro { background: var(--dusk-astro); }
.s-night { background: var(--dusk-night); }
/* 霞光位置柔光 */
.glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(
    46% 150% at var(--x, 50%) 96%,
    rgba(255, 166, 87, 0.3) 0%,
    transparent 68%
  );
}
/* 颗粒 */
.grain {
  position: absolute;
  inset: 0;
  pointer-events: none;
  mix-blend-mode: overlay;
  opacity: 0.1;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E");
  background-size: 160px 160px;
}
[data-theme="light"] .grain { opacity: 0.12; }
/* 霞光窗口：橙底线 + 白上沿 */
.win {
  position: absolute;
  bottom: 0;
  height: 4px;
  min-width: 3px;
  background: var(--acc-1);
  border-top: 1px solid rgba(255, 255, 255, 0.85);
  border-radius: 2px;
  pointer-events: none;
}
.win::before, .win::after {
  content: "";
  position: absolute;
  top: -6px;
  width: 1px;
  height: 9px;
  background: var(--acc-1);
  opacity: 0.9;
}
.win::before { left: 0; }
.win::after { right: 0; }
/* 现在线 */
.now {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 0 0 1px rgba(20, 30, 45, 0.35);
  pointer-events: none;
}
/* 两行轴 */
.skyaxis {
  position: relative;
  height: 34px;
  margin: 7px -26px 0;
  font-size: 11px;
  line-height: 16px;
  color: var(--tx-3);
}
.skyaxis span {
  position: absolute;
  top: 0;
  white-space: nowrap;
  transform: translateX(-50%);
}
.skyaxis .mk.an-l { transform: none; }
.skyaxis .mk.an-r { transform: translateX(-100%); }
.skyaxis b { font-weight: 600; color: var(--tx-2); margin-left: 4px; }
.skyaxis .nm { font-style: normal; }
.skyaxis.tonly .nm { display: none; }
.skyaxis .nowlbl {
  top: 16px;
  font-weight: 700;
  color: var(--acc-3);
}
.skyaxis .nowlbl.an-m { transform: translateX(-50%); }
.skyaxis .nowlbl.an-l { transform: none; }
.skyaxis .nowlbl.an-r { transform: translateX(-100%); }
.skyfoot {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  font-size: var(--fs-tiny);
  color: var(--tx-3);
  margin-top: 2px;
}
.skyfoot .tzf { white-space: nowrap; }
</style>
