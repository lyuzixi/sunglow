package com.sunglow.spectrum.core

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/*
 * SUNGLOW · 基础常量与数学工具
 * 口径来源：v2/src/core/math.ts（V1 _p2.js 的逐语义移植）。
 * 数值必须与网页端逐位一致，禁止"顺手优化"。
 */

const val RE_KM: Double = 6371.0          // 地球平均半径 km
const val DEG: Double = PI / 180.0
const val RAD: Double = 180.0 / PI
const val RAY_OD550_V: Double = 0.0975    // 550nm 整层瑞利光学厚度
const val H_RAY: Double = 8.0             // 瑞利散射标高 km
const val ANGSTROM: Double = 1.3          // 气溶胶 Ångström 波长指数
const val K_TH: Double = 0.02             // 550nm 气溶胶消光系数阈值 km^-1

fun clamp(v: Double, a: Double, b: Double): Double = if (v < a) a else if (v > b) b else v
fun clamp01(v: Double): Double = clamp(v, 0.0, 1.0)
fun lerp(a: Double, b: Double, t: Double): Double = a + (b - a) * t

/** 有限数值判定：与 TS 的 isNum 同义（null / NaN / ±Inf 都不算数） */
fun isNum(v: Double?): Boolean = v != null && v.isFinite()

/** 空值兜底：不是有效数值时取默认值 */
fun nz(v: Double?, d: Double): Double = if (isNum(v)) v!! else d

/** 梯形隶属函数：pts 必须按 x 升序 */
fun trap(x: Double?, pts: List<Pair<Double, Double>>): Double? {
    if (!isNum(x)) return null
    val v = x!!
    if (v <= pts[0].first) return pts[0].second
    for (i in 1 until pts.size) {
        if (v <= pts[i].first) {
            val (x0, y0) = pts[i - 1]
            val (x1, y1) = pts[i]
            return if (x1 == x0) y1 else lerp(y0, y1, (v - x0) / (x1 - x0))
        }
    }
    return pts[pts.size - 1].second
}

fun logistic(x: Double): Double = 1.0 / (1.0 + exp(-x))

/** 加权几何平均（一票否决特性）：任一因子接近 0 会把总分压下去 */
const val FLOOR_F: Double = 0.02

fun wgeo(items: List<Pair<Double?, Double>>): Double {
    var e = 0.0
    var s = 0.0
    for ((v, w) in items) {
        if (!isNum(v)) continue
        s += w
        e += w * ln(max(v!!, FLOOR_F))
    }
    return if (s > 0) exp(e / s) else 0.0
}

/* ---- 日期工具 ---- */

fun pad2(n: Int): String = n.toString().padStart(2, '0')

/** 时长的分钟数格式化：保留两位，四舍五入后进位 */
fun fmtHM(hoursFloat: Double?): String {
    if (!isNum(hoursFloat)) return "—"
    var h = kotlin.math.floor(hoursFloat!!).toInt()
    var m = kotlin.math.round((hoursFloat - h) * 60).toInt()
    if (m == 60) { h++; m = 0 }
    h = ((h % 24) + 24) % 24
    return pad2(h) + ":" + pad2(m)
}

/* ---- 球面距离 / 方位推点 ---- */

fun haversineKm(la1: Double, lo1: Double, la2: Double, lo2: Double): Double {
    val dLa = (la2 - la1) * DEG
    val dLo = (lo2 - lo1) * DEG
    val a = sin(dLa / 2).let { it * it } +
        cos(la1 * DEG) * cos(la2 * DEG) * sin(dLo / 2).let { it * it }
    return 2 * RE_KM * asin(min(1.0, sqrt(a)))
}

fun destPoint(lat: Double, lon: Double, azDeg: Double, distKm: Double): Pair<Double, Double> {
    val d = distKm / RE_KM
    val brg = azDeg * DEG
    val la1 = lat * DEG
    val lo1 = lon * DEG
    val la2 = asin(sin(la1) * cos(d) + cos(la1) * sin(d) * cos(brg))
    val lo2 = lo1 + atan2(
        sin(brg) * sin(d) * cos(la1),
        cos(d) - sin(la1) * sin(la2)
    )
    return (la2 * RAD) to (((lo2 * RAD + 540) % 360) - 180)
}

/** 角度归一化到 [-180, 180) */
fun wrap180(deg: Double): Double {
    var v = (deg + 180.0) % 360.0
    if (v < 0) v += 360.0
    return v - 180.0
}

/** 角度归一化到 [0, 360) */
fun wrap360(deg: Double): Double {
    var v = deg % 360.0
    if (v < 0) v += 360.0
    return v
}

internal fun approxEquals(a: Double?, b: Double?, eps: Double = 1e-6): Boolean {
    if (a == null || b == null) return a == null && b == null
    if (!a.isFinite() || !b.isFinite()) return a == b
    return abs(a - b) <= eps
}
