package com.sunglow.spectrum.ui.screens

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.stickyHeader
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.sunglow.spectrum.R
import com.sunglow.spectrum.core.City
import com.sunglow.spectrum.core.FacDisplayRow
import com.sunglow.spectrum.core.ForecastResult
import com.sunglow.spectrum.core.ModelSel
import com.sunglow.spectrum.core.Period
import com.sunglow.spectrum.core.QUALITY_BANDS
import com.sunglow.spectrum.core.QUALITY_LABEL
import com.sunglow.spectrum.core.TzCache
import com.sunglow.spectrum.core.addDaysIso
import com.sunglow.spectrum.core.captionOf
import com.sunglow.spectrum.core.conclWord
import com.sunglow.spectrum.core.facDisplayRows
import com.sunglow.spectrum.core.fmtClock
import com.sunglow.spectrum.core.fmtDur
import com.sunglow.spectrum.core.glowWindow
import com.sunglow.spectrum.core.isNum
import com.sunglow.spectrum.core.shareBodyOf
import com.sunglow.spectrum.core.todayInTz
import com.sunglow.spectrum.core.typeDetailText
import com.sunglow.spectrum.core.uAlt
import com.sunglow.spectrum.core.uDist
import com.sunglow.spectrum.core.verdictViewOf
import com.sunglow.spectrum.core.VerdictView
import com.sunglow.spectrum.ui.HomeViewModel
import com.sunglow.spectrum.ui.theme.SunglowColors
import com.sunglow.spectrum.ui.theme.SunglowTheme
import java.time.LocalDate
import java.util.Locale
import kotlin.math.roundToInt

/*
 * P3 主屏：视觉与网页版同一套令牌（光谱 / 玻璃卡 / 发丝线 / 仪器字），
 * 交互按手机重排：品牌与城市常驻、日期与时段吸顶、模型切换收进结论卡、
 * 每个区块自带折叠与触达反馈，分享走系统面板。
 */

@OptIn(ExperimentalFoundationApi::class)
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

    /* 模型选择是「看哪一路」的视角，不触发取数；换城市/日期/时段回到综合 */
    var modelSel by remember(state.city.name, state.dateStr, state.period) {
        mutableStateOf(ModelSel.ENS)
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
                .statusBarsPadding()
                .navigationBarsPadding()
        ) {
            LazyColumn(
                state = rememberLazyListState(),
                contentPadding = PaddingValues(bottom = spacing.xxl)
            ) {
                item {
                    BrandBar(
                        city = state.city,
                        today = today,
                        onClick = { vm.setCitySheetOpen(true) },
                        modifier = Modifier.padding(
                            start = spacing.page,
                            end = spacing.page,
                            top = spacing.md,
                            bottom = spacing.md
                        )
                    )
                }

                stickyHeader {
                    StickyControls(
                        dates = state.dates,
                        selected = state.dateStr,
                        today = today,
                        period = state.period,
                        onSelectDate = vm::selectDate,
                        onSelectPeriod = vm::selectPeriod
                    )
                }

                val result = state.result
                when {
                    state.error != null -> {
                        item { SectionHead("结论") }
                        item {
                            ErrorCard(
                                message = state.error ?: "",
                                loading = state.loading,
                                onRetry = vm::refresh
                            )
                        }
                    }

                    result == null -> {
                        item { SectionHead("结论") }
                        item { LoadingCard(loading = state.loading) }
                    }

                    else -> {
                        val view = verdictViewOf(result, modelSel)
                        item { SectionHead("结论") }
                        item {
                            VerdictCard(
                                result = result,
                                view = view,
                                modelSel = modelSel,
                                loading = state.loading,
                                onSelectModel = { modelSel = it },
                                onRetry = vm::refresh
                            )
                        }

                        item { SectionHead("主要因素") }
                        item { FactorList(result) }

                        item { SectionHead("光路细节") }
                        item { RayCard(result) }

                        item { SectionHead("分享") }
                        item { ShareCard(result, view) }

                        item { SectionHead("说明") }
                        item { NotesCard() }
                    }
                }

                item {
                    Text(
                        text = "概率预报 · 仅供参考 · 气象数据 Open-Meteo",
                        style = MaterialTheme.typography.labelSmall,
                        color = colors.faint,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = spacing.xl, start = spacing.page, end = spacing.page),
                        textAlign = TextAlign.Center
                    )
                }
            }
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

