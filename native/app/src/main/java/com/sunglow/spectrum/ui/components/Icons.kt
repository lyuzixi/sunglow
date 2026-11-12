package com.sunglow.spectrum.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/*
 * 矢量小图标：替代文字符号（↑ / ›），保证与网页同一种线条气质。
 * 统一 1.7dp 线宽、圆头端点。
 */

@Composable
fun ShareIcon(tint: Color, size: Dp = 16.dp) {
    Canvas(Modifier.size(size)) {
        val s = this.size.minDimension
        val sw = s * 0.095f
        val c = StrokeCap.Round
        /* 竖线 + 上箭头 */
        drawLine(tint, Offset(s * 0.5f, s * 0.66f), Offset(s * 0.5f, s * 0.1f), sw, cap = c)
        drawLine(tint, Offset(s * 0.28f, s * 0.32f), Offset(s * 0.5f, s * 0.09f), sw, cap = c)
        drawLine(tint, Offset(s * 0.72f, s * 0.32f), Offset(s * 0.5f, s * 0.09f), sw, cap = c)
        /* 托盘 */
        drawLine(tint, Offset(s * 0.16f, s * 0.66f), Offset(s * 0.16f, s * 0.9f), sw, cap = c)
        drawLine(tint, Offset(s * 0.16f, s * 0.9f), Offset(s * 0.84f, s * 0.9f), sw, cap = c)
        drawLine(tint, Offset(s * 0.84f, s * 0.9f), Offset(s * 0.84f, s * 0.66f), sw, cap = c)
    }
}

@Composable
fun ChevronRight(tint: Color, size: Dp = 14.dp) {
    Canvas(Modifier.size(size)) {
        val s = this.size.minDimension
        val sw = s * 0.12f
        drawLine(tint, Offset(s * 0.36f, s * 0.2f), Offset(s * 0.66f, s * 0.5f), sw, cap = StrokeCap.Round)
        drawLine(tint, Offset(s * 0.66f, s * 0.5f), Offset(s * 0.36f, s * 0.8f), sw, cap = StrokeCap.Round)
    }
}

/** 三个点：设置入口 */
@Composable
fun MoreIcon(tint: Color, size: Dp = 16.dp) {
    Canvas(Modifier.size(size)) {
        val s = this.size.minDimension
        val r = s * 0.085f
        drawCircle(tint, r, Offset(s * 0.22f, s * 0.5f))
        drawCircle(tint, r, Offset(s * 0.5f, s * 0.5f))
        drawCircle(tint, r, Offset(s * 0.78f, s * 0.5f))
    }
}

/** 勾：分享成功 */
@Composable
fun CheckIcon(tint: Color, size: Dp = 16.dp) {
    Canvas(Modifier.size(size)) {
        val s = this.size.minDimension
        val sw = s * 0.12f
        drawLine(tint, Offset(s * 0.2f, s * 0.52f), Offset(s * 0.42f, s * 0.74f), sw, cap = StrokeCap.Round)
        drawLine(tint, Offset(s * 0.42f, s * 0.74f), Offset(s * 0.82f, s * 0.26f), sw, cap = StrokeCap.Round)
    }
}

/** 刷新：环形箭头 */
@Composable
fun RefreshIcon(tint: Color, size: Dp = 16.dp) {
    Canvas(Modifier.size(size)) {
        val s = this.size.minDimension
        val sw = s * 0.1f
        drawArc(
            color = tint,
            startAngle = 40f,
            sweepAngle = 280f,
            useCenter = false,
            topLeft = Offset(s * 0.12f, s * 0.12f),
            size = androidx.compose.ui.geometry.Size(s * 0.76f, s * 0.76f),
            style = androidx.compose.ui.graphics.drawscope.Stroke(width = sw, cap = StrokeCap.Round)
        )
        drawLine(tint, Offset(s * 0.62f, s * 0.06f), Offset(s * 0.86f, s * 0.2f), sw, cap = StrokeCap.Round)
        drawLine(tint, Offset(s * 0.86f, s * 0.2f), Offset(s * 0.72f, s * 0.36f), sw, cap = StrokeCap.Round)
    }
}
