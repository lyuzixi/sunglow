package com.sunglow.spectrum.work

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequest
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.util.Calendar
import java.util.concurrent.TimeUnit

/*
 * 定时任务编排：
 *   · 提醒：清晨 04:30 与午后 13:30 各一次（WorkManager 允许几分钟误差）
 *   · 小组件：每小时读一次磁盘快照并刷新
 */
object ReminderScheduler {

    private const val WORK_AM = "sunglow_reminder_am"
    private const val WORK_PM = "sunglow_reminder_pm"
    private const val WORK_WIDGET = "sunglow_widget_hourly"

    fun sync(ctx: Context, enabled: Boolean) {
        val wm = WorkManager.getInstance(ctx)
        wm.cancelUniqueWork(WORK_AM)
        wm.cancelUniqueWork(WORK_PM)
        if (!enabled) return
        wm.enqueueUniquePeriodicWork(WORK_AM, ExistingPeriodicWorkPolicy.UPDATE, daily("am", 4, 30))
        wm.enqueueUniquePeriodicWork(WORK_PM, ExistingPeriodicWorkPolicy.UPDATE, daily("pm", 13, 30))
    }

    fun ensureWidget(ctx: Context) {
        val req = PeriodicWorkRequestBuilder<WidgetRefreshWorker>(1, TimeUnit.HOURS).build()
        WorkManager.getInstance(ctx)
            .enqueueUniquePeriodicWork(WORK_WIDGET, ExistingPeriodicWorkPolicy.KEEP, req)
    }

    private fun daily(period: String, hour: Int, minute: Int): PeriodicWorkRequest =
        PeriodicWorkRequestBuilder<ReminderWorker>(24, TimeUnit.HOURS, 30, TimeUnit.MINUTES)
            .setInitialDelay(delayTo(hour, minute), TimeUnit.MILLISECONDS)
            .setInputData(workDataOf("period" to period))
            .build()

    private fun delayTo(hour: Int, minute: Int): Long {
        val now = Calendar.getInstance()
        val target = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        if (!target.after(now)) target.add(Calendar.DAY_OF_YEAR, 1)
        return target.timeInMillis - now.timeInMillis
    }
}
