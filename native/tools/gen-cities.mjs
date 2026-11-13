/*
 * SUNGLOW · 城市库生成器
 *
 * 目的：城市表只维护在网页端（v2/src/core/citydata.ts），原生端不抄一份。
 * 用法（仓库根执行）：
 *   npx tsx native/tools/gen-cities.mjs
 * 产物：
 *   native/app/src/main/assets/cities.tsv
 * 格式（Tab 分隔）：
 *   城市名	经度	纬度	省区	检索别名（空格分隔的英文/拼音）
 *
 * 产物不入库（.gitignore），每次 CI 构建前重新生成；
 * 资源缺失时 App 会回落到内置的省会清单。
 */

import { writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const coreDir = resolve(here, "../../v2/src/core")
const load = (name) => import(pathToFileURL(resolve(coreDir, name)).href)

const citydata = await load("citydata.ts")
const cityname = await load("cityname.ts")

function parseList(raw) {
  const out = []
  for (const item of String(raw || "").split(";")) {
    const p = item.split("|")
    if (p.length < 4) continue
    const name = p[0].trim()
    const lon = Number(p[1])
    const lat = Number(p[2])
    if (!name || !Number.isFinite(lon) || !Number.isFinite(lat)) continue
    out.push({ name, lon, lat, region: p[3].trim() })
  }
  return out
}

/* 与网页端同序：CN_CITIES → MAP_CITIES → GLOBAL_CITIES，同名取先出现的 */
const all = []
const seen = new Set()
for (const raw of [citydata.CN_CITIES_RAW, citydata.MAP_CITIES_RAW, citydata.GLOBAL_CITIES_RAW]) {
  for (const c of parseList(raw)) {
    if (seen.has(c.name)) continue
    seen.add(c.name)
    all.push(c)
  }
}

const glAlias = new Map()
for (const s of String(citydata.GL_ALIAS_RAW || "").split(";")) {
  const i = s.indexOf("=")
  if (i > 0) glAlias.set(s.slice(0, i).trim(), s.slice(i + 1).trim())
}

function aliasOf(c) {
  const en = (cityname.EN_CITY && cityname.EN_CITY[c.name]) ||
    (cityname.EN_REGION && cityname.EN_REGION[c.region]) || ""
  const gl = glAlias.get(c.name) || ""
  const joined = `${en} ${gl}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  const squashed = joined.replace(/\s+/g, "")
  return [joined, squashed].filter(Boolean).join(" ")
}

/* N3b：英/繁地名随表一起生成（简体底图自带，英文/繁体界面自绘，不在原生端再维护一份） */
const enOf = (c) => (cityname.EN_CITY && cityname.EN_CITY[c.name]) || ""
const twOf = (c) => (cityname.TW_CITY && cityname.TW_CITY[c.name]) || ""

const lines = all.map((c) =>
  [c.name, c.lon.toFixed(4), c.lat.toFixed(4), c.region, aliasOf(c), enOf(c), twOf(c)].join("\t")
)

const outPath = resolve(here, "../app/src/main/assets/cities.tsv")
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, lines.join("\n") + "\n", "utf8")
console.log(`cities: ${all.length} -> ${outPath}`)
