/*
 * SUNGLOW · Android 三语资源一致性门禁
 *
 * 用法（仓库根执行）：node native/tools/check-i18n.mjs
 * CI：.github/workflows/android.yml 在生成 golden 之后、单测之前调用。
 *
 * 判据：
 *   1. values / values-zh-rTW / values-en 的 <string name> 集合必须完全一致
 *   2. 不允许重复 name、空值
 *   3. 格式化占位符（%1$s 等）数量不一致时给出警告，不阻断（翻译语序可能不同）
 *
 * 背景：2026-11-13 检查时简体 78 键、繁/英各 61 键；缺口中 12 个是 P0 空壳残留，
 * 已清理，5 个语言/品牌名已补译。此后新增文案必须三语同批提交。
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const res = resolve(here, "../app/src/main/res")
const files = {
  zh: resolve(res, "values/strings.xml"),
  hant: resolve(res, "values-zh-rTW/strings.xml"),
  en: resolve(res, "values-en/strings.xml")
}

function parse(path) {
  const src = readFileSync(path, "utf8")
  const map = new Map()
  const dup = []
  const re = /<string\s+name="([^"]+)"\s*>([\s\S]*?)<\/string>/g
  let m
  while ((m = re.exec(src)) !== null) {
    const [, name, raw] = m
    if (map.has(name)) dup.push(name)
    map.set(name, raw.trim())
  }
  return { map, dup }
}

const parsed = Object.fromEntries(
  Object.entries(files).map(([lang, path]) => [lang, parse(path)])
)

let failed = false
const fail = (msg) => { console.error("  ✗ " + msg); failed = true }

for (const [lang, { map, dup }] of Object.entries(parsed)) {
  if (map.size === 0) fail(`${lang}: 未解析到任何 <string> 条目（${files[lang]}）`)
  if (dup.length) fail(`${lang}: 重复 name → ${dup.join(", ")}`)
  for (const [name, value] of map) {
    if (!value) fail(`${lang}: 空值 → ${name}`)
  }
  console.log(`  ${lang.padEnd(5)} ${String(map.size).padStart(3)} keys  ${files[lang].replace(/\\/g, "/").split("/").slice(-3).join("/")}`)
}

const base = parsed.zh.map
for (const lang of ["hant", "en"]) {
  const cur = parsed[lang].map
  const missing = [...base.keys()].filter((k) => !cur.has(k)).sort()
  const extra = [...cur.keys()].filter((k) => !base.has(k)).sort()
  if (missing.length) fail(`${lang}: 缺 ${missing.length} 个键 → ${missing.join(", ")}`)
  if (extra.length) fail(`${lang}: 多 ${extra.length} 个键 → ${extra.join(", ")}`)
}

/* 占位符数量只作提示：翻译语序可能改变编号，但数量不一致通常意味着漏写参数 */
for (const [name, zh] of base) {
  const count = (s) => (s.match(/%\d+\$[sdf]/g) || []).length
  for (const lang of ["hant", "en"]) {
    const v = parsed[lang].map.get(name)
    if (v && count(zh) !== count(v)) {
      console.warn(`  ! ${lang}: 占位符数量与简体不同 → ${name} (${count(zh)} vs ${count(v)})`)
    }
  }
}

if (failed) {
  console.error("\ncheck-i18n: 三语资源不一致，请同步补齐后再提交。")
  process.exit(1)
}
console.log("check-i18n: ✓ 三语键集一致，无重复与空值。")
