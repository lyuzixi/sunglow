package com.sunglow.spectrum.ui.screens

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
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
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.material3.Switch
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
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
import androidx.core.content.ContextCompat
import com.sunglow.spectrum.R
import com.sunglow.spectrum.core.ForecastResult
import com.sunglow.spectrum.core.ModelSel
import com.sunglow.spectrum.core.Period
import com.sunglow.spectrum.core.QUALITY_BANDS
import com.sunglow.spectrum.core.QUALITY_LABEL
import com.sunglow.spectrum.core.TzCache
import com.sunglow.spectrum.core.captionOf
import com.sunglow.spectrum.core.refScore
import com.sunglow.spectrum.core.conclWord
import com.sunglow.spectrum.core.facDisplayRows
import com.sunglow.spectrum.core.fmtClock
import com.sunglow.spectrum.core.fmtDur
import com.sunglow.spectrum.core.glowWindow
import com.sunglow.spectrum.core.gradeOf
import com.sunglow.spectrum.core.isNum
import com.sunglow.spectrum.core.shareBodyOf
import com.sunglow.spectrum.core.shareUrlOf
import com.sunglow.spectrum.core.skyBandOf
import com.sunglow.spectrum.core.todayInTz
import com.sunglow.spectrum.core.uAlt
import com.sunglow.spectrum.core.uDist
import com.sunglow.spectrum.core.verdictViewOf
import com.sunglow.spectrum.core.VerdictView
import com.sunglow.spectrum.ui.HomeViewModel
import com.sunglow.spectrum.ui.components.ChevronRight
import com.sunglow.spectrum.ui.components.MoreIcon
import com.sunglow.spectrum.ui.components.ShareIcon
import com.sunglow.spectrum.ui.i18n.Lang
import com.sunglow.spectrum.ui.motion.AnimatedNumberText
import com.sunglow.spectrum.ui.motion.confirm
import com.sunglow.spectrum.ui.motion.open
import com.sunglow.spectrum.ui.motion.pressScale
import com.sunglow.spectrum.ui.motion.rememberMotionEnabled
import com.sunglow.spectrum.ui.motion.tap
import com.sunglow.spectrum.ui.share.ShareCard
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
                Toast.makeText(context, context.getString(R.string.home_loc_fail), Toast.LENGTH_SHORT).show()
            }
        } else {
            Toast.makeText(context, context.getString(R.string.home_loc_denied), Toast.LENGTH_SHORT).show()
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
                onOpenSettings = { sheet = "settings" },
                onCycleModel = cycleModel,
                onShare = {
                    if (result != null) {
                        haptics.open()
                        sheet = "share"
                    }
                }
            )
        }

        if (result != null) {
            val time = state.offlineAt?.let { offlineTime(it) }
            /* N5：缓存结果（6 小时内）不是「离线」，如实写成缓存；断网时 error 同时在，提示更清楚 */
            val hasNotice = state.offlineAt != null || state.error != null
            if (hasNotice) {
                item {
                    val notice = when {
                        state.offlineAt != null && state.error != null ->
                            stringResource(R.string.home_cache_time_kind, time ?: "", errorLabel(state.errorKind))
                        state.offlineAt != null -> stringResource(R.string.home_cache_time, time ?: "")
                        else -> stringResource(R.string.home_error_retry, errorLabel(state.errorKind))
                    }
                    NoticeStrip(notice, stringResource(R.string.home_retry), vm::refresh)
                }
            }
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
                    FoldRow(stringResource(R.string.fold_factors), stringResource(R.string.fold_factors_note)) {
                        haptics.open()
                        sheet = "factors"
                    }
                    Spacer(Modifier.height(8.dp))
                    FoldRow(stringResource(R.string.fold_ray), stringResource(R.string.fold_ray_note)) {
                        haptics.open()
                        sheet = "ray"
                    }
                    Spacer(Modifier.height(8.dp))
                    FoldRow(stringResource(R.string.fold_share), stringResource(R.string.fold_share_note)) {
                        haptics.open()
                        sheet = "share"
                    }
                }
            }
            item {
                Text(
                    text = stringResource(R.string.home_data_credit),
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.faint,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp),
                    textAlign = TextAlign.Center
                )
            }
        } else if (state.loading) {
            item { PageSkeleton(colors) }
        } else {
            item { StatusCard(state.error, state.errorKind, vm::refresh, state.needsFetch) }
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
                        Toast.makeText(context, context.getString(R.string.home_loc_fail), Toast.LENGTH_SHORT).show()
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
                "share" -> ShareSheet(result, verdictViewOf(result, modelSel), state, vm::loadHeat)
                "settings" -> SettingsSheet(
                    themeMode = state.themeMode,
                    lang = state.lang,
                    reminderEnabled = state.reminderEnabled,
                    reminderThreshold = state.reminderThreshold,
                    showSamples = state.showSamples,
                    onSetTheme = vm::setThemeMode,
                    onSetLang = vm::setLanguage,
                    onSetReminder = vm::setReminderEnabled,
                    onSetThreshold = vm::setReminderThreshold,
                    onSetSamples = vm::setShowSamples,
                    onOpenAbout = { sheet = "about" },
                    onOpenGuide = { sheet = "guide" },
                    onFeedback = {
                        runCatching {
                            context.startActivity(
                                Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://github.com/lyuzixi/sunglow/issues"))
                            )
                        }
                    },
                    onClearCache = {
                        vm.clearLocalCache()
                        Toast.makeText(context, context.getString(R.string.cache_cleared), Toast.LENGTH_SHORT).show()
                    }
                )
                "about" -> AboutSheet(state.requestCount)
                "guide" -> GuideSheet()
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
    onOpenSettings: () -> Unit,
    onCycleModel: () -> Unit,
    onShare: () -> Unit
) {
    val colors = SunglowTheme.colors
    /* N5 首帧：窄屏用 B3 的 720w 分档图（解码更快、内存更省），大屏仍用原图 */
    val heroRes = if (LocalConfiguration.current.screenWidthDp <= 420) {
        R.drawable.hero_photo_720
    } else {
        R.drawable.hero_photo
    }
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
            painter = painterResource(heroRes),
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
                        " · " + (if (state.period == Period.AM) stringResource(R.string.widget_am) else stringResource(R.string.widget_pm)),
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
                ShareIcon(Color.White, 15.dp)
            }
            Spacer(Modifier.width(8.dp))
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .background(Color(0x6111161F))
                    .border(1.dp, Color(0x29FFFFFF), CircleShape)
                    .clickable(onClick = onOpenSettings),
                contentAlignment = Alignment.Center
            ) {
                MoreIcon(Color.White, 15.dp)
            }
        }

        /* 读数 */
        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(start = 20.dp, end = 20.dp, bottom = 14.dp)
        ) {
            if (view == null) {
                if (state.loading) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        SkeletonBar(Modifier.width(72.dp).height(36.dp))
                        Spacer(Modifier.width(22.dp))
                        SkeletonBar(Modifier.width(72.dp).height(36.dp))
                    }
                } else {
                    Text(
                        text = state.error ?: stringResource(R.string.home_start),
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
                            text = if (state.period == Period.AM) stringResource(R.string.home_am_prob) else stringResource(R.string.home_pm_prob),
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
                            text = stringResource(R.string.home_quality),
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontSize = 9.sp,
                                letterSpacing = 1.4.sp
                            ),
                            color = Color.White.copy(alpha = 0.62f)
                        )
                    }
                    Spacer(Modifier.width(4.dp))
                    Text(
                        text = stringResource(R.string.home_score_unit),
                        style = MaterialTheme.typography.titleSmall.copy(fontSize = 13.sp),
                        color = Color(0xFFFFD08A).copy(alpha = 0.85f),
                        modifier = Modifier.padding(bottom = 18.dp)
                    )
                }

                Spacer(Modifier.height(8.dp))

                Row(verticalAlignment = Alignment.CenterVertically) {
                    SubStat(stringResource(R.string.home_grade), gradeLabel(view.grade), gradeColor(view.grade, colors))
                    SubDivider()
                    if (view.single) {
                        SubStat(stringResource(R.string.home_recency), stringResource(R.string.home_live), Color.White)
                    } else {
                        SubStat(
                            stringResource(R.string.home_divergence),
                            if (isNum(result.dvI)) result.dvI!!.roundToInt().toString() else "—",
                            Color.White
                        )
                        SubDivider()
                        SubStat(stringResource(R.string.home_confidence), confLabel(result.conf.key), Color.White)
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
    val band = remember(result, nowMs) {
        skyBandOf(result, nowMs.toDouble(), result.dateStr)
    }
    /* 每分钟推进一次，用 600ms 缓动而不是瞬移 */
    val nowPct by animateFloatAsState(
        targetValue = band?.nowPct ?: 0f,
        animationSpec = tween(if (motion) 600 else 0),
        label = "nowLine"
    )

    /* 有窗口才呼吸，避免常驻耗电 */
    val breathOn = motion && band != null && band.winWidth > 0f
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
            val segs = band?.segments
            if (segs != null) {
                val totalW = segs.sumOf { it.weight.toDouble() }.toFloat().coerceAtLeast(0.01f)
                var x = 0f
                segs.forEach { s ->
                    val ww = size.width * (s.weight / totalW)
                    drawRect(color = skyColor(s.key), topLeft = Offset(x, 0f), size = Size(ww, size.height))
                    x += ww
                }
                /* 霞光窗口 */
                if (band.winWidth > 0f) {
                    drawRect(
                        color = Color(0xFFFF4D82).copy(alpha = if (breathOn) winAlpha else 0.9f),
                        topLeft = Offset(size.width * band.winLeft, size.height - 3.dp.toPx()),
                        size = Size(size.width * band.winWidth, 3.dp.toPx())
                    )
                }
                /* 此刻：用缓动后的百分比，每分钟平滑推进 */
                if (band.nowPct != null) {
                    drawLine(
                        color = Color.White.copy(alpha = 0.9f),
                        start = Offset(size.width * nowPct, 0f),
                        end = Offset(size.width * nowPct, size.height),
                        strokeWidth = 1.dp.toPx()
                    )
                }
            } else {
                /* 极端情况（太阳事件算不出）退回固定五段 */
                val fixed = listOf(
                    0.26f to DuskDay,
                    0.15f to DuskCivil,
                    0.15f to DuskNautical,
                    0.13f to DuskAstro,
                    0.31f to DuskNight
                )
                var x = 0f
                fixed.forEach { (w, c) ->
                    val ww = size.width * w
                    drawRect(color = c, topLeft = Offset(x, 0f), size = Size(ww, size.height))
                    x += ww
                }
            }
        }
        Spacer(Modifier.height(4.dp))
        Row(modifier = Modifier.fillMaxWidth()) {
            val current = band
            if (current != null) {
                current.segments.forEach { s ->
                    Text(
                        text = skyShortName(s.key),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.5.sp),
                        color = colors.faint,
                        modifier = Modifier.weight(s.weight)
                    )
                }
                if (current.nowPct != null) {
                    Text(
                        text = stringResource(R.string.home_now, current.nowText),
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontSize = 8.5.sp,
                            fontWeight = FontWeight.SemiBold
                        ),
                        color = colors.accentCool
                    )
                }
            } else {
                val names = listOf(
                    R.string.sky_day, R.string.sky_civil, R.string.sky_naut,
                    R.string.sky_astro, R.string.sky_night
                )
                names.forEachIndexed { i, res ->
                    Text(
                        text = stringResource(res),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.5.sp),
                        color = colors.faint,
                        modifier = Modifier.weight(
                            when (i) { 0 -> 26f; 1 -> 15f; 2 -> 15f; 3 -> 13f; else -> 31f }
                        )
                    )
                }
            }
        }
    }
}

