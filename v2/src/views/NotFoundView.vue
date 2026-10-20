<script setup lang="ts">
import { t } from "../core/i18n";
</script>

<template>
  <div class="wrap center-screen">
    <div class="big-code">404</div>
    <h1 style="margin: 0">{{ t("页面未找到") }}</h1>
    <p style="color: var(--tx-2); max-width: 420px">
      这条光谱里没有你要找的波段。回到观测站继续今晚的霞光预报。
    </p>
    <router-link class="btn btn-primary" to="/">{{ t("返回首页") }}</router-link>
  </div>
</template>
