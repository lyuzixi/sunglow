package com.sunglow.spectrum.ui

import com.sunglow.spectrum.R

/**
 * R6 手机信息架构：
 * 4 个底部 Tab（预报 / 趋势 / 观测场 / 我的）+ 11 个上下文二级页 + pack 快照覆盖页。
 * 不再有「更多 / 目录」页面；入口由当前任务上下文、观测场工具面板或「我的」提供。
 */
enum class AppPage(val titleRes: Int) {
    Conclusion(R.string.tab_conclusion),
    Trend(R.string.tab_trend),
    Field(R.string.tab_field),
    Compare(R.string.page_compare),
    Share(R.string.share_title),
    Factors(R.string.page_factors),
    Ray(R.string.page_ray),
    Calib(R.string.page_calib),
    Notes(R.string.page_notes),
    Guide(R.string.page_guide),
    About(R.string.about_title),
    Settings(R.string.settings_title),
    Feedback(R.string.settings_feedback),
    AppLab(R.string.page_app_lab);

    companion object {
        const val TAB_COUNT = 4

        /** 不再展示为目录；每一项都必须从上下文页面直接进入。 */
        val secondaryPages = listOf(
            Compare, Share, Factors, Ray, Calib, Notes, Guide, About, Settings, Feedback, AppLab
        )

        /** 4 Tab + 11 二级页 + pack 快照覆盖页 = 16 个可达目的地。 */
        const val REACHABLE_DESTINATIONS = TAB_COUNT + 11 + 1

        fun fromTab(tab: Int): AppPage = when (tab) {
            1 -> Trend
            2 -> Field
            else -> Conclusion
        }
    }
}
