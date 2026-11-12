package com.sunglow.spectrum.core

/*
 * 天色带（与网页 core/skyband.ts 同口径）
 * 五段曙暮光按太阳高度角 0 / -6 / -12 / -18 / -20° 的真实时刻分段，
 * 段宽即该段真实时长；霞光窗口 = 云边界 θnear → 地球遮挡 θfar。
 */

data class SkySegment(val key: String, val weight: Float, val title: String)

data class SkyMark(
    val pct: Float,
    val name: String,
    val time: String,
    /** -1 左对齐 / 0 居中 / 1 右对齐 */
    val align: Int
)

data class SkyBandData(
    val segments: List<SkySegment>,
    val winLeft: Float,
    val winWidth: Float,
    val marks: List<SkyMark>,
    val nowPct: Float?,
    val nowText: String,
    val startMs: Double,
    val endMs: Double
)

fun skyBandOf(r: ForecastResult, nowMs: Double, dateStr: String): SkyBandData? {
    val isAM = r.period == Period.AM
    val dir = if (isAM) -1.0 else 1.0
    val evMs = r.evMs

    fun alt(ms: Double): Double = solarPosition(ms, r.city.lat, r.city.lon).altitude

    fun cross(target: Double, d: Double): Double? {
        var lo = evMs
        var hi = evMs + d * 6 * 3600000.0
        fun f(ms: Double): Double = alt(ms) - target
        if (f(lo) * f(hi) > 0) return null
        repeat(44) {
            val mid = (lo + hi) / 2
            if (f(mid) * f(lo) > 0) lo = mid else hi = mid
        }
        return (lo + hi) / 2
    }

    val tEdge = cross(2.0, -dir) ?: return null
    val t6 = cross(-6.0, dir) ?: return null
    val t12 = cross(-12.0, dir) ?: return null
    val t18 = cross(-18.0, dir) ?: return null
    val t20 = cross(-20.0, dir) ?: return null

    val tStart = minOf(tEdge, t20)
    val tEnd = maxOf(tEdge, t20)
    val span = tEnd - tStart
    if (span <= 60000.0) return null

    fun seg(key: String, a: Double, b: Double, title: String): SkySegment {
        val minutes = (b - a) / 60000.0
        return SkySegment(key, maxOf(0.01f, minutes.toFloat()), title)
    }

    val segments = if (isAM) listOf(
        seg("night", tStart, t18, "夜间"),
        seg("astro", t18, t12, "天文曙暮光"),
        seg("naut", t12, t6, "航海曙暮光"),
        seg("civil", t6, evMs, "民用曙暮光"),
        seg("day", evMs, tEnd, "白昼余晖")
    ) else listOf(
        seg("day", tStart, evMs, "白昼余晖"),
        seg("civil", evMs, t6, "民用曙暮光"),
        seg("naut", t6, t12, "航海曙暮光"),
        seg("astro", t12, t18, "天文曙暮光"),
        seg("night", t18, tEnd, "夜间")
    )

    var winLeft = 0f
    var winWidth = 0f
    val geom = r.sRT.geom
    if (geom.ok && geom.thNearDeg.isFinite() && geom.thFarDeg.isFinite()) {
        val a = cross(-geom.thNearDeg, dir)
        val b = cross(-geom.thFarDeg, dir)
        if (a != null && b != null) {
            val ws = maxOf(tStart, minOf(a, b))
            val we = minOf(tEnd, maxOf(a, b))
            if (we > ws) {
                winLeft = ((ws - tStart) / span).toFloat()
                winWidth = ((we - ws) / span).toFloat()
            }
        }
    }

    fun pct(ms: Double): Float = ((ms - tStart) / span).toFloat()

    val today = todayInTz(r.tz)
    val nowIn = dateStr == today && nowMs >= tStart && nowMs <= tEnd

    val marks = listOf(
        SkyMark(pct(evMs), if (isAM) "日出" else "日落", fmtClock(evMs, r.tz), -1),
        SkyMark(pct(t6), if (isAM) "渐亮" else "渐暗", fmtClock(t6, r.tz), 0),
        SkyMark(pct(t12), if (isAM) "淡蓝" else "深蓝", fmtClock(t12, r.tz), 0),
        SkyMark(pct(t18), if (isAM) "天亮" else "天黑", fmtClock(t18, r.tz), 1)
    )

    return SkyBandData(
        segments = segments,
        winLeft = winLeft,
        winWidth = winWidth,
        marks = marks,
        nowPct = if (nowIn) pct(nowMs) else null,
        nowText = if (nowIn) fmtClock(nowMs, r.tz) else "",
        startMs = tStart,
        endMs = tEnd
    )
}
