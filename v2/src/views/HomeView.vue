<script setup lang="ts">
import { computed, nextTick, onMounted, provide, ref, watch } from "vue";
import HeroSection from "../components/HeroSection.vue";
import ConclusionCard from "../components/ConclusionCard.vue";
import TrendSection from "../components/TrendSection.vue";
import MapView from "../components/MapView.vue";
import ComparePanel from "../components/ComparePanel.vue";
import FactorsPanel from "../components/FactorsPanel.vue";
import CalibPanel from "../components/CalibPanel.vue";
import RayDetail from "../components/RayDetail.vue";
import NotesCard from "../components/NotesCard.vue";
import ShareQrDialog from "../components/ShareQrDialog.vue";
import ShareComposer from "../components/ShareComposer.vue";
import { state, hasSavedCity, hasSavedMapDate, reanchorToday, dataStamp } from "../state";
import { nearestCity, cityByName, CITIES } from "../core/city";
import { runForecast } from "../core/forecast";
import { cityTz, todayInTz } from "../core/tz";
import { verdictViewOf } from "../core/verdict";
import { captionOf, saveIcs } from "../core/shareextras";
import { snapEncode, type SnapInput, type SnapData } from "../core/snap";
import { t } from "../core/i18n";
import { pointName } from "../core/citylang";
import { armReveal } from "../composables/useReveal";
import {
  applyUrlState, syncUrl, baseQuery, readUrl, shareBaseUrl, SHARE_SITE, readPackRaw
} from "../core/urlstate";
import {
  buildSharePack, installSharePack, exitSnapshot, isSnapshot,
  snapInfo, qrSafeUrl, PACK_PARAM, type SnapPackInfo
} from "../core/snapshot";

const snapUrl = ref("");
const copied = ref(false);
/** 旧版（V1 互通）精简快照：只用于横幅里的一行结论摘要，不再单独成页 */
const legacySnap = ref<SnapData | null>(null);
const qrOpen = ref(false);
const copiedText = ref(false);
const icsDone = ref(false);
/* 复制被浏览器拒绝时的兜底：把链接显示成可选中的输入框，绝不静默失败 */
const linkFallback = ref("");
/** 本次链接里打包了哪些板块（分享卡显示 + 一键补齐的依据） */
const packMeta = ref<{ parts: string[]; mapStride: number; chars: number } | null>(null);

const PACK_PART_LABEL: Record<string, string> = {
  point: "结论与影响因素", trend: "十日趋势", map: "观测场", compare: "多观测点对比"
};
const ALL_PARTS = ["point", "trend", "map"];
const packedLabels = computed(() =>
  (packMeta.value?.parts || []).map((p) => t(PACK_PART_LABEL[p] || p))
);
const missingParts = computed(() =>
  ALL_PARTS.filter((p) => !(packMeta.value?.parts || []).includes(p))
);
const inSnap = computed(() => isSnapshot() || legacySnap.value !== null);

/* 是否由 file:// 直接打开（双击根 index.html）。只用来显示一条说明，
   不再禁用按钮 —— 分享链接的 host 由 shareBaseUrl() 统一换成线上站点。 */
const isLocalFile = typeof location !== "undefined" && location.protocol === "file:";
/* 「复制链接」与「二维码」共用同一句提示（键即简体原文，繁体/英文在 i18n-extra 里） */
const LOCAL_SHARE_TIP =
  "当前从本地文件打开，复制链接与二维码会自动指向 {site}，对方打开即可查看快照，无需重新取数。";
const NO_SNAP_TIP = "先算出结果，才能生成分享链接：点上方「重新计算」取得本次预报。";

/* 底部分享区与快照链接同一口径：综合结论（模型切换只在结论卡内生效） */
const shareView = computed(() =>
  state.result ? verdictViewOf(state.result, "ens") : null
);
const caption = computed(() => {
  const r = state.result;
  const v = shareView.value;
  return r && v ? captionOf(r, v) : "";
});

