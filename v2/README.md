# 霞光档案 · SUNGLOW · Spectrum Edition（光谱观测版）

> 本文是 [SUNGLOW](../README.md) 的 **Sunglow Spectrum Edition（V2 · 光谱观测版）**：当前主线。

全新高级科技风版本。与 **Sunglow Classic Edition**（`V1/`，内部标识 V1，单文件 assemble 构建链）**完全隔离、互不影响**：
V1 代码与资源零改动，Spectrum Edition 只单向链接到 Classic Edition。

## 版本家族
- **Sunglow Spectrum Edition（V2 · 光谱观测版）**：当前主线，本目录。
- **Sunglow Classic Edition（V1 · 经典原版）**：历史经典版本，保留最初的设计与算法实现。
- **Skyglow Enhanced Edition（Skyglow · Skyglow移植增强版）**：基于第三方 [couletian/Skyglow](https://github.com/couletian/Skyglow) 的移植增强独立版本，不是 V2 的下一代。已独立部署于 https://sky.sunglow.cloud/，已迁出本仓库。

## 视觉方向
**A · 大气光谱观测站**（深色） / **晨光实验室**（浅色） / 跟随系统

- 深空蓝黑 `#070b14` 基底 + 极光辐射渐变 + 星尘
- 光谱渐变：品红 `#ff4d82` → 琥珀 `#ff9c3f` → 电离青 `#2ed5e8`
- 玻璃拟态面板（blur 22px + 发丝描边）
- 辉光只给「概率数字」与「结论标题」（Chanel rule：别处不加辉光）
- 字体：Space Grotesk（display）+ Inter（body），**自托管**（@fontsource 打包进产物）；中文走系统字
- 全页动效：滚动渐入（带 2s 兜底强制显形）、Hero 星环漂浮、仪表弧渐变、色条过渡

## 技术栈
Vite 6 + Vue 3 + TypeScript + vue-router（hash 路由，双击/任意静态托管可开）

```
v2/
├── scripts/                 emit-single.mjs（稳定名产物）+ publish-root.mjs（发布到仓库根）
├── package.json / vite.config.ts / tsconfig.json
├── vendor/src-verbatim/     V1脚本【冻结参考副本】（口径 diff 用，不参与构建）
├── src/
│   ├── main.ts / App.vue / router.ts / state.ts
│   ├── core/                算法层 TS 移植（口径与V1逐点对齐）
│   │   ├── math.ts          clamp/trap/wgeo/b64u/esc/safeLabel/球面几何
│   │   ├── astro.ts         solarPosition/sunEvents/sunAltRate（NOAA 低精度）
│   │   ├── physics.ts       光路消光积分/CIE 色度/rayTraceColor/云层/火三角
│   │   ├── scoring.ts       buildEnv/scoreStat/scoreRay/QUALITY_BANDS/ensConf
│   │   ├── ramp.ts          SPECTRUM_RAMP（新光谱色阶，与光效统一）
│   │   ├── calib.ts         F4 校准存储（四条硬边界原样保留）
│   │   ├── snap.ts          快照编解码 SNAP_VER=1（与V1互通）
│   │   ├── snapshot.ts      全功能快照包（#/?pack= 压缩缓存）
│   │   ├── composemods.ts   合成分享卡的模块清单（14 个可选块，无依赖）
│   │   ├── composecard.ts   合成分享卡渲染：原版结论核心 + 模块按实高累加
│   │   ├── raydetail.ts     光追中间量（页面 SVG 与分享卡 canvas 共用）
│   │   ├── i18n.ts          三语（简/繁/英）
│   │   ├── api.ts           Open-Meteo + 超时预算（失败不回退演示数据）
│   │   ├── city.ts          城市检索（主要城市子集）
│   │   └── forecast.ts      取数→样带→三套算法→综合 编排
│   ├── composables/useReveal.ts
│   ├── components/          Hero/结论/天色带/趋势/观测场/模式/因素/校准/顶栏
│   ├── views/               HomeView / AboutView / NotFoundView
│   └── styles/              tokens.css（双主题设计令牌）+ main.css
├── app.html                 源码入口（开发用，不对外）
└── index.html               构建中间产物（单文件；发布副本在仓库根，见下）
```

## 交付产物（单一形态 · 落仓库根）

| 产物 | 路径 | 怎么打开 |
|---|---|---|
| **唯一交付** | 仓库根 `index.html` | **直接双击打开**；气象取数需要联网。JS/CSS/字体内联，约 1.22MB |
| 发布伴随 | 根 `404.html` / `tutorial.html` / `sw.js` / `manifest.webmanifest` / 图标×5 | `npm run build` 自动发布 |
| 开发 | 源码入口 `v2/app.html`（不对外） | `cd v2 && npm run dev` → 打开 `/app.html` |

```bash
cd v2
npm install
npm run dev                # 开发服务器
npm run build              # 单文件产物 + publish-root 自动发布 10 个文件到仓库根
```

> 为什么不直接双击源码入口 `v2/app.html`：Vite 默认产物是 ES module 多文件，
> 浏览器从 `file://` 加载 module 脚本会被 CORS 拦截。单文件版把脚本内联进 HTML 才绕开这条限制。
> 根 `index.html` 由 `npm run build` 生成并自动发布，**不要手改**；`v2/index.html` 是构建中间产物
>（本地预览用；页脚、顶栏「版本」菜单与目录抽屉「其他版本」组里的 V1 链接按根位置写 `V1/index.html`，Skyglow 使用绝对地址 https://sky.sunglow.cloud/（已独立），故只在根副本中正确）。

## 使用教程（四档三语）

独立静态文件 `tutorial.html`（随构建发布到仓库根；顶栏书本图标、mini 抽屉「指南」、页脚都能进）：

| 档位 | 写给谁 | 内容 |
| --- | --- | --- |
| 概览 | 所有人 | 一句话定位、五个亮点、快速开始、版本家族、三档入口卡 |
| 用户版 | 使用者 | 查预报、读懂结论卡、十日趋势、观测场、多观测点对比、保存图片与快照、实况校准、偏好、缓存与额度 |
| 开发者版 | 开发者 | 构建链、源码结构、算法口径、与 V1 的关系、观测场渲染、取数账目、快照协议、质量门、部署 |
| 创作者版 | 拍摄者 | 三步挑拍摄夜、结论卡导出、快照做内容、主题与截图、校准反哺、额度礼节 |

- 三语（简 / 繁 / EN）：页内 `data-i18n` 词典 + 顶栏语言切换器，`?lang=` 可直开；主题三态与主页一致。
- 与主页共享同一份偏好 `SUNGLOW.v2.pref`（语言 / 主题，补字段写入，不碰单位与时间制式）。
- 分档走 hash 路由（`#users` / `#dev` / `#creator`），档内章节有锚点；吸顶条高度实测写入 `--toph`。
- 应用内**没有**教程路由：2026-10-26 删除了无入口的 `/tutorial` 孤儿视图，避免两份教程各自漂移。

## 与 Sunglow Classic Edition（V1）的关系
| 项 | Classic Edition（V1） | Spectrum Edition（V2） |
|---|---|---|
| 构建链 | `assemble.py` 单文件 | Vite 多文件产物 |
| 存储 | `sunsetbot.pref.v1` / `sunsetbot.calib.v1` | `SUNGLOW.v2.pref` / `SUNGLOW.v2.calib` |
| 地图色阶 | HEAT_RAMP 白→黄→橙→红 | SPECTRUM_RAMP 深靛→品红→琥珀→电离青 |
| 预报算法 | GFS/EC 统计 + 光追 | **口径完全一致**（逐函数移植） |
| 快照格式 | SNAP_VER=1 | **互通**（任一侧生成对方可解） |
| 地图代理 | `__TMAP_SERVICE_HOST__` | 同占位符（产物不含密钥） |

**分享链接的 host**：唯一口径是 `src/core/urlstate.ts` 的 `SHARE_SITE` / `shareBaseUrl()`。从 `file://` 双击或 `localhost` / `127.0.0.1` 预览打开时，链接自动指向 `https://sunglow.cloud/`（否则复制出去是别人打不开的本机路径）；部署在其它可公开访问的域名时沿用当前页面地址。`snap=` 自包含，对方打开不需要重新取数。因此「复制链接 / 二维码」在本地打开时同样可用，按钮只会在还没有结果时禁用，并有灰化 + `not-allowed` 的可见禁用态。

**全功能快照包**（`src/core/snapshot.ts`）：`snap=` 只带结论、与经典原版互通；v2 另外把分享者本地已缓存的单点结果、十日趋势、观测场（121 点 × 朝/晚，量化成整数行后 deflate + base64url）、对比点列表一起打包进 `#/?pack=`。放 hash 是刻意的：本项目为 hash 路由，hash 不随 HTTP 请求发送，实测线上站点普通 query 超过 8 KB 直接 414。被分享者打开后是**完整主页**，包内条目以内存 overlay 排在六个缓存读取入口之前，零请求、零额度，且保留各板块「缓存」标记；不写入对方 localStorage。链接软上限 7600 字符，超了逐级抽稀观测场。二维码容量不足时自动用精简链接并给出提示；「复制链接」始终给完整版。

**合成分享卡**（`src/core/composecard.ts`）：底卡是**改造前的 780×400 结论核心**（报头照片 / 城市·日期·概率结论 / 页脚，模块 2 的版式一字不改），14 个可选模块接在结论层之后，单列流按内容实测高度累加，先量后定高、两遍绘制。模块：天色带、最佳观赏窗口、十日趋势、观测场缩略、模型卡、云体/光路/通透/动力四组因素、光追关键量/色样/时间轴/曲线、二维码。天色带锚定在结论层上方（拖走会让模块 2 顶出空白），其余可拖拽排序（手柄 + ↑↓，顺序写偏好）。缺缓存/无链接的模块禁选并写明原因，产物里不会出现「尚未加载」。趋势与观测场只读缓存，绝不因勾选触发请求。

**十日趋势的编码**（`drawTrend`）：**结论胶囊 + 双行热力格**。上半是三枚「最值得出门」胶囊（①②③ 日期 星期 朝/晚 · 质量分 · 概率），先回答「哪天去」；下半是 10 天 × 2 行（朝 / 晚）的格子——**底色＝出现概率**（`TREND_RAMP`：淡青 #EAF6FC → 深海蓝 #2E86C1 线性插值；深色主题从 #1B2436 叠到 28%–82%，保证低值格仍有边界），格内左数＝概率、右数＝**质量分**（按优/良/一般/差上色），①②③ 徽标＝按质量分排出的前三名（同分看概率），灰底虚框 + 破折号＝该时段没数据（不再静默用另一时段补）。当前时段的行标加一根竖条。前三名是**时段级**的（同一天朝与晚可以同时进榜），所以序号贴格不贴日期行。列宽按实际天数自适应，标题随之变成「{n} 日趋势」；`100%` 与三位质量分并排时逐档降字号，保证两数之间留 6px。

`vendor/src-verbatim/` 是V1脚本的冻结拷贝：**不参与构建、不加载**，
仅作口径对照与 diff 基线。若V1算法演进，先 diff 该目录再同步 `src/core/`。

## 注意
- 数据源 Open-Meteo，免费层仅限非商业用途，按访客 IP 计额度
- 网络不可用/超时（单点总预算 12s；单次请求 6s，地图取数 12s）**不再回退演示数据**，直接提示「这次没有取到数据」并给「重新计算」入口；这不是离线可用——气象取数必须联网，断网只能看已缓存的结果
- 探针：`probe-ui`（agent-browser）/ `probe-tz` / `probe:consist`；交付物经 publish-root 落根，GitHub Pages 根路径即 V2
