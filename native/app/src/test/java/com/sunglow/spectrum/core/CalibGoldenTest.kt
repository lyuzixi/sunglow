package com.sunglow.spectrum.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

/*
 * N1 · 实况校准口径回归
 * 基准：b2-baselines.json → samples.calib（由 v2/src/core/calib.ts 实时生成）。
 */
class CalibGoldenTest {

    private val baseline: JsonObject by lazy {
        val stream = javaClass.classLoader!!.getResourceAsStream("golden/b2-baselines.json")
            ?: error("缺少 golden/b2-baselines.json，请先运行 npx tsx native/tools/gen-b2-baselines.mjs")
        Json.parseToJsonElement(stream.bufferedReader().readText()).jsonObject
    }

    @Test
    fun calibMatchesGolden() {
        val cases = baseline["samples"]!!.jsonObject["calib"]!!.jsonArray
        var checked = 0
        for (el in cases) {
            val c = el.jsonObject
            if (c.containsKey("group")) {
                val lat = c["lat"]!!.jsonPrimitive.doubleOrNull!!
                val lon = c["lon"]!!.jsonPrimitive.doubleOrNull!!
                assertEquals("calibGroupOf($lat,$lon)", c["group"]!!.jsonPrimitive.content, calibGroupOf(lat, lon))
                checked++
            }
            if (c.containsKey("bucket")) {
                val p = c["p"]!!.jsonPrimitive.doubleOrNull!!
                assertEquals("calibBucketOf($p)", c["bucket"]!!.jsonPrimitive.doubleOrNull!!.toInt(), calibBucketOf(p))
                checked++
            }
            if (c.containsKey("canAnnotate")) {
                val leadEl = c["leadH"] as? JsonPrimitive
                val leadH = leadEl?.doubleOrNull
                assertEquals(
                    "calibCanAnnotate($leadH)",
                    c["canAnnotate"]!!.jsonPrimitive.booleanOrNull!!,
                    calibCanAnnotate(leadH)
                )
                checked++
            }
        }
        check(checked >= 17) { "校准基准用例不足：$checked" }
    }

    @Test
    fun constantsMatchWeb() {
        assertEquals(0.5, CALIB_GRID_DEG, 1e-9)
        assertEquals(20, CALIB_BUCKET)
        assertEquals(-1, CALIB_AFTER_H)
        assertEquals(200, CALIB_MAX)
    }
}
