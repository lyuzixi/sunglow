package com.sunglow.spectrum.ui.i18n

import android.content.Context
import com.sunglow.spectrum.R

/** 等级键（优/良/一般/差）走资源，供小组件与通知显示 */
fun gradeText(ctx: Context, grade: String): String = when (grade) {
    com.sunglow.spectrum.core.GRADE_YOU -> ctx.getString(R.string.grade_you)
    com.sunglow.spectrum.core.GRADE_LIANG -> ctx.getString(R.string.grade_liang)
    com.sunglow.spectrum.core.GRADE_YIBAN -> ctx.getString(R.string.grade_yiban)
    com.sunglow.spectrum.core.GRADE_CHA -> ctx.getString(R.string.grade_cha)
    else -> grade
}
