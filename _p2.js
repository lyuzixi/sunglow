/* =========================================================================
   霞光预报 · 单文件应用
   Part 2：基础常量 / 数学工具 / 天文计算 / 城市库
   ========================================================================= */
"use strict";

const RE      = 6371.0;            // 地球平均半径 km
const DEG     = Math.PI / 180;
const RAD     = 180 / Math.PI;
const RAY_OD550_V = 0.0975;        // 550nm 整层瑞利光学厚度
const H_RAY   = 8.0;               // 瑞利散射标高 km
const ANGSTROM = 1.3;              // 气溶胶 Ångström 波长指数（教程取 1.0~1.3）
const K_TH    = 0.02;              // 550nm 气溶胶消光系数阈值 km^-1（决定等效地表高度）
const WINDOW_MIN = 45;             // 事件前后取样窗口（分钟）

const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const clamp01 = v => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const isNum = v => typeof v === "number" && isFinite(v);
const nz = (v, d) => isNum(v) ? v : d;

/* =========================================================================
   文本进 DOM 前的两道闸门（S0 安全整改）
   -------------------------------------------------------------------------
   病灶：全项目 49 处 innerHTML 插值，此前**一个转义函数都没有**，全靠
   "数据来自内置城市表"这个前提兜底。而这条前提至少有两处不成立：
     · `_p6.js` 的省份名 `provName` 来自**外部 GeoJSON**（DataV 省界），
       上游一旦被污染或改字段，就是存储型 XSS；
     · `readUrl()` 把地址栏里的 `?name=` 直接写进 `State.name`，最终落在
       `_p5b.js` 的结果卡模板串里 —— 这是一条**可被分享链接触发**的反射型 XSS
       （40 字符截断挡不住：`<img src=1 onerror=eval(location.hash)>` 正好 39
       字符，超长载荷放 hash 里即可）。
   处置分两层，都不改动任何渲染结构：
     ① `esc()`   —— 输出侧转义，用在**文本节点**与**引号包住的属性值**两种位置；
     ② `safeLabel()` —— 输入侧白名单，专用于"来自 URL 的人造地名"。
   刻意不做的事：不搞"全部 innerHTML 改 textContent"的大手术（那会动到
   几十处渲染结构、回归面过大），只在这两个函数上收口。
   ========================================================================= */
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/* HTML 转义。四个字符之外**不要**再处理（`&#x27;` 之类反而会被当文本显示）。
   注意适用范围：只用于文本与用引号包住的属性值；**不要**拿它去拼 style / url() /
   事件处理器 —— 那几处的正确做法是别拼。 */
function esc(v) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/[&<>"']/g, c => ESC_MAP[c]);
}
/* 输入侧白名单：只留字母、数字、汉字/日文假名等文字类字符，以及地名里真正会出现的
   分隔符（空格 · ・ - . ( ) （））。其余一律删掉。
   `u` 标志下 `\p{L}` 已覆盖中日韩文字，所以不必再单独列汉字区间。
   这是"双保险"里的第二道：即使将来某处忘了调 esc()，URL 里也塞不进标签。 */
function safeLabel(s, max) {
  if (typeof s !== "string") return "";
  return s.replace(/[^\p{L}\p{N} ·・.\-()（）]/gu, "").slice(0, max || 40);
}

/* 梯形隶属函数：pts = [[x0,y0],[x1,y1],...] 线性插值，两端外推为首尾值 */
function trap(x, pts) {
  if (!isNum(x)) return null;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return x1 === x0 ? y1 : lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  return pts[pts.length - 1][1];
}
const logistic = x => 1 / (1 + Math.exp(-x));
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* 加权几何平均：任一要素“卡死”时整体结果会被显著拉低，更符合霞光的“一票否决”特性 */
const FLOOR_F = 0.02;
function wgeo(items) {
  let e = 0, s = 0;
  for (const it of items) {
    const v = it[0], w = it[1];
    if (v == null || !isNum(v)) continue;
    s += w; e += w * Math.log(Math.max(v, FLOOR_F));
  }
  return s > 0 ? Math.exp(e / s) : 0;
}

