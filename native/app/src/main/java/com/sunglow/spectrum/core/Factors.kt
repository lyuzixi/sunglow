package com.sunglow.spectrum.core

import kotlinx.serialization.Serializable
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/*
 * SUNGLOW · 主要因素（展示口径的唯一来源）
 * 口径来源：v2/src/core/factors.ts（V1 _p5b.js renderFactors）。
 *
 * 1. 数值是富文本（「高积云 · 21%」「无明显云边界」「（上限 xx）」…），缺数显 — 而不是 0；
 * 2. 每项带判定：有利 / 中性 / 不利 / 数据缺失（阈值 0.78 / 0.5）；
 * 3. 共 13 项，第 13 项「模式一致性」。
 * 这些 trap 曲线是展示曲线，与 scoreStat 里喂给 P 的算法曲线用途不同，别混用。
 */

/** （键, 原始数值, 展示得分）—— 与网页 State.factorRows 同构；null = 缺数据 */
@Serializable
data class FacRow(val key: String, val raw: Double?, val score: Double?)

/** facRowsOf 的输入：都是计算期就知道的原始量 */
data class FacCtx(
    val type: String,
    val level: Int,
    val base: Double,
    val cover: Double,
    val heq: Double?,
    val hs: Double?,
    val hEff: Double?,
    val d: Double?,
    val xMax: Double?,
    val geomOk: Boolean,
    val lowBlock: Double?,
    val aod: Double?,
    val vis: Double?,
    val rh: Double?,
    val dP: Double?,
    val windComp: Double?,
    val cape: Double?,
    val precip: Double?,
    val consist: Double,
    val dvI: Double?,
    val spread: Double?,
    val spreadQ: Double?
)

fun facRowsOf(c: FacCtx): List<FacRow> {
    val coverSc = trap(
        c.cover,
        listOf(0.0 to 0.0, 8.0 to 0.12, 22.0 to 0.62, 38.0 to 1.0, 75.0 to 1.0, 88.0 to 0.5, 100.0 to 0.22)
    )
    val baseSc = trap(
        c.base,
        listOf(0.1 to 0.05, 0.6 to 0.24, 1.2 to 0.55, 2.0 to 0.8, 3.0 to 1.0, 9.0 to 1.0, 13.0 to 0.68)
    )
    val heqSc = if (isNum(c.heq)) trap(
        c.heq,
        listOf(0.0 to 1.0, 0.8 to 1.0, 1.5 to 0.8, 2.5 to 0.5, 3.5 to 0.3, 5.0 to 0.12, 8.0 to 0.03)
    ) else null
    val heffSc = if (isNum(c.hEff)) trap(
        c.hEff,
        listOf(0.0 to 0.03, 0.4 to 0.25, 1.0 to 0.6, 2.0 to 0.85, 4.0 to 1.0, 10.0 to 1.0)
    ) else null
    /* dedge：无云盘 / 无边界时是 0.05（不利），不是「数据缺失」 */
    val dSc = if (c.geomOk && isNum(c.d) && isNum(c.xMax))
        clamp(1 - c.d!! / max(c.xMax!!, 1.0), 0.0, 1.0) * 0.6 + 0.4
    else 0.05
    val blockSc = if (isNum(c.lowBlock)) trap(
        c.lowBlock,
        listOf(0.0 to 1.0, 25.0 to 0.95, 45.0 to 0.72, 65.0 to 0.4, 85.0 to 0.18, 100.0 to 0.1)
    ) else null
    val aeroSc = if (isNum(c.aod)) trap(
        c.aod,
        listOf(
            0.0 to 1.0, 0.1 to 1.0, 0.2 to 0.88, 0.3 to 0.72, 0.5 to 0.52,
            0.8 to 0.26, 1.2 to 0.12, 3.0 to 0.03
        )
    ) else null
    val visSc = if (isNum(c.vis)) trap(
        c.vis!! / 1000.0,
        listOf(0.4 to 0.05, 2.0 to 0.2, 5.0 to 0.42, 10.0 to 0.66, 20.0 to 0.92, 30.0 to 1.0, 80.0 to 1.0)
    ) else null
    val humSc = if (isNum(c.rh)) trap(
        c.rh,
        listOf(5.0 to 0.7, 20.0 to 0.92, 40.0 to 1.0, 75.0 to 1.0, 88.0 to 0.78, 95.0 to 0.45, 100.0 to 0.3)
    ) else null
    val stabSc = if (isNum(c.dP)) trap(
        c.dP,
        listOf(0.0 to 1.0, 0.6 to 1.0, 1.2 to 0.8, 2.5 to 0.52, 6.0 to 0.3)
    ) else null
    val compSc = if (isNum(c.windComp)) trap(
        c.windComp,
        listOf(0.0 to 1.0, 8.0 to 1.0, 15.0 to 0.75, 22.0 to 0.5, 32.0 to 0.3, 50.0 to 0.15)
    ) else null
    val convSc = if (isNum(c.cape)) trap(
        c.cape,
        listOf(0.0 to 1.0, 300.0 to 1.0, 800.0 to 0.8, 1500.0 to 0.55, 3000.0 to 0.32)
    ) else null

    return listOf(
        FacRow("cover", c.cover.takeIf { isNum(it) }, coverSc),
        FacRow("base", c.base.takeIf { isNum(it) }, baseSc),
        FacRow("heq", c.heq, heqSc),
        FacRow("heff", c.hEff, heffSc),
        FacRow("dedge", c.d, dSc),
        FacRow("block", c.lowBlock, blockSc),
        FacRow("aod", c.aod, aeroSc),
        FacRow("vis", c.vis, visSc),
        FacRow("rh", c.rh, humSc),
        FacRow("stab", c.dP, stabSc),
        FacRow("wind", c.windComp, compSc),
        FacRow("cape", c.cape, convSc),
        FacRow("consist", null, clamp(nz(c.consist, 0.0) / 100, 0.0, 1.0))
    )
}

