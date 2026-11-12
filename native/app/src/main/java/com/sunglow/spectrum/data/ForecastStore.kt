package com.sunglow.spectrum.data

import android.content.Context
import com.sunglow.spectrum.core.ForecastResult
import com.sunglow.spectrum.core.Period
import com.sunglow.spectrum.core.glowWindow
import org.json.JSONObject
import java.io.File

/*
 * SUNGLOW · 当日结论的磁盘快照
 * 主界面、桌面小组件、霞光提醒共用同一份数据：App 每次取数成功后落盘，
 * 后台任务优先读它，读不到再联网。只存结论所需的最小字段，不复制整份模型。
 */

data class PeriodSnapshot(
    val p: Double,
    val q: Double,
    val grade: String,
    val windowStart: Long?,
    val windowEnd: Long?
)

data class DaySnapshot(
    val city: String,
    val lat: Double,
    val lon: Double,
    val date: String,
    val am: PeriodSnapshot?,
    val pm: PeriodSnapshot?,
    val updatedAt: Long
)

object ForecastStore {

    private const val FILE = "forecast_store.json"
    private const val MAX_DAYS = 40
    private val lock = Any()

    fun save(ctx: Context, r: ForecastResult) {
        val win = glowWindow(
            evMs = r.evMs,
            isAM = r.period == Period.AM,
            lat = r.city.lat,
            lon = r.city.lon,
            thNearDeg = r.sRT.geom.thNearDeg,
            thFarDeg = r.sRT.geom.thFarDeg
        )
        val ps = PeriodSnapshot(
            p = r.p,
            q = r.q,
            grade = r.grade,
            windowStart = win?.first?.toLong(),
            windowEnd = win?.second?.toLong()
        )
        synchronized(lock) {
            val root = readRoot(ctx)
            val key = r.city.name + "|" + r.dateStr
            val day = root.optJSONObject(key) ?: JSONObject()
            day.put("city", r.city.name)
            day.put("lat", r.city.lat)
            day.put("lon", r.city.lon)
            day.put("date", r.dateStr)
            day.put(if (r.period == Period.AM) "am" else "pm", encode(ps))
            day.put("updatedAt", System.currentTimeMillis())
            root.put(key, day)
            prune(root)
            writeRoot(ctx, root)
        }
    }

    fun day(ctx: Context, city: String, date: String): DaySnapshot? = synchronized(lock) {
        val obj = readRoot(ctx).optJSONObject(city + "|" + date) ?: return null
        parse(obj)
    }

    fun latest(ctx: Context, city: String): DaySnapshot? = synchronized(lock) {
        val root = readRoot(ctx)
        var best: DaySnapshot? = null
        for (k in root.keys()) {
            val o = root.optJSONObject(k) ?: continue
            if (o.optString("city") != city) continue
            val d = parse(o) ?: continue
            if (best == null || d.updatedAt > best!!.updatedAt) best = d
        }
        best
    }

    fun clear(ctx: Context) {
        synchronized(lock) {
            runCatching { fileOf(ctx).delete() }
        }
    }

    /* ---------- 内部 ---------- */

    private fun fileOf(ctx: Context): File = File(ctx.filesDir, FILE)

    private fun readRoot(ctx: Context): JSONObject = runCatching {
        val f = fileOf(ctx)
        if (f.exists()) JSONObject(f.readText()) else JSONObject()
    }.getOrElse { JSONObject() }

    private fun writeRoot(ctx: Context, root: JSONObject) {
        runCatching {
            val f = fileOf(ctx)
            f.writeText(root.toString())
        }
    }

    private fun prune(root: JSONObject) {
        if (root.length() <= MAX_DAYS) return
        val keys = root.keys().asSequence().toList()
            .sortedByDescending { root.optJSONObject(it)?.optLong("updatedAt") ?: 0L }
        for (k in keys.drop(MAX_DAYS)) root.remove(k)
    }

    private fun encode(ps: PeriodSnapshot): JSONObject = JSONObject().apply {
        put("p", ps.p)
        put("q", ps.q)
        put("grade", ps.grade)
        put("ws", ps.windowStart ?: JSONObject.NULL)
        put("we", ps.windowEnd ?: JSONObject.NULL)
    }

    private fun decode(o: JSONObject?): PeriodSnapshot? {
        if (o == null) return null
        return PeriodSnapshot(
            p = o.optDouble("p", Double.NaN),
            q = o.optDouble("q", Double.NaN),
            grade = o.optString("grade"),
            windowStart = if (o.isNull("ws")) null else o.optLong("ws"),
            windowEnd = if (o.isNull("we")) null else o.optLong("we")
        )
    }

    private fun parse(o: JSONObject): DaySnapshot? {
        val city = o.optString("city")
        if (city.isBlank()) return null
        return DaySnapshot(
            city = city,
            lat = o.optDouble("lat", 0.0),
            lon = o.optDouble("lon", 0.0),
            date = o.optString("date"),
            am = decode(o.optJSONObject("am")),
            pm = decode(o.optJSONObject("pm")),
            updatedAt = o.optLong("updatedAt")
        )
    }
}
