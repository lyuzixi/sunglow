package com.sunglow.spectrum

import android.app.Application
import android.content.Context
import com.sunglow.spectrum.data.CityRepository
import com.sunglow.spectrum.widget.WidgetUpdater
import com.sunglow.spectrum.work.Notifications
import com.sunglow.spectrum.work.ReminderScheduler

/**
 * 应用入口。
 * 主线程只做通知通道（系统要求早注册，耗时 <1 ms）；
 * 提醒排程、小组件刷新、城市表解析全部挪到后台线程 —— 这些会读盘/解析 29 KB
 * 资源，放在 onCreate 里做会直接拖慢首帧。
 */
class SunglowApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifications.ensureChannel(this)
        val app = this
        Thread {
            runCatching {
                /* 预热城市表：首次进入观测场/搜索时不再主线程解析 */
                CityRepository(app).cities
                val prefs = app.getSharedPreferences("sunglow_prefs", Context.MODE_PRIVATE)
                ReminderScheduler.sync(app, prefs.getBoolean("reminder_enabled", false))
                ReminderScheduler.ensureWidget(app)
                WidgetUpdater.updateAll(app)
            }
        }.apply {
            name = "sunglow-init"
            priority = Thread.MIN_PRIORITY
        }.start()
    }
}
