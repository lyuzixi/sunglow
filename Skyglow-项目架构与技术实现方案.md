# Skyglow（霞光）项目架构与技术实现方案报告

> **分析范围**：仅限 `Skyglow/` 子项目目录。报告中所有结论均来自对该目录内源代码、配置文件、数据文件与文档的实际阅读；行号引用格式为 `文件:行号`。凡属推断或依据不足之处，均已明确标注「假设」或「待确认」。未阅读目录：无（`tools/make_single.py`、`tools/verify_port.py` 引用的同级 `_build/` 目录在本副本中不存在，见 §9.3）。

---

## 1. 项目定位与核心功能

### 1.1 定位

Skyglow（霞光）是一款**可本地运行**的朝霞/晚霞（火烧云）**定量概率预报**网页产品（`README.md:1-7`）。其核心方法为：基于免费的 ERA5 再分析分层云量、CAMS 气溶胶光学厚度与 Open-Meteo 预报接口，计算「太阳—云层几何 + 大气光谱消光 + 光路上游云遮挡」，输出 0–100% 的出现概率、六档强度、最佳观赏窗口与预计色彩。

本目录为**脱敏发布版**：不含任何 API Key、令牌或账户标识（`README.md:4-6`；`core/config.py:27` 中 `DEFAULT_WEATHERAPI_KEY = ""`）。主链路（概率计算）不依赖任何密钥。

### 1.2 核心功能清单（均有代码支撑）

| 单日预测（朝霞/晚霞）   | `core/service.py:243` `predict_day`                        | 四数据源并列计算，输出概率/等级/窗口/配色/判断依据/风险                          |
| ------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| 七日趋势          | `core/service.py:395` `outlook`                            | 今天起 8 天，只算事件瞬时、不画曲线（`service.py:406-409` 注释）            |
| 晚霞方位雷达 + 几何剖面 | `core/azimuth.py:67` `analyze`                             | 16 方位 × 4 距离环 + 太阳方位 13 点剖面                             |
| 全国晚霞地图        | `core/glowmap.py:224` `national`                           | 2.0° 网格 32×19=608 点，按需生成                                |
| 城市精细地图        | `core/glowmap.py:257` `local`                              | 中心 ±1.5°、0.25° 网格 13×13=169 点                           |
| 四源并列对照        | `core/meteo.py:40-52`                                      | Open-Meteo best_match / ECMWF IFS / GFS / ICON 同一时刻各算一次 |
| 官方档案直连（GRIB2） | `core/direct.py`                                           | ECMWF / GFS / ICON，Open-Meteo 失败时的备援                    |
| 校验与缺测补位       | `core/weatherapi.py`、`core/qweather.py`                    | 只补能见度/湿度/降水，不参与概率打分（`service.py:132-158`）               |
| 回测验证页         | `data/validation.json` + `web/app.js:904` `loadValidation` | 混淆矩阵、校准曲线、与 sunsetbot 同期对比                              |
| 单文件网页版        | `Skyglow-单文件版.html`（92 KB）                                 | 双击即用、无服务器；算法为 Python 逐行移植（`README.md:450`）              |

### 1.3 两种产品形态

1. **Python 服务版**（本目录主体）：`server.py` 提供 HTTP 服务与 JSON API，前端 `web/` 为原生 JS 单页应用。
2. **单文件版**：由 `tools/make_single.py` 将 `_build/` 源与 `data/model.json`、`data/nn_model.json` 合成单个 HTML（`make_single.py:26-61`）。单文件版不含辉光地图、GRIB2 直连、和风校验（`README.md:441-446`）。

---

## 2. 主要模块划分及各自职责

### 2.1 后端 `core/`（13 个模块，共 3329 行）

