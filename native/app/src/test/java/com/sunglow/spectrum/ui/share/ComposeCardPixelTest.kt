package com.sunglow.spectrum.ui.share

import android.graphics.Bitmap
import com.sunglow.spectrum.core.City
import com.sunglow.spectrum.core.ForecastResult
import com.sunglow.spectrum.core.HeatCell
import com.sunglow.spectrum.core.HeatGrid
import com.sunglow.spectrum.core.ModelSel
import com.sunglow.spectrum.core.Period
import com.sunglow.spectrum.core.QUALITY_BANDS
import com.sunglow.spectrum.core.Series
import com.sunglow.spectrum.core.SeriesRow
import com.sunglow.spectrum.core.TzInfo
import com.sunglow.spectrum.core.assembleForecast
import com.sunglow.spectrum.core.solarPosition
import com.sunglow.spectrum.core.sunAltRate
import com.sunglow.spectrum.core.sunEvents
import com.sunglow.spectrum.core.transectPoints
import com.sunglow.spectrum.core.verdictViewOf
import com.sunglow.spectrum.ui.TrendCell
import com.sunglow.spectrum.ui.TrendRow
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.io.FileOutputStream
import java.util.Locale
import kotlin.math.roundToLong

/*
 * P0 像素卡回归基线
 *
 * 目的：在没有真机/模拟器的 CI 上，把合成卡真的画出来并逐张落盘。
 *   · 14 模块 × 简/繁/英 × 明/暗 = 84 张
 *   · 每张校验：宽度、高度公式、页脚存在、底部留白、右边缘无溢出
 *   · 模块图与「只有天色带」的基线做像素差，防止模块被勾选后其实什么都没画
 *
 * 输出：native/app/build/pixel-cards 下的 PNG + manifest.json
 * CI 会把整个目录挂成 artifact，人工抽查时直接看图。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "zh-rCN")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ComposeCardPixelTest {

    private val modules = listOf(
        "sky", "window", "qr", "trend", "map", "models",
        "facCloud", "facPath", "facAir", "facDyn",
        "rayRows", "raySwatch", "rayTime", "rayCurve"
    )

    private val lat = 39.9042
    private val lon = 116.4074
    private val city = City("北京市", lon, lat, "北京市")
    private val tz = TzInfo("Asia/Shanghai", 8 * 3600, false)

    @org.junit.Before
    fun setUp() {
        ComposeCard.testForceSans = true
    }

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

    private fun utcMillis(y: Int, m: Int, d: Int): Long =
        java.time.ZonedDateTime.of(y, m, d, 0, 0, 0, 0, java.time.ZoneOffset.UTC)
            .toInstant().toEpochMilli()

    private fun sampleTrend(): List<TrendRow> = (0 until 10).map { i ->
        val band = QUALITY_BANDS[i % QUALITY_BANDS.size]
        val p = 52.0 + i * 4.0
        val q = 45.0 + i * 5.0
        TrendRow(
            date = "2026-11-${(12 + i).coerceAtMost(28).toString().padStart(2, '0')}",
            am = TrendCell(p, q, band.key),
            pm = TrendCell((p - 6).coerceAtLeast(2.0), (q - 4).coerceAtLeast(0.0), band.key)
        )
    }

    private fun sampleHeat(): HeatGrid {
        val n = 13
        val dLat = 0.72
        val dLon = 0.78
        val lat0 = lat + dLat * (n - 1) / 2.0
        val lon0 = lon - dLon * (n - 1) / 2.0
        val cells = ArrayList<HeatCell>(n * n)
        for (i in 0 until n) {
            for (j in 0 until n) {
                val dx = j - (n - 1) / 2.0
                val dy = i - (n - 1) / 2.0
                val dist = kotlin.math.sqrt(dx * dx + dy * dy)
                val p = (86.0 - dist * 8.0).coerceIn(6.0, 92.0)
                val q = (78.0 - dist * 6.0).coerceIn(8.0, 88.0)
                val idx = 0.55 * p + 0.45 * q
                val band = QUALITY_BANDS.firstOrNull { idx >= it.min && idx <= it.max }
                    ?: QUALITY_BANDS.last()
                cells.add(
                    HeatCell(
                        i = i, j = j, lat = lat0 - i * dLat, lon = lon0 + j * dLon,
                        p = p, q = q, idx = idx, grade = band.key,
                        type = "卷云", cover = 35.0, d = 180.0
                    )
                )
            }
        }
        return HeatGrid("2026-11-12", Period.PM, n, lat0, lon0, dLat, dLon, cells)
    }

    private fun diffRatio(base: Bitmap, other: Bitmap): Double {
        val w = minOf(base.width, other.width)
        val h = minOf(base.height, other.height)
        val a = IntArray(w)
        val b = IntArray(w)
        var diff = 0L
        var total = 0L
        var y = 0
        while (y < h) {
            base.getPixels(a, 0, w, 0, y, w, 1)
            other.getPixels(b, 0, w, 0, y, w, 1)
            for (x in 0 until w step 3) {
                if (a[x] != b[x]) diff++
                total++
            }
            y += 4
        }
        return if (total == 0L) 0.0 else diff.toDouble() / total
    }

    private fun maxBlankBand(bmp: Bitmap, bg: Int): Int {
        val h = bmp.height
        val w = bmp.width
        val row = IntArray(w)
        var run = 0
        var worst = 0
        for (y in 850 until h - 130) {
            bmp.getPixels(row, 0, w, 0, y, w, 1)
            var blank = true
            for (x in 0 until w step 5) {
                if (row[x] != bg) {
                    blank = false
                    break
                }
            }
            run = if (blank) run + 1 else 0
            if (run > worst) worst = run
        }
        return worst
    }

    private fun footerPresent(bmp: Bitmap): Boolean {
        val bg = bmp.getPixel(4, bmp.height - 4)
        var inkPixels = 0
        val row = IntArray(bmp.width)
        for (y in bmp.height - 112 until bmp.height) {
            bmp.getPixels(row, 0, bmp.width, 0, y, bmp.width, 1)
            for (x in 0 until bmp.width step 4) {
                if (row[x] != bg) inkPixels++
            }
        }
        return inkPixels > 200
    }

    private fun assertCommon(name: String, bmp: Bitmap, mods: List<String>) {
        assertEquals("$name：宽度必须 1080", 1080, bmp.width)
        assertEquals("$name：高度必须与 heightFor 一致", ComposeCard.heightFor(mods), bmp.height)
        assertTrue("$name：页脚缺失", footerPresent(bmp))
        val bg = bmp.getPixel(4, bmp.height - 4)
        for (y in bmp.height - 10 until bmp.height) {
            for (x in 0 until bmp.width step 8) {
                assertEquals("$name：底部留白被占用 y=$y x=$x", bg, bmp.getPixel(x, y))
            }
        }
        val blank = maxBlankBand(bmp, bg)
        assertTrue("$name：模块之间出现 $blank px 空白带", blank <= 110)
        for (y in 930 until bmp.height - 130 step 6) {
            for (x in 1040 until bmp.width step 8) {
                assertEquals("$name：内容越过右边距 y=$y x=$x", bg, bmp.getPixel(x, y))
            }
        }
    }

    @Test
    fun rendersAllModulesInAllLocales() {
        val r = sampleResult()
        val view = verdictViewOf(r, ModelSel.ENS)
        val trend = sampleTrend()
        val heat = sampleHeat()

        val outDir = File(
            System.getProperty("sunglow.pixelDir") ?: "build/pixel-cards"
        ).apply { mkdirs() }

        val manifest = JSONObject()
        val cases = JSONArray()
        val locales = listOf("zh-rCN", "zh-rTW", "en")
        val baselines = HashMap<String, Bitmap>()

        for (q in locales) {
            RuntimeEnvironment.setQualifiers("+$q")
            Locale.setDefault(Locale.forLanguageTag(q.replace("-r", "-")))
            val localCtx = RuntimeEnvironment.getApplication()
            for (dark in listOf(false, true)) {
                val skyMods = listOf("sky")
                val sky = baselines.getOrPut("$q|$dark") {
                    ComposeCard.render(localCtx, r, view, dark, skyMods, trend, heat)
                }
                for (id in modules) {
                    val mods = if (id == "sky") listOf("sky") else listOf("sky", id)
                    val bmp = ComposeCard.render(localCtx, r, view, dark, mods, trend, heat)
                    val name = "${q}_${if (dark) "dark" else "light"}_$id"
                    assertCommon(name, bmp, mods)

                    val diff = if (id == "sky") 1.0 else diffRatio(sky, bmp)
                    assertTrue(
                        "$name：模块没有实际绘制（像素差 ${"%.4f".format(diff)}）",
                        diff >= 0.005
                    )

                    FileOutputStream(File(outDir, "$name.png")).use { out ->
                        bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
                    }
                    cases.put(
                        JSONObject()
                            .put("file", "$name.png")
                            .put("locale", q)
                            .put("dark", dark)
                            .put("modules", id)
                            .put("w", bmp.width)
                            .put("h", bmp.height)
                            .put("diffFromSky", String.format(Locale.US, "%.4f", diff))
                    )
                    bmp.recycle()
                }
            }
        }
        baselines.values.forEach { it.recycle() }

        manifest.put("generatedAt", java.time.Instant.now().toString())
        manifest.put("count", cases.length())
        manifest.put("cases", cases)
        File(outDir, "manifest.json").writeText(manifest.toString(2))
        assertTrue("应生成 84 张基线", cases.length() == 84)
    }

    @Test
    fun fullStackHasNoClippingOrGaps() {
        val r = sampleResult()
        val view = verdictViewOf(r, ModelSel.ENS)
        val trend = sampleTrend()
        val heat = sampleHeat()
        val ctx = RuntimeEnvironment.getApplication()
        val bmp = ComposeCard.render(
            ctx, r, view, false, modules, trend, heat
        )
        assertCommon("full-stack", bmp, modules)
        File("build/pixel-cards").mkdirs()
        FileOutputStream(File("build/pixel-cards/full-stack_zh-rCN_light.png")).use { out ->
            bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
        }
        bmp.recycle()
    }
}
