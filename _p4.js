/* =========================================================================
   Part 4：数据获取 + 评分模型
   ========================================================================= */
const API_FORECAST = "https://api.open-meteo.com/v1/forecast";
const API_AQ = "https://air-quality-api.open-meteo.com/v1/air-quality";

/* 全应用唯一的时区口径（单点查询与地图取数共用）。
   Open-Meteo 的 timezone 参数决定 hourly.time 的基准墙钟；makeSeries 按
   `Date.parse(t+"Z") - utc_offset_seconds` 还原真实 UTC 毫秒 —— 所以 timezone 一改，
   同一坐标的同一串 hourly.time 就对应到不同的真实时刻，取到的数值也随之改变。
   实测（_check/tzprobe.js，见探针输出）：
     · 上海：auto 与 Asia/Shanghai 的 utc_offset_seconds / hourly.time / 数值**完全一致**；
     · 纽约：auto → -14400（America/New_York），Asia/Shanghai → +28800，数值不同。
   → auto 是"按坐标自动解析"的正确口径；Asia/Shanghai 只对中国坐标成立。
   地图端原先硬编码 Asia/Shanghai，因为取样点全在中国，数值恰好无差别，
   但它与单点端的 auto 其实是两个口径 —— 一旦地图点位扩到境外就会静默算错。
   这里收敛成一个常量，`_p6.js` 的 MAP_TZ 直接引用它，避免两处各自漂移。 */
const API_TZ = "auto";

/* ---- 计费请求登记表 ----
   方案（P4）的验收方式是"断言首屏计费请求数"。要让这个断言可写、可回归，
   就得有个地方记录"到底发出了几次请求、每次带了多少坐标"。
   Open-Meteo 的限额按加权调用计：权重 = max(1, 变量数/10 × 时间跨度系数) × 坐标数，
   即**每个坐标至少计 1 次** —— 坐标数才是那个不会被下限吞掉的量，所以这里一并记下来。
   纯登记，不参与任何计算，也不影响请求本身。 */
const API_CALLS = [];
function apiCallReset() { API_CALLS.length = 0; }
function apiCallLog(endpoint, coords, vars, tz, startD, endD) {
  API_CALLS.push({
    endpoint: endpoint, coords: coords, vars: vars, tz: tz,
    start: startD, end: endD, at: Date.now()
  });
  if (API_CALLS.length > 500) API_CALLS.shift();
}
function apiCallStats() {
  let coords = 0;
  for (let i = 0; i < API_CALLS.length; i++) coords += API_CALLS[i].coords;
  return { requests: API_CALLS.length, coords: coords, calls: API_CALLS.slice() };
}

/* ---- 统一的"软失败"记录 ----
   事件绑定、缓存写入、地图 SDK 胶水这类地方，失败时通常应该继续跑（不该中断主流程），
   但"catch(e){} 什么都不做"会把问题永久藏起来 —— 例如某版 SDK 不再派发某个事件，
   表现只是"悬停没反应"，从外部完全看不出原因。
   这里统一记一条（控制台可见 + 计数可被测试断言），把"静默降级"变成"有迹可循"。 */
const SOFT_WARNS = [];
function softWarn(where, e) {
  const msg = where + "：" + (e && e.message ? e.message : String(e));
  SOFT_WARNS.push(msg);
  if (SOFT_WARNS.length > 50) SOFT_WARNS.shift();
  if (typeof console !== "undefined" && console.warn) console.warn("[软失败] " + msg);
}

/* 单点精细预报所需字段（只请求真正参与计算的量，减少载荷） */
const F_VARS = ["temperature_2m", "dew_point_2m", "relative_humidity_2m", "cloud_cover_low",
  "cloud_cover_mid", "cloud_cover_high", "visibility", "pressure_msl", "wind_speed_10m",
  "wind_direction_10m", "boundary_layer_height", "freezing_level_height", "precipitation", "cape"];
const AQ_VARS = ["aerosol_optical_depth", "pm2_5", "pm10", "dust"];
/* 地图批量采样用的字段集（**10 个**，仍落在计费下限档：
   计费权重 = max(1, 变量数/10) × max(1, 天数/14)，10 个变量仍是 1.0 而不是 1.1 以上，
   所以补上露点不花一分额度）。
   为什么补露点：buildEnv 只有"取不到时才用 T−(100−RH)/5 线性近似"的兜底，
   而该近似与真实露点差约 0.3~1.2 ℃（RH 越低差得越多）。地图侧原先没有这个字段，
   等于每个网格点都在用近似露点，而单点侧用的是真实露点 —— 两条路径的湿度项
   （W_STAT.hum）因此对不上。补上它，地图精度与单点口径一起改善。 */