/* ---------- 结果落地时的视口锚定 ----------
   首屏取数前，结论 / 影响因素 / 光追三节都是空态：整页 6333px；结果一到，
   这三节长成完整卡片，整页变成 11737px（实测 390×844）。用户这时往往已经在往下滑，
   浏览器自带的滚动锚定只补回一部分（Chromium 实测视口仍会视觉跳 ~2100px），
   小米浏览器补得更差 —— 表现就是「滑动中突然跳到实况校准」。
   所以在写结果前后把视口顶部所在的那一节钉住：只有整页高度真的变了才动，
   且用瞬移、在绘制前完成，用户看不见。 */
type ViewAnchor = { el: HTMLElement | null; top: number; sh: number };

function captureViewAnchor(): ViewAnchor {
  const el =
    [...document.querySelectorAll<HTMLElement>(".section")].find((s) => {
      const r = s.getBoundingClientRect();
      /* 跨在视口里的那一节（底部还在视口内），或紧贴视口下方进入视口的那一节 */
      return r.bottom > 1 && r.top < window.innerHeight;
    }) || null;
  return {
    el,
    top: el ? el.getBoundingClientRect().top : 0,
    sh: document.documentElement.scrollHeight
  };
}

async function holdViewAnchor(a: ViewAnchor): Promise<void> {
  await nextTick();
  /* 还停在最顶上时，下方长高不会动到眼前内容，不必（也不该）补 */
  if (!a.el || window.scrollY < 1) return;
  if (Math.abs(document.documentElement.scrollHeight - a.sh) < 8) return;
  /* 浏览器已经做过的锚定补偿不再重复算 —— 这里只补残差 */
  const d = a.el.getBoundingClientRect().top - a.top;
  if (Math.abs(d) < 8) return;
  const root = document.documentElement;
  /* 全局 CSS 是 scroll-behavior:smooth；这一次必须瞬移（行为值 auto 会继承 CSS） */
  root.style.scrollBehavior = "auto";
  window.scrollTo(0, window.scrollY + d);
  root.style.scrollBehavior = "";
}

/* 单点预报竞态令牌：快速连续切换城市 / 日期时，先发的请求可能后到；
   只有「当前这一次」才允许写 state 与结束 loading（core 侧另有同一判据，
   见 forecast.ts 的 stillCurrent）。 */
let runSeq = 0;

async function run(force = false) {
  const seq = ++runSeq;
  const stillCurrent = () => seq === runSeq;
  state.loading = true;
  state.error = "";
  try {
    const r = await runForecast({
      city: state.city,
      dateStr: state.dateStr,
      period: state.period,
      useMock: state.useMock,
      force,
      stillCurrent
    });
    if (!stillCurrent()) return; /* 已被更新的请求取代：不覆写结果，loading 交给它收尾 */
    const anchor = captureViewAnchor();
    if (!r.ok) {
      state.error = r.error;
      state.result = null;
      snapUrl.value = ""; /* 本次没有结果，别把上一轮的快照链接留在页面上 */
    } else {
      state.result = r;
      void refreshSnap();
      syncUrl();
    }
    await holdViewAnchor(anchor);
  } catch (e) {
    if (!stillCurrent()) return;
    state.error = String(e);
  } finally {
    if (stillCurrent()) state.loading = false;
  }
}

/* 趋势最佳窗口点击后要重算：把它交给子组件，避免趋势区复制一套取数逻辑。
   约束不变 —— 只有用户显式点了某个窗口，才会触发这一次计算。 */
provide("sunglow.run", run);

/** 精简链接（SNAP_VER=1，与经典原版互通）—— 也是二维码超长时的降级目标 */
function liteUrlOf(s: string): string {
  return shareBaseUrl() + baseQuery() + "&snap=" + s;
}

/**
 * 生成分享链接：精简 snap= 放普通 query（老版本也能解），全功能 pack 放
 * hash query（不发给服务器，避开 8 KB 请求行上限）。对方打开后是完整主页。
 */
