package com.sunglow.spectrum.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/*
 * SUNGLOW 主题入口
 * 深浅两套使用各自的语义令牌；Material 色板只用来承接系统组件
 * （弹层、水波纹），品牌色一律从 SunglowTheme.colors 取。
 */

private val DarkScheme = darkColorScheme(
    primary = SpectrumMagenta,
    secondary = SpectrumCyan,
    tertiary = SpectrumAmber,
    background = DarkTokens.bg,
    surface = DarkTokens.bg2,
    onBackground = DarkTokens.ink,
    onSurface = DarkTokens.ink,
    outline = DarkTokens.ruleStrong
)

private val LightScheme = lightColorScheme(
    primary = SpectrumMagenta,
    secondary = SpectrumCyan,
    tertiary = SpectrumAmber,
    background = LightTokens.bg,
    surface = LightTokens.bg2,
    onBackground = LightTokens.ink,
    onSurface = LightTokens.ink,
    outline = LightTokens.ruleStrong
)

object SunglowTheme {
    val colors: SunglowColors
        @Composable get() = LocalSunglowColors.current
    val spacing: SunglowSpacing
        @Composable get() = LocalSunglowSpacing.current
}

@Composable
fun SunglowTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colors = if (darkTheme) DarkColors else LightColors
    val scheme = if (darkTheme) DarkScheme else LightScheme

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !darkTheme
                isAppearanceLightNavigationBars = !darkTheme
            }
        }
    }

    CompositionLocalProvider(
        LocalSunglowColors provides colors,
        LocalSunglowSpacing provides SunglowSpacing()
    ) {
        MaterialTheme(
            colorScheme = scheme,
            typography = SunglowTypography,
            content = content
        )
    }
}
