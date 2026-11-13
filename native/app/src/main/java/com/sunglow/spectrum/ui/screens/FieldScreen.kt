package com.sunglow.spectrum.ui.screens

import android.view.MotionEvent
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.OnlineTileSourceBase
import org.osmdroid.util.GeoPoint
import org.osmdroid.util.MapTileIndex
import org.osmdroid.views.MapView
import com.sunglow.spectrum.R
import com.sunglow.spectrum.core.City
import com.sunglow.spectrum.core.DEG
import com.sunglow.spectrum.core.ForecastResult
import com.sunglow.spectrum.core.HeatCell
import com.sunglow.spectrum.core.FieldPt
import com.sunglow.spectrum.core.FieldSampler
import com.sunglow.spectrum.core.OCC_BAND_A
import com.sunglow.spectrum.core.OCC_MIN_V
import com.sunglow.spectrum.core.OCC_RGB
import com.sunglow.spectrum.core.OCC_BAND_NAMES
import com.sunglow.spectrum.core.occBandOf
import com.sunglow.spectrum.core.fieldConfOf
import com.sunglow.spectrum.core.HeatGrid
import com.sunglow.spectrum.core.HEAT_RADIUS_KM
import com.sunglow.spectrum.core.fadeOf
import com.sunglow.spectrum.core.fieldRampColor
import com.sunglow.spectrum.core.Period
import com.sunglow.spectrum.core.RAD
import com.sunglow.spectrum.core.TransectPt
import com.sunglow.spectrum.core.cloudBlockOf
import com.sunglow.spectrum.core.dirWordOf
import com.sunglow.spectrum.core.fmtDur
import com.sunglow.spectrum.core.haversineKm
import com.sunglow.spectrum.core.isNum
import com.sunglow.spectrum.core.transectPoints
import com.sunglow.spectrum.core.uAlt
import com.sunglow.spectrum.core.uDist
import com.sunglow.spectrum.ui.HomeUiState
import com.sunglow.spectrum.ui.HomeViewModel
import com.sunglow.spectrum.ui.theme.SunglowColors
import com.sunglow.spectrum.ui.theme.SunglowTheme
import java.util.Locale
import kotlin.math.log2
import kotlin.math.roundToInt

/*
 * 观测场：地图（osmdroid 原生底图，可拖拽缩放）+ 光路剖面。
 */

@Composable
fun FieldScreen(vm: HomeViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val colors = SunglowTheme.colors
    val result = state.result
    var showMap by remember(state.city.name) { mutableStateOf(true) }
    /* 遮挡层默认关闭（与网页一致）：它是背景信息，要查细节再自己打开 */
    var showOcclusion by remember(state.city.name) { mutableStateOf(false) }
    /* 城市名命中：点自绘地名弹城市卡，换城市要用户显式点，不自动取数 */
    var pickedCity by remember(state.city.name) { mutableStateOf<City?>(null) }
    /* 地图上要标注的邻近城市：按当前城市取最近 12 个（486 城排序一次即可） */
    val labelCities = remember(state.city.name) { vm.nearby(12).map { it.first } }

    /* 进入观测场才生成热力面：6 个请求 + 121 点计算，结果缓存在 ViewModel 里 */
    LaunchedEffect(state.city.name, state.dateStr, state.period, result) {
        if (result != null) vm.loadHeat()
    }

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
                    text = stringResource(R.string.field_title),
                    style = MaterialTheme.typography.headlineSmall.copy(fontSize = 20.sp),
                    color = colors.ink
                )
                Spacer(Modifier.weight(1f))
                Text(
                    text = state.city.name + " · " + stringResource(
                        if (state.period == Period.AM) R.string.widget_am else R.string.widget_pm
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.faint
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(
                text = stringResource(R.string.field_subtitle),
                style = MaterialTheme.typography.labelSmall,
                color = colors.faint
            )
        }

        if (result == null) {
            Text(
                text = if (state.loading) stringResource(R.string.field_loading)
                else stringResource(R.string.field_no_data),
                style = MaterialTheme.typography.bodyMedium,
                color = colors.muted,
                modifier = Modifier.padding(18.dp)
            )
            return@Column
        }

        if (showMap) {
            OsmMap(
                state,
                result,
                showOcclusion = showOcclusion,
                lang = state.lang,
                nearbyCities = labelCities,
                onPickCity = { pickedCity = it },
                modifier = Modifier.padding(horizontal = 18.dp)
            )
        } else {
            RayProfile(result)
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.End
        ) {
            Text(
                text = if (showMap) stringResource(R.string.field_to_ray)
                else stringResource(R.string.field_to_map),
                style = MaterialTheme.typography.labelSmall,
                color = colors.accentCool,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .clickable { showMap = !showMap }
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            )
            Spacer(Modifier.width(10.dp))
            Text(
                text = if (showOcclusion) stringResource(R.string.field_occlusion_on)
                else stringResource(R.string.field_occlusion_off),
                style = MaterialTheme.typography.labelSmall,
                color = if (showOcclusion) colors.accent else colors.faint,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .border(1.dp, colors.ruleStrong, RoundedCornerShape(999.dp))
                    .clickable { showOcclusion = !showOcclusion }
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            )
        }

        /* 城市名命中卡片：只显示与提供显式动作，绝不因为点一下就取数 */
        pickedCity?.let { c ->
            val km = haversineKm(state.city.lat, state.city.lon, c.lat, c.lon)
            Column(Modifier.padding(horizontal = 18.dp, vertical = 8.dp)) {
                Panel {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = c.labelOf(state.lang),
                            style = MaterialTheme.typography.titleSmall,
                            color = colors.ink
                        )
                        Spacer(Modifier.weight(1f))
                        Text(
                            text = stringResource(R.string.common_close),
                            style = MaterialTheme.typography.labelSmall,
                            color = colors.accentCool,
                            modifier = Modifier
                                .clip(RoundedCornerShape(999.dp))
                                .clickable { pickedCity = null }
                                .padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                    InfoRow(stringResource(R.string.field_dist_city), uDist(km))
                    InfoRow(stringResource(R.string.field_region), if (c.region.isBlank()) "—" else c.region)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = stringResource(R.string.field_view_city),
                        style = MaterialTheme.typography.labelSmall,
                        color = colors.accentCool,
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .border(1.dp, colors.ruleStrong, RoundedCornerShape(999.dp))
                            .clickable {
                                pickedCity = null
                                vm.selectCity(c)
                            }
                            .padding(horizontal = 12.dp, vertical = 6.dp)
                    )
                }
            }
        }

        Column(Modifier.padding(horizontal = 18.dp, vertical = 12.dp)) {
            Text(
                text = stringResource(R.string.field_canvas),
                style = MaterialTheme.typography.titleSmall,
                color = colors.ink
            )
            Spacer(Modifier.height(8.dp))
            Panel {
                InfoRow(
                    stringResource(R.string.field_main_deck),
                    cloudLevelLabel(result.sRT.primary.nameZh) + " · " + cloudTypeLabel(result.sRT.primary.type)
                )
                InfoRow(stringResource(R.string.field_cover), result.sRT.primary.cover.roundToInt().toString() + "%")
                InfoRow(stringResource(R.string.field_base), uAlt(result.sRT.primary.base * 1000))
                InfoRow(stringResource(R.string.field_edge), uDist(result.sRT.d))
                InfoRow(stringResource(R.string.field_xmax), uDist(result.sRT.geom.xMax))
                InfoRow(stringResource(R.string.field_duration), fmtDur(result.sRT.geom.dur))
                InfoRow(stringResource(R.string.field_heq), uAlt(result.sRT.heq * 1000))
            }

            Spacer(Modifier.height(12.dp))
            Text(
                text = stringResource(R.string.field_geometry),
                style = MaterialTheme.typography.titleSmall,
                color = colors.ink
            )
            Spacer(Modifier.height(8.dp))
            Panel {
                Text(
                    text = if (result.sRT.geom.ok) {
                        stringResource(R.string.field_geom_ok)
                    } else if (isNum(result.sRT.d)) {
                        stringResource(R.string.field_geom_edge, uDist(result.sRT.d), uDist(result.sRT.geom.xMax))
                    } else {
                        stringResource(R.string.field_geom_nocloud)
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = if (result.sRT.geom.ok) colors.good else colors.bad,
                    lineHeight = 18.sp
                )
            }

            Spacer(Modifier.height(12.dp))
            Text(
                text = stringResource(R.string.field_compare),
                style = MaterialTheme.typography.titleSmall,
                color = colors.ink
            )
            Spacer(Modifier.height(8.dp))
            ComparePanel(state, onClear = vm::clearCompare)

            Spacer(Modifier.height(12.dp))
            Text(
                text = stringResource(R.string.field_nearby),
                style = MaterialTheme.typography.titleSmall,
                color = colors.ink
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = stringResource(R.string.field_nearby_hint),
                style = MaterialTheme.typography.labelSmall,
                color = colors.faint
            )
            Spacer(Modifier.height(8.dp))
            NearbyPanel(state, onToggle = vm::toggleCompare, nearby = vm.nearby(8))
            Spacer(Modifier.height(10.dp))
            CompareAddPanel(
                search = vm::searchCities,
                onToggle = vm::toggleCompare,
                onAddPoint = vm::addCustomPoint,
                selected = state.compareCities.map { it.name }.toSet(),
                full = state.compareCities.size >= 4
            )

            Spacer(Modifier.height(12.dp))
            Text(
                text = stringResource(R.string.field_calib),
                style = MaterialTheme.typography.titleSmall,
                color = colors.ink
            )
            Spacer(Modifier.height(8.dp))
            CalibPanel(state, onRecord = vm::recordSighting)

            Spacer(Modifier.height(12.dp))
            Text(
                text = stringResource(R.string.common_note),
                style = MaterialTheme.typography.titleSmall,
                color = colors.ink
            )
            Spacer(Modifier.height(8.dp))
            Panel {
                Text(
                    text = stringResource(R.string.field_help),
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
                text = stringResource(R.string.field_sun_az),
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
                text = stringResource(R.string.field_edge_xmax, uDist(d), uDist(xMax)),
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
                text = stringResource(R.string.field_layer_city),
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.5.sp),
                color = colors.faint
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = stringResource(R.string.field_layer_cloud),
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.5.sp),
                color = colors.accent
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = stringResource(R.string.field_layer_sun),
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.5.sp),
                color = Color(0xFFFFC773)
            )
        }
    }
}

