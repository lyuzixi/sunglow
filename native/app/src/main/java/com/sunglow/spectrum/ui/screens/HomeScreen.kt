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
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
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
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.sunglow.spectrum.R
import com.sunglow.spectrum.core.ForecastResult
import com.sunglow.spectrum.core.ModelSel
import com.sunglow.spectrum.core.Period
import com.sunglow.spectrum.core.QUALITY_BANDS
import com.sunglow.spectrum.core.QUALITY_LABEL
import com.sunglow.spectrum.core.TzCache
import com.sunglow.spectrum.core.captionOf
import com.sunglow.spectrum.core.conclWord
import com.sunglow.spectrum.core.facDisplayRows
import com.sunglow.spectrum.core.fmtClock
import com.sunglow.spectrum.core.fmtDur
import com.sunglow.spectrum.core.glowWindow
import com.sunglow.spectrum.core.gradeOf
import com.sunglow.spectrum.core.isNum
import com.sunglow.spectrum.core.shareBodyOf
import com.sunglow.spectrum.core.todayInTz
import com.sunglow.spectrum.core.uAlt
import com.sunglow.spectrum.core.uDist
import com.sunglow.spectrum.core.verdictViewOf
import com.sunglow.spectrum.core.VerdictView
import com.sunglow.spectrum.ui.HomeViewModel
import com.sunglow.spectrum.ui.motion.AnimatedNumberText
import com.sunglow.spectrum.ui.motion.confirm
import com.sunglow.spectrum.ui.motion.open
import com.sunglow.spectrum.ui.motion.pressScale
import com.sunglow.spectrum.ui.motion.rememberMotionEnabled
import com.sunglow.spectrum.ui.motion.tap
import com.sunglow.spectrum.ui.theme.DuskAstro
import com.sunglow.spectrum.ui.theme.DuskCivil
import com.sunglow.spectrum.ui.theme.DuskDay
import com.sunglow.spectrum.ui.theme.DuskNautical
import com.sunglow.spectrum.ui.theme.DuskNight
import com.sunglow.spectrum.ui.theme.SunglowColors
import com.sunglow.spectrum.ui.theme.SunglowTheme
import java.util.Locale
import kotlin.math.roundToInt

/*
 * 结论页（P0 视觉骨架）
 * 结构：实拍 Hero（双主角读数）→ 结论句 → 五段曙暮光 → 四模型并列卡 → 下钻入口。
 * 点任意模型卡，Hero 的 P/Q/等级/分歧/可信度一起切换。
 */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(vm: HomeViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val colors = SunglowTheme.colors
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

    var modelSel by remember(state.city.name, state.dateStr, state.period) {
        mutableStateOf(ModelSel.ENS)
    }
    var sheet by remember { mutableStateOf<String?>(null) }

    val haptics = LocalHapticFeedback.current
    val motion = rememberMotionEnabled()
    val modelOrder = remember { listOf(ModelSel.ENS, ModelSel.GFS, ModelSel.EC, ModelSel.RT) }
    val cycleModel: () -> Unit = {
        val i = modelOrder.indexOf(modelSel)
        modelSel = modelOrder[(i + 1) % modelOrder.size]
        haptics.tap()
    }

    val result = state.result

    PullToRefreshBox(
        isRefreshing = state.loading && result != null,
        onRefresh = vm::refresh,
        modifier = Modifier.fillMaxSize()
    ) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 20.dp)
    ) {
        item {
            HeroBlock(
                state = state,
                result = result,
                modelSel = modelSel,
                motion = motion,
                onOpenCity = { vm.setCitySheetOpen(true) },
                onCycleModel = cycleModel,
                onShare = {
                    if (result != null) {
                        haptics.confirm()
                        val view = verdictViewOf(result, modelSel)
                        val send = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, shareBodyOf(result, view))
                        }
                        context.startActivity(Intent.createChooser(send, "分享霞光预报"))
                    }
                }
            )
        }

        if (result != null) {
            val view = verdictViewOf(result, modelSel)
            item {
                Column(modifier = Modifier.padding(horizontal = 18.dp, vertical = 12.dp)) {
                    Crossfade(
                        targetState = verdictSentence(view),
                        animationSpec = tween(220),
                        label = "verdict"
                    ) { sentence ->
                        Text(
                            text = sentence,
                            style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.5.sp),
                            color = colors.ink
                        )
                    }
                }
            }
            item { SkyBand(result, motion) }
            item {
                ModelSection(
                    result = result,
                    sel = modelSel,
                    motion = motion,
                    onSelect = {
                        modelSel = it
                        haptics.tap()
                    }
                )
            }
            item {
                Column(modifier = Modifier.padding(horizontal = 18.dp, vertical = 10.dp)) {
                    FoldRow("影响因素", "13 项判据") {
                        haptics.open()
                        sheet = "factors"
                    }
                    Spacer(Modifier.height(8.dp))
                    FoldRow("光路细节", "云幕几何与消光") {
                        haptics.open()
                        sheet = "ray"
                    }
                    Spacer(Modifier.height(8.dp))
                    FoldRow("分享与文案", "生成一句话") {
                        haptics.open()
                        sheet = "share"
                    }
                }
            }
            item {
                Text(
                    text = "数据 Open-Meteo · 概率预报仅供参考",
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.faint,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp),
                    textAlign = TextAlign.Center
                )
            }
        } else {
            item { StatusCard(state.error, state.loading, vm::refresh) }
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

    if (sheet != null && result != null) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(
            onDismissRequest = { sheet = null },
            sheetState = sheetState,
            containerColor = colors.bg2
        ) {
            when (sheet) {
                "factors" -> FactorsSheet(result)
                "ray" -> RaySheet(result)
                "share" -> ShareSheet(result, verdictViewOf(result, modelSel))
            }
        }
    }
}

