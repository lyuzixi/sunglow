package com.sunglow.spectrum.core

import java.util.Base64
import java.util.Locale
import kotlin.math.abs

/*
 * SUNGLOW · 快照编解码（N1 · 与网页 v2/src/core/snap.ts 互通）
 *
 * 协议：SNAP_VER="1"，字段顺序即协议，base64url(UTF-8) 无 padding。
 *   · 21 字段是老快照：tzMin 恒写 480（历史缺陷），必须按坐标重算。
 *   · 22 字段是新快照：第 22 位是真实 UTC 偏移（分钟），直接采纳。
 * 任一端生成的链接两端都能解；改动字段顺序会破坏互通，必须与 snap.ts 同批修改。
 * 基准样本：native/app/src/test/resources/golden/b2-baselines.json → samples.snap[0]。
 */

const val SNAP_VER = "1"
const val SNAP_MAX = 2000
const val SNAP_N_FAC = 4

val SNAP_KEYS: List<String> = listOf(
    "cover", "base", "heq", "heff", "dedge", "block",
    "aod", "vis", "rh", "stab", "wind", "cape"
)

val SNAP_TYPES: List<String> = listOf(
    "层云/雾", "层积云", "积云", "高积云", "高层云", "卷层云", "卷云"
)

data class SnapFactor(val k: String, val v: Double?, val s: Double?)

data class SnapInput(
    val dateStr: String,
    val period: String,
    val lat: Double,
    val lon: Double,
    val name: String,
    val region: String,
    val p: Double,
    val q: Double,
    val consist: Double? = null,
    val dvI: Double? = null,
    val spread: Double? = null,
    val spreadQ: Double? = null,
    val offsetS: Double? = null,
    val primaryLevel: Double? = null,
    val primaryType: String? = null,
    val primaryBase: Double? = null,
    val dKm: Double? = null,
    val durMin: Double? = null,
    val factors: List<SnapFactor> = emptyList()
)

data class SnapData(
    val gen: Double,
    val date: String,
    val period: String,
    val lat: Double,
    val lon: Double,
    val name: String,
    val region: String,
    val p: Double,
    val q: Double,
    val consist: Double,
    val dvI: Double?,
    val spread: Double?,
    val spreadQ: Double?,
    val tzMin: Double,
    val deck: Int,
    val type: String?,
    val baseKm: Double?,
    val dKm: Double?,
    val durMin: Double?,
    val factors: List<SnapFactor>
)

private val LABEL_BAD = Regex("[^\\p{L}\\p{N} ·・.\\-()（）]")
private val DATE_RE = Regex("^\\d{4}-\\d{2}-\\d{2}$")
private val DIGIT_RE = Regex("^\\d$")
private val DECK_RE = Regex("^[012]$")

private fun safeLabel(s: String?, max: Int): String {
    if (s == null) return ""
    val cleaned = LABEL_BAD.replace(s, "")
    return if (cleaned.length > max) cleaned.substring(0, max) else cleaned
}

/** 复刻 JS `+(v.toFixed(d))`：格式化后去掉尾随 0 与小数点 */
private fun fixedTrim(v: Double, d: Int): String {
    var s = String.format(Locale.US, "%." + d + "f", v)
    s = s.trimEnd('0').trimEnd('.')
    return if (s.isEmpty() || s == "-" || s == "-0") "0" else s
}

private fun finite(v: Double?): Boolean =
    v != null && !v.isNaN() && !v.isInfinite()

private fun numOf(s: String): Double? {
    val x = s.toDoubleOrNull() ?: return null
    return if (!x.isNaN() && !x.isInfinite()) x else null
}

