package com.sunglow.spectrum.core

import com.sunglow.spectrum.data.LatLon
import com.sunglow.spectrum.data.OpenMeteoClient
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.roundToLong

/*
 * SUNGLOW · 观测场热力面
 * 口径来源：v2/src/core/mapdata.ts 的 buildLocalGrid + scoreGridPoint。
 * 15×15 = 225 点铺满城市周边（半跨 3.0°≈330 km，整幅约 660 km 见方）。
 * 每个网格点只取一条 Series；样带不是额外取数，而是用 IDW 从邻近网格点的
 * 云量插值出来（与网页同构），因此一次热力面只需 3 批 × 3 个接口 = 9 个请求。
 */

const val HEAT_N = 15
const val HEAT_HALF_DEG = 3.0

private const val HEAT_BATCH = 75

/** 采样可达距离：离最近网格点超过这个距离就不着色 */
private const val HEAT_IDW_MAX = 100.0

data class HeatCell(
    val i: Int,
    val j: Int,
    val lat: Double,
    val lon: Double,
    val p: Double,
    val q: Double,
    /** 综合指数 I = 0.55P + 0.45Q */
    val idx: Double,
    val grade: String,
    val type: String,
    val cover: Double,
    val d: Double?
)

class HeatGrid(
    val dateStr: String,
    val period: Period,
    val n: Int,
    val lat0: Double,
    val lon0: Double,
    val dLat: Double,
    val dLon: Double,
    val cells: List<HeatCell>
) {
    private val index: Map<Int, HeatCell> by lazy { cells.associateBy { it.i * n + it.j } }

    fun latOf(i: Int): Double = lat0 - i * dLat
    fun lonOf(j: Int): Double = lon0 + j * dLon

    fun cellAt(i: Int, j: Int): HeatCell? {
        if (i < 0 || j < 0 || i >= n || j >= n) return null
        return index[i * n + j]
    }

    /** 整幅覆盖的南北/东西边长（km），用于界面与分享图标注 */
    fun spanKm(): Double = haversineKm(lat0, lon0, lat0 - (n - 1) * dLat, lon0 + (n - 1) * dLon)
}

private data class HeatLayout(
    val n: Int,
    val lat0: Double,
    val lon0: Double,
    val dLat: Double,
    val dLon: Double
) {
    fun latOf(i: Int): Double = lat0 - i * dLat
    fun lonOf(j: Int): Double = lon0 + j * dLon

    fun points(): List<LatLon> = buildList {
        for (i in 0 until n) for (j in 0 until n) add(LatLon(latOf(i), lonOf(j)))
    }
}

private data class HeatMeta(val evMs: Double, val az: Double, val omega: Double)

private class IdwPlan(val exact: Int, val idx: IntArray, val w: DoubleArray)

private fun layoutOf(city: City): HeatLayout {
    val n = HEAT_N
    val dLat = 2 * HEAT_HALF_DEG / (n - 1)
    /* 东西向按纬度收缩，保证整幅大致是正方形（公里尺度） */
    val lonHalf = HEAT_HALF_DEG / max(0.2, cos(city.lat * DEG))
    val dLon = 2 * lonHalf / (n - 1)
    return HeatLayout(n, city.lat + HEAT_HALF_DEG, city.lon - lonHalf, dLat, dLon)
}

private fun idwPlan(lat: Double, lon: Double, pts: List<LatLon>): IdwPlan? {
    var near = Double.MAX_VALUE
    val idx = IntArray(pts.size)
    val w = DoubleArray(pts.size)
    for (k in pts.indices) {
        val d = haversineKm(lat, lon, pts[k].lat, pts[k].lon)
        if (d < near) near = d
        if (d < 1e-6) return IdwPlan(k, IntArray(0), DoubleArray(0))
        idx[k] = k
        w[k] = 1.0 / (d * d)
    }
    if (near > HEAT_IDW_MAX) return null
    return IdwPlan(-1, idx, w)
}

