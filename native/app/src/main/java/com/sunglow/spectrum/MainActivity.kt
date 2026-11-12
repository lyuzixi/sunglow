package com.sunglow.spectrum

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.sunglow.spectrum.ui.HomeViewModel
import com.sunglow.spectrum.ui.SunglowApp
import com.sunglow.spectrum.ui.theme.SunglowTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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
}
