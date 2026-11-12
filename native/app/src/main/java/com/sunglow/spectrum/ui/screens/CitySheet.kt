package com.sunglow.spectrum.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sunglow.spectrum.core.City
import com.sunglow.spectrum.ui.theme.SunglowTheme

/*
 * 城市选择：搜索（城市名 / 短名 / 拼音 / 省份）、最近使用、当前定位。
 * 全量城市表来自 assets/cities.tsv（CI 从网页端城市库生成）。
 */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CitySheet(
    recent: List<City>,
    onSearch: (String) -> List<City>,
    onPick: (City) -> Unit,
    onLocate: () -> Unit,
    onDismiss: () -> Unit
) {
    val colors = SunglowTheme.colors
    var q by remember { mutableStateOf("") }
    val results = remember(q) { if (q.isBlank()) emptyList() else onSearch(q) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = colors.bg2,
        contentColor = colors.ink,
        dragHandle = { BottomSheetDefaults.DragHandle(color = colors.ruleStrong) }
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 20.dp)
                .padding(bottom = 20.dp)
        ) {
            Text(
                text = "选择城市",
                style = MaterialTheme.typography.headlineMedium,
                color = colors.ink
            )

            Spacer(Modifier.height(14.dp))

            OutlinedTextField(
                value = q,
                onValueChange = { q = it },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("城市名、拼音或省份") },
                shape = RoundedCornerShape(12.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = colors.accentCool,
                    unfocusedBorderColor = colors.ruleStrong,
                    focusedTextColor = colors.ink,
                    unfocusedTextColor = colors.ink,
                    cursorColor = colors.accentCool,
                    focusedPlaceholderColor = colors.muted,
                    unfocusedPlaceholderColor = colors.muted
                )
            )

            TextButton(
                onClick = onLocate,
                contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)
            ) {
                Text(
                    text = "使用当前定位",
                    style = MaterialTheme.typography.bodyLarge,
                    color = colors.accentCool
                )
            }

            when {
                q.isBlank() -> {
                    if (recent.isNotEmpty()) {
                        Text(
                            text = "最近使用",
                            style = MaterialTheme.typography.labelSmall,
                            color = colors.muted
                        )
                        Spacer(Modifier.height(8.dp))
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(recent, key = { it.name }) { c ->
                                RecentChip(c) { onPick(c) }
                            }
                        }
                        Spacer(Modifier.height(16.dp))
                    }
                    Text(
                        text = "输入城市名、拼音或省份，例如「杭州」「hangzhou」「广东」。",
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.muted
                    )
                }

                results.isEmpty() -> {
                    Text(
                        text = "没有匹配的城市，换个关键词试试。",
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.muted
                    )
                }

                else -> {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 380.dp)
                    ) {
                        items(results, key = { it.name + it.lat }) { c ->
                            CityRow(c) { onPick(c) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RecentChip(city: City, onClick: () -> Unit) {
    val colors = SunglowTheme.colors
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(colors.card)
            .border(1.dp, colors.ruleStrong, RoundedCornerShape(999.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 7.dp)
    ) {
        Text(
            text = city.name,
            style = MaterialTheme.typography.bodyLarge,
            color = colors.ink
        )
    }
}

@Composable
private fun CityRow(city: City, onClick: () -> Unit) {
    val colors = SunglowTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = city.name,
                style = MaterialTheme.typography.bodyLarge,
                color = colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            if (city.region.isNotBlank() && city.region != city.name) {
                Text(
                    text = city.region,
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
        Text(
            text = "选择",
            style = MaterialTheme.typography.bodyMedium,
            color = colors.accentCool
        )
    }
}
