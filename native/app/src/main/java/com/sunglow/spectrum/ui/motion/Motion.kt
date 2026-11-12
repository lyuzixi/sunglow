package com.sunglow.spectrum.ui.motion

import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import kotlin.math.roundToInt

/*
 * 动效与触觉的统一入口
 * 全部动画都遵守系统「移除动画」设置：ANIMATOR_DURATION_SCALE = 0 时直接落位。
 */

/** 系统动画缩放是否为 0（无障碍里的“移除动画”） */
@Composable
fun rememberMotionEnabled(): Boolean {
    val ctx = LocalContext.current
    return remember(ctx) {
        try {
            Settings.Global.getFloat(
                ctx.contentResolver,
                Settings.Global.ANIMATOR_DURATION_SCALE,
                1f
            ) > 0f
        } catch (_: Exception) {
            true
        }
    }
}

/** 数字滚动：从当前显示值滚到 target，切换模型时不会“从 0 重来” */
@Composable
fun AnimatedNumberText(
    target: Double,
    style: TextStyle,
    color: Color,
    modifier: Modifier = Modifier,
    durationMs: Int = 600,
    suffix: String = "",
    enabled: Boolean = true
) {
    val anim = remember { Animatable(0f) }
    LaunchedEffect(target, enabled) {
        if (!enabled) {
            anim.snapTo(target.toFloat())
        } else {
            anim.animateTo(target.toFloat(), tween(durationMs, easing = FastOutSlowInEasing))
        }
    }
    Text(
        text = anim.value.roundToInt().toString() + suffix,
        style = style,
        color = color,
        modifier = modifier
    )
}

/** 按压缩放：所有可点卡片共用，松手回弹 */
fun Modifier.pressScale(
    interactionSource: MutableInteractionSource,
    pressedScale: Float = 0.985f,
    enabled: Boolean = true
): Modifier = composed {
    val pressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed && enabled) pressedScale else 1f,
        animationSpec = spring(dampingRatio = 0.75f, stiffness = 900f),
        label = "pressScale"
    )
    graphicsLayer {
        scaleX = scale
        scaleY = scale
    }
}

/** 触觉：只给关键节点（切换、展开、分享成功） */
fun HapticFeedback.tap() = performHapticFeedback(HapticFeedbackType.TextHandleMove)

fun HapticFeedback.open() = performHapticFeedback(HapticFeedbackType.LongPress)

fun HapticFeedback.confirm() = performHapticFeedback(HapticFeedbackType.LongPress)
