<script setup lang="ts">
import { computed, ref } from "vue";
import { state } from "../state";
import { t } from "../core/i18n";
import {
  calibRead, calibSave, calibSet, calibFind, calibStats, calibCanAnnotate,
  CALIB_MIN_N, CALIB_MIN_BUCKET,
  type CalibRow
} from "../core/calib";

const rows = ref<CalibRow[]>(calibRead());
const res = computed(() => state.result);

const canAnnotate = computed(
  () => state.calibOn && res.value && calibCanAnnotate(res.value.leadH)
);
const existing = computed(() => {
  const r = res.value;
  if (!r) return null;
  return calibFind(rows.value, r.city.lat, r.city.lon, r.dateStr, r.period);
});
const stats = computed(() => {
  const r = res.value;
  if (!r) return null;
  return calibStats(rows.value, r.city.lat, r.city.lon, r.P);
});

function mark(a: number) {
  const r = res.value;
  if (!r) return;
  const rec = calibSet(
    rows.value,
    r.city.lat, r.city.lon, r.dateStr, r.period,
    r.P, r.Q, a
  );
  if (rec) rows.value = calibRead();
}
function clearAll() {
  calibSave([]);
  rows.value = [];
}
</script>

<template>
  <section id="calib" class="section">
    <div class="wrap">
      <div class="section-head">
        <h2>{{ t("实况校准") }}</h2>
        <div class="sub">
          CALIB_MIN_N={{ CALIB_MIN_N }} · CALIB_MIN_BUCKET={{ CALIB_MIN_BUCKET }}
        </div>
      </div>

      <div class="glass calib-card">
        <div class="calib-switch">
          <span>{{ state.calibOn ? t("开启校准") : t("关闭校准") }}</span>
          <button
            class="sw"
            :class="{ on: state.calibOn }"
            role="switch"
            :aria-checked="state.calibOn"
            @click="state.calibOn = !state.calibOn"
          >
            <i />
          </button>
          <button class="btn btn-ghost" style="margin-left: auto" @click="clearAll">
            {{ t("清除全部") }}
          </button>
        </div>

        <div v-if="canAnnotate && res" class="marks">
          <button
            v-for="m in ([
              { a: 2, label: t('看到了'), c: 'var(--q-good)' },
              { a: 0, label: t('没有看到'), c: 'var(--q-bad)' },
              { a: -1, label: t('无法判断'), c: 'var(--tx-3)' }
            ] as const)"
            :key="m.a"
            class="btn"
            :class="{ 'btn-primary': existing?.a === m.a }"
            @click="mark(m.a)"
          >
            {{ m.label }}
          </button>
        </div>
        <div v-else class="hint">
          {{ state.calibOn ? t("样本不足") + " · " + t("暂无数据") : t("关闭校准") }}
        </div>

        <div v-if="stats" class="stats">
          <div class="metric">
            <span class="num" style="font-size: 1.35rem">{{ stats.nAll }}</span>
            <span class="lab">总样本</span>
          </div>
          <div class="metric">
            <span class="num" style="font-size: 1.35rem">{{ stats.nBucket }}</span>
            <span class="lab">本档样本</span>
          </div>
          <div class="metric">
            <span class="num" style="font-size: 1.35rem">
              {{ stats.enough && stats.delta != null ? (stats.delta > 0 ? "+" : "") + stats.delta.toFixed(1) : "—" }}
            </span>
            <span class="lab">偏差</span>
          </div>
          <div class="metric">
            <span class="num" style="font-size: 1.35rem">
              {{ stats.enough ? "✓" : "…" }}
            </span>
            <span class="lab">{{ stats.enough ? "可校准" : t("样本不足") }}</span>
          </div>
        </div>

        <p class="note">
          校准仅在本机展示（glowcast.v2.calib），不会回改预报模型。
          事件结束 1 小时后才可标注；同一地点同一时段只保留一条记录。
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.calib-card { padding: 20px 22px; }
.calib-switch {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  color: var(--tx-2);
  font-size: var(--fs-small);
}
.sw {
  width: 42px; height: 24px;
  border-radius: var(--r-full);
  border: 1px solid var(--stroke-2);
  background: var(--bg-glass-2);
  position: relative;
  transition: all var(--t-fast);
}
.sw i {
  position: absolute;
  top: 2px; left: 2px;
  width: 18px; height: 18px;
  border-radius: 50%;
  background: var(--tx-3);
  transition: all var(--t-fast) var(--ease-out);
}
.sw.on {
  background: var(--spectrum);
  border-color: transparent;
}
.sw.on i {
  left: 20px;
  background: #fff;
}
.marks {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.hint {
  color: var(--tx-3);
  font-size: var(--fs-small);
}
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--stroke);
}
.note {
  margin: 16px 0 0;
  color: var(--tx-3);
  font-size: var(--fs-tiny);
  line-height: 1.7;
}
</style>
