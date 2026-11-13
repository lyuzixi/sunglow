package com.sunglow.spectrum.core

import com.sunglow.spectrum.data.LatLon
import com.sunglow.spectrum.data.OpenMeteoClient
import com.sunglow.spectrum.data.WeatherErrorKind
import com.sunglow.spectrum.data.WeatherException
import com.sunglow.spectrum.data.friendly
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong
import java.util.Locale

/*
 * SUNGLOW · 预报编排
 * 口径来源：v2/src/core/forecast.ts。
 * 把「取数 → 样带 → 三套算法 → 综合」串成一次可渲染的结果：
 *   GFS/EC 走统计判据模型（scoreStat），光追走纯物理模型（scoreRay）。
 */

const val MODEL_GFS = "gfs_seamless"
const val MODEL_EC = "ecmwf_ifs025"

/* 单点精细预报所需字段（只请求真正参与计算的量）。 */
val F_VARS: List<String> = listOf(
    "temperature_2m", "dew_point_2m", "relative_humidity_2m",
    "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "visibility",
    "pressure_msl", "wind_speed_10m", "wind_direction_10m",
    "boundary_layer_height", "freezing_level_height",
    "precipitation", "cape"
)

/* 沿日出入方位 0–400 km，每 25 km 一个采样点 */
val TRANSECT: List<Int> = listOf(
    0, 25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400
)

const val NO_DATA_MSG = "这次没有取到数据：气象接口没有响应或网络中断。稍后点「重新计算」再试一次。"

@Serializable
data class ModelRow(val id: String, val label: String, val p: Double, val q: Double)

@Serializable
data class ForecastResult(
    val dateStr: String,
    val period: Period,
    val city: City,
    val tz: TzInfo,
    val evName: String,
    val evMs: Double,
    val evAz: Double,
    val events: SunEvents,
    val leadH: Double,
    val omega: Double,
    val envM: Env,
    val sRT: RayResult,
    val sG: StatResult,
    val sE: StatResult?,
    val models: List<ModelRow>,
    val p: Double,
    val q: Double,
    val grade: String,
    val consist: Double,
    val dvI: Double?,
    val spread: Double?,
    val spreadQ: Double?,
    val conf: EnsBand,
    val factorRows: List<FacRow>,
    /** 合并后的样带（0–400 km，25 km 一档），供观测场地图画热力点 */
    val transect: List<TransectPt> = emptyList(),
    /** 本次没取到气溶胶（AOD），评分实际用了 0.25 兜底值 */
    val aodFallback: Boolean,
    val fromCache: Boolean = false
)

/** 失败分型：界面据此给出不同的文案与下一步动作 */
enum class FailureKind { NETWORK, TIMEOUT, RATE_LIMIT, NO_DATA, OTHER }

sealed interface ForecastOutcome {
    data class Success(val result: ForecastResult) : ForecastOutcome
    data class Failure(
        val message: String,
        val kind: FailureKind = FailureKind.OTHER
    ) : ForecastOutcome
}

/** 样带坐标：沿日出/日落方位，25 km 一档（d=0 就是城市本身） */
fun transectPoints(city: City, evAz: Double): List<LatLon> = TRANSECT.map { d ->
    if (d == 0) LatLon(city.lat, city.lon)
    else {
        val (la, lo) = destPoint(city.lat, city.lon, evAz, d.toDouble())
        LatLon(la, lo)
    }
}

internal fun summaryOf(t: TransectResult): TransectSummary = TransectSummary(
    hasDeck = t.hasDeck,
    dFar = t.dFar,
    upstreamAod = t.upstreamAod,
    upstreamLowMax = t.upstreamLowMax,
    upstreamMidMax = t.upstreamMidMax
)

/**
 * 纯计算段：给定三路序列，产出一次完整预报结果。
 * 拆出来是为了让单测能在没有网络的情况下跑通整条流水线。
 */
