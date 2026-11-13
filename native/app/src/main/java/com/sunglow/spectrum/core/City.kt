package com.sunglow.spectrum.core

import kotlinx.serialization.Serializable

/** 城市（数据来自 v2/src/core/citydata.ts，由 native/tools/gen-cities.mjs 生成资源） */
@Serializable
data class City(
    val name: String,
    val lon: Double,
    val lat: Double,
    val region: String = ""
) {
    /** 去掉行政后缀的短名，用于检索与窄屏显示 */
    val shortName: String
        get() = name.replace(Regex("(特别行政区|自治区|自治州|地区|市|省)$"), "").ifEmpty { name }

    val display: String
        get() = if (region.isBlank() || region == name) name else "$name · $region"
}