/* ---------- Hero ---------- */

@Composable
private fun HeroBlock(
    state: com.sunglow.spectrum.ui.HomeUiState,
    result: ForecastResult?,
    modelSel: ModelSel,
    motion: Boolean,
    onOpenCity: () -> Unit,
    onCycleModel: () -> Unit,
    onShare: () -> Unit
) {
    val colors = SunglowTheme.colors
    val view = result?.let { verdictViewOf(it, modelSel) }

    /* 照片缓推镜：8 秒 1.00 → 1.04，只在首帧跑一次 */
    val heroScale = remember { Animatable(1f) }
    LaunchedEffect(Unit) {
        if (motion) heroScale.animateTo(1.04f, tween(8000, easing = LinearEasing))
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(236.dp)
            .background(Color(0xFF1B2130))
    ) {
        Image(
            painter = painterResource(R.drawable.hero_photo),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer {
                    scaleX = heroScale.value
                    scaleY = heroScale.value
                }
        )
        /* 顶部压暗，保证状态栏与胶囊可读 */
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0f to Color(0x6B060A12),
                        0.34f to Color(0x0A060A12),
                        0.76f to Color(0x57060A12),
                        1f to Color(0xE0070B14)
                    )
                )
        )
        /* 左下径向压暗，承载读数 */
        Canvas(Modifier.fillMaxSize()) {
            drawRect(
                brush = Brush.radialGradient(
                    colors = listOf(Color(0xD9060A12), Color.Transparent),
                    center = Offset(size.width * 0.24f, size.height * 0.92f),
                    radius = size.width * 0.95f
                )
            )
        }

        /* 顶栏 */
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 18.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(Color(0x6111161F))
                    .border(1.dp, Color(0x29FFFFFF), RoundedCornerShape(999.dp))
                    .clickable(onClick = onOpenCity)
                    .padding(horizontal = 12.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    Modifier
                        .size(5.dp)
                        .clip(CircleShape)
                        .background(colors.accentCool)
                )
                Spacer(Modifier.width(7.dp))
                Text(
                    text = state.city.name,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.White.copy(alpha = 0.94f),
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = " · " + state.dateStr.takeLast(5).replace('-', '/') +
                        " · " + (if (state.period == Period.AM) "朝霞" else "晚霞"),
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.White.copy(alpha = 0.72f),
                    maxLines = 1
                )
            }
            Spacer(Modifier.weight(1f))
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .background(Color(0x6111161F))
                    .border(1.dp, Color(0x29FFFFFF), CircleShape)
                    .clickable(onClick = onShare),
                contentAlignment = Alignment.Center
            ) {
                Text("↑", style = MaterialTheme.typography.bodyLarge, color = Color.White)
            }
        }

        /* 读数 */
        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(start = 20.dp, end = 20.dp, bottom = 14.dp)
        ) {
            if (view == null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (state.loading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                            color = colors.accentCool
                        )
                        Spacer(Modifier.width(10.dp))
                    }
                    Text(
                        text = state.error ?: if (state.loading) "正在取数…" else "点我开始观测",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.White.copy(alpha = 0.8f)
                    )
                }
            } else {
                Row(
                    modifier = Modifier.clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = onCycleModel
                    ),
                    verticalAlignment = Alignment.Bottom
                ) {
                    Column {
                        AnimatedNumberText(
                            target = view.p,
                            style = MaterialTheme.typography.displaySmall.copy(
                                fontSize = 40.sp,
                                fontWeight = FontWeight.Medium,
                                shadow = Shadow(colors.accent.copy(alpha = 0.45f), blurRadius = 18f)
                            ),
                            color = Color.White,
                            durationMs = 600,
                            enabled = motion
                        )
                        Text(
                            text = if (state.period == Period.AM) "朝霞概率" else "晚霞概率",
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontSize = 9.sp,
                                letterSpacing = 1.4.sp
                            ),
                            color = Color.White.copy(alpha = 0.62f)
                        )
                    }
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = "%",
                        style = MaterialTheme.typography.titleMedium.copy(fontSize = 17.sp),
                        color = Color.White.copy(alpha = 0.9f),
                        modifier = Modifier.padding(bottom = 18.dp)
                    )
                    Spacer(Modifier.width(20.dp))
                    Column {
                        AnimatedNumberText(
                            target = view.q,
                            style = MaterialTheme.typography.displaySmall.copy(
                                fontSize = 40.sp,
                                fontWeight = FontWeight.Medium,
                                shadow = Shadow(Color(0x66FF9C3F), blurRadius = 18f)
                            ),
                            color = Color(0xFFFFD08A),
                            durationMs = 600,
                            enabled = motion
                        )
                        Text(
                            text = "观赏质量",
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontSize = 9.sp,
                                letterSpacing = 1.4.sp
                            ),
                            color = Color.White.copy(alpha = 0.62f)
                        )
                    }
                    Spacer(Modifier.width(4.dp))
                    Text(
                        text = "分",
                        style = MaterialTheme.typography.titleSmall.copy(fontSize = 13.sp),
                        color = Color(0xFFFFD08A).copy(alpha = 0.85f),
                        modifier = Modifier.padding(bottom = 18.dp)
                    )
                }

                Spacer(Modifier.height(8.dp))

                Row(verticalAlignment = Alignment.CenterVertically) {
                    SubStat("等级", QUALITY_LABEL[view.grade] ?: view.grade, gradeColor(view.grade, colors))
                    SubDivider()
                    if (view.single) {
                        SubStat("时效", "实况/历史", Color.White)
                    } else {
                        SubStat(
                            "分歧",
                            if (isNum(result.dvI)) result.dvI!!.roundToInt().toString() else "—",
                            Color.White
                        )
                        SubDivider()
                        SubStat("可信度", result.conf.level, Color.White)
                    }
                }
            }
        }
    }
}