/* ---------- 模型卡 ---------- */

/** 五段曙暮光配色（与网页 --dusk-* 同值） */
private fun skyColor(key: String): Color = when (key) {
    "day" -> DuskDay
    "civil" -> DuskCivil
    "naut" -> DuskNautical
    "astro" -> DuskAstro
    else -> DuskNight
}

/** 轴标短名：段宽按真实时长，名字要压到两个字 */
@Composable
private fun skyShortName(key: String): String = when (key) {
    "day" -> stringResource(R.string.sky_day)
    "civil" -> stringResource(R.string.sky_civil)
    "naut" -> stringResource(R.string.sky_naut)
    "astro" -> stringResource(R.string.sky_astro)
    else -> stringResource(R.string.sky_night)
}

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
                text = stringResource(R.string.model_title),
                style = MaterialTheme.typography.titleMedium.copy(fontSize = 13.sp),
                color = colors.ink
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = stringResource(R.string.model_hint),
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
            title = stringResource(R.string.model_ens),
            desc = stringResource(R.string.model_ens_desc),
            p = ensView.p,
            q = ensView.q,
            grade = ensView.grade,
            lines = listOf(
                listOf(
                    stringResource(R.string.label_conf) to confLabel(result.conf.key),
                    "ΔI" to (if (isNum(result.dvI)) result.dvI!!.roundToInt().toString() else "—"),
                    "ΔP" to (if (isNum(result.spread)) "${result.spread!!.roundToInt()}" else "—"),
                    "ΔQ" to (if (isNum(result.spreadQ)) "${result.spreadQ!!.roundToInt()}" else "—")
                ),
                cloudLine(result),
                listOf(
                    stringResource(R.string.label_duration) to fmtDur(sRT.geom.dur),
                    "AOD" to (if (isNum(result.envM.aod)) String.format(Locale.US, "%.2f", result.envM.aod) else "—")
                ),
                /* N3b 独立旁证：五因子参考分，不参与加权，只作交叉验证 */
                listOf(
                    stringResource(R.string.label_ref) to (
                        stringResource(R.string.home_ref_suffix, refScore(result.envM).v.roundToInt().toString()) +
                            if (refScore(result.envM).missing.isNotEmpty())
                                stringResource(R.string.home_ref_missing, refScore(result.envM).missing.joinToString("/"))
                            else ""
                        )
                )
            ),
            motion = motion,
            onClick = { onSelect(ModelSel.ENS) }
        )

        result.models.forEachIndexed { idx, m ->
            val ms = when (m.id) {
                "gfs" -> Triple(ModelSel.GFS, stringResource(R.string.model_gfs), stringResource(R.string.model_gfs_desc))
                "ec" -> Triple(ModelSel.EC, stringResource(R.string.model_ec), stringResource(R.string.model_ec_desc))
                "rt" -> Triple(ModelSel.RT, stringResource(R.string.model_rt), stringResource(R.string.model_rt_desc))
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
                        stringResource(R.string.field_main_deck) to cloudTypeLabel(sRT.primary.type),
                        stringResource(R.string.label_heq) to uAlt(sRT.heq * 1000),
                        stringResource(R.string.label_peak_t) to fmtSci(sRT.peak.color.t550)
                    ),
                    listOf(
                        stringResource(R.string.label_bright) to brightLabel(sRT.bright.score),
                        stringResource(R.string.label_color) to colorLabel(sRT.peak.color.nameKey),
                        stringResource(R.string.label_sat) to (sRT.peak.color.sat * 100).roundToInt().toString() + "%"
                    )
                )
            } else {
                listOf(
                    cloudLine(result),
                    listOf(
                        stringResource(R.string.label_duration) to fmtDur(sRT.geom.dur),
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

@Composable
private fun cloudLine(r: ForecastResult): List<Pair<String, String>> = listOf(
    stringResource(R.string.label_cloud_type) to cloudTypeLabel(r.sRT.primary.type),
    stringResource(R.string.field_cover) to (r.sRT.primary.cover.roundToInt().toString() + "%"),
    stringResource(R.string.label_cloud_base) to uAlt(r.sRT.primary.base * 1000),
    stringResource(R.string.label_edge) to uDist(r.sRT.d)
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
                onClickLabel = stringResource(R.string.home_switch_model, title),
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
                    text = stringResource(R.string.home_badge, q.roundToInt(), gradeLabel(grade)),
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
        ChevronRight(colors.accentCool, 14.dp)
    }
}

@Composable
private fun FactorsSheet(result: ForecastResult) {
    val colors = SunglowTheme.colors
    val rows = remember(result) { facDisplayRows(result) }
    Column(modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp)) {
        Text(
            text = stringResource(R.string.factor_title),
            style = MaterialTheme.typography.titleMedium,
            color = colors.ink
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = stringResource(R.string.factor_sub),
            style = MaterialTheme.typography.labelSmall,
            color = colors.faint
        )
        Spacer(Modifier.height(10.dp))
        val byKey = remember(rows) { rows.associateBy { it.key } }
        val groups = listOf(
            Triple(stringResource(R.string.factor_group_cloud), stringResource(R.string.factor_group_cloud_note), listOf("cover", "base", "block")),
            Triple(stringResource(R.string.factor_group_ray), stringResource(R.string.factor_group_ray_note), listOf("heq", "heff", "dedge")),
            Triple(stringResource(R.string.factor_group_atmo), stringResource(R.string.factor_group_atmo_note), listOf("aod", "vis", "rh")),
            Triple(stringResource(R.string.factor_group_dyn), stringResource(R.string.factor_group_dyn_note), listOf("stab", "wind", "cape")),
            Triple(stringResource(R.string.factor_group_consist), stringResource(R.string.factor_group_consist_note), listOf("consist"))
        )
        groups.forEach { (title, note, keys) ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 14.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                    color = colors.accentCool,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    text = note,
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
                    color = colors.faint
                )
                Spacer(Modifier.weight(1f))
                Text(
                    text = stringResource(R.string.factor_count, keys.count { byKey.containsKey(it) }),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                    color = colors.faint
                )
            }
            keys.mapNotNull { byKey[it] }.forEach { row ->
                Box(Modifier.fillMaxWidth().height(1.dp).background(colors.rule))
                Column(modifier = Modifier.padding(vertical = 9.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = factorName(row.nameKey),
                            style = MaterialTheme.typography.bodyMedium,
                            color = colors.ink,
                            modifier = Modifier.weight(1f)
                        )
                        Text(
                            text = factorValue(row),
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
                                text = judgeLabel(row.judgeCls),
                                style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                                color = judgeColor(row.judgeCls, colors)
                            )
                        }
                    }
                    Spacer(Modifier.height(3.dp))
                    Text(
                        text = factorDesc(row.descKey),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
                        color = colors.faint,
                        lineHeight = 14.sp
                    )
                }
            }
        }
    }
}