/* ---------- 地图（osmdroid 原生 View，无需任何 key） ---------- */

/**
 * 高德公开栅格瓦片。瓦片本身是 GCJ-02 网格，中心点与标记要做 WGS-84 → GCJ-02 纠偏，
 * 否则放大后会有几百米偏移。无需 key，国内网络可直连。
 */
private class AmapTileSource(
    name: String,
    base: String,
    maxZoom: Int
) : OnlineTileSourceBase(name, 3, maxZoom, 256, "", arrayOf(base), "© AMap") {
    override fun getTileURLString(pMapTileIndex: Long): String =
        baseUrl +
            "x=" + MapTileIndex.getX(pMapTileIndex) +
            "&y=" + MapTileIndex.getY(pMapTileIndex) +
            "&z=" + MapTileIndex.getZoom(pMapTileIndex)
}

/** WGS-84 → GCJ-02，仅用于高德底图上的定位显示 */
private fun wgsToGcj(lat: Double, lon: Double): Pair<Double, Double> {
    if (lon < 72.0 || lon > 138.0 || lat < 0.0 || lat > 56.0) return lat to lon
    val a = 6378245.0
    val ee = 0.00669342162296594323
    fun tLat(x: Double, y: Double): Double {
        var r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
        r += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0
        r += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0
        r += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0
        return r
    }
    fun tLon(x: Double, y: Double): Double {
        var r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
        r += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0
        r += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0
        r += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0
        return r
    }
    val dLat = tLat(lon - 105.0, lat - 35.0)
    val dLon = tLon(lon - 105.0, lat - 35.0)
    val radLat = lat / 180.0 * Math.PI
    val magic = 1 - ee * Math.sin(radLat) * Math.sin(radLat)
    val sqrtMagic = Math.sqrt(magic)
    val la = lat + (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI)
    val lo = lon + (dLon * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI)
    return la to lo
}

/** 地图实例上的非状态字段：避免在地图回调里写 Compose 状态引起重组 */
private class MapHolder {
    var lastKey: String = ""
    var overlay: TransectOverlay? = null
    var heatOverlay: HeatOverlay? = null
    var labelOverlay: CityLabelOverlay? = null
    var graticule: GraticuleOverlay? = null
}

/**
 * N3b · 自绘地名层
 * ---------------------------------------------------------------------------
 * 简体底图自带中文地名，所以简体界面不画（避免与底图叠字）；
 * 英文 / 繁体界面底图没有对应字，才由这里自绘。
 * 标签只做视觉与命中：点中只弹城市卡，**绝不自动取数**——换城市必须由用户显式点。
 */