/* 日期工具 */
const pad2 = n => String(n).padStart(2, "0");
function ymd(d) { return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()); }
function dayOfYearUTC(d) {
  const s = Date.UTC(d.getUTCFullYear(), 0, 0);
  return (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - s) / 86400000;
}
function fmtHM(hoursFloat) {
  if (!isNum(hoursFloat)) return "—";
  let h = Math.floor(hoursFloat), m = Math.round((hoursFloat - h) * 60);
  if (m === 60) { h++; m = 0; }
  h = ((h % 24) + 24) % 24;
  return pad2(h) + ":" + pad2(m);
}
function fmtDur(min) {
  if (!isNum(min)) return "—";
  if (min <= 0) return "0 分";
  const m = Math.floor(min), s = Math.round((min - m) * 60);
  return (m > 0 ? m + " 分 " : "") + s + " 秒";
}

/* =========================================================================
   天文：太阳位置（NOAA 低精度算法，精度 ~0.01°）
   返回 altitude / azimuth(deg, 自正北顺时针) / declination / hourAngle
   ========================================================================= */
function solarPosition(ms, lat, lon) {
  const jd = ms / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lam));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  let H = ((gmst * 15 + lon) * DEG - ra);
  H = ((H + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const phi = lat * DEG;
  const sinAlt = clamp(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H), -1, 1);
  const alt = Math.asin(sinAlt);
  let az = Math.acos(clamp((Math.sin(decl) - sinAlt * Math.sin(phi)) / (Math.cos(alt) * Math.cos(phi) || 1e-9), -1, 1));
  if (H > 0) az = 2 * Math.PI - az;    // 下午方位角 > 180°
  return { altitude: alt * RAD, azimuth: az * RAD, declination: decl * RAD, hourAngle: H * RAD };
}

/* 求解当日中天（真正午）UTC 毫秒 */
function solarNoonMs(dayMs, lat, lon) {
  let best = null, bestAlt = -999;
  for (let k = 0; k < 288; k++) {
    const t = dayMs + k * 5 * 60000;
    const a = solarPosition(t, lat, lon).altitude;
    if (a > bestAlt) { bestAlt = a; best = t; }
  }
  // 二次精修
  for (let it = 0; it < 24; it++) {
    const a1 = solarPosition(best - 240000, lat, lon).altitude;
    const a2 = solarPosition(best + 240000, lat, lon).altitude;
    if (a2 > a1) best += 60000; else best -= 60000;
  }
  return best;
}

/* 求解日出/日落（标准高度角 -0.833°，含大气折射与日面半径）
   返回 {riseMs, setMs, noonMs, polarDay, polarNight} */
function sunEvents(dayMs, lat, lon) {
  const noon = solarNoonMs(dayMs, lat, lon);
  const altNoon = solarPosition(noon, lat, lon).altitude;
  const H0 = -0.833;
  if (altNoon < H0) {
    // 极夜或太阳全天不升起
    return { noonMs: noon, riseMs: null, setMs: null, polarDay: false, polarNight: true };
  }
  // 从正午向两侧搜索 -0.833° 交叉点
  function cross(dir) {
    let t = noon, prev = altNoon;
    for (let k = 1; k <= 1440; k++) {
      const tt = noon + dir * k * 60000;
      const a = solarPosition(tt, lat, lon).altitude;
      if (prev >= H0 && a < H0) {
        // 二分
        let lo = tt - dir * 60000, hi = tt;
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          const am = solarPosition(mid, lat, lon).altitude;
          if (am < H0) hi = mid; else lo = mid;
        }
        return (lo + hi) / 2;
      }
      prev = a;
    }
    return null;
  }
  const setMs = cross(1), riseMs = cross(-1);
  return { noonMs: noon, riseMs, setMs, polarDay: (riseMs === null || setMs === null), polarNight: false };
}

/* =========================================================================
   城市库（内联数据）
   中国城市：名称|经度|纬度|省级行政区   （363 个地级及以上城市）
   全球城市：名称|经度|纬度|国家/地区
   ========================================================================= */
const CN_CITIES_RAW = "/*__CN_CITIES__*/";
const MAP_CITIES_RAW = "/*__MAP_CITIES__*/";
const GLOBAL_CITIES_RAW = "/*__GLOBAL_CITIES__*/";

function parseCityList(raw) {
  const out = [];
  raw.split(";").forEach(s => {
    const p = s.split("|");
    if (p.length < 4) return;
    const lon = parseFloat(p[1]), lat = parseFloat(p[2]);
    if (!isNum(lon) || !isNum(lat)) return;
    out.push({ name: p[0], lon, lat, region: p[3] });
  });
  return out;
}
const CN_CITIES = parseCityList(CN_CITIES_RAW);
const MAP_CITIES = parseCityList(MAP_CITIES_RAW);
const GL_CITIES = parseCityList(GLOBAL_CITIES_RAW);
/* 检索库 = 全国地级市 ∪ 地图采样点（含直辖市/港澳台）∪ 全球主要城市（按名称去重） */
const ALL_CITIES = (function () {
  const seen = new Set(), out = [];
  CN_CITIES.concat(MAP_CITIES, GL_CITIES).forEach(c => {
    if (!seen.has(c.name)) { seen.add(c.name); out.push(c); }
  });
  return out;
})();

