package com.sunglow.spectrum.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max

/*
 * R1 · 观测场网格口径
 * 对齐 v2/src/core/mapdata.ts 的 buildLocalGrid：
 * 13×13 包围盒、500 km 半径过滤、80 km 格距，正好 121 点。
 * 这里只测几何，不联网；取数与评分由 FieldGoldenTest / B2 基准覆盖。
 */
class HeatGridLayoutTest {

    private val beijing = 39.9042 to 116.4074

    @Test
    fun `grid has exactly 121 nodes and four corners are holes`() {
        val nodes = heatNodesOf(beijing.first, beijing.second)
        assertEquals(121, nodes.size)
        assertEquals(121, nodes.map { it.i to it.j }.toSet().size)
        assertFalse("西北角应被半径过滤", nodes.any { it.i == 0 && it.j == 0 })
        assertFalse("东北角应被半径过滤", nodes.any { it.i == 0 && it.j == 12 })
        assertFalse("西南角应被半径过滤", nodes.any { it.i == 12 && it.j == 0 })
        assertFalse("东南角应被半径过滤", nodes.any { it.i == 12 && it.j == 12 })
    }

    @Test
    fun `frame matches web constants`() {
        val f = heatFrameOf(beijing.first, beijing.second)
        assertEquals(13.0, f[0], 0.0)
        assertEquals(80.0 / 110.574, f[3], 1e-9)
        val dLo = 80.0 / (111.32 * max(0.15, cos(Math.toRadians(beijing.first))))
        assertEquals(dLo, f[4], 1e-9)
        assertEquals(beijing.first + 6 * f[3], f[1], 1e-9)
        assertEquals(beijing.second - 6 * f[4], f[2], 1e-9)
    }

    @Test
    fun `center node sits on the city and every node is inside 500 km`() {
        val nodes = heatNodesOf(beijing.first, beijing.second)
        val center = nodes.single { it.i == 6 && it.j == 6 }
        assertEquals(beijing.first, center.lat, 1e-9)
        assertEquals(beijing.second, center.lon, 1e-9)
        nodes.forEach { n ->
            assertTrue(
                "点 (${n.i},${n.j}) 超出半径",
                haversineKm(beijing.first, beijing.second, n.lat, n.lon) <= 500.0 + 0.5
            )
        }
        val span = 80.0 * 12
        assertEquals(960.0, span, 0.0)
    }

    @Test
    fun `longitude spacing shrinks at high latitude`() {
        val north = heatFrameOf(60.0, 20.0)[4]
        val south = heatFrameOf(20.0, 20.0)[4]
        assertTrue("高纬经度格距应更大", north > south)
        assertEquals(abs(north - 80.0 / (111.32 * max(0.15, cos(Math.toRadians(60.0))))), 0.0, 1e-9)
    }
}
