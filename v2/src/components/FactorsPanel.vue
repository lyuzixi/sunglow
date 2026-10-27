<script setup lang="ts">
import { computed } from "vue";
import { state } from "../state";
import { t } from "../core/i18n";
import { facDisplayRows } from "../core/factors";

const res = computed(() => state.result);

/* 13 项因素（键与 SNAP_KEYS 同源；数值/判定/长文案口径唯一来源是 core/factors.ts） */
const rows = computed(() => {
  const r = res.value;
  return r ? facDisplayRows(r) : [];
});

function tone(s: number | null): string {
  if (s == null) return "var(--tx-3)";
  if (s >= 0.7) return "var(--q-good)";
  if (s >= 0.4) return "var(--q-mid)";
  return "var(--q-bad)";
}
</script>

<template>
  <section id="factors" class="section">
    <div class="wrap">
      <div class="section-head">
        <h2>{{ t("影响因素") }}</h2>
        <div class="sub">{{ t("13 项判据") }} · {{ t("算法说明") }}</div>
      </div>

      <div class="grid grid-2" v-if="rows.length">
        <div v-for="f in rows" :key="f.key" class="glass fac-card" :data-fkey="f.key">
          <div class="fac-top">
            <b>{{ f.name }}</b>
            <span class="fac-right">
              <em class="fj" :class="f.judgeCls">{{ f.judge }}</em>
              <span class="fac-score" :style="{ color: tone(f.score) }">
                {{ f.score != null ? Math.round(f.score * 100) : "—" }}
              </span>
            </span>
          </div>
          <div class="fac-val">{{ f.val }}</div>
          <div class="bar"><i :style="{ width: (f.score != null ? f.score * 100 : 0) + '%' }" /></div>
          <p>{{ f.desc }}</p>
        </div>
      </div>
      <div v-else class="glass" style="padding: 24px; color: var(--tx-3)">
        {{ state.loading ? t("加载中") + "…" : t("暂无数据") }}
      </div>
    </div>
  </section>
</template>

<style scoped>
.fac-card {
  padding: 18px 20px;
}
.fac-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 6px;
}
.fac-top b { font-size: var(--fs-body); }
.fac-right {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-shrink: 0;
}
.fac-score {
  font-family: var(--font-display);
  font-size: 1.35rem;
  font-weight: 600;
}
/* 判定 pill：有利 / 中性 / 不利 / 数据缺失（颜色随分档，深浅主题都可读） */
.fj {
  font-style: normal;
  font-size: var(--fs-tiny);
  line-height: 1.6;
  padding: 1px 9px;
  border-radius: 999px;
  border: 1px solid currentColor;
  white-space: nowrap;
}
.j-ok { color: var(--q-good); }
.j-mid { color: var(--q-mid); }
.j-bad { color: var(--q-bad); }
.j-miss { color: var(--tx-3); }
.fac-val {
  color: var(--tx-2);
  font-size: var(--fs-small);
  margin-bottom: 10px;
  font-variant-numeric: tabular-nums;
}
.fac-card p {
  margin: 10px 0 0;
  color: var(--tx-3);
  font-size: var(--fs-small);
}
</style>
