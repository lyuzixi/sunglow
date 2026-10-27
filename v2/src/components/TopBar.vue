<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import SettingsPanel from "./SettingsPanel.vue";
import { state, setLangAndSave, setThemeAndSave, setFold, type ThemeMode } from "../state";
import { t, LANGS, LANG_SHORT, LANG_NAMES, type Lang } from "../core/i18n";
import { cityName } from "../core/citylang";

/* 徽标三段：地点 / 日期 / 朝晚霞。宽屏在主行按钮右侧；手机（mode-mini）
   连这一行都放不下，顶栏干脆不显示徽标 —— 改由抽屉顶部的状态行承担。
   地点随语言走：英文 Beijing / 繁体 廣州市（口径见 citylang.ts）。 */
const metaParts = computed(() => [
  cityName(state.city.name, state.lang),
  state.dateStr,
  t(state.period === "am" ? "朝霞" : "晚霞")
]);
const metaTitle = computed(() => metaParts.value.join(" · "));

/* ---- 桌面/抽屉共用的目录项（顺序 = 页面顺序，单一口径） ----
   full 只在抽屉里用：桌面顶栏宽度是硬预算（长标签会把「收紧档」下限从 1000 抬到 1050），
   所以桌面写短标签、抽屉保留全称（2026-10-26 定）。 */
const NAV: { id: string; label: string; full?: string; fold?: string }[] = [
  { id: "#verdict", label: "结论" },
  { id: "#trend", label: "十日趋势" },
  { id: "#field", label: "观测场" },
  { id: "#compare", label: "多地对比" },
  { id: "#factors", label: "影响因素" },
  { id: "#calib", label: "实况校准" },
  /* 与 RayDetail.vue 的 FoldCard anchor 对应；fold 让 jumpTo 能就地展开收起卡 */
  { id: "#ray", label: "光追细节", full: "光追算法细节", fold: "rayFold" }
];

function navLabel(n: { label: string; full?: string }, inDrawer: boolean) {
  return inDrawer ? (n.full || n.label) : n.label;
}

/* 只在抽屉里出现的入口（不进桌面导航）：附注是页尾的技术说明，桌面顶栏放不下 */
const DETAIL_NAV: { id: string; label: string; fold: string }[] = [
  { id: "#notes", label: "附注", fold: "notesFold" }
];

const settingsOpen = ref(false);
const langOpen = ref(false);
const themeOpen = ref(false);
const rootEl = ref<HTMLElement | null>(null);

/* ---- 移动端目录抽屉（≤860px 替代导航） ---- */
const drawerOpen = ref(false);
const drawerTop = ref(88);
const headerEl = ref<HTMLElement | null>(null);

function syncDrawerTop() {
  const h = headerEl.value?.getBoundingClientRect().height;
  if (h) drawerTop.value = Math.round(h);
}

/* ---- 顶栏四态：单行 → 收紧 → 汉堡 → 手机极简（逐级降级，JS 判，CSS 只管长相） ----
   为什么不用 media query 写死：宽度预算不是常量 —— 英文导航比中文宽 251px
   （单行需 1373px，而 .wrap 封顶 1180，**英文永远不可能走单行**），
   11 字州名还会再加约 100px。所以只按「放不放得下」逐级试。
   最后一档 mini 是手机兜底：**顶栏不再显示徽标**（340px 容器里放不下胶囊，
   折回第二行会留下整片空白），状态改由抽屉顶部的一行承担。
   高度只有两档：单行 63（one/tight/menu/mini 同高，手机 57）/ 无更高档。 */
type Mode = "one" | "tight" | "menu" | "mini";
const mode = ref<Mode>("one");
const MODES: Mode[] = ["one", "tight", "menu", "mini"];
let refitRaf = 0;
let ro: ResizeObserver | null = null;

function applyTopbarHeight() {
  const h = headerEl.value?.getBoundingClientRect().height;
  if (h) document.documentElement.style.setProperty("--topbar-h", Math.round(h) + "px");
}

/* 单行是否「挤爆」= 横向溢出 OR 内部折行。
   只看 scrollWidth 不够：flex 项会先缩到 min-content 再换行，溢出量恒为 0，
   而英文导航（Verdict / Contributing Factors / Field Calibration）与品牌名
   （Glow Forecast）正是这样被折成两行塞进 62px 的 —— 肉眼很难看，量却看不见。 */