private class CityLabelOverlay(
    private val lang: String,
    private val onPickCity: (City) -> Unit
) : org.osmdroid.views.overlay.Overlay() {
    var cities: List<City> = emptyList()

    private val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    private val pt = android.graphics.Point()

    private data class Label(val city: City, val x: Float, val y: Float, val w: Float)

    private var labels: List<Label> = emptyList()

    override fun draw(c: android.graphics.Canvas, mapView: MapView, shadow: Boolean) {
        if (shadow) return
        if (lang == "zh" || cities.isEmpty()) {
            labels = emptyList()
            return
        }
        val proj = mapView.projection
        val out = ArrayList<Label>()
        for (city in cities) {
            val g = wgsToGcj(city.lat, city.lon)
            proj.toPixels(GeoPoint(g.first, g.second), pt)
            val text = city.labelOf(lang)
            p.reset()
            p.isAntiAlias = true
            p.textSize = 30f
            p.typeface = android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD)
            val w = p.measureText(text)
            /* 简单避让：与已放下的标签太近就跳过这一条，宁可少画也不要叠字 */
            val clash = out.any { l ->
                kotlin.math.abs(l.x - pt.x) < (l.w + w) / 2f + 16f && kotlin.math.abs(l.y - pt.y) < 40f
            }
            if (clash) continue
            out.add(Label(city, pt.x.toFloat(), pt.y.toFloat(), w))
            val x = pt.x - w / 2f
            val y = pt.y - 12f
            p.style = android.graphics.Paint.Style.STROKE
            p.strokeWidth = 4f
            p.color = 0xB3000000.toInt()
            c.drawText(text, x, y, p)
            p.style = android.graphics.Paint.Style.FILL
            p.color = 0xFFFFFFFF.toInt()
            c.drawText(text, x, y, p)
        }
        labels = out
    }

    override fun onSingleTapConfirmed(e: MotionEvent, mapView: MapView): Boolean {
        for (l in labels) {
            val dx = e.x - l.x
            val dy = e.y - (l.y - 12f)
            if (kotlin.math.abs(dx) <= l.w / 2f + 12f && kotlin.math.abs(dy) <= 22f) {
                onPickCity(l.city)
                return true
            }
        }
        return false
    }
}

/** 样带上的一个采样点（坐标已转 GCJ-02） */
private data class SampleDot(val gp: GeoPoint, val cov: Float, val km: Double)

/** 画在底图上的样带：折线 + 热力点 + 点选 */
private class TransectOverlay(
    private val colorFor: (Float) -> Int,
    private val onPick: (Int) -> Unit,
    private val dotRadius: Float,
    private val strokeWidth: Float
) : org.osmdroid.views.overlay.Overlay() {
    var dots: List<SampleDot> = emptyList()
    var selected: Int = -1

    private val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    private val path = android.graphics.Path()
    private val pt = android.graphics.Point()
    private val xy = ArrayList<Float>()

    override fun draw(c: android.graphics.Canvas, mapView: MapView, shadow: Boolean) {
        if (shadow || dots.isEmpty()) return
        val proj = mapView.projection
        xy.clear()
        for (d in dots) {
            proj.toPixels(d.gp, pt)
            xy.add(pt.x.toFloat())
            xy.add(pt.y.toFloat())
        }

        /* 光路折线 */
        path.reset()
        path.moveTo(xy[0], xy[1])
        for (i in 1 until dots.size) path.lineTo(xy[i * 2], xy[i * 2 + 1])
        p.reset()
        p.isAntiAlias = true
        p.style = android.graphics.Paint.Style.STROKE
        p.strokeWidth = strokeWidth
        p.color = 0x661FD3E6
        c.drawPath(path, p)

        /* 热力点：半径与颜色都随主云层云量走 */
        for (i in dots.indices) {
            val cx = xy[i * 2]
            val cy = xy[i * 2 + 1]
            val r = dotRadius * (0.6f + 0.6f * dots[i].cov)
            p.style = android.graphics.Paint.Style.FILL
            p.color = colorFor(dots[i].cov)
            p.alpha = 235
            c.drawCircle(cx, cy, r, p)
            p.alpha = 255

            if (i == 0) {
                p.style = android.graphics.Paint.Style.STROKE
                p.strokeWidth = strokeWidth * 1.2f
                p.color = 0xFFFFFFFF.toInt()
                c.drawCircle(cx, cy, r + strokeWidth * 2f, p)
                p.style = android.graphics.Paint.Style.FILL
                p.color = 0xFFFFFFFF.toInt()
                c.drawCircle(cx, cy, r * 0.42f, p)
            }
            if (i == selected) {
                p.style = android.graphics.Paint.Style.STROKE
                p.strokeWidth = strokeWidth * 1.6f
                p.color = 0xFFFFFFFF.toInt()
                c.drawCircle(cx, cy, r + strokeWidth * 2.4f, p)
            }
        }
    }

    override fun onSingleTapConfirmed(e: MotionEvent, mapView: MapView): Boolean {
        if (dots.isEmpty()) return false
        val proj = mapView.projection
        var best = -1
        var bestD = Float.MAX_VALUE
        val lim = dotRadius * 2.6f
        for (i in dots.indices) {
            proj.toPixels(dots[i].gp, pt)
            val dx = pt.x - e.x
            val dy = pt.y - e.y
            val d = dx * dx + dy * dy
            if (d <= lim * lim && d < bestD) {
                bestD = d
                best = i
            }
        }
        if (best >= 0) {
            onPick(best)
            return true
        }
        return false
    }
}

/** 0–100 → 8 锚点全光谱色（与网页 ramp.ts 同尺，低值不归零） */
private fun rampColor(t: Float, colors: SunglowColors): Color {
    val hex = fieldRampColor(t.coerceIn(0f, 1f).toDouble() * 100.0)
    return Color(android.graphics.Color.parseColor(hex))
}

/** 降饱和：按可信度把颜色往灰里拉（不改变色相与明度层级） */
private fun desat(rgb: Int, conf: Double): Int {
    val k = (1.0 - conf).coerceIn(0.0, 1.0)
    if (k <= 0.001) return rgb
    val r = android.graphics.Color.red(rgb)
    val g = android.graphics.Color.green(rgb)
    val b = android.graphics.Color.blue(rgb)
    val lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    fun mix(c: Int): Int = Math.round(c + (lum - c) * k).toInt().coerceIn(0, 255)
    return android.graphics.Color.rgb(mix(r), mix(g), mix(b))
}

