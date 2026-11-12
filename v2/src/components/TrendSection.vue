<script setup lang="ts">
import { inject, ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { state, isDark, dataStamp } from "../state";
import { snapshotReady } from "../core/snapshot";
import { t, ageText, getLang } from "../core/i18n";
import { cityName } from "../core/citylang";
import { rampColor } from "../core/ramp";
import { QUALITY_BANDS } from "../core/scoring";
import { saveTrendCard } from "../core/sharecard";
import { useShareImage } from "../core/sharehub";
import { loadTrend, type TrendRow } from "../core/trend";
import FoldNote from "./FoldNote.vue";
import ShareButton from "./ShareButton.vue";

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
    dataStamp.value++;
    srcKind.value = res.fromCache ? "cache" : "live";
    cacheAgeMs.value = res.fromCache ? res.ageMs ?? null : null;
    error.value = "";
  } else if (res.message) {
    error.value = res.message;
  }
}

onMounted(() => {
  go("auto");
  window.addEventListener("sunglow:fill-snapshot", onFill);
});
onBeforeUnmount(() => window.removeEventListener("sunglow:fill-snapshot", onFill));
/** 分享页「补齐全部数据」：只在还没数据时取一次，绝不静默连点 */
function onFill() {
  if (!rows.value.length && !loading.value) void go("click");
}
/** 全功能快照包是父组件异步解压后装好的：那时重新查一次缓存 */
watch(snapshotReady, () => go("auto"));
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

/* ---------- 最佳窗口（F3 口径：跨朝/晚按质量分排名） ---------- */
/** 未来这些天里最值得出门的前三名。用户关心的是“值不值得跑一趟”，
    所以排序只看观赏质量分 Q；Q 相同再让出现概率 P 高的靠前。 */
const best = computed(() =>
  rows.value.slice().sort((a, b) => b.Q - a.Q || b.P - a.P).slice(0, 3)
);
const bestTone = computed(() => {
  const q = best.value[0]?.Q ?? 0;
  if (q >= 65) return { key: "值得安排", cls: "good" };
  if (q >= 45) return { key: "可以留意", cls: "mid" };
  return { key: "整体偏弱", cls: "bad" };
});

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
function weekday(date: string): string {
  const [Y, M, D] = date.split("-").map(Number);
  return t(WEEK[new Date(Date.UTC(Y, M - 1, D)).getUTCDay()]);
}

/* 点击窗口 = 用户的显式意图：切到那天那段并重算一次（与V1 F3行为一致）。
   渲染最佳窗口本身仍然零取数 —— 只读已算好的 rows。 */
const runForecast = inject<((force?: boolean) => Promise<void>) | null>("sunglow.run", null);
function scrollToVerdict() {
  const target = document.getElementById("verdict");
  if (!target) return;
  const reduce =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}
