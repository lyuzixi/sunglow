package com.sunglow.spectrum.core

import kotlinx.serialization.Serializable
import kotlin.math.max
import kotlin.math.min

/*
 * SUNGLOW · 评分模型
 * 口径来源：v2/src/core/scoring.ts（V1 _p4.js）。
 * 阈值、权重、隶属函数逐点对齐，禁止调整。
 */

const val API_FORECAST = "https://api.open-meteo.com/v1/forecast"
const val API_AQ = "https://air-quality-api.open-meteo.com/v1/air-quality"
const val API_TZ = "auto"

/* ---------- 环境场 ---------- */

@Serializable
data class Env(
    val tMs: Long,
    val t: Double?,
    val td: Double?,
    val rh: Double?,
    val cTot: Double?,
    val cLow: Double?,
    val cMid: Double?,
    val cHigh: Double?,
    val vis: Double?,
    val p: Double?,
    val pmsl: Double?,
    val ws: Double?,
    val wd: Double?,
    val gust: Double?,
    val fz: Double?,
    val blh: Double?,
    val precip: Double?,
    val cape: Double?,
    val sw: Double?,
    val pp: Double?,
    val aod: Double?,
    val missing: List<String>
) {
    fun envLike(): EnvLike = EnvLike(t = t, td = td, fz = fz, cLow = cLow, cMid = cMid, cHigh = cHigh)
}

/** 小时序列读取器：按变量名取某时刻的值 */
interface SeriesReader {
    fun at(key: String, ms: Long): Double?
}

fun buildEnv(sr: SeriesReader?, tMs: Long, extraAod: Double? = null): Env {
    val missing = mutableListOf<String>()

    fun g(key: String, optional: Boolean = false): Double? {
        val v = sr?.at(key, tMs)
        if (!isNum(v)) {
            if (!optional) missing.add(key)
            return null
        }
        return v
    }

    var t = g("temperature_2m")
    var td = g("dew_point_2m")
    var rh = g("relative_humidity_2m")
    val cTot = g("cloud_cover", true)
    var cLow = g("cloud_cover_low")
    var cMid = g("cloud_cover_mid")
    var cHigh = g("cloud_cover_high")
    var vis = g("visibility")
    val p = g("surface_pressure", true)
    val pmsl = g("pressure_msl")
    val ws = g("wind_speed_10m")
    val wd = g("wind_direction_10m")
    val gust = g("wind_gusts_10m", true)
    val fz = g("freezing_level_height")
    val blh = g("boundary_layer_height")
    val precip = g("precipitation", true)
    val cape = g("cape", true)
    val sw = g("shortwave_radiation", true)
    val pp = g("precipitation_probability", true)

    if (isNum(t) && !isNum(td)) {
        td = t!! - (100 - clamp(nz(rh, 60.0), 1.0, 100.0)) / 5
        missing.add("dew_point_2m")
    }
    if (isNum(rh)) rh = clamp(rh!!, 0.0, 100.0)
    if (isNum(vis)) vis = clamp(vis!!, 0.0, 200000.0)
    cLow = cLow?.let { clamp(it, 0.0, 100.0) }
    cMid = cMid?.let { clamp(it, 0.0, 100.0) }
    cHigh = cHigh?.let { clamp(it, 0.0, 100.0) }

    return Env(
        tMs = tMs,
        t = t,
        td = td,
        rh = rh,
        cTot = cTot,
        cLow = cLow,
        cMid = cMid,
        cHigh = cHigh,
        vis = vis,
        p = p,
        pmsl = pmsl,
        ws = ws,
        wd = wd,
        gust = gust,
        fz = fz,
        blh = blh,
        precip = precip,
        cape = cape,
        sw = sw,
        pp = pp,
        aod = extraAod,
        missing = missing.toList()
    )
}

/* ---------- 统计判据模型 ---------- */

val W_STAT: Map<String, Double> = linkedMapOf(
    "cover" to 0.2,
    "type" to 0.16,
    "base" to 0.12,
    "geom" to 0.16,
    "aero" to 0.12,
    "vis" to 0.08,
    "hum" to 0.05,
    "stab" to 0.06,
    "block" to 0.05
)

data class ScoreCtx(
    val v: Double,       // 云边界移动速度 km/min
    val omega: Double,   // 太阳高度角变化率 deg/min
    val dP: Double?,
    val aod: Double? = null
)