/** 把颜色按比例混到目标 RGB（遮挡层用） */
private fun blendTo(rgb: Int, target: List<Int>, k: Double): Int {
    val f = k.coerceIn(0.0, 1.0)
    fun mix(c: Int, t: Int): Int = Math.round(c + (t - c) * f).toInt().coerceIn(0, 255)
    return android.graphics.Color.rgb(
        mix(android.graphics.Color.red(rgb), target[0]),
        mix(android.graphics.Color.green(rgb), target[1]),
        mix(android.graphics.Color.blue(rgb), target[2])
    )
}

/** 观测场四维口径：与网页 MapDim（mix/p/q/dv）一致 */
private enum class FieldDim(val labelRes: Int, val hintRes: Int, val shortRes: Int) {
    MIX(R.string.field_dim_mix, R.string.field_dim_mix_hint, R.string.field_dim_mix_short),
    P(R.string.field_dim_p, R.string.field_dim_p_hint, R.string.field_dim_p_short),
    Q(R.string.field_dim_q, R.string.field_dim_q_hint, R.string.field_dim_q_short),
    DV(R.string.field_dim_dv, R.string.field_dim_dv_hint, R.string.field_dim_dv_short)
}

private fun HeatCell.dimValue(dim: FieldDim): Double = when (dim) {
    FieldDim.MIX -> idx
    FieldDim.P -> p
    FieldDim.Q -> q
    FieldDim.DV -> refGap
}

/**
 * N3：把网格点用自适应核 Shepard 升采样成 48×48 色面，再按 fadeOf 淡出。
 * 不再是「一个格点一个色块」；没有凸包/可达距离硬裁切，边界落在 alpha=0 处。
 * 48×48 是手机端的性能折中（约 2300 次插值，remember 内只算一次）。
 */
private fun heatBitmap(
    grid: HeatGrid,
    colors: SunglowColors,
    showOcclusion: Boolean = false,
    dim: FieldDim = FieldDim.MIX
): android.graphics.Bitmap {
    val res = 48
    val bmp = android.graphics.Bitmap.createBitmap(res, res, android.graphics.Bitmap.Config.ARGB_8888)
    /* 采样点带上遮挡 occ 与形态分歧 refGap：前者画遮挡层，后者驱动降饱和；
       分歧维度本身的值就是 refGap，不再二次降饱和 */
    val sampler = FieldSampler(
        grid.cells.map {
            FieldPt(
                it.lat,
                it.lon,
                it.dimValue(dim),
                it.occ,
                if (dim == FieldDim.DV) 0.0 else it.refGap
            )
        }
    )
    val px = IntArray(res * res)
    val latTop = grid.latOf(0)
    val latBottom = grid.latOf(grid.n - 1)
    val lonLeft = grid.lonOf(0)
    val lonRight = grid.lonOf(grid.n - 1)
    /* 网页按 500 km 半径裁成圆：包围盒四角没有格点，这里同样不涂色 */
    val cLat = grid.latOf(grid.n / 2)
    val cLon = grid.lonOf(grid.n / 2)
    for (r in 0 until res) {
        val lat = latTop + (latBottom - latTop) * r / (res - 1)
        for (c in 0 until res) {
            val lon = lonLeft + (lonRight - lonLeft) * c / (res - 1)
            if (haversineKm(cLat, cLon, lat, lon) > HEAT_RADIUS_KM + 8.0) continue
            val s = sampler.at(lat, lon)
            val v = s.v ?: continue
            val fade = fadeOf(s.near)
            if (fade <= 0.0) continue
            var rgb = android.graphics.Color.parseColor(fieldRampColor(v))
            /* 可信度只降饱和：分歧越大越虚，色相与明度保留（网页同口径） */
            rgb = desat(rgb, fieldConfOf(s.gap))
            /* 遮挡层默认关闭；打开后按四档 alpha 叠一层暗色 */
            if (showOcclusion) {
                val oc = s.occ
                if (oc != null && v >= OCC_MIN_V) {
                    val bandA = OCC_BAND_A[occBandOf(oc)]
                    if (bandA > 0) rgb = blendTo(rgb, OCC_RGB, bandA * minOf(1.0, fade * 1.4) * 0.85)
                }
            }
            val a = (fade * 200.0).toInt().coerceIn(0, 255)
            px[r * res + c] = (a shl 24) or (rgb and 0x00FFFFFF)
        }
    }
    bmp.setPixels(px, 0, res, 0, 0, res, res)
    return bmp
}

/**
 * 热力面覆盖层：把整幅位图贴到「北西角 → 南东角」的投影矩形上，并接管任意点选。
 * 底图是 GCJ-02 网格，四角先做纠偏再投影，否则放大后有偏移。
 */
private class HeatOverlay(
    private val onPick: (Int, Int) -> Unit
) : org.osmdroid.views.overlay.Overlay() {
    var bitmap: android.graphics.Bitmap? = null
    var grid: HeatGrid? = null
    var selected: HeatCell? = null
    var dim: FieldDim = FieldDim.MIX
    var showValues: Boolean = false

    private val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    private val tp = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    private val pt = android.graphics.Point()
    private val pt2 = android.graphics.Point()
    private val dst = android.graphics.Rect()

    private fun rectOf(mapView: MapView, g: HeatGrid): Boolean {
        val nw = wgsToGcj(g.lat0 + g.dLat / 2, g.lon0 - g.dLon / 2)
        val se = wgsToGcj(
            g.lat0 - (g.n - 1) * g.dLat - g.dLat / 2,
            g.lon0 + (g.n - 1) * g.dLon + g.dLon / 2
        )
        val proj = mapView.projection
        proj.toPixels(GeoPoint(nw.first, nw.second), pt)
        proj.toPixels(GeoPoint(se.first, se.second), pt2)
        dst.set(pt.x, pt.y, pt2.x, pt2.y)
        return dst.width() > 4 && dst.height() > 4
    }

    override fun draw(c: android.graphics.Canvas, mapView: MapView, shadow: Boolean) {
        if (shadow) return
        val bmp = bitmap ?: return
        val g = grid ?: return
        if (!rectOf(mapView, g)) return
        p.reset()
        p.isFilterBitmap = true
        p.alpha = 190
        c.drawBitmap(bmp, null, dst, p)

        /* 数值直标：隔点取样，避免 121 个数字糊成一片；白字黑晕保证深浅底图都能读 */
        if (showValues) {
            tp.textSize = 9.5f * mapView.resources.displayMetrics.density
            tp.textAlign = android.graphics.Paint.Align.CENTER
            tp.color = 0xFFFFFFFF.toInt()
            tp.setShadowLayer(3f, 0f, 1f, 0xE6000000.toInt())
            for (cell in g.cells) {
                if ((cell.i + cell.j) % 2 != 0) continue
                val cx = dst.left + (cell.j + 0.5f) / g.n * dst.width()
                val cy = dst.top + (cell.i + 0.5f) / g.n * dst.height() + tp.textSize / 3f
                c.drawText(cell.dimValue(dim).roundToInt().toString(), cx, cy, tp)
            }
        }

        selected?.let { cell ->
            val cx = dst.left + (cell.j + 0.5f) / g.n * dst.width()
            val cy = dst.top + (cell.i + 0.5f) / g.n * dst.height()
            p.reset()
            p.isAntiAlias = true
            p.style = android.graphics.Paint.Style.STROKE
            p.strokeWidth = 3f
            p.color = 0xFFFFFFFF.toInt()
            c.drawCircle(cx, cy, 11f, p)
            p.style = android.graphics.Paint.Style.FILL
            p.color = 0xFFFFFFFF.toInt()
            c.drawCircle(cx, cy, 4f, p)
        }
    }

    override fun onSingleTapConfirmed(e: MotionEvent, mapView: MapView): Boolean {
        val g = grid ?: return false
        if (bitmap == null) return false
        if (!rectOf(mapView, g)) return false
        if (!dst.contains(e.x.toInt(), e.y.toInt())) return false
        val fx = ((e.x - dst.left) / dst.width()).coerceIn(0f, 0.9999f)
        val fy = ((e.y - dst.top) / dst.height()).coerceIn(0f, 0.9999f)
        onPick((fy * g.n).toInt(), (fx * g.n).toInt())
        return true
    }
}

