# 霞光档案 Android · 发布与合规清单

> 2026-11-13 · 配套方案 `reports/android-next-phase-plan.html`（B4）。
> 拍板形态：**debug 内测版继续对外 + 长周期资质并行启动**；正式 release 签名包不在本轮。
> 「已完成」只指本地可交付的材料，不代表已受理或审核通过。

## 一、本轮已交付

| 项 | 交付物 | 状态 |
|---|---|---|
| 独立隐私政策 URL | `privacy.html`（简 / 繁 / 英三语，纯静态、无外部依赖） | ✅ 已生成，待 Pages 部署后访问 `https://sunglow.cloud/privacy.html` 复核 |
| 站内入口 | `v2/download.src.html` 页脚新增「隐私政策」→ 经 `emit-download-qr.mjs` 同步根 `download.html` | ✅ 已改并随 build 生成 |
| 应用内政策地址 | `res/values*/strings.xml` 新增 `privacy_url`（三语一致） | ✅ 资源就绪；**待接**：`AboutSheet` 增加可点击链接（属 B2-4 施工卡范围） |
| Open-Meteo CC BY 4.0 署名 + 许可链接 | 三语 `about_data` 已补 `CC BY 4.0` 与 `https://open-meteo.com/en/terms` | ✅ 已改；待下次出包生效 |
| 高德瓦片署名 | 三语 `about_data` 补「© 高德地图」；`FieldScreen.kt` 的 tile source 原本带署名 | ✅ 文案已补，条款待确认 |
| 三语资源一致性 | `native/tools/check-i18n.mjs` 进 CI | ✅ 67/67/67（新增 privacy_url 后） |
| 内测版功能边界文案 | 下载页三语改稿 | ✅ 已随 build 同步根产物 |

## 二、并行启动（长周期，需外部办理）

| # | 事项 | 材料 / 动作 | 状态 |
|---|---|---|---|
| 1 | **APP 备案**（工信部） | 主办者信息、App 名称与包名 `com.sunglow.spectrum`、域名 sunglow.cloud、前置审批（如涉及）、服务内容说明；国内商店提审核验 | ☐ 未办 · 建议立即启动 |
| 2 | **软著 / 电子版权证书**（三选一） | 小米要求《计算机软件著作权登记证书》《APP 电子版权证书》《软件著作权认证证书》三选一；华为常建议但审核中可能要求。名称需与「霞光档案」一致 | ☐ 未办 |
| 3 | 开发者实名与主体一致 | 各商店账号实名、包名、签名证书持有者、备案主体保持一致 | ☐ 待核对 |
| 4 | 商店素材 | 图标（已有 mipmap 五档 + 自适应图标）、启动图、5 张截图、应用简介、分级问卷、权限用途说明 | ☐ 待制作 |
| 5 | 权限用途说明 | INTERNET / ACCESS_NETWORK_STATE（取数）、COARSE+FINE_LOCATION（仅匹配最近城市）、POST_NOTIFICATIONS（本机提醒）、RECEIVE_BOOT_COMPLETED（小组件与排程恢复） | ☐ 待提交文案（可复用隐私页第 3/4/6 节） |
| 6 | 高德公开瓦片条款 | 确认公开分发的授权、配额、署名与是否需商务授权；若不被允许，B2-3 需临时回退到「无底图纯自绘」方案 | ☐ **B2-3 前置风险** |
| 7 | Open-Meteo 非商业约束 | 免费层仅限非商业、CC BY 4.0 署名；一旦加广告或收费，需改付费接口或自建代理 | ☐ 已署名，保持免费无广告 |

## 三、发布口径（本轮维持 debug 内测）

- Release `apk-latest` 继续 prerelease + 稳定直链；每次出包后同步更新 Release 描述与下载页功能边界（走 `download.src.html` → 生成器 → build，**根产物禁止手改**）。
- `versionCode = github.run_number` 递增保持不变；`versionName` 恒 `1.0.0` 建议后续改为随批次递增（**报告内建议，非拍板**）。
- debug keystore 固定复用（`native/keystore/debug.keystore`），避免覆盖安装报签名不一致。
- 下载页与隐私页持续保留：「未签正式证书的 debug 内测包」「正式签名版需先卸载」「来源校验」「预报仅供观赏参考」。
- 正式 release 签名包、AAB、商店提审、内测包→正式包迁移方案：**本轮不做**，待 B2 功能冻结 + B0 真机清单通过后单独拍板。

## 四、需要人工操作的外部动作（本机无法代劳）

1. 通过 `~/sunglow-sync.py` 或 GitHub 网页把本轮改动推送到远端，触发 `android` 工作流并确认 CI 全绿。
2. 在 GitHub Release `apk-latest` 的编辑页同步描述（功能边界、包大小、sha256、隐私政策链接）。
3. 提交 APP 备案与软著材料；向高德确认瓦片公开分发条款。
4. 商店账号注册与实名、素材上传、提审。
5. 真机执行 `docs/android-device-checklist.md` 并回填结论。

> 商店资质与数据 / 地图条款以各平台当期官方要求为准。本清单只记录材料与状态，不构成法律意见。
