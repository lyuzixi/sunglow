<script setup lang="ts">
import { computed, ref } from "vue";
import { state } from "../state";
import { t } from "../core/i18n";
import { uAlt, uDist, uClock } from "../core/units";
import { gradeOf } from "../core/scoring";
import { isNum } from "../core/math";
import SkyBand from "./SkyBand.vue";

const res = computed(() => state.result);

function conclWord(p: number): string {
  if (p >= 70) return "大概率出现";
  if (p >= 45) return "值得期待";
  if (p >= 25) return "可以一试";
  return "希望不大";
}
function fmtClock(ms: number | null): string { return ms ? uClock(ms) : "—"; }

/* ---- 多模型切换（并入结论层） ---- */
type Mk = "ens" | "gfs" | "ec" | "rt";
const modelSel = ref<Mk>("ens");
const MK: Array<{ id: Mk; label: string }> = [
  { id: "ens", label: "多模型综合" },
  { id: "gfs", label: "GFS" },
  { id: "ec", label: "ECMWF" },
  { id: "rt", label: "光追" }
];

const view = computed(() => {
  const r = res.value;
  if (!r) return null;
  if (modelSel.value === "ens") {
    return { P: r.P, Q: r.Q, grade: r.grade, label: t("多模型综合"), single: false };
  }
  const m = r.models.find((x) => x.id === modelSel.value);
  if (!m || !isNum(m.P)) {
    return { P: r.P, Q: r.Q, grade: r.grade, label: t("多模型综合"), single: false };
  }
  return { P: m.P, Q: m.Q, grade: gradeOf(m.Q), label: t(m.label), single: true };
});

const modelRows = computed(() => {
  const r = res.value;
  if (!r) return [];
  return r.models.map((m) => ({ id: m.id, label: t(m.label), P: m.P, Q: m.Q }));
});
</script>

