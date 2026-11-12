<script setup lang="ts">
/* 整卡折叠：卡头右侧胶囊按钮（同V1 cardRay / cardNotes 的做法），
   卡内说明段落用 FoldNote 的原生 <details>。两者都写同一份偏好。
   outsideTitle：把标题行按其它板块的 .section-head 排在白卡之外（光追算法细节）。
   默认 false ——「附注」卡照旧把标题留在白卡内，不要顺手一起改。 */
import { state, toggleFold } from "../state";
import { t } from "../core/i18n";

defineProps<{
  foldKey: string;
  anchor: string;
  title: string;
  sub?: string;
  outsideTitle?: boolean;
}>();
</script>

<template>
  <section :id="anchor" class="section">
    <div class="wrap">
      <!-- 外置版卡头：与其它板块共用 .section-head，但保留 .fc-head / .btn，
           折叠探针与目录跳转的既有选择器一个都不用改。下面两处卡头内容必须同步。 -->
      <div v-if="outsideTitle" class="section-head fc-head">
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
      <div
        class="glass foldcard"
        :class="{ outside: outsideTitle, folded: !!state.folds[foldKey] }"
      >
        <div v-if="!outsideTitle" class="fc-head">
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
/* 标题外置：卡里只剩正文，去掉原卡头与正文之间的那道 14px 间隙 */
.foldcard.outside .fc-body { margin-top: 0; }
/* 收起时把空卡一起收掉，外面只留标题行与「展开」按钮 */
.foldcard.outside.folded { display: none; }
/* 外置卡头跟随其它板块的基线对齐（scoped 权重高于 .fc-head 的 center） */
.section-head.fc-head { align-items: baseline; }
</style>
