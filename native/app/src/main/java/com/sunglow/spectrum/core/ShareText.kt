package com.sunglow.spectrum.core

import kotlin.math.roundToInt

/*
 * SUNGLOW · 分享文案
 * 口径来源：v2/src/core/shareextras.ts（captionOf / whenWord）。
 * 一句话结论既给系统分享用，也给复制文案用，两处必须同一份。
 */

fun whenWord(r: ForecastResult): String {
    val today = todayInTz(r.tz)
    val isAM = r.period == Period.AM
    if (r.dateStr == today) return if (isAM) "今早" else "今晚"
    if (r.dateStr == addDaysIso(today, 1)) return if (isAM) "明早" else "明晚"
    return if (r.dateStr.length >= 10) r.dateStr.substring(5) else r.dateStr
}

/** 现成文案：今晚 18:32，北京晚霞概率 72%，良好 */
fun captionOf(r: ForecastResult, view: VerdictView): String {
    val win = glowWindow(
        evMs = r.evMs,
        isAM = r.period == Period.AM,
        lat = r.city.lat,
        lon = r.city.lon,
        thNearDeg = r.sRT.geom.thNearDeg,
        thFarDeg = r.sRT.geom.thFarDeg
    )
    val mid = if (win != null) (win.first + win.second) / 2 else r.evMs
    val cityName = r.city.shortName
    val periodWord = if (r.period == Period.AM) "朝霞" else "晚霞"
    val grade = QUALITY_LABEL[view.grade] ?: view.grade
    return whenWord(r) + " " + fmtClock(mid, r.tz) + "，" + cityName + periodWord +
        "概率 " + view.p.roundToInt() + "%，" + grade
}

/** 系统分享的完整正文：一句话结论 + 出处 */
fun shareBodyOf(r: ForecastResult, view: VerdictView): String =
    captionOf(r, view) + "\n—— 来自「霞光档案 · 光谱观测」"