/* ---------- 背景 ---------- */

@Composable
private fun GlowBackdrop() {
    val colors = SunglowTheme.colors
    Canvas(
        modifier = Modifier
            .fillMaxWidth()
            .height(460.dp)
    ) {
        drawRect(
            brush = Brush.radialGradient(
                colors = listOf(
                    colors.accent.copy(alpha = if (colors.isDark) 0.22f else 0.10f),
                    Color.Transparent
                ),
                center = Offset(size.width * 0.88f, -size.height * 0.10f),
                radius = size.width * 1.05f
            ),
            size = size
        )
        drawRect(
            brush = Brush.radialGradient(
                colors = listOf(
                    colors.accentCool.copy(alpha = if (colors.isDark) 0.14f else 0.08f),
                    Color.Transparent
                ),
                center = Offset(size.width * 0.02f, size.height * 0.12f),
                radius = size.width * 0.92f
            ),
            size = size
        )
    }
}

/* ---------- 品牌 / 城市 ---------- */

@Composable
private fun LogoMark(diameter: Dp) {
    val colors = SunglowTheme.colors
    Canvas(modifier = Modifier.size(diameter)) {
        val r = size.minDimension / 2f
        val brush = Brush.sweepGradient(colors.spectrum)
        drawCircle(brush = brush, radius = r * 0.72f, style = Stroke(width = r * 0.24f))
        drawCircle(brush = brush, radius = r * 0.24f)
    }
}

@Composable
private fun BrandBar(
    city: City,
    today: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val colors = SunglowTheme.colors
    val radius = SunglowTheme.radius
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(radius.lg))
            .background(colors.card)
            .border(1.dp, colors.rule, RoundedCornerShape(radius.lg))
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        LogoMark(30.dp)
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = stringResource(R.string.brand_mark) + " · 光谱观测",
                style = MaterialTheme.typography.labelSmall,
                color = colors.accentCool
            )
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = city.name,
                    style = MaterialTheme.typography.headlineMedium,
                    color = colors.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                if (city.region.isNotBlank() && city.region != city.name) {
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = city.region,
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.muted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(
                text = "切换城市",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.accentCool
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = "当地今天 " + today.substring(5),
                style = MaterialTheme.typography.labelSmall,
                color = colors.faint
            )
        }
    }
}

/* ---------- 吸顶控制条：日期 + 时段 ---------- */

@Composable
private fun StickyControls(
    dates: List<String>,
    selected: String,
    today: String,
    period: Period,
    onSelectDate: (String) -> Unit,
    onSelectPeriod: (Period) -> Unit
) {
    val colors = SunglowTheme.colors
    val spacing = SunglowTheme.spacing
    Column(modifier = Modifier.fillMaxWidth().background(colors.bg)) {
        DateBar(dates, selected, today, onSelectDate)
        Spacer(Modifier.height(spacing.sm))
        PeriodSwitch(period, onSelectPeriod, Modifier.padding(horizontal = spacing.page))
        Spacer(Modifier.height(spacing.md))
        Box(Modifier.fillMaxWidth().height(1.dp).background(colors.rule))
    }
}

@Composable
private fun DateBar(
    dates: List<String>,
    selected: String,
    today: String,
    onSelect: (String) -> Unit
) {
    val listState = rememberLazyListState()
    /* 选中项自动滚进视野：手机上一屏放不下 10 天，切换日期后不该让用户自己找 */
    LaunchedEffect(selected, dates) {
        val i = dates.indexOf(selected)
        if (i >= 0) listState.animateScrollToItem((i - 2).coerceAtLeast(0))
    }
    LazyRow(
        state = listState,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        contentPadding = PaddingValues(horizontal = SunglowTheme.spacing.page)
    ) {
        items(dates, key = { it }) { d ->
            val on = d == selected
            val label = when (d) {
                today -> "今天"
                addDaysIso(today, 1) -> "明天"
                else -> weekdayOf(d)
            }
            DateChip(
                label = label,
                date = shortDate(d),
                selected = on,
                onClick = { onSelect(d) }
            )
        }
    }
}

