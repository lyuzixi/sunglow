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
        val pointKey = snap.entries[0].key ?: ""
        assertTrue("单点键要能命中网页 point cache：$pointKey",
            pointKey.startsWith("SUNGLOW.v2.point.v3.2026-11-12|pm@39.9,116.4"))
        val trendKey = snap.entries[1].key ?: ""
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
        println("PACK_LEN=${pack?.length ?: 0}")
    }

    @Test
    fun mapPackMatchesWebRowProtocol() {
        val r = sampleResult()
        val base = listOf(
            HeatCell(i = 0, j = 0, lat = 40.0, lon = 116.0, p = 55.0, q = 62.0, idx = 58.0,
                grade = "良好", type = "高层云", cover = 62.0, d = 120.0, occ = 30.0, ref = 40.0),
            HeatCell(i = 0, j = 1, lat = 40.0, lon = 116.1, p = 31.0, q = 44.0, idx = 37.0,
                grade = "一般", type = "高积云", cover = 35.0, d = 80.0, occ = 12.0, ref = 20.0),
            HeatCell(i = 1, j = 0, lat = 39.9, lon = 116.0, p = 12.0, q = 25.0, idx = 18.0,
                grade = "较差", type = "卷云", cover = 18.0, d = null, occ = 5.0, ref = 8.0)
        )
        val grid = HeatGrid(
            dateStr = "2026-11-12", period = Period.PM, n = 2,
            lat0 = 40.0, lon0 = 116.0, dLat = 0.1, dLon = 0.1,
            cells = base.mapIndexed { i, c ->
                c.copy(
                    covers = listOf(c.cover, c.cover * 0.8, c.cover * 0.6),
                    baseKm = 6.2,
                    aod = 0.15,
                    cld = c.cover,
                    t550 = 0.08,
                    color = "#ff8844",
                    dur = 22.0,
                    ensP = c.p,
                    gfsP = c.p - 3,
                    ecP = c.p + 2,
                    rtP = c.p - 1,
                    refP = c.p,
                    ensQ = c.q,
                    gfsQ = c.q - 4,
                    ecQ = c.q + 3,
                    rtQ = c.q,
                    refQ = c.q - 2,
                    refGap = i * 10.0
                )
            }
        )
        val pack = buildSnapshotPack(r, emptyList(), grid, gen = 1L)
        assertNotNull("含观测场的 pack 不应为空", pack)
        val snap = decodePack(pack)
        assertNotNull(snap)
        println("MAP_KEYS=${snap!!.entries.map { it.key }}")
        assertEquals("entries=${snap.entries.map { it.key }}", 2, snap.entries.size)
        val mapKey = snap.entries[1].key ?: ""
        assertTrue("观测场键格式：$mapKey",
            mapKey == "SUNGLOW.v2.map.v9.2026-11-12@39.9,116.4")

        val cm = snap.entries[1].value["cm"]!!.jsonObject
        assertEquals(1, cm["m"]!!.jsonPrimitive.int)
        assertEquals("2026-11-12", cm["d"]!!.jsonPrimitive.content)
        assertEquals(0, cm["na"]!!.jsonPrimitive.int)
        assertEquals(1, cm["ds"]!!.jsonPrimitive.int)
        val rows = cm["r"]!!.jsonArray
        assertEquals(3, rows.size)
        assertEquals(32, rows[0].jsonArray.size)
        assertEquals(40, rows[0].jsonArray[2].jsonPrimitive.int / 100)
        assertEquals(62, rows[0].jsonArray[20].jsonPrimitive.int)
        assertEquals(15, rows[0].jsonArray[23].jsonPrimitive.int)
        assertEquals(0, rows[0].jsonArray[25].jsonPrimitive.int)
        assertEquals(255, rows[2].jsonArray[21].jsonPrimitive.int)
        val s = cm["s"]!!.jsonArray
        assertEquals("高层云", s[rows[0].jsonArray[30].jsonPrimitive.int].jsonPrimitive.content)
        assertEquals("#ff8844", s[rows[0].jsonArray[31].jsonPrimitive.int].jsonPrimitive.content)
    }

    @Test
    fun fullGridStaysUnderPackLimit() {
        val r = sampleResult()
        val cells = (0 until 121).map { k ->
            HeatCell(
                i = k / 11, j = k % 11,
                lat = 40.0 - (k / 11) * 0.1, lon = 116.0 + (k % 11) * 0.1,
                p = 20.0 + (k % 60), q = 15.0 + (k % 70), idx = 30.0,
                grade = "一般", type = "高层云", cover = 40.0, d = 100.0,
                covers = listOf(40.0, 30.0, 20.0), baseKm = 6.0, aod = 0.2,
                cld = 40.0, t550 = 0.1, color = "#ff8844", dur = 20.0,
                ensP = 50.0, gfsP = 48.0, ecP = 52.0, rtP = 49.0, refP = 50.0,
                ensQ = 55.0, gfsQ = 52.0, ecQ = 58.0, rtQ = 54.0, refQ = 53.0
            )
        }
        val grid = HeatGrid(
            dateStr = "2026-11-12", period = Period.PM, n = 11,
            lat0 = 40.0, lon0 = 116.0, dLat = 0.1, dLon = 0.1, cells = cells
        )
        val pack = buildSnapshotPack(r, emptyList(), grid, gen = 1L)
        assertNotNull("121 点观测场应能在 7,600 字符内打包", pack)
        assertTrue("pack 长度 ${pack?.length} 应 ≤ 7600", (pack?.length ?: Int.MAX_VALUE) <= 7600)
        val snap = decodePack(pack)
        assertEquals("entries=${snap!!.entries.map { it.key }}", 2, snap.entries.size)
        val cm = snap.entries[1].value["cm"]!!.jsonObject
        val n = cm["r"]!!.jsonArray.size
        assertTrue("抽稀后应为 121/61/41 点，实际 $n", n in listOf(121, 61, 41))
        assertEquals(32, cm["r"]!!.jsonArray[0].jsonArray.size)
        println("FULL_MAP_PACK_LEN=${pack?.length ?: 0} ROWS=$n STRIDE=${cm["ds"]}")
        println("MAP_PACK_SAMPLE=$pack")
    }
}