| 模块              | 行数  | 职责                 | 关键实现                                                                                                                                                                                                                                         |
| --------------- | --- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `solar.py`      | 125 | NOAA 太阳位置算法        | `solar_position`（`solar.py:17`）儒略日+均轮差求高度角/方位角；`event_times`（`:97`）2 分钟步长扫描 + 18 次二分求日出日落（精度 5 秒）；`illumination_limit`（`:121`）云底受光极限 α_min=−√(2h/R)                                                                                          |
| `spectrum.py`   | 179 | 光谱消光与配色            | `deck_light`（`:98`）400–700 nm 逐 5 nm 积分瑞利（τ₅₅₀=0.098，λ^-4.1）+ 气溶胶米散射（Ångström=1.3），Wyman(2013) 高斯拟合 CIE 1931 配色函数转 sRGB；切点高度 h_t=h−Rα²/2（`:92`）                                                                                              |
| `model.py`      | 306 | 物理子评分 + 标定层        | `features_from_weather`（`:97`）三层云幕 canvas/受光 gate/光路遮挡 horizon/通透度 purity；`assess`（`:210`）岭回归潜变量 + 一维 logistic 概率 + 六档阈值；`timeline`/`best_window`（`:255`/`:279`）逐分钟曲线与最佳窗口                                                                   |
| `meteo.py`      | 473 | Open-Meteo 接入与配额治理 | `fetch_bundle`（`:216`）25 点环带 × 7 变量 × 四模式单次请求；`assemble`（`:296`）上游加权聚合；`_get`（`:147`）URL 哈希缓存 + 429 熔断（`:106` `_mark_relay_down`，600 s，落盘 `data/cache/_relay_breaker.json`）；令牌桶节流（`:120` `_throttle`，430 点/分钟）；`geocode`（`:399`）中文行政区划多级回退解析 |
| `service.py`    | 493 | 单日/七日预报装配          | `predict_day`（`:243`）缓存优先；`_predict_day`（`:258`）逐事件 × 逐源评估、relay→direct 降级；`_conf`（`:14`）置信度模型；`_reasons`/`_risks`（`:31`/`:68`）可解释依据与风险；`_fill_aux`（`:132`）校验源补位                                                                             |
| `glowmap.py`    | 302 | 格点地图场              | `national`（`:224`）608 点、`local`（`:257`）169 点；150 点/块分块请求（`:23` `CHUNK`）；上游近似 = 太阳方位 ±30° 三射线 × 140/280/420 km 三档 + 双线性插值（`:27-28`、`:108`）；gzip 磁盘缓存（`:196-211`）                                                                              |
| `azimuth.py`    | 167 | 16 方位雷达            | 64 环点 + 13 剖面点 = 77 点（`:17-18`）；评分 = 云幕 canvas × (1−0.7×近距低云遮挡) × 太阳扇区权重（`:128`）                                                                                                                                                             |
| `direct.py`     | 416 | 官方档案直连             | GFS：`.idx` 定位 LCDC/MCDC/HCDC 字节区间（`:152`）；ECMWF：`.index` 取 tcc+850/500/300 hPa RH 偏移，主站 + S3 镜像双 host（`:29-32`、`:235`），分层云由 Sundqvist 型诊断（`:227`）；ICON：二十面体网格最近邻（`:352`），`icon_grid.npz` 磁盘缓存                                                |
| `nn.py`         | 50  | 神经网络推理             | 纯 Python 前向（无 numpy 运行时依赖），15-8-4-1 tanh MLP，权重在 `data/nn_model.json`                                                                                                                                                                        |
| `store.py`      | 127 | 结果级缓存              | `data/predict/` gzip 存储；TTL 按日期分级（`:38`：过去永久/当天 60 min/明天 3 h/之后 6 h）；`SCHEMA=4` 版本化键（`:35`）；tmp + `os.replace` 原子写（`:90-94`）                                                                                                                |
| `config.py`     | 142 | 本地凭据               | `config.local.json` 读写，环境变量优先（`:31`、`:57`）；`direct_settings`（`:123`）、`save_qweather`（`:71`）                                                                                                                                                  |
| `weatherapi.py` | 205 | 主校验源               | 一次 `forecast.json?days=3` 覆盖早晚两个事件（`:137`）；日上限护栏默认 2000（`:27`）；用量统计落盘 `_weatherapi_usage.json`                                                                                                                                               |
| `qweather.py`   | 344 | 备用校验源              | JWT EdDSA 签名（`:170`，需 `cryptography`）或 `X-QW-Api-Key`；401/403 后 300 s 冷却（`:43`、`:277`）；日上限默认 800                                                                                                                                             |

### 2.2 入口 `server.py`（402 行）