function isSqueezed(el: HTMLElement) {
  const inn = el.querySelector<HTMLElement>(".topbar-in");
  if (inn && inn.scrollWidth - inn.clientWidth > 0) return true;
  const links = [...el.querySelectorAll<HTMLElement>(".nav-tabs a")];
  if (links.length > 1) {
    const tops = new Set(links.map((a) => Math.round(a.getBoundingClientRect().top)));
    if (tops.size > 1) return true;
  }
  const name = el.querySelector<HTMLElement>(".brand .name");
  if (name) {
    const cs = getComputedStyle(name);
    let lh = parseFloat(cs.lineHeight);
    if (!isFinite(lh)) lh = parseFloat(cs.fontSize) * 1.4;
    if (name.getBoundingClientRect().height > lh * 1.35) return true;
  }
  return false;
}

/* 从最宽形态「单行」开始逐级试，第一个不挤的就是答案。
   每级都要重新渲染再量；await nextTick 全在微任务里跑完，浏览器一次都没绘制，
   所以看不到中间态闪烁。最后一档 mini 是手机兜底：到这一档已经无路可退，
   即便 320px 这种超窄屏仍然挤，也停在这里（品牌名会折行，但不会横向溢出）。 */
let refitting = false;
async function refit() {
  const el = headerEl.value;
  if (!el || refitting) return;
  refitting = true;
  try {
    const trace: string[] = [];
    for (const m of MODES) {
      if (mode.value !== m) {
        mode.value = m;
        await nextTick();
      }
      const sq = isSqueezed(el);
      trace.push(m + (sq ? "!" : ""));
      if (!sq) break;
    }
    /* 调试钩子（与 __gcBox / __gcAzi 同惯例）：探针据此断言「判定链走到哪一级」，
       也方便日后复现某宽度为什么落到这个形态。 */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__gcFit = trace.join(">");
  } finally {
    refitting = false;
  }
  applyTopbarHeight();
  syncDrawerTop();
}
function scheduleRefit() {
  if (refitRaf) return;
  refitRaf = requestAnimationFrame(() => {
    refitRaf = 0;
    void refit();
  });
}

/* 顶栏同一时刻只开一个浮层：抽屉 / 设置 / 语言 / 主题 互斥 */
function closeOverlays(keep?: "settings" | "lang" | "theme" | "drawer") {
  if (keep !== "settings") settingsOpen.value = false;
  if (keep !== "lang") langOpen.value = false;
  if (keep !== "theme") themeOpen.value = false;
  if (keep !== "drawer") drawerOpen.value = false;
}
function toggleSettings() {
  const next = !settingsOpen.value;
  closeOverlays("settings");
  settingsOpen.value = next;
  if (next) syncDrawerTop();
}
function toggleLang() {
  const next = !langOpen.value;
  closeOverlays("lang");
  langOpen.value = next;
}
function toggleTheme() {
  const next = !themeOpen.value;
  closeOverlays("theme");
  themeOpen.value = next;
}
function toggleDrawer() {
  const next = !drawerOpen.value;
  closeOverlays("drawer");
  drawerOpen.value = next;
  if (next) syncDrawerTop();
}
function closeDrawer() {
  drawerOpen.value = false;
}

/* 站内跳转：**不能**用原生 href="#id" —— 本项目是 hash 路由（createWebHashHistory），
   #verdict 会被当成路由 /verdict，落到 404。改成滚动定位。 */
