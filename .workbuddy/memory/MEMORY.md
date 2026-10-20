# 霞光预报 · 长期约定（索引）

> 56 条约束全文见 `.workbuddy/memory/硬约束详解.md`；过程见根目录总结与每日日志。改模块前先查详解。

## 构建与验证
- 源：`tpl/template.html`、`_p2.._p6.js`、`refs/*`；`index.html`/`404.html`/`_check/preview.html` 是产物禁手改。
- 流程：`SITE_BASE=sunglow python assemble.py`（必须带 SITE_BASE）→ `mkpreview.py` → `_check/all.py`；同一时间只跑一个 `all.py`。`all.py` 是唯一总判据（单项可能 stdout 报失败却 exit 0）。4 个内联脚本块按内容定位不按序号。
- 整批 git 回退后必补 `mkpreview.py`（preview.html 不进 git）：回退 → assemble（字节对 git）→ mkpreview → all.py。

## 地图
- 网格 500km/120km/固定 57 点；`mapPts()` 以 `MapMod.gridC` 为中心；缓存 **v6**（`pts` 带 `cld`）。取数只许显式触发（例外仅缓存命中自动绘制）；`cacheOnly` 在快路径后、网络前返回，绝不挂 `setLocation`。缓存经 `mapKeyOf()`+版本：地图豁免当前地点，单点/趋势不豁免。
- `MAP_TZ`=API `timezone=auto`；代理仅占位符 `__TMAP_SERVICE_HOST__`；429 文案区分日额度/短时限流。分歧/可信度走 `dvI`/`ensConfOf`/`ENS_CONF_BANDS`/`bandColor()`；有效模型<2 时分歧 `null`。
- 深色底图并入全局主题（`.mapwrap.dark` 唯一来源 `isDarkTheme()`+`applyMapDark()`）。色面**固定 0–100 绝对刻度**；`HEAT_RAMP`（`_p4.js` 唯一）=白→黄→橙→红 8 锚点（2026-10-18 用户拍板旧尺）；harness 色阶断言=git 原块，换肤要重写断言。

## 渲染与交互
- 图层 0→8+tip(20)；全屏 `.mapwrap.fs` z=2100、`#cardMap.fsmap` 全屏中 **z=2200**（sticky 层叠陷阱双端兜底，`setMapFs` 唯一切 `.fs`）；`.fsExit` 住 `.mapwrap` 内；**#map 须 position:relative;z-index:0**。可点必须 elementFromPoint 验。色面双降走 `.rlayer{opacity:.75}` 不写画布 alpha。
- 羽化噪声 `EDGE_NOISE_KM=26` 按进度缩放；经纬网两层（3px 光晕+1px 芯线，反差≥28）；云纹四档 `TX_BAND_HI=25`/`TX_BAND_A`/`txBandOf()`（晴不画，逐格公式比对）。可信度纱层已删（层号 4 不回收）；藏卡只走 `hideMapTip()`。
- ≤760px：提示卡 dock 底 z=2000；`#map` 高 460；排行榜前 4+查看全部（`RANK_NARROW_N=4`，复用 760 断点）；拖动>12px 收卡。
- **顶栏两行（双端）**：行1 ☰/logo/标题/语言`#langBtn`/主题`#themeBtn`（三选一下拉挂 body 级，`#langSeg/#themeSeg` 在菜单内）；行2 徽标纯文字右对齐。桌面 87px/手机 71px；scroll-margin-top 94/78。**目录抽屉**：汉堡最左单入口，面板贴顶栏下缘，遮罩 z119；手机顶栏 sticky。404 顶栏 static 同步精简。
- 偏好 `sunsetbot.pref.v1` 白名单先读后合并；`applyPrefs()` 早于 UI 派生；位置/日期/`mapPeriod` 不持久化。天色带轴两行（太阳事件/now 游标）；`fitAxis()` 降级幂等；页外判据函数顶层定义，`window` 监听前 `typeof window` 守卫。
- 视觉**方案四·纸面仪器**：`.card` 只给结论与地图，余下 `.card.q` 透明+发丝线；`--grad*` 已删；深色 `--solid` 比卡片亮一档。