@Composable
private fun DateChip(label: String, date: String, selected: Boolean, onClick: () -> Unit) {
    val colors = SunglowTheme.colors
    val inverse = if (colors.isDark) Color(0xFF06101C) else Color.White
    Column(
        modifier = Modifier
            .width(64.dp)
            .clip(RoundedCornerShape(14.dp))
            .then(
                if (selected) Modifier.background(Brush.horizontalGradient(colors.spectrum))
                else Modifier.background(colors.card)
            )
            .border(
                1.dp,
                if (selected) Color.Transparent else colors.rule,
                RoundedCornerShape(14.dp)
            )
            .clickable(onClick = onClick)
            .padding(vertical = 9.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = if (selected) inverse.copy(alpha = 0.82f) else colors.muted
        )
        Spacer(Modifier.height(3.dp))
        Text(
            text = date,
            style = MaterialTheme.typography.titleMedium,
            color = if (selected) inverse else colors.ink
        )
    }
}

@Composable
private fun PeriodSwitch(
    period: Period,
    onSelect: (Period) -> Unit,
    modifier: Modifier = Modifier
) {
    val colors = SunglowTheme.colors
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(999.dp))
            .background(colors.glass)
            .border(1.dp, colors.ruleStrong, RoundedCornerShape(999.dp))
            .padding(3.dp)
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
    val inverse = if (colors.isDark) Color(0xFF06101C) else Color.White
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .then(
                if (selected) Modifier.background(Brush.horizontalGradient(colors.spectrum))
                else Modifier
            )
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.titleMedium,
            color = if (selected) inverse else colors.muted
        )
    }
}

/* ---------- 区块标题 / 卡片容器 ---------- */

@Composable
private fun SectionHead(title: String, note: String? = null) {
    val colors = SunglowTheme.colors
    val spacing = SunglowTheme.spacing
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(
                start = spacing.page,
                end = spacing.page,
                top = spacing.xl,
                bottom = spacing.md
            ),
        verticalAlignment = Alignment.Bottom
    ) {
        Box(
            Modifier
                .width(18.dp)
                .height(3.dp)
                .clip(RoundedCornerShape(3.dp))
                .background(Brush.horizontalGradient(colors.spectrum))
        )
        Spacer(Modifier.width(8.dp))
        Text(
            text = title,
            style = MaterialTheme.typography.headlineMedium,
            color = colors.ink,
            modifier = Modifier.weight(1f)
        )
        if (note != null) {
            Text(
                text = note,
                style = MaterialTheme.typography.labelSmall,
                color = colors.faint
            )
        }
    }
}

@Composable
private fun GlassCard(
    modifier: Modifier = Modifier,
    topSpectrum: Boolean = false,
    content: @Composable ColumnScope.() -> Unit
) {
    val colors = SunglowTheme.colors
    val radius = SunglowTheme.radius
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(radius.lg))
            .background(colors.card)
            .border(1.dp, colors.rule, RoundedCornerShape(radius.lg))
    ) {
        if (topSpectrum) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(2.dp)
                    .background(Brush.horizontalGradient(colors.spectrum))
            )
        }
        Column(modifier = Modifier.padding(18.dp), content = content)
    }
}

/* ---------- 结论卡 ---------- */

