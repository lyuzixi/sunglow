<script setup lang="ts">
import { computed } from "vue";
import { state, setDate, setPeriod } from "../state";
import { t } from "../core/i18n";
import { dayCells, bestSlots } from "../core/suggest";
import { clamp } from "../core/math";
import { mixedIndex } from "../core/scoring";

const cells = computed(() => {
  const tr = state.trend;
  if (!tr || !tr.rows) return [];
  return dayCells(tr.rows);
});

const best = computed(() => {
  const tr = state.trend;
  if (!tr || !tr.rows) return [];
  return bestSlots(tr.rows, 3);
});

const WD = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function fmtDate(ds: string): { md: string; wd: string } {
  const [Y, M, D] = ds.split("-").map(Number);
  const d = new Date(Date.UTC(Y, M - 1, D));
  return {
    md: `${M}/${D}`,
    wd: t(WD[d.getUTCDay()])
  };
}
function cellI(c: { I: number }): number {
  return clamp(c.I < 0 ? 0 : c.I, 0, 100);
}
function slotH(cell: { P: number; Q: number } | null): string {
  if (!cell) return "2px";
  const v = clamp(mixedIndex(cell.P, cell.Q), 0, 100);
  return (v * 0.2 + 2) + "px";
}
function pick(ds: string, per: "am" | "pm") {
  setDate(ds);
  setPeriod(per);
}
</script>

<template>
  <section id="cal" class="wing order-cal">
    <div class="panel-h">
      <h2>{{ t("机会日历") }}</h2>
      <span class="sub">7D</span>
    </div>

    <div v-if="state.trendLoading" class="cal-note">{{ t("正在取数") }}…</div>
    <div v-else-if="!cells.length" class="cal-note">{{ t("暂无数据") }}</div>

    <div v-else class="cal-grid">
      <button
        v-for="c in cells"
        :key="c.dateS"
        class="cal-day"
        :class="{ on: c.dateS === state.dateStr, best: best.some(b => b.dateS === c.dateS) }"
        @click="pick(c.dateS, c.bestPeriod || state.period)"
      >
        <span class="d">
          <b>{{ fmtDate(c.dateS).md }}</b>{{ fmtDate(c.dateS).wd }}
        </span>
        <span class="bar">
          <i :class="{ hi: !!c.am }" :style="{ height: slotH(c.am) }" />
          <i :class="{ hi: !!c.pm }" :style="{ height: slotH(c.pm) }" />
        </span>
        <span class="v">{{ Math.round(cellI(c)) }}</span>
      </button>
    </div>

    <p v-if="best.length" class="cal-note">
      {{ t("最值得去") }}：<b v-for="(b, i) in best" :key="b.dateS + b.period">
        {{ fmtDate(b.dateS).md }} {{ b.period === "am" ? t("朝霞") : t("晚霞") }}<template v-if="i < best.length - 1">、</template>
      </b>
    </p>
    <p class="cal-note">{{ t("点格子切到那天的时段") }}</p>
  </section>
</template>
