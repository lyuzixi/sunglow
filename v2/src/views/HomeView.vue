<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import HeroSection from "../components/HeroSection.vue";
import ConclusionCard from "../components/ConclusionCard.vue";
import TrendSection from "../components/TrendSection.vue";
import MapView from "../components/MapView.vue";
import ComparePanel from "../components/ComparePanel.vue";
import FactorsPanel from "../components/FactorsPanel.vue";
import CalibPanel from "../components/CalibPanel.vue";
import RayDetail from "../components/RayDetail.vue";
import NotesCard from "../components/NotesCard.vue";
import { state, hasSavedCity, reanchorToday } from "../state";
import { nearestCity, cityByName, CITIES } from "../core/city";
import { runForecast } from "../core/forecast";
import { cityTz, todayInTz } from "../core/tz";
import { snapEncode, snapDecode, type SnapInput, type SnapData } from "../core/snap";
import { SNAP_FAC_NAME, snapFacFmt, judgmentOf } from "../core/factors";
import { t } from "../core/i18n";
import { pointName } from "../core/citylang";
import { armReveal } from "../composables/useReveal";
import { applyUrlState, syncUrl, baseQuery, readUrl } from "../core/urlstate";

const snapUrl = ref("");
const snapMsg = ref("");
const copied = ref(false);
const snapView = ref<SnapData | null>(null);

async function run(force = false) {
  state.loading = true;
  state.error = "";
  try {
    const r = await runForecast({
      city: state.city,
      dateStr: state.dateStr,
      period: state.period,
      force
    });
    if (!r.ok) {
      state.error = r.error;
      state.result = null;
    } else {
      state.result = r;
      refreshSnap();
      syncUrl();
    }
  } catch (e) {
    state.error = String(e);
  } finally {
    state.loading = false;
  }
}

function refreshSnap() {
  const r = state.result;
  if (!r) {
    snapUrl.value = "";
    return;
  }
  const input: SnapInput = {
    dateStr: r.dateStr,
    period: r.period,
    lat: r.city.lat,
    lon: r.city.lon,
    name: r.city.name,
    region: r.city.region,
    offsetS: r.tz.offsetSec,
    P: r.P,
    Q: r.Q,
    consist: r.consist,
    dvI: r.dvI,
    spread: r.spread,
    spreadQ: r.spreadQ,
    primaryLevel: r.sRT.primary.level,
    primaryType: r.sRT.primary.type,
    primaryBase: r.sRT.primary.base,
    dKm: r.sRT.d,
    durMin: r.sRT.geom.dur,
    factors: r.factorRows.map((x) => ({ k: x[0], v: x[1], s: x[2] }))
  };
  const s = snapEncode(input);
  snapUrl.value = s
    ? location.href.split("#")[0].split("?")[0] + baseQuery() + "&snap=" + s
    : "";
  // 解码自检
  if (s) {
    const d = snapDecode(s);
    snapMsg.value = d
      ? `快照互通 OK · P=${Math.round(d.P)} Q=${Math.round(d.Q)}`
      : "快照解码失败";
  }
}

async function copySnap() {
  if (!snapUrl.value) return;
  try {
    await navigator.clipboard.writeText(snapUrl.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1800);
  } catch {
    snapMsg.value = "复制失败，请手动复制";
  }
}

/* URL 带 snap= 时优先展示快照（不重新取数、不烧额度） */
function tryLoadSnap(): boolean {
  const u = applyUrlState();
  if (u.snap) {
    snapView.value = u.snap;
    const d = u.snap;
    snapMsg.value = `这是 ${d.date} ${d.period === "am" ? "朝霞" : "晚霞"} 的计算结果（快照）· P=${Math.round(d.P)} Q=${Math.round(d.Q)}`;
    return true;
  }
  return false;
}

watch(
  () => [state.city.name, state.dateStr, state.period],
  () => {
    snapUrl.value = "";
  }
);

