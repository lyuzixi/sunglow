package com.sunglow.spectrum

import android.app.Application
import android.content.Context
import com.sunglow.spectrum.widget.WidgetUpdater
import com.sunglow.spectrum.work.Notifications
import com.sunglow.spectrum.work.ReminderScheduler

/** 应用入口：通知通道、提醒排程、小组件刷新都在这里初始化 */
class SunglowApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        val prefs = getSharedPreferences("sunglow_prefs", Context.MODE_PRIVATE)
        Notifications.ensureChannel(this)
        ReminderScheduler.sync(this, prefs.getBoolean("reminder_enabled", false))
        ReminderScheduler.ensureWidget(this)
        WidgetUpdater.updateAll(this)
    }
}
