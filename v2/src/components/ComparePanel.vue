<script setup lang="ts">
/* =========================================================================
   多观测点对比 · 排行榜（grill 拍板：方案A 独立分区，地图之后）
   三档取数纪律与全局一致：auto 只看缓存 / click 缓存优先 / force 绕开。
   当前地点自动加入第一张卡（复用主结果，零取数，不占 CMP_MAX 名额）。
   ========================================================================= */
import { ref, computed, watch, onMounted } from "vue";
import { state } from "../state";
import { mapBox } from "../state";
import { t } from "../core/i18n";
import { searchCity, type City } from "../core/city";
import { pointName, regionName } from "../core/citylang";
import {
  cmpList, addCmpPt, removeCmpPt, clearCmp, CMP_MAX,
  ensureRow, rowFromResult, rowFromMapPoint, rowMissing, originOf,
  type ComparePt, type CompareRow
} from "../core/compare";
import { pointCacheGet } from "../core/forecast";
import { ageText } from "../core/i18n";
import { isNum } from "../core/math";
import { typeDetail } from "../core/physics";

const rows = ref<CompareRow[]>([]);
const loading = ref(false);
const token = ref(0);
const q = ref("");
const qEl = ref<HTMLInputElement | null>(null);
const sug = ref<City[]>([]);
const showSug = ref(false);
const llLat = ref("");
const llLon = ref("");
const flash = ref("");
let flashTimer = 0;

/** 占位卡「＋ 再加一个观测点」→ 聚焦搜索框（桌面/手机同一入口） */
function focusQ() {
  qEl.value?.focus();
}

function say(msg: string) {
  flash.value = msg;
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => (flash.value = ""), 2200);
}

