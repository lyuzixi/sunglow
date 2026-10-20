<script setup lang="ts">
import { computed } from "vue";
import { state } from "../state";
import { t } from "../core/i18n";
import { clamp, isNum } from "../core/math";

const r = computed(() => state.result);

const dv = computed(() => (r.value && isNum(r.value.dvI) ? r.value.dvI : null));
const conf = computed(() => r.value?.conf ?? null);
const dvPct = computed(() => (dv.value == null ? 50 : clamp(100 - dv.value * 1.9, 0, 100)));

const rows = computed(() => r.value?.models ?? []);
</script>

<template>
  <section id="conf" class="wing order-conf">
    <div class="panel-h">
      <h2>{{ t("可信度") }}</h2>
      <span class="sub">DV·ENS</span>
    </div>

    <div class="conf-block">
      <div class="conf-lab">
        <span>{{ t("模型分歧") }}</span>
        <b>{{ dv == null ? "—" : Math.round(dv) }}</b>
      </div>
      <div class="meter" :class="{ warn: (dv ?? 0) > 35 }">
        <i :style="{ width: dvPct + '%' }" />
      </div>
      <p class="conf-hint">
        {{ t("三套算法") }} mixedIndex 极差 ·
        <span v-if="conf" class="badge-conf" :class="conf.key">{{ t("可信度") }} {{ t(conf.lv) }}</span>
      </p>
    </div>

    <div class="conf-block">
      <div class="conf-lab"><span>{{ t("模型") }}</span><b>P / Q / I</b></div>
      <table class="model-rows">
        <thead>
          <tr><th></th><th>P</th><th>Q</th><th>I</th></tr>
        </thead>
        <tbody>
          <tr v-for="m in rows" :key="m.id">
            <td>{{ m.label }}</td>
            <td class="v">{{ Math.round(m.P) }}</td>
            <td class="v">{{ Math.round(m.Q) }}</td>
            <td class="v">{{ Math.round(m.I) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="conf-block">
      <div class="conf-lab"><span>{{ t("一致性") }}</span><b>{{ r ? Math.round(r.consist) : "—" }}%</b></div>
      <div class="meter"><i :style="{ width: (r ? r.consist : 0) + '%' }" /></div>
      <p v-if="conf" class="conf-hint">{{ conf.txt }}{{ conf.hint }}</p>
      <p v-if="r && r.src === 'mock'" class="conf-hint" style="color: var(--coral)">
        {{ t("网络不可用，已回落到确定性演示数据") }}
      </p>
    </div>

    <div class="conf-block">
      <div class="conf-lab"><span>{{ t("校准档案") }}</span><b>—</b></div>
      <p class="conf-hint">{{ t("敬请期待") }}（二期）</p>
    </div>
  </section>
</template>
