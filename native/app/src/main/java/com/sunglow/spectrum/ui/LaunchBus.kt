package com.sunglow.spectrum.ui

import com.sunglow.spectrum.core.Period
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/*
 * 小组件 / 通知点击带过来的跳转目标。
 * MainActivity 在 onCreate / onNewIntent 写入，HomeViewModel 消费一次后清空。
 */

data class LaunchTarget(
    val cityName: String? = null,
    val dateStr: String? = null,
    val period: Period? = null
)

object LaunchBus {
    private val _target = MutableStateFlow<LaunchTarget?>(null)
    val target: StateFlow<LaunchTarget?> = _target

    fun emit(cityName: String?, dateStr: String?, period: String?) {
        if (cityName.isNullOrBlank() && dateStr.isNullOrBlank() && period.isNullOrBlank()) return
        _target.value = LaunchTarget(
            cityName = cityName,
            dateStr = dateStr,
            period = when (period) {
                "am" -> Period.AM
                "pm" -> Period.PM
                else -> null
            }
        )
    }

    fun clear() {
        _target.value = null
    }
}
