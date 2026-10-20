<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue";
import { state } from "../state";
import { t } from "../core/i18n";
import { solarPosition } from "../core/astro";
import { uClock } from "../core/units";

const res = computed(() => state.result);
const nowMs = ref(Date.now());
let timer = 0;
const hostW = ref(800);

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
  const el = document.getElementById("skyAxis");
  if (el) hostW.value = el.clientWidth;
}

/* 天色带：以事件为中心的 ±70 分钟窗口 */
const winStart = computed(() => (res.value ? res.value.evMs - 70 * 60000 : 0));
const winEnd = computed(() => (res.value ? res.value.evMs + 70 * 60000 : 0));

interface Mark {
  p: number;
  alt: number;
  label: string;
  big?: boolean;
  now?: boolean;
  sub?: string;
}

/* 第一行：太阳事件（0/−6/−12/−18° 分界） */
const eventMarks = computed<Mark[]>(() => {
  if (!res.value) return [];
  const { evMs, period, evName } = res.value;
  const defs = [
    { off: -55, label: t("天文" + (period === "am" ? "晨光始" : "昏影终")), alt: -18 },
    { off: -30, label: t("航海" + (period === "am" ? "晨光始" : "昏影终")), alt: -12 },
    { off: -12, label: t("民用" + (period === "am" ? "晨光始" : "昏影终")), alt: -6 },
    { off: 0, label: t(evName), alt: -0.833, big: true },
    { off: 18, label: t(period === "am" ? "日出后" : "日落后"), alt: -2 }
  ];
  return defs.map((d) => ({
    p: (evMs + d.off * 60000 - winStart.value) / (winEnd.value - winStart.value),
    alt: d.alt,
    label: d.label,
    big: d.big
  }));
});

/* 第二行：now 游标 + 本地时间刻度 */
const nowMark = computed<Mark | null>(() => {
  if (!res.value) return null;
  const p = (nowMs.value - winStart.value) / (winEnd.value - winStart.value);
  if (p < -0.02 || p > 1.02) return null;
  return {
    p: Math.max(0, Math.min(1, p)),
    alt: solarPosition(nowMs.value, res.value.city.lat, res.value.city.lon).altitude,
    label: t("此刻"),
    now: true,
    sub: fmt(nowMs.value)
  };
});

const hourTicks = computed(() => {
  const out: Array<{ p: number; label: string }> = [];
  const start = winStart.value, end = winEnd.value;
  const d0 = new Date(start);
  d0.setMinutes(0, 0, 0);
  for (let ms = d0.getTime(); ms <= end; ms += 3600000) {
    if (ms < start) continue;
    out.push({ p: (ms - start) / (end - start), label: fmt(ms) });
  }
  return out;
});

/* fitAxis：窄屏降级（幂等）——每隔一个隐藏小标 */
const showEvery = computed(() => (hostW.value < 560 ? 2 : 1));

function fmt(ms: number): string { return uClock(ms); }
</script>

<template>
  <section id="sky" class="section">
    <div class="wrap">
      <div class="section-head">
        <h2>{{ t("天色带") }}</h2>
        <div class="sub" v-if="res">
          {{ fmt(winStart) }} — {{ fmt(winEnd) }} · {{ t("本地时间") }}
        </div>
      </div>

      <div class="glass band-card">
        <div class="band-sky" aria-hidden="true">
          <div class="sky-grad" />
          <div class="sun-orb">☀</div>
        </div>

        <!-- 两行轴：行1 太阳事件，行2 now 游标 + 小时刻度 -->
        <div id="skyAxis" class="axis">
          <div class="axis-row events">
            <div
              v-for="(m, i) in eventMarks"
              :key="i"
              class="mk"
              :class="{ big: m.big }"
              :style="{ left: m.p * 100 + '%' }"
            >
              <div class="mk-line" />
              <div class="mk-label">
                <b>{{ m.label }}</b>
                <span>{{ m.alt.toFixed(0) }}°</span>
              </div>
            </div>
          </div>

          <div class="axis-row cursor">
            <div
              v-for="(tk, i) in hourTicks"
              :key="'h' + i"
              class="tick"
              :style="{ left: tk.p * 100 + '%' }"
            >
              <div class="tick-line" />
              <span v-if="i % showEvery === 0" class="tick-label">{{ tk.label }}</span>
            </div>
            <div
              v-if="nowMark"
              class="mk now"
              :style="{ left: nowMark.p * 100 + '%' }"
            >
              <div class="mk-line" />
              <div class="mk-label">
                <b>{{ nowMark.label }}</b>
                <span>{{ nowMark.sub }} · {{ nowMark.alt.toFixed(0) }}°</span>
              </div>
            </div>
          </div>
        </div>

        <div class="band-legend">
          <span><i class="d" />{{ t("太阳高度角 0° / −6° / −12° / −18°（事件行）") }}</span>
          <span v-if="res">{{ t(res.evName) }} {{ uClock(res.evMs) }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.band-card {
  padding: 22px 22px 16px;
  overflow: hidden;
}
.band-sky {
  position: relative;
  height: 118px;
  border-radius: var(--r-md);
  overflow: hidden;
  border: 1px solid var(--stroke);
}
.sky-grad {
  position: absolute; inset: 0;
  background: linear-gradient(
    180deg,
    rgba(46, 213, 232, 0.16) 0%,
    rgba(255, 156, 63, 0.28) 55%,
    rgba(255, 77, 130, 0.32) 78%,
    rgba(20, 18, 40, 0.55) 100%
  );
}
[data-theme="light"] .sky-grad {
  background: linear-gradient(
    180deg,
    #cfeef8 0%,
    #ffe1b8 55%,
    #ffb3c3 78%,
    #d9a3c8 100%
  );
}
.sun-orb {
  position: absolute;
  left: 50%; top: 42%;
  transform: translate(-50%, -50%);
  font-size: 30px;
  filter: drop-shadow(0 0 18px rgba(255, 180, 80, 0.7));
}
.axis {
  position: relative;
  margin: 10px 6px 0;
}
.axis-row {
  position: relative;
}
.axis-row.events { height: 58px; }
.axis-row.cursor {
  height: 42px;
  border-top: 1px solid var(--stroke);
  margin-top: 2px;
}
.mk {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.mk-line {
  width: 1px; height: 18px;
  background: var(--stroke-2);
}
.mk.big .mk-line {
  width: 2px;
  background: var(--spectrum);
}
.mk.now .mk-line {
  background: var(--acc-3);
  box-shadow: 0 0 8px var(--acc-3);
  height: 26px;
}
.mk-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 0.62rem;
  color: var(--tx-3);
  white-space: nowrap;
}
.mk-label b {
  font-weight: 550;
  color: var(--tx-2);
  font-size: 0.68rem;
}
.mk.big .mk-label b { color: var(--tx-1); }
.mk.now .mk-label b { color: var(--acc-3); }
.cursor .mk { top: 0; }
.tick {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
}
.tick-line {
  width: 1px; height: 6px;
  background: var(--stroke-2);
  margin: 0 auto;
}
.tick-label {
  display: block;
  font-size: 0.58rem;
  color: var(--tx-3);
  margin-top: 2px;
  white-space: nowrap;
}
.band-legend {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: var(--fs-tiny);
  color: var(--tx-3);
}
.d {
  display: inline-block;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--spectrum);
  margin-right: 6px;
}
</style>
