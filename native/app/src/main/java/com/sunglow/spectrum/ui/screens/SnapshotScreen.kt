package com.sunglow.spectrum.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import com.sunglow.spectrum.ui.theme.SunglowTheme
import com.sunglow.spectrum.ui.i18n.gradeText
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/*
 * 网页 pack 快照态：只读、零请求。
 * 这里不重建整份 ForecastResult，只展示包里确实存在的结论摘要与观测场规模；
 * 地图/趋势的完整复现放到 R2-3。
 */
@Composable
fun SnapshotScreen(snap: PackSnapshot, onExit: () -> Unit) {
    val colors = SunglowTheme.colors
    val ctx = LocalContext.current
    val point = packPointSummary(snap)
    val map = expandPackMap(snap.mapEntry)
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
            .padding(horizontal = 22.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text(
            text = stringResource(R.string.snapshot_badge),
            color = colors.accent,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold
        )
        Text(stringResource(R.string.snapshot_title), color = colors.ink, fontSize = 30.sp, fontWeight = FontWeight.Bold)
        Text(
            "${snap.q.name.ifBlank { point?.name.orEmpty() }} · ${snap.q.date} · " +
                (if (snap.q.period == "pm") stringResource(R.string.widget_pm) else stringResource(R.string.widget_am)),
            color = colors.ink,
            fontSize = 17.sp
        )
        Text(stringResource(R.string.snapshot_generated, genText), color = colors.faint, fontSize = 12.sp)

        if (point == null) {
            Text(stringResource(R.string.snapshot_empty), color = colors.muted, fontSize = 15.sp)
        } else {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(colors.bg2, RoundedCornerShape(14.dp))
                    .padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(18.dp)
            ) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.field_dim_p), color = colors.faint, fontSize = 12.sp)
                    Text("${point.p.toInt()}%", color = colors.ink, fontSize = 38.sp, fontWeight = FontWeight.Bold)
                }
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.field_dim_q), color = colors.faint, fontSize = 12.sp)
                    Text("${point.q.toInt()}", color = colors.ink, fontSize = 38.sp, fontWeight = FontWeight.Bold)
                }
            }
            Text(
                gradeText(ctx, point.grade),
                color = colors.accent,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                stringResource(R.string.share_confidence) + " · " +
                    if (point.confKey == "hi") stringResource(R.string.conf_high)
                    else if (point.confKey == "lo") stringResource(R.string.conf_low)
                    else stringResource(R.string.conf_mid),
                color = colors.muted,
                fontSize = 13.sp
            )
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (p in snap.parts) {
                Text(
                    partLabel(p),
                    color = colors.muted,
                    fontSize = 12.sp,
                    modifier = Modifier
                        .background(colors.bg3, RoundedCornerShape(20.dp))
                        .padding(horizontal = 10.dp, vertical = 4.dp)
                )
            }
        }
        if (map != null) {
            Text(
                stringResource(R.string.snapshot_map_info, map.am.pts.size, snap.mapStride),
                color = colors.faint,
                fontSize = 12.sp
            )
        }

        Spacer(Modifier.height(8.dp))
        Button(
            onClick = onExit,
            colors = ButtonDefaults.buttonColors(containerColor = colors.accent),
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(stringResource(R.string.snapshot_exit), color = Color.White)
        }
        Text(
            stringResource(R.string.home_data_credit),
            color = colors.faint,
            fontSize = 11.sp,
            modifier = Modifier.align(Alignment.CenterHorizontally)
        )
    }
}
