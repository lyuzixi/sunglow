package com.sunglow.spectrum.ui.screens

import android.Manifest
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.sunglow.spectrum.R
import com.sunglow.spectrum.core.ModelSel
import com.sunglow.spectrum.core.verdictViewOf
import com.sunglow.spectrum.ui.AppPage
import com.sunglow.spectrum.ui.HomeUiState
import com.sunglow.spectrum.ui.HomeViewModel
import com.sunglow.spectrum.ui.motion.rememberMotionEnabled
import com.sunglow.spectrum.ui.share.ShareCard
import com.sunglow.spectrum.ui.theme.SunglowTheme

@Composable
fun SecondaryScreen(
    page: AppPage,
    vm: HomeViewModel,
    onBack: () -> Unit,
    onOpenPage: (AppPage) -> Unit
) {
    val colors = SunglowTheme.colors
    val state by vm.state.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().background(colors.bg)) {
        PageTopBar(page, onBack) { onOpenPage(AppPage.More) }
        Box(Modifier.weight(1f)) {
            when (page) {
                AppPage.More -> MoreScreen(state, onOpenPage)
                AppPage.Compare -> CompareScreen(vm)
                AppPage.Share -> ShareScreen(vm, state)
                AppPage.Factors -> FactorsScreen(state)
                AppPage.Ray -> RayScreen(state)
                AppPage.Calib -> CalibScreen(vm, state)
                AppPage.Notes -> NotesScreen()
                AppPage.Guide -> GuideScreen()
                AppPage.About -> AboutSheet(state.requestCount)
                AppPage.Settings -> SettingsScreen(vm, state, onOpenPage)
                AppPage.Feedback -> FeedbackScreen()
                AppPage.AppLab -> AppLabScreen(vm, state, onOpenPage)
                else -> Unit
            }
        }
        if (page != AppPage.More) PageFooter(page, onOpenPage)
    }
}

@Composable
private fun PageTopBar(page: AppPage, onBack: () -> Unit, onMore: () -> Unit) {
    val colors = SunglowTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .height(58.dp)
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        TextButton(onClick = onBack) { Text("‹ " + stringResource(R.string.page_back), color = colors.ink) }
        Text(
            text = stringResource(page.titleRes),
            color = colors.ink,
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.weight(1f),
            textAlign = TextAlign.Center
        )
        TextButton(onClick = onMore, enabled = page != AppPage.More) {
            Text(if (page == AppPage.More) "" else stringResource(R.string.page_more), color = colors.accentCool)
        }
    }
}

@Composable
private fun PageFooter(page: AppPage, onOpenPage: (AppPage) -> Unit) {
    val colors = SunglowTheme.colors
    val pages = AppPage.menuPages
    val index = pages.indexOf(page).coerceAtLeast(0)
    val previous = pages.getOrNull(index - 1)
    val next = pages.getOrNull(index + 1) ?: AppPage.More
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, colors.rule)
            .padding(horizontal = 12.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        TextButton(onClick = { onOpenPage(previous ?: AppPage.More) }, modifier = Modifier.weight(1f)) {
            Text("‹ " + (previous?.let { stringResource(it.titleRes) } ?: stringResource(R.string.page_more)), color = colors.muted)
        }
        Text("${index + 1}/${pages.size}", color = colors.faint, fontSize = 11.sp)
        TextButton(onClick = { onOpenPage(next) }, modifier = Modifier.weight(1f)) {
            Text((next.let { stringResource(it.titleRes) }) + " ›", color = colors.muted)
        }
    }
}

@Composable
private fun MoreScreen(state: HomeUiState, onOpenPage: (AppPage) -> Unit) {
    val colors = SunglowTheme.colors
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 18.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Text(state.city.shortName + " · " + state.dateStr, color = colors.muted, fontSize = 13.sp)
        listOf(
            R.string.more_group_main to listOf(AppPage.Compare, AppPage.Share),
            R.string.more_group_detail to listOf(AppPage.Factors, AppPage.Ray, AppPage.Calib, AppPage.Notes),
            R.string.more_group_support to listOf(AppPage.Guide, AppPage.About, AppPage.Settings),
            R.string.more_group_other to listOf(AppPage.Feedback, AppPage.AppLab)
        ).forEach { (groupRes, pages) ->
            Text(stringResource(groupRes), color = colors.accentCool, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
            pages.chunked(2).forEach { rowPages ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                rowPages.forEach { page ->
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(14.dp))
                            .background(colors.bg2)
                            .border(1.dp, colors.rule, RoundedCornerShape(14.dp))
                            .clickable { onOpenPage(page) }
                            .padding(16.dp)
                    ) {
                        Text(stringResource(page.titleRes), color = colors.ink, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(6.dp))
                        Text(stringResource(pageSubtitle(page)), color = colors.faint, fontSize = 11.sp, lineHeight = 16.sp)
                    }
                }
                if (rowPages.size == 1) Spacer(Modifier.weight(1f))
            }
        }
        }
        Text(
            text = stringResource(R.string.about_version),
            color = colors.faint,
            fontSize = 11.sp,
            modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
            textAlign = TextAlign.Center
        )
    }
}

