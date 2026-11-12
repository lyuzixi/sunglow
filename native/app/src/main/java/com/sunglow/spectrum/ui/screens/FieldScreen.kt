package com.sunglow.spectrum.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.sunglow.spectrum.core.ForecastResult
import com.sunglow.spectrum.core.Period
import com.sunglow.spectrum.core.fmtDur
import com.sunglow.spectrum.core.isNum
import com.sunglow.spectrum.core.uAlt
import com.sunglow.spectrum.core.uDist
import com.sunglow.spectrum.ui.HomeUiState
import com.sunglow.spectrum.ui.HomeViewModel
import com.sunglow.spectrum.ui.theme.SunglowColors
import com.sunglow.spectrum.ui.theme.SunglowTheme
import java.util.Locale
import kotlin.math.roundToInt

/*
 * 观测场（当前版：光路剖面）
 * 完整地图版需要地图 SDK；这一版先用"沿太阳方位的样带剖面"把云盘位置与霞光深入距离讲清楚。
 */

@Composable
fun FieldScreen(vm: HomeViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val colors = SunglowTheme.colors
    val result = state.result

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .statusBarsPadding()
            .padding(bottom = 24.dp)
    ) {
        Column(Modifier.padding(horizontal = 18.dp, vertical = 14.dp)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    text = "观测场",
                    style = MaterialTheme.typography.headlineSmall.copy(fontSize = 20.sp),
                    color = colors.ink
                )
                Spacer(Modifier.weight(1f))
                Text(
                    text = state.city.name + " · " + (if (state.period == Period.AM) "朝霞" else "晚霞"),
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.faint
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(
                text = "沿日出/日落方位的光路剖面",
                style = MaterialTheme.typography.labelSmall,
                color = colors.faint
            )
        }

        if (result == null) {
            Text(
                text = if (state.loading) "正在取数…" else "暂无数据，请先回结论页计算",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.muted,
                modifier = Modifier.padding(18.dp)
            )
            return@Column
        }

        RayProfile(result)

        Column(Modifier.padding(horizontal = 18.dp, vertical = 12.dp)) {
            Text(
                text = "云幕与光路",
                style = MaterialTheme.typography.titleSmall,
                color = colors.ink
            )
            Spacer(Modifier.height(8.dp))
            Panel {
                InfoRow("主云层", result.sRT.primary.nameZh + " · " + result.sRT.primary.type)
                InfoRow("云量", result.sRT.primary.cover.roundToInt().toString() + "%")
                InfoRow("云底高度", uAlt(result.sRT.primary.base * 1000))
                InfoRow("云边界距离", uDist(result.sRT.d))
                InfoRow("霞光深入上限", uDist(result.sRT.geom.xMax))
                InfoRow("持续时间", fmtDur(result.sRT.geom.dur))
                InfoRow("等效地面高度", uAlt(result.sRT.heq * 1000))
            }

            Spacer(Modifier.height(12.dp))
            Text(
                text = "几何判定",
                style = MaterialTheme.typography.titleSmall,
                color = colors.ink
            )
            Spacer(Modifier.height(8.dp))
            Panel {
                Text(
                    text = if (result.sRT.geom.ok) {
                        "火烧云三角几何条件成立：阳光可以从云底下方射入。"
                    } else if (isNum(result.sRT.d)) {
                        "不成立：云边界 ${uDist(result.sRT.d)} 已超过霞光深入上限 ${uDist(result.sRT.geom.xMax)}。"
                    } else {
                        "不成立：日出/日落方向 400 km 内没有可承载霞光的云盘。"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = if (result.sRT.geom.ok) colors.good else colors.bad,
                    lineHeight = 18.sp
                )
            }

            Spacer(Modifier.height(12.dp))
            Text(
                text = "多点对比",
                style = MaterialTheme.typography.titleSmall,
                color = colors.ink
            )
            Spacer(Modifier.height(8.dp))
            ComparePanel(state, onClear = vm::clearCompare)

            Spacer(Modifier.height(12.dp))
            Text(
                text = "周边点位",
                style = MaterialTheme.typography.titleSmall,
                color = colors.ink
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = "点选城市加入对比，最多 4 个",
                style = MaterialTheme.typography.labelSmall,
                color = colors.faint
            )
            Spacer(Modifier.height(8.dp))
            NearbyPanel(state, onToggle = vm::toggleCompare, nearby = vm.nearby(8))

            Spacer(Modifier.height(12.dp))
            Text(
                text = "实况校准",
                style = MaterialTheme.typography.titleSmall,
                color = colors.ink
            )
            Spacer(Modifier.height(8.dp))
            CalibPanel(state, onRecord = vm::recordSighting)

            Spacer(Modifier.height(12.dp))
            Text(
                text = "说明",
                style = MaterialTheme.typography.titleSmall,
                color = colors.ink
            )
            Spacer(Modifier.height(8.dp))
            Panel {
                Text(
                    text = "剖面沿日出/日落方位取 17 个等距采样点，逐点读取云量、云底与气溶胶。" +
                        "当前版本先以剖面呈现；完整地图版（可拖拽、可选点对比）在后续版本接入。",
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.faint,
                    lineHeight = 16.sp
                )
            }
        }
    }
}