async function refreshSnap() {
  const r = state.result;
  if (!r) {
    snapUrl.value = "";
    packMeta.value = null;
    return;
  }
  /* 快照模式下冻结链接：转发收到的同一份，不拿被分享者的本地缓存重新打包 */
  if (isSnapshot()) return;
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
  if (!s) { snapUrl.value = ""; packMeta.value = null; return; }
  const built = await buildSharePack({
    lat: r.city.lat, lon: r.city.lon,
    date: r.dateStr, period: r.period,
    mapDate: state.mapDateS, name: r.city.name
  });
  const pack = built?.pack || "";
  snapUrl.value = liteUrlOf(s) + (pack ? "#/?" + PACK_PARAM + "=" + pack : "");
  packMeta.value = built
    ? { parts: built.info.parts, mapStride: built.info.mapStride, chars: built.pack.length }
    : null;
  linkFallback.value = "";
}

/** 趋势 / 观测场晚于结论卡落地：数据一到就重打包，链接自动包含新板块 */
watch(() => dataStamp.value, () => { if (!isSnapshot()) void refreshSnap(); });

/** 二维码容量约 3 KB；完整链接塞不下时退回精简链接，并明确告知 */
const qrUrl = computed(() => qrSafeUrl(snapUrl.value));
const qrLite = computed(() => qrUrl.value !== snapUrl.value);

/* 剪贴板在 file:// / 无权限 / 非安全上下文下可能不可用：先走 async API，
   再退 execCommand，最后把链接摆出来让用户手动复制。任何一步成功都要有可见反馈。 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 落到下一级回退 */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

async function copySnap() {
  if (!snapUrl.value) return;
  const ok = await writeClipboard(snapUrl.value);
  if (ok) {
    linkFallback.value = "";
    copied.value = true;
    setTimeout(() => (copied.value = false), 1800);
  } else {
    /* 不做 alert：模态框在手机上极易被忽略，看起来仍是「点了没反应」 */
    linkFallback.value = snapUrl.value;
  }
}

/* 二维码里装的就是 snapUrl；本地打开时它已指向线上站点，照常生成 */
function openQr() {
  if (!snapUrl.value) return;
  qrOpen.value = true;
}

/* 一键复制现成文案：今晚 18:32，广州晚霞概率 72%，良 */
async function copyCaption() {
  if (!caption.value) return;
  const ok = await writeClipboard(caption.value);
  if (ok) {
    copiedText.value = true;
    setTimeout(() => (copiedText.value = false), 1800);
  } else {
    alert(t("复制失败，请手动复制"));
  }
}

function onLinkFocus(e: Event) {
  (e.target as HTMLInputElement).select();
}

/* 加入日历：.ics 覆盖最佳观赏窗口，提前 30 分钟提醒 */
function addCalendar() {
  const r = state.result;
  const v = shareView.value;
  if (!r || !v) return;
  try {
    saveIcs(r, v, snapUrl.value);
    icsDone.value = true;
    setTimeout(() => (icsDone.value = false), 1800);
  } catch {
    alert(t("日历文件生成失败，请重试"));
  }
}

/* URL 带 pack= 时先安装全功能快照包，再照常跑一次 run()（会命中 overlay，
   零请求）。页面因此是完整主页，不再另起一张孤立的快照卡。
   只有旧的精简 snap= 时，横幅保留分享者的结论摘要，主页其余板块按当前条件查看。 */
