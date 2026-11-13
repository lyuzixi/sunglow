package com.sunglow.spectrum.core

import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sqrt

/*
 * SUNGLOW · 观测场插值与色阶（N3 · 与网页 v2/src/core/maprender.ts + ramp.ts 同口径）
 *
 * 场重建：自适应核 Shepard（modified Shepard, Franke–Little 1982）
 *   w_i = ((R − d_i)/(R·d_i))²，R = 第 9 近邻距离 × 1.06
 *   · 凸组合，不过冲；过点取真值；权重在 R 处连续降到 0。
 *   · 网页用空间索引 knearest 加速；这里直接全量排序取 9 近邻，
 *     已由 gen-b2-baselines.mjs 自检与 trendValueAt 等价（max delta 3.6e-14）。
 * 形态：8 锚点全光谱，低值不归零；无凸包硬裁切，靠 fadeOf 60→320km 淡到 0。
 */

const val FIELD_K_NEIGH = 9
const val FIELD_K_RADIUS_PAD = 1.06
const val FADE_NEAR_KM = 60.0
const val FADE_FAR_KM = 320.0
const val MAP_GRID_KM = 80
const val MAP_CACHE_TTL_MS = 6L * 3600L * 1000L
const val MAP_CACHE_MAX = 5
const val CITY_NEAR_KM = 60

val SPECTRUM_RAMP: List<String> = listOf(
    "#101a33", "#2b2352", "#7a2d6b", "#d13d6e",
    "#ff6a4d", "#ff9c3f", "#ffd76a", "#eafcff"
)

data class FieldPt(
    val lat: Double,
    val lon: Double,
    val v: Double?,
    val occ: Double? = null,
    val gap: Double? = null
)

data class FieldSample(
    val v: Double?,
    val occ: Double?,
    val gap: Double?,
    val near: Double
)

private fun finite(v: Double?): Boolean =
    v != null && !v.isNaN() && !v.isInfinite()

private fun clamp100(v: Double): Double = clamp(v, 0.0, 100.0)

/** 到最近采样点的距离衰减：60km 内满量，320km 外为 0，中间 smoothstep */
fun fadeOf(nearKm: Double): Double {
    if (nearKm <= FADE_NEAR_KM) return 1.0
    if (nearKm >= FADE_FAR_KM) return 0.0
    val t = (nearKm - FADE_NEAR_KM) / (FADE_FAR_KM - FADE_NEAR_KM)
    val s = 1.0 - t
    return s * s * (3.0 - 2.0 * s)
}

/** 0–100 取色（逐段 sRGB 线性插值），返回小写 #rrggbb，与 ramp.ts rampColor 一致 */
fun fieldRampColor(v: Double): String {
    val x = (clamp100(v) / 100.0) * (SPECTRUM_RAMP.size - 1)
    val i = floor(x).toInt().coerceIn(0, SPECTRUM_RAMP.size - 2)
    val f = x - i
    val a = hexRgb(SPECTRUM_RAMP[i])
    val b = hexRgb(SPECTRUM_RAMP[i + 1])
    fun to2(n: Double): String = Math.round(n).toInt().coerceIn(0, 255)
        .toString(16).padStart(2, '0')
    return "#" + to2(a[0] + (b[0] - a[0]) * f) +
        to2(a[1] + (b[1] - a[1]) * f) +
        to2(a[2] + (b[2] - a[2]) * f)
}

private fun hexRgb(hex: String): DoubleArray {
    val h = hex.removePrefix("#")
    return doubleArrayOf(
        h.substring(0, 2).toInt(16).toDouble(),
        h.substring(2, 4).toInt(16).toDouble(),
        h.substring(4, 6).toInt(16).toDouble()
    )
}

/** 与网页 makeSampler 相同的 km 投影：均值中心 + 111.32/110.574 */
class FieldSampler(points: List<FieldPt>) {
    private data class Node(val x: Double, val y: Double, val v: Double, val occ: Double, val gap: Double)

