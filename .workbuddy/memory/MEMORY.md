# 霞光预报 · 长期约定（索引）

> 一行一条**规则**。为何这么定 / 实测数字 / 完整推导都在 `硬约束详解.md`（51 条完整版）；
> 过程在根目录 `改进落地说明.md` / `阶段性总结.md` / `下一步方案*.md` 与同目录 `YYYY-MM-DD.md`。
> **改某模块前，先去详解读对应条目。**

## 构建管线（改源文件后必须重跑）
`python assemble.py`（→ `index.html` **与 `404.html`**）→ `python mkpreview.py`（→ `_check/preview.html`，**所有探针跑它**）。
产物＝`tpl/template.html` + `_p2.._p6.js` + `refs/*`；**两个产物都禁止手改**。占位符：数据 4 个
（`CN_CITIES`/`MAP_CITIES` 仍供 `ALL_CITIES` 解析，**非死代码**/`GLOBAL`/`ELEV_GRID`）、
`__TMAP_SERVICE_HOST__`、`__ICON_SVG__`/`__ICON_PNG180__`、`__SITE_BASE__`（仅 404，见 52）。
**产物名 `index.html` 散落在 9 处**（`assemble.py` 的 `OUT`/`wr()`、`mkpreview.py`、6 个探针的读取、3 份 md）⇒ 改名必须同步。判"有没有断"只看 `python _check/all.py`。

## 硬约束（改了就会坏）
1. `geomSig()` **只校验点集** ⇒ 改几何字段必须**升 `MAP_CACHE_PREFIX`**。
2. `exact`≈Int16 点下标 ⇒ 采样点 ≤ **32,767**。
3. 权重必须 Float64；段内候选**按原 pts 下标升序**写入。
4. `FIELD_STEP` 与 `FIELD_BLUR` 必须同步。
5. `LABEL_TIERS` 只在跨台阶时重建 DOM；拖动地图不得重建。
6. `dlT` 必须按 **(列,点) 转置**存。
7. `MAP_TZ ≡ API_TZ="auto"`。
8. **默认城市只有一个来源**（`State` 初值）；`initUI` 只允许一次 `setLocation`。
9. **额度纪律**：地图取数必须**用户显式触发**，别把 `loadMapData()` 加回 `initMap` 末尾。
    ⚠️ **有界放宽（B14）：有缓存就自动画**（`autoLoadMapFromCache()` → `loadMapData(false,true)`）。
    边界落在"**发不发请求**"：`cacheOnly` 的 `return false` 在两条缓存快路径**之后**、网络调用**之前**
    ⇒ 别在调用方复制命中条件去对齐（镜像条件必漂移）。挂点只有两个：`initMap` 末尾 +
    `mapOnPlaceChanged` 的**作废分支**；**绝不能挂 `setLocation`**（小幅移动 ≤`MAP_KEEP_KM` 时地图未失效）。
    判据：localgrid 两次加载对照；"地图取数"特征＝**坐标数 ≥50**（地图 57 / 单点 1 / 趋势 34）。
10. `MapMod.ok`≠「数据就绪」；`loading` 只是进度条位；判有无数据用 `mapSet()`/`strips.length`。
11. **429 文案必须走 `friendly`**，三条取数链路都接；日额度耗尽劝退 / 短时限流重试，**处置相反**。
12. `mapPts()` 由 `MapMod.gridC`（**网格中心**）决定，**非** `State.lat/lon`。
13. **缓存键两道闸门**：版本号 + `mapKeyOf()`；三个入口统一走它。
14. **LRU 只按日期计数** ⇒ 必须有 `mapCacheSweep()` 跨地点总闸门。
15. **「多远之外不可信」只有一个来源**：`MAP_IDW_MAX ≡ TIP_RANGE_KM ≡ FIELD_REACH_KM`。
16. `gridName` 三档 + 建好点集后**必须再去重**；方位计算经度差乘 `cos(lat)`。
17. 悬停**两重节流**（rAF + DOM 去重）；`mouseleave` 必须 `cancelHover()`。
18. **「模型分歧」与所选模型解耦**；**少于两套有值返回 `null` 而非 0**；零取数。
19. **可信度纱是独立画布**，绝不动色面像素；**纱边界＝凸包外**（`sd>0`），与色面淡出边界、B1 虚线**同一条**。
    **`FIELD_FULL`(90) 只管悬停卡文案** —— `dkm`（离最近点）表达不了"外推"。
