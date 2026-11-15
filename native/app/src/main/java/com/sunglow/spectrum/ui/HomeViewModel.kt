package com.sunglow.spectrum.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.sunglow.spectrum.R
import com.sunglow.spectrum.core.City
import com.sunglow.spectrum.core.DisplayPrefs
import com.sunglow.spectrum.core.ModelSel
import com.sunglow.spectrum.core.ForecastCache
import com.sunglow.spectrum.core.ForecastEngine
import com.sunglow.spectrum.core.ForecastOutcome
import com.sunglow.spectrum.core.ForecastResult
import com.sunglow.spectrum.core.LoadMode
import com.sunglow.spectrum.core.decideLoad
import com.sunglow.spectrum.core.Period
import com.sunglow.spectrum.core.TzCache
import com.sunglow.spectrum.core.addDaysIso
import com.sunglow.spectrum.core.todayInTz
import com.sunglow.spectrum.data.CityRepository
import com.sunglow.spectrum.data.ForecastStore
import com.sunglow.spectrum.data.LocationProvider
import com.sunglow.spectrum.data.OpenMeteoClient
import com.sunglow.spectrum.ui.i18n.Lang
import com.sunglow.spectrum.widget.WidgetUpdater
import com.sunglow.spectrum.work.ReminderScheduler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.Locale
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/*
 * 主屏状态
 * 只做三件事：选城市 / 选日期时段 / 取一次单点预报。
 * 趋势按需加载（切到趋势 Tab 才跑），观测场复用当前结果。
 */

/** 趋势里的单日单时段 */
data class TrendCell(val p: Double, val q: Double, val grade: String)

/** 趋势里的一天：朝 + 晚 */
data class TrendRow(val date: String, val am: TrendCell?, val pm: TrendCell?)

/** 多点对比的一行 */
data class CompareCell(
    val city: City,
    val p: Double,
    val q: Double,
    val grade: String
)

/** 设置页盘点用：磁盘结果 + 内存单点缓存 */
data class AppCacheStats(
    val diskCount: Int,
    val diskBytes: Long,
    val oldest: Long?,
    val memoryCount: Int
)

data class HomeUiState(
    val city: City = DEFAULT_CITY,
    val dates: List<String> = emptyList(),
    val dateStr: String = "",
    /** 0 结论 / 1 趋势 / 2 观测场：放进全局状态，趋势点某天才能跳回结论 Tab */
    val tab: Int = 0,
    val period: Period = Period.PM,
    val loading: Boolean = false,
    val result: ForecastResult? = null,
    val error: String? = null,
    val citySheetOpen: Boolean = false,
    /* 十日趋势 */
    val trend: List<TrendRow> = emptyList(),
    val trendLoading: Boolean = false,
    val trendDone: Int = 0,
    val trendTotal: Int = 0,
    val trendError: String? = null,
    /** 多点对比 */
    val compareCities: List<City> = emptyList(),
    val compareRows: List<CompareCell> = emptyList(),
    val compareLoading: Boolean = false,
    val compareError: String? = null,
    /** 实况校准：城市名 → (看到次数, 记录次数) */
    val sightings: Map<String, Pair<Int, Int>> = emptyMap(),
    /** 0 跟随系统 / 1 深色 / 2 浅色 */
    val themeMode: Int = 0,
    /** 0 隐藏 / 1 照片 / 2 照片+霞光 / 3 仅霞光 */
    val photoMode: Int = 2,
    val imperial: Boolean = false,
    val hour12: Boolean = false,
    /** 输入已变化，等待用户明确点击「计算」 */
    val pendingInput: Boolean = false,
    /** zh / zh_tw / en */
    val lang: String = "zh",
    val reminderEnabled: Boolean = false,
    /** 提醒阈值（概率百分比） */
    val reminderThreshold: Int = 45,
    /** 当前画面来自磁盘快照的时间（毫秒）；非空表示这是离线/缓存数据 */
    val offlineAt: Long? = null,
    /** 错误分型（FailureKind.name），界面据此给出动作 */
    val errorKind: String? = null,
    /** N5：这一天的结果没有新鲜缓存，且按纪律**不自动取数**，等用户点「更新」 */
    val needsFetch: Boolean = false,
    /** N5：本次会话真实发出的请求数（真机验收「不取数」就看这个数有没有涨） */
    val requestCount: Int = 0,
    /** 观测场是否显示 17 个样带采样点 */
    val showSamples: Boolean = false,
    /** 观测场热力面 */
    val heat: com.sunglow.spectrum.core.HeatGrid? = null,
    val heatLoading: Boolean = false,
    val heatDone: Int = 0,
    val heatTotal: Int = 0,
    val heatError: String? = null,
    /** 观测场独立输入与数据；主结论变化不会自动覆盖这里 */
    val mapDateStr: String = "",
    val mapPeriod: Period = Period.PM,
    val mapModel: ModelSel = ModelSel.ENS,
    val mapHeat: com.sunglow.spectrum.core.HeatGrid? = null,
    val mapSrc: String = "",
    val mapAgeMs: Long? = null,
    val mapLoading: Boolean = false,
    val mapDone: Int = 0,
    val mapTotal: Int = 0,
    val mapError: String? = null,
    /** 非空 = 正在看网页分享来的快照，不取数 */
    val packSnapshot: com.sunglow.spectrum.core.PackSnapshot? = null
)

