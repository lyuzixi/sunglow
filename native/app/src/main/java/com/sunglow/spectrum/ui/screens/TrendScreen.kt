package com.sunglow.spectrum.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.sunglow.spectrum.core.QUALITY_LABEL
import com.sunglow.spectrum.core.TrendWindow
import com.sunglow.spectrum.core.gradeOf
import com.sunglow.spectrum.core.rankWindows
import com.sunglow.spectrum.ui.HomeViewModel
import com.sunglow.spectrum.ui.TrendCell
import com.sunglow.spectrum.ui.TrendRow
import com.sunglow.spectrum.ui.theme.SunglowColors
import com.sunglow.spectrum.ui.theme.SunglowTheme
import com.sunglow.spectrum.ui.trendRampColor
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
fun TrendScreen(vm: HomeViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val colors = SunglowTheme.colors

    LaunchedEffect(Unit) { vm.loadTrend() }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
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
                        text = "十日趋势",
                        style = MaterialTheme.typography.headlineSmall.copy(fontSize = 20.sp),
                        color = colors.ink
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        text = state.city.name,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.faint
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    text = if (state.trendLoading) {
                        "正在计算 ${state.trendDone}/${state.trendTotal} 天…"
                    } else {
                        "朝霞与晚霞逐日概率 · 点任意一天查看详情"
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.faint
                )
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

        val best = bestWindows(state.trend)
        if (best.isNotEmpty()) {
            item {
                Column(Modifier.padding(horizontal = 18.dp)) {
                    Text(
                        text = "最值得出门",
                        style = MaterialTheme.typography.titleSmall,
                        color = colors.ink
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        best.forEachIndexed { i, w ->
                            BestCard(
                                rank = i + 1,
                                date = w.first,
                                periodAm = w.second == 0,
                                cell = w.third,
                                modifier = Modifier.weight(1f),
                                onClick = {
                                    vm.selectDate(w.first)
                                    vm.selectTab(0)
                                }
                            )
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    Text(
                        text = "逐日明细",
                        style = MaterialTheme.typography.titleSmall,
                        color = colors.ink
                    )
                    Spacer(Modifier.height(8.dp))
                }
            }
        }

        items(state.trend, key = { it.date }) { row ->
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
                    text = "还没有趋势数据，点这里加载",
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
}

/** 三天最佳：跨朝/晚按 Q 降序、Q 相同按 P 降序（口径在 core/TrendRank.kt，供单测断言） */
private fun bestWindows(rows: List<TrendRow>): List<Triple<String, Int, TrendCell>> {
    val all = mutableListOf<TrendWindow>()
    rows.forEach { r ->
        r.am?.let { all += TrendWindow(r.date, true, it.p, it.q, it.grade) }
        r.pm?.let { all += TrendWindow(r.date, false, it.p, it.q, it.grade) }
    }
    return rankWindows(all).map {
        Triple(it.date, if (it.periodAm) 0 else 1, TrendCell(it.p, it.q, it.grade))
    }
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
    val summary = date + " " + (if (periodAm) "朝霞" else "晚霞") +
        " 质量 " + cell.q.roundToInt() + " 分 出现概率 " + cell.p.roundToInt() + "%"
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
                contentDescription = "第 " + rank + " 名 " + summary
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
                text = if (periodAm) "朝" else "晚",
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
            text = cell.q.roundToInt().toString() + " 分",
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
                text = QUALITY_LABEL[cell.grade] ?: cell.grade,
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                color = gradeCol
            )
        }
    }
}

@Composable
private fun TrendDayRow(row: TrendRow, onClick: () -> Unit) {
    val colors = SunglowTheme.colors
    fun descOf(c: TrendCell?): String =
        if (c == null) "无数据" else c.p.roundToInt().toString() + "% 质量 " + c.q.roundToInt() + " 分"
    val desc = row.date + " 朝霞 " + descOf(row.am) + " 晚霞 " + descOf(row.pm)
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
                contentDescription = desc + "，点击查看当日结论"
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
                text = weekdayOf(row.date),
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                color = colors.faint
            )
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            ProbRow("朝", row.am)
            ProbRow("晚", row.pm)
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
                    text = (QUALITY_LABEL[cell.grade]?.take(1) ?: cell.grade) +
                        cell.q.roundToInt().toString(),
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
    "优" -> Color(0xFF9FE6BD)
    "良" -> Color(0xFF9AC765)
    "一般" -> colors.mid
    else -> colors.bad
}

private fun weekdayOf(dateStr: String): String = try {
    when (LocalDate.parse(dateStr).dayOfWeek.value) {
        1 -> "周一"; 2 -> "周二"; 3 -> "周三"; 4 -> "周四"
        5 -> "周五"; 6 -> "周六"; else -> "周日"
    }
} catch (_: Exception) {
    ""
}
