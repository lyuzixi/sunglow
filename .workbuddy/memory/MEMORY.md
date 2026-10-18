# 霞光预报 · 长期约定

> 这里只保留跨会话必须记住的索引。完整 56 条约束与推导见 `.workbuddy/memory/硬约束详解.md`；过程见根目录总结文档及每日工作日志。改模块前先查详解对应条目。

## 构建与验证
- 源文件：`tpl/template.html`、`_p2.._p6.js`、`refs/*`；`index.html`、`404.html`、`_check/preview.html` 都是产物，禁止手改。
- 修改后固定执行：`SITE_BASE=sunglow python assemble.py`（确认输出字节数；**必须带 SITE_BASE**，部署约定是 GH Pages 项目页 `/sunglow/`，裸跑会按 `/` 构建并让 404probe 的首页链接断言假失败）→ `python mkpreview.py` → `python _check/all.py`。同一时间只跑一个 `all.py`。
- `all.py` 是唯一总判据；单项脚本可能只在 stdout 报失败却 exit 0。改探针后先跑 `all.py`，再跑 `docfacts`。
- 4 个内联脚本块必须按内容定位业务块（如 `function jget`），不能按序号；数 FAIL 时同时检查退出码。

## 地图核心约束
- 局部网格：中心半径 500 km、间距 120 km、固定 57 点；采样点上限 32,767。`mapPts()` 以 `MapMod.gridC` 为中心。
- 几何/样带/权重/阈值变化须同步相关常量并升级缓存版本；权重用 Float64，`dlT` 按 `(列,点)` 转置，候选保持原点下标升序。当前地图缓存 **v6**（`pts` 带 `cld` 云量字段；v5 及更旧缓存 `cld` 缺失 ⇒ 云纹静默不画，属预期降级）。
- 地图取数只允许用户显式触发；例外仅“缓存命中自动绘制”。`cacheOnly` 必须在缓存快路径之后、网络调用之前返回，挂点仅 `initMap` 与位置作废分支，绝不挂 `setLocation`。
- 三类缓存统一经 `mapKeyOf()`/版本号和 `mapCacheSweep()`：地图豁免当前地点，单点/趋势不豁免；单点存原始响应且键含时段，趋势只存算好的 rows。
- `MAP_TZ` 恒等于 API `timezone=auto`；默认城市只有 `State` 一个来源；初始化只调用一次 `setLocation`。
- 地图代理仅占位符 `__TMAP_SERVICE_HOST__`；产物不得含密钥或未替换占位符。429 必须经统一友好文案区分日额度耗尽与短时限流。
- 可信度、模型分歧、档位及配色统一走 `dvI`、`ensConfOf`、`ENS_CONF_BANDS`、`bandColor()`；少于两套有效模型时分歧为 `null`。
- 色面值域是**固定 0–100 绝对刻度**：当日值域拉伸机制（`scaleRange`/`scaleT`/`mapRangeOf`）已删，`cv = clamp(dimOf(pts[i],dim,mk),0,100)` 恒等——图上颜色可跨日对比。`HEAT_RAMP`（`_p4.js` 唯一定义）= 天色色阶 8 锚点 Variant C（暮蓝→暮灰→金→橙红→深红），与首屏 `--dusk-*` 同语汇；harness 色阶断言按新设计意图守（实测依据在 `_scratch/measure_ramp.py`），换肤要重写断言而非改期望值。

## 渲染与交互
- 图层顺序：底图压暗(0)→色面(1)→**云纹(2)**→等值线/经纬网/范围线(3)→可信度纱(4)→方位环(5)→直标(6)→图钉(7)→遮罩(8)→提示卡(20)；全屏 `.mapwrap.fs` z=2100（高于 top 60 / tip.dock 2000）。新增层同步 template 注释表、z-index、深色 filter 名单。**色面双降走 CSS 层透明度 `.rlayer{opacity:.75}`**，不写进画布 alpha——保 alpha 峰值 207，否则 mapaudit/zoomprobe 的「≥200 不透明区」像素断言基线失效。
- 色面边界取采样点凸包并仅向外羽化；掩膜与排行榜共用 `mapVisibleAt()` 口径。等值线是独立屏幕空间矢量层，插值基于连续值场；经纬网投影只依赖 `projectToContainer`。羽化边缘带有机噪声（`EDGE_NOISE_KM=26`，格哈希确定性，**按羽化进度缩放 ⇒ 包内/包界恒 0**，三对齐数学上不破；mapaudit 假绿防线查外带掐格）。
- “藏提示卡”只能走 `hideMapTip()`，同时清 on/dock、`pinLL` 和悬停帧。悬停双重节流；清空图钉层同时清 `pinSig`。
- ≤760px：顶部单行压缩；提示卡 dock 底部且不透明、z-index 2000；地图 `touch-action:none`，卡片 `pan-y`；拖动超过 12px 收卡；`#map` 高 460px（图例与排行榜紧凑化换来的），排行榜默认前 4 条 + 「查看全部」展开（`RANK_NARROW_N=4`，**复用 `TIP_DOCK_MQ` 760 断点不引第二常量**，展开态 `rankAll` 不进偏好）。`overflow-x:auto` 容器和 `.top-tx` 必须 `min-width:0`，越界用 `documentElement.clientWidth` 判定。
- 偏好键 `sunsetbot.pref.v1`：白名单、先读后合并；`applyPrefs()` 必须早于 UI 派生状态，地图偏好早于缓存自动绘制。位置、日期、`mapPeriod` 不持久化。
- 天色带轴是**两行**：上行静态太阳事件（左/右锚）、下行「现在」游标（锚点按 ≥88/≤12 切换），`.skyaxis.two` 只在有 now 时加高。别把两者塞回同一行——天黑在 90.9% 而非轴右端，傍晚必然重叠；也不要再用 `clamp` 把标签挪离刻度线。
- 轴 = 时间尺（12.2）：四道分界（0/−6/−12/−18°）各挂 `.mk`「名称+时刻」，名称随时段转向（晚霞「终」/朝霞「始」，−18° 朝霞是天亮）；标签中心必须压在色块边界（A4 ±2px）。挤不下由 `fitAxis()` 实测降级（改锚→.tonly 隐名称→.off 舍中间，首尾永不丢），幂等可重入。**给页外判据调用的函数必须顶层定义**；顶层挂 `window.addEventListener` 前必须 `typeof window` 守卫（run_self 在 Node 裸载源文件会炸）。
- 视觉（方案四 · 纸面仪器）：**两级卡片**——`.card`（有面）只给结论与地图，其余一律 `.card.q`（透明 + 头顶一根发丝线）；`--grad*` 系列已删除，层级靠排版与发丝线。别把阴影/底色加回分区（uiprobe A2 按身份守）。深色 `--solid` 必须比卡片亮一档，不能近白（darkprobe 浅色块扫描器会抓）。

