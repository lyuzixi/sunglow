package com.sunglow.spectrum.ui.share

import android.content.Context
import android.content.Intent
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
import androidx.core.content.FileProvider
import androidx.core.content.res.ResourcesCompat
import androidx.compose.ui.graphics.toArgb
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.sunglow.spectrum.R
import com.sunglow.spectrum.core.ForecastResult
import com.sunglow.spectrum.core.HeatGrid
import com.sunglow.spectrum.core.QUALITY_BANDS
import com.sunglow.spectrum.core.QUALITY_LABEL
import com.sunglow.spectrum.core.VerdictView
import com.sunglow.spectrum.core.captionOf
import com.sunglow.spectrum.core.conclWord
import com.sunglow.spectrum.core.fmtClock
import com.sunglow.spectrum.core.glowWindow
import com.sunglow.spectrum.core.isNum
import com.sunglow.spectrum.core.shareFileNameOf
import com.sunglow.spectrum.core.skyBandOf
import com.sunglow.spectrum.core.uDist
import com.sunglow.spectrum.ui.theme.DarkTokens
import com.sunglow.spectrum.ui.theme.LightTokens
import java.io.File
import java.io.FileOutputStream
import java.util.Locale
import kotlin.math.max
import kotlin.math.roundToInt

/*
 * SUNGLOW · 竖版分享图卡
 * 口径对齐网页 v2/src/core/sharecard.ts：实拍报头 + 读数 + 天色带 + 事实 + 二维码。
 * 画布固定 1080×1440，纯 Canvas 手绘，不依赖截图或外部渲染。
 */

object ShareCard {

    const val W = 1080f
    const val H = 1440f

    /** 画一张图卡；dark 决定用哪套令牌。template 0＝结论版，1＝地图版（需 heat） */
    fun render(
        ctx: Context,
        r: ForecastResult,
        view: VerdictView,
        dark: Boolean,
        template: Int = 0,
        heat: HeatGrid? = null
    ): Bitmap {
        val bmp = Bitmap.createBitmap(W.toInt(), H.toInt(), Bitmap.Config.ARGB_8888)
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
        ): Float {
            paint.reset()
            paint.isAntiAlias = true
            paint.typeface = tf
            paint.textSize = size
            paint.color = color
            paint.textAlign = align
            cv.drawText(s, x, y, paint)
            return paint.measureText(s)
        }

        fun fillRound(x: Float, y: Float, w: Float, h: Float, rad: Float, color: Int) {
            paint.reset()
            paint.isAntiAlias = true
            paint.color = color
            cv.drawRoundRect(RectF(x, y, x + w, y + h), rad, rad, paint)
        }

        /* 底 */
        cv.drawColor(bg)