@Composable
private fun RaySheet(result: ForecastResult) {
    val colors = SunglowTheme.colors
    val r = result.sRT
    val g = r.geom
    val samples = r.samples
    val keyRows = listOf(
        stringResource(R.string.ray_geom_window) to if (g.ok) fmtDur(g.dur) else stringResource(R.string.ray_not_ok),
        stringResource(R.string.ray_bright_level) to brightLabel(r.bright.score),
        stringResource(R.string.ray_peak_t550) to fmtSci(r.peak.color.t550),
        stringResource(R.string.ray_tau) to String.format(Locale.US, "%.2f", r.peak.color.tau550),
        stringResource(R.string.ray_peak_color) to colorLabel(r.peak.color.nameKey),
        stringResource(R.string.ray_hue_spread) to String.format(Locale.US, "%.1f", r.hueSpread) + "°",
        stringResource(R.string.ray_hs) to String.format(Locale.US, "%.2f", r.hs) + " km",
        stringResource(R.string.ray_near) to if (g.thNearDeg.isFinite()) String.format(Locale.US, "%.1f", g.thNearDeg) + "°" else "—",
        stringResource(R.string.ray_far) to if (g.thFarDeg.isFinite()) String.format(Locale.US, "%.1f", g.thFarDeg) + "°" else "—"
    )
    Column(modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp)) {
        Text(
            text = stringResource(R.string.fold_ray),
            style = MaterialTheme.typography.titleMedium,
            color = colors.ink
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = stringResource(R.string.ray_sub),
            style = MaterialTheme.typography.labelSmall,
            color = colors.faint
        )

        Spacer(Modifier.height(14.dp))
        keyRows.chunked(2).forEach { pair ->
            Row(Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
                pair.forEach { (k, v) ->
                    Column(Modifier.weight(1f)) {
                        Text(
                            text = k,
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
                            color = colors.faint
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(
                            text = v,
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.ink
                        )
                    }
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }

        /* 光谱色样：刚被照亮 → 掠地最红 */
        Spacer(Modifier.height(16.dp))
        Text(
            text = stringResource(R.string.ray_spectrum),
            style = MaterialTheme.typography.titleSmall,
            color = colors.ink
        )
        Spacer(Modifier.height(2.dp))
        Text(
            text = stringResource(R.string.ray_spectrum_hint),
            style = MaterialTheme.typography.labelSmall,
            color = colors.faint
        )
        Spacer(Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            samples.forEach { s ->
                Column(Modifier.weight(1f)) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(42.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color(android.graphics.Color.parseColor(s.color.hex)))
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = colorLabel(s.color.nameKey),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.5.sp),
                        color = colors.faint,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }

        /* 照亮时间轴：云底被低角度阳光照亮的时段 */
        Spacer(Modifier.height(16.dp))
        TimeLine(result, colors)

        /* 亮度·彩度曲线 */
        Spacer(Modifier.height(16.dp))
        Text(
            text = stringResource(R.string.ray_curve),
            style = MaterialTheme.typography.titleSmall,
            color = colors.ink
        )
        Spacer(Modifier.height(8.dp))
        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(96.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(colors.glass)
                .padding(8.dp)
        ) {
            val w = size.width
            val h = size.height
            for (i in 0..4) {
                val y = h * i / 4f
                drawLine(colors.rule, Offset(0f, y), Offset(w, y), 1.dp.toPx())
            }
            if (samples.isEmpty()) return@Canvas
            val lumMax = samples.maxOf { it.color.lumRel }.coerceAtLeast(1e-9)
            val chrMax = samples.maxOf { it.color.chroma }.coerceAtLeast(1e-9)
            fun px(t: Float): Float = t.coerceIn(0f, 1f) * w
            fun py(v: Double): Float = h - (v.coerceIn(0.0, 1.0) * h).toFloat()

            fun poly(values: List<Double>, color: Color) {
                for (i in 1 until samples.size) {
                    drawLine(
                        color = color,
                        start = Offset(px(samples[i - 1].t.toFloat()), py(values[i - 1])),
                        end = Offset(px(samples[i].t.toFloat()), py(values[i])),
                        strokeWidth = 2.dp.toPx()
                    )
                }
            }
            poly(samples.map { it.color.lumRel / lumMax }, colors.accentAlt)
            poly(samples.map { it.color.chroma / chrMax }, colors.accentCool)

            samples.forEach { s ->
                val x = px(s.t.toFloat())
                drawCircle(
                    color = Color(android.graphics.Color.parseColor(s.color.hex)),
                    radius = 3.2.dp.toPx(),
                    center = Offset(x, h - 5.dp.toPx())
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(14.dp).height(2.dp).background(colors.accentAlt))
            Spacer(Modifier.width(4.dp))
            Text(stringResource(R.string.label_bright), style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp), color = colors.faint)
            Spacer(Modifier.width(12.dp))
            Box(Modifier.width(14.dp).height(2.dp).background(colors.accentCool))
            Spacer(Modifier.width(4.dp))
            Text(stringResource(R.string.ray_chroma), style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp), color = colors.faint)
            Spacer(Modifier.weight(1f))
            Text(stringResource(R.string.ray_just_lit), style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp), color = colors.faint)
        }
    }
}