/* ---------- 剖面 ---------- */

@Composable
private fun RayProfile(result: ForecastResult) {
    val colors = SunglowTheme.colors
    val d = result.sRT.d
    val xMax = result.sRT.geom.xMax
    val ok = result.sRT.geom.ok

    Column(modifier = Modifier.padding(horizontal = 18.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "日落方位",
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
                color = colors.faint
            )
            Spacer(Modifier.width(6.dp))
            Text(
                text = String.format(Locale.US, "%.1f", result.evAz) + "°",
                style = MaterialTheme.typography.bodySmall.copy(
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold
                ),
                color = colors.accentCool
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = "云边界 " + uDist(d) + " / 上限 " + uDist(xMax),
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                color = colors.faint
            )
        }
        Spacer(Modifier.height(6.dp))

        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(168.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(colors.card)
                .border(1.dp, colors.rule, RoundedCornerShape(14.dp))
        ) {
            val w = size.width
            val h = size.height
            val baseY = h * 0.66f
            val left = 22.dp.toPx()
            val right = w - 22.dp.toPx()
            val spanKm = maxOf(
                if (isNum(xMax)) xMax * 1.45 else 60.0,
                if (isNum(d)) d!! * 1.25 else 30.0,
                50.0
            )

            fun xOf(km: Double): Float =
                left + (right - left) * (km / spanKm).toFloat().coerceIn(0f, 1f)

            /* 地平线 */
            drawLine(
                color = colors.ruleStrong,
                start = Offset(left, baseY),
                end = Offset(right, baseY),
                strokeWidth = 1.dp.toPx()
            )

            /* 17 个采样点 */
            val n = 17
            for (i in 0 until n) {
                val x = left + (right - left) * i / (n - 1).toFloat()
                drawCircle(
                    color = colors.ruleStrong,
                    radius = 1.6.dp.toPx(),
                    center = Offset(x, baseY)
                )
            }

            /* 霞光深入上限：虚线 */
            if (isNum(xMax)) {
                val xLim = xOf(xMax)
                var x = xLim
                var dashOn = true
                while (x < right) {
                    if (dashOn) {
                        drawLine(
                            color = colors.accentCool.copy(alpha = 0.55f),
                            start = Offset(x, baseY - 34.dp.toPx()),
                            end = Offset(minOf(x + 4.dp.toPx(), right), baseY - 34.dp.toPx()),
                            strokeWidth = 1.dp.toPx()
                        )
                    }
                    x += 7.dp.toPx()
                    dashOn = !dashOn
                }
                drawLine(
                    color = colors.accentCool.copy(alpha = 0.35f),
                    start = Offset(xLim, baseY - 34.dp.toPx()),
                    end = Offset(xLim, baseY),
                    strokeWidth = 1.dp.toPx()
                )
            }

            /* 城市 */
            drawCircle(
                color = colors.accentCool.copy(alpha = 0.22f),
                radius = 9.dp.toPx(),
                center = Offset(left, baseY)
            )
            drawCircle(
                color = colors.accentCool,
                radius = 3.2.dp.toPx(),
                center = Offset(left, baseY)
            )

            /* 云盘 */
            if (isNum(d)) {
                val xd = xOf(d!!)
                val cloudW = 30.dp.toPx()
                val cloudY = baseY - 26.dp.toPx()
                drawRoundRect(
                    brush = Brush.horizontalGradient(
                        listOf(
                            Color(0xCCFF9C3F),
                            Color(0x99FF4D82),
                            Color(0x66CF6F42)
                        )
                    ),
                    topLeft = Offset(xd - cloudW / 2, cloudY - 8.dp.toPx()),
                    size = Size(cloudW, 16.dp.toPx()),
                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(8.dp.toPx())
                )
                drawLine(
                    color = colors.accent.copy(alpha = 0.45f),
                    start = Offset(xd, cloudY + 9.dp.toPx()),
                    end = Offset(xd, baseY),
                    strokeWidth = 1.dp.toPx()
                )
            }

            /* 太阳 */
            val sunX = right - 6.dp.toPx()
            drawCircle(
                color = Color(0xFFFFC773).copy(alpha = 0.28f),
                radius = 14.dp.toPx(),
                center = Offset(sunX, baseY - 40.dp.toPx())
            )
            drawCircle(
                color = Color(0xFFFFD9A0),
                radius = 6.dp.toPx(),
                center = Offset(sunX, baseY - 40.dp.toPx())
            )
            /* 光线 */
            for (i in 0..2) {
                val y = baseY - (24f + i * 8f).dp.toPx()
                drawLine(
                    color = Color(0xFFFFD9A0).copy(alpha = 0.22f),
                    start = Offset(sunX - 12.dp.toPx(), y),
                    end = Offset(if (isNum(d)) xOf(d!!) + 16.dp.toPx() else left + 40.dp.toPx(), y + 10.dp.toPx()),
                    strokeWidth = 1.dp.toPx()
                )
            }

            /* 超出上限区域：斜线阴影 */
            if (isNum(xMax)) {
                val xLim = xOf(xMax)
                if (xLim < right) {
                    drawRect(
                        color = Color(0x22000000),
                        topLeft = Offset(xLim, 0f),
                        size = Size(right - xLim, baseY),
                    )
                }
            }

            /* 状态点 */
            drawCircle(
                color = if (ok) colors.good else colors.bad,
                radius = 2.4.dp.toPx(),
                center = Offset(left + 8.dp.toPx(), baseY - 30.dp.toPx()),
                style = Stroke(width = 1.2.dp.toPx())
            )
        }

        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth()) {
            Text(
                text = "城市",
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.5.sp),
                color = colors.faint
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = "云盘",
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.5.sp),
                color = colors.accent
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = "太阳",
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.5.sp),
                color = Color(0xFFFFC773)
            )
        }
    }
}

