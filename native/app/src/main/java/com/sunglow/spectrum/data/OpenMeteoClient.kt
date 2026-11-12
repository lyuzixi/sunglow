package com.sunglow.spectrum.data

import com.sunglow.spectrum.core.API_AQ
import com.sunglow.spectrum.core.API_FORECAST
import com.sunglow.spectrum.core.Series
import com.sunglow.spectrum.core.SeriesRow
import com.sunglow.spectrum.core.TzInfo
import com.sunglow.spectrum.core.wallIsoToReal
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.Locale
import java.util.concurrent.TimeUnit

/*
 * SUNGLOW · Open-Meteo 取数
 * 口径来源：v2/src/core/{api,series,mapload}.ts。
 * 单请求多坐标（逗号分隔）；429 不重试，其它错误最多再补 1 次。
 */

data class LatLon(val lat: Double, val lon: Double)

enum class WeatherErrorKind { NETWORK, TIMEOUT, RATE_LIMIT, HTTP }

class WeatherException(
    message: String,
    val kind: WeatherErrorKind,
    val status: Int? = null,
    val fatal: Boolean = false
) : Exception(message)

/** 给用户看的短文案（长文案由 core/Forecast.kt 统一组织） */
fun WeatherException.friendly(): String = when (kind) {
    WeatherErrorKind.NETWORK -> "连不上气象服务，请检查手机网络后重试。"
    WeatherErrorKind.TIMEOUT -> "气象接口响应超时，请稍后重试。"
    WeatherErrorKind.RATE_LIMIT -> "气象接口暂时限流，约一分钟后自动恢复。"
    WeatherErrorKind.HTTP -> "气象接口返回错误（HTTP ${status ?: "?"}），请稍后重试。"
}

private fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(14, TimeUnit.SECONDS)
    .writeTimeout(10, TimeUnit.SECONDS)
    .callTimeout(20, TimeUnit.SECONDS)
    .retryOnConnectionFailure(true)
    .build()

class OpenMeteoClient(
    private val client: OkHttpClient = defaultHttpClient()
) {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    suspend fun forecastBatched(
        model: String?,
        pts: List<LatLon>,
        startD: String,
        endD: String,
        vars: List<String>
    ): List<Series> = withContext(Dispatchers.IO) {
        val url = buildUrl(API_FORECAST, model, pts, startD, endD, vars.joinToString(","))
        parseSeriesList(get(url))
    }

    /** 气溶胶只在空气质量接口上提供；返回长度与 pts 对齐，取不到的位置是 null */
    suspend fun aqBatched(
        pts: List<LatLon>,
        startD: String,
        endD: String
    ): List<Series?> = withContext(Dispatchers.IO) {
        val url = buildUrl(API_AQ, null, pts, startD, endD, "aerosol_optical_depth")
        parseSeriesList(get(url)).map { s -> if (s.has("aerosol_optical_depth")) s else null }
    }

    private fun buildUrl(
        base: String,
        model: String?,
        pts: List<LatLon>,
        startD: String,
        endD: String,
        vars: String
    ): String {
        val b = base.toHttpUrl().newBuilder()
        b.addQueryParameter(
            "latitude",
            pts.joinToString(",") { String.format(Locale.US, "%.4f", it.lat) }
        )
        b.addQueryParameter(
            "longitude",
            pts.joinToString(",") { String.format(Locale.US, "%.4f", it.lon) }
        )
        b.addQueryParameter("hourly", vars)
        b.addQueryParameter("start_date", startD)
        b.addQueryParameter("end_date", endD)
        b.addQueryParameter("timezone", "auto")
        if (model != null) b.addQueryParameter("models", model)
        return b.build().toString()
    }

    /** 429 不重试；超时 / 网络错误 / 5xx 最多再补 1 次 */
    private fun get(url: String, retries: Int = 1): String {
        var last: Exception? = null
        for (i in 0..retries) {
            try {
                return execute(url)
            } catch (e: WeatherException) {
                last = e
                if (e.kind == WeatherErrorKind.RATE_LIMIT || e.fatal) throw e
            } catch (e: Exception) {
                last = e
            }
            if (i < retries) {
                try {
                    Thread.sleep(400L * (i + 1))
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    break
                }
            }
        }
        throw last ?: WeatherException("network", WeatherErrorKind.NETWORK)
    }

    private fun execute(url: String): String {
        val req = Request.Builder()
            .url(url)
            .header("User-Agent", "SUNGLOW-Android/1.0")
            .build()
        try {
            client.newCall(req).execute().use { resp ->
                val body = resp.body?.string().orEmpty()
                if (resp.code == 429) {
                    val fatal = body.contains("daily", ignoreCase = true) &&
                        Regex("limit|exceed|quota|rate", RegexOption.IGNORE_CASE).containsMatchIn(body)
                    throw WeatherException("rate-limited", WeatherErrorKind.RATE_LIMIT, 429, fatal)
                }
                if (!resp.isSuccessful) {
                    throw WeatherException("HTTP ${resp.code}", WeatherErrorKind.HTTP, resp.code)
                }
                return body
            }
        } catch (e: SocketTimeoutException) {
            throw WeatherException("timeout", WeatherErrorKind.TIMEOUT)
        } catch (e: IOException) {
            throw WeatherException(e.message ?: "network", WeatherErrorKind.NETWORK)
        }
    }

    private fun parseSeriesList(text: String): List<Series> {
        val root = json.parseToJsonElement(text)
        val items = if (root is JsonArray) root.toList() else listOf(root)
        return items.mapNotNull { parseSeries(it) }
    }

    private fun parseSeries(el: JsonElement): Series? {
        val obj = el as? JsonObject ?: return null
        val off = (obj["utc_offset_seconds"] as? JsonPrimitive)?.content?.toIntOrNull() ?: 0
        val iana = (obj["timezone"] as? JsonPrimitive)?.content?.takeIf { it.isNotBlank() }
        val tz = TzInfo(iana = iana, offsetSec = off, est = false)
        val hourly = obj["hourly"] as? JsonObject ?: return Series(emptyMap(), tz)
        val timeArr = (hourly["time"] as? JsonArray)
            ?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()
        val times = timeArr.map { wallIsoToReal(it, off) }
        val raw = LinkedHashMap<String, List<SeriesRow>>()
        for ((k, v) in hourly) {
            if (k == "time") continue
            val arr = v as? JsonArray ?: continue
            raw[k] = arr.mapIndexed { i, x ->
                SeriesRow(times.getOrElse(i) { 0.0 }, numOrNull(x))
            }
        }
        return Series(raw, tz)
    }

    private fun numOrNull(el: JsonElement): Double? {
        val p = el as? JsonPrimitive ?: return null
        if (p.content == "null") return null
        return p.content.toDoubleOrNull()?.takeIf { it.isFinite() }
    }
}
