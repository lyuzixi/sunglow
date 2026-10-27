<script setup lang="ts">
/* 整卡折叠：卡头右侧胶囊按钮（同V1 cardRay / cardNotes 的做法），
   卡内说明段落用 FoldNote 的原生 <details>。两者都写同一份偏好。 */
import { state, toggleFold } from "../state";
import { t } from "../core/i18n";

defineProps<{
  foldKey: string;
  anchor: string;
  title: string;
  sub?: string;
}>();
</script>

<template>
  <section :id="anchor" class="section">
    <div class="wrap">
      <div class="glass foldcard">
        <div class="fc-head">
          <h2>{{ t(title) }}</h2>
          <div class="fc-right">
            <span v-if="sub" class="fc-sub">{{ sub }}</span>
            <button
              class="btn btn-ghost sm"
              :aria-expanded="!state.folds[foldKey]"
              :aria-controls="anchor + '-body'"
              @click="toggleFold(foldKey)"
            >
              {{ state.folds[foldKey] ? t("展开") : t("收起") }}
            </button>
          </div>
        </div>
        <div v-show="!state.folds[foldKey]" :id="anchor + '-body'" class="fc-body">
          <slot />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.foldcard { padding: 18px 20px 20px; }
.fc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.fc-head h2 { margin: 0; font-size: var(--fs-title); }
.fc-right { display: flex; align-items: center; gap: 10px; }
.fc-sub { font-size: var(--fs-tiny); color: var(--tx-3); }
.fc-body { margin-top: 14px; }
</style>
