package com.sunglow.spectrum.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/* R2 · pack 互通：fixture 由网页 snapshot.ts 的 buildSharePack 真实生成 */
class PackCodecTest {

    private fun fixture(name: String): String =
        javaClass.classLoader!!.getResource("pack/$name")!!.readText().trim()

    @Test
    fun decodesWebPack() {
        val snap = decodePack(fixture("web-pack.txt"))
        assertNotNull(snap)
        snap!!
        assertEquals(2, PACK_VER)
        assertEquals("广州", snap.q.name)
        assertEquals("2026-11-13", snap.q.date)
        assertEquals("am", snap.q.period)
        assertEquals(listOf("point", "trend", "map"), snap.parts)
        assertEquals(1, snap.mapStride)
        assertTrue(snap.entries.size >= 3)
    }

    @Test
    fun expandsWebMapTo121Points() {
        val snap = decodePack(fixture("web-pack.txt"))!!
        val box = expandPackMap(snap.mapEntry)!!
        assertEquals(121, box.am.pts.size)
        assertEquals(121, box.pm.pts.size)
        assertEquals("点0", box.am.pts.first().name)
        assertEquals(23.1291, box.am.pts.first().lat, 0.001)
        assertEquals(0.28, box.am.pts.first().aod, 0.001)
        assertEquals("高积云", box.am.pts.first().type)
    }

    @Test
    fun readsPointSummary() {
        val s = packPointSummary(decodePack(fixture("web-pack.txt"))!!)!!
        assertEquals("广州市", s.name)
        assertEquals(62.0, s.p, 0.01)
        assertEquals(74.0, s.q, 0.01)
        assertEquals("you", s.grade)
        assertEquals("hi", s.confKey)
    }

    @Test
    fun rejectsBadPack() {
        assertNull(decodePack(null))
        assertNull(decodePack(""))
        assertNull(decodePack("x123"))
        assertNull(decodePack("z" + "A".repeat(50000)))
    }

    @Test
    fun roundTripEncode() {
        val snap = decodePack(fixture("web-pack.txt"))!!
        val pack = encodePack(snap.gen, snap.q, snap.entries)
        assertNotNull(pack)
        val again = decodePack(pack)
        assertNotNull(again)
        assertEquals(snap.q.name, again!!.q.name)
        assertEquals(snap.entries.size, again.entries.size)
        assertEquals(snap.parts, again.parts)
        assertTrue(pack!!.length <= PACK_MAX_CHARS)
    }
}
