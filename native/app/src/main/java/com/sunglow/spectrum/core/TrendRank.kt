package com.sunglow.spectrum.core

import java.time.Instant
import java.time.ZoneOffset
import java.util.Locale

/*
 * SUNGLOW · 趋势最佳窗口排序（N2 · 与网页 v2/src/components/TrendSection.vue 同口径）
 * 网页 computed best：跨朝/晚展开后按质量分 Q 降序，Q 相同再按出现概率 P 降序，取前三。
 * 放在 core 层是为了让纯 JVM 单测能断言排序，不依赖 Compose / Android。
 */

const val TREND_WINDOW_COUNT = 10
const val TREND_CACHE_TTL_MS = 6L * 3600L * 1000L
const val TREND_CACHE_PREFIX = "SUNGLOW.v2.trend."

data class TrendWindow(
    val date: String,
    val periodAm: Boolean,
    val p: Double,
    val q: Double,
    val grade: String
)

fun rankWindows(windows: List<TrendWindow>): List<TrendWindow> =
    windows.sortedWith(compareByDescending<TrendWindow> { it.q }.thenByDescending { it.p }).take(3)

/** 与 v2/src/core/trend.ts 的 trendKeyOf 同口径：UTC 日期 + 一位小数坐标 */
fun trendCacheKeyOf(day0: Long, lat: Double, lon: Double): String {
    val d = Instant.ofEpochMilli(day0).atZone(ZoneOffset.UTC)
    val ymd = String.format(Locale.US, "%04d-%02d-%02d", d.year, d.monthValue, d.dayOfMonth)
    return TREND_CACHE_PREFIX + ymd + "@" +
        String.format(Locale.US, "%.1f", lat) + "," +
        String.format(Locale.US, "%.1f", lon)
}
