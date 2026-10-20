<script setup lang="ts">
import { computed } from "vue";
import { state } from "../state";
import { t } from "../core/i18n";
import { isNum } from "../core/math";
import { uAlt, uDist, uSpeed } from "../core/units";

const res = computed(() => state.result);

/* 12 项因素（键与原版 SNAP_FACTORS 完全一致，快照侧同源） */
interface FacDef {
  key: string;
  name: string;
  fmt: (v: number) => string;
  desc: (v: number, r: NonNullable<typeof res.value>) => string;
}
const DEFS: FacDef[] = [
  {
    key: "cover", name: "云量类型与覆盖度",
    fmt: (v) => Math.round(v) + "%",
    desc: (v, r) => {
      const deck = ["低云", "中云", "高云"][r.sRT.primary.level];
      const head = t("{type}属{deck}，云底约 {base} km。", {
        type: r.sRT.primary.type, deck: t(deck),
        base: r.sRT.primary.base.toFixed(2)
      });
      const tail = v < 20
        ? t("云量偏少，可能没有足够云体承接霞光。")
        : v > 90 ? t("云量接近全覆盖，阳光难以穿透，易形成闷烧或无霞。")
          : t("云量处于理想区间，云块之间既能透光又能承接低角度阳光。");
      return head + tail;
    }
  },
  {
    key: "base", name: "云底高度",
    fmt: (v) => uAlt(v * 1000),
    desc: (v) => v >= 2 ? t("云底够高，光程长、色彩层次丰富。") : t("云底偏低，霞光可能被遮挡或不持久。")
  },
  {
    key: "heq", name: "光学等效地表高度",
    fmt: (v) => uDist(v, 2),
    desc: () => t("气溶胶消光层的等效厚度，会压低有效云底。")
  },
  {
    key: "heff", name: "等效云底高度",
    fmt: (v) => uDist(v, 2),
    desc: () => t("扣除气溶胶等效地表高度后的光路起算高度。")
  },
  {
    key: "dedge", name: "云边界距离",
    fmt: (v) => uDist(v),
    desc: (v, r) => t("霞光深入距离上限约 {x} km，几何{ok}。", {
      x: r.sRT.geom.xMax.toFixed(0),
      ok: r.sRT.geom.ok ? t("成立") : t("不成立")
    })
  },
  {
    key: "block", name: "光路上游低层云遮挡",
    fmt: (v) => Math.round(v) + "%",
    desc: () => t("低层云会挡住打向主云盘的低角度阳光。")
  },
  {
    key: "aod", name: "气溶胶光学厚度 AOD",
    fmt: (v) => v.toFixed(2),
    desc: (v) => v > 0.3 ? t("气溶胶偏多，色彩饱和度下降（污烧风险）。") : t("气溶胶适中，有利于形成鲜艳霞光。")
  },
  {
    key: "vis", name: "能见度",
    fmt: (v) => (v / 1000).toFixed(1) + " km",
    desc: () => t("能见度决定你能不能看清那片云。")
  },
  {
    key: "rh", name: "2m 相对湿度",
    fmt: (v) => Math.round(v) + "%",
    desc: () => t("湿度影响近地层气溶胶吸湿增长与通透度。")
  },
  {
    key: "stab", name: "气压稳定性",
    fmt: (v) => "|ΔP/Δt| = " + v.toFixed(2) + " hPa/h",
    desc: () => t("气压变化平缓时云场更稳定，预报可信度更高。")
  },
  {
    key: "wind", name: "云边界风速分量",
    fmt: (v) => uSpeed(v),
    desc: () => t("沿日落方位的风速分量，影响云边界移动与持续时间。")
  },
  {
    key: "cape", name: "对流活动",
    fmt: (v) => "CAPE " + Math.round(v) + " J/kg",
    desc: (v) => v > 1500 ? t("对流有效位能偏高，可能出现局地对流云遮挡。") : t("对流活动弱，云场以系统性云为主。")
  }
];

const rows = computed(() => {
  const r = res.value;
  if (!r) return [];
  return DEFS.map((d) => {
    const row = r.factorRows.find((x) => x[0] === d.key);
    const v = row ? row[1] : NaN;
    const s = row ? row[2] : 0.5;
    return {
      key: d.key,
      name: t(d.name),
      val: isNum(v) ? d.fmt(v) : "—",
      score: isNum(s) ? s : 0.5,
      desc: isNum(v) ? d.desc(v, r) : t("本项数据缺失。")
    };
  });
});

function tone(s: number): string {
  if (s >= 0.7) return "var(--q-good)";
  if (s >= 0.4) return "var(--q-mid)";
  return "var(--q-bad)";
}
</script>

<template>
  <section id="factors" class="section">
    <div class="wrap">
      <div class="section-head">
        <h2>{{ t("影响因素") }}</h2>
        <div class="sub">{{ t("12 项判据") }} · {{ t("算法说明") }}</div>
      </div>

      <div class="grid grid-2" v-if="rows.length">
        <div v-for="f in rows" :key="f.key" class="glass fac-card">
          <div class="fac-top">
            <b>{{ f.name }}</b>
            <span class="fac-score" :style="{ color: tone(f.score) }">
              {{ Math.round(f.score * 100) }}
            </span>
          </div>
          <div class="fac-val">{{ f.val }}</div>
          <div class="bar"><i :style="{ width: f.score * 100 + '%' }" /></div>
          <p>{{ f.desc }}</p>
        </div>
      </div>
      <div v-else class="glass" style="padding: 24px; color: var(--tx-3)">
        {{ state.loading ? t("加载中") + "…" : t("暂无数据") }}
      </div>
    </div>
  </section>
</template>

<style scoped>
.fac-card {
  padding: 18px 20px;
}
.fac-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}
.fac-top b { font-size: var(--fs-body); }
.fac-score {
  font-family: var(--font-display);
  font-size: 1.35rem;
  font-weight: 600;
}
.fac-val {
  color: var(--tx-2);
  font-size: var(--fs-small);
  margin-bottom: 10px;
  font-variant-numeric: tabular-nums;
}
.fac-card p {
  margin: 10px 0 0;
  color: var(--tx-3);
  font-size: var(--fs-small);
}
</style>