        /* 顶部报头：同一张实拍照片，下沿渐隐到卡片底色 */
        val heroH = 340f
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
            0f, heroH * 0.42f, 0f, heroH,
            intArrayOf(Color.TRANSPARENT, bg, bg),
            floatArrayOf(0f, 0.72f, 1f),
            Shader.TileMode.CLAMP
        )
        cv.drawRect(0f, heroH * 0.42f, W, heroH, paint)
        paint.shader = LinearGradient(
            0f, 0f, 0f, 136f,
            intArrayOf(Color.parseColor(if (dark) "#8C070B14" else "#CCFFFFFF"), Color.TRANSPARENT),
            null, Shader.TileMode.CLAMP
        )
        cv.drawRect(0f, 0f, W, 136f, paint)
        paint.shader = null

        /* 顶部光谱线 */
        paint.reset()
        paint.shader = LinearGradient(
            0f, 0f, W, 0f,
            intArrayOf(accent, amber, cool),
            null, Shader.TileMode.CLAMP
        )
        cv.drawRect(0f, 0f, W, 7f, paint)
        paint.shader = null

        txt(ctx.getString(R.string.app_name) + " · " + ctx.getString(R.string.brand_mark), 64f, 62f, 30f, if (dark) Color.parseColor("#E9EEFB") else Color.parseColor("#111A2C"), display)
        txt(
            ctx.getString(R.string.share_photo_caption), W - 64f, 62f, 24f,
            if (dark) Color.parseColor("#B8C4DC") else Color.parseColor("#46556F"),
            sans, Paint.Align.RIGHT
        )

        /* 城市与日期 */
        val cityTop = 424f
        txt(r.city.name, 64f, cityTop, 58f, ink, sansBold)
        val periodWord = if (r.period == com.sunglow.spectrum.core.Period.AM) ctx.getString(R.string.widget_am) else ctx.getString(R.string.widget_pm)
        val dateLine = r.dateStr + " · " + periodWord + " · " + r.evName + " " + fmtClock(r.evMs, r.tz)
        txt(dateLine, 64f, cityTop + 40f, 30f, muted)

        if (view.single) {
            val label = view.label
            paint.reset()
            paint.isAntiAlias = true
            paint.textSize = 24f
            paint.typeface = sans
            val tw = paint.measureText(label)
            val pw = tw + 40f
            val px = W - 64f - pw
            fillRound(px, cityTop - 40f, pw, 46f, 23f, withAlpha(accent, if (dark) 0x26 else 0x1F))
            txt(label, px + 20f, cityTop - 8f, 24f, accent)
        }

        /* 概率大字 */
        txt(ctx.getString(R.string.share_prob_p), 64f, 566f, 26f, faint)
        val pTxt = view.p.roundToInt().toString()
        val numSize = 190f
        paint.reset()
        paint.isAntiAlias = true
        paint.typeface = display ?: sansBold
        paint.textSize = numSize
        val numW = paint.measureText(pTxt)
        txt(pTxt, 54f, 728f, numSize, ink, display ?: sansBold)
        txt("%", 64f + numW + 10f, 728f, 62f, muted, display ?: sans)

        /* 等级胶囊：与技术读数同一行右侧 */
        val band = QUALITY_BANDS.firstOrNull { it.key == view.grade } ?: QUALITY_BANDS.last()
        val gColor = Color.parseColor(if (dark) band.dark else band.color)
        val gLabel = com.sunglow.spectrum.ui.i18n.gradeText(ctx, view.grade)
        paint.reset()
        paint.isAntiAlias = true
        paint.textSize = 34f
        paint.typeface = sansBold
        val gw = paint.measureText(gLabel) + 64f
        fillRound(W - 64f - gw, 640f, gw, 72f, 36f, withAlpha(gColor, if (dark) 0x33 else 0x22))
        txt(gLabel, W - 64f - gw / 2f, 691f, 34f, gColor, sansBold, Paint.Align.CENTER)
        txt(ctx.getString(R.string.share_view_q, view.q.roundToInt().toString()), W - 64f, 748f, 26f, faint, sans, Paint.Align.RIGHT)

        /* 结论句 */
        txt(conclWord(view.p), 64f, 812f, 42f, ink, sansBold)

        val win = glowWindow(
            evMs = r.evMs,
            isAM = r.period == com.sunglow.spectrum.core.Period.AM,
            lat = r.city.lat,
            lon = r.city.lon,
            thNearDeg = r.sRT.geom.thNearDeg,
            thFarDeg = r.sRT.geom.thFarDeg
        )
        val useMap = template == 1 && heat != null

        if (useMap) {
            val h = heat!!
            /* 地图版：16:9 热力缩略 + 右侧关键读数 */
            val mx = 64f
            val my = 862f
            val mw = 560f
            val mh = mw * 9f / 16f
            txt(ctx.getString(R.string.share_heat_title), mx, my - 16f, 24f, faint)
            drawHeat(cv, h, RectF(mx, my, mx + mw, my + mh), dark)
            txt(
                ctx.getString(
                    R.string.share_heat_span,
                    h.spanKm().roundToInt().toString(),
                    (if (r.period == com.sunglow.spectrum.core.Period.AM) ctx.getString(R.string.widget_am) else ctx.getString(R.string.widget_pm)) +
                        " " + fmtClock(r.evMs, r.tz)
                ),
                mx, my + mh + 26f, 20f, faint
            )
            txt(ctx.getString(R.string.share_heat_hint), mx, my + mh + 52f, 19f, faint)

            var ry = my + 16f
            fun right(label: String, value: String) {
                txt(label, 660f, ry, 23f, faint)
                txt(value, 660f, ry + 36f, 30f, ink, sansBold)
                ry += 82f
            }
            right(ctx.getString(R.string.share_divergence), if (isNum(r.dvI)) r.dvI!!.roundToInt().toString() else "—")
            right(ctx.getString(R.string.share_confidence), confText(ctx, r.conf.key))
            right(ctx.getString(R.string.factor_name_dedge), uDist(r.sRT.d))
            right(
                ctx.getString(R.string.share_best_window),
                if (win != null) fmtClock(win.first, r.tz) + "–" + fmtClock(win.second, r.tz) else "—"
            )
        } else {
            /* 天色带 */
            val bandY = 890f
            val bandH = 92f
            val bandW = W - 128f
            txt(ctx.getString(R.string.share_sky_band), 64f, bandY - 18f, 26f, faint)
            val sky = skyBandOf(r, System.currentTimeMillis().toDouble(), r.dateStr)
            if (sky != null) {
                val total = sky.segments.sumOf { it.weight.toDouble() }.takeIf { it > 0 } ?: 1.0
                cv.save()
                val clip = Path().apply { addRoundRect(RectF(64f, bandY, 64f + bandW, bandY + bandH), 12f, 12f, Path.Direction.CW) }
                cv.clipPath(clip)
                var x = 64f
                for (s in sky.segments) {
                    val w = (s.weight / total * bandW).toFloat()
                    paint.reset()
                    paint.color = duskColor(s.key, dark)
                    cv.drawRect(x, bandY, x + w + 1f, bandY + bandH, paint)
                    x += w
                }
                /* 霞光窗口 */
                if (sky.winWidth > 0f) {
                    val wx = 64f + sky.winLeft * bandW
                    val ww = sky.winWidth * bandW
                    fillRound(wx, bandY, ww, bandH, 0f, withAlpha(Color.WHITE, if (dark) 0x24 else 0x30))
                    paint.reset()
                    paint.isAntiAlias = true
                    paint.style = Paint.Style.STROKE
                    paint.strokeWidth = 3f
                    paint.color = withAlpha(Color.WHITE, if (dark) 0xCC else 0xE6)
                    cv.drawRoundRect(RectF(wx, bandY + 1.5f, wx + ww, bandY + bandH - 1.5f), 8f, 8f, paint)
                    paint.style = Paint.Style.FILL
                }
                cv.restore()

                /* 时刻刻度 */
                val markY = bandY + bandH + 30f
                for (m in sky.marks) {
                    val mx2 = (64f + m.pct * bandW).coerceIn(86f, W - 86f)
                    val align = when (m.align) {
                        -1 -> Paint.Align.LEFT
                        1 -> Paint.Align.RIGHT
                        else -> Paint.Align.CENTER
                    }
                    txt(m.time, mx2, markY, 21f, faint, sans, align)
                }
            } else {
                fillRound(64f, bandY, bandW, bandH, 12f, withAlpha(faint, 0x18))
                txt(ctx.getString(R.string.share_sky_none), 84f, bandY + 56f, 26f, faint)
            }

            /* 事实行 */
            var fy = 1060f
            paint.reset()
            paint.color = rule
            cv.drawRect(64f, 1018f, W - 64f, 1019.5f, paint)

            fun fact(k: String, v: String) {
                txt(k, 64f, fy, 26f, faint)
                txt(v, W - 64f, fy, 28f, ink, sans, Paint.Align.RIGHT)
                fy += 44f
            }

            fact(ctx.getString(R.string.factor_name_dedge), ctx.getString(R.string.share_edge_max, uDist(r.sRT.d), uDist(r.sRT.geom.xMax)))
            fact(
                ctx.getString(R.string.share_best_window_long),
                if (win != null) fmtClock(win.first, r.tz) + " – " + fmtClock(win.second, r.tz) else "—"
            )
            fact(ctx.getString(R.string.ray_peak_t550), fmtSci(r.sRT.peak.color.t550))
            fact(
                ctx.getString(R.string.share_confidence),
                if (isNum(r.dvI)) confText(ctx, r.conf.key) + " · ΔI " + r.dvI!!.roundToInt() else confText(ctx, r.conf.key)
            )
        }

        /* 页脚 */
        paint.reset()
        paint.color = rule
        cv.drawRect(64f, 1252f, W - 64f, 1253.5f, paint)
        txt(ctx.getString(R.string.app_name) + " · " + ctx.getString(R.string.brand_mark), 64f, 1300f, 26f, ink, display)
        txt(ctx.getString(R.string.home_data_credit), 64f, 1338f, 21f, faint)

        /* 二维码：扫码回到同一城市、同一天、同一时段 */
        val qrSize = 168
        val qx = W - 64f - qrSize
        val qy = 1212f
        fillRound(qx - 10f, qy - 10f, qrSize + 20f, qrSize + 20f, 16f, Color.WHITE)
        val qr = qr(
            com.sunglow.spectrum.core.shareUrlOf(r),
            qrSize,
            Color.parseColor("#070B14"),
            Color.WHITE
        )
        if (qr != null) {
            cv.drawBitmap(qr, qx, qy, null)
            qr.recycle()
        }
        txt(ctx.getString(R.string.share_scan_same_city), qx + qrSize / 2f, qy + qrSize + 40f, 20f, faint, sans, Paint.Align.CENTER)

        return bmp
    }

    /** 生成二维码；返回 null 表示编码失败（链接过长等） */
    fun qr(text: String, size: Int, dark: Int = Color.parseColor("#070B14"), light: Int = Color.WHITE): Bitmap? =
        runCatching {
            val hints = mapOf(
                EncodeHintType.MARGIN to 1,
                EncodeHintType.CHARACTER_SET to "UTF-8"
            )
            val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, hints)
            val bmp = Bitmap.createBitmap(m.width, m.height, Bitmap.Config.ARGB_8888)
            val px = IntArray(m.width * m.height)
            for (y in 0 until m.height) {
                for (x in 0 until m.width) {
                    px[y * m.width + x] = if (m.get(x, y)) dark else light
                }
            }
            bmp.setPixels(px, 0, m.width, 0, 0, m.width, m.height)
            bmp
        }.getOrNull()

    /** 存到 cache/share/ 并分享 */
    fun shareImage(
        ctx: Context,
        r: ForecastResult,
        view: VerdictView,
        dark: Boolean,
        template: Int = 0,
        heat: HeatGrid? = null
    ) {
        val bmp = render(ctx, r, view, dark, template, heat)
        val dir = File(ctx.cacheDir, "share").apply { mkdirs() }
        val f = File(dir, shareFileNameOf(r))
        FileOutputStream(f).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bmp.recycle()

        val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".fileprovider", f)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "image/png"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_TEXT, captionOf(r, view))
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        ctx.startActivity(Intent.createChooser(send, ctx.getString(R.string.share_chooser_image)))
    }

    /* =====================================================================
     * 竖版故事卡 1080×1920（N4）
     * 与 1080×1440 结论卡同源，只是把画布拉高、留白加大，适合发朋友圈/小红书。
     * ===================================================================== */
    fun renderStory(
        ctx: Context,
        r: ForecastResult,
        view: VerdictView,
        dark: Boolean
    ): Bitmap {
        val w = W
        val h = 1920f
        val bmp = Bitmap.createBitmap(w.toInt(), h.toInt(), Bitmap.Config.ARGB_8888)
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

        fun fillRound(x: Float, y: Float, width: Float, height: Float, rad: Float, color: Int) {
            paint.reset()
            paint.isAntiAlias = true
            paint.color = color
            cv.drawRoundRect(RectF(x, y, x + width, y + height), rad, rad, paint)
        }

        cv.drawColor(bg)

        /* 报头实拍：占上方 40%，下沿渐隐 */
        val heroH = 760f
        val hero = runCatching { BitmapFactory.decodeResource(ctx.resources, R.drawable.hero_photo) }.getOrNull()
        if (hero != null) {
            val scale = max(w / hero.width, heroH / hero.height)
            val sw = w / scale
            val sh = heroH / scale
            val src = Rect(
                ((hero.width - sw) / 2f).toInt(),
                ((hero.height - sh) * 0.42f).toInt(),
                ((hero.width + sw) / 2f).toInt(),
                ((hero.height + sh) * 0.42f).toInt()
            )
            cv.drawBitmap(hero, src, RectF(0f, 0f, w, heroH), paint)
            hero.recycle()
        } else {
            fillRound(0f, 0f, w, heroH, 0f, if (dark) Color.parseColor("#1B2130") else Color.parseColor("#DCE3F0"))
        }
        paint.reset()
        paint.shader = LinearGradient(
            0f, heroH * 0.30f, 0f, heroH,
            intArrayOf(Color.TRANSPARENT, bg, bg),
            floatArrayOf(0f, 0.78f, 1f),
            Shader.TileMode.CLAMP
        )
        cv.drawRect(0f, heroH * 0.30f, w, heroH, paint)
        paint.shader = LinearGradient(
            0f, 0f, 0f, 150f,
            intArrayOf(Color.parseColor(if (dark) "#8C070B14" else "#CCFFFFFF"), Color.TRANSPARENT),
            null, Shader.TileMode.CLAMP
        )
        cv.drawRect(0f, 0f, w, 150f, paint)
        paint.shader = null

        paint.reset()
        paint.shader = LinearGradient(0f, 0f, w, 0f, intArrayOf(accent, amber, cool), null, Shader.TileMode.CLAMP)
        cv.drawRect(0f, 0f, w, 8f, paint)
        paint.shader = null

        txt(ctx.getString(R.string.app_name) + " · " + ctx.getString(R.string.brand_mark), 72f, 76f, 34f, if (dark) Color.parseColor("#E9EEFB") else Color.parseColor("#111A2C"), display)

        /* 城市 / 日期 / 时段 */
        val pTxt = view.p.roundToInt().toString()
        txt(r.city.name, 72f, 916f, 76f, ink, sansBold)
        val periodWord = if (r.period == com.sunglow.spectrum.core.Period.AM) ctx.getString(R.string.widget_am) else ctx.getString(R.string.widget_pm)
        txt(
            r.dateStr + " · " + periodWord + " · " + r.evName + " " + fmtClock(r.evMs, r.tz),
            72f, 972f, 34f, muted
        )

        /* 概率大字 */
        paint.reset()
        paint.isAntiAlias = true
        paint.typeface = display ?: sansBold
        paint.textSize = 260f
        val numW = paint.measureText(pTxt)
        txt(pTxt, 62f, 1230f, 260f, ink, display ?: sansBold)
        txt("%", 72f + numW + 12f, 1230f, 84f, muted, display ?: sans)

        /* 等级（右上） */
        val band = QUALITY_BANDS.firstOrNull { it.key == view.grade } ?: QUALITY_BANDS.last()
        val gColor = Color.parseColor(if (dark) band.dark else band.color)
        val gLabel = com.sunglow.spectrum.ui.i18n.gradeText(ctx, view.grade)
        paint.reset()
        paint.isAntiAlias = true
        paint.textSize = 42f
        paint.typeface = sansBold
        val gw = paint.measureText(gLabel) + 84f
        fillRound(w - 72f - gw, 1150f, gw, 88f, 44f, withAlpha(gColor, if (dark) 0x33 else 0x22))
        txt(gLabel, w - 72f - gw / 2f, 1212f, 42f, gColor, sansBold, Paint.Align.CENTER)
        txt(ctx.getString(R.string.share_view_q, view.q.roundToInt()), w - 72f, 1290f, 30f, faint, sans, Paint.Align.RIGHT)

        /* 结论句 */
        txt(conclWord(view.p), 72f, 1330f, 50f, ink, sansBold)

        /* 事实两行 */
        val win = glowWindow(
            evMs = r.evMs,
            isAM = r.period == com.sunglow.spectrum.core.Period.AM,
            lat = r.city.lat,
            lon = r.city.lon,
            thNearDeg = r.sRT.geom.thNearDeg,
            thFarDeg = r.sRT.geom.thFarDeg
        )
        paint.reset()
        paint.color = rule
        cv.drawRect(72f, 1392f, w - 72f, 1393.5f, paint)

        var fy = 1452f
        fun fact(k: String, v: String) {
            txt(k, 72f, fy, 30f, faint)
            txt(v, w - 72f, fy, 32f, ink, sans, Paint.Align.RIGHT)
            fy += 62f
        }
        fact(ctx.getString(R.string.factor_name_dedge), uDist(r.sRT.d))
        fact(ctx.getString(R.string.share_best_window_long), if (win != null) fmtClock(win.first, r.tz) + " – " + fmtClock(win.second, r.tz) else "—")

        /* 页脚 + 二维码 */
        paint.reset()
        paint.color = rule
        cv.drawRect(72f, 1624f, w - 72f, 1625.5f, paint)
        txt(ctx.getString(R.string.app_name) + " · " + ctx.getString(R.string.brand_mark), 72f, 1700f, 30f, ink, display)
        txt(ctx.getString(R.string.home_data_credit), 72f, 1746f, 24f, faint)

        val qrSize = 210
        val qx = w - 72f - qrSize
        val qy = 1660f
        fillRound(qx - 12f, qy - 12f, qrSize + 24f, qrSize + 24f, 18f, Color.WHITE)
        val qr2 = qr(com.sunglow.spectrum.core.qrShareUrlOf(r), qrSize, Color.parseColor("#070B14"), Color.WHITE)
        if (qr2 != null) {
            cv.drawBitmap(qr2, qx, qy, null)
            qr2.recycle()
        }

        return bmp
    }

    /* =====================================================================
     * 十日趋势图 1080×1080（N4）
     * 逐日双柱（上＝晚霞、下＝朝霞），柱高按概率，颜色按质量分档；
     * 顶部标注「最值得出门」的那一个窗口，和 App 内趋势页同一口径。
     * ===================================================================== */
    fun renderTrend(
        ctx: Context,
        rows: List<com.sunglow.spectrum.ui.TrendRow>,
        cityName: String,
        dark: Boolean
    ): Bitmap {
        val w = 1080f
        val h = 1080f
        val bmp = Bitmap.createBitmap(w.toInt(), h.toInt(), Bitmap.Config.ARGB_8888)
        val cv = Canvas(bmp)

        val bg = c(if (dark) DarkTokens.bg else LightTokens.bg)
        val ink = c(if (dark) DarkTokens.ink else LightTokens.ink)
        val muted = c(if (dark) DarkTokens.muted else LightTokens.muted)
        val faint = c(if (dark) DarkTokens.faint else LightTokens.faint)
        val accent = c(if (dark) DarkTokens.accent else LightTokens.accent)
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

        cv.drawColor(bg)
        paint.reset()
        paint.shader = LinearGradient(
            0f, 0f, w, 0f,
            intArrayOf(accent, Color.parseColor("#E2B45E"), Color.parseColor("#3FA9C8")),
            null, Shader.TileMode.CLAMP
        )
        cv.drawRect(0f, 0f, w, 7f, paint)
        paint.shader = null

        txt(ctx.getString(R.string.trend_title), 64f, 108f, 52f, ink, sansBold)
        txt(cityName, 64f, 156f, 30f, muted)

        /* 最值得出门的一个窗口 */
        var bestRow: com.sunglow.spectrum.ui.TrendRow? = null
        var bestCell: com.sunglow.spectrum.ui.TrendCell? = null
        var bestAm = false
        for (row in rows) {
            row.am?.let { if (bestCell == null || it.q > bestCell!!.q) { bestCell = it; bestRow = row; bestAm = true } }
            row.pm?.let { if (bestCell == null || it.q > bestCell!!.q) { bestCell = it; bestRow = row; bestAm = false } }
        }
        if (bestCell != null && bestRow != null) {
            txt(
                ctx.getString(
                    R.string.share_trend_best,
                    bestRow!!.date.substring(5),
                    (if (bestAm) ctx.getString(R.string.widget_am) else ctx.getString(R.string.widget_pm)) +
                        " " + bestCell!!.p.roundToInt() + "%"
                ),
                w - 64f, 108f, 30f, accent, sansBold, Paint.Align.RIGHT
            )
        }

        /* 网格与柱状 */
        val baseY = 828f
        val topY = 300f
        val left = 88f
        val usable = w - left * 2f
        val n = rows.size.coerceAtLeast(1)
        val slot = usable / n
        paint.reset()
        paint.color = withAlpha(faint, 0x26)
        cv.drawRect(left, baseY, left + usable, baseY + 1.5f, paint)
        for (pct in listOf(0.5f, 1f)) {
            val y = baseY - (baseY - topY) * pct
            paint.reset()
            paint.color = withAlpha(faint, if (pct == 1f) 0x24 else 0x14)
            cv.drawRect(left, y, left + usable, y + 1f, paint)
        }

        rows.forEachIndexed { i, row ->
            val cx = left + slot * (i + 0.5f)
            val barW = slot * 0.30f
            fun bar(cell: com.sunglow.spectrum.ui.TrendCell?, dx: Float) {
                val p = cell?.p ?: 0.0
                val hgt = ((baseY - topY) * (p / 100.0).toFloat()).coerceIn(2f, baseY - topY)
                val color = cell?.let { cellColor(it.grade, dark) } ?: withAlpha(faint, 0x33)
                paint.reset()
                paint.isAntiAlias = true
                paint.color = color
                cv.drawRoundRect(
                    RectF(cx + dx - barW / 2f, baseY - hgt, cx + dx + barW / 2f, baseY),
                    barW / 2f, barW / 2f, paint
                )
                if (cell != null && p >= 1.0) {
                    txt(
                        p.roundToInt().toString(), cx + dx, baseY - hgt - 12f, 19f,
                        muted, sans, Paint.Align.CENTER
                    )
                }
            }
            bar(row.pm, -barW * 0.62f)
            bar(row.am, barW * 0.62f)
            txt(row.date.substring(5), cx, baseY + 40f, 22f, faint, sans, Paint.Align.CENTER)
        }

        /* 图例 */
        val legendY = baseY + 92f
        paint.reset()
        paint.isAntiAlias = true
        paint.color = accent
        cv.drawRoundRect(RectF(64f, legendY - 20f, 84f, legendY - 2f), 6f, 6f, paint)
        txt(ctx.getString(R.string.widget_pm), 96f, legendY, 24f, muted)
        paint.reset()
        paint.color = withAlpha(accent, 0x80)
        cv.drawRoundRect(RectF(176f, legendY - 20f, 196f, legendY - 2f), 6f, 6f, paint)
        txt(ctx.getString(R.string.widget_am), 208f, legendY, 24f, muted)
        txt(ctx.getString(R.string.share_trend_legend), w - 64f, legendY, 22f, faint, sans, Paint.Align.RIGHT)

        paint.reset()
        paint.color = rule
        cv.drawRect(64f, 1010f, w - 64f, 1011.5f, paint)
        txt(ctx.getString(R.string.app_name) + " · " + ctx.getString(R.string.brand_mark), 64f, 1054f, 26f, ink, display)
        txt(ctx.getString(R.string.share_data_only), w - 64f, 1054f, 22f, faint, sans, Paint.Align.RIGHT)

        return bmp
    }

    /** 质量分档 → 画布颜色（与 App 内的徽章同色） */
    private fun cellColor(grade: String, dark: Boolean): Int {
        val band = QUALITY_BANDS.firstOrNull { it.key == grade } ?: QUALITY_BANDS.last()
        return withAlpha(Color.parseColor(if (dark) band.dark else band.color), 0xE6)
    }

    /** 任意位图走系统分享（故事卡 / 趋势图共用） */
    fun shareBitmap(ctx: Context, bmp: Bitmap, fileName: String, caption: String) {
        val dir = File(ctx.cacheDir, "share").apply { mkdirs() }
        val f = File(dir, fileName)
        FileOutputStream(f).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bmp.recycle()

        val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".fileprovider", f)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "image/png"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_TEXT, caption)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        ctx.startActivity(Intent.createChooser(send, ctx.getString(R.string.share_chooser_image)))
    }

    /** 加入日历：写 .ics 到缓存目录，交给系统日历导入（不需要日历读写权限） */
    fun shareIcs(ctx: Context, r: ForecastResult, view: VerdictView) {
        val built = com.sunglow.spectrum.core.buildIcs(r, view, com.sunglow.spectrum.core.shareUrlOf(r))
        val dir = File(ctx.cacheDir, "share").apply { mkdirs() }
        val f = File(dir, built.fileName)
        f.writeText(built.text, Charsets.UTF_8)

        val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".fileprovider", f)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/calendar"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, built.fileName)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        ctx.startActivity(Intent.createChooser(send, ctx.getString(R.string.share_add_calendar)))
    }

    /* ---------- 内部 ---------- */

    /** 热力面缩略：最近邻位图 + 双线性过滤放大，保持格子边界柔和 */
    private fun drawHeat(cv: Canvas, heat: HeatGrid, dst: RectF, dark: Boolean) {
        val n = heat.n
        val bmp = Bitmap.createBitmap(n, n, Bitmap.Config.ARGB_8888)
        val px = IntArray(n * n)
        for (c in heat.cells) px[c.i * n + c.j] = heatColor(c.idx / 100.0, dark)
        bmp.setPixels(px, 0, n, 0, 0, n, n)
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            isFilterBitmap = true
            alpha = 240
        }
        cv.save()
        cv.clipPath(
            Path().apply { addRoundRect(dst, 14f, 14f, Path.Direction.CW) }
        )
        cv.drawBitmap(bmp, null, dst, p)
        cv.restore()
        bmp.recycle()

        p.reset()
        p.isAntiAlias = true
        p.style = Paint.Style.STROKE
        p.strokeWidth = 2f
        p.color = withAlpha(Color.WHITE, if (dark) 0x33 else 0x55)
        cv.drawRoundRect(dst, 14f, 14f, p)
    }

    private fun heatColor(t: Double, dark: Boolean): Int {
        val v = t.coerceIn(0.0, 1.0).toFloat()
        fun mix(a: Int, b: Int, f: Float): Int = Color.rgb(
            (Color.red(a) + (Color.red(b) - Color.red(a)) * f).toInt(),
            (Color.green(a) + (Color.green(b) - Color.green(a)) * f).toInt(),
            (Color.blue(a) + (Color.blue(b) - Color.blue(a)) * f).toInt()
        )
        val cool = Color.parseColor(if (dark) "#3FA9C8" else "#2E8FB0")
        val mid = Color.parseColor(if (dark) "#E2B45E" else "#D99B3F")
        val hot = Color.parseColor(if (dark) "#F2796A" else "#C0392B")
        val c = if (v <= 0.5f) mix(cool, mid, v / 0.5f) else mix(mid, hot, (v - 0.5f) / 0.5f)
        return withAlpha(c, 240)
    }

    private fun c(color: androidx.compose.ui.graphics.Color): Int = color.toArgb()

    private fun withAlpha(color: Int, alpha: Int): Int =
        Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))

    private fun duskColor(key: String, dark: Boolean): Int = when (key) {
        "day" -> Color.parseColor(if (dark) "#3A4354" else "#DDE5EE")
        "civil" -> Color.parseColor(if (dark) "#E8B678" else "#F0C48C")
        "naut" -> Color.parseColor(if (dark) "#CF6F42" else "#D9784A")
        "astro" -> Color.parseColor(if (dark) "#6F6A92" else "#7A759F")
        else -> Color.parseColor(if (dark) "#1E2536" else "#2B3450")
    }

    private fun fmtSci(v: Double): String =
        if (!v.isFinite()) "—" else String.format(Locale.US, "%.3f", v)
}

private fun confText(ctx: Context, key: String): String = when (key) {
    "hi" -> ctx.getString(R.string.conf_high)
    "lo" -> ctx.getString(R.string.conf_low)
    else -> ctx.getString(R.string.conf_mid)
}