/**
 * 经纬网图层：每 2° 一条，先画 3px 白色光晕再压 1px 深色芯线，
 * 与网页 drawGraticule 的两层画法一致（深浅底图都能看清）。
 */
private class GraticuleOverlay : org.osmdroid.views.overlay.Overlay() {
    private val halo = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    private val core = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    private val a = android.graphics.Point()
    private val b = android.graphics.Point()

    override fun draw(c: android.graphics.Canvas, mapView: MapView, shadow: Boolean) {
        if (shadow) return
        val bb = mapView.boundingBox ?: return
        halo.style = android.graphics.Paint.Style.STROKE
        halo.strokeWidth = 3f
        halo.color = 0x8CFFFFFF.toInt()
        core.style = android.graphics.Paint.Style.STROKE
        core.strokeWidth = 1f
        core.color = 0x9E1E2A40.toInt()
        val proj = mapView.projection
        val step = 2.0

        var lat = kotlin.math.ceil(bb.latSouth / step) * step
        while (lat <= bb.latNorth) {
            proj.toPixels(GeoPoint(lat, bb.lonWest), a)
            proj.toPixels(GeoPoint(lat, bb.lonEast), b)
            c.drawLine(a.x.toFloat(), a.y.toFloat(), b.x.toFloat(), b.y.toFloat(), halo)
            c.drawLine(a.x.toFloat(), a.y.toFloat(), b.x.toFloat(), b.y.toFloat(), core)
            lat += step
        }
        var lon = kotlin.math.ceil(bb.lonWest / step) * step
        while (lon <= bb.lonEast) {
            proj.toPixels(GeoPoint(bb.latSouth, lon), a)
            proj.toPixels(GeoPoint(bb.latNorth, lon), b)
            c.drawLine(a.x.toFloat(), a.y.toFloat(), b.x.toFloat(), b.y.toFloat(), halo)
            c.drawLine(a.x.toFloat(), a.y.toFloat(), b.x.toFloat(), b.y.toFloat(), core)
            lon += step
        }
    }
}