/* 换城市：日期若还停在「上一座城市的今天」，就跟到新城市的今天 */
watch(
  () => state.city,
  (n, o) => {
    if (n && o && n.name !== o.name) reanchorToday(o);
  }
);

/* ---------- 默认城市：用户当前定位；不可用则广州市 ---------- */
function geoOnce(timeout = 3500): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    const timer = setTimeout(() => resolve(null), timeout);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        resolve({ lat: p.coords.latitude, lon: p.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { timeout, maximumAge: 600000, enableHighAccuracy: false }
    );
  });
}

/** URL 指定坐标 > 已保存城市 > 定位（就近城市，200km 外记“我的位置”）> 广州市 */
async function resolveCity(): Promise<void> {
  const u = readUrl();
  if (u.lat != null && u.lon != null) {
    /* URL 里只带 name / lat / lon，**省区没进 URL** —— 早前直接拼对象，分享链接打开后
       城市名后面就少了「· 广东省」。坐标能对上城市库就用库里的条目（省区与规范名一起回来），
       对不上（地图点选/任意坐标）就按最近城市补省区。 */
    const hit = cityByName(u.name || "");
    if (hit && Math.abs(hit.lat - u.lat) < 0.01 && Math.abs(hit.lon - u.lon) < 0.01) {
      state.city = hit;
      return;
    }
    const near = nearestCity(u.lat, u.lon, CITIES);
    state.city = {
      name: u.name || "我的位置", lat: u.lat, lon: u.lon,
      region: near && near.distKm <= 200 ? near.city.region : ""
    };
    return;
  }
  if (hasSavedCity()) return;
  const pos = await geoOnce();
  if (pos) {
    const near = nearestCity(pos.lat, pos.lon, CITIES);
    if (near && near.distKm <= 200) state.city = near.city;
    else state.city = { name: "我的位置", lat: pos.lat, lon: pos.lon, region: "" };
  } else {
    state.city = cityByName("广州市") || CITIES[0];
  }
}

onMounted(async () => {
  await resolveCity();
  /* 默认日期按**城市当地**的今天（不是浏览器今天）：北京时间 10-21 时，
     纽约此刻可能还是 10-20，用本机日期会默认「明天」。URL 明确给了 date 就不动。 */
  const u = readUrl();
  if (!u.date) {
    const t0 = todayInTz(cityTz(state.city.lat, state.city.lon));
    state.dateStr = t0;
    state.mapDateS = t0;
  }
  if (!tryLoadSnap()) run();
  armReveal();
});
</script>

