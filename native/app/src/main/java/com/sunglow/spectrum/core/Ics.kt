package com.sunglow.spectrum.core

import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import kotlin.math.max
import kotlin.math.roundToLong

/*
 * 日历事件（.ics）—— 口径对齐网页 v2/src/core/shareextras.ts
 * ---------------------------------------------------------------------------
 * · 观赏窗口与页面天色带同源（skyBandOf 的 win.left / win.width），
 *   没有几何窗口时退回「日出/日落 ±15 分钟」参考时段。
 * · 时间一律写 UTC（Z 后缀），不引入 VTIMEZONE，任何日历客户端都能显示当地时间。
 * · RFC 5545：单行不超过 75 个八位组，续行以空格开头（按 UTF-8 字节数计，中文 3 字节）。
 *
 * 拆成两层：icsTextOf 只做纯格式化（可用固定输入与网页逐字节对拍），
 * buildIcs 负责把 ForecastResult 组装成字段。
 */

/** 观赏窗口；geom=false 表示走的是 ±15 分钟兜底 */
data class GlowSpan(val startMs: Double, val endMs: Double, val geom: Boolean)

/** 与网页 glowWindowOf 同口径：优先天色带里的几何窗口 */
fun glowSpanOf(r: ForecastResult, nowMs: Double = System.currentTimeMillis().toDouble()): GlowSpan {
    val band = skyBandOf(r, nowMs, r.dateStr)
    if (band != null && band.winWidth > 0f) {
        val span = band.endMs - band.startMs
        val start = band.startMs + band.winLeft * span
        return GlowSpan(start, start + band.winWidth * span, true)
    }
    val half = 15 * 60000.0
    return GlowSpan(r.evMs - half, r.evMs + half, false)
}

private fun pad2(n: Int): String = if (n < 10) "0" + n else n.toString()

/** ICS 时间必须是 UTC：YYYYMMDDTHHMMSSZ */
fun icsTime(ms: Double): String {
    val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
    cal.timeInMillis = ms.toLong()
    return cal.get(Calendar.YEAR).toString() +
        pad2(cal.get(Calendar.MONTH) + 1) +
        pad2(cal.get(Calendar.DAY_OF_MONTH)) + "T" +
        pad2(cal.get(Calendar.HOUR_OF_DAY)) +
        pad2(cal.get(Calendar.MINUTE)) +
        pad2(cal.get(Calendar.SECOND)) + "Z"
}

fun icsEsc(s: String): String =
    s.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")

/** RFC 5545 折行：按 UTF-8 字节数，超过 75 个八位组就续行（续行首字符是空格） */
fun icsFold(line: String): String {
    val out = ArrayList<String>()
    val cur = StringBuilder()
    var bytes = 0
    var i = 0
    while (i < line.length) {
        val single = if (
            Character.isHighSurrogate(line[i]) &&
            i + 1 < line.length && Character.isLowSurrogate(line[i + 1])
        ) line.substring(i, i + 2) else line[i].toString()
        val b = single.toByteArray(Charsets.UTF_8).size
        if (bytes + b > 73) {
            out.add(cur.toString())
            cur.setLength(0)
            cur.append(' ').append(single)
            bytes = 1 + b
        } else {
            cur.append(single)
            bytes += b
        }
        i += single.length
    }
    out.add(cur.toString())
    return out.joinToString("\r\n")
}

/**
 * 纯格式化：给定全部字段，产出可直接落盘的 ICS 文本（CRLF 结尾）。
 * 与网页 buildIcs 逐字节同构，便于用固定输入对拍。
 */
fun icsTextOf(
    startMs: Double,
    endMs: Double,
    summary: String,
    description: String,
    location: String,
    geoLat: Double,
    geoLon: Double,
    uid: String,
    stampMs: Double,
    alarmText: String
): String {
    val lines = listOf(
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//SUNGLOW//Glow Forecast//CN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        "UID:" + uid,
        "DTSTAMP:" + icsTime(stampMs),
        "DTSTART:" + icsTime(startMs),
        "DTEND:" + icsTime(endMs),
        "SUMMARY:" + icsEsc(summary),
        "DESCRIPTION:" + icsEsc(description),
        "LOCATION:" + icsEsc(location),
        "GEO:" + String.format(Locale.US, "%.4f", geoLat) + ";" +
            String.format(Locale.US, "%.4f", geoLon),
        "BEGIN:VALARM",
        "TRIGGER:-PT30M",
        "ACTION:DISPLAY",
        "DESCRIPTION:" + icsEsc(alarmText),
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR"
    )
    return lines.joinToString("\r\n") { icsFold(it) } + "\r\n"
}

data class IcsResult(val text: String, val fileName: String)

private fun safeName(s: String): String {
    val cleaned = s.replace(Regex("[\\\\/:*?\"<>|]"), "").trim()
    return if (cleaned.isEmpty()) "点位" else cleaned
}

fun icsFileNameOf(r: ForecastResult): String {
    val city = safeName(r.city.name)
    val period = if (r.period == Period.AM) "朝霞" else "晚霞"
    return "霞光档案_" + city + "_" + r.dateStr + "_" + period + ".ics"
}

/**
 * 把最佳窗口写成一条日历事件：事件本身覆盖观赏窗口，提前 30 分钟提醒。
 * url 非空时把快照链接写进事件描述。
 */
fun buildIcs(
    r: ForecastResult,
    view: VerdictView,
    url: String = "",
    nowMs: Double = System.currentTimeMillis().toDouble()
): IcsResult {
    val win = glowSpanOf(r, nowMs)
    val start = win.startMs
    val end = max(win.endMs, start + 5 * 60000.0)
    val city = r.city.name
    val period = if (r.period == Period.AM) "朝霞" else "晚霞"
    val grade = QUALITY_LABEL[view.grade] ?: view.grade
    val p = view.p.roundToInt()
    val q = view.q.roundToInt()
    val startClock = fmtClock(start, r.tz)
    val endClock = fmtClock(end, r.tz)

    val summary = "霞光档案 · " + city + period + " " + p + "%"
    val desc = (
        if (win.geom)
            "最佳观赏窗口 " + startClock + "–" + endClock + "，出现概率 " + p + "%，观赏质量 " + q + " 分（" + grade + "）。"
        else
            "参考时段 " + startClock + "–" + endClock + "（无几何窗口），出现概率 " + p + "%，观赏质量 " + q + " 分（" + grade + "）。"
        ) + if (url.isNotEmpty()) "\n查看快照：" + url else ""

    val periodKey = if (r.period == Period.AM) "am" else "pm"
    val uid = "sunglow-" + r.dateStr + "-" + periodKey + "-" +
        String.format(Locale.US, "%.3f", r.city.lat) + "-" +
        String.format(Locale.US, "%.3f", r.city.lon) + "-" +
        (start / 60000.0).roundToLong() + "@sunglow.local"

    val text = icsTextOf(
        startMs = start,
        endMs = end,
        summary = summary,
        description = desc,
        location = city + " " + String.format(Locale.US, "%.3f", r.city.lat) + "," +
            String.format(Locale.US, "%.3f", r.city.lon),
        geoLat = r.city.lat,
        geoLon = r.city.lon,
        uid = uid,
        stampMs = nowMs,
        alarmText = startClock + "–" + endClock + " · " + summary
    )
    return IcsResult(text, icsFileNameOf(r))
}
