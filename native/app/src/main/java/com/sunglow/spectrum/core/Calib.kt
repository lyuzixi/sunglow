package com.sunglow.spectrum.core

import kotlin.math.floor

/*
 * SUNGLOW · 实况校准口径（N1 · 与网页 v2/src/core/calib.ts 同口径）
 * 基准：b2-baselines.json → samples.calib（17 条分组 / 分桶 / 可标注样本）。
 * 常量与函数名照抄网页，避免两端各写一套网格规则。
 */

const val CALIB_GRID_DEG = 0.5
const val CALIB_BUCKET = 20
const val CALIB_HIT_MIN = 2
const val CALIB_MIN_N = 8
const val CALIB_MIN_BUCKET = 3
const val CALIB_MAX = 200
const val CALIB_AFTER_H = -1

val CALIB_MARKS: List<Int> = listOf(-1, 0, 1, 2, 3, 4)

/** 0.5° 网格分组；JS Math.round 与 Kotlin Math.round 均向 +∞ 取整，结果一致 */
fun calibGroupOf(lat: Double, lon: Double): String {
    val k = 1.0 / CALIB_GRID_DEG
    return Math.round(lat * k).toString() + "," + Math.round(lon * k).toString()
}

/** 只有在霞光发生之后（leadH <= -1）才允许回填实况 */
fun calibCanAnnotate(leadH: Double?): Boolean =
    isNum(leadH) && leadH!! <= CALIB_AFTER_H.toDouble()

/** 概率按 20 分一桶，共 5 桶（0..4） */
fun calibBucketOf(p: Double): Int =
    clamp(
        floor(clamp(p, 0.0, 100.0) / CALIB_BUCKET),
        0.0,
        100.0 / CALIB_BUCKET - 1.0
    ).toInt()
