package com.sunglow.spectrum.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/*
 * 算法一致性基准测试（对拍）
 *
 * 基准由 native/tools/gen-golden.mjs 用网页端 TypeScript 实现跑出，
 * 本测试把同一批输入喂给 Kotlin 实现，逐字段比对。
 *
 * 口径：
 *   · 浮点：1e-6 容差（基准已收敛到 6 位小数）
 *   · 时刻：二分求解的毫秒值同样用 1e-6 容差
 *   · 离散值（等级、色名、云型、缺失因子列表）：必须完全相等
 *
 * 算法口径一旦调整，必须重跑生成脚本，否则这里会按旧基准通过。
 */
class GoldenTest {

    private val eps = 1e-6

    private val golden: JsonObject by lazy {
        val stream = javaClass.classLoader!!.getResourceAsStream("golden/core-golden.json")
            ?: error("缺少基准文件 golden/core-golden.json，请先运行 npx tsx native/tools/gen-golden.mjs")
        Json.parseToJsonElement(stream.bufferedReader().readText()).jsonObject
    }

    /* ---------- 取值助手 ---------- */

    private fun JsonObject.d(key: String): Double? =
        (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.doubleOrNull

    private fun JsonObject.l(key: String): Long? =
        (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.long

    private fun JsonObject.b(key: String): Boolean? =
        (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.booleanOrNull

    private fun JsonObject.s(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

    private fun JsonObject.obj(key: String): JsonObject? = (this[key] as? JsonObject)

    private fun JsonObject.arr(key: String): JsonArray = this[key]!!.jsonArray

    private fun assertNear(msg: String, expected: Double?, actual: Double?, tol: Double = eps) {
        if (expected == null || actual == null) {
            assertEquals("$msg：空值不一致", expected, actual)
            return
        }
        if (!expected.isFinite() || !actual.isFinite()) {
            assertEquals("$msg：非有限值不一致", expected, actual)
            return
        }
        assertEquals(msg, expected, actual, tol)
    }

    /* ---------- 1. 太阳位置 ---------- */

    @Test
    fun solarPositionMatchesGolden() {
        val cases = golden.arr("astro")
        assertTrue("基准用例为空", cases.size > 0)
        for (el in cases) {
            val c = el.jsonObject
            val ms = c.l("ms")!!
            val lat = c.d("lat")!!
            val lon = c.d("lon")!!
            val p = solarPosition(ms, lat, lon)
            val tag = "solarPosition($ms, $lat, $lon)"
            assertNear("$tag.altitude", c.d("altitude"), p.altitude)
            assertNear("$tag.azimuth", c.d("azimuth"), p.azimuth)
            assertNear("$tag.declination", c.d("declination"), p.declination)
            assertNear("$tag.hourAngle", c.d("hourAngle"), p.hourAngle)
        }
    }

    @Test
    fun sunEventsMatchesGolden() {
        for (el in golden.arr("sunEvents")) {
            val c = el.jsonObject
            val lat = c.d("lat")!!
            val lon = c.d("lon")!!
            val ev = sunEvents(utcMillis(2026, 11, 12), lat, lon)
            val tag = "sunEvents($lat, $lon)"
            assertNear("$tag.noonMs", c.d("noonMs"), ev.noonMs)
            assertNear("$tag.riseMs", c.d("riseMs"), ev.riseMs)
            assertNear("$tag.setMs", c.d("setMs"), ev.setMs)
            assertEquals("$tag.polarDay", c.b("polarDay"), ev.polarDay)
            assertEquals("$tag.polarNight", c.b("polarNight"), ev.polarNight)
        }
    }

    @Test
    fun eventAzimuthMatchesGolden() {
        for (el in golden.arr("eventAzimuth")) {
            val c = el.jsonObject
            val per = if (c.s("per") == "am") Period.AM else Period.PM
            val v = eventAzimuth("2026-11-12", per, c.d("lat")!!, c.d("lon")!!)
            assertNear("eventAzimuth(${c.s("per")} ${c.d("lat")})", c.d("value"), v)
        }
    }

    @Test
    fun sunAltRateMatchesGolden() {
        for (el in golden.arr("sunAltRate")) {
            val c = el.jsonObject
            val v = sunAltRate(c.l("ms")!!, c.d("lat")!!, c.d("lon")!!)
            assertNear("sunAltRate(${c.l("ms")})", c.d("value"), v)
        }
    }

    /* ---------- 2. 光路与色彩 ---------- */

    @Test
    fun rayTraceColorMatchesGolden() {
        for (el in golden.arr("rayColor")) {
            val c = el.jsonObject
            val h = c.d("h")!!
            val th = c.d("th")!!
            val aod = c.d("aod")!!
            val hs = c.d("hs")!!
            val got = rayTraceColor(h, th, aod, hs)
            val tag = "rayTraceColor(h=$h, th=$th, aod=$aod, hs=$hs)"
            assertNear("$tag.tau550", c.d("tau550"), got.tau550)
            assertNear("$tag.t550", c.d("t550"), got.t550)
            assertNear("$tag.lumRel", c.d("lumRel"), got.lumRel)
            assertNear("$tag.wash", c.d("wash"), got.wash)
            assertEquals("$tag.r", c.d("r")!!.toInt(), got.r)
            assertEquals("$tag.g", c.d("g")!!.toInt(), got.g)
            assertEquals("$tag.b", c.d("b")!!.toInt(), got.b)
            assertEquals("$tag.hex", c.s("hex"), got.hex)
            assertNear("$tag.sat", c.d("sat"), got.sat)
            assertNear("$tag.hue", c.d("hue"), got.hue)
            assertNear("$tag.chroma", c.d("chroma"), got.chroma)
            assertEquals("$tag.name", c.s("name"), got.nameZh)
        }
    }

    /* ---------- 3. 样带分析 ---------- */

    @Test
    fun analyseTransectMatchesGolden() {
        for (el in golden.arr("transect")) {
            val c = el.jsonObject
            val key = c.s("levelKey")!!
            val pts = c.arr("input").map { row ->
                val o = row.jsonObject
                TransectPt(
                    d = o.d("d")!!,
                    cLow = o.d("cLow"),
                    cMid = o.d("cMid"),
                    cHigh = o.d("cHigh"),
                    aod = o.d("aod"),
                    vis = o.d("vis")
                )
            }
            val want = c.obj("out")!!
            val got = analyseTransect(pts, key)
            val tag = "analyseTransect($key, n=${pts.size})"
            assertEquals("$tag.ok", want.b("ok"), got.ok)
            assertEquals("$tag.reason", want.s("reason"), got.reason)
            assertNear("$tag.dNear", want.d("dNear"), got.dNear)
            assertNear("$tag.dFar", want.d("dFar"), got.dFar)
            assertEquals("$tag.openEnded", want.b("openEnded"), got.openEnded)
            assertEquals("$tag.hasDeck", want.b("hasDeck"), got.hasDeck)
            assertNear("$tag.upstreamAod", want.d("upstreamAod"), got.upstreamAod)
            assertNear("$tag.upstreamLowMax", want.d("upstreamLowMax"), got.upstreamLowMax)
            assertNear("$tag.upstreamMidMax", want.d("upstreamMidMax"), got.upstreamMidMax)
            assertNear("$tag.upstreamVisMin", want.d("upstreamVisMin"), got.upstreamVisMin)
        }
    }

    /* ---------- 4. 统计评分 ---------- */

    @Test
    fun scoreStatMatchesGolden() {
        for (el in golden.arr("stat")) {
            val c = el.jsonObject
            val env = envOf(c.obj("env")!!)
            val tr = summaryOf(c.obj("summary")!!)
            val ctx = ctxOf(c.obj("ctx")!!)
            val got = scoreStat(env, tr, ctx)
            val tag = "scoreStat(P=${c.d("p")})"

            assertNear("$tag.p", c.d("p"), got.p)
            assertNear("$tag.q", c.d("q"), got.q)
            assertNear("$tag.s", c.d("s"), got.s)
            assertNear("$tag.hEff", c.d("hEff"), got.hEff)
            assertNear("$tag.Heq", c.d("Heq"), got.heq)
            assertNear("$tag.Hs", c.d("Hs"), got.hs)
            assertNear("$tag.aodUp", c.d("aodUp"), got.aodUp)
            assertNear("$tag.d", c.d("d"), got.d)
            assertEquals("$tag.primary", c.s("primaryKey"), got.primary.key)
            assertEquals("$tag.type", c.s("primaryType"), got.primary.type)
            assertEquals("$tag.noCloud", c.b("noCloud"), got.noCloud)

            val wantF = c.obj("f")!!
            for (k in wantF.keys) {
                assertNear("$tag.f.$k", wantF.d(k), got.f[k])
            }
            assertEquals(
                "$tag.missF",
                c.arr("missF").map { (it as JsonPrimitive).content },
                got.missF
            )

            val geom = c.obj("geom")!!
            assertNear("$tag.geom.xMax", geom.d("xMax"), got.geom.xMax)
            assertNear("$tag.geom.thFar", geom.d("thFar"), got.geom.thFar)
            assertNear("$tag.geom.dur", geom.d("dur"), got.geom.dur)
            assertEquals("$tag.geom.ok", geom.b("ok"), got.geom.ok)
        }
    }

    /* ---------- 5. 光追评分 ---------- */

    @Test
    fun scoreRayMatchesGolden() {
        for (el in golden.arr("rayScore")) {
            val c = el.jsonObject
            val env = envOf(c.obj("env")!!)
            val tr = summaryOf(c.obj("summary")!!)
            val ctx = ctxOf(c.obj("ctx")!!)
            val got = scoreRay(env, tr, ctx)
            val tag = "scoreRay(hEff=${c.d("hEff")})"

            assertNear("$tag.p", c.d("p"), got.p)
            assertNear("$tag.q", c.d("q"), got.q)
            assertNear("$tag.s", c.d("s"), got.s)
            assertNear("$tag.hEff", c.d("hEff"), got.hEff)
            assertNear("$tag.hRaw", c.d("hRaw"), got.hRaw)
            assertEquals("$tag.noLight", c.b("noLight"), got.noLight)
            assertNear("$tag.Heq", c.d("Heq"), got.heq)
            assertNear("$tag.Hs", c.d("Hs"), got.hs)
            assertNear("$tag.aodUp", c.d("aodUp"), got.aodUp)
            assertEquals("$tag.geomOk", c.b("geomOk"), got.geom.ok)
            assertNear("$tag.dur", c.d("dur"), got.geom.dur)
            assertNear("$tag.geomF", c.d("geomF"), got.geomF)
            assertNear("$tag.coverF", c.d("coverF"), got.coverF)
            assertNear("$tag.aeroF", c.d("aeroF"), got.aeroF)
            assertNear("$tag.satScore", c.d("satScore"), got.satScore)
            assertNear("$tag.colorRich", c.d("colorRich"), got.colorRich)
            assertNear("$tag.hueSpread", c.d("hueSpread"), got.hueSpread)
            assertNear("$tag.maxChroma", c.d("maxChroma"), got.maxChroma)
            assertNear("$tag.qColor", c.d("qColor"), got.qColor)
            assertNear("$tag.qDur", c.d("qDur"), got.qDur)
            assertEquals("$tag.brightTxt", c.s("brightTxt"), got.bright.txt)
            assertNear("$tag.brightScore", c.d("brightScore"), got.bright.score)

            val wantSamples = c.arr("samples")
            assertEquals("$tag.samples.size", wantSamples.size, got.samples.size)
            for (i in 0 until wantSamples.size) {
                val w = wantSamples[i].jsonObject
                val g = got.samples[i]
                val st = "$tag.samples[$i]"
                assertNear("$st.t", w.d("t"), g.t)
                assertNear("$st.magDeg", w.d("magDeg"), g.magDeg)
                assertNear("$st.th", w.d("th"), g.th)
                assertEquals("$st.invalid", w.b("invalid"), g.invalid)
                assertNear("$st.t550", w.d("t550"), g.color.t550)
                assertEquals("$st.hex", w.s("hex"), g.color.hex)
                assertNear("$st.sat", w.d("sat"), g.color.sat)
                assertNear("$st.hue", w.d("hue"), g.color.hue)
                assertNear("$st.chroma", w.d("chroma"), g.color.chroma)
            }
        }
    }

    /* ---------- 构造器 ---------- */

    private fun envOf(o: JsonObject): Env = Env(
        tMs = o.l("tMs") ?: 0L,
        t = o.d("T"),
        td = o.d("Td"),
        rh = o.d("RH"),
        cTot = o.d("cTot"),
        cLow = o.d("cLow"),
        cMid = o.d("cMid"),
        cHigh = o.d("cHigh"),
        vis = o.d("vis"),
        p = o.d("P"),
        pmsl = o.d("Pmsl"),
        ws = o.d("ws"),
        wd = o.d("wd"),
        gust = o.d("gust"),
        fz = o.d("fz"),
        blh = o.d("blh"),
        precip = o.d("precip"),
        cape = o.d("cape"),
        sw = o.d("sw"),
        pp = o.d("pp"),
        aod = o.d("aod"),
        missing = emptyList()
    )

    private fun summaryOf(o: JsonObject): TransectSummary = TransectSummary(
        hasDeck = o.b("hasDeck") ?: false,
        dFar = o.d("dFar"),
        upstreamAod = o.d("upstreamAod"),
        upstreamLowMax = o.d("upstreamLowMax"),
        upstreamMidMax = o.d("upstreamMidMax")
    )

    private fun ctxOf(o: JsonObject): ScoreCtx = ScoreCtx(
        v = o.d("v") ?: 0.0,
        omega = o.d("omega") ?: 0.0,
        dP = o.d("dP"),
        aod = o.d("aod")
    )
}
