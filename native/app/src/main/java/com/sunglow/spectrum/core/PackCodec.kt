package com.sunglow.spectrum.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.zip.Deflater
import java.util.zip.Inflater

/*
 * SUNGLOW · pack 快照包（R2 · 与网页 v2/src/core/snapshot.ts 互通）
 *
 * 包结构：{"v":2,"g":gen,"q":{n,d,p,md,la,lo},"e":[[key,value],...]}
 *   · 外层先 JSON，再 deflate，再 base64url；首字符 "z"=deflate，"j"=未压缩兜底。
 *   · 观测场条目 value = {"ts":..,"cm":{m,s,r,n,d,na,ds}}，行宽固定 32。
 *   · 只认网页的三个缓存族与对比键，未知键直接丢弃，绝不写任意键。
 *   · 解码硬上限 40,000 字符、解压上限 1 MB，防恶意包。
 */

const val PACK_VER = 2
const val PACK_MAX_CHARS = 7600
const val PACK_HARD_MAX = 40000
const val PACK_ROW_LEN = 32
const val PACK_ENTRY_MAX = 40

val PACK_FAMILIES: List<String> = listOf(
    "SUNGLOW.v2.point.", "SUNGLOW.v2.trend.", "SUNGLOW.v2.map."
)
const val PACK_CMP_KEY = "SUNGLOW.v2.cmp.v1"

data class PackMeta(
    val name: String,
    val date: String,
    val period: String,
    val mapDate: String,
    val lat: Double,
    val lon: Double
)

data class PackEntry(val key: String, val value: JsonObject)

data class PackSnapshot(
    val gen: Long,
    val q: PackMeta,
    val entries: List<PackEntry>
) {
    val parts: List<String>
        get() {
            val p = mutableListOf<String>()
            if (entries.any { it.key.startsWith("SUNGLOW.v2.point.") }) p.add("point")
            if (entries.any { it.key.startsWith("SUNGLOW.v2.trend.") }) p.add("trend")
            if (entries.any { it.key.startsWith("SUNGLOW.v2.map.") }) p.add("map")
            if (entries.any { it.key == PACK_CMP_KEY }) p.add("compare")
            return p
        }

    /** 观测场抽稀步长；没有观测场时为 0 */
    val mapStride: Int
        get() {
            val cm = entries.firstOrNull { it.key.startsWith("SUNGLOW.v2.map.") }
                ?.value?.get("cm") as? JsonObject ?: return 0
            return cm["ds"]?.jsonPrimitive?.intOrNull ?: 1
        }

    val mapEntry: PackEntry?
        get() = entries.firstOrNull { it.key.startsWith("SUNGLOW.v2.map.") }
}

data class PackMapPoint(
    val name: String,
    val prov: String,
    val lat: Double,
    val lon: Double,
    val p: Double,
    val q: Double,
    val grade: String,
    val type: String,
    val cover: Double,
    val covers: List<Double>,
    val baseKm: Double,
    val dKm: Double?,
    val durMin: Double,
    val aod: Double,
    val cloud: Double,
    val t550: Double,
    val color: String,
    val occ: Double,
    val ref: Double,
    val refGap: Double,
    val ensP: Double,
    val ensQ: Double
)

data class PackMapPeriod(
    val dateS: String,
    val period: String,
    val note: String,
    val pts: List<PackMapPoint>
)

data class PackMapBox(val am: PackMapPeriod, val pm: PackMapPeriod)

data class PackPointSummary(
    val dateStr: String,
    val period: String,
    val name: String,
    val p: Double,
    val q: Double,
    val grade: String,
    val consist: Double,
    val dvI: Double?,
    val confLevel: String,
    val confKey: String
)

