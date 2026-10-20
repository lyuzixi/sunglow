<script setup lang="ts">
import { computed } from "vue";
import { state, setLangPref, setTheme } from "../state";
import { t, LANGS, LANG_SHORT, type Lang } from "../core/i18n";
import type { ThemePref } from "../state";

const themes: ThemePref[] = ["auto", "light", "dark"];
const themeLabel: Record<ThemePref, string> = {
  auto: "跟随系统", light: "浅色", dark: "深色"
};
const year = computed(() => new Date().getFullYear());
void year;
</script>

<template>
  <header class="topbar">
    <div class="wrap topbar-in">
      <a class="brand" href="#/">
        GLOWCAST <span class="v">V3</span><span class="cn">{{ t("追光航志") }}</span>
      </a>
      <nav class="topnav">
        <a href="#concl">{{ t("今晚") }}</a>
        <a href="#stage">{{ t("去哪拍") }}</a>
        <a href="#cal">{{ t("机会日历") }}</a>
        <a href="#conf">{{ t("可信度") }}</a>
      </nav>
      <div class="top-ctrl">
        <div class="seg" role="group" :aria-label="t('语言')">
          <button
            v-for="l in LANGS"
            :key="l"
            :class="{ on: state.lang === l }"
            :aria-pressed="state.lang === l"
            @click="setLangPref(l as Lang)"
          >{{ LANG_SHORT[l] }}</button>
        </div>
        <div class="seg" role="group" :aria-label="t('主题')">
          <button
            v-for="th in themes"
            :key="th"
            :class="{ on: state.theme === th }"
            :aria-pressed="state.theme === th"
            @click="setTheme(th)"
          >{{ t(themeLabel[th]) }}</button>
        </div>
        <div class="vlinks">
          <a href="../index.html">原版 ↗</a>
          <a href="../v2/standalone.html">V2 ↗</a>
        </div>
      </div>
    </div>
  </header>
</template>