/* ---------- 多点对比 ---------- */

@Composable
private fun ComparePanel(state: HomeUiState, onClear: () -> Unit) {
    val colors = SunglowTheme.colors
    Panel {
        if (state.compareCities.isEmpty()) {
            Text(
                text = "还没有选点。下方「周边点位」里点城市即可加入对比。",
                style = MaterialTheme.typography.labelSmall,
                color = colors.faint,
                lineHeight = 16.sp
            )
            return@Panel
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "已选 ${state.compareCities.size}/4",
                style = MaterialTheme.typography.labelSmall,
                color = colors.faint
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = if (state.compareLoading) "计算中…" else "清空",
                style = MaterialTheme.typography.labelSmall,
                color = if (state.compareLoading) colors.faint else colors.accentCool,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .clickable(enabled = !state.compareLoading, onClick = onClear)
                    .padding(horizontal = 6.dp, vertical = 2.dp)
            )
        }
        Spacer(Modifier.height(6.dp))
        state.compareRows.forEach { row ->
            Column(Modifier.padding(vertical = 4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = row.city.name,
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.ink,
                        modifier = Modifier.weight(1f)
                    )
                    Text(
                        text = row.p.roundToInt().toString() + "%",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.accent,
                        fontWeight = FontWeight.SemiBold
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = "Q " + row.q.roundToInt(),
                        style = MaterialTheme.typography.labelSmall,
                        color = colors.accentAlt
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = gradeLabel(row.grade),
                        style = MaterialTheme.typography.labelSmall,
                        color = bandColor(row.grade, colors)
                    )
                }
                Spacer(Modifier.height(3.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(3.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(colors.rule)
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth((row.p / 100.0).toFloat().coerceIn(0f, 1f))
                            .height(3.dp)
                            .background(Brush.horizontalGradient(colors.spectrum))
                    )
                }
            }
        }
        if (state.compareError != null) {
            Spacer(Modifier.height(4.dp))
            Text(
                text = state.compareError,
                style = MaterialTheme.typography.labelSmall,
                color = colors.bad
            )
        }
        if (state.compareRows.size < state.compareCities.size && !state.compareLoading) {
            Spacer(Modifier.height(4.dp))
            Text(
                text = "部分点位没有取到数据（可能超出预报范围）",
                style = MaterialTheme.typography.labelSmall,
                color = colors.faint
            )
        }
    }
}

