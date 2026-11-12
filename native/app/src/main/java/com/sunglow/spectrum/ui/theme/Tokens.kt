package com.sunglow.spectrum.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/*
 * SUNGLOW 设计令牌 · 语义层
 * 组件通过 SunglowTheme.colors 取色，不在组件里判断深浅主题。
 */

@Immutable
data class SunglowColors(
    val bg: Color,
    val bg2: Color,
    val bg3: Color,
    /** 玻璃卡片（半透明，叠在页面底色/光晕上） */
    val card: Color,
    val cardStrong: Color,
    /** 卡片内部的次级面板 */
    val glass: Color,
    val glassStrong: Color,
    val ink: Color,
    val muted: Color,
    /** 三级文字：单位、脚注、说明 */
    val faint: Color,
    val rule: Color,
    val ruleStrong: Color,
    val accent: Color,
    val accentAlt: Color,
    val accentCool: Color,
    val good: Color,
    val mid: Color,
    val bad: Color,
    val info: Color,
    val isDark: Boolean
) {
    /** 品红 → 琥珀 → 电离青，与网页 --spectrum 同序 */
    val spectrum: List<Color> get() = listOf(accent, accentAlt, accentCool)
}

val DarkColors = SunglowColors(
    bg = DarkTokens.bg,
    bg2 = DarkTokens.bg2,
    bg3 = DarkTokens.bg3,
    card = DarkTokens.card,
    cardStrong = DarkTokens.cardStrong,
    glass = DarkTokens.glass,
    glassStrong = DarkTokens.glassStrong,
    ink = DarkTokens.ink,
    muted = DarkTokens.muted,
    faint = DarkTokens.faint,
    rule = DarkTokens.rule,
    ruleStrong = DarkTokens.ruleStrong,
    accent = DarkTokens.accent,
    accentAlt = DarkTokens.accentAlt,
    accentCool = DarkTokens.accentCool,
    good = DarkTokens.good,
    mid = DarkTokens.mid,
    bad = DarkTokens.bad,
    info = DarkTokens.info,
    isDark = true
)

val LightColors = SunglowColors(
    bg = LightTokens.bg,
    bg2 = LightTokens.bg2,
    bg3 = LightTokens.bg3,
    card = LightTokens.card,
    cardStrong = LightTokens.cardStrong,
    glass = LightTokens.glass,
    glassStrong = LightTokens.glassStrong,
    ink = LightTokens.ink,
    muted = LightTokens.muted,
    faint = LightTokens.faint,
    rule = LightTokens.rule,
    ruleStrong = LightTokens.ruleStrong,
    accent = LightTokens.accent,
    accentAlt = LightTokens.accentAlt,
    accentCool = LightTokens.accentCool,
    good = LightTokens.good,
    mid = LightTokens.mid,
    bad = LightTokens.bad,
    info = LightTokens.info,
    isDark = false
)

/** 间距阶梯（4dp 基数，与网页 --sp-1…--sp-8 对应） */
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

/** 圆角阶梯，与网页 --r-sm / --r-md / --r-lg 对应 */
@Immutable
data class SunglowRadius(
    val sm: Dp = 8.dp,
    val md: Dp = 14.dp,
    val lg: Dp = 22.dp
)

val LocalSunglowColors = staticCompositionLocalOf { DarkColors }
val LocalSunglowSpacing = staticCompositionLocalOf { SunglowSpacing() }
val LocalSunglowRadius = staticCompositionLocalOf { SunglowRadius() }