@Serializable
data class StatResult(
    val p: Double,
    val q: Double,
    val primary: Deck,
    val decks: List<Deck>,
    val noCloud: Boolean,
    val hEff: Double?,
    val heq: Double,
    val hs: Double,
    val aodUp: Double?,
    val d: Double?,
    val geom: FireGeom,
    val f: Map<String, Double?>,
    val s: Double,
    val missF: List<String>,
    val notes: List<String>
)

data class PrimaryDeckResult(val decks: List<Deck>, val primary: Deck, val noCloud: Boolean)

fun primaryDeckOf(env: Env): PrimaryDeckResult {
    val decks = cloudDecks(env.envLike())
    var picked: Deck? = null
    for (d in decks) if (d.cover >= 20) picked = d
    val noCloud = picked == null
    val primary = picked ?: decks.reduce { a, b -> if (b.cover > a.cover) b else a }
    return PrimaryDeckResult(decks, primary, noCloud)
}

/**
 * 光路遮挡因子（0–1，1=完全通透；越小越挡光）
 * 光源段判据：本地云幕要被低角度阳光点亮，太阳来向上游不能有低云（对中/高云幕）
 * 与中云（对高云幕）挡着。地图的「遮挡层」与评分的 block 因子共用本函数。
 */
fun blockFactor(level: Int, upstreamLowMax: Double?, upstreamMidMax: Double?): Double {
    var block = 1.0
    if (level > 0) {
        if (isNum(upstreamLowMax)) {
            block *= trap(
                upstreamLowMax,
                listOf(0.0 to 1.0, 25.0 to 0.95, 45.0 to 0.72, 65.0 to 0.4, 85.0 to 0.18, 100.0 to 0.1)
            ) ?: 1.0
        }
    }
    if (level > 1) {
        if (isNum(upstreamMidMax)) {
            block *= trap(
                upstreamMidMax,
                listOf(0.0 to 1.0, 30.0 to 0.94, 55.0 to 0.78, 80.0 to 0.48, 95.0 to 0.26)
            ) ?: 1.0
        }
    }
    return block
}

data class TransectSummary(
    val hasDeck: Boolean,
    val dFar: Double? = null,
    val upstreamAod: Double? = null,
    val upstreamLowMax: Double? = null,
    val upstreamMidMax: Double? = null
)

