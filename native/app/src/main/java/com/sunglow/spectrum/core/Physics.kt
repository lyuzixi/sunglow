package com.sunglow.spectrum.core

import kotlinx.serialization.Serializable
import kotlin.math.cbrt
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.round
import kotlin.math.sqrt
import kotlin.math.tan

/*
 * SUNGLOW · 物理模型
 * 口径来源：v2/src/core/physics.ts（V1 _p3.js）。
 * 气溶胶垂直分布 / 光学等效地表高度 / 光路消光积分 / CIE 色度 / 云层几何。
 *
 * 与网页版的差异（唯一一处，且已记录）：
 *   typeDetail() 在网页里直接拼多语言文案，属于表现层；原生端只返回结构化数据，
 *   文案在 UI 层组装。云型名仍以中文作为规范键（DECK_TYPE_SCORE 的既有口径）。
 */

/* ---- 气溶胶消光系数标高 ---- */
fun aerosolScaleHeight(blhM: Double?): Double {
    val km = if (isNum(blhM)) blhM!! / 1000.0 else 1.5
    return clamp(km * 0.75, 0.6, 4.0)
}

/* ---- 光学等效地表高度 ---- */
fun equivGroundHeight(aod: Double?, hsKm: Double, kth: Double = K_TH): Double {
    if (!isNum(aod) || aod!! <= 0 || !isNum(hsKm) || hsKm <= 0) return 0.0
    val z = hsKm * ln(aod / (hsKm * kth))
    return clamp(if (z.isFinite()) z else 0.0, 0.0, 14.0)
}

private fun sigmaRayleigh0(lam: Double): Double = (RAY_OD550_V / H_RAY) * (550.0 / lam).pow(4)
private fun sigmaAerosol0(aod: Double, hs: Double, lam: Double): Double =
    (aod / hs) * (550.0 / lam).pow(ANGSTROM)

private fun pathOpticalDepth(h: Double, th: Double, aod: Double, hs: Double, lam: Double): Double {
    val sR = sigmaRayleigh0(lam)
    val sA = sigmaAerosol0(aod, hs, lam)
    val t0 = tan(th)
    val n = 420
    val xmax = 1400.0
    val dx = xmax / n
    var tau = 0.0
    for (i in 0 until n) {
        val x = (i + 0.5) * dx
        var z = h + x * t0 + (x * x) / (2 * RE_KM)
        if (!(z > -50)) break
        if (z > 110) break
        if (z < 0) z = 0.0
        val dzdx = t0 + x / RE_KM
        val dl = sqrt(1 + dzdx * dzdx) * dx
        tau += (sR * exp(-z / H_RAY) + sA * exp(-z / hs)) * dl
    }
    return tau
}

/* ---- CIE 1931 色度函数（Wyman 多高斯解析近似） ---- */
private fun gauss(x: Double, mu: Double, s1: Double, s2: Double): Double =
    if (x < mu) exp(-0.5 * ((x - mu) / s1).pow(2)) else exp(-0.5 * ((x - mu) / s2).pow(2))

private fun cmfX(w: Double): Double =
    1.056 * gauss(w, 599.8, 37.9, 31.0) +
        0.362 * gauss(w, 442.0, 16.0, 26.7) -
        0.065 * gauss(w, 501.1, 20.4, 26.2)

private fun cmfY(w: Double): Double =
    0.821 * gauss(w, 568.8, 46.9, 40.5) + 0.286 * gauss(w, 530.9, 16.3, 31.1)

private fun cmfZ(w: Double): Double =
    1.217 * gauss(w, 437.0, 11.8, 36.0) + 0.681 * gauss(w, 459.0, 26.0, 13.8)

private fun sunSpectrum(lam: Double): Double {
    val c1 = 3.7418e-16
    val c2 = 1.4388e-2
    val l = lam * 1e-9
    return c1 / (l.pow(5) * (exp(c2 / (l * 5778.0)) - 1))
}

const val DIFF_AMP: Double = 0.06
const val DIFF_PATH: Double = 0.3
const val WASH_A: Double = 0.62
const val LUM_REF: Double = 0.06
const val AOD_SKY: Double = 0.55
const val CHROMA_REF: Double = 0.155

private val LUM_FULL: Double = run {
    var s = 0.0
    var lam = 400.0
    while (lam <= 700.0) {
        s += sunSpectrum(lam) * cmfY(lam)
        lam += 5
    }
    if (s == 0.0) 1.0 else s
}

