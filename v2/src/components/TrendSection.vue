<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { state } from "../state";
import { t, ageText } from "../core/i18n";
import { rampColor } from "../core/ramp";
import { loadTrend, type TrendRow } from "../core/trend";
import FoldNote from "./FoldNote.vue";

const rows = ref<TrendRow[]>([]);
const loading = ref(false);
const error = ref("");
const token = ref(0);
/* 来源：cache = 吃缓存（带年龄小字 + 重取入口）/ live = 刚取 */
const srcKind = ref<"" | "cache" | "live">("");
const cacheAgeMs = ref<number | null>(null);

/**
 * 三档语义，别混：
 *   auto  —— 只看缓存，绝不取数（挂载 / 换地点）
 *   click —— 缓存优先，未命中才取数（点「加载趋势」）
 *   force —— 绕开缓存强制重取（点「重新取数」）
 */
async function go(mode: "auto" | "click" | "force" = "auto") {
  const seq = ++token.value;
  const still = () => seq === token.value;
  loading.value = true;
  error.value = "";
  const res = await loadTrend({
    lat: state.city.lat,
    lon: state.city.lon,
    dateStr: state.dateStr,
    cacheOnly: mode === "auto",
    force: mode === "force",
    onProgress: () => { /* 进度文案轻量，暂不占位 */ },
    stillCurrent: still
  });
  if (!still()) return;
  loading.value = false;
  if (res.ok && res.rows) {
    rows.value = res.rows;
    srcKind.value = res.fromCache ? "cache" : "live";
    cacheAgeMs.value = res.fromCache ? res.ageMs ?? null : null;
    error.value = "";
  } else if (res.message) {
    error.value = res.message;
  }
}

onMounted(() => go("auto"));
watch(() => state.city.name, () => {
  rows.value = [];
  srcKind.value = "";
  cacheAgeMs.value = null;
  go("auto");
});

/* 按天聚合（每天 朝/晚 两行） */
const byDay = computed(() => {
  const map = new Map<string, { date: string; am?: TrendRow; pm?: TrendRow }>();
  for (const r of rows.value) {
    const e = map.get(r.date) || { date: r.date };
    if (r.period === "am") e.am = r; else e.pm = r;
    map.set(r.date, e);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
});
</script>

<template>
  <section id="trend" class="section">
    <div class="wrap">
      <div class="section-head">
        <h2>{{ t("十日趋势") }}</h2>
        <div class="sub">
          {{ rows.length ? rows.length + " " + t("条实算结果") : t("暂无数据") }}
          <button class="btn btn-ghost sm" style="margin-left: 10px" :disabled="loading" @click="go('click')">
            {{ loading ? t("取数中…") : rows.length ? t("重新加载趋势") : t("加载趋势") }}
          </button>
          <span v-if="srcKind && !loading" class="fresh">
            <span class="fresh-t">
              {{ srcKind === "cache" ? t("缓存 · {age}前", { age: ageText(cacheAgeMs ?? 0) }) : t("刚刚取数") }}
            </span>
            <button v-if="srcKind === 'cache'" class="linkbtn" :disabled="loading" @click="go('force')">
              {{ t("重新取数") }}
            </button>
          </span>
        </div>
      </div>

      <div class="glass trend-card">
        <div v-if="error" class="err">{{ error }}</div>
        <div v-if="rows.length" class="trend-rows">
          <div v-for="d in byDay" :key="d.date" class="t-day">
            <div class="t-label">
              <b>{{ d.date.slice(5) }}</b>
              <span>{{ d.date }}</span>
            </div>
            <div class="t-pair">
              <div class="t-row">
                <span class="per">{{ t("朝") }}</span>
                <div class="bar"><i :style="{ width: (d.am?.P ?? 0) + '%' }" /></div>
                <b class="pv" :style="{ color: rampColor(d.am?.P ?? 0) }">
                  {{ d.am ? Math.round(d.am.P) + "%" : "—" }}
                </b>
                <span class="qv">{{ d.am ? Math.round(d.am.Q) : "—" }}</span>
                <span class="gr">{{ d.am?.grade ?? "" }}</span>
              </div>
              <div class="t-row">
                <span class="per">{{ t("晚") }}</span>
                <div class="bar"><i :style="{ width: (d.pm?.P ?? 0) + '%' }" /></div>
                <b class="pv" :style="{ color: rampColor(d.pm?.P ?? 0) }">
                  {{ d.pm ? Math.round(d.pm.P) + "%" : "—" }}
                </b>
                <span class="qv">{{ d.pm ? Math.round(d.pm.Q) : "—" }}</span>
                <span class="gr">{{ d.pm?.grade ?? "" }}</span>
              </div>
            </div>
          </div>
        </div>
        <div v-else-if="!loading && !error" class="hint">
          {{ t("趋势需要一次性取 34 个坐标 × 10 天数据（约 102 次加权调用），点击「加载趋势」显式触发。") }}
        </div>
        <div class="trend-key">
          <span><i class="k1" />{{ t("出现概率") }}</span>
          <span><i class="k2" />{{ t("观赏质量分（右列）") }}</span>
        </div>

        <FoldNote fold-key="trendFold" title="说明 · 趋势为什么要手动加载">
          <p>{{ t("趋势一次要取 34 个样带点（朝、晚各 17 点）× 10 天，约 102 次加权调用（34 坐标 × 3 路），额度消耗明显高于单点预报。") }}</p>
          <p>{{ t("所以它不随页面自动触发，需要点「加载趋势」；结果同样缓存 6 小时，重复查看不会再取数。") }}</p>
          <p>{{ t("每行左侧是出现概率，右侧小字是观赏质量分，朝霞与晚霞分开算，互不参与对方的综合。") }}</p>
        </FoldNote>
      </div>
    </div>
  </section>
</template>

<style scoped>
.trend-card { padding: 18px 20px; }
.trend-rows { display: grid; gap: 12px; }
.t-day {
  display: grid;
  grid-template-columns: 76px 1fr;
  gap: 14px;
  align-items: center;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--stroke);
}
.t-day:last-child { border-bottom: 0; }
.t-label b {
  display: block;
  font-size: var(--fs-body);
  font-weight: 600;
}
.t-label span {
  font-size: var(--fs-tiny);
  color: var(--tx-3);
}
.t-pair { display: grid; gap: 6px; }
.t-row {
  display: grid;
  grid-template-columns: 22px 1fr 52px 34px 40px;
  gap: 10px;
  align-items: center;
}
.per {
  font-size: var(--fs-tiny);
  color: var(--tx-3);
}
.pv {
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
}
.qv, .gr {
  font-size: var(--fs-tiny);
  color: var(--tx-2);
  text-align: right;
}
.trend-key {
  display: flex;
  gap: 18px;
  margin-top: 14px;
  font-size: var(--fs-tiny);
  color: var(--tx-3);
}
.k1, .k2 {
  display: inline-block;
  width: 14px; height: 4px;
  border-radius: 3px;
  margin-right: 6px;
  vertical-align: middle;
  background: var(--spectrum);
}
.k2 { background: var(--acc-2); }
.err {
  color: var(--q-bad);
  font-size: var(--fs-small);
  margin-bottom: 10px;
}
.hint {
  color: var(--tx-3);
  font-size: var(--fs-small);
  padding: 8px 0 14px;
}
.sm { padding: 3px 10px; font-size: var(--fs-tiny); }
/* 缓存来源小字 + 「重新取数」文字入口（与地图/结论卡同一套） */
.fresh {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: 10px;
  font-size: var(--fs-tiny);
  color: var(--tx-3);
  white-space: nowrap;
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
</style>
