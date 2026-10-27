<script setup lang="ts">
/* =========================================================================
   各模型独立结果（V1 2×2 卡的同位复刻）
   · 数据全部取自 result 里已有的 sG / sE / sRT 三份评分结果 —— 不新增取数、
     不改缓存结构；综合卡用同一份 P/Q/ΔI 口径，只是换个摆法
   · 点任意一张卡＝把上方结论切到该模型（与标题右侧切换器共用同一个 modelSel）
   · ≤720px 单列堆叠，事实行不截断
   ========================================================================= */
import { computed } from "vue";
import { t } from "../core/i18n";
import { uAlt, uDist } from "../core/units";
import { isNum } from "../core/math";
import { gradeOf, mixedIndex, QUALITY_BANDS } from "../core/scoring";
import { isDark } from "../state";
import type { ForecastResult } from "../core/forecast";
import type { ModelSel } from "../core/verdict";

const props = defineProps<{ result: ForecastResult }>();
const sel = defineModel<ModelSel>({ required: true });

const r = computed(() => props.result);

const COLOR: Record<string, string> = {
  ens: "#BA7517",
  gfs: "#378ADD",
  ec: "#1D9E75",
  rt: "#D85A30"
};

interface Fact { k: string; v: string }
interface Card {
  id: ModelSel;
  name: string;
  sub: string;
  P: number;
  Q: number;
  grade: string;
  facts: Fact[];
  missing?: boolean;
}

/** 等级胶囊：取 QUALITY_BANDS 的按主题配色，底色用同一色的低透明度 */
function band(grade: string) {
  const b = QUALITY_BANDS.find((x) => x.key === grade) || QUALITY_BANDS[QUALITY_BANDS.length - 1];
  const c = isDark.value ? b.dark : b.color;
  return { color: c, background: c + "1f", borderColor: c + "4d" };
}