@Composable
private fun VerdictCard(
    result: ForecastResult,
    view: VerdictView,
    modelSel: ModelSel,
    loading: Boolean,
    onSelectModel: (ModelSel) -> Unit,
    onRetry: () -> Unit
) {
    val colors = SunglowTheme.colors
    val p = view.p.roundToInt()
    val q = view.q.roundToInt()
    val gradeCol = gradeColor(view.grade, colors)
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

    GlassCard(modifier = Modifier.padding(horizontal = SunglowTheme.spacing.page), topSpectrum = true) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            ConfPill(
                text = "可信度 " + result.conf.level + " · " + result.conf.txt,
                fg = hexColor(if (colors.isDark) result.conf.darkColor else result.conf.color),
                bg = hexColor(if (colors.isDark) result.conf.darkBg else result.conf.bg),
                bd = hexColor(if (colors.isDark) result.conf.darkBd else result.conf.bd)
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = if (loading) "取数中…" else if (result.fromCache) "缓存结果" else "刚刚取数",
                style = MaterialTheme.typography.labelSmall,
                color = colors.faint
            )
        }

        Spacer(Modifier.height(14.dp))

        Text(
            text = result.city.name + " " + result.dateStr + " " +
                (if (result.period == Period.AM) "朝霞" else "晚霞"),
            style = MaterialTheme.typography.headlineMedium,
            color = colors.ink
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = conclWord(view.p),
            style = MaterialTheme.typography.headlineMedium.copy(
                shadow = Shadow(colors.accent.copy(alpha = 0.45f), blurRadius = 18f)
            ),
            color = colors.accent
        )

        Spacer(Modifier.height(10.dp))

        Text(
            text = "概率 $p%，观赏质量 $q 分 · 等级 " +
                (QUALITY_LABEL[view.grade] ?: view.grade) + "。" + result.conf.hint,
            style = MaterialTheme.typography.bodyMedium,
            color = colors.muted
        )

        if (view.single) {
            Spacer(Modifier.height(6.dp))
            Text(
                text = "当前显示 " + view.label + " 单路结果，点下方模型卡可切回综合。",
                style = MaterialTheme.typography.labelSmall,
                color = colors.accentAlt
            )
        }

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
        }
        Spacer(Modifier.height(14.dp))
        Row(modifier = Modifier.fillMaxWidth()) {
            Metric(
                QUALITY_LABEL[view.grade] ?: view.grade,
                "等级",
                gradeCol,
                Modifier.weight(1f),
                size = 22
            )
            Metric(
                if (isNum(result.dvI)) String.format(Locale.US, "%.1f", result.dvI!!) else "—",
                "模型分歧 ΔI",
                colors.ink,
                Modifier.weight(1f),
                size = 22
            )
        }

        Spacer(Modifier.height(16.dp))
        Box(Modifier.fillMaxWidth().height(1.dp).background(colors.rule))
        Spacer(Modifier.height(14.dp))

        SunRows(result = result, win = win)

        Spacer(Modifier.height(16.dp))
        ColorStrip(result)

        Spacer(Modifier.height(16.dp))
        ModelCards(result = result, sel = modelSel, onSelect = onSelectModel)

        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "概率预报 · 仅供参考",
                style = MaterialTheme.typography.labelSmall,
                color = colors.faint,
                modifier = Modifier.weight(1f)
            )
            Text(
                text = if (loading) "取数中…" else "重新计算",
                style = MaterialTheme.typography.bodyMedium,
                color = if (loading) colors.faint else colors.accentCool,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .clickable(enabled = !loading, onClick = onRetry)
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            )
        }
    }
}

@Composable
private fun Metric(
    value: String,
    label: String,
    color: Color,
    modifier: Modifier = Modifier,
    size: Int = 28
) {
    val colors = SunglowTheme.colors
    Column(modifier = modifier) {
        Text(
            text = value,
            style = MaterialTheme.typography.headlineLarge.copy(
                fontSize = size.sp,
                shadow = if (colors.isDark) {
                    Shadow(color.copy(alpha = 0.35f), blurRadius = 14f)
                } else null
            ),
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
        "最佳观赏窗口" to (
            win?.let { fmtClock(it.first, result.tz) + "–" + fmtClock(it.second, result.tz) }
                ?: "—"
            )
    )

    Column {
        rows.forEach { (k, v) ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp)
            ) {
                Text(
                    text = k,
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.faint,
                    modifier = Modifier.width(96.dp)
                )
                Text(
                    text = v,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (k == "几何条件" && !result.sRT.geom.ok) colors.bad else colors.ink,
                    modifier = Modifier.weight(1f),
                    textAlign = TextAlign.End
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
        Text(
            text = "底色光谱",
            style = MaterialTheme.typography.labelSmall,
            color = colors.faint
        )
        Spacer(Modifier.height(6.dp))
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
        Spacer(Modifier.height(6.dp))
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

/* ---------- 模型卡（点选切换主数字） ---------- */

private data class ModelCellData(
    val sel: ModelSel,
    val label: String,
    val p: Double,
    val q: Double
)

@Composable
private fun ModelCards(result: ForecastResult, sel: ModelSel, onSelect: (ModelSel) -> Unit) {
    val cells = remember(result) {
        buildList {
            add(ModelCellData(ModelSel.ENS, "综合", result.p, result.q))
            result.models.forEach { m ->
                when (m.id) {
                    "gfs" -> add(ModelCellData(ModelSel.GFS, "GFS", m.p, m.q))
                    "ec" -> add(ModelCellData(ModelSel.EC, "ECMWF", m.p, m.q))
                    "rt" -> add(ModelCellData(ModelSel.RT, "光追", m.p, m.q))
                }
            }
        }
    }

    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        cells.forEach { c ->
            ModelCell(
                label = c.label,
                p = c.p,
                q = c.q,
                selected = sel == c.sel,
                modifier = Modifier.weight(1f),
                onClick = { onSelect(c.sel) }
            )
        }
    }
}

@Composable
private fun ModelCell(
    label: String,
    p: Double,
    q: Double,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val colors = SunglowTheme.colors
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) colors.glassStrong else colors.glass)
            .border(
                1.dp,
                if (selected) colors.accentCool else colors.rule,
                RoundedCornerShape(12.dp)
            )
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp, horizontal = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = if (selected) colors.ink else colors.muted,
            maxLines = 1
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = "P " + p.roundToInt() + "%",
            style = MaterialTheme.typography.bodyMedium,
            color = colors.accent,
            fontWeight = FontWeight.SemiBold
        )
        Text(
            text = "Q " + q.roundToInt(),
            style = MaterialTheme.typography.bodyMedium,
            color = colors.accentAlt
        )
    }
}

