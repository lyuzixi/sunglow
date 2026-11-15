package com.sunglow.spectrum.ui

import com.sunglow.spectrum.R

/** 16 个可达目的地中的 15 个常规页面；第 16 个 Snapshot 由 pack 深链覆盖显示。 */
enum class AppPage(val titleRes: Int) {
    Conclusion(R.string.tab_conclusion),
    Trend(R.string.tab_trend),
    Field(R.string.tab_field),
    More(R.string.page_more),
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
        /** 目录里主动进入的 11 页；Snapshot 只通过只读 pack 进入。 */
        val menuPages = listOf(Compare, Share, Factors, Ray, Calib, Notes, Guide, About, Settings, Feedback, AppLab)

        fun fromTab(tab: Int): AppPage = when (tab) {
            1 -> Trend
            2 -> Field
            else -> Conclusion
        }
    }
}