@Composable
private fun SubStat(label: String, value: String, valueColor: Color) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
            color = Color.White.copy(alpha = 0.55f)
        )
        Spacer(Modifier.width(4.dp))
        Text(
            text = value,
            style = MaterialTheme.typography.bodySmall.copy(
                fontSize = 11.5.sp,
                fontWeight = FontWeight.SemiBold
            ),
            color = valueColor
        )
    }
}

@Composable
private fun SubDivider() {
    Box(
        Modifier
            .padding(horizontal = 8.dp)
            .width(1.dp)
            .height(10.dp)
            .background(Color.White.copy(alpha = 0.26f))
    )
}

/* ---------- 天色带 ---------- */

@Composable
private fun SkyBand(result: ForecastResult, motion: Boolean) {
    val colors = SunglowTheme.colors
    var nowMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            kotlinx.coroutines.delay(60_000)
            nowMs = System.currentTimeMillis()
        }
    }
    val now = nowMs.toDouble()
    val span = 3 * 3600000.0
    val start = result.evMs - span
    val total = span * 2
    val nowPctTarget = ((now - start) / total).coerceIn(0.0, 1.0).toFloat()
    /* 每分钟推进一次，用 600ms 缓动而不是瞬移 */
    val nowPct by animateFloatAsState(
        targetValue = nowPctTarget,
        animationSpec = tween(if (motion) 600 else 0),
        label = "nowLine"
    )

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
    val winStart = win?.let { ((it.first - start) / total).toFloat() } ?: 0f
    val winEnd = win?.let { ((it.second - start) / total).toFloat() } ?: 0f

    /* 窗口在未来 2 小时内才呼吸，避免常驻耗电 */
    val breathOn = motion && win != null && (win.first - now) in 0.0..(2 * 3600000.0)
    val breath = rememberInfiniteTransition(label = "winBreath")
    val winAlpha by breath.animateFloat(
        initialValue = 0.55f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1500),
            repeatMode = RepeatMode.Reverse
        ),
        label = "winAlpha"
    )

    Column(modifier = Modifier.padding(horizontal = 18.dp)) {
        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(28.dp)
                .clip(RoundedCornerShape(8.dp))
        ) {
            val segs = listOf(
                0.26f to DuskDay,
                0.15f to DuskCivil,
                0.15f to DuskNautical,
                0.13f to DuskAstro,
                0.31f to DuskNight
            )
            var x = 0f
            segs.forEach { (w, c) ->
                val ww = size.width * w
                drawRect(color = c, topLeft = Offset(x, 0f), size = Size(ww, size.height))
                x += ww
            }
            /* 霞光窗口 */
            if (win != null && winEnd > winStart) {
                drawRect(
                    color = Color(0xFFFF4D82).copy(alpha = if (breathOn) winAlpha else 0.9f),
                    topLeft = Offset(size.width * winStart, size.height - 3.dp.toPx()),
                    size = Size(size.width * (winEnd - winStart), 3.dp.toPx())
                )
            }
            /* 此刻 */
            drawLine(
                color = Color.White.copy(alpha = 0.9f),
                start = Offset(size.width * nowPct, 0f),
                end = Offset(size.width * nowPct, size.height),
                strokeWidth = 1.dp.toPx()
            )
        }
        Spacer(Modifier.height(4.dp))
        Row(modifier = Modifier.fillMaxWidth()) {
            listOf("白昼", "民用", "航海", "天文", "夜间").forEachIndexed { i, nm ->
                Text(
                    text = nm,
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.5.sp),
                    color = colors.faint,
                    modifier = Modifier.weight(
                        when (i) { 0 -> 26f; 1 -> 15f; 2 -> 15f; 3 -> 13f; else -> 31f }
                    )
                )
            }
            Text(
                text = "此刻 " + fmtClock(now, result.tz),
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 8.5.sp,
                    fontWeight = FontWeight.SemiBold
                ),
                color = colors.accentCool
            )
        }
    }
}

