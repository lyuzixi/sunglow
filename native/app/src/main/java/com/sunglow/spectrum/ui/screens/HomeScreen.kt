package com.sunglow.spectrum.ui.screens

import android.Manifest
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.sunglow.spectrum.R
import com.sunglow.spectrum.core.City
import com.sunglow.spectrum.core.FacDisplayRow
import com.sunglow.spectrum.core.ForecastResult
import com.sunglow.spectrum.core.ModelRow
import com.sunglow.spectrum.core.Period
import com.sunglow.spectrum.core.QUALITY_BANDS
import com.sunglow.spectrum.core.QUALITY_LABEL
import com.sunglow.spectrum.core.TzCache
import com.sunglow.spectrum.core.addDaysIso
import com.sunglow.spectrum.core.conclWord
import com.sunglow.spectrum.core.facDisplayRows
import com.sunglow.spectrum.core.fmtClock
import com.sunglow.spectrum.core.fmtDur
import com.sunglow.spectrum.core.glowWindow
import com.sunglow.spectrum.core.isNum
import com.sunglow.spectrum.core.todayInTz
import com.sunglow.spectrum.core.typeDetailText
import com.sunglow.spectrum.core.uAlt
import com.sunglow.spectrum.core.uDist
import com.sunglow.spectrum.ui.HomeViewModel
import com.sunglow.spectrum.ui.theme.SunglowColors
import com.sunglow.spectrum.ui.theme.SunglowTheme
import java.time.LocalDate
import java.util.Locale
import kotlin.math.roundToInt

/*
 * P2 主屏：选城市 → 选日期/时段 → 一次单点预报 → 结论、模式明细、主要因素。
 * 数值口径全部来自 core/，这一层只负责排版。
 */

@Composable
fun HomeScreen(vm: HomeViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val colors = SunglowTheme.colors
    val spacing = SunglowTheme.spacing
    val context = LocalContext.current

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        if (grants.values.any { it }) {
            if (!vm.useCurrentLocation()) {
                Toast.makeText(context, "没有取到定位，请手动搜索城市", Toast.LENGTH_SHORT).show()
            }
        } else {
            Toast.makeText(context, "未获得定位权限，可手动搜索城市", Toast.LENGTH_SHORT).show()
        }
    }

    val today = remember(state.city) {
        todayInTz(TzCache.cityTz(state.city.lat, state.city.lon))
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bg)
    ) {
        GlowBackdrop()

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(horizontal = spacing.page)
                .padding(top = spacing.lg, bottom = spacing.xxl)
        ) {
            CityHeader(city = state.city, onClick = { vm.setCitySheetOpen(true) })

            Spacer(Modifier.height(spacing.lg))

            DateBar(
                dates = state.dates,
                selected = state.dateStr,
                today = today,
                onSelect = vm::selectDate
            )

            Spacer(Modifier.height(spacing.md))

            PeriodSwitch(period = state.period, onSelect = vm::selectPeriod)

            Spacer(Modifier.height(spacing.lg))

            val result = state.result
            when {
                state.error != null -> ErrorCard(
                    message = state.error ?: "",
                    loading = state.loading,
                    onRetry = vm::refresh
                )
                result == null && state.loading -> LoadingCard()
                result != null -> {
                    VerdictCard(result = result, loading = state.loading)
                    Spacer(Modifier.height(spacing.lg))
                    ModelTable(result.models)
                    Spacer(Modifier.height(spacing.lg))
                    FactorList(result)
                }
            }

            Spacer(Modifier.height(spacing.xl))

            Text(
                text = "概率预报 · 仅供参考 · 气象数据 Open-Meteo",
                style = MaterialTheme.typography.labelSmall,
                color = colors.muted,
                modifier = Modifier.fillMaxWidth(),
                textAlign = TextAlign.Center
            )
        }
    }

    if (state.citySheetOpen) {
        val recent = remember(state.citySheetOpen) { vm.recentCities() }
        CitySheet(
            recent = recent,
            onSearch = vm::searchCities,
            onPick = vm::selectCity,
            onLocate = {
                if (vm.hasLocationPermission()) {
                    if (!vm.useCurrentLocation()) {
                        Toast.makeText(context, "没有取到定位，请手动搜索城市", Toast.LENGTH_SHORT).show()
                    }
                } else {
                    permissionLauncher.launch(
                        arrayOf(
                            Manifest.permission.ACCESS_COARSE_LOCATION,
                            Manifest.permission.ACCESS_FINE_LOCATION
                        )
                    )
                }
            },
            onDismiss = { vm.setCitySheetOpen(false) }
        )
    }
}