fun snapEncode(r: SnapInput?): String? {
    if (r == null || !finite(r.p) || !finite(r.q)) return null

    val fac = r.factors
        .filter { SNAP_KEYS.contains(it.k) && finite(it.v) && finite(it.s) }
        .sortedByDescending { abs(it.s!! - 0.5) }
        .take(SNAP_N_FAC)
        .map { it.k + "~" + fixedTrim(it.v!!, 3) + "~" + fixedTrim(it.s!!, 2) }

    val tIdx = r.primaryType?.let { SNAP_TYPES.indexOf(it) } ?: -1
    val f = mutableListOf<String>()
    f.add(SNAP_VER)
    f.add((System.currentTimeMillis() / 1000L).toString(36))
    f.add(r.dateStr)
    f.add(r.period)
    f.add(String.format(Locale.US, "%.4f", r.lat))
    f.add(String.format(Locale.US, "%.4f", r.lon))
    f.add(safeLabel(r.name, 24))
    f.add(safeLabel(r.region, 16))
    f.add(Math.round(clamp(r.p, 0.0, 100.0)).toString())
    f.add(Math.round(clamp(r.q, 0.0, 100.0)).toString())
    f.add(Math.round(clamp(nz(r.consist, 0.0), 0.0, 100.0)).toString())
    f.add(if (finite(r.dvI)) String.format(Locale.US, "%.1f", r.dvI) else "")
    f.add(if (finite(r.spread)) Math.round(r.spread!!).toString() else "")
    f.add(if (finite(r.spreadQ)) Math.round(r.spreadQ!!).toString() else "")
    f.add(Math.round(if (finite(r.offsetS)) r.offsetS!! / 60.0 else 480.0).toString())
    f.add(r.primaryLevel?.let { clamp(it.toInt().toDouble(), 0.0, 2.0).toInt().toString() } ?: "")
    f.add(if (tIdx >= 0) tIdx.toString() else "")
    f.add(if (finite(r.primaryBase)) String.format(Locale.US, "%.2f", r.primaryBase) else "")
    f.add(if (finite(r.dKm)) String.format(Locale.US, "%.1f", r.dKm) else "")
    f.add(if (finite(r.durMin)) Math.round(r.durMin!!).toString() else "")
    f.add(fac.joinToString("!"))
    /* 第 22 位：真实 UTC 偏移；老解码器只读前 21 位，不受影响 */
    if (finite(r.offsetS)) f.add(Math.round(r.offsetS!! / 60.0).toString())

    return try {
        Base64.getUrlEncoder().withoutPadding()
            .encodeToString(f.joinToString("|").toByteArray(Charsets.UTF_8))
    } catch (e: Exception) {
        null
    }
}

fun snapDecode(raw: String?): SnapData? {
    if (raw.isNullOrEmpty() || raw.length > SNAP_MAX) return null
    val txt = try {
        var t = raw.replace('-', '+').replace('_', '/')
            .replace(Regex("[^A-Za-z0-9+/]"), "")
        while (t.length % 4 != 0) t += "="
        String(Base64.getDecoder().decode(t), Charsets.UTF_8)
    } catch (e: Exception) {
        return null
    }
    if (txt.isEmpty() || txt.length > 4000) return null

    val f = txt.split("|")
    if (f.size < 21 || f[0] != SNAP_VER) return null

    val date = if (DATE_RE.matches(f[2])) f[2] else null
    val period = if (f[3] == "am" || f[3] == "pm") f[3] else null
    val lat = numOf(f[4])
    val lon = numOf(f[5])
    val p = numOf(f[8])
    val q = numOf(f[9])
    if (date == null || period == null || lat == null || lon == null || p == null || q == null) return null
    if (abs(lat) > 90.0 || abs(lon) > 180.0) return null

    val factors = f[20].split("!")
        .filter { it.isNotEmpty() }
        .mapNotNull { seg ->
            val parts = seg.split("~")
            if (parts.size < 3) return@mapNotNull null
            val k = parts[0]
            val v = numOf(parts[1])
            val s = numOf(parts[2])
            if (SNAP_KEYS.contains(k) && v != null && s != null) SnapFactor(k, v, s) else null
        }
        .take(SNAP_N_FAC)

    val tRaw = if (DIGIT_RE.matches(f[16])) f[16].toInt() else -1
    val dRaw = if (DECK_RE.matches(f[15])) f[15].toInt() else -1
    val g = try { java.lang.Long.parseLong(f[1], 36) } catch (e: Exception) { 0L }

    val tzNew = if (f.size >= 22) numOf(f[21]) else null
    val tzMin: Double = if (tzNew != null && abs(tzNew) <= 1440.0) {
        tzNew
    } else {
        Math.round(estimateOffsetSec(lat, lon) / 60.0).toDouble()
    }

    return SnapData(
        gen = g.toDouble() * 1000.0,
        date = date,
        period = period,
        lat = lat,
        lon = lon,
        name = safeLabel(f[6], 24).ifEmpty { "该地点" },
        region = safeLabel(f[7], 16),
        p = clamp(p, 0.0, 100.0),
        q = clamp(q, 0.0, 100.0),
        consist = clamp(nz(numOf(f[10]), 0.0), 0.0, 100.0),
        dvI = numOf(f[11]),
        spread = numOf(f[12]),
        spreadQ = numOf(f[13]),
        tzMin = tzMin,
        deck = dRaw,
        type = if (tRaw >= 0 && tRaw < SNAP_TYPES.size) SNAP_TYPES[tRaw] else null,
        baseKm = numOf(f[17]),
        dKm = numOf(f[18]),
        durMin = numOf(f[19]),
        factors = factors
    )
}