/** 云底被照亮的时段条：位置取自天色带同一条时间轴 */
@Composable
private fun TimeLine(result: ForecastResult, colors: SunglowColors) {
    val win = glowWindow(
        evMs = result.evMs,
        isAM = result.period == Period.AM,
        lat = result.city.lat,
        lon = result.city.lon,
        thNearDeg = result.sRT.geom.thNearDeg,
        thFarDeg = result.sRT.geom.thFarDeg
    )
    Text(
        text = stringResource(R.string.ray_timeline),
        style = MaterialTheme.typography.titleSmall,
        color = colors.ink
    )
    Spacer(Modifier.height(2.dp))
    Text(
        text = stringResource(R.string.ray_timeline_hint),
        style = MaterialTheme.typography.labelSmall,
        color = colors.faint
    )
    Spacer(Modifier.height(8.dp))
    if (win == null) {
        Text(
            text = stringResource(R.string.ray_no_window),
            style = MaterialTheme.typography.labelSmall,
            color = colors.mid
        )
        return
    }
    val sky = skyBandOf(result, System.currentTimeMillis().toDouble(), result.dateStr)
    val span = if (sky != null) sky.endMs - sky.startMs else 0.0
    val left = if (span > 0) ((win.first - sky!!.startMs) / span).toFloat().coerceIn(0f, 1f) else 0f
    val right = if (span > 0) ((win.second - sky!!.startMs) / span).toFloat().coerceIn(0f, 1f) else 1f
    Canvas(
        modifier = Modifier
            .fillMaxWidth()
            .height(10.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(colors.glassStrong)
    ) {
        drawRect(
            color = colors.accent,
            topLeft = Offset(left * size.width, 0f),
            size = Size((right - left).coerceAtLeast(0.02f) * size.width, size.height)
        )
    }
    Spacer(Modifier.height(6.dp))
    Row(Modifier.fillMaxWidth()) {
        Text(
            text = stringResource(R.string.ray_start, fmtClock(win.first, result.tz)),
            style = MaterialTheme.typography.labelSmall,
            color = colors.faint
        )
        Spacer(Modifier.weight(1f))
        Text(
            text = stringResource(R.string.ray_end, fmtClock(win.second, result.tz)),
            style = MaterialTheme.typography.labelSmall,
            color = colors.faint
        )
    }
}

@Composable
private fun ShareSheet(
    result: ForecastResult,
    view: VerdictView,
    state: com.sunglow.spectrum.ui.HomeUiState,
    onLoadHeat: () -> Unit
) {
    val colors = SunglowTheme.colors
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val caption = remember(result, view) { captionOf(result, view) }
    val link = remember(result) { shareUrlOf(result) }
    val qr = remember(result) { ShareCard.qr(link, 512) }
    val heat = state.heat
    var qrOpen by remember(result) { mutableStateOf(false) }

    fun copyText(text: String, tip: Int) {
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("Sunglow", text))
        Toast.makeText(context, context.getString(tip), Toast.LENGTH_SHORT).show()
    }

    fun safeShare(block: () -> Unit) {
        runCatching(block).onFailure {
            Toast.makeText(context, context.getString(R.string.share_failed), Toast.LENGTH_SHORT).show()
        }
    }

    Column(modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp)) {
        Text(
            text = stringResource(R.string.share_title),
            style = MaterialTheme.typography.titleMedium,
            color = colors.ink
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = caption,
            style = MaterialTheme.typography.bodyMedium,
            color = colors.muted
        )
        Spacer(Modifier.height(14.dp))

        /* 八磁贴：四张图片产物 + 四个链接/提醒动作，与网页分享中心同一个口径 */
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ShareTile(
                name = stringResource(R.string.share_tile_card),
                sub = stringResource(R.string.share_sub_card),
                enabled = true,
                main = true,
                modifier = Modifier.weight(1f)
            ) {
                haptics.confirm()
                safeShare {
                    ShareCard.shareImage(context, result, view, colors.isDark, 0, null)
                }
            }
            ShareTile(
                name = stringResource(R.string.share_tile_story),
                sub = stringResource(R.string.share_sub_story),
                enabled = true,
                modifier = Modifier.weight(1f)
            ) {
                haptics.confirm()
                safeShare {
                    ShareCard.shareBitmap(
                        context,
                        ShareCard.renderStory(context, result, view, colors.isDark),
                        "sunglow-story-" + result.dateStr + "-" + result.period.name.lowercase() + ".png",
                        shareBodyOf(result, view)
                    )
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ShareTile(
                name = stringResource(R.string.share_tile_trend),
                sub = if (state.trend.isEmpty()) stringResource(R.string.share_hint_trend)
                else stringResource(R.string.share_sub_trend),
                enabled = state.trend.isNotEmpty(),
                modifier = Modifier.weight(1f)
            ) {
                haptics.confirm()
                safeShare {
                    ShareCard.shareBitmap(
                        context,
                        ShareCard.renderTrend(context, state.trend, result.city.name, colors.isDark),
                        "sunglow-trend-" + result.dateStr + ".png",
                        shareBodyOf(result, view)
                    )
                }
            }
            ShareTile(
                name = stringResource(R.string.share_tile_map),
                sub = when {
                    heat != null -> stringResource(R.string.share_sub_map)
                    state.heatLoading -> stringResource(R.string.share_map_loading)
                    else -> stringResource(R.string.share_hint_map)
                },
                enabled = !state.heatLoading,
                modifier = Modifier.weight(1f)
            ) {
                haptics.tap()
                if (heat == null) {
                    onLoadHeat()
                } else {
                    safeShare {
                        ShareCard.shareImage(context, result, view, colors.isDark, 1, heat)
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ShareTile(
                name = stringResource(R.string.share_copy_link),
                sub = stringResource(R.string.share_tile_link_sub),
                enabled = true,
                modifier = Modifier.weight(1f)
            ) {
                haptics.tap()
                copyText(link, R.string.share_link_copied)
            }
            ShareTile(
                name = stringResource(R.string.share_tile_qr),
                sub = stringResource(R.string.share_sub_qr),
                enabled = true,
                modifier = Modifier.weight(1f)
            ) {
                haptics.tap()
                qrOpen = !qrOpen
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ShareTile(
                name = stringResource(R.string.share_copy_text),
                sub = stringResource(R.string.share_tile_caption_sub),
                enabled = true,
                modifier = Modifier.weight(1f)
            ) {
                haptics.tap()
                copyText(caption, R.string.share_text_copied)
            }
            ShareTile(
                name = stringResource(R.string.share_tile_ics),
                sub = stringResource(R.string.share_sub_ics),
                enabled = true,
                modifier = Modifier.weight(1f)
            ) {
                haptics.confirm()
                safeShare {
                    ShareCard.shareIcs(context, result, view)
                }
                Toast.makeText(context, context.getString(R.string.share_ics_done), Toast.LENGTH_SHORT).show()
            }
        }

        /* 二维码：扫码回到同一城市、同一天、同一时段 */
        if (qrOpen) {
            Spacer(Modifier.height(14.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(colors.glass)
                    .border(1.dp, colors.rule, RoundedCornerShape(14.dp))
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(128.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(Color.White)
                        .padding(8.dp),
                    contentAlignment = Alignment.Center
                ) {
                    if (qr != null) {
                        Image(
                            bitmap = qr.asImageBitmap(),
                            contentDescription = stringResource(R.string.share_tile_qr),
                            modifier = Modifier.fillMaxSize()
                        )
                    }
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = stringResource(R.string.share_qr_title),
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.ink
                    )
                    Spacer(Modifier.height(3.dp))
                    Text(
                        text = result.city.shortName + " · " + result.dateStr + " · " +
                            (if (result.period == Period.AM) stringResource(R.string.widget_am) else stringResource(R.string.widget_pm)),
                        style = MaterialTheme.typography.labelSmall,
                        color = colors.faint
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = stringResource(R.string.share_copy_link),
                        style = MaterialTheme.typography.labelSmall,
                        color = colors.accentCool,
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .border(1.dp, colors.ruleStrong, RoundedCornerShape(999.dp))
                            .clickable {
                                haptics.tap()
                                copyText(link, R.string.share_link_copied)
                            }
                            .padding(horizontal = 10.dp, vertical = 4.dp)
                    )
                }
            }
        }
    }
}

/** 分享磁贴：名称 + 一句副文案；禁用时给原因，不留「点了没反应」 */
@Composable
private fun ShareTile(
    name: String,
    sub: String,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    main: Boolean = false,
    onClick: () -> Unit
) {
    val colors = SunglowTheme.colors
    Column(
        modifier = modifier
            .heightIn(min = 58.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(if (main) colors.glassStrong else colors.glass)
            .border(
                1.dp,
                if (main) colors.accent else colors.rule,
                RoundedCornerShape(14.dp)
            )
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp)
    ) {
        Text(
            text = name,
            style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp),
            color = if (enabled) colors.ink else colors.faint
        )
        Spacer(Modifier.height(3.dp))
        Text(
            text = sub,
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
            color = colors.faint,
            lineHeight = 13.sp,
            maxLines = 2
        )
    }
}

/* ---------- 设置 ---------- */

@Composable
private fun SettingsSheet(
    themeMode: Int,
    lang: String,
    reminderEnabled: Boolean,
    reminderThreshold: Int,
    showSamples: Boolean,
    onSetTheme: (Int) -> Unit,
    onSetLang: (String) -> Unit,
    onSetReminder: (Boolean) -> Unit,
    onSetThreshold: (Int) -> Unit,
    onSetSamples: (Boolean) -> Unit,
    onOpenAbout: () -> Unit,
    onOpenGuide: () -> Unit,
    onFeedback: () -> Unit,
    onClearCache: () -> Unit
) {
    val colors = SunglowTheme.colors
    val context = LocalContext.current
    val activity = context.findActivity()
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        onSetReminder(granted)
        if (!granted) {
            Toast.makeText(
                context,
                context.getString(R.string.reminder_permission_denied),
                Toast.LENGTH_SHORT
            ).show()
        }
    }

    fun toggleReminder(on: Boolean) {
        val needPermission = on && Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.POST_NOTIFICATIONS
            ) != PackageManager.PERMISSION_GRANTED
        if (needPermission) {
            permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            onSetReminder(on)
        }
    }

    Column(modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp)) {
        Text(
            text = stringResource(R.string.settings_title),
            style = MaterialTheme.typography.titleMedium,
            color = colors.ink
        )

        Spacer(Modifier.height(16.dp))
        Text(
            text = stringResource(R.string.settings_theme),
            style = MaterialTheme.typography.labelSmall,
            color = colors.faint
        )
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(
                stringResource(R.string.theme_system) to 0,
                stringResource(R.string.theme_dark) to 1,
                stringResource(R.string.theme_light) to 2
            ).forEach { (label, mode) ->
                val on = themeMode == mode
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(999.dp))
                        .then(
                            if (on) Modifier.background(Brush.horizontalGradient(colors.spectrum))
                            else Modifier.background(colors.glass)
                        )
                        .border(
                            1.dp,
                            if (on) Color.Transparent else colors.ruleStrong,
                            RoundedCornerShape(999.dp)
                        )
                        .clickable { onSetTheme(mode) }
                        .padding(vertical = 10.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = label,
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (on) Color(0xFF06101C) else colors.muted
                    )
                }
            }
        }

        Spacer(Modifier.height(18.dp))
        Text(
            text = stringResource(R.string.settings_language),
            style = MaterialTheme.typography.labelSmall,
            color = colors.faint
        )
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(Lang.ZH, Lang.ZH_TW, Lang.EN).forEach { code ->
                val on = lang == code
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(999.dp))
                        .then(
                            if (on) Modifier.background(Brush.horizontalGradient(colors.spectrum))
                            else Modifier.background(colors.glass)
                        )
                        .border(
                            1.dp,
                            if (on) Color.Transparent else colors.ruleStrong,
                            RoundedCornerShape(999.dp)
                        )
                        .clickable {
                            if (lang != code) {
                                onSetLang(code)
                                activity?.recreate()
                            }
                        }
                        .padding(vertical = 10.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = stringResource(Lang.labelRes(code)),
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (on) Color(0xFF06101C) else colors.muted
                    )
                }
            }
        }

        Spacer(Modifier.height(18.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = stringResource(R.string.settings_reminder),
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.ink
                )
                Spacer(Modifier.height(3.dp))
                Text(
                    text = stringResource(R.string.reminder_enable),
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.faint
                )
            }
            Switch(
                checked = reminderEnabled,
                onCheckedChange = { toggleReminder(it) },
                colors = androidx.compose.material3.SwitchDefaults.colors(
                    checkedThumbColor = Color(0xFF06101C),
                    checkedTrackColor = colors.accent,
                    uncheckedThumbColor = colors.faint,
                    uncheckedTrackColor = colors.glassStrong,
                    uncheckedBorderColor = colors.ruleStrong
                )
            )
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(30, 45, 60, 75).forEach { v ->
                val on = reminderThreshold == v
                Text(
                    text = v.toString() + "%",
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                    color = if (on) colors.ink else colors.faint,
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(if (on) colors.glassStrong else colors.glass)
                        .border(
                            1.dp,
                            if (on) colors.ruleStrong else colors.rule,
                            RoundedCornerShape(999.dp)
                        )
                        .clickable { onSetThreshold(v) }
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(
            text = stringResource(R.string.reminder_hint),
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
            color = colors.faint,
            lineHeight = 14.sp
        )

        Spacer(Modifier.height(18.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = stringResource(R.string.settings_samples),
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.ink
                )
                Spacer(Modifier.height(3.dp))
                Text(
                    text = stringResource(R.string.samples_hint),
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.faint
                )
            }
            Switch(
                checked = showSamples,
                onCheckedChange = onSetSamples,
                colors = androidx.compose.material3.SwitchDefaults.colors(
                    checkedThumbColor = Color(0xFF06101C),
                    checkedTrackColor = colors.accent,
                    uncheckedThumbColor = colors.faint,
                    uncheckedTrackColor = colors.glassStrong,
                    uncheckedBorderColor = colors.ruleStrong
                )
            )
        }

        Spacer(Modifier.height(18.dp))
        Box(Modifier.fillMaxWidth().height(1.dp).background(colors.rule))
        SettingsAction(stringResource(R.string.guide_title), onOpenGuide)
        SettingsAction(stringResource(R.string.settings_about), onOpenAbout)
        SettingsAction(stringResource(R.string.settings_feedback), onFeedback)
        SettingsAction(stringResource(R.string.settings_clear_cache), onClearCache)

        Spacer(Modifier.height(14.dp))
        Text(
            text = stringResource(R.string.about_version),
            style = MaterialTheme.typography.labelSmall,
            color = colors.faint
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = stringResource(R.string.about_data),
            style = MaterialTheme.typography.labelSmall,
            color = colors.faint,
            lineHeight = 15.sp
        )
    }
}