<template>
  <HeroSection @run="run" />

  <div class="wrap" style="margin-top: -8px; margin-bottom: 8px">
    <div v-if="snapMsg" class="pill" style="gap: 10px">
      <span>{{ snapMsg }}</span>
      <button v-if="snapUrl" class="btn btn-ghost" style="padding: 2px 10px" @click="copySnap">
        {{ copied ? t("已复制") : t("复制链接") }}
      </button>
    </div>
  </div>

  <!-- 快照结果卡：与V1 renderSnap 同信息集，打开快照不重新取数 -->
  <section v-if="snapView" class="section" style="padding-top: 8px">
    <div class="wrap">
      <div class="glass snap-card">
        <div class="pill">{{ t("快照模式") }} · SNAP_VER=1</div>
        <h2 style="margin: 12px 0 6px">
          {{ pointName(snapView.name, state.lang) }} {{ snapView.date }}
          {{ snapView.period === "am" ? t("朝霞") : t("晚霞") }}
        </h2>
        <p class="snap-sub">
          {{ t("生成于") }} {{ new Date(snapView.gen).toLocaleString() }} ·
          {{ t("打开快照链接不会重新取数，因此不消耗接口额度。") }}
        </p>
        <div class="snap-grid">
          <div class="metric">
            <span class="num" style="color: var(--acc-1)">{{ Math.round(snapView.P) }}%</span>
            <span class="lab">{{ t("出现概率") }}</span>
          </div>
          <div class="metric">
            <span class="num" style="color: var(--acc-2)">{{ Math.round(snapView.Q) }}</span>
            <span class="lab">{{ t("观赏质量") }}</span>
          </div>
          <div class="metric">
            <span class="num" style="color: var(--acc-3)">{{ snapView.consist }}</span>
            <span class="lab">{{ t("一致性") }}</span>
          </div>
          <div class="metric">
            <span class="num" style="color: var(--tx-2)">
              {{ snapView.dvI != null ? snapView.dvI.toFixed(1) : "—" }}
            </span>
            <span class="lab">{{ t("分歧 ΔI") }}</span>
          </div>
        </div>
        <div v-if="snapView.factors.length" class="snap-fac">
          <div v-for="f in snapView.factors" :key="f.k" class="sf">
            <span>{{ t(SNAP_FAC_NAME[f.k] || f.k) }}</span>
            <b>{{ snapFacFmt(f.k, f.v) }}</b>
            <em class="fj" :class="judgmentOf(f.s).cls">{{ t(judgmentOf(f.s).key) }}</em>
            <i :style="{ width: (f.s != null ? f.s * 100 : 0) + '%' }" />
          </div>
        </div>
        <button class="btn btn-primary" style="margin-top: 16px" @click="snapView = null; run()">
          {{ t("按当前条件重新计算") }}
        </button>
      </div>
    </div>
  </section>

  <template v-else>
    <ConclusionCard class="reveal" @refetch="run(true)" />
    <TrendSection class="reveal" />
    <MapView class="reveal" />
    <ComparePanel class="reveal" />
    <FactorsPanel class="reveal" />
    <CalibPanel class="reveal" />
    <RayDetail class="reveal" />
    <NotesCard class="reveal" />
  </template>

  <section class="section" style="padding-top: 0">
    <div class="wrap">
      <div class="glass" style="padding: 26px 28px; display: flex; flex-wrap: wrap; gap: 18px; align-items: center; justify-content: space-between">
        <div>
          <h3 style="margin: 0 0 6px">{{ t("分享快照") }}</h3>
          <p style="margin: 0; color: var(--tx-2); font-size: var(--fs-small)">
            {{ t("生成的链接与 Sunglow Classic Edition（V1）互通（SNAP_VER=1），对方无需重新取数即可查看。") }}
          </p>
        </div>
        <button class="btn btn-primary" :disabled="!snapUrl" @click="copySnap">
          {{ copied ? t("已复制") : t("复制链接") }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.snap-card {
  padding: 26px 28px;
}
.snap-sub {
  color: var(--tx-2);
  font-size: var(--fs-small);
  margin: 0 0 18px;
}
.snap-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}
@media (max-width: 640px) {
  .snap-grid { grid-template-columns: repeat(2, 1fr); }
}
.snap-fac {
  margin-top: 18px;
  display: grid;
  gap: 8px;
}
.sf {
  display: grid;
  grid-template-columns: 150px 1fr auto 90px;
  gap: 10px;
  align-items: center;
  font-size: var(--fs-small);
  color: var(--tx-2);
}
.sf i {
  height: 5px;
  border-radius: 3px;
  background: var(--spectrum);
}
/* 判定 pill（与因素面板同款） */
.fj {
  font-style: normal;
  font-size: var(--fs-tiny);
  line-height: 1.6;
  padding: 1px 9px;
  border-radius: 999px;
  border: 1px solid currentColor;
  white-space: nowrap;
}
.j-ok { color: var(--q-good); }
.j-mid { color: var(--q-mid); }
.j-bad { color: var(--q-bad); }
.j-miss { color: var(--tx-3); }
@media (max-width: 640px) {
  .sf {
    grid-template-columns: 1fr auto;
    grid-template-areas: "name judge" "val bar";
  }
  .sf span { grid-area: name; }
  .sf b { grid-area: val; }
  .sf .fj { grid-area: judge; justify-self: end; }
  .sf i { grid-area: bar; }
}
</style>
