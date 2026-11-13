package com.sunglow.spectrum.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.cos
import kotlin.math.sin

/*
 * N3 · 观测场插值与色阶回归
 * 基准：b2-baselines.json（由 v2/src/core/maprender.ts 的 trendValueAt / fieldProbeAt
 *       与 ramp.ts 的 rampColor / SPECTRUM_RAMP 实时生成）。
 * 点集必须与 native/tools/gen-b2-baselines.mjs 里的 fieldPts 完全一致。
 */
class FieldGoldenTest {

    private val baseline: JsonObject by lazy {
        val stream = javaClass.classLoader!!.getResourceAsStream("golden/b2-baselines.json")
            ?: error("缺少 golden/b2-baselines.json，请先运行 npx tsx native/tools/gen-b2-baselines.mjs")
        Json.parseToJsonElement(stream.bufferedReader().readText()).jsonObject
    }

    private fun d(o: JsonObject, k: String): Double = o[k]!!.jsonPrimitive.doubleOrNull!!

    /** 与生成器一致的 5×5 伪随机场 */
    private fun fieldPts(): List<FieldPt> = buildList {
        for (i in 0 until 5) {
            for (j in 0 until 5) {
                add(
                    FieldPt(
                        lat = 30.0 + i * 0.6,
                        lon = 110.0 + j * 0.6,
                        v = (20 + ((i * 37 + j * 19) % 75)).toDouble(),
                        occ = ((i * 13 + j * 7) % 90).toDouble(),
                        gap = ((i * 11 + j * 5) % 40).toDouble()
                    )
                )
            }
        }
    }

    @Test
    fun shepardMatchesWeb() {
        val sampler = FieldSampler(fieldPts())
        val cases = baseline["samples"]!!.jsonObject["field"]!!.jsonArray
        assertTrue("场基准为空", cases.isNotEmpty())
        for (el in cases) {
            val c = el.jsonObject
            val got = sampler.at(d(c, "lat"), d(c, "lon"))
            val wantEl = c["v"]
            if (wantEl is JsonNull) {
                assertNull("v 应为空", got.v)
            } else {
                val want = (wantEl as JsonPrimitive).doubleOrNull!!
                assertEquals("v@(${d(c, "lat")},${d(c, "lon")})", want, got.v!!, 1e-6)
                val probe = c["probe"]!!.jsonObject
                assertEquals("near@(${d(c, "lat")},${d(c, "lon")})", d(probe, "near"), got.near, 1e-6)
            }
        }
    }

    @Test
    fun spectrumRampMatchesWeb() {
        val cases = baseline["samples"]!!.jsonObject["ramp"]!!.jsonArray
        for (el in cases) {
            val c = el.jsonObject
            assertEquals(
                "rampColor(" + d(c, "v") + ")",
                c["hex"]!!.jsonPrimitive.content,
                fieldRampColor(d(c, "v"))
            )
        }
        val anchors = baseline["samples"]!!.jsonObject["rampAnchors"]!!.jsonArray
        assertEquals("锚点数", anchors.size, SPECTRUM_RAMP.size)
        anchors.forEachIndexed { i, el ->
            assertEquals("anchor[$i]", el.jsonPrimitive.content, SPECTRUM_RAMP[i])
        }
    }

    @Test
    fun fadeOfMatchesWeb() {
        assertEquals(1.0, fadeOf(0.0), 1e-9)
        assertEquals(1.0, fadeOf(60.0), 1e-9)
        assertEquals(0.0, fadeOf(320.0), 1e-9)
        assertEquals(0.0, fadeOf(500.0), 1e-9)
        assertEquals(0.5, fadeOf(190.0), 1e-9)
    }

    @Test
    fun constantsMatchWeb() {
        val c = baseline["constants"]!!.jsonObject["map"]!!.jsonObject
        assertEquals(
            "MAP_GRID_KM",
            c["MAP_GRID_KM"]!!.jsonObject["value"]!!.jsonPrimitive.doubleOrNull!!.toInt(),
            MAP_GRID_KM
        )
        assertEquals(
            "MAP_CACHE_TTL",
            c["MAP_CACHE_TTL"]!!.jsonObject["value"]!!.jsonPrimitive.doubleOrNull!!.toLong(),
            MAP_CACHE_TTL_MS
        )
        assertEquals(
            "MAP_CACHE_MAX",
            c["MAP_CACHE_MAX"]!!.jsonObject["value"]!!.jsonPrimitive.doubleOrNull!!.toInt(),
            MAP_CACHE_MAX
        )
        assertEquals(
            "CITY_NEAR_KM",
            c["CITY_NEAR_KM"]!!.jsonObject["value"]!!.jsonPrimitive.doubleOrNull!!.toInt(),
            CITY_NEAR_KM
        )
    }

    @Test
    fun leaveOneOutBeatsNearestNeighbour() {
        /* 伪随机锯齿场不代表真实气象场；精度判据用空间平滑场（与网页 __gcCV 同性质） */
        val smooth = buildList {
            for (i in 0 until 5) {
                for (j in 0 until 5) {
                    val lat = 30.0 + i * 0.6
                    val lon = 110.0 + j * 0.6
                    val v = 50.0 + 25.0 * sin((lat - 30.0) * 2.0) + 18.0 * cos((lon - 110.0) * 2.0)
                    add(FieldPt(lat, lon, clamp(v, 0.0, 100.0)))
                }
            }
        }
        val loo = looRmse(smooth)
        val nn = nnRmse(smooth)
        assertTrue("留一法 $loo 应明显优于最近邻 $nn", loo < 0.75 * nn)
    }
}
