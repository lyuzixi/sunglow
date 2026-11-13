/*
 * SUNGLOW · 算法基准（golden）生成器
 *
 * 目的：让网页端 TS 实现充当"标准答案"，为 Kotlin 原生实现提供逐字段的对比基准。
 * 用法（仓库根执行）：
 *   npx tsx native/tools/gen-golden.mjs
 * 产物：
 *   native/app/src/test/resources/golden/core-golden.json
 *
 * 注意：本脚本只读取 v2/src/core，不修改任何网页源码。
 * 一旦算法口径调整，必须重跑本脚本，否则原生端会按旧基准通过测试。
 *
 * 2026-11-13 · B1「两端长期全量同步」契约：
 *   · 基准不入库，CI 每次从 v2 源码实时生成；网页改一行 TS、Kotlin 没跟上就红。
 *   · verdict 是打通「改 TS → CI 红 → 改 Kotlin → 绿」回路的最小分组。
 *   · trend / field / calib / snapshot 分组待 B2 各功能包实现时接入，
 *     写在 pendingGroups 里作为待办清单，不生成假基准。
 */

/* 网页端模块在模块加载时可能触碰浏览器存储，先在 Node 里补一个内存实现 */
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

import { writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const coreDir = resolve(here, "../../v2/src/core")
const mod = (name) => pathToFileURL(resolve(coreDir, name)).href

const astro = await import(mod("astro.ts"))
const physics = await import(mod("physics.ts"))
const scoring = await import(mod("scoring.ts"))
const verdict = await import(mod("verdict.ts"))

/* ---------- 确定性伪随机（保证每次生成同一批用例） ---------- */
let seed = 20261112
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}
const pick = (a) => a[Math.floor(rnd() * a.length)]
const round = (v, n = 6) => (typeof v === "number" && isFinite(v) ? Number(v.toFixed(n)) : v)

/* 数值统一收敛到 6 位小数，避免浮点尾数把"1e-16 级差异"当成不一致 */
function deepRound(v) {
  if (Array.isArray(v)) return v.map(deepRound)
  if (v && typeof v === "object") {
    const o = {}
    for (const k of Object.keys(v)) o[k] = deepRound(v[k])
    return o
  }
  if (typeof v === "number") return round(v)
  return v
}

/* ---------- 1. 太阳位置 / 日出日落 / 事件方位 ---------- */
const coords = [
  [39.9042, 116.4074],   // 北京
  [31.2304, 121.4737],   // 上海
  [23.1291, 113.2644],   // 广州
  [22.5431, 114.0579],   // 深圳
  [30.5728, 104.0668],   // 成都
  [36.0671, 120.3826],   // 青岛
  [43.8171, 125.3235],   // 长春
  [29.6520, 91.1721],    // 拉萨
  [18.2528, 109.5119],   // 三亚
  [64.1466, -21.9426],   // 雷克雅未克（高纬 + 负经度）
  [-33.8688, 151.2093],  // 悉尼（南半球）
  [-1.2921, 36.8219]     // 内罗毕（赤道）
]

const astroCases = []
const dayBase = Date.UTC(2026, 10, 12, 6, 0, 0) // 2026-11-12T06:00Z
for (let i = 0; i < 48; i++) {
  const [lat, lon] = pick(coords)
  const ms = dayBase + Math.floor(rnd() * 14 * 24 * 60) * 60000
  const p = astro.solarPosition(ms, lat, lon)
  astroCases.push({
    ms, lat, lon,
    altitude: p.altitude, azimuth: p.azimuth,
    declination: p.declination, hourAngle: p.hourAngle
  })
}

const eventCases = []
for (const [lat, lon] of coords) {
  const ev = astro.sunEvents(Date.UTC(2026, 10, 12), lat, lon)
  eventCases.push({
    date: "2026-11-12", lat, lon,
    noonMs: ev.noonMs, riseMs: ev.riseMs, setMs: ev.setMs,
    polarDay: ev.polarDay, polarNight: ev.polarNight
  })
}

