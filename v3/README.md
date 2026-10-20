# 霞光预报 GLOWCAST · v3「追光航志」Glow Logbook

指挥台式观测决策版。与原版（`../index.html`，assemble 单文件链）和 v2（`../v2/`，大气光谱观测站）
**完全隔离、互不影响**：原版与 v2 的代码、资源、localStorage 键一个字节都没动，
v3 只单向链出（顶栏/页脚「原版 ↗ · V2 ↗」）。

> 双主轴（2026-10-20 grill-me 30 分钟决策树拍板）：
> **今晚去哪拍**（决策）+ **敢不敢信**（可信度）。

## 一、十个拍板项

| 分支 | 决策 |
|---|---|
| 核心定位 | 三合一：新视觉 + 新 IA + 功能增强 |
| 功能主轴 | 决策（去哪拍）+ 可信度 双主轴（经竞品调研提案后拍板） |
| 信息架构 | 方案 B · 指挥台式：结论条 →（机会日历翼 \| 地图主舞台 \| 可信度翼） |
| 视觉气质 | **暮色航图**：图纸深蓝 `#0E2233` / 黄昏金 `#D9A441` / 珊瑚霞 `#E2725B` / 潮线青 `#2E6F7E`，航图注记体系（经纬网/罗盘/比例尺） |
| 技术栈 | 与 v2 同构：Vite 6 + Vue 3 + TS + hash 路由，独立 `v3/` 工程 |
| 一期范围 | **主链路先行**：结论条 + 地图推荐 + 机会日历 + 可信度仪表 + 三语双主题 |
| 算法口径 | 基线与原版**逐点对齐**（`vendor/src-verbatim/` 冻结七脚本作 diff 基线），新能力只从基线输出推导 |
| 地图色阶 | **航图新尺**：深蓝→潮青→黄昏金→珊瑚→暖白 8 锚点；0–100 绝对刻度不动 |
| 质量门槛 | 轻量探针（`npm run probe`，89 断言） |
| 命名 | GLOWCAST · v3「追光航志」Glow Logbook |

## 二、视觉系统

- **深色「暮色航图」**（默认/跟随系统）：深蓝图纸底 + 黄昏金强调 + 珊瑚霞警示
- **浅色「航图纸」**：浅蓝灰图纸 + 墨蓝线划 + 深金/深珊瑚（AA 对比度）
- 字体（自托管 latin 子集，中文走系统字）：
  **IBM Plex Serif**（图表名，海图标题语感）· **IBM Plex Mono**（数据/坐标注记）· 系统无衬线（正文）
- 三态主题 `auto/light/dark`，头部引导脚本防 FOUC

## 三、指挥台主链路

```
顶栏（品牌 | 今晚/去哪拍/机会日历/可信度 | 语言×3 | 主题×3 | 原版↗ V2↗）
地点条（城市搜索 · 坐标 · MOCK 标）
① 结论条   值得出门/谨慎出门/今晚算了 + 概率 + 事件时刻 + 倒计时 + 到位建议
② 地图主舞台（画布航图）：色面(0–100) + Top3 pin + 太阳方位朝向线 + 点选浮卡
             + 经纬网两层 + 罗盘玫瑰 + 比例尺 + 图廓角标
③ 机会日历翼：7 天 × 朝/晚双档柱 + 最值得去 Top3 + 点格切换
④ 可信度翼：模型分歧(mixedIndex 极差) + 分档 + 三模型 P/Q/I 表 + 一致性 + 校准档案(二期)
页脚（数据源 · 教程 · 原版 · V2 · 三版互链）
```

窄屏 ≤980px 塌缩竖排：结论 → 地图 → 日历 → 可信度。

## 四、数据与口径

- **基线逐点对齐**：`src/core/` 的 math/astro/physics/scoring/forecast 与原版
  `_p2…_p6.js` 逐语义对齐（样带 TRANSECT 17 点、三路取数 GFS/ECMWF-IFS/AOD、
  W_ENS 加权**几何**平均、分歧=dvI、一致性=clamp(100−1.9·dvI)）。
  `vendor/src-verbatim/` 是原版七脚本冻结副本，**不参与构建**，仅作 diff 基线。
- **移植血缘**：`src/core` 起点为 v2 已验证的 TS 移植，逐项复核后修正了 v2 侧漂移
  （`mixedIndex` 权重回正 0.55/0.45、综合回正 wgeo、一致性公式回正）。
- **新能力 = 展示层推导**（`src/core/suggest.ts`，规则写在文件头）：
  排序 = mixedIndex 降序；朝向 = 事件时刻太阳方位角；
  窗口 = [事件−25min, 事件+max(dur,8)min]（dur 来自火三角几何）；到位建议 = 窗口起点−20min。
