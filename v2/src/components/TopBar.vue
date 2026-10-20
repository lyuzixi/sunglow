<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import SettingsPanel from "./SettingsPanel.vue";
import { state, setLangAndSave, setThemeAndSave, type ThemeMode } from "../state";
import { t, LANGS, LANG_SHORT, LANG_NAMES, type Lang } from "../core/i18n";

const langOpen = ref(false);
const themeOpen = ref(false);
const rootEl = ref<HTMLElement | null>(null);

/* ---- 移动端目录抽屉（≤760px 替代导航） ---- */
const drawerOpen = ref(false);
const drawerTop = ref(88);
const headerEl = ref<HTMLElement | null>(null);

function syncDrawerTop() {
  const h = headerEl.value?.getBoundingClientRect().height;
  if (h) drawerTop.value = Math.round(h);
}
function toggleDrawer() {
  drawerOpen.value = !drawerOpen.value;
  if (drawerOpen.value) syncDrawerTop();
}
function closeDrawer() {
  drawerOpen.value = false;
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && drawerOpen.value) closeDrawer();
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
function onDoc(e: MouseEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) {
    langOpen.value = false;
    themeOpen.value = false;
  }
}
onMounted(() => {
  document.addEventListener("click", onDoc);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", syncDrawerTop);
  syncDrawerTop();
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDoc);
  document.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", syncDrawerTop);
  lockScroll(false);
});

const themeIcon = () =>
  state.theme === "dark" ? "☾" : state.theme === "light" ? "☀" : "◐";
const themeLabel = () =>
  state.theme === "dark"
    ? t("深色")
    : state.theme === "light"
      ? t("浅色")
      : t("跟随系统");
</script>

<template>
  <header class="topbar" ref="headerEl">
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
        <a href="#verdict">{{ t("结论") }}</a>
        <a href="#trend">{{ t("十日趋势") }}</a>
        <a href="#field">{{ t("观测场") }}</a>
      </nav>

      <div class="top-actions">
        <SettingsPanel />
        <div style="position: relative">
          <button
            class="icon-btn"
            :aria-label="t('语言')"
            @click.stop="langOpen = !langOpen; themeOpen = false"
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
            @click.stop="themeOpen = !themeOpen; langOpen = false"
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
          class="icon-btn"
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
      </div>
    </div>

    <!-- 徽标：当前地点 · 日期 · 朝/晚霞（原版同款：纯文字、右对齐、独占一行） -->
    <div class="wrap topbar-meta">
      <span>{{ state.city.name }}</span>
      <i>·</i>
      <span>{{ state.dateStr }}</span>
      <i>·</i>
      <span>{{ t(state.period === "am" ? "朝霞" : "晚霞") }}</span>
    </div>
  </header>

  <!-- 移动端目录：遮罩 + 贴顶栏下缘的面板（原版同款交互） -->
  <div v-if="drawerOpen" class="mdrawer-mask" @click="closeDrawer" />
  <div
    id="mnav"
    class="mdrawer"
    :class="{ on: drawerOpen }"
    :style="{ top: drawerTop + 'px' }"
    role="dialog"
    :aria-label="t('目录')"
  >
    <nav class="mdrawer-nav">
      <a href="#verdict" @click="closeDrawer">{{ t("结论") }}</a>
      <a href="#trend" @click="closeDrawer">{{ t("十日趋势") }}</a>
      <a href="#field" @click="closeDrawer">{{ t("观测场") }}</a>
      <a href="./tutorial.html">{{ t("使用教程") }}</a>
    </nav>
  </div>
</template>