/* ---------- 模型卡 ---------- */

@Composable
private fun ModelSection(
    result: ForecastResult,
    sel: ModelSel,
    motion: Boolean,
    onSelect: (ModelSel) -> Unit
) {
    val colors = SunglowTheme.colors
    val sRT = result.sRT

    Column(modifier = Modifier.padding(horizontal = 18.dp, vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                text = "各模型独立结果",
                style = MaterialTheme.typography.titleMedium.copy(fontSize = 13.sp),
                color = colors.ink
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = "点卡片，上方数据随之切换",
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                color = colors.faint
            )
        }
        Spacer(Modifier.height(6.dp))

        /* 综合 */
        val ensView = verdictViewOf(result, ModelSel.ENS)
        ModelCard(
            index = 0,
            selected = sel == ModelSel.ENS,
            accent = colors.accentCool,
            dotColor = colors.accentCool,
            barBrush = Brush.horizontalGradient(colors.spectrum),
            title = "多模型综合",
            desc = "GFS 30% + EC 34% + 光追 36%",
            p = ensView.p,
            q = ensView.q,
            grade = ensView.grade,
            lines = listOf(
                listOf(
                    "可信度" to result.conf.level,
                    "ΔI" to (if (isNum(result.dvI)) result.dvI!!.roundToInt().toString() else "—"),
                    "ΔP" to (if (isNum(result.spread)) "${result.spread!!.roundToInt()}" else "—"),
                    "ΔQ" to (if (isNum(result.spreadQ)) "${result.spreadQ!!.roundToInt()}" else "—")
                ),
                cloudLine(result),
                listOf(
                    "持续" to fmtDur(sRT.geom.dur),
                    "AOD" to (if (isNum(result.envM.aod)) String.format(Locale.US, "%.2f", result.envM.aod) else "—")
                )
            ),
            motion = motion,
            onClick = { onSelect(ModelSel.ENS) }
        )

        result.models.forEachIndexed { idx, m ->
            val ms = when (m.id) {
                "gfs" -> Triple(ModelSel.GFS, "GFS 模式", "NOAA 全球模式 · 1 小时分辨率")
                "ec" -> Triple(ModelSel.EC, "ECMWF-IFS 模式", "欧洲中心全球模式")
                "rt" -> Triple(ModelSel.RT, "光追算法", "纯物理：多波长光路积分 + CIE 色度")
                else -> return@forEachIndexed
            }
            val accent = when (m.id) {
                "gfs" -> colors.info
                "ec" -> colors.good
                else -> colors.accent
            }
            val isRt = m.id == "rt"
            val lines = if (isRt) {
                listOf(
                    listOf(
                        "主云型" to sRT.primary.type,
                        "等效地表" to uAlt(sRT.heq * 1000),
                        "峰值透射" to fmtSci(sRT.peak.color.t550)
                    ),
                    listOf(
                        "亮度" to sRT.bright.txt.substringBefore("（"),
                        "颜色" to sRT.peak.color.nameZh,
                        "饱和" to (sRT.peak.color.sat * 100).roundToInt().toString() + "%"
                    )
                )
            } else {
                listOf(
                    cloudLine(result),
                    listOf(
                        "持续" to fmtDur(sRT.geom.dur),
                        "AOD" to (if (isNum(result.envM.aod)) String.format(Locale.US, "%.2f", result.envM.aod) else "—")
                    )
                )
            }
            ModelCard(
                index = idx + 1,
                selected = sel == ms.first,
                accent = accent,
                dotColor = accent,
                barBrush = Brush.horizontalGradient(listOf(accent, accent)),
                title = ms.second,
                desc = ms.third,
                p = m.p,
                q = m.q,
                grade = gradeOf(m.q),
                lines = lines,
                motion = motion,
                onClick = { onSelect(ms.first) }
            )
        }
    }
}