@Composable
private fun SettingsAction(title: String, onClick: () -> Unit) {
    val colors = SunglowTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.bodyMedium,
            color = colors.ink,
            modifier = Modifier.weight(1f)
        )
        ChevronRight(colors.faint, 14.dp)
    }
}

/* ---------- 使用教程（N4） ----------
 * 原生只放一页快速上手；完整四档三语教程走系统浏览器打开，
 * 与「不内嵌 WebView」的既有约束一致（下载页与外壳都不带浏览器内核）。
 */
@Composable
private fun GuideSheet() {
    val colors = SunglowTheme.colors
    val context = LocalContext.current
    val steps = listOf(
        stringResource(R.string.guide_step1),
        stringResource(R.string.guide_step2),
        stringResource(R.string.guide_step3)
    )
    Column(modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp)) {
        Text(
            text = stringResource(R.string.guide_title),
            style = MaterialTheme.typography.titleMedium,
            color = colors.ink
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = stringResource(R.string.guide_intro),
            style = MaterialTheme.typography.bodySmall,
            color = colors.muted
        )
        Spacer(Modifier.height(16.dp))
        steps.forEachIndexed { i, line ->
            Row(verticalAlignment = Alignment.Top) {
                Box(
                    modifier = Modifier
                        .size(22.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(colors.glassStrong)
                        .border(1.dp, colors.ruleStrong, RoundedCornerShape(999.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = (i + 1).toString(),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                        color = colors.accent
                    )
                }
                Spacer(Modifier.width(10.dp))
                Text(
                    text = line,
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp),
                    color = colors.ink,
                    lineHeight = 19.sp,
                    modifier = Modifier.weight(1f)
                )
            }
            Spacer(Modifier.height(12.dp))
        }

        Spacer(Modifier.height(6.dp))
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(999.dp))
                .background(Brush.horizontalGradient(colors.spectrum))
                .clickable {
                    runCatching {
                        context.startActivity(
                            Intent(
                                Intent.ACTION_VIEW,
                                android.net.Uri.parse(com.sunglow.spectrum.core.SHARE_SITE + "tutorial.html")
                            )
                        )
                    }.onFailure {
                        Toast.makeText(
                            context,
                            context.getString(R.string.share_failed),
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                }
                .padding(vertical = 12.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = stringResource(R.string.guide_open_web),
                style = MaterialTheme.typography.titleSmall,
                color = Color(0xFF06101C)
            )
        }
        Spacer(Modifier.height(10.dp))
        Text(
            text = stringResource(R.string.guide_note),
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
            color = colors.faint,
            lineHeight = 14.sp
        )
    }
}

