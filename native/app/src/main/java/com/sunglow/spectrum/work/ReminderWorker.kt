package com.sunglow.spectrum.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.sunglow.spectrum.R
import com.sunglow.spectrum.MainActivity
import android.app.PendingIntent
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.sunglow.spectrum.core.ForecastEngine
import com.sunglow.spectrum.core.ForecastOutcome
import com.sunglow.spectrum.core.Period
import com.sunglow.spectrum.core.TzCache
import com.sunglow.spectrum.core.fmtClock
import com.sunglow.spectrum.core.todayInTz
import com.sunglow.spectrum.data.CityRepository
import com.sunglow.spectrum.data.ForecastStore
import com.sunglow.spectrum.data.OpenMeteoClient
import com.sunglow.spectrum.ui.i18n.gradeText

/*
 * 霞光提醒：每天清晨与午后各跑一次。
 * 先读磁盘快照，过期或缺失才联网；达到阈值且窗口尚未结束就发本地通知。
 */
class ReminderWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val prefs = ctx.getSharedPreferences("sunglow_prefs", Context.MODE_PRIVATE)
        if (!prefs.getBoolean("reminder_enabled", false)) return Result.success()

        val city = CityRepository(ctx).lastCity() ?: return Result.success()
        val period = if (inputData.getString("period") == "am") Period.AM else Period.PM
        val tz = TzCache.cityTz(city.lat, city.lon)
        val date = todayInTz(tz)
        val threshold = prefs.getInt("reminder_threshold", 45)

        var snap = ForecastStore.day(ctx, city.name, date)
        var ps = if (period == Period.AM) snap?.am else snap?.pm
        val stale = snap == null || System.currentTimeMillis() - snap.updatedAt > 4 * 3600_000L

        if (ps == null || stale) {
            when (val out = ForecastEngine(OpenMeteoClient()).run(city, date, period, false)) {
                is ForecastOutcome.Success -> {
                    ForecastStore.save(ctx, out.result)
                    snap = ForecastStore.day(ctx, city.name, date)
                    ps = if (period == Period.AM) snap?.am else snap?.pm
                }
                is ForecastOutcome.Failure -> if (ps == null) return Result.retry()
            }
        }

        val cur = ps ?: return Result.success()
        val p = cur.p
        if (!p.isFinite() || p < threshold) return Result.success()

        val now = System.currentTimeMillis()
        val wsMs = cur.windowStart
        val weMs = cur.windowEnd
        if (weMs != null && weMs < now) return Result.success()
        if (wsMs != null && wsMs > now + 8 * 3600_000L) return Result.success()

        val mark = "reminded_" + date + "_" + period.name
        if (prefs.getString(mark, "") == "1") return Result.success()
        if (!Notifications.canPost(ctx)) return Result.success()

        Notifications.ensureChannel(ctx)
        val title = ctx.getString(
            if (period == Period.AM) R.string.notif_title_am else R.string.notif_title_pm
        )
        val ws = wsMs?.let { fmtClock(it.toDouble(), tz) } ?: "—"
        val we = weMs?.let { fmtClock(it.toDouble(), tz) } ?: "—"
        val body = ctx.getString(R.string.notif_body, p.toInt(), gradeText(ctx, cur.grade), ws, we)

        val intent = Intent(ctx, MainActivity::class.java).apply {
            putExtra(MainActivity.EXTRA_CITY, city.name)
            putExtra(MainActivity.EXTRA_DATE, date)
            putExtra(MainActivity.EXTRA_PERIOD, if (period == Period.AM) "am" else "pm")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pi = PendingIntent.getActivity(
            ctx,
            if (period == Period.AM) 7201 else 7202,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notif = NotificationCompat.Builder(ctx, Notifications.CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_sunglow)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()
        NotificationManagerCompat.from(ctx)
            .notify(if (period == Period.AM) 7201 else 7202, notif)
        prefs.edit().putString(mark, "1").apply()
        return Result.success()
    }
}