function jumpTo(id: string, close = false) {
  if (close) closeDrawer();
  /* 点中默认收起的卡 = 明确意图，就地展开并写偏好（与V1同款） */
  const det = NAV.find((d) => d.id === id) || DETAIL_NAV.find((d) => d.id === id);
  if (det?.fold && state.folds[det.fold]) setFold(det.fold, false);
  if (NAV.some((n) => n.id === id)) active.value = id;
  const el = document.querySelector(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---- 当前小节高亮：IO 只当「有变化」的信号，判定用几何量，结果可复现 ---- */
const active = ref("");
/* .section 的 scroll-margin-top = --topbar-h + 26px（CSS 单一来源）；
   判定线取它再往下 12px，这样点导航跳过去之后当前节能立刻正确归位。
   顶栏现在有两种高度（宽屏单行 63 / 折回两行 86 / 手机 80），不能写死。 */
function spyLine() {
  const h = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h"));
  return (isFinite(h) && h > 0 ? h : 63) + 38;
}
let io: IntersectionObserver | null = null;
let rafId = 0;

function computeActive() {
  let cur = "";
  let last = "";
  const line = spyLine();
  for (const n of NAV) {
    const el = document.querySelector(n.id);
    if (!el) continue; /* 快照模式下若干 section 不存在，直接跳过 */
    last = n.id;
    if (el.getBoundingClientRect().top <= line) cur = n.id;
  }
  /* 到底兜底：页尾那几节顶不到判定线（后面只剩分享卡和页脚），
     不做这一步高亮会永远卡在倒数第二节 */
  const doc = document.documentElement;
  if (last && doc.scrollHeight > window.innerHeight + 8) {
    const bottom = window.scrollY + window.innerHeight >= doc.scrollHeight - 4;
    if (bottom) cur = last;
  }
  active.value = cur;
}
function scheduleSpy() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    computeActive();
  });
}
/* router-view 会随语言/主题重挂，观测目标要重新收集 */
function refreshSpyTargets() {
  io?.disconnect();
  io = null;
  if (typeof IntersectionObserver !== "undefined") {
    io = new IntersectionObserver(() => scheduleSpy(), {
      threshold: [0, 0.2, 0.5, 1],
      rootMargin: "-15% 0px -15% 0px"
    });
    for (const n of NAV) {
      const el = document.querySelector(n.id);
      if (el) io.observe(el);
    }
  }
  computeActive();
}
watch(
  () => state.lang + state.theme,
  () => nextTick(refreshSpyTargets)
);
/* 语言/地点/日期都会改变徽标与导航的字宽 —— 折回判定必须跟着重算 */
watch(
  () => state.lang + state.city.name + state.dateStr + (state.period === "am"),
  () => nextTick(scheduleRefit)
);

function onKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  closeOverlays();
}
/* 点浮层外面收卡：面板与菜单都挂在 .topbar-in 里，contains() 自然放行面板内部点击 */
function onDoc(e: MouseEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) closeOverlays();
}
/* 抽屉打开时锁住背景滚动：面板本身不加滚动容器，避免和 body 抢滚动 */
let prevOverflow = "";
function lockScroll(on: boolean) {
  if (on) { prevOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
  else { document.body.style.overflow = prevOverflow || ""; }
}
watch(drawerOpen, (v) => lockScroll(v));

function pickLang(l: Lang) {
  setLangAndSave(l);
  langOpen.value = false;
}
function pickTheme(m: ThemeMode) {
  setThemeAndSave(m);
  themeOpen.value = false;
}

onMounted(() => {
  document.addEventListener("click", onDoc);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", syncDrawerTop);
  window.addEventListener("scroll", scheduleSpy, { passive: true });
  window.addEventListener("resize", scheduleSpy);
  window.addEventListener("resize", scheduleRefit);
  syncDrawerTop();
  refreshSpyTargets();
  void refit();
  /* 光靠 resize 不够：首帧页面还没纵向滚动条，.topbar-in 量到 620px 判「放得下」，
     滚动条随之出现把宽度压成 610，品牌名就被挤成两行 —— 而没有任何事件再来重判。
     观察顶栏自身宽度，尺寸一变就重跑判定（refit 内部有重入锁，不会自激）。 */
  if (typeof ResizeObserver !== "undefined" && rootEl.value) {
    ro = new ResizeObserver(() => scheduleRefit());
    ro.observe(rootEl.value);
  }
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDoc);
  document.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", syncDrawerTop);
  window.removeEventListener("scroll", scheduleSpy);
  window.removeEventListener("resize", scheduleSpy);
  window.removeEventListener("resize", scheduleRefit);
  ro?.disconnect();
  ro = null;
  io?.disconnect();
  io = null;
  if (rafId) cancelAnimationFrame(rafId);
  if (refitRaf) cancelAnimationFrame(refitRaf);
  lockScroll(false);
});

const themeIcon = () =>
  state.theme === "dark" ? "☾" : state.theme === "light" ? "☀" : "◐";
</script>