fun assembleForecast(
    city: City,
    dateStr: String,
    period: Period,
    tz: TzInfo,
    events: SunEvents,
    evMs: Double,
    evAz: Double,
    omega: Double,
    leadH: Double,
    sG: List<Series?>,
    sE: List<Series?>?,
    sA: List<Series?>?
): ForecastResult {
    val evT = evMs.roundToLong()
    val pts = transectPoints(city, evAz)
    val sM = sG.mapIndexed { i, g -> mergeSeries(g, sE?.getOrNull(i)) }

    val aodRow = sA?.firstOrNull()?.at("aerosol_optical_depth", evT)
    val aodUse = if (isNum(aodRow)) clamp(aodRow!!, 0.005, 5.0) else 0.25
    /* 没取到真值才算兜底：只要有数（哪怕极小）就不是默认值 */
    val aodFallback = !isNum(aodRow)

    fun trOf(sers: List<Series?>?): List<TransectPt>? {
        if (sers == null) return null
        return pts.indices.map { i ->
            val s = sers.getOrNull(i)
            TransectPt(
                d = TRANSECT[i].toDouble(),
                cLow = s?.at("cloud_cover_low", evT),
                cMid = s?.at("cloud_cover_mid", evT),
                cHigh = s?.at("cloud_cover_high", evT),
                vis = s?.at("visibility", evT),
                aod = aodUse
            )
        }
    }

    fun envOf(sers: List<Series?>?): Env = buildEnv(sers?.firstOrNull(), evT, aodUse)

    val trG = trOf(sG) ?: emptyList()
    val trE = trOf(sE)
    val trM = trOf(sM) ?: emptyList()

    val envG = envOf(sG)
    val envM = envOf(sM)
    /* EC 缺项时按 GFS 补齐（TS 同口径）：只补真值，不补兜底值 */
    val envE = if (sE != null) envOf(sE).let { e ->
        e.copy(
            fz = e.fz ?: envG.fz,
            blh = e.blh ?: envG.blh,
            vis = e.vis ?: envG.vis,
            cape = e.cape ?: envG.cape,
            precip = e.precip ?: envG.precip
        )
    } else null

    val dP = pressureTrend(sG.firstOrNull(), evT)
    val v = alongComponent(envM.ws, envM.wd, evAz)
    val vKmin = if (isNum(v)) v!! / 60 else 1.5
    val ctx = ScoreCtx(v = vKmin, omega = omega, dP = dP, aod = aodUse)

    val aM = analyseTransect(trM, primaryDeckOf(envM).primary.key)
    val sRT = scoreRay(envM, summaryOf(aM), ctx)
    val sGv = scoreStat(envG, summaryOf(analyseTransect(trG, primaryDeckOf(envG).primary.key)), ctx)
    val sEv = if (envE != null && trE != null) {
        scoreStat(envE, summaryOf(analyseTransect(trE, primaryDeckOf(envE).primary.key)), ctx)
    } else null

    val rows = buildList {
        add(ModelRow("gfs", "GFS 统计", sGv.p, sGv.q))
        if (sEv != null) add(ModelRow("ec", "EC 统计", sEv.p, sEv.q))
        add(ModelRow("rt", "光追物理", sRT.p, sRT.q))
    }.filter { isNum(it.p) }

    /* 综合＝非空子集按 W_ENS 的加权几何平均（与 V1 once() 一致） */
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

    val idxs = rows.map { mixedIndex(it.p, it.q) }
    val dvI = if (rows.size >= 2) idxs.max() - idxs.min() else null
    val spread = if (rows.size >= 2) rows.maxOf { it.p } - rows.minOf { it.p } else null
    val spreadQ = if (rows.size >= 2) rows.maxOf { it.q } - rows.minOf { it.q } else null
    val conf = ensConfOf(dvI)
    /* 一致性＝100 − ΔI×1.9（V1 同式）：斜率 1.9 是口径的一部分 */
    val consist = clamp(100 - (dvI ?: 0.0) * 1.9, 0.0, 100.0)

    val factorRows = facRowsOf(
        FacCtx(
            type = sRT.primary.type,
            level = sRT.primary.level,
            base = sRT.primary.base,
            cover = sRT.primary.cover,
            heq = sRT.heq,
            hs = sRT.hs,
            hEff = sRT.hEff,
            d = sRT.d,
            xMax = sRT.geom.xMax.takeIf { it.isFinite() && it > 0 },
            geomOk = sRT.geom.ok,
            lowBlock = aM.upstreamLowMax ?: envM.cLow,
            aod = sRT.aodUp,
            vis = envM.vis,
            rh = envM.rh,
            dP = dP,
            windComp = v,
            cape = envM.cape,
            precip = envM.precip,
            consist = consist,
            dvI = dvI,
            spread = spread,
            spreadQ = spreadQ
        )
    )

    return ForecastResult(
        dateStr = dateStr,
        period = period,
        city = city,
        tz = tz,
        evName = if (period == Period.AM) "日出" else "日落",
        evMs = evMs,
        evAz = evAz,
        events = events,
        leadH = leadH,
        omega = omega,
        envM = envM,
        sRT = sRT,
        sG = sGv,
        sE = sEv,
        models = rows,
        p = p,
        q = q,
        grade = gradeOf(q),
        consist = consist,
        dvI = dvI,
        spread = spread,
        spreadQ = spreadQ,
        conf = conf,
        factorRows = factorRows,
        transect = trM,
        aodFallback = aodFallback
    )
}

