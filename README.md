# 霞光预报 sunglow · 项目总览

> **Sunglow / Glowcast** —— 朝霞与晚霞（火烧云）定量预报仓库：v2 主线、V1 原版，以及基于第三方 Skyglow 改进的全功能单文件版。

基于免费公开气象数据，计算太阳—云层几何、大气光谱消光与光路上游云遮挡，输出朝霞 / 晚霞的**出现概率（0–100%）**、强度等级、最佳观赏窗口与预计色彩。

**主入口：双击根目录的 [index.html](index.html)** —— v2 的单文件产物，断网也能打开。

## 版本一览

| 版本 | 定位 | 入口 | 打开方式 |
|---|---|---|---|
| **v2**（主线） | 大气光谱观测站 · 深色科技风 | [index.html](index.html) · [README](v2/README.md) | 双击根 `index.html`，断网可用 |
| **Skyglow**（改进版） | 上游 Python 全功能版 → 单文件 JS 移植增强；功能最全 | [Skyglow/index.html](Skyglow/index.html) · [README](Skyglow/README.md) | 双击单文件版；完整功能用 `run.bat` / `run.sh` |
| **V1**（原版） | 算法权威 · assemble 单文件构建链 | [V1/index.html](V1/index.html) · [README](V1/README.md) | 双击；地图需腾讯地图代理 |

**v2 · 主线**：Vite 6 + Vue 3 + TypeScript。仓库根的 `index.html`、`404.html`、`tutorial.html`、`sw.js`、`manifest.webmanifest` 与图标都是它的发布产物（`cd v2 && npm run build` 自动落根），**不要手改**。三语（简 / 繁 / 英）+ 双主题 + 实况校准 + 分享卡。

**Skyglow · 改进版**：源自第三方项目 [couletian/Skyglow](https://github.com/couletian/Skyglow)。Python 3.9+ 本地服务沿用上游；`index.html` 由本仓库把上游算法逐行移植为纯 JS，并打包成自包含单文件页（移植增强，属衍生作品）。四源并列、全国 608 格点与城市 169 格点地图、历史回测验证。发布时已脱敏，仓库不含任何密钥。**上游未附 LICENSE，默认版权保留**，引用或再分发前请先联系原作者。

**V1 · 原版**：`assemble.py` 单文件构建链，算法口径的唯一权威 —— v2 以 `vendor/src-verbatim/` 的冻结副本作 diff 基线。

## 快速开始

**主入口**：双击根 [index.html](index.html)。它是 v2 的构建产物，改动请改源码后重新构建。

| 想做什么 | 怎么做 |
|---|---|
| 直接用（推荐） | 双击根 `index.html` |
| 看原版 | 双击 `V1/index.html` |
| Skyglow 单文件版 | 双击 `Skyglow/index.html`（单点 + 全国 608 格点 / 城市 169 格点地图 + 回测验证；GRIB2 官方档案直连仍需 Python 版） |
| Skyglow 完整版 | Windows 双击 `Skyglow\run.bat`；macOS / Linux 在 `Skyglow/` 下执行 `./run.sh`，浏览器打开 `http://127.0.0.1:8770` |

> 别双击 `v2/app.html` 当页面用：它是源码入口，`file://` 下 ES module 会被 CORS 拦截；请 `cd v2 && npm run dev` 后打开 `/app.html`。

## 版本互不影响

- 三套代码、资源与构建链各自独立（Skyglow 含上游 Python 实现与其 JS 移植版），改动互不牵连；页面之间只做单向互链，不共享代码。
- 本地存储按版本分命名空间，互不覆盖：V1 `sunsetbot.*`、v2 `glowcast.v2.*`、Skyglow `skyglow.p0.*`。
- 算法口径以 V1 为基线；v2 的 `vendor/src-verbatim/` 是 V1 脚本的冻结副本，不参与构建、仅作对照。

## 目录结构

```
sunglow/
├── index.html / 404.html / tutorial.html / sw.js / manifest.webmanifest / icon-*.png
│                            v2 发布产物（构建生成，勿手改）
├── code-wiki.html           项目 Code Wiki（单页，可离线打开）
├── V1/                      原版：assemble 单文件构建链，算法权威
├── v2/                      主线：Vite 6 + Vue 3 + TS
└── Skyglow/                 改进版：上游 Python 服务 + 移植增强单文件版
```

各子目录都有独立 README，构建、验证与算法口径的细节见对应文档。

## 数据源与额度

- **数据源**：Open-Meteo（气象 / 空气质量）、DataV 省界；Skyglow 另用 ERA5 / CAMS 再分析。均免费、无需注册。
- **额度规则**：Open-Meteo 免费层仅限**非商业用途**，按访客出口 IP 计每日额度。
- **取数纪律**：只在显式操作时取数（点按钮 / 回车），缓存命中自动绘制是唯一例外。一次代价（v2 口径）：单点约 51 次、地图约 171 次、趋势约 102 次调用。
- **离线回落**：网络失败或超时回落到确定性 mock，界面标 `MOCK`，不消耗额度。
- **密钥**：仓库不内置任何 API Key；腾讯地图、WeatherAPI、和风天气等可选增强需自备凭据（Skyglow 复制 `config.example.json` 为 `config.local.json` 后填写）。

> 本项目仅供学习交流，请遵守各数据源的使用条款（Open-Meteo 免费层限非商业用途）。

## 文档

- [Code Wiki](code-wiki.html) —— 代码结构导览
- 各版 README：[V1](V1/README.md) · [v2](v2/README.md) · [Skyglow](Skyglow/README.md)