## 安全、页面与链接
- 所有用户输入展示用 `textContent`/安全标签，不拼 `innerHTML`。favicon 与 apple-touch-icon 内联（后者 PNG）。
- 404 页自包含、`noindex`、支持任意深度路径；链接经 `__SITE_BASE__` 注入为站点根绝对地址。首页用真链接，上一页按钮仅在有历史时显示并带首页兜底。
- 快照链接只存内部键和值，不存展示文案；解码前限长并逐字段校验。日出日落按位置/日期/时区现算；快照模式不跑预报。
- PWA 是 `PWA=1` 的**可选产物**（manifest/sw/两张图标），默认构建仍必须只有 index.html 与 404.html —— 单文件是核心约束。SW **绝不缓存气象响应**，只认预缓存名单；缓存名取产物 sha256 前 12 位；注册不得新增内联脚本块（块数 4 是不变量），地址由 `link[rel=manifest]` 推出。
- F4 本地校准（`sunsetbot.calib.v1`）四条硬边界：**只展示不回改模型**（校准块与结论卡各写各的 DOM）、**样本不够不给结论**（`CALIB_MIN_N=8` 且本档 `CALIB_MIN_BUCKET=3`）、**`a=-1` 不进统计**、**关掉 ≠ 删除**（开关与清空两个按钮）。阈值常量必须留在源码顶层并被 `docfacts` 核对。

## 项目现状与部署
- 预报数据源仅 Open-Meteo；免费层仅限非商业。纯前端直连按访客 IP 计额度，不要经 CF Workers 代转；地图代理可用 CF Pages Functions。
- 地图数据规模：单点约 65、地图约 171、趋势约 129、全量约 236 加权调用；首屏只花单点约 65。
- 中国区域底图不要擅自改成 Leaflet/MapLibre 等未经合规验证的方案；底图选型须优先考虑测绘资质、审图号、密钥域名白名单和数据出境边界。
- GitHub 网络受限时可走 Contents API；远端一致性按 Git blob SHA-1 校验，避免 `core.autocrlf` 干扰。

## 回归方法
语义变更不能拿旧实现直接当新基准：先用结构独立的第三方参考实现证明旧语义一致，再以新语义做双重差分。探针避免固定 sleep、硬编码城市坐标、模板串中的未转义正则与反引号；所有判据必须自检，防静默假绿。
判据不要按"元素总数"断死（如 `[data-snaphide]` 的个数）：新增一个同类块就会变成"改数字"式的假失败。按**身份/集合**断（如 `div.card[data-snaphide]` 恰 4 张 + 所有同类块都收起）。**分段控件要分两类**：单选组（`unitSeg/clockSeg/langSeg/themeSeg/mapPeriod`）恒有且只有一个当前值；记录器（`.cbseg` 实况回填）的 0 选中是正常态，只判"至多一个"。`#calibSeg` 只在事件过去 ≥1h（`leadH <= -1`）时才渲染，判据若依赖它存在就会随跑批钟点忽绿忽红。计数器/累积量型断言必须在**被测动作结束那一刻**取值：放到最后统一读会把中间其它动作（如"制造上一页"要载入首页）一起算进来，名字说测 A 实际测 A+B。判"页面就绪"不能用 `window.State` —— `State` 是顶层 `const`（词法全局），`window.State` 恒为 `undefined`，写错会让轮询静默跑满预算、探针零输出被杀。`Page.navigate` 返回时旧文档仍 `complete`，重复导航必须用"导航标记"握手且超时要抛错。
行尾已**机制化**（2026-10-17，替代旧的"numstat 两口径核对"人肉纪律）：`.gitattributes` 全仓 LF（`* text=auto eol=lf`，png binary）守 blob；`_check/syntax.py` 末尾的「源文件无 CRLF」断言守工作区（clean filter 会把工作区 CR 藏进 diff，但 assemble 的 `rd(newline='')` 会把它带进产物字节——探针是唯一守门员）。工作区被编辑工具写脏时跑一次全仓 `python -c` 转换即可，`eolfix.py` 已删。注意：这台机器的 `git show` 会做 LF→CRLF smudge，查 blob 原始字节要用 `git cat-file blob`。