@Composable
private fun AboutSheet(requestCount: Int = 0) {
    val colors = SunglowTheme.colors
    Column(modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp)) {
        Text(
            text = stringResource(R.string.about_title),
            style = MaterialTheme.typography.titleMedium,
            color = colors.ink
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = stringResource(R.string.about_version),
            style = MaterialTheme.typography.bodySmall,
            color = colors.muted
        )
        Spacer(Modifier.height(10.dp))
        Text(
            text = stringResource(R.string.about_data),
            style = MaterialTheme.typography.labelSmall,
            color = colors.faint,
            lineHeight = 16.sp
        )
        Spacer(Modifier.height(16.dp))
        Text(
            text = stringResource(R.string.about_privacy_title),
            style = MaterialTheme.typography.titleSmall,
            color = colors.ink
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = stringResource(R.string.privacy_body),
            style = MaterialTheme.typography.labelSmall,
            color = colors.muted,
            lineHeight = 18.sp
        )
        /* N3 增补 C：关于页挂出独立隐私政策 URL（商店与合规材料都要求可访问） */
        val context = LocalContext.current
        val privacyUrl = stringResource(R.string.privacy_url)
        Spacer(Modifier.height(8.dp))
        Text(
            text = privacyUrl,
            style = MaterialTheme.typography.labelSmall,
            color = colors.accentCool,
            modifier = Modifier
                .clickable {
                    runCatching {
                        context.startActivity(
                            Intent(Intent.ACTION_VIEW, android.net.Uri.parse(privacyUrl))
                        )
                    }
                }
                .padding(vertical = 8.dp)
        )
        Spacer(Modifier.height(16.dp))
        Text(
            text = stringResource(R.string.about_licenses),
            style = MaterialTheme.typography.labelSmall,
            color = colors.faint,
            lineHeight = 16.sp
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = stringResource(R.string.about_thanks),
            style = MaterialTheme.typography.labelSmall,
            color = colors.faint,
            lineHeight = 16.sp
        )
        /* N5：额度纪律可观测——真机验收「不取数」就看这个计数有没有涨 */
        Spacer(Modifier.height(10.dp))
        Text(
            text = stringResource(R.string.home_requests, requestCount),
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
            color = colors.faint,
            lineHeight = 14.sp
        )
    }
}