/* ---------- 背景与容器 ---------- */

@Composable
private fun GlowBackdrop() {
    val colors = SunglowTheme.colors
    Canvas(
        modifier = Modifier
            .fillMaxWidth()
            .height(420.dp)
    ) {
        drawRect(
            brush = Brush.radialGradient(
                colors = listOf(
                    colors.accent.copy(alpha = if (colors.isDark) 0.26f else 0.14f),
                    Color.Transparent
                ),
                center = Offset(size.width * 0.82f, -size.height * 0.15f),
                radius = size.width * 1.05f
            ),
            size = Size(size.width, size.height)
        )
        drawRect(
            brush = Brush.radialGradient(
                colors = listOf(
                    colors.accentCool.copy(alpha = if (colors.isDark) 0.16f else 0.10f),
                    Color.Transparent
                ),
                center = Offset(size.width * 0.05f, size.height * 0.05f),
                radius = size.width * 0.9f
            ),
            size = Size(size.width, size.height)
        )
    }
}

@Composable
private fun Panel(content: @Composable () -> Unit) {
    val colors = SunglowTheme.colors
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(colors.card)
            .border(1.dp, colors.rule, RoundedCornerShape(18.dp))
            .padding(18.dp)
    ) {
        content()
    }
}

/* ---------- 顶部：城市 ---------- */

@Composable
private fun CityHeader(city: City, onClick: () -> Unit) {
    val colors = SunglowTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(colors.card)
            .border(1.dp, colors.rule, RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = stringResource(R.string.brand_mark) + " · 光谱观测",
                style = MaterialTheme.typography.labelSmall,
                color = colors.accentCool
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = city.name,
                style = MaterialTheme.typography.headlineMedium,
                color = colors.ink
            )
            if (city.region.isNotBlank() && city.region != city.name) {
                Spacer(Modifier.height(2.dp))
                Text(
                    text = city.region,
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.muted
                )
            }
        }
        Text(
            text = "切换城市",
            style = MaterialTheme.typography.bodyLarge,
            color = colors.accentCool
        )
    }
}

/* ---------- 日期条 ---------- */

@Composable
private fun DateBar(
    dates: List<String>,
    selected: String,
    today: String,
    onSelect: (String) -> Unit
) {
    val colors = SunglowTheme.colors
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(dates, key = { it }) { d ->
            val on = d == selected
            val label = when (d) {
                today -> "今天"
                addDaysIso(today, 1) -> "明天"
                else -> weekdayOf(d)
            }
            Column(
                modifier = Modifier
                    .width(64.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (on) colors.accent else colors.card)
                    .border(
                        1.dp,
                        if (on) Color.Transparent else colors.rule,
                        RoundedCornerShape(12.dp)
                    )
                    .clickable { onSelect(d) }
                    .padding(vertical = 10.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelSmall,
                    color = if (on) Color.White.copy(alpha = 0.9f) else colors.muted
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text = shortDate(d),
                    style = MaterialTheme.typography.titleMedium,
                    color = if (on) Color.White else colors.ink
                )
            }
        }
    }
}

private fun weekdayOf(dateStr: String): String = try {
    when (LocalDate.parse(dateStr).dayOfWeek.value) {
        1 -> "周一"
        2 -> "周二"
        3 -> "周三"
        4 -> "周四"
        5 -> "周五"
        6 -> "周六"
        else -> "周日"
    }
} catch (_: Exception) {
    "—"
}

