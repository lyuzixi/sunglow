package com.sunglow.spectrum.ui.share

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import androidx.core.content.res.ResourcesCompat
import androidx.compose.ui.graphics.toArgb
import com.sunglow.spectrum.R
import com.sunglow.spectrum.core.ForecastResult
import com.sunglow.spectrum.core.QUALITY_BANDS
import com.sunglow.spectrum.core.VerdictView
import com.sunglow.spectrum.core.conclWord
import com.sunglow.spectrum.core.fmtClock
import com.sunglow.spectrum.core.glowWindow
import com.sunglow.spectrum.core.skyBandOf
import com.sunglow.spectrum.ui.i18n.gradeText
import com.sunglow.spectrum.ui.theme.DarkTokens
import com.sunglow.spectrum.ui.theme.LightTokens
import kotlin.math.max
import kotlin.math.roundToInt

/*
 * SUNGLOW · 自由合成卡（R3-2）
 * 只画已接入像素版式的模块：天色带 / 最佳观赏窗口 / 二维码。
 * 结论层与实拍报头是卡片固定层，不随模块开关消失。
 */
object ComposeCard {

    const val W = 1080f
    private const val M = 64f
    private const val BASE_IDS = "sky,window,qr"

    fun canRender(mods: List<String>): Boolean = mods.all { it in BASE_IDS.split(",") }

    fun render(
        ctx: Context,
        r: ForecastResult,
        view: VerdictView,
        dark: Boolean,
        mods: List<String>
    ): Bitmap {
        val on = mods.toSet()
        val skyOn = "sky" in on

        var h = 900f
        if (skyOn) h += 148f
        if ("window" in on) h += 96f
        if ("qr" in on) h += 252f
        h = h.coerceAtLeast(880f)

        val bmp = Bitmap.createBitmap(W.toInt(), h.toInt(), Bitmap.Config.ARGB_8888)
        val cv = Canvas(bmp)
        val bg = c(if (dark) DarkTokens.bg else LightTokens.bg)
        val ink = c(if (dark) DarkTokens.ink else LightTokens.ink)
        val muted = c(if (dark) DarkTokens.muted else LightTokens.muted)
        val faint = c(if (dark) DarkTokens.faint else LightTokens.faint)
        val accent = c(if (dark) DarkTokens.accent else LightTokens.accent)
        val amber = c(if (dark) DarkTokens.accentAlt else LightTokens.accentAlt)
        val cool = c(if (dark) DarkTokens.accentCool else LightTokens.accentCool)
        val rule = c(if (dark) DarkTokens.ruleStrong else LightTokens.ruleStrong)

        val display = runCatching { ResourcesCompat.getFont(ctx, R.font.space_grotesk) }.getOrNull()
        val sans = Typeface.create("sans-serif", Typeface.NORMAL)
        val sansBold = Typeface.create("sans-serif", Typeface.BOLD)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)

        fun txt(
            s: String,
            x: Float,
            y: Float,
            size: Float,
            color: Int,
            tf: Typeface? = sans,
            align: Paint.Align = Paint.Align.LEFT
        ) {
            paint.reset()
            paint.isAntiAlias = true
            paint.typeface = tf
            paint.textSize = size
            paint.color = color
            paint.textAlign = align
            cv.drawText(s, x, y, paint)
        }

        fun fillRound(x: Float, y: Float, w: Float, hh: Float, rad: Float, color: Int) {
            paint.reset()
            paint.isAntiAlias = true
            paint.color = color
            cv.drawRoundRect(RectF(x, y, x + w, y + hh), rad, rad, paint)
        }

        fun wrap(s: String, x: Float, y: Float, size: Float, color: Int, maxW: Float, lh: Float): Float {
            paint.reset()
            paint.isAntiAlias = true
            paint.typeface = sansBold
            paint.textSize = size
            paint.color = color
            var start = 0
            var yy = y
            while (start < s.length) {
                val n = paint.breakText(s.substring(start), true, maxW, null).coerceAtLeast(1)
                cv.drawText(s.substring(start, (start + n).coerceAtMost(s.length)), x, yy, paint)
                start += n
                yy += lh
            }
            return yy
        }

        cv.drawColor(bg)