const azimuthCases = []
for (const [lat, lon] of coords) {
  for (const per of ["am", "pm"]) {
    azimuthCases.push({
      date: "2026-11-12", per, lat, lon,
      value: astro.eventAzimuth("2026-11-12", per, lat, lon)
    })
  }
}

const altRateCases = []
for (let i = 0; i < 16; i++) {
  const [lat, lon] = pick(coords)
  const ms = dayBase + Math.floor(rnd() * 12 * 60) * 60000
  altRateCases.push({ ms, lat, lon, value: astro.sunAltRate(ms, lat, lon) })
}

/* ---------- 2. 光路消融 → 色彩 ---------- */
const rayCases = []
const hList = [0.4, 1.2, 2.5, 4.0, 6.5]
const thList = [-0.004, -0.02, -0.06, -0.14, -0.3]
const aodList = [0.04, 0.18, 0.45, 1.1]
const hsList = [0.8, 1.5, 3.2]
for (const h of hList) {
  for (const th of thList) {
    for (const aod of aodList) {
      for (const hs of hsList) {
        const c = physics.rayTraceColor(h, th, aod, hs)
        rayCases.push({
          h, th, aod, hs,
          tau550: c.tau550, t550: c.T550, lumRel: c.lumRel, wash: c.wash,
          r: c.rgb[0], g: c.rgb[1], b: c.rgb[2], hex: c.hex,
          sat: c.sat, hue: c.hue, chroma: c.chroma, name: c.name
        })
      }
    }
  }
}

/* ---------- 3. 评分：统计判据 + 光追 ---------- */
function makeEnv(over) {
  return Object.assign({
    tMs: Date.UTC(2026, 10, 12, 9, 0, 0),
    T: 16, Td: 8, RH: 58,
    cTot: 60, cLow: 8, cMid: 15, cHigh: 55,
    vis: 24000, P: 1012, Pmsl: 1016,
    ws: 4.2, wd: 210, gust: 7.5,
    fz: 3800, blh: 1100,
    precip: 0, cape: 120, sw: 80,
    pp: 5, aod: 0.16,
    missing: []
  }, over)
}

function makeTransect(low, mid, high, aod) {
  const out = []
  for (let i = 0; i <= 16; i++) {
    const d = i * 25
    out.push({
      d,
      cLow: low[i] ?? low[low.length - 1],
      cMid: mid[i] ?? mid[mid.length - 1],
      cHigh: high[i] ?? high[high.length - 1],
      aod: aod[i] ?? aod[aod.length - 1],
      vis: 24000
    })
  }
  return out
}

const envCases = [
  makeEnv(),
  makeEnv({ cHigh: 85, cLow: 2, cMid: 8, aod: 0.08, vis: 32000, blh: 1600 }),
  makeEnv({ cLow: 88, cMid: 40, cHigh: 15 }),
  makeEnv({ cLow: 0, cMid: 0, cHigh: 0, cTot: 0 }),
  makeEnv({ aod: 1.25, vis: 6000, cHigh: 70 }),
  makeEnv({ vis: 900, RH: 96, precip: 2.4, cape: 2200 }),
  makeEnv({ fz: 900, T: 4, Td: 2, blh: 320 }),
  makeEnv({ cMid: 72, cLow: 34, cHigh: 40, vis: 11000 }),
  makeEnv({ cLow: 46, cMid: 12, cHigh: 92, aod: 0.5, blh: 700 }),
  makeEnv({ T: 27, Td: 24, RH: 88, cLow: 22, cMid: 26, cHigh: 30, aod: 0.95 })
]

