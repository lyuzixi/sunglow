package com.sunglow.spectrum.core

import com.sunglow.spectrum.ui.AppPage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** R6 手机信息架构：4 Tab + 11 个上下文二级页 + pack 快照 = 16 个可达目的地。 */
class R6NavigationTest {
    @Test fun fourBottomTabs() = assertEquals(4, AppPage.TAB_COUNT)

    @Test fun noMoreDirectory() = assertFalse(AppPage.secondaryPages.any { it.name == "More" })

    @Test fun elevenContextPagesRemain() = assertEquals(11, AppPage.secondaryPages.size)

    @Test fun sixteenDestinationsRemain() = assertEquals(16, AppPage.REACHABLE_DESTINATIONS)

    @Test fun contextPagesAreUnique() =
        assertEquals(AppPage.secondaryPages.size, AppPage.secondaryPages.distinct().size)

    @Test fun snapshotIsPackOnly() =
        assertFalse(AppPage.secondaryPages.any { it.name == "Snapshot" })

    @Test fun everyContextPageHasTitle() =
        assertTrue(AppPage.secondaryPages.all { it.titleRes != 0 })
}