- **取数纪律**（沿原版）：观测场**显式触发**（点「加载周边观测场」），缓存命中自动绘制是唯一例外。
  一次观测场取数 = 57 点 × 2 模式 + 气溶胶；按日期缓存 3 小时（LRU 6 条）。
- **存储命名空间**：`glowcast.v3.pref` / `glowcast.v3.map.v1.*` / `glowcast.v3.trend.v1.*` /
  `glowcast.v3.calib` —— 与原版 `sunsetbot.*`、v2 `glowcast.v2.*` 三方隔离；
  探针断言 v3 **绝不删除**其他版本的键（互不影响）。
- **离线回落**：网络失败/超时 → 确定性 mock（界面标 `MOCK 模式`）。
- **与原版的一处刻意差异**：地图走**画布航图**（不接 TMap）—— 暮色航图的制图语言本身就是底图，
  于是不需要地图代理/密钥，standalone 断网双击也能开（TMap 路线留在原版）。

## 五、目录

```
v3/
├── index.html               Vite 入口（JS 跑不起来时留指引页）
├── package.json / vite.config.ts / tsconfig.json
├── standalone.html          ★ 单文件产物（双击即开，断网可用）
├── dist/                    标准多文件产物（部署用）
├── vendor/src-verbatim/     原版七脚本【冻结参考副本】（不参与构建）
├── probes/
│   ├── probe.mjs            轻量探针 89 断言（npm run probe）
│   ├── register.mjs         Node 直跑 TS 的解析钩子
│   └── ts-resolver.mjs
└── src/
    ├── main.ts / App.vue / router.ts / state.ts
    ├── core/                算法层（口径=原版）
    │   ├── consts.ts        TRANSECT/字段集/缓存键族/网格参数
    │   ├── math.ts          球面几何/wgeo/sunsetSpeedKmph/hexA
    │   ├── astro.ts         太阳位置/日出日落事件
    │   ├── physics.ts       光路消光/云层/火三角（含 dur）
    │   ├── scoring.ts       buildEnv/scoreStat/scoreRay/分档/ensConf
    │   ├── forecast.ts      三路取数→样带→三算法→wgeo 综合
    │   ├── mapdata.ts       57 点局部网格 + 逐点评分 + 地图缓存
    │   ├── trend.ts         7 天趋势取数 + 趋势缓存（算好的 rows 才落盘）
    │   ├── suggest.ts       ★ V3 新能力推导（Top3/窗口/朝向/日历读法）
    │   ├── ramp.ts          ★ 航图色阶（8 锚点）
    │   ├── i18n.ts          三语（简/繁/英，简体原文为键）
    │   ├── api.ts           Open-Meteo 批量请求 + mock
    │   └── calib.ts / snap.ts   二期预留（校准/快照数据层）
    ├── components/          TopBar/ConclusionBar/MapStage/CalendarWing/ConfidenceWing
    ├── views/               Home / 404
    └── styles/              tokens.css（双主题）+ main.css（指挥台版式）
```

## 六、命令

```bash
cd v3
npm install
npm run dev                # 开发服务器
npm run build              # 多文件产物 → dist/
npm run build:standalone   # 单文件产物 → standalone.html（双击即开）
npm run typecheck          # tsc --noEmit
npm run probe              # 轻量探针 89 断言
npm run preview            # 预览 dist/
```

> 双击 `v3/index.html` 是**源码入口**，什么都看不到（ES module 的 file:// 限制）——
> 正确入口是 `v3/standalone.html`。`index.html` 里内置了指引页说明这三条路径。

## 七、一期 / 二期

**一期（本次交付）**：指挥台四件套 + 三语 + 双主题 + 城市搜索 + MOCK 回落 + 双轨产物 + 探针。

**二期（已留数据层/入口，UI 未做）**：
- 明细区：天色带（`skyCloud` 已算好）、影响因素（`factorRows` 已算好）、模式对比、逐时表
- 教程页（v3 自有教程；现在链到原版教程）
- 分享卡/快照（`snap.ts` 已移植，格式与原版 SNAP_VER=1 互通）
- 校准档案（`calib.ts` 已移植，F4 四条硬边界原样）
- 窄屏横滑细节打磨、地图点选浮卡的键盘可达

## 八、数据源

Open-Meteo（免费层仅限**非商业用途**，按访客 IP 计每日额度）。
观测场一次取数约 171 个计费调用（57 点 × 3 路）——界面在加载前明示代价，取后按日期缓存 3 小时。
