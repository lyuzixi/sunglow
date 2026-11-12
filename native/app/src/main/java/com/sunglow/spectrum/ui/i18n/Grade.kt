package com.sunglow.spectrum.ui.i18n

import android.content.Context
import com.sunglow.spectrum.R

/** 等级键（优/良/一般/差）走资源，供小组件与通知显示 */
fun gradeText(ctx: Context, grade: String): String = when (grade) {
    "优" -> ctx.getString(R.string.grade_you)
    "良" -> ctx.getString(R.string.grade_liang)
    "一般" -> ctx.getString(R.string.grade_yiban)
    "差" -> ctx.getString(R.string.grade_cha)
    else -> grade
}
