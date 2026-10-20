# 霞光预报 GLOWCAST · v2「大气光谱观测站」

全新高级科技风版本。与原版（`../index.html`，单文件 assemble 构建链）**完全隔离、互不影响**：
原版代码与资源零改动，v2 只单向链接到原版。

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
├── index.html               Vite 入口
├── package.json / vite.config.ts / tsconfig.json
├── vendor/src-verbatim/     原版脚本【冻结参考副本】（口径 diff 用，不参与构建）
├── src/
│   ├── main.ts / App.vue / router.ts / state.ts
│   ├── core/                算法层 TS 移植（口径与原版逐点对齐）
│   │   ├── math.ts          clamp/trap/wgeo/b64u/esc/safeLabel/球面几何
│   │   ├── astro.ts         solarPosition/sunEvents/sunAltRate（NOAA 低精度）
│   │   ├── physics.ts       光路消光积分/CIE 色度/rayTraceColor/云层/火三角
│   │   ├── scoring.ts       buildEnv/scoreStat/scoreRay/QUALITY_BANDS/ensConf
│   │   ├── ramp.ts          SPECTRUM_RAMP（新光谱色阶，与光效统一）
│   │   ├── calib.ts         F4 校准存储（四条硬边界原样保留）
│   │   ├── snap.ts          快照编解码 SNAP_VER=1（与原版互通）
│   │   ├── i18n.ts          三语（简/繁/英）
│   │   ├── api.ts           Open-Meteo + 超时预算 + 确定性 mock 回落
│   │   ├── city.ts          城市检索（主要城市子集）
│   │   └── forecast.ts      取数→样带→三套算法→综合 编排
│   ├── composables/useReveal.ts
│   ├── components/          Hero/结论/天色带/趋势/观测场/模式/因素/校准/顶栏
│   ├── views/               Home / Tutorial / 404
│   └── styles/              tokens.css（双主题设计令牌）+ main.css
├── app.html                 源码入口（开发用，不对外）
└── index.html               交付产物（单文件，构建生成）
```

## 交付产物（单一形态）

| 产物 | 路径 | 怎么打开 |
|---|---|---|
| **唯一交付** | `v2/index.html` | **直接双击**，断网可用。JS/CSS/字体内联，约 650KB |
| 开发 | 源码入口 `v2/app.html`（不对外） | `cd v2 && npm run dev` → 打开 `/app.html` |

```bash
cd v2
npm install
npm run dev                # 开发服务器
npm run build              # 单文件产物 → index.html
```

> 为什么不直接双击源码入口 `v2/app.html`：Vite 默认产物是 ES module 多文件，
> 浏览器从 `file://` 加载 module 脚本会被 CORS 拦截。单文件版把脚本内联进 HTML 才绕开这条限制。
> `v2/index.html` 由 `npm run build` 生成，**不要手改**；它是唯一交付文件。

## 与原版的关系
| 项 | 原版 | v2 |
|---|---|---|
| 构建链 | `assemble.py` 单文件 | Vite 多文件产物 |
| 存储 | `sunsetbot.pref.v1` / `sunsetbot.calib.v1` | `glowcast.v2.pref` / `glowcast.v2.calib` |
| 地图色阶 | HEAT_RAMP 白→黄→橙→红 | SPECTRUM_RAMP 深靛→品红→琥珀→电离青 |
| 预报算法 | GFS/EC 统计 + 光追 | **口径完全一致**（逐函数移植） |
| 快照格式 | SNAP_VER=1 | **互通**（任一侧生成对方可解） |
| 地图代理 | `__TMAP_SERVICE_HOST__` | 同占位符（产物不含密钥） |

`vendor/src-verbatim/` 是原版脚本的冻结拷贝：**不参与构建、不加载**，
仅作口径对照与 diff 基线。若原版算法演进，先 diff 该目录再同步 `src/core/`。

## 注意
- 数据源 Open-Meteo，免费层仅限非商业用途，按访客 IP 计额度
- 网络不可用/超时（预算 9s）会回落到**确定性 mock**，界面左上角标注 `MOCK`
- 首发不带测试；地图代理与部署（GH Pages）按约定暂缓
