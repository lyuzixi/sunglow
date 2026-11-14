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
import com.sunglow.spectrum.core.HeatGrid
import com.sunglow.spectrum.core.QUALITY_BANDS
import com.sunglow.spectrum.core.VerdictView
import com.sunglow.spectrum.core.conclWord
import com.sunglow.spectrum.core.fmtClock
import com.sunglow.spectrum.core.glowWindow
import com.sunglow.spectrum.core.judgmentOf
import com.sunglow.spectrum.core.skyBandOf
import com.sunglow.spectrum.core.uAlt
import com.sunglow.spectrum.core.uDist
import com.sunglow.spectrum.core.uSpeed
import com.sunglow.spectrum.ui.TrendRow
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
    private const val BASE_IDS =
        "sky,window,qr,trend,map,models,facCloud,facPath,facAir,facDyn,rayRows,raySwatch,rayTime,rayCurve"

    fun canRender(mods: List<String>): Boolean = mods.all { it in BASE_IDS.split(",") }

    /** 与 render 使用同一套高度规则，供回归测试核对实际位图高度。 */
    fun heightFor(mods: List<String>): Int {
        val on = mods.toSet()
        var h = 900f
        if ("sky" in on) h += 148f
        if ("window" in on) h += 96f
        if ("qr" in on) h += 252f
        if ("trend" in on) h += 180f
        if ("map" in on) h += 490f
        if ("models" in on) h += 150f
        if ("facCloud" in on) h += 160f
        if ("facPath" in on) h += 160f
        if ("facAir" in on) h += 160f
        if ("facDyn" in on) h += 160f
        if ("rayRows" in on) h += 210f
        if ("raySwatch" in on) h += 130f
        if ("rayTime" in on) h += 120f
        if ("rayCurve" in on) h += 180f
        return h.roundToInt()
    }

    fun render(
        ctx: Context,
        r: ForecastResult,
        view: VerdictView,
        dark: Boolean,
        mods: List<String>,
        trend: List<TrendRow> = emptyList(),
        heat: HeatGrid? = null
    ): Bitmap {
        val on = mods.toSet()
        val skyOn = "sky" in on

        val h = heightFor(mods).toFloat()
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
                "trend" -> {
                    txt(ctx.getString(R.string.compose_mod_trend), M, y, 25f, faint)
                    y += 26f
                    val chartH = 96f
                    val baseY = y + chartH
                    val n = trend.size.coerceAtMost(10)
                    if (n == 0) {
                        fillRound(M, y, W - 2 * M, chartH, 10f, withAlpha(faint, 0x12))
                        txt(ctx.getString(R.string.compose_unavailable), M + 16f, y + 54f, 22f, faint)
                    } else {
                        val colW = (W - 2 * M) / n
                        paint.reset()
                        paint.color = rule
                        cv.drawRect(M, baseY, W - M, baseY + 1.2f, paint)
                        for (k in 0 until n) {
                            val row = trend[k]
                            val x = M + k * colW
                            fun bar(cell: com.sunglow.spectrum.ui.TrendCell?, offset: Float, bw: Float) {
                                if (cell == null) return
                                val bh = (cell.p / 100f * chartH).toFloat().coerceAtLeast(2f)
                                val band = QUALITY_BANDS.firstOrNull { it.key == cell.grade } ?: QUALITY_BANDS.last()
                                val gColor = Color.parseColor(if (dark) band.dark else band.color)
                                fillRound(x + offset, baseY - bh, bw, bh, 4f, withAlpha(gColor, 0xE8))
                            }
                            bar(row.am, colW * 0.16f, colW * 0.28f)
                            bar(row.pm, colW * 0.54f, colW * 0.28f)
                            txt(
                                row.date.takeLast(5),
                                x + colW / 2f, baseY + 24f, 16f,
                                faint, sans, Paint.Align.CENTER
                            )
                        }
                    }
                    y += chartH + 40f
                }
                "map" -> {
                    txt(ctx.getString(R.string.compose_mod_map), M, y, 25f, faint)
                    y += 26f
                    val mw = 720f
                    val mh = 405f
                    val mx = (W - mw) / 2f
                    if (heat == null) {
                        fillRound(mx, y, mw, mh, 12f, withAlpha(faint, 0x12))
                        txt(ctx.getString(R.string.compose_unavailable), mx + 24f, y + mh / 2f, 24f, faint)
                    } else {
                        fillRound(mx, y, mw, mh, 12f, Color.parseColor(if (dark) "#0D1424" else "#F2F5FB"))
                        val cw = mw / heat.n
                        val ch = mh / heat.n
                        for (i in 0 until heat.n) {
                            for (j in 0 until heat.n) {
                                val cell = heat.cellAt(i, j) ?: continue
                                val band = QUALITY_BANDS.firstOrNull { it.key == cell.grade } ?: QUALITY_BANDS.last()
                                val gColor = Color.parseColor(if (dark) band.dark else band.color)
                                paint.reset()
                                paint.color = withAlpha(gColor, 0xD8)
                                cv.drawRect(mx + j * cw, y + i * ch, mx + (j + 1) * cw, y + (i + 1) * ch, paint)
                            }
                        }
                        paint.reset()
                        paint.isAntiAlias = true
                        paint.color = withAlpha(Color.WHITE, 0xEE)
                        cv.drawCircle(mx + mw / 2f, y + mh / 2f, 6f, paint)
                        paint.color = withAlpha(ink, 0xCC)
                        cv.drawCircle(mx + mw / 2f, y + mh / 2f, 3f, paint)
                    }
                    val periodWord = if (r.period == com.sunglow.spectrum.core.Period.AM) {
                        ctx.getString(R.string.widget_am)
                    } else {
                        ctx.getString(R.string.widget_pm)
                    }
                    txt(
                        ctx.getString(
                            R.string.share_heat_span,
                            if (heat != null) heat.spanKm().roundToInt().toString() else "—",
                            periodWord + " " + fmtClock(r.evMs, r.tz)
                        ),
                        mx, y + mh + 24f, 19f, faint
                    )
                    y += mh + 52f
                }
                "models" -> {
                    txt(ctx.getString(R.string.compose_mod_models), M, y, 25f, faint)
                    y += 34f
                    val labelW = 190f
                    val barX = M + labelW
                    val barW = W - M - 90f - barX
                    for (m in r.models.take(3)) {
                        txt(m.label, M, y + 18f, 22f, muted)
                        fillRound(barX, y + 4f, barW, 14f, 7f, withAlpha(faint, 0x18))
                        val bw = (barW * (m.p / 100.0).coerceIn(0.0, 1.0)).toFloat()
                        fillRound(barX, y + 4f, bw.coerceAtLeast(3f), 14f, 7f, accent)
                        txt(
                            m.p.roundToInt().toString() + "%",
                            W - M, y + 18f, 20f, ink, sans, Paint.Align.RIGHT
                        )
                        y += 30f
                    }
                    y += 16f
                }
                "facCloud", "facPath", "facAir", "facDyn" -> {
                    val keys = when (id) {
                        "facCloud" -> listOf("cover", "base", "block")
                        "facPath" -> listOf("heq", "heff", "dedge")
                        "facAir" -> listOf("aod", "vis", "rh")
                        else -> listOf("stab", "wind", "cape")
                    }
                    val titleRes = when (id) {
                        "facCloud" -> R.string.compose_mod_fac_cloud
                        "facPath" -> R.string.compose_mod_fac_path
                        "facAir" -> R.string.compose_mod_fac_air
                        else -> R.string.compose_mod_fac_dyn
                    }
                    txt(ctx.getString(titleRes), M, y, 25f, faint)
                    txt(
                        ctx.getString(R.string.factor_count, keys.size),
                        W - M, y, 19f, faint, sans, Paint.Align.RIGHT
                    )
                    y += 32f
                    val byKey = r.factorRows.associateBy { it.key }
                    for (k in keys) {
                        val fr = byKey[k]
                        txt(ctx.getString(facNameRes(k)), M, y + 23f, 20f, muted)
                        txt(facRawText(k, fr?.raw), M + 286f, y + 23f, 19f, faint)
                        val bx = M + 560f
                        val bw = 210f
                        fillRound(bx, y + 10f, bw, 10f, 5f, withAlpha(faint, 0x18))
                        val s = fr?.score
                        if (s != null && s.isFinite()) {
                            val j = judgmentOf(s)
                            val jt = when (j.cls) {
                                "ok" -> ctx.getString(R.string.judge_ok)
                                "mid" -> ctx.getString(R.string.judge_mid)
                                "bad" -> ctx.getString(R.string.judge_bad)
                                else -> ctx.getString(R.string.judge_miss)
                            }
                            fillRound(
                                bx, y + 10f,
                                (bw * s.coerceIn(0.0, 1.0)).toFloat().coerceAtLeast(3f),
                                10f, 5f, judgeColor(j.cls, dark)
                            )
                            txt(jt, W - M, y + 23f, 20f, judgeColor(j.cls, dark), sans, Paint.Align.RIGHT)
                        } else {
                            txt(
                                ctx.getString(R.string.judge_miss),
                                W - M, y + 23f, 20f, faint, sans, Paint.Align.RIGHT
                            )
                        }
                        y += 34f
                    }
                    y += 10f
                }
                "rayRows" -> {
                    val g = r.sRT.geom
                    val pk = r.sRT.peak
                    txt(ctx.getString(R.string.compose_mod_ray_rows), M, y, 25f, faint)
                    y += 32f
                    val inner = W - 2 * M
                    val colW = (inner - 40f) / 2f
                    val rows = listOf(
                        ctx.getString(R.string.ray_geom_window) to
                            (g.dur.roundToInt().toString() + " min"),
                        ctx.getString(R.string.ray_bright_level) to
                            ctx.getString(brightRes(r.sRT.bright.score)),
                        ctx.getString(R.string.ray_peak_t550) to
                            String.format(java.util.Locale.US, "%.2e", pk.color.t550),
                        ctx.getString(R.string.ray_tau) to
                            String.format(java.util.Locale.US, "%.1f", pk.color.tau550),
                        ctx.getString(R.string.ray_peak_color) to
                            (ctx.getString(colorRes(pk.color.nameKey)) + " · " +
                                ctx.getString(R.string.label_sat) + " " +
                                (pk.color.sat * 100).roundToInt() + "%"),
                        ctx.getString(R.string.ray_hue_spread) to
                            (r.sRT.hueSpread.roundToInt().toString() + "°"),
                        ctx.getString(R.string.ray_hs) to
                            String.format(java.util.Locale.US, "%.2f km", r.sRT.hs),
                        ctx.getString(R.string.ray_near) to
                            String.format(java.util.Locale.US, "%.2f°", g.thNearDeg),
                        ctx.getString(R.string.ray_far) to
                            String.format(java.util.Locale.US, "%.2f°", g.thFarDeg)
                    )
                    rows.forEachIndexed { i, row ->
                        val col = i % 2
                        val cx = M + col * (colW + 40f)
                        txt(row.first, cx, y, 18f, faint)
                        txt(row.second, cx + colW, y, 20f, ink, sans, Paint.Align.RIGHT)
                        if (col == 1 || i == rows.lastIndex) y += 30f
                    }
                    y += 16f
                }
                "raySwatch" -> {
                    txt(ctx.getString(R.string.ray_spectrum), M, y, 25f, faint)
                    y += 30f
                    val sm = r.sRT.samples
                    if (sm.isEmpty()) {
                        txt(ctx.getString(R.string.compose_unavailable), M, y + 20f, 20f, faint)
                        y += 60f
                    } else {
                        val gap = 8f
                        val sw = (W - 2 * M - gap * (sm.size - 1)) / sm.size
                        sm.forEachIndexed { i, s ->
                            val x = M + i * (sw + gap)
                            fillRound(x, y, sw, 44f, 7f, Color.parseColor(s.color.hex))
                            txt(
                                ctx.getString(colorRes(s.color.nameKey)),
                                x + sw / 2f, y + 68f, 16f, faint, sans, Paint.Align.CENTER
                            )
                        }
                        txt(ctx.getString(R.string.ray_spectrum_hint), M, y + 96f, 18f, faint)
                        y += 112f
                    }
                }
                "rayTime" -> {
                    txt(ctx.getString(R.string.ray_timeline), M, y, 25f, faint)
                    y += 32f
                    val g = r.sRT.geom
                    val om = if (r.omega > 0.01) r.omega else 0.2
                    if (!g.ok) {
                        txt(ctx.getString(R.string.ray_no_window), M, y + 14f, 20f, faint)
                        y += 56f
                    } else {
                        val t0 = g.thNearDeg / om
                        val t1 = g.thFarDeg / om
                        val mx = maxOf(t1 * 1.12, 0.8)
                        val inner = W - 2 * M
                        fillRound(M, y + 8f, inner, 12f, 6f, withAlpha(faint, 0x18))
                        val l = (t0 / mx).coerceIn(0.0, 1.0).toFloat() * inner
                        val w = ((t1 - t0) / mx).coerceIn(0.0, 1.0).toFloat() * inner
                        fillRound(M + l, y + 8f, w.coerceAtLeast(4f), 12f, 6f, accent)
                        txt(ctx.getString(R.string.ray_start, durText(t0)), M, y + 48f, 19f, faint)
                        txt(
                            ctx.getString(R.string.ray_end, durText(t1)),
                            W - M, y + 48f, 19f, faint, sans, Paint.Align.RIGHT
                        )
                        y += 62f
                    }
                }
                "rayCurve" -> {
                    txt(ctx.getString(R.string.ray_curve), M, y, 25f, faint)
                    y += 30f
                    val sm = r.sRT.samples
                    val g = r.sRT.geom
                    val om = if (r.omega > 0.01) r.omega else 0.2
                    if (sm.size < 2) {
                        txt(ctx.getString(R.string.compose_unavailable), M, y + 24f, 20f, faint)
                        y += 60f
                    } else {
                        val mins = sm.mapIndexed { i, s ->
                            if (g.ok) (g.thNearDeg + s.t * (g.thFarDeg - g.thNearDeg)) / om else i * 3.0
                        }
                        val maxMin = maxOf((mins.maxOrNull() ?: 1.0) * 1.06, 0.5)
                        val maxL = sm.maxOf { it.color.lumRel }.takeIf { it > 0 } ?: 1.0
                        val maxC = sm.maxOf { it.color.chroma }.takeIf { it > 0 } ?: 1.0
                        val cw = W - 2 * M
                        val ch = 90f
                        paint.reset()
                        paint.color = rule
                        for (k in 0..4) {
                            val yy = y + ch - k * ch / 4f
                            cv.drawLine(M, yy, M + cw, yy, paint)
                        }
                        fun px(min: Double): Float = M + (min / maxMin).toFloat() * cw
                        fun py(v: Double): Float = y + ch - v.coerceIn(0.0, 1.0).toFloat() * ch
                        fun poly(get: (Double, Double) -> Double, color: Int) {
                            paint.reset()
                            paint.color = color
                            paint.strokeWidth = 2.2f
                            var lastX = 0f
                            var lastY = 0f
                            sm.forEachIndexed { i, s ->
                                val xx = px(mins[i])
                                val yy = py(get(s.color.lumRel, s.color.chroma))
                                if (i > 0) cv.drawLine(lastX, lastY, xx, yy, paint)
                                lastX = xx
                                lastY = yy
                            }
                        }
                        poly({ lum, _ -> lum / maxL }, accent)
                        poly(
                            { _, chroma -> chroma / maxC },
                            Color.parseColor(if (dark) "#E6B36A" else "#B5721F")
                        )
                        sm.forEachIndexed { i, s ->
                            paint.reset()
                            paint.color = Color.parseColor(s.color.hex)
                            cv.drawRect(
                                px(mins[i]) - 1.5f, y + ch + 2f,
                                px(mins[i]) + 1.5f, y + ch + 10f, paint
                            )
                        }
                        txt(durText(0.0), M, y + ch + 28f, 17f, faint)
                        txt(
                            durText(maxMin / 2), M + cw / 2f, y + ch + 28f, 17f,
                            faint, sans, Paint.Align.CENTER
                        )
                        txt(
                            durText(maxMin), M + cw, y + ch + 28f, 17f,
                            faint, sans, Paint.Align.RIGHT
                        )
                        y += ch + 50f
                    }
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

    private fun judgeColor(cls: String, dark: Boolean): Int = when (cls) {
        "ok" -> Color.parseColor(if (dark) "#6FD3A2" else "#178A52")
        "mid" -> Color.parseColor(if (dark) "#E0B45C" else "#C07A10")
        "bad" -> Color.parseColor(if (dark) "#E08A6A" else "#C2603A")
        else -> Color.parseColor(if (dark) "#8A93A6" else "#7A8494")
    }

    private fun facNameRes(key: String): Int = when (key) {
        "cover" -> R.string.factor_name_cover
        "base" -> R.string.factor_name_base
        "heq" -> R.string.factor_name_heq
        "heff" -> R.string.factor_name_heff
        "dedge" -> R.string.factor_name_dedge
        "block" -> R.string.factor_name_block
        "aod" -> R.string.factor_name_aod
        "vis" -> R.string.factor_name_vis
        "rh" -> R.string.factor_name_rh
        "stab" -> R.string.factor_name_stab
        "wind" -> R.string.factor_name_wind
        else -> R.string.factor_name_cape
    }

    private fun brightRes(score: Double): Int = when {
        score >= 100.0 -> R.string.bright_2
        score >= 90.0 -> R.string.bright_3
        score >= 72.0 -> R.string.bright_1
        score >= 58.0 -> R.string.bright_4
        score >= 28.0 -> R.string.bright_5
        score >= 8.0 -> R.string.bright_6
        else -> R.string.bright_7
    }

    private fun colorRes(key: String): Int = when (key) {
        "hazy" -> R.string.color_hazy
        "dull" -> R.string.color_dull
        "deepRed" -> R.string.color_deepRed
        "red" -> R.string.color_red
        "orangeRed" -> R.string.color_orangeRed
        "orange" -> R.string.color_orange
        "golden" -> R.string.color_golden
        "paleYellow" -> R.string.color_paleYellow
        "pinkPurple" -> R.string.color_pinkPurple
        else -> R.string.color_yellowGreen
    }

    private fun durText(min: Double): String {
        if (!min.isFinite() || min <= 0.0) return "0″"
        val total = min.roundToInt().coerceAtLeast(0)
        val m = total / 60
        val s = total % 60
        return if (m > 0) m.toString() + "′" + s.toString() + "″" else s.toString() + "″"
    }

    private fun facRawText(key: String, raw: Double?): String {
        if (raw == null || !raw.isFinite()) return "—"
        return when (key) {
            "cover", "block", "rh" -> raw.roundToInt().toString() + "%"
            "base" -> uAlt(raw * 1000)
            "heq", "heff" -> uDist(raw, 2)
            "dedge" -> uDist(raw)
            "aod" -> String.format(java.util.Locale.US, "%.2f", raw)
            "vis" -> uDist(raw / 1000, 1)
            "stab" -> "|ΔP/Δt| = " + String.format(java.util.Locale.US, "%.2f", raw) + " hPa/h"
            "wind" -> uSpeed(raw)
            "cape" -> "CAPE " + raw.roundToInt() + " J/kg"
            else -> String.format(java.util.Locale.US, "%.2f", raw)
        }
    }

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