private fun Context.findActivity(): Activity? {
    var ctx: Context = this
    while (ctx is ContextWrapper) {
        if (ctx is Activity) return ctx
        ctx = ctx.baseContext
    }
    return null
}

@Composable
private fun SkeletonBar(modifier: Modifier, base: Color = Color.White) {
    val breath = rememberInfiniteTransition(label = "skeleton")
    val a by breath.animateFloat(
        initialValue = 0.26f,
        targetValue = 0.5f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "skeletonAlpha"
    )
    Box(
        modifier
            .clip(RoundedCornerShape(6.dp))
            .background(base.copy(alpha = a))
    )
}

/** 首屏骨架：与真实布局同构（结论句 + 模型卡），避免取数回来时整页跳变 */
@Composable
private fun PageSkeleton(colors: SunglowColors) {
    Column(Modifier.padding(horizontal = 18.dp, vertical = 12.dp)) {
        SkeletonBar(Modifier.fillMaxWidth().height(16.dp), colors.ruleStrong)
        Spacer(Modifier.height(8.dp))
        SkeletonBar(Modifier.fillMaxWidth(0.68f).height(16.dp), colors.ruleStrong)
        Spacer(Modifier.height(16.dp))
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(colors.card)
                .border(1.dp, colors.rule, RoundedCornerShape(14.dp))
                .padding(14.dp)
        ) {
            SkeletonBar(Modifier.fillMaxWidth(0.4f).height(13.dp), colors.rule)
            Spacer(Modifier.height(14.dp))
            repeat(3) {
                SkeletonBar(Modifier.fillMaxWidth().height(12.dp), colors.rule)
                Spacer(Modifier.height(10.dp))
            }
        }
        Spacer(Modifier.height(12.dp))
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(colors.card)
                .border(1.dp, colors.rule, RoundedCornerShape(14.dp))
                .padding(14.dp)
        ) {
            repeat(2) {
                SkeletonBar(Modifier.fillMaxWidth().height(12.dp), colors.rule)
                Spacer(Modifier.height(10.dp))
            }
        }
    }
}

/** 离线/更新失败提示条：不遮挡主结论，只说明数据新鲜度 */
@Composable
private fun NoticeStrip(text: String, action: String?, onAction: () -> Unit) {
    val colors = SunglowTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(colors.glass)
            .border(1.dp, colors.rule, RoundedCornerShape(999.dp))
            .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
            color = colors.muted,
            modifier = Modifier.weight(1f)
        )
        if (action != null) {
            Text(
                text = action,
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                color = colors.accentCool,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .clickable(onClick = onAction)
                    .padding(horizontal = 8.dp, vertical = 2.dp)
            )
        }
    }
}

private fun offlineTime(ms: Long): String =
    java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault())
        .format(java.util.Date(ms))

@Composable
private fun errorLabel(kind: String?): String = when (kind) {
    "NETWORK" -> stringResource(R.string.err_network)
    "TIMEOUT" -> stringResource(R.string.err_timeout)
    "RATE_LIMIT" -> stringResource(R.string.err_rate)
    "NO_DATA" -> stringResource(R.string.err_nodata)
    else -> stringResource(R.string.err_update)
}

/* ---------- 状态卡 ---------- */

