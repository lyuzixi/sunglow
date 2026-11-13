package com.sunglow.spectrum.core

import java.net.URLDecoder
import java.net.URLEncoder
import java.util.Locale

/*
 * SUNGLOW · 分享链接
 * 与网页 v2/src/core/urlstate.ts 的 baseQuery 同口径：
 *   ?name=&lat=&lon=&date=&period=
 * 扫码或点开链接都会还原到同一城市、同一天、同一时段。
 */

const val SHARE_SITE = "https://sunglow.cloud/"

fun shareUrlOf(r: ForecastResult, trend: List<TrendRow> = emptyList()): String {
    /* 优先带 pack：网页打开即还原结论与十日趋势，不烧额度；超长/编码失败回退精简链接 */
    packShareUrlOf(r, trend)?.let { return it }
    return legacyShareUrlOf(r)
}

/** 二维码专用：pack 超过二维码容量时退回精简链接，避免生成失败 */
fun qrShareUrlOf(r: ForecastResult, trend: List<TrendRow> = emptyList()): String {
    val pack = packShareUrlOf(r, trend)
    if (pack != null && pack.length <= 2600) return pack
    return legacyShareUrlOf(r)
}

private fun legacyShareUrlOf(r: ForecastResult): String {
    val name = URLEncoder.encode(r.city.name, "UTF-8")
    val lat = String.format(Locale.US, "%.4f", r.city.lat)
    val lon = String.format(Locale.US, "%.4f", r.city.lon)
    val period = if (r.period == Period.AM) "am" else "pm"
    return SHARE_SITE + "?name=" + name + "&lat=" + lat + "&lon=" + lon +
        "&date=" + r.dateStr + "&period=" + period
}

/**
 * 从网页分享链接里取 pack 参数。
 * 网页是 hash 路由，真实形态是 `https://sunglow.cloud/#/?pack=z...`，
 * 所以先看 `#` 之后，再退回普通查询串。
 */
fun packFromUrl(url: String?): String? {
    if (url.isNullOrBlank()) return null
    val tail = if (url.contains('#')) url.substringAfter('#') else url
    val query = tail.substringAfter('?', tail)
    val hit = query.split('&').firstOrNull { it.startsWith("pack=") } ?: return null
    val raw = hit.substringAfter('=').trim()
    if (raw.isEmpty() || raw.length > PACK_HARD_MAX) return null
    return try {
        URLDecoder.decode(raw, "UTF-8")
    } catch (e: Exception) {
        raw
    }
}

/** 分享图卡文件名：霞光档案_广州_2026-11-12_晚霞.png */
fun shareFileNameOf(r: ForecastResult): String {
    val word = if (r.period == Period.AM) "朝霞" else "晚霞"
    val city = r.city.shortName.replace(Regex("[\\\\/:*?\"<>|]"), "")
    return "霞光档案_" + city + "_" + r.dateStr + "_" + word + ".png"
}