标准库 `ThreadingHTTPServer`，单 `Handler` 类分发（`server.py:56-98`）。API 端点：

```
/api/health /api/cache /api/geocode /api/predict /api/outlook
/api/glowmap /api/validation /api/azimuth /api/direct /api/qweather
/api/weatherapi /api/model
```

静态文件从 `web/` 提供，带 `..` 穿越防护（`server.py:302-307`）。所有「写操作」（保存直连开关、密钥）均用 **GET + `_method=post` 查询参数**实现，未定义 `do_POST`（`server.py:217-230`）。参数校验：经纬度范围、日期格式、预报期 ≤15 天、历史 ≥1980（`server.py:135-154`）。

### 2.3 前端 `web/`（无构建、无框架）

| 文件            | 行数     | 职责                                                                          |
| ------------- | ------ | --------------------------------------------------------------------------- |
| `index.html`  | 467    | 页面结构：查询卡、hero、四源对照、分时演变、成霞因子、云层剖面、方位雷达、几何模型、交叉比对、七日、数据源面板、地图、回测验证、方法说明      |
| `app.js`      | 1248   | 主控 IIFE：选点（地名/经纬度/定位）、取数编排、渲染、四源切换器、Canvas 绘图（天空、时间曲线、可靠性曲线）                |
| `analysis.js` | 339    | 方位雷达（四源闭合曲线叠加）、几何剖面 SVG、云量剖面                                                |
| `maps.js`     | 545    | 全国/城市地图：手写 Albers 投影（`:16-20`）、DataV.GeoAtlas 边界 Path2D、热力色带、南海诸岛插图、悬停/点击交互 |
| `styles.css`  | 32 KB  | 深色主题样式                                                                      |
| `china.json`  | 582 KB | 省级行政边界（阿里云 DataV.GeoAtlas，含台湾、香港、澳门、南海诸岛，`README.md:149`）                   |

模块间通信采用 **CustomEvent 总线**：`skyglow:data`（新预测结果）、`skyglow:pending`（参数变更待重算）、`skyglow:pick`（地图选点）（`app.js:405`、`analysis.js:20-24`、`maps.js:390`）。

### 2.4 `tools/`（16 个脚本，2401 行）——离线数据管线与验证体系

| 分组       | 脚本                        | 职责                                                             |
| -------- | ------------------------- | -------------------------------------------------------------- |
| 取数       | `fetch_reanalysis.py`     | 抓 sunsetbot 再分析标签（10 天窗口自适应收缩，`:33-35`）                        |
|          | `fetch_grid.py`           | 下载上海周边 25 格点 × 550 天 ERA5+CAMS 历史场                             |
|          | `check_direct.py`         | 实测三家官方档案可用性                                                    |
| 建表       | `build_dataset.py`        | 标签 × 历史格点 → 回测特征表（25 点环带、与线上同一加权公式 `:53-57`）                   |
| 实验       | `experiment.py`           | 6 组特征集 × 3 档 ridge 强度消融                                        |
|          | `measure_accuracy.py`     | 用真实缓存响应量化「砍环带/砍变量」的精度代价                                        |
|          | `audit_window.py`         | 审计取数窗口与实际读取（stub 掉 `_get`，插值打点计数）                              |
| 训练       | `train_nn.py`             | numpy 手写 Adam 训练 15-8-4-1 MLP；时间切分早停；部署权重用全量                   |
| 标定       | `calibrate.py`            | 拟合 ridge + logistic + 分位阈值，产出 `model.json` 与 `validation.json` |
| 单文件生成/验证 | `make_single.py`          | 合成单文件 HTML                                                     |
|          | `verify_port.py`          | Python vs JS 逐值比对（5 用例，node 执行）                                |
|          | `verify_real.py`          | 真实缓存数据端到端比对（Edge headless + fetch stub）                        |
|          | `smoke_single.py`         | 渲染冒烟（结构性断言 DOM）                                                |
|          | `verify_requests.py`      | 实测单文件版请求足迹（配额核算）                                               |
|          | `verify_interaction.py`   | 断言「改参数不发请求、点按钮才发」                                              |
|          | `verify_outlook_shape.py` | 断言七日趋势用 25 点环带                                                 |

