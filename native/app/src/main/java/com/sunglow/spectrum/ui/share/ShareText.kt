package com.sunglow.spectrum.ui.share

import android.content.Context
import com.sunglow.spectrum.R
import com.sunglow.spectrum.core.Period

/** 结论词：分享图卡与合成卡共用，随当前语言切换。 */
internal fun conclText(ctx: Context, p: Double): String {
    val key = when {
        p >= 70 -> R.string.concl_very_likely
        p >= 45 -> R.string.concl_worth
        p >= 25 -> R.string.concl_try
        else -> R.string.concl_unlikely
    }
    return ctx.getString(key)
}

/** 事件名（日出 / 日落）也随当前语言切换。 */
internal fun eventName(ctx: Context, period: Period): String =
    ctx.getString(if (period == Period.AM) R.string.event_sunrise else R.string.event_sunset)