/** 判定 pill（与 V1 pill() 同阈值） */
data class Judgment(val text: String, val cls: String)

fun judgmentOf(score: Double?): Judgment = when {
    !isNum(score) -> Judgment("数据缺失", "miss")
    score!! >= 0.78 -> Judgment("有利", "ok")
    score >= 0.5 -> Judgment("中性", "mid")
    else -> Judgment("不利", "bad")
}

/** 分歧落在哪个轴上（V1 ensConfDetail 同式） */
fun ensConfDetail(spreadP: Double?, spreadQ: Double?): String {
    val a = nz(spreadP, 0.0)
    val b = nz(spreadQ, 0.0)
    if (max(a, b) < 8) return "两方面分歧都很小"
    val mainIsP = a >= b
    return "分歧主要在" + (if (mainIsP) "出现概率" else "观赏质量") +
        "（" + max(a, b).roundToLong() + " 分），" +
        (if (mainIsP) "观赏质量" else "出现概率") + "较一致（" + kotlin.math.min(a, b).roundToLong() + " 分）"
}

data class FacDisplayRow(
    val key: String,
    val name: String,
    val value: String,
    val score: Double?,
    val desc: String,
    val judge: String,
    val judgeCls: String,
    val nameKey: String,
    val descKey: String,
    val valueKey: String? = null,
    val valueArgs: List<String> = emptyList()
)

/* ---------- 显示单位（与网页 v2/src/core/units.ts 同口径；imperial 默认关闭） ---------- */

/** 距离：输入 km */
fun uDist(km: Double?, digits: Int = 0, imperial: Boolean = false): String {
    if (km == null || !km.isFinite()) return "—"
    if (imperial) {
        val mi = km * 0.621371
        val d = if (mi < 10) 1 else digits
        return String.format(java.util.Locale.US, "%.${d}f", mi) + " mi"
    }
    val d = if (km < 10) 1 else digits
    return String.format(java.util.Locale.US, "%.${d}f", km) + " km"
}

/** 高度/厚度：输入米 */
fun uAlt(m: Double?, imperial: Boolean = false): String {
    if (m == null || !m.isFinite()) return "—"
    if (imperial) return Math.round(m * 3.28084).toString() + " ft"
    return if (m >= 1000) {
        val digits = if (m >= 10000) 0 else 2
        String.format(java.util.Locale.US, "%.${digits}f", m / 1000) + " km"
    } else {
        Math.round(m).toString() + " m"
    }
}

