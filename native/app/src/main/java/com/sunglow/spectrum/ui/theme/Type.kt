package com.sunglow.spectrum.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/*
 * SUNGLOW 设计令牌 · 字体
 *
 * 当前使用系统字体族（安卓为 Roboto + Noto Sans CJK）：
 *   · 展示字（标题、概率数字、品牌标）用 SansSerif + Bold + 负字距，靠字重与字号建立层级
 *   · 标签与数据用 Monospace + 宽字距，形成"仪器读数"的观感
 *
 * 品牌字体 Space Grotesk / Inter 为可变字重 TTF（约 1 MB），属于二进制资源，
 * 待具备 git 推送条件时再加：把 TTF 放入 res/font，用 Font(resId, weight,
 * variationSettings = FontVariation.Settings(FontVariation.weight(n))) 替换下面的两个族即可。
 * 令牌名（SpaceGrotesk / InterFamily）保持不变，替换时组件无需改动。
 */

val SpaceGrotesk: FontFamily = FontFamily.SansSerif

val InterFamily: FontFamily = FontFamily.SansSerif

private val Reading: FontFamily = FontFamily.SansSerif

val SunglowTypography = Typography(
    displayLarge = TextStyle(
        fontFamily = SpaceGrotesk,
        fontWeight = FontWeight.Bold,
        fontSize = 44.sp,
        lineHeight = 50.sp,
        letterSpacing = (-0.5).sp
    ),
    headlineLarge = TextStyle(
        fontFamily = SpaceGrotesk,
        fontWeight = FontWeight.Bold,
        fontSize = 28.sp,
        lineHeight = 34.sp
    ),
    headlineMedium = TextStyle(
        fontFamily = SpaceGrotesk,
        fontWeight = FontWeight.Bold,
        fontSize = 21.sp,
        lineHeight = 27.sp
    ),
    titleMedium = TextStyle(
        fontFamily = Reading,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 22.sp
    ),
    bodyLarge = TextStyle(
        fontFamily = Reading,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
        lineHeight = 25.sp
    ),
    bodyMedium = TextStyle(
        fontFamily = Reading,
        fontWeight = FontWeight.Normal,
        fontSize = 13.5.sp,
        lineHeight = 22.sp
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.Monospace,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        lineHeight = 15.sp,
        letterSpacing = 1.2.sp
    )
)
