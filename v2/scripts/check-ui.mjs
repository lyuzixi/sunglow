/* =========================================================================
   check-ui.mjs —— 关键布局 / 交互 / 三语 / 可达性断言（npm run build 前置）

   目的：把这几轮改造的「约定」固化成可重复的判据，避免以后改样式或模板时
   悄悄回退（趋势区重新出现折叠或日历、分享卡丢掉最佳窗口、三语缺键、
   触屏热区缩水、次要文字对比度掉到 4.5:1 以下）。

   只读源码，不依赖浏览器或联网环境；失败即 exit 1，由构建拦截。
   ========================================================================= */
import fs from "node:fs";
import path from "node:path";

const v2 = path.resolve(import.meta.dirname, "..");
const read = (rel) => fs.readFileSync(path.join(v2, rel), "utf8");

const issues = [];
const must = (ok, msg) => { if (!ok) issues.push(msg); };

/* ---------- 1. 趋势区：最佳窗口 → 常显逐日明细 ---------- */
const trend = read("src/components/TrendSection.vue");
must(/slice\(0,\s*3\)/.test(trend), "趋势区没有「最佳窗口取前 3」（slice(0, 3)）");
must(/b\.Q - a\.Q \|\| b\.P - a\.P/.test(trend), "最佳窗口排序口径不是 Q 降序、Q 相同看 P");
must(/class="detail-block"/.test(trend), "趋势区缺少常显的逐日明细区块 .detail-block");
must(!/<details[\s\S]{0,240}detail-block/.test(trend), "逐日明细又被包进了 <details>（应常显）");

/* 全量源码里不得再出现逐日明细的折叠键 */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(ts|vue)$/.test(e.name) ? [p] : [];
  });
}
const srcFiles = walk(path.join(v2, "src"));
const allSrc = srcFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");
must(!/trendDetailFold/.test(allSrc), "源码仍残留 trendDetailFold（逐日明细折叠偏好）");

/* 折叠偏好表只管整卡 / 说明块，不再登记逐日明细 */
const state = read("src/state.ts");
const foldBlock = state.match(/export const FOLD_KEYS = \[([\s\S]*?)\]/);
must(!!foldBlock && !/trendDetailFold/.test(foldBlock[1]), "state.ts 的 FOLD_KEYS 仍登记逐日明细");

/* ---------- 1.5 三处「保存图片」共用同一呈现 ---------- */
const shareBtn = read("src/components/ShareButton.vue");
const shareImg = read("src/components/ShareImageButton.vue");
const map = read("src/components/MapView.vue");
must(/<ShareButton/.test(shareImg), "结论卡保存按钮没有使用 ShareButton");
must(/<ShareButton[\s\S]{0,200}@click="saveImg"/.test(trend), "趋势卡保存按钮没有使用 ShareButton");
must(/<ShareButton[\s\S]{0,200}@click="saveImg"/.test(map), "地图卡保存按钮没有使用 ShareButton");
must(/@media \(max-width: 720px\)[\s\S]{0,200}\.sb-txt \{ display: none; \}/.test(shareBtn),
  "ShareButton 缺少 ≤720 图标化（隐藏文字）样式");
must(/@media \(pointer: coarse\)[\s\S]{0,120}height: 44px/.test(shareBtn),
  "ShareButton 缺少触屏 44px 热区");

/* ---------- 1.6 分享闭环：故事卡 / 二维码 / 文案 / 日历 ---------- */
const home = read("src/views/HomeView.vue");
const storyCard = read("src/core/sharecard.ts");
const extras = read("src/core/shareextras.ts");
const qrDialog = read("src/components/ShareQrDialog.vue");
must(/drawStoryCard/.test(storyCard) && /STW = 540, STH = 960/.test(storyCard),
  "缺少 9:16 竖版故事卡（540×960）");