/* ---------- 单点取数缓存（日期 + 时段 + 坐标 0.1°；TTL 6 小时，LRU 12 条） ---------- */

object ForecastCache {
    private const val TTL = 6 * 3600000L
    private const val MAX = 12
    private val map = LinkedHashMap<String, Pair<Long, ForecastResult>>(16, 0.75f, true)

    private fun keyOf(city: City, dateStr: String, period: Period): String =
        dateStr + "|" + period.name + "@" +
            String.format(Locale.US, "%.1f", city.lat) + "," +
            String.format(Locale.US, "%.1f", city.lon)

    fun get(city: City, dateStr: String, period: Period): ForecastResult? {
        val hit = map[keyOf(city, dateStr, period)] ?: return null
        if (System.currentTimeMillis() - hit.first > TTL) return null
        return hit.second
    }

    fun put(city: City, dateStr: String, period: Period, r: ForecastResult) {
        map[keyOf(city, dateStr, period)] = System.currentTimeMillis() to r
        while (map.size > MAX) {
            val it = map.keys.iterator()
            if (!it.hasNext()) break
            it.next()
            it.remove()
        }
    }

    fun clear() = map.clear()
}

/* ---------- 取数 → 计算 ---------- */

const val RATE_LIMIT_FATAL =
    "今日气象数据额度已用尽。Open-Meteo 免费层按「出口 IP」计（每日 10,000 次 / 每小时 5,000 次），" +
        "不是按账号 —— 若你在公司、学校或代理等共享网络下，很可能是同一出口 IP 的其他使用者消耗掉的。" +
        "额度会在次日重置，之后即可恢复。"

const val RATE_LIMIT_SOFT = "气象接口暂时限流（短时并发过高），约一分钟内会自动恢复。"
const val NETWORK_MSG = "连不上气象服务：请检查手机网络（Wi-Fi 或移动数据）后重试。"
const val TIMEOUT_MSG = "气象接口响应超时，请检查网络后重试。"

class ForecastEngine(private val client: OpenMeteoClient) {

    suspend fun run(
        city: City,
        dateStr: String,
        period: Period,
        force: Boolean = false
    ): ForecastOutcome {
        if (!force) {
            ForecastCache.get(city, dateStr, period)?.let {
                return ForecastOutcome.Success(it.copy(fromCache = true))
            }
        }
        val ymd = parseYmd(dateStr) ?: return ForecastOutcome.Failure("日期格式不正确")
        val dayMs = utcMillis(ymd.first, ymd.second, ymd.third)
        val tz0 = TzCache.cityTz(city.lat, city.lon)
        /* 锚点必须落在城市当地 0 点，sunEvents 的 24 小时搜索窗才一定包含当地正午 */
        val dayAnchor = dayMs - tz0.offsetSec * 1000L

        val events = sunEvents(dayAnchor, city.lat, city.lon)
        val evMs = (if (period == Period.AM) events.riseMs else events.setMs)
            ?: (dayAnchor + 12 * 3600000.0)
        val evAz = solarPosition(evMs, city.lat, city.lon).azimuth
        val omega = sunAltRate(evMs, city.lat, city.lon)
        val leadH = (evMs - System.currentTimeMillis()) / 3600000.0
        val pts = transectPoints(city, evAz)

        val sG: List<Series?> = try {
            client.forecastBatched(MODEL_GFS, pts, dateStr, dateStr, F_VARS)
        } catch (e: WeatherException) {
            return failureOf(e)
        } catch (e: Exception) {
            return ForecastOutcome.Failure(NETWORK_MSG, FailureKind.NETWORK)
        }
        if (sG.isEmpty()) return ForecastOutcome.Failure(NO_DATA_MSG, FailureKind.NO_DATA)

        val sE = try {
            client.forecastBatched(MODEL_EC, pts, dateStr, dateStr, F_VARS)
        } catch (_: Exception) {
            null
        }
        val sA = try {
            client.aqBatched(pts, dateStr, dateStr)
        } catch (_: Exception) {
            null
        }

        /* 接口回来的时区是权威值：校准并记住 */
        var tz = tz0
        val tzLive = sG.filterNotNull().firstOrNull { it.tz.iana != null && !it.tz.est }?.tz
        if (tzLive != null) {
            tz = tzLive
            TzCache.remember(city.lat, city.lon, tzLive)
        }

        val result = assembleForecast(
            city = city,
            dateStr = dateStr,
            period = period,
            tz = tz,
            events = events,
            evMs = evMs,
            evAz = evAz,
            omega = omega,
            leadH = leadH,
            sG = sG,
            sE = sE,
            sA = sA
        )
        ForecastCache.put(city, dateStr, period, result)
        return ForecastOutcome.Success(result)
    }