const F_MAP_VARS = ["temperature_2m", "dew_point_2m", "relative_humidity_2m",
  "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "visibility",
  "pressure_msl", "boundary_layer_height", "freezing_level_height"];
const MODEL_NAME = { gfs: "gfs_seamless", ec: "ecmwf_ifs025" };
const MODEL_LABEL = { gfs: "GFS 模式", ec: "ECMWF-IFS 模式" };
const TRANSECT = [0, 25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400];

/* 取数：对 429（限流）与 5xx 做指数退避重试；4xx 客户端错误立即失败。
   每次尝试都套一层 12 秒超时（AbortController）：浏览器对 fetch 没有默认超时上限，
   网络"半死不活"（连接建立但迟迟不返回）时界面会一直停在"计算中…"，
   用户既得不到结果也得不到错误。主动掐断后按普通可重试错误处理，退避重试一轮。 */
const JGET_TIMEOUT_MS = 12000;
async function jget(url, tries) {
  tries = tries || 3;
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    const ac = (typeof AbortController === "function") ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), JGET_TIMEOUT_MS) : 0;
    try {
      const opt = { mode: "cors" };
      if (ac) opt.signal = ac.signal;
      const r = await fetch(url, opt);
      if (r.ok) return await r.json();
      const err = new Error("HTTP " + r.status);
      err.status = r.status;
      const ra = parseInt(r.headers.get("retry-after"), 10);
      if (isNum(ra)) err.retryAfter = clamp(ra, 1, 20) * 1000;
      /* 429 其实分两类，处置方式完全相反：
         ① 短时突发限流（每分钟 600 / 每小时 5,000 超了）—— 等一会儿就好，退避重试有意义；
         ② 日额度耗尽 —— 这是按「出口 IP」计的硬上限，重试多少次都是同一结果，
            只会白白多打几次接口、把用户多晾十几秒。识别出来立刻短路，并给出可行动说明。 */
      if (r.status === 429) {
        let body = "";
        try { body = await r.text(); } catch (e2) { }
        /* 判别只用「响应体有没有指向 daily」这一条：官方在超限时给出的 reason 会
           指明被突破的是哪个窗口（minutely / hourly / daily），而只有 daily 是
           次日才恢复的。措辞可能变，但"哪个窗口"必然写出来 —— 所以按 daily 关键词
           判别，比钉死整句更耐改；反向也成立：短时限流的 reason 里不会出现 daily。 */
        if (/daily/i.test(body) && /limit|exceed|quota|rate/i.test(body)) {
          err.fatal = true;
          err.friendly = "今日气象数据额度已用尽。Open-Meteo 免费层按「出口 IP」计"
            + "（每日 10,000 次 / 每小时 5,000 次），不是按账号 ——"
            + "若你在公司、学校或代理等共享网络下，很可能是同一出口 IP 的其他使用者消耗掉的。";
        } else {
          err.friendly = "气象接口暂时限流（短时并发过高），约一分钟内会自动恢复。";
        }
      }
      throw err;
    } catch (e) {
      /* abort 抛的是 DOMException（name="AbortError"，部分内核 code=20）：
         统一映射成可读文案，并标记 timeout，供上层给出针对性的提示。 */
      const aborted = e && (e.name === "AbortError" || e.code === 20);
      if (aborted) {
        lastErr = new Error("请求超时（超过 " + Math.round(JGET_TIMEOUT_MS / 1000) + " 秒无响应）");
        lastErr.timeout = true;
      } else {
        lastErr = e;
      }
      const st = (lastErr && lastErr.status) || 0;
      /* 400/404 等请求本身的错误重试无意义，直接抛出 */
      if (st >= 400 && st < 500 && st !== 429) break;
      /* 日额度耗尽同样不可恢复 —— 继续退避只是多打几次接口、多晾用户十几秒 */
      if (lastErr && lastErr.fatal) break;
      if (i === tries - 1) break;
      const wait = (lastErr && lastErr.retryAfter != null) ? lastErr.retryAfter
        : (st === 429 ? 2500 * Math.pow(1.9, i) : 700 * Math.pow(1.6, i));
      await new Promise(s => setTimeout(s, wait + Math.random() * 400));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastErr || new Error("网络请求失败");
}

function qs(obj) {
  return Object.keys(obj).map(k => k + "=" + encodeURIComponent(obj[k])).join("&");
}

