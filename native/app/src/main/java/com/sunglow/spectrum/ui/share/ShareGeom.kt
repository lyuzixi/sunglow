package com.sunglow.spectrum.ui.share

data class CurveDomain(val start: Double, val end: Double, val useIndex: Boolean) {
    val middle: Double get() = (start + end) / 2.0
    fun spanRatio(values: List<Double>): Double {
        if (values.size < 2 || end <= start) return 0.0
        val raw = (values.maxOrNull() ?: 0.0) - (values.minOrNull() ?: 0.0)
        return if (useIndex) 1.0 / 1.12 else raw / (end - start)
    }
}

/** 首末样本占满绘图区，仅左右各留 6%；相同时间样本退化为索引轴。 */
fun curveDomainOf(values: List<Double>): CurveDomain {
    if (values.isEmpty()) return CurveDomain(0.0, 1.0, false)
    val lo = values.minOrNull() ?: 0.0
    val hi = values.maxOrNull() ?: lo
    val raw = hi - lo
    if (values.size > 1 && raw < 1e-9) {
        val last = (values.size - 1).toDouble().coerceAtLeast(1.0)
        return CurveDomain(-last * 0.06, last * 1.06, true)
    }
    val span = raw.coerceAtLeast(1.0)
    return CurveDomain(lo - span * 0.06, hi + span * 0.06, false)
}

/** 网页分享产物几何：像素值属于交付协议，不随设备 dp 改变。 */
object ShareGeom {
    const val CONCLUSION_W = 780
    const val CONCLUSION_H = 1024
    const val STORY_W = 1080
    const val STORY_H = 1920
    const val TREND_W = 780
    const val TREND_H = 680
    const val FIELD_W = 780
    const val FIELD_H = 660
    const val COMPOSE_W = 780

    fun dimensionsFor(kind: String): Pair<Int, Int> = when (kind.lowercase()) {
        "conclusion" -> CONCLUSION_W to CONCLUSION_H
        "story" -> STORY_W to STORY_H
        "trend" -> TREND_W to TREND_H
        "field", "map" -> FIELD_W to FIELD_H
        else -> error("unknown share card kind: $kind")
    }
}
