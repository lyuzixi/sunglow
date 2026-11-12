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

/* ---------- 1.5 三处保存按钮：各自的产物名（方案 C） ---------- */
const shareBtn = read("src/components/ShareButton.vue");
const shareDrop = read("src/components/ShareDropdown.vue");
const map = read("src/components/MapView.vue");
must(/kind="trend"/.test(trend) && /kind="map"/.test(map),
  "趋势 / 地图按钮没有用自己的产物名（kind=trend / kind=map）");
must(/t\("趋势图"\)/.test(shareBtn) && /t\("观测场图"\)/.test(shareBtn),
  "ShareButton 缺少「趋势图 / 观测场图」产物名");
must(/ShareDropdown/.test(read("src/components/ConclusionCard.vue")),
  "结论卡没有「保存图片 ▾」下拉（方案 C）");
must(/saveShareCard/.test(shareDrop) && /saveStoryCard/.test(shareDrop),
  "下拉里没有两个产物（结论卡 / 竖版故事卡）");
must(/@media \(max-width: 720px\)[\s\S]{0,200}\.sb-txt \{ display: none; \}/.test(shareBtn),
  "ShareButton 缺少 ≤720 图标化（隐藏文字）样式");
must(/@media \(pointer: coarse\)[\s\S]{0,120}height: 44px/.test(shareBtn),
  "ShareButton 缺少触屏 44px 热区");
must(/@media \(pointer: coarse\)[\s\S]{0,120}height: 44px/.test(shareDrop),
  "ShareDropdown 缺少触屏 44px 热区");

/* ---------- 1.6 分享闭环：故事卡 / 二维码 / 文案 / 日历 ---------- */
const home = read("src/views/HomeView.vue");
const storyCard = read("src/core/sharecard.ts");
const extras = read("src/core/shareextras.ts");
const qrDialog = read("src/components/ShareQrDialog.vue");
must(/drawStoryCard/.test(storyCard) && /STW = 540, STH = 960/.test(storyCard),
  "缺少 9:16 竖版故事卡（540×960）");
must(/saveStoryCard/.test(shareDrop) && /pick\('story'\)/.test(shareDrop),
  "结论卡下拉里没有竖版故事卡入口");
must(/captionOf/.test(extras) && /buildIcs/.test(extras), "分享扩展缺少文案或日历实现");
must(/<ShareQrDialog/.test(home), "底部分享区没有接入二维码弹层");
must(/复制文案/.test(home) && /加入日历/.test(home) && /二维码/.test(home),
  "底部分享区缺少二维码 / 文案 / 日历入口");
must(/from "qrcode-generator"/.test(qrDialog), "二维码弹层没有使用 qrcode-generator");
must(/z-index: 300/.test(qrDialog), "二维码弹层层级低于顶栏");
must(/saveQr/.test(qrDialog) && /deliverBlob/.test(qrDialog), "二维码弹层缺少保存二维码图片的入口");
must(/saveQrCard/.test(qrDialog), "二维码弹层保存时没有生成卡片（照片 + 概率 + 质量）");
const feedbackDialogSrc = read("src/components/FeedbackDialog.vue");
must(/z-index: 320/.test(feedbackDialogSrc), "反馈弹层层级低于设置面板 / 顶栏");
must(/saveQr/.test(feedbackDialogSrc) && /a\.download/.test(feedbackDialogSrc),
  "反馈弹层缺少保存二维码图片的入口");
/* ---------- 1.61 分享按钮可点性（2026-11-11） ----------
   本地双击 index.html 时两个按钮曾恒为 disabled，而 .btn 没有禁用态，
   看着能点、点了毫无反应。快照模式与换参数后 snapUrl 为空也会禁用。 */
const urlstate = read("src/core/urlstate.ts");
const shareMainCss = read("src/styles/main.css");
must(/export const SHARE_SITE = "https:\/\/sunglow\.cloud\/";/.test(urlstate),
  "分享链接缺少线上正式站点常量 SHARE_SITE");