async function tryLoadSnap(): Promise<void> {
  const u = applyUrlState();
  const rawSnap = new URLSearchParams(location.search).get("snap") || "";
  legacySnap.value = u.snap || null;
  const installed = await installSharePack(u.pack);
  if (installed && snapInfo.value) {
    const info = snapInfo.value as SnapPackInfo;
    const rawPack = u.pack || readPackRaw();
    snapUrl.value = (rawSnap ? liteUrlOf(rawSnap) : shareBaseUrl() + baseQuery()) +
      (rawPack ? "#/?" + PACK_PARAM + "=" + rawPack : "");
    packMeta.value = {
      parts: info.parts, mapStride: info.mapStride, chars: rawPack.length
    };
  } else if (rawSnap) {
    snapUrl.value = liteUrlOf(rawSnap);
    packMeta.value = null;
  }
}

/** 退出快照：抹掉 overlay 与 URL 里的 snap/pack，回到自己的缓存/重新取数 */
function exitSnap() {
  exitSnapshot();
  legacySnap.value = null;
  packMeta.value = null;
  snapUrl.value = "";
  try {
    const base = location.href.split("#")[0].split("?")[0];
    history.replaceState(null, "", base + baseQuery() + "#/");
  } catch { /* file:// */ }
  void run();
}

/** 一键补齐：显式事件（不自动取数），趋势与观测场各自判断是否已有数据 */
function fillAll() {
  window.dispatchEvent(new CustomEvent("sunglow:fill-snapshot"));
}

const genText = computed(() => {
  const ms = snapInfo.value?.gen || legacySnap.value?.gen || Date.now();
  return new Date(ms).toLocaleString();
});
const snapTitle = computed(() => {
  const s = snapInfo.value || legacySnap.value;
  const name = s ? pointName(s.name, state.lang) : "";
  const d = s ? s.date : "";
  const p = s ? (s.period === "am" ? t("朝霞") : t("晚霞")) : "";
  return [name, d, p].filter(Boolean).join(" ");
});
const bannerDesc = computed(() => t(
  snapInfo.value
    ? "这是分享者当时的完整缓存：结论、十日趋势、观测场、影响因素等板块已在本页还原，本次打开不消耗接口额度；各板块仍保留「缓存」标记。"
    : "这是经典原版的精简快照（只含结论数据）。主页其它板块按当前条件查看，点各板块的加载按钮即可取数。"
));
const bannerParts = computed(() => {
  if (!snapInfo.value) return [];
  const out = packedLabels.value.slice();
  if (snapInfo.value.mapStride > 1) out.push(t("观测场已按抽样精度压缩"));
  return out;
});

/* flush:"sync" 很关键：onMounted 里 resolveCity / applyUrlState 会先改城市与日期，
   异步 watch 会在 tryLoadSnap() 之后才跑，把刚生成的快照链接清空。 */
watch(
  () => [state.city.name, state.dateStr, state.period],
  () => {
    if (isSnapshot()) return; /* 快照模式分享的是同一个快照，不随参数切换失效 */
    snapUrl.value = "";
    linkFallback.value = "";
  },
  { flush: "sync" }
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
    /* 上次查看的观测场日期已写进偏好：有就别覆盖，否则缓存键的日期段变了，
       刷新后明明有缓存也读不到（2026-11-11）。 */
    if (!hasSavedMapDate()) state.mapDateS = t0;
  }
  await tryLoadSnap();
  /* 全功能快照也要跑一次：runForecast 会命中 overlay 里的单点结果，
     state.result 才有值，结论卡 / 影响因素 / 光追 / 分享卡才全部长出来。 */
  run();
  armReveal();
});
</script>

