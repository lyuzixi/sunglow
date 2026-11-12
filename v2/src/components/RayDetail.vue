<script setup lang="ts">
/* 光追算法细节卡：把 sRT 里已经算出来、但结论卡没地方摆的中间量摊开。
   数据全部来自 state.result.sRT，不新增任何取数。 */
import { computed } from "vue";
import { state } from "../state";
import { t } from "../core/i18n";
import { clamp, clamp01 } from "../core/math";
import { rayRows, rayFactors, rayCurve, rayTimeline } from "../core/raydetail";
import FoldCard from "./FoldCard.vue";

const res = computed(() => state.result);

const rows = computed(() => (res.value ? rayRows(res.value) : []));
const facs = computed(() => (res.value ? rayFactors(res.value) : []));

/* 以下只把 core 里的归一化结果映射成 SVG 坐标（100×34 的局部坐标系），
   数值口径全部来自 core/raydetail.ts —— 同步给分享卡用。 */
const CW = 100, CH = 34, CPT = 4, CPB = 6;
const curve = computed(() => {
  const cv = res.value ? rayCurve(res.value) : null;
  if (!cv) return null;
  const X = (min: number) => (min / cv.maxMin) * (CW - 2) + 1;
  const Y = (v: number) => CH - CPB - clamp01(v) * (CH - CPT - CPB);
  const poly = (get: (p: { lum: number; chroma: number }) => number) =>
    cv.points.map((p) => X(p.min).toFixed(2) + ',' + Y(get(p)).toFixed(2)).join(' ');
  return {
    lPoints: poly((p) => p.lum),
    cPoints: poly((p) => p.chroma),
    gridYs: [0, 0.25, 0.5, 0.75, 1].map((f) => Y(f).toFixed(2)),
    bars: cv.points.map((p) => ({ x: X(p.min).toFixed(2), hex: p.hex })),
    peakMin: cv.peakMin.toFixed(1),
    maxC: cv.maxC.toFixed(3),
    axis: cv.axis
  };
});

/* 火烧云三角时间轴：起止比例来自 core，这里只换成百分比字符串 */
const timeline = computed(() => {
  const r = res.value;
  if (!r) return null;
  const tl = rayTimeline(r);
  if (!tl.ok) return { ok: false as const, warn: tl.warn };
  const l = tl.startFrac * 100, rr2 = tl.endFrac * 100;
  return {
    ok: true as const,
    segLeft: l.toFixed(1) + '%',
    segWidth: (rr2 - l).toFixed(1) + '%',
    nearLeft: l.toFixed(1) + '%',
    farLeft: rr2.toFixed(1) + '%',
    nearLabelLeft: clamp(l, 6, 62).toFixed(1) + '%',
    farLabelLeft: clamp(rr2, 40, 94).toFixed(1) + '%',
    start: tl.start,
    end: tl.end
  };
});
</script>

