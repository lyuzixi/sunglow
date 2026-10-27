<script setup lang="ts">
/* 卡内说明块：原生 <details>（保留系统三角），折叠态双向同步偏好。
   与 FoldCard 的分工：FoldCard 折整张卡（卡头胶囊按钮），这里折卡里的一段说明。 */
import { state, setFold } from "../state";
import { t } from "../core/i18n";

const props = defineProps<{
  foldKey: string;
  title: string;
}>();

function onToggle(e: Event) {
  const el = e.target as HTMLDetailsElement;
  const wantOpen = !state.folds[props.foldKey];
  if (el.open !== wantOpen) setFold(props.foldKey, !el.open);
}
</script>

<template>
  <details class="fnote" :open="!state.folds[foldKey]" @toggle="onToggle">
    <summary>{{ t(title) }}</summary>
    <div class="fnote-body"><slot /></div>
  </details>
</template>

<style scoped>
.fnote {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--stroke);
  font-size: var(--fs-small);
  color: var(--tx-2);
}
.fnote summary {
  cursor: pointer;
  color: var(--tx-3);
  font-size: var(--fs-tiny);
  letter-spacing: 0.02em;
  list-style-position: inside;
}
.fnote summary:hover { color: var(--tx-1); }
.fnote-body {
  margin-top: 8px;
  padding-left: 14px;
  display: grid;
  gap: 6px;
  line-height: 1.75;
  color: var(--tx-2);
}
.fnote-body :deep(p) { margin: 0; }
</style>
