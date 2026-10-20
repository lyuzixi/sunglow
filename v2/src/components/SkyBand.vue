<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue";
import { state } from "../state";
import { t } from "../core/i18n";
import { solarPosition } from "../core/astro";
import { uClock } from "../core/units";

/* 天色带（内联版，供结论卡使用）
   口径对齐原版 _p5b：
   · 五段固定曙暮光序列，段宽＝该段真实时长（太阳高度角 0/−6/−12/−18/−20° 分段）
   · 轴用通俗术语：晚霞 日落/渐暗/深蓝/天黑；朝霞 日出/渐亮/淡蓝/天亮
   · 霞光窗口（云边界→地球遮挡之间）+ 现在游标，两行轴 */
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
  if (!r) return null;
  const isAM = r.period === "am";
  const dir = isAM ? -1 : 1; // 时间推进方向
  const evMs = r.evMs;
  const altOf = (ms: number) => solarPosition(ms, r.city.lat, r.city.lon).altitude;
  const cross = (target: number, d: number): number | null => {
    let lo = evMs, hi = evMs + d * 6 * 3600000;
    const f = (ms: number) => altOf(ms) - target;
    if (!(f(lo) * f(hi) <= 0)) return null;
    for (let i = 0; i < 44; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) * f(lo) > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const tEdge = cross(2, -dir);
  const t6 = cross(-6, dir), t12 = cross(-12, dir);
  const t18 = cross(-18, dir), t20 = cross(-20, dir);
  if (tEdge == null || t6 == null || t12 == null || t18 == null || t20 == null) return null;
  const tStart = Math.min(tEdge, t20), tEnd = Math.max(tEdge, t20);
  const span = tEnd - tStart;
  if (!(span > 60000)) return null;

  const seg = (cls: string, a: number, b: number, title: string) => ({
    cls, m: Math.max(0.01, (b - a) / 60000), title
  });
  const segs = isAM
    ? [seg("s-night", tStart, t18, t("夜间")),
       seg("s-astro", t18, t12, t("天文曙暮光")),
       seg("s-naut", t12, t6, t("航海曙暮光")),
       seg("s-civil", t6, evMs, t("民用曙暮光")),
       seg("s-day", evMs, tEnd, t("白昼余晖"))]
    : [seg("s-day", tStart, evMs, t("白昼余晖")),
       seg("s-civil", evMs, t6, t("民用曙暮光")),
       seg("s-naut", t6, t12, t("航海曙暮光")),
       seg("s-astro", t12, t18, t("天文曙暮光")),
       seg("s-night", t18, tEnd, t("夜间"))];

  /* 霞光窗口：θnear（云边界）→ θfar（地球遮挡） */
  let win: { left: number; width: number } | null = null;
  const g = r.sRT.geom;
  if (g && g.ok && isFinite(g.thNearDeg) && isFinite(g.thFarDeg)) {
    const a = cross(-g.thNearDeg, dir), b = cross(-g.thFarDeg, dir);
    if (a != null && b != null) {
      const ws = Math.max(tStart, Math.min(a, b));
      const we = Math.min(tEnd, Math.max(a, b));
      if (we > ws) {
        win = {
          left: ((ws - tStart) / span) * 100,
          width: ((we - ws) / span) * 100
        };
      }
    }
  }

  const pct = (ms: number) => ((ms - tStart) / span) * 100;
  const now = new Date();
  const today =
    now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") +
    "-" + String(now.getDate()).padStart(2, "0");
  const nowIn = state.dateStr === today && nowMs.value >= tStart && nowMs.value <= tEnd;

  const nameOf = (k: "ev" | "a" | "b" | "c") =>
    isAM
      ? { ev: t("日出"), a: t("渐亮"), b: t("淡蓝"), c: t("天亮") }[k]
      : { ev: t("日落"), a: t("渐暗"), b: t("深蓝"), c: t("天黑") }[k];

  const marks = [
    { p: pct(evMs), name: nameOf("ev"), time: uClock(evMs), cls: "an-l" },
    { p: pct(t6), name: nameOf("a"), time: uClock(t6), cls: "" },
    { p: pct(t12), name: nameOf("b"), time: uClock(t12), cls: "" },
    { p: pct(t18), name: nameOf("c"), time: uClock(t18), cls: "an-r" }
  ];

  return {
    segs, win, marks,
    glowX: win ? win.left + win.width / 2 : 50,
    nowPct: nowIn ? pct(nowMs.value) : null,
    nowText: nowIn ? uClock(nowMs.value) : ""
  };
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
    </div>
  </div>
</template>

<style scoped>
.skywrap { margin: 0 0 16px; }
/* 带子两侧出血，由卡片圆角裁齐（与原版 .sky 同构） */
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
  font-size: var(--fs-tiny);
  color: var(--tx-3);
  margin-top: 2px;
}
</style>
