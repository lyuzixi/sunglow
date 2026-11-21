package com.sunglow.spectrum.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sunglow.spectrum.ui.theme.SunglowTheme

/*
 * R7A 设计同源层 · 共享组件
 *
 * 口径来源：v2/src/styles/tokens.css（光谱渐变、圆角、间距阶梯）；
 * 辉光纪律见 docs/android-app-design.md——辉光只给概率数字与结论标题，
 * 卡片默认不发光，不得出现裸 hex 颜色，一律走 SunglowTheme.colors。
 */

/** 页面区块头：大标题（可带副标题）+ 右侧动作 + 底部分隔发丝线。 */
@Composable
fun SectionHead(
    title: String,
    modifier: Modifier = Modifier,
    action: String? = null,
    onAction: (() -> Unit)? = null,
    subtitle: String? = null
) {
    val colors = SunglowTheme.colors
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleLarge,
                    color = colors.ink
                )
                if (subtitle != null) {
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.muted,
                        modifier = Modifier.padding(top = SunglowTheme.spacing.xs)
                    )
                }
            }
            if (action != null && onAction != null) {
                TextButton(
                    onClick = onAction,
                    modifier = Modifier.heightIn(min = 48.dp),
                    colors = ButtonDefaults.textButtonColors(contentColor = colors.accent)
                ) {
                    Text(text = action, style = MaterialTheme.typography.labelSmall)
                }
            }
        }
        HorizontalDivider(
            modifier = Modifier.padding(top = SunglowTheme.spacing.sm),
            thickness = 1.dp,
            color = colors.rule
        )
    }
}

/** 玻璃卡片容器；accentLine 仅用于 hero 结论卡，默认关闭以遵守辉光纪律。 */
@Composable
fun GlassPanel(
    modifier: Modifier = Modifier,
    accentLine: Boolean = false,
    content: @Composable ColumnScope.() -> Unit
) {
    val colors = SunglowTheme.colors
    val shape = RoundedCornerShape(SunglowTheme.radius.md)
    Column(
        modifier = modifier
            .clip(shape)
            .background(colors.card)
    ) {
        if (accentLine) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(2.dp)
                    .background(Brush.linearGradient(colors.spectrum))
            )
        }
        Column(
            modifier = Modifier.padding(SunglowTheme.spacing.lg),
            content = content
        )
    }
}

/** 分段胶囊：选中态光谱渐变底 + 反色字，未选中态发丝线描边；视觉 36dp、触控 48dp。 */
@Composable
fun SpectrumPill(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val colors = SunglowTheme.colors
    val shape = RoundedCornerShape(999.dp)
    val visualModifier = Modifier
        .height(36.dp)
        .clip(shape)
        .then(
            if (selected) {
                Modifier.background(Brush.horizontalGradient(colors.spectrum))
            } else {
                Modifier
                    .background(colors.glass)
                    .border(1.dp, colors.rule, shape)
            }
        )
        .padding(horizontal = SunglowTheme.spacing.md)

    Box(
        modifier = modifier
            .heightIn(min = 48.dp)
            .clickable(onClick = onClick)
            .padding(vertical = 6.dp),
        contentAlignment = Alignment.Center
    ) {
        Box(modifier = visualModifier, contentAlignment = Alignment.Center) {
            Text(
                text = text,
                style = MaterialTheme.typography.labelSmall,
                color = if (selected) colors.bg else colors.muted,
                textAlign = TextAlign.Center,
                maxLines = 1
            )
        }
    }
}

/** 缓存状态徽章："缓存 · N 分钟前" 或 "取数失败"（isError=true 时用 bad 色）。 */
@Composable
fun CacheBadge(
    text: String,
    modifier: Modifier = Modifier,
    isError: Boolean = false
) {
    val colors = SunglowTheme.colors
    val tint = if (isError) colors.bad else colors.faint
    val shape = RoundedCornerShape(999.dp)
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall.copy(color = tint),
        modifier = modifier
            .background(colors.glass, shape)
            .border(1.dp, tint.copy(alpha = 0.45f), shape)
            .padding(
                horizontal = SunglowTheme.spacing.sm,
                vertical = SunglowTheme.spacing.xs
            ),
        maxLines = 1
    )
}

/** 三宫格单元：上方小标签 + 下方读数（emphasize 时读数用强调色）。 */
@Composable
fun MetricCell(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    emphasize: Boolean = false
) {
    val colors = SunglowTheme.colors
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(SunglowTheme.spacing.xs)
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = colors.faint,
            maxLines = 1
        )
        Text(
            text = value,
            style = MaterialTheme.typography.headlineSmall.copy(
                color = if (emphasize) colors.accent else colors.ink,
                fontFeatureSettings = "tnum"
            ),
            maxLines = 1
        )
    }
}

/** 首屏概率/质量大数字：tnum 等宽读数；glow 仅用于概率数字与结论标题。 */
@Composable
fun BigNumber(
    value: String,
    modifier: Modifier = Modifier,
    glow: Boolean = false,
    color: Color? = null
) {
    /* 默认色不能在参数位调用 @Composable getter（SunglowTheme.colors），故用 nullable 在函数体内取值 */
    val resolvedColor = color ?: SunglowTheme.colors.ink
    val displayModifier = if (glow) {
        modifier
            .drawBehind {
                val center = Offset(size.width / 2f, size.height / 2f)
                drawCircle(
                    color = resolvedColor.copy(alpha = 0.13f),
                    radius = size.minDimension * 0.62f,
                    center = center
                )
            }
            .graphicsLayer {
                shadowElevation = 18f
                ambientColor = resolvedColor
                spotColor = resolvedColor
            }
    } else {
        modifier
    }
    Text(
        text = value,
        style = MaterialTheme.typography.displayLarge.copy(
            fontSize = 50.sp,
            fontFeatureSettings = "tnum",
            color = resolvedColor
        ),
        modifier = displayModifier,
        maxLines = 1
    )
}