@Composable
private fun OsmMap(
    state: HomeUiState,
    result: ForecastResult,
    showOcclusion: Boolean = false,
    lang: String = "zh",
    nearbyCities: List<City> = emptyList(),
    onPickCity: (City) -> Unit = {},
    modifier: Modifier = Modifier
) {
    val colors = SunglowTheme.colors
    val density = LocalDensity.current
    val city = state.city
    val streetLabel = stringResource(R.string.map_street)
    val satelliteLabel = stringResource(R.string.map_satellite)
    val sources = remember(streetLabel, satelliteLabel) {
        listOf(
            streetLabel to AmapTileSource(
                "AmapStreet",
                "https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&",
                18
            ),
            satelliteLabel to AmapTileSource(
                "AmapSat",
                "https://webst01.is.autonavi.com/appmaptile?style=6&",
                18
            )
        )
    }
    var basemap by remember { mutableStateOf(0) }
    var picked by remember(city.name) { mutableStateOf(-1) }
    var dim by rememberSaveable { mutableStateOf(FieldDim.MIX) }
    var showGraticule by rememberSaveable { mutableStateOf(false) }
    var showValues by rememberSaveable { mutableStateOf(false) }
    var pickedCell by remember(city.name, state.dateStr, state.period) {
        mutableStateOf<HeatCell?>(null)
    }
    val holder = remember { MapHolder() }
    val heat = state.heat
    val showSamples = state.showSamples

    /* 热力面位图：48×48 插值色面，维度或遮挡层变化时重算 */
    val heatBmp = remember(heat, colors.isDark, showOcclusion, dim) {
        heat?.let { heatBitmap(it, colors, showOcclusion, dim) }
    }
    /* 覆盖层在 factory 里只创建一次，用可变引用读最新的热力面 */
    val heatNow = remember { mutableStateOf<HeatGrid?>(null) }
    SideEffect { heatNow.value = heat }

    /* 样带坐标与主云层云量：默认隐藏，设置里打开才画 */
    val dots: List<SampleDot> = remember(result, showSamples) {
        if (!showSamples) return@remember emptyList()
        val coords = transectPoints(result.city, result.evAz)
        val key = result.sRT.primary.key
        result.transect.mapIndexedNotNull { i, t ->
            val c = coords.getOrNull(i) ?: return@mapIndexedNotNull null
            val cov = when (key) {
                "cLow" -> t.cLow ?: 0.0
                "cMid" -> t.cMid ?: 0.0
                else -> t.cHigh ?: 0.0
            }
            val g = wgsToGcj(c.lat, c.lon)
            SampleDot(
                gp = GeoPoint(g.first, g.second),
                cov = (cov / 100.0).toFloat().coerceIn(0f, 1f),
                km = t.d
            )
        }
    }

    Column(modifier) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(260.dp)
                .clip(RoundedCornerShape(14.dp))
                .border(1.dp, colors.rule, RoundedCornerShape(14.dp))
                .background(colors.card)
        ) {
            AndroidView(
                factory = { ctx ->
                    runCatching {
                        Configuration.getInstance().userAgentValue = ctx.packageName
                    }
                    MapView(ctx).apply {
                        setBackgroundColor(android.graphics.Color.parseColor("#070B14"))
                        setTileSource(sources[basemap].second)
                        /* 不把 256px 瓦片按屏幕密度放大，否则整图发糊；
                           按 log2(density) 抬高级别，视野范围与放大时一致但更清晰 */
                        setTilesScaledToDpi(false)
                        setMultiTouchControls(true)
                        setBuiltInZoomControls(false)
                        setUseDataConnection(true)
                        tag = basemap
                        val d = ctx.resources.displayMetrics.density
                        controller.setZoom(6.5 + log2(d.toDouble()))
                        val p = wgsToGcj(city.lat, city.lon)
                        controller.setCenter(GeoPoint(p.first, p.second))
                        holder.lastKey = basemap.toString() + "|" + city.name

                        val gr = GraticuleOverlay()
                        gr.isEnabled = false
                        overlays.add(gr)
                        holder.graticule = gr

                        val ho = HeatOverlay { i, j ->
                            pickedCell = heatNow.value?.cellAt(i, j)
                            picked = -1
                        }
                        overlays.add(ho)
                        holder.heatOverlay = ho

                        val ov = TransectOverlay(
                            colorFor = { t -> rampColor(t, colors).toArgb() },
                            onPick = {
                                picked = it
                                pickedCell = null
                            },
                            dotRadius = with(density) { 6.dp.toPx() },
                            strokeWidth = with(density) { 2.dp.toPx() }
                        )
                        overlays.add(ov)
                        holder.overlay = ov

                        /* 地名层放在最后：osmdroid 倒序派发，标签优先接管自己的点击 */
                        val lo = CityLabelOverlay(lang) { c -> onPickCity(c) }
                        overlays.add(lo)
                        holder.labelOverlay = lo

                        /* 地图在竖向滚动页里：按下时先夺走父容器的滚动权，否则拖不动 */
                        setOnTouchListener { v, e ->
                            when (e.actionMasked) {
                                MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE ->
                                    v.parent?.requestDisallowInterceptTouchEvent(true)
                                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL ->
                                    v.parent?.requestDisallowInterceptTouchEvent(false)
                            }
                            false
                        }
                    }
                },
                update = { mv ->
                    if (mv.tag != basemap) {
                        mv.tag = basemap
                        mv.setTileSource(sources[basemap].second)
                    }
                    val key = basemap.toString() + "|" + city.name
                    if (holder.lastKey != key) {
                        holder.lastKey = key
                        val p = wgsToGcj(city.lat, city.lon)
                        mv.controller.setCenter(GeoPoint(p.first, p.second))
                    }
                    holder.heatOverlay?.let {
                        it.bitmap = heatBmp
                        it.grid = heat
                        it.selected = pickedCell
                        it.dim = dim
                        it.showValues = showValues
                    }
                    holder.graticule?.let { it.isEnabled = showGraticule }
                    holder.overlay?.let {
                        it.dots = dots
                        it.selected = picked
                    }
                    holder.labelOverlay?.let {
                        it.cities = nearbyCities
                    }
                    mv.invalidate()
                },
                modifier = Modifier.fillMaxSize()
            )

            /* 图层开关：经纬网 / 数值直标（都只在本地绘制，不发请求） */
            Row(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(8.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                val graticuleLabel = stringResource(R.string.field_graticule)
                val valuesLabel = stringResource(R.string.field_values)
                listOf(graticuleLabel to showGraticule, valuesLabel to showValues).forEach { (label, on) ->
                    Text(
                        text = label,
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
                        color = if (on) colors.ink else colors.faint,
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(if (on) colors.card.copy(alpha = 0.92f) else Color(0x66070B14))
                            .border(1.dp, if (on) colors.ruleStrong else colors.rule, RoundedCornerShape(999.dp))
                            .clickable {
                                if (label == graticuleLabel) showGraticule = !showGraticule
                                else showValues = !showValues
                            }
                            .padding(horizontal = 8.dp, vertical = 3.dp)
                    )
                }
            }

            /* 底图切换：街道取不到图时可以换卫星 */
            Row(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(8.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                sources.forEachIndexed { i, s ->
                    val on = i == basemap
                    Text(
                        text = s.first,
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
                        color = if (on) colors.ink else colors.faint,
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(if (on) colors.card.copy(alpha = 0.92f) else Color(0x66070B14))
                            .border(1.dp, if (on) colors.ruleStrong else colors.rule, RoundedCornerShape(999.dp))
                            .clickable { basemap = i }
                            .padding(horizontal = 8.dp, vertical = 3.dp)
                    )
                }
            }

            Text(
                text = stringResource(R.string.common_map_credit),
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.sp),
                color = colors.faint,
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(6.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(Color(0x99070B14))
                    .padding(horizontal = 4.dp, vertical = 1.dp)
            )
        }

        if (state.heatLoading) {
            Spacer(Modifier.height(8.dp))
            Text(
                text = stringResource(R.string.field_building, state.heatDone, state.heatTotal),
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
                color = colors.faint
            )
        } else if (heat != null) {
            Spacer(Modifier.height(8.dp))
            /* 四维切换：综合指数 / 出现概率 / 观赏质量 / 模型分歧（网页 MapDim 同构） */
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                FieldDim.values().forEach { d ->
                    val on = d == dim
                    Text(
                        text = d.shortRes.let { stringResource(it) },
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
                        color = if (on) colors.ink else colors.faint,
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(if (on) colors.card else Color.Transparent)
                            .border(1.dp, if (on) colors.ruleStrong else colors.rule, RoundedCornerShape(999.dp))
                            .clickable { dim = d }
                            .padding(horizontal = 8.dp, vertical = 3.dp)
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = dim.labelRes.let { stringResource(it) },
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
                    color = colors.faint
                )
                Spacer(Modifier.width(6.dp))
                Box(
                    modifier = Modifier
                        .width(54.dp)
                        .height(4.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(
                            Brush.horizontalGradient(
                                listOf(colors.accentCool, colors.accentAlt, colors.accent)
                            )
                        )
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    text = dim.hintRes.let { stringResource(it) },
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                    color = colors.faint
                )
            }
        } else if (state.heatError != null) {
            Spacer(Modifier.height(8.dp))
            Text(
                text = state.heatError,
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
                color = colors.bad
            )
        }

        if (showSamples && dots.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = stringResource(R.string.field_samples),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
                    color = colors.faint
                )
                Spacer(Modifier.width(6.dp))
                Box(
                    modifier = Modifier
                        .width(54.dp)
                        .height(4.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(
                            Brush.horizontalGradient(
                                listOf(colors.accentCool, colors.accentAlt, colors.accent)
                            )
                        )
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    text = stringResource(R.string.field_samples_hint),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                    color = colors.faint
                )
            }
        }

        pickedCell?.let { cell ->
            Spacer(Modifier.height(8.dp))
            HeatCard(cell, city, onClose = { pickedCell = null })
        }

        val sel = dots.getOrNull(picked)
        if (showSamples && sel != null) {
            Spacer(Modifier.height(8.dp))
            SampleCard(
                km = sel.km,
                t = result.transect.getOrNull(picked),
                xMax = result.sRT.geom.xMax,
                onClose = { picked = -1 }
            )
        }
    }
}

