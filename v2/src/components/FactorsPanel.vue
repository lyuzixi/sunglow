<script setup lang="ts">
import { computed } from "vue";
import { state, toggleFold } from "../state";
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
        <!-- 13 项卡很长，默认收起（factorsFold 默认 true，手点后写偏好记忆）。
             按钮与光追 / 附注的整卡胶囊同款，点目录里的「影响因素」也会就地展开。 -->
        <div class="fac-head">
          <span class="sub">{{ t("13 项判据") }} · {{ t("算法说明") }}</span>
          <button
            class="btn btn-ghost sm fac-fold"
            :aria-expanded="!state.folds.factorsFold"
            aria-controls="factors-body"
            @click="toggleFold('factorsFold')"
          >
            {{ state.folds.factorsFold ? t("展开") : t("收起") }}
          </button>
        </div>
      </div>

      <div v-show="!state.folds.factorsFold" id="factors-body">
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
    </div>
  </section>
</template>

<style scoped>
/* 标题行右侧：副标题 + 折叠胶囊；窄屏让整行换行，别把标题挤成竖排 */
.fac-head { display: flex; align-items: center; gap: 10px; }
@media (max-width: 720px) {
  .section-head { flex-wrap: wrap; row-gap: 8px; }
}
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
