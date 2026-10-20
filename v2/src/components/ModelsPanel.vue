<script setup lang="ts">
import { computed } from "vue";
import { state } from "../state";
import { t } from "../core/i18n";
import { rampColor } from "../core/ramp";

const res = computed(() => state.result);
</script>

<template>
  <section id="models" class="section">
    <div class="wrap">
      <div class="section-head">
        <h2>{{ t("模式对比") }}</h2>
        <div class="sub">GFS · ECMWF · {{ t("光谱分析") }}</div>
      </div>

      <div class="glass">
        <table class="data" v-if="res">
          <thead>
            <tr>
              <th>{{ t("模型") }}</th>
              <th>{{ t("出现概率") }}</th>
              <th>{{ t("观赏质量") }}</th>
              <th style="width: 34%">—</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in res.models" :key="m.id">
              <td>
                <b>{{ t(m.label) }}</b>
              </td>
              <td>
                <span :style="{ color: rampColor(m.P), fontWeight: 600 }">
                  {{ Math.round(m.P) }}%
                </span>
              </td>
              <td>
                <span :style="{ color: rampColor(m.Q), fontWeight: 600 }">
                  {{ Math.round(m.Q) }}
                </span>
              </td>
              <td>
                <div class="bar">
                  <i :style="{ width: m.P + '%' }" />
                </div>
              </td>
            </tr>
            <tr style="background: var(--bg-glass)">
              <td><b>{{ t("综合") }}</b></td>
              <td><b :style="{ color: rampColor(res.P) }">{{ Math.round(res.P) }}%</b></td>
              <td><b :style="{ color: rampColor(res.Q) }">{{ Math.round(res.Q) }}</b></td>
              <td>
                <div class="bar">
                  <i :style="{ width: res.P + '%' }" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="pad">{{ state.loading ? t("加载中") + "…" : t("暂无数据") }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.pad { padding: 24px; color: var(--tx-3); }
</style>
