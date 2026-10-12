/* P4 前置探索：合并单点侧与地图侧的首屏请求之前，必须先确认三件事
   ① timezone=auto 与 timezone=Asia/Shanghai 对同一坐标返回的「真实时刻」是否一致
      （makeSeries 用 Date.parse(t+"Z") - utc_offset_seconds 还原为真实 UTC 毫秒，
       所以只要 utc_offset_seconds 不同，同一坐标的 hourly.time 序列就对应不同的真实时刻）
   ② 合并后的坐标数（169）单次请求是否被接受、URL 有多长（GET 的实际上限）
   ③ 变量集取并集（14 个）后，同一坐标的数值是否与精简集（9 个）逐位一致
      —— 若一致，则"合并"在地图侧只是"顺便多取几个用不到的变量"，
         但计费权重会从 1.0/坐标涨到 1.4/坐标，必须算清楚账。 */
const http = require("http");
const https = require("https");

const API = "https://api.open-meteo.com/v1/forecast";
const AQ = "https://air-quality-api.open-meteo.com/v1/air-quality";

function get(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, r => {
      let s = "";
      r.setEncoding("utf8");
      r.on("data", c => s += c);
      r.on("end", () => {
        if (r.statusCode !== 200) return rej(new Error("HTTP " + r.statusCode + " " + s.slice(0, 300)));
        res(JSON.parse(s));
      });
    });
    req.on("error", rej);
    req.setTimeout(30000, () => { req.destroy(new Error("timeout")); });
  });
}
const qs = o => Object.keys(o).map(k => k + "=" + encodeURIComponent(o[k])).join("&");

const DATE = "2026-10-09";
const SH = { lat: 31.2304, lon: 121.4737 };
const NY = { lat: 40.7128, lon: -74.0060 };

let fail = 0;
function ck(ok, msg) { console.log((ok ? "PASS" : "FAIL"), msg); if (!ok) fail++; }

