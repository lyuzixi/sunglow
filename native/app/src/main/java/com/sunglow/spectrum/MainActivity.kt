package com.sunglow.spectrum

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.sunglow.spectrum.ui.HomeViewModel
import com.sunglow.spectrum.ui.LaunchBus
import com.sunglow.spectrum.ui.SunglowApp
import com.sunglow.spectrum.ui.i18n.Lang
import com.sunglow.spectrum.ui.theme.SunglowTheme

class MainActivity : ComponentActivity() {

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(Lang.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIntent(intent)
        enableEdgeToEdge()
        setContent {
            val vm: HomeViewModel = viewModel()
            val state by vm.state.collectAsStateWithLifecycle()
            val dark = when (state.themeMode) {
                1 -> true
                2 -> false
                else -> isSystemInDarkTheme()
            }
            SunglowTheme(darkTheme = dark) {
                SunglowApp(vm)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    /** 小组件 / 通知点击，或网页分享链接（?name=&date=&period=）带进来的目标 */
    private fun handleIntent(intent: Intent?) {
        if (intent == null) return
        val data = intent.data
        /* 网页 URL 明确给 date / period 时优先于 Intent extra（与网页 urlstate 口径一致） */
        LaunchBus.emit(
            cityName = intent.getStringExtra(EXTRA_CITY) ?: data?.getQueryParameter("name"),
            dateStr = data?.getQueryParameter("date") ?: intent.getStringExtra(EXTRA_DATE),
            period = data?.getQueryParameter("period") ?: intent.getStringExtra(EXTRA_PERIOD)
        )
    }

    companion object {
        const val EXTRA_CITY = "sunglow.extra.city"
        const val EXTRA_DATE = "sunglow.extra.date"
        const val EXTRA_PERIOD = "sunglow.extra.period"
    }
}
