package com.sunglow.spectrum

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.sunglow.spectrum.ui.SunglowApp
import com.sunglow.spectrum.ui.theme.SunglowTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            SunglowTheme {
                SunglowApp()
            }
        }
    }
}
