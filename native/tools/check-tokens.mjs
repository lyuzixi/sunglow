/*
 * SUNGLOW · Android ↔ Web 设计令牌同步门禁（R7A）
 *
 * 用法（仓库根执行）：node native/tools/check-tokens.mjs
 * CI：.github/workflows/android.yml 在 check-i18n 之后调用。
 *
 * 判据：
 *   1. 网页 tokens.css 中「主题无关」与「深色主题」的关键 hex，必须在 Color.kt 有同值令牌；
 *   2. 网页改了这些 hex 而 Kotlin 未跟改 → 失败（漂移）；
 *   3. 已声明的平台差异（无障碍对比度）列进豁免，不阻断。
 *
 * 边界：
 *   · 只比对「能一一映射且应当相同」的色，不追求 tokens.css 全部 107 个变量——
 *     网页专有变量（照片遮罩、辉光阴影等）本就不该进原生。
 *   · 解析源码文本，不执行任何模块，无 DOM / 网络依赖，CI 稳定。
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const cssPath = resolve(here, "../../v2/src/styles/tokens.css")
const ktPath = resolve(here, "../app/src/main/java/com/sunglow/spectrum/ui/theme/Color.kt")

const css = readFileSync(cssPath, "utf8")
const kt = readFileSync(ktPath, "utf8")

/* ---- 从 CSS 抽取某个变量的值（取第一次出现，即 :root 或 dark 块） ---- */
function cssVar(name) {
  const m = css.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`))
  return m ? m[1].trim().toLowerCase() : null
}

/* ---- 从 Kotlin 抽取指定 object 内某 val 的 ARGB hex ---- */
function ktVal(obj, name) {
  const block = kt.match(new RegExp(`object ${obj}\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!block) return null
  const m = block[1].match(new RegExp(`val ${name}\\s*=\\s*Color\\(0x([0-9a-fA-F]{8})\\)`))
  return m ? m[1].toLowerCase() : null
}

/* ---- 顶层 val（光谱 / 曙暮光常量）---- */
function ktTop(name) {
  const m = kt.match(new RegExp(`val ${name}\\s*=\\s*Color\\(0x([0-9a-fA-F]{8})\\)`))
  return m ? m[1].toLowerCase() : null
}

/* #rgb → argb；rgba(r,g,b,a) → aarrggbb */
function normalize(value) {
  if (!value) return null
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) return "ff" + hex[1].toLowerCase()
  const rgba = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i)
  if (rgba) {
    const [, r, g, b, a] = rgba
    const alpha = a === undefined ? 255 : Math.round(parseFloat(a) * 255)
    const hx = (n) => Number(n).toString(16).padStart(2, "0")
    return alpha.toString(16).padStart(2, "0") + hx(r) + hx(g) + hx(b)
  }
  return null
}

/*
 * 映射表：{ 网页变量, Kotlin 取值函数, 说明 }
 * 分类：
 *   universal —— 主题无关，必须与 Kotlin 顶层常量一致
 *   dark      —— 取自 tokens.css 深色块（第一次出现的 --bg-base / --tx-1 等即深色值）
 */
const checks = [
  // 光谱（主题无关）
  ["spectrum-1", () => ktTop("SpectrumMagenta"), "品牌光谱·品红"],
  ["spectrum-2", () => ktTop("SpectrumAmber"), "品牌光谱·琥珀"],
  ["spectrum-3", () => ktTop("SpectrumCyan"), "品牌光谱·电离青"],
  // 曙暮光（不随主题，CSS 第一次出现即深色块值）
  ["dusk-day", () => ktTop("DuskDay"), "曙暮光·白昼"],
  ["dusk-civil", () => ktTop("DuskCivil"), "曙暮光·民用"],
  ["dusk-nautical", () => ktTop("DuskNautical"), "曙暮光·航海"],
  ["dusk-astro", () => ktTop("DuskAstro"), "曙暮光·天文"],
  ["dusk-night", () => ktTop("DuskNight"), "曙暮光·夜间"],
  // 深色语义色（CSS 第一次出现 = 深色块）
  ["bg-base", () => ktVal("DarkTokens", "bg"), "深色·页面底"],
  ["bg-elev", () => ktVal("DarkTokens", "bg2"), "深色·抬升面"],
  ["bg-card", () => ktVal("DarkTokens", "card"), "深色·玻璃卡"],
  ["tx-1", () => ktVal("DarkTokens", "ink"), "深色·主文字"],
  ["tx-2", () => ktVal("DarkTokens", "muted"), "深色·次文字"],
  ["tx-3", () => ktVal("DarkTokens", "faint"), "深色·脚注"],
  ["q-good", () => ktVal("DarkTokens", "good"), "深色·良好"],
  ["q-mid", () => ktVal("DarkTokens", "mid"), "深色·一般"],
  ["q-bad", () => ktVal("DarkTokens", "bad"), "深色·较差"],
  ["q-info", () => ktVal("DarkTokens", "info"), "深色·信息"],
]

/*
 * 平台差异豁免：Kotlin 侧有意与网页不同，且已在源码注释说明原因。
 * 键为 CSS 变量；值为「Kotlin 当前值 → 豁免理由」。
 */
const waivers = {
  // 原生 N2 无障碍把浅色 faint 从 #667287 调到 #5A667C（4.45:1 → 5.3:1，达 WCAG AA）。
  // 网页 tokens.css 仍是 #667287；这是已拍板的平台差异，不算漂移。
  light_faint: "#5a667c — N2 无障碍：浅色脚注对比度 4.45:1 → 5.3:1（见 Color.kt 注释）",
}

let failed = 0
let passed = 0
for (const [cssName, readKt, label] of checks) {
  const web = normalize(cssVar(cssName))
  const native = readKt()
  if (!web) {
    console.error(`  ? ${label}：tokens.css 未找到 --${cssName}`)
    failed++
    continue
  }
  if (!native) {
    console.error(`  ✗ ${label}：Color.kt 未找到对应令牌`)
    failed++
    continue
  }
  if (web === native) {
    passed++
  } else {
    console.error(`  ✗ ${label}：漂移  web=#${web}  native=#${native}`)
    failed++
  }
}

/* 豁免项：确认 Kotlin 值仍等于声明值，若被改动则提示重新评估豁免 */
const lightFaint = ktVal("LightTokens", "faint")
if (lightFaint !== "ff5a667c") {
  console.error(`  ! 浅色 faint 已变更（当前 #${lightFaint}），请复核 check-tokens.mjs 的豁免理由`)
  failed++
} else {
  passed++
  console.log(`  ○ 浅色 faint 平台差异（豁免）：${waivers.light_faint}`)
}

console.log(`\n令牌同步：${passed} 通过 / ${failed} 失败`)
if (failed > 0) {
  console.error("网页设计令牌已漂移，请同步 native Color.kt 后再提交。")
  process.exit(1)
}