<template>
  <HeroSection @run="run" />

  <!-- 全功能快照：不再另起一张孤立结果卡，只在主页顶部加一条横幅说明。
       下方所有板块照常渲染，数据来自链接里的缓存包（零请求）。 -->
  <section v-if="inSnap" class="section snap-banner-sec" style="padding-top: 8px">
    <div class="wrap">
      <div class="glass snap-banner">
        <div class="sb-top">
          <span class="pill">{{ t("快照模式") }} · SNAP_VER=1</span>
          <b class="sb-title">{{ snapTitle }}</b>
          <span class="sb-gen">{{ t("生成于") }} {{ genText }}</span>
        </div>
        <p class="sb-desc">{{ bannerDesc }}</p>
        <div v-if="bannerParts.length" class="sb-parts">
          <span v-for="p in bannerParts" :key="p" class="sb-part">{{ p }}</span>
        </div>
        <div v-if="legacySnap && !snapInfo" class="sb-metrics">
          <span>{{ t("出现概率") }} <b>{{ Math.round(legacySnap.P) }}%</b></span>
          <span>{{ t("观赏质量") }} <b>{{ Math.round(legacySnap.Q) }}</b></span>
          <span>{{ t("一致性") }} <b>{{ legacySnap.consist }}</b></span>
        </div>
        <button class="btn btn-ghost sm" style="margin-top: 12px" @click="exitSnap">
          {{ t("退出快照，按当前条件查看") }}
        </button>
      </div>
    </div>
  </section>

  <ConclusionCard class="reveal" @refetch="run(true)" />
    <TrendSection class="reveal" />
    <MapView class="reveal" />
    <ComparePanel class="reveal" />

    <!-- 分享：2026-11-10 从页尾提上来，目录顺序＝页面顺序
         （多地对比 → 分享 → 影响因素）。id 供导航锚点用。
         四个动作都是同一款 .btn 按钮（复制链接 / 二维码 / 复制文案 / 加入日历），不拆成「更多」文字链。
         标题按其它板块的口径排在白卡外，说明文字（附注）与动作、合成面板仍留在同一张卡里。
         方案 D：合成分享卡面板紧跟其后，一张卡按块拼，产物永远 1 个文件。 -->
    <section id="share" class="section reveal">
      <div class="wrap">
        <div class="section-head">
          <h2>{{ t("分享") }}</h2>
        </div>
        <div class="glass" style="padding: 26px 28px">
          <div class="share-row">
            <div>
              <p style="margin: 0; color: var(--tx-2); font-size: var(--fs-small)">
                {{ t("生成的链接与 Sunglow Classic Edition（经典原版）互通（SNAP_VER=1），对方无需重新取数即可查看。") }}
              </p>
              <p v-if="isLocalFile" class="share-tip">{{ t(LOCAL_SHARE_TIP, { site: SHARE_SITE }) }}</p>
              <p class="share-tip">{{ t("二维码、文案与日历文件均由本机生成，不经过服务器。") }}</p>
            </div>
            <div class="share-acts">
              <button
                class="btn btn-primary"
                :disabled="!snapUrl"
                :title="!snapUrl ? t(NO_SNAP_TIP) : undefined"
                @click="copySnap"
              >
                {{ copied ? t("已复制") : t("复制链接") }}
              </button>
              <button
                class="btn btn-ghost"
                :disabled="!snapUrl"
                :title="!snapUrl ? t(NO_SNAP_TIP) : undefined"
                @click="openQr"
              >
                {{ t("二维码") }}
              </button>
              <button
                class="btn btn-ghost"
                :disabled="!shareView"
                :title="!shareView ? t(NO_SNAP_TIP) : undefined"
                @click="copyCaption"
              >
                {{ copiedText ? t("已复制") : t("复制文案") }}
              </button>
              <button
                class="btn btn-ghost"
                :disabled="!shareView"
                :title="!shareView ? t(NO_SNAP_TIP) : undefined"
                @click="addCalendar"
              >
                {{ icsDone ? t("已下载") : t("加入日历") }}
              </button>
            </div>
          </div>
          <!-- 全功能快照打包状态：缺哪块就给一个显式的补齐入口（绝不自动取数） -->
          <div class="share-pack">
            <span class="sp-lead">{{ t("链接内含") }}：</span>
            <span v-for="p in packedLabels" :key="p" class="sb-part">{{ p }}</span>
            <span v-if="!packedLabels.length" class="sp-empty">{{ t("尚无缓存数据") }}</span>
            <button
              v-if="!isSnapshot() && missingParts.length && snapUrl"
              class="linkbtn sp-fill"
              @click="fillAll"
            >{{ t("补齐全部数据（会取数）") }}</button>
          </div>
          <p v-if="!snapUrl" class="share-tip share-why">{{ t(NO_SNAP_TIP) }}</p>
          <p v-if="linkFallback" class="share-manual">
            {{ t("复制失败，请选中下面的链接手动复制") }}
            <input class="share-link" readonly :value="linkFallback" @focus="onLinkFocus" />
          </p>
          <!-- 合成面板与分享动作同一张卡：两卡叠放会在接缝处留下一截「过度连接」的空白 -->
          <ShareComposer :view="shareView" :url="snapUrl" />
        </div>
      </div>
    </section>

    <FactorsPanel class="reveal" />
    <RayDetail class="reveal" />
    <!-- 实况校准：目录里已撤下，页面位置改到光追之后、附注之前 -->
    <CalibPanel class="reveal" />
    <NotesCard class="reveal" />

  <ShareQrDialog
    :open="qrOpen" :url="qrUrl" :lite="qrLite"
    @close="qrOpen = false" @copy="copySnap"
  />
