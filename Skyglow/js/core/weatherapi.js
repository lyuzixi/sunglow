/* ---------------- WeatherAPI (optional) ---------------- */
function getWaKey() {
  try { return localStorage.getItem("skyglow:waKey") || null; } catch (e) { return null; }
}
function setWaKey(v) {
  try {
    if (v) localStorage.setItem("skyglow:waKey", v);
    else localStorage.removeItem("skyglow:waKey");
  } catch (e) { /* ignore */ }
}
function getWaCap() {
  try { return +(localStorage.getItem("skyglow:waCap") || 2000) || 2000; } catch (e) { return 2000; }
}
function setWaCap(v) {
  try { localStorage.setItem("skyglow:waCap", String(+v || 2000)); } catch (e) { /* ignore */ }
}

async function waSampleAt(lat, lon, wallMs, offsetSec, keyIn) {
  // wallMs = 事件时刻的"墙上时钟"毫秒（= epoch + offset*1000）
  const key = keyIn || getWaKey();
  if (!key) return null;
  const o = dateInOffset(wallMs, 0);
  const todayO = dateInOffset(Date.now(), offsetSec);
  const lead = (Date.UTC(o.y, o.m - 1, o.d) - Date.UTC(todayO.y, todayO.m - 1, todayO.d)) / 86400000;
  if (lead > 2) return null;

  const ck = "wa:" + lat.toFixed(2) + "," + lon.toFixed(2);
  let data = cacheGet(ck);
  if (!data) {
    const url = WA_API + "?key=" + encodeURIComponent(key)
      + "&q=" + lat.toFixed(4) + "," + lon.toFixed(4)
      + "&days=3&aqi=no&alerts=no&lang=zh";
    const res = await fetch(url);
    data = await res.json();
    if (!res.ok || data.error) {
      throw new Error((data.error && data.error.message) || ("HTTP " + res.status));
    }
    cachePut(ck, data, CACHE_TTL);
  }
  const all = [];
  for (const day of (data.forecast && data.forecast.forecastday) || []) {
    for (const h of day.hour || []) all.push(h);
  }
  if (!all.length) return null;

  let best = null;
  for (const h of all) {
    const t = parseLocalMs(h.time.replace(" ", "T"));
    const dt = Math.abs(t - wallMs);
    if (!best || dt < best.dt) best = { dt, h };
  }
  const h = best.h;
  return {
    time: h.time, cloud_total: h.cloud, humidity: h.humidity,
    visibility_km: h.vis_km, precip_mm: h.precip_mm, chance_of_rain: h.chance_of_rain,
    dewpoint_c: h.dewpoint_c, temp_c: h.temp_c, wind_kph: h.wind_kph,
    condition: (h.condition || {}).text, offset_minutes: Math.round(best.dt / 60000),
  };
}

function fillAux(w, wa) {
  const used = {};
  if (!wa) return used;
  if (w.vis == null && wa.visibility_km != null) { w.vis = wa.visibility_km * 1000; used.vis = "weatherapi"; }
  if (w.rh == null && wa.humidity != null) { w.rh = wa.humidity; used.rh = "weatherapi"; }
  if ((w.precip || 0) <= 0 && wa.precip_mm) { w.precip = wa.precip_mm; used.precip = "weatherapi"; }
  return used;
}

/* ---------------- 本地配置 / 用量 / 测试 ---------------- */
function waUsageRead() {
  try {
    const j = JSON.parse(localStorage.getItem("skyglow:waUsage") || "null");
    if (j && j.date === new Date().toISOString().slice(0, 10)) return j;
  } catch (e) { /* ignore */ }
  return { date: new Date().toISOString().slice(0, 10), count: 0, ok: 0, fail: 0 };
}
function waUsageBump(ok, msg) {
  const u = waUsageRead();
  u.count++;
  if (ok) { u.ok++; u.last_ok = new Date().toISOString(); }
  else { u.fail++; u.last_error = String(msg || "请求失败"); }
  try { localStorage.setItem("skyglow:waUsage", JSON.stringify(u)); } catch (e) { /* ignore */ }
}
function weatherApiStatus() {
  const key = getWaKey();
  const cap = getWaCap();
  const u = waUsageRead();
  return {
    configured: !!key,
    source: key ? "localStorage" : "—",
    key_hint: key ? "…" + key.slice(-4) : "",
    cap,
    usage: {
      count: u.count, cap, remaining: Math.max(0, cap - u.count),
      ok: u.ok, fail: u.fail, last_ok: u.last_ok || null, last_error: u.last_error || null,
    },
    note: "全功能单文件版：Key 仅存本机 localStorage，明文保存；不会上传任何服务器。",
  };
}
async function weatherApiTest() {
  const key = getWaKey();
  if (!key) return { ok: false, error: "未配置 WeatherAPI Key" };
  try {
    const url = WA_API + "?key=" + encodeURIComponent(key)
      + "&q=31.2304,121.4737&days=1&aqi=no&alerts=no&lang=zh";
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error((data.error && data.error.message) || ("HTTP " + res.status));
    const h = (data.current || {});
    waUsageBump(true, "test");
    return { ok: true, sample: {
      time: h.last_updated, condition: (h.condition || {}).text,
      cloud_total: h.cloud, visibility_km: h.vis_km, humidity: h.humidity,
      precip_mm: h.precip_mm, chance_of_rain: null,
    } };
  } catch (e) {
    waUsageBump(false, e.message);
    return { ok: false, error: e.message };
  }
}
async function weatherApiHandle(params) {
  const method = params.get("_method");
  if (method === "post") {
    if (params.has("key")) setWaKey((params.get("key") || "").trim());
    if (params.has("daily_cap")) setWaCap(params.get("daily_cap"));
    return weatherApiStatus();
  }
  if (method === "test") return weatherApiTest();
  return weatherApiStatus();
}
const SkyglowWeatherApi = { handle: weatherApiHandle, status: weatherApiStatus, key: getWaKey };

/* 神经网络评分。15 个输入与 Python service._nn_features 逐项对应：
   三层云量 + 上游两层云量 + 湿度/边界层/太阳高度 + 7 个物理子项。 */
function nnScore(w, elev) {
  const f = featuresFromWeather(w, elev);
  const feats = [
    w.cc_low || 0, w.cc_mid || 0, w.cc_high || 0,
    w.cc_low_up || 0, w.cc_mid_up || 0,
    w.rh || 0, w.blh || 0, elev,
    f.canvas, f.canvas_high, f.light, f.horizon, f.purity, f.aod, f.precip,
  ];
  const p = nnPredict(feats, NN);
  return p == null ? null : p;
}

