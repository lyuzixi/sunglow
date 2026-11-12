package com.sunglow.spectrum.work

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.sunglow.spectrum.widget.WidgetUpdater

/** 每小时把磁盘快照同步到桌面小组件，不发网络请求 */
class WidgetRefreshWorker(
    appContext: Context,
    params: WorkerParameters
) : Worker(appContext, params) {
    override fun doWork(): Result {
        WidgetUpdater.updateAll(applicationContext)
        return Result.success()
    }
}