/* ---------- 周边点位 ---------- */

@Composable
private fun NearbyPanel(
    state: HomeUiState,
    onToggle: (com.sunglow.spectrum.core.City) -> Unit,
    nearby: List<Pair<com.sunglow.spectrum.core.City, Double>>
) {
    val colors = SunglowTheme.colors
    val selected = state.compareCities.map { it.name }.toSet()
    Panel {
        nearby.forEachIndexed { i, (city, km) ->
            if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(colors.rule))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onToggle(city) }
                    .padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = city.name,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (selected.contains(city.name)) colors.accentCool else colors.ink,
                    modifier = Modifier.weight(1f)
                )
                Text(
                    text = km.roundToInt().toString() + " km",
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.faint
                )
                Spacer(Modifier.width(10.dp))
                Box(
                    modifier = Modifier
                        .size(16.dp)
                        .clip(RoundedCornerShape(5.dp))
                        .background(
                            if (selected.contains(city.name)) colors.accentCool.copy(alpha = 0.22f)
                            else Color.Transparent
                        )
                        .border(
                            1.dp,
                            if (selected.contains(city.name)) colors.accentCool else colors.ruleStrong,
                            RoundedCornerShape(5.dp)
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    if (selected.contains(city.name)) {
                        Text(
                            text = "✓",
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                            color = colors.accentCool
                        )
                    }
                }
            }
        }
    }
}

/* ---------- 实况校准 ---------- */

@Composable
private fun CalibPanel(state: HomeUiState, onRecord: (Boolean) -> Unit) {
    val colors = SunglowTheme.colors
    val rec = state.sightings[state.city.name] ?: (0 to 0)
    Panel {
        Text(
            text = state.city.name + " · 已记录 " + rec.second + " 次，看到 " + rec.first + " 次",
            style = MaterialTheme.typography.bodySmall,
            color = colors.muted
        )
        if (rec.second > 0) {
            Spacer(Modifier.height(4.dp))
            Text(
                text = "本地命中率 " + (rec.first * 100 / rec.second) + "%（只统计你自己的记录）",
                style = MaterialTheme.typography.labelSmall,
                color = colors.faint
            )
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(999.dp))
                    .background(colors.good.copy(alpha = 0.14f))
                    .border(1.dp, colors.good.copy(alpha = 0.45f), RoundedCornerShape(999.dp))
                    .clickable { onRecord(true) }
                    .padding(vertical = 9.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "这次看到了",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.good
                )
            }
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(999.dp))
                    .background(colors.glass)
                    .border(1.dp, colors.ruleStrong, RoundedCornerShape(999.dp))
                    .clickable { onRecord(false) }
                    .padding(vertical = 9.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "没看到",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.muted
                )
            }
        }
    }
}

private fun gradeLabel(grade: String): String = when (grade) {
    "优" -> "优秀"
    "良" -> "良好"
    "一般" -> "一般"
    else -> "较差"
}

private fun bandColor(grade: String, colors: SunglowColors): Color = when (grade) {
    "优" -> Color(0xFF9FE6BD)
    "良" -> Color(0xFF9AC765)
    "一般" -> colors.mid
    else -> colors.bad
}

/* ---------- 小组件 ---------- */

@Composable
private fun Panel(content: @Composable () -> Unit) {
    val colors = SunglowTheme.colors
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(colors.card)
            .border(1.dp, colors.rule, RoundedCornerShape(12.dp))
            .padding(12.dp)
    ) {
        content()
    }
}

@Composable
private fun InfoRow(k: String, v: String) {
    val colors = SunglowTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.Top
    ) {
        Text(
            text = k,
            style = MaterialTheme.typography.bodySmall,
            color = colors.faint,
            modifier = Modifier.width(96.dp)
        )
        Text(
            text = v,
            style = MaterialTheme.typography.bodySmall,
            color = colors.ink,
            modifier = Modifier.weight(1f)
        )
    }
}