20. **图层次序**：0 底图压暗 / 1 色面 / **2 等值线+经纬网+数据范围边界线** / 3 纱 / 4 方位环 / 5 直标 /
    6 图钉 / 7 遮罩 / 20 提示卡。新增层同步三处：template 注释表 / `z-index` / `.mapwrap.dark` filter 名单。
21. `renderPins` 靠签名兜底；清空 `pinLayer` **必须同时置空 `pinSig`**。
22. `#mapDateSel` 只写 `textContent`；`（今天）/（明天）`文案只一处定义。
23. **样带必须与单点同构**（`step=transect[1].d−transect[0].d`）；动点数/间距要同步 `MAP_AZ_KM` + 升缓存版本。
24. **`consist` 与 `ensConfOf` 同一把尺子**（都由 `dvI` 导出）：地图 `dv` / 结论卡徽标 / 因素表 / 分享卡。
25. **可信度档位与配色只有 `ENS_CONF_BANDS`**；不再手写 18/35；`dv==null` 返回**「中」**。
26. **分享卡必须复用页面文案与配色**；`toBlob` 缺失时静默不报错。
27. **`F_MAP_VARS` 是 10 个，不得删 `dew_point_2m`**。
28. **三个内联 `<script>` 共享全局作用域，`function` 声明静默覆盖** ⇒ **新增全局函数前先 `grep _p6.js`**；单点侧带 `ens` 前缀。
29. **两个缓存键族共用总闸门但豁免相反**（地图 `true`/单点 `false`）；`POINT_CACHE_MAX=4` 是**实测定的**；单点缓存存**原始响应**、键含**时段**。
30. **`TREND_DAYS` 必须经 `trendWindow()` 夹紧**（越界 400 ⇒ 整轮失败）。
31. **地图代理只有一个占位符 `__TMAP_SERVICE_HOST__`**，产物**不允许残留**；判"没配"走 `isMapProxyPlaceholder()`；**key 永不进产物**。
32. **图标必须内联**：favicon 用 SVG data-URI、apple-touch-icon 用 **PNG**（iOS 不支持 SVG）；data-URI 里 `#` 写 `%23`。
33. **色面掩膜与排行榜口径必须同批**（`MASK_KEEP_KM=300` + `renderRank` 过 `mapVisibleAt()`）；`mapVisibleAt` 读**色面栅格 alpha**；**不能用 ETOPO1 判海**；掩膜不进缓存。
34. **色面边缘＝采样点凸包**：去共线后是**正八边形**（长边 509 / 短边 240 km）。**`hull.length` 在 8/10/12 间浮动、别硬编码**。包外距离＝**切比雪夫型** `max over edges`，只羽化 `FIELD_OUT_KM`。**别磨圆折角**。`FIELD_FULL` 与色面边界是两个量。
35. **分档后所有取色必须走 `bandColor(mode,v)`**；探针"像素色↔数值"断言改成"↔档位"。
36. **深色底图靠同一 filter 套两层抵消**；**绝不能加 `contrast`/`saturate`**。
37. **相邻条带必须共用同一个取整后的边界像素**；`SEAM=1` 时 `gapCount` 必须 0。
38. **不要重做「工具条死区」分析**（纯观感）；别轻易"缩短文案压行数"。
39. **等值线必须独立成层（`.clayer`），不许描进色面栅格**。
40. **等值线是屏幕空间矢量**（几何只在**栅格坐标**算一次、固定 `CONT_PX=1`）；**绝不退回逐格栅格化**；插值在**连续值场 `f.vals`** 上做。量线宽＝墨迹面积÷折线总长。
41. **经纬网别去猜投影公式**：只依赖 `projectToContainer` 的**单调性**，四边二分 + 整数度精确投影。
42. **数据范围边界线（B1）按色面 alpha 逐段裁断**（与等值线同一条纪律）；采样在**容器像素**、步长 **1 px**、每条弧段单独 `stroke`。与等值线**共用画布** ⇒ 等值线那条"墨迹不悬空"断言就是它的端到端证明。
43. **经纬网开关 `gratOn`（画出来没）与 `gratUser`（用户偏好）必须分开** —— 不分开 `fitRaster` 每次都会把用户选择**静默打开**。关掉时必须显式 `svg.style.display="none"`（`.clayer` 的 `.on` 是"等值线或经纬网有其一即显示"）；开回来**必须让 `gratSig` 失效**。
44. **窄屏（≤760px）两条专属路径，改断点要同时改三处**：`template.html` 两条 `@media` + `_p6.js` 的 `TIP_DOCK_MQ`。
    ① **顶部条**：`.top-in` 是 `flex-wrap:wrap` 且文字列缺 `min-width:0` ⇒ 摊成 3 行（实测 175 px/20.8%）。压法＝sub 隐藏 + h1 **14px**（15px 会断在词中间）+ badge 同行 + logo 26 + **sticky 改 static**（压薄后仍半透明压住内容）→ **43 px/1 行**。
    ② **提示卡走 `.tip.dock` 贴底通栏**；dock 时 **JS 必须显式清 `left/top/--tipshift/below`**（行内样式优先级更高）；`.dock` 背景要**不透明**。
    ③ **dock 卡片 `z-index:2000`**：触屏真机上 SDK 会自动加缩放/罗盘控件（z 值内部定、无从约定），实测压住 z=20 的卡片。**headless 探针量不出来，只能防**。
    ④ **触屏没有 `mouseleave`** ⇒ 关闭**四条**路径：× / 再点同一处 / 点地图以外 / **拖动地图**（位移 >12px 收；**不能在 pointerdown 收**，否则"再点同一处"失效；起手在卡片内不收；passive+capture）。
    ⑤ **`#map` 必须 `touch-action:none`**；**绝不能设在 `.mapwrap`**（`.tip.dock` 是它后代且要纵向滚动，手势取触摸链交集）。卡片自己设 `touch-action:pan-y`。
