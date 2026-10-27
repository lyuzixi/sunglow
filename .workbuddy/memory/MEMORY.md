# 霞光预报 · 长期约定（索引）

> 约束全文 `.workbuddy/memory/硬约束详解.md`；细节见每日日志（最新最权威）。改模块前先查当日日志。

- **V1**（原版，2026-10-25 起迁入 `V1/`）：产物 `V1/index`、`V1/404`、`V1/_check` 禁手改；构建 `cd V1 && SITE_BASE=sunglow python assemble.py`→mkpreview→`python _check/all.py`（均在 V1/ 下执行；唯一总判据，回退后必补）。地图 500/120km/57 点；取数只许显式触发；#map 须 position:relative;z-index:0；可点必须 elementFromPoint 验。安全：用户输入 textContent；数据源仅 Open-Meteo；中国底图不得换 Leaflet/MapLibre；同步 `~/sunglow-sync.py`（令牌走 env）；全仓 LF。回归：先独立参考实现证旧语义再双差分；按身份/集合断不按总数断死；`window.State` 恒 undefined。

## 四套并存（V1/v2/v3/Skyglow · 2026-10-25 重整）
- localStorage 隔离 `sunsetbot.*`/`glowcast.v2.*`/`glowcast.v3.*`；算法 V1 唯一权威。v3=画布航图断网可开。
- 目录格局：根目录只放 `V1/`（原版全套）、`v2/`（**主线**）、`v3/`、`Skyglow/`（后两者冻结不动）+ 5 份跨版本文档；2026-10-26 起 V2 交付物（index/404/tutorial/sw/manifest/图标×2）经 build 链 `publish-root.mjs` 落根并 sha256 校验——线上根路径同步后即 V2；V1 经 `/sunglow/V1/` 访问。`.gitignore` 的 `_check` 忽略规则已锚定 `V1/_check/`（带内部斜杠的模式锚定仓库根）。v2 的「原版」已全量改「V1」（含 i18n 键/英文值），App.vue 链接与 probe-consist 的 origDir 已改指 `../V1`；v3 冻结，其两处「查看原版」链接暂失效（已知接受）。
- 工具坑：agent-browser 守护进程全局单例，probe 后台跑时绝不能并发 ab()；`ab()` 禁管道接输出（挂死），必须 stdio 落文件再读；Windows 直接 spawn `bin/agent-browser-win32-x64.exe`；残留 `close --all`。

