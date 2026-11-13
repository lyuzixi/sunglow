package com.sunglow.spectrum.ui

import androidx.compose.ui.graphics.Color

/*
 * SUNGLOW · 趋势冷青蓝色阶（N2）
 * 口径来源：v2/src/core/composecard.ts 的 TREND_RAMP = ["#EAF6FC", "#2E86C1"]
 * 与 mixHex：两端颜色线性插值，而不是「单色 + 透明度叠加」（那会把高值压成脏紫）。
 * 浅色：t = P/100 * 0.78；深色：从 #1B2436 起叠 0.28 + 0.54*t，保证低值格仍看得出边界。
 */

private val RAMP_FROM = Color(0xFFEAF6FC)
private val RAMP_TO = Color(0xFF2E86C1)
private val DARK_BASE = Color(0xFF1B2436)

private fun mix(a: Color, b: Color, t: Float): Color {
    val k = t.coerceIn(0f, 1f)
    return Color(
        red = a.red + (b.red - a.red) * k,
        green = a.green + (b.green - a.green) * k,
        blue = a.blue + (b.blue - a.blue) * k,
        alpha = 1f
    )
}

/** p 为出现概率（0–100）；dark 决定走哪套底 */
fun trendRampColor(p: Double, dark: Boolean): Color {
    val t = (p / 100.0).coerceIn(0.0, 1.0).toFloat()
    return if (dark) {
        mix(DARK_BASE, RAMP_TO, 0.28f + 0.54f * t)
    } else {
        mix(RAMP_FROM, RAMP_TO, t * 0.78f)
    }
}
