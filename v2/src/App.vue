<script setup lang="ts">
import TopBar from "./components/TopBar.vue";
import { state, applyTheme } from "./state";
import { t } from "./core/i18n";
import { computed, watchEffect } from "vue";

const year = new Date().getFullYear();
const showFoot = computed(() => true);
watchEffect(() => {
  void state.theme;
  applyTheme();
});
</script>

<template>
  <TopBar />
  <router-view :key="state.lang + state.theme" />
  <footer v-if="showFoot" class="foot">
    <div class="wrap foot-in">
      <div>
        <b class="spectrum-text" style="font-family: var(--font-display)">GLOWCAST</b>
        · {{ t("霞光预报") }} · {{ t("数据源") }} Open-Meteo（{{ t("非商业用途") }}）
      </div>
      <div style="display: flex; gap: 14px; align-items: center">
        <a href="./tutorial.html">{{ t("使用教程") }}</a>
        <a href="../index.html">{{ t("切换到原版") }} →</a>
        <span>© {{ year }}</span>
      </div>
    </div>
  </footer>
</template>
