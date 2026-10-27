<script setup lang="ts">
/* 保存图片按钮（结论卡标题右侧）：
   桌面是文字按钮、与模型切换器同高；≤720 收成 34×34 图标按钮，文案进 title/aria-label。
   手机浏览器支持带文件分享时唤起系统分享面板，否则回退下载 —— 逻辑在 core/sharecard.ts。 */
import { computed, ref } from "vue";
import { state } from "../state";
import { t } from "../core/i18n";
import type { VerdictView } from "../core/verdict";
import { saveShareCard } from "../core/sharecard";

const props = defineProps<{ view: VerdictView | null }>();

const busy = ref(false);
const label = computed(() => (busy.value ? t("正在生成…") : t("保存图片")));

async function onClick() {
  const r = state.result;
  if (!r || !props.view || busy.value) return;
  busy.value = true;
  try {
    await saveShareCard(r, props.view);
  } catch {
    alert(t("生成图片失败，请重试。"));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <button
    type="button"
    class="share-btn"
    :class="{ busy }"
    :disabled="!view || busy"
    :title="label"
    :aria-label="label"
    @click="onClick"
  >
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none"
         stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 2.5v7.2" />
      <path d="M5.1 6.9 8 9.8l2.9-2.9" />
      <path d="M3 11.4v1.3a.9.9 0 0 0 .9.9h8.2a.9.9 0 0 0 .9-.9v-1.3" />
    </svg>
    <span class="sb-txt">{{ label }}</span>
  </button>
</template>

<style scoped>
.share-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border-radius: var(--r-full);
  border: 1px solid var(--stroke-2);
  background: transparent;
  color: var(--tx-2);
  font-size: var(--fs-tiny);
  font-weight: 550;
  white-space: nowrap;
  transition: color var(--t-fast), border-color var(--t-fast), background var(--t-fast);
}
.share-btn:hover:not(:disabled) {
  color: var(--tx-1);
  border-color: var(--acc-3);
  background: var(--bg-glass);
}
.share-btn:disabled { opacity: 0.42; cursor: not-allowed; }
.share-btn.busy svg { animation: sb-pulse 1s ease-in-out infinite; }
@keyframes sb-pulse { 50% { opacity: 0.35; } }

/* ≤720：收成与顶栏同规格的图标按钮，文案进 title/aria-label */
@media (max-width: 720px) {
  .share-btn {
    width: 34px; height: 34px; padding: 0;
    justify-content: center;
    border-radius: var(--r-sm);
  }
  .share-btn .sb-txt { display: none; }
}
</style>
