# 霞光档案 Android · B2 四包深同步施工卡

> 2026-11-13 · 配套方案 `reports/android-next-phase-plan.html`（B2）。
> 口径：**功能与结论一致、视觉允许原生化**；底座保持 osmdroid + 高德公开瓦片；B1 门禁已落地。
>
> **本轮已交付的前置件**：`native/tools/gen-b2-baselines.mjs`（网页侧基准采集，已在 CI 生成）、
> `native/app/src/test/resources/golden/b2-baselines.json`（常量 / 纯函数样本 / 源文件 sha256）、
> `native/tools/check-i18n.mjs`（三语门禁）、`native/app/src/test/.../VerdictGoldenTest.kt`（回路样板）。
>
> **本轮未写 Kotlin 功能代码的原因（需要如实记录）**：本机没有 JDK / Android SDK / Gradle，
> 无法编译验证；而 B1 刚把「网页改一行、Kotlin 没跟上就 CI 红」立成硬约束。
> 盲写上千行未编译的 Compose / 场算法代码会立刻把流水线打红、阻塞出包，与方案目标相反。
> 因此采用「先备齐基准与施工卡 → 每包一次提交 → 看云端 CI 结果迭代」的推进方式。

## 通用工作流（每个子批都照这个走）

1. 从 `b2-baselines.json` 取该包的常量与样本；在 Kotlin 侧新增 `XxxGoldenTest.kt`，仿 `VerdictGoldenTest.kt` 读 `golden/b2-baselines.json` 逐项断言。
2. 实现功能代码；把该包名字从 `gen-golden.mjs` 的 `pendingGroups` 移除。
3. `git push` 触发 android 工作流：生成 golden → 生成 B2 基准 → 三语门禁 → 单测 → assembleDebug → Release。
4. CI 红就按 Job Summary 的 `e:` 错误定位（云端无模拟器，这是主要反馈回路）；绿了再出包，复跑 `docs/android-device-checklist.md` 的相关项。
5. 每包独立出 debug 包，不攒大版本。

---

## B2-1 · 数据口径与设置层（公共底座，先做）

| 项 | 内容 |
|---|---|
| 网页源 | `v2/src/core/snap.ts`（定长字段协议 `SNAP_VER="1"`、`SNAP_KEYS` 12 项、`SNAP_TYPES` 7 种云型）、`calib.ts`（0.5° 网格 / 20 桶 / `CALIB_HIT_MIN` 等）、`units.ts`（`uDist/uAlt/uSpeed/uTemp/uClock`）、`urlstate.ts`（`SHARE_SITE`、`readUrl`）、`refmodel.ts`、`factors.ts`、`raydetail.ts` |
| Kotlin 落点 | 新增 `core/SnapCodec.kt`（替换 `ShareLink.kt` 的单向外链）、`core/Calib.kt`、`core/Units.kt`；扩 `HomeViewModel` 的 `recordSighting()`；`SettingsSheet` 增加单位 / 12-24 时制 |
| 现成基准 | `b2-baselines.json.samples.snap[0]` 已含一条真实 `snapEncode → snapDecode` 往返样本（raw 196 字符，解码 20 个字段）；`samples.calib` 17 条（网格分组、P 分桶、可标注判定）；`constants.calib/trend/snap` |
| 验收断言 | ① Kotlin 解网页 raw 逐字段相等；② Kotlin 编码结果网页 `snapDecode` 能解；③ 校准同输入输出同结果；④ 单位换算与 `uClock` 格式一致；⑤ 13 因素缺数保 `null`，文案 key 与三语词典对齐 |
| 依赖 / 风险 | `snap.ts` 的字段顺序即协议，改动必须两端同批；App 目前只有 `ShareLink.kt` 生成链接，尚无解码。 |

## B2-2 · 趋势形态与决策辅助

| 项 | 内容 |
|---|---|
| 网页源 | `v2/src/components/TrendSection.vue`（①②③「最值得出门」胶囊、`TREND_RAMP` 冷青蓝两端插值、10×2 热力格、缺时段灰虚线格）、`v2/src/core/trend.ts`（`TREND_N=10`、TTL 6h、`trendKeyOf`） |
| Kotlin 落点 | `ui/screens/TrendScreen.kt`（列表 → 胶囊 + 热力格）、新增 `ui/trend/TrendRamp.kt`；`HomeViewModel.loadTrend()` 保持区间取数（朝/晚各 3 请求） |
| 现成基准 | `constants.trend`、`samples.trend`（缓存键样本）、`hashes.trend.ts`（网页口径变动提醒） |
| 验收断言 | ① 同一城市十日的 P/Q/等级与网页一致；② 热力格底色＝概率、格内左概率右质量分；③ 冷青蓝用两端颜色线性插值，深色下限 0.28，不退回「单色 + alpha」；④ 点某天带转场回结论并载入该日期；⑤ **换日期真实请求数 = 0** |
| 依赖 / 风险 | 依赖 B2-1 的单位与日期口径；`TrendScreen.kt` 头注释「逐日串行取数」已过时，需一并修正。 |

