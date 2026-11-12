package com.sunglow.spectrum.data

import android.content.Context
import com.sunglow.spectrum.core.City
import com.sunglow.spectrum.core.haversineKm
import java.util.Locale

/*
 * SUNGLOW · 城市检索
 * 口径来源：v2/src/core/city.ts（V1 _p2.js searchCity）。
 * 全量城市表由 native/tools/gen-cities.mjs 从 v2/src/core/citydata.ts 生成到
 * assets/cities.tsv；资源缺失时回落到内置的省会清单（本地开发也能跑）。
 */
class CityRepository(context: Context) {

    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences("sunglow", Context.MODE_PRIVATE)

    /** 生成资源里带的别名列（name → 拼音/英文，空格分隔） */
    private val assetAliases = HashMap<String, String>()

    val cities: List<City> by lazy { loadCatalog() }

    private val index: List<Pair<City, String>> by lazy {
        cities.map { c ->
            val aliases = aliasesOf(c.name).lowercase(Locale.ROOT)
            val key = (
                c.name + " " + c.shortName + " " + aliases + " " + c.region
                ).lowercase(Locale.ROOT)
            c to key
        }
    }

    private fun loadCatalog(): List<City> {
        val fromAsset = runCatching {
            appContext.assets.open("cities.tsv").bufferedReader().use { it.readLines() }
        }.getOrNull().orEmpty()
        val parsed = fromAsset.mapNotNull { parseLine(it) }
        return if (parsed.isNotEmpty()) parsed else BUILTIN_CITIES
    }

    private fun parseLine(line: String): City? {
        if (line.isBlank()) return null
        val p = line.split('\t')
        if (p.size < 4) return null
        val lon = p[1].toDoubleOrNull() ?: return null
        val lat = p[2].toDoubleOrNull() ?: return null
        if (p.size >= 5 && p[4].isNotBlank()) assetAliases[p[0]] = p[4]
        return City(name = p[0], lon = lon, lat = lat, region = p[3])
    }

    fun search(q: String, limit: Int = 30): List<City> {
        val s = q.trim().lowercase(Locale.ROOT)
        if (s.isEmpty()) return emptyList()
        val hasAscii = s.any { it in 'a'..'z' }
        val hit = ArrayList<Pair<Int, City>>()
        val seen = HashSet<String>()
        for ((c, key) in index) {
            val nm = c.name.lowercase(Locale.ROOT)
            val toks = key.split(' ')
            val rank = when {
                nm.startsWith(s) -> 0
                toks.any { it.isNotEmpty() && (it.startsWith(s) || (it.length >= 3 && s.startsWith(it))) } -> 1
                !hasAscii && key.contains(s) -> 2
                else -> -1
            }
            if (rank >= 0 && seen.add(c.name)) hit.add(rank to c)
        }
        if (hit.isEmpty()) {
            for ((c, key) in index) {
                if (key.contains(s) && seen.add(c.name)) hit.add(2 to c)
            }
        }
        return hit
            .sortedWith(compareBy({ it.first }, { it.second.name.length }))
            .take(limit)
            .map { it.second }
    }

    fun nearest(lat: Double, lon: Double): Pair<City, Double>? {
        var best: City? = null
        var bd = Double.MAX_VALUE
        for (c in cities) {
            val d = haversineKm(lat, lon, c.lat, c.lon)
            if (d < bd) {
                bd = d
                best = c
            }
        }
        return best?.let { it to bd }
    }

    /** 周边点位：按直线距离排序，排除自身 */
    fun nearby(lat: Double, lon: Double, limit: Int = 8): List<Pair<City, Double>> =
        cities
            .asSequence()
            .map { it to haversineKm(lat, lon, it.lat, it.lon) }
            .filter { it.second > 0.5 }
            .sortedBy { it.second }
            .take(limit)
            .toList()

    fun recent(): List<City> {
        val raw = prefs.getString(KEY_RECENT, "").orEmpty()
        if (raw.isBlank()) return emptyList()
        return raw.split('\n').mapNotNull { parseLine(it.replace('|', '\t')) }
    }

    fun remember(city: City) {
        val list = ArrayList<City>()
        list.add(city)
        for (c in recent()) {
            if (c.name != city.name) list.add(c)
        }
        val out = list.take(MAX_RECENT).joinToString("\n") {
            it.name + "|" + String.format(Locale.US, "%.4f", it.lon) + "|" +
                String.format(Locale.US, "%.4f", it.lat) + "|" + it.region
        }
        prefs.edit().putString(KEY_RECENT, out).apply()
    }

    fun lastCity(): City? = recent().firstOrNull()