val DEFAULT_CITY = City("北京市", 116.4074, 39.9042, "北京市")

const val DATE_COUNT = 10

class HomeViewModel(private val app: Application) : AndroidViewModel(app) {

    private val repo = CityRepository(app)
    private val location = LocationProvider(app)
    private val client = OpenMeteoClient()
    private val engine = ForecastEngine(client)
    private val prefs = app.getSharedPreferences("sunglow_prefs", android.content.Context.MODE_PRIVATE)

    private val startCity = repo.lastCity() ?: DEFAULT_CITY

    private val _state = MutableStateFlow(
        HomeUiState(
            city = startCity,
            themeMode = prefs.getInt("theme_mode", 0),
            photoMode = prefs.getInt("photo_mode", 2),
            imperial = prefs.getBoolean("imperial", false),
            hour12 = prefs.getBoolean("hour12", false),
            lang = prefs.getString("lang", "zh") ?: "zh",
            reminderEnabled = prefs.getBoolean("reminder_enabled", false),
            reminderThreshold = prefs.getInt("reminder_threshold", 45),
            showSamples = prefs.getBoolean("show_samples", false),
            sightings = parseSightings(prefs.getString("sightings", "").orEmpty())
        )
    )
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    private var compareJob: Job? = null

    private var job: Job? = null
    private var trendJob: Job? = null
    private var heatJob: Job? = null

    /* N5 取数纪律：本会话是否已经做过一次自动加载。
       做过之后，切日期/时段就不再自动取数（省额度，等用户显式点更新）。 */
    private var autoFetchSpent = false

    init {
        val dates = buildDates(startCity)
        DisplayPrefs.photoMode = prefs.getInt("photo_mode", 2)
        DisplayPrefs.imperial = prefs.getBoolean("imperial", false)
        DisplayPrefs.hour12 = prefs.getBoolean("hour12", false)
        _state.update {
            it.copy(
                dates = dates,
                dateStr = dates.firstOrNull().orEmpty(),
                mapDateStr = dates.firstOrNull().orEmpty()
            )
        }
        val first = LaunchBus.target.value
        if (first?.pack != null) {
            applyPack(first.pack)
            LaunchBus.clear()
        } else {
            load(LoadMode.AUTO)
        }
        /* 小组件 / 通知点进来：城市、日期、时段一次性应用 */
        viewModelScope.launch {
            LaunchBus.target.collect { t ->
                if (t != null) {
                    if (t.pack != null) applyPack(t.pack) else applyLaunch(t)
                    LaunchBus.clear()
                }
            }
        }
    }

    /**
     * 网页完整快照：直接进快照态，覆盖任何取数（requestCount 不变）。
     * 解码失败退回普通首页，不弹空白页。
     */
    private fun applyPack(raw: String) {
        val snap = com.sunglow.spectrum.core.decodePack(raw)
        if (snap == null) {
            load(LoadMode.AUTO)
            return
        }
        val q = snap.q
        val city = repo.cities.firstOrNull {
            it.name == q.name || it.shortName == q.name
        }
        _state.update { s ->
            s.copy(
                city = city ?: s.city,
                dateStr = q.date.takeIf { it.isNotBlank() } ?: s.dateStr,
                period = when (q.period) {
                    "am" -> Period.AM
                    "pm" -> Period.PM
                    else -> s.period
                },
                tab = 0,
                result = null,
                trend = emptyList(),
                compareRows = emptyList(),
                error = null,
                errorKind = null,
                packSnapshot = snap
            )
        }
    }

