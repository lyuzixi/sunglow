# 霞光档案 Android · B3 优化专项施工卡

> 2026-11-13 · 配套方案 `reports/android-next-phase-plan.html`（B3）。
> 拍板范围只有两项：**启动首帧与包体**、**取数与缓存纪律**。
> 视觉与无障碍、可观测平台、截图自动化本轮不做（B0 只保留一次性最小真机清单）。

## 本轮已落地

| 动作 | 落点 | 验证 |
|---|---|---|
| 首屏图分档：由 1920×1280 原图生成 720×480 / 24 KB webp | `native/assets/hero_photo_720.webp` | 本地 PIL 生成，尺寸与体积已核对 |
| CI 构建时把两档图一起放进 `drawable-nodpi` | `.github/workflows/android.yml` → `Copy brand assets into app resources` | YAML 解析通过，步骤已加入 |
| 网页侧额度/TTL 常量进基准 | `native/tools/gen-b2-baselines.mjs` → `b2-baselines.json`（已在 CI 生成） | 本地实跑通过，6 个源文件含 sha256 |
| 三语资源一致性门禁 | `native/tools/check-i18n.mjs` → CI | 66/66/66 通过 |

## ① 启动首帧与包体（待 Kotlin 实现，需云端编译）

现状：`SunglowApplication.onCreate()` 已把城市表解析、提醒排程、小组件刷新挪到低优先级后台线程，主线程只注册通知通道；`HomeScreen.kt` 已有 `PageSkeleton` 与真实布局同构；`enableEdgeToEdge()` 已启用。

- 按密度选图（示例，需在 CI 编译验证）：
  ```kotlin
  val res = LocalContext.current.resources
  val id = if (res.displayMetrics.widthPixels <= 720) R.drawable.hero_photo_720 else R.drawable.hero_photo
  Image(painterResource(id), contentDescription = null)
  ```
  注意 `painterResource` 对 webp 的支持与 `R.drawable` 命名一致；两档图都由 CI 复制，`drawable-nodpi` 不做密度缩放。
- 检查 Compose 首次组合代价：首帧不要做 `CityRepository` 解析、不要等图片解码完成才显示骨架。
- 可评估 Baseline Profile 与 `isMinifyEnabled` 的 release 侧收益；debug 包体基线 **13,267,692 B**（2026-11-13 Release）。
- 清理无引用的 `native/app/src/main/assets/map.html`（早期 WebView 实验遗留，与「0 WebView」硬标准表述冲突）——删除前确认未被任何 `loadUrl` 引用（已全仓 Grep 确认无引用）。

**验收**：冷启动无白屏；首帧时间有前后对比；包体较 13.27 MB 可度量下降（阈值等真机基线后定）。

## ② 取数与缓存纪律（逐条可断言）

现状：进程内 6h LRU `ForecastCache`、磁盘 `ForecastStore` / `ResultCache`、冷启动先画快照再让网络覆盖、`errorKind` 错误分型、趋势已改区间取数（朝/晚各 3 请求）。

| # | 纪律 | 网页口径来源 | 断言方式 |
|---|---|---|---|
| 1 | 额度：单点 51 / 趋势 102 / 地图 363 加权调用 | `v2/src/core/mapdata.ts`、`api.ts` | 按真实请求数计数，不按界面文案判断 |
| 2 | TTL 6h；`auto` 只看缓存、`click` 缓存优先、`force` 绕开 | `cache.ts` / `mapdata.ts` / `trend.ts`（基准已采集 TTL=21600000） | 命中缓存时零请求，页脚显示「缓存 ·」与重取入口 |
| 3 | **换日期绝不自动取数** | `v2/src/state.ts` 日期同步器 | 换日期后真实请求数 = 0，只读新日期缓存 |
| 4 | 429 不重试；限流 / 超时 / 无数据分型文案与退避 | `v2/src/core/api.ts` | 桩掉各类失败，逐类截图留档 |
| 5 | 热力面首次进入不自动加载，点「加载」才开始 | `mapload.ts` | 进观测场零请求，点击后才计数 |
| 6 | 断网不得无标识给 mock；保留旧结果并标离线时间 | `HomeViewModel` 已有 `offlineAt` | 飞行模式冷启动，检查标记与重试按钮 |
| 7 | 日历序列存真实 epoch；一切按城市当地钟 | `v2/src/core/tz.ts` | 复用现有 `GoldenTest` 时区样本 |

**验收**：换日期请求数 0；缓存命中零取数；每类失败都有可复现文案；断网不出现无标识假结论。

## 依赖与推进方式

- B3 在 B2 功能冻结后做，避免边改版式边量性能。
- 每批一次提交 → 看 `android` 工作流 → 绿了再出包；本机无 JDK/Gradle，Kotlin 改动一律经云端 CI 验证。
- 复跑 `docs/android-device-checklist.md` 的第 1 / 6 项（主题可读性、断网快照）。
