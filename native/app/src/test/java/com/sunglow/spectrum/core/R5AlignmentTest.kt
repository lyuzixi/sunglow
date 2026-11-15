package com.sunglow.spectrum.core

import com.sunglow.spectrum.ui.AppPage
import com.sunglow.spectrum.ui.share.ShareGeom
import com.sunglow.spectrum.ui.share.curveDomainOf
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.roundToLong

class R5AlignmentTest {
    private val city = City("北京市", 116.4074, 39.9042, "北京市")
    private val tz = TzInfo("Asia/Shanghai", 8 * 3600, false)

    @After fun resetDisplayPrefs() {
        DisplayPrefs.imperial = false
        DisplayPrefs.hour12 = false
        DisplayPrefs.photoMode = 2
    }

    private fun result(): ForecastResult {
        val events = sunEvents(java.time.Instant.parse("2026-11-12T00:00:00Z").toEpochMilli(), city.lat, city.lon)
        val evMs = events.setMs!!
        val evT = evMs.roundToLong()
        fun series(): Series {
            fun rows(v: Double?) = listOf(
                SeriesRow((evT - 7200000L).toDouble(), v),
                SeriesRow((evT + 7200000L).toDouble(), v)
            )
            return Series(linkedMapOf(
                "temperature_2m" to rows(20.0), "dew_point_2m" to rows(10.0),
                "relative_humidity_2m" to rows(60.0), "cloud_cover_low" to rows(5.0),
                "cloud_cover_mid" to rows(25.0), "cloud_cover_high" to rows(62.0),
                "visibility" to rows(20000.0), "pressure_msl" to rows(1012.0),
                "wind_speed_10m" to rows(4.0), "wind_direction_10m" to rows(90.0),
                "freezing_level_height" to rows(3000.0), "boundary_layer_height" to rows(1200.0),
                "precipitation" to rows(0.0), "cape" to rows(100.0),
                "aerosol_optical_depth" to rows(0.15)
            ), tz)
        }
        val evAz = solarPosition(evMs, city.lat, city.lon).azimuth
        val pts = transectPoints(city, evAz)
        return assembleForecast(
            city, "2026-11-12", Period.PM, tz, events, evMs, evAz,
            sunAltRate(evMs, city.lat, city.lon), 8.0,
            pts.map { series() }, pts.map { series() }, pts.map { series() }
        )
    }

    private fun cell(p: Double, q: Double, gfs: Double? = null, ec: Double? = null) = HeatCell(
        0, 0, city.lat, city.lon, p, q, 0.55 * p + 0.45 * q, "you", "卷云", 40.0, 100.0,
        ensP = p, gfsP = gfs, ecP = ec, rtP = p - 4,
        ensQ = q, gfsQ = gfs?.let { it - 2 }, ecQ = ec?.let { it - 2 }, rtQ = q - 4
    )

    private fun heat(): HeatGrid {
        val cells = (0 until 121).map { k ->
            val p = 10.0 + (k * 37 % 85)
            val q = 8.0 + (k * 29 % 80)
            cell(p, q, p - 3, p - 5).copy(i = k / 11, j = k % 11)
        }
        return HeatGrid("2026-11-12", Period.PM, 11, city.lat + 0.5, city.lon - 0.5, 0.1, 0.1, cells)
    }

    @Test fun conclusionDimensions() = assertEquals(780 to 1024, ShareGeom.dimensionsFor("conclusion"))
    @Test fun storyDimensions() = assertEquals(1080 to 1920, ShareGeom.dimensionsFor("story"))
    @Test fun trendDimensions() = assertEquals(780 to 680, ShareGeom.dimensionsFor("trend"))
    @Test fun fieldDimensions() = assertEquals(780 to 660, ShareGeom.dimensionsFor("field"))

    @Test fun curvePositiveSpan() {
        val values = listOf(2.0, 4.0, 9.0)
        assertTrue(curveDomainOf(values).spanRatio(values) >= 0.80)
    }
    @Test fun curveNegativeSpan() {
        val values = listOf(-12.0, -7.0, -1.0)
        val d = curveDomainOf(values)
        assertTrue(d.start < -12.0 && d.end > -1.0)
        assertTrue(d.spanRatio(values) >= 0.80)
    }
    @Test fun curveDegenerateUsesIndex() {
        val values = listOf(3.0, 3.0, 3.0)
        val d = curveDomainOf(values)
        assertTrue(d.useIndex)
        assertTrue(d.spanRatio(values) >= 0.80)
    }
    @Test fun curveMiddleIsCentered() {
        val d = curveDomainOf(listOf(0.0, 10.0))
        assertEquals((d.start + d.end) / 2, d.middle, 1e-9)
    }

