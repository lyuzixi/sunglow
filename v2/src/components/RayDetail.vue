<script setup lang="ts">
/* 光追算法细节卡：把 sRT 里已经算出来、但结论卡没地方摆的中间量摊开。
   数据全部来自 state.result.sRT，不新增任何取数。 */
import { computed } from "vue";
import { state } from "../state";
import { t } from "../core/i18n";
import { uAlt, uDist } from "../core/units";
import FoldCard from "./FoldCard.vue";

const res = computed(() => state.result);

const rows = computed(() => {
  const r = res.value;
  if (!r) return [];
  const s = r.sRT;
  return [
    { k: "主云型", v: `${t(s.primary.type)} · ${t(s.primary.name)}` },
    { k: "云底高度", v: uAlt(s.primary.base * 1000) },
    { k: "云量", v: `${Math.round(s.primary.cover)}%` },
    { k: "视线距离", v: uDist(s.d, 0) },
    { k: "几何窗口", v: `${Math.round(s.geom.dur)} ${t("分钟")}` },
    { k: "亮度等级", v: t(s.bright.txt) }
  ];
});

const facs = computed(() => {
  const r = res.value;
  if (!r) return [];
  const s = r.sRT;
  return [
    { k: "几何", v: s.geomF },
    { k: "云量", v: s.coverF },
    { k: "通透度", v: s.aeroF }
  ];
});
</script>

<template>
  <FoldCard fold-key="rayFold" anchor="ray" title="光追算法细节" :sub="t('来自同一份取数结果，不额外请求')">
    <p v-if="!res" class="hint">{{ t("先计算一次预报，这里才会出现光追推导的中间量。") }}</p>
    <template v-else>
      <dl class="rd-grid">
        <div v-for="r in rows" :key="r.k" class="rd-item">
          <dt>{{ t(r.k) }}</dt>
          <dd>{{ r.v }}</dd>
        </div>
      </dl>

      <div class="rd-facs">
        <div v-for="f in facs" :key="f.k" class="rd-fac">
          <span class="rd-k">{{ t(f.k) }}</span>
          <i><em :style="{ width: Math.round(f.v * 100) + '%' }" /></i>
          <b>{{ Math.round(f.v * 100) }}%</b>
        </div>
      </div>

      <p class="rd-note">
        {{ t("光追模型沿太阳方位逐层追踪光线穿过云层的路径：几何窗口决定「能亮多久」，云量与通透度决定「能亮多好」，三者在综合分里加权。") }}
      </p>
    </template>
  </FoldCard>
</template>

<style scoped>
.hint { margin: 0; color: var(--tx-3); font-size: var(--fs-small); }
.rd-grid {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px 18px;
}
.rd-item { display: flex; flex-direction: column; gap: 2px; }
.rd-item dt { font-size: var(--fs-tiny); color: var(--tx-3); letter-spacing: 0.04em; }
.rd-item dd { margin: 0; font-size: var(--fs-small); color: var(--tx-1); }
.rd-facs { margin-top: 16px; display: grid; gap: 8px; }
.rd-fac {
  display: grid;
  grid-template-columns: 56px 1fr 40px;
  align-items: center;
  gap: 10px;
  font-size: var(--fs-tiny);
  color: var(--tx-3);
}
.rd-fac i {
  display: block;
  height: 5px;
  border-radius: 3px;
  background: var(--bg-glass-2);
  overflow: hidden;
}
.rd-fac em { display: block; height: 100%; background: var(--spectrum); }
.rd-fac b { font-weight: 500; color: var(--tx-2); text-align: right; }
.rd-note {
  margin: 16px 0 0;
  font-size: var(--fs-tiny);
  line-height: 1.8;
  color: var(--tx-3);
}
</style>
