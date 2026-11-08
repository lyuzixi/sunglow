<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { state, isDark } from "../state";
import { t, ageText, getLang } from "../core/i18n";
import { cityName } from "../core/citylang";
import { rampColor } from "../core/ramp";
import { QUALITY_BANDS } from "../core/scoring";
import { saveTrendCard } from "../core/sharecard";
import { loadTrend, type TrendRow } from "../core/trend";
import FoldNote from "./FoldNote.vue";

const rows = ref<TrendRow[]>([]);
const loading = ref(false);
const busy = ref(false);
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

/* 等级配色：取 QUALITY_BANDS 的按主题色，与模型卡同一口径 */
function bandOf(grade: string) {
  const b = QUALITY_BANDS.find((x) => x.key === grade) || QUALITY_BANDS[QUALITY_BANDS.length - 1];
  return isDark.value ? b.dark : b.color;
}

/** 质量徽章：底色是等级的淡色，文字与描边同色，一眼分辨好坏 */
function badgeStyle(grade: string) {
  const c = bandOf(grade);
  return { color: c, background: c + "14", borderColor: c + "3d" };
}

/* 保存趋势图为图片：与结论卡同一套落地逻辑（手机唤起系统分享，桌面下载） */
async function saveImg() {
  if (!byDay.value.length || busy.value || loading.value) return;
  busy.value = true;
  try {
    await saveTrendCard(byDay.value, {
      city: cityName(state.city.name, getLang()),
      src: srcKind.value
    });
  } catch {
    alert(t("生成图片失败，请重试。"));
  } finally {
    busy.value = false;
  }
}
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
          <button
            v-if="rows.length"
            class="btn btn-ghost sm"
            style="margin-left: 8px"
            :disabled="loading || busy"
            @click="saveImg"
          >
            {{ busy ? t("正在生成…") : t("保存图片") }}
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
                <span v-if="d.am" class="qb" :style="badgeStyle(d.am.grade)">
                  <b>{{ t(d.am.grade) }}</b><em>{{ Math.round(d.am.Q) }}</em>
                </span>
                <span v-else class="qb empty">—</span>
              </div>
              <div class="t-row">
                <span class="per">{{ t("晚") }}</span>
                <div class="bar"><i :style="{ width: (d.pm?.P ?? 0) + '%' }" /></div>
                <b class="pv" :style="{ color: rampColor(d.pm?.P ?? 0) }">
                  {{ d.pm ? Math.round(d.pm.P) + "%" : "—" }}
                </b>
                <span v-if="d.pm" class="qb" :style="badgeStyle(d.pm.grade)">
                  <b>{{ t(d.pm.grade) }}</b><em>{{ Math.round(d.pm.Q) }}</em>
                </span>
                <span v-else class="qb empty">—</span>
              </div>
            </div>
          </div>
        </div>
        <div v-else-if="!loading && !error" class="hint">
          {{ t("趋势需要一次性取 34 个坐标 × 10 天数据（约 102 次加权调用），点击「加载趋势」显式触发。") }}
        </div>
        <div class="trend-key">
          <span><i class="k1" />{{ t("出现概率") }}</span>
          <span><i class="k2" />{{ t("质量徽章（右列）") }}</span>
        </div>

        <FoldNote fold-key="trendFold" title="说明 · 趋势为什么要手动加载">
          <p>{{ t("趋势一次要取 34 个样带点（朝、晚各 17 点）× 10 天，约 102 次加权调用（34 坐标 × 3 路），额度消耗明显高于单点预报。") }}</p>
          <p>{{ t("所以它不随页面自动触发，需要点「加载趋势」；结果同样缓存 6 小时，重复查看不会再取数。") }}</p>
          <p>{{ t("每行左侧是出现概率，右侧徽章是观赏质量等级与分数，徽章颜色即等级；朝霞与晚霞分开算，互不参与对方的综合。") }}</p>
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
  grid-template-columns: 22px 1fr 52px 62px;
  gap: 10px;
  align-items: center;
}
/* 宽屏改为左右两栏：卡片保持与其他板块同宽，单行里条与数字的比例也更平衡 */
@media (min-width: 900px) {
  .trend-rows {
    grid-template-columns: 1fr 1fr;
    column-gap: 56px;
    row-gap: 10px;
  }
  .t-day { grid-template-columns: 84px minmax(0, 1fr); }
  .t-day:nth-last-child(-n+2) { border-bottom: 0; }
  .t-row {
    grid-template-columns: 22px minmax(0, 1fr) 64px 84px;
    gap: 10px;
  }
  .pv { font-size: var(--fs-body); }
  .qb { padding: 2px 9px; }
  .qb b { font-size: var(--fs-small); }
}
.per {
  font-size: var(--fs-tiny);
  color: var(--tx-3);
}
.pv {
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
}
/* 质量徽章：等级在前、分数在后，颜色即等级 */
.qb {
  justify-self: end;
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 1px 7px;
  border: 1px solid transparent;
  border-radius: var(--r-full);
  font-size: var(--fs-tiny);
  line-height: 1.5;
  white-space: nowrap;
}
.qb b { font-weight: 600; }
.qb em {
  font-style: normal;
  font-weight: 500;
  opacity: 0.72;
  font-variant-numeric: tabular-nums;
}
.qb.empty { border-color: var(--stroke); color: var(--tx-3); }
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