must(/export function shareBaseUrl/.test(urlstate) && /location\.protocol === "file:"/.test(urlstate),
  "shareBaseUrl 没有把 file:// 换到线上地址");
must(/shareBaseUrl\(\) \+ baseQuery\(\)/.test(home) &&
  !/location\.href\.split\("#"\)\[0\]\.split\("\?"\)\[0\] \+ baseQuery/.test(home),
  "HomeView 仍用 location.href 拼分享链接（本地打开时是本机路径）");
must(!/:disabled="!snapUrl \|\| isLocalFile"/.test(home) && !/if \(isLocalFile\) return;/.test(home),
  "分享按钮仍因本地打开被禁用 / 点击被拦截");
must(/link: !!snapUrl\.value/.test(home) && /share-why/.test(home) &&
     /:disabled="!it.ready"/.test(read("src/components/ShareTiles.vue")),
  "分享磁贴缺少无结果时的禁用态与可见原因");
must(/\.btn:disabled[\s\S]{0,220}cursor: not-allowed/.test(shareMainCss),
  "全局 .btn:disabled 缺少可见禁用态（用户会以为按钮坏了）");
must(/writeClipboard/.test(home) && /document\.execCommand\("copy"\)/.test(home) && /linkFallback/.test(home),
  "复制缺少剪贴板回退与手动复制入口");
must(/new URLSearchParams\(location\.search\)\.get\("snap"\)/.test(home),
  "快照模式没有生成可继续转发的分享链接");
must(/flush: "sync"/.test(home), "参数 watch 不是同步（初始化会把快照链接清空）");

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
must(/'glowcast-v2-pwa-' \+ buildId/.test(publish) && /const VERSION = /.test(publish),
  "publish-root 没有按 index.html 哈希给 sw.js 打构建戳");
must(/const VERSION = "glowcast-v2-pwa-__BUILD_ID__";/.test(sw),
  "sw.js 的 VERSION 不再是语义化占位 __BUILD_ID__（写死版本号会让升版失效）");
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

/* ---------- 1.9 不得宣称断网可完整使用 ---------- */
/* 「离线回落」也在禁列：它容易被读成「断网也能用」，实际只是取数失败后回落 mock */
const noOfflineClaim = /断网也能打开|断网也能开|断网可用|断网可开|断网也能看|双击即可离线使用|离线回落/;
for (const rel of ["tutorial.html", "404.html", "sw.js", "app.html", "README.md",
  "../tutorial.html", "../404.html", "../sw.js",
  "../README.md", "../code-wiki.html", "../V1/index.html", "../V1/tutorial.html", "../V1/README.md"]) {
  must(!noOfflineClaim.test(read(rel)), `${rel} 仍宣称断网可完整使用（气象取数需要联网）`);
}

/* ---------- 1.10 取数失败不造数据（2026-11-10） ----------
   一份编造的概率会让人拿着它出门，比没有结果更糟：失败只能给「没有取到数据」提示。
   src="mock" 只允许出现在显式 useMock 分支里，不允许再有任何自动回落。 */
const fc = read("src/core/forecast.ts");
must(/NO_DATA_MSG/.test(fc) && /return \{ ok: false, error: t\(NO_DATA_MSG\) \}/.test(fc),
  "取数失败没有返回「没有取到数据」提示");
must((fc.match(/src = "mock"/g) || []).length === 1 && /if \(opts\.useMock\)/.test(fc),
  "mock 仍有自动回落分支（src=\"mock\" 只允许出现在显式 useMock 分支）");
must(/err-note[\s\S]{0,600}重新计算/.test(read("src/components/ConclusionCard.vue")),
  "无数据提示没有给「重新计算」出口");
must(/这次没有取到数据/.test(read("src/core/i18n-extra.ts")),
  "「没有取到数据」缺少繁 / 英词条");

/* ---------- 1.11 分享板块八磁贴 + 方案 D 合成卡 ----------
   2026-11-12 用户拍板：把方案 A「一处总览」落地 —— 4 张图片产物 +
   4 个链接 / 提醒动作排成 2×4 磁贴；旧的四按钮 .share-acts 撤掉。 */
