# SUNGLOW 原生工程 · 混淆规则
# Compose 与 kotlinx.serialization 的规则由各自插件提供，这里只放项目自有内容。

# 保留算法层类名与字段名，便于崩溃栈直接对应源码
-keep class com.sunglow.spectrum.core.** { *; }
-keep class com.sunglow.spectrum.data.** { *; }
