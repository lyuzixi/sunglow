/*
 * SUNGLOW · B2 四包深同步的网页侧基准采集
 *
 * 用法（仓库根执行）：npx tsx native/tools/gen-b2-baselines.mjs
 * 产物：native/app/src/test/resources/golden/b2-baselines.json（供 B2 各包 Kotlin 断言使用）
 *
 * 设计取舍：
 *   · 只采集「常量 + 纯函数样本」，不发起任何网络请求、不修改网页源码。
 *   · 常量用正则从源码文本提取（不执行模块），纯函数才动态 import，避免 DOM 依赖导致 CI 抖动。
 *   · 每个源文件记 sha256：网页改了口径，哈希就变，Kotlin 侧必须跟改。
 *   · 本脚本不替代 gen-golden.mjs；B2 各包实现时把对应分组接入 VerdictGoldenTest 同款断言，
 *     再从 gen-golden.mjs 的 pendingGroups 里移除名字。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const coreDir = resolve(here, "../../v2/src/core")
const mod = (name) => pathToFileURL(resolve(coreDir, name)).href
const read = (name) => readFileSync(resolve(coreDir, name), "utf8")

/* 网页端模块在加载时可能触碰浏览器存储，先补内存实现 */
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size }
}
globalThis.sessionStorage = globalThis.localStorage

const files = ["snap.ts", "calib.ts", "trend.ts", "mapdata.ts", "verdict.ts", "units.ts"]
const hashes = Object.fromEntries(
  files.map((f) => [f, createHash("sha256").update(read(f)).digest("hex").slice(0, 16)])
)

function constOf(src, name) {
  const m = src.match(new RegExp("export const " + name + "\\s*=\\s*([^;\\n]+)"))
  if (!m) return null
  const expr = m[1].replace(/\/\/.*$/, "").trim()
  let value = expr
  try { value = Function('"use strict";return (' + expr + ")")() } catch { /* 保留表达式原文 */ }
  return { expr, value: typeof value === "function" ? null : value }
}

const mapSrc = read("mapdata.ts")
const calibSrc = read("calib.ts")
const trendSrc = read("trend.ts")
const snapSrc = read("snap.ts")

const constants = {
  map: Object.fromEntries(
    ["MAP_RADIUS_KM", "MAP_GRID_KM", "MAP_CACHE_TTL", "MAP_CACHE_MAX", "FIELD_OUT_KM", "EDGE_NOISE_KM", "CITY_NEAR_KM"]
      .map((k) => [k, constOf(mapSrc, k)])
  ),
  calib: Object.fromEntries(
    ["CALIB_GRID_DEG", "CALIB_BUCKET", "CALIB_HIT_MIN", "CALIB_MIN_N", "CALIB_MIN_BUCKET", "CALIB_MAX", "CALIB_AFTER_H"]
      .map((k) => [k, constOf(calibSrc, k)])
  ),
  trend: Object.fromEntries(
    ["TREND_N", "TREND_CACHE_TTL", "TREND_CACHE_PREFIX"].map((k) => [k, constOf(trendSrc, k)])
  ),
  snap: Object.fromEntries(
    ["SNAP_VER", "SNAP_MAX", "SNAP_N_FAC"].map((k) => [k, constOf(snapSrc, k)])
  )
}

const samples = { snap: [], calib: [], trend: [], map: [] }
const unavailable = []

try {
  const snap = await import(mod("snap.ts"))
  const input = {
    dateStr: "2026-11-13", period: "pm", lat: 39.9042, lon: 116.4074,
    name: "北京市", region: "北京市", P: 72, Q: 68,
    consist: 0.8, dvI: 1.0, spread: 0.12, spreadQ: 6,
    offsetS: 28800, primaryLevel: 1, primaryType: "层积云", primaryBase: 1.3,
    dKm: 120, durMin: 25,
    factors: [
      { k: "cover", v: 60, s: 55 }, { k: "base", v: 1.3, s: 70 },
      { k: "aod", v: 0.31, s: 60 }, { k: "vis", v: 24, s: 82 }
    ]
  }
  const raw = snap.snapEncode(input)
  samples.snap.push({ raw, decoded: raw ? snap.snapDecode(raw) : null, keys: snap.SNAP_KEYS, types: snap.SNAP_TYPES })
} catch (e) { unavailable.push("snap.ts: " + e.message) }

try {
  const calib = await import(mod("calib.ts"))
  for (const [lat, lon] of [[39.9042, 116.4074], [23.1291, 113.2644], [-33.8688, 151.2093]]) {
    samples.calib.push({ lat, lon, group: calib.calibGroupOf(lat, lon) })
  }
  for (const p of [0, 7, 19, 20, 42, 65, 88, 100]) {
    samples.calib.push({ p, bucket: calib.calibBucketOf(p) })
  }
  for (const h of [null, -2, -1, 0, 1, 4]) {
    samples.calib.push({ leadH: h, canAnnotate: calib.calibCanAnnotate(h) })
  }
} catch (e) { unavailable.push("calib.ts: " + e.message) }

try {
  const trend = await import(mod("trend.ts"))
  for (const [day0, lat, lon] of [[Date.UTC(2026, 10, 13), 39.9042, 116.4074], [Date.UTC(2026, 10, 14), 23.1291, 113.2644]]) {
    samples.trend.push({ day0, lat, lon, key: trend.trendKeyOf(day0, lat, lon) })
  }
} catch (e) { unavailable.push("trend.ts: " + e.message) }

try {
  const map = await import(mod("mapdata.ts"))
  for (const [dateS, lat, lon] of [["2026-11-13", 39.9042, 116.4074], ["2026-11-14", 23.1291, 113.2644]]) {
    samples.map.push({ dateS, lat, lon, key: map.mapKeyOf(dateS, lat, lon) })
  }
} catch (e) { unavailable.push("mapdata.ts: " + e.message) }

const out = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: "v2/src/core (TypeScript)",
  note: "B2 基准：常量与纯函数样本。Kotlin 断言随各功能包接入，见 docs/android-b2-workcards.md。",
  hashes,
  constants,
  samples,
  unavailable
}

const outPath = resolve(here, "../app/src/test/resources/golden/b2-baselines.json")
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n", "utf8")
console.log("B2 baselines written:", outPath)
console.log("  hashes:", Object.keys(hashes).length, "files")
console.log("  samples:", Object.entries(samples).map(([k, v]) => k + "=" + v.length).join(" "))
if (unavailable.length) console.warn("  unavailable:", unavailable.join(" | "))
