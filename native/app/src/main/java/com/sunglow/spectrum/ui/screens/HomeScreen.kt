package com.sunglow.spectrum.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sunglow.spectrum.R
import com.sunglow.spectrum.core.SunEvents
import com.sunglow.spectrum.core.sunEvents
import com.sunglow.spectrum.core.utcMillis
import com.sunglow.spectrum.ui.theme.SunglowTheme
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Calendar

/*
 * P0 落地页
 * 这一屏的作用不是"最终界面"，而是证明三件事已经打通：
 *   1. 原生 Compose 能起屏，主题令牌生效；
 *   2. 算法内核能在真实构建里被调用；
 *   3. 计算结果是可信的（与网页版同一套 NOAA 口径）。
 * P2 起这一屏会被真正的结论卡与日期条替换。
 */

private const val DEMO_CITY = "北京"
private const val DEMO_LAT = 39.9042
private const val DEMO_LON = 116.4074
private const val DEMO_TZ = "Asia/Shanghai"

@Composable
fun HomeScreen() {
    val colors = SunglowTheme.colors
    val spacing = SunglowTheme.spacing

    val today = remember {
        val c = Calendar.getInstance()
        Triple(
            c.get(Calendar.YEAR),
            c.get(Calendar.MONTH) + 1,
            c.get(Calendar.DAY_OF_MONTH)
        )
    }
    val events = remember(today) {
        sunEvents(utcMillis(today.first, today.second, today.third), DEMO_LAT, DEMO_LON)
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bg)
    ) {
        // 顶部光谱辉光：与网页首屏同一语系，但按原生尺寸重画
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

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(horizontal = spacing.page)
                .padding(top = spacing.xl, bottom = spacing.xxl)
        ) {
            Text(
                text = stringResource(R.string.brand_mark),
                style = androidx.compose.material3.MaterialTheme.typography.labelSmall,
                color = colors.accentCool
            )

            Spacer(Modifier.height(spacing.md))

            Text(
                text = stringResource(R.string.app_name),
                style = androidx.compose.material3.MaterialTheme.typography.displayLarge,
                color = colors.ink
            )

            Spacer(Modifier.height(spacing.sm))

            Text(
                text = stringResource(R.string.app_name_full),
                style = androidx.compose.material3.MaterialTheme.typography.bodyLarge,
                color = colors.muted
            )

            Spacer(Modifier.height(spacing.lg))

            SpectrumBand()

            Spacer(Modifier.height(spacing.xl))

            StatusCard(
                title = stringResource(R.string.shell_title),
                body = stringResource(R.string.shell_body)
            )

            Spacer(Modifier.height(spacing.lg))

            TodayCard(dateText = "${today.first}-${pad(today.second)}-${pad(today.third)}", events = events)

            Spacer(Modifier.height(spacing.lg))

            SectionCard(
                title = stringResource(R.string.shell_section_core),
                rows = listOf(
                    stringResource(R.string.core_math),
                    stringResource(R.string.core_astro),
                    stringResource(R.string.core_physics),
                    stringResource(R.string.core_scoring)
                ),
                mark = Mark.Done
            )

            Spacer(Modifier.height(spacing.md))

            SectionCard(
                title = stringResource(R.string.shell_section_next),
                rows = listOf(
                    stringResource(R.string.next_api),
                    stringResource(R.string.next_city),
                    stringResource(R.string.next_ui)
                ),
                mark = Mark.Pending
            )
        }
    }
}

private fun pad(n: Int): String = n.toString().padStart(2, '0')

private enum class Mark { Done, Pending }

@Composable
private fun SpectrumBand() {
    val colors = SunglowTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(3.dp)
            .clip(RoundedCornerShape(2.dp))
    ) {
        Box(
            Modifier
                .weight(1f)
                .fillMaxSize()
                .background(colors.accent)
        )
        Box(
            Modifier
                .weight(1f)
                .fillMaxSize()
                .background(colors.accentAlt)
        )
        Box(
            Modifier
                .weight(1f)
                .fillMaxSize()
                .background(colors.accentCool)
        )
    }
}

@Composable
private fun Panel(
    modifier: Modifier = Modifier,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit
) {
    val colors = SunglowTheme.colors
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(colors.card)
            .border(1.dp, colors.rule, RoundedCornerShape(18.dp))
            .padding(18.dp),
        content = content
    )
}

@Composable
private fun StatusCard(title: String, body: String) {
    val colors = SunglowTheme.colors
    Panel {
        Text(
            text = stringResource(R.string.shell_badge),
            style = androidx.compose.material3.MaterialTheme.typography.labelSmall,
            color = colors.accentAlt
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = title,
            style = androidx.compose.material3.MaterialTheme.typography.headlineMedium,
            color = colors.ink
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = body,
            style = androidx.compose.material3.MaterialTheme.typography.bodyMedium,
            color = colors.muted
        )
    }
}

@Composable
private fun TodayCard(dateText: String, events: SunEvents) {
    val colors = SunglowTheme.colors
    val timeFmt = remember { DateTimeFormatter.ofPattern("HH:mm") }
    val zone = remember { ZoneId.of(DEMO_TZ) }

    fun fmt(ms: Double?): String =
        ms?.let { Instant.ofEpochMilli(it.toLong()).atZone(zone).format(timeFmt) } ?: "—"

    Panel {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "$DEMO_CITY · $dateText",
                style = androidx.compose.material3.MaterialTheme.typography.titleMedium,
                color = colors.ink
            )
            Text(
                text = DEMO_TZ,
                style = androidx.compose.material3.MaterialTheme.typography.labelSmall,
                color = colors.muted
            )
        }

        Spacer(Modifier.height(14.dp))

        Row(modifier = Modifier.fillMaxWidth()) {
            EventCell("日出", fmt(events.riseMs), Modifier.weight(1f))
            EventCell("正午", fmt(events.noonMs), Modifier.weight(1f))
            EventCell("日落", fmt(events.setMs), Modifier.weight(1f))
        }

        if (events.polarNight || events.polarDay) {
            Spacer(Modifier.height(10.dp))
            Text(
                text = if (events.polarNight) "极夜：当日无日出日落" else "极昼：当日不落",
                style = androidx.compose.material3.MaterialTheme.typography.bodyMedium,
                color = colors.accentAlt
            )
        }
    }
}

@Composable
private fun EventCell(label: String, value: String, modifier: Modifier = Modifier) {
    val colors = SunglowTheme.colors
    Column(modifier = modifier) {
        Text(
            text = label,
            style = androidx.compose.material3.MaterialTheme.typography.labelSmall,
            color = colors.muted
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = value,
            style = androidx.compose.material3.MaterialTheme.typography.headlineLarge.copy(fontSize = 24.sp),
            color = colors.ink
        )
    }
}

@Composable
private fun SectionCard(title: String, rows: List<String>, mark: Mark) {
    val colors = SunglowTheme.colors
    Panel {
        Text(
            text = title,
            style = androidx.compose.material3.MaterialTheme.typography.labelSmall,
            color = colors.muted
        )
        Spacer(Modifier.height(10.dp))
        rows.forEach { row ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(7.dp)
                        .clip(CircleShape)
                        .background(
                            if (mark == Mark.Done) colors.accentCool else colors.ruleStrong
                        )
                )
                Spacer(Modifier.size(10.dp))
                Text(
                    text = row,
                    style = androidx.compose.material3.MaterialTheme.typography.bodyLarge,
                    color = if (mark == Mark.Done) colors.ink else colors.muted,
                    fontWeight = if (mark == Mark.Done) FontWeight.Medium else FontWeight.Normal
                )
            }
        }
    }
}