        /* 报头：实拍照片 + 下沿渐隐 */
        val heroH = 300f
        val hero = runCatching { BitmapFactory.decodeResource(ctx.resources, R.drawable.hero_photo) }.getOrNull()
        if (hero != null) {
            val scale = max(W / hero.width, heroH / hero.height)
            val sw = W / scale
            val sh = heroH / scale
            val src = Rect(
                ((hero.width - sw) / 2f).toInt(),
                ((hero.height - sh) * 0.45f).toInt(),
                ((hero.width + sw) / 2f).toInt(),
                ((hero.height + sh) * 0.45f).toInt()
            )
            cv.drawBitmap(hero, src, RectF(0f, 0f, W, heroH), paint)
            hero.recycle()
        } else {
            fillRound(0f, 0f, W, heroH, 0f, if (dark) Color.parseColor("#1B2130") else Color.parseColor("#DCE3F0"))
        }
        paint.reset()
        paint.shader = LinearGradient(
            0f, heroH * 0.45f, 0f, heroH,
            intArrayOf(Color.TRANSPARENT, bg, bg),
            floatArrayOf(0f, 0.74f, 1f),
            Shader.TileMode.CLAMP
        )
        cv.drawRect(0f, heroH * 0.45f, W, heroH, paint)
        paint.shader = null

        paint.reset()
        paint.shader = LinearGradient(
            0f, 0f, W, 0f,
            intArrayOf(accent, amber, cool),
            null, Shader.TileMode.CLAMP
        )
        cv.drawRect(0f, 0f, W, 7f, paint)
        paint.shader = null

        txt(
            ctx.getString(R.string.app_name) + " · " + ctx.getString(R.string.brand_mark),
            M, 58f, 30f, if (dark) Color.parseColor("#E9EEFB") else Color.parseColor("#111A2C"), display
        )
        txt(ctx.getString(R.string.compose_title), W - M, 58f, 24f, faint, sans, Paint.Align.RIGHT)

        var y = 372f
        txt(r.city.name, M, y, 58f, ink, sansBold)
        y += 40f
        val periodWord = if (r.period == com.sunglow.spectrum.core.Period.AM) {
            ctx.getString(R.string.widget_am)
        } else {
            ctx.getString(R.string.widget_pm)
        }
        txt(r.dateStr + " · " + periodWord + " · " + r.evName + " " + fmtClock(r.evMs, r.tz), M, y, 28f, muted)

        /* 结论层 */
        y += 72f
        txt(ctx.getString(R.string.share_prob_p), M, y, 26f, faint)
        y += 14f
        val pTxt = view.p.roundToInt().toString()
        paint.reset()
        paint.isAntiAlias = true
        paint.typeface = display ?: sansBold
        paint.textSize = 176f
        val numW = paint.measureText(pTxt)
        txt(pTxt, M - 10f, y + 150f, 176f, ink, display ?: sansBold)
        txt("%", M + numW + 8f, y + 150f, 58f, muted, display ?: sans)

        val band = QUALITY_BANDS.firstOrNull { it.key == view.grade } ?: QUALITY_BANDS.last()
        val gColor = Color.parseColor(if (dark) band.dark else band.color)
        val gLabel = gradeText(ctx, view.grade)
        paint.reset()
        paint.isAntiAlias = true
        paint.textSize = 32f
        paint.typeface = sansBold
        val gw = paint.measureText(gLabel) + 60f
        fillRound(W - M - gw, y + 20f, gw, 66f, 33f, withAlpha(gColor, if (dark) 0x33 else 0x22))
        txt(gLabel, W - M - gw / 2f, y + 65f, 32f, gColor, sansBold, Paint.Align.CENTER)
        txt(
            ctx.getString(R.string.share_view_q, view.q.roundToInt().toString()),
            W - M, y + 118f, 25f, faint, sans, Paint.Align.RIGHT
        )
        y += 198f
        wrap(conclWord(view.p), M, y, 40f, ink, W - 2 * M, 50f)