### 2.5 `data/`

| 内容                                  | 说明                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `model.json`                        | 部署用标定参数（ridge-v2.1：7 特征 mean/std/coef、prob_a=2.66、prob_b=1.38、五档阈值 1.19–1.45）             |
| `nn_model.json` / `nn_metrics.json` | MLP 权重与评估指标（test AUC 0.794 / Brier 0.174；train AUC 0.881）                                 |
| `validation.json`                   | 验证报告：五折 CV AUC 0.802 / Brier 0.118、混淆矩阵、校准曲线、sunsetbot 同期对比（366 条）                        |
| `reanalysis_records.csv`            | 1109 条标签（2022-06-24～2023-12-30，555 天，上海；实测去重后无重复）                                         |
| `backtest_features.csv`             | 1109 行 × 32 列特征表                                                                          |
| `era5/`                             | 25 格点历史场（gz）。**本副本实存 22 个文件**（缺 `r380a225/270/315`），见 §9.3                                |
| `cache/`                            | 原始 HTTP 响应缓存 + `_relay_breaker.json`（当前值 `until: 1792301806`，即熔断处于激活状态）                   |
| `direct/`                           | 解码后的 GRIB 单点缓存（30 min TTL），如 `ecmwf_2026101805_31.23_121.47_.json` 含 `diagnosed: true` 标记 |
| `predict/`                          | 运行时由 `store.py` 创建（`store.py:30`），本副本尚未生成                                                 |


## 4. 目录结构与启动入口

```
Skyglow/
├─ server.py               # HTTP 服务与 JSON API（402 行，纯标准库）
├─ requirements.txt        # eccodes / numpy / cryptography（均为可选）
├─ config.example.json     # 凭据模板（复制为 config.local.json）
├─ setup.bat / setup.sh    # 首次：建 .venv 并装可选依赖
├─ run.bat   / run.sh      # 启动：优先使用 .venv
├─ README.md               # 产品文档（525 行）
├─ STATIC_HOSTING.md       # 静态托管可行性评估（348 行）
├─ Skyglow-单文件版.html   # 免服务器单文件版（92 KB）
├─ core/                   # 13 个后端模块（3329 行）
├─ web/                    # 前端（index.html/app.js/maps.js/analysis.js/styles.css/china.json）
├─ tools/                  # 16 个离线脚本（2401 行）
└─ data/                   # 模型参数、标签、特征表、历史场、运行时缓存
```

**启动入口**：`python server.py [port]`（`server.py:361` `main()`）。端口解析顺序：命令行参数 > `$PORT` > 8770；占用时自动尝试 +1…+10（`server.py:369-375`）。绑定地址：默认 `127.0.0.1`；设置了 `PORT`（Render/Railway/Fly 惯例）或 `SKYGLOW_HOST` 时绑 `0.0.0.0`（`server.py:365`）。启动横幅打印可选依赖状态（`_print_deps`，`server.py:340`）。

**启动脚本**：`setup.sh`/`setup.bat` 建 `.venv` 装 `requirements.txt` 并 import 自检；`run.sh`/`run.bat` 优先用 `.venv` 的 python，缺失时回退系统 python 并提示直连功能不可用（`run.sh:6-13`）。注意 README 提示 bat 文件必须保持 CRLF（`README.md:40`）。

**单文件版**：双击 `Skyglow-单文件版.html`，无需安装（`README.md:418`）。

---

## 5. 技术栈与核心依赖清单

### 5.1 运行时

| 层    | 技术                                                          | 说明                                                                     |
| ---- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| 后端语言 | Python ≥ 3.9                                                | `README.md:44`                                                         |
| 后端框架 | 无（标准库 `http.server` + `urllib`）                             | `server.py:12-14`                                                      |
| 可选依赖 | `eccodes`（GRIB2 解码）、`numpy`（ICON 网格）、`cryptography`（和风 JWT） | `requirements.txt`；缺失时对应功能降级但不崩（`direct.py:36-46`、`server.py:324-337`） |
| 前端   | 原生 JS（IIFE + ES6）、Canvas 2D、SVG、Path2D                      | 无框架、无构建、无 npm（`app.js:4`）                                              |
| 推理   | MLP 前向为纯 Python（`nn.py:29-42`）                              | 运行时不需要 numpy                                                           |