fun decodePack(raw: String?): PackSnapshot? {
    val text = raw?.trim().orEmpty()
    if (text.isEmpty() || text.length > PACK_HARD_MAX) return null
    val bytes = try {
        when (text[0]) {
            'z' -> inflate(b64u(text.substring(1)))
            'j' -> b64u(text.substring(1))
            else -> return null
        }
    } catch (e: Exception) {
        return null
    } ?: return null
    if (bytes.size > 1_048_576) return null

    val root = try {
        Json.parseToJsonElement(String(bytes, Charsets.UTF_8)).jsonObject
    } catch (e: Exception) {
        return null
    }
    if (root["v"]?.jsonPrimitive?.intOrNull != PACK_VER) return null
    val e = root["e"] as? JsonArray ?: return null
    if (e.size > PACK_ENTRY_MAX) return null
    val qObj = root["q"] as? JsonObject ?: return null

    val entries = ArrayList<PackEntry>(e.size)
    for (item in e) {
        val pair = item as? JsonArray ?: continue
        if (pair.size != 2) continue
        val key = (pair[0] as? JsonPrimitive)?.contentOrNullSafe() ?: continue
        if (!allowedPackKey(key)) continue
        val value = pair[1] as? JsonObject ?: continue
        entries.add(PackEntry(key, value))
    }
    if (entries.isEmpty()) return null

    val meta = PackMeta(
        name = qObj.str("n"),
        date = qObj.str("d"),
        period = qObj.str("p"),
        mapDate = qObj.str("md"),
        lat = qObj.num("la") ?: 0.0,
        lon = qObj.num("lo") ?: 0.0
    )
    if (meta.date.isNotBlank() && !Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(meta.date)) return null
    if (meta.period.isNotBlank() && meta.period != "am" && meta.period != "pm") return null

    return PackSnapshot(
        gen = root["g"]?.jsonPrimitive?.longOrNull ?: 0L,
        q = meta,
        entries = entries
    )
}

/** 编码：与网页 encodePack 同构，默认 deflate；字符超 PACK_MAX_CHARS 返回 null。 */
fun encodePack(gen: Long, q: PackMeta, entries: List<PackEntry>): String? {
    if (entries.isEmpty() || entries.size > PACK_ENTRY_MAX) return null
    val root = buildJsonObject {
        put("v", PACK_VER)
        put("g", gen)
        put("q", buildJsonObject {
            put("n", q.name)
            put("d", q.date)
            put("p", q.period)
            put("md", q.mapDate)
            put("la", q.lat)
            put("lo", q.lon)
        })
        put("e", JsonArray(entries.map { entry ->
            JsonArray(listOf(JsonPrimitive(entry.key), entry.value))
        }))
    }
    val bytes = root.toString().toByteArray(Charsets.UTF_8)
    val out = deflate(bytes) ?: return null
    val pack = "z" + b64uEncode(out)
    return if (pack.length <= PACK_MAX_CHARS) pack else null
}

/* ------------------------------------------------------------ 观测场展开 */

