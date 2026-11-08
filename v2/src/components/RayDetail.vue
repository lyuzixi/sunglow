<script setup lang="ts">
/* 光追算法细节卡：把 sRT 里已经算出来、但结论卡没地方摆的中间量摊开。
   数据全部来自 state.result.sRT，不新增任何取数。 */
import { computed } from "vue";
import { state } from "../state";
import { t } from "../core/i18n";
import { uAlt, uDist } from "../core/units";
import { clamp, clamp01, isNum } from "../core/math";
import FoldCard from "./FoldCard.vue";

const res = computed(() => state.result);

const n1 = (v: number | null | undefined, d = 1): string =>
  isNum(v) ? v.toFixed(d) : "—";

const fmtDur = (min: number): string => {
  if (!isNum(min)) return "—";
  if (min <= 0) return t("0 分");
  const m = Math.floor(min), s = Math.round((min - m) * 60);
  return m > 0 ? t("{m} 分 {s} 秒", { m, s }) : t("{s} 秒", { s });
};

const rows = computed(() => {
  const r = res.value;
  if (!r) return [];
  const s = r.sRT, g = s.geom;
  return [
    { k: "主云型", v: `${t(s.primary.type)} · ${t(s.primary.name)}` },
    { k: "云底高度", v: uAlt(s.primary.base * 1000) },
    { k: "云量", v: `${Math.round(s.primary.cover)}%` },
    { k: "视线距离", v: uDist(s.d, 0) },
    { k: "几何窗口", v: `${Math.round(g.dur)} ${t("分钟")}` },
    { k: "亮度等级", v: t(s.bright.txt) },
    { k: "峰值透射率 T(550nm)", v: s.peak.T550.toExponential(2) },
    { k: "峰值路径光学厚度 τ", v: s.peak.tau550.toFixed(1) },
    { k: "峰值颜色", v: `${t(s.peak.name)} · ${t("饱和")} ${Math.round(s.peak.sat * 100)}%` },
    { k: "色相跨距（颜色丰富度）", v: `${s.hueSpread.toFixed(0)}°` },
    { k: "气溶胶标高 Hs", v: `${n1(s.Hs, 2)} km` },
    { k: "近边界角（云遮挡）", v: `${n1(g.thNearDeg, 2)}°` },
    { k: "远边界角（地球遮挡）", v: `${n1(g.thFarDeg, 2)}°` }
  ];
});

const facs = computed(() => {
  const r = res.value;
  if (!r) return [];
  const s = r.sRT;
  return [
    { k: "几何", raw: `${t("边界")} ${uDist(s.d, 0)}`, v: s.geomF },
    { k: "云量", raw: `${Math.round(s.primary.cover)}%`, v: s.coverF },
    { k: "通透度", raw: `AOD ${s.aodUp.toFixed(2)}`, v: s.aeroF }
  ];
});

/* 强度-彩度时间曲线：与V1 rayCurve 同式 —— 横轴由 ω 把各采样点的
   掠射角换算成「事件后分钟数」，纵轴各自归一到峰值，竖线用采样点实际颜色。 */
const curve = computed(() => {
  const r = res.value;
  if (!r) return null;
  const sm = r.sRT.samples || [];
  if (sm.length < 2) return null;
  const g = r.sRT.geom;
  const om = isNum(r.omega) && r.omega > 0.01 ? r.omega : 0.2;
  const okGeo = isNum(g.thNearDeg) && isNum(g.thFarDeg);
  const mins = sm.map((x, i) =>
    okGeo ? (g.thNearDeg + x.t * (g.thFarDeg - g.thNearDeg)) / om : i * 3
  );
  const mx = Math.max(Math.max(...mins) * 1.06, 0.5);
  const maxL = Math.max(...sm.map((x) => x.lumRel || 0)) || 1;
  const maxC = Math.max(...sm.map((x) => x.chroma || 0)) || 1;
  const W = 100, H = 34, PT = 4, PB = 6;
  const X = (i: number) => (mins[i] / mx) * (W - 2) + 1;
  const Y = (v: number) => H - PB - clamp01(v) * (H - PT - PB);
  const poly = (key: "lumRel" | "chroma", mxv: number) =>
    sm.map((x, i) => `${X(i).toFixed(2)},${Y((x[key] || 0) / mxv).toFixed(2)}`).join(" ");
  let pk = 0;
  for (let i = 1; i < sm.length; i++) if ((sm[i].lumRel || 0) > (sm[pk].lumRel || 0)) pk = i;
  return {
    lPoints: poly("lumRel", maxL),
    cPoints: poly("chroma", maxC),
    gridYs: [0, 0.25, 0.5, 0.75, 1].map((f) => Y(f).toFixed(2)),
    bars: sm.map((x, i) => ({ x: X(i).toFixed(2), hex: x.hex })),
    peakMin: mins[pk].toFixed(1),
    maxC: maxC.toFixed(3),
    axis: [t("0 分"), fmtDur(mx / 2), fmtDur(mx)]
  };
});

/* 火烧云三角时间轴：把 θnear→θfar 的掠射区间按 ω 换算成事件后分钟数，
   与上方曲线共用同一时间口径；几何不成立时给出原因，不画轴。 */
const timeline = computed(() => {
  const r = res.value;
  if (!r) return null;
  const g = r.sRT.geom;
  if (!g.ok) {
    const why = isNum(r.sRT.d)
      ? t("云边界距离 {d} 已超过霞光深入距离上限 {m}（该云盘范围内阳光无法从云底下方射入）", {
          d: uDist(r.sRT.d), m: uDist(g.xMax)
        })
      : t("日出/日落方向 400 km 内没有找到可承载霞光的云盘");
    return {
      ok: false as const,
      warn: t("几何条件不成立：{why}。光追结果按最接近的掠射情形估算，仅作参考。", { why })
    };
  }
  const om = isNum(r.omega) && r.omega > 0 ? r.omega : 0.2;
  const t0 = g.thNearDeg / om, t1 = g.thFarDeg / om;
  const mx = Math.max(t1 * 1.12, 0.8);
  return {
    ok: true as const,
    segLeft: `${(t0 / mx * 100).toFixed(1)}%`,
    segWidth: `${((t1 - t0) / mx * 100).toFixed(1)}%`,
    nearLeft: `${(t0 / mx * 100).toFixed(1)}%`,
    farLeft: `${(t1 / mx * 100).toFixed(1)}%`,
    nearLabelLeft: `${clamp(t0 / mx * 100, 6, 62).toFixed(1)}%`,
    farLabelLeft: `${clamp(t1 / mx * 100, 40, 94).toFixed(1)}%`,
    start: fmtDur(t0),
    end: fmtDur(t1)
  };
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
