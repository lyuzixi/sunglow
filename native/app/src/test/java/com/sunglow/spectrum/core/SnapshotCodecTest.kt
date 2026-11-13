package com.sunglow.spectrum.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/*
 * N1 · 快照互通回归
 * 基准：native/tools/gen-b2-baselines.mjs 从 v2/src/core/snap.ts 实时生成的
 *       golden/b2-baselines.json → samples.snap[0]（真实 snapEncode → snapDecode 往返）。
 * 两条方向都要验：网页编码 Kotlin 能解；Kotlin 编码结果网页同字段可解。
 */
class SnapshotCodecTest {

    private val baseline: JsonObject by lazy {
        val stream = javaClass.classLoader!!.getResourceAsStream("golden/b2-baselines.json")
            ?: error("缺少 golden/b2-baselines.json，请先运行 npx tsx native/tools/gen-b2-baselines.mjs")
        Json.parseToJsonElement(stream.bufferedReader().readText()).jsonObject
    }

    private val sample: JsonObject
        get() = baseline["samples"]!!.jsonObject["snap"]!!.jsonArray[0].jsonObject

    private fun d(o: JsonObject, k: String): Double = o[k]!!.jsonPrimitive.doubleOrNull!!
    private fun s(o: JsonObject, k: String): String = o[k]!!.jsonPrimitive.content

    private fun assertMatches(tag: String, want: JsonObject, got: SnapData, checkGen: Boolean = false) {
        if (checkGen) assertEquals("$tag.gen", d(want, "gen"), got.gen, 1e-6)
        assertEquals("$tag.date", s(want, "date"), got.date)
        assertEquals("$tag.period", s(want, "period"), got.period)
        assertEquals("$tag.lat", d(want, "lat"), got.lat, 1e-6)
        assertEquals("$tag.lon", d(want, "lon"), got.lon, 1e-6)
        assertEquals("$tag.name", s(want, "name"), got.name)
        assertEquals("$tag.region", s(want, "region"), got.region)
        assertEquals("$tag.P", d(want, "P"), got.p, 1e-6)
        assertEquals("$tag.Q", d(want, "Q"), got.q, 1e-6)
        assertEquals("$tag.consist", d(want, "consist"), got.consist, 1e-6)
        assertEquals("$tag.dvI", d(want, "dvI"), got.dvI!!, 1e-6)
        assertEquals("$tag.spread", d(want, "spread"), got.spread!!, 1e-6)
        assertEquals("$tag.spreadQ", d(want, "spreadQ"), got.spreadQ!!, 1e-6)
        assertEquals("$tag.tzMin", d(want, "tzMin"), got.tzMin, 1e-6)
        assertEquals("$tag.deck", d(want, "deck").toInt(), got.deck)
        assertEquals("$tag.type", s(want, "type"), got.type)
        assertEquals("$tag.baseKm", d(want, "baseKm"), got.baseKm!!, 1e-6)
        assertEquals("$tag.dKm", d(want, "dKm"), got.dKm!!, 1e-6)
        assertEquals("$tag.durMin", d(want, "durMin"), got.durMin!!, 1e-6)

        val wantFac = want["factors"]!!.jsonArray
        assertEquals("$tag.factors.size", wantFac.size, got.factors.size)
        wantFac.forEachIndexed { i, el ->
            val f = el.jsonObject
            assertEquals("$tag.factors[$i].k", s(f, "k"), got.factors[i].k)
            assertEquals("$tag.factors[$i].v", d(f, "v"), got.factors[i].v!!, 1e-6)
            assertEquals("$tag.factors[$i].s", d(f, "s"), got.factors[i].s!!, 1e-6)
        }
    }

    @Test
    fun decodesWebSnapshot() {
        val want = sample["decoded"]!!.jsonObject
        val got = snapDecode(sample["raw"]!!.jsonPrimitive.content)
        assertNotNull("网页快照应可解码", got)
        assertMatches("web", want, got!!, checkGen = true)
    }

    @Test
    fun encodesRoundTripWithWebShape() {
        val want = sample["decoded"]!!.jsonObject
        val factors = want["factors"]!!.jsonArray.map { el ->
            val f = el.jsonObject
            SnapFactor(s(f, "k"), d(f, "v"), d(f, "s"))
        }
        val input = SnapInput(
            dateStr = s(want, "date"),
            period = s(want, "period"),
            lat = d(want, "lat"),
            lon = d(want, "lon"),
            name = s(want, "name"),
            region = s(want, "region"),
            p = d(want, "P"),
            q = d(want, "Q"),
            consist = d(want, "consist"),
            dvI = d(want, "dvI"),
            spread = d(want, "spread"),
            spreadQ = d(want, "spreadQ"),
            offsetS = d(want, "tzMin") * 60.0,
            primaryLevel = d(want, "deck"),
            primaryType = s(want, "type"),
            primaryBase = d(want, "baseKm"),
            dKm = d(want, "dKm"),
            durMin = d(want, "durMin"),
            factors = factors
        )
        val raw = snapEncode(input)
        assertNotNull("Kotlin 应能编码快照", raw)
        val got = snapDecode(raw)
        assertNotNull("Kotlin 编码的快照应可解", got)
        /* gen 使用当前时间戳，不参与比对；其余字段必须与网页基准逐项一致 */
        assertMatches("roundtrip", want, got!!)
    }

    @Test
    fun rejectsMalformedInput() {
        assertNull(snapDecode(null))
        assertNull(snapDecode(""))
        assertNull(snapDecode("!!!"))
        assertNull(snapEncode(null))
    }
}