    /**
     * 区间取数：一次请求拿回多天（start_date=首日 / end_date=末日），逐日 assemble。
     * 日期列表里已有缓存的直接复用；缺失的天合并成一个区间，只发 3 个请求。
     * 方位角用首日事件方位近似（10 天内变化 < 1°，对样带位置无实质影响）。
     */
    suspend fun runRange(
        city: City,
        dates: List<String>,
        period: Period,
        force: Boolean = false
    ): List<ForecastOutcome> {
        if (dates.isEmpty()) return emptyList()
        val out = HashMap<String, ForecastOutcome>()
        val need = ArrayList<String>()
        for (d in dates) {
            val hit = if (force) null else ForecastCache.get(city, d, period)
            when {
                hit != null -> out[d] = ForecastOutcome.Success(hit.copy(fromCache = true))
                parseYmd(d) == null -> out[d] = ForecastOutcome.Failure("日期格式不正确")
                else -> need.add(d)
            }
        }
        fun collect(): List<ForecastOutcome> = dates.map {
            out[it] ?: ForecastOutcome.Failure(NO_DATA_MSG, FailureKind.NO_DATA)
        }
        if (need.isEmpty()) return collect()

        val firstD = need.first()
        val lastD = need.last()
        val ymd = parseYmd(firstD) ?: return collect()
        val tz0 = TzCache.cityTz(city.lat, city.lon)
        val anchor0 = utcMillis(ymd.first, ymd.second, ymd.third) - tz0.offsetSec * 1000L
        val ev0 = sunEvents(anchor0, city.lat, city.lon)
        val evMs0 = (if (period == Period.AM) ev0.riseMs else ev0.setMs)
            ?: (anchor0 + 12 * 3600000.0)
        val evAz = solarPosition(evMs0, city.lat, city.lon).azimuth
        val pts = transectPoints(city, evAz)

        val sG: List<Series?> = try {
            client.forecastBatched(MODEL_GFS, pts, firstD, lastD, F_VARS)
        } catch (e: WeatherException) {
            need.forEach { out[it] = failureOf(e) }
            return collect()
        } catch (e: Exception) {
            need.forEach { out[it] = ForecastOutcome.Failure(NETWORK_MSG, FailureKind.NETWORK) }
            return collect()
        }
        if (sG.isEmpty()) {
            need.forEach { out[it] = ForecastOutcome.Failure(NO_DATA_MSG, FailureKind.NO_DATA) }
            return collect()
        }
        val sE = try {
            client.forecastBatched(MODEL_EC, pts, firstD, lastD, F_VARS)
        } catch (_: Exception) {
            null
        }
        val sA = try {
            client.aqBatched(pts, firstD, lastD)
        } catch (_: Exception) {
            null
        }

        /* 接口回来的时区是权威值：校准并记住 */
        var tz = tz0
        val tzLive = sG.filterNotNull().firstOrNull { it.tz.iana != null && !it.tz.est }?.tz
        if (tzLive != null) {
            tz = tzLive
            TzCache.remember(city.lat, city.lon, tzLive)
        }

        for (d in need) {
            val p = parseYmd(d) ?: continue
            val anchor = utcMillis(p.first, p.second, p.third) - tz.offsetSec * 1000L
            val events = sunEvents(anchor, city.lat, city.lon)
            val evMs = (if (period == Period.AM) events.riseMs else events.setMs)
                ?: (anchor + 12 * 3600000.0)
            val omega = sunAltRate(evMs, city.lat, city.lon)
            val leadH = (evMs - System.currentTimeMillis()) / 3600000.0
            val r = assembleForecast(
                city = city,
                dateStr = d,
                period = period,
                tz = tz,
                events = events,
                evMs = evMs,
                evAz = evAz,
                omega = omega,
                leadH = leadH,
                sG = sG,
                sE = sE,
                sA = sA
            )
            ForecastCache.put(city, d, period, r)
            out[d] = ForecastOutcome.Success(r)
        }
        return collect()
    }

