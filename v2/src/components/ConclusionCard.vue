<script setup lang="ts">
import { computed, ref } from "vue";
import { state } from "../state";
import { t, ageText } from "../core/i18n";
import { uAlt, uDist, uClock } from "../core/units";
import { pointCacheAge } from "../core/forecast";
import SkyBand from "./SkyBand.vue";
import FoldNote from "./FoldNote.vue";
import ShareImageButton from "./ShareImageButton.vue";
import ModelCards from "./ModelCards.vue";
import { isForeignTz, tzLabel } from "../core/tz";
import { typeDetail } from "../core/physics";
import { cityName } from "../core/citylang";
import { isNum } from "../core/math";
import { MODEL_ITEMS, conclWord, verdictViewOf, type ModelSel } from "../core/verdict";

const emit = defineEmits<{ refetch: [] }>();

const res = computed(() => state.result);

/* 与地图/趋势同一套「缓存 · N 分钟前 + 重新取数」旁路 */
const cacheAgeMs = computed(() => {
  const r = res.value;
  if (!r || r.src !== "cache") return null;
  return pointCacheAge(r.city.lat, r.city.lon, r.dateStr, r.period);
});

function fmtClock(ms: number | null): string { return ms ? uClock(ms, res.value?.tz) : "—"; }
/* 只在城市时区与浏览器不同时标注，国内城市不多写一行字 */
const tzHint = computed(() => {
  const z = res.value?.tz;
  return z && isForeignTz(z) ? tzLabel(z) : "";
});

/* ---- 多模型切换（并入结论层） ---- */
const modelSel = ref<ModelSel>("ens");
const MK = MODEL_ITEMS;

/* 口径在 core/verdict.ts：切换器选中哪一路，主数字就是哪一路；
   保存图片也吃同一份 view，图上与屏上不会出现两个数。 */
const view = computed(() => {
  const r = res.value;
  return r ? verdictViewOf(r, modelSel.value) : null;
});

/* 火烧云三角几何判定（V1 renderHero 的 {geom} 位）：
   成立一句话；不成立带具体原因 —— 云边界超上限 / 400km 内无可承载云盘。 */
const geomTxt = computed(() => {
  const r = res.value;
  if (!r) return "—";
  const g = r.sRT.geom;
  if (g.ok) return t("火烧云三角几何条件成立");
  return isNum(r.sRT.d)
    ? t("几何条件不成立：云边界距离 {d} 已超过霞光深入距离上限 {m}（该云盘范围内阳光无法从云底下方射入）", {
        d: uDist(r.sRT.d), m: uDist(g.xMax)
      })
    : t("几何条件不成立：日出/日落方向 400 km 内没有找到可承载霞光的云盘");
});
</script>

