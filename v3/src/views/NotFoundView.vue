<script setup lang="ts">
import { t } from "../core/i18n";
</script>

<template>
  <main class="wrap" style="padding: 12vh 24px">
    <h1 style="font-family: var(--f-display); font-size: 22px">{{ t("页面未找到") }}</h1>
    <p style="color: var(--tx-2)">{{ t("返回首页") }} → <a href="#/">{{ t("追光航志") }}</a></p>
  </main>
</template>