@Composable
private fun GuideScreen() {
    val colors = SunglowTheme.colors
    val context = LocalContext.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 18.dp)) {
        GuideSheet()
        listOf(
            R.string.guide_download to (com.sunglow.spectrum.core.SHARE_SITE + "download.html"),
            R.string.guide_classic to (com.sunglow.spectrum.core.SHARE_SITE + "V1/index.html")
        ).forEach { (labelRes, url) ->
            Text(
                stringResource(labelRes),
                color = colors.accentCool,
                fontSize = 13.sp,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 4.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .border(1.dp, colors.ruleStrong, RoundedCornerShape(12.dp))
                    .clickable { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }
                    .padding(horizontal = 16.dp, vertical = 16.dp)
            )
        }
    }
}

private fun pageSubtitle(page: AppPage): Int = when (page) {
    AppPage.Compare -> R.string.page_compare_sub
    AppPage.Share -> R.string.page_share_sub
    AppPage.Factors -> R.string.page_factors_sub
    AppPage.Ray -> R.string.page_ray_sub
    AppPage.Calib -> R.string.page_calib_sub
    AppPage.Notes -> R.string.page_notes_sub
    AppPage.Guide -> R.string.page_guide_sub
    AppPage.About -> R.string.page_about_sub
    AppPage.Settings -> R.string.page_settings_sub
    AppPage.Feedback -> R.string.page_feedback_sub
    else -> R.string.page_app_lab_sub
}

@Composable
private fun CompareScreen(vm: HomeViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp)) {
        ComparePanel(state, vm::clearCompare)
        Spacer(Modifier.height(12.dp))
        NearbyPanel(state, vm::toggleCompare, vm.nearby())
        Spacer(Modifier.height(12.dp))
        CompareAddPanel(
            search = vm::searchCities,
            onToggle = vm::toggleCompare,
            onAddPoint = vm::addCustomPoint,
            selected = state.compareCities.map { it.name }.toSet(),
            full = state.compareCities.size >= 4
        )
    }
}

@Composable
private fun FactorsScreen(state: HomeUiState) {
    if (state.result == null) EmptyPage(stringResource(R.string.empty_need_result))
    else FactorsSheet(state.result)
}

@Composable
private fun RayScreen(state: HomeUiState) {
    if (state.result == null) EmptyPage(stringResource(R.string.empty_need_result))
    else RaySheet(state.result)
}

@Composable
private fun CalibScreen(vm: HomeViewModel, state: HomeUiState) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp)) {
        CalibPanel(state, vm::recordSighting)
    }
}

@Composable
private fun NotesScreen() {
    val colors = SunglowTheme.colors
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(22.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(stringResource(R.string.settings_notes_title), color = colors.ink, style = MaterialTheme.typography.headlineSmall)
        Text(stringResource(R.string.settings_notes_body), color = colors.muted, style = MaterialTheme.typography.bodyLarge, lineHeight = 24.sp)
        Text(stringResource(R.string.about_data), color = colors.faint, style = MaterialTheme.typography.bodyMedium, lineHeight = 21.sp)
        Text(stringResource(R.string.notes_method), color = colors.muted, style = MaterialTheme.typography.bodyLarge, lineHeight = 24.sp)
    }
}