must(/<ShareTiles :items="shareTiles" @pick="onTile" \/>/.test(home),
  "分享板块不是八磁贴（ShareTiles）");
must(/SHARE_TILE_KEYS: ShareTileKey\[\] =[\s\S]{0,160}"card", "story", "trend", "map", "link", "qr", "caption", "ics"/.test(home),
  "八磁贴顺序不对（前四张图片、后四个动作）");
must(/provideShareHub\(\)/.test(home) && /shareHub\.entries\[k\]\?\.save\(\)/.test(home),
  "图片磁贴没有经 sharehub 转发给各卡自己的保存函数");
must(/if \(k === "link"\) void copySnap\(\)/.test(home) &&
     /else if \(k === "qr"\) openQr\(\)/.test(home) &&
     /else if \(k === "caption"\) void copyCaption\(\)/.test(home) &&
     /else if \(k === "ics"\) addCalendar\(\)/.test(home),
  "四个动作磁贴没有接回原处理函数");
must(!/share-acts/.test(home), "分享板块仍残留旧的四按钮 .share-acts");
must(!/share-more/.test(home) && !/class="mlink"/.test(home) && !/t\("更多："\)/.test(home),
  "分享页仍残留「更多：」文字链");
const tiles = read("src/components/ShareTiles.vue");
must(/:data-share="it.k"/.test(tiles) && /:disabled="!it.ready"/.test(tiles),
  "磁贴缺少 data-share 身份 / 就绪禁用态");
must(/grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/.test(tiles) &&
     /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(tiles),
  "磁贴不是桌面 4 列 / 窄屏 2 列");
