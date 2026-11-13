package com.sunglow.spectrum.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/*
 * 结论口径基准测试（B1 ·「两端长期全量同步」的最小回路）
 *
 * 基准由 native/tools/gen-golden.mjs 从 v2/src/core/scoring.ts 与 verdict.ts
 * 实时生成，不入库。网页端改了分档、结论词或模型顺序，Kotlin 没跟上就会在这里红。
 *
 * 其余分组（trend / field / calib / snapshot）随 B2 各功能包实现时接入，
 * 见基准 JSON 的 pendingGroups 字段。
 */
class VerdictGoldenTest {

    private val golden: JsonObject by lazy {
        val stream = javaClass.classLoader!!.getResourceAsStream("golden/core-golden.json")
            ?: error("缺少基准文件 golden/core-golden.json，请先运行 npx tsx native/tools/gen-golden.mjs")
        Json.parseToJsonElement(stream.bufferedReader().readText()).jsonObject
    }

    private val verdict: JsonObject get() = golden["verdict"]!!.jsonObject

    @Test
    fun qualityBandsMatchGolden() {
        val bands = verdict["bands"]!!.jsonArray
        assertEquals("QUALITY_BANDS.size", bands.size, QUALITY_BANDS.size)
        bands.forEachIndexed { i, el ->
            val b = el.jsonObject
            val band = QUALITY_BANDS[i]
            assertEquals("band[$i].key", b["key"]!!.jsonPrimitive.content, band.key)
            assertEquals("band[$i].min", b["min"]!!.jsonPrimitive.doubleOrNull!!, band.min, 1e-6)
            assertEquals("band[$i].max", b["max"]!!.jsonPrimitive.doubleOrNull!!, band.max, 1e-6)
        }
    }

    @Test
    fun gradeOfMatchesGolden() {
        val cases = verdict["grades"]!!.jsonArray
        assertTrue("基准用例为空", cases.isNotEmpty())
        for (el in cases) {
            val c = el.jsonObject
            val q = c["q"]!!.jsonPrimitive.doubleOrNull!!
            assertEquals("gradeOf($q)", c["key"]!!.jsonPrimitive.content, gradeOf(q))
        }
    }

    @Test
    fun conclWordMatchesGolden() {
        val cases = verdict["words"]!!.jsonArray
        assertTrue("基准用例为空", cases.isNotEmpty())
        for (el in cases) {
            val c = el.jsonObject
            val p = c["p"]!!.jsonPrimitive.doubleOrNull!!
            assertEquals("conclWord($p)", c["word"]!!.jsonPrimitive.content, conclWord(p))
        }
    }

    @Test
    fun modelOrderMatchesGolden() {
        val cases = verdict["models"]!!.jsonArray
        val values = ModelSel.values()
        assertEquals("ModelSel 数量", cases.size, values.size)
        cases.forEachIndexed { i, el ->
            val c = el.jsonObject
            assertEquals("model[$i].id", c["id"]!!.jsonPrimitive.content, values[i].id)
            assertEquals("model[$i].label", c["label"]!!.jsonPrimitive.content, values[i].label)
        }
    }
}