/* 拼音/英文别名（主要城市，便于英文输入检索） */
const ALIAS = {
  "北京市":"beijing bj","上海市":"shanghai sh","广州市":"guangzhou gz","深圳市":"shenzhen sz",
  "天津市":"tianjin tj","重庆市":"chongqing cq","成都市":"chengdu cd","杭州市":"hangzhou hz",
  "南京市":"nanjing nj","武汉市":"wuhan wh","西安市":"xian xa","郑州市":"zhengzhou zz",
  "长沙市":"changsha cs","沈阳市":"shenyang sy","哈尔滨市":"haerbin hrb","长春市":"changchun cc",
  "济南市":"jinan jn","青岛市":"qingdao qd","大连市":"dalian dl","厦门市":"xiamen xm",
  "福州市":"fuzhou fz","昆明市":"kunming km","贵阳市":"guiyang gy","南宁市":"nanning nn",
  "海口市":"haikou hk","三亚市":"sanya sy","合肥市":"hefei hf","南昌市":"nanchang nc",
  "太原市":"taiyuan ty","石家庄市":"shijiazhuang sjz","呼和浩特市":"huhehaote hhht",
  "乌鲁木齐市":"wulumuqi wlmq","拉萨市":"lasa ls","西宁市":"xining xn","银川市":"yinchuan yc",
  "兰州市":"lanzhou lz","成都市1":"cd","香港":"hongkong hk xianggang","澳门":"macao macau am",
  "台北":"taipei taibei tb","高雄":"kaohsiung","苏州市":"suzhou","无锡市":"wuxi",
  "宁波市":"ningbo","温州市":"wenzhou","东莞市":"dongguan","佛山市":"foshan","珠海市":"zhuhai",
  "泉州市":"quanzhou","烟台市":"yantai","潍坊市":"weifang","洛阳市":"luoyang","徐州市":"xuzhou",
  "唐山市":"tangshan","常州市":"changzhou","南通市":"nantong","嘉兴市":"jiaxing"
};
/* 全球城市英文/拉丁字母别名（便于英文输入检索） */
const GL_ALIAS_RAW = "/*__GL_ALIAS__*/";
const GL_ALIAS = (function () {
  const m = {};
  GL_ALIAS_RAW.split(";").forEach(s => {
    const i = s.indexOf("=");
    if (i > 0) m[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  });
  return m;
})();
const CITY_INDEX = ALL_CITIES.map((c, i) => {
  const short = c.name.replace(/(市|特别行政区|自治区|自治州|地区)$/, "");
  const al = ((ALIAS[c.name] || "") + " " + (GL_ALIAS[c.name] || "")).toLowerCase();
  return { i, key: (c.name + " " + short + " " + al + " " + c.region).toLowerCase(), c };
});
function searchCity(q, limit) {
  limit = limit || 30;
  const s = q.trim().toLowerCase();
  if (!s) return [];
  /* 拉丁字母查询按“音节边界”匹配（双向前缀），避免 changzhou 被 hangzhou 命中 */
  const hasAscii = /[a-z]/i.test(s);
  const hit = [], seen = new Set();
  for (const it of CITY_INDEX) {
    const k = it.key, nm = it.c.name.toLowerCase();
    const toks = k.split(" ");
    let rank = -1;
    if (nm.startsWith(s)) rank = 0;
    else if (toks.some(w => w && (w.startsWith(s) || (w.length >= 3 && s.startsWith(w))))) rank = 1;
    else if (!hasAscii && k.includes(s)) rank = 2;
    if (rank >= 0 && !seen.has(it.c.name)) { seen.add(it.c.name); hit.push({ rank, c: it.c }); }
  }
  hit.sort((a, b) => a.rank - b.rank || a.c.name.length - b.c.name.length);
  /* 兜底：严格匹配无果时（例如只敲了 "zhou" 这种歧义前缀），
     放宽为子串包含，至少给出候选，避免输入落空 */
  if (!hit.length) {
    for (const it of CITY_INDEX) {
      if (it.key.includes(s) && !seen.has(it.c.name)) { seen.add(it.c.name); hit.push({ rank: 2, c: it.c }); }
    }
    hit.sort((a, b) => a.c.name.length - b.c.name.length);
  }
  return hit.slice(0, limit).map(x => x.c);
}
/* 最近城市（用于地图悬停等） */
function nearestCity(lat, lon, list) {
  list = list || MAP_CITIES;
  let best = null, bd = 1e9;
  for (const c of list) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bd) { bd = d; best = c; }
  }
  return best ? { city: best, distKm: bd } : null;
}
function haversineKm(la1, lo1, la2, lo2) {
  const dLa = (la2 - la1) * DEG, dLo = (lo2 - lo1) * DEG;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * DEG) * Math.cos(la2 * DEG) * Math.sin(dLo / 2) ** 2;
  return 2 * RE * Math.asin(Math.min(1, Math.sqrt(a)));
}
/* 沿方位角推出目标点（球面） */
function destPoint(lat, lon, azDeg, distKm) {
  const d = distKm / RE, brg = azDeg * DEG, la1 = lat * DEG, lo1 = lon * DEG;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(brg));
  const lo2 = lo1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { lat: la2 * RAD, lon: ((lo2 * RAD + 540) % 360) - 180 };
}

