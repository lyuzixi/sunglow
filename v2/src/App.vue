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
        <div class="foot-sub">{{ t("概率预报 · 仅供参考") }}</div>
      </div>
      <div class="foot-links">
        <a href="./tutorial.html">{{ t("使用教程") }}</a>
        <a href="#feedback" @click.prevent="openFeedback">{{ t("反馈") }}</a>
        <router-link to="/about">{{ t("关于 / 隐私") }}</router-link>
        <!-- 版本切换（2026-10-27）：V1 仍按根位置写（publish-root 禁止 ../ 跨目录链接）；
             Skyglow 已独立到 sky.sunglow.cloud，改用绝对地址跨域跳转。 -->
        <a
          class="foot-ver"
          href="V1/index.html"
          :title="t('经典原版已停止更新，仅保留小修小补')"
        >{{ t("Sunglow 经典原版") }}<em class="ver-stale">{{ t("已停更") }}</em></a>
        <a class="foot-ver" href="https://sky.sunglow.cloud/">{{ t("Skyglow 移植增强版") }}<em class="ver-ind">{{ t("独立项目") }}</em></a>
        <span>© {{ year }}</span>
      </div>
    </div>
  </footer>
  <PwaUpdatePrompt />
  <FeedbackDialog />
</template>