/* ---------- 因素 ---------- */

@Composable
private fun FactorList(result: ForecastResult) {
    val colors = SunglowTheme.colors
    val rows = remember(result) { facDisplayRows(result) }
    var expanded by remember(result) { mutableStateOf<String?>(null) }

    GlassCard(modifier = Modifier.padding(horizontal = SunglowTheme.spacing.page)) {
        Text(
            text = "13 项判据 · 点任意一项展开说明",
            style = MaterialTheme.typography.labelSmall,
            color = colors.faint
        )
        Spacer(Modifier.height(10.dp))
        rows.forEachIndexed { i, row ->
            if (i > 0) {
                Box(Modifier.fillMaxWidth().height(1.dp).background(colors.rule))
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
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = row.name,
                style = MaterialTheme.typography.bodyLarge,
                color = colors.ink,
                modifier = Modifier.weight(1f)
            )
            Text(
                text = row.value,
                style = MaterialTheme.typography.bodyMedium,
                color = colors.muted
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
    "ok" -> colors.good
    "mid" -> colors.mid
    "bad" -> colors.bad
    else -> colors.muted
}

/* ---------- 光路细节 ---------- */

@Composable
private fun RayCard(result: ForecastResult) {
    val colors = SunglowTheme.colors
    val r = result.sRT
    val rows = listOf(
        "主云层" to (r.primary.nameZh + " · " + r.primary.type),
        "云量" to (r.primary.cover.roundToInt().toString() + "%"),
        "云底高度" to uAlt(r.primary.base * 1000),
        "云边界距离" to uDist(r.d),
        "霞光深入上限" to uDist(r.geom.xMax),
        "持续时间" to fmtDur(r.geom.dur),
        "气溶胶标高" to uAlt(r.hs * 1000),
        "等效地面高度" to uAlt(r.heq * 1000)
    )
    GlassCard(modifier = Modifier.padding(horizontal = SunglowTheme.spacing.page)) {
        Text(
            text = "光追物理模型沿日出/日落方位量出的云幕几何",
            style = MaterialTheme.typography.bodyMedium,
            color = colors.muted
        )
        Spacer(Modifier.height(12.dp))
        rows.forEach { (k, v) ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp)
            ) {
                Text(
                    text = k,
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.faint,
                    modifier = Modifier.width(110.dp)
                )
                Text(
                    text = v,
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.ink,
                    modifier = Modifier.weight(1f),
                    textAlign = TextAlign.End
                )
            }
        }
    }
}

/* ---------- 分享 ---------- */

@Composable
private fun ShareCard(result: ForecastResult, view: VerdictView) {
    val colors = SunglowTheme.colors
    val context = LocalContext.current
    val caption = remember(result, view) { captionOf(result, view) }

    GlassCard(modifier = Modifier.padding(horizontal = SunglowTheme.spacing.page)) {
        Text(
            text = caption,
            style = MaterialTheme.typography.bodyLarge,
            color = colors.ink
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = "文案与分享内容由本机生成，不经过服务器。",
            style = MaterialTheme.typography.labelSmall,
            color = colors.faint
        )
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SpectrumButton("分享", Modifier.weight(1f)) {
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, shareBodyOf(result, view))
                }
                context.startActivity(Intent.createChooser(send, "分享霞光预报"))
            }
            GhostButton("复制文案", Modifier.weight(1f)) {
                val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("霞光预报", caption))
                Toast.makeText(context, "文案已复制", Toast.LENGTH_SHORT).show()
            }
        }
    }
}