### 5.2 外部数据源

| 源                           | 端点/用途                                                                                                | 密钥      |
| --------------------------- | ---------------------------------------------------------------------------------------------------- | ------- |
| Open-Meteo Forecast/Archive | 分层云量、湿度、降水、BLH、能见度；`models=best_match,ecmwf_ifs025,gfs_seamless,icon_seamless` 四模式单请求（`meteo.py:52`） | 无       |
| Open-Meteo Air Quality      | CAMS AOD(550 nm)，四源共用（`meteo.py:236-241`）                                                            | 无       |
| Open-Meteo Geocoding        | 地名解析（`meteo.py:38`）                                                                                  | 无       |
| WeatherAPI.com              | 主校验源：总云量/能见度/湿度/降水                                                                                   | 可选，用户自备 |
| 和风天气                        | 备用校验源：总云量/能见度/湿度/降水                                                                                  | 可选，用户自备 |
| ECMWF/GFS/ICON 官方档案         | GRIB2 字节区间/Range 直读                                                                                  | 无       |
| 阿里云 DataV.GeoAtlas          | 省级边界 `web/china.json`                                                                                | 无       |
| sunsetbot.top               | 回测标签（上海，1109 条）                                                                                      | 无       |

---

## 6. 关键配置项及部署/运行方式

### 6.1 `config.local.json`（`config.example.json` 为模板，已 gitignore）

| 键                                                     | 默认值                       | 说明                         |
| ----------------------------------------------------- | ------------------------- | -------------------------- |
| `weatherapi_key` / `weatherapi_cap`                   | `""` / 2000               | 空 = 未启用（`config.py:27-28`） |
| `direct.auto`                                         | `true`                    | 失败时是否自动改走官方直连              |
| `direct.sources`                                      | ecmwf/gfs=true，icon=false | 逐源开关（`config.py:10-13`）    |
| `qweather.host/key/kid/iss/sub/private_key/daily_cap` | 空 / 800                   | 页面「和风天气」面板或环境变量写入          |

### 6.2 环境变量（优先于文件）

`WEATHERAPI_KEY`/`SKYGLOW_WEATHERAPI_KEY`；`SKYGLOW_QWEATHER_HOST/_KEY/_KID/_ISS/_SUB/_AUTH`、`SKYGLOW_QWEATHER_PRIVATE_KEY`（PEM 路径或全文）；`PORT`、`SKYGLOW_HOST`（`README.md:65-69`、`server.py:363-365`）。

### 6.3 运行时行为参数（代码内常量）

| 参数          | 值                                   | 位置                                  |
| ----------- | ----------------------------------- | ----------------------------------- |
| 环带采样        | 中心 + 120/250/380 km × 8 方位 = 25 点   | `meteo.py:61-62`                    |
| 请求变量        | 7 个（三层云、能见度、湿度、降水、BLH）              | `meteo.py:57-58`                    |
| 取数窗口        | 单日 d−1…d+1（3 天）；七日 today…today+days | `service.py:263`、`:409`             |
| HTTP 缓存 TTL | 预报 1 h / 再分析 24 h / 空气 1 h          | `meteo.py:222`、`:226`、`:237`        |
| 结果缓存 TTL    | 过去永久 / 当天 60 min / 明天 3 h / 之后 6 h  | `store.py:38-47`                    |
| 熔断          | 429 或配额提示 → relay 停用 600 s，落盘跨重启    | `meteo.py:71-72`、`:106-113`         |
| 节流          | 令牌桶 ≤430 点/滚动分钟                     | `meteo.py:65-66`、`:120-128`         |
| 校验源上限       | WeatherAPI 2000/日、和风 800/日          | `weatherapi.py:27`、`qweather.py:35` |
| 地图分块        | 150 点/请求；gzip 缓存 6 h/3 h/永久         | `glowmap.py:23`、`:227`、`:271`       |
| 直连缓存        | 30 min（`data/direct/`）              | `direct.py:405`                     |

### 6.4 部署方式

