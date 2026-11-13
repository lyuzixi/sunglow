package com.sunglow.spectrum.core

import kotlin.math.exp
import kotlin.math.max
import kotlin.math.sqrt

/*
 * SUNGLOW · 参考模型（五因子加权）与观测场辅助口径
 * ---------------------------------------------------------------------------
 * 逐位复刻 v2/src/core/refmodel.ts 与 v2/src/core/maprender.ts 的对应部分。
 *
 * 定位（与网页一致，不要改）：**独立旁证**，不是主口径。
 *   · 五因子不看光路几何，严格度低于 scoreStat；
 *   · 绝不参与 ens / dv 加权，也不改任何既有数字；
 *   · 唯一用途是交叉验证：与物理核并列显示，并用「空间形态分歧」驱动色面降饱和。
 *
 * 分歧口径不是 |ref − mix|（两套模型刻度本就不同，直接取差会把整张图洗灰），
 * 而是各自在全图上标准化（减均值除标准差）后再取差：|Δz| × 33 → 0–100。
 */

val REF_W: Map<String, Double> = linkedMapOf(
    "cloudType" to 0.35,
    "transparency" to 0.25,
    "humidity" to 0.15,
    "precip" to 0.10,
    "cloudCover" to 0.15
)

data class RefFactors(
    val cloudType: Double?,
    val transparency: Double?,
    val humidity: Double?,
    val precip: Double?,
    val cloudCover: Double?
)

data class RefResult(
    /** 0–1 原始五因子加权分 */
    val s: Double,
    /** 0–100（= 100S），与主口径同刻度，便于并列显示 */
    val v: Double,
    val factors: RefFactors,
    /** 缺项键名（用于卡片提示「参考分缺 AOD」这类情况） */
    val missing: List<String>
)

/** 高斯隶属（湿度最优区间用，报告给的是 50±15） */
private fun gauss(x: Double, mu: Double, sigma: Double): Double {
    val z = (x - mu) / sigma
    return exp(-0.5 * z * z)
}

/**
 * 五因子参考分。只读 env（不查样带），正因如此才独立。
 * 缺项按「已给项重归一化」处理，不拿常数顶替。
 */
fun refScore(env: Env): RefResult {
    val missing = mutableListOf<String>()
    var cloudType: Double? = null
    var transparency: Double? = null
    var humidity: Double? = null
    var precip: Double? = null
    var cloudCover: Double? = null

    /* 因子 1 · 云型配置：高云主导度 + 中高云总量是否落在 10–85 的画布带 */
    if (isNum(env.cHigh) && isNum(env.cMid) && isNum(env.cLow)) {
        val hi = clamp(env.cHigh!!, 0.0, 100.0)
        val mid = clamp(env.cMid!!, 0.0, 100.0)
        val lo = clamp(env.cLow!!, 0.0, 100.0)
        val dominance = hi / max(hi + mid + lo, 1.0)
        val canvas = trap(
            hi + mid,
            listOf(10.0 to 0.0, 30.0 to 1.0, 60.0 to 1.0, 85.0 to 0.35)
        ) ?: 0.0
        cloudType = clamp(0.6 * dominance + 0.4 * canvas, 0.0, 1.0)
    } else {
        missing.add("cHigh/cMid/cLow")
    }

    /* 因子 2 · 通透度：能见度 0.5 + AOD 0.5（AOD 缺则只取能见度） */
    val visF = if (isNum(env.vis)) {
        trap(
            env.vis,
            listOf(0.0 to 0.0, 5000.0 to 0.3, 15000.0 to 0.8, 30000.0 to 1.0, 200000.0 to 1.0)
        )
    } else {
        null
    }
    val aodF = if (isNum(env.aod)) {
        trap(
            env.aod,
            listOf(0.0 to 1.0, 0.1 to 1.0, 0.2 to 0.9, 0.4 to 0.6, 0.6 to 0.3, 1.0 to 0.0, 3.0 to 0.0)
        )
    } else {
        null
    }
    if (visF != null && aodF != null) {
        transparency = 0.5 * visF + 0.5 * aodF
    } else if (visF != null) {
        transparency = visF
    } else if (aodF != null) {
        transparency = aodF
        missing.add("visibility")
    } else {
        missing.add("visibility/aod")
    }

    /* 因子 3 · 湿度：40–60% 最优，>85% 判霾 */
    if (isNum(env.rh)) {
        val rh = clamp(env.rh!!, 0.0, 100.0)
        humidity = if (rh < 85.0) clamp(gauss(rh, 50.0, 15.0), 0.0, 1.0) else 0.1
    } else {
        missing.add("relative_humidity_2m")
    }

    /* 因子 4 · 降水：>50% 直接判没戏（用小时降水概率） */
    if (isNum(env.pp)) {
        val pp = env.pp!!
        precip = if (pp < 30.0) 1.0 else if (pp < 50.0) 0.5 else 0.0
    } else {
        missing.add("precipitation_probability")
    }

    /* 因子 5 · 总云量修正：15–60 最优；没给总云量就用三层合成（并集），不是简单相加 */
    if (isNum(env.cTot)) {
        cloudCover = trap(
            env.cTot,
            listOf(10.0 to 0.0, 15.0 to 1.0, 60.0 to 1.0, 80.0 to 0.0)
        ) ?: 0.0
    } else if (isNum(env.cHigh) && isNum(env.cMid) && isNum(env.cLow)) {
        val lo = clamp(env.cLow!!, 0.0, 100.0)
        val mid = clamp(env.cMid!!, 0.0, 100.0)
        val hi = clamp(env.cHigh!!, 0.0, 100.0)
        val union = clamp(
            lo + mid * (1 - lo / 100) + hi * (1 - clamp(lo + mid, 0.0, 100.0) / 100),
            0.0,
            100.0
        )
        cloudCover = trap(
            union,
            listOf(10.0 to 0.0, 15.0 to 1.0, 60.0 to 1.0, 80.0 to 0.0)
        ) ?: 0.0
    } else {
        missing.add("cloud_cover")
    }

    var sw = 0.0
    var sv = 0.0
    val vals = listOf(
        "cloudType" to cloudType,
        "transparency" to transparency,
        "humidity" to humidity,
        "precip" to precip,
        "cloudCover" to cloudCover
    )
    for ((k, value) in vals) {
        val f = value ?: continue
        if (!isNum(f)) continue
        val w = REF_W[k] ?: 0.0
        sw += w
        sv += w * f
    }
    val s = if (sw > 0) clamp(sv / sw, 0.0, 1.0) else 0.0
    return RefResult(
        s = s,
        v = 100.0 * s,
        factors = RefFactors(cloudType, transparency, humidity, precip, cloudCover),
        missing = missing
    )
}

