package com.sunglow.spectrum.core

import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale

/*
 * SUNGLOW · 单位与时间显示（N1 补齐网页 v2/src/core/units.ts 的缺口）
 *
 * uDist / uAlt / uSpeed 早已存在于 Factors.kt，本轮给它们加了 imperial 默认参数，
 * 这里只补网页有、App 原先没有的 uTemp / uClock，避免同包重复定义。
 * 带 tz 的墙钟语义沿用 Tz.kt 的 fmtClock；这里额外支持 12 小时制。
 */

fun uTemp(c: Double?, imperial: Boolean = false): String {
    if (c == null || c.isNaN() || c.isInfinite()) return "—"
    return if (imperial) {
        String.format(Locale.US, "%.1f", c * 1.8 + 32.0) + " °F"
    } else {
        String.format(Locale.US, "%.1f", c) + " °C"
    }
}

/**
 * 时刻显示。offsetSeconds 为城市真实 UTC 偏移（秒）时按城市墙钟，
 * 否则退回设备本地时区（与网页「不传 tz 用浏览器本地时区」一致）。
 */
fun uClock(ms: Double?, hour12: Boolean = false, offsetSeconds: Int? = null): String {
    if (ms == null || ms.isNaN() || ms.isInfinite()) return "—"
    val zone: ZoneId = if (offsetSeconds != null) {
        ZoneOffset.ofTotalSeconds(offsetSeconds)
    } else {
        ZoneId.systemDefault()
    }
    val lt = Instant.ofEpochMilli(ms.toLong()).atZone(zone)
    return if (hour12) {
        val h = lt.hour % 12
        val hh = if (h == 0) 12 else h
        val ap = if (lt.hour < 12) "AM" else "PM"
        String.format(Locale.US, "%02d:%02d %s", hh, lt.minute, ap)
    } else {
        String.format(Locale.US, "%02d:%02d", lt.hour, lt.minute)
    }
}