/* =========================================================================
   日出/日落线速度查表（km/分钟，教程附录）
   行：纬度 0/5/10/.../60 (只取北纬，南纬取同纬度)
   列：1/15 ~ 12/15 每月 15 日
   ========================================================================= */
const SPD_LAT = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
const SPD_TAB = [
  [21.6,22.6,23.2,22.9,21.9,21.3,21.6,22.5,23.1,22.9,22.0,21.3],
  [21.5,22.5,23.1,22.8,21.8,21.2,21.4,22.4,23.1,22.8,21.9,21.2],
  [21.2,22.3,22.8,22.5,21.6,20.9,21.2,22.1,22.8,22.6,21.6,20.9],
  [20.8,21.8,22.4,22.1,21.1,20.4,20.7,21.6,22.3,22.1,21.2,20.5],
  [20.1,21.2,21.8,21.4,20.4,19.7,20.0,21.0,21.7,21.5,20.5,19.8],
  [19.3,20.4,21.0,20.6,19.6,18.9,19.1,20.2,21.0,20.7,19.7,18.9],
  [18.3,19.4,20.1,19.7,18.6,17.8,18.1,19.2,20.0,19.8,18.7,17.9],
  [17.1,18.3,19.0,18.6,17.4,16.6,16.9,18.1,18.9,18.7,17.6,16.7],
  [15.7,17.1,17.8,17.3,16.1,15.1,15.5,16.8,17.7,17.4,16.2,15.3],
  [14.2,15.6,16.4,15.9,14.5,13.5,13.9,15.3,16.3,16.1,14.7,13.7],
  [12.4,14.1,14.9,14.4,12.8,11.6,12.1,13.7,14.8,14.5,13.1,11.9],
  [10.5,12.4,13.3,12.7,10.9,9.5,10.0,11.9,13.2,12.9,11.2,9.8],
  [8.2,10.5,11.6,10.9,8.7,6.8,7.6,10.0,11.5,11.1,9.1,7.4]
];
function sunsetSpeedKmph(absLat, dateUTC) {
  const m = dateUTC.getUTCMonth() + 1;
  const d = dateUTC.getUTCDate();
  const colF = (m - 1) + clamp((d - 15) / 30, -0.5, 0.5);   // 以每月15日为列基准
  const c0 = clamp(Math.floor(colF), 0, 11), c1 = clamp(c0 + 1, 0, 11), tc = clamp(colF - c0, 0, 1);
  const la = clamp(absLat, 0, 60);
  let r0 = 0, r1 = 1;
  for (let i = 1; i < SPD_LAT.length; i++) if (la <= SPD_LAT[i]) { r0 = i - 1; r1 = i; break; }
  const tr = SPD_LAT[r1] === SPD_LAT[r0] ? 0 : (la - SPD_LAT[r0]) / (SPD_LAT[r1] - SPD_LAT[r0]);
  const v0 = lerp(SPD_TAB[r0][c0], SPD_TAB[r0][c1], tc);
  const v1 = lerp(SPD_TAB[r1][c0], SPD_TAB[r1][c1], tc);
  // 高纬外推（>60°）按经验线性衰减，最低 4 km/min
  let v = lerp(v0, v1, tr);
  if (absLat > 60) v = Math.max(4, v * Math.cos(clamp(absLat, 60, 80) * DEG) / Math.cos(60 * DEG));
  return v;
}
