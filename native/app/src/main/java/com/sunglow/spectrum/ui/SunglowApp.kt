package com.sunglow.spectrum.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.sunglow.spectrum.R
import com.sunglow.spectrum.ui.screens.FieldScreen
import com.sunglow.spectrum.ui.screens.HomeScreen
import com.sunglow.spectrum.ui.screens.TrendScreen
import com.sunglow.spectrum.ui.theme.SunglowTheme

/*
 * 应用骨架：三个 Tab（结论 / 趋势 / 观测场），共用同一个 ViewModel。
 */

@Composable
fun SunglowApp(vm: HomeViewModel = viewModel()) {
    val colors = SunglowTheme.colors
    var tab by rememberSaveable { mutableIntStateOf(0) }

    Column(modifier = Modifier.fillMaxSize().background(colors.bg)) {
        Box(modifier = Modifier.weight(1f)) {
            AnimatedContent(
                targetState = tab,
                transitionSpec = {
                    (fadeIn(tween(220)) + slideInVertically(tween(220)) { it / 40 }) togetherWith
                        fadeOut(tween(120))
                },
                label = "tabSwitch"
            ) { current ->
                when (current) {
                    0 -> HomeScreen(vm)
                    1 -> TrendScreen(vm)
                    else -> FieldScreen(vm)
                }
            }
        }
        SunglowTabBar(selected = tab, onSelect = { tab = it })
    }
}

@Composable
private fun SunglowTabBar(selected: Int, onSelect: (Int) -> Unit) {
    val colors = SunglowTheme.colors
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.bg2)
            .navigationBarsPadding()
    ) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(colors.rule))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(58.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            TabItem(0, stringResource(R.string.tab_conclusion), selected == 0, Modifier.weight(1f)) { onSelect(0) }
            TabItem(1, stringResource(R.string.tab_trend), selected == 1, Modifier.weight(1f)) { onSelect(1) }
            TabItem(2, stringResource(R.string.tab_field), selected == 2, Modifier.weight(1f)) { onSelect(2) }
        }
    }
}

@Composable
private fun TabItem(
    type: Int,
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val colors = SunglowTheme.colors
    val tint = if (selected) colors.accentCool else colors.faint
    Column(
        modifier = modifier
            .fillMaxSize()
            .clickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(9.dp))
        Canvas(modifier = Modifier.size(20.dp)) { tabIcon(type, tint) }
        Spacer(Modifier.height(3.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
            color = tint
        )
    }
}

private fun DrawScope.tabIcon(type: Int, color: Color) {
    val sw = 1.6.dp.toPx()
    when (type) {
        0 -> {
            /* 太阳：半环 + 地平线 + 光线 */
            drawArc(
                color = color,
                startAngle = 180f,
                sweepAngle = 180f,
                useCenter = false,
                topLeft = Offset(size.width * 0.14f, size.height * 0.30f),
                size = Size(size.width * 0.72f, size.height * 0.58f),
                style = Stroke(width = sw, cap = StrokeCap.Round)
            )
            drawLine(
                color = color,
                start = Offset(size.width * 0.04f, size.height * 0.62f),
                end = Offset(size.width * 0.96f, size.height * 0.62f),
                strokeWidth = sw,
                cap = StrokeCap.Round
            )
            drawLine(
                color = color,
                start = Offset(size.width * 0.5f, size.height * 0.08f),
                end = Offset(size.width * 0.5f, size.height * 0.24f),
                strokeWidth = sw,
                cap = StrokeCap.Round
            )
        }
        1 -> {
            /* 柱状：三日趋势 */
            drawLine(
                color = color,
                start = Offset(size.width * 0.2f, size.height * 0.85f),
                end = Offset(size.width * 0.2f, size.height * 0.5f),
                strokeWidth = 2.4.dp.toPx(),
                cap = StrokeCap.Round
            )
            drawLine(
                color = color,
                start = Offset(size.width * 0.5f, size.height * 0.85f),
                end = Offset(size.width * 0.5f, size.height * 0.18f),
                strokeWidth = 2.4.dp.toPx(),
                cap = StrokeCap.Round
            )
            drawLine(
                color = color,
                start = Offset(size.width * 0.8f, size.height * 0.85f),
                end = Offset(size.width * 0.8f, size.height * 0.38f),
                strokeWidth = 2.4.dp.toPx(),
                cap = StrokeCap.Round
            )
        }
        else -> {
            /* 观测场：定位针 */
            drawCircle(
                color = color,
                radius = size.width * 0.26f,
                center = Offset(size.width * 0.5f, size.height * 0.38f),
                style = Stroke(width = sw)
            )
            drawCircle(
                color = color,
                radius = size.width * 0.07f,
                center = Offset(size.width * 0.5f, size.height * 0.38f)
            )
            drawLine(
                color = color,
                start = Offset(size.width * 0.5f, size.height * 0.64f),
                end = Offset(size.width * 0.5f, size.height * 0.94f),
                strokeWidth = sw,
                cap = StrokeCap.Round
            )
        }
    }
}