/** 风速：输入 m/s */
fun uSpeed(ms: Double?, imperial: Boolean = false): String {
    if (ms == null || !ms.isFinite()) return "—"
    return if (imperial) {
        String.format(java.util.Locale.US, "%.1f", ms * 2.23694) + " mph"
    } else {
        String.format(java.util.Locale.US, "%.1f", ms * 3.6) + " km/h"
    }
}

private fun n1(v: Double?): String =
    if (isNum(v)) String.format(java.util.Locale.US, "%.1f", v) else "—"

private fun n2(v: Double?): String =
    if (isNum(v)) String.format(java.util.Locale.US, "%.2f", v) else "—"

private fun pct(v: Double?): String = if (isNum(v)) v!!.roundToInt().toString() + "%" else "—"

/** 云型长格式：卷云（低云 0% / 中云 0% / 高云 48%）；covers 顺序＝低/中/高 */
fun typeDetailText(type: String, covers: List<Double?>?): String {
    if (type.isBlank()) return "—"
    if (covers == null || covers.size < 3) return type
    val txt = listOf("低云", "中云", "高云").mapIndexed { i, nm ->
        nm + " " + (if (isNum(covers[i])) covers[i]!!.roundToInt().toString() + "%" else "—")
    }.joinToString(" / ")
    return "$type（$txt）"
}