<template>
  <section id="verdict" class="section">
    <div class="wrap">
      <div class="section-head">
        <h2>{{ t("结论") }}</h2>
        <div class="head-right">
          <div class="seg" role="group" aria-label="模型">
            <button
              v-for="m in MK"
              :key="m.id"
              :class="{ on: modelSel === m.id }"
              @click="modelSel = m.id"
            >
              {{ t(m.label) }}
            </button>
          </div>
        </div>
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
        <!-- 天色带：合并进结论层，置于结论内容上方 -->
        <SkyBand />

        <div class="v-body">
          <div class="v-left">
            <div class="pill" :style="{ color: res.conf.dark.color, borderColor: res.conf.dark.bd, background: res.conf.dark.bg }">
              {{ t("可信度") }} {{ t(res.conf.lv) }} · {{ t(res.conf.txt) }}
              <em v-if="view?.single" class="mk-tag">{{ view.label }}</em>
            </div>
            <h3 class="v-title glow">
              {{ res.city.name }} {{ res.dateStr }}
              {{ res.period === "am" ? t("朝霞") : t("晚霞") }}
              <span class="spectrum-text">{{ t(conclWord(view!.P)) }}</span>
            </h3>
            <p class="v-desc">
              {{ t("概率") }} <b>{{ Math.round(view!.P) }}%</b>，
              {{ t("观赏质量") }} <b>{{ Math.round(view!.Q) }}</b> 分 ·
              {{ t("等级") }} <b>{{ t(view!.grade) }}</b>。
              {{ t(res.conf.hint) }}
            </p>

            <div class="v-grid">
              <div class="metric">
                <span class="num" :style="{ color: 'var(--acc-1)' }">{{ Math.round(view!.P) }}%</span>
                <span class="lab">{{ t("出现概率") }}</span>
              </div>
              <div class="metric">
                <span class="num" :style="{ color: 'var(--acc-2)' }">{{ Math.round(view!.Q) }}</span>
                <span class="lab">{{ t("观赏质量") }}</span>
              </div>
              <div class="metric">
                <span class="num" :style="{ color: 'var(--acc-3)' }">{{ t(view!.grade) }}</span>
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
                <span class="k">{{ t(res.evName) }}</span>
                <b>{{ fmtClock(res.evMs) }}</b>
              </div>
              <div class="sun-row">
                <span class="k">{{ t("方位角") }}</span>
                <b>{{ res.evAz.toFixed(1) }}°</b>
              </div>
              <div class="sun-row">
                <span class="k">{{ t("云型") }}</span>
                <b>{{ t(res.sRT.primary.type) }} · {{ t(res.sRT.primary.name) }}</b>
              </div>
              <div class="sun-row">
                <span class="k">{{ t("云底高度") }}</span>
                <b>{{ uAlt(res.sRT.primary.base * 1000) }}</b>
              </div>
              <div class="sun-row">
                <span class="k">{{ t("持续时间") }}</span>
                <b>{{ Math.round(res.sRT.geom.dur) }} {{ t("分钟") }}</b>
              </div>
              <div class="sun-row">
                <span class="k">{{ t("能见度") }}</span>
                <b>{{ uDist(res.envM.vis ? res.envM.vis / 1000 : null, 1) }}</b>
              </div>
            </div>

            <!-- 多模型横向对比（切换器改变的是本卡主数字；这里给全量对照） -->
            <div class="mtable" role="table" :aria-label="t('模式对比')">
              <div class="mtr mth">
                <span>{{ t("模型") }}</span>
                <span>{{ t("出现概率") }}</span>
                <span>{{ t("观赏质量") }}</span>
              </div>
              <button
                v-for="m in modelRows"
                :key="m.id"
                class="mtr mrow"
                :class="{ on: modelSel === m.id }"
                @click="modelSel = m.id as Mk"
              >
                <span>{{ m.label }}</span>
                <span>{{ Math.round(m.P) }}%</span>
                <span>{{ Math.round(m.Q) }}</span>
              </button>
              <button
                class="mtr mrow ens"
                :class="{ on: modelSel === 'ens' }"
                @click="modelSel = 'ens'"
              >
                <span>{{ t("综合") }}</span>
                <span>{{ Math.round(res.P) }}%</span>
                <span>{{ Math.round(res.Q) }}</span>
              </button>
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
.head-right { display: flex; align-items: center; gap: 10px; }
.seg {
  display: inline-flex;
  padding: 3px;
  border-radius: var(--r-full);
  border: 1px solid var(--stroke-2);
  background: var(--bg-glass);
}
.seg button {
  padding: 5px 12px;
  border-radius: var(--r-full);
  font-size: var(--fs-tiny);
  color: var(--tx-2);
}
.seg button.on {
  background: var(--spectrum);
  color: var(--tx-inv);
  font-weight: 600;
}
.verdict-card {
  padding: clamp(20px, 3.4vw, 34px) 26px;
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
.v-body {
  display: grid;
  gap: 26px;
  align-items: center;
}
@media (min-width: 900px) {
  .v-body { grid-template-columns: 1.35fr 1fr; }
}
.mk-tag {
  margin-left: 8px;
  font-style: normal;
  font-weight: 600;
  opacity: 0.85;
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
/* 模型对照 */
.mtable {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--stroke);
  display: grid;
  gap: 2px;
}
.mtr {
  display: grid;
  grid-template-columns: 1fr 62px 62px;
  gap: 8px;
  align-items: center;
  padding: 5px 6px;
  border-radius: 6px;
  font-size: var(--fs-tiny);
  color: var(--tx-2);
  text-align: right;
}
.mth { color: var(--tx-3); padding-bottom: 2px; }
.mth span:first-child, .mtr span:first-child { text-align: left; }
.mrow {
  border: 0;
  background: transparent;
  cursor: pointer;
  width: 100%;
}
.mrow:hover { background: var(--bg-glass-2); }
.mrow.on {
  background: var(--bg-glass-2);
  color: var(--tx-1);
  font-weight: 600;
  box-shadow: inset 0 0 0 1px var(--stroke-2);
}
.mrow.ens { color: var(--tx-1); }
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
@media (max-width: 720px) {
  .v-grid { grid-template-columns: repeat(2, 1fr); }
  .seg { flex-wrap: wrap; }
}
</style>
