<script setup lang="ts">
/* 关于 / 隐私：把数据来源、额度与本地存储讲清楚。
   内容与 README「数据源与额度」、tutorial 用户版保持一致；更新口径时三处一起改。 */
import { t } from "../core/i18n";
import { openFeedback } from "../composables/useFeedback";
</script>

<template>
  <section class="section about">
    <div class="wrap">
      <router-link class="about-back" to="/">
        <span aria-hidden="true">←</span>{{ t("返回首页") }}
      </router-link>

      <div class="about-hero">
        <span class="pill">SUNGLOW · Spectrum Edition</span>
        <h1>{{ t("关于霞光档案") }}</h1>
        <p class="lead">{{ t("朝霞与晚霞的定量预报，纯前端、单文件、可离线。这份说明讲清数据来源、额度与本地存储。") }}</p>
      </div>

      <div class="about-grid">
        <section class="glass about-card">
          <h2><span class="no">01</span>{{ t("数据来源") }}</h2>
          <p>{{ t("Open-Meteo 提供 GFS 与 ECMWF-IFS 气象场、CAMS 气溶胶光学厚度；免费公开数据，仅限非商业用途。") }}</p>
          <p>{{ t("观测场底图可选腾讯地图，经部署方配置的代理加载；未配置代理时地图不可用，预报与分享功能不受影响。") }}</p>
          <p>{{ t("行政区边界来自 DataV；首屏实拍照片为广州珠江，随项目自带。") }}</p>
          <p class="warn">{{ t("预报只作观赏参考，不构成出行、航海、航空等安全决策依据。") }}</p>
        </section>

        <section class="glass about-card">
          <h2><span class="no">02</span>{{ t("额度与取数纪律") }}</h2>
          <div class="quota">
            <table>
              <thead>
                <tr><th scope="col">{{ t("功能") }}</th><th scope="col">{{ t("一次代价") }}</th></tr>
              </thead>
              <tbody>
                <tr><td>{{ t("单点预报") }}</td><td>{{ t("约 51 次") }}</td></tr>
                <tr><td>{{ t("十日趋势") }}</td><td>{{ t("约 102 次") }}</td></tr>
                <tr><td>{{ t("观测场") }}</td><td>{{ t("约 171 次") }}</td></tr>
                <tr><td>{{ t("多地对比") }}</td><td>{{ t("约 51 次 / 点") }}</td></tr>
                <tr><td>{{ t("快照 / 二维码 / 日历") }}</td><td>{{ t("0 次") }}</td></tr>
              </tbody>
            </table>
          </div>
          <p>{{ t("只在显式操作时取数；命中缓存直接画出来，不重复消耗额度。预报缓存 6 小时。") }}</p>
          <p>{{ t("额度按访客出口 IP 计。额度耗尽时界面如实报错，不会静默伪造数据。") }}</p>
        </section>

        <section class="glass about-card wide">
          <h2><span class="no">03</span>{{ t("本地存储与隐私") }}</h2>
          <p>{{ t("不使用 Cookie、不做访问统计、不接第三方广告，也没有账号系统。") }}</p>
          <p>{{ t("偏好与计算结果只存在浏览器 localStorage：") }}</p>
          <ul class="store-list">
            <li><code>SUNGLOW.v2.pref</code><span>{{ t("偏好（语言 / 主题 / 单位 / 折叠状态）") }}</span></li>
            <li><code>SUNGLOW.v2.point.v3.*</code><span>{{ t("单点预报缓存") }}</span></li>
            <li><code>SUNGLOW.v2.trend.*</code><span>{{ t("十日趋势缓存") }}</span></li>
            <li><code>SUNGLOW.v2.map.v9.*</code><span>{{ t("观测场缓存") }}</span></li>
            <li><code>SUNGLOW.v2.tz.*</code><span>{{ t("时区缓存") }}</span></li>
            <li><code>SUNGLOW.v2.calib</code><span>{{ t("实况校准记录") }}</span></li>
            <li><code>SUNGLOW.v2.cmp.v1</code><span>{{ t("多观测点清单") }}</span></li>
            <li><code>SUNGLOW.v2.mapTestNote.v1</code><span>{{ t("地图测试提示的已读状态") }}</span></li>
          </ul>
          <p>{{ t("位置与日期不写入偏好。定位只在点「定位」时请求一次；坐标会随取数请求发送给 Open-Meteo 或地图代理，用于返回该点数据。当前查询会出现在地址栏（便于分享与刷新恢复），但不写入 localStorage。") }}</p>
          <p>{{ t("清除浏览器站点数据即可清空全部本地记录；设置面板也提供缓存清理。") }}</p>
          <p>{{ t("PWA 还会用浏览器 CacheStorage 缓存应用外壳（HTML / 图标），仅用于离线打开；气象响应与个人数据都不进这份缓存。") }}</p>
          <p>{{ t("快照把结果编码在链接里，打开不重新取数，也不消耗额度。") }}</p>
        </section>

        <section class="glass about-card wide">
          <h2><span class="no">04</span>{{ t("反馈与支持") }}</h2>
          <p>{{ t("反馈与交流请通过官方小红书；点「打开反馈」可查看主页二维码，或直接跳转到主页。") }}</p>
          <div class="about-acts">
            <button class="btn btn-primary" @click="openFeedback">{{ t("打开反馈") }}</button>
            <a class="btn btn-ghost" href="./tutorial.html">{{ t("使用教程") }}</a>
            <router-link class="btn btn-ghost" to="/">{{ t("返回首页") }}</router-link>
          </div>
        </section>
      </div>
    </div>
  </section>