fun scoreStat(env: Env, tr: TransectSummary, ctx: ScoreCtx): StatResult {
    val notes = mutableListOf<String>()
    val pd = primaryDeckOf(env)
    val decks = pd.decks
    val primary = pd.primary
    val noCloud = pd.noCloud

    val hs = aerosolScaleHeight(env.blh)
    val aodUp = when {
        isNum(tr.upstreamAod) -> tr.upstreamAod
        isNum(env.aod) -> env.aod
        else -> null
    }
    val heq = equivGroundHeight(aodUp, hs)
    val hEff = if (isNum(primary.base)) primary.base - heq else null
    val d = if (tr.hasDeck) tr.dFar else null
    val geom = fireGeometry(hEff, d, ctx.v, ctx.omega)

    val f = linkedMapOf<String, Double?>()
    f["cover"] = trap(
        primary.cover,
        listOf(0.0 to 0.0, 8.0 to 0.12, 22.0 to 0.62, 38.0 to 1.0, 75.0 to 1.0, 88.0 to 0.5, 100.0 to 0.22)
    )
    f["type"] = primary.typeScore
    f["base"] = trap(
        primary.base,
        listOf(0.1 to 0.05, 0.6 to 0.24, 1.2 to 0.55, 2.0 to 0.8, 3.0 to 1.0, 9.0 to 1.0, 13.0 to 0.68)
    )
    f["geom"] = when {
        !tr.hasDeck -> 0.06
        !isNum(d) -> 0.2
        else -> trap(
            d!! / max(geom.xMax, 1.0),
            listOf(
                0.0 to 0.72, 0.12 to 0.95, 0.55 to 1.0, 0.9 to 0.62, 1.0 to 0.4, 1.5 to 0.08, 3.0 to 0.02
            )
        )
    }
    f["aero"] = if (isNum(aodUp)) {
        trap(
            aodUp,
            listOf(
                0.0 to 1.0, 0.1 to 1.0, 0.2 to 0.88, 0.3 to 0.72, 0.5 to 0.52,
                0.8 to 0.26, 1.2 to 0.12, 3.0 to 0.03
            )
        )
    } else null
    f["vis"] = if (isNum(env.vis)) {
        trap(
            env.vis!! / 1000.0,
            listOf(0.4 to 0.05, 2.0 to 0.2, 5.0 to 0.42, 10.0 to 0.66, 20.0 to 0.92, 30.0 to 1.0, 80.0 to 1.0)
        )
    } else null
    f["hum"] = if (isNum(env.rh)) {
        trap(
            env.rh,
            listOf(5.0 to 0.7, 20.0 to 0.92, 40.0 to 1.0, 75.0 to 1.0, 88.0 to 0.78, 95.0 to 0.45, 100.0 to 0.3)
        )
    } else null
    var stab = if (isNum(ctx.dP)) {
        trap(ctx.dP, listOf(0.0 to 1.0, 0.6 to 1.0, 1.2 to 0.8, 2.5 to 0.52, 6.0 to 0.3))
    } else null
    if (stab != null) {
        var v = stab
        if (isNum(env.cape) && env.cape!! > 1500) v *= 0.78
        if (isNum(env.precip) && env.precip!! > 1) v *= 0.82
        stab = v
    }
    f["stab"] = stab
    f["block"] = blockFactor(
        primary.level,
        if (isNum(tr.upstreamLowMax)) tr.upstreamLowMax else env.cLow,
        if (isNum(tr.upstreamMidMax)) tr.upstreamMidMax else env.cMid
    )

    val missF = mutableListOf<String>()
    for (k in W_STAT.keys) if (f[k] == null) missF.add(k)
    val s = wgeo(
        listOf(
            f["cover"] to W_STAT.getValue("cover"),
            f["type"] to W_STAT.getValue("type"),
            f["base"] to W_STAT.getValue("base"),
            f["geom"] to W_STAT.getValue("geom"),
            f["aero"] to W_STAT.getValue("aero"),
            f["vis"] to W_STAT.getValue("vis"),
            f["hum"] to W_STAT.getValue("hum"),
            f["stab"] to W_STAT.getValue("stab"),
            f["block"] to W_STAT.getValue("block")
        )
    )
    var p = 100 * logistic(6.5 * (s - 0.62))
    if (noCloud) p = min(p, 8.0)
    if (primary.cover < 12) p = min(p, 22.0)
    p = clamp(p, 2.0, 97.0)

    val qCover = trap(
        primary.cover,
        listOf(0.0 to 0.0, 15.0 to 0.3, 35.0 to 0.9, 55.0 to 1.0, 75.0 to 0.9, 90.0 to 0.55, 100.0 to 0.35)
    )
    val qBase = trap(
        primary.base,
        listOf(0.2 to 0.05, 1.0 to 0.3, 2.0 to 0.6, 3.5 to 0.9, 6.0 to 1.0, 10.0 to 0.95, 13.0 to 0.7)
    )
    val qGeom = f["geom"]
    val qDur = trap(geom.dur, listOf(0.0 to 0.05, 1.0 to 0.5, 3.0 to 0.85, 6.0 to 1.0, 20.0 to 1.0))
    val qAero = f["aero"] ?: 0.7
    var q = 100 * wgeo(
        listOf(
            qCover to 0.24,
            primary.typeScore to 0.2,
            qBase to 0.16,
            qGeom to 0.14,
            qAero to 0.14,
            qDur to 0.12
        )
    )
    if (noCloud) q = min(q, 10.0)
    q = clamp(q, 0.0, 100.0)

    return StatResult(
        p = p,
        q = q,
        primary = primary,
        decks = decks,
        noCloud = noCloud,
        hEff = hEff,
        heq = heq,
        hs = hs,
        aodUp = aodUp,
        d = d,
        geom = geom,
        f = f,
        s = s,
        missF = missF,
        notes = notes
    )
}

/* ---------- 光追算法 ---------- */

@Serializable
data class RaySample(
    val t: Double,
    val magDeg: Double,
    val th: Double,
    val invalid: Boolean = false,
    val color: RayColor
)