    /** 退出快照，回到实时预报 */
    fun exitPack() {
        _state.update { it.copy(packSnapshot = null) }
        load(LoadMode.AUTO)
    }

    private fun applyLaunch(t: LaunchTarget) {
        val s = _state.value
        /* 允许「只带日期/时段」的深链：没有城市名时沿用当前城市，不再直接 return */
        val city = t.cityName?.let { n ->
            repo.cities.firstOrNull { it.name == n || it.shortName == n }
        } ?: s.city
        if (t.cityName != null) repo.remember(city)
        val baseDates = buildDates(city)
        val wanted = t.dateStr?.takeIf { it.matches(Regex("\\d{4}-\\d{2}-\\d{2}")) }
        /* 窗口外日期（历史分享链接 / 深链）补进首项，避免日期控件显示空白；换日期不自动取数 */
        val dates = if (wanted != null && !baseDates.contains(wanted)) {
            listOf(wanted) + baseDates
        } else {
            baseDates
        }
        val date = wanted ?: if (dates.contains(s.dateStr)) s.dateStr else dates.firstOrNull().orEmpty()
        _state.update {
            it.copy(
                city = city,
                dates = dates,
                dateStr = date,
                period = t.period ?: it.period,
                result = null,
                error = null,
                errorKind = null,
                offlineAt = null,
                heat = null,
                heatError = null,
                needsFetch = false
            )
        }
        /* 深链是用户显式动作：缓存优先，没有才取 */
        load(LoadMode.CLICK)
    }

    /* ---------- 十日趋势 ---------- */