private fun cloudLine(r: ForecastResult): List<Pair<String, String>> = listOf(
    "云型" to r.sRT.primary.type,
    "云量" to (r.sRT.primary.cover.roundToInt().toString() + "%"),
    "云底" to uAlt(r.sRT.primary.base * 1000),
    "边界" to uDist(r.sRT.d)
)

@Composable
private fun ModelCard(
    index: Int,
    selected: Boolean,
    accent: Color,
    dotColor: Color,
    barBrush: Brush,
    title: String,
    desc: String,
    p: Double,
    q: Double,
    grade: String,
    lines: List<List<Pair<String, String>>>,
    motion: Boolean,
    onClick: () -> Unit
) {
    val colors = SunglowTheme.colors
    val radius = RoundedCornerShape(12.dp)
    val interaction = remember { MutableInteractionSource() }

    /* 入场：逐张上浮 12dp，间隔 40ms */
    val appear = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        if (motion) {
            kotlinx.coroutines.delay(index * 40L)
            appear.animateTo(1f, tween(360, easing = androidx.compose.animation.core.FastOutSlowInEasing))
        } else {
            appear.snapTo(1f)
        }
    }

    val borderColor by androidx.compose.animation.animateColorAsState(
        targetValue = if (selected) accent else colors.rule,
        animationSpec = tween(180),
        label = "cardBorder"
    )
    val borderWidth by animateDpAsState(
        targetValue = if (selected) 1.5.dp else 1.dp,
        animationSpec = tween(180),
        label = "cardBorderWidth"
    )

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 6.dp)
            .graphicsLayer {
                alpha = appear.value
                translationY = (1f - appear.value) * 12.dp.toPx()
            }
            .pressScale(interaction, enabled = motion)
            .clip(radius)
            .background(colors.card)
            .border(width = borderWidth, color = borderColor, shape = radius)
            .clickable(
                interactionSource = interaction,
                indication = null,
                onClick = onClick
            )
            .padding(horizontal = 11.dp, vertical = 9.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(5.dp)
                    .clip(CircleShape)
                    .background(dotColor)
            )
            Spacer(Modifier.width(6.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.bodySmall.copy(
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold
                ),
                color = colors.ink
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = desc,
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.sp),
                color = colors.faint,
                textAlign = TextAlign.End,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.width(180.dp)
            )
        }
        Spacer(Modifier.height(3.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = p.roundToInt().toString() + "%",
                style = MaterialTheme.typography.titleLarge.copy(
                    fontSize = 20.sp,
                    fontWeight = FontWeight.SemiBold
                ),
                color = colors.ink
            )
            Spacer(Modifier.width(7.dp))
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(colors.good.copy(alpha = 0.12f))
                    .border(1.dp, colors.good.copy(alpha = 0.45f), RoundedCornerShape(999.dp))
                    .padding(horizontal = 6.dp, vertical = 1.dp)
            ) {
                Text(
                    text = "质量 ${q.roundToInt()} · " + (QUALITY_LABEL[grade] ?: grade),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.sp),
                    color = colors.good
                )
            }
        }
        Spacer(Modifier.height(5.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .height(2.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(colors.rule)
        ) {
            Box(
                Modifier
                    .fillMaxWidth((p / 100.0).toFloat().coerceIn(0f, 1f))
                    .height(2.dp)
                    .background(barBrush)
            )
        }
        Spacer(Modifier.height(4.dp))
        lines.forEach { line ->
            Text(
                text = annotatedLine(line, colors),
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                color = colors.muted,
                lineHeight = 14.sp
            )
        }
    }
}