## v2（源码在 v2/，交付物经 publish-root 落根；验证链 typecheck→build(含发布)→probe:ui/tz/consist→截图目检→LF→写日志）
- 教程（2026-10-26 重做）：独立 v2/tutorial.html 四档三语（概览+用户/开发者/创作者，data-i18n 词典，与主页共享 glowcast.v2.pref 的语言/主题）；应用内 /tutorial 孤儿路由连视图已删——入口全指独立文件，别再建第二份。
- 顶栏四态 `one→tight→menu→mini` 由 refit() 逐级试（isSqueezed=横向溢出**或**折行）；mini 蕴含 menu；**必须配 ResizeObserver**。高度唯一来源 `--topbar-h`；`.wrap` 封顶 1180；英文永远落 menu 档；量需宽用 `.mockups/measure-natural.cjs`。徽标 C 案胶囊（`.topbar-meta` 禁复活）。
- 缓存与额度（勿退回）：TTL 6h；auto 只看缓存/click 缓存优先/force 绕开；**换日期绝不自动取数**；jget 429 不重试。额度单点 51/地图 171/趋势 102。断「不取数」必须数真实请求。
- 时区：一切按城市当地钟；序列存真实 epoch；offsetAt 是秒且先 floor。`probe:tz` 28。
- 口径单一来源：skyband/verdict/factors/compare/physics。因素 13 项缺数保 null。ComparePanel 根节点必须 section+wrap；占位卡 `.phcard` 不带 rcard。
- 多语言地名：显示名只走 `core/citylang.ts`；`cityname.ts` 由 gen-cityname.mjs 生成勿手改；内部简体、只显示层翻译。腾讯底图无英/繁 → 英/繁自绘（简体保留底图字防叠字）；避让 avoid rects（`.rotate-circle` 别量）；SDK 控件挪 BOTTOM_RIGHT；schedulePaint 须在 await loadSdk() 前先画一帧。
- 图源选型（拍板不换）：谷歌出局（条款含 China/境内不可达）；高德多语言要商务工单且国内无繁体；腾讯免费 4 模板含墨渊 style2，样式须先控制台绑 key（一 key 限 3 个）。
- **勿重做清单**：①「底图退到背景」已整条撤销（现状=底图原色+深色两段滤镜，重提先问）；②「三语统一关文字、全自绘」已撤销；③深色滤镜 `invert(1) hue-rotate(180deg)` 顺序不可反。
- 案 C·2：英/繁跨度 ≤120km 自动开底图中文文字、>132km 恢复自绘（滞回 12km）；静默切换。钩子 `__gcAutoText(span)`。
- 地图渲染性能（勿退回每帧重算）：热力场=地理栅格缓存（`buildFieldRaster`→FieldCache；命中只重求仿射贴图+线段重放）；失效=samePts（Object.is 比 lat/lon/v/cld/occ/gap）；主题不参与构建。缩放中发糊=拍板接受。
- **色面重做（2026-10-23 二次返工，勿回退）**：采样 **80km / 121 点**；场重建=**自适应核 Shepard**（R=第9近邻×1.06，`w=((R−d)/(R·d))²`）⇒ 过点但不长平台，旧「d²+900 主场盘」永久出局；精度可断言=`__gcCV()` 留一法 rmse < 0.75×nnRmse。**形态=SunsetBot 全光谱**（浅蓝→蓝→青→绿→黄→橙→红→品红 11 锚点，`alpha` 0.10→0.86 **低值不归零**），**不再有凸包/可达距离硬裁切**：色面铺到视口外，靠 `fadeOf(near)` 60→320km smoothstep 淡到 0；栅格外扩 350km。**显示平滑** `blurMasked(fvals, inner, K=8, 2 遍)` 把 9/90 台阶摊成坡（只进栅格，卡片与探针仍是原始值）。遮挡层与等值线**默认关**（会压暗/划彩色面）。`conf.mean` 必须按 alpha 加权。三层分工：色面(场)/遮挡(`occ`，与 `blockFactor` 同源)/可信度(只降饱和)。5 因子 `refmodel.refScore` **只做旁证**（`refGap`=z 分数取差）。钩子 `__gcCV`(含 spanDeg)/`__gcRamp`/`__gcTrend`/`__gcFieldProbe`。
- **色面观感三坑（勿再踩）**：①浅色底图上低值必须"浅+低 alpha"，用深蓝+中 alpha 会变成一层脏紫滤镜；②采样点只标位置不标数值（按值填色会融进同色色面），做法=反差芯 1.7px + 反色发丝光环 3.1px，默认关；③分数场本身是 **9/90 二值台阶**（`noCloud→P≤8`、`cover<12→P≤22` 两条硬截断），看见"填色多边形"先怀疑数据台阶，别急着调插值和配色。
- 地图选点（勿回退 26px/跟随式）：悬停=只读小卡（pointer-events:none）；点击=吸附→定格卡（pinCard 每帧重算、贴右缘翻左；「加入对比」只在定格卡）；点卡空白=取消；触屏 touchend=selectAt。吸附半径自适应 `ringPx=120km/span*h`：pick=×0.5、hover=×0.42（**绝不超半环距**）；本市特权 ×0.95（home 用屏幕距<8px，**不能用 lat=== 浮点微差**）。onPinCardClick 必须 stopPropagation；`watch(pin)→schedulePaint()` 放 pin 后（TDZ）。钩子 `__gcSnap`；容器 `.canvas-host`/`.map-box`。
- **城市名选点（与格点并行）**：城市名 486 vs 格点 121，疏密仍差一量级；加密到 80km 后广州锚点旁有了自家格点（6.3px，旧网格是「清远市附近」18.6px），但城市名单独命中仍**标签优先**（城市卡给的是本城坐标数据，不是 25km 外那个格点的数据）。`cityAt()` 英/繁用 `labelsInfo.geo` 真实落笔矩形、简体用「腾讯地名居中压在锚点上方」估算矩形（实拍量过）；当前城市→复用 0 环格点（零请求）；其余→城市卡**只读 6h 点缓存**，未命中才给按钮（**绝不自动取数**）；换日期只重判缓存。
- **SDK 层硬约束**：腾讯 SDK 交互容器 z-index:1000（canvas z=2），`.map-host` 必须 z-index:0 建层叠上下文——否则真实点击全落 SDK 层。探针：可点断言必须 elementFromPoint（el.click() 绕过命中测试）；视口外恒 null（先滚入）。probe:ui 约 280 条会浮动；开跑前清 `glowcast.v2.pref`。