@Composable
private fun StatusCard(error: String?, kind: String?, onRetry: () -> Unit, needsFetch: Boolean = false) {
    val colors = SunglowTheme.colors
    /* N5：切日期后没有新鲜缓存时按纪律不自动取数，这里明确告诉用户可以点更新 */
    val title = if (needsFetch) stringResource(R.string.err_title_day_none) else when (kind) {
        "NETWORK" -> stringResource(R.string.err_network)
        "TIMEOUT" -> stringResource(R.string.err_timeout)
        "RATE_LIMIT" -> stringResource(R.string.err_rate)
        "NO_DATA" -> stringResource(R.string.err_title_nodata)
        else -> if (error != null) stringResource(R.string.err_title_fail) else stringResource(R.string.err_nodata)
    }
    val action = if (needsFetch) stringResource(R.string.err_action_update) else when (kind) {
        "NETWORK" -> stringResource(R.string.err_action_network)
        "TIMEOUT" -> stringResource(R.string.err_action_timeout)
        "RATE_LIMIT" -> stringResource(R.string.err_action_rate)
        "NO_DATA" -> stringResource(R.string.err_action_nodata)
        else -> stringResource(R.string.err_action_recalc)
    }
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
            text = title,
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
            text = action,
            style = MaterialTheme.typography.bodyMedium,
            color = colors.accentCool,
            modifier = Modifier
                .clip(RoundedCornerShape(999.dp))
                .clickable(onClick = onRetry)
                .padding(horizontal = 8.dp, vertical = 4.dp)
        )
    }
}

/* ---------- 工具 ---------- */

@Composable
private fun verdictSentence(view: VerdictView): String = when {
    view.p >= 60 -> stringResource(R.string.verdict_1)
    view.p >= 35 -> stringResource(R.string.verdict_2)
    view.p >= 15 -> stringResource(R.string.verdict_3)
    else -> stringResource(R.string.verdict_4)
}

@Composable
private fun gradeLabel(grade: String): String = when (grade) {
    com.sunglow.spectrum.core.GRADE_YOU -> stringResource(R.string.grade_you)
    com.sunglow.spectrum.core.GRADE_LIANG -> stringResource(R.string.grade_liang)
    com.sunglow.spectrum.core.GRADE_YIBAN -> stringResource(R.string.grade_yiban)
    com.sunglow.spectrum.core.GRADE_CHA -> stringResource(R.string.grade_cha)
    else -> grade
}

@Composable
private fun confLabel(key: String): String = when (key) {
    "hi" -> stringResource(R.string.conf_high)
    "lo" -> stringResource(R.string.conf_low)
    else -> stringResource(R.string.conf_mid)
}

@Composable
private fun cloudTypeLabel(type: String): String = when (type) {
    com.sunglow.spectrum.core.DECK_ST_FOG -> stringResource(R.string.cloud_st_fog)
    com.sunglow.spectrum.core.DECK_SC -> stringResource(R.string.cloud_sc)
    com.sunglow.spectrum.core.DECK_CU -> stringResource(R.string.cloud_cu)
    com.sunglow.spectrum.core.DECK_AC -> stringResource(R.string.cloud_ac)
    com.sunglow.spectrum.core.DECK_AS -> stringResource(R.string.cloud_as)
    com.sunglow.spectrum.core.DECK_CS -> stringResource(R.string.cloud_cs)
    com.sunglow.spectrum.core.DECK_CI -> stringResource(R.string.cloud_ci)
    else -> type
}

@Composable
private fun brightLabel(score: Double): String = when {
    score >= 100.0 -> stringResource(R.string.bright_2)
    score >= 90.0 -> stringResource(R.string.bright_3)
    score >= 72.0 -> stringResource(R.string.bright_1)
    score >= 58.0 -> stringResource(R.string.bright_4)
    score >= 28.0 -> stringResource(R.string.bright_5)
    score >= 8.0 -> stringResource(R.string.bright_6)
    else -> stringResource(R.string.bright_7)
}

@Composable
private fun colorLabel(key: String): String = when (key) {
    "hazy" -> stringResource(R.string.color_hazy)
    "dull" -> stringResource(R.string.color_dull)
    "deepRed" -> stringResource(R.string.color_deepRed)
    "red" -> stringResource(R.string.color_red)
    "orangeRed" -> stringResource(R.string.color_orangeRed)
    "orange" -> stringResource(R.string.color_orange)
    "golden" -> stringResource(R.string.color_golden)
    "paleYellow" -> stringResource(R.string.color_paleYellow)
    "pinkPurple" -> stringResource(R.string.color_pinkPurple)
    else -> stringResource(R.string.color_yellowGreen)
}

@Composable
private fun factorName(key: String): String = stringResource(
    when (key) {
        "cover" -> R.string.factor_name_cover
        "base" -> R.string.factor_name_base
        "heq" -> R.string.factor_name_heq
        "heff" -> R.string.factor_name_heff
        "dedge" -> R.string.factor_name_dedge
        "block" -> R.string.factor_name_block
        "aod" -> R.string.factor_name_aod
        "vis" -> R.string.factor_name_vis
        "rh" -> R.string.factor_name_rh
        "stab" -> R.string.factor_name_stab
        "wind" -> R.string.factor_name_wind
        "cape" -> R.string.factor_name_cape
        else -> R.string.factor_name_consist
    }
)

@Composable
private fun factorDesc(key: String): String = stringResource(
    when (key) {
        "cover" -> R.string.factor_desc_cover
        "base" -> R.string.factor_desc_base
        "heq" -> R.string.factor_desc_heq
        "heff" -> R.string.factor_desc_heff
        "dedge" -> R.string.factor_desc_dedge
        "block" -> R.string.factor_desc_block
        "aod" -> R.string.factor_desc_aod
        "vis" -> R.string.factor_desc_vis
        "rh" -> R.string.factor_desc_rh
        "stab" -> R.string.factor_desc_stab
        "wind" -> R.string.factor_desc_wind
        "cape" -> R.string.factor_desc_cape
        else -> R.string.factor_desc_consist
    }
)

@Composable
private fun judgeLabel(cls: String): String = stringResource(
    when (cls) {
        "ok" -> R.string.judge_ok
        "mid" -> R.string.judge_mid
        "bad" -> R.string.judge_bad
        else -> R.string.judge_miss
    }
)

@Composable
private fun factorValue(row: com.sunglow.spectrum.core.FacDisplayRow): String {
    val id = when (row.valueKey) {
        "factor_value_cover" -> R.string.factor_value_cover
        "factor_value_dedge" -> R.string.factor_value_dedge
        "factor_value_dedge_none" -> R.string.factor_value_dedge_none
        "factor_value_consist" -> R.string.factor_value_consist
        "factor_value_consist_none" -> R.string.factor_value_consist_none
        "factor_value_cape" -> R.string.factor_value_cape
        "factor_value_cape_only" -> R.string.factor_value_cape_only
        else -> null
    } ?: return row.value
    return stringResource(id, *row.valueArgs.toTypedArray())
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
