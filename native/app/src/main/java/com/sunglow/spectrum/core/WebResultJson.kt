package com.sunglow.spectrum.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.Locale
import kotlin.math.roundToInt

/*
 * SUNGLOW · App → 网页快照序列化（R2-3）
 *
 * 网页 v2 的 ForecastResult 字段大小写与原生模型不同（P/Q、T/Td/RH、Heq），
 * 这里做一次显式映射，避免直接反射序列化导致网页读到 undefined。
 * 先只序列化单点结论；趋势与观测场随后批次补。
 */

fun webForecastJson(r: ForecastResult, src: String = if (r.fromCache) "cache" else "live"): JsonObject =
    buildJsonObject {
        put("ok", true)
        put("dateStr", r.dateStr)
        put("period", if (r.period == Period.AM) "am" else "pm")
        put("city", buildJsonObject {
            put("name", r.city.name)
            put("lon", r.city.lon)
            put("lat", r.city.lat)
            put("region", r.city.region)
        })
        put("tz", buildJsonObject {
            put("iana", r.tz.iana?.let { JsonPrimitive(it) } ?: JsonNull)
            put("offsetSec", r.tz.offsetSec)
            put("est", r.tz.est)
        })
        put("evName", r.evName)
        put("evMs", r.evMs)
        put("evAz", r.evAz)
        put("events", buildJsonObject {
            put("noonMs", r.events.noonMs)
            put("riseMs", r.events.riseMs?.let { JsonPrimitive(it) } ?: JsonNull)
            put("setMs", r.events.setMs?.let { JsonPrimitive(it) } ?: JsonNull)
            put("polarDay", r.events.polarDay)
            put("polarNight", r.events.polarNight)
        })
        put("leadH", r.leadH)
        put("omega", r.omega)
        put("envM", webEnv(r.envM))
        put("sRT", webRay(r.sRT))
        put("sG", webStat(r.sG))
        put("sE", r.sE?.let { webStat(it) } ?: JsonNull)
        put("models", JsonArray(r.models.map { m ->
            buildJsonObject {
                put("id", m.id)
                put("label", m.label)
                put("P", m.p)
                put("Q", m.q)
            }
        }))
        put("P", r.p)
        put("Q", r.q)
        put("grade", r.grade)
        put("consist", r.consist)
        put("dvI", r.dvI?.let { JsonPrimitive(it) } ?: JsonNull)
        put("spread", r.spread?.let { JsonPrimitive(it) } ?: JsonNull)
        put("spreadQ", r.spreadQ?.let { JsonPrimitive(it) } ?: JsonNull)
        put("conf", webConf(r.conf))
        put("factorRows", JsonArray(r.factorRows.map { f ->
            JsonArray(listOf(
                JsonPrimitive(f.key),
                f.raw?.let { JsonPrimitive(it) } ?: JsonNull,
                f.score?.let { JsonPrimitive(it) } ?: JsonNull
            ))
        }))
        put("src", src)
        put("aodFallback", r.aodFallback)
    }

/** 网页 point 缓存键：SUNGLOW.v2.point.v3.<date>|<period>@lat,lon */
fun webPointKey(r: ForecastResult): String {
    val coord = "@" + String.format(Locale.US, "%.1f", r.city.lat) + "," +
        String.format(Locale.US, "%.1f", r.city.lon)
    val p = if (r.period == Period.AM) "am" else "pm"
    return "SUNGLOW.v2.point.v3." + r.dateStr + "|" + p + coord
}

fun packMetaOf(r: ForecastResult): PackMeta = PackMeta(
    name = r.city.name,
    date = r.dateStr,
    period = if (r.period == Period.AM) "am" else "pm",
    mapDate = r.dateStr,
    lat = r.city.lat,
    lon = r.city.lon
)

/** 趋势扁平行：与网页 TrendRow 同构，避免 core 依赖 ui 模型 */
data class WebTrendRow(
    val date: String,
    val period: String,
    val p: Double,
    val q: Double,
    val grade: String
)

/** 十日趋势条目：网页 trendCacheGet 读 {ts, rows:[{date,period,P,Q,grade}]} */
private fun webTrendEntry(
    r: ForecastResult,
    rows: List<WebTrendRow>
): PackEntry? {
    if (rows.isEmpty()) return null
    val arr = rows.map { row ->
        buildJsonObject {
            put("date", row.date)
            put("period", row.period)
            put("P", row.p)
            put("Q", row.q)
            put("grade", row.grade)
        }
    }
    val key = "SUNGLOW.v2.trend." + r.dateStr + "@" +
        String.format(Locale.US, "%.1f", r.city.lat) + "," +
        String.format(Locale.US, "%.1f", r.city.lon)
    return PackEntry(
        key,
        buildJsonObject {
            put("ts", System.currentTimeMillis())
            put("rows", JsonArray(arr))
        }
    )
}

