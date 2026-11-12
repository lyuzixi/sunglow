package com.sunglow.spectrum.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.sunglow.spectrum.core.City
import com.sunglow.spectrum.core.ForecastEngine
import com.sunglow.spectrum.core.ForecastOutcome
import com.sunglow.spectrum.core.ForecastResult
import com.sunglow.spectrum.core.Period
import com.sunglow.spectrum.core.TzCache
import com.sunglow.spectrum.core.addDaysIso
import com.sunglow.spectrum.core.todayInTz
import com.sunglow.spectrum.data.CityRepository
import com.sunglow.spectrum.data.LocationProvider
import com.sunglow.spectrum.data.OpenMeteoClient
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

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
    val themeMode: Int = 0
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
            sightings = parseSightings(prefs.getString("sightings", "").orEmpty())
        )
    )
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    private var compareJob: Job? = null

    private var job: Job? = null
    private var trendJob: Job? = null

    init {
        val dates = buildDates(startCity)
        _state.update { it.copy(dates = dates, dateStr = dates.firstOrNull().orEmpty()) }
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
            val rows = mutableListOf<TrendRow>()
            try {
                for ((i, d) in s.dates.withIndex()) {
                    /* 逐日串行：接口限流比"快"重要，缓存命中后重进会很快 */
                    val amRes = engine.run(s.city, d, Period.AM, force)
                    val pmRes = engine.run(s.city, d, Period.PM, force)
                    val am = (amRes as? ForecastOutcome.Success)?.result
                    val pm = (pmRes as? ForecastOutcome.Success)?.result
                    rows += TrendRow(
                        date = d,
                        am = am?.let { TrendCell(it.p, it.q, it.grade) },
                        pm = pm?.let { TrendCell(it.p, it.q, it.grade) }
                    )
                    _state.update { it.copy(trend = rows.toList(), trendDone = i + 1) }
                    delay(120)
                }
            } catch (e: Exception) {
                _state.update { it.copy(trendError = "趋势取数中断，请点重试") }
            } finally {
                _state.update { it.copy(trendLoading = false) }
            }
        }
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
                citySheetOpen = false
            )
        }
        load()
    }

    fun selectDate(dateStr: String) {
        if (dateStr == _state.value.dateStr) return
        _state.update { it.copy(dateStr = dateStr) }
        load()
    }

    fun selectPeriod(period: Period) {
        if (period == _state.value.period) return
        _state.update { it.copy(period = period) }
        load()
    }

    fun refresh() = load(force = true)

    fun setCitySheetOpen(open: Boolean) {
        _state.update { it.copy(citySheetOpen = open) }
    }

    /** 主题三档：0 跟随系统 / 1 深色 / 2 浅色 */
    fun setThemeMode(mode: Int) {
        prefs.edit().putInt("theme_mode", mode).apply()
        _state.update { it.copy(themeMode = mode) }
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
            _state.update { it.copy(loading = true, error = null) }
            when (val out = engine.run(s.city, s.dateStr, s.period, force)) {
                is ForecastOutcome.Success -> _state.update {
                    it.copy(loading = false, result = out.result, error = null)
                }
                is ForecastOutcome.Failure -> _state.update {
                    it.copy(loading = false, result = null, error = out.message)
                }
            }
        }
    }

    private fun buildDates(city: City): List<String> {
        val today = todayInTz(TzCache.cityTz(city.lat, city.lon))
        return (0 until DATE_COUNT).map { addDaysIso(today, it) }
    }
}
