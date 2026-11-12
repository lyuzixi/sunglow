package com.sunglow.spectrum.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.sunglow.spectrum.MainActivity
import com.sunglow.spectrum.R
import com.sunglow.spectrum.core.TzCache
import com.sunglow.spectrum.core.fmtClock
import com.sunglow.spectrum.core.todayInTz
import com.sunglow.spectrum.data.CityRepository
import com.sunglow.spectrum.data.ForecastStore
import com.sunglow.spectrum.data.PeriodSnapshot
import com.sunglow.spectrum.ui.i18n.gradeText

/*
 * 小组件的绘制与刷新。
 * 数据只读磁盘快照，不在这里发网络请求；刷新由 WorkManager 或 App 主动触发。
 */

object WidgetUpdater {

    fun updateAll(ctx: Context) {
        val mgr = AppWidgetManager.getInstance(ctx)
        val ids = mgr.getAppWidgetIds(ComponentName(ctx, SunglowWidgetProvider::class.java))
        if (ids.isEmpty()) return
        val views = build(ctx)
        for (id in ids) mgr.updateAppWidget(id, views)
    }

    fun build(ctx: Context): RemoteViews {
        val views = RemoteViews(ctx.packageName, R.layout.widget_sunglow)
        val city = CityRepository(ctx).lastCity()
        if (city == null) {
            views.setTextViewText(R.id.widget_city, ctx.getString(R.string.widget_city_empty))
            views.setTextViewText(R.id.widget_footer, ctx.getString(R.string.widget_no_cache))
            views.setTextViewText(R.id.widget_am_p, "—")
            views.setTextViewText(R.id.widget_pm_p, "—")
            views.setTextViewText(R.id.widget_am_grade, "")
            views.setTextViewText(R.id.widget_pm_grade, "")
            attachClick(ctx, views, null, null, null)
            return views
        }

        val tz = TzCache.cityTz(city.lat, city.lon)
        val date = todayInTz(tz)
        val snap = ForecastStore.day(ctx, city.name, date)

        views.setTextViewText(R.id.widget_city, city.shortName)
        bindPeriod(ctx, views, true, snap?.am)
        bindPeriod(ctx, views, false, snap?.pm)

        val footer = if (snap != null && snap.updatedAt > 0) {
            ctx.getString(R.string.widget_updated, fmtClock(snap.updatedAt.toDouble(), tz))
        } else {
            ctx.getString(R.string.widget_no_cache)
        }
        views.setTextViewText(R.id.widget_footer, footer)
        attachClick(ctx, views, city.name, date, null)
        return views
    }

    private fun bindPeriod(ctx: Context, views: RemoteViews, am: Boolean, ps: PeriodSnapshot?) {
        val pView = if (am) R.id.widget_am_p else R.id.widget_pm_p
        val gView = if (am) R.id.widget_am_grade else R.id.widget_pm_grade
        if (ps == null || !ps.p.isFinite()) {
            views.setTextViewText(pView, "—")
            views.setTextViewText(gView, "")
            return
        }
        views.setTextViewText(pView, ps.p.toInt().toString() + "%")
        views.setTextViewText(gView, gradeText(ctx, ps.grade))
    }

    private fun attachClick(
        ctx: Context,
        views: RemoteViews,
        city: String?,
        date: String?,
        period: String?
    ) {
        val intent = Intent(ctx, MainActivity::class.java).apply {
            putExtra(MainActivity.EXTRA_CITY, city)
            putExtra(MainActivity.EXTRA_DATE, date)
            putExtra(MainActivity.EXTRA_PERIOD, period)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pi = PendingIntent.getActivity(
            ctx,
            7001,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(R.id.widget_root, pi)
    }
}
