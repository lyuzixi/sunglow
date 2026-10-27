/* =========================================================================
   GLOWCAST v2 · 城市检索
   口径来源：V1 _p2.js searchCity 语义。城市库全量来自 refs/（citydata.ts，
   与V1同源：363 地级市 + 地图采样点 + 全球主要城市 + 拉丁别名）。
   ========================================================================= */
import { haversineKm, isNum } from "./math";
import { searchAliases } from "./citylang";
import {
  CN_CITIES_RAW, MAP_CITIES_RAW, GLOBAL_CITIES_RAW, GL_ALIAS_RAW
} from "./citydata";

export interface City {
  name: string; lon: number; lat: number; region: string;
}

function parseCityList(raw: string): City[] {
  const out: City[] = [];
  for (const s of raw.split(";")) {
    const p = s.split("|");
    if (p.length < 4) continue;
    const lon = parseFloat(p[1]), lat = parseFloat(p[2]);
    if (!isNum(lon) || !isNum(lat)) continue;
    out.push({ name: p[0], lon, lat, region: p[3] });
  }
  return out;
}

const CN_CITIES = parseCityList(CN_CITIES_RAW);
const MAP_CITIES = parseCityList(MAP_CITIES_RAW);
const GL_CITIES = parseCityList(GLOBAL_CITIES_RAW);

export const CITIES: City[] = (() => {
  const seen = new Set<string>(), out: City[] = [];
  for (const c of CN_CITIES.concat(MAP_CITIES, GL_CITIES)) {
    if (!seen.has(c.name)) { seen.add(c.name); out.push(c); }
  }
  return out;
})();

const ALIAS: Record<string, string> = {
  "北京市": "beijing bj", "上海市": "shanghai sh", "广州市": "guangzhou gz",
  "深圳市": "shenzhen sz", "天津市": "tianjin tj", "重庆市": "chongqing cq",
  "成都市": "chengdu cd", "杭州市": "hangzhou hz", "南京市": "nanjing nj",
  "武汉市": "wuhan wh", "西安市": "xian xa", "郑州市": "zhengzhou zz",
  "长沙市": "changsha cs", "沈阳市": "shenyang sy", "哈尔滨市": "harbin hrb",
  "长春市": "changchun cc", "济南市": "jinan jn", "青岛市": "qingdao qd",
  "大连市": "dalian dl", "厦门市": "xiamen xm", "福州市": "fuzhou fz",
  "昆明市": "kunming km", "贵阳市": "guiyang gy", "南宁市": "nanning nn",
  "海口市": "haikou hk", "三亚市": "sanya sy", "合肥市": "hefei hf",
  "南昌市": "nanchang nc", "太原市": "taiyuan ty", "石家庄市": "shijiazhuang sjz",
  "呼和浩特市": "hohhot hhht", "乌鲁木齐市": "urumqi wlmq", "拉萨市": "lhasa ls",
  "西宁市": "xining xn", "银川市": "yinchuan yc", "兰州市": "lanzhou lz",
  "香港": "hongkong hk", "澳门": "macao macau", "台北": "taipei",
  "东京": "tokyo", "大阪": "osaka", "首尔": "seoul", "新加坡": "singapore",
  "纽约": "newyork nyc", "洛杉矶": "losangeles la", "旧金山": "sanfrancisco sf",
  "伦敦": "london", "巴黎": "paris", "柏林": "berlin", "悉尼": "sydney",
  "墨尔本": "melbourne", "多伦多": "toronto", "温哥华": "vancouver",
  "莫斯科": "moscow", "迪拜": "dubai", "曼谷": "bangkok"
};

const GL_ALIAS: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  GL_ALIAS_RAW.split(";").forEach((s) => {
    const i = s.indexOf("=");
    if (i > 0) m[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  });
  return m;
})();

interface CityIdx { i: number; key: string; c: City }

const CITY_INDEX: CityIdx[] = CITIES.map((c, i) => {
  const short = c.name.replace(/(市|特别行政区|自治区|自治州|地区)$/, "");
  const al = ((ALIAS[c.name] || "") + " " + (GL_ALIAS[c.name] || "")).toLowerCase();
  /* 英文名与繁体名也进索引：输入 guangzhou / 廣州 都能命中（原先只认简体与拼音别名）。
     省区同理，方便「广东」这类按省检索。 */
  const xl = searchAliases(c.name).concat(searchAliases(c.region)).join(" ").toLowerCase();
  return {
    i,
    key: (c.name + " " + short + " " + al + " " + xl + " " + c.region).toLowerCase(),
    c
  };
});

/* ---------------- 城市分级（地图自绘地名的缩放分级口径） ----------------
   0 = 省会 / 直辖市 / 港澳台（远看只画这些，约 30 个）
   1 = 地级市（中景补上，共 363 个）
   2 = 其余：地图采样点、海外城市（近景全量）
   分级只看名字，不看坐标 —— 名字即身份，改城市库时不用同步维护坐标。 */
export const PROV_CAPITALS = new Set<string>([
  "北京市", "天津市", "石家庄市", "太原市", "呼和浩特市", "沈阳市", "长春市",
  "哈尔滨市", "上海市", "南京市", "杭州市", "合肥市", "福州市", "南昌市",
  "济南市", "郑州市", "武汉市", "长沙市", "广州市", "南宁市", "海口市",
  "重庆市", "成都市", "贵阳市", "昆明市", "拉萨市", "西安市", "兰州市",
  "西宁市", "银川市", "乌鲁木齐市", "香港", "澳门", "台北"
]);

const PREFECTURES = new Set<string>(CN_CITIES.map((c) => c.name));

export function cityTier(name: string): 0 | 1 | 2 {
  if (PROV_CAPITALS.has(name)) return 0;
  return PREFECTURES.has(name) ? 1 : 2;
}


export function searchCity(q: string, limit = 30): City[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const hasAscii = /[a-z]/i.test(s);
  const hit: Array<{ rank: number; c: City }> = [];
  const seen = new Set<string>();
  for (const it of CITY_INDEX) {
    const k = it.key, nm = it.c.name.toLowerCase();
    const toks = k.split(" ");
    let rank = -1;
    if (nm.startsWith(s)) rank = 0;
    else if (toks.some((w) => w && (w.startsWith(s) || (w.length >= 3 && s.startsWith(w)))))
      rank = 1;
    else if (!hasAscii && k.includes(s)) rank = 2;
    if (rank >= 0 && !seen.has(it.c.name)) {
      seen.add(it.c.name);
      hit.push({ rank, c: it.c });
    }
  }
  hit.sort((a, b) => a.rank - b.rank || a.c.name.length - b.c.name.length);
  if (!hit.length) {
    for (const it of CITY_INDEX) {
      if (it.key.includes(s) && !seen.has(it.c.name)) {
        seen.add(it.c.name);
        hit.push({ rank: 2, c: it.c });
      }
    }
    hit.sort((a, b) => a.c.name.length - b.c.name.length);
  }
  return hit.slice(0, limit).map((x) => x.c);
}

export function nearestCity(
  lat: number, lon: number, list = CITIES
): { city: City; distKm: number } | null {
  let best: City | null = null, bd = 1e9;
  for (const c of list) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bd) { bd = d; best = c; }
  }
  return best ? { city: best, distKm: bd } : null;
}

export function cityByName(name: string): City | null {
  return CITIES.find((c) => c.name === name) || null;
}
