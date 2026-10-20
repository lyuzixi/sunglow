<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import SettingsPanel from "./SettingsPanel.vue";
import { state, setLangAndSave, setThemeAndSave, type ThemeMode } from "../state";
import { t, LANGS, LANG_SHORT, LANG_NAMES, type Lang } from "../core/i18n";

const langOpen = ref(false);
const themeOpen = ref(false);
const rootEl = ref<HTMLElement | null>(null);

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
onMounted(() => document.addEventListener("click", onDoc));
onBeforeUnmount(() => document.removeEventListener("click", onDoc));

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
  <header class="topbar">
    <div class="wrap topbar-in" ref="rootEl">
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
</template>
