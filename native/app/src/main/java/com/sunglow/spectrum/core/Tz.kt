package com.sunglow.spectrum.core

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.util.Locale
import java.util.TimeZone
import kotlin.math.abs
import kotlin.math.roundToLong

/*
 * SUNGLOW · 城市时区
 * 口径来源：v2/src/core/tz.ts。
 * 时间轴统一存真实时间戳；只有显示的最后一刻才换算成城市墙钟。
 */

data class TzInfo(
    /** IANA 名，如 "Asia/Shanghai"；经度估算态为 null */
    val iana: String? = null,
    /** 参考时刻的 UTC 偏移（秒，东正） */
    val offsetSec: Int = 0,
    /** true = 经度估算，尚未被接口校准 */
    val est: Boolean = true
)

private val ISO_WITH_TZ = Regex("([Zz]|[+-]\\d{2}:?\\d{2})$")

/** 中国全境（含新疆、西藏）行政统一 UTC+8 —— 经度估算在这里必然偏差 2 小时以上 */
fun estimateOffsetSec(lat: Double, lon: Double): Int {
    if (lat >= 18.0 && lat <= 54.0 && lon >= 73.0 && lon <= 135.2) return 8 * 3600
    return clamp((lon / 15.0).roundToLong().toDouble(), -12.0, 14.0).toInt() * 3600
}

/**
 * 记住接口回来的实测偏移（按坐标 0.1° ≈ 11 km 归档）。
 * 网页端写在 localStorage；原生端先只放内存 —— 冷启动用经度估算，取数回来即校准。
 */
object TzCache {
    private val mem = HashMap<String, TzInfo>()

    private fun keyOf(lat: Double, lon: Double): String =
        String.format(Locale.US, "%.1f,%.1f", lat, lon)

    fun remembered(lat: Double, lon: Double): TzInfo? = mem[keyOf(lat, lon)]

    fun remember(lat: Double, lon: Double, tz: TzInfo) {
        // 真实时区偏移一定是 15 分钟的整数倍；不是就说明是算坏的脏值，丢掉
        if (abs(tz.offsetSec) > 14 * 3600 || tz.offsetSec % 900 != 0) return
        mem[keyOf(lat, lon)] = tz.copy(est = false)
    }

    /** 城市时区：记住的实测值 > 经度估算 */
    fun cityTz(lat: Double, lon: Double): TzInfo =
        remembered(lat, lon) ?: TzInfo(null, estimateOffsetSec(lat, lon), true)
}

/** 接口返回的是城市当地墙钟（无后缀）；转成真实时间戳 */
fun wallIsoToReal(iso: String, offsetSec: Int): Double {
    val s = iso.trim()
    if (ISO_WITH_TZ.containsMatchIn(s)) {
        return try {
            Instant.parse(s).toEpochMilli().toDouble()
        } catch (_: Exception) {
            Double.NaN
        }
    }
    val norm = if (s.length == 16) "$s:00" else s
    return try {
        LocalDateTime.parse(norm).toInstant(ZoneOffset.UTC).toEpochMilli().toDouble() - offsetSec * 1000.0
    } catch (_: Exception) {
        Double.NaN
    }
}

/** 真实时刻 → 城市墙钟的 HH:MM */
fun fmtClock(ms: Double?, tz: TzInfo?): String {
    if (ms == null || !ms.isFinite()) return "—"
    val off = tz?.offsetSec ?: 0
    val d = Instant.ofEpochMilli((ms + off * 1000L).toLong()).atZone(ZoneOffset.UTC)
    return pad2(d.hour) + ":" + pad2(d.minute)
}

/** 真实时刻 → 城市墙钟的 YYYY-MM-DD */
fun dateInTz(ms: Long, tz: TzInfo): String {
    val d = Instant.ofEpochMilli(ms + tz.offsetSec * 1000L).atZone(ZoneOffset.UTC)
    return d.year.toString().padStart(4, '0') + "-" + pad2(d.monthValue) + "-" + pad2(d.dayOfMonth)
}

/** 城市当地的「今天」 */
fun todayInTz(tz: TzInfo, nowMs: Long = System.currentTimeMillis()): String =
    dateInTz(nowMs, tz)

/** 日期字符串加减天数（纯日历运算，不碰时区） */
fun addDaysIso(iso: String, n: Int): String {
    val p = iso.split("-")
    if (p.size != 3) return iso
    val y = p[0].toIntOrNull() ?: return iso
    val m = p[1].toIntOrNull() ?: return iso
    val d = p[2].toIntOrNull() ?: return iso
    return dateInTz(utcMillis(y, m, d) + n * 86400000L, TzInfo(null, 0, false))
}

/** UTC+9 / UTC−4 / UTC+5:30（负号用真正的减号，避免和连字符混淆） */
fun tzLabel(tz: TzInfo): String {
    val off = (tz.offsetSec / 60.0).toInt()
    val sign = if (off < 0) "\u2212" else "+"
    val a = abs(off)
    val h = a / 60
    val m = a % 60
    return "UTC" + sign + h + (if (m != 0) ":" + pad2(m) else "")
}

/** 本机当前 UTC 偏移（秒，东正） */
fun deviceOffsetSec(nowMs: Long = System.currentTimeMillis()): Int =
    TimeZone.getDefault().getOffset(nowMs) / 1000

/** 城市时区是否与本机不同（差 30 分钟以上才算） */
fun isForeignTz(tz: TzInfo, nowMs: Long = System.currentTimeMillis()): Boolean =
    abs(tz.offsetSec - deviceOffsetSec(nowMs)) >= 1800