/* 通用多坐标数值预报请求（vars 可指定精简字段集） */
async function apiForecast(model, pts, startD, endD, tz, extraDaily, vars) {
  const p = {
    latitude: pts.map(x => x.lat.toFixed(4)).join(","),
    longitude: pts.map(x => x.lon.toFixed(4)).join(","),
    hourly: (vars || F_VARS).join(","),
    start_date: startD, end_date: endD,
    timezone: tz || API_TZ,
    models: model
  };
  if (extraDaily) p.daily = extraDaily;
  apiCallLog("forecast", pts.length, (vars || F_VARS).length, p.timezone, startD, endD);
  const d = await jget(API_FORECAST + "?" + qs(p));
  return Array.isArray(d) ? d : [d];
}
/* 空气质量（气溶胶光学厚度等） */
async function apiAQ(pts, startD, endD, tz) {
  const p = {
    latitude: pts.map(x => x.lat.toFixed(4)).join(","),
    longitude: pts.map(x => x.lon.toFixed(4)).join(","),
    hourly: AQ_VARS.join(","),
    start_date: startD, end_date: endD,
    timezone: tz || API_TZ
  };
  apiCallLog("air-quality", pts.length, AQ_VARS.length, p.timezone, startD, endD);
  const d = await jget(API_AQ + "?" + qs(p));
  return Array.isArray(d) ? d : [d];
}
/* 批量请求（按 240 点分批，控制单次载荷与 URL 长度）

   为什么不做"单点 17 点与地图 152 点取并集、合成一次请求"（方案 P4 的原始提法）——
   实测下来它既省不了额度、也和"降低 429"的目标相反：

   计费口径（Open-Meteo 公开说明）：权重 = max(1, 变量数/10 × 时间跨度系数) × 坐标数。
   两侧的坐标集合几乎不重叠（样带点沿日出/日落方位分布，与城市点无关），于是
     · 坐标数口径：现在 3×(17+152)=507，并集后 3×169=507 —— 一分不省；
     · 变量×坐标乘积口径：现在 3×(17×14 + 152×9)=4,818，并集后 3×169×14=7,098（+47%）。
   后者才是真实代价：地图侧特意把字段集压到 9 个（≤10 变量恰好落在权重 1.0 的基准档，
   见 F_MAP_VARS 注释），一旦与单点侧的 14 个变量取并集，152 个坐标的权重会从
   1.0 涨到 1.4，反而更容易触发限流。
   还有一个反直觉的地方：并集请求要等两边都凑齐才发，会把本来 17 坐标的小请求
   串到 152 坐标的大请求之后，**推迟首屏主结论**的可见时间。
   实测数据见 _check/tzprobe.js 的输出（169 坐标 / 约 3.7 K 字节，远低于 GET 上限，但账不划算）。
   所以 P4 落地为"消除真正多余的取数"：统一时区口径 + 去掉按城市搜索时的强制刷新。 */
async function apiForecastBatched(model, pts, startD, endD, tz, vars) {
  const out = [];
  for (let i = 0; i < pts.length; i += 240) {
    const chunk = pts.slice(i, i + 240);
    const r = await apiForecast(model, chunk, startD, endD, tz, null, vars);
    out.push(...r);
    if (i + 240 < pts.length) await sleep(250);
  }
  return out;
}
async function apiAQBatched(pts, startD, endD, tz) {
  const out = [];
  for (let i = 0; i < pts.length; i += 240) {
    const chunk = pts.slice(i, i + 240);
    const r = await apiAQ(chunk, startD, endD, tz);
    out.push(...r);
    if (i + 240 < pts.length) await sleep(250);
  }
  return out;
}

/* ---- 把 hourly 数据包装成可按真实时间插值的序列 ---- */
function seriesFrom(t, h) {
  return {
    t, h,
    at(key, ms) {
      const arr = h[key];
      if (!arr || !t.length) return null;
      if (ms <= t[0]) return firstValid(arr, 0, 1);
      const n = t.length;
      if (ms >= t[n - 1]) return firstValid(arr, n - 1, -1);
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= ms) lo = m; else hi = m; }
      const a = arr[lo], b = arr[hi];
      if (isNum(a) && isNum(b)) {
        const f = (ms - t[lo]) / (t[hi] - t[lo]);
        return a + (b - a) * f;
      }
      return isNum(a) ? a : (isNum(b) ? b : null);
    }
  };
}
function makeSeries(data) {
  const off = nz(data.utc_offset_seconds, 0) * 1000;
  const t = (data.hourly && data.hourly.time || []).map(s => Date.parse(s + "Z") - off);
  return seriesFrom(t, data.hourly || {});
}
/* 两套模式逐时平均，得到「综合场」序列（用于光追与地图综合） */
function mergeSeries(a, b) {
  if (!a) return b;
  if (!b) return a;
  const keys = {};
  Object.keys(a.h).forEach(k => { keys[k] = 1; });
  Object.keys(b.h).forEach(k => { keys[k] = 1; });
  const h = {};
  Object.keys(keys).forEach(k => {
    const A = a.h[k], B = b.h[k];
    if (k === "time" || !A) { h[k] = B || A; return; }
    if (!B) { h[k] = A; return; }
    h[k] = A.map((v, i) => (isNum(v) && isNum(B[i])) ? (v + B[i]) / 2 : (isNum(v) ? v : B[i]));
  });
  return seriesFrom(a.t, h);
}
function firstValid(arr, idx, dir) {
  for (let i = idx; i >= 0 && i < arr.length; i += dir) if (isNum(arr[i])) return arr[i];
  return null;
}