private fun shortDate(dateStr: String): String =
    if (dateStr.length >= 10) dateStr.substring(5).replace('-', '/') else dateStr

/* ---------- 时段切换 ---------- */

@Composable
private fun PeriodSwitch(period: Period, onSelect: (Period) -> Unit) {
    val colors = SunglowTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(999.dp))
            .background(colors.card)
            .border(1.dp, colors.rule, RoundedCornerShape(999.dp))
            .padding(4.dp)
    ) {
        PeriodChip("朝霞", period == Period.AM, Modifier.weight(1f)) { onSelect(Period.AM) }
        PeriodChip("晚霞", period == Period.PM, Modifier.weight(1f)) { onSelect(Period.PM) }
    }
}

@Composable
private fun PeriodChip(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val colors = SunglowTheme.colors
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (selected) colors.accentCool else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.titleMedium,
            color = if (selected) colors.bg else colors.muted
        )
    }
}

/* ---------- 结论卡 ---------- */

@Composable
private fun VerdictCard(result: ForecastResult, loading: Boolean) {
    val colors = SunglowTheme.colors
    val p = result.p.roundToInt()
    val q = result.q.roundToInt()
    val gradeColor = gradeColor(result.grade, colors)
    val win = remember(result) {
        if (result.sRT.geom.ok) {
            glowWindow(
                evMs = result.evMs,
                isAM = result.period == Period.AM,
                lat = result.city.lat,
                lon = result.city.lon,
                thNearDeg = result.sRT.geom.thNearDeg,
                thFarDeg = result.sRT.geom.thFarDeg
            )
        } else null
    }

    Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            ConfPill(
                text = "可信度 " + result.conf.level + " · " + result.conf.txt,
                fg = hexColor(if (colors.isDark) result.conf.darkColor else result.conf.color),
                bg = hexColor(if (colors.isDark) result.conf.darkBg else result.conf.bg),
                bd = hexColor(if (colors.isDark) result.conf.darkBd else result.conf.bd)
            )
            Spacer(Modifier.weight(1f))
            if (loading) {
                Text(
                    text = "取数中…",
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.muted
                )
            }
        }

        Spacer(Modifier.height(14.dp))

        Text(
            text = result.city.name + " " + result.dateStr + " " +
                (if (result.period == Period.AM) "朝霞" else "晚霞") +
                " " + conclWord(result.p),
            style = MaterialTheme.typography.headlineMedium,
            color = colors.ink
        )

        Spacer(Modifier.height(8.dp))

        Text(
            text = "概率 $p%，观赏质量 $q 分 · 等级 " +
                (QUALITY_LABEL[result.grade] ?: result.grade) + "。" + result.conf.hint,
            style = MaterialTheme.typography.bodyMedium,
            color = colors.muted
        )

        if (result.aodFallback) {
            Spacer(Modifier.height(8.dp))
            Text(
                text = "本次没有取到气溶胶数据，颜色浓淡按默认值估算，实际霞光可能比预报更淡或更浓。",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.accentAlt
            )
        }

        Spacer(Modifier.height(18.dp))

        Row(modifier = Modifier.fillMaxWidth()) {
            Metric("$p%", "出现概率", colors.accent, Modifier.weight(1f))
            Metric("$q", "观赏质量", colors.accentAlt, Modifier.weight(1f))
            Metric(result.grade, "等级", gradeColor, Modifier.weight(1f))
            Metric(
                if (isNum(result.dvI)) String.format(Locale.US, "%.1f", result.dvI!!) else "—",
                "模型分歧 ΔI",
                colors.ink,
                Modifier.weight(1f)
            )
        }

        Spacer(Modifier.height(18.dp))

        Box(
            Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(colors.rule)
        )

        Spacer(Modifier.height(14.dp))

        SunRows(result = result, win = win)

        Spacer(Modifier.height(16.dp))

        ColorStrip(result)
    }
}

