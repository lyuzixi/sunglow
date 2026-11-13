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

const samples = { snap: [], calib: [], trend: [], map: [], field: [], ramp: [] }
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

/* ---------- 5. 观测场：自适应核 Shepard 插值 + 全光谱色阶（N3） ---------- */
/* 用网页真实导出的 trendValueAt / fieldProbeAt / rampColor 生成基准， */
/* 而不是在生成器里另写一套公式；下面的 jsShepard 只用于自检 Kotlin 侧的全量近邻实现。 */
try {
  const mr = await import(mod("maprender.ts"))
  const ramp = await import(mod("ramp.ts"))
  const fieldPts = []
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      fieldPts.push({
        lat: 30 + i * 0.6,
        lon: 110 + j * 0.6,
        v: 20 + ((i * 37 + j * 19) % 75),
        occ: (i * 13 + j * 7) % 90,
        gap: (i * 11 + j * 5) % 40
      })
    }
  }
  const queries = [
    [30.0, 110.0], [30.3, 110.3], [31.2, 111.2], [30.9, 110.6],
    [31.8, 112.0], [29.4, 109.2], [33.0, 113.4], [30.15, 110.15]
  ]
  for (const [lat, lon] of queries) {
    samples.field.push({
      lat, lon,
      v: mr.trendValueAt(lat, lon, fieldPts),
      probe: mr.fieldProbeAt(lat, lon, fieldPts)
    })
  }
  for (const v of [0, 7, 22, 50, 72, 90, 100]) {
    samples.ramp.push({ v, hex: ramp.rampColor(v) })
  }

  /* 自检：全量排序取 9 近邻（Kotlin 实现）是否与网页空间索引 knearest 等价 */
  function jsShepard(pts, lat, lon) {
    const good = pts.filter((p) => p.v != null && Number.isFinite(p.v))
    const lat0 = good.reduce((s, p) => s + p.lat, 0) / good.length
    const lon0 = good.reduce((s, p) => s + p.lon, 0) / good.length
    const cosLat = Math.max(0.2, Math.cos((lat0 * Math.PI) / 180))
    const X = (lon - lon0) * 111.32 * cosLat
    const Y = (lat - lat0) * 110.574
    const ds = good.map((p) => ({
      d: Math.hypot((p.lon - lon0) * 111.32 * cosLat - X, (p.lat - lat0) * 110.574 - Y),
      v: Math.min(100, Math.max(0, p.v))
    })).sort((a, b) => a.d - b.d).slice(0, 9)
    if (!ds.length) return null
    if (ds[0].d < 1e-6) return ds[0].v
    const R = ds[ds.length - 1].d * 1.06 || 1
    let sw = 0, sv = 0
    for (const q of ds) {
      const t = R - q.d
      const w = t > 0 ? (t * t) / (R * R * q.d * q.d) : 0
      sw += w; sv += w * q.v
    }
    return sw > 0 ? sv / sw : ds[0].v
  }
  let maxDelta = 0
  for (const c of samples.field) {
    const mine = jsShepard(fieldPts, c.lat, c.lon)
    if (mine != null && c.v != null) maxDelta = Math.max(maxDelta, Math.abs(mine - c.v))
  }
  console.log("  field self-check: full-sort Shepard vs trendValueAt max delta =", maxDelta.toExponential(3))
  if (maxDelta > 1e-6) unavailable.push("field: 全量近邻与网页 knearest 不等价，Kotlin 需改用空间索引")
  if (ramp.SPECTRUM_RAMP) samples.rampAnchors = ramp.SPECTRUM_RAMP
} catch (e) { unavailable.push("maprender.ts/ramp.ts: " + e.message) }

const out = {
  version: 2,
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
