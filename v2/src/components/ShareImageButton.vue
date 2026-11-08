<script setup lang="ts">
/* 结论卡的保存图片按钮：只保留保存逻辑，呈现交给共用的 ShareButton。
   桌面是文字按钮、与模型切换器同高；≤720 收成图标按钮，文案进 title/aria-label。
   手机浏览器支持带文件分享时唤起系统分享面板，否则回退下载 —— 逻辑在 core/sharecard.ts。 */
import { ref } from "vue";
import { state } from "../state";
import { t } from "../core/i18n";
import type { VerdictView } from "../core/verdict";
import { saveShareCard, saveStoryCard } from "../core/sharecard";
import ShareButton from "./ShareButton.vue";

const props = defineProps<{ view: VerdictView | null; kind?: "card" | "story" }>();

const busy = ref(false);

async function onClick() {
  const r = state.result;
  if (!r || !props.view || busy.value) return;
  busy.value = true;
  try {
    await (props.kind === "story" ? saveStoryCard(r, props.view) : saveShareCard(r, props.view));
  } catch {
    alert(t("生成图片失败，请重试。"));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ShareButton :busy="busy" :disabled="!view" :kind="kind" @click="onClick" />
</template>