must(/kind="story"/.test(read("src/components/ConclusionCard.vue")), "结论卡没有竖版故事卡入口");
must(/captionOf/.test(extras) && /buildIcs/.test(extras), "分享扩展缺少文案或日历实现");
must(/<ShareQrDialog/.test(home), "底部分享区没有接入二维码弹层");
must(/复制文案/.test(home) && /加入日历/.test(home) && /二维码/.test(home),
  "底部分享区缺少二维码 / 文案 / 日历入口");
must(/from "qrcode-generator"/.test(qrDialog), "二维码弹层没有使用 qrcode-generator");
must(/z-index: 300/.test(qrDialog), "二维码弹层层级低于顶栏");
const feedbackDialogSrc = read("src/components/FeedbackDialog.vue");
must(/z-index: 320/.test(feedbackDialogSrc), "反馈弹层层级低于设置面板 / 顶栏");
must(/openFeedbackFromSettings/.test(read("src/components/SettingsPanel.vue")),
  "设置菜单打开反馈前没有先收起面板");
const pwaBar = read("src/components/PwaUpdatePrompt.vue");
must(/\.pwa-bar \{[\s\S]{0,500}overflow: hidden/.test(pwaBar),
  "更新提示条顶部光谱线没有裁到胶囊轮廓（直线会越过两端圆角）");
must(!/\.pwa-bar::before[\s\S]{0,220}border-radius: var\(--r-full\) var\(--r-full\) 0 0/.test(pwaBar),
  "更新提示条顶部光谱线仍在用无效的顶部圆角");

/* ---------- 1.7 PWA 更新提示 / 反馈 / 关于隐私 ---------- */
const sw = read("sw.js");
const publish = read("scripts/publish-root.mjs");
const app = read("src/App.vue");
must(/type === "SKIP_WAITING"/.test(sw) && !/await self\.skipWaiting\(\)/.test(sw),
  "Service Worker 仍是安装即接管，页面弹不出「新版本已就绪」");
must(/glowcast-v2-pwa-/.test(publish) && /const VERSION = /.test(publish),
  "publish-root 没有按 index.html 哈希给 sw.js 打构建戳");
must(/PwaUpdatePrompt/.test(app), "App 没有挂载 PWA 更新提示条");
must(/path: "\/about"/.test(read("src/router.ts")), "缺少 /about 关于隐私路由");
must(/关于 \/ 隐私/.test(app) && /反馈/.test(app), "页脚缺少「关于 / 隐私」或「反馈」入口");
must(/feedbackOpen/.test(read("src/composables/useFeedback.ts")) &&
  /65446e91000000000301c1cb/.test(read("src/components/FeedbackDialog.vue")) &&
  /xiaohongshu-profile\.jpg/.test(read("src/components/FeedbackDialog.vue")),
  "反馈弹层缺少小红书主页入口或主页截图");
must(/docs\.open-meteo|Open-Meteo/.test(read("src/views/AboutView.vue")) &&
  /localStorage/.test(read("src/views/AboutView.vue")),
  "关于页没有讲清数据来源或 localStorage");
must(/class="about-back"[\s\S]{0,120}to="\/"/.test(read("src/views/AboutView.vue")),
  "关于页缺少返回主页入口");

/* ---------- 1.8 液态玻璃：顶栏不得成为 backdrop root ---------- */
const glassCss = read("src/styles/main.css");
const topbarBlock = glassCss.match(/\.topbar \{([\s\S]*?)\}/);
must(!!topbarBlock && !/backdrop-filter/.test(topbarBlock[1]),
  "顶栏直接在自身上做 backdrop-filter，会成为 backdrop root，设置面板采样不到页面");
must(/\.topbar::before[\s\S]{0,220}backdrop-filter/.test(glassCss),
  "顶栏磨砂没有拆到伪元素");
const settings = read("src/components/SettingsPanel.vue");
must(/backdrop-filter: saturate\(1\.7\) blur\(26px\)/.test(settings),
  "设置面板缺少液态玻璃磨砂");
must(/@supports not \(\(backdrop-filter: blur\(1px\)\)/.test(settings),
  "设置面板缺少不支持 backdrop-filter 时的实色兜底");

/* ---------- 2. 分享卡：最佳窗口前 3 + 无内部代号 ---------- */
const card = read("src/core/sharecard.ts");
must(/TW = 780, TH = 680/.test(card), "趋势分享卡不再是 780×680");
must(/function barCell/.test(card) && /function badgeCell/.test(card) && /rampColor/.test(card),
  "趋势分享卡的表格没有照搬页面的概率条 / 质量徽章");
must((card.match(/dataset\.theme === "dark"/g) || []).length >= 4,
  "四张分享卡（结论 / 趋势 / 故事 / 观测场）没有统一读取页面主题");
must(/t\("最佳窗口"\)/.test(card), "趋势分享卡没有「最佳窗口」分区");
must(/\.sort\(\(a, b\) => b\.Q - a\.Q \|\| b\.P - a\.P\)[\s\S]{0,80}\.slice\(0, 3\)/.test(card),
  "趋势分享卡的最佳窗口口径与页面不一致（应为 Q 降序取前 3）");
const idxBest = card.indexOf('t("最佳窗口")');
const idxTable = card.indexOf("/* 体：照搬页面趋势表");
must(idxBest !== -1 && idxTable !== -1 && idxBest < idxTable, "趋势分享卡的最佳窗口没有排在逐日表之前");
must(!/SUNGLOW V2/.test(card), "趋势分享卡仍含内部代号 SUNGLOW V2");
must(!/SUNGLOW V2/.test(read("tutorial.html")),
  "tutorial.html 仍含内部代号 SUNGLOW V2");

/* ---------- 3. 关键文案三语齐全 ---------- */
const extra = read("src/core/i18n-extra.ts");
function dictBlock(text, name) {
  const start = text.indexOf("export const " + name);
  const end = text.indexOf("\n};", start);
  return start === -1 || end === -1 ? "" : text.slice(start, end);
}
const HANT = dictBlock(extra, "HANT_EXTRA");
const EN = dictBlock(extra, "EN_EXTRA");
function keysOf(block) {
  const set = new Set();
  for (const m of block.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:/gm)) set.add(m[1]);
  return set;
}
const hantKeys = keysOf(HANT), enKeys = keysOf(EN);
const critical = [
  "最佳窗口", "逐日明细（概率条与质量徽章）", "最值得出门", "值得安排", "可以留意",
  "整体偏弱",
  "竖版故事卡", "分享与保存", "二维码", "复制文案", "加入日历",
  "最佳观赏窗口", "霞光档案 · {city}{period} {p}%", "今晚", "明晚",
  "新版本已就绪", "反馈", "反馈与交流", "反馈及交流请联系官方小红书",
  "前往小红书主页", "小红书主页截图",
  "关于 / 隐私", "数据来源", "本地存储与隐私"
];
for (const k of critical) {
  must(hantKeys.has(k), `i18n-extra 繁体缺键：${k}`);
  must(enKeys.has(k), `i18n-extra 英文缺键：${k}`);
}

/* 教程页：静态 data-i18n* 键必须在繁 / 英词典里都有（缺键会静默退回中文） */
const tut = read("tutorial.html");
function tutDict(name) {
  const start = tut.indexOf("var " + name + " = {");
  const end = tut.indexOf("\n  };", start);
  return start === -1 || end === -1 ? "" : tut.slice(start, end);
}
const tutHant = keysOf(tutDict("HANT")), tutEn = keysOf(tutDict("EN"));
const i18nKeys = new Set();
const decodeEnt = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
for (const m of tut.matchAll(/\bdata-i18n(?:-html|-aria)?="([^"]+)"/g)) i18nKeys.add(decodeEnt(m[1]));
must(i18nKeys.size > 0, "教程页没有解析到任何 data-i18n 键");
/* 只校验「中文正文」：纯英文标签 / 代码块 / 公式（含换行或 = 号）可沿用中文原文，
   缺键时 applyLang 会回退中文，不算漂移；中文正文缺键则会在英 / 繁页面里露中文。 */
for (const k of i18nKeys) {
  if (!/[\u4e00-\u9fff]/.test(k) || /[\n=]/.test(k)) continue;
  must(tutHant.has(k), `教程页繁体词典缺键：${k}`);
  must(tutEn.has(k), `教程页英文词典缺键：${k}`);
}

/* ---------- 4. 触屏热区 ≥ 44px ---------- */
const mainCss = read("src/styles/main.css");
must(/@media \(pointer: coarse\) \{\s*\.btn \{ min-height: 44px; \}/.test(mainCss),
  "main.css 缺少触屏按钮 44px 热区");
must(/@media \(pointer: coarse\)[\s\S]{0,240}min-height: 44px/.test(trend),
  "趋势区缺少触屏热区（.sm / .linkbtn 未撑到 44px）");
must(/@media \(pointer:coarse\)[\s\S]{0,200}min-height:44px/.test(tut),
  "教程页缺少触屏热区（.back / .tab / .tbtn 未撑到 44px）");

/* ---------- 5. 次要文字对比度 ≥ 4.5:1（WCAG AA 正文） ---------- */
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const tokens = read("src/styles/tokens.css");
function themeColor(theme, name) {
  const block = tokens.match(new RegExp('\\[data-theme="' + theme + '"\\]\\s*\\{([\\s\\S]*?)\\n\\}'));
  const m = block && block[1].match(new RegExp("--" + name + ":\\s*(#[0-9a-fA-F]{6})"));
  return m ? m[1] : "";
}
for (const theme of ["dark", "light"]) {
  const tx3 = themeColor(theme, "tx-3");
  const bg = themeColor(theme, "bg-card-solid");
  must(!!tx3 && !!bg, `tokens.css 解析不到 ${theme} 的 --tx-3 / --bg-card-solid`);
  if (tx3 && bg) {
    must(contrast(tx3, bg) >= 4.5,
      `${theme} 主题 --tx-3 对比度 ${contrast(tx3, bg).toFixed(2)}，低于 4.5:1`);
  }
}
/* 等级徽章：浅色等级色叠在 8% 同名底色（badge 的实际底色）上仍需 ≥ 4.5:1 */
function blend(fg, bg, a) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const f = p(fg), b = p(bg);
  const mix = f.map((v, i) => Math.round(v * a + b[i] * (1 - a)));
  return "#" + mix.map((v) => v.toString(16).padStart(2, "0")).join("");
}
const scoring = read("src/core/scoring.ts");
for (const m of scoring.matchAll(/key:\s*"(优|良|一般|差)".*?color:\s*"(#[0-9a-fA-F]{6})"/g)) {
  const bg = blend(m[2], "#ffffff", 0.08);
  const ratio = contrast(m[2], bg);
  must(ratio >= 4.5, `浅色等级「${m[1]}」徽章对比度 ${ratio.toFixed(2)}，低于 4.5:1`);
}
/* 教程页浅色次要文字：只在 light 主题块里取 --bg 与 --tx3，别误取深色值 */
const tutLight = tut.match(/html\[data-theme="light"\]\{([\s\S]*?)\n\}/);
if (tutLight) {
  const bg = tutLight[1].match(/--bg:(#[0-9a-fA-F]{6})/);
  const tx3 = tutLight[1].match(/--tx3:(#[0-9a-fA-F]{6})/);
  if (bg && tx3) {
    must(contrast(tx3[1], bg[1]) >= 4.5,
      `教程页浅色 --tx3 对比度 ${contrast(tx3[1], bg[1]).toFixed(2)}，低于 4.5:1`);
  }
}

if (issues.length) {
  console.error(`check-ui: ${issues.length} 处 UI 断言失败`);
  for (const s of issues) console.error("  ✗ " + s);
  process.exit(1);
}
console.log("check-ui: ✓ 趋势布局 / 分享卡口径 / 三语键 / 触屏热区 / 对比度断言通过");
