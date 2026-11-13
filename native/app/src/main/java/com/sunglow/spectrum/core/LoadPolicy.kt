package com.sunglow.spectrum.core

/*
 * SUNGLOW · 取数纪律（对齐网页 v2 的缓存口径）
 * ---------------------------------------------------------------------------
 * 三种模式，语义与网页一一对应：
 *   AUTO  —— 自动加载（进页面、切日期/时段）：**只看缓存**，绝不擅自取数；
 *            唯一例外是本会话还没取过数（冷启动首屏），那一次允许。
 *   CLICK —— 用户显式点了「更新」：缓存优先，有缓存就用缓存，没有才取数。
 *   FORCE —— 用户显式点了「刷新/重试」：绕开缓存，强制重新取。
 *
 * 为什么把决策写成纯函数：这条纪律是「额度纪律」的一部分（单点 51 / 地图 171 / 趋势 102），
 * 出错一次就是白烧额度，所以要在单测里能直接断言，而不是只能靠真机数请求。
 */

enum class LoadMode { AUTO, CLICK, FORCE }

data class LoadDecision(
    /** 这一轮到底要不要发网络请求 */
    val fetch: Boolean,
    /** 决策理由（界面与日志用） */
    val reason: String
)

/**
 * @param hasFreshCache 是否命中 6 小时内的缓存
 * @param autoFetchSpent 本会话是否已经做过一次自动加载（有就说明是切日期/时段这类二次进入）
 */
fun decideLoad(mode: LoadMode, hasFreshCache: Boolean, autoFetchSpent: Boolean): LoadDecision =
    when {
        mode == LoadMode.FORCE -> LoadDecision(true, "强制刷新，绕开缓存")
        hasFreshCache -> LoadDecision(false, "缓存命中，不重复取数")
        mode == LoadMode.CLICK -> LoadDecision(true, "用户显式触发")
        autoFetchSpent -> LoadDecision(false, "切日期/时段不自动取数，等用户点更新")
        else -> LoadDecision(true, "首次自动取数")
    }

/** 磁盘结果缓存的有效期：与网页 6 小时口径一致（内存缓存同值，见 ForecastCache.TTL） */
const val RESULT_CACHE_TTL_MS = 6L * 3600L * 1000L
