package com.sunglow.spectrum.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sunglow.spectrum.R
import com.sunglow.spectrum.core.PackMapPoint
import com.sunglow.spectrum.core.PackSnapshot
import com.sunglow.spectrum.core.expandPackMap
import com.sunglow.spectrum.core.fieldRampColor
import com.sunglow.spectrum.core.fmtDur
import com.sunglow.spectrum.core.glowWindow
import com.sunglow.spectrum.core.packPointSummary
import com.sunglow.spectrum.core.packTrendRows
import com.sunglow.spectrum.ui.i18n.gradeText
import com.sunglow.spectrum.ui.theme.SunglowColors
import com.sunglow.spectrum.ui.theme.SunglowTheme
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.text.SimpleDateFormat
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Date
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.sqrt

/** 只读 pack 覆盖页：零请求，所有数据分区默认折叠。 */
@Composable
fun SnapshotScreen(snap: PackSnapshot, onExit: () -> Unit) {
    val colors = SunglowTheme.colors
    val ctx = LocalContext.current
    val point = packPointSummary(snap)
    val pointObj = snap.entries.firstOrNull { it.key.startsWith("SUNGLOW.v2.point.") }
        ?.value?.get("obj") as? JsonObject
    val models = pointObj?.get("models") as? JsonArray
    val factors = pointObj?.get("factorRows") as? JsonArray
    val ray = pointObj?.get("sRT") as? JsonObject
    val map = expandPackMap(snap.mapEntry)
    val trend = packTrendRows(snap)
    val bestWindow = snapshotWindow(pointObj, snap)
    val genText = if (snap.gen > 0) {
        SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()).format(Date(snap.gen))
    } else "—"

    @Composable
    fun partLabel(key: String): String = when (key) {
        "point" -> stringResource(R.string.snapshot_part_point)
        "trend" -> stringResource(R.string.snapshot_part_trend)
        "map" -> stringResource(R.string.snapshot_part_map)
        "compare" -> stringResource(R.string.snapshot_part_compare)
        else -> key
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bg)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(R.string.snapshot_badge),
                color = colors.accent,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f)
            )
            Button(
                onClick = onExit,
                colors = ButtonDefaults.buttonColors(containerColor = colors.bg3)
            ) { Text(stringResource(R.string.snapshot_exit), color = colors.ink) }
        }
        Text(stringResource(R.string.snapshot_title), color = colors.ink, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Text(
            "${snap.q.name.ifBlank { point?.name.orEmpty() }} · ${snap.q.date} · " +
                (if (snap.q.period == "pm") stringResource(R.string.widget_pm) else stringResource(R.string.widget_am)),
            color = colors.ink,
            fontSize = 16.sp
        )
        Text(stringResource(R.string.snapshot_generated, genText), color = colors.faint, fontSize = 12.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            for (p in snap.parts) {
                Text(
                    partLabel(p), color = colors.muted, fontSize = 12.sp,
                    modifier = Modifier.background(colors.bg3, RoundedCornerShape(20.dp)).padding(horizontal = 10.dp, vertical = 5.dp)
                )
            }
        }

        SnapshotSection("point", stringResource(R.string.snapshot_part_point), colors) {
            if (point == null) {
                Text(stringResource(R.string.snapshot_empty), color = colors.muted, fontSize = 15.sp)
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.field_dim_p), color = colors.faint, fontSize = 12.sp)
                        Text("${point.p.toInt()}%", color = colors.ink, fontSize = 36.sp, fontWeight = FontWeight.Bold)
                    }
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.field_dim_q), color = colors.faint, fontSize = 12.sp)
                        Text("${point.q.toInt()}", color = colors.ink, fontSize = 36.sp, fontWeight = FontWeight.Bold)
                    }
                }
                Text(gradeText(ctx, point.grade), color = colors.accent, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    stringResource(R.string.share_confidence) + " · " +
                        if (point.confKey == "hi") stringResource(R.string.conf_high)
                        else if (point.confKey == "lo") stringResource(R.string.conf_low)
                        else stringResource(R.string.conf_mid),
                    color = colors.muted,
                    fontSize = 13.sp
                )
                if (bestWindow != null) {
                    Text(stringResource(R.string.snapshot_best_window, bestWindow), color = colors.accentCool, fontSize = 14.sp)
                }
                val evName = pointObj.text("evName")
                if (evName.isNotBlank()) Text(evName, color = colors.muted, fontSize = 13.sp)
            }
        }

        if (!models.isNullOrEmpty()) {
            SnapshotSection("models", stringResource(R.string.model_title), colors) {
                models.mapNotNull { it as? JsonObject }.forEach { model ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(model.text("label").ifBlank { model.text("id") }, color = colors.ink, fontSize = 13.sp, modifier = Modifier.weight(1f))
                        Text("P ${model.num("P")?.toInt() ?: 0}%", color = colors.muted, fontSize = 12.sp)
                        Spacer(Modifier.width(12.dp))
                        Text("Q ${model.num("Q")?.toInt() ?: 0}", color = colors.accentCool, fontSize = 12.sp)
                    }
                }
            }
        }

        if (!factors.isNullOrEmpty()) {
            SnapshotSection("factors", stringResource(R.string.page_factors), colors) {
                factors.mapNotNull { it as? JsonArray }.forEach { row ->
                    val key = (row.getOrNull(0) as? JsonPrimitive)?.content ?: "—"
                    val raw = (row.getOrNull(1) as? JsonPrimitive)?.content ?: "—"
                    val score = (row.getOrNull(2) as? JsonPrimitive)?.doubleOrNull
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(key, color = colors.muted, fontSize = 12.sp, modifier = Modifier.weight(1f))
                        Text(raw, color = colors.ink, fontSize = 12.sp, modifier = Modifier.padding(end = 10.dp))
                        Text(score?.let { String.format(Locale.US, "%.0f", it) } ?: "—", color = colors.accentCool, fontSize = 12.sp)
                    }
                }
            }
        }

        if (ray != null) {
            SnapshotSection("ray", stringResource(R.string.page_ray), colors) {
                Text("P ${ray.num("P")?.toInt() ?: 0}% · Q ${ray.num("Q")?.toInt() ?: 0}", color = colors.ink, fontSize = 15.sp)
                val primary = ray.obj("primary")
                Text(
                    stringResource(R.string.field_cover) + " · " + (primary.num("cover")?.toInt()?.toString() ?: "—") + "%",
                    color = colors.muted,
                    fontSize = 13.sp
                )
                Text(stringResource(R.string.field_heq) + " · " + (ray.num("Heq")?.let { String.format(Locale.US, "%.1f km", it) } ?: "—"), color = colors.muted, fontSize = 13.sp)
                Text(stringResource(R.string.field_duration) + " · " + fmtDur(ray.obj("geom").num("dur") ?: 0.0), color = colors.muted, fontSize = 13.sp)
                SnapshotRayCurve(ray)
            }
        }

        if (trend.isNotEmpty()) {
            SnapshotSection("trend", stringResource(R.string.snapshot_part_trend), colors) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    trend.forEach { row ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(row.date, color = colors.muted, fontSize = 12.sp, modifier = Modifier.weight(1f))
                            Text(
                                if (row.period == "am") stringResource(R.string.widget_am) else stringResource(R.string.widget_pm),
                                color = colors.faint,
                                fontSize = 12.sp,
                                modifier = Modifier.padding(end = 8.dp)
                            )
                            Text("P ${row.p.toInt()}% · Q ${row.q.toInt()}", color = colors.ink, fontSize = 13.sp)
                            Text(gradeText(ctx, row.grade), color = colors.accent, fontSize = 12.sp, modifier = Modifier.padding(start = 8.dp))
                        }
                    }
                }
            }
        }

        if (map != null) {
            SnapshotSection("map", stringResource(R.string.snapshot_part_map), colors) {
                Text(
                    stringResource(R.string.snapshot_map_info, map.am.pts.size, map.pm.pts.size, snap.mapStride),
                    color = colors.muted,
                    fontSize = 13.sp
                )
                val selected = if (snap.q.period == "am") map.am.pts else map.pm.pts
                val points = if (selected.isNotEmpty()) selected else if (map.am.pts.isNotEmpty()) map.am.pts else map.pm.pts
                SnapshotMap(points)
            }
        }
        Text(stringResource(R.string.home_data_credit), color = colors.faint, fontSize = 11.sp, modifier = Modifier.align(Alignment.CenterHorizontally))
    }
}