const cards = computed<Card[]>(() => {
  const res = r.value;
  const out: Card[] = [];

  /* ① 多模型综合（与切换器同序，先总后分） */
  out.push({
    id: "ens",
    name: "多模型综合",
    sub: "GFS 30% + EC 34% + 光追 36%",
    P: res.P,
    Q: res.Q,
    grade: res.grade,
    facts: [
      { k: "可信度", v: t(res.conf.lv) },
      { k: "ΔI", v: res.dvI != null ? String(Math.round(res.dvI)) : "—" },
      { k: "ΔP", v: res.spread != null ? String(Math.round(res.spread)) : "—" },
      { k: "ΔQ", v: res.spreadQ != null ? String(Math.round(res.spreadQ)) : "—" },
      { k: "等级", v: t(res.grade) },
      {
        k: "时效",
        v: res.leadH > 0 ? Math.round(res.leadH) + " " + t("小时") : t("实况/历史")
      },
      { k: "综合指数", v: String(Math.round(mixedIndex(res.P, res.Q))) }
    ]
  });

  /* ② GFS 统计 */
  const g = res.sG;
  out.push({
    id: "gfs",
    name: "GFS 模式",
    sub: "NOAA 全球模式 · 1 小时分辨率",
    P: g.P,
    Q: g.Q,
    grade: gradeOf(g.Q),
    facts: [
      { k: "云型", v: t(g.primary.type) },
      { k: "主云量", v: Math.round(g.primary.cover) + "%" },
      { k: "云底高度", v: uAlt(g.primary.base * 1000) },
      { k: "云边界", v: isNum(g.d) ? uDist(g.d) : t("无明显边界") },
      { k: "等效云底", v: uDist(g.hEff, 2) },
      { k: "持续时间", v: Math.round(g.geom.dur) + " " + t("分钟") },
      { k: "AOD", v: isNum(g.aodUp) ? (g.aodUp as number).toFixed(2) : "—" }
    ]
  });

  /* ③ ECMWF-IFS（这次没取到就只留卡头与说明，不编数字） */
  const e = res.sE;
  if (e) {
    out.push({
      id: "ec",
      name: "ECMWF-IFS 模式",
      sub: "欧洲中心全球模式",
      P: e.P,
      Q: e.Q,
      grade: gradeOf(e.Q),
      facts: [
        { k: "云型", v: t(e.primary.type) },
        { k: "主云量", v: Math.round(e.primary.cover) + "%" },
        { k: "云底高度", v: uAlt(e.primary.base * 1000) },
        { k: "云边界", v: isNum(e.d) ? uDist(e.d) : t("无明显边界") },
        { k: "等效云底", v: uDist(e.hEff, 2) },
        { k: "持续时间", v: Math.round(e.geom.dur) + " " + t("分钟") },
        { k: "AOD", v: isNum(e.aodUp) ? (e.aodUp as number).toFixed(2) : "—" }
      ]
    });
  } else {
    out.push({
      id: "ec", name: "ECMWF-IFS 模式", sub: "欧洲中心全球模式",
      P: NaN, Q: NaN, grade: "", facts: [], missing: true
    });
  }

  /* ④ 光追物理 */
  const rt = res.sRT;
  const bright = t(rt.bright.txt).split(/[（(]/)[0].trim();
  out.push({
    id: "rt",
    name: "光追算法",
    sub: "纯物理：多波长光路积分 + CIE 色度",
    P: rt.P,
    Q: rt.Q,
    grade: gradeOf(rt.Q),
    facts: [
      { k: "主云型", v: t(rt.primary.type) },
      { k: "等效地表", v: uDist(rt.Heq, 2) },
      { k: "峰值透射", v: rt.peak.T550.toExponential(2) },
      { k: "亮度", v: bright },
      { k: "颜色", v: t(rt.peak.name) },
      { k: "饱和", v: Math.round(rt.peak.sat * 100) + "%" },
      { k: "几何", v: t(rt.geom.ok ? "成立" : "不成立") }
    ]
  });

  return out;
});

function pick(id: ModelSel) {
  if (id === "ec" && !r.value.sE) return;
  sel.value = id;
}
function barW(p: number): string {
  return Math.max(0, Math.min(100, p)) + "%";
}
</script>

<template>
  <div class="mc-wrap">
    <div class="mc-head">
      <h4>{{ t("各模型独立结果") }}</h4>
      <span class="mc-hint">{{ t("点任意一张卡，上方结论就切到该模型") }}</span>
    </div>

    <div class="mc-grid">
      <component
        :is="c.missing ? 'div' : 'button'"
        v-for="c in cards"
        :key="c.id"
        class="mcard"
        :class="{ on: sel === c.id, missing: c.missing }"
        :data-mid="c.id"
        :type="c.missing ? null : 'button'"
        :aria-pressed="c.missing ? null : sel === c.id"
        :aria-label="t(c.name)"
        @click="pick(c.id)"
      >
        <span class="mh">
          <i class="dot" :style="{ background: COLOR[c.id] }" />
          <b>{{ t(c.name) }}</b>
          <em class="sub">{{ t(c.sub) }}</em>
        </span>

        <template v-if="!c.missing">
          <span class="mrow">
            <span class="mnum">{{ Math.round(c.P) }}<small>%</small></span>
            <span class="grade" :style="band(c.grade)">
              {{ t("质量 {q} 分 · {grade}", { q: Math.round(c.Q), grade: t(c.grade) }) }}
            </span>
          </span>
          <span class="bar"><i :style="{ width: barW(c.P), background: COLOR[c.id] }" /></span>
          <span class="facts">
            <span v-for="f in c.facts" :key="f.k">
              <i>{{ t(f.k) }}</i><b>{{ f.v }}</b>
            </span>
          </span>
        </template>

        <p v-else class="miss">
          {{ t("该日期/点位未取到 ECMWF 数据，本次综合结果由 GFS 与光追算法构成。") }}
        </p>
      </component>
    </div>
  </div>
</template>

<style scoped>
.mc-wrap {
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px solid var(--stroke);
}
.mc-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.mc-head h4 {
  margin: 0;
  font-size: 1.02rem;
  color: var(--tx-1);
}
.mc-hint {
  font-size: var(--fs-tiny);
  color: var(--tx-3);
}
.mc-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
/* 整卡是按钮：只剩视觉层，交互语义靠 aria-pressed */
.mcard {
  position: relative;
  display: block;
  width: 100%;
  text-align: left;
  padding: 14px 16px 15px;
  border-radius: var(--r-md);
  border: 1px solid var(--stroke);
  background: var(--bg-glass-2);
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: border-color 0.16s, background 0.16s, box-shadow 0.16s;
}
.mcard:hover {
  border-color: var(--stroke-2);
  background: var(--bg-glass);
}
/* 选中态＝**框本身就是光谱**：2px 边框设为透明，用两层背景把渐变画进
   border-box（外圈 2px 光谱）、内层用实色卡底盖住 padding-box，
   渐变只在边框那一圈露出来。这样圆角完全贴合，不再有“架在框上的线”。
   padding 各减 1px 抵消加粗的边框，选中前后盒子尺寸与文字位置都不动。 */
.mcard.on {
  border: 2px solid transparent;
  padding: 13px 15px 14px;
  background-image:
    linear-gradient(var(--bg-card-solid), var(--bg-card-solid)),
    var(--spectrum);
  background-origin: padding-box, border-box;
  background-clip: padding-box, border-box;
  background-repeat: no-repeat;
  box-shadow: none;
}
.mcard.missing {
  cursor: default;
  border-style: dashed;
}
.mh {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.mh .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.mh b {
  font-size: 0.86rem;
  font-weight: 600;
  white-space: nowrap;
}
.mh .sub {
  margin-left: auto;
  font-style: normal;
  font-size: var(--fs-tiny);
  color: var(--tx-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 58%;
}
.mrow {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.mnum {
  font-family: var(--font-display);
  font-size: 1.9rem;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.mnum small {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--tx-3);
  margin-left: 1px;
}
.grade {
  font-size: var(--fs-tiny);
  padding: 2px 8px;
  border-radius: var(--r-full);
  border: 1px solid transparent;
  white-space: nowrap;
}
.bar {
  display: block;
  height: 3px;
  margin: 10px 0 9px;
  border-radius: 2px;
  background: var(--stroke);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  border-radius: 2px;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 3px 16px;
  font-size: var(--fs-tiny);
  color: var(--tx-2);
  line-height: 1.75;
}
.facts span {
  white-space: nowrap;
  min-width: 0;
}
.facts i {
  font-style: normal;
  color: var(--tx-3);
  margin-right: 6px;
}
.facts b {
  font-weight: 600;
  color: var(--tx-1);
  font-variant-numeric: tabular-nums;
}
.miss {
  margin: 10px 0 0;
  font-size: var(--fs-tiny);
  color: var(--tx-3);
  line-height: 1.75;
}
@media (max-width: 720px) {
  .mc-grid { grid-template-columns: 1fr; }
  /* 副标题不藏：综合卡的权重、光追卡的物理口径都在这里，
     窄屏放不下就换行到卡名下方，而不是整条丢掉 */
  .mh { flex-wrap: wrap; row-gap: 2px; }
  .mh .sub {
    flex: 1 0 100%;
    margin-left: 14px;
    max-width: none;
  }
}
</style>
