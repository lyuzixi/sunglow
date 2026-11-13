package com.sunglow.spectrum.core

import java.util.Calendar
import java.util.TimeZone
import kotlinx.serialization.Serializable
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/*
 * SUNGLOW · 天文计算
 * 口径来源：v2/src/core/astro.ts（V1 _p2.js / _p3.js）。
 * NOAA 低精度算法（~0.01°）—— 数值逐语义移植，禁止"顺手优化"。
 *
 * 时间参数统一用 Double（毫秒）：网页端用 JS number，二分求解会产出小数毫秒，
 * 用 Long 截断会与基准产生亚毫秒偏差。对外另提供 Long 重载方便调用。
 */

data class SolarPos(
    val altitude: Double,      // 度
    val azimuth: Double,       // 度，自正北顺时针
    val declination: Double,   // 度
    val hourAngle: Double      // 度
)

@Serializable
data class SunEvents(
    val noonMs: Double,
    val riseMs: Double?,
    val setMs: Double?,
    val polarDay: Boolean,
    val polarNight: Boolean
)

fun solarPosition(ms: Double, lat: Double, lon: Double): SolarPos {
    val jd = ms / 86400000.0 + 2440587.5
    val n = jd - 2451545.0
    val l = (280.46 + 0.9856474 * n) % 360.0
    val g = ((357.528 + 0.9856003 * n) % 360.0) * DEG
    val lam = (l + 1.915 * sin(g) + 0.02 * sin(2 * g)) * DEG
    val eps = (23.439 - 0.0000004 * n) * DEG
    val decl = asin(sin(eps) * sin(lam))
    val ra = atan2(cos(eps) * sin(lam), cos(lam))
    val gmst = (18.697374558 + 24.06570982441908 * n) % 24.0
    var h = gmst * 15 * DEG + lon * DEG - ra
    h = (((h + PI) % (2 * PI)) + 2 * PI) % (2 * PI) - PI
    val phi = lat * DEG
    val sinAlt = clamp(
        sin(phi) * sin(decl) + cos(phi) * cos(decl) * cos(h),
        -1.0, 1.0
    )
    val alt = asin(sinAlt)
    // 与 TS 的 `(cos(alt) * cos(phi) || 1e-9)` 同义：仅在恰好为 0 或 NaN 时替换分母
    val denom0 = cos(alt) * cos(phi)
    val denom = if (denom0 == 0.0 || denom0.isNaN()) 1e-9 else denom0
    var az = acos(clamp((sin(decl) - sinAlt * sin(phi)) / denom, -1.0, 1.0))
    if (h > 0) az = 2 * PI - az
    return SolarPos(
        altitude = alt * RAD,
        azimuth = az * RAD,
        declination = decl * RAD,
        hourAngle = h * RAD
    )
}

fun solarPosition(ms: Long, lat: Double, lon: Double): SolarPos =
    solarPosition(ms.toDouble(), lat, lon)

/** 当日太阳最高时刻（毫秒）：先 5 分钟粗扫，再 40 分钟梯度微调 */
fun solarNoonMs(dayMs: Long, lat: Double, lon: Double): Long {
    var best = dayMs
    var bestAlt = -999.0
    for (k in 0 until 288) {
        val t = dayMs + k * 5L * 60000L
        val a = solarPosition(t, lat, lon).altitude
        if (a > bestAlt) { bestAlt = a; best = t }
    }
    for (i in 0 until 24) {
        val a1 = solarPosition(best - 240000, lat, lon).altitude
        val a2 = solarPosition(best + 240000, lat, lon).altitude
        if (a2 > a1) best += 60000 else best -= 60000
    }
    return best
}

fun sunEvents(dayMs: Long, lat: Double, lon: Double): SunEvents {
    val noon = solarNoonMs(dayMs, lat, lon)
    val altNoon = solarPosition(noon, lat, lon).altitude
    val h0 = -0.833
    if (altNoon < h0) {
        return SunEvents(noon.toDouble(), null, null, polarDay = false, polarNight = true)
    }

    fun cross(dir: Int): Double? {
        var prev = altNoon
        for (k in 1..1440) {
            val tt = noon + dir * k * 60000L
            val a = solarPosition(tt, lat, lon).altitude
            if (prev >= h0 && a < h0) {
                var lo = (tt - dir * 60000L).toDouble()
                var hi = tt.toDouble()
                for (i in 0 until 40) {
                    val mid = (lo + hi) / 2
                    val am = solarPosition(mid, lat, lon).altitude
                    if (am < h0) hi = mid else lo = mid
                }
                return (lo + hi) / 2
            }
            prev = a
        }
        return null
    }

    val setMs = cross(1)
    val riseMs = cross(-1)
    return SunEvents(
        noonMs = noon.toDouble(),
        riseMs = riseMs,
        setMs = setMs,
        polarDay = riseMs == null || setMs == null,
        polarNight = false
    )
}

/** 太阳高度角变化率（度/分钟） */
fun sunAltRate(ms: Double, lat: Double, lon: Double): Double {
    val a1 = solarPosition(ms - 6 * 60000.0, lat, lon).altitude
    val a2 = solarPosition(ms + 6 * 60000.0, lat, lon).altitude
    val r = abs((a2 - a1) / 12)
    return if (r == 0.0) 0.2 else r
}

fun sunAltRate(ms: Long, lat: Double, lon: Double): Double = sunAltRate(ms.toDouble(), lat, lon)

/**
 * 当日朝/晚霞事件方位角（度，正北 0、顺时针）。
 * 与 V1 azimEventOf 同源：零取数纯天文，极昼/极夜用正午+12h 兜底。
 */
fun eventAzimuth(dateS: String, period: Period, lat: Double, lon: Double): Double? {
    val parts = dateS.split("-")
    if (parts.size != 3) return null
    val y = parts[0].toIntOrNull() ?: return null
    val m = parts[1].toIntOrNull() ?: return null
    val d = parts[2].toIntOrNull() ?: return null
    if (y <= 0 || m <= 0 || d <= 0) return null

    val ev = sunEvents(utcMillis(y, m, d), lat, lon)
    val base = if (period == Period.AM) ev.riseMs else ev.setMs
    val ms = base ?: (ev.noonMs + 12 * 3600000.0)
    val az = solarPosition(ms, lat, lon).azimuth
    return if (az.isFinite()) wrap360(az) else null
}

@Serializable
enum class Period { AM, PM }

/** UTC 零点毫秒（不依赖设备时区） */
fun utcMillis(year: Int, month: Int, day: Int): Long {
    val c = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
    c.clear()
    c.set(year, month - 1, day, 0, 0, 0)
    return c.timeInMillis
}

/** 8 方位词（方言无关的稳定下标：0=北，顺时针，45° 一档四舍五入） */
val DIR_WORDS: List<String> = listOf("北", "东北", "东", "东南", "南", "西南", "西", "西北")

fun dirIndex(brg: Double): Int = (wrap360(brg) / 45.0).roundToInt() % 8

fun dirWordOf(brg: Double): String = DIR_WORDS[dirIndex(brg)]