private fun idwOf(plan: IdwPlan?, vals: List<Double?>): Double? {
    if (plan == null) return null
    if (plan.exact >= 0) return vals.getOrNull(plan.exact)
    var sw = 0.0
    var sv = 0.0
    for (k in plan.idx.indices) {
        val v = vals.getOrNull(plan.idx[k])
        if (!isNum(v)) continue
        sw += plan.w[k]
        sv += plan.w[k] * v!!
    }
    return if (sw > 0) sv / sw else null
}

/**
 * 生成热力面。任意一批取数失败只影响那一块区域（留空透明），不推翻全局结果。
 * onProgress(done, total)：取数 9 步 + 逐行计算 15 步。
 */
suspend fun buildHeatGrid(
    client: OpenMeteoClient,
    city: City,
    dateStr: String,
    period: Period,
    onProgress: (Int, Int) -> Unit = { _, _ -> }
): HeatGrid? {
    val parts = dateStr.split("-")
    if (parts.size != 3) return null
    val y = parts[0].toIntOrNull() ?: return null
    val mo = parts[1].toIntOrNull() ?: return null
    val da = parts[2].toIntOrNull() ?: return null
    val tz = TzCache.cityTz(city.lat, city.lon)
    val dayAnchor = utcMillis(y, mo, da) - tz.offsetSec * 1000L

    val layout = layoutOf(city)
    val pts = layout.points()
    val count = pts.size
    val sG = arrayOfNulls<Series>(count)
    val sE = arrayOfNulls<Series>(count)
    val sA = arrayOfNulls<Series>(count)

    val batches = pts.chunked(HEAT_BATCH)
    val totalSteps = batches.size * 3 + layout.n
    var step = 0
    fun bump() {
        step++
        onProgress(step, totalSteps)
    }

    for ((bi, chunk) in batches.withIndex()) {
        val from = bi * HEAT_BATCH

        runCatching { client.forecastBatched(MODEL_GFS, chunk, dateStr, dateStr, F_VARS) }
            .getOrNull()
            ?.forEachIndexed { k, s -> if (from + k < count) sG[from + k] = s }
        bump()

        runCatching { client.forecastBatched(MODEL_EC, chunk, dateStr, dateStr, F_VARS) }
            .getOrNull()
            ?.forEachIndexed { k, s -> if (from + k < count) sE[from + k] = s }
        bump()

        runCatching { client.aqBatched(chunk, dateStr, dateStr) }
            .getOrNull()
            ?.forEachIndexed { k, s -> if (from + k < count) sA[from + k] = s }
        bump()
    }
    if (sG.all { it == null }) return null

    /* 逐点事件时刻 / 方位 / 高度角变化率 —— 与 buildPointMeta 同构 */
    val meta = pts.map { p ->
        val ev = sunEvents(dayAnchor, p.lat, p.lon)
        val raw = if (period == Period.AM) ev.riseMs else ev.setMs
        val evMs = raw ?: (ev.noonMs + 12 * 3600000.0)
        HeatMeta(
            evMs = evMs,
            az = solarPosition(evMs, p.lat, p.lon).azimuth,
            omega = sunAltRate(evMs, p.lat, p.lon)
        )
    }

    /* 综合场（GFS/EC 逐时平均）一次算好，样带插值复用 */
    val sM = Array(count) { k -> mergeSeries(sG[k], sE[k]) }

    val cells = ArrayList<HeatCell>(count)
    for (i in 0 until layout.n) {
        for (j in 0 until layout.n) {
            val k = i * layout.n + j
            if (sG[k] == null) continue
            val m = meta[k]
            val evT = m.evMs.roundToLong()
            val aodRaw = sA[k]?.at("aerosol_optical_depth", evT)
            val aodUse = if (isNum(aodRaw)) clamp(aodRaw!!, 0.005, 5.0) else 0.25

            fun transectOf(sers: Array<Series?>): List<TransectPt>? {
                val own = sers[k] ?: return null
                val base = pts[k]
                val lowVals = sers.map { it?.at("cloud_cover_low", evT) }
                val midVals = sers.map { it?.at("cloud_cover_mid", evT) }
                val highVals = sers.map { it?.at("cloud_cover_high", evT) }
                val visVals = sers.map { it?.at("visibility", evT) }
                val rows = ArrayList<TransectPt>(TRANSECT.size)
                rows.add(
                    TransectPt(
                        d = 0.0,
                        cLow = own.at("cloud_cover_low", evT),
                        cMid = own.at("cloud_cover_mid", evT),
                        cHigh = own.at("cloud_cover_high", evT),
                        vis = own.at("visibility", evT),
                        aod = aodUse
                    )
                )
                for (t in 1 until TRANSECT.size) {
                    val d = TRANSECT[t]
                    val tp = destPoint(base.lat, base.lon, m.az, d.toDouble())
                    val plan = idwPlan(tp.first, tp.second, pts)
                    rows.add(
                        TransectPt(
                            d = d.toDouble(),
                            cLow = idwOf(plan, lowVals),
                            cMid = idwOf(plan, midVals),
                            cHigh = idwOf(plan, highVals),
                            vis = idwOf(plan, visVals),
                            aod = aodUse
                        )
                    )
                }
                return rows
            }

            val trG = transectOf(sG) ?: continue
            val trM = transectOf(sM) ?: continue
            val trE = if (sE[k] != null) transectOf(sE) else null

            val envG = buildEnv(sG[k], evT, aodUse)
            val envM = buildEnv(sM[k], evT, aodUse)
            val envE = if (sE[k] != null) buildEnv(sE[k], evT, aodUse).let { e ->
                e.copy(
                    fz = e.fz ?: envG.fz,
                    blh = e.blh ?: envG.blh,
                    vis = e.vis ?: envG.vis,
                    cape = e.cape ?: envG.cape,
                    precip = e.precip ?: envG.precip
                )
            } else null

            val ctx = ScoreCtx(v = 1.5, omega = m.omega, dP = null, aod = aodUse)
            val sRT = scoreRay(
                envM,
                summaryOf(analyseTransect(trM, primaryDeckOf(envM).primary.key)),
                ctx
            )
            val sGv = scoreStat(
                envG,
                summaryOf(analyseTransect(trG, primaryDeckOf(envG).primary.key)),
                ctx
            )
            val sEv = if (envE != null && trE != null) {
                scoreStat(
                    envE,
                    summaryOf(analyseTransect(trE, primaryDeckOf(envE).primary.key)),
                    ctx
                )
            } else null

            val pParts = mutableListOf<Pair<Double?, Double>>()
            pParts.add(sGv.p to W_ENS.getValue("gfs"))
            if (sEv != null) pParts.add(sEv.p to W_ENS.getValue("ec"))
            pParts.add(sRT.p to W_ENS.getValue("rt"))
            val qParts = mutableListOf<Pair<Double?, Double>>()
            qParts.add(sGv.q to W_ENS.getValue("gfs"))
            if (sEv != null) qParts.add(sEv.q to W_ENS.getValue("ec"))
            qParts.add(sRT.q to W_ENS.getValue("rt"))

            val p = wgeo(pParts)
            val q = wgeo(qParts)
            cells.add(
                HeatCell(
                    i = i,
                    j = j,
                    lat = pts[k].lat,
                    lon = pts[k].lon,
                    p = p,
                    q = q,
                    idx = mixedIndex(p, q),
                    grade = gradeOf(q),
                    type = sRT.primary.type,
                    cover = sRT.primary.cover,
                    d = sRT.d
                )
            )
        }
        bump()
    }

    if (cells.isEmpty()) return null
    return HeatGrid(
        dateStr = dateStr,
        period = period,
        n = layout.n,
        lat0 = layout.lat0,
        lon0 = layout.lon0,
        dLat = layout.dLat,
        dLon = layout.dLon,
        cells = cells
    )
}
