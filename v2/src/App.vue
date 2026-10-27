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
        <!-- 版本切换（2026-10-27）：两条都按**根位置**写（源码直改，publish-root 校验
             禁止根产物里出现 ../ 跨目录链接）。V2 交付物发布到仓库根，所以 V1/ 与
             Skyglow/ 就是同级目录 —— 根副本正确，v2/ 工程目录里预览时这两条会指错，
             与既有「切换到V1」同一条已拍板的已知限制。 -->
        <a href="V1/index.html">{{ t("切换到V1") }} →</a>
        <a href="Skyglow/index.html">{{ t("切换到Skyglow") }} →</a>
        <span>© {{ year }}</span>
      </div>
    </div>
  </footer>
</template>
