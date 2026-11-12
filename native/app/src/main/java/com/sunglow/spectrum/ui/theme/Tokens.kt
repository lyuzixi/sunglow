package com.sunglow.spectrum.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/*
 * SUNGLOW 设计令牌 · 语义层
 * 组件通过 SunglowTheme.tokens 取色，不在组件里判断深浅主题。
 */

@Immutable
data class SunglowColors(
    val bg: Color,
    val bg2: Color,
    val bg3: Color,
    val ink: Color,
    val muted: Color,
    val rule: Color,
    val ruleStrong: Color,
    val card: Color,
    val cardStrong: Color,
    val accent: Color,
    val accentAlt: Color,
    val accentCool: Color,
    val isDark: Boolean
)

val DarkColors = SunglowColors(
    bg = DarkTokens.bg,
    bg2 = DarkTokens.bg2,
    bg3 = DarkTokens.bg3,
    ink = DarkTokens.ink,
    muted = DarkTokens.muted,
    rule = DarkTokens.rule,
    ruleStrong = DarkTokens.ruleStrong,
    card = DarkTokens.card,
    cardStrong = DarkTokens.cardStrong,
    accent = SpectrumMagenta,
    accentAlt = SpectrumAmber,
    accentCool = SpectrumCyan,
    isDark = true
)

val LightColors = SunglowColors(
    bg = LightTokens.bg,
    bg2 = LightTokens.bg2,
    bg3 = LightTokens.bg3,
    ink = LightTokens.ink,
    muted = LightTokens.muted,
    rule = LightTokens.rule,
    ruleStrong = LightTokens.ruleStrong,
    card = LightTokens.card,
    cardStrong = LightTokens.cardStrong,
    accent = SpectrumMagenta,
    accentAlt = SpectrumAmber,
    accentCool = SpectrumCyan,
    isDark = false
)

/** 间距阶梯（4dp 基数，与网页的 rem 节奏对应） */
@Immutable
data class SunglowSpacing(
    val xs: Dp = 4.dp,
    val sm: Dp = 8.dp,
    val md: Dp = 12.dp,
    val lg: Dp = 16.dp,
    val xl: Dp = 24.dp,
    val xxl: Dp = 32.dp,
    val page: Dp = 20.dp
)

val LocalSunglowColors = staticCompositionLocalOf { DarkColors }
val LocalSunglowSpacing = staticCompositionLocalOf { SunglowSpacing() }
