package com.sunglow.spectrum.core

import kotlin.math.roundToLong

data class BestWindow(
    val startMs: Double,
    val endMs: Double,
    val durationMin: Double,
    val fallback: Boolean
)

/**
 * 分享卡最佳窗口：优先用云边界/地球遮挡几何；几何以外的数据不能画出空白卡，
 * 回退到太阳事件 ± 光追持续时长（无有效时长时取 20 分钟）。
 */
fun bestWindowOf(r: ForecastResult): BestWindow {
    val exact = glowWindow(
        evMs = r.evMs,
        isAM = r.period == Period.AM,
        lat = r.city.lat,
        lon = r.city.lon,
        thNearDeg = r.sRT.geom.thNearDeg,
        thFarDeg = r.sRT.geom.thFarDeg
    )
    if (exact != null) {
        return BestWindow(exact.first, exact.second, (exact.second - exact.first) / 60000.0, false)
    }
    val duration = r.sRT.geom.dur.takeIf { it.isFinite() && it > 0.0 } ?: 20.0
    val half = duration * 30000.0
    return BestWindow(r.evMs - half, r.evMs + half, duration, true)
}

fun bestWindowLabel(r: ForecastResult): String {
    val w = bestWindowOf(r)
    return fmtClock(w.startMs, r.tz) + "–" + fmtClock(w.endMs, r.tz) +
        " · " + w.durationMin.roundToLong() + " min"
}
