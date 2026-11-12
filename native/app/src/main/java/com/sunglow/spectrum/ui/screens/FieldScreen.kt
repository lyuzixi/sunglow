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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
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
import org.osmdroid.views.overlay.Marker
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
 * 观测场：地图（osmdroid 原生底图，可拖拽缩放）+ 光路剖面。
 */

@Composable
fun FieldScreen(vm: HomeViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val colors = SunglowTheme.colors
    val result = state.result
    var showMap by remember(state.city.name) { mutableStateOf(true) }

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

        if (showMap) {
            OsmMap(city = state.city, modifier = Modifier.padding(horizontal = 18.dp))
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
                text = if (showMap) "切到光路剖面" else "切到地图",
                style = MaterialTheme.typography.labelSmall,
                color = colors.accentCool,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .clickable { showMap = !showMap }
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            )
        }

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
                        "地图底图为高德公开瓦片，无需密钥，可拖拽与双指缩放；中心点已做 GCJ-02 纠偏。",
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

/* ---------- 地图（osmdroid 原生 View，无需任何 key） ---------- */

/**
 * 高德公开栅格瓦片。瓦片本身是 GCJ-02 网格，中心点与标记要做 WGS-84 → GCJ-02 纠偏，
 * 否则放大后会有几百米偏移。无需 key，国内网络可直连。
 */
private class AmapTileSource(
    name: String,
    base: String,
    maxZoom: Int
) : OnlineTileSourceBase(name, 3, maxZoom, 256, "", arrayOf(base), "© 高德地图") {
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
    var marker: Marker? = null
    var lastKey: String = ""
}

@Composable
private fun OsmMap(city: com.sunglow.spectrum.core.City, modifier: Modifier = Modifier) {
    val colors = SunglowTheme.colors
    val sources = remember {
        listOf(
            "街道" to AmapTileSource(
                "AmapStreet",
                "https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&",
                18
            ),
            "卫星" to AmapTileSource(
                "AmapSat",
                "https://webst01.is.autonavi.com/appmaptile?style=6&",
                18
            )
        )
    }
    var basemap by remember { mutableStateOf(0) }
    val holder = remember { MapHolder() }

    Box(
        modifier = modifier
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
                    setTilesScaledToDpi(true)
                    setMultiTouchControls(true)
                    setBuiltInZoomControls(false)
                    setUseDataConnection(true)
                    tag = basemap
                    controller.setZoom(6.5)
                    val p = wgsToGcj(city.lat, city.lon)
                    controller.setCenter(GeoPoint(p.first, p.second))

                    val m = Marker(this).apply {
                        position = GeoPoint(p.first, p.second)
                        title = city.name
                        setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                    }
                    overlays.add(m)
                    holder.marker = m
                    holder.lastKey = basemap.toString() + "|" + city.name

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
                    val gp = GeoPoint(p.first, p.second)
                    holder.marker?.let {
                        it.position = gp
                        it.title = city.name
                    }
                    mv.controller.setCenter(gp)
                    mv.invalidate()
                }
            },
            modifier = Modifier.fillMaxSize()
        )

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
            text = "© 高德地图",
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
