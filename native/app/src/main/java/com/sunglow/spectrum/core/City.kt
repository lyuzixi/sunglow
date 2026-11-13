package com.sunglow.spectrum.core

import kotlinx.serialization.Serializable

/** 城市（数据来自 v2/src/core/citydata.ts，由 native/tools/gen-cities.mjs 生成资源） */
@Serializable
data class City(
    val name: String,
    val lon: Double,
    val lat: Double,
    val region: String = "",
    /** 英文名（网页 cityname.ts 的 EN_CITY，由 gen-cities.mjs 带入） */
    val enName: String = "",
    /** 繁体名（网页 cityname.ts 的 TW_CITY，只存差异项，空即用简体） */
    val twName: String = ""
) {
    /** 去掉行政后缀的短名，用于检索与窄屏显示 */
    val shortName: String
        get() = name.replace(Regex("(特别行政区|自治区|自治州|地区|市|省)$"), "").ifEmpty { name }

    val display: String
        get() = if (region.isBlank() || region == name) name else "$name · $region"

    /** 按语言取显示名：zh 用简体，hant 用繁体（无差异项则回简体），en 用英文名 */
    fun labelOf(lang: String): String = when (lang) {
        "en" -> enName.ifBlank { name }
        "zh_tw" -> twName.ifBlank { name }
        else -> name
    }
}