(async function () {
  /* ---------- ① timezone 语义 ---------- */
  console.log("=== ① timezone 参数语义 ===");
  for (const [nm, p] of [["上海", SH], ["纽约", NY]]) {
    const base = {
      latitude: p.lat, longitude: p.lon, hourly: "temperature_2m",
      start_date: DATE, end_date: DATE
    };
    const a = await get(API + "?" + qs(Object.assign({}, base, { timezone: "auto" })));
    const b = await get(API + "?" + qs(Object.assign({}, base, { timezone: "Asia/Shanghai" })));
    console.log(`  ${nm}: auto -> tz=${a.timezone} off=${a.utc_offset_seconds} | ` +
      `Asia/Shanghai -> tz=${b.timezone} off=${b.utc_offset_seconds}`);
    const sameOff = a.utc_offset_seconds === b.utc_offset_seconds;
    const sameTime = JSON.stringify(a.hourly.time) === JSON.stringify(b.hourly.time);
    const sameVal = JSON.stringify(a.hourly.temperature_2m) === JSON.stringify(b.hourly.temperature_2m);
    console.log(`         hourly.time 相同=${sameTime}  温度序列相同=${sameVal}`);
    if (nm === "上海") {
      ck(sameOff && sameTime && sameVal,
        "上海坐标：auto 与 Asia/Shanghai 返回完全一致（国内坐标下统一时区＝零数值变化）");
    } else {
      ck(!sameOff,
        "纽约坐标：auto 与 Asia/Shanghai 不一致（" + a.utc_offset_seconds + " vs " + b.utc_offset_seconds +
        "）→ 统一成 Asia/Shanghai 会改变国外坐标的取值");
    }
  }

  /* ---------- ③ 变量集并集是否等价 ---------- */
  console.log("=== ③ 变量集 9(地图) vs 14(单点) 对同一坐标是否等价 ===");
  const NINE = ["temperature_2m", "relative_humidity_2m", "cloud_cover_low", "cloud_cover_mid",
    "cloud_cover_high", "visibility", "pressure_msl", "boundary_layer_height", "freezing_level_height"];
  const FOURTEEN = NINE.concat(["dew_point_2m", "wind_speed_10m", "wind_direction_10m", "precipitation", "cape"]);
  const pN = { latitude: SH.lat, longitude: SH.lon, hourly: NINE.join(","), start_date: DATE, end_date: DATE, timezone: "Asia/Shanghai", models: "gfs_seamless" };
  const pF = { latitude: SH.lat, longitude: SH.lon, hourly: FOURTEEN.join(","), start_date: DATE, end_date: DATE, timezone: "Asia/Shanghai", models: "gfs_seamless" };
  const rN = await get(API + "?" + qs(pN));
  const rF = await get(API + "?" + qs(pF));
  const shared = NINE.concat(["dew_point_2m"]);
  let bad = 0;
  for (const k of NINE) {
    if (JSON.stringify(rN.hourly[k]) !== JSON.stringify(rF.hourly[k])) { bad++; console.log("    差异字段:", k); }
  }
  ck(bad === 0, "9 变量集与 14 变量集里共有的 9 个变量逐位一致（" + (bad === 0 ? "0 差异" : bad + " 处差异") + "）");

  /* ---------- ② 169 坐标单次请求可行性 ---------- */
  console.log("=== ② 合并后 169 坐标单次请求 ===");
  /* 用 152 个地图点（真实数据）+ 17 个上海样带点近似构造并集规模 */
  const pts = [];
  for (let i = 0; i < 152; i++) pts.push({ lat: 20 + (i % 30) * 1.1, lon: 100 + (i % 40) * 0.8 });
  for (let i = 0; i < 17; i++) pts.push({ lat: SH.lat + i * 0.05, lon: SH.lon + i * 0.05 });
  ck(pts.length === 169, "构造的并集坐标数 = 169（实测 " + pts.length + "）");
  const big = {
    latitude: pts.map(x => x.lat.toFixed(4)).join(","),
    longitude: pts.map(x => x.lon.toFixed(4)).join(","),
    hourly: FOURTEEN.join(","), start_date: DATE, end_date: DATE,
    timezone: "Asia/Shanghai", models: "gfs_seamless"
  };
  const url = API + "?" + qs(big);
  console.log("  URL 长度 = " + url.length + " 字节");
  ck(url.length < 8000, "合并请求 URL 长度 < 8000 字节（实测 " + url.length + "）");
  let ok169 = true, n169 = 0;
  try {
    const r = await get(url);
    n169 = Array.isArray(r) ? r.length : 1;
  } catch (e) { ok169 = false; console.log("    请求失败:", e.message); }
  ck(ok169 && n169 === 169, "169 坐标单次请求被接受，返回 " + n169 + " 组结果");

  /* ---------- 计费权重核算 ---------- */
  console.log("=== 计费权重核算（Open-Meteo：权重 = max(1, 变量数/10 × 时间系数) × 坐标数） ===");
  const wSingle = { coord: 17, vars: 14, days: 3 };
  const wMap = { coord: 152, vars: 9, days: 1 };
  const wMerge = { coord: 169, vars: 14, days: 3 };
  console.log("  单点 3 路   : 17 坐标 × max(1, 1.4×τ3)  = " + (3 * 17) + " … " + (3 * 17 * 1.4));
  console.log("  地图 3 路   : 152 坐标 × max(1, 0.9×τ1) = " + (3 * 152));
  console.log("  合并 3 路   : 169 坐标 × max(1, 1.4×τ3) = " + (3 * 169) + " … " + (3 * 169 * 1.4));
  console.log("  坐标数口径（不考虑权重，只看坐标数）: 现在 3×(17+152)=" + (3 * 169) + " → 合并 3×169=" + (3 * 169));
  console.log("  「变量×坐标」乘积口径: 现在 " + (3 * (17 * 14 + 152 * 9)) + " → 合并 " + (3 * 169 * 14));

  /* ---------- AQ 接口 ---------- */
  console.log("=== AQ 接口 169 坐标 ===");
  const aqU = AQ + "?" + qs({
    latitude: pts.map(x => x.lat.toFixed(4)).join(","),
    longitude: pts.map(x => x.lon.toFixed(4)).join(","),
    hourly: "aerosol_optical_depth,pm2_5,pm10,dust",
    start_date: DATE, end_date: DATE, timezone: "Asia/Shanghai"
  });
  console.log("  AQ URL 长度 = " + aqU.length + " 字节");
  let aqN = 0, aqOK = true;
  try { const r = await get(aqU); aqN = Array.isArray(r) ? r.length : 1; } catch (e) { aqOK = false; console.log("    ", e.message); }
  ck(aqOK && aqN === 169, "AQ 169 坐标单次请求被接受，返回 " + aqN + " 组结果");

  console.log("FAIL 计数:", fail);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error("探针异常:", e); process.exitCode = 3; });