- **本地**：`setup.bat`/`./setup.sh` → `run.bat`/`./run.sh` → 浏览器开 `http://127.0.0.1:8770`（README 特别提醒 `0.0.0.0` 是监听地址不是可访问地址，`README.md:36-38`）。
- **容器/云平台**（Render 等）：设 `PORT` 即自动绑 `0.0.0.0`，`python server.py` 零改动；`STATIC_HOSTING.md:295-316` 给出 Render 配置步骤（Build: `pip install -r requirements.txt`，Start: `python server.py $PORT`）。
- **静态托管**：`STATIC_HOSTING.md` 评估结论为「当前代码不能直接静态托管」（计算全在后端、绝对路径、密钥无处可藏），并给出三条路线：A 纯前端重写（约 1500–2000 行 JS）、B 静态前端 + Serverless API（推荐折中）、C 直接部署 Python 服务（零改动，推荐演示场景）。
- **安全姿态**：无任何内置密钥；凭据只写本地 `config.local.json`（`config.py:1-6`）；服务无认证层，定位为本地/内网/自用部署（此项为基于代码的推断：`server.py` 无任何鉴权逻辑）。

---

## 7. 代码组织与实现层面的关键设计决策

1. **四源一次 HTTP 请求**：Open-Meteo 的 `models=` 参数把四家模式场复用到一次响应里，变量名加后缀区分（`meteo.py:195-200` `_series`）。四源对照不增加地点配额——这是「四源并列」功能成立的成本前提（`README.md:163`）。
2. **25 点上游环带不做任何裁剪**：地平线遮挡取决于太阳方向上游低云；`tools/measure_accuracy.py` 用 39 份真实响应实测：仅中心点最差偏差 42.3pp（上游低云 83%/中心 0% 时概率 14%→57%），故环带保留（`meteo.py:131-139`、`measure_accuracy.py:154-155`）。
3. **变量从 11 精简到 7**：露点、风速风向、降水概率模型从不读取（`measure_accuracy.py` 问题 1 以源码扫描证明零影响），额度成本降 36%（`meteo.py:54-58`、`README.md:287`）。
4. **取数只发生在用户确认时**：前端参数变更只 `markDirty()`，点「开始预测」/回车才发请求（`app.js:51-59`、`README.md:20`）；`tools/verify_interaction.py` 将此固化为自动化断言。
5. **三层缓存**：结果级（`data/predict/`，gzip + 原子写 + schema 版本化键）→ 原始响应（URL 哈希）→ GRIB 单点；过期策略按「资料还能变多少」定（`store.py:1-19`）。
6. **配额熔断而非盲目退避**：429 后 10 分钟内 relay 请求立即失败转直连，避免每次查询空等 90 s（`meteo.py:68-72`；状态持久化到 `_relay_breaker.json`，重启不丢）。
7. **物理可解释特征 + 薄标定层**：模型先算 canvas/light/horizon/purity/aod/precip 六个物里子评分，ridge（α=1.2）只做重加权，logistic 只做概率映射，六档阈值按标签累计频率分位确定（`model.py:174-207`、`calibrate.py:208-229`）。「是否成霞」与「烧多强」解耦（`grade_from_index` 用潜变量而非概率定级，`model.py:199`）。
8. **降级语义诚实标注**：直连结果带 `degraded`/`diagnosed` 字段（仅最近格点、无环带、置信度上限 0.74、ECMWF 分层云由 tcc+RH 诊断），UI 明示，不掩盖（`service.py:237-239`、`direct.py:236-241`）。
9. **校验源只补模型真正读取的量**：能见度/湿度/降水，补位来源记入 `aux_from`；总云量分歧 ≥35pp 或降水概率 ≥60% 转风险提示（`service.py:132-158`、`:203-208`）。
10. **地图按需生成 + 键设计**：日常查询只取 25 点；全国/城市图各由按钮触发，按「日期+朝晚」或「日期+坐标」缓存；切换数据源只重绘不发请求（`server.py:192-200` 注释、`maps.js:508-521`）。
11. **单文件版「移植而非重写」+ 双向验证**：`verify_port.py`（5 用例逐值比对，容差 1e-6～1e-3）、`verify_real.py`（真实 25 格点缓存同时喂两端，0 处差异）、`smoke_single.py`/`verify_requests.py`/`verify_interaction.py`（渲染冒烟、请求足迹、交互不变量）。
12. **GET + `_method=post` 代替 POST**：所有设置保存走查询参数，`do_GET` 内部分流（`server.py:219`、`:234`、`:264`）——实现简单，但也意味着无可预期的 CSRF 防护（推断，见 §9.6）。
13. **前端零依赖 + 事件总线**：三个 IIFE 通过 `skyglow:data`/`pending`/`pick` 解耦；每个分析面板有独立数据源切换器（`app.js:220-231`）。
14. **地图投影自绘**：全国图 Albers（标准纬线 25°/47°，中央经线 105°，`maps.js:12-20`），城市图简化等距圆柱；色带为固定绝对色阶跨日期可比（`maps.js:61-90`、`README.md:146`）。

