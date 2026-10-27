<script setup lang="ts">
/* 附注卡：把散落在页脚、设置面板、快照说明里的口径集中一处。
   整卡折叠（notesFold），内容全是静态说明，不依赖取数。 */
import { t } from "../core/i18n";
import FoldCard from "./FoldCard.vue";

const items = [
  {
    k: "数据源",
    v: "气象要素来自 Open-Meteo 的数值预报与空气质量接口，非商业用途；地图底图请求经代理转发，不携带任何个人标识。"
  },
  {
    k: "缓存",
    v: "结果按「日期 + 时段 + 坐标」分键缓存 6 小时。同一条件重复查看不会重新取数，换地点或换日期才会。"
  },
  {
    k: "快照",
    v: "带 snap 参数的链接是结果快照：打开它不会重新计算，也不消耗接口额度，因此可以和别人分享同一份结论。"
  },
  {
    k: "校准",
    v: "实况校准只记录你「看到了 / 没看到」的判断，用于你自己回看准确度，不会反过来改动预报值；样本不足时不给结论。"
  },
  {
    k: "额度",
    v: "免费层每日 10,000 次加权调用（按出口 IP 计，不是按账号）。单点预报约 51 次、一张地图约 171 次、十日趋势约 102 次；地图与趋势都要手动点按钮触发，页面不会自动请求。"
  }
];
</script>

<template>
  <FoldCard fold-key="notesFold" anchor="notes" title="附注" :sub="t('数据口径与额度说明')">
    <dl class="nt-list">
      <div v-for="it in items" :key="it.k" class="nt-item">
        <dt>{{ t(it.k) }}</dt>
        <dd>{{ t(it.v) }}</dd>
      </div>
    </dl>
    <p class="nt-note">
      {{ t("预报存在不确定性，观赏前请结合当地天气实况判断；本页结论仅供参考，不构成出行建议。") }}
    </p>
  </FoldCard>
</template>

<style scoped>
.nt-list { margin: 0; display: grid; gap: 12px; }
.nt-item {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 12px;
  align-items: baseline;
}
.nt-item dt {
  font-size: var(--fs-tiny);
  color: var(--tx-3);
  letter-spacing: 0.06em;
}
.nt-item dd {
  margin: 0;
  font-size: var(--fs-small);
  line-height: 1.8;
  color: var(--tx-2);
}
.nt-note {
  margin: 16px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--stroke);
  font-size: var(--fs-tiny);
  line-height: 1.8;
  color: var(--tx-3);
}
@media (max-width: 560px) {
  .nt-item { grid-template-columns: 1fr; gap: 2px; }
}
</style>