/** 观测场紧凑行（网页 PACK_ROW_LEN=32 协议，字段顺序不可改） */
private class StrTable {
    val list = ArrayList<String>()
    private val index = HashMap<String, Int>()
    fun of(v: String): Int {
        index[v]?.let { return it }
        index[v] = list.size
        list.add(v)
        return list.size - 1
    }
}

private fun qv(v: Double?, scale: Double = 1.0, nullable: Boolean = false): Int {
    if (v == null || !v.isFinite()) return if (nullable) 255 else 0
    val x = (v * scale).roundToInt()
    val hi = if (nullable) 254 else 255
    return x.coerceIn(0, hi)
}

private fun mapRow(c: HeatCell, st: StrTable): JsonArray {
    val row = IntArray(32)
    row[0] = st.of("")
    row[1] = st.of("")
    row[2] = (c.lat * 100).roundToInt()
    row[3] = (c.lon * 100).roundToInt()
    row[4] = qv(c.p)
    row[5] = qv(c.q)
    row[6] = qv(c.ensP)
    row[7] = qv(c.gfsP, nullable = true)
    row[8] = qv(c.ecP, nullable = true)
    row[9] = qv(c.rtP)
    row[10] = qv(c.refP, nullable = true)
    row[11] = qv(c.ensQ)
    row[12] = qv(c.gfsQ, nullable = true)
    row[13] = qv(c.ecQ, nullable = true)
    row[14] = qv(c.rtQ)
    row[15] = qv(c.refQ, nullable = true)
    row[16] = qv(c.cover)
    row[17] = qv(c.covers.getOrElse(0) { 0.0 })
    row[18] = qv(c.covers.getOrElse(1) { 0.0 })
    row[19] = qv(c.covers.getOrElse(2) { 0.0 })
    row[20] = qv(c.baseKm, 10.0)
    row[21] = qv(c.d, 0.5, nullable = true)
    row[22] = qv(c.dur)
    row[23] = qv(c.aod, 100.0)
    row[24] = qv(c.cld)
    row[25] = qv(c.t550)
    row[26] = qv(c.occ)
    row[27] = qv(c.ref)
    row[28] = qv(c.refGap)
    row[29] = st.of(c.grade)
    row[30] = st.of(c.type)
    row[31] = st.of(c.color)
    return JsonArray(row.map { JsonPrimitive(it) })
}

/**
 * 观测场条目：直接写 compactMap 结果，网页 installSharePack 会展开成 MapDateBox。
 * 只打包当前时段；另一时段留空（不伪造颜色）。
 */
fun buildMapPackEntry(grid: HeatGrid, center: City, stride: Int = 1): PackEntry {
    val st = StrTable()
    val cells = if (stride <= 1) grid.cells else grid.cells.filterIndexed { i, _ -> i % stride == 0 }
    val rows = cells.map { mapRow(it, st) }
    val amRows = if (grid.period == Period.AM) rows else emptyList()
    val pmRows = if (grid.period == Period.PM) rows else emptyList()
    val cm = buildJsonObject {
        put("m", 1)
        put("s", JsonArray(st.list.map { JsonPrimitive(it) }))
        put("r", JsonArray(amRows + pmRows))
        put("n", JsonArray(listOf(JsonPrimitive(""), JsonPrimitive(""))))
        put("d", grid.dateStr)
        put("na", amRows.size)
        put("ds", stride)
    }
    val key = "SUNGLOW.v2.map.v9." + grid.dateStr + "@" +
        String.format(Locale.US, "%.1f", center.lat) + "," +
        String.format(Locale.US, "%.1f", center.lon)
    return PackEntry(
        key,
        buildJsonObject {
            put("ts", System.currentTimeMillis())
            put("cm", cm)
        }
    )
}

/** 单点 + 趋势 + 观测场 pack；超长时按 1 → 2 → 3 → 丢弃观测场逐级退。 */
fun buildSnapshotPack(
    r: ForecastResult,
    trend: List<WebTrendRow> = emptyList(),
    heat: HeatGrid? = null,
    gen: Long = System.currentTimeMillis()
): String? {
    val value = buildJsonObject {
        put("ts", System.currentTimeMillis())
        put("obj", webForecastJson(r))
    }
    val base = mutableListOf(PackEntry(webPointKey(r), value))
    webTrendEntry(r, trend)?.let { base.add(it) }

    val strides = if (heat == null) listOf(0) else listOf(1, 2, 3, 0)
    for (stride in strides) {
        val entries = base.toMutableList()
        if (heat != null && stride > 0) entries.add(buildMapPackEntry(heat, r.city, stride))
        val pack = encodePack(gen = gen, q = packMetaOf(r), entries = entries)
        if (pack != null) return pack
    }
    return null
}

fun packShareUrlOf(
    r: ForecastResult,
    trend: List<WebTrendRow> = emptyList(),
    heat: HeatGrid? = null,
    gen: Long = System.currentTimeMillis()
): String? = buildSnapshotPack(r, trend, heat, gen)?.let { SHARE_SITE + "#/?pack=" + it }

/* ------------------------------------------------------------------ 子结构 */

