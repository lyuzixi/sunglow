package com.sunglow.spectrum.core

/*
 * SUNGLOW · 模式序列
 * 口径来源：v2/src/core/series.ts（V1 makeSeries/mergeSeries）。
 * 一条序列 = 一份 Open-Meteo 逐小时响应；两套模式逐时平均出综合场。
 */

data class SeriesRow(val t: Double, val v: Double?)

class Series(val raw: Map<String, List<SeriesRow>>, val tz: TzInfo) : SeriesReader {

    /** 小时序列线性插值：与 TS 的 at() 逐语义一致（端点夹取、单侧缺数取另一侧） */
    override fun at(key: String, ms: Long): Double? {
        val rows = raw[key] ?: return null
        if (rows.isEmpty()) return null
        val x = ms.toDouble()
        if (x <= rows[0].t) return rows[0].v
        if (x >= rows[rows.size - 1].t) return rows[rows.size - 1].v
        var lo = 0
        var hi = rows.size - 1
        while (hi - lo > 1) {
            val mid = (lo + hi) shr 1
            if (rows[mid].t <= x) lo = mid else hi = mid
        }
        val a = rows[lo].v
        val b = rows[hi].v
        if (!isNum(a)) return if (isNum(b)) b else null
        if (!isNum(b)) return a
        val t0 = rows[lo].t
        val t1 = rows[hi].t
        val f = if (t1 == t0) 0.0 else (x - t0) / (t1 - t0)
        return a!! + (b!! - a) * f
    }

    fun has(key: String): Boolean = raw[key]?.isNotEmpty() == true
}

/** 两套模式逐时平均（综合场） */
fun mergeSeries(a: Series?, b: Series?): Series? {
    if (a == null) return b
    if (b == null) return a
    val keys = LinkedHashSet<String>()
    keys.addAll(a.raw.keys)
    keys.addAll(b.raw.keys)
    val raw = LinkedHashMap<String, List<SeriesRow>>()
    for (k in keys) {
        val ra = a.raw[k].orEmpty()
        val rb = b.raw[k].orEmpty()
        val map = HashMap<Double, Array<Double?>>()
        fun slot(t: Double): Array<Double?> = map.getOrPut(t) { arrayOfNulls(2) }
        for (r in ra) slot(r.t)[0] = r.v
        for (r in rb) slot(r.t)[1] = r.v
        val ts = map.keys.sorted()
        raw[k] = ts.map { t ->
            val pair = map.getValue(t)
            val x = pair[0]
            val y = pair[1]
            val v = when {
                isNum(x) && isNum(y) -> (x!! + y!!) / 2
                isNum(x) -> x
                isNum(y) -> y
                else -> null
            }
            SeriesRow(t, v)
        }
    }
    return Series(raw, a.tz)
}

/** 气压稳定性：事件前后 1 小时变化率 */
fun pressureTrend(reader: SeriesReader?, tMs: Long): Double? {
    if (reader == null) return null
    val a = reader.at("pressure_msl", tMs - 3600000L)
    val b = reader.at("pressure_msl", tMs + 3600000L)
    if (!isNum(a) || !isNum(b)) return null
    return kotlin.math.abs(b!! - a!!) / 2
}

/** 风向风速的方位分量 */
fun alongComponent(ws: Double?, wd: Double?, az: Double?): Double? {
    if (!isNum(ws) || !isNum(wd) || !isNum(az)) return null
    val d = kotlin.math.abs(((wd!! - az!! + 540) % 360) - 180)
    return kotlin.math.abs(ws!! * kotlin.math.cos(d * kotlin.math.PI / 180))
}