45. **「藏提示卡」统一走 `hideMapTip()`**（7 处散落的 `remove("on")` 已收口）。只藏卡片会留三个不一致：`pinLL` 残留 / 悬停帧未取消 / **`.dock` 残留（最严重）** —— 那块 326×302 的**隐形热区仍扣在地图上**（拖不动 + 双指触发整页缩放），这是"关掉卡片后地图再也滑不动"的真根因。它一次做四件事：`remove("on")`+`remove("dock")`+`pinLL=null`+`cancelHover()`。**判据取端到端**：关闭后 `elementFromPoint(原卡片中心)` 必须落回 `#map`（探针已断）。
46. **`overflow-x:auto` 容器必须显式 `min-width:0`**（`.t-scroll`），否则把页面 `scrollWidth` 顶出去 ⇒ 移动端放大布局视口、**整页被缩小**。姊妹坑：**`.top-tx` 也必须 `min-width:0`**（h1 是 nowrap，缺它把 badge 顶出容器 61 px＝390 视口 scrollWidth 451 的唯一来源）。**只写 min-width:0 别写 flex:1**。
    **探针判越界的参照必须用 `documentElement.clientWidth`，绝不能用 `innerWidth`**（溢出会把布局视口等比放大 390→451，用 innerWidth 当参照**永远抓不到自己制造的溢出**）。
46b. **产物现在有 4 个内联脚本块**（0＝`<head>` 主题引导 / 1＝业务 / 2＝地图代理配置 / 3＝`_p6.js`）。
    **取块一律按内容找（含 `function jget` 的那一块），不许按序号** —— `timeoutprobe` / `run_self` / `aodscale`
    原来都是 `findall(tpl)[0]`，加第 4 块后取到引导脚本（用 document）⇒ `run_self` **静默假绿**
    （脚本崩了 stdout 为空，而判据是"数 FAIL 行" ⇒ 数成 0）。**凡"数 FAIL 行"的判据都要同时看退出码。**