    /** 首次进入只读缓存；用户点击加载/重试时才允许网络。 */
    fun loadTrend(force: Boolean = false, cacheOnly: Boolean = false) {
        val s = _state.value
        if (s.trendLoading) return
        if (!force && s.trend.size >= s.dates.size) return
        trendJob?.cancel()
        trendJob = viewModelScope.launch {
            _state.update {
                it.copy(
                    trendLoading = true,
                    trendError = null,
                    trendDone = 0,
                    trendTotal = s.dates.size,
                    trend = if (force) emptyList() else it.trend
                )
            }
            try {
                /* 区间取数：10 天朝/晚各 3 个请求（合计 6 个），不再是 60 个 */
                val amOut = engine.runRange(s.city, s.dates, Period.AM, force, cacheOnly)
                _state.update { it.copy(trendDone = s.dates.size / 2) }
                val pmOut = engine.runRange(s.city, s.dates, Period.PM, force, cacheOnly)

                val rows = s.dates.mapIndexed { i, d ->
                    val am = (amOut.getOrNull(i) as? ForecastOutcome.Success)?.result
                    val pm = (pmOut.getOrNull(i) as? ForecastOutcome.Success)?.result
                    TrendRow(
                        date = d,
                        am = am?.let { TrendCell(it.p, it.q, it.grade) },
                        pm = pm?.let { TrendCell(it.p, it.q, it.grade) }
                    )
                }
                _state.update {
                    it.copy(
                        trend = rows,
                        trendDone = s.dates.size,
                        trendLoading = false,
                        trendError = if (cacheOnly && rows.all { it.am == null && it.pm == null }) {
                            null
                        } else {
                            firstFailure(amOut, pmOut)
                        }
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(trendLoading = false, trendError = app.getString(R.string.err_trend_failed)) }
            }
        }
    }

    /** 趋势里第一条失败文案：部分天成功时也把原因说清楚 */
    private fun firstFailure(vararg lists: List<ForecastOutcome>): String? {
        for (l in lists) for (o in l) if (o is ForecastOutcome.Failure) return o.message
        return null
    }

    /* ---------- 观测场热力面 ---------- */

    /** 兼容旧分享入口：加载当前观测场，而不是强制套用首页日期/时段。 */
    fun loadHeat(force: Boolean = false) = loadMapHeat(force = force)

    fun selectMapDate(date: String) {
        _state.update { it.copy(mapDateStr = date, mapError = null) }
    }

    fun selectMapPeriod(period: Period) {
        _state.update { it.copy(mapPeriod = period, mapError = null) }
    }

    fun selectMapModel(model: ModelSel) {
        _state.update { it.copy(mapModel = model) }
    }

    /** 只有这个函数会为观测场取数；主结论 result 不是前置条件。 */
    fun loadMapHeat(date: String? = null, period: Period? = null, force: Boolean = false) {
        val before = _state.value
        val wantedDate = date ?: before.mapDateStr.ifBlank { before.dateStr }
        val wantedPeriod = period ?: before.mapPeriod
        if (before.mapLoading) return
        val current = before.mapHeat
        if (!force && current != null && current.dateStr == wantedDate && current.period == wantedPeriod) return
        heatJob?.cancel()
        heatJob = viewModelScope.launch {
            _state.update {
                it.copy(
                    mapDateStr = wantedDate,
                    mapPeriod = wantedPeriod,
                    mapLoading = true,
                    mapDone = 0,
                    mapTotal = 24,
                    mapError = null,
                    heatLoading = true,
                    heatDone = 0,
                    heatTotal = 24,
                    heatError = null
                )
            }
            val grid = runCatching {
                engine.runHeat(before.city, wantedDate, wantedPeriod) { done, total ->
                    _state.update { st -> st.copy(mapDone = done, mapTotal = total, heatDone = done, heatTotal = total) }
                }
            }.getOrNull()
            _state.update {
                val error = if (grid == null) app.getString(R.string.err_heat_failed) else null
                it.copy(
                    mapLoading = false,
                    mapHeat = grid ?: it.mapHeat,
                    mapSrc = if (grid == null) it.mapSrc else "network",
                    mapAgeMs = if (grid == null) it.mapAgeMs else System.currentTimeMillis(),
                    mapError = error,
                    heatLoading = false,
                    heat = grid ?: it.heat,
                    heatError = error
                )
            }
        }
    }

    /** TOP 点位标签：25 km 内用最近城市短名，否则用经纬度。 */
    fun mapPlaceLabel(lat: Double, lon: Double): String {
        val near = repo.nearest(lat, lon)
        if (near != null && near.second <= 25.0) return near.first.shortName
        return String.format(Locale.US, "%.2f, %.2f", lat, lon)
    }

    fun setShowSamples(on: Boolean) {
        prefs.edit().putBoolean("show_samples", on).apply()
        _state.update { it.copy(showSamples = on) }
    }

    /* ---------- 选择 ---------- */

    fun selectCity(city: City) {
        repo.remember(city)
        val dates = buildDates(city)
        _state.update {
            it.copy(
                city = city,
                dates = dates,
                dateStr = dates.firstOrNull().orEmpty(),
                result = null,
                error = null,
                errorKind = null,
                offlineAt = null,
                pendingInput = true,
                needsFetch = true,
                citySheetOpen = false,
                trend = emptyList(),
                trendError = null,
                /* 城市不同则旧地图不能冒充新城市；日期/时段变化则保留旧地图。 */
                heat = null,
                heatError = null,
                mapHeat = null,
                mapError = null,
                mapAgeMs = null
            )
        }
    }

    fun selectDate(dateStr: String) {
        if (dateStr == _state.value.dateStr) return
        _state.update {
            it.copy(
                dateStr = dateStr,
                result = null,
                offlineAt = null,
                pendingInput = true,
                needsFetch = true,
                trend = emptyList(),
                trendError = null
            )
        }
    }

    fun selectPeriod(period: Period) {
        if (period == _state.value.period) return
        _state.update {
            it.copy(
                period = period,
                result = null,
                offlineAt = null,
                pendingInput = true,
                needsFetch = true,
                trend = emptyList(),
                trendError = null
            )
        }
    }

    /** 首页唯一主动取数入口。 */
    fun calculate() {
        _state.update { it.copy(pendingInput = false) }
        load(LoadMode.CLICK)
    }

    fun refresh() = load(LoadMode.FORCE)

    fun setCitySheetOpen(open: Boolean) {
        _state.update { it.copy(citySheetOpen = open) }
    }

    /** 切换底部 Tab；趋势页点某天时用它把用户带回结论页 */
    fun selectTab(index: Int) {
        if (index !in 0..2 || index == _state.value.tab) return
        _state.update { it.copy(tab = index) }
    }

    /** 主题三档：0 跟随系统 / 1 深色 / 2 浅色 */
    fun setThemeMode(mode: Int) {
        prefs.edit().putInt("theme_mode", mode).apply()
        _state.update { it.copy(themeMode = mode) }
    }

    fun setPhotoMode(mode: Int) {
        val value = mode.coerceIn(0, 3)
        prefs.edit().putInt("photo_mode", value).apply()
        DisplayPrefs.photoMode = value
        _state.update { it.copy(photoMode = value) }
    }

    fun setImperial(on: Boolean) {
        prefs.edit().putBoolean("imperial", on).apply()
        DisplayPrefs.imperial = on
        _state.update { it.copy(imperial = on) }
    }

    fun setHour12(on: Boolean) {
        prefs.edit().putBoolean("hour12", on).apply()
        DisplayPrefs.hour12 = on
        _state.update { it.copy(hour12 = on) }
    }

    /* ---------- M5 设置 ---------- */

    fun setLanguage(lang: String) {
        Lang.save(getApplication(), lang)
        _state.update { it.copy(lang = lang) }
    }

    fun setReminderEnabled(on: Boolean) {
        prefs.edit().putBoolean("reminder_enabled", on).apply()
        _state.update { it.copy(reminderEnabled = on) }
        ReminderScheduler.sync(getApplication(), on)
        if (on) ReminderScheduler.checkNow(getApplication())
    }

    fun setReminderThreshold(value: Int) {
        prefs.edit().putInt("reminder_threshold", value).apply()
        _state.update { it.copy(reminderThreshold = value) }
        ReminderScheduler.sync(getApplication(), _state.value.reminderEnabled)
    }

    fun clearLocalCache() {
        ForecastCache.clear()
        ForecastStore.clear(getApplication())
        com.sunglow.spectrum.data.ResultCache.clear(getApplication())
        _state.update { it.copy(offlineAt = null, heat = null, mapHeat = null, mapAgeMs = null) }
        WidgetUpdater.updateAll(getApplication())
    }

    fun cacheStats(): AppCacheStats {
        val d = com.sunglow.spectrum.data.ResultCache.stats(getApplication())
        return AppCacheStats(
            diskCount = d.count,
            diskBytes = d.bytes,
            oldest = d.oldest,
            memoryCount = ForecastCache.size()
        )
    }

    /** 只清磁盘结果（单点结果族），当前内存结果与观测场保留 */
    fun clearResultCache() {
        com.sunglow.spectrum.data.ResultCache.clear(getApplication())
        _state.update { it.copy(offlineAt = null) }
    }

    /** 只清单点内存缓存（最多 12 条），磁盘结果保留 */
    fun clearPointCache() {
        ForecastCache.clear()
    }

    /* ---------- 多点对比 ---------- */

    fun nearby(limit: Int = 8): List<Pair<City, Double>> {
        val c = _state.value.city
        return repo.nearby(c.lat, c.lon, limit)
    }

    /** 经纬度自定义点：名称用坐标串，避免引入未本地化的“自定义”字样 */
    fun addCustomPoint(lat: Double, lon: Double): Boolean {
        if (lat !in -90.0..90.0 || lon !in -180.0..180.0) return false
        if (_state.value.compareCities.size >= 4) return false
        val name = String.format(Locale.US, "%.2f,%.2f", lat, lon)
        toggleCompare(City(name = name, lon = lon, lat = lat))
        return true
    }

    fun toggleCompare(city: City) {
        val list = _state.value.compareCities.toMutableList()
        if (list.any { it.name == city.name }) {
            list.removeAll { it.name == city.name }
        } else if (list.size < 4) {
            list.add(city)
        }
        _state.update { it.copy(compareCities = list) }
        if (list.isEmpty()) {
            _state.update { it.copy(compareRows = emptyList(), compareError = null) }
        } else {
            loadCompare()
        }
    }

    fun loadCompare() {        val s = _state.value
        if (s.compareCities.isEmpty()) return
        compareJob?.cancel()
        compareJob = viewModelScope.launch {
            _state.update { it.copy(compareLoading = true, compareError = null) }
            val rows = mutableListOf<CompareCell>()
            try {
                for (c in s.compareCities) {
                    val out = engine.run(c, s.dateStr, s.period, false)
                    if (out is ForecastOutcome.Success) {
                        val r = out.result
                        rows += CompareCell(c, r.p, r.q, r.grade)
                    }
                }
                _state.update { it.copy(compareRows = rows.toList(), compareLoading = false) }
            } catch (e: Exception) {
                _state.update {
                    it.copy(compareLoading = false, compareError = app.getString(R.string.err_compare_failed))
                }
            }
        }
    }

    fun clearCompare() {
        compareJob?.cancel()
        _state.update {
            it.copy(compareCities = emptyList(), compareRows = emptyList(), compareError = null)
        }
    }

    /* ---------- 实况校准 ---------- */

    fun recordSighting(hit: Boolean) {
        val name = _state.value.city.name
        val cur = _state.value.sightings[name] ?: (0 to 0)
        val next = (cur.first + if (hit) 1 else 0) to (cur.second + 1)
        val map = _state.value.sightings.toMutableMap()
        map[name] = next
        prefs.edit().putString("sightings", encodeSightings(map)).apply()
        _state.update { it.copy(sightings = map) }
    }

    private fun parseSightings(raw: String): Map<String, Pair<Int, Int>> {
        if (raw.isBlank()) return emptyMap()
        return raw.split(';').mapNotNull { seg ->
            val p = seg.split('|')
            if (p.size == 3) {
                val h = p[1].toIntOrNull()
                val t = p[2].toIntOrNull()
                if (h != null && t != null) p[0] to (h to t) else null
            } else null
        }.toMap()
    }

    private fun encodeSightings(map: Map<String, Pair<Int, Int>>): String =
        map.entries.joinToString(";") { "${it.key}|${it.value.first}|${it.value.second}" }

    /* ---------- 城市检索 / 定位 ---------- */

    fun searchCities(q: String): List<City> = repo.search(q)

    fun recentCities(): List<City> = repo.recent()

    fun hasLocationPermission(): Boolean = location.hasPermission()

    /** 有权限时把最后已知位置折算成最近城市；返回是否成功 */
    fun useCurrentLocation(): Boolean {
        val ll = location.lastKnown() ?: return false
        val near = repo.nearest(ll.lat, ll.lon)?.first ?: return false
        selectCity(near)
        return true
    }

    /* ---------- 取数 ---------- */

    /**
     * N5：取数纪律的唯一入口。
     * AUTO —— 自动加载只看缓存；CLICK —— 用户点「更新」，缓存优先；FORCE —— 刷新，绕开缓存。
     */
    private fun load(mode: LoadMode = LoadMode.AUTO) {
        job?.cancel()
        val s = _state.value
        if (s.dateStr.isBlank()) return
        job = viewModelScope.launch {
            val app = getApplication<Application>()
            /* 先读磁盘缓存（6 小时口径）：命中就先画出来 */
            val cached = withContext(Dispatchers.IO) {
                com.sunglow.spectrum.data.ResultCache.get(app, s.city, s.dateStr, s.period)
            }
            val decision = decideLoad(mode, cached != null, autoFetchSpent)
            if (mode == LoadMode.AUTO) autoFetchSpent = true
            if (cached != null && _state.value.result == null) {
                _state.update { it.copy(result = cached.result, offlineAt = cached.savedAt) }
            }
            if (!decision.fetch) {
                /* 不取数：把界面落定，缺结果时提示用户点更新 */
                _state.update { it.copy(loading = false, needsFetch = it.result == null) }
                return@launch
            }
            _state.update { it.copy(loading = true, error = null, errorKind = null, needsFetch = false) }
            when (val out = engine.run(s.city, s.dateStr, s.period, mode == LoadMode.FORCE)) {
                is ForecastOutcome.Success -> {
                    _state.update {
                        it.copy(
                            loading = false,
                            result = out.result,
                            error = null,
                            errorKind = null,
                            offlineAt = null,
                            requestCount = client.requestCount
                        )
                    }
                    withContext(Dispatchers.IO) {
                        ForecastStore.save(app, out.result)
                        com.sunglow.spectrum.data.ResultCache.save(app, out.result)
                    }
                    WidgetUpdater.updateAll(app)
                }
                is ForecastOutcome.Failure -> _state.update {
                    /* 有旧结果（离线快照）时保留它，只把错误挂出来，别把整页清空 */
                    it.copy(
                        loading = false,
                        error = out.message,
                        errorKind = out.kind.name,
                        requestCount = client.requestCount
                    )
                }
            }
        }
    }

    private fun buildDates(city: City): List<String> {
        val today = todayInTz(TzCache.cityTz(city.lat, city.lon))
        return (0 until DATE_COUNT).map { addDaysIso(today, it) }
    }
}