/* ---- 把某时刻的环境要素打包成 env ---- */
function buildEnv(sr, tMs, extra) {
  const missing = [];
  const g = (key, opt) => {
    const v = sr ? sr.at(key, tMs) : null;
    if (!isNum(v)) { if (!opt) missing.push(key); return null; }
    return v;
  };
  const env = {
    tMs,
    T: g("temperature_2m"), Td: g("dew_point_2m"), RH: g("relative_humidity_2m"),
    cTot: g("cloud_cover", true), cLow: g("cloud_cover_low"), cMid: g("cloud_cover_mid"), cHigh: g("cloud_cover_high"),
    vis: g("visibility"), P: g("surface_pressure", true), Pmsl: g("pressure_msl"),
    ws: g("wind_speed_10m"), wd: g("wind_direction_10m"), gust: g("wind_gusts_10m", true),
    fz: g("freezing_level_height"), blh: g("boundary_layer_height"),
    precip: g("precipitation", true), cape: g("cape", true), sw: g("shortwave_radiation", true),
    missing
  };
  if (isNum(env.T) && !isNum(env.Td)) {
    env.Td = env.T - (100 - clamp(nz(env.RH, 60), 1, 100)) / 5;
    missing.push("dew_point_2m");
  }
  if (isNum(env.RH)) env.RH = clamp(env.RH, 0, 100);
  if (isNum(env.vis)) env.vis = clamp(env.vis, 0, 200000);
  ["cTot", "cLow", "cMid", "cHigh"].forEach(k => { if (isNum(env[k])) env[k] = clamp(env[k], 0, 100); });
  if (extra) Object.assign(env, extra);
  return env;
}

/* ---- 气压稳定性：事件前后 1 小时的气压变化率 hPa/h ---- */
function pressureTrend(sr, tMs) {
  if (!sr) return null;
  const a = sr.at("pressure_msl", tMs - 3600000), b = sr.at("pressure_msl", tMs + 3600000);
  if (!isNum(a) || !isNum(b)) return null;
  return Math.abs(b - a) / 2;
}
/* ---- 风向风速的日落方向分量（用于云边界不确定性） ---- */
function alongComponent(ws, wd, az) {
  if (!isNum(ws) || !isNum(wd) || !isNum(az)) return null;
  const d = Math.abs(((wd - az + 540) % 360) - 180);   // 与目标方位的夹角
  return Math.abs(ws * Math.cos(d * DEG));
}

/* =========================================================================
   评分模型：统计判据模型（用于 GFS / EC 单模式）
   ========================================================================= */
const W_STAT = { cover: 0.20, type: 0.16, base: 0.12, geom: 0.16, aero: 0.12, vis: 0.08, hum: 0.05, stab: 0.06, block: 0.05 };

/* 选定承载霞光的主云盘：优先取「云底最高且云量≥20%」的一层 */
function primaryDeck(env) {
  const decks = cloudDecks(env);
  let primary = null;
  for (const d of decks) if (d.cover >= 20) primary = d;
  let noCloud = false;
  if (!primary) { primary = decks.reduce((a, b) => (b.cover > a.cover ? b : a)); noCloud = true; }
  return { decks, primary, noCloud };
}