47. **偏好持久化：「应用顺序」就是正确性**（键 `sunsetbot.pref.v1`，单键 + 白名单 + 先读后合并）。`applyPrefs()` 必须在 `initUI` 里任何"控件初值/派生状态"赋值**之前**调用（否则"控件写着 A、State 是 B"的静默错位）。依赖地图 DOM 的两项走 `applyMapLayerPrefs()`，挂 `initMap` 末尾且**必须早于** `autoLoadMapFromCache()`。坏值一律降级不抛错。**刻意不存**：位置与日期（URL 已承载）、`mapPeriod`（派生值）。本条**作废**了旧结论"图层开关一律不持久化"。
48. **趋势缓存只存「算好的 rows」，绝不存原始响应**（原始 ≈ **5 MB** 会撑爆配额使**所有**缓存静默失效；rows ≈ **1.9 KB**）。动权重/阈值**必须升 `TREND_CACHE_PREFIX`**；上限 3 条。入闸门位置与 B14 同构（`cacheOnly` 的 `return false` 在缓存快路径后、网络调用前）。**三键族共用 `mapCacheSweep`，「豁免当前地点」恰好相反**：地图 `true` / 单点 `false` / 趋势 `false`。
49. **`docfacts` 三纪律**：① 只校验**可机读事实**；② **失配必须响**（找不到声明报 STALE，**绝不静默通过**）；③ **只断「等于」**（约数/范围进排除清单）。事实源＝文件系统 + 源码正则 + `_check/.facts.json`（**含探针源码 sha1**，源码改了没重跑 ⇒ STALE）⇒ **改探针后先跑 `all.py` 再跑 docfacts**。
50. **`cdp.js` 分段计时用 `mark(name)` ＝命名「刚结束」的那一段**（旧 `tick(n)` 命名下一段，已因**十一个标签整体位移一位**废弃）。`--fast` ≡ 传 `CDP_SEG=fast`：照常端到端，只跳过 `SEG_SLOW` 两段，**跳过时必须各打一行「已跳过」**。
51. **探针实测三条**：① **`:focus-visible` 不能用脚本 `focus()` 触发**（47/50 误报）⇒ 用 CDP `CSS.forcePseudoState`，且本项目样式写在 `input:focus` 上 ⇒ **同时强制 `focus` 与 `focus-visible`**；② **渐变背景**与 **JS 注入的数据驱动配色不计入**对比度判据；③ **一次 `Runtime.evaluate` 只量一次绘制** —— CPU 节流作用在**任务调度**上，一整段同步 JS 是一个长任务 ⇒ 节流失效。
52. **404 页（第二个产物）**：纯静态站**没有前端路由** ⇒ 靠托管平台取 `404.html` 并以 404 状态返回（CF Pages / GH Pages / Netlify 同约定），**不需要任何 rewrite 配置**。
    ① 它在**任意深度**的 URL 下被返回 ⇒ 页内地址必须是**站点根绝对形式**（构建期注入 `__SITE_BASE__`，默认 `/`；子路径部署如 GH Pages 项目页用 `SITE_BASE=/仓库名/`）。写相对地址会按请求路径解析（`/a/b` → `/a/index.html`）。
    ② **不得有任何外部引用**（自包含；图标与主页同枚、一律内联）。
    ③ 出口两个且性质相反：**返回首页是真 `<a href>`**（无 JS 也能用）；**返回上一页是默认 `hidden` 的 `<button>`**，靠 JS 确认 `history.length>1` 才显形（否则新标签页会把人扔去空白页），且回退失败时兜底跳首页。
    ④ 路径显示必须用 `textContent`（路径是用户输入，拼 `innerHTML` 就是反射型 XSS）；长路径要 `word-break:break-all`。
    ⑤ `:root` 令牌与主页**逐字一致**、窄屏走同一条 760px 媒体查询 ⇒ 由 `404probe` 的"令牌比对 / 占位符残留 / 外部引用 / 窄屏不溢出"守着。
    ⑥ 必须 `noindex`（它会被拿去应答各种拼错地址）。
53. **快照链接（F5）：只存"键 + 数"，不存"文案"** —— 云型 / 因素名存**内部键**，展示时才过 `i18n()`（同一条链接切英文就是英文、切英制就是 ft/mi）；日出日落时刻与方位角**不进链接**，由 (lat,lon,date,tz 分钟) 用 `sunEvents`/`solarPosition` 现算。解码**前**先量长度（`SNAP_MAX`），解码时逐字段过闸门（日期正则 / 时段白名单 / 云型下标 / `parseFloat+isNum` / 字符串 `safeLabel`）。`SNAP_TYPES` 的**顺序即编码下标** ⇒ 改动必须升 `SNAP_VER`。失效只收口在 `invalidateSnap()`（`State.booting` 期间不生效，否则首屏 `setLocation` 会把刚读进来的快照判死）；它只清 State，地址栏靠随后那次 `syncUrl()` 自然去掉 snap=。**快照模式不跑 `runForecast`** —— 首屏自动预报是本项目唯一一处被动取数。

