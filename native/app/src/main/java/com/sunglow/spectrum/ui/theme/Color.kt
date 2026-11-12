package com.sunglow.spectrum.ui.theme

import androidx.compose.ui.graphics.Color

/*
 * SUNGLOW 设计令牌 · 颜色
 * 口径来源：v2/src/styles/tokens.css。深浅两套共用同一组语义名，
 * 组件里不允许出现裸色值。
 */

// ---- 品牌光谱（两套主题共用） ----
val SpectrumMagenta = Color(0xFFFF4D82)
val SpectrumAmber = Color(0xFFFF9C3F)
val SpectrumCyan = Color(0xFF2ED5E8)

// ---- 深色：大气光谱观测站 ----
object DarkTokens {
    val bg = Color(0xFF070B14)
    val bg2 = Color(0xFF0B1220)
    val bg3 = Color(0xFF111C30)
    val ink = Color(0xFFE9EEFB)
    val muted = Color(0xFF93A4C3)
    val rule = Color(0x1AFFFFFF)
    val ruleStrong = Color(0x33FFFFFF)
    val card = Color(0x09FFFFFF)
    val cardStrong = Color(0x0FFFFFFF)
}

// ---- 浅色：晨光实验室 ----
object LightTokens {
    val bg = Color(0xFFF5F7FB)
    val bg2 = Color(0xFFFFFFFF)
    val bg3 = Color(0xFFEDF1F8)
    val ink = Color(0xFF101725)
    val muted = Color(0xFF5C6A82)
    val rule = Color(0x14000000)
    val ruleStrong = Color(0x29000000)
    val card = Color(0xFFFFFFFF)
    val cardStrong = Color(0xFFFFFFFF)
}