function scoreStat(env, tr, ctx) {
  const notes = [];
  const pd = primaryDeck(env);
  const decks = pd.decks, primary = pd.primary, noCloud = pd.noCloud;

  const Hs = aerosolScaleHeight(env.blh);
  const aodUp = isNum(tr.upstreamAod) ? tr.upstreamAod : nz(env.aod, null);
  const Heq = equivGroundHeight(aodUp, Hs);
  const hEff = isNum(primary.base) ? primary.base - Heq : null;
  const d = tr.hasDeck ? tr.dFar : null;
  const geom = fireGeometry(hEff, d, ctx.v, ctx.omega);

  const f = {};
  f.cover = trap(primary.cover, [[0, 0], [8, 0.12], [22, 0.62], [38, 1], [75, 1], [88, 0.5], [100, 0.22]]);
  f.type = primary.typeScore;
  f.base = trap(primary.base, [[0.1, 0.05], [0.6, 0.24], [1.2, 0.55], [2.0, 0.8], [3.0, 1], [9, 1], [13, 0.68]]);
  if (!tr.hasDeck) f.geom = 0.06;
  else if (!isNum(d)) f.geom = 0.2;
  else f.geom = trap(d / Math.max(geom.xMax, 1), [[0, 0.72], [0.12, 0.95], [0.55, 1], [0.9, 0.62], [1.0, 0.4], [1.5, 0.08], [3, 0.02]]);
  f.aero = isNum(aodUp) ? trap(aodUp, [[0, 1], [0.1, 1], [0.2, 0.88], [0.3, 0.72], [0.5, 0.52], [0.8, 0.26], [1.2, 0.12], [3, 0.03]]) : null;
  f.vis = isNum(env.vis) ? trap(env.vis / 1000, [[0.4, 0.05], [2, 0.2], [5, 0.42], [10, 0.66], [20, 0.92], [30, 1], [80, 1]]) : null;
  f.hum = isNum(env.RH) ? trap(env.RH, [[5, 0.7], [20, 0.92], [40, 1], [75, 1], [88, 0.78], [95, 0.45], [100, 0.3]]) : null;
  const dP = ctx.dP;
  let stab = isNum(dP) ? trap(dP, [[0, 1], [0.6, 1], [1.2, 0.8], [2.5, 0.52], [6, 0.3]]) : null;
  if (stab != null) {
    if (isNum(env.cape) && env.cape > 1500) stab *= 0.78;
    if (isNum(env.precip) && env.precip > 1) stab *= 0.82;
  }
  f.stab = stab;
  let block = 1;
  if (primary.level > 0) {
    const lw = isNum(tr.upstreamLowMax) ? tr.upstreamLowMax : env.cLow;
    if (isNum(lw)) block *= trap(lw, [[0, 1], [25, 0.95], [45, 0.72], [65, 0.4], [85, 0.18], [100, 0.1]]);
  }
  if (primary.level > 1) {
    const md = isNum(tr.upstreamMidMax) ? tr.upstreamMidMax : env.cMid;
    if (isNum(md)) block *= trap(md, [[0, 1], [30, 0.94], [55, 0.78], [80, 0.48], [95, 0.26]]);
  }
  f.block = block;

  const missF = [];
  for (const k in W_STAT) if (f[k] == null) missF.push(k);
  const S = wgeo([[f.cover, W_STAT.cover], [f.type, W_STAT.type], [f.base, W_STAT.base],
    [f.geom, W_STAT.geom], [f.aero, W_STAT.aero], [f.vis, W_STAT.vis],
    [f.hum, W_STAT.hum], [f.stab, W_STAT.stab], [f.block, W_STAT.block]]);
  let P = 100 * logistic(6.5 * (S - 0.62));
  if (noCloud) P = Math.min(P, 8);
  if (primary.cover < 12) P = Math.min(P, 22);
  P = clamp(P, 2, 97);

  /* 观赏质量（统计模型：按要素分级加权几何平均） */
  const qCover = trap(primary.cover, [[0, 0], [15, 0.3], [35, 0.9], [55, 1], [75, 0.9], [90, 0.55], [100, 0.35]]);
  const qBase = trap(primary.base, [[0.2, 0.05], [1, 0.3], [2, 0.6], [3.5, 0.9], [6, 1], [10, 0.95], [13, 0.7]]);
  const qGeom = f.geom;
  const qDur = trap(geom.dur, [[0, 0.05], [1, 0.5], [3, 0.85], [6, 1], [20, 1]]);
  const qAero = f.aero == null ? 0.7 : f.aero;
  let Q = 100 * wgeo([[qCover, 0.24], [primary.typeScore, 0.20], [qBase, 0.16],
    [qGeom, 0.14], [qAero, 0.14], [qDur, 0.12]]);
  if (noCloud) Q = Math.min(Q, 10);
  Q = clamp(Q, 0, 100);

  if (isNum(env.cape) && env.cape > 1500) notes.push("对流有效位能偏高，可能出现局地对流云遮挡");
  return { P, Q, primary, decks, noCloud, hEff, Heq, Hs, aodUp, d, geom, f, s: S, missF, notes };
}

/* =========================================================================
   评分模型：光追算法（纯物理）
   ========================================================================= */