---

## 8. 验证与质量保障体系（代码内建）

| 层次      | 手段                                  | 结果（数据文件实测）                                                                                    |
| ------- | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| 算法移植一致性 | `verify_port.py` / `verify_real.py` | 太阳位置 1e-6°、概率 1e-4、等级/RGB/NN 输出完全相等（README:452-476）                                           |
| 行为不变量   | `verify_interaction.py`             | 打开页面/改城市/改日期/切朝晚 → 0 请求；点按钮 → 发请求                                                             |
| 请求足迹    | `verify_requests.py`                | 主查询 25 点 × 7 变量；方位 77 点 × 4 变量；合计约 2508 额度单位                                                  |
| 取数窗口审计  | `audit_window.py`                   | 证实 outlook 前一天被读取 0 次；predict ±1 天 padding 服务高纬跨午夜曲线                                          |
| 模型指标    | `validation.json`                   | 五折 CV：AUC 0.802、Brier 0.118、±1 档 81.6%；时间切分 test AUC 0.797、Brier 0.167；同期 sunsetbot AUC 0.761 |
| 神经网络    | `nn_metrics.json`                   | test AUC 0.794 / Brier 0.174；train AUC 0.881（README 自述过拟合，仅作旁证）                               |
| 数据覆盖审计  | `validation.json` dataset 段         | 1109/1109 全量进入建表、标定与训练；唯一缺口为上游本身缺失的 1 条观测                                                     |

---

## 9. 发现的问题、文档漂移与风险（均标注依据）

### 9.1 文档与代码不一致（漂移）

1. **README「16 方位 × 6 距离（60–420 km）」**（`README.md:341`）与代码不符：`core/azimuth.py:17` 实为 **4 个距离**（60/140/240/380）；`azimuth.py:66` docstring 自称「109-point」亦不符（96+13=109 是 6 环旧值，现为 64+13=**77**）。前端 `verify_requests.py` 与 README 配额表中的「77 格点 × 4 变量」才是现行值。
2. **`glowmap.py` 模块 docstring 称 1.5° 粗网格**（`glowmap.py:5`），代码 `STEP = 2.0`（`:22`），608 点；README 配额段「全国图约消耗 1050 个格点请求」（`README.md:150`）与前端「约消耗 600 个格点配额」（`index.html:334`）互相不一致，且 1050 对应旧 1.5° 网格（42×25）。
3. **`config.example.json` 注释称「留空则使用程序内置的 WeatherAPI 密钥」**，但发布版 `DEFAULT_WEATHERAPI_KEY = ""`（`config.py:27`），`weatherapi.describe()` 的「内置默认」分支（`weatherapi.py:49`）实际永不可达——发布版即无内置密钥。
4. **`STATIC_HOSTING.md` 的行数统计过期**（称后端 3332 行、前端 2111 行；当前 core+server 为 3731 行、前端 JS 为 2132 行）——不影响结论，仅数字陈旧。

### 9.2 工具脚本硬编码作者机器路径

`tools/verify_port.py:16` 的 node 路径为 `C:\Users\Miracle R\.workbuddy\...`，`verify_real.py:22`/`smoke_single.py:16` 等的 Edge 路径为 `C:\Program Files (x86)\Microsoft\Edge\...`。换机器/换用户后这些验证脚本需手工改路径才能运行（发布版未做参数化）。

### 9.3 本副本数据完整性与工具可运行性