const hubSrc = read("src/core/sharehub.ts");
must(/provide\(HUB_KEY, hub\)/.test(hubSrc) && /onMounted\(\(\) => hub.register/.test(hubSrc),
  "sharehub 不是 provide / onMounted 登记");
must(/useShareImage\("card"/.test(read("src/components/ShareDropdown.vue")) &&
     /useShareImage\("story"/.test(read("src/components/ShareDropdown.vue")) &&
     /useShareImage\("trend"/.test(read("src/components/TrendSection.vue")) &&
     /useShareImage\("map"/.test(read("src/components/MapView.vue")),
  "四张图片产物没有全部登记到 sharehub（各卡自己的保存函数）");
must(!/"更多：":/.test(read("src/core/i18n-extra.ts")), "i18n-extra 仍留着已弃用的「更多：」词条");
must(/<ShareComposer/.test(home), "分享页没有接入合成分享卡（方案 D）");
const composer = read("src/components/ShareComposer.vue");
const composeCore = read("src/core/composecard.ts");
const composeMods = read("src/core/composemods.ts");
must(/drawComposeCard\(el, input/.test(composer) && /saveComposeCard\(input/.test(composer),
  "合成面板没有复用 drawComposeCard / saveComposeCard（预览与导出同源）");
must(/trendDaysCached/.test(composer) && /mapThumbCached/.test(composer),
  "合成面板的取数口径不是只读缓存（趋势 / 观测场都必须查缓存）");
must(!/loadTrend|apiForecast|apiAQ/.test(composer),
  "合成面板会触发取数——只允许读缓存");
/* 2026-11-11 重做：底卡回到 780×400 原版结论核心，14 个可选模块按实高累加 */
must(/const MEASURE_H = \d+/.test(composeCore) && /paint\(c, d, mods\)/.test(composeCore),
  "合成卡不是两遍绘制（先量后定高）");
must(/function composeRenderList/.test(composeCore) && /function composeAvail/.test(composeCore),
  "合成卡缺少可用性过滤 / 渲染顺序整理");
must((composeMods.match(/id: "/g) || []).length === 14,
  "模块清单不是 14 个可选模块");
must(/COMPOSE_DEFAULT_ON: ComposeModId\[\] = \["sky", "qr"\]/.test(composeMods),
  "默认勾选不是极简（天色带 + 二维码）");
must(/anchored: true/.test(composeMods) && /anchored/.test(composeCore),
  "天色带没有锚定在结论层上方（模块 2 的版式会被打乱）");

/* ---------- 1.17 十日趋势 = 结论胶囊 + 双行热力格（2026-11-12 三次改版） ----------
   演进：单柱（柱高=概率+橙标最佳，两套指标抢通道）→ 双行热力格（读不出「该去哪天」）
   → 并排双柱（柱高=质量，柱顶两行数字互相挤）→ 现在：顶部三枚「最值得出门」胶囊
   先给答案，下面 10×2 热力格给全量数据（格内左概率右质量）。 */
const trendBody = composeCore.slice(
  composeCore.indexOf("function drawTrend"), composeCore.indexOf("模块 6：观测场"));
must(!!trendBody, "找不到 drawTrend");
must(/const marks = \["①", "②", "③"\]/.test(trendBody) && /t\("最值得出门"\)/.test(trendBody),
  "趋势顶部没有「最值得出门」结论胶囊");
must(/pers: Array<"am" \| "pm"> = \["am", "pm"\]/.test(trendBody) &&
     /dd\.am/.test(trendBody) && /dd\.pm/.test(trendBody),
  "趋势没有分别读 am / pm 两条数据");
must(/const ramp = TREND_RAMP;/.test(trendBody) &&
     /mixHex\(ramp\[0\], ramp\[1\], tt \* 0\.\d+\)/.test(trendBody) &&
     /mixHex\("#1B2436", ramp\[1\]/.test(trendBody),
  "格子底色没有按概率在 TREND_RAMP 两端之间插值（浅色/深色两条分支都要有）");
must(/export const TREND_RAMP: \[string, string\] = \["#[0-9A-Fa-f]{6}", "#[0-9A-Fa-f]{6}"\]/.test(composeCore),
  "TREND_RAMP 不是一对十六进制颜色");
must(/gradeColor\(row\.grade, p\.dark\)/.test(trendBody) && /Math\.round\(row\.Q\)/.test(trendBody),
  "格内右侧不是按质量分档上色的质量分");
must(/all\.sort\(\(a, b\) => \(b\.Q - a\.Q\) \|\| \(b\.P - a\.P\)\)/.test(trendBody) &&
     /\.slice\(0, 3\)/.test(trendBody) && /c\.arc\(x \+ cellW \/ 2, cy, 7\.5/.test(trendBody),
  "前三名没有按质量分排名并画在格子顶边");
must(/setLineDash\(\[3, 3\]\)/.test(trendBody) && /fillText\("—"/.test(trendBody),
  "缺时段没有画灰虚线格 + 破折号");
must(!/const pick = \(dd: TrendDay\)/.test(trendBody),
  "趋势仍在静默用另一时段补缺");
must(/weekdayOf\(dd\.date\)/.test(trendBody), "日期行没有标星期");
must(/cellW = \(INNER - LAB_W - GAP \* \(n - 1\)\) \/ n/.test(trendBody),
  "列宽没有按实际天数自适应（不足十天会在右侧留空列）");
must(/while \(fp > 9 && pairW\(fp, fq\) \+ 12 \+ 6 > cellW\)/.test(trendBody),
  "极值（100% 与三位质量分）没有做逐档降字号的间距兜底");
must(/①②③＝前三名/.test(trendBody), "图例缺「①②③＝前三名」");

/* ---------- 1.12 标题外置：光追 / 分享的标题排在白卡外，「附注」卡不动 ----------
   2026-11-11：两个板块的标题原本贴在白卡里，其它板块（对比 / 趋势 / 观测场）
   一律是 .section-head 在卡外。附注与光追共用 FoldCard，只能按开关区分。 */
const foldCard = read("src/components/FoldCard.vue");
const ray = read("src/components/RayDetail.vue");
const notesCard = read("src/components/NotesCard.vue");
must(/outsideTitle\?: boolean/.test(foldCard) &&
     /v-if="outsideTitle" class="section-head fc-head"/.test(foldCard) &&
     /v-if="!outsideTitle" class="fc-head"/.test(foldCard),
  "FoldCard 缺少标题外置开关（outsideTitle + 卡外 .section-head / 卡内 fc-head）");
must(/outside-title/.test(ray), "光追算法细节没有启用标题外置");
must(!/outside-title/.test(notesCard), "「附注」卡被误改成标题外置（用户要求附注不动）");
const shareSec = (home.match(/<section id="share"[\s\S]*?<\/section>/) || [""])[0];
const iHead = shareSec.indexOf('class="section-head"');
const iGlass = shareSec.indexOf('class="glass"');
const iTip = shareSec.indexOf('class="share-tip"');
must(iHead >= 0 && iGlass > iHead && iTip > iGlass &&
     /<h2>\{\{ t\("分享"\) \}\}<\/h2>/.test(shareSec) && !/<h3[^>]*>\{\{ t\("分享"\) \}\}/.test(shareSec),
  "分享标题没有移到白卡外、附注跑出了卡片，或卡内仍留着旧 h3");

/* ---------- 1.13 影响因素默认收起（2026-11-11） ----------
   13 项卡很长，默认收起；目录点过去必须就地展开，否则跳进一个空节。 */
const factorsPanel = read("src/components/FactorsPanel.vue");
const topbar = read("src/components/TopBar.vue");
must(/"factorsFold"/.test(state) && /factorsFold:\s*true/.test(state),
  "state.ts 没有登记 factorsFold，或默认值不是「收起」");
must(/v-show="!state\.folds\.factorsFold"/.test(factorsPanel) &&
     /toggleFold\('factorsFold'\)/.test(factorsPanel) &&
     /class="btn btn-ghost sm fac-fold"/.test(factorsPanel) &&
     /aria-controls="factors-body"/.test(factorsPanel),
  "影响因素没有接上折叠按钮 / v-show / 可达性属性");
must(/id: "#factors"[^}]*fold: "factorsFold"/.test(topbar),
  "目录里的「影响因素」没挂 fold，默认收起后点导航会跳进空节");

/* ---------- 1.14 全功能快照：主页直开 + 全部板块随链接走 ----------
   旧版打开 ?snap= 只给一张孤立的快照结果卡，趋势 / 观测场 / 影响因素全丢。 */
const snapPack = read("src/core/snapshot.ts");
const forecastSrc = read("src/core/forecast.ts");
const trendCore = read("src/core/trend.ts");
const mapCore = read("src/core/mapdata.ts");
const compareCore = read("src/core/compare.ts");
must(/export async function buildSharePack/.test(snapPack) &&
     /export async function installSharePack/.test(snapPack) &&
     /CompressionStream\("deflate"\)/.test(snapPack),
  "全功能快照包缺少打包 / 安装 / deflate 压缩");
must(/export function readPackRaw/.test(urlstate) &&
     /location\.hash \|\| ""/.test(urlstate) &&
     /function hashWithPack/.test(urlstate) && /p\.set\(PACK_PARAM, raw\)/.test(urlstate) &&
     /export const PACK_PARAM = "pack"/.test(snapPack),
  "快照包没有走 hash 查询串（普通 query 超过 8 KB 会 414）");
must((forecastSrc.match(/snapCacheEntry/g) || []).length >= 2 &&
     (trendCore.match(/snapCacheEntry/g) || []).length >= 1 &&
     (mapCore.match(/snapCacheEntry/g) || []).length >= 1 &&
     /snapCmpList/.test(compareCore),
  "六个缓存读取入口没有全部接上快照 overlay（point/trend/map/compare）");
must(!/snap-card/.test(home) && !/<template v-else>/.test(home) &&
     /class="glass snap-banner"/.test(home) && /<ConclusionCard/.test(home) &&
     /<TrendSection/.test(home) && /<MapView/.test(home) && /<FactorsPanel/.test(home),
  "快照又变回孤立结果页，或主页板块被 v-else 挡住了");
must(/await installSharePack\(u\.pack\)/.test(home) && /\n  run\(\);/.test(home),
  "快照模式没有先装包再跑一次 run()（state.result 不会落地）");
must(/qrSafeUrl/.test(home) && /qrSafeUrl/.test(read("src/core/sharecard.ts")) &&
     /lite\?: boolean/.test(qrDialog),
  "长链接没有二维码降级（qrcode-generator 单码上限约 3 KB）");
must(/sunglow:fill-snapshot/.test(trend) && /sunglow:fill-snapshot/.test(map) &&
     /watch\(snapshotReady/.test(trend) && /watch\(snapshotReady/.test(map),
  "趋势 / 观测场缺少「一键补齐」或快照异步就绪后的补读");

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

/* ---------- 1.15 结论分享卡 = 整个结论板块（2026-11-11） ----------
   用户要求「结论分享卡的把整个结论板块的内容全部做进去」：只留概率大字的
   780×400 横版不够，扩成 780×1024 的完整版，页面 #verdict 的每一块都要在图上。 */
must(/const W = 780, H = 1024, S = 2;/.test(card),
  "结论卡画布不是 780×1024（完整结论版）");
must(/function wrapText/.test(card) && /function modelCardsOf/.test(card) &&
     /function drawModelCard/.test(card),
  "结论卡缺少多行文本 / 四张模型卡的绘制实现");
for (const k of [
  't("出现概率")', 't("观赏质量")', 't("等级")', 't("可信度")', 't("模型分歧 ΔI")',
  't("方位角")', 't("云底高度")', 't("持续时间")', 't("能见度")',
  't("几何条件")', 't("各模型独立结果")', 't("说明 · 概率与质量分怎么算")',
  't("五段曙暮光：白昼余晖 / 民用 / 航海 / 天文 / 夜间")',
  't("底部橙条＝霞光窗口")', 't("同一份取数，四路独立评分")'
]) {
  must(card.includes(k), "结论分享卡缺少「" + k + "」这一块内容");
}
must(/contentEnd: Math\.round\(ny\)/.test(card),
  "结论卡没有暴露 contentEnd（排版留白靠它核对）");
must(/heightPx\.value = Math\.round\(meta\.h \/ 2\)/.test(composer),
  "合成面板没有把实测高度写回「成图 780×h」");
must(/t\("完整版"\)/.test(read("src/components/ShareDropdown.vue")),
  "下拉菜单里还是「横版」——卡片已经改成完整版");

/* ---------- 1.16 合成卡预览可放大（2026-11-11） ----------
   320px 的预览看不清长图细节：整块预览做成按钮，点开弹层看整张。 */
must(/<button[\s\S]{0,260}class="cmp-preview"/.test(composer) &&
     /@click="openZoom"/.test(composer) &&
     /aria-label="t\('放大预览合成分享卡'\)"|:aria-label="t\('放大预览合成分享卡'\)"/.test(composer),
  "合成卡预览不是可点的按钮（缺 openZoom / aria-label）");
must(/function openZoom/.test(composer) && /drawImage\(src, 0, 0\)/.test(composer),
  "放大层没有把当前画布原样拷贝过去（drawImage）");
must(/class="zoom-mask"/.test(composer) && /class="zoom-cv"/.test(composer) &&
     /<Teleport to="body">/.test(composer),
  "缺少放大预览弹层（Teleport + zoom-mask + zoom-cv）");
must(/key === "Escape"[\s\S]{0,120}closeZoom/.test(composer) &&
     /document\.body\.style\.overflow = "hidden"/.test(composer),
  "放大层不支持 Esc 关闭或没有锁滚动");
must(/\.cmp-preview \{[\s\S]{0,500}cursor: zoom-in/.test(composer),
  "预览没有 zoom-in 光标提示");

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
  "竖版故事卡", "分享", "二维码", "复制文案", "加入日历",
  /* 八磁贴（2026-11-12）：副文案也要三语齐全 */
  "十日趋势图", "含最佳窗口标注", "热力面 + 城市名", "先在上方加载趋势",
  "快照链接，对方零取数", "扫码看同一份结论", "一句话转发今晚的霞",
  "覆盖观赏窗口，提前 30 分钟",
  "当前从本地文件打开，复制链接与二维码会自动指向 {site}，对方打开即可查看快照，无需重新取数。",
  "先算出结果，才能生成分享链接：点上方「重新计算」取得本次预报。",
  "复制失败，请选中下面的链接手动复制",
  "趋势图", "观测场图", "合成分享卡", "可选块", "极简", "标准", "完整",
  "观测场缩略", "天色带与观赏窗口", "三因子",
  "最佳观赏窗口", "霞光档案 · {city}{period} {p}%", "今晚", "明晚",
  "新版本已就绪", "反馈", "反馈与交流", "反馈及交流请联系官方小红书",
  "前往小红书主页", "小红书主页截图", "保存二维码图片",
  "关于 / 隐私", "数据来源", "本地存储与隐私",
  /* 全功能快照链接（2026-11-11） */
  "退出快照，按当前条件查看",
  "这是分享者当时的完整缓存：结论、十日趋势、观测场、影响因素等板块已在本页还原，本次打开不消耗接口额度；各板块仍保留「缓存」标记。",
  "这是经典原版的精简快照（只含结论数据）。主页其它板块按当前条件查看，点各板块的加载按钮即可取数。",
  "观测场已按抽样精度压缩", "结论与影响因素", "链接内含", "尚无缓存数据",
  "模型分歧 ΔI", "点击放大", "合成分享卡预览", "成图 780×{h}",
  "模型卡", "云体条件", "光路几何", "大气通透", "动力与对流",
  "光追关键量", "光谱色样", "照亮时间轴", "亮度·彩度曲线",
  "可选模块 · 拖动排序", "拖动排序", "固定在结论上方", "当日霞光时段",
  "已选 {n} 块 · 成图 780×{h}（高随内容走）", "扫码查看完整结论",
  "补齐全部数据（会取数）",
  "{n} 日趋势", "左＝出现概率", "右＝质量分", "①②③＝前三名", "—＝该时段无数据",
  "完整链接较长，二维码用的是精简版（只含结论数据）；要共享全部板块，请点「复制链接」。"
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
/* 首屏免责标语压在照片白纱上，实际底色是 --bg-base（#f2f5fb），比 --bg-card-solid
   更暗一档：--tx-3 在那里只剩 4.45:1，所以 .hero-note 必须用 --tx-2。 */
const heroSrc = read("src/components/HeroSection.vue");
const heroNote = heroSrc.match(/\.hero-note\s*\{([\s\S]*?)\}/);
must(!!heroNote, "HeroSection.vue 找不到 .hero-note 样式块");
if (heroNote) {
  const tok = heroNote[1].match(/color:\s*var\(--(tx-[123])\)/);
  must(!!tok, ".hero-note 的 color 不是 --tx-1/2/3 令牌");
  if (tok) {
    for (const theme of ["dark", "light"]) {
      const fg = themeColor(theme, tok[1]);
      const bg = themeColor(theme, "bg-base");
      must(!!fg && !!bg, `tokens.css 解析不到 ${theme} 的 --${tok[1]} / --bg-base`);
      if (fg && bg) {
        must(contrast(fg, bg) >= 4.5,
          `${theme} 主题首屏免责标语 --${tok[1]} 在 --bg-base 上对比度 ` +
          `${contrast(fg, bg).toFixed(2)}，低于 4.5:1`);
      }
    }
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

/* ---------- 观测场缓存：立即落盘 / 日期可恢复 / 探针不删用户数据 ----------
   2026-11-11 事故：探针整族清 SUNGLOW.v2.* 把用户的观测场缓存删了；
   mapCachePut 又排在 requestIdleCallback 里，图出来就刷新等于没存过。 */
const mapdataSrc = read("src/core/mapdata.ts");
const putAt = mapdataSrc.indexOf("export function mapCachePut(");
const putBody = putAt < 0 ? "" : mapdataSrc.slice(putAt, putAt + 900);
must(putAt >= 0 && /localStorage\.setItem/.test(putBody)
  && !/requestIdleCallback|stillWanted/.test(putBody),
  "观测场缓存又改回延迟落盘或取数令牌闸门（图出来就刷新会丢缓存）");
const probeSrc = read("scripts/probe-ui.mjs");
must(!/startsWith\('SUNGLOW\.v2\.'\)[\s\S]{0,100}removeItem/.test(probeSrc),
  "probe-ui 又整族清 SUNGLOW.v2.*（file:// 下会删掉用户的观测场缓存）");
must(/mapDateS:\s*hasSavedMapDate\(\)/.test(state)
  && /mapDateS:\s*state\.mapDateS/.test(state),
  "观测场日期没写进偏好（刷新后日期漂移会 miss 缓存）");

/* ---------- 1.18 全页日期联动（2026-11-12） ----------
   顶部月历与观测场日期曾是两套独立设置。现在只认一个「当前查看日期」，
   任一边改动都同步到另一边；两处控件的可选窗口也必须同源，否则
   顶部选到 +10 天时观测场 Select 取不到匹配项，触发器会显示空白。 */
const dpSrc = read("src/components/DatePicker.vue");
const mapSrc = read("src/components/MapView.vue");
const urlSrc = read("src/core/urlstate.ts");
const homeSrc = read("src/views/HomeView.vue");
const trendSrc = read("src/components/TrendSection.vue");
must(/export const DATE_MIN_OFFSET = -2;/.test(state)
  && /export const DATE_MAX_OFFSET = 15;/.test(state),
  "日期窗口常量没落在 state.ts（两处控件会各写一套范围）");
must(/addDays\(today\.value, DATE_MIN_OFFSET\)/.test(dpSrc)
  && /addDays\(today\.value, DATE_MAX_OFFSET\)/.test(dpSrc)
  && /k = DATE_MIN_OFFSET; k <= DATE_MAX_OFFSET/.test(mapSrc),
  "顶部月历与观测场下拉没有共用同一对范围常量");
must(/flush: "sync"/.test(state)
  && /watch\(\(\) => state\.dateStr, \(v\) => \{[\s\S]{0,140}state\.mapDateS = v/.test(state)
  && /watch\(\(\) => state\.mapDateS, \(v\) => \{[\s\S]{0,140}state\.dateStr = v/.test(state),
  "dateStr ↔ mapDateS 缺少双向 sync 同步器（会在初始化/打包时差半拍）");
must(/hasSavedMapDate\(\) && state\.mapDateS !== state\.dateStr/.test(state),
  "首屏没有按偏好把整页日期对齐（刷新后两边一分家就 miss 缓存）");
must(/diff >= DATE_MIN_OFFSET && diff <= DATE_MAX_OFFSET/.test(state),
  "偏好日期有效性窗口没跟着扩大（+8~+15 天会被误判过期）");
must(!/state\.mapDateS\s*=/.test(urlSrc)
  && !/state\.mapDateS\s*=/.test(trendSrc)
  && !/if \(state\.mapDateS === oldT\)/.test(state),
  "还有别处在各自同步观测场日期（日期口径必须单点）");
must(/!out\.some\(\(o\) => o\.v === state\.mapDateS\)/.test(mapSrc),
  "观测场下拉没有把窗口外的当前日期补进选项（旧分享链接打开会显示空白触发器）");
must(/if \(!u\.date && !hasSavedMapDate\(\)\)/.test(homeSrc),
  "onMounted 仍会无条件把日期覆盖成今天（会冲掉偏好恢复的上次日期）");

if (issues.length) {
  console.error(`check-ui: ${issues.length} 处 UI 断言失败`);
  for (const s of issues) console.error("  ✗ " + s);
  process.exit(1);
}
console.log("check-ui: ✓ 趋势布局 / 分享卡口径 / 三语键 / 触屏热区 / 对比度 / 缓存落盘断言通过");