@Serializable
data class RayColor(
    val tau550: Double,
    val t550: Double,
    val lumRel: Double,
    val wash: Double,
    val r: Int,
    val g: Int,
    val b: Int,
    val hex: String,
    val sat: Double,
    val hue: Double,
    val chroma: Double,
    val nameKey: String,
    val nameZh: String
)

fun rayTraceColor(h: Double, th: Double, aod: Double, hs: Double): RayColor {
    var x = 0.0
    var y = 0.0
    var z = 0.0
    var tau550 = 0.0
    var lumRaw = 0.0
    var lam = 400.0
    while (lam <= 700.0) {
        val tau = pathOpticalDepth(h, th, aod, hs, lam)
        val t = exp(-clamp(tau, 0.0, 60.0))
        val tSky = exp(-clamp(tau * DIFF_PATH, 0.0, 60.0))
        val s = sunSpectrum(lam)
        val w = s * (t + DIFF_AMP * tSky)
        x += w * cmfX(lam)
        y += w * cmfY(lam)
        z += w * cmfZ(lam)
        lumRaw += w * cmfY(lam)
        if (lam == 550.0) tau550 = tau
        lam += 5
    }
    var r = 3.2406 * x - 1.5372 * y - 0.4986 * z
    var g = -0.9689 * x + 1.8758 * y + 0.0415 * z
    var b = 0.0557 * x - 0.204 * y + 1.057 * z
    r = max(0.0, r); g = max(0.0, g); b = max(0.0, b)
    val mx = max(r, max(g, b)).takeIf { it != 0.0 } ?: 1e-12
    var nr = r / mx
    var ng = g / mx
    var nb = b / mx
    val lumRel = lumRaw / LUM_FULL
    val skyRel = clamp01(aod / AOD_SKY)
    val dimness = clamp01(1 - lumRel / LUM_REF)
    val wash = clamp01(WASH_A * (0.3 + 0.7 * skyRel) * (0.2 + 0.8 * dimness))
    val gray = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb
    nr = lerp(nr, gray, wash); ng = lerp(ng, gray, wash); nb = lerp(nb, gray, wash)

    fun to255(v: Double): Int = round(255 * clamp(v, 0.0, 1.0).pow(1 / 2.2)).toInt()
    val rr = to255(nr)
    val gg = to255(ng)
    val bb = to255(nb)
    val hex = "#" + listOf(rr, gg, bb).joinToString("") { it.toString(16).padStart(2, '0') }

    val mxx = max(nr, max(ng, nb))
    val mnn = min(nr, min(ng, nb))
    val dd = mxx - mnn
    var hue = 0.0
    if (dd > 1e-9) {
        hue = when (mxx) {
            nr -> 60 * (((ng - nb) / dd) % 6)
            ng -> 60 * ((nb - nr) / dd + 2)
            else -> 60 * ((nr - ng) / dd + 4)
        }
    }
    if (hue < 0) hue += 360
    val sat = if (mxx > 1e-9) dd / mxx else 0.0
    val chroma = oklabChroma(nr, ng, nb)
    val t550 = exp(-clamp(tau550, 0.0, 60.0))
    val nm = colorName(hue, sat, t550)
    return RayColor(
        tau550 = tau550,
        t550 = t550,
        lumRel = lumRel,
        wash = wash,
        r = rr,
        g = gg,
        b = bb,
        hex = hex,
        sat = sat,
        hue = hue,
        chroma = chroma,
        nameKey = nm.first,
        nameZh = nm.second
    )
}

fun oklabChroma(r: Double, g: Double, b: Double): Double {
    val l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    val m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    val s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    val a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    val b2 = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    return hypot(a, b2)
}

/** 色名：返回（稳定键, 中文名）。键用于多语言与基准比对。 */
fun colorName(hue: Double, sat: Double, t550: Double): Pair<String, String> {
    if (sat < 0.1) {
        return if (t550 < 0.004) "dull" to "灰暗无彩" else "hazy" to "灰白（大气浑浊）"
    }
    return when {
        hue < 12 -> "deepRed" to "深红 / 暗红"
        hue < 25 -> "red" to "红"
        hue < 36 -> "orangeRed" to "橘红"
        hue < 46 -> "orange" to "橙色"
        hue < 55 -> "golden" to "金黄 / 橘黄"
        hue < 68 -> "paleYellow" to "淡黄"
        hue >= 320 -> "pinkPurple" to "粉紫"
        else -> "yellowGreen" to "黄绿（少见）"
    }
}

