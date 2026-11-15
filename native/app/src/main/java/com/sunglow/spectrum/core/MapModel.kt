package com.sunglow.spectrum.core

/** 地图模型取值只读已有 HeatCell 分量，不增加任何网络请求。 */
fun heatPOf(cell: HeatCell, model: ModelSel): Double = when (model) {
    ModelSel.ENS -> cell.ensP.takeIf { it.isFinite() } ?: cell.p
    ModelSel.GFS -> cell.gfsP ?: cell.ensP.takeIf { it.isFinite() } ?: cell.p
    ModelSel.EC -> cell.ecP ?: cell.ensP.takeIf { it.isFinite() } ?: cell.p
    ModelSel.RT -> cell.rtP.takeIf { it.isFinite() } ?: cell.p
}

fun heatQOf(cell: HeatCell, model: ModelSel): Double = when (model) {
    ModelSel.ENS -> cell.ensQ.takeIf { it.isFinite() } ?: cell.q
    ModelSel.GFS -> cell.gfsQ ?: cell.ensQ.takeIf { it.isFinite() } ?: cell.q
    ModelSel.EC -> cell.ecQ ?: cell.ensQ.takeIf { it.isFinite() } ?: cell.q
    ModelSel.RT -> cell.rtQ.takeIf { it.isFinite() } ?: cell.q
}

fun heatValueOf(cell: HeatCell, dim: String, model: ModelSel): Double = when (dim.lowercase()) {
    "p" -> heatPOf(cell, model)
    "q" -> heatQOf(cell, model)
    "dv" -> cell.refGap
    else -> 0.55 * heatPOf(cell, model) + 0.45 * heatQOf(cell, model)
}

fun topHeatCells(grid: HeatGrid, model: ModelSel = ModelSel.ENS, limit: Int = 4): List<HeatCell> =
    grid.cells.sortedByDescending { heatValueOf(it, "mix", model) }.take(limit.coerceAtLeast(0))