fun expandPackMap(entry: PackEntry?): PackMapBox? {
    if (entry == null) return null
    val cm = entry.value["cm"] as? JsonObject ?: return null
    if (cm["m"]?.jsonPrimitive?.intOrNull != 1) return null
    val strings = (cm["s"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNullSafe() } ?: return null
    val rows = (cm["r"] as? JsonArray) ?: return null
    val na = (cm["na"]?.jsonPrimitive?.intOrNull ?: 0).coerceIn(0, rows.size)
    val dateS = cm.str("d")
    val notes = cm["n"] as? JsonArray
    val noteAm = (notes?.getOrNull(0) as? JsonPrimitive)?.contentOrNullSafe().orEmpty()
    val notePm = (notes?.getOrNull(1) as? JsonPrimitive)?.contentOrNullSafe().orEmpty()

    fun s(i: Int): String = strings.getOrElse(i) { "" }

    fun rowOf(item: JsonArray): PackMapPoint? {
        if (item.size < PACK_ROW_LEN) return null
        fun v(i: Int): Double = item[i].jsonPrimitive.doubleOrNull ?: 0.0
        fun iv(i: Int): Int = item[i].jsonPrimitive.intOrNull ?: 0
        fun nil(i: Int): Boolean = iv(i) >= 255
        fun n(i: Int): Double? = if (nil(i)) null else v(i)
        return PackMapPoint(
            name = s(iv(0)), prov = s(iv(1)),
            lat = v(2) / 100.0, lon = v(3) / 100.0,
            p = v(4), q = v(5),
            grade = s(iv(29)), type = s(iv(30)), color = s(iv(31)),
            cover = v(16),
            covers = listOf(v(17), v(18), v(19)),
            baseKm = v(20) / 10.0,
            dKm = n(21)?.let { it * 2.0 },
            durMin = v(22), aod = v(23) / 100.0, cloud = v(24), t550 = v(25),
            occ = v(26), ref = v(27), refGap = v(28),
            ensP = v(6), ensQ = v(11)
        )
    }

    fun period(rows2: List<JsonArray>, period: String, note: String) = PackMapPeriod(
        dateS = dateS, period = period, note = note,
        pts = rows2.mapNotNull { rowOf(it) }
    )

    val amRows = rows.take(na).mapNotNull { it as? JsonArray }
    val pmRows = rows.drop(na).mapNotNull { it as? JsonArray }
    return PackMapBox(
        am = period(amRows, "am", noteAm),
        pm = period(pmRows, "pm", notePm)
    )
}

/** 从包里取出单点结论的摘要字段，供快照横幅与结果卡使用 */
fun packPointSummary(snap: PackSnapshot): PackPointSummary? {
    val entry = snap.entries.firstOrNull { it.key.startsWith("SUNGLOW.v2.point.") } ?: return null
    val obj = entry.value["obj"] as? JsonObject ?: return null
    return PackPointSummary(
        dateStr = obj.str("dateStr").ifBlank { snap.q.date },
        period = obj.str("period").ifBlank { snap.q.period },
        name = ((obj["city"] as? JsonObject)?.str("name")).orEmpty().ifBlank { snap.q.name },
        p = obj.num("P") ?: 0.0,
        q = obj.num("Q") ?: 0.0,
        grade = obj.str("grade"),
        consist = obj.num("consist") ?: 0.0,
        dvI = obj.num("dvI"),
        confLevel = ((obj["conf"] as? JsonObject)?.str("level")).orEmpty(),
        confKey = ((obj["conf"] as? JsonObject)?.str("key")).orEmpty()
    )
}

/* ------------------------------------------------------------------ 工具 */

private fun allowedPackKey(k: String): Boolean =
    PACK_FAMILIES.any { k.startsWith(it) } || k == PACK_CMP_KEY

private fun JsonPrimitive.contentOrNullSafe(): String? =
    if (this is JsonPrimitive) content else null

private fun JsonObject.str(k: String): String = this[k]?.jsonPrimitive?.content ?: ""

private fun JsonObject.num(k: String): Double? =
    (this[k] as? JsonPrimitive)?.doubleOrNull

private fun b64u(s: String): ByteArray {
    var t = s.replace('-', '+').replace('_', '/').replace(Regex("[^A-Za-z0-9+/]"), "")
    while (t.length % 4 != 0) t += "="
    return Base64.getDecoder().decode(t)
}

private fun b64uEncode(b: ByteArray): String =
    Base64.getUrlEncoder().withoutPadding().encodeToString(b)

private fun deflate(src: ByteArray): ByteArray? = try {
    val d = Deflater(Deflater.BEST_COMPRESSION)
    d.setInput(src)
    d.finish()
    val out = ByteArrayOutputStream()
    val buf = ByteArray(8192)
    while (!d.finished()) {
        val n = d.deflate(buf)
        if (n > 0) out.write(buf, 0, n)
    }
    d.end()
    out.toByteArray()
} catch (e: Exception) {
    null
}

private fun inflate(src: ByteArray): ByteArray? {
    return try {
        val inf = Inflater()
        inf.setInput(src)
        val out = ByteArrayOutputStream()
        val buf = ByteArray(8192)
        var guard = 0
        while (!inf.finished() && guard < 256) {
            val n = inf.inflate(buf)
            if (n > 0) {
                if (out.size() + n > 1_048_576) {
                    inf.end()
                    return null
                }
                out.write(buf, 0, n)
            } else if (inf.needsInput()) break
            guard++
        }
        inf.end()
        if (out.size() == 0) null else out.toByteArray()
    } catch (e: Exception) {
        null
    }
}