/* ---- 加点 ---- */
function onInput() {
  sug.value = q.value.trim() ? searchCity(q.value, 6) : [];
  showSug.value = sug.value.length > 0;
}
function addCity(c: City) {
  const r = addCmpPt({ name: c.name, prov: c.region, lat: c.lat, lon: c.lon, src: "search" });
  afterAdd(r);
  q.value = "";
  showSug.value = false;
}
function addLL() {
  const la = parseFloat(llLat.value), lo = parseFloat(llLon.value);
  if (!isNum(la) || !isNum(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
    say("请输入有效的纬度（-90~90）与经度（-180~180）");
    return;
  }
  const name = la.toFixed(2) + "°, " + lo.toFixed(2) + "°";
  const r = addCmpPt({ name, prov: "", lat: la, lon: lo, src: "ll" });
  afterAdd(r);
  if (r === "ok") { llLat.value = ""; llLon.value = ""; }
}
function afterAdd(r: "ok" | "dup" | "full") {
  say(r === "ok" ? "已加入对比" : r === "dup" ? "该点已在对比中" : "对比列表已满（最多 4 个）");
  if (r === "ok") void refresh("auto"); /* 先试缓存，绝不自动取数 */
}

/* ---- 行构建 ---- */
function mapFreeRow(pt: ComparePt): CompareRow | null {
  /* 地图选点免额度的唯一路径：观测场该日期+时段已加载且与主日期一致 */
  const box = mapBox.value;
  const pb = box ? box[state.period] : null;
  if (!pb || pb.dateS !== state.dateStr || !pb.pts?.length) return null;
  let best: (typeof pb.pts)[number] | null = null;
  let bd = Infinity;
  for (const p of pb.pts) {
    const d = Math.abs(p.lat - pt.lat) + Math.abs(p.lon - pt.lon);
    if (d < bd) { bd = d; best = p; }
  }
  return best && bd < 0.2 ? rowFromMapPoint(best) : null;
}

async function rowFor(pt: ComparePt, mode: "auto" | "click" | "force", still: () => boolean): Promise<CompareRow> {
  if (pt.src === "map") {
    const hit = pointCacheGet(pt.lat, pt.lon, state.dateStr, state.period);
    if (hit && still()) return rowFromResult({ ...hit, src: "cache" }, originOf(pt), false, pt);
    const free = mapFreeRow(pt);
    if (free && still()) return free;
    if (mode === "auto") return rowMissing(pt);
  }
  return ensureRow(pt, { dateStr: state.dateStr, period: state.period, mode, stillCurrent: still });
}

async function refresh(mode: "auto" | "click" | "force") {
  const seq = ++token.value;
  const still = () => seq === token.value;
  const list: CompareRow[] = [];
  /* 当前地点：主结果在且日期时段匹配就直接用（零取数） */
  const r = state.result;
  if (r && r.ok && r.dateStr === state.dateStr && r.period === state.period) {
    list.push(rowFromResult(r, "当前地点", true));
  } else {
    list.push({
      ...rowMissing({ name: state.city.name, prov: state.city.region, lat: state.city.lat, lon: state.city.lon, src: "search" }),
      origin: "当前地点", free: true
    });
  }
  loading.value = mode !== "auto";
  for (const pt of cmpList.value) {
    if (mode === "click") {
      /* 缓存优先：已有数据的行原样保留，只为缺数行取 */
      const ex = rows.value.find((x) => x.pt && Math.abs(x.pt.lat - pt.lat) < 0.005 && Math.abs(x.pt.lon - pt.lon) < 0.005 && !x.missing);
      if (ex) { list.push(ex); continue; }
    }
    list.push(await rowFor(pt, mode, still));
    if (!still()) return;
  }
  if (!still()) return;
  loading.value = false;
  rows.value = sortRows(list);
}

function sortRows(list: CompareRow[]): CompareRow[] {
  return [...list].sort((a, b) => {
    if (a.missing !== b.missing) return a.missing ? 1 : -1;
    return (b.score || 0) - (a.score || 0);
  });
}

/* 主结果更新 / 日期时段切换 / 列表增删 → 重新对齐（auto 不烧额度） */
watch(() => [state.result, state.dateStr, state.period, state.city.name, cmpList.value.length], () => void refresh("auto"));
onMounted(() => void refresh("auto"));

const readyRows = computed(() => rows.value.filter((x) => !x.missing));
const missRows = computed(() => rows.value.filter((x) => x.missing && !(x.free && x.origin === "当前地点" && !state.result)));
const canLoad = computed(() => rows.value.some((x) => x.missing));
const mainMeta = computed(() => {
  const r = state.result;
  return r && r.ok && r.dateStr === state.dateStr && r.period === state.period;
});

function gradeCls(s: number): string {
  return s >= 75 ? "j-ok" : s >= 50 ? "j-mid" : "j-bad";
}
function durTxt(v: number | null): string {
  return isNum(v) ? Math.round(v) + " " + t("分钟") : "—";
}
function confTxt(x: CompareRow): string {
  if (!x.conf) return "—";
  return t(x.conf.lv) + (isNum(x.dvI) ? " · ΔI " + Math.round(x.dvI) : "");
}
function srcTag(x: CompareRow): string {
  if (x.pt) return t(originOf(x.pt));
  return t("当前地点");
}
/** 按坐标移除（行里的 pt 可能是地图行新建的副本，不能按对象引用找） */
function rmRow(x: CompareRow) {
  if (!x.pt) return;
  const i = cmpList.value.findIndex((p) => Math.abs(p.lat - x.pt!.lat) < 0.005 && Math.abs(p.lon - x.pt!.lon) < 0.005);
  if (i >= 0) removeCmpPt(i);
}
function ageBadge(x: CompareRow): string {
  if (x.fromCache === true && x.ageMs != null) return t("缓存 · {age}前", { age: ageText(x.ageMs) });
  if (x.fromCache === false) return t("刚刚取数");
  return "";
}
</script>

<template>
  <section id="compare" class="section">
    <div class="wrap">
      <div class="section-head">
        <h2>{{ t("多观测点对比") }}</h2>
        <div class="head-right">
          <div class="sub">
            {{ t("同一天 · 按综合分排序") }}
            <span class="dot">·</span>
            {{ t("最多 {n} 个对比点", { n: CMP_MAX }) }}
          </div>
          <div class="acts">
            <button class="btn btn-primary" :disabled="loading || !canLoad" @click="refresh('click')">
              {{ loading ? t("取数中…") : t("加载对比") }}
            </button>
            <button class="btn btn-ghost" :disabled="loading || !readyRows.length && !missRows.length" @click="refresh('force')">
              {{ t("重新取数") }}
            </button>
            <button class="btn btn-ghost" :disabled="!cmpList.length" @click="clearCmp">
              {{ t("清空对比") }}
            </button>
          </div>
        </div>
      </div>

      <div class="cmp glass">
        <div class="toolbar">
          <div class="sbox">
            <input
              ref="qEl"
              v-model="q" class="inp" :placeholder="t('搜索城市加入对比…')"
              @input="onInput" @focus="onInput" @blur="showSug = false"
            />
            <ul v-if="showSug" class="sug" @mousedown.prevent>
              <li v-for="c in sug" :key="c.name + c.lat" @click="addCity(c)">
                {{ pointName(c.name, state.lang) }} <em>{{ regionName(c.region, state.lang) }}</em>
              </li>
            </ul>
          </div>
          <div class="ll">
            <input v-model="llLat" class="inp sm" :placeholder="t('纬度')" />
            <input v-model="llLon" class="inp sm" :placeholder="t('经度')" />
            <button class="btn" @click="addLL">{{ t("输入经纬度") }}</button>
          </div>
        </div>
        <p class="hint">
          {{ t("当前地点自动加入（复用主结果，不重复取数）。") }}
          <em>{{ t("地图选点免额度") }}</em>{{ t("：在上方观测场地图点任意格点的「加入对比」；搜索/经纬度加入的每个点约 51 次加权调用，结果缓存 6 小时。") }}
        </p>
        <p v-if="flash" class="flash">{{ t(flash) }}</p>

        <!-- 固定两列（grill 拍板方案 1）：仅当前地点一卡时，右侧补虚线占位卡 -->
        <div class="grid">
          <div
            v-for="(x, i) in rows" :key="x.pt ? x.pt.lat + ',' + x.pt.lon : 'main'"
            class="rcard" :class="{ champ: i === 0 && !x.missing, miss: x.missing }"
          >
            <span v-if="!x.missing" class="badge" :class="'b' + (i + 1)">{{ ["①", "②", "③", "④", "⑤"][i] }} {{ t("综合") }} {{ Math.round(x.score) }}</span>
            <div class="rch">
              <span class="nm">{{ pointName(x.pt ? x.pt.name : state.city.name, state.lang) }}</span>
              <span class="co">
                {{ (x.pt ? x.pt.lat : state.city.lat).toFixed(2) }}, {{ (x.pt ? x.pt.lon : state.city.lon).toFixed(2) }}
                · {{ srcTag(x) }}
              </span>
              <button v-if="x.pt" class="rm" :aria-label="t('移除')" @click="rmRow(x)">×</button>
            </div>
            <template v-if="!x.missing">
              <div class="srow">
                <span class="score">{{ Math.round(x.score) }}</span>
                <span class="grade" :class="gradeCls(x.score)">{{ t(x.grade) }}</span>
                <span v-if="ageBadge(x)" class="age" :class="{ fresh: x.fromCache === false }">{{ ageBadge(x) }}</span>
              </div>
              <div class="kv">
                <span>{{ t("出现概率") }} P</span><b>{{ Math.round(x.P) }}</b>
                <span>{{ t("观赏质量") }} Q</span><b>{{ Math.round(x.Q) }}</b>
                <span>{{ t("云型") }}</span><b>{{ typeDetail(x.type, x.covers) }}</b>
                <span>{{ t("霞色") }}</span><b>{{ x.color ? t(x.color) : "—" }}</b>
                <span>{{ t("持续时间") }}</span><b>{{ durTxt(x.dur) }}</b>
                <span>{{ t("可信度") }}</span><b>{{ confTxt(x) }}</b>
              </div>
            </template>
            <template v-else>
              <div class="missbox">
                <p>{{ x.free ? t("尚未取数") : t("该日期尚未取数") }}</p>
                <p v-if="x.pt && x.pt.src === 'map'" class="miss-sub">{{ t("在上方加载同日期地图可免额度显示；或点「加载对比」按单点取数。") }}</p>
                <p v-else class="miss-sub">{{ t("点「加载对比」取数（约 51 次加权调用，缓存 6 小时）。") }}</p>
              </div>
            </template>
          </div>
          <button v-if="rows.length === 1" class="phcard" type="button" @click="focusQ">
            <span class="ph-plus">＋</span>
            <span class="ph-t">{{ t("再加一个观测点") }}</span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.cmp {
  padding: 24px 26px;
}
.head-right {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  align-items: center;
  justify-content: flex-end;
}
.sub { color: var(--tx-3); font-size: var(--fs-small); white-space: nowrap; }
.dot { margin: 0 6px; color: var(--tx-3); }
.acts { display: flex; gap: 8px; flex-wrap: wrap; }
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin: 14px 0 8px;
}
.sbox { position: relative; flex: 1 1 220px; max-width: 320px; }
.inp {
  width: 100%;
  border: 1px solid var(--stroke-2);
  border-radius: 999px;
  padding: 7px 14px;
  font-size: var(--fs-small);
  background: var(--bg-glass-2);
  color: var(--tx-1);
}
.inp:focus { outline: none; border-color: var(--acc-3); }
.inp.sm { width: 96px; border-radius: var(--r-sm); }
.ll { display: flex; gap: 6px; align-items: center; }
.sug {
  position: absolute;
  top: calc(100% + 4px);
  left: 0; right: 0;
  z-index: 30;
  margin: 0; padding: 4px;
  list-style: none;
  background: var(--bg-card-solid);
  border: 1px solid var(--stroke-2);
  border-radius: var(--r-sm);
  box-shadow: var(--card-sh);
}
.sug li { padding: 7px 10px; font-size: var(--fs-small); cursor: pointer; border-radius: 6px; }
.sug li:hover { background: var(--bg-glass-2); }
.sug em { font-style: normal; color: var(--tx-3); margin-left: 6px; font-size: var(--fs-tiny); }
.hint { margin: 4px 0 0; font-size: var(--fs-tiny); color: var(--tx-3); }
.hint em { font-style: normal; color: var(--q-good); font-weight: 600; }
.flash { margin: 6px 0 0; font-size: var(--fs-tiny); color: var(--acc-3); }