/** 点选样带点后的即时读数（全部来自本地结果，不再请求） */
@Composable
private fun SampleCard(km: Double, t: TransectPt?, xMax: Double, onClose: () -> Unit) {
    val colors = SunglowTheme.colors
    fun pct(v: Double?): String =
        if (isNum(v)) v!!.roundToInt().toString() + "%" else "—"

    Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = stringResource(R.string.field_sample_title, uDist(km)),
                style = MaterialTheme.typography.titleSmall,
                color = colors.ink
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = stringResource(R.string.common_close),
                style = MaterialTheme.typography.labelSmall,
                color = colors.accentCool,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .clickable(onClick = onClose)
                    .padding(horizontal = 6.dp, vertical = 2.dp)
            )
        }
        Spacer(Modifier.height(6.dp))
        if (t == null) {
            Text(
                text = stringResource(R.string.field_sample_nodata),
                style = MaterialTheme.typography.labelSmall,
                color = colors.faint
            )
            return@Panel
        }
        InfoRow(stringResource(R.string.field_lowmidhigh), pct(t.cLow) + " / " + pct(t.cMid) + " / " + pct(t.cHigh))
        InfoRow(stringResource(R.string.field_block), pct(cloudBlockOf(t.cLow, t.cMid)))
        InfoRow(stringResource(R.string.field_visibility), uDist(if (isNum(t.vis)) t.vis!! / 1000 else null))
        InfoRow(
            stringResource(R.string.field_reach),
            if (km <= xMax) stringResource(R.string.field_reach_in, uDist(xMax))
            else stringResource(R.string.field_reach_out, uDist(xMax))
        )
    }
}

/* ---------- 热力格读数 ---------- */

/** 点选热力格的即时读数（全部来自本地网格，不再请求） */
@Composable
private fun HeatCard(cell: HeatCell, city: City, onClose: () -> Unit) {
    val colors = SunglowTheme.colors
    val km = haversineKm(city.lat, city.lon, cell.lat, cell.lon)
    val dy = (cell.lat - city.lat) * DEG
    val dx = (cell.lon - city.lon) * DEG * kotlin.math.cos(city.lat * DEG)
    val brg = ((kotlin.math.atan2(dx, dy) * RAD) + 360.0) % 360.0

    Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = stringResource(R.string.field_cell_title, uDist(km), dirLabel(dirWordOf(brg))),
                style = MaterialTheme.typography.titleSmall,
                color = colors.ink
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = stringResource(R.string.common_close),
                style = MaterialTheme.typography.labelSmall,
                color = colors.accentCool,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .clickable(onClick = onClose)
                    .padding(horizontal = 6.dp, vertical = 2.dp)
            )
        }
        Spacer(Modifier.height(6.dp))
        InfoRow(
            stringResource(R.string.field_cell_idx),
            cell.idx.roundToInt().toString() + " · " + gradeLabel(cell.grade)
        )
        InfoRow(
            stringResource(R.string.field_cell_pq),
            cell.p.roundToInt().toString() + "% / " + cell.q.roundToInt().toString()
        )
        InfoRow(stringResource(R.string.field_cell_deck), cloudTypeLabel(cell.type) + " · " + cell.cover.roundToInt().toString() + "%")
        InfoRow(stringResource(R.string.field_cell_edge), uDist(cell.d))
        /* N3b：遮挡分档 + 参考旁证 + 形态分歧 */
        InfoRow(stringResource(R.string.field_cell_occ), occLabel(OCC_BAND_NAMES[occBandOf(cell.occ)]) + " · " + cell.occ.roundToInt())
        InfoRow(
            stringResource(R.string.field_cell_ref),
            cell.ref.roundToInt().toString() + " · " + stringResource(R.string.field_not_weighted)
        )
        InfoRow(stringResource(R.string.field_cell_gap), cell.refGap.roundToInt().toString() + " · " + fieldConfOf(cell.refGap).let { String.format(java.util.Locale.US, "%.2f", it) })
        InfoRow(stringResource(R.string.field_coverage), stringResource(R.string.field_coverage_value))
    }
}

/* ---------- 多点对比 ---------- */