/* ---- 云层识别 ---- */

@Serializable
data class Deck(
    val key: String,
    val level: Int,
    val nameZh: String,
    val base: Double,
    val cover: Double,
    val type: String,
    val typeScore: Double
)

val DECK_TYPE_SCORE: Map<String, Double> = mapOf(
    "层云/雾" to 0.12,
    "层积云" to 0.58,
    "积云" to 0.42,
    "高积云" to 0.86,
    "高层云" to 0.94,
    "卷层云" to 1.0,
    "卷云" to 0.95
)

private fun deckTypeName(level: Int, h: Double, cover: Double): String = when (level) {
    0 -> when {
        h < 0.35 -> "层云/雾"
        h < 2.0 -> "层积云"
        else -> "积云"
    }
    1 -> if (h < 4.2) "高积云" else "高层云"
    else -> if (cover >= 70) "卷层云" else "卷云"
}

data class EnvLike(
    val t: Double? = null,
    val td: Double? = null,
    val fz: Double? = null,
    val cLow: Double? = null,
    val cMid: Double? = null,
    val cHigh: Double? = null
)

fun cloudDecks(env: EnvLike): List<Deck> {
    val dT = if (isNum(env.t) && isNum(env.td)) max(0.0, env.t!! - env.td!!) else 3.0
    val lcl = clamp(0.125 * dT, 0.03, 4.0)
    val fz = if (isNum(env.fz)) clamp(env.fz!! / 1000.0, 0.2, 7.0) else null
    val hLow = clamp(lcl, 0.03, 2.5)
    val hMid = if (fz != null) clamp(0.55 * fz, 2.6, 6.0) else 3.6
    val hHigh = if (fz != null) clamp(1.65 * fz, 5.5, 12.0) else 8.5
    val raw = listOf(
        Triple("cLow", 0, hLow) to nz(env.cLow, 0.0),
        Triple("cMid", 1, hMid) to nz(env.cMid, 0.0),
        Triple("cHigh", 2, hHigh) to nz(env.cHigh, 0.0)
    )
    return raw.map { (meta, cover) ->
        val (key, level, base) = meta
        val type = deckTypeName(level, base, cover)
        Deck(
            key = key,
            level = level,
            nameZh = when (level) { 0 -> "低云"; 1 -> "中云"; else -> "高云" },
            base = base,
            cover = cover,
            type = type,
            typeScore = DECK_TYPE_SCORE[type] ?: 0.5
        )
    }
}

/**
 * 云型长格式：卷云（低云 0% / 中云 0% / 高云 48%）
 * 网页版在这里直接拼多语言文案；原生端只提供结构化拆分，由 UI 组装。
 */
data class DeckTypeDetail(val type: String, val covers: List<Double?>)

fun deckTypeDetail(type: String, covers: List<Double?>?): DeckTypeDetail =
    DeckTypeDetail(type = type, covers = covers?.takeIf { it.size >= 3 } ?: emptyList())

/* ---- 沿样带的云边界分析 ---- */

@Serializable
data class TransectPt(
    val d: Double,
    val cLow: Double? = null,
    val cMid: Double? = null,
    val cHigh: Double? = null,
    val aod: Double? = null,
    val vis: Double? = null
)

data class TransectResult(
    val ok: Boolean,
    val reason: String? = null,
    val dNear: Double? = null,
    val dFar: Double? = null,
    val openEnded: Boolean = false,
    val hasDeck: Boolean = false,
    val upstreamAod: Double? = null,
    val upstreamLowMax: Double? = null,
    val upstreamMidMax: Double? = null,
    val upstreamVisMin: Double? = null,
    val deckIdx: Pair<Int, Int>? = null
)