<template>
  <FoldCard fold-key="rayFold" anchor="ray" title="光追算法细节" :sub="t('来自同一份取数结果，不额外请求')" outside-title>
    <p v-if="!res" class="hint">{{ t("先计算一次预报，这里才会出现光追推导的中间量。") }}</p>
    <template v-else>
      <dl class="rd-grid">
        <div v-for="r in rows" :key="r.k" class="rd-item">
          <dt>{{ t(r.k) }}</dt>
          <dd>{{ r.v }}</dd>
        </div>
      </dl>

      <div v-if="curve" class="rd-curve">
        <p class="rd-hint">
          {{ t("霞光强度与彩度随时间的演变（横轴＝事件后分钟数，竖线＝各采样点的实际颜色）：") }}
        </p>
        <div class="rc-wrap">
          <svg
            class="rc-svg"
            viewBox="0 0 100 34"
            preserveAspectRatio="none"
            role="img"
            :aria-label="t('霞光强度与彩度随时间的演变（横轴＝事件后分钟数，竖线＝各采样点的实际颜色）：')"
          >
            <line
              v-for="(y, i) in curve.gridYs"
              :key="'g' + i"
              class="rc-grid"
              x1="1"
              x2="99"
              :y1="y"
              :y2="y"
              vector-effect="non-scaling-stroke"
            />
            <line
              v-for="(b, i) in curve.bars"
              :key="'b' + i"
              :x1="b.x"
              :x2="b.x"
              y1="4"
              y2="28"
              :stroke="b.hex"
              stroke-width="1.4"
              opacity=".55"
              vector-effect="non-scaling-stroke"
            />
            <polyline class="rc-l" :points="curve.lPoints" vector-effect="non-scaling-stroke" />
            <polyline class="rc-c" :points="curve.cPoints" vector-effect="non-scaling-stroke" />
          </svg>
          <div class="rc-axis">
            <span v-for="(a, i) in curve.axis" :key="i">{{ a }}</span>
          </div>
          <div class="rc-leg">
            <span><i class="rc-li" />{{ t("相对亮度（峰值 +{v} 分钟）", { v: curve.peakMin }) }}</span>
            <span><i class="rc-ci" />{{ t("彩度 · OKLab（峰值 {v}）", { v: curve.maxC }) }}</span>
          </div>
        </div>
      </div>

      <div class="rd-sw">
        <p class="rd-hint">{{ t("同一组采样时刻的光谱与颜色（左＝刚被照亮，右＝掠地最红）：") }}</p>
        <div class="rd-ray">
          <div
            v-for="(x, i) in res.sRT.samples"
            :key="i"
            class="rd-swatch"
            :style="{ background: x.hex }"
          >
            {{ t(x.name) }}
          </div>
        </div>
      </div>

      <div class="rd-tl-wrap">
        <p class="rd-hint">{{ t("本地云底被照亮的时段（火烧云三角）：") }}</p>
        <div v-if="timeline && timeline.ok" class="rd-tl">
          <div class="rd-seg" :style="{ left: timeline.segLeft, width: timeline.segWidth }" />
          <div class="rd-mk" style="left: 0" />
          <div class="rd-mk" :style="{ left: timeline.nearLeft }" />
          <div class="rd-mk" :style="{ left: timeline.farLeft }" />
          <div class="rd-lb rd-lb-top" :style="{ left: timeline.nearLabelLeft }">
            {{ t("开始 +{v}", { v: timeline.start }) }}
          </div>
          <div class="rd-lb rd-lb-top" :style="{ left: timeline.farLabelLeft }">
            {{ t("结束 +{v}", { v: timeline.end }) }}
          </div>
          <div class="rd-lb rd-lb-ev">{{ t("{ev}时刻", { ev: t(res.evName) }) }}</div>
        </div>
        <p v-else-if="timeline" class="rd-warn">{{ timeline.warn }}</p>
      </div>

      <div class="rd-facs">
        <div v-for="f in facs" :key="f.k" class="rd-fac">
          <span class="rd-fac-t">
            {{ t(f.k) }} {{ f.raw }} · {{ t("适宜度") }} <b>{{ Math.round(f.v * 100) }}%</b>
          </span>
          <i class="rd-bar"><em :style="{ width: Math.round(f.v * 100) + '%' }" /></i>
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
  gap: 4px;
  font-size: var(--fs-tiny);
  color: var(--tx-3);
}
.rd-fac-t { line-height: 1.5; }
.rd-fac-t b { font-weight: 500; color: var(--tx-1); }
.rd-bar {
  display: block;
  height: 5px;
  border-radius: 3px;
  background: var(--bg-glass-2);
  overflow: hidden;
}
.rd-bar em { display: block; height: 100%; background: var(--spectrum); }
.rd-curve { margin-top: 16px; }
.rd-hint { margin: 0 0 6px; font-size: var(--fs-tiny); color: var(--tx-3); }
.rc-svg { display: block; width: 100%; height: 96px; }
.rc-grid { stroke: var(--stroke); stroke-width: 1; }
.rc-l { fill: none; stroke: var(--acc-3); stroke-width: 1.8; }
.rc-c { fill: none; stroke: var(--acc-2); stroke-width: 1.8; stroke-dasharray: 4 3; }
.rc-axis {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
  font-size: 12px;
  color: var(--tx-3);
}
.rc-leg {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--tx-2);
}
.rc-leg i {
  display: inline-block;
  width: 14px;
  height: 3px;
  margin-right: 5px;
  border-radius: 2px;
  vertical-align: middle;
}
.rc-li { background: var(--acc-3); }
.rc-ci { background: var(--acc-2); }
.rd-sw { margin-top: 12px; }
.rd-ray {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(146px, 1fr));
  gap: 9px;
}
.rd-swatch {
  height: 42px;
  padding: 3px 7px;
  border: 1px solid var(--stroke);
  border-radius: 8px;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  font-size: 11.5px;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}
.rd-tl-wrap { margin-top: 14px; }
.rd-tl {
  position: relative;
  height: 56px;
  margin: 2px 0 4px;
  border: 1px solid var(--stroke);
  border-radius: 9px;
  background: var(--bg-glass-2);
  overflow: hidden;
}
.rd-seg {
  position: absolute;
  top: 0;
  bottom: 0;
  background: linear-gradient(180deg, #ffd9a8, #f08a3c);
  opacity: 0.32;
}
.rd-mk {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #94a3b8;
}
.rd-lb {
  position: absolute;
  font-size: 10.5px;
  color: var(--tx-3);
  transform: translateX(-50%);
  white-space: nowrap;
}
.rd-lb-top { top: 4px; }
.rd-lb-ev { bottom: 4px; left: 6%; }
.rd-warn {
  margin: 0;
  padding: 8px 11px;
  border: 1px solid var(--stroke);
  border-left: 2px solid var(--acc-2);
  border-radius: var(--r-sm);
  background: rgba(255, 156, 63, 0.10);
  color: var(--tx-2);
  font-size: var(--fs-tiny);
  line-height: 1.6;
}
.rd-note {
  margin: 16px 0 0;
  font-size: var(--fs-tiny);
  line-height: 1.8;
  color: var(--tx-3);
}
</style>