<template>
  <header class="topbar" ref="headerEl" :class="'mode-' + mode">
    <div class="wrap topbar-in" ref="rootEl">
      <button
        class="hamburger"
        :aria-expanded="drawerOpen"
        aria-controls="mnav"
        :aria-label="t('目录')"
        :title="t('目录')"
        @click.stop="toggleDrawer"
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      <router-link class="brand" to="/">
        <span class="logo" aria-hidden="true" />
        <span class="name">
          {{ t("霞光预报") }}<em>GLOWCAST</em>
        </span>
      </router-link>

      <nav class="nav-tabs">
        <a
          v-for="n in NAV"
          :key="n.id"
          :href="n.id"
          :class="{ on: active === n.id }"
          :aria-current="active === n.id ? 'true' : undefined"
          @click.prevent="jumpTo(n.id)"
        >{{ t(n.label) }}</a>
      </nav>

      <div class="top-actions">
        <SettingsPanel v-model="settingsOpen" @toggle="toggleSettings" />
        <div style="position: relative">
          <button
            class="icon-btn"
            :aria-label="t('语言')"
            :aria-expanded="langOpen"
            @click.stop="toggleLang"
          >
            {{ LANG_SHORT[state.lang] }}
          </button>
          <div v-if="langOpen" class="menu-pop" role="menu">
            <button
              v-for="l in LANGS"
              :key="l"
              role="menuitemradio"
              :aria-pressed="state.lang === l"
              @click="pickLang(l)"
            >
              <span>{{ LANG_NAMES[l] }}</span>
              <span v-if="state.lang === l">✓</span>
            </button>
          </div>
        </div>

        <div style="position: relative">
          <button
            class="icon-btn"
            :aria-label="t('主题')"
            :aria-expanded="themeOpen"
            @click.stop="toggleTheme"
          >
            {{ themeIcon() }}
          </button>
          <div v-if="themeOpen" class="menu-pop" role="menu">
            <button
              v-for="m in (['dark', 'light', 'system'] as ThemeMode[])"
              :key="m"
              role="menuitemradio"
              :aria-pressed="state.theme === m"
              @click="pickTheme(m)"
            >
              <span>{{ m === "dark" ? t("深色") : m === "light" ? t("浅色") : t("跟随系统") }}</span>
              <span v-if="state.theme === m">✓</span>
            </button>
          </div>
        </div>

        <a
          class="icon-btn tut-btn"
          href="./tutorial.html"
          :aria-label="t('使用教程')"
          :title="t('使用教程')"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15.5H6.5A2.5 2.5 0 0 0 4 21z" />
            <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H19" />
            <path d="M8 7.5h7" />
          </svg>
        </a>

        <!-- 徽标：幽灵胶囊，跟在四按钮右侧（mode-mini 下整块隐藏） -->
        <span class="meta-pill" :title="metaTitle" :aria-label="metaTitle">
          <template v-for="(p, i) in metaParts" :key="i">
            <i v-if="i" class="dot">·</i><span>{{ p }}</span>
          </template>
        </span>
      </div>
    </div>
  </header>

  <!-- 移动端目录：左侧抽屉（分组 + 细线分隔，参考V1）
       armed 跟着形态走（menu / mini）：不用 @media 写死 860，否则「861–915 收紧也放不下」
       时会既没导航也没汉堡。mini 额外藏掉顶栏的教程按钮，入口就在下面「指南」组里。 -->
  <div v-if="drawerOpen" class="mdrawer-mask" @click="closeDrawer" />
  <aside
    id="mnav"
    class="mdrawer"
    :class="{ on: drawerOpen, armed: mode === 'menu' || mode === 'mini' }"
    :style="{ top: drawerTop + 'px' }"
    role="dialog"
    :aria-label="t('目录')"
  >
    <!-- 手机（mode-mini）顶栏不显示徽标，状态在这里补回来，滚动到任何位置都能一键看到 -->
    <div v-if="mode === 'mini'" class="md-status" :title="metaTitle">
      <template v-for="(p, i) in metaParts" :key="i">
        <i v-if="i">·</i><span>{{ p }}</span>
      </template>
    </div>

    <div class="md-label">{{ t("目录") }}</div>

    <div class="md-group">
      <h4>{{ t("主结果") }}</h4>
      <a
        v-for="n in NAV.slice(0, 5)"
        :key="n.id"
        :href="n.id"
        @click.prevent="jumpTo(n.id, true)"
      ><span>{{ t(navLabel(n, true)) }}</span></a>
    </div>

    <div class="md-group">
      <h4>{{ t("技术细节") }}</h4>
      <a
        v-for="n in NAV.slice(5)"
        :key="n.id"
        :href="n.id"
        @click.prevent="jumpTo(n.id, true)"
      ><span>{{ t(navLabel(n, true)) }}</span></a>
      <a
        v-for="n in DETAIL_NAV"
        :key="n.id"
        :href="n.id"
        @click.prevent="jumpTo(n.id, true)"
      ><span>{{ t(n.label) }}</span></a>
    </div>

    <div class="md-group">
      <h4>{{ t("指南") }}</h4>
      <a class="ext" href="./tutorial.html"><span>{{ t("使用教程") }}</span><i class="arw">↗</i></a>
    </div>
  </aside>
</template>