private fun annotatedLine(line: List<Pair<String, String>>, colors: SunglowColors): AnnotatedString =
    buildAnnotatedString {
        line.forEachIndexed { i, (k, v) ->
            if (i > 0) withStyle(SpanStyle(color = colors.faint.copy(alpha = 0.55f))) { append(" · ") }
            withStyle(SpanStyle(color = colors.faint)) { append(k) }
            append(" ")
            withStyle(SpanStyle(color = colors.muted)) { append(v) }
        }
    }

/* ---------- 折叠入口 ---------- */

@Composable
private fun FoldRow(title: String, note: String, onClick: () -> Unit) {
    val colors = SunglowTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(colors.card)
            .border(1.dp, colors.rule, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 13.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.bodyMedium,
            color = colors.ink,
            fontWeight = FontWeight.Medium
        )
        Spacer(Modifier.width(6.dp))
        Text(
            text = note,
            style = MaterialTheme.typography.labelSmall,
            color = colors.faint
        )
        Spacer(Modifier.weight(1f))
        Text(
            text = "›",
            style = MaterialTheme.typography.bodyLarge,
            color = colors.accentCool
        )
    }
}

/* ---------- 底部 sheet 内容 ---------- */

@Composable
private fun FactorsSheet(result: ForecastResult) {
    val colors = SunglowTheme.colors
    val rows = remember(result) { facDisplayRows(result) }
    Column(modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp)) {
        Text(
            text = "影响因素",
            style = MaterialTheme.typography.titleMedium,
            color = colors.ink
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = "13 项判据 · 到达率由云场与光路共同决定",
            style = MaterialTheme.typography.labelSmall,
            color = colors.faint
        )
        Spacer(Modifier.height(12.dp))
        rows.forEachIndexed { i, row ->
            if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(colors.rule))
            Column(modifier = Modifier.padding(vertical = 9.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = row.name,
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.ink,
                        modifier = Modifier.weight(1f)
                    )
                    Text(
                        text = row.value,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.muted
                    )
                    Spacer(Modifier.width(6.dp))
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(judgeColor(row.judgeCls, colors).copy(alpha = 0.12f))
                            .padding(horizontal = 6.dp, vertical = 1.dp)
                    ) {
                        Text(
                            text = row.judge,
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                            color = judgeColor(row.judgeCls, colors)
                        )
                    }
                }
                Spacer(Modifier.height(3.dp))
                Text(
                    text = row.desc,
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
                    color = colors.faint,
                    lineHeight = 14.sp
                )
            }
        }
    }
}

@Composable
private fun RaySheet(result: ForecastResult) {
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
        "等效地面高度" to uAlt(r.heq * 1000),
        "峰值透射" to fmtSci(r.peak.color.t550),
        "亮度" to r.bright.txt
    )
    Column(modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp)) {
        Text(
            text = "光路细节",
            style = MaterialTheme.typography.titleMedium,
            color = colors.ink
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = "沿日出/日落方位量出的云幕几何与消光",
            style = MaterialTheme.typography.labelSmall,
            color = colors.faint
        )
        Spacer(Modifier.height(12.dp))
        rows.forEach { (k, v) ->
            Row(modifier = Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
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
                    modifier = Modifier.weight(1f),
                    textAlign = TextAlign.End
                )
            }
        }
    }
}