@Composable
private fun Metric(value: String, label: String, color: Color, modifier: Modifier = Modifier) {
    val colors = SunglowTheme.colors
    Column(modifier = modifier) {
        Text(
            text = value,
            style = MaterialTheme.typography.headlineLarge.copy(fontSize = 26.sp),
            color = color
        )
        Spacer(Modifier.height(2.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = colors.muted
        )
    }
}

@Composable
private fun SunRows(result: ForecastResult, win: Pair<Double, Double>?) {
    val colors = SunglowTheme.colors
    val rows = mutableListOf<Pair<String, String>>()
    rows.add(result.evName to fmtClock(result.evMs, result.tz))
    rows.add("方位角" to String.format(Locale.US, "%.1f", result.evAz) + "°")
    rows.add(
        "云型" to typeDetailText(
            result.sRT.primary.type,
            result.sRT.decks.map { it.cover }
        )
    )
    rows.add("云底高度" to uAlt(result.sRT.primary.base * 1000))
    rows.add("几何条件" to geomText(result))
    rows.add("持续时间" to fmtDur(result.sRT.geom.dur))
    rows.add("能见度" to uDist(result.envM.vis?.let { it / 1000 }, 1))
    rows.add(
        "最佳观赏窗口" to (win?.let { fmtClock(it.first, result.tz) + "–" + fmtClock(it.second, result.tz) }
            ?: "—")
    )

    Column {
        rows.forEach { (k, v) ->
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                verticalAlignment = Alignment.Top
            ) {
                Text(
                    text = k,
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.muted,
                    modifier = Modifier.width(84.dp)
                )
                Text(
                    text = v,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (k == "几何条件" && !result.sRT.geom.ok) Color(0xFFD0503F) else colors.ink,
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}

private fun geomText(r: ForecastResult): String {
    val g = r.sRT.geom
    if (g.ok) return "火烧云三角几何条件成立"
    return if (isNum(r.sRT.d)) {
        "不成立：云边界 " + uDist(r.sRT.d) + " 已超过上限 " + uDist(g.xMax)
    } else {
        "不成立：400 km 内没有可承载霞光的云盘"
    }
}

@Composable
private fun ColorStrip(result: ForecastResult) {
    val colors = SunglowTheme.colors
    val samples = result.sRT.samples
    if (samples.isEmpty()) return
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(16.dp)
                .clip(RoundedCornerShape(999.dp))
                .border(1.dp, colors.rule, RoundedCornerShape(999.dp))
        ) {
            samples.forEach { s ->
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .background(hexColor(s.color.hex))
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(
            text = samples.map { it.color.nameZh }.distinct().joinToString(" · "),
            style = MaterialTheme.typography.labelSmall,
            color = colors.muted
        )
    }
}

@Composable
private fun ConfPill(text: String, fg: Color, bg: Color, bd: Color) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(bg)
            .border(1.dp, bd, RoundedCornerShape(999.dp))
            .padding(horizontal = 10.dp, vertical = 4.dp)
    ) {
        Text(text = text, style = MaterialTheme.typography.labelSmall, color = fg)
    }
}

/* ---------- 模式明细 ---------- */

@Composable
private fun ModelTable(models: List<ModelRow>) {
    val colors = SunglowTheme.colors
    Panel {
        Text(
            text = "模式明细",
            style = MaterialTheme.typography.labelSmall,
            color = colors.muted
        )
        Spacer(Modifier.height(10.dp))
        models.forEach { m ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = m.label,
                    style = MaterialTheme.typography.bodyLarge,
                    color = colors.ink,
                    modifier = Modifier.weight(1f)
                )
                Text(
                    text = "P " + m.p.roundToInt() + "%",
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.accent
                )
                Spacer(Modifier.width(14.dp))
                Text(
                    text = "Q " + m.q.roundToInt(),
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.accentAlt
                )
            }
        }
    }
}

/* ---------- 主要因素 ---------- */

