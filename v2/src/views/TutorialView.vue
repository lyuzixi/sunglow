<script setup lang="ts">
import { onMounted } from "vue";
import { t } from "../core/i18n";
import { state } from "../state";
import { armReveal } from "../composables/useReveal";

onMounted(() => armReveal());

const sections = [
  {
    id: "what",
    title: "霞光预报是什么",
    body: "霞光（晚霞/朝霞）出现在太阳位于地平线附近、阳光以接近掠地的角度穿过大气层时。低角度阳光经过更长的光程，短波（蓝紫）被散射殆尽，留下红橙色的直射光打在云底——这就是我们看到的火烧云。本工具用三套算法对「出现概率」与「观赏质量」分别打分，并给出多模型综合结论。"
  },
  {
    id: "three",
    title: "三套算法",
    body: "GFS 统计判据模型：基于云量、云型、云底高度、气溶胶等 9 项要素的加权几何平均；ECMWF 统计判据模型：同一框架下参数微扰；光追物理模型：沿抛物线光路积分消光光学厚度，用 CIE 1931 色度函数算出霞光的真实颜色。三套结论的分歧度 → 可信度徽标。"
  },
  {
    id: "read",
    title: "怎么读结论",
    body: "出现概率 = 今晚「有没有霞」的主观概率；观赏质量 = 「好不好看」（0–100 分，优 ≥80、良 ≥65、一般 ≥45）。两个维度独立：有时概率高但质量平平（闷烧），有时概率低但一旦出现极惊艳。可信度看三套算法是否一致：分歧越小越值得专程出门。"
  },
  {
    id: "sky",
    title: "天色带怎么用",
    body: "天色带是围绕日出/日落的一段时间尺。四道分界线对应太阳高度角 0°、−6°、−12°、−18°（日落/日出线、民用昏影终、航海昏影终、天文昏影终）。「此刻」游标告诉你现在处于哪个阶段——朝霞要在天亮之前到位，晚霞的黄金窗口通常在日落后 10–25 分钟。"
  },
  {
    id: "field",
    title: "观测场",
    body: "观测场是以你所在城市为中心的采样网格，色阶采用 SPECTRUM_RAMP 光谱尺（深空靛 → 品红 → 琥珀 → 电离青白），可切换出现概率 / 观赏质量 / 云量 / 可信度四个维度。观测场只在你显式触发取数时刷新（缓存命中会自动绘制）。"
  },
  {
    id: "calib",
    title: "实况校准",
    body: "看完霞之后回来标注「看到了 / 没看到 / 无法判断」，本机会在你的区域 + 同档概率下累计样本。样本足够时（≥8 条、本档 ≥3 条）会展示观测偏差。校准只在本地展示，绝不回改预报模型；关闭标注开关不会删除已有样本。"
  },
  {
    id: "snap",
    title: "快照链接",
    body: "点「复制链接」会把当前结果编码进 URL（base64url，SNAP_VER=1）。对方打开链接直接看到快照，不消耗任何接口额度。格式与原版完全互通——原版生成的快照 v2 能解，反之亦然。"
  },
  {
    id: "data",
    title: "数据与额度",
    body: "数据源 Open-Meteo（免费层仅限非商业用途），按访问者 IP 计额度。首屏一次预报约几十个加权调用，地图全量约 236 个。地图代理占位符 __TMAP_SERVICE_HOST__ 部署时注入，产物不含任何密钥。"
  }
];
</script>

<template>
  <div class="wrap tutorial">
    <div class="hero-lite anim-rise">
      <div class="pill">{{ t("使用教程") }}</div>
      <h1 style="font-size: clamp(1.9rem, 4.6vw, 3rem); margin: 14px 0 10px">
        {{ t("算法说明") }} · {{ t("使用教程") }}
      </h1>
      <p class="lead">
        从物理原理到界面读法，十分钟看懂这份霞光预报。
        主题：{{ state.theme === "light" ? t("晨光实验室") : t("大气光谱观测站") }}。
      </p>
    </div>

    <div class="toc glass-soft">
      <a v-for="s in sections" :key="s.id" :href="'#' + s.id">{{ s.title }}</a>
    </div>

    <article class="doc">
      <section v-for="(s, i) in sections" :key="s.id" :id="s.id" class="doc-sec reveal">
        <div class="idx">{{ String(i + 1).padStart(2, "0") }}</div>
        <div>
          <h2>{{ s.title }}</h2>
          <p>{{ s.body }}</p>
        </div>
      </section>
    </article>

    <div class="glass" style="padding: 26px 28px; margin: 32px 0">
      <h3 style="margin-top: 0">术语速查</h3>
      <table class="data">
        <tbody>
          <tr><td>AOD</td><td>气溶胶光学厚度，衡量大气浑浊度（0.1 清澈 → 1+ 重霾）</td></tr>
          <tr><td>云底高度</td><td>承接霞光的云层底面高度，3–6 km 的中高云最出片</td></tr>
          <tr><td>光学等效地表高度</td><td>气溶胶层「吃掉」光程的等效厚度，会降低有效云底</td></tr>
          <tr><td>光追</td><td>沿地球曲率的抛物线光路做逐波长消光积分，输出真实色彩</td></tr>
          <tr><td>可信度</td><td>三套算法综合指数（0.62P + 0.38Q）极差的分档：&lt;18 高、&lt;35 中、≥35 低</td></tr>
        </tbody>
      </table>
    </div>

    <router-link class="btn btn-primary" to="/" style="margin-bottom: 40px">
      ← {{ t("返回首页") }}
    </router-link>
  </div>
</template>

<style scoped>
.tutorial { padding-bottom: 40px; }
.hero-lite { padding: 40px 0 10px; }
.lead {
  font-size: var(--fs-lead);
  color: var(--tx-2);
  max-width: 720px;
}
.toc {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  margin: 18px 0 34px;
  position: sticky;
  top: 70px;
  z-index: 20;
}
.toc a {
  padding: 6px 13px;
  border-radius: var(--r-full);
  font-size: var(--fs-small);
  color: var(--tx-2);
}
.toc a:hover {
  color: var(--tx-1);
  background: var(--bg-glass-2);
  text-decoration: none;
}
.doc-sec {
  display: grid;
  grid-template-columns: 58px 1fr;
  gap: 18px;
  padding: 26px 0;
  border-top: 1px solid var(--stroke);
}
.idx {
  font-family: var(--font-display);
  font-size: 1.35rem;
  font-weight: 600;
  color: var(--tx-3);
  letter-spacing: 0.04em;
}
.doc-sec h2 {
  font-size: 1.28rem;
  margin: 0 0 10px;
}
.doc-sec p {
  margin: 0;
  color: var(--tx-2);
  line-height: 1.85;
  max-width: 760px;
}
</style>