## B2-3 · 观测场深水区

| 项 | 内容 |
|---|---|
| 网页源 | `v2/src/core/mapdata.ts`（`MAP_RADIUS_KM=500`、`MAP_GRID_KM=80`、TTL 6h、`MAP_CACHE_MAX=5`、`CITY_NEAR_KM=60`、额度 363）、`maprender.ts`（自适应核 Shepard：R＝第 9 近邻 ×1.06、`w=((R−d)/(R·d))²`；11 锚点全光谱；`fadeOf(near)` 60→320km；`blurMasked` 2 遍 K=8；`FieldCache`）、`citylang.ts` / `cityname.ts`（486 城市名） |
| Kotlin 落点 | `core/HeatGrid.kt`（场构建与精度）、`ui/screens/FieldScreen.kt`（底图不动，只换色面与命中逻辑）、新增 `ui/field/FieldRamp.kt` |
| 现成基准 | `constants.map`、`samples.map`（`mapKeyOf` 样本）、`hashes.mapdata.ts` |
| 验收断言 | ① 同一批输入的场值逐点相等（留一法 rmse < 0.75×最近邻）；② 低值不归零、无凸包硬裁切；③ 简体沿用底图文字，英/繁自绘并做避让；④ 城市名标签优先命中，当前城市零请求、其余只读 6h 点缓存；⑤ 额度耗尽 / 限流给明确文案 |
| 依赖 / 风险 | **合规前置**：高德公开瓦片的公开分发条款、署名（tile source 已带「© 高德地图」）与配额须先有结论。不接腾讯 SDK、不去底图。`FieldScreen.kt` 是 1,318 行大文件，改动按 overlay 拆函数，避免整文件重写。 |

## B2-4 · 分享与内容体系

| 项 | 内容 |
|---|---|
| 网页源 | `v2/src/components/ShareTiles.vue`（2×4 八磁贴）、`core/sharehub.ts`（登记 + ready）、`composemods.ts`（14 模块，默认 sky/qr）、`sharecard.ts`（结论卡 780×1024、故事卡 1080×1920、`captionOf` 按分句截）、`tutorial.html`（四档三语）、`FeedbackDialog.vue` / `AboutView.vue` |
| Kotlin 落点 | `ui/screens/HomeScreen.kt` 的 `ShareSheet`（改八磁贴）、`ui/share/ShareCard.kt`（补故事卡 / 趋势图 / 观测场图模板）、新增 `ui/share/CalendarInvite.kt`；关于与反馈 sheet |
| 现成基准 | B2-2 / B2-3 的图源即基准来源（同一份数据，不重造第二套绘制） |
| 验收断言 | ① 四个图片磁贴产出四张不同 PNG，尺寸按网页真值；② 文案不截断、二维码可跳回同城市日期；③ 加入日历覆盖观赏窗口；④ 三语文案与 `check-i18n` 一致；⑤ 分享全程零新增取数 |
| 依赖 / 风险 | 依赖 B2-2 与 B2-3 出图；**建议**：不搬 14 模块拖拽合成器（手机重排成本高），教程走系统浏览器外链 + 原生快速上手页以保持「0 WebView」。 |

---

## 出口判据（B2 整体）

- [ ] 四个子批各自独立出包，CI 全绿
- [ ] `gen-golden.mjs` 的 `pendingGroups` 清空（每组都有对应 Kotlin 断言）
- [ ] 同一城市 / 日期 / 时段 / 模型，网页与 App 的 P、Q、等级、最佳窗口、因素判定、结论文案一致
- [ ] 最小真机清单的 4 / 6 项（地图、分享图）复跑通过
- [ ] 下载页功能边界文案再次随包更新（走 `download.src.html` → 生成器 → build）

## 参考文件

- 方案：`reports/android-next-phase-plan.html`
- 现状报告：`reports/android-app-task-report.html`
- 真机清单：`docs/android-device-checklist.md`
- CI：`.github/workflows/android.yml`
- 基准：`native/tools/gen-golden.mjs`、`native/tools/gen-b2-baselines.mjs`、`native/tools/check-i18n.mjs`