## 安全 / 页面 / 部署
- 用户输入 `textContent`；favicon/apple-touch-icon 内联。404 自包含 noindex 任意深度，`__SITE_BASE__` 注入。快照只存内部键值、解码限长逐字段校验、快照模式不跑预报。
- PWA 是 `PWA=1` 可选产物；默认只有 index+404（单文件核心约束）；SW 不缓存气象响应；内联脚本块=4 不变量。F4 校准 `sunsetbot.calib.v1`：只展示不回改 / 样本不够不给结论（`CALIB_MIN_N=8`、`CALIB_MIN_BUCKET=3`）/ `a=-1` 不进统计 / 关掉≠删除。
- 数据源仅 Open-Meteo（非商业）；前端直连按 IP 计额度不代转；地图代理可 CF Pages Functions；首屏约 65 加权调用。中国区域底图不得擅自换 Leaflet/MapLibre。
- **同步走 `~/sunglow-sync.py`**（Git Data API 一个提交）；本机 git→github.com 永久 502 只放行 api.github.com；令牌在 `~/.workbuddy/mcp.json` 经 `GITHUB_TOKEN` 传绝不进 argv。推前先本地 commit；验收只比 tree SHA。Pages 是 branch 源，部署走 Actions；`Page build failed` 可能是排队超时伪装。

## 回归方法
语义变更先用独立参考实现证旧语义一致再双重差分。探针忌固定 sleep/硬编码坐标/未转义正则反引号；判据必须自检。按身份/集合断不按总数断死；分段控件分两类（单选组恰一 vs 记录器至多一）；`#calibSeg` 仅 `leadH<=-1` 才渲染；计数器在被测动作结束那一刻取值；判就绪不能用 `window.State`（恒 undefined）；重复导航要握手标记。行尾机制化：`.gitattributes` 全仓 LF + `syntax.py` 断源无 CRLF（查 blob 用 `git cat-file blob`）。

## 教程页 tutorial.html（2026-10-19）
手写独立不进 assemble（双击可开、断网可读、零外部引用）；`_check/tutorialprobe.js` 34 条单独守。三语键=简体原文只写繁/英；`applyLang` 必须 `pick(n)`。繁體不用 `text===key` 判回落（简繁同形），用词典覆盖率+繁体专用字计数（≥20 节点）；英文可 `text===key`。显隐按 computed `display` 判；可点过 elementFromPoint。主题共享 `sunsetbot.pref.v1`（教程整份读只补 `lang`/`theme`）。两入口 `#tutBtn`+`#tocTut`（真链接）。截图坑：`captureBeyondViewport` 时 fixed 只画原视口。

## 三版并存（2026-10-20）
- 三版：原版（根目录 assemble 链）/ `v2/`（大气光谱观测站，Vite+Vue3）/ `v3/`（追光航志，指挥台 IA+暮色航图）。**原版与 v2 一经交付即冻结**；v3 单向链出，互不改对方任何文件与 localStorage 键（`sunsetbot.*` / `glowcast.v2.*` / `glowcast.v3.*` 三方隔离，探针断言不删别家键）。
- 算法口径三版同源（原版为唯一权威）；v2 移植有 3 处已知漂移（mixedIndex 0.62/0.38、算术平均综合、一致性公式），v3 已回正，详见 2026-10-20 日志与 `v3/README.md`。
- v3 地图=画布航图（无 TMap/无代理密钥，standalone 断网可开）；观测场沿「显式触发」纪律。v3 新能力只做展示层推导（suggest.ts）。
- v3 验证三件套：`npm run typecheck` / `npm run build` + `build:standalone` / `npm run probe`（89 断言）。
- 工具坑：agent-browser 跨 Bash 调用目标漂移（截图假白页、click 不触发 Vue handler）——每条链以 open 开头、截图绝对路径、验状态用 `window.__v3` 句柄。