/* ---------- 观测场：遮挡分档与可信度（口径同 v2/src/core/maprender.ts） ---------- */

/** 遮挡层四档：0–25 通透 / 25–50 轻度 / 50–75 明显 / 75–100 严重 */
const val OCC_BAND_HI = 25.0
val OCC_BAND_NAMES: List<String> = listOf("通透", "轻度遮挡", "明显遮挡", "严重遮挡")

/** 遮挡层配色与各档 alpha（网页 TX_RGB / TX_BAND_A） */
val OCC_RGB: List<Int> = listOf(26, 36, 58)
val OCC_BAND_A: List<Double> = listOf(0.0, 0.12, 0.2, 0.3)

/** 低于这个综合指数的格子不画遮挡（太弱的区域没有参考价值） */
const val OCC_MIN_V = 35.0

fun occBandOf(v: Double): Int {
    val b = Math.floor(clamp(v, 0.0, 100.0) / OCC_BAND_HI).toInt()
    return if (b < 0) 0 else if (b > 3) 3 else b
}

/** 分歧软化阈值与可信度权重（网页 GAP_SOFT / CONF_GAP_W） */
const val GAP_SOFT = 35.0
const val CONF_GAP_W = 0.3

/**
 * 只算「模型分歧」这一项的可信度（0–1）。
 * 网页还含距离项与残差项；原生端的场是 15×15 实测点、距离项由 fadeOf 单独负责，
 * 所以这里只保留分歧项，口径与网页的 gap 项一致。
 */
fun fieldConfOf(gap: Double?): Double {
    val gapT = clamp((gap ?: 0.0) / GAP_SOFT, 0.0, 1.0)
    return clamp(1.0 - gapT * CONF_GAP_W, 0.2, 1.0)
}

/**
 * 全图标准化求「空间形态分歧」：refGap = |z(ref) − z(mix)| × 33。
 * 与网页 finalizeRefGap 同构（网页 ×33 把 |Δz|=1 映射到 33 分）。
 */
fun finalizeRefGap(
    refs: List<Double>,
    mixes: List<Double>
): List<Double> {
    if (refs.size < 3 || refs.size != mixes.size) return List(refs.size) { 0.0 }
    fun stat(xs: List<Double>): Pair<Double, Double> {
        val mean = xs.sum() / xs.size
        var v = 0.0
        for (x in xs) v += (x - mean) * (x - mean)
        return Pair(mean, sqrt(v / xs.size).let { if (it == 0.0) 1.0 else it })
    }
    val (ma, sda) = stat(refs)
    val (mb, sdb) = stat(mixes)
    return refs.indices.map { i ->
        val zr = (refs[i] - ma) / sda
        val zm = (mixes[i] - mb) / sdb
        clamp(Math.abs(zr - zm) * 33.0, 0.0, 100.0)
    }
}