    @Test fun mapEnsUsesEnsComponents() {
        val c = cell(70.0, 60.0, 50.0, 40.0)
        assertEquals(70.0, heatPOf(c, ModelSel.ENS), 1e-9)
        assertEquals(60.0, heatQOf(c, ModelSel.ENS), 1e-9)
    }
    @Test fun mapGfsUsesGfsComponents() {
        val c = cell(70.0, 60.0, 50.0, 40.0)
        assertEquals(50.0, heatPOf(c, ModelSel.GFS), 1e-9)
        assertEquals(48.0, heatQOf(c, ModelSel.GFS), 1e-9)
    }
    @Test fun mapMissingGfsFallsBack() {
        val c = cell(70.0, 60.0, null, 40.0)
        assertEquals(70.0, heatPOf(c, ModelSel.GFS), 1e-9)
    }
    @Test fun mapEcUsesEcComponents() {
        val c = cell(70.0, 60.0, 50.0, 40.0)
        assertEquals(40.0, heatPOf(c, ModelSel.EC), 1e-9)
        assertEquals(38.0, heatQOf(c, ModelSel.EC), 1e-9)
    }
    @Test fun mapRtUsesRtComponents() {
        val c = cell(70.0, 60.0, 50.0, 40.0)
        assertEquals(66.0, heatPOf(c, ModelSel.RT), 1e-9)
        assertEquals(56.0, heatQOf(c, ModelSel.RT), 1e-9)
    }
    @Test fun mapMixFormula() {
        val c = cell(70.0, 60.0, 50.0, 40.0)
        assertEquals(65.5, heatValueOf(c, "mix", ModelSel.ENS), 1e-9)
    }
    @Test fun topFourSorted() {
        val top = topHeatCells(heat(), ModelSel.ENS, 4)
        assertEquals(4, top.size)
        assertTrue(top.zipWithNext().all { (a, b) -> heatValueOf(a, "mix", ModelSel.ENS) >= heatValueOf(b, "mix", ModelSel.ENS) })
    }
    @Test fun topLimitZero() = assertTrue(topHeatCells(heat(), limit = 0).isEmpty())

    @Test fun menuHasElevenPages() = assertEquals(11, AppPage.menuPages.size)
    @Test fun destinationCountIsSixteen() = assertEquals(16, 3 + 1 + AppPage.menuPages.size + 1)
    @Test fun snapshotIsNotInOrdinaryMenu() = assertFalse(AppPage.menuPages.any { it.name == "Snapshot" })
    @Test fun menuDestinationsAreUnique() = assertEquals(AppPage.menuPages.size, AppPage.menuPages.distinct().size)

    @Test fun bestWindowIsFinite() {
        val w = bestWindowOf(result())
        assertTrue(w.startMs.isFinite() && w.endMs.isFinite())
        assertTrue(w.endMs > w.startMs)
        assertTrue(w.durationMin > 0)
    }
    @Test fun bestWindowFallsBackToTwentyMinutes() {
        val r = result()
        val broken = r.copy(sRT = r.sRT.copy(geom = r.sRT.geom.copy(
            ok = false, thNearDeg = Double.NaN, thFarDeg = Double.NaN, dur = Double.NaN
        )))
        val w = bestWindowOf(broken)
        assertTrue(w.fallback)
        assertEquals(20.0, w.durationMin, 1e-9)
        assertEquals(20.0, (w.endMs - w.startMs) / 60000.0, 1e-9)
    }
    @Test fun bestWindowLabelNeverDash() {
        val label = bestWindowLabel(result())
        assertTrue(label.contains("–"))
        assertFalse(label.contains("—"))
    }

    @Test fun qrPackNeverExceedsThreshold() {
        val r = result()
        val url = qrShareUrlOf(r)
        val pack = packShareUrlOf(r)
        if (pack != null && pack.length <= 1800) assertEquals(pack, url)
        else assertFalse(url.contains("pack="))
    }
    @Test fun qrFallsBackWhenFullPackIsLong() {
        val r = result()
        val trend = (0 until 20).map { WebTrendRow("2026-11-${(it % 9 + 12).toString().padStart(2, '0')}", if (it % 2 == 0) "am" else "pm", 60.0, 70.0, "you") }
        val full = packShareUrlOf(r, trend, heat())
        val qr = qrShareUrlOf(r, trend, heat())
        assertNotNull(qr)
        if (full == null || full.length > 1800) {
            assertFalse(qr.contains("pack="))
            assertTrue(qr.length < 300)
        } else assertEquals(full, qr)
    }

    @Test fun displayPrefsDriveImperialUnits() {
        DisplayPrefs.imperial = true
        assertEquals("60.8 °F", uTemp(16.0))
        assertEquals("7.6 mi", uDist(12.3))
    }
    @Test fun displayPrefsDriveHour12() {
        DisplayPrefs.hour12 = true
        assertEquals("12:00 AM", uClock(0.0, offsetSeconds = 0))
    }
}
