package com.sunglow.spectrum.data

import android.content.Context
import com.sunglow.spectrum.core.City
import com.sunglow.spectrum.core.ForecastResult
import com.sunglow.spectrum.core.Period
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.security.MessageDigest
import java.util.Locale

/*
 * SUNGLOW · 完整结果的磁盘快照
 * 与 ForecastStore（只存结论数字，供小组件快读）不同，这里存整份 ForecastResult，
 * 冷启动时先读它把界面画出来，再让网络结果覆盖 —— 弱网/断网时也能看到上次的观测场。
 */

class CachedResult(val result: ForecastResult, val savedAt: Long)

object ResultCache {

    /* N5：对齐网页 6 小时口径（原先 36 小时，会白烧额度）；离线条另有 ForecastStore 兜底 */
    private const val TTL = com.sunglow.spectrum.core.RESULT_CACHE_TTL_MS
    private const val MAX = 24
    private const val VERSION = 2

    private val json = Json {
        ignoreUnknownKeys = true
        allowSpecialFloatingPointValues = true
        encodeDefaults = true
    }

    @Serializable
    private data class Envelope(
        val v: Int = 1,
        val savedAt: Long,
        val result: ForecastResult
    )

    private fun dirOf(ctx: Context): File = File(ctx.filesDir, "results")

    private fun keyOf(city: City, dateStr: String, period: Period): String =
        "v$VERSION|" + dateStr + "|" + period.name + "@" +
            String.format(Locale.US, "%.3f,%.3f", city.lat, city.lon)

    private fun fileOf(ctx: Context, key: String): File {
        val md = MessageDigest.getInstance("MD5").digest(key.toByteArray(Charsets.UTF_8))
        val name = md.joinToString("") { String.format(Locale.US, "%02x", it.toInt() and 0xff) }
        return File(dirOf(ctx), name + ".json")
    }

    fun save(ctx: Context, r: ForecastResult) {
        runCatching {
            val d = dirOf(ctx)
            if (!d.exists()) d.mkdirs()
            val env = Envelope(VERSION, System.currentTimeMillis(), r)
            fileOf(ctx, keyOf(r.city, r.dateStr, r.period))
                .writeText(json.encodeToString(Envelope.serializer(), env))
            prune(d)
        }
    }

    fun get(ctx: Context, city: City, dateStr: String, period: Period): CachedResult? =
        runCatching {
            val f = fileOf(ctx, keyOf(city, dateStr, period))
            if (!f.exists()) return@runCatching null
            val env = json.decodeFromString(Envelope.serializer(), f.readText())
            if (env.v != VERSION) return@runCatching null
            val age = System.currentTimeMillis() - env.savedAt
            if (age < 0 || age > TTL) return@runCatching null
            CachedResult(env.result, env.savedAt)
        }.getOrNull()

    fun clear(ctx: Context) {
        runCatching { dirOf(ctx).listFiles()?.forEach { it.delete() } }
    }

    private fun prune(d: File) {
        val files = d.listFiles()?.filter { it.isFile } ?: return
        if (files.size <= MAX) return
        files.sortedByDescending { it.lastModified() }.drop(MAX).forEach { it.delete() }
    }
}
