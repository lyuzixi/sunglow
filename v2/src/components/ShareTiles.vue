<script setup lang="ts">
/* =========================================================================
   分享板块八磁贴（2026-11-12 · 方案 A「一处总览」）
   ---------------------------------------------------------------------------
   4 张图片产物 + 4 个链接 / 提醒动作排成 2×4：图标 + 名称 + 一句副文案。
   第一枚（结论卡）用 --acc-3 描边标主推，与 mockup 一致。
   这里只管呈现和派发：数据、三语文案、禁用判断都在 HomeView 组装，
   四张图的保存动作由 sharehub 登记表转发给各自那张卡（产物同源）。
   ========================================================================= */
import type { ShareTileItem, ShareTileKey } from "../core/sharehub";

defineProps<{ items: ShareTileItem[] }>();
const emit = defineEmits<{ (e: "pick", k: ShareTileKey): void }>();
</script>

<template>
  <div class="share-tiles">
    <button
      v-for="it in items" :key="it.k"
      type="button"
      class="share-tile"
      :class="{ main: !!it.main }"
      :data-share="it.k"
      :disabled="!it.ready"
      :title="it.ready ? '' : (it.hint || '')"
      @click="emit('pick', it.k)"
    >
      <span class="st-n">
        <svg class="st-ic" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"
             fill="none" stroke="currentColor" stroke-width="1.6"
             stroke-linecap="round" stroke-linejoin="round">
          <template v-if="it.k === 'card'">
            <path d="M8 2.5v7.2" /><path d="M5.1 6.9 8 9.8l2.9-2.9" />
            <path d="M3 11.4v1.3a.9.9 0 0 0 .9.9h8.2a.9.9 0 0 0 .9-.9v-1.3" />
          </template>
          <template v-else-if="it.k === 'story'">
            <rect x="4.4" y="1.6" width="7.2" height="12.8" rx="1.2" />
            <path d="M8 5.4v4.1" /><path d="M6.3 8 8 9.7l1.7-1.7" />
          </template>
          <template v-else-if="it.k === 'trend'">
            <path d="M2.5 13.5h11" /><path d="M4.6 11V7" /><path d="M8 11V4" />
            <path d="M11.4 11V8.6" />
          </template>
          <template v-else-if="it.k === 'map'">
            <path d="M2.4 4.4 6 2.8l4 1.6 3.6-1.6v8.8L10 13.2 6 11.6l-3.6 1.6z" />
            <path d="M6 2.8v8.8M10 4.4v8.8" />
          </template>
          <template v-else-if="it.k === 'link'">
            <path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-1 1" />
            <path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l1-1" />
          </template>
          <template v-else-if="it.k === 'qr'">
            <rect x="2.4" y="2.4" width="4.4" height="4.4" rx="1" />
            <rect x="9.2" y="2.4" width="4.4" height="4.4" rx="1" />
            <rect x="2.4" y="9.2" width="4.4" height="4.4" rx="1" />
            <path d="M9.6 9.6h1.8v1.8H9.6zM12.4 12.4h1.2v1.2h-1.2z" />
          </template>
          <template v-else-if="it.k === 'caption'">
            <path d="M3 4.2h10M3 8h7.4M3 11.8h5" />
          </template>
          <template v-else>
            <rect x="2.4" y="3.4" width="11.2" height="10" rx="1.6" />
            <path d="M2.4 6.6h11.2M5.4 2v2.6M10.6 2v2.6" />
          </template>
        </svg>
        <span>{{ it.n }}</span>
      </span>
      <span class="st-s">{{ it.s }}</span>
    </button>
  </div>
</template>

<style scoped>
.share-tiles {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 18px;
}
.share-tile {
  display: flex; flex-direction: column; align-items: flex-start; gap: 3px;
  min-width: 0; padding: 12px 13px;
  border-radius: var(--r-md);
  border: 1px solid var(--stroke-2);
  background: var(--bg-glass);
  color: var(--tx-1); text-align: left; cursor: pointer;
  transition: border-color var(--t-fast), background var(--t-fast), transform var(--t-fast);
}
.share-tile:hover:not(:disabled) {
  border-color: var(--acc-3); background: var(--bg-glass-2); transform: translateY(-1px);
}
.share-tile:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.share-tile:disabled { opacity: .45; cursor: not-allowed; }
/* 主推产物：浅色下 --acc-3 是青蓝，与 mockup 的蓝描边一致 */
.share-tile.main { border-color: var(--acc-3); }
.st-n {
  display: flex; align-items: center; gap: 7px;
  width: 100%; min-width: 0;
  font-size: var(--fs-small); font-weight: 600; line-height: 1.35;
}
.st-ic { flex: none; }
.st-s {
  width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  /* 用 tx-2 而非 tx-3：深色主题下 tx-3 压在玻璃底上实测偏暗，副文案读不清 */
  font-size: var(--fs-tiny); color: var(--tx-2);
}
.share-tile:disabled .st-s { color: var(--tx-3); }
@media (max-width: 900px) {
  .share-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