@Serializable
data class RayResult(
    val p: Double,
    val q: Double,
    val primary: Deck,
    val decks: List<Deck>,
    val noCloud: Boolean,
    val heq: Double,
    val hs: Double,
    val aodUp: Double,
    val hEff: Double,
    val hRaw: Double,
    val noLight: Boolean,
    val d: Double?,
    val geom: FireGeom,
    val samples: List<RaySample>,
    val peak: RaySample,
    val best: RaySample,
    val last: RaySample,
    val bright: BrightLevel,
    val satScore: Double,
    val colorRich: Double,
    val hueSpread: Double,
    val geomF: Double,
    val coverF: Double,
    val aeroF: Double,
    val s: Double,
    val qColor: Double,
    val maxChroma: Double,
    val qDur: Double
)

fun scoreRay(env: Env, tr: TransectSummary, ctx: ScoreCtx): RayResult {
    val pd = primaryDeckOf(env)
    val decks = pd.decks
    val primary = pd.primary

    val hs = aerosolScaleHeight(env.blh)
    val aodUp = when {
        isNum(tr.upstreamAod) -> tr.upstreamAod!!
        else -> nz(env.aod, 1.2)
    }
    val heq = equivGroundHeight(aodUp, hs)
    val hRaw = primary.base - heq
    val hEff = max(0.02, hRaw)
    val noLight = !isNum(hRaw) || hRaw <= 0.05
    val d = if (tr.hasDeck) tr.dFar else null
    val geom = fireGeometry(hEff, d, ctx.v, ctx.omega)

    val samples = mutableListOf<RaySample>()
    if (geom.ok) {
        for (t in listOf(0.0, 0.3, 0.55, 0.78, 1.0)) {
            val mag = geom.thNear + t * (geom.thFar - geom.thNear)
            samples.add(
                RaySample(
                    t = t,
                    magDeg = mag * RAD,
                    th = -mag,
                    color = rayTraceColor(primary.base, -mag, aodUp, hs)
                )
            )
        }
    } else {
        // 与 TS 的 `geom.thFar || 0.02`、`geom.thNear || 0` 同义：0 与 NaN 才兜底
        val far = if (geom.thFar == 0.0 || geom.thFar.isNaN()) 0.02 else geom.thFar
        val nearRaw = if (geom.thNear == 0.0 || geom.thNear.isNaN()) 0.0 else geom.thNear
        val mag = min(far, max(nearRaw, 0.0001))
        samples.add(
            RaySample(
                t = 0.0,
                magDeg = mag * RAD,
                th = -mag,
                invalid = true,
                color = rayTraceColor(primary.base, -mag, aodUp, hs)
            )
        )
    }

    val peak = samples[0]
    val best = samples.reduce { a, b -> if (b.color.sat > a.color.sat) b else a }
    val last = samples[samples.size - 1]
    val bright = brightnessLevel(peak.color.t550)
    val satScore = clamp((peak.color.sat - 0.12) / 0.55, 0.0, 1.0) * 100
    val hueSpread = samples.maxOf { it.color.hue } - samples.minOf { it.color.hue }
    val colorRich = clamp(hueSpread / 45.0, 0.0, 1.0) * 100

    val coverF = trap(
        primary.cover,
        listOf(0.0 to 0.0, 10.0 to 0.16, 25.0 to 0.6, 40.0 to 0.92, 70.0 to 1.0, 88.0 to 0.55, 100.0 to 0.26)
    ) ?: 0.0
    val geomF: Double = when {
        !tr.hasDeck -> 0.05
        !isNum(d) -> 0.2
        else -> trap(
            d!! / max(geom.xMax, 1.0),
            listOf(
                0.0 to 0.7, 0.12 to 0.95, 0.55 to 1.0, 0.9 to 0.6, 1.0 to 0.38, 1.5 to 0.07, 3.0 to 0.02
            )
        ) ?: 0.0
    }
    val aeroF = if (isNum(aodUp)) {
        trap(
            aodUp,
            listOf(
                0.0 to 1.0, 0.1 to 1.0, 0.2 to 0.9, 0.3 to 0.75, 0.5 to 0.55, 0.8 to 0.28, 1.2 to 0.12, 3.0 to 0.03
            )
        ) ?: 0.7
    } else 0.7

    val s = 0.4 * geomF + 0.22 * (bright.score / 100) + 0.16 * (satScore / 100) +
        0.1 * coverF + 0.12 * aeroF
    var p = 100 * logistic(7 * (s - 0.46))
    if (pd.noCloud) p = min(p, 8.0)
    if (primary.cover < 12) p = min(p, 22.0)
    p = clamp(p, 2.0, 97.0)

    val qDur = trap(geom.dur, listOf(0.0 to 0.06, 1.0 to 0.5, 3.0 to 0.85, 6.0 to 1.0, 20.0 to 1.0)) ?: 0.0
    val maxChroma = samples.maxOf { it.color.chroma }
    val qColor = clamp(maxChroma / CHROMA_REF, 0.0, 1.0)
    var q = 100 * wgeo(
        listOf(
            (bright.score / 100) to 0.26,
            qColor to 0.22,
            aeroF to 0.2,
            primary.typeScore to 0.16,
            qDur to 0.08,
            coverF to 0.08
        )
    )
    if (!geom.ok) q = min(q, 55.0)
    if (noLight) {
        p = min(p, 12.0)
        q = min(q, 15.0)
    }
    if (pd.noCloud) q = min(q, 10.0)
    q = clamp(q, 0.0, 99.0)

    return RayResult(
        p = p,
        q = q,
        primary = primary,
        decks = decks,
        noCloud = pd.noCloud,
        heq = heq,
        hs = hs,
        aodUp = aodUp,
        hEff = hEff,
        hRaw = hRaw,
        noLight = noLight,
        d = d,
        geom = geom,
        samples = samples,
        peak = peak,
        best = best,
        last = last,
        bright = bright,
        satScore = satScore,
        colorRich = colorRich,
        hueSpread = hueSpread,
        geomF = geomF,
        coverF = coverF,
        aeroF = aeroF,
        s = s,
        qColor = qColor,
        maxChroma = maxChroma,
        qDur = qDur
    )
}

