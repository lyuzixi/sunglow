<script setup lang="ts">
import { computed } from "vue";
import { state } from "../state";
import { t } from "../core/i18n";

const res = computed(() => state.result);

function conclWord(p: number): string {
  if (p >= 70) return "大概率出现";
  if (p >= 45) return "值得期待";
  if (p >= 25) return "可以一试";
  return "希望不大";
}
function fmtClock(ms: number | null): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
</script>

<template>
  <section id="verdict" class="section">
    <div class="wrap">
      <div class="section-head">
        <h2>{{ t("结论") }}</h2>
        <div class="sub">{{ t("多模型综合") }}</div>
      </div>

      <div v-if="state.error" class="glass" style="padding: 18px 22px; color: var(--q-bad)">
        {{ state.error }}
      </div>

      <div v-else-if="!res" class="glass empty">
        <div class="empty-ring" />
        <p v-if="state.loading">{{ t("加载中") }}……</p>
        <p v-else>{{ t("暂无数据") }} —— {{ t("开始观测") }}，点击「{{ t("计算") }}」。</p>
      </div>

      <div v-else class="glass verdict-card anim-rise">
        <div class="v-left">
          <div class="pill" :style="{ color: res.conf.dark.color, borderColor: res.conf.dark.bd, background: res.conf.dark.bg }">
            {{ t("可信度") }} {{ res.conf.lv }} · {{ res.conf.txt }}
          </div>
          <h3 class="v-title glow">
            {{ res.city.name }} {{ res.dateStr }}
            {{ res.period === "am" ? t("朝霞") : t("晚霞") }}
            <span class="spectrum-text">{{ conclWord(res.P) }}</span>
          </h3>
          <p class="v-desc">
            {{ t("概率") }} <b>{{ Math.round(res.P) }}%</b>，
            {{ t("观赏质量") }} <b>{{ Math.round(res.Q) }}</b> 分 ·
            {{ t("等级") }} <b>{{ res.grade }}</b>。
            {{ res.conf.hint }}
          </p>

          <div class="v-grid">
            <div class="metric">
              <span class="num" :style="{ color: 'var(--acc-1)' }">{{ Math.round(res.P) }}%</span>
              <span class="lab">{{ t("出现概率") }}</span>
            </div>
            <div class="metric">
              <span class="num" :style="{ color: 'var(--acc-2)' }">{{ Math.round(res.Q) }}</span>
              <span class="lab">{{ t("观赏质量") }}</span>
            </div>
            <div class="metric">
              <span class="num" :style="{ color: 'var(--acc-3)' }">{{ res.grade }}</span>
              <span class="lab">{{ t("等级") }}</span>
            </div>
            <div class="metric">
              <span class="num" style="color: var(--tx-2)">
                {{ res.dvI != null ? res.dvI.toFixed(1) : "—" }}
              </span>
              <span class="lab">{{ t("可信度") }}</span>
            </div>
          </div>
        </div>

        <div class="v-right">
          <div class="sun-rows">
            <div class="sun-row">
              <span class="k">{{ res.evName }}</span>
              <b>{{ fmtClock(res.evMs) }}</b>
            </div>
            <div class="sun-row">
              <span class="k">{{ t("方位角") }}</span>
              <b>{{ res.evAz.toFixed(1) }}°</b>
            </div>
            <div class="sun-row">
              <span class="k">{{ t("云型") }}</span>
              <b>{{ res.sRT.primary.type }} · {{ res.sRT.primary.name }}</b>
            </div>
            <div class="sun-row">
              <span class="k">{{ t("云底高度") }}</span>
              <b>{{ res.sRT.primary.base.toFixed(2) }} km</b>
            </div>
            <div class="sun-row">
              <span class="k">{{ t("持续时间") }}</span>
              <b>{{ Math.round(res.sRT.geom.dur) }} {{ t("分钟") }}</b>
            </div>
            <div class="sun-row">
              <span class="k">{{ t("能见度") }}</span>
              <b>{{ res.envM.vis ? (res.envM.vis / 1000).toFixed(1) : "—" }} km</b>
            </div>
          </div>
          <div class="color-strip" aria-hidden="true">
            <i
              v-for="(s, i) in res.sRT.samples"
              :key="i"
              :style="{ background: s.hex, flex: 1 }"
              :title="s.name"
            />
          </div>
          <div class="color-names">
            <span v-for="(s, i) in res.sRT.samples" :key="i">{{ s.name }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.empty {
  padding: 48px 24px;
  text-align: center;
  color: var(--tx-2);
  position: relative;
  overflow: hidden;
}
.empty-ring {
  width: 90px; height: 90px;
  margin: 0 auto 16px;
  border-radius: 50%;
  border: 1px dashed var(--stroke-2);
  background: radial-gradient(circle, rgba(46, 213, 232, 0.12), transparent 70%);
}
.verdict-card {
  display: grid;
  gap: 26px;
  padding: clamp(20px, 3.4vw, 34px);
  position: relative;
  overflow: hidden;
}
.verdict-card::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 2px;
  background: var(--spectrum);
  opacity: 0.8;
}
@media (min-width: 900px) {
  .verdict-card { grid-template-columns: 1.35fr 1fr; align-items: center; }
}
.v-title {
  font-size: clamp(1.35rem, 2.6vw, 1.95rem);
  margin: 14px 0 10px;
}
.v-desc {
  color: var(--tx-2);
  margin: 0 0 22px;
  font-size: 1.02rem;
}
.v-desc b { color: var(--tx-1); }
.v-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}
.v-right {
  padding: 18px;
  border-radius: var(--r-md);
  background: var(--bg-glass);
  border: 1px solid var(--stroke);
}
.sun-rows { display: grid; gap: 9px; }
.sun-row {
  display: flex; justify-content: space-between;
  font-size: var(--fs-small);
}
.sun-row .k { color: var(--tx-3); }
.color-strip {
  display: flex;
  height: 14px;
  border-radius: var(--r-full);
  overflow: hidden;
  margin-top: 16px;
  border: 1px solid var(--stroke);
}
.color-names {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 0.62rem;
  color: var(--tx-3);
}
</style>
