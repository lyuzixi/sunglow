package com.sunglow.spectrum.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.roundToLong

/*
 * 编排层单测：不联网，用合成序列把「三套算法 → 综合 → 因素」整条流水线跑通。
 * 数值细节由 GoldenTest 对拍；这里只守结构性约束（概率区间、等级、因素条数）。
 */
class ForecastAssembleTest {

    private val lat = 39.9042
    private val lon = 116.4074
    private val city = City("北京市", lon, lat, "北京市")
    private val tz = TzInfo("Asia/Shanghai", 8 * 3600, false)

    private fun makeSeries(
        evT: Long,
        cLow: Double,
        cMid: Double,
        cHigh: Double,
        aod: Double? = null
    ): Series {
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
            "cape" to rows(100.0)
        )
        if (aod != null) raw["aerosol_optical_depth"] = rows(aod)
        return Series(raw, tz)
    }

    private fun runCase(
        cLow: Double,
        cMid: Double,
        cHigh: Double,
        aod: Double?
    ): ForecastResult {
        val events = sunEvents(utcMillis(2026, 11, 12), lat, lon)
        val evMs = events.setMs ?: error("北京 2026-11-12 应有日落时刻")
        val evAz = solarPosition(evMs, lat, lon).azimuth
        val omega = sunAltRate(evMs, lat, lon)
        val evT = evMs.roundToLong()
        val pts = transectPoints(city, evAz)

        val gfs = pts.map { makeSeries(evT, cLow, cMid, cHigh) }
        val ec = pts.map { makeSeries(evT, cLow, cMid, cHigh) }
        val aq = if (aod != null) pts.map { makeSeries(evT, cLow, cMid, cHigh, aod) } else null

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
            sG = gfs,
            sE = ec,
            sA = aq
        )
    }

    @Test
    fun clearSkyHasNoGlow() {
        val r = runCase(0.0, 0.0, 0.0, 0.15)
        assertTrue("无云时概率应被压到 10% 以下，实际 ${r.p}", r.p <= 10.0)
        assertTrue("无云时质量分应被压到 10 分以内，实际 ${r.q}", r.q <= 10.0)
        assertEquals(3, r.models.size)
        assertEquals(13, r.factorRows.size)
        assertEquals(13, facDisplayRows(r).size)
    }

    @Test
    fun highCloudDeckScoresHigher() {
        val clear = runCase(0.0, 0.0, 0.0, 0.15)
        val deck = runCase(5.0, 25.0, 62.0, 0.15)

        assertTrue("有高云幕时概率应更高", deck.p > clear.p)
        assertTrue("有高云幕时质量分应更高", deck.q > clear.q)
        assertTrue("等级必须在既定档位里", deck.grade in QUALITY_LABEL.keys)
        assertTrue("一致性必须在 0–100", deck.consist in 0.0..100.0)
        assertTrue("概率必须在 2–97", deck.p in 2.0..97.0)
        assertTrue("质量分必须在 0–100", deck.q in 0.0..100.0)
        assertEquals(false, deck.aodFallback)
        assertEquals(true, clear.aodFallback.not())
    }

    @Test
    fun missingAerosolIsFlagged() {
        val r = runCase(5.0, 25.0, 62.0, null)
        assertTrue("没有气溶胶数据时必须有兜底标记", r.aodFallback)
    }
}
