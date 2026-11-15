package com.sunglow.spectrum.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sunglow.spectrum.R
import com.sunglow.spectrum.core.PackSnapshot
import com.sunglow.spectrum.core.expandPackMap
import com.sunglow.spectrum.core.packPointSummary
import com.sunglow.spectrum.core.packTrendRows
import com.sunglow.spectrum.ui.i18n.gradeText
import com.sunglow.spectrum.ui.theme.SunglowColors
import com.sunglow.spectrum.ui.theme.SunglowTheme
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 只读 pack 覆盖页：零请求，所有数据分区默认折叠。 */
@Composable
fun SnapshotScreen(snap: PackSnapshot, onExit: () -> Unit) {
    val colors = SunglowTheme.colors
    val ctx = LocalContext.current
    val point = packPointSummary(snap)
    val map = expandPackMap(snap.mapEntry)
    val trend = packTrendRows(snap)
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
                            Text(
                                gradeText(ctx, row.grade), color = colors.accent, fontSize = 12.sp,
                                modifier = Modifier.padding(start = 8.dp)
                            )
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
            }
        }
        Text(
            stringResource(R.string.home_data_credit),
            color = colors.faint,
            fontSize = 11.sp,
            modifier = Modifier.align(Alignment.CenterHorizontally)
        )
    }
}

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
