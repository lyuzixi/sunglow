package com.sunglow.spectrum.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.sunglow.spectrum.core.City
import com.sunglow.spectrum.core.ForecastCache
import com.sunglow.spectrum.core.ForecastEngine
import com.sunglow.spectrum.core.ForecastOutcome
import com.sunglow.spectrum.core.ForecastResult
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
    /** zh / zh_tw / en */
    val lang: String = "zh",
    val reminderEnabled: Boolean = false,
    /** 提醒阈值（概率百分比） */
    val reminderThreshold: Int = 45,
    /** 当前画面来自磁盘快照的时间（毫秒）；非空表示这是离线/缓存数据 */
    val offlineAt: Long? = null,
    /** 错误分型（FailureKind.name），界面据此给出动作 */
    val errorKind: String? = null,
    /** 观测场是否显示 17 个样带采样点 */
    val showSamples: Boolean = false,
    /** 观测场热力面 */
    val heat: com.sunglow.spectrum.core.HeatGrid? = null,
    val heatLoading: Boolean = false,
    val heatDone: Int = 0,
    val heatTotal: Int = 0,
    val heatError: String? = null
)

val DEFAULT_CITY = City("北京市", 116.4074, 39.9042, "北京市")

const val DATE_COUNT = 10

class HomeViewModel(app: Application) : AndroidViewModel(app) {

    private val repo = CityRepository(app)
    private val location = LocationProvider(app)
    private val engine = ForecastEngine(OpenMeteoClient())
    private val prefs = app.getSharedPreferences("sunglow_prefs", android.content.Context.MODE_PRIVATE)

    private val startCity = repo.lastCity() ?: DEFAULT_CITY

    private val _state = MutableStateFlow(
        HomeUiState(
            city = startCity,
            themeMode = prefs.getInt("theme_mode", 0),
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

    init {
        val dates = buildDates(startCity)
        _state.update { it.copy(dates = dates, dateStr = dates.firstOrNull().orEmpty()) }
        load()
        /* 小组件 / 通知点进来：城市、日期、时段一次性应用 */
        viewModelScope.launch {
            LaunchBus.target.collect { t ->
                if (t != null) {
                    applyLaunch(t)
                    LaunchBus.clear()
                }
            }
        }
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
                heatError = null
            )
        }
        load()
    }

    /* ---------- 十日趋势 ---------- */

    /** 切到趋势 Tab 时调用；已有完整结果就不重复跑 */
    fun loadTrend(force: Boolean = false) {
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
                val amOut = engine.runRange(s.city, s.dates, Period.AM, force)
                _state.update { it.copy(trendDone = s.dates.size / 2) }
                val pmOut = engine.runRange(s.city, s.dates, Period.PM, force)

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
                        trendError = firstFailure(amOut, pmOut)
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(trendLoading = false, trendError = "趋势取数中断，请点重试") }
            }
        }
    }

    /** 趋势里第一条失败文案：部分天成功时也把原因说清楚 */
    private fun firstFailure(vararg lists: List<ForecastOutcome>): String? {
        for (l in lists) for (o in l) if (o is ForecastOutcome.Failure) return o.message
        return null
    }

    /* ---------- 观测场热力面 ---------- */

    fun loadHeat(force: Boolean = false) {
        val s = _state.value
        if (s.heatLoading) return
        if (s.result == null) return
        if (!force && s.heat != null &&
            s.heat.dateStr == s.dateStr && s.heat.period == s.period
        ) return
        heatJob?.cancel()
        heatJob = viewModelScope.launch {
            _state.update {
                it.copy(
                    heatLoading = true,
                    heatDone = 0,
                    heatTotal = 24,
                    heatError = null,
                    heat = if (force) null else it.heat
                )
            }
            val grid = runCatching {
                engine.runHeat(s.city, s.dateStr, s.period) { done, total ->
                    _state.update { st -> st.copy(heatDone = done, heatTotal = total) }
                }
            }.getOrNull()
            _state.update {
                it.copy(
                    heatLoading = false,
                    heat = grid,
                    heatError = if (grid == null) "热力面没有取到数据，请稍后重试" else null
                )
            }
        }
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
                heat = null,
                heatError = null,
                citySheetOpen = false
            )
        }
        load()
    }

    fun selectDate(dateStr: String) {
        if (dateStr == _state.value.dateStr) return
        _state.update {
            it.copy(
                dateStr = dateStr,
                result = null,
                offlineAt = null,
                heat = null,
                heatError = null
            )
        }
        load()
    }

    fun selectPeriod(period: Period) {
        if (period == _state.value.period) return
        _state.update {
            it.copy(
                period = period,
                result = null,
                offlineAt = null,
                heat = null,
                heatError = null
            )
        }
        load()
    }

    fun refresh() = load(force = true)

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
        _state.update { it.copy(offlineAt = null, heat = null) }
        WidgetUpdater.updateAll(getApplication())
    }

    /* ---------- 多点对比 ---------- */

    fun nearby(limit: Int = 8): List<Pair<City, Double>> {
        val c = _state.value.city
        return repo.nearby(c.lat, c.lon, limit)
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
                    it.copy(compareLoading = false, compareError = "对比取数失败，请重试")
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

    private fun load(force: Boolean = false) {
        job?.cancel()
        val s = _state.value
        if (s.dateStr.isBlank()) return
        job = viewModelScope.launch {
            val app = getApplication<Application>()
            /* 冷启动/切日期：先把磁盘快照画出来，再让网络结果覆盖 */
            if (!force) {
                val cached = withContext(Dispatchers.IO) {
                    com.sunglow.spectrum.data.ResultCache.get(app, s.city, s.dateStr, s.period)
                }
                if (cached != null && _state.value.result == null) {
                    _state.update { it.copy(result = cached.result, offlineAt = cached.savedAt) }
                }
            }
            _state.update { it.copy(loading = true, error = null, errorKind = null) }
            when (val out = engine.run(s.city, s.dateStr, s.period, force)) {
                is ForecastOutcome.Success -> {
                    _state.update {
                        it.copy(
                            loading = false,
                            result = out.result,
                            error = null,
                            errorKind = null,
                            offlineAt = null
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
                        errorKind = out.kind.name
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