/* ---------- 等级与可信度 ---------- */

data class QualityBand(val key: String, val min: Double, val max: Double, val color: String, val dark: String)

val QUALITY_BANDS: List<QualityBand> = listOf(
    QualityBand("优", 80.0, 100.0, "#0f7042", "#5fce97"),
    QualityBand("良", 65.0, 79.0, "#4a7a10", "#9ac765"),
    QualityBand("一般", 45.0, 64.0, "#965d06", "#e2b45e"),
    QualityBand("差", 0.0, 44.0, "#c0392b", "#f2796a")
)

val QUALITY_LABEL: Map<String, String> = mapOf(
    "优" to "优秀",
    "良" to "良好",
    "一般" to "一般",
    "差" to "较差"
)

fun gradeOf(q: Double?): String {
    val v = if (isNum(q)) q!! else 0.0
    for (b in QUALITY_BANDS) if (v >= b.min) return b.key
    return QUALITY_BANDS.last().key
}

@Serializable
data class EnsBand(
    val key: String,
    val max: Double,
    val level: String,
    val color: String,
    val bg: String,
    val bd: String,
    val darkColor: String,
    val darkBg: String,
    val darkBd: String,
    val txt: String,
    val hint: String
)

val ENS_CONF_BANDS: List<EnsBand> = listOf(
    EnsBand(
        "hi", 18.0, "高", "#178a52", "#e9f7ef", "#bfe7d2", "#5fce97", "#122a20", "#1f4735",
        "三套算法结论接近", "可信度较高，可直接据此安排。"
    ),
    EnsBand(
        "mid", 35.0, "中", "#c07a10", "#fdf3e3", "#f2ddba", "#e2b45e", "#2a2314", "#463a1e",
        "三套算法存在一定分歧", "分歧在可接受范围内，建议结合临近云图复核。"
    ),
    EnsBand(
        "lo", Double.POSITIVE_INFINITY, "低", "#c0392b", "#fdeceb", "#f5cdc9", "#f2796a", "#2d1a18", "#4d2a26",
        "三套算法分歧较大", "请谨慎采信，临近日再确认一次。"
    )
)

fun ensConfOf(dv: Double?): EnsBand {
    if (!isNum(dv)) return ENS_CONF_BANDS[1]
    for (b in ENS_CONF_BANDS) if (dv!! < b.max) return b
    return ENS_CONF_BANDS.last()
}

val W_ENS: Map<String, Double> = mapOf("gfs" to 0.3, "ec" to 0.34, "rt" to 0.36)

/** 综合指数 I = 0.55P + 0.45Q（0–100），与 V1 mixedIndex 逐字一致 */
fun mixedIndex(p: Double, q: Double): Double = clamp(0.55 * p + 0.45 * q, 0.0, 100.0)
