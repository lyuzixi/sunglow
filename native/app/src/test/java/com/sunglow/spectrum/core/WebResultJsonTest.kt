package com.sunglow.spectrum.core

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.roundToLong

/*
 * R2-5 反向校验：用真实编排结果生成 App 侧 pack，
 * 再按网页 installSharePack 的规则解回来，确认键名与字段名不是「看起来像」。
 */
class WebResultJsonTest {

    private val lat = 39.9042
    private val lon = 116.4074
    private val city = City("北京市", lon, lat, "北京市")
    private val tz = TzInfo("Asia/Shanghai", 8 * 3600, false)

    private fun makeSeries(evT: Long, cLow: Double, cMid: Double, cHigh: Double): Series {
        fun rows(v: Double?): List<SeriesRow> = listOf(
            SeriesRow((evT - 2 * 3600000L).toDouble(), v),
            SeriesRow((evT + 2 * 3600000L).toDouble(), v)
        )
        val raw = linkedMapOf(
            "temperature_2m" to rows(20.0),
            "dew_point_2m" to rows(10.0),
            "relative_humidity_2m" to rows(60.0),
            "cloud_cover_low" to rows(cLow),
            "cloud_cover_mid" to rows(cMid),
            "cloud_cover_high" to rows(cHigh),
            "visibility" to rows(20000.0),
            "pressure_msl" to rows(1012.0),
            "wind_speed_10m" to rows(4.0),
            "wind_direction_10m" to rows(90.0),
            "freezing_level_height" to rows(3000.0),
            "boundary_layer_height" to rows(1200.0),
            "precipitation" to rows(0.0),
            "cape" to rows(100.0),
            "aerosol_optical_depth" to rows(0.15)
        )
        return Series(raw, tz)
    }

    private fun sampleResult(): ForecastResult {
        val events = sunEvents(utcMillis(2026, 11, 12), lat, lon)
        val evMs = events.setMs ?: error("北京 2026-11-12 应有日落时刻")
        val evAz = solarPosition(evMs, lat, lon).azimuth
        val omega = sunAltRate(evMs, lat, lon)
        val evT = evMs.roundToLong()
        val pts = transectPoints(city, evAz)
        return assembleForecast(
            city = city,
            dateStr = "2026-11-12",
            period = Period.PM,
            tz = tz,
            events = events,
            evMs = evMs,
            evAz = evAz,
            omega = omega,
            leadH = 8.0,
            sG = pts.map { makeSeries(evT, 5.0, 25.0, 62.0) },
            sE = pts.map { makeSeries(evT, 5.0, 25.0, 62.0) },
            sA = pts.map { makeSeries(evT, 5.0, 25.0, 62.0) }
        )
    }

    @Test
    fun packMatchesWebSchema() {
        val r = sampleResult()
        val trend = listOf(
            WebTrendRow("2026-11-12", "am", 41.0, 63.0, "良好"),
            WebTrendRow("2026-11-12", "pm", r.p, r.q, r.grade)
        )
        val pack = buildSnapshotPack(r, trend, gen = 1_700_000_000_000L)
        assertNotNull("pack 不应为空（长度超限会返回 null）", pack)
        val snap = decodePack(pack)
        assertNotNull("Kotlin 侧应能解回自己生成的 pack", snap)
        snap!!

        assertEquals(2, snap.entries.size)
        val pointKey = snap.entries[0].key
        assertTrue("单点键要能命中网页 point cache：$pointKey",
            pointKey.startsWith("SUNGLOW.v2.point.v3.2026-11-12|pm@39.9,116.4"))
        val trendKey = snap.entries[1].key
        assertTrue("趋势键要能命中网页 trend cache：$trendKey",
            trendKey == "SUNGLOW.v2.trend.2026-11-12@39.9,116.4")

        val obj = snap.entries[0].value["obj"]!!.jsonObject
        assertEquals(r.p, obj["P"]!!.jsonPrimitive.double, 1e-9)
        assertEquals(r.q, obj["Q"]!!.jsonPrimitive.double, 1e-9)
        assertEquals(r.grade, obj["grade"]!!.jsonPrimitive.content)
        assertTrue(obj["envM"] is JsonObject)
        assertEquals(20.0, obj["envM"]!!.jsonObject["T"]!!.jsonPrimitive.double, 1e-9)
        assertEquals(1012.0, obj["envM"]!!.jsonObject["Pmsl"]!!.jsonPrimitive.double, 1e-9)
        assertEquals(r.sRT.heq, obj["sRT"]!!.jsonObject["Heq"]!!.jsonPrimitive.double, 1e-9)
        assertEquals(13, obj["factorRows"]!!.jsonArray.size)
        assertEquals(3, obj["factorRows"]!!.jsonArray[0].jsonArray.size)
        assertTrue("网页 EnsBand 需要嵌套 dark",
            obj["conf"]!!.jsonObject["dark"] is JsonObject)
        assertEquals(62.0, obj["sRT"]!!.jsonObject["primary"]!!.jsonObject["cover"]!!.jsonPrimitive.double, 1e-9)
        assertEquals("live", obj["src"]!!.jsonPrimitive.content)

        val rows = snap.entries[1].value["rows"]!!.jsonArray
        assertEquals(2, rows.size)
        assertEquals("am", rows[0].jsonObject["period"]!!.jsonPrimitive.content)
        assertEquals("pm", rows[1].jsonObject["period"]!!.jsonPrimitive.content)
        assertEquals(r.p, rows[1].jsonObject["P"]!!.jsonPrimitive.double, 1e-9)

        /* CI 日志里捞这一行，交给网页 installSharePack 再验一次 */
        println("PACK_SAMPLE=$pack")
        println("PACK_LEN=${pack.length}")
    }
}
