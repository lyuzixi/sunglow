package com.sunglow.spectrum.ui.share

import android.content.Context
import com.sunglow.spectrum.R

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
