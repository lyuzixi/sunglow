package com.sunglow.spectrum.core

/** 进程内显示偏好；由 HomeViewModel 从 SharedPreferences 恢复并写回。 */
object DisplayPrefs {
    @Volatile var imperial: Boolean = false
    @Volatile var hour12: Boolean = false
    /** 0=隐藏，1=照片，2=照片+霞光，3=仅霞光。 */
    @Volatile var photoMode: Int = 2
}