@Composable
private fun ComparePanel(state: HomeUiState, onClear: () -> Unit) {
    val colors = SunglowTheme.colors
    Panel {
        if (state.compareCities.isEmpty()) {
            Text(
                text = stringResource(R.string.field_compare_empty),
                style = MaterialTheme.typography.labelSmall,
                color = colors.faint,
                lineHeight = 16.sp
            )
            return@Panel
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = stringResource(R.string.field_compare_count, state.compareCities.size),
                style = MaterialTheme.typography.labelSmall,
                color = colors.faint
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = if (state.compareLoading) stringResource(R.string.common_calculating)
                else stringResource(R.string.common_clear),
                style = MaterialTheme.typography.labelSmall,
                color = if (state.compareLoading) colors.faint else colors.accentCool,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .clickable(enabled = !state.compareLoading, onClick = onClear)
                    .padding(horizontal = 6.dp, vertical = 2.dp)
            )
        }
        Spacer(Modifier.height(6.dp))
        state.compareRows.sortedByDescending { it.p }.forEachIndexed { idx, row ->
            Column(Modifier.padding(vertical = 4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = (idx + 1).toString(),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                        color = if (idx == 0) colors.accentCool else colors.faint,
                        modifier = Modifier.width(14.dp)
                    )
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
                text = stringResource(R.string.field_compare_partial),
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

/* ---------- 添加对比点：城市搜索 + 经纬度 ---------- */

@Composable
private fun CompareAddPanel(
    search: (String) -> List<City>,
    onToggle: (City) -> Unit,
    onAddPoint: (Double, Double) -> Boolean,
    selected: Set<String>,
    full: Boolean
) {
    val colors = SunglowTheme.colors
    var q by rememberSaveable { mutableStateOf("") }
    var lat by rememberSaveable { mutableStateOf("") }
    var lon by rememberSaveable { mutableStateOf("") }
    val results = remember(q, search) {
        val s = q.trim()
        if (s.isEmpty()) emptyList() else search(s).take(8)
    }
    val latV = lat.trim().toDoubleOrNull()
    val lonV = lon.trim().toDoubleOrNull()
    val canAdd = !full && latV != null && lonV != null &&
        latV in -90.0..90.0 && lonV in -180.0..180.0

    Panel {
        Text(
            text = stringResource(R.string.field_add_point),
            style = MaterialTheme.typography.labelSmall,
            color = colors.faint
        )
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value = q,
            onValueChange = { q = it },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            textStyle = MaterialTheme.typography.bodySmall,
            placeholder = {
                Text(
                    stringResource(R.string.field_search_hint),
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.faint
                )
            }
        )
        if (q.isNotBlank()) {
            if (results.isEmpty()) {
                Spacer(Modifier.height(6.dp))
                Text(
                    stringResource(R.string.field_search_empty),
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.faint
                )
            } else {
                results.forEach { c ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                onToggle(c)
                                q = ""
                            }
                            .padding(vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            c.name,
                            style = MaterialTheme.typography.bodySmall,
                            color = if (selected.contains(c.name)) colors.accentCool else colors.ink,
                            modifier = Modifier.weight(1f)
                        )
                        Text(
                            c.region,
                            style = MaterialTheme.typography.labelSmall,
                            color = colors.faint
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = lat,
                onValueChange = { lat = it },
                modifier = Modifier.weight(1f),
                singleLine = true,
                textStyle = MaterialTheme.typography.bodySmall,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                placeholder = {
                    Text(
                        stringResource(R.string.field_coord_lat),
                        style = MaterialTheme.typography.labelSmall,
                        color = colors.faint
                    )
                }
            )
            Spacer(Modifier.width(8.dp))
            OutlinedTextField(
                value = lon,
                onValueChange = { lon = it },
                modifier = Modifier.weight(1f),
                singleLine = true,
                textStyle = MaterialTheme.typography.bodySmall,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                placeholder = {
                    Text(
                        stringResource(R.string.field_coord_lon),
                        style = MaterialTheme.typography.labelSmall,
                        color = colors.faint
                    )
                }
            )
            Spacer(Modifier.width(10.dp))
            Text(
                text = stringResource(R.string.field_coord_add),
                style = MaterialTheme.typography.labelSmall,
                color = if (canAdd) colors.accentCool else colors.faint,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .clickable(enabled = canAdd) {
                        if (latV != null && lonV != null && onAddPoint(latV, lonV)) {
                            lat = ""
                            lon = ""
                        }
                    }
                    .padding(horizontal = 6.dp, vertical = 4.dp)
            )
        }
        if (full) {
            Spacer(Modifier.height(4.dp))
            Text(
                stringResource(R.string.field_compare_full),
                style = MaterialTheme.typography.labelSmall,
                color = colors.faint
            )
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
            text = state.city.name + " · " + stringResource(R.string.field_calib_recorded, rec.second, rec.first),
            style = MaterialTheme.typography.bodySmall,
            color = colors.muted
        )
        if (rec.second > 0) {
            Spacer(Modifier.height(4.dp))
            Text(
                text = stringResource(R.string.field_calib_hit, (rec.first * 100 / rec.second).toString()),
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
                    text = stringResource(R.string.field_calib_saw),
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
                    text = stringResource(R.string.field_calib_miss),
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.muted
                )
            }
        }
    }
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

private fun dirRes(word: String): Int = when (word) {
    com.sunglow.spectrum.core.DIR_N -> R.string.dir_n
    com.sunglow.spectrum.core.DIR_NE -> R.string.dir_ne
    com.sunglow.spectrum.core.DIR_E -> R.string.dir_e
    com.sunglow.spectrum.core.DIR_SE -> R.string.dir_se
    com.sunglow.spectrum.core.DIR_S -> R.string.dir_s
    com.sunglow.spectrum.core.DIR_SW -> R.string.dir_sw
    com.sunglow.spectrum.core.DIR_W -> R.string.dir_w
    com.sunglow.spectrum.core.DIR_NW -> R.string.dir_nw
    else -> 0
}

@Composable
private fun dirLabel(word: String): String {
    val id = dirRes(word)
    return if (id == 0) word else stringResource(id)
}

private fun occRes(word: String): Int = when (word) {
    com.sunglow.spectrum.core.OCC_CLEAR -> R.string.occ_clear
    com.sunglow.spectrum.core.OCC_LIGHT -> R.string.occ_light
    com.sunglow.spectrum.core.OCC_MEDIUM -> R.string.occ_medium
    com.sunglow.spectrum.core.OCC_HEAVY -> R.string.occ_heavy
    else -> 0
}

@Composable
private fun occLabel(word: String): String {
    val id = occRes(word)
    return if (id == 0) word else stringResource(id)
}

private fun cloudLevelRes(level: String): Int = when (level) {
    com.sunglow.spectrum.core.CLOUD_LEVEL_LOW -> R.string.cloud_low
    com.sunglow.spectrum.core.CLOUD_LEVEL_MID -> R.string.cloud_mid
    com.sunglow.spectrum.core.CLOUD_LEVEL_HIGH -> R.string.cloud_high
    else -> 0
}

@Composable
private fun cloudLevelLabel(level: String): String {
    val id = cloudLevelRes(level)
    return if (id == 0) level else stringResource(id)
}

private fun cloudTypeRes(type: String): Int = when (type) {
    com.sunglow.spectrum.core.DECK_ST_FOG -> R.string.cloud_st_fog
    com.sunglow.spectrum.core.DECK_SC -> R.string.cloud_sc
    com.sunglow.spectrum.core.DECK_CU -> R.string.cloud_cu
    com.sunglow.spectrum.core.DECK_AC -> R.string.cloud_ac
    com.sunglow.spectrum.core.DECK_AS -> R.string.cloud_as
    com.sunglow.spectrum.core.DECK_CS -> R.string.cloud_cs
    com.sunglow.spectrum.core.DECK_CI -> R.string.cloud_ci
    else -> 0
}

@Composable
private fun cloudTypeLabel(type: String): String {
    val id = cloudTypeRes(type)
    return if (id == 0) type else stringResource(id)
}

private fun bandColor(grade: String, colors: SunglowColors): Color = when (grade) {
    com.sunglow.spectrum.core.GRADE_YOU -> Color(0xFF9FE6BD)
    com.sunglow.spectrum.core.GRADE_LIANG -> Color(0xFF9AC765)
    com.sunglow.spectrum.core.GRADE_YIBAN -> colors.mid
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
