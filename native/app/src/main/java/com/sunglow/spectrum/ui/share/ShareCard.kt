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
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import androidx.core.content.FileProvider
import androidx.core.content.res.ResourcesCompat
import androidx.core.graphics.toArgb
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.sunglow.spectrum.R
import com.sunglow.spectrum.core.ForecastResult
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

    /** 画一张图卡；dark 决定用哪套令牌 */
    fun render(ctx: Context, r: ForecastResult, view: VerdictView, dark: Boolean): Bitmap {
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
            val src = RectF(
                (hero.width - sw) / 2f,
                (hero.height - sh) * 0.45f,
                (hero.width + sw) / 2f,
                (hero.height + sh) * 0.45f
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

        txt("霞光档案 · SUNGLOW", 64f, 62f, 30f, if (dark) Color.parseColor("#E9EEFB") else Color.parseColor("#111A2C"), display)
        txt(
            "广州 · 珠江 · 实拍", W - 64f, 62f, 24f,
            if (dark) Color.parseColor("#B8C4DC") else Color.parseColor("#46556F"),
            sans, Paint.Align.RIGHT
        )

        /* 城市与日期 */
        val cityTop = 424f
        txt(r.city.name, 64f, cityTop, 58f, ink, sansBold)
        val periodWord = if (r.period == com.sunglow.spectrum.core.Period.AM) "朝霞" else "晚霞"
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
        txt("出现概率 P", 64f, 566f, 26f, faint)
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
        val gLabel = QUALITY_LABEL[view.grade] ?: view.grade
        paint.reset()
        paint.isAntiAlias = true
        paint.textSize = 34f
        paint.typeface = sansBold
        val gw = paint.measureText(gLabel) + 64f
        fillRound(W - 64f - gw, 640f, gw, 72f, 36f, withAlpha(gColor, if (dark) 0x33 else 0x22))
        txt(gLabel, W - 64f - gw / 2f, 691f, 34f, gColor, sansBold, Paint.Align.CENTER)
        txt("观赏质量 " + view.q.roundToInt().toString(), W - 64f, 748f, 26f, faint, sans, Paint.Align.RIGHT)

        /* 结论句 */
        txt(conclWord(view.p), 64f, 812f, 42f, ink, sansBold)

        /* 天色带 */
        val bandY = 890f
        val bandH = 92f
        val bandW = W - 128f
        txt("天色带", 64f, bandY - 18f, 26f, faint)
        val sky = skyBandOf(r, System.currentTimeMillis(), r.dateStr)
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
                val mx = (64f + m.pct * bandW).coerceIn(86f, W - 86f)
                val align = when (m.align) {
                    -1 -> Paint.Align.LEFT
                    1 -> Paint.Align.RIGHT
                    else -> Paint.Align.CENTER
                }
                txt(m.time, mx, markY, 21f, faint, sans, align)
            }
        } else {
            fillRound(64f, bandY, bandW, bandH, 12f, withAlpha(faint, 0x18))
            txt("此刻没有可用的天色带", 84f, bandY + 56f, 26f, faint)
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

        fact("云边界距离", uDist(r.sRT.d) + " / 上限 " + uDist(r.sRT.geom.xMax))
        val win = glowWindow(
            evMs = r.evMs,
            isAM = r.period == com.sunglow.spectrum.core.Period.AM,
            lat = r.city.lat,
            lon = r.city.lon,
            thNearDeg = r.sRT.geom.thNearDeg,
            thFarDeg = r.sRT.geom.thFarDeg
        )
        fact(
            "最佳观赏窗口",
            if (win != null) fmtClock(win.first, r.tz) + " – " + fmtClock(win.second, r.tz) else "—"
        )
        fact("峰值透射率 T550", fmtSci(r.sRT.peak.color.t550))
        fact(
            "模型可信度",
            if (isNum(r.dvI)) r.conf.level + " · ΔI " + r.dvI!!.roundToInt() else r.conf.level
        )

        /* 页脚 */
        paint.reset()
        paint.color = rule
        cv.drawRect(64f, 1252f, W - 64f, 1253.5f, paint)
        txt("霞光档案 · SUNGLOW", 64f, 1300f, 26f, ink, display)
        txt("数据 Open-Meteo · 概率预报仅供参考", 64f, 1338f, 21f, faint)

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
        txt("扫码查看同一城市", qx + qrSize / 2f, qy + qrSize + 40f, 20f, faint, sans, Paint.Align.CENTER)

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
    fun shareImage(ctx: Context, r: ForecastResult, view: VerdictView, dark: Boolean) {
        val bmp = render(ctx, r, view, dark)
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
        ctx.startActivity(Intent.createChooser(send, "分享霞光图卡"))
    }

    /* ---------- 内部 ---------- */

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