@Composable
private fun SnapshotMap(points: List<PackMapPoint>) {
    val colors = SunglowTheme.colors
    if (points.isEmpty()) {
        Text(stringResource(R.string.snapshot_empty), color = colors.muted, fontSize = 13.sp)
        return
    }
    val n = ceil(sqrt(points.size.toDouble())).toInt().coerceAtLeast(1)
    Canvas(Modifier.fillMaxWidth().height(220.dp).background(colors.bg3, RoundedCornerShape(10.dp))) {
        val cw = size.width / n
        val ch = size.height / n
        points.forEachIndexed { index, point ->
            val row = index / n
            val col = index % n
            val value = (point.p * 0.55 + point.q * 0.45).coerceIn(0.0, 100.0)
            val color = runCatching { Color(android.graphics.Color.parseColor(fieldRampColor(value))) }.getOrDefault(colors.accent)
            drawRect(color = color, topLeft = Offset(col * cw, row * ch), size = Size(cw + 0.5f, ch + 0.5f))
        }
    }
}

@Composable
private fun SnapshotRayCurve(ray: JsonObject) {
    val colors = SunglowTheme.colors
    val samples = (ray["samples"] as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()
    if (samples.size < 2) return
    val times = samples.mapNotNull { it.num("t") }
    if (times.size != samples.size) return
    val lo = times.minOrNull() ?: return
    val hi = times.maxOrNull() ?: return
    val span = (hi - lo).takeIf { it > 0.0 } ?: 1.0
    Text(stringResource(R.string.snapshot_curve), color = colors.faint, fontSize = 12.sp)
    Canvas(Modifier.fillMaxWidth().height(132.dp).background(colors.bg3, RoundedCornerShape(10.dp))) {
        fun x(t: Double) = size.width * (0.06f + 0.88f * ((t - lo) / span).toFloat().coerceIn(0f, 1f))
        fun y(v: Double) = size.height * (0.90f - 0.76f * v.toFloat().coerceIn(0f, 1f))
        for (i in 0 until samples.lastIndex) {
            val a = samples[i]
            val b = samples[i + 1]
            val av = a.num("lumRel") ?: 0.0
            val bv = b.num("lumRel") ?: 0.0
            drawLine(colors.accentCool, Offset(x(times[i]), y(av)), Offset(x(times[i + 1]), y(bv)), strokeWidth = 2.dp.toPx())
        }
        samples.forEachIndexed { i, sample ->
            val color = sample.text("hex").takeIf { it.startsWith("#") }?.let {
                runCatching { Color(android.graphics.Color.parseColor(it)) }.getOrNull()
            } ?: colors.accent
            drawCircle(color, radius = 3.dp.toPx(), center = Offset(x(times[i]), y(sample.num("lumRel") ?: 0.0)))
        }
    }
}

private fun snapshotWindow(obj: JsonObject?, snap: PackSnapshot): String? {
    val evMs = obj.num("evMs")?.toLong() ?: return null
    if (evMs <= 0L) return null
    val geom = obj.obj("sRT").obj("geom")
    val duration = geom.num("dur")?.takeIf { it.isFinite() && it > 0.0 } ?: 20.0
    val city = obj.obj("city")
    val isAm = obj.text("period").ifBlank { snap.q.period } == "am"
    val window = glowWindow(evMs, isAm, city.num("lat") ?: snap.q.lat, city.num("lon") ?: snap.q.lon, geom.num("thNearDeg"), geom.num("thFarDeg"))
        ?: (evMs - (duration * 30_000).toLong() to evMs + (duration * 30_000).toLong())
    val offset = obj.obj("tz").num("offsetSec")?.toLong() ?: 0L
    return snapshotClock(window.first, offset) + "–" + snapshotClock(window.second, offset)
}

private fun snapshotClock(ms: Long, offsetSec: Long): String =
    Instant.ofEpochMilli(ms).plusSeconds(offsetSec).atZone(ZoneOffset.UTC).format(DateTimeFormatter.ofPattern("HH:mm"))

private fun JsonObject?.obj(key: String): JsonObject? = this?.get(key) as? JsonObject
private fun JsonObject?.num(key: String): Double? = (this?.get(key) as? JsonPrimitive)?.doubleOrNull
private fun JsonObject?.text(key: String): String = (this?.get(key) as? JsonPrimitive)?.content.orEmpty()

@Composable
private fun SnapshotSection(
    key: String,
    title: String,
    colors: SunglowColors,
    content: @Composable () -> Unit
) {
    var expanded by rememberSaveable(key) { mutableStateOf(false) }
    Column(
        Modifier
            .fillMaxWidth()
            .background(colors.bg2, RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp, vertical = 4.dp)
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .clickable { expanded = !expanded },
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(title, color = colors.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            Text(if (expanded) "−" else "+", color = colors.accent, fontSize = 20.sp)
        }
        if (expanded) {
            Column(Modifier.fillMaxWidth().padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                content()
            }
        }
    }
}