const transectSets = [
  makeTransect([5, 8, 12, 20, 30, 45, 60, 70, 65, 55, 40, 30, 20, 12, 8, 5, 2],
               [10, 14, 18, 30, 45, 55, 50, 40, 30, 22, 18, 14, 10, 8, 6, 4, 2],
               [30, 40, 55, 65, 75, 85, 88, 80, 70, 60, 50, 42, 36, 30, 26, 22, 18],
               [0.1, 0.12, 0.15, 0.2, 0.28, 0.35, 0.4, 0.38, 0.34, 0.3, 0.26, 0.22, 0.2, 0.18, 0.16, 0.14, 0.12]),
  makeTransect([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
               [5, 5, 6, 6, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13],
               [60, 62, 64, 66, 68, 70, 72, 74, 74, 72, 70, 68, 66, 64, 62, 60, 58],
               [0.05, 0.05, 0.06, 0.06, 0.07, 0.07, 0.08, 0.08, 0.09, 0.09, 0.1, 0.1, 0.11, 0.11, 0.12, 0.12, 0.13]),
  makeTransect([80, 85, 90, 92, 90, 85, 70, 55, 40, 30, 20, 15, 10, 8, 6, 4, 2],
               [40, 45, 50, 55, 55, 50, 45, 40, 35, 30, 25, 20, 16, 12, 10, 8, 6],
               [20, 25, 30, 35, 40, 45, 50, 55, 60, 62, 60, 55, 50, 45, 40, 35, 30],
               [0.4, 0.42, 0.45, 0.48, 0.5, 0.52, 0.55, 0.58, 0.6, 0.62, 0.6, 0.58, 0.55, 0.5, 0.45, 0.4, 0.38])
]

const ctxCases = [
  { v: 0.6, omega: 0.18, dP: 0.8, aod: null },
  { v: 0.25, omega: 0.09, dP: -0.4, aod: null },
  { v: 1.4, omega: 0.32, dP: 3.1, aod: null },
  { v: 0.9, omega: 0.11, dP: null, aod: null }
]

const statCases = []
const rayScoreCases = []
for (let i = 0; i < envCases.length; i++) {
  const env = envCases[i]
  const trRaw = transectSets[i % transectSets.length]
  for (let j = 0; j < ctxCases.length; j++) {
    const ctx = ctxCases[j]
    const levelKey = env.cHigh >= 20 ? "cHigh" : env.cMid >= 20 ? "cMid" : "cLow"
    const tr = physics.analyseTransect(trRaw, levelKey)
    /*
     * 关键：summary 是"派生输入"。基准 JSON 会把数值收敛到 6 位小数，
     * 若用全精度 summary 计算输出、却只存 6 位小数的 summary，
     * 原生端读回时就会得到不同的结果（1e-6 级偏差会一路放大到概率上）。
     * 因此这里先把 summary 收敛，再拿收敛后的值参与计算。
     */
    const summary = deepRound({
      hasDeck: tr.hasDeck,
      dFar: tr.dFar ?? null,
      upstreamAod: tr.upstreamAod ?? null,
      upstreamLowMax: tr.upstreamLowMax ?? null,
      upstreamMidMax: tr.upstreamMidMax ?? null
    })

    const stat = scoring.scoreStat(env, summary, ctx)
    statCases.push({
      env, summary, ctx,
      p: stat.P, q: stat.Q, s: stat.s,
      hEff: stat.hEff, Heq: stat.Heq, Hs: stat.Hs,
      aodUp: stat.aodUp, d: stat.d,
      primaryKey: stat.primary.key,
      primaryType: stat.primary.type,
      noCloud: stat.noCloud,
      f: stat.f, missF: stat.missF,
      geom: {
        xMax: stat.geom.xMax, thFar: stat.geom.thFar, thNear: stat.geom.thNear,
        ok: stat.geom.ok, dur: stat.geom.dur
      }
    })

    const ray = scoring.scoreRay(env, summary, ctx)
    rayScoreCases.push({
      env, summary, ctx,
      p: ray.P, q: ray.Q, s: ray.S,
      hEff: ray.hEff, hRaw: ray.hRaw, noLight: ray.noLight,
      Heq: ray.Heq, Hs: ray.Hs, aodUp: ray.aodUp,
      geomOk: ray.geom.ok, dur: ray.geom.dur,
      geomF: ray.geomF, coverF: ray.coverF, aeroF: ray.aeroF,
      satScore: ray.satScore, colorRich: ray.colorRich, hueSpread: ray.hueSpread,
      maxChroma: ray.maxChroma, qColor: ray.qColor, qDur: ray.qDur,
      brightTxt: ray.bright.txt, brightScore: ray.bright.score,
      samples: ray.samples.map((s) => ({
        t: s.t, magDeg: s.magDeg, th: s.th, invalid: !!s.invalid,
        t550: s.T550, hex: s.hex, sat: s.sat, hue: s.hue, chroma: s.chroma
      }))
    })
  }
}

const transectCases = []
for (const set of transectSets) {
  for (const key of ["cLow", "cMid", "cHigh"]) {
    const r = physics.analyseTransect(set, key)
    transectCases.push({
      levelKey: key,
      input: set,
      out: deepRound({
        ok: r.ok, reason: r.reason ?? null,
        dNear: r.dNear ?? null, dFar: r.dFar ?? null,
        openEnded: !!r.openEnded, hasDeck: r.hasDeck,
        upstreamAod: r.upstreamAod ?? null,
        upstreamLowMax: r.upstreamLowMax ?? null,
        upstreamMidMax: r.upstreamMidMax ?? null,
        upstreamVisMin: r.upstreamVisMin ?? null
      })
    })
  }
}

/* 边界：空样带 */
transectCases.push({
  levelKey: "cLow",
  input: [],
  out: { ok: false, reason: "无样带数据", dNear: null, dFar: null, openEnded: false, hasDeck: false,
         upstreamAod: null, upstreamLowMax: null, upstreamMidMax: null, upstreamVisMin: null }
})

/* ---------- 4. 结论口径：等级分档 / 结论词 / 模型顺序 ---------- */
/* 覆盖每个分档的下边界、边界前后与越界值；Kotlin 侧 VerdictGoldenTest 逐项断言。 */
const gradeQs = [-1, 0, 43.9, 44, 44.9, 45, 63.9, 64, 64.9, 65, 78.9, 79, 79.9, 80, 99.9, 100, 120]
const gradeCases = gradeQs.map((q) => ({ q, key: scoring.gradeOf(q) }))
const wordPs = [-5, 0, 24.9, 25, 44.9, 45, 69.9, 70, 85, 100, 150]
const wordCases = wordPs.map((p) => ({ p, word: verdict.conclWord(p) }))
const bandCases = scoring.QUALITY_BANDS.map((b) => ({ key: b.key, min: b.min, max: b.max }))
const modelCases = verdict.MODEL_ITEMS.map((m) => ({ id: m.id, label: m.label }))

const golden = deepRound({
  version: 2,
  source: "v2/src/core (TypeScript)",
  generatedAt: new Date().toISOString(),
  verdict: {
    grades: gradeCases,
    words: wordCases,
    bands: bandCases,
    models: modelCases
  },
  /* B2 各功能包实现时接入断言，接入后从数组移除对应名字。
     N1 已接入：snapshot（SnapshotCodecTest）、calib（CalibGoldenTest）。 */
  pendingGroups: ["trend", "field"],
  astro: astroCases,
  sunEvents: eventCases,
  eventAzimuth: azimuthCases,
  sunAltRate: altRateCases,
  rayColor: rayCases,
  transect: transectCases,
  stat: statCases,
  rayScore: rayScoreCases
})

const outPath = resolve(here, "../app/src/test/resources/golden/core-golden.json")
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(golden, null, 1) + "\n", "utf8")

const counts = {
  "verdict.grades": golden.verdict.grades.length,
  "verdict.words": golden.verdict.words.length,
  "verdict.bands": golden.verdict.bands.length,
  pendingGroups: golden.pendingGroups,
  astro: golden.astro.length,
  sunEvents: golden.sunEvents.length,
  eventAzimuth: golden.eventAzimuth.length,
  sunAltRate: golden.sunAltRate.length,
  rayColor: golden.rayColor.length,
  transect: golden.transect.length,
  stat: golden.stat.length,
  rayScore: golden.rayScore.length
}
console.log("golden written:", outPath)
console.log(JSON.stringify(counts, null, 2))