</template>

<style scoped>
.about { padding-top: 8px; }
.about-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  padding: 6px 13px;
  border: 1px solid var(--stroke);
  border-radius: var(--r-full);
  color: var(--tx-2);
  font-size: var(--fs-small);
  text-decoration: none;
  transition: color var(--t-fast), border-color var(--t-fast);
}
.about-back:hover {
  color: var(--tx-1);
  border-color: var(--stroke-2);
  text-decoration: none;
}
.about-back:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
@media (pointer: coarse) {
  .about-back { min-height: 44px; padding: 0 15px; }
}
.about-hero {
  position: relative;
  padding: 26px 0 24px;
  border-bottom: 1px solid var(--stroke);
  margin-bottom: 18px;
}
.about-hero::after {
  content: "";
  position: absolute;
  left: 0;
  bottom: -1px;
  width: 96px;
  height: 2px;
  background: var(--spectrum);
}
.about-hero h1 {
  margin: 12px 0 8px;
  font-size: var(--fs-title);
  font-family: var(--font-display);
  color: var(--tx-1);
}
.about-hero .lead {
  margin: 0;
  max-width: 720px;
  color: var(--tx-2);
  font-size: var(--fs-small);
  line-height: 1.75;
}
.about-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.about-card {
  padding: 20px 22px 18px;
}
.about-card.wide { grid-column: 1 / -1; }
.about-card h2 {
  margin: 0 0 10px;
  font-size: var(--fs-body);
  color: var(--tx-1);
}
.about-card h2 .no {
  margin-right: 9px;
  font-family: var(--font-mono);
  font-size: var(--fs-tiny);
  font-weight: 400;
  color: var(--tx-3);
}
.about-card p {
  margin: 0 0 8px;
  font-size: var(--fs-small);
  line-height: 1.75;
  color: var(--tx-2);
}
.about-card p:last-child { margin-bottom: 0; }
.about-card .warn { color: var(--tx-3); }
.quota table {
  width: 100%;
  border-collapse: collapse;
  margin: 4px 0 12px;
  font-size: var(--fs-small);
}
.quota th, .quota td {
  padding: 7px 4px;
  border-bottom: 1px solid var(--stroke);
  text-align: left;
  color: var(--tx-2);
}
.quota th {
  font-size: var(--fs-tiny);
  font-weight: 600;
  color: var(--tx-3);
  letter-spacing: 0.02em;
}
.quota td:last-child, .quota th:last-child { text-align: right; }
.quota tr:last-child td { border-bottom: 0; }
.store-list {
  list-style: none;
  margin: 2px 0 12px;
  padding: 0;
  display: grid;
  gap: 6px;
}
.store-list li {
  display: grid;
  grid-template-columns: minmax(150px, 0.9fr) 1.4fr;
  gap: 12px;
  align-items: baseline;
  font-size: var(--fs-small);
  color: var(--tx-2);
}
.store-list code {
  font-family: var(--font-mono);
  font-size: var(--fs-tiny);
  color: var(--tx-1);
  word-break: break-all;
}
.about-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.about-acts .btn { text-decoration: none; }
@media (max-width: 760px) {
  .about-grid { grid-template-columns: 1fr; }
  .about-card.wide { grid-column: auto; }
  .store-list li { grid-template-columns: 1fr; gap: 2px; }
}
@media (pointer: coarse) {
  .about-acts .btn { min-height: 44px; }
}
</style>