    private val nodes: List<Node>
    private val lat0: Double
    private val lon0: Double
    private val cosLat: Double

    init {
        val good = points.filter { finite(it.v) }
        lat0 = if (good.isEmpty()) 0.0 else good.map { it.lat }.average()
        lon0 = if (good.isEmpty()) 0.0 else good.map { it.lon }.average()
        cosLat = maxOf(0.2, cos(lat0 * Math.PI / 180.0))
        nodes = good.map {
            Node(
                x = (it.lon - lon0) * 111.32 * cosLat,
                y = (it.lat - lat0) * 110.574,
                v = clamp100(it.v!!),
                occ = if (finite(it.occ)) clamp100(it.occ!!) else Double.NaN,
                gap = if (finite(it.gap)) clamp100(it.gap!!) else Double.NaN
            )
        }
    }

    fun at(lat: Double, lon: Double): FieldSample {
        if (nodes.isEmpty()) return FieldSample(null, null, null, Double.POSITIVE_INFINITY)
        val x = (lon - lon0) * 111.32 * cosLat
        val y = (lat - lat0) * 110.574
        val near = nodes.mapIndexed { i, n ->
            val dx = n.x - x
            val dy = n.y - y
            Pair(sqrt(dx * dx + dy * dy), i)
        }.sortedBy { it.first }.take(FIELD_K_NEIGH)

        val first = near[0]
        if (first.first < 1e-6) {
            val n = nodes[first.second]
            return FieldSample(n.v, n.occ, n.gap, 0.0)
        }
        val r = near.last().first * FIELD_K_RADIUS_PAD
        val radius = if (r > 0.0) r else 1.0
        val w = DoubleArray(near.size) { k ->
            val d = near[k].first
            val t = radius - d
            if (t > 0.0) (t * t) / (radius * radius * d * d) else 0.0
        }
        var sw = w.sum()
        if (sw <= 0.0) {
            w[0] = 1.0
            sw = 1.0
        }
        fun blend(get: (Node) -> Double): Double? {
            var s = 0.0
            var acc = 0.0
            for (k in near.indices) {
                val value = get(nodes[near[k].second])
                if (value.isNaN() || value.isInfinite()) continue
                s += w[k]
                acc += w[k] * value
            }
            return if (s > 0.0) acc / s else null
        }
        return FieldSample(
            v = blend { it.v },
            occ = blend { it.occ },
            gap = blend { it.gap },
            near = first.first
        )
    }
}

/**
 * 留一法精度：Shepard 的 RMSE 必须明显低于最近邻基线，否则说明插值没带来信息。
 * 网页用 __gcCV() 断言 rmse < 0.75 × nnRmse，这里保持同一判据。
 */
fun looRmse(points: List<FieldPt>): Double {
    val good = points.filter { finite(it.v) }
    if (good.size < 3) return 0.0
    var sum = 0.0
    var n = 0
    for (i in good.indices) {
        val others = good.filterIndexed { k, _ -> k != i }
        val sampler = FieldSampler(others)
        val target = good[i]
        val pred = sampler.at(target.lat, target.lon).v ?: continue
        val err = clamp100(target.v!!) - pred
        sum += err * err
        n++
    }
    return if (n > 0) sqrt(sum / n) else 0.0
}

fun nnRmse(points: List<FieldPt>): Double {
    val good = points.filter { finite(it.v) }
    if (good.size < 3) return 0.0
    var sum = 0.0
    for (i in good.indices) {
        val target = good[i]
        var best = Double.POSITIVE_INFINITY
        var value = 0.0
        for (j in good.indices) {
            if (i == j) continue
            val dx = (good[j].lon - target.lon) * 111.32
            val dy = (good[j].lat - target.lat) * 110.574
            val d = sqrt(dx * dx + dy * dy)
            if (d < best) {
                best = d
                value = clamp100(good[j].v!!)
            }
        }
        val err = clamp100(target.v!!) - value
        sum += err * err
    }
    return sqrt(sum / good.size)
}
