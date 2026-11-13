package com.sunglow.spectrum.core

import com.sunglow.spectrum.data.LatLon
import com.sunglow.spectrum.data.OpenMeteoClient
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.roundToLong

/*
 * SUNGLOW · 观测场热力面
 * 口径来源：v2/src/core/mapdata.ts 的 buildLocalGrid + scoreGridPoint。
 * 13×13 包围盒（±6 格）× 80 km 格距，按 500 km 半径过滤掉四角 → 121 点，
 * 与网页逐点同构（经纬度、格距、半径全部取自 buildLocalGrid）。
 * 每个网格点只取一条 Series；样带不是额外取数，而是用 IDW 从邻近网格点的
 * 云量插值出来（与网页同构），因此一次热力面只需 2 批 × 3 个接口 = 6 个请求。
 */

const val HEAT_N = 13
const val HEAT_STEP_KM = 80.0
const val HEAT_RADIUS_KM = 500.0

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
    val d: Double?,
    /** 光路遮挡 0–100（与评分 block 因子同源；四档见 occBandOf） */
    val occ: Double = 0.0,
    /** 五因子参考分 0–100（独立旁证，不参与加权） */
    val ref: Double = 0.0,
    /** 空间形态分歧 0–100（ref 与综合指数各自标准化后取差 ×33） */
    val refGap: Double = 0.0
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

    /** 整幅包围盒边长（km）：13 格 × 80 km = 960 km，实际着色范围是 500 km 半径圆 */
    fun spanKm(): Double = HEAT_STEP_KM * (n - 1)
}

/** 一个格点在 13×13 包围盒里的行列号与经纬度；四角被半径过滤掉的点不会出现 */
data class HeatNode(
    val i: Int,
    val j: Int,
    val lat: Double,
    val lon: Double
)

private data class HeatLayout(
    val n: Int,
    val lat0: Double,
    val lon0: Double,
    val dLat: Double,
    val dLon: Double,
    val nodes: List<HeatNode>
) {
    fun latOf(i: Int): Double = lat0 - i * dLat
    fun lonOf(j: Int): Double = lon0 + j * dLon
}

private data class HeatMeta(val evMs: Double, val az: Double, val omega: Double)

private class IdwPlan(val exact: Int, val idx: IntArray, val w: DoubleArray)

/**
 * 与网页 buildLocalGrid 同构：
 *   dLa = 80 / 110.574；dLo = 80 / (111.32 × max(0.15, cos(lat)))；
 *   nSide = floor(500 / 80) = 6；i、j ∈ [-6, 6]；
 *   kx = j × 80、ky = i × 80，kx² + ky² > 500² 的点丢弃（正好剩 121 点）；
 *   纬度 clamp(-85, 85)，经度 ((lon + j × dLo + 540) % 360) - 180。
 */
private fun layoutOf(lat: Double, lon: Double): HeatLayout {
    val dLa = HEAT_STEP_KM / 110.574
    val dLo = HEAT_STEP_KM / (111.32 * max(0.15, cos(lat * DEG)))
    val nSide = (HEAT_RADIUS_KM / HEAT_STEP_KM).toInt()
    val n = 2 * nSide + 1
    val nodes = buildList {
        for (i in 0 until n) {
            for (j in 0 until n) {
                val ky = (i - nSide) * HEAT_STEP_KM
                val kx = (j - nSide) * HEAT_STEP_KM
                if (kx * kx + ky * ky > HEAT_RADIUS_KM * HEAT_RADIUS_KM + 1e-6) continue
                val la = clamp(lat + (i - nSide) * dLa, -85.0, 85.0)
                val lo = ((lon + (j - nSide) * dLo + 540.0) % 360.0) - 180.0
                add(HeatNode(i, j, la, lo))
            }
        }
    }
    val lat0 = clamp(lat + nSide * dLa, -85.0, 85.0)
    val lon0 = lon - nSide * dLo
    return HeatLayout(n, lat0, lon0, dLa, dLo, nodes)
}

/** 单测入口：给定城市中心，返回与网页同口径的 121 个格点 */
internal fun heatNodesOf(lat: Double, lon: Double): List<HeatNode> = layoutOf(lat, lon).nodes

/** 单测入口：返回 (包围盒边长 n, 北界 lat0, 西界 lon0, 纬向格距, 经向格距) */
internal fun heatFrameOf(lat: Double, lon: Double): List<Double> =
    layoutOf(lat, lon).let { listOf(it.n.toDouble(), it.lat0, it.lon0, it.dLat, it.dLon) }

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
 * onProgress(done, total)：取数 6 步 + 汇总 1 步。
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

    val layout = layoutOf(city.lat, city.lon)
    val nodes = layout.nodes
    val pts = nodes.map { LatLon(it.lat, it.lon) }
    val count = pts.size
    val sG = arrayOfNulls<Series>(count)
    val sE = arrayOfNulls<Series>(count)
    val sA = arrayOfNulls<Series>(count)

    val batches = pts.chunked(HEAT_BATCH)
    val totalSteps = batches.size * 3 + 1
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
    val meta = nodes.map { n ->
        val ev = sunEvents(dayAnchor, n.lat, n.lon)
        val raw = if (period == Period.AM) ev.riseMs else ev.setMs
        val evMs = raw ?: (ev.noonMs + 12 * 3600000.0)
        HeatMeta(
            evMs = evMs,
            az = solarPosition(evMs, n.lat, n.lon).azimuth,
            omega = sunAltRate(evMs, n.lat, n.lon)
        )
    }

    /* 综合场（GFS/EC 逐时平均）一次算好，样带插值复用 */
    val sM = Array(count) { k -> mergeSeries(sG[k], sE[k]) }

    val cells = ArrayList<HeatCell>(count)
    for ((k, node) in nodes.withIndex()) {
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
            val pdM = primaryDeckOf(envM)
            val trMA = analyseTransect(trM, pdM.primary.key)
            val sRT = scoreRay(envM, summaryOf(trMA), ctx)
            /* 遮挡层：与网页 mapdata 同源同表（blockFactor），缺样带上游值时退回本地该层云量 */
            val occ = clamp(
                100.0 * (1.0 - blockFactor(
                    pdM.primary.level,
                    if (isNum(trMA.upstreamLowMax)) trMA.upstreamLowMax else envM.cLow,
                    if (isNum(trMA.upstreamMidMax)) trMA.upstreamMidMax else envM.cMid
                )),
                0.0,
                100.0
            )
            /* 独立旁证：五因子参考分（不参与加权，见 RefModel.kt 文件头） */
            val ref = refScore(envM).v
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
                    i = node.i,
                    j = node.j,
                    lat = node.lat,
                    lon = node.lon,
                    p = p,
                    q = q,
                    idx = mixedIndex(p, q),
                    grade = gradeOf(q),
                    type = sRT.primary.type,
                    cover = sRT.primary.cover,
                    d = sRT.d,
                    occ = occ,
                    ref = ref
                )
            )
    }
    bump()

    if (cells.isEmpty()) return null
    /* 空间形态分歧：两套模型各自在全图标准化后再取差（网页 finalizeRefGap 同构） */
    val gaps = finalizeRefGap(cells.map { it.ref }, cells.map { it.idx })
    val withGap = cells.mapIndexed { i, c -> if (i < gaps.size) c.copy(refGap = gaps[i]) else c }
    return HeatGrid(
        dateStr = dateStr,
        period = period,
        n = layout.n,
        lat0 = layout.lat0,
        lon0 = layout.lon0,
        dLat = layout.dLat,
        dLon = layout.dLon,
        cells = withGap
    )
}