</template>

<style scoped>
/* ---- 全功能快照横幅：只是一条说明，主页其余板块照常排在下面 ---- */
.snap-banner { padding: 18px 22px; }
.sb-top {
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
}
.sb-title { font-size: var(--fs-body, 15px); color: var(--tx-1); }
.sb-gen { color: var(--tx-3); font-size: var(--fs-tiny); }
.sb-desc {
  margin: 10px 0 0; color: var(--tx-2); font-size: var(--fs-small); line-height: 1.7;
}
.sb-parts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.sb-part {
  font-size: var(--fs-tiny); color: var(--tx-2);
  border: 1px solid var(--stroke-2); border-radius: 999px;
  padding: 2px 10px; background: var(--bg-glass-2);
}
.sb-metrics {
  display: flex; flex-wrap: wrap; gap: 16px;
  margin-top: 10px; font-size: var(--fs-small); color: var(--tx-2);
}
.sb-metrics b { color: var(--tx-1); }
@media (max-width: 640px) {
  .sb-gen { width: 100%; }
}

/* ---- 分享 ---- */
.share-tip {
  margin: 6px 0 0;
  color: var(--tx-3);
  font-size: var(--fs-tiny);
}
/* 四个动作同排：主按钮 + 三个 ghost，窄屏自动换行；文字链版已撤 */
.share-row {
  display: flex; flex-wrap: wrap; gap: 18px;
  align-items: center; justify-content: space-between;
}
.share-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
.share-why {
  /* 链接没生成时把原因写在按钮下方（disabled 元素的 title 浏览器通常不显示） */
  margin: 10px 0 0;
  font-size: var(--fs-tiny);
}
.share-pack {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  margin-top: 12px; padding-top: 12px;
  border-top: 1px solid var(--stroke-1);
}
.sp-lead, .sp-empty { font-size: var(--fs-tiny); color: var(--tx-3); }
.sp-fill {
  margin-left: auto; padding: 2px 0;
  font-size: var(--fs-tiny); color: var(--acc-1);
  background: none; border: none; border-bottom: 1px solid currentColor;
  cursor: pointer;
}
.sp-fill:hover { color: var(--acc-2); }
.share-manual {
  display: grid;
  gap: 6px;
  margin: 10px 0 0;
  font-size: var(--fs-tiny);
  color: var(--tx-2);
}
.share-link {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--stroke-2);
  border-radius: var(--r-sm, 10px);
  background: var(--bg-glass-2);
  color: var(--tx-1);
  font-size: var(--fs-tiny);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (max-width: 720px) {
  /* 四个按钮 2×2 等宽：flex:1 1 auto 会把落单的第 4 个拉成整行长条 */
  .share-acts {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .share-acts .btn {
    min-width: 0;
    padding-inline: 10px;
  }
}
</style>
