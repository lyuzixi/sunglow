package com.sunglow.spectrum.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/*
 * N5 · 取数纪律门禁
 * ---------------------------------------------------------------------------
 * 额度是稀缺资源（单点 51 / 地图 171 / 趋势 102），「不取数」必须能被断言，
 * 而不是只靠人肉观察。这组断言锁住三条规矩：
 *   1. 自动加载（AUTO）只读缓存，命中就一个请求都不发；
 *   2. 切日期/切时段绝不自动取数（会话里已经自动取过一次之后）；
 *   3. 只有用户显式动作（点击更新 / 刷新）才允许发请求。
 */
class LoadPolicyTest {

    @Test
    fun `auto load never refetches when cache is fresh`() {
        val d = decideLoad(LoadMode.AUTO, hasFreshCache = true, autoFetchSpent = false)
        assertFalse("缓存命中时不得发请求", d.fetch)
    }

    @Test
    fun `switching date does not auto fetch`() {
        /* 会话里已经自动取过一次 → 再切日期没有新鲜缓存时也不取数 */
        val d = decideLoad(LoadMode.AUTO, hasFreshCache = false, autoFetchSpent = true)
        assertFalse("切日期不得自动取数", d.fetch)
        assertTrue(d.reason.contains("不自动取数"))
    }

    @Test
    fun `first auto load is allowed to fetch`() {
        val d = decideLoad(LoadMode.AUTO, hasFreshCache = false, autoFetchSpent = false)
        assertTrue("冷启动首屏允许取一次数", d.fetch)
    }

    @Test
    fun `click prefers cache but fetches when cache is missing`() {
        assertFalse("点击更新时优先用缓存", decideLoad(LoadMode.CLICK, true, true).fetch)
        assertTrue("没有缓存时点击才取数", decideLoad(LoadMode.CLICK, false, true).fetch)
    }

    @Test
    fun `force always bypasses cache`() {
        assertTrue("强制刷新必须绕开缓存", decideLoad(LoadMode.FORCE, true, true).fetch)
        assertTrue(decideLoad(LoadMode.FORCE, false, true).fetch)
    }

    @Test
    fun `result cache ttl matches web six hours`() {
        assertEquals("磁盘缓存 TTL 必须与网页口径一致（6 小时）", 6L * 3600L * 1000L, RESULT_CACHE_TTL_MS)
    }
}
