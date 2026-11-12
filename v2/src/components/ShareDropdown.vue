<script setup lang="ts">
/* 结论卡的「保存图片 ▾」下拉（方案 C）：
   位置不动、只消歧义 —— 两个产物（完整版结论卡 / 9:16 故事卡）共用一个按钮，
   菜单里写清楚各自的产物名，点之前就知道会得到哪张图。
   呈现口径与 ShareButton 同一套（≤720 收成图标按钮），菜单里仍然写全称。 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import { state } from "../state";
import { t } from "../core/i18n";
import type { VerdictView } from "../core/verdict";
import { saveShareCard, saveStoryCard } from "../core/sharecard";

const props = defineProps<{ view: VerdictView | null }>();

const open = ref(false);
const busy = ref(false);
const root = ref<HTMLElement | null>(null);

async function pick(kind: "card" | "story") {
  open.value = false;
  const r = state.result;
  if (!r || !props.view || busy.value) return;
  busy.value = true;
  try {
    await (kind === "story" ? saveStoryCard(r, props.view) : saveShareCard(r, props.view));
  } catch {
    alert(t("生成图片失败，请重试。"));
  } finally {
    busy.value = false;
  }
}

function onDoc(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") open.value = false;
}
onMounted(() => {
  document.addEventListener("click", onDoc);
  document.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDoc);
  document.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div ref="root" class="sdd">
    <button
      type="button"
      class="share-btn"
      :class="{ busy }"
      :disabled="busy || !view"
      :title="t('保存图片')"
      :aria-label="t('保存图片')"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click.stop="open = !open"
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none"
           stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 2.5v7.2" />
        <path d="M5.1 6.9 8 9.8l2.9-2.9" />
        <path d="M3 11.4v1.3a.9.9 0 0 0 .9.9h8.2a.9.9 0 0 0 .9-.9v-1.3" />
      </svg>
      <span class="sb-txt">{{ busy ? t("正在生成…") : t("保存图片") }}</span>
      <svg class="caret" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"
           fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 6.2 8 10l4-3.8" />
      </svg>
    </button>

    <div v-if="open" class="sdd-menu" role="menu">
      <button type="button" role="menuitem" @click="pick('card')">
        <span class="n">{{ t("结论卡") }}</span><small>{{ t("完整版") }}</small>
      </button>
      <button type="button" role="menuitem" @click="pick('story')">
        <span class="n">{{ t("竖版故事卡") }}</span><small>{{ t("9:16") }}</small>
      </button>
    </div>
  </div>
</template>

<script lang="ts">
export default { inheritAttrs: true };
</script>

<style scoped>
.sdd { position: relative; display: inline-block; }
.share-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 12px;
  border-radius: var(--r-full);
  border: 1px solid var(--stroke-2);
  background: transparent;
  color: var(--tx-2);
  font-size: var(--fs-tiny);
  font-weight: 550;
  white-space: nowrap;
  vertical-align: middle;
  transition: color var(--t-fast), border-color var(--t-fast), background var(--t-fast);
}
.share-btn:hover:not(:disabled) {
  color: var(--tx-1);
  border-color: var(--acc-3);
  background: var(--bg-glass);
}
.share-btn:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
.share-btn:disabled { opacity: .42; cursor: not-allowed; }
.share-btn.busy svg { animation: sdd-pulse 1s ease-in-out infinite; }
@keyframes sdd-pulse { 50% { opacity: .35; } }
.caret { opacity: .7; margin-left: -1px; }

.sdd-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 240;
  min-width: 172px;
  padding: 5px;
  border-radius: var(--r-md);
  border: 1px solid var(--stroke-2);
  background: var(--bg-card-solid);
  box-shadow: var(--card-sh);
}
.sdd-menu button {
  display: flex; align-items: baseline; gap: 8px;
  width: 100%; padding: 8px 10px; border: 0;
  border-radius: var(--r-sm); background: transparent;
  color: var(--tx-1); font-size: var(--fs-small); text-align: left;
}
.sdd-menu button:hover { background: var(--bg-glass); }
.sdd-menu .n { font-weight: 550; }
.sdd-menu small { margin-left: auto; color: var(--tx-3); font-size: var(--fs-tiny); }

@media (max-width: 720px) {
  .share-btn { width: 34px; height: 34px; padding: 0; justify-content: center; border-radius: var(--r-sm); }
  .share-btn .sb-txt { display: none; }
  .share-btn .caret { display: none; }
  .sdd-menu { min-width: 158px; }
}
@media (pointer: coarse) {
  .share-btn { min-width: 44px; height: 44px; padding: 0 14px; }
}
</style>