        /* 天色带 */
        y += 78f
        if (skyOn) {
            txt(ctx.getString(R.string.share_sky_band), M, y, 25f, faint)
            y += 16f
            val bandH = 88f
            val bandW = W - 2 * M
            val sky = skyBandOf(r, System.currentTimeMillis().toDouble(), r.dateStr)
            if (sky != null) {
                val total = sky.segments.sumOf { it.weight.toDouble() }.takeIf { it > 0 } ?: 1.0
                cv.save()
                val clip = Path().apply {
                    addRoundRect(RectF(M, y, M + bandW, y + bandH), 12f, 12f, Path.Direction.CW)
                }
                cv.clipPath(clip)
                var x = M
                for (s in sky.segments) {
                    val w = (s.weight / total * bandW).toFloat()
                    paint.reset()
                    paint.color = duskColor(s.key, dark)
                    cv.drawRect(x, y, x + w + 1f, y + bandH, paint)
                    x += w
                }
                if (sky.winWidth > 0f) {
                    val wx = M + sky.winLeft * bandW
                    val ww = sky.winWidth * bandW
                    fillRound(wx, y, ww, bandH, 0f, withAlpha(Color.WHITE, if (dark) 0x24 else 0x30))
                    paint.reset()
                    paint.isAntiAlias = true
                    paint.style = Paint.Style.STROKE
                    paint.strokeWidth = 3f
                    paint.color = withAlpha(Color.WHITE, if (dark) 0xCC else 0xE6)
                    cv.drawRoundRect(RectF(wx, y + 1.5f, wx + ww, y + bandH - 1.5f), 8f, 8f, paint)
                    paint.style = Paint.Style.FILL
                }
                cv.restore()
                val markY = y + bandH + 28f
                for (m in sky.marks) {
                    val mx = (M + m.pct * bandW).coerceIn(M + 22f, W - M - 22f)
                    val align = when (m.align) {
                        -1 -> Paint.Align.LEFT
                        1 -> Paint.Align.RIGHT
                        else -> Paint.Align.CENTER
                    }
                    txt(m.time, mx, markY, 20f, faint, sans, align)
                }
            } else {
                fillRound(M, y, bandW, bandH, 12f, withAlpha(faint, 0x18))
                txt(ctx.getString(R.string.share_sky_none), M + 20f, y + 54f, 25f, faint)
            }
            y += 148f
        }

        /* 结论层之后按用户顺序绘制非锚定模块 */
        for (id in mods) {
            when (id) {
                "window" -> {
                    val win = glowWindow(
                        evMs = r.evMs,
                        isAM = r.period == com.sunglow.spectrum.core.Period.AM,
                        lat = r.city.lat,
                        lon = r.city.lon,
                        thNearDeg = r.sRT.geom.thNearDeg,
                        thFarDeg = r.sRT.geom.thFarDeg
                    )
                    txt(ctx.getString(R.string.share_best_window), M, y, 25f, faint)
                    y += 44f
                    txt(
                        if (win != null) fmtClock(win.first, r.tz) + " – " + fmtClock(win.second, r.tz) else "—",
                        M, y, 44f, ink, sansBold
                    )
                    txt(ctx.getString(R.string.compose_window_note), M, y + 32f, 22f, faint)
                    y += 96f
                }
                "qr" -> {
                    y += 16f
                    txt(ctx.getString(R.string.share_qr_title), M, y, 25f, faint)
                    y += 16f
                    val qs = 170f
                    fillRound(M - 8f, y - 8f, qs + 16f, qs + 16f, 14f, Color.WHITE)
                    val qr = ShareCard.qr(
                        com.sunglow.spectrum.core.shareUrlOf(r),
                        qs.toInt(),
                        Color.parseColor("#070B14"),
                        Color.WHITE
                    )
                    if (qr != null) {
                        cv.drawBitmap(qr, M, y, null)
                        qr.recycle()
                    }
                    txt(ctx.getString(R.string.share_scan_same_city), M + qs + 28f, y + 92f, 22f, faint)
                    y += 220f
                }
                else -> Unit
            }
        }

        /* 页脚 */
        y += 6f
        paint.reset()
        paint.color = rule
        cv.drawRect(M, y, W - M, y + 1.5f, paint)
        y += 46f
        txt(ctx.getString(R.string.app_name) + " · " + ctx.getString(R.string.brand_mark), M, y, 26f, ink, display)
        y += 32f
        txt(ctx.getString(R.string.home_data_credit), M, y, 20f, faint)
        return bmp
    }

    private fun c(color: androidx.compose.ui.graphics.Color): Int = color.toArgb()

    private fun withAlpha(color: Int, alpha: Int): Int =
        (color and 0x00FFFFFF) or ((alpha and 0xFF) shl 24)

    private fun duskColor(key: String, dark: Boolean): Int = when (key) {
        "night" -> Color.parseColor(if (dark) "#141A2A" else "#2A3346")
        "astronomy" -> Color.parseColor(if (dark) "#17223C" else "#38466B")
        "nautical" -> Color.parseColor(if (dark) "#243A66" else "#5D74A8")
        "civil" -> Color.parseColor(if (dark) "#4A5F9E" else "#94A6D8")
        "golden" -> Color.parseColor(if (dark) "#C98A46" else "#E2A25C")
        "sunset" -> Color.parseColor(if (dark) "#D7604A" else "#E9705B")
        else -> Color.parseColor(if (dark) "#2A3346" else "#5B6A88")
    }
}
