package com.sunglow.spectrum.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

/*
 * N2 · 趋势口径回归
 * 常量与缓存键来自 b2-baselines.json（由 v2/src/core/trend.ts 实时生成）；
 * 最佳窗口排序规则对应 v2/src/components/TrendSection.vue 的 computed best：
 * 跨朝/晚展开后按 Q 降序，Q 相同按 P 降序，取前三。
 */
class TrendGoldenTest {

    private val baseline: JsonObject by lazy {
        val stream = javaClass.classLoader!!.getResourceAsStream("golden/b2-baselines.json")
            ?: error("缺少 golden/b2-baselines.json，请先运行 npx tsx native/tools/gen-b2-baselines.mjs")
        Json.parseToJsonElement(stream.bufferedReader().readText()).jsonObject
    }

    @Test
    fun constantsMatchWeb() {
        val c = baseline["constants"]!!.jsonObject["trend"]!!.jsonObject
        assertEquals(
            "TREND_N",
            c["TREND_N"]!!.jsonObject["value"]!!.jsonPrimitive.doubleOrNull!!.toInt(),
            TREND_WINDOW_COUNT
        )
        assertEquals(
            "TREND_CACHE_TTL",
            c["TREND_CACHE_TTL"]!!.jsonObject["value"]!!.jsonPrimitive.doubleOrNull!!.toLong(),
            TREND_CACHE_TTL_MS
        )
        assertEquals(
            "TREND_CACHE_PREFIX",
            c["TREND_CACHE_PREFIX"]!!.jsonObject["value"]!!.jsonPrimitive.content,
            TREND_CACHE_PREFIX
        )
    }

    @Test
    fun cacheKeysMatchWeb() {
        val cases = baseline["samples"]!!.jsonObject["trend"]!!.jsonArray
        for (el in cases) {
            val c = el.jsonObject
            val day0 = c["day0"]!!.jsonPrimitive.doubleOrNull!!.toLong()
            val lat = c["lat"]!!.jsonPrimitive.doubleOrNull!!
            val lon = c["lon"]!!.jsonPrimitive.doubleOrNull!!
            assertEquals(
                "trendCacheKeyOf($day0,$lat,$lon)",
                c["key"]!!.jsonPrimitive.content,
                trendCacheKeyOf(day0, lat, lon)
            )
        }
    }

    @Test
    fun bestWindowsRankByQualityThenProbability() {
        val rows = listOf(
            TrendWindow("2026-11-13", true, 20.0, 40.0, "一般"),
            TrendWindow("2026-11-14", false, 80.0, 72.0, "良"),
            TrendWindow("2026-11-15", true, 60.0, 72.0, "良"),
            TrendWindow("2026-11-16", false, 30.0, 65.0, "良"),
            TrendWindow("2026-11-17", true, 10.0, 30.0, "差")
        )
        val best = rankWindows(rows)
        assertEquals(3, best.size)
        /* Q 相同（72）时，P 高的 80% 排在 60% 前 */
        assertEquals("2026-11-14", best[0].date)
        assertEquals("2026-11-15", best[1].date)
        assertEquals("2026-11-16", best[2].date)
    }
}