private fun webEnv(e: Env): JsonObject = buildJsonObject {
    put("tMs", e.tMs)
    putNum("T", e.t)
    putNum("Td", e.td)
    putNum("RH", e.rh)
    putNum("cTot", e.cTot)
    putNum("cLow", e.cLow)
    putNum("cMid", e.cMid)
    putNum("cHigh", e.cHigh)
    putNum("vis", e.vis)
    putNum("P", e.p)
    putNum("Pmsl", e.pmsl)
    putNum("ws", e.ws)
    putNum("wd", e.wd)
    putNum("gust", e.gust)
    putNum("fz", e.fz)
    putNum("blh", e.blh)
    putNum("precip", e.precip)
    putNum("cape", e.cape)
    putNum("sw", e.sw)
    putNum("pp", e.pp)
    putNum("aod", null)
    put("missing", JsonArray(emptyList()))
}

private fun webDeck(d: Deck): JsonObject = buildJsonObject {
    put("key", d.key)
    put("level", d.level)
    put("name", d.nameZh)
    put("base", d.base)
    put("cover", d.cover)
    put("type", d.type)
    put("typeScore", d.typeScore)
}

private fun webGeom(g: FireGeom): JsonObject = buildJsonObject {
    put("xMax", g.xMax)
    put("thFar", g.thFar)
    put("thNear", g.thNear)
    put("thFarDeg", g.thFarDeg)
    put("thNearDeg", g.thNearDeg)
    put("ok", g.ok)
    put("dur", g.dur)
}

private fun webColor(c: RayColor): JsonObject = buildJsonObject {
    put("tau550", c.tau550)
    put("T550", c.t550)
    put("lumRel", c.lumRel)
    put("wash", c.wash)
    put("rgb", JsonArray(listOf(JsonPrimitive(c.r), JsonPrimitive(c.g), JsonPrimitive(c.b))))
    put("hex", c.hex)
    put("sat", c.sat)
    put("hue", c.hue)
    put("chroma", c.chroma)
    put("name", c.nameZh)
}

private fun webSample(s: RaySample): JsonObject = buildJsonObject {
    put("t", s.t)
    put("magDeg", s.magDeg)
    put("th", s.th)
    if (s.invalid) put("invalid", true)
    webColor(s.color).forEach { (k, v) -> put(k, v) }
}

private fun webRay(r: RayResult): JsonObject = buildJsonObject {
    put("P", r.p)
    put("Q", r.q)
    put("primary", webDeck(r.primary))
    put("decks", JsonArray(r.decks.map { webDeck(it) }))
    put("noCloud", r.noCloud)
    put("Heq", r.heq)
    put("Hs", r.hs)
    put("aodUp", r.aodUp)
    put("hEff", r.hEff)
    put("hRaw", r.hRaw)
    put("noLight", r.noLight)
    putNum("d", r.d)
    put("geom", webGeom(r.geom))
    put("samples", JsonArray(r.samples.map { webSample(it) }))
    put("peak", webSample(r.peak))
    put("best", webSample(r.best))
    put("last", webSample(r.last))
    put("bright", buildJsonObject {
        put("txt", r.bright.txt)
        put("score", r.bright.score)
    })
    put("satScore", r.satScore)
    put("colorRich", r.colorRich)
    put("hueSpread", r.hueSpread)
    put("geomF", r.geomF)
    put("coverF", r.coverF)
    put("aeroF", r.aeroF)
    put("S", r.s)
    put("qColor", r.qColor)
    put("maxChroma", r.maxChroma)
    put("qDur", r.qDur)
}

private fun webStat(s: StatResult): JsonObject = buildJsonObject {
    put("P", s.p)
    put("Q", s.q)
    put("primary", webDeck(s.primary))
    put("decks", JsonArray(s.decks.map { webDeck(it) }))
    put("noCloud", s.noCloud)
    putNum("hEff", s.hEff)
    put("Heq", s.heq)
    put("Hs", s.hs)
    putNum("aodUp", s.aodUp)
    putNum("d", s.d)
    put("geom", webGeom(s.geom))
    put("f", JsonObject(s.f.mapValues { (_, v) -> v?.let { JsonPrimitive(it) } ?: JsonNull }))
    put("s", s.s)
    put("missF", JsonArray(s.missF.map { JsonPrimitive(it) }))
    put("notes", JsonArray(s.notes.map { JsonPrimitive(it) }))
}

private fun webConf(c: EnsBand): JsonObject = buildJsonObject {
    put("key", c.key)
    put("max", c.max)
    put("lv", c.level)
    put("color", c.color)
    put("bg", c.bg)
    put("bd", c.bd)
    put("dark", buildJsonObject {
        put("color", c.darkColor)
        put("bg", c.darkBg)
        put("bd", c.darkBd)
    })
    put("txt", c.txt)
    put("hint", c.hint)
}

private fun JsonObjectBuilder.putNum(k: String, v: Double?) {
    put(k, v?.let { JsonPrimitive(it) } ?: JsonNull)
}