<template>
  <section id="verdict" class="section">
    <div class="wrap">
      <div class="section-head">
        <h2>{{ t("结论") }}</h2>
        <div class="head-right">
          <ShareImageButton :view="view" />
          <div class="seg" role="group" :aria-label="t('模型')">
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
              <em v-if="view?.single" class="mk-tag">{{ t(view.label) }}</em>
            </div>
            <!-- 与地图/趋势同一套缓存旁路：命中说明来源，真要重取也找得到 -->
            <div v-if="res.src === 'cache' || res.src === 'live'" class="fresh">
              <span class="fresh-t">
                {{ res.src === "cache" ? t("缓存 · {age}前", { age: ageText(cacheAgeMs ?? 0) }) : t("刚刚取数") }}
              </span>
              <button v-if="res.src === 'cache'" class="linkbtn" @click="emit('refetch')">
                {{ t("重新取数") }}
              </button>
            </div>
            <h3 class="v-title glow">
              {{ cityName(res.city.name, state.lang) }} {{ res.dateStr }}
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
                <b>
                  {{ fmtClock(res.evMs) }}
                  <em v-if="tzHint" class="tz-hint" :title="t('当地时间')">{{ tzHint }}</em>
                </b>
              </div>
              <div class="sun-row">
                <span class="k">{{ t("方位角") }}</span>
                <b>{{ res.evAz.toFixed(1) }}°</b>
              </div>
              <div class="sun-row">
                <span class="k">{{ t("云型") }}</span>
                <b>{{ typeDetail(res.sRT.primary.type, res.sRT.decks.map((d) => d.cover)) }}</b>
              </div>
              <div class="sun-row">
                <span class="k">{{ t("云底高度") }}</span>
                <b>{{ uAlt(res.sRT.primary.base * 1000) }}</b>
              </div>
              <div class="sun-row">
                <span class="k">{{ t("几何条件") }}</span>
                <b :class="{ 'geom-no': !res.sRT.geom.ok }">{{ geomTxt }}</b>
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
            <div class="color-strip" aria-hidden="true">
              <i
                v-for="(s, i) in res.sRT.samples"
                :key="i"
                :style="{ background: s.hex, flex: 1 }"
                :title="s.name"
              />
            </div>
            <div class="color-names">
              <span v-for="(s, i) in res.sRT.samples" :key="i">{{ t(s.name) }}</span>
            </div>
          </div>
        </div>

        <!-- 各模型独立结果：四张卡，点任意一张＝切换上方主数字 -->
        <ModelCards v-model="modelSel" :result="res!" />

        <FoldNote fold-key="heroFold" title="说明 · 概率与质量分怎么算">
          <p>{{ t("概率 P 来自多模型的加权几何平均：GFS、ECMWF 与光追物理各给一份，缺哪一路就自动剔除，其余权重不变。") }}</p>
          <p>{{ t("质量分 Q 由云型、云量、云底高度、几何持续与大气通透度共同评分，再换算成等级；它回答「好不好看」，概率回答「有没有」。") }}</p>
          <p>{{ t("可信度看模型分歧 ΔI：分歧越小，综合值越可信；有效模型少于两路时不给分歧值，右上角显示为破折号。ΔI 是三套算法综合指数的极差，ΔP / ΔQ 是出现概率与质量分的极差。") }}</p>
        </FoldNote>
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
  display: flex; justify-content: space-between; gap: 12px;
  font-size: var(--fs-small);
}
/* 标签列钉死不换行：几何条件的长值曾把「几何条件」压成「几何条/件」竖排 */
.sun-row .k { color: var(--tx-3); white-space: nowrap; flex: 0 0 auto; }
/* 几何条件不成立：长原因可换行右对齐，警示色 */
.sun-row b { text-align: right; flex: 1 1 auto; min-width: 0; }
.sun-row .geom-no { color: var(--q-bad, #c2603a); font-weight: 600; }
/* 城市时区与本机不同时的小标注（UTC+9 / UTC−4） */
.sun-row .tz-hint {
  font-style: normal;
  font-size: var(--fs-tiny);
  font-weight: 500;
  color: var(--tx-3);
  margin-left: 6px;
  letter-spacing: 0.02em;
}
/* 模型对照小表已升级为卡片网格（ModelCards.vue），这里只留色彩条 */
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
/* 缓存来源小字 + 「重新取数」文字入口（与地图/趋势同一套） */
.fresh {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: var(--fs-tiny);
  color: var(--tx-3);
}
.linkbtn {
  font-size: var(--fs-tiny);
  color: var(--acc-2);
  text-decoration: underline;
  text-underline-offset: 3px;
  padding: 2px 4px;
  border-radius: var(--r-sm);
}
.linkbtn:hover { color: var(--acc-1); }
.linkbtn:disabled { opacity: 0.5; }
@media (max-width: 720px) {
  .v-grid { grid-template-columns: repeat(2, 1fr); }
  .seg { flex-wrap: wrap; }
  /* 标题右侧多了「保存图片」图标，窄屏放不下时整组下移，别把标题挤掉 */
  .section-head { flex-wrap: wrap; row-gap: 8px; }
  .head-right { flex-wrap: wrap; }
}
</style>
