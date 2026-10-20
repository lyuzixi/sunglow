<script setup lang="ts">
import TopBar from "./components/TopBar.vue";
</script>

<template>
  <TopBar />
  <router-view />
  <footer class="foot">
    <div class="wrap foot-in">
      <span>数据源 Open-Meteo（仅限非商业用途）</span>
      <span>口径与原版逐点对齐 · 新能力只做推导</span>
      <span><a href="../tutorial.html">教程</a></span>
      <span><a href="../index.html">查看原版</a></span>
      <span><a href="../v2/standalone.html">查看 V2</a></span>
      <span>GLOWCAST · v3「追光航志」</span>
    </div>
  </footer>
</template>
