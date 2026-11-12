package com.sunglow.spectrum.ui.i18n

import android.content.Context
import android.content.res.Configuration
import android.os.LocaleList
import com.sunglow.spectrum.R
import java.util.Locale

/*
 * SUNGLOW · 应用内语言
 * 三档：简体 / 繁體 / English。语言写入 prefs，MainActivity 在 attachBaseContext
 * 时套一层 Configuration，界面重建后资源文案随之切换。
 */

object Lang {
    const val ZH = "zh"
    const val ZH_TW = "zh_tw"
    const val EN = "en"

    private const val PREFS = "sunglow_prefs"
    private const val KEY = "lang"

    fun current(ctx: Context): String =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, ZH) ?: ZH

    fun save(ctx: Context, lang: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, lang).apply()
    }

    fun wrap(base: Context): Context {
        val locale = when (current(base)) {
            EN -> Locale.ENGLISH
            ZH_TW -> Locale.TRADITIONAL_CHINESE
            else -> Locale.SIMPLIFIED_CHINESE
        }
        val cfg = Configuration(base.resources.configuration)
        cfg.setLocale(locale)
        cfg.setLocales(LocaleList(locale))
        return base.createConfigurationContext(cfg)
    }

    fun labelRes(lang: String): Int = when (lang) {
        EN -> R.string.lang_en
        ZH_TW -> R.string.lang_zh_tw
        else -> R.string.lang_zh
    }
}