    /** 观测场热力面：15×15 全区域铺满，分 3 批取数，边算边回调进度 */
    suspend fun runHeat(
        city: City,
        dateStr: String,
        period: Period,
        onProgress: (Int, Int) -> Unit = { _, _ -> }
    ): HeatGrid? = withContext(Dispatchers.Default) {
        buildHeatGrid(client, city, dateStr, period, onProgress)
    }

    companion object {
        /** 接口异常 → 用户可读的分型文案 */
        fun failureOf(e: WeatherException): ForecastOutcome.Failure = when (e.kind) {
            WeatherErrorKind.RATE_LIMIT -> ForecastOutcome.Failure(
                if (e.fatal) RATE_LIMIT_FATAL else RATE_LIMIT_SOFT,
                FailureKind.RATE_LIMIT
            )
            WeatherErrorKind.NETWORK -> ForecastOutcome.Failure(NETWORK_MSG, FailureKind.NETWORK)
            WeatherErrorKind.TIMEOUT -> ForecastOutcome.Failure(TIMEOUT_MSG, FailureKind.TIMEOUT)
            WeatherErrorKind.HTTP -> ForecastOutcome.Failure(
                if (e.fatal) RATE_LIMIT_FATAL else e.friendly(),
                FailureKind.NO_DATA
            )
        }
    }
}

private fun parseYmd(iso: String): Triple<Int, Int, Int>? {
    val p = iso.split("-")
    if (p.size != 3) return null
    val y = p[0].toIntOrNull() ?: return null
    val m = p[1].toIntOrNull() ?: return null
    val d = p[2].toIntOrNull() ?: return null
    if (y <= 0 || m <= 0 || d <= 0) return null
    return Triple(y, m, d)
}

/** 结论词（页面标题里那句，也印在分享图上） */
fun conclWord(p: Double): String = when {
    p >= 70 -> "大概率出现"
    p >= 45 -> "值得期待"
    p >= 25 -> "可以一试"
    else -> "希望不大"
}

/** 最佳观赏窗口：云边界 θnear → 地球遮挡 θfar 两个太阳高度角对应的真实时刻 */
fun glowWindow(
    evMs: Double,
    isAM: Boolean,
    lat: Double,
    lon: Double,
    thNearDeg: Double,
    thFarDeg: Double
): Pair<Double, Double>? {
    if (!thNearDeg.isFinite() || !thFarDeg.isFinite()) return null
    val dir = if (isAM) -1 else 1

    fun alt(ms: Double): Double = solarPosition(ms, lat, lon).altitude

    fun cross(target: Double): Double? {
        var lo = evMs
        var hi = evMs + dir * 6 * 3600000.0
        fun f(ms: Double): Double = alt(ms) - target
        if (f(lo) * f(hi) > 0) return null
        repeat(44) {
            val mid = (lo + hi) / 2
            if (f(mid) * f(lo) > 0) lo = mid else hi = mid
        }
        return (lo + hi) / 2
    }

    val a = cross(-thNearDeg) ?: return null
    val b = cross(-thFarDeg) ?: return null
    val s = min(a, b)
    val e = max(a, b)
    return if (e - s > 60000) s to e else null
}

/** 分钟级时长显示 */
fun fmtDur(minutes: Double): String {
    if (!minutes.isFinite() || minutes <= 0) return "—"
    return if (minutes < 60) abs(minutes).roundToLong().toString() + " 分钟"
    else (minutes / 60).toInt().toString() + " 小时 " + (minutes % 60).roundToLong().toString() + " 分"
}