function scoreRay(env, tr, ctx) {
  const pd = primaryDeck(env);
  const decks = pd.decks, primary = pd.primary;

  const Hs = aerosolScaleHeight(env.blh);
  const aodUp = isNum(tr.upstreamAod) ? tr.upstreamAod : nz(env.aod, 1.2);
  const Heq = equivGroundHeight(aodUp, Hs);
  const hRaw = primary.base - Heq;                 // 等效云底高度
  const hEff = Math.max(0.02, hRaw);
  /* 气溶胶消光层顶已高于云底：阳光无法从光路上方抵达云底，物理上不存在霞光 */
  const noLight = !isNum(hRaw) || hRaw <= 0.05;
  const d = tr.hasDeck ? tr.dFar : null;
  const geom = fireGeometry(hEff, d, ctx.v, ctx.omega);

  /* 采样时刻：从「刚被照亮」（最亮）到「地球遮挡」（最红最暗） */
  const samples = [];
  if (geom.ok) {
    const ts = [0, 0.3, 0.55, 0.78, 1.0];
    for (const t of ts) {
      const mag = geom.thNear + t * (geom.thFar - geom.thNear);
      samples.push(Object.assign({ t, magDeg: mag * RAD, th: -mag }, rayTraceColor(primary.base, -mag, aodUp, Hs)));
    }
  } else {
    const mag = Math.min(geom.thFar || 0.02, Math.max(geom.thNear || 0, 0.0001));
    samples.push(Object.assign({ t: 0, magDeg: mag * RAD, th: -mag, invalid: true }, rayTraceColor(primary.base, -mag, aodUp, Hs)));
  }

  const peak = samples[0];
  const best = samples.reduce((a, b) => (b.sat > a.sat ? b : a), samples[0]);
  const last = samples[samples.length - 1];
  const bright = brightnessLevel(peak.T550);
  const satScore = clamp((peak.sat - 0.12) / 0.55, 0, 1) * 100;
  /* 颜色丰富度：云底越高，色相变化范围越大（教程 1.3.4 结论） */
  const hueSpread = Math.max(...samples.map(s => s.hue)) - Math.min(...samples.map(s => s.hue));
  const colorRich = clamp(hueSpread / 45, 0, 1) * 100;

  const coverF = trap(primary.cover, [[0, 0], [10, 0.16], [25, 0.6], [40, 0.92], [70, 1], [88, 0.55], [100, 0.26]]);
  let geomF;
  if (!tr.hasDeck) geomF = 0.05;
  else if (!isNum(d)) geomF = 0.2;
  else geomF = trap(d / Math.max(geom.xMax, 1), [[0, 0.7], [0.12, 0.95], [0.55, 1], [0.9, 0.6], [1.0, 0.38], [1.5, 0.07], [3, 0.02]]);
  const aeroF = isNum(aodUp) ? trap(aodUp, [[0, 1], [0.1, 1], [0.2, 0.9], [0.3, 0.75], [0.5, 0.55], [0.8, 0.28], [1.2, 0.12], [3, 0.03]]) : 0.7;

  const S = 0.40 * geomF + 0.22 * (bright.score / 100) + 0.16 * (satScore / 100) + 0.10 * coverF + 0.12 * aeroF;
  let P = 100 * logistic(7 * (S - 0.46));
  if (pd.noCloud) P = Math.min(P, 8);
  if (primary.cover < 12) P = Math.min(P, 22);
  P = clamp(P, 2, 97);

  /* 观赏质量：亮度区间 / 感知彩度 / 气溶胶（教程表2.3）/ 云属 / 持续时间 / 云量适中度 */
  const qDur = trap(geom.dur, [[0, 0.06], [1, 0.5], [3, 0.85], [6, 1], [20, 1]]);
  const maxChroma = samples.reduce((a, b) => Math.max(a, b.chroma || 0), 0);
  const qColor = clamp(maxChroma / CHROMA_REF, 0, 1);
  let Q = 100 * wgeo([
    [bright.score / 100, 0.26],
    [qColor, 0.22],
    [aeroF, 0.20],
    [primary.typeScore, 0.16],
    [qDur, 0.08],
    [coverF, 0.08]
  ]);
  if (!geom.ok) Q = Math.min(Q, 55);        // 几何条件不成立，至多“一般”
  if (noLight) { P = Math.min(P, 12); Q = Math.min(Q, 15); }   // 气溶胶消光层顶高于云底
  if (pd.noCloud) Q = Math.min(Q, 10);
  Q = clamp(Q, 0, 99);

  return {
    P, Q, primary, decks, noCloud: pd.noCloud, Heq, Hs, aodUp, hEff, hRaw, noLight, d, geom, samples, peak, best, last,
    bright, satScore, colorRich, hueSpread, geomF, coverF, aeroF, S, qColor, maxChroma, qDur
  };
}

/* =========================================================================
   综合与影响因素
   ========================================================================= */
