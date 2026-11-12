package com.sunglow.spectrum.ui.theme

import androidx.compose.ui.graphics.Color

/*
 * SUNGLOW 设计令牌 · 颜色
 * 口径来源：v2/src/styles/tokens.css（深色「大气光谱观测站」/ 浅色「晨光实验室」）。
 * 深浅两套共用同一组语义名，组件里不允许出现裸色值。
 */

// ---- 品牌光谱（暗色主题下直接使用；浅色主题另有一套加深版） ----
val SpectrumMagenta = Color(0xFFFF4D82)
val SpectrumAmber = Color(0xFFFF9C3F)
val SpectrumCyan = Color(0xFF2ED5E8)

// ---- 曙暮光五段（与网页 --dusk-* 同值，不随主题变化） ----
val DuskDay = Color(0xFF3A4354)
val DuskCivil = Color(0xFFE8B678)
val DuskNautical = Color(0xFFCF6F42)
val DuskAstro = Color(0xFF6F6A92)
val DuskNight = Color(0xFF1E2536)

// ---- 深色：大气光谱观测站 ----
object DarkTokens {
    val bg = Color(0xFF070B14)
    val bg2 = Color(0xFF0B1220)
    val bg3 = Color(0xFF101A2E)

    /** rgba(15, 23, 42, 0.62) —— 玻璃卡片 */
    val card = Color(0x9E0F172A)
    val cardStrong = Color(0xFF101A2E)
    val glass = Color(0x0F82A0DC)
    val glassStrong = Color(0x1A82A0DC)

    val ink = Color(0xFFE9EEFB)
    val muted = Color(0xFFA0B1CD)
    val faint = Color(0xFF7F8FB0)

    /** rgba(148, 178, 232, 0.14) 发丝线 */
    val rule = Color(0x2494B2E8)
    val ruleStrong = Color(0x4294B2E8)

    val accent = SpectrumMagenta
    val accentAlt = SpectrumAmber
    val accentCool = SpectrumCyan

    val good = Color(0xFF5FCE97)
    val mid = Color(0xFFE2B45E)
    val bad = Color(0xFFF2796A)
    val info = Color(0xFF7AB8FF)
}

// ---- 浅色：晨光实验室 ----
object LightTokens {
    val bg = Color(0xFFF2F5FB)
    val bg2 = Color(0xFFFFFFFF)
    val bg3 = Color(0xFFE8EDF7)

    /** rgba(255, 255, 255, 0.72) */
    val card = Color(0xB8FFFFFF)
    val cardStrong = Color(0xFFFFFFFF)
    val glass = Color(0x8CFFFFFF)
    val glassStrong = Color(0xC7FFFFFF)

    val ink = Color(0xFF111A2C)
    val muted = Color(0xFF46556F)
    val faint = Color(0xFF667287)

    val rule = Color(0x1A283C64)
    val ruleStrong = Color(0x33283C64)

    val accent = Color(0xFFE02D62)
    val accentAlt = Color(0xFFE07A1C)
    val accentCool = Color(0xFF0F9FBF)

    val good = Color(0xFF16794A)
    val mid = Color(0xFF965D06)
    val bad = Color(0xFFC0392B)
    val info = Color(0xFF2266BB)
}