fun analyseTransect(transect: List<TransectPt>?, levelKey: String): TransectResult {
    if (transect.isNullOrEmpty()) {
        return TransectResult(ok = false, reason = "无样带数据", hasDeck = false)
    }
    fun cov(i: Int): Double = when (levelKey) {
        "cLow" -> nz(transect[i].cLow, 0.0)
        "cMid" -> nz(transect[i].cMid, 0.0)
        else -> nz(transect[i].cHigh, 0.0)
    }
    val th = 25.0
    val runs = mutableListOf<Pair<Int, Int>>()
    var i = 0
    while (i < transect.size) {
        if (cov(i) >= th) {
            var j = i
            while (j + 1 < transect.size && cov(j + 1) >= th) j++
            runs.add(i to j)
            i = j + 1
        } else i++
    }
    if (runs.isEmpty()) {
        return TransectResult(
            ok = false,
            reason = "日出/日落方向 400km 内无明显云盘",
            hasDeck = false
        )
    }
    var main = runs.firstOrNull { it.first == 0 } ?: runs.last()
    val step = if (transect.size > 1) transect[1].d - transect[0].d else 25.0
    val dNear = if (transect[main.first].d == 0.0) 0.0
    else max(0.0, transect[main.first].d - step / 2)
    val lastIdx = main.second
    val dFar = if (lastIdx == transect.size - 1) transect[lastIdx].d + step
    else transect[lastIdx].d + step / 2
    val openEnded = lastIdx == transect.size - 1

    var aSum = 0.0
    var aN = 0
    var lowMax = 0.0
    var midMax = 0.0
    var visMin = 1e9
    val reach = max(dFar, 120.0)
    for (p in transect) {
        if (p.d > reach) continue
        if (isNum(p.aod)) { aSum += p.aod!!; aN++ }
        lowMax = max(lowMax, nz(p.cLow, 0.0))
        midMax = max(midMax, nz(p.cMid, 0.0))
        val v = nz(p.vis, 1e9)
        if (v < visMin) visMin = v
    }
    return TransectResult(
        ok = true,
        dNear = dNear,
        dFar = dFar,
        openEnded = openEnded,
        hasDeck = true,
        upstreamAod = if (aN > 0) aSum / aN else null,
        upstreamLowMax = lowMax,
        upstreamMidMax = midMax,
        upstreamVisMin = if (visMin == 1e9) null else visMin,
        deckIdx = main
    )
}

/* ---- 火烧云三角几何 ---- */

@Serializable
data class FireGeom(
    val xMax: Double,
    val thFar: Double,
    val thNear: Double,
    val thFarDeg: Double,
    val thNearDeg: Double,
    val ok: Boolean,
    val dur: Double
)

fun fireGeometry(
    hEffKm: Double?,
    dFarKm: Double?,
    vKmin: Double,
    omegaDegMin: Double
): FireGeom {
    val h = hEffKm ?: 0.0
    val xMax = 2 * sqrt(2 * RE_KM * max(h, 0.0))
    val thFar = sqrt(max(0.0, 2 * h / RE_KM))
    val thNear = if (isNum(dFarKm)) dFarKm!! / (2 * RE_KM) else Double.POSITIVE_INFINITY
    val ok = isNum(hEffKm) && hEffKm!! > 0.05 && isNum(dFarKm) && thNear < thFar
    // 与 TS 的 `Math.abs(omegaDegMin) * DEG || 1` 同义：太阳不动时用 1 兜底
    val omega = (kotlin.math.abs(omegaDegMin) * DEG).takeIf { it != 0.0 } ?: 1.0
    val dur = if (ok) (thFar - thNear) / omega else 0.0
    return FireGeom(
        xMax = xMax,
        thFar = thFar,
        thNear = thNear,
        thFarDeg = thFar * RAD,
        thNearDeg = if (thNear.isFinite()) thNear * RAD else Double.POSITIVE_INFINITY,
        ok = ok,
        dur = dur
    )
}

/* ---- 云量淡纹：低云 + 中云×0.85 合成遮挡（0–100） ---- */
fun cloudBlockOf(cLow: Double?, cMid: Double?): Double {
    val a = if (isNum(cLow)) clamp(cLow!!, 0.0, 100.0) else 0.0
    val b = (if (isNum(cMid)) clamp(cMid!!, 0.0, 100.0) else 0.0) * 0.85
    return clamp(a + b - (a * b) / 100, 0.0, 100.0)
}

/* ---- 亮度分级 ---- */

@Serializable
data class BrightLevel(val txt: String, val score: Double)

fun brightnessLevel(t550: Double): BrightLevel = when {
    t550 >= 0.2 -> BrightLevel("极亮（可能过曝、色泽偏白）", 72.0)
    t550 >= 0.06 -> BrightLevel("明亮（最佳区间）", 100.0)
    t550 >= 0.02 -> BrightLevel("明亮偏弱（仍清晰可见）", 90.0)
    t550 >= 0.002 -> BrightLevel("较暗（闷烧）", 58.0)
    t550 >= 0.001 -> BrightLevel("很暗（观赏价值低）", 28.0)
    t550 >= 0.0002 -> BrightLevel("极暗（基本看不到）", 8.0)
    else -> BrightLevel("完全不可见", 0.0)
}
