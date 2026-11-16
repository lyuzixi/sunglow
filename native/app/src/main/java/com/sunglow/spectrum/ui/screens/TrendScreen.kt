package com.sunglow.spectrum.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.ui.platform.LocalContext
import com.sunglow.spectrum.R
import com.sunglow.spectrum.core.ModelSel
import com.sunglow.spectrum.core.TrendWindow
import com.sunglow.spectrum.core.fmtClock
import com.sunglow.spectrum.core.glowWindow
import com.sunglow.spectrum.core.gradeOf
import com.sunglow.spectrum.core.rankWindows
import com.sunglow.spectrum.core.verdictViewOf
import com.sunglow.spectrum.ui.AppPage
import com.sunglow.spectrum.ui.HomeViewModel
import com.sunglow.spectrum.ui.components.ShareIcon
import com.sunglow.spectrum.ui.TrendCell
import com.sunglow.spectrum.ui.TrendRow
import com.sunglow.spectrum.ui.theme.SunglowColors
import com.sunglow.spectrum.ui.theme.SunglowTheme
import com.sunglow.spectrum.ui.trendRampColor
import com.sunglow.spectrum.ui.share.ShareCard
import java.time.LocalDate
import kotlin.math.roundToInt

/*
 * 十日趋势（N2 · 对齐网页 v2/src/components/TrendSection.vue 当前形态）
 *   · 取数：区间取数（朝/晚各 3 请求），缓存命中后再次进入很快。
 *   · 最佳窗口：跨朝/晚按质量分 Q 降序、Q 相同按概率 P 降序，取前三（core/TrendRank.kt）。
 *   · 明细：概率条 + 完整等级/质量分徽章；概率数字用冷青蓝两端插值（ui/TrendRamp.kt）。
 *   · 点任意一天：载入该日期并切回结论 Tab。
 * 注：网页「10×2 热力格」目前只用于合成分享卡（composecard.ts TREND_RAMP），
 *     广场页是概率条版；热力格形态留到 N4 的分享卡趋势块对齐。
 */

