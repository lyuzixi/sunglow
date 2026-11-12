package com.sunglow.spectrum.core

/*
 * SUNGLOW · 结论视图
 * 口径来源：v2/src/core/verdict.ts。
 * 结论卡上的主数字由「当前选中的模型」决定：综合＝加权几何平均，
 * 单模型＝该路自己的 P/Q（等级按单路 Q 重新判）。
 */

enum class ModelSel(val id: String, val label: String) {
    ENS("ens", "多模型综合"),
    GFS("gfs", "GFS"),
    EC("ec", "ECMWF"),
    RT("rt", "光追")
}

data class VerdictView(
    val p: Double,
    val q: Double,
    val grade: String,
    val label: String,
    /** true＝单模型视图（结论卡上要标出模型名） */
    val single: Boolean
)

fun verdictViewOf(r: ForecastResult, sel: ModelSel): VerdictView {
    if (sel == ModelSel.ENS) {
        return VerdictView(r.p, r.q, r.grade, ModelSel.ENS.label, false)
    }
    val m = r.models.firstOrNull { it.id == sel.id }
        ?: return VerdictView(r.p, r.q, r.grade, ModelSel.ENS.label, false)
    return VerdictView(m.p, m.q, gradeOf(m.q), m.label, true)
}