.grid {
  margin-top: 16px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
/* 占位卡：不带 .rcard 类（探针按 .rcard 计数），虚线空框引导加点 */
.phcard {
  border: 1px dashed var(--stroke-2);
  border-radius: var(--r-md);
  background: transparent;
  min-height: 168px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  color: var(--tx-3);
  transition: border-color var(--t-fast), color var(--t-fast), background var(--t-fast);
}
.phcard:hover {
  border-color: var(--acc-3);
  color: var(--acc-3);
  background: var(--bg-glass-2);
}
.ph-plus { font-size: 1.7rem; line-height: 1; }
.ph-t { font-size: var(--fs-small); }
.rcard {
  position: relative;
  border: 1px solid var(--stroke-2);
  border-radius: var(--r-md);
  background: var(--bg-card-solid);
  padding: 16px 18px 14px;
}
.rcard.champ {
  border: 2px solid transparent;
  padding: 15px 17px 13px;
  background-image: linear-gradient(var(--bg-card-solid), var(--bg-card-solid)), var(--spectrum);
  background-origin: padding-box, border-box;
  background-clip: padding-box, border-box;
}
.rcard.miss { border-style: dashed; }
.badge {
  position: absolute;
  top: -11px;
  left: 14px;
  font-size: var(--fs-tiny);
  padding: 2px 11px;
  border-radius: 999px;
  color: #fff;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.badge.b1 { background: linear-gradient(90deg, var(--spectrum-1), var(--spectrum-2)); }
.badge.b2, .badge.b3, .badge.b4, .badge.b5 { background: var(--tx-2); }
.rch { display: flex; align-items: baseline; gap: 10px; }
.rch .nm { font-weight: 700; font-size: 1rem; }
.rch .co { font-size: var(--fs-tiny); color: var(--tx-3); flex: 1; }
.rm {
  border: none; background: none; cursor: pointer;
  color: var(--tx-3); font-size: 1rem; line-height: 1;
  padding: 2px 6px;
}
.rm:hover { color: var(--q-bad); }
.srow { display: flex; align-items: center; gap: 10px; margin: 10px 0 8px; }
.score { font-size: 1.9rem; font-weight: 700; line-height: 1; }
.grade {
  font-size: var(--fs-tiny);
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid currentColor;
}
.j-ok { color: var(--q-good); }
.j-mid { color: var(--q-mid); }
.j-bad { color: var(--q-bad); }
.age { font-size: var(--fs-tiny); color: var(--tx-3); margin-left: auto; }
.age.fresh { color: var(--acc-3); }
.kv {
  display: grid;
  grid-template-columns: 76px 1fr;
  gap: 4px 10px;
  font-size: var(--fs-small);
  color: var(--tx-2);
}
.kv b { color: var(--tx-1); font-weight: 600; }
.missbox { padding: 14px 0 8px; color: var(--tx-2); font-size: var(--fs-small); }
.missbox p { margin: 0 0 6px; }
.miss-sub { color: var(--tx-3); font-size: var(--fs-tiny); }
@media (max-width: 720px) {
  .section-head { flex-wrap: wrap; row-gap: 8px; }
  .grid { grid-template-columns: 1fr; }
  .acts { flex-basis: 100%; justify-content: flex-start; }
  .head-right { justify-content: flex-start; }
  .sub { white-space: normal; }
  .rch { flex-wrap: wrap; }
  .rch .nm { flex: 1; }
  .rch .co { flex-basis: 100%; order: 3; }
  .phcard { min-height: 120px; }
}
</style>