const W_ENS = { gfs: 0.30, ec: 0.34, rt: 0.36 };
/* 观赏质量等级的唯一来源：阈值 + 名称 + 代表色。
   此前这套阈值散在三处 —— gradeOf()、结论卡片的等级文案、地图图例的等级行，
   任何一处单独改动都会让"同一个分数在不同位置显示成不同等级"。
   min 是**唯一**的落档边界（与改造前的 if/else 链逐点等价）；max 只用于区间文案。
   注意分数保留一位小数，所以 79.5 属于「良」而不是「优」—— 与旧实现完全一致，
   区间文案也只承诺整数分。 */
const QUALITY_BANDS = [
  { key: "优", min: 80, max: 100, color: "#178a52" },
  { key: "良", min: 65, max: 79, color: "#5f9a1b" },
  { key: "一般", min: 45, max: 64, color: "#c07a10" },
  { key: "差", min: 0, max: 44, color: "#c0392b" }
];
const QUALITY_LABEL = { "优": "优秀", "良": "良好", "一般": "一般", "差": "较差" };
function gradeOf(q) {
  const v = isNum(q) ? q : 0;
  for (let i = 0; i < QUALITY_BANDS.length; i++) if (v >= QUALITY_BANDS[i].min) return QUALITY_BANDS[i].key;
  return QUALITY_BANDS[QUALITY_BANDS.length - 1].key;
}
function gradeColor(g) {
  const b = QUALITY_BANDS.find(x => x.key === g);
  return b ? b.color : "#8892a0";
}
/* ---- 模式一致性（可信度）档位：**全应用唯一来源** ----
   阈值 18 / 35 不是新造的 —— 它们此前已经硬写在结论卡的附注文案里，只是没有名字。
   现在提出来命名，附注、结论卡徽标、因素条三处都读它，避免"同一个分歧在两个地方
   显示成不同档"（这正是 QUALITY_BANDS 当初被提取出来的同一条理由）。

   口径统一在 **ΔI = max(I) − min(I)**，其中 I = mixedIndex(P, Q) ——
   与地图的「模型分歧」维度（`divergeOf`）**完全同源**，所以结论卡与地图对
   "三套算法分歧大不大"给的是同一个判断。
   只报 P 的极差会漏掉"概率接近但质量差很多"，反之亦然，所以 P、Q 的极差也各自算出来，
   用来回答"分歧到底落在概率上还是质量上"（`ensConfDetail`）。 */
/* 命名带 `ens`（ensemble）前缀是**必须的**，不是风格问题：
   `_p6.js` 里已经有一个 `function ensConfOf(km)`（地图「可信度纱」用，判的是"离最近采样点多远"）。
   三个内联 script 块共享同一个全局作用域，而**函数声明是覆盖语义、不报错** ——
   最初两者同名（都叫 `confOf`）时，`_p5.js` 写的 `confOf(dvI)` 实际跑的是
   `_p6.js` 那个"距离 → 可信度"的版本，于是结论卡徽标显示成
   "可信度 较高 / 距最近采样点 11 km，插值可信 / undefined"，分歧提示的档位也全都
   fallback 成了 warn。是 `cdp.js` 新增的徽标断言把它抓出来的。
   **凡是在 `_p4/_p5/_p5b` 里新增的全局函数，先 grep 一遍 `_p6.js` 再命名。** */
const ENS_CONF_BANDS = [
  { key: "hi", max: 18, lv: "高", color: "#178a52", bg: "#e9f7ef", bd: "#bfe7d2", txt: "三套算法结论接近", hint: "可信度较高，可直接据此安排。" },
  { key: "mid", max: 35, lv: "中", color: "#c07a10", bg: "#fdf3e3", bd: "#f2ddba", txt: "三套算法存在一定分歧", hint: "分歧在可接受范围内，建议结合临近云图复核。" },
  { key: "lo", max: Infinity, lv: "低", color: "#c0392b", bg: "#fdeceb", bd: "#f5cdc9", txt: "三套算法分歧较大", hint: "请谨慎采信，临近日再确认一次。" }
];
/* 取不到分歧（不足两套算法有值）时给「中」—— 既不假装可信，也不无端恐吓 */
function ensConfOf(dv) {
  if (!isNum(dv)) return ENS_CONF_BANDS[1];
  for (let i = 0; i < ENS_CONF_BANDS.length; i++) if (dv < ENS_CONF_BANDS[i].max) return ENS_CONF_BANDS[i];
  return ENS_CONF_BANDS[ENS_CONF_BANDS.length - 1];
}
/* 分歧落在概率还是质量上。两边的极差都小于 8 分时不再区分主次 ——
   那种量级本来就只是取整噪声，硬说"主要在某一侧"是过度解读。 */