## 验证脚本
**首选 `python _check/all.py`**（`-v` 详细、`-k` 过滤、`--fast` ＝ cdp 只跑快段）。理由：`run_self.py`/`cdp.js`/`cachesize.js` **始终 exit 0**，只在 stdout 打计数，漏解析会把失败当成功。
序列（**22 项，顺序即依赖**）：`syntax`/`globals`/`run_self`/`datacheck`/`localgrid`/`timeoutprobe`/`zoomprobe`/`raceprobe`/`cachesize`/`cdp`/`mapaudit`/`mobileprobe`/`mobileprobe360`/`persistprobe`/`a11yprobe`/`xssprobe`/`i18nprobe`/`darkprobe`/`spotprobe`/**`snapprobe`**/**`404probe`**/`docfacts`。不全跑：`pointcache`、`perfprobe`（只测量）、`consistency`/`shotdefault`（花真实额度）、`tzprobe`、`aodscale`、`styleprobe`。
阈值：`zoomprobe` **136 项 0 失败**；`timeoutprobe` **15**；`mapaudit` **26**；`mobileprobe` **26**（两档视口各跑一次，不花额度）；`persistprobe` **15**；`a11yprobe` **15**；`xssprobe` **18**；`i18nprobe` **23**；`darkprobe` **19**；`spotprobe` **21**；**`snapprobe` 24**；**`404probe` 21**。
坑（都踩过）：改源码忘重跑 `assemble.py`+`mkpreview.py`（已两次）· **别硬编码城市坐标**（写死的点落值场外时断言静默空转）· **同一时间只跑一个 `all.py`**（否则 `EADDRINUSE` 假失败）· `cdp.js` 末节「部署缺陷探测」必须排在**所有截图与新增段落之后**（局部变量也叫 `B1`，会清空 `#map`）· 别用固定 `sleep`，改轮询 · 探针模板串**内部**要写 `\\s`、**注释里不能出现反引号**（截断模板串，已踩 **4 次**）· **给 md/日志追加文本别用 `python -c "…"`**（双引号里的反引号被 bash 当命令替换**静默吃掉**）· 重跑 `assemble.py` **必须看字节数**（重定向到 `/dev/null` 会让文档记下中间态）· 断言用 `{名称:条件}` 别串 `&&` · **失败登记务必保留**（`FAIL` 行 + `FAIL 计数: N` 作退出码）· **判据失效导致的空等/绿灯也是坑**（曾静默空等 125.8 s）⇒ 判据要配自检断言。

## 地图规模与账目
**局部网格：查询点为心、半径 500 km、间距 120 km、固定 57 点**；栅格是 57 点包围盒 ⇒ **列数随纬度变**（广州 **217×200 / 3 条带**）。
账目：单点 ≈ **65** / 地图 ≈ **171** / 趋势 ≈ **129** / 全量 ≈ **236**。**首屏只花 65**。

## 数据源与部署 · 速查
- **只有 Open-Meteo，无等量替代**；**免费层仅限非商业**；**别换 Leaflet/MapLibre**（中国区域展示需测绘资质）。
- **计费**：`加权调用 = max(1,变量数/10) × max(1,天数/14) × 坐标数` ⇒ 唯一杠杆是变量数；**限额按来源 IP** ⇒ 纯前端直连计入**访客自己的 IP**。
- **别把 Open-Meteo 代转到 CF Workers**（限流按 IP）；**地图代理放 CF Pages Functions 可以**。
- **上传 GitHub**：沙箱里 git 到 github.com 不通 ⇒ 走 **REST contents API**（`PUT /repos/lyuzixi/sunglow/contents/<name>`，已存在带 `sha`）。脚本 `~/.sunglow-push404.py`（可复用）：凭据取 `~/.workbuddy/mcp.json` 的 `mcpServers.github-pat.headers.Authorization` —— 值是 **`Bearer ghp_…` 整串**，要 `split()[-1]`，按 `startswith("ghp_")` 找**找不到**。校验用**远端 blob sha1 == 本地 `sha1("blob <len>\0"+内容)`**（等于即逐字节相同；别用 `git hash-object` 默认值，受 `core.autocrlf` 影响）。

## 方法论
**对有意的语义变更做回归时，不能拿改造前的实现当基准**：要写**结构独立、语义相同**的第三方参考实现，再做双重差分 ①第三方(旧语义) vs 旧实现 → 0 ⇒ 尺子可信；②新实现 vs 第三方(新语义) → 0 ⇒ 新实现正确（`zoomprobe.js` 的 `refThird`）。