@Composable
private fun SettingsScreen(vm: HomeViewModel, state: HomeUiState, onOpenPage: (AppPage) -> Unit) {
    val ctx = LocalContext.current
    SettingsSheet(
        themeMode = state.themeMode,
        photoMode = state.photoMode,
        imperial = state.imperial,
        hour12 = state.hour12,
        lang = state.lang,
        reminderEnabled = state.reminderEnabled,
        reminderThreshold = state.reminderThreshold,
        showSamples = state.showSamples,
        onSetTheme = vm::setThemeMode,
        onSetPhotoMode = vm::setPhotoMode,
        onSetImperial = vm::setImperial,
        onSetHour12 = vm::setHour12,
        onSetLang = { vm.setLanguage(it); (ctx as? android.app.Activity)?.recreate() },
        onSetReminder = vm::setReminderEnabled,
        onSetThreshold = vm::setReminderThreshold,
        onSetSamples = vm::setShowSamples,
        onOpenAbout = { onOpenPage(AppPage.About) },
        onOpenGuide = { onOpenPage(AppPage.Guide) },
        onFeedback = { onOpenPage(AppPage.Feedback) },
        onClearCache = vm::clearLocalCache,
        cacheStats = vm::cacheStats,
        onClearResults = vm::clearResultCache,
        onClearMemory = vm::clearPointCache
    )
}

@Composable
private fun ShareScreen(vm: HomeViewModel, state: HomeUiState) {
    val result = state.result
    if (result == null) {
        EmptyPage(stringResource(R.string.empty_need_result))
        return
    }
    var modelSel by remember { mutableStateOf(ModelSel.ENS) }
    ShareSheet(
        result = result,
        view = verdictViewOf(result, modelSel),
        state = state,
        onLoadHeat = { vm.loadMapHeat() }
    )
}

@Composable
private fun FeedbackScreen() {
    val colors = SunglowTheme.colors
    val ctx = LocalContext.current
    val url = stringResource(R.string.feedback_url)
    val qr = remember(url) { ShareCard.qr(url, 520) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(22.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(stringResource(R.string.feedback_title), color = colors.ink, style = MaterialTheme.typography.headlineSmall)
        Text(stringResource(R.string.feedback_body), color = colors.muted, textAlign = TextAlign.Center, lineHeight = 22.sp)
        if (qr != null) {
            Image(bitmap = qr.asImageBitmap(), contentDescription = stringResource(R.string.feedback_title), modifier = Modifier.size(220.dp).clip(RoundedCornerShape(16.dp)))
        } else {
            Text("—", color = colors.faint, modifier = Modifier.size(220.dp).clip(RoundedCornerShape(16.dp)).background(colors.bg2).padding(88.dp), textAlign = TextAlign.Center)
        }
        Text(
            text = stringResource(R.string.feedback_open),
            color = colors.bg,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(colors.accent)
                .clickable { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
                .padding(vertical = 14.dp)
        )
    }
}

@Composable
private fun AppLabScreen(vm: HomeViewModel, state: HomeUiState, onOpenPage: (AppPage) -> Unit) {
    val colors = SunglowTheme.colors
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(stringResource(R.string.app_lab_intro), color = colors.muted, lineHeight = 22.sp)
        LabToggle(stringResource(R.string.settings_reminder), state.reminderEnabled, vm::setReminderEnabled)
        LabToggle(stringResource(R.string.settings_samples), state.showSamples, vm::setShowSamples)
        LabRow(stringResource(R.string.app_lab_widget), stringResource(R.string.app_lab_widget_note))
        LabRow(stringResource(R.string.app_lab_offline), stringResource(R.string.app_lab_offline_note))
        LabRow(stringResource(R.string.app_lab_pack), stringResource(R.string.app_lab_pack_note))
        TextButton(onClick = { onOpenPage(AppPage.Settings) }, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.app_lab_open_settings), color = colors.accentCool)
        }
    }
}

@Composable
private fun LabToggle(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    val colors = SunglowTheme.colors
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(colors.bg2).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, color = colors.ink, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun LabRow(title: String, note: String) {
    val colors = SunglowTheme.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(colors.bg2).padding(14.dp)) {
        Text(title, color = colors.ink, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(5.dp))
        Text(note, color = colors.faint, fontSize = 12.sp, lineHeight = 18.sp)
    }
}

@Composable
private fun EmptyPage(message: String) {
    val colors = SunglowTheme.colors
    Box(Modifier.fillMaxSize().padding(28.dp), contentAlignment = Alignment.Center) {
        Text(message, color = colors.muted, textAlign = TextAlign.Center, lineHeight = 22.sp)
    }
}
