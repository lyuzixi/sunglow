package com.sunglow.spectrum.ui.screens

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** 合成器选择/顺序的持久化边界：脏 id 过滤、缺失 id 补齐、sky 强制第一位。 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ComposePrefsTest {

    private val ctx: Context = ApplicationProvider.getApplicationContext()

    @Before
    fun clear() {
        ctx.getSharedPreferences("compose_ui", Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test
    fun repairsDirtyStateAndKeepsSkyFirst() {
        ctx.getSharedPreferences("compose_ui", Context.MODE_PRIVATE).edit()
            .putStringSet("on", setOf("models", "bogus", "sky"))
            .putString("order", "models|qr|bogus")
            .commit()

        val (on, order) = ComposePrefs.load(ctx)
        assertEquals(setOf("sky", "models"), on)
        assertEquals("sky", order.first())
        assertEquals("models", order[1])
        assertEquals("qr", order[2])
        assertEquals(14, order.size)
        assertTrue(order.contains("window"))
    }

    @Test
    fun savesAndReloadsSelection() {
        ComposePrefs.save(ctx, setOf("sky", "trend", "models"), listOf("sky", "models", "trend"))
        val (on, order) = ComposePrefs.load(ctx)
        assertEquals(setOf("sky", "trend", "models"), on)
        assertEquals(listOf("sky", "models", "trend"), order.take(3))
        assertEquals(14, order.size)
    }
}