async function jumpTo(date: string, period: "am" | "pm") {
  if (state.loading) return;
  state.dateStr = date;
  state.period = period;
  /* mapDateS 由 state.ts 的日期同步器跟随，别在这里各写一半。
     mapPeriod 仍单独跳：用户没要求时段联动，趋势卡点朝霞就带去朝霞。 */
  state.mapPeriod = period;
  state.result = null;
  /* 先跳回结论区再取数：用户立刻看到加载态，不用等 9 秒超时预算 */
  scrollToVerdict();
  if (!runForecast) return;
  await runForecast();
}

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
/* 底部「分享」板块的「十日趋势图」磁贴：同一份 byDay，不重取数 */
useShareImage("trend", {
  save: saveImg,
  ready: () => byDay.value.length > 0 && !loading.value
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
          <ShareButton
            v-if="rows.length"
            kind="trend"
            :busy="busy"
            :disabled="loading"
            style="margin-left: 8px"
            @click="saveImg"
          />
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

        <template v-if="rows.length">
          <!-- 最佳窗口：先回答「哪天值得去」，再给逐日数据 -->
          <div class="best-block">
            <div class="best-head">
              <div>
                <span class="pill">{{ t("最佳窗口") }} · {{ t("未来 {n} 天", { n: byDay.length }) }}</span>
                <p class="best-sub">
                  {{ t("最值得出门") }} · {{ best[0].date.slice(5) }} {{ weekday(best[0].date) }}
                  · {{ t(best[0].period === "am" ? "朝霞" : "晚霞") }}
                  · {{ t("质量") }} {{ Math.round(best[0].Q) }} {{ t("分") }}
                  · {{ t("出现概率") }} {{ Math.round(best[0].P) }}%
                </p>
              </div>
              <span class="tone" :class="'tone-' + bestTone.cls">{{ t(bestTone.key) }}</span>
            </div>

            <div class="best-grid">
              <button
                v-for="(w, i) in best"
                :key="w.date + w.period"
                type="button"
                class="best-win"
                :class="{ first: i === 0 }"
                :disabled="state.loading"
                :aria-label="w.date + ' ' + t(w.period === 'am' ? '朝霞' : '晚霞') + ' · ' + t('质量') + ' ' + Math.round(w.Q) + ' ' + t('分') + ' · ' + t('出现概率') + ' ' + Math.round(w.P) + '%'"
                @click="jumpTo(w.date, w.period)"
              >
                <span class="bw-top">
                  <em class="bw-rank">#{{ i + 1 }}</em>
                  <span class="bw-date">
                    <b>{{ w.date.slice(5) }}</b>
                    <em>{{ weekday(w.date) }}</em>
                  </span>
                </span>
                <span class="bw-per">{{ t(w.period === "am" ? "朝霞" : "晚霞") }}</span>
                <span class="bw-bottom">
                  <b class="bw-q" :style="{ color: bandOf(w.grade) }">{{ Math.round(w.Q) }}<i>{{ t("分") }}</i></b>
                  <span class="bw-p">{{ Math.round(w.P) }}%</span>
                  <span class="bw-grade" :style="badgeStyle(w.grade)">{{ t(w.grade) }}</span>
                </span>
              </button>
            </div>
          </div>

          <!-- 逐日明细始终展开：概率条与完整徽章直接可见 -->
          <div class="detail-block">
            <h3 class="detail-title">{{ t("逐日明细（概率条与质量徽章）") }}</h3>
            <div class="trend-rows">
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
            <div class="trend-key">
              <span><i class="k1" />{{ t("出现概率") }}</span>
              <span><i class="k2" />{{ t("质量徽章（右列）") }}</span>
            </div>
          </div>
        </template>

        <div v-else-if="!loading && !error" class="hint">
          {{ t("趋势需要一次性取 34 个坐标 × 10 天数据（约 102 次加权调用），点击「加载趋势」显式触发。") }}
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

/* ---------- 最佳窗口 ---------- */
.best-block {
  padding-bottom: 16px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--stroke);
}
.best-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.best-sub {
  margin: 9px 0 0;
  font-size: var(--fs-small);
  color: var(--tx-2);
  line-height: 1.65;
}
.tone {
  flex: 0 0 auto;
  font-size: var(--fs-tiny);
  line-height: 1.6;
  padding: 2px 10px;
  border: 1px solid currentColor;
  border-radius: var(--r-full);
  white-space: nowrap;
}
.tone-good { color: var(--q-good); }
.tone-mid { color: var(--q-mid); }
.tone-bad { color: var(--q-bad); }

.best-grid {
  display: grid;
  grid-template-columns: 1.15fr 1fr 1fr;
  gap: 10px;
  margin-top: 14px;
}
.best-win {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-height: 104px;
  padding: 12px 14px;
  border: 1px solid var(--stroke);
  border-radius: var(--r-md);
  background: var(--bg-glass);
  color: var(--tx-1);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--t-fast), background var(--t-fast), transform var(--t-fast);
}
.best-win:hover {
  border-color: var(--stroke-2);
  background: var(--bg-glass-2);
  transform: translateY(-1px);
}
.best-win:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
.best-win:disabled { opacity: 0.55; cursor: default; transform: none; }
.best-win.first {
  border-color: var(--acc-2);
  background: linear-gradient(140deg, rgba(255, 156, 63, 0.09), var(--bg-glass) 58%);
}
.bw-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.bw-rank {
  font-style: normal;
  font-size: var(--fs-tiny);
  color: var(--tx-3);
  font-family: var(--font-display);
  letter-spacing: 0.04em;
}
.bw-date { display: inline-flex; align-items: baseline; gap: 6px; }
.bw-date b {
  font-size: var(--fs-body);
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
}
.bw-date em { font-style: normal; font-size: var(--fs-tiny); color: var(--tx-3); }
.bw-per { font-size: var(--fs-tiny); color: var(--tx-2); letter-spacing: 0.02em; }
.bw-bottom {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: auto;
  flex-wrap: wrap;
}
.bw-q {
  font-family: var(--font-display);
  font-size: 1.45rem;
  line-height: 1;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.bw-q i { font-style: normal; font-size: var(--fs-tiny); font-weight: 500; margin-left: 2px; }
.bw-p {
  font-family: var(--font-display);
  font-size: var(--fs-small);
  color: var(--tx-2);
  font-variant-numeric: tabular-nums;
}
.bw-grade {
  font-size: var(--fs-tiny);
  line-height: 1.6;
  padding: 1px 8px;
  border: 1px solid transparent;
  border-radius: var(--r-full);
  white-space: nowrap;
}

/* 始终展开，不再包 details：保留标题做分区，正文直接接上 */
.detail-block { margin-top: 18px; }
.detail-title {
  margin: 0 0 12px;
  font-size: var(--fs-tiny);
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--tx-3);
}

@media (max-width: 720px) {
  .best-grid { grid-template-columns: 1fr 1fr; }
  .best-win.first { grid-column: 1 / -1; }
}
@media (max-width: 640px) {
  .trend-card { padding: 16px; }
  .best-sub { font-size: var(--fs-tiny); }
}
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
.linkbtn:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
/* 触屏热区：小号操作按钮也撑到 44px 高 */
@media (pointer: coarse) {
  .sm { min-height: 44px; padding: 0 14px; }
  .linkbtn {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 8px;
  }
}
</style>
