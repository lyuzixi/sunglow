package com.sunglow.spectrum.core

import org.junit.Assert.assertEquals
import org.junit.Test

/*
 * N1 · 单位与时间显示回归
 * 期望值由 v2/src/core/units.ts 的公式直译（本批未把 units 样本纳入
 * gen-b2-baselines.mjs，后续可补成实时基准）。公制调用保持与 P2 完全一致。
 */
class UnitsTest {

    @Test
    fun metricMatchesWeb() {
        assertEquals("12 km", uDist(12.3))
        assertEquals("3.5 km", uDist(3.5))
        assertEquals("1.30 km", uAlt(1300.0))
        assertEquals("500 m", uAlt(500.0))
        assertEquals("15.1 km/h", uSpeed(4.2))
        assertEquals("16.0 °C", uTemp(16.0))
        assertEquals("00:00", uClock(0.0, false, 0))
    }

    @Test
    fun imperialAndHour12MatchWeb() {
        assertEquals("7.6 mi", uDist(12.3, 0, true))
        assertEquals("1640 ft", uAlt(500.0, true))
        assertEquals("9.4 mph", uSpeed(4.2, true))
        assertEquals("60.8 °F", uTemp(16.0, true))
        assertEquals("12:00 AM", uClock(0.0, true, 0))
    }

    @Test
    fun nullAndNonFiniteFallBackToDash() {
        assertEquals("—", uDist(null))
        assertEquals("—", uAlt(Double.NaN))
        assertEquals("—", uTemp(null))
        assertEquals("—", uClock(Double.POSITIVE_INFINITY))
    }
}