/** 因素面板的完整展示行（缺数一律显 —，绝不压成 0） */
fun facDisplayRows(r: ForecastResult): List<FacDisplayRow> {
    val valMap = r.factorRows.associate { it.key to it.raw }
    val scoreMap = r.factorRows.associate { it.key to it.score }
    val p = r.sRT.primary
    val geom = r.sRT.geom
    val decks = r.sRT.decks

    fun row(
        key: String,
        name: String,
        value: String,
        desc: String,
        valueKey: String? = null,
        valueArgs: List<String> = emptyList()
    ): FacDisplayRow {
        val s = scoreMap[key]
        val j = judgmentOf(s)
        return FacDisplayRow(
            key, name, value, s, desc, j.text, j.cls,
            nameKey = "factor_name_$key",
            descKey = "factor_desc_$key",
            valueKey = valueKey,
            valueArgs = valueArgs
        )
    }

    val coverVal = typeDetailText(p.type, decks.map { it.cover })
    val coverDesc = p.type + "属" + listOf("低云", "中云", "高云").getOrElse(p.level) { "中云" } +
        "，云底约 " + uAlt(p.base * 1000) + "。" + when {
        p.cover < 20 -> "云量偏少，可能没有足够云体承接霞光。"
        p.cover > 90 -> "云量接近全覆盖，阳光难以穿透，易形成闷烧或无霞。"
        else -> "云量处于理想区间，云块之间既能透光又能承接低角度阳光。"
    }

    val heq = valMap["heq"]
    val dEdge = valMap["dedge"]

    return listOf(
        row("cover", "云量类型与覆盖度", coverVal, coverDesc,
            "factor_value_cover", decks.map { pct(it.cover) }),
        row("base", "云底高度", uAlt(p.base * 1000),
            "云底越高，霞光可出现的范围与色相变化越丰富；云底越低，霞光越局限于橘红且持续时间短。"),
        row("heq", "光学等效地表高度", if (isNum(heq)) uDist(heq, 2) else "—",
            "气溶胶把光线“垫高”的等效地表高度，由 AOD 与气溶胶标高 Hs=" + n2(r.sRT.hs) +
                " km 计算（z=Hs·ln(AOD/(Hs·k₀))）。该值越大，等效云底越低，霞光越难形成。"),
        row("heff", "等效云底高度", n2(r.sRT.hEff),
            "云底高度减去光学等效地表高度后的有效高度，是几何判定的真正输入。"),
        if (isNum(dEdge)) {
            row("dedge", "云边界距离", uDist(dEdge),
                "沿日出/日落方位以 25 km 间隔采样得到的云盘外缘距离。必须小于霞光深入距离 " +
                    "2√(2Rh)，阳光才能从云底下方照进来；距离越远，颜色越红、开始越晚。",
                "factor_value_dedge", listOf(uDist(dEdge), uDist(geom.xMax)))
        } else {
            row("dedge", "云边界距离", "—",
                "沿日出/日落方位以 25 km 间隔采样得到的云盘外缘距离。必须小于霞光深入距离 " +
                    "2√(2Rh)，阳光才能从云底下方照进来；距离越远，颜色越红、开始越晚。",
                "factor_value_dedge_none")
        }
        row("block", "光路上游低层云遮挡", pct(valMap["block"]),
            "低云位于霞光光路下方，是最常见的“翻车”原因：低云量高会把阳光彻底挡住。"),
        row("aod", "气溶胶光学厚度 AOD",
            if (isNum(valMap["aod"])) n2(valMap["aod"]) + "（550nm）" else "—",
            when {
                !isNum(valMap["aod"]) -> "本项数据缺失。"
                valMap["aod"]!! < 0.2 -> "气溶胶很少，瑞利散射占主导，阳光颜色纯净、饱和度高，水晶天。"
                valMap["aod"]!! < 0.5 -> "气溶胶一般，天空通透度普通，颜色饱和度会略降。"
                valMap["aod"]!! < 0.8 -> "气溶胶较多，天空偏霾，会明显削弱霞光的亮度与饱和度。"
                else -> "气溶胶大量存在，属“污烧”，低角度霞光细节会被灰霾吞掉。"
            }),
        row("vis", "能见度",
            if (isNum(valMap["vis"])) uDist(valMap["vis"]!! / 1000) else "—",
            "反映底层大气通透程度。能见度低于 5 km 时地面附近霾/雾显著，霞光的低角度部分会被遮挡。"),
        row("rh", "2m 相对湿度", pct(valMap["rh"]),
            "湿度适中利于云的存在与散射；相对湿度过高（>90%）会形成雾并放大气溶胶消光，" +
                "反而使天空浑浊；过低则可能没有云。"),
        row("stab", "气压稳定性",
            if (isNum(valMap["stab"])) "|ΔP/Δt| = " + n2(valMap["stab"]) + " hPa/h" else "—",
            "气压稳定说明天气系统移动缓慢，云边界位置可预测；气压快速变化意味着云况随时可能改变，预报不确定性大。"),
        row("wind", "云边界风速分量", uSpeed(valMap["wind"]),
            "云边界沿日出/日落方向的速度分量。经验上 <15 m/s 云边界位置不确定度小，" +
                ">30 m/s 则很大（云边界会明显推移）。"),
        row("cape", "对流活动",
            (if (isNum(valMap["cape"])) "CAPE " + valMap["cape"]!!.roundToLong() + " J/kg" else "—") +
                (if (isNum(r.envM.precip)) " · 降水 " + String.format(
                    java.util.Locale.US, "%.1f", r.envM.precip
                ) + " mm" else ""),
            "对流强时局地积云/积雨云发展，会随机遮挡光路；但积雨云云砧本身也可能形成漂亮的云砧晚霞。",
            if (isNum(valMap["cape"]) && isNum(r.envM.precip)) "factor_value_cape"
            else if (isNum(valMap["cape"])) "factor_value_cape_only" else null,
            when {
                isNum(valMap["cape"]) && isNum(r.envM.precip) -> listOf(
                    valMap["cape"]!!.roundToLong().toString(),
                    String.format(java.util.Locale.US, "%.1f", r.envM.precip)
                )
                isNum(valMap["cape"]) -> listOf(valMap["cape"]!!.roundToLong().toString())
                else -> emptyList()
            }),
        row("consist", "模式一致性",
            if (isNum(r.dvI))
                r.conf.level + " · ΔI " + r.dvI!!.roundToLong() +
                    "（ΔP " + nz(r.spread, 0.0).roundToLong() +
                    " · ΔQ " + nz(r.spreadQ, 0.0).roundToLong() + "）"
            else "数据不足",
            if (isNum(r.dvI))
                r.conf.txt + "，" + ensConfDetail(r.spread, r.spreadQ) + "。" + r.conf.hint
            else "不足两套算法给出结果，无法评估模型一致性。",
            if (isNum(r.dvI)) "factor_value_consist" else "factor_value_consist_none",
            if (isNum(r.dvI)) listOf(
                r.dvI!!.roundToLong().toString(),
                nz(r.spread, 0.0).roundToLong().toString(),
                nz(r.spreadQ, 0.0).roundToLong().toString()
            ) else emptyList())
    )
}
