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
 * N3b · 参考模型旁证与观测场辅助口径
 * ---------------------------------------------------------------------------
 * 参考分（五因子加权）是「独立旁证」，绝不参与 ens/dv 加权；网页与原生必须逐位一致，
 * 否则两端的交叉验证结论会互相打架。遮挡四档、形态分歧（z 标准化后 |Δz|×33）同理。
 */
class RefModelGoldenTest {

    private fun baselines(): JsonObject {
        val stream = javaClass.classLoader!!.getResourceAsStream("golden/b2-baselines.json")
            ?: error("缺少 golden/b2-baselines.json：先跑 npx tsx native/tools/gen-b2-baselines.mjs")
        return Json.parseToJsonElement(stream.bufferedReader().readText()).jsonObject
    }

    private fun JsonObject.d(key: String): Double? =
        this[key]?.jsonPrimitive?.doubleOrNull

    private fun envOf(o: JsonObject): Env = Env(
        tMs = 0L,
        t = o.d("T"),
        td = null,
        rh = o.d("RH"),
        cTot = o.d("cTot"),
        cLow = o.d("cLow"),
        cMid = o.d("cMid"),
        cHigh = o.d("cHigh"),
        vis = o.d("vis"),
        p = null,
        pmsl = null,
        ws = null,
        wd = null,
        gust = null,
        fz = null,
        blh = null,
        precip = null,
        cape = null,
        sw = null,
        pp = o.d("pp"),
        aod = o.d("aod"),
        missing = emptyList()
    )

    /** 可空数值的带容差比较（避免 assertEquals 重载歧义） */
    private fun assertNum(name: String, expected: Double?, actual: Double?, delta: Double = 1e-12) {
        if (expected == null) {
            assertEquals(name, null, actual)
            return
        }
        assertEquals(name, expected, actual!!, delta)
    }

    @Test
    fun `ref score matches web refmodel`() {
        val cases = baselines()["samples"]!!.jsonObject["ref"]!!.jsonArray
        assertTrue("参考分基准为空", cases.isNotEmpty())
        for (c in cases) {
            val obj = c.jsonObject
            val name = obj["name"]!!.jsonPrimitive.content
            val expected = obj["v"]!!.jsonPrimitive.doubleOrNull!!
            val expectedS = obj["s"]!!.jsonPrimitive.doubleOrNull!!
            val expectedMissing = obj["missing"]!!.jsonArray.map { it.jsonPrimitive.content }
            val expectedFactors = obj["factors"]!!.jsonObject

            val got = refScore(envOf(obj["env"]!!.jsonObject))

            assertNum("$name 参考分", expected, got.v, 1e-9)
            assertNum("$name 原始分", expectedS, got.s, 1e-12)
            assertEquals("$name 缺项", expectedMissing, got.missing)

            val ef = expectedFactors
            assertNum("$name 云型", ef.d("cloudType"), got.factors.cloudType)
            assertNum("$name 通透", ef.d("transparency"), got.factors.transparency)
            assertNum("$name 湿度", ef.d("humidity"), got.factors.humidity)
            assertNum("$name 降水", ef.d("precip"), got.factors.precip)
            assertNum("$name 总云量", ef.d("cloudCover"), got.factors.cloudCover)
        }
    }

    @Test
    fun `occlusion bands match web`() {
        val cases = baselines()["samples"]!!.jsonObject["occ"]!!.jsonArray
        assertTrue("遮挡分档基准为空", cases.isNotEmpty())
        for (c in cases) {
            val obj = c.jsonObject
            val v = obj["v"]!!.jsonPrimitive.doubleOrNull!!
            assertEquals("遮挡分档 v=$v", obj["band"]!!.jsonPrimitive.content.toInt(), occBandOf(v))
            assertEquals(
                "遮挡分档名 v=$v",
                obj["name"]!!.jsonPrimitive.content,
                OCC_BAND_NAMES[occBandOf(v)]
            )
        }
    }

    @Test
    fun `ref gap matches web standardization`() {
        val case = baselines()["samples"]!!.jsonObject["refGap"]!!.jsonArray.first().jsonObject
        val refs = case["refs"]!!.jsonArray.map { it.jsonPrimitive.doubleOrNull!! }
        val mixes = case["mixes"]!!.jsonArray.map { it.jsonPrimitive.doubleOrNull!! }
        val expected = case["gaps"]!!.jsonArray.map { it.jsonPrimitive.doubleOrNull!! }

        val got = finalizeRefGap(refs, mixes)
        assertEquals("分歧条数", expected.size, got.size)
        for (i in expected.indices) {
            assertEquals("分歧 #$i", expected[i], got[i], 1e-9)
        }
    }

    @Test
    fun `confidence only drops saturation`() {
        /* 分歧越大可信度越低，但下限 0.2（网页同口径） */
        assertEquals(1.0, fieldConfOf(0.0), 1e-12)
        assertEquals(1.0, fieldConfOf(null), 1e-12)
        assertTrue(fieldConfOf(35.0) < 1.0)
        assertTrue(fieldConfOf(100.0) >= 0.2)
        assertEquals(0.7, fieldConfOf(35.0), 1e-12)
    }
}