@Composable
private fun SpectrumButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val colors = SunglowTheme.colors
    val inverse = if (colors.isDark) Color(0xFF06101C) else Color.White
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(Brush.horizontalGradient(colors.spectrum))
            .clickable(onClick = onClick)
            .padding(vertical = 11.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(text = text, style = MaterialTheme.typography.titleMedium, color = inverse)
    }
}

@Composable
private fun GhostButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val colors = SunglowTheme.colors
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(colors.glass)
            .border(1.dp, colors.ruleStrong, RoundedCornerShape(999.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 11.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(text = text, style = MaterialTheme.typography.titleMedium, color = colors.ink)
    }
}

/* ---------- 说明 ---------- */

@Composable
private fun NotesCard() {
    val colors = SunglowTheme.colors
    GlassCard(modifier = Modifier.padding(horizontal = SunglowTheme.spacing.page)) {
        val notes = listOf(
            "概率 P 来自多模型的加权几何平均：GFS、ECMWF 与光追物理各给一份，缺哪一路就自动剔除，其余权重不变。",
            "质量分 Q 由云型、云量、云底高度、几何持续与大气通透度共同评分，再换算成等级；它回答「好不好看」，概率回答「有没有」。",
            "可信度看模型分歧 ΔI：分歧越小，综合值越可信；有效模型少于两路时不给分歧值，显示为破折号。"
        )
        notes.forEachIndexed { i, t ->
            if (i > 0) Spacer(Modifier.height(10.dp))
            Text(
                text = t,
                style = MaterialTheme.typography.bodyMedium,
                color = colors.muted
            )
        }
    }
}

/* ---------- 错误 / 加载 ---------- */

@Composable
private fun ErrorCard(message: String, loading: Boolean, onRetry: () -> Unit) {
    val colors = SunglowTheme.colors
    GlassCard(modifier = Modifier.padding(horizontal = SunglowTheme.spacing.page)) {
        Text(
            text = "取数失败",
            style = MaterialTheme.typography.titleMedium,
            color = colors.bad
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = colors.muted
        )
        Spacer(Modifier.height(12.dp))
        GhostButton(
            text = if (loading) "取数中…" else "重新计算",
            modifier = Modifier.fillMaxWidth()
        ) {
            if (!loading) onRetry()
        }
    }
}

@Composable
private fun LoadingCard(loading: Boolean) {
    val colors = SunglowTheme.colors
    GlassCard(modifier = Modifier.padding(horizontal = SunglowTheme.spacing.page)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (loading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp),
                    strokeWidth = 2.dp,
                    color = colors.accentCool
                )
                Spacer(Modifier.width(12.dp))
            }
            Text(
                text = if (loading) "正在取数并计算…" else "暂无数据",
                style = MaterialTheme.typography.bodyLarge,
                color = colors.muted
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(
            text = "沿日出/日落方位取 17 个样带点，跑 GFS / ECMWF / 光追三套算法，通常几秒内完成。",
            style = MaterialTheme.typography.bodyMedium,
            color = colors.faint
        )
    }
}

/* ---------- 工具 ---------- */

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

private fun hexColor(hex: String): Color = try {
    Color(android.graphics.Color.parseColor(hex))
} catch (_: Exception) {
    Color.Gray
}

private fun gradeColor(grade: String, colors: SunglowColors): Color {
    val band = QUALITY_BANDS.firstOrNull { it.key == grade } ?: return colors.ink
    return hexColor(if (colors.isDark) band.dark else band.color)
}