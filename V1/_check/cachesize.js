/* 一次性测量：地图模块"每个日期键"的真实体积与请求账目。
   用途：回答"为什么只取这么多个采样点"的成本论证需要真实常数，不靠估。
   注：采样点论证经历过两轮 —— 107 → 152（D6 加密），再 → 周边局部网格（B13，点数由
   半径/间距常量固定、随查询点平移）。这里的输出即为当前基线。
   用法: node _check/cachesize.js
   输出：点对象平均字节、每日期 localStorage 条目字节、加权调用数、栅格与锚点比。 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SERVE = path.join(ROOT, "_check");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 47877, DBG = 9338;

function serve() {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".png": "image/png" };
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split("?")[0]);
    const f = path.join(SERVE, u === "/" ? "/preview.html" : u);
    fs.readFile(f, (e, b) => {
      if (e) { res.writeHead(404); res.end("no"); return; }
      res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" });
      res.end(b);
    });
  });
  return new Promise(r => srv.listen(PORT, "127.0.0.1", () => r(srv)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jget = async u => (await fetch(u)).json();

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pend = new Map(); this.handlers = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws error")); });
    const c = new CDP(ws);
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pend.has(m.id)) {
        const { res, rej } = c.pend.get(m.id); c.pend.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else c.handlers.forEach(f => f(m));
    };
    return c;
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pend.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.pend.has(id)) { this.pend.delete(id); rej(new Error("timeout " + method)); } }, 60000);
    });
  }
  on(f) { this.handlers.push(f); }
}
const clampf = (v, a, b) => (v < a ? a : (v > b ? b : v));

function gen(v, lat, lon, h, isAQ, dof) {
  const wave = (a, b) => Math.sin((lat + a + dof) / 6) * Math.sin((lon + b) / 7);
  const diur = ph => Math.max(0, Math.sin((h - ph) / 24 * 2 * Math.PI));
  if (isAQ) {
    if (v === "aerosol_optical_depth") return clampf(0.32 + 0.22 * wave(0, 0), 0.02, 1.6);
    if (v === "pm2_5") return clampf(30 + 22 * wave(3, 5), 2, 220);
    if (v === "pm10") return clampf(52 + 30 * wave(3, 5), 4, 320);
    return clampf(8 + 6 * wave(1, 2), 0, 120);
  }
  switch (v) {
    case "temperature_2m": return 16 + 9 * Math.sin((h - 8) / 24 * 2 * Math.PI) - Math.abs(lat - 31) * 0.35;
    case "dew_point_2m": return 8 + 5 * Math.sin((h - 6) / 24 * 2 * Math.PI) - Math.abs(lat - 31) * 0.28;
    case "relative_humidity_2m": return clampf(62 + 22 * Math.sin((h - 14) / 24 * 2 * Math.PI), 15, 98);
    case "cloud_cover_low": return clampf(38 + 40 * wave(0, 0) + 18 * diur(4), 0, 100);
    case "cloud_cover_mid": return clampf(34 + 36 * wave(9, 4) + 16 * diur(2), 0, 100);
    case "cloud_cover_high": return clampf(42 + 38 * wave(18, 9) + 14 * diur(0), 0, 100);
    case "visibility": return clampf(24000 - 14000 * Math.max(0, wave(0, 0)) + 1500 * Math.sin(h / 4), 1200, 45000);
    case "pressure_msl": return clampf(1012 + 6 * wave(5, 3), 990, 1035);
    case "boundary_layer_height": return clampf(300 + 1100 * Math.max(0, Math.sin((h - 6) / 12 * Math.PI)), 80, 2200);
    case "freezing_level_height": return clampf(4200 - Math.abs(lat - 31) * 60, 1200, 5200);
    case "wind_speed_10m": return clampf(5 + 4 * wave(2, 7), 0.4, 22);
    case "wind_direction_10m": return ((260 + 40 * wave(4, 1)) % 360 + 360) % 360;
    case "precipitation": return Math.max(0, 0.6 * wave(6, 6));
    case "cape": return clampf(220 + 260 * wave(8, 2), 0, 1800);
    default: return 1;
  }
}

(async function main() {
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "cdpc-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + DBG, "--user-data-dir=" + udd, "--window-size=1200,900", "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });

  let ver = null;
  for (let i = 0; i < 60; i++) { try { ver = await jget("http://127.0.0.1:" + DBG + "/json/version"); break; } catch (e) { await sleep(500); } }
  if (!ver) { console.log("CHROME_START_FAIL"); process.exit(1); }
  const list = await jget("http://127.0.0.1:" + DBG + "/json/list");
  const page = list.find(t => t.type === "page");
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);

  await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Fetch.enable", { patterns: [
    { urlPattern: "*://api.open-meteo.com/*" },
    { urlPattern: "*://air-quality-api.open-meteo.com/*" }
  ] });
  cdp.on(async m => {
    if (m.method !== "Fetch.requestPaused") return;
    const { requestId, request } = m.params;
    try {
      const u = new URL(request.url);
      const lats = (u.searchParams.get("latitude") || "").split(",").map(Number);
      const lons = (u.searchParams.get("longitude") || "").split(",").map(Number);
      const vars = (u.searchParams.get("hourly") || "").split(",").filter(Boolean);
      const isAQ = u.hostname.indexOf("air-quality") >= 0;
      const sd = u.searchParams.get("start_date") || "";
      const dof = Number(sd.slice(-2)) % 7 * 0.9;
      const body = lats.map((la, i) => {
        const lo = lons[i] == null ? 0 : lons[i];
        const times = [];
        for (let h = 0; h < 24; h++) times.push(sd + "T" + String(h).padStart(2, "0") + ":00");
        const hourly = { time: times };
        vars.forEach(v => { hourly[v] = times.map((_, h) => gen(v, la, lo, h, isAQ, dof)); });
        return { latitude: la, longitude: lo, utc_offset_seconds: 28800, timezone: "Asia/Shanghai", hourly };
      });
      await cdp.send("Fetch.fulfillRequest", {
        requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" },
          { name: "Access-Control-Allow-Origin", value: "*" }],
        body: Buffer.from(JSON.stringify(body), "utf8").toString("base64")
      });
    } catch (e) { await cdp.send("Fetch.continueRequest", { requestId }).catch(() => { }); }
  });

  await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/preview.html" });
  let ready = false, kicked = false;
  for (let i = 0; i < 80; i++) {
    await sleep(1000);
    const r = await cdp.send("Runtime.evaluate", {
      expression: `(typeof MapMod!=='undefined') && MapMod.ok && !!(mapSet() && mapSet().pts.length)`,
      returnByValue: true
    });
    if (r.result.value) { ready = true; break; }
    /* 首屏不再自动取地图数据（B11）：这里代替用户点一次「刷新地图」。
       只点一次 —— 反复点会让请求令牌 reqSeq 自增、把上一次取数作废。 */
    if (!kicked) {
      const k = await cdp.send("Runtime.evaluate", {
        expression: `(function(){ try{ var b=document.getElementById("mapGo"); if(!b) return "no-btn"; b.click(); return "clicked"; }catch(e){ return String(e); } })()`,
        returnByValue: true
      });
      if (k.result.value === "clicked") kicked = true;
    }
  }
  if (!ready) { console.log("首屏地图未就绪，退出"); process.exit(1); }
  await sleep(1200);

  const r = await cdp.send("Runtime.evaluate", {
    expression: `(function(){
      const keys = Object.keys(MapMod.data);
      const d = MapMod.data[keys[0]];
      const onePeriod = d && d.pm ? d.pm.pts : [];
      const json1 = JSON.stringify(d);                    // 一个日期键的完整对象
      const jsonP = JSON.stringify(onePeriod[0] || {});   // 单个点对象
      const lsKeys = [];
      for (let i = 0; i < localStorage.length; i++) lsKeys.push(localStorage.key(i));
      const lsMapKeys = lsKeys.filter(k => k.indexOf(MAP_CACHE_PREFIX) === 0);
      const lsSizes = lsMapKeys.map(k => localStorage.getItem(k).length);
      const st = apiCallStats();
      return JSON.stringify({
        mapPoints: mapPts().length,
        dateKeys: keys.length,
        ptsPerPeriod: onePeriod.length,
        perPointChars: jsonP.length,
        perDateChars: json1.length,
        perDateUtf8: new Blob([json1]).size,
        lsEntries: lsMapKeys.length,
        lsCharsTotal: lsSizes.reduce((a,b)=>a+b,0),
        lsCharsEach: lsSizes,
        apiRequests: st.requests,
        apiCoords: st.coords,
        apiDetail: st.calls.map(c => c.endpoint + "/" + c.coords + "x" + c.vars + "/" + c.tz),
        raster: MapMod.field ? { cols: MapMod.field.cols, rows: MapMod.field.rows } : null,
        strips: (MapMod.strips||[]).length,
        fMapVars: F_MAP_VARS.length,
        fieldReachKm: FIELD_REACH_KM, fieldStep: FIELD_STEP, fieldOutKm: FIELD_OUT_KM,
        idwMaxKm: MAP_IDW_MAX, tipRangeKm: TIP_RANGE_KM, azKm: MAP_AZ_KM,
        dataMax: MAP_DATA_MAX
      }, null, 1);
    })()`, returnByValue: true
  });
  console.log(r.result.value);

  await cdp.send("Browser.close").catch(() => { });
  chrome.kill(); srv.close(); process.exit(0);
})().catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