1. **`data/era5/` 实存 22/25 个文件**（缺 `r380a225/270/315` 三个环点）。`build_dataset.py:28-37` 按「目录里有什么读什么」处理，因此用本副本重建特征表时上游环带只有 22 点；随附的 `backtest_features.csv`（1109 行）应是在 25 点齐全时生成的（推断，无法从本目录证实生成时的文件集）。
2. **`_build/` 目录不存在**（`make_single.py:16`、`verify_port.py:17` 均引用同级 `_build/`）。因此在本发布副本中，单文件 HTML 只能使用随附成品，`make_single.py`/`verify_port.py` 无法直接运行；`verify_real.py` 依赖的缓存文件 `data/cache/03968e78045c510d82d9.json` 亦不在随附的 6 个缓存文件中。发布版裁剪了开发期中间产物，属预期行为（推断）。

### 9.4 模型层面的已知局限（README 自述 + 数据佐证）

- 标签仅上海单点、单人主观观测；跨气候区需重新标定（`README.md:412`）。
- 部署参数用全量 1109 条拟合，对 2023-07～12 属样本内预测，指标偏乐观（`README.md:377`）。
- 六档中 83% 为「基本不烧」，可用于区分强度的样本仅 188 条，强度分级是弱项（`README.md:395`）。
- 概率标定在秋季偏保守（测试期基率 24.3% vs 模型均值 12.6%），Brier 偏高（`README.md:394`）。
- ECMWF 直连无自带分层云量，诊断值受 Sundqvist 参数（lo=55、span=45、power=1.6，`direct.py:227`）影响。

### 9.5 工程层面观察（代码阅读所得，非文档声明）

1. **令牌桶非线程安全**：`_throttle`（`meteo.py:120-128`）在 `ThreadingHTTPServer` 多线程下对同一 `deque` 无锁读写，存在竞态；后果限于节流精度，不影响正确性（推断）。
2. **HTTP 缓存写盘非原子**：`meteo._get` 直接 `open(path,"w")` 覆写（`meteo.py:170-171`），并发同 URL 请求可能产生半文件；读取端有 `ValueError` 兜底（`:157-159`）。
3. **无 POST/无鉴权**：全部写操作走 GET 查询参数，服务面向可信网络部署（前述推断）。
4. **地图事件时刻固定 UTC+8**：`glowmap.py:240`、`:279` 对所有格点传 `tz_offset=8`。对中国全境（法定单一时区）正确；若把 BBOX 外推到海外需改（假设：当前仅面向中国）。
5. **`model.timeline` 每分钟重算全量物理**（`model.py:255-276`，91 次 `assess`，且 `:257-258` 对同一时刻重复调用 `solar_position`），单次预测的时间曲线是主要 CPU 成本；实测单次查询 2–4 s（`README.md:48`）说明可接受，但属可优化点。
6. **`store.py` 的 `data/predict/` 无清理机制**：仅提供 `clear` API，长期运行会累积（`store.py:115-127`）。

---

## 10. 结论

Skyglow 是一个**设计完整度很高**的小型全栈产品：后端 3700 余行纯标准库 Python 实现了「物理可解释 + 薄标定」的预报内核、四源并列、按需地图、GRIB2 直连与三级缓存/熔断的配额治理；前端 2100 余行零依赖 JS 完成全部可视化；`tools/` 把「取数—建表—实验—标定—训练—移植验证」做成可复现管线，并用 8 个验证脚本把关键不变量（移植一致性、请求足迹、交互不触发取数）固化为自动化断言。其工程取舍（环带不裁剪、变量精简、缓存分级、降级诚实标注、无内置密钥）都有代码内的量化依据或明确注释支撑。

主要待改进项按优先级：① 修正 §9.1 的文档漂移（尤其方位雷达距离数与全国图配额数）；② 参数化工具脚本中的绝对路径；③ 发布版补齐或说明 `_build/` 与 25 点 ERA5 场的缺失；④ 服务层加基础鉴权或明确仅限内网使用；⑤ `_throttle` 加锁与缓存原子写。

---

*报告生成时间：2026-10-25；分析对象：`D:/wbfile/sunglow/Skyglow/`（发布版副本）。*
