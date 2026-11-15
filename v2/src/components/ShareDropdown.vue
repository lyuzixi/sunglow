<script setup lang="ts">
/* 结论卡的「保存图片 ▾」下拉（方案 C）：
   位置不动、只消歧义 —— 两个产物（完整版结论卡 / 9:16 故事卡）共用一个按钮，
   菜单里写清楚各自的产物名，点之前就知道会得到哪张图。
   呈现口径与 ShareButton 同一套（≤720 收成图标按钮），菜单里仍然写全称。

   2026-11-15：菜单原来用 absolute + right:0，相对按钮右缘往左展开。
   ≤720 时标题整组下移、按钮贴着屏幕左缘（44px 热区），172px 的菜单
   于是有 120px 落在视口外，被 body 的 overflow-x:hidden 裁掉，
   手机上只剩右列「完整版 / 9:16」看得见。改接 core/popover 的锚定弹层：
   Teleport 到 body + fixed + 视口内 clamp（还顺带解决底部放不下时上翻），
   与城市下拉 / 月历同一套定位口径。 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import { state } from "../state";
import { t } from "../core/i18n";
import type { VerdictView } from "../core/verdict";
import { saveShareCard, saveStoryCard } from "../core/sharecard";
import { useShareImage } from "../core/sharehub";
import { useAnchoredPopup } from "../core/popover";

const props = defineProps<{ view: VerdictView | null }>();

const open = ref(false);
const busy = ref(false);
const triggerEl = ref<HTMLButtonElement | null>(null);
const popEl = ref<HTMLElement | null>(null);

/* 桌面：菜单右缘对齐按钮右缘（与改版前一致）；
   窄屏：按钮在左缘，改成从按钮左缘向右展开，别再往视口外挤。
   两端最终都由 useAnchoredPopup 再夹一次进视口，旋转/缩放也不会漏出去。 */
function align(): "start" | "end" {
  return window.matchMedia("(max-width: 720px)").matches ? "start" : "end";
}
const { anchor } = useAnchoredPopup(open, triggerEl, popEl, align);

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

/* 底部「分享」板块八磁贴里的两个图片入口：复用就地下拉的同一套动作，
   不另造一份 ForecastResult / VerdictView 取数口径。 */
useShareImage("card", {
  save: () => pick("card"),
  ready: () => !!state.result && !!props.view
});
useShareImage("story", {
  save: () => pick("story"),
  ready: () => !!state.result && !!props.view
});

/* 菜单 Teleport 到 body 后不在 .sdd 内，点外部关闭要连它一起认，
   否则点菜单项时会被判定成「点在外面」。 */
function onDoc(e: MouseEvent) {
  const t = e.target as Node;
  if (triggerEl.value?.contains(t) || popEl.value?.contains(t)) return;
  open.value = false;
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
  <div class="sdd">
    <button
      ref="triggerEl"
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

    <Teleport to="body">
      <div
        v-if="open"
        ref="popEl"
        class="pop-card sdd-menu"
        role="menu"
        :aria-label="t('保存图片')"
        :style="{
          left: anchor.left + 'px',
          top: anchor.top + 'px',
          visibility: anchor.ready ? 'visible' : 'hidden'
        }"
      >
        <button type="button" role="menuitem" @click="pick('card')">
          <span class="n">{{ t("结论卡") }}</span><small>{{ t("完整版") }}</small>
        </button>
        <button type="button" role="menuitem" @click="pick('story')">
          <span class="n">{{ t("竖版故事卡") }}</span><small>{{ t("9:16") }}</small>
        </button>
      </div>
    </Teleport>
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

/* 定位与层级全交给 core/popover.ts + 全局 .pop-card（fixed / z-index 2400 /
   视口内 clamp / 底部放不下向上翻）。这里只管尺寸与内容：
   绝不能再写 right:0 —— 手机端按钮贴左缘时会把菜单顶出视口。
   max-width 同时留足 popover 的 12px 双边距，极窄屏也不会右溢出。 */
.sdd-menu {
  min-width: 172px;
  max-width: min(240px, calc(100vw - 24px));
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