@Composable
private fun ShareSheet(result: ForecastResult, view: VerdictView) {
    val colors = SunglowTheme.colors
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val caption = remember(result, view) { captionOf(result, view) }
    Column(modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp)) {
        Text(
            text = "分享",
            style = MaterialTheme.typography.titleMedium,
            color = colors.ink
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = caption,
            style = MaterialTheme.typography.bodyMedium,
            color = colors.muted
        )
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(999.dp))
                    .background(Brush.horizontalGradient(colors.spectrum))
                    .clickable {
                        haptics.confirm()
                        val send = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, shareBodyOf(result, view))
                        }
                        context.startActivity(Intent.createChooser(send, "分享霞光预报"))
                    }
                    .padding(vertical = 11.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "系统分享",
                    style = MaterialTheme.typography.titleSmall,
                    color = Color(0xFF06101C)
                )
            }
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(999.dp))
                    .background(colors.glass)
                    .border(1.dp, colors.ruleStrong, RoundedCornerShape(999.dp))
                    .clickable {
                        haptics.confirm()
                        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        cm.setPrimaryClip(ClipData.newPlainText("霞光预报", caption))
                        Toast.makeText(context, "文案已复制", Toast.LENGTH_SHORT).show()
                    }
                    .padding(vertical = 11.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "复制文案",
                    style = MaterialTheme.typography.titleSmall,
                    color = colors.ink
                )
            }
        }
    }
}

/* ---------- 状态卡 ---------- */

@Composable
private fun StatusCard(error: String?, loading: Boolean, onRetry: () -> Unit) {
    val colors = SunglowTheme.colors
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 8.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(colors.card)
            .border(1.dp, colors.rule, RoundedCornerShape(14.dp))
            .padding(16.dp)
    ) {
        Text(
            text = if (error != null) "取数失败" else if (loading) "正在取数…" else "暂无数据",
            style = MaterialTheme.typography.titleSmall,
            color = if (error != null) colors.bad else colors.ink
        )
        if (error != null) {
            Spacer(Modifier.height(6.dp))
            Text(
                text = error,
                style = MaterialTheme.typography.bodySmall,
                color = colors.muted
            )
        }
        Spacer(Modifier.height(10.dp))
        Text(
            text = if (loading) "请稍候" else "重新计算",
            style = MaterialTheme.typography.bodyMedium,
            color = colors.accentCool,
            modifier = Modifier
                .clip(RoundedCornerShape(999.dp))
                .clickable(enabled = !loading, onClick = onRetry)
                .padding(horizontal = 8.dp, vertical = 4.dp)
        )
    }
}

/* ---------- 工具 ---------- */

private fun verdictSentence(view: VerdictView): String = when {
    view.p >= 60 -> "云幕与光路配合得不错，值得往高处走一趟"
    view.p >= 35 -> "有一定机会，值得碰碰运气"
    view.p >= 15 -> "机会不大，路过时顺便看看"
    else -> "这一场希望不大，安心做别的事"
}

private fun gradeColor(grade: String, colors: SunglowColors): Color {
    val band = QUALITY_BANDS.firstOrNull { it.key == grade } ?: return colors.muted
    return hexColor(if (colors.isDark) band.dark else band.color)
}

private fun judgeColor(cls: String, colors: SunglowColors): Color = when (cls) {
    "ok" -> colors.good
    "mid" -> colors.mid
    "bad" -> colors.bad
    else -> colors.muted
}

private fun hexColor(hex: String): Color = try {
    Color(android.graphics.Color.parseColor(hex))
} catch (_: Exception) {
    Color.Gray
}

/** 科学计数法：2.78e-2 / 1.2e-3 */
private fun fmtSci(v: Double): String {
    if (!v.isFinite() || v <= 0) return "—"
    val e = kotlin.math.floor(kotlin.math.log10(v)).toInt()
    val m = v / Math.pow(10.0, e.toDouble())
    return String.format(Locale.US, "%.2fe%d", m, e)
}