@Composable
private fun FactorList(result: ForecastResult) {
    val colors = SunglowTheme.colors
    val rows = remember(result) { facDisplayRows(result) }
    var expanded by remember { mutableStateOf<String?>(null) }

    Panel {
        Text(
            text = "主要因素",
            style = MaterialTheme.typography.labelSmall,
            color = colors.muted
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = "点任意一项查看说明",
            style = MaterialTheme.typography.labelSmall,
            color = colors.ruleStrong
        )
        Spacer(Modifier.height(12.dp))
        rows.forEachIndexed { i, row ->
            if (i > 0) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(1.dp)
                        .background(colors.rule)
                )
            }
            FactorRow(
                row = row,
                open = expanded == row.key,
                onClick = { expanded = if (expanded == row.key) null else row.key }
            )
        }
    }
}

@Composable
private fun FactorRow(row: FacDisplayRow, open: Boolean, onClick: () -> Unit) {
    val colors = SunglowTheme.colors
    Column(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = row.name,
                style = MaterialTheme.typography.bodyLarge,
                color = colors.ink,
                modifier = Modifier.weight(1f)
            )
            Spacer(Modifier.width(10.dp))
            /* 名称与数值平分宽度：长数值换行，不再把名称挤成竖排 */
            Text(
                text = row.value,
                style = MaterialTheme.typography.bodyMedium,
                color = colors.muted,
                textAlign = TextAlign.End,
                modifier = Modifier.weight(1f)
            )
            Spacer(Modifier.width(8.dp))
            JudgeChip(row.judge, row.judgeCls)
        }
        if (open) {
            Spacer(Modifier.height(8.dp))
            Text(
                text = row.desc,
                style = MaterialTheme.typography.bodyMedium,
                color = colors.muted
            )
        }
    }
}

@Composable
private fun JudgeChip(text: String, cls: String) {
    val colors = SunglowTheme.colors
    val c = judgeColor(cls, colors)
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(c.copy(alpha = 0.12f))
            .border(1.dp, c.copy(alpha = 0.5f), RoundedCornerShape(999.dp))
            .padding(horizontal = 7.dp, vertical = 2.dp)
    ) {
        Text(text = text, style = MaterialTheme.typography.labelSmall, color = c)
    }
}

private fun judgeColor(cls: String, colors: SunglowColors): Color = when (cls) {
    "ok" -> Color(0xFF2F9E63)
    "mid" -> colors.accentAlt
    "bad" -> Color(0xFFD0503F)
    else -> colors.muted
}

/* ---------- 错误 / 加载 ---------- */

@Composable
private fun ErrorCard(message: String, loading: Boolean, onRetry: () -> Unit) {
    val colors = SunglowTheme.colors
    Panel {
        Text(
            text = "取数失败",
            style = MaterialTheme.typography.titleMedium,
            color = Color(0xFFD0503F)
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = colors.muted
        )
        Spacer(Modifier.height(10.dp))
        TextButton(onClick = onRetry, enabled = !loading) {
            Text(
                text = if (loading) "取数中…" else "重新计算",
                style = MaterialTheme.typography.bodyLarge,
                color = colors.accentCool
            )
        }
    }
}

@Composable
private fun LoadingCard() {
    val colors = SunglowTheme.colors
    Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(
                modifier = Modifier.size(18.dp),
                strokeWidth = 2.dp,
                color = colors.accentCool
            )
            Spacer(Modifier.width(12.dp))
            Text(
                text = "正在取数并计算…",
                style = MaterialTheme.typography.bodyLarge,
                color = colors.muted
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(
            text = "沿日出/日落方位取 17 个样带点，跑 GFS / ECMWF / 光追三套算法，通常几秒内完成。",
            style = MaterialTheme.typography.bodyMedium,
            color = colors.ruleStrong
        )
    }
}

/* ---------- 工具 ---------- */

private fun hexColor(hex: String): Color = try {
    Color(android.graphics.Color.parseColor(hex))
} catch (_: Exception) {
    Color.Gray
}

private fun gradeColor(grade: String, colors: SunglowColors): Color {
    val band = QUALITY_BANDS.firstOrNull { it.key == grade } ?: return colors.ink
    return hexColor(if (colors.isDark) band.dark else band.color)
}
