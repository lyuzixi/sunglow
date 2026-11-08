<script setup lang="ts">
import TopBar from "./components/TopBar.vue";
import PwaUpdatePrompt from "./components/PwaUpdatePrompt.vue";
import FeedbackDialog from "./components/FeedbackDialog.vue";
import { state, applyTheme } from "./state";
import { t } from "./core/i18n";
import { openFeedback } from "./composables/useFeedback";
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
      <div class="foot-brand">
        <div>
          <b class="spectrum-text" style="font-family: var(--font-display)">SUNGLOW</b>
          · 霞光档案 · {{ t("Spectrum Edition · 光谱观测版") }}
        </div>
        <div class="foot-sub">{{ t("让每一次追霞，都有迹可循") }}</div>
        <div class="foot-sub">{{ t("数据源") }} Open-Meteo（{{ t("非商业用途") }}）</div>
      </div>
      <div style="display: flex; gap: 14px; align-items: center">
        <a href="./tutorial.html">{{ t("使用教程") }}</a>
        <a href="#feedback" @click.prevent="openFeedback">{{ t("反馈") }}</a>
        <router-link to="/about">{{ t("关于 / 隐私") }}</router-link>
        <!-- 版本切换（2026-10-27）：两条都按**根位置**写（源码直改，publish-root 校验
             禁止根产物里出现 ../ 跨目录链接）。V2 交付物发布到仓库根，所以 V1/ 与
             Skyglow/ 就是同级目录 —— 根副本正确，v2/ 工程目录里预览时这两条会指错，
             与既有版本切换入口同一条已拍板的已知限制。 -->
        <a
          class="foot-ver"
          href="V1/index.html"
          :title="t('经典原版已停止更新，仅保留小修小补')"
        >{{ t("Sunglow 经典原版") }}<em class="ver-stale">{{ t("已停更") }}</em></a>
        <a class="foot-ver" href="Skyglow/index.html">{{ t("Skyglow 移植增强版") }}<em class="ver-ind">{{ t("独立项目") }}</em></a>
        <span>© {{ year }}</span>
      </div>
    </div>
  </footer>
  <PwaUpdatePrompt />
  <FeedbackDialog />
</template>
