/*
 * SUNGLOW · 取数纪律静态契约门禁（对应方案「立刻开工三件事」之趋势批量取数锁定）
 *
 * 用法（仓库根执行）：node native/tools/check-fetch-contract.mjs
 * CI：建议接在 check-tokens.mjs 之后、单测之前。
 *
 * 为什么用静态断言而不是 Kotlin 单测：
 *   · 本机能跑、无需 JDK/Gradle，网页口径或有人回退实现时立刻红；
 *   · 锁的是「结构性契约」（是否走了批量路径、换日期是否不取数、429 是否不重试），
 *     这些是取数纪律的骨架，数值细节仍由 golden 对拍负责。
 *
 * 判据（任一失败即退出码 1）：
 *   1. HomeViewModel.loadTrend 走 engine.runRange（区间批量），不得回退成逐日 engine.run；
 *   2. ForecastEngine.runRange 内部走 client.forecastBatched（区间 start/end），
 *      不是对每一天循环调用 run；
 *   3. LoadPolicy.decideLoad 保留 autoFetchSpent → 不取数 分支（换日期不自动取数）；
 *   4. OpenMeteoClient 遇到 429/RATE_LIMIT 直接抛、不重试；
 *   5. 额度口径注释统一为 363（不得回退到 171）。
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, "../app/src/main/java/com/sunglow/spectrum")
const read = (p) => readFileSync(resolve(src, p), "utf8")

const vm = read("ui/HomeViewModel.kt")
const forecast = read("core/Forecast.kt")
const policy = read("core/LoadPolicy.kt")
const client = read("data/OpenMeteoClient.kt")
const policyTest = readFileSync(
  resolve(here, "../app/src/test/java/com/sunglow/spectrum/core/LoadPolicyTest.kt"),
  "utf8"
)

let failed = 0
let passed = 0
function check(label, ok, detail) {
  if (ok) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`)
  }
}

/* 1. loadTrend 用 runRange */
const trendBody = (vm.match(/fun loadTrend\([\s\S]*?\n    \}/) || [""])[0]
check(
  "趋势取数走区间批量 runRange",
  /engine\.runRange\s*\(/.test(trendBody),
  "loadTrend 不得回退成逐日 engine.run"
)
check(
  "趋势未逐日循环调用 run",
  !/for\s*\([\s\S]{0,120}\)\s*\{[\s\S]{0,300}engine\.run\s*\(/.test(trendBody),
  "检测到 loadTrend 内逐日 engine.run"
)

/* 2. runRange 内用 forecastBatched 的区间重载（firstD/lastD），不是单日 dateStr/dateStr */
const rangeBody = (forecast.match(/suspend fun runRange\([\s\S]*?\n    \}/) || [""])[0]
check(
  "runRange 用区间批量请求",
  /forecastBatched\s*\([^)]*firstD[^)]*lastD/.test(rangeBody),
  "应是 firstD/lastD 区间，不是逐日"
)

/* 3. 换日期不自动取数 */
check(
  "换日期/时段不自动取数",
  /autoFetchSpent\s*->\s*LoadDecision\(false/.test(policy),
  "decideLoad 的 autoFetchSpent 分支被改动"
)

/* 4. 429 不重试 */
check(
  "429/限流不重试",
  /RATE_LIMIT\s*\|\|\s*e\.fatal\)\s*throw\s+e/.test(client),
  "限流必须直接抛，不得进入退避重试"
)

/* 5. 额度口径 363 */
check("额度口径 363（主源码）", /地图 363/.test(policy), "出现旧口径 171")
check("额度口径 363（单测）", /地图 363/.test(policyTest), "出现旧口径 171")
check("无旧口径 171 残留", !/地图 171/.test(policy) && !/地图 171/.test(policyTest), "仍有 171")

console.log(`\n取数契约：${passed} 通过 / ${failed} 失败`)
if (failed > 0) {
  console.error("取数纪律契约被破坏，请核对 diff 后再提交。")
  process.exit(1)
}