@Composable
fun TrendScreen(vm: HomeViewModel = viewModel(), onOpenPage: (AppPage) -> Unit = {}) {
    val state by vm.state.collectAsStateWithLifecycle()
    val colors = SunglowTheme.colors
    val context = LocalContext.current
    var model by rememberSaveable { mutableStateOf(ModelSel.ENS) }
    var shareOpen by rememberSaveable { mutableStateOf(false) }
    val listState = rememberLazyListState()
    val shareResult = state.result
    var lastTabTap by rememberSaveable { mutableStateOf(state.tabTap) }
    LaunchedEffect(state.tabTap) {
        if (state.tabTap != lastTabTap) {
            lastTabTap = state.tabTap
            if (state.tab == 1) listState.scrollToItem(0)
        }
    }
    val dark = when (state.themeMode) {
        1 -> true
        2 -> false
        else -> isSystemInDarkTheme()
    }
    val rows = state.trend.map { row ->
        row.copy(am = row.am?.forModel(model), pm = row.pm?.forModel(model))
    }

    LaunchedEffect(Unit) { vm.loadTrend(cacheOnly = true) }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        state = listState,
        contentPadding = PaddingValues(bottom = 24.dp)
    ) {
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(horizontal = 18.dp, vertical = 14.dp)
            ) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(
                        text = stringResource(R.string.trend_title),
                        style = MaterialTheme.typography.headlineSmall.copy(fontSize = 20.sp),
                        color = colors.ink
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        text = state.city.name,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.faint
                    )
                    if (rows.isNotEmpty()) {
                        Spacer(Modifier.width(8.dp))
                        if (shareResult != null) {
                            Box(
                                modifier = Modifier
                                    .size(48.dp)
                                    .clip(RoundedCornerShape(999.dp))
                                    .background(colors.glass)
                                    .clickable { shareOpen = true }
                                    .semantics { contentDescription = context.getString(R.string.share_title) },
                                contentAlignment = Alignment.Center
                            ) {
                                ShareIcon(colors.accentCool, 15.dp)
                            }
                        }
                        Spacer(Modifier.width(12.dp))
                        Text(
                            text = stringResource(R.string.trend_save),
                            style = MaterialTheme.typography.labelSmall,
                            color = colors.accentCool,
                            modifier = Modifier
                                .clip(RoundedCornerShape(999.dp))
                                .border(1.dp, colors.ruleStrong, RoundedCornerShape(999.dp))
                                .clickable {
                                    val bmp = ShareCard.renderTrend(context, rows, state.city.shortName, dark)
                                    ShareCard.shareBitmap(
                                        context,
                                        bmp,
                                        "sunglow-trend-${state.city.shortName}.png",
                                        state.city.name + " · " + context.getString(R.string.trend_title)
                                    )
                                }
                                .padding(horizontal = 10.dp, vertical = 8.dp)
                        )
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    text = if (state.trendLoading) {
                        stringResource(R.string.trend_loading, state.trendDone, state.trendTotal)
                    } else {
                        stringResource(R.string.trend_sub)
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.faint
                )
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    ModelSel.values().forEach { option ->
                        val label = when (option) {
                            ModelSel.ENS -> stringResource(R.string.model_ens)
                            ModelSel.GFS -> "GFS"
                            ModelSel.EC -> "EC"
                            ModelSel.RT -> stringResource(R.string.model_rt)
                        }
                        Text(
                            text = label,
                            color = if (model == option) colors.bg else colors.muted,
                            fontSize = 10.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(999.dp))
                                .background(if (model == option) colors.accentCool else colors.bg3)
                                .clickable { model = option }
                                .padding(vertical = 10.dp)
                        )
                    }
                }
                if (rows.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Canvas(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp))) {
                        drawRect(
                            brush = Brush.horizontalGradient(
                                listOf(0.0, 25.0, 50.0, 75.0, 100.0).map { trendRampColor(it, colors.isDark) }
                            ),
                            size = size
                        )
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        listOf(R.string.grade_short_cha, R.string.grade_short_yiban, R.string.grade_short_liang, R.string.grade_short_you).forEach {
                            Text(stringResource(it), color = colors.faint, fontSize = 9.sp)
                        }
                    }
                }
                if (state.trendLoading) {
                    Spacer(Modifier.height(8.dp))
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(2.dp)
                            .clip(RoundedCornerShape(2.dp))
                            .background(colors.rule)
                    ) {
                        val frac = if (state.trendTotal > 0) {
                            state.trendDone.toFloat() / state.trendTotal
                        } else 0f
                        Box(
                            Modifier
                                .fillMaxWidth(frac.coerceIn(0f, 1f))
                                .fillMaxHeight()
                                .background(Brush.horizontalGradient(colors.spectrum))
                        )
                    }
                }
            }
        }

        val best = bestWindows(rows)
        if (best.isNotEmpty()) {
            item {
                Column(Modifier.padding(horizontal = 18.dp)) {
                    Text(
                        text = stringResource(R.string.trend_best),
                        style = MaterialTheme.typography.titleSmall,
                        color = colors.ink
                    )
                    Spacer(Modifier.height(4.dp))
                    bestWindowLabel(best.first().third)?.let { label ->
                        Text(
                            text = stringResource(R.string.trend_best_window, best.first().first, label),
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.accentCool
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    BoxWithConstraints {
                        if (maxWidth < 420.dp) {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                best.forEachIndexed { i, w ->
                                    BestCard(i + 1, w.first, w.second == 0, w.third, Modifier.fillMaxWidth()) {
                                        vm.selectDate(w.first)
                                        vm.selectTab(0)
                                    }
                                }
                            }
                        } else {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                best.forEachIndexed { i, w ->
                                    BestCard(i + 1, w.first, w.second == 0, w.third, Modifier.weight(1f)) {
                                        vm.selectDate(w.first)
                                        vm.selectTab(0)
                                    }
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    Text(
                        text = stringResource(R.string.trend_detail),
                        style = MaterialTheme.typography.titleSmall,
                        color = colors.ink
                    )
                    Spacer(Modifier.height(8.dp))
                }
            }
        }

        items(rows, key = { it.date }) { row ->
            TrendDayRow(
                row = row,
                onClick = {
                    vm.selectDate(row.date)
                    vm.selectTab(0)
                }
            )
        }

        if (state.trendError != null) {
            item {
                Text(
                    text = state.trendError ?: "",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.bad,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { vm.loadTrend(force = true) }
                        .padding(18.dp),
                    textAlign = TextAlign.Center
                )
            }
        }

        if (state.trend.isEmpty() && !state.trendLoading) {
            item {
                Text(
                    text = stringResource(R.string.trend_empty),
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.accentCool,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { vm.loadTrend(force = true) }
                        .padding(24.dp),
                    textAlign = TextAlign.Center
                )
            }
        }
    }

    if (shareOpen && shareResult != null) {
        ShareBottomSheetModal(
            result = shareResult,
            view = verdictViewOf(shareResult, model),
            state = state,
            onLoadHeat = { vm.loadMapHeat() },
            onDismiss = { shareOpen = false },
            onOpenFull = {
                shareOpen = false
                onOpenPage(AppPage.Share)
            }
        )
    }
}

/** 三天最佳：跨朝/晚按 Q 降序、Q 相同按 P 降序（口径在 core/TrendRank.kt，供单测断言） */
private fun bestWindows(rows: List<TrendRow>): List<Triple<String, Int, TrendCell>> {
    val candidates = mutableListOf<Pair<TrendWindow, TrendCell>>()
    rows.forEach { r ->
        r.am?.let { candidates += TrendWindow(r.date, true, it.p, it.q, it.grade) to it }
        r.pm?.let { candidates += TrendWindow(r.date, false, it.p, it.q, it.grade) to it }
    }
    return rankWindows(candidates.map { it.first }).map { ranked ->
        val original = candidates.first { it.first == ranked }.second
        Triple(ranked.date, if (ranked.periodAm) 0 else 1, original)
    }
}

private fun TrendCell.forModel(model: ModelSel): TrendCell {
    val r = result ?: return this
    val view = verdictViewOf(r, model)
    return copy(p = view.p, q = view.q, grade = view.grade)
}

private fun bestWindowLabel(cell: TrendCell): String? {
    val r = cell.result ?: return null
    if (r.evMs <= 0L) return null
    val duration = r.sRT.geom.dur.takeIf { it.isFinite() && it > 0.0 } ?: 20.0
    val window = glowWindow(r.evMs, r.period.name == "AM", r.city.lat, r.city.lon, r.sRT.geom.thNearDeg, r.sRT.geom.thFarDeg)
        ?: (r.evMs - (duration * 30_000).toLong() to r.evMs + (duration * 30_000).toLong())
    return fmtClock(window.first, r.tz) + "–" + fmtClock(window.second, r.tz)
}

@Composable
private fun BestCard(
    rank: Int,
    date: String,
    periodAm: Boolean,
    cell: TrendCell,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val colors = SunglowTheme.colors
    val gradeCol = bandColor(cell.grade, colors)
    val periodText = stringResource(if (periodAm) R.string.trend_am else R.string.trend_pm)
    val summary = date + " " + periodText + " " +
        stringResource(R.string.trend_quality, cell.q.roundToInt(), cell.p.roundToInt())
    val rankDesc = stringResource(R.string.trend_rank, rank, summary)
    Column(
        modifier = modifier
            .heightIn(min = 44.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(colors.card)
            .border(
                width = if (rank == 1) 1.5.dp else 1.dp,
                color = if (rank == 1) colors.accent else colors.rule,
                shape = RoundedCornerShape(12.dp)
            )
            .clickable(onClick = onClick)
            .semantics(mergeDescendants = true) {
                contentDescription = rankDesc
            }
            .padding(10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = when (rank) { 1 -> "①"; 2 -> "②"; else -> "③" },
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 12.sp),
                color = if (rank == 1) colors.accent else colors.faint
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = stringResource(if (periodAm) R.string.trend_am_short else R.string.trend_pm_short),
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                color = colors.faint
            )
        }
        Spacer(Modifier.height(4.dp))
        Text(
            text = date.takeLast(5).replace('-', '/'),
            style = MaterialTheme.typography.bodyMedium,
            color = colors.ink,
            fontWeight = FontWeight.SemiBold
        )
        Spacer(Modifier.height(2.dp))
        Text(
            text = stringResource(R.string.trend_score, cell.q.roundToInt()),
            style = MaterialTheme.typography.titleMedium.copy(
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold
            ),
            color = gradeCol
        )
        Spacer(Modifier.height(4.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = cell.p.roundToInt().toString() + "%",
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                color = colors.accent
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = gradeLabel(cell.grade),
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                color = gradeCol
            )
        }
    }
}

@Composable
private fun TrendDayRow(row: TrendRow, onClick: () -> Unit) {
    val colors = SunglowTheme.colors
    val none = stringResource(R.string.trend_none)
    val amDesc = row.am?.let {
        stringResource(R.string.trend_cell_desc, it.p.roundToInt(), it.q.roundToInt())
    } ?: none
    val pmDesc = row.pm?.let {
        stringResource(R.string.trend_cell_desc, it.p.roundToInt(), it.q.roundToInt())
    } ?: none
    val desc = stringResource(R.string.trend_row_desc, row.date, amDesc, pmDesc) +
        stringResource(R.string.trend_click)
    val weekday = weekdayRes(row.date)?.let { stringResource(it) } ?: ""
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .padding(horizontal = 18.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(colors.card)
            .border(1.dp, colors.rule, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .semantics(mergeDescendants = true) {
                contentDescription = desc
            }
            .padding(horizontal = 12.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.width(60.dp)) {
            Text(
                text = row.date.takeLast(5).replace('-', '/'),
                style = MaterialTheme.typography.bodyMedium,
                color = colors.ink,
                fontWeight = FontWeight.Medium
            )
            Text(
                text = weekday,
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                color = colors.faint
            )
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            ProbRow(stringResource(R.string.trend_am_short), row.am)
            ProbRow(stringResource(R.string.trend_pm_short), row.pm)
        }
    }
}

@Composable
private fun ProbRow(label: String, cell: TrendCell?) {
    val colors = SunglowTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
            color = colors.faint,
            modifier = Modifier.width(14.dp)
        )
        Box(
            Modifier
                .weight(1f)
                .height(4.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(colors.rule)
        ) {
            if (cell != null) {
                Box(
                    Modifier
                        .fillMaxWidth((cell.p / 100.0).toFloat().coerceIn(0f, 1f))
                        .fillMaxHeight()
                        /* 冷青蓝两端插值：不用「单色 + alpha」，低值也不会压成脏紫 */
                        .background(trendRampColor(cell.p, colors.isDark))
                )
            }
        }
        Text(
            text = if (cell != null) cell.p.roundToInt().toString() + "%" else "—",
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
            color = if (cell != null) colors.ink else colors.faint,
            textAlign = TextAlign.End,
            modifier = Modifier.width(34.dp)
        )
        if (cell != null) {
            Box(
                modifier = Modifier
                    .width(46.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(bandColor(cell.grade, colors).copy(alpha = 0.12f))
                    .padding(vertical = 1.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    /* 网页 qb 徽章：等级 + 质量分；数字可读色不用浅色阶 */
                    text = gradeShort(cell.grade) + cell.q.roundToInt().toString(),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.sp),
                    color = bandColor(cell.grade, colors)
                )
            }
        } else {
            Spacer(Modifier.width(46.dp))
        }
    }
}

private fun bandColor(grade: String, colors: SunglowColors): Color = when (grade) {
    com.sunglow.spectrum.core.GRADE_YOU -> Color(0xFF9FE6BD)
    com.sunglow.spectrum.core.GRADE_LIANG -> Color(0xFF9AC765)
    com.sunglow.spectrum.core.GRADE_YIBAN -> colors.mid
    else -> colors.bad
}

@Composable
private fun gradeLabel(grade: String): String = stringResource(
    when (grade) {
        com.sunglow.spectrum.core.GRADE_YOU -> R.string.grade_you
        com.sunglow.spectrum.core.GRADE_LIANG -> R.string.grade_liang
        com.sunglow.spectrum.core.GRADE_YIBAN -> R.string.grade_yiban
        else -> R.string.grade_cha
    }
)

@Composable
private fun gradeShort(grade: String): String = stringResource(
    when (grade) {
        com.sunglow.spectrum.core.GRADE_YOU -> R.string.grade_short_you
        com.sunglow.spectrum.core.GRADE_LIANG -> R.string.grade_short_liang
        com.sunglow.spectrum.core.GRADE_YIBAN -> R.string.grade_short_yiban
        else -> R.string.grade_short_cha
    }
)

private fun weekdayRes(dateStr: String): Int? = try {
    when (LocalDate.parse(dateStr).dayOfWeek.value) {
        1 -> R.string.trend_week_mon
        2 -> R.string.trend_week_tue
        3 -> R.string.trend_week_wed
        4 -> R.string.trend_week_thu
        5 -> R.string.trend_week_fri
        6 -> R.string.trend_week_sat
        else -> R.string.trend_week_sun
    }
} catch (_: Exception) {
    null
}
