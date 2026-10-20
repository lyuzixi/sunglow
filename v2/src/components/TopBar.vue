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
        <a href="#sky">{{ t("天色带") }}</a>
        <a href="#trend">{{ t("七日趋势") }}</a>
        <a href="#field">{{ t("观测场") }}</a>
        <a href="./tutorial.html">{{ t("使用教程") }}</a>
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
      </div>
    </div>
  </header>
</template>