function ensConfDetail(spreadP, spreadQ) {
  const a = nz(spreadP, 0), b = nz(spreadQ, 0);
  if (Math.max(a, b) < 8) return "两方面分歧都很小";
  const mainIsP = a >= b;
  return "分歧主要在" + (mainIsP ? "出现概率" : "观赏质量") + "（" + Math.round(Math.max(a, b)) +
    " 分），" + (mainIsP ? "观赏质量" : "出现概率") + "较一致（" + Math.round(Math.min(a, b)) + " 分）";
}
/* 等级在图例色条上的代表位置：取区间中点（优＝90、良＝72、一般＝54.5、差＝22） */
function bandMid(b) { return (b.min + Math.min(b.max, 100)) / 2; }
/* 区间文案（供 innerHTML 使用，所以 "<" 一律转义成 &lt;），唯一由 QUALITY_BANDS 推导 */
function bandRangeHtml(b, unit) {
  return (b.min === 0 ? "&lt;" + (b.max + 1) : b.min + "–" + b.max) + " " + unit;
}

/* ---------------------------------------------------------------------------
   热力图统一色阶：白 → 黄 → 橙 → 红
   白色＝最低值（0），红色＝最高值（100），中间为连续线性渐变（逐段 sRGB 线性插值）。
   只有这一条色阶：所有热力图图层都从 rampColor() 取色 ——
   栅格值场（buildField 的 256 档 LUT）、省级色块（PROV_STYLES）、图例色条与等级色块、
   排行榜条形、悬停色块 —— 因此朝霞 / 晚霞、各算法模型、各着色维度之间着色规则完全一致。
   锚点同时保证色相 60°→0° 单调递进、亮度单调下降（顶端用深红而非纯 #f00，
   否则纯红亮度低于橙，高值区反而显得"更暗"，视觉上会误判成低值）。
   mode 参数保留但已不再影响颜色，仅为兼容既有调用点。
--------------------------------------------------------------------------- */
const HEAT_RAMP = [
  "#ffffff",  // 0%   白
  "#fff7b0",  // 14%  极浅黄
  "#ffe44d",  // 29%  黄
  "#ffc220",  // 43%  琥珀
  "#ff9520",  // 57%  橙
  "#fa6a16",  // 71%  深橙
  "#ee3c15",  // 86%  橙红
  "#d51313"   // 100% 红（最高值）
];
function rampColors(mode) { return HEAT_RAMP; }
function rampColor(mode, v) {
  const c = rampColors(mode);
  const x = clamp(v, 0, 100) / 100 * (c.length - 1);
  const i = clamp(Math.floor(x), 0, c.length - 2);
  const f = x - i;
  return mixHex(c[i], c[i + 1], f);
}
/* 与 rampColor 完全等价的 CSS 渐变串：图例色条用它渲染，保证与栅格逐像素同源同色 */
function heatGradientCss(deg) {
  const stops = HEAT_RAMP.map((c, i) => c + " " + (i / (HEAT_RAMP.length - 1) * 100).toFixed(2) + "%");
  return "linear-gradient(" + (deg == null ? 90 : deg) + "deg," + stops.join(",") + ")";
}
function hex2rgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function mixHex(a, b, t) {
  const A = hex2rgb(a), B = hex2rgb(b);
  return "#" + [0, 1, 2].map(i => Math.round(lerp(A[i], B[i], t)).toString(16).padStart(2, "0")).join("");
}
/* 两个维度合并为一个色值的规则：综合指数 I = 0.55×概率 + 0.45×质量 */
function mixedIndex(P, Q) { return clamp(0.55 * P + 0.45 * Q, 0, 100); }

/* 色标值域：按当日各点的实际数值范围做线性拉伸。
   若直接用 0–100 的绝对值域，像 60–77 这样的窄区间会把所有地区挤进同一档颜色，
   地域差异在图上就看不出来了；拉伸后色阶的两端对应当日实际的最低/最高值，
   图例刻度同步显示这两个真实数值，仍可反查绝对大小。 */
function scaleRange(vals) {
  const a = vals.filter(isNum);
  if (!a.length) return { lo: 0, hi: 100 };
  let lo = Math.min.apply(null, a), hi = Math.max.apply(null, a);
  const pad = Math.max(3, (hi - lo) * 0.06);
  lo = Math.max(0, Math.floor(lo - pad));
  hi = Math.min(100, Math.ceil(hi + pad));
  if (hi - lo < 12) {                    // 全境近乎一致时给一个最小跨度，避免整图同色
    const c = (hi + lo) / 2;
    lo = Math.max(0, Math.round(c - 6));
    hi = Math.min(100, lo + 12);
  }
  return { lo, hi };
}
/* 绝对数值 → 0–1 的色阶位置 */
function scaleT(v, lo, hi) { return clamp((v - lo) / ((hi - lo) || 1), 0, 1); }
