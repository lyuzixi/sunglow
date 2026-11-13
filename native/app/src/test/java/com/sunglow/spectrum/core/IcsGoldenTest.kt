package com.sunglow.spectrum.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone
import kotlin.math.roundToLong

/*
 * 日历事件（.ics）门禁 —— N4
 * ---------------------------------------------------------------------------
 * 第一组：网页 buildIcs 的真实产物逐字节对拍（含中文折行、转义、UTC 时间）。
 *         基准里的 text 由 v2/src/core/shareextras.ts 生成，Kotlin 只要字节不同就红。
 * 第二组：用组装好的真实预报跑一遍 buildIcs，守住「事件落在观赏时段内 / 有提前 30 分钟提醒」
 *         这类结构性约束，避免上游窗口算法改了却没人发现。
 */
class IcsGoldenTest {

    private fun baselines(): JsonObject {
        val stream = javaClass.classLoader!!.getResourceAsStream("golden/b2-baselines.json")
            ?: error("缺少 golden/b2-baselines.json：先跑 npx tsx native/tools/gen-b2-baselines.mjs")
        return Json.parseToJsonElement(stream.bufferedReader().readText()).jsonObject
    }

    @Test
    fun `ics text matches web buildIcs byte for byte`() {
        val sample = baselines()["samples"]!!.jsonObject["ics"]!!.jsonArray.first().jsonObject

        val text = icsTextOf(
            startMs = sample["startMs"]!!.jsonPrimitive.double,
            endMs = sample["endMs"]!!.jsonPrimitive.double,
            summary = sample["summary"]!!.jsonPrimitive.content,
            description = sample["description"]!!.jsonPrimitive.content,
            location = sample["location"]!!.jsonPrimitive.content,
            geoLat = sample["geoLat"]!!.jsonPrimitive.double,
            geoLon = sample["geoLon"]!!.jsonPrimitive.double,
            uid = sample["uid"]!!.jsonPrimitive.content,
            stampMs = sample["stampMs"]!!.jsonPrimitive.double,
            alarmText = sample["alarmText"]!!.jsonPrimitive.content
        )

        assertEquals("ICS 文本与网页不一致", sample["text"]!!.jsonPrimitive.content, text)
        assertEquals("文件名口径不一致", sample["fileName"]!!.jsonPrimitive.content,
            icsFileNameOf(sampleForecast()))
    }

    /** 与基准 sample 同城同日同时段的最小预报，只用于文件名断言 */
    private fun sampleForecast(): ForecastResult {
        val city = City("北京市", 116.4074, 39.9042, "北京市")
        val tz = TzInfo("Asia/Shanghai", 8 * 3600, false)
        val events = sunEvents(utcMillis(2026, 11, 13), 39.9042, 116.4074)
        val evMs = events.setMs ?: error("北京 2026-11-13 应有日落时刻")
        val evAz = solarPosition(evMs, 39.9042, 116.4074).azimuth
        val omega = sunAltRate(evMs, 39.9042, 116.4074)
        val pts = transectPoints(city, evAz)
        val series = pts.map { makeSeries(evMs.roundToLong()) }
        val result = assembleForecast(
            city = city,
            dateStr = "2026-11-13",
            period = Period.PM,
            tz = tz,
            events = events,
            evMs = evMs,
            evAz = evAz,
            omega = omega,
            leadH = 8.0,
            sG = series,
            sE = series,
            sA = null
        )
        return result
    }

    private fun makeSeries(evT: Long): Series {
        fun rows(v: Double?): List<SeriesRow> = listOf(
            SeriesRow((evT - 2 * 3600000L).toDouble(), v),
            SeriesRow((evT + 2 * 3600000L).toDouble(), v)
        )
        val raw = linkedMapOf(
            "temperature_2m" to rows(20.0),
            "dew_point_2m" to rows(10.0),
            "relative_humidity_2m" to rows(60.0),
            "cloud_cover_low" to rows(20.0),
            "cloud_cover_mid" to rows(30.0),
            "cloud_cover_high" to rows(40.0),
            "visibility" to rows(20000.0),
            "pressure_msl" to rows(1012.0),
            "wind_speed_10m" to rows(4.0),
            "wind_direction_10m" to rows(90.0),
            "freezing_level_height" to rows(3000.0),
            "boundary_layer_height" to rows(1200.0),
            "precipitation" to rows(0.0),
            "cape" to rows(100.0)
        )
        return Series(raw, TzInfo("Asia/Shanghai", 8 * 3600, false))
    }

    @Test
    fun `ics event covers glow window with a 30 minute alarm`() {
        val r = sampleForecast()
        val view = VerdictView(
            p = 72.0, q = 68.0, grade = "良", label = "良", single = true
        )
        val now = utcMillis(2026, 11, 13).toDouble()
        val built = buildIcs(r, view, "https://sunglow.cloud/?s=TEST", now)
        val text = built.text

        assertTrue("必须 CRLF 结尾", text.endsWith("\r\n"))
        assertTrue("缺少日历头", text.startsWith("BEGIN:VCALENDAR\r\n"))
        assertTrue("缺少事件尾", text.trimEnd().endsWith("END:VCALENDAR"))
        assertTrue("缺少提前 30 分钟提醒", text.contains("TRIGGER:-PT30M"))
        assertTrue("事件必须含 UTC 时间", Regex("DTSTART:\\d{8}T\\d{6}Z").containsMatchIn(text))

        /* 每一行（含续行）不超过 75 个八位组 */
        for (line in text.split("\r\n")) {
            if (line.isEmpty()) continue
            val bytes = line.toByteArray(Charsets.UTF_8).size
            assertTrue("行超长（$bytes 字节）：$line", bytes <= 75)
        }

        /* 事件起点必须落在观测时刻附近（±6 小时），不能把日期算串 */
        val startLine = Regex("DTSTART:(\\d{8}T\\d{6}Z)").find(text)!!.groupValues[1]
        val startMs = parseIcsTime(startLine)
        assertTrue("DTSTART 偏离观测时刻太远", kotlin.math.abs(startMs - r.evMs) <= 6 * 3600000.0)

        /* 事件结束不早于起点 */
        val endLine = Regex("DTEND:(\\d{8}T\\d{6}Z)").find(text)!!.groupValues[1]
        assertTrue("DTEND 早于 DTSTART", parseIcsTime(endLine) >= startMs)

        assertTrue("文件名应为 .ics", built.fileName.endsWith(".ics"))
        assertTrue("文件名应含城市", built.fileName.contains(r.city.name))
    }

    private fun parseIcsTime(s: String): Double {
        val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
        cal.clear()
        cal.set(
            s.substring(0, 4).toInt(),
            s.substring(4, 6).toInt() - 1,
            s.substring(6, 8).toInt(),
            s.substring(9, 11).toInt(),
            s.substring(11, 13).toInt(),
            s.substring(13, 15).toInt()
        )
        return cal.timeInMillis.toDouble()
    }
}