    /** 拼音 / 英文别名：优先用生成资源里的列，兜底用内置的常见城市表 */
    private fun aliasesOf(name: String): String =
        assetAliases[name] ?: CN_PINYIN[name].orEmpty()

    private companion object {
        const val KEY_RECENT = "recent_cities"
        const val MAX_RECENT = 8

        val CN_PINYIN: Map<String, String> = mapOf(
            "北京市" to "beijing bj", "上海市" to "shanghai sh", "广州市" to "guangzhou gz",
            "深圳市" to "shenzhen sz", "天津市" to "tianjin tj", "重庆市" to "chongqing cq",
            "成都市" to "chengdu cd", "杭州市" to "hangzhou hz", "南京市" to "nanjing nj",
            "武汉市" to "wuhan wh", "西安市" to "xian xa", "郑州市" to "zhengzhou zz",
            "长沙市" to "changsha cs", "沈阳市" to "shenyang sy", "哈尔滨市" to "harbin hrb",
            "长春市" to "changchun cc", "济南市" to "jinan jn", "青岛市" to "qingdao qd",
            "大连市" to "dalian dl", "厦门市" to "xiamen xm", "福州市" to "fuzhou fz",
            "昆明市" to "kunming km", "贵阳市" to "guiyang gy", "南宁市" to "nanning nn",
            "海口市" to "haikou hk", "三亚市" to "sanya sy", "合肥市" to "hefei hf",
            "南昌市" to "nanchang nc", "太原市" to "taiyuan ty", "石家庄市" to "shijiazhuang sjz",
            "呼和浩特市" to "hohhot hhht", "乌鲁木齐市" to "urumqi wlmq", "拉萨市" to "lhasa ls",
            "西宁市" to "xining xn", "银川市" to "yinchuan yc", "兰州市" to "lanzhou lz",
            "香港" to "hongkong hk", "澳门" to "macao macau", "台北" to "taipei"
        )

        /** 资源缺失时的兜底：省会 + 直辖市 + 港澳台 + 少数海外热门 */
        val BUILTIN_CITIES: List<City> = """
            北京市|116.4074|39.9042|北京市
            天津市|117.2010|39.0842|天津市
            上海市|121.4737|31.2304|上海市
            重庆市|106.5516|29.5630|重庆市
            石家庄市|114.5025|38.0455|河北省
            太原市|112.5492|37.8570|山西省
            呼和浩特市|111.6708|40.8183|内蒙古自治区
            沈阳市|123.4291|41.7968|辽宁省
            长春市|125.3245|43.8868|吉林省
            哈尔滨市|126.6425|45.7570|黑龙江省
            南京市|118.7674|32.0415|江苏省
            杭州市|120.1536|30.2875|浙江省
            合肥市|117.2830|31.8612|安徽省
            福州市|119.3062|26.0753|福建省
            南昌市|115.8922|28.6765|江西省
            济南市|117.0009|36.6758|山东省
            郑州市|113.6654|34.7580|河南省
            武汉市|114.2986|30.5844|湖北省
            长沙市|112.9823|28.1941|湖南省
            广州市|113.2806|23.1252|广东省
            南宁市|108.3200|22.8240|广西壮族自治区
            海口市|110.3312|20.0320|海南省
            成都市|104.0657|30.6595|四川省
            贵阳市|106.7135|26.5783|贵州省
            昆明市|102.7123|25.0406|云南省
            拉萨市|91.1322|29.6604|西藏自治区
            西安市|108.9480|34.2632|陕西省
            兰州市|103.8236|36.0580|甘肃省
            西宁市|101.7789|36.6232|青海省
            银川市|106.2782|38.4664|宁夏回族自治区
            乌鲁木齐市|87.6177|43.7928|新疆维吾尔自治区
            香港|114.1694|22.3193|香港特别行政区
            澳门|113.5439|22.1987|澳门特别行政区
            台北|121.5654|25.0330|台湾省
            东京|139.6503|35.6762|日本
            首尔|126.9780|37.5665|韩国
            新加坡|103.8198|1.3521|新加坡
            曼谷|100.5018|13.7563|泰国
            纽约|-74.0060|40.7128|美国
            伦敦|-0.1276|51.5074|英国
            巴黎|2.3522|48.8566|法国
            悉尼|151.2093|-33.8688|澳大利亚
        """.trimIndent().lines().mapNotNull { parseLineStatic(it) }
            .map { City(it.name, it.lon, it.lat, it.region) }

        fun parseLineStatic(line: String): City? {
            val p = line.trim().split('|')
            if (p.size < 4) return null
            val lon = p[1].toDoubleOrNull() ?: return null
            val lat = p[2].toDoubleOrNull() ?: return null
            return City(p[0], lon, lat, p[3])
        }
    }
}
