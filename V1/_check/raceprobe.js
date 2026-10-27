/* 竞态回归守护：快速切换地图日期时，先发出的慢请求会"后返回"。
   用法: node _check/raceprobe.js

   构造方式（时间轴）：
     t=0     选日期 B（该日期的接口被刻意延迟 2400 ms/次，共 3 次）
     t=1000  选日期 A（该日期的接口被刻意延迟 6000 ms/次）  ← 形成"后发先至"的窗口
     t≈8s    B 的响应到达（此时已经切到 A）——修复前它会：
               · 走 paintMap() 的"无数据提前 return"，标签写 A、色面停在最初日期
               · 紧接着 mapSetLoad(false) 把加载遮罩关掉
     t≈20s   A 的响应到达，才真正画对

   修复后应满足的**不变量**（本探针的断言）：
     ① 遮罩一旦关闭，色面指纹必须已经等于最终值 ——
        不允许出现"没有加载提示、但图上还是旧日期的颜色"这种静默错误；
     ② 窗口内不允许有任何采样点的遮罩被提前关闭（除非色面已是最新）。
   注意：窗口内"标签已是 A、色面仍是旧日期、遮罩为 flex"是**正确**状态 ——
   旧色面 + 加载遮罩 = "新数据还在路上"，用户不会被误导。判据只在遮罩关闭之后才生效。
*/
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SERVE = path.join(ROOT, "_check");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 47855;

const D_SLOW = 6000, D_MID = 2400;
function ymd(offDays) { return new Date(Date.now() + offDays * 86400000).toISOString().slice(0, 10); }
const DATE_B = ymd(1);      // 先点、慢
const DATE_A = ymd(2);      // 后点、较快

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

function clampf(v, a, b) { return v < a ? a : (v > b ? b : v); }
/* 合成场：额外按 start_date 的"日"给一个偏移，这样不同日期算出来的色面指纹不同，
   否则两次请求返回一模一样的数据，就分辨不出"画的是哪一天"。 */
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
    case "surface_pressure": return clampf(1000 + 6 * wave(5, 3), 850, 1030);
    case "boundary_layer_height": return clampf(300 + 1100 * Math.max(0, Math.sin((h - 6) / 12 * Math.PI)), 80, 2200);
    case "freezing_level_height": return clampf(4200 - Math.abs(lat - 31) * 60, 1200, 5200);
    case "wind_speed_10m": return clampf(5 + 4 * wave(2, 7), 0.4, 22);
    case "wind_direction_10m": return ((260 + 40 * wave(4, 1)) % 360 + 360) % 360;
    case "wind_gusts_10m": return clampf(9 + 6 * wave(2, 7), 1, 32);
    case "precipitation": return Math.max(0, 0.6 * wave(6, 6));
    case "cape": return clampf(220 + 260 * wave(8, 2), 0, 1800);
    case "shortwave_radiation": return clampf(700 * Math.max(0, Math.sin((h - 6) / 12 * Math.PI)), 0, 900);
    default: return 1;
  }
}

/* 页面内快照：色面指纹 + 标签 + 遮罩 + 已缓存的日期 + 当前 curDate。
   指纹取自**当前网格中心**（MapMod.gridC，即取数时真正用的那个中心），
   而不是写死某个城市的坐标 —— B13 之后值场只覆盖查询点周围 500 km，
   写死的点一旦落到场外，fieldValue 就返回 null，"色面指纹变没变"这条断言
   会静默地变成恒真/恒假的空转，看起来全绿其实什么都没测。 */
const SNAP = `(function(){
  var fv = null;
  try {
    var c = (typeof MapMod!=='undefined' && MapMod.gridC) ? MapMod.gridC : { lat: State.lat, lon: State.lon };
    fv = fieldValue(c.lat, c.lon);
  } catch(e){}
  var load = document.querySelector('#mapLoad');
  return JSON.stringify({
    t: +performance.now().toFixed(0),
    curDate: (typeof MapMod!=='undefined') ? MapMod.curDate : null,
    tag: (document.querySelector('#mapTag')||{}).textContent || '',
    mask: load ? (load.style.display || '') : '',
    fieldAtC: (fv==null? null : +fv.toFixed(2)),
    cached: (typeof MapMod!=='undefined') ? Object.keys(MapMod.data) : [],
    strips: (typeof MapMod!=='undefined') ? (MapMod.strips||[]).length : -1
  });
})()`;

(async function main() {
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "cdpr-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=9336", "--user-data-dir=" + udd, "--window-size=1200,900", "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let cerr = ""; chrome.stderr.on("data", d => { cerr += d.toString(); });

  let ver = null;
  for (let i = 0; i < 60; i++) { try { ver = await jget("http://127.0.0.1:9336/json/version"); break; } catch (e) { await sleep(500); } }
  if (!ver) { console.log("CHROME_START_FAIL\n" + cerr.slice(0, 2000)); process.exit(1); }

  const list = await jget("http://127.0.0.1:9336/json/list");
  const page = list.find(t => t.type === "page");
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  const errs = [];
  cdp.on(m => {
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
      errs.push(m.params.args.map(a => a.value || a.description || a.type).join(" ").slice(0, 200));
    else if (m.method === "Runtime.exceptionThrown")
      errs.push("EXCEPTION: " + String(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || "").slice(0, 200));
  });
  await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });

  /* 按 start_date 决定响应延迟，制造"后发先至" */
  let seen = { slow: 0, mid: 0, fast: 0 };
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
      /* 只有"地图批量"（坐标数 > 50）才施加延迟，避免把单点预报也拖慢。
         关键：先点的 B 较快、后点的 A 更慢 —— 这样 B 的响应会落在
         "已经切到 A、但 A 还没回来"的窗口里，触发 paintMap 的提前 return。 */
      let dly = 0;
      if (lats.length > 50) {
        if (sd === DATE_B) { dly = D_MID; seen.slow++; }
        else if (sd === DATE_A) { dly = D_SLOW; seen.mid++; }
        else seen.fast++;
      }
      if (dly) await sleep(dly);
      await cdp.send("Fetch.fulfillRequest", {
        requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" },
          { name: "Access-Control-Allow-Origin", value: "*" }],
        body: Buffer.from(JSON.stringify(body), "utf8").toString("base64")
      });
    } catch (e) { await cdp.send("Fetch.continueRequest", { requestId }).catch(() => { }); }
  });

  await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/preview.html" });

  /* 等首屏地图就绪 */
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

  const snap = async () => {
    const r = await cdp.send("Runtime.evaluate", { expression: SNAP, returnByValue: true });
    return JSON.parse(r.result.value);
  };

  const t0 = await snap();

  /* 关键序列：先点慢的 B，1000ms 后点较快的 A */
  const drive = await cdp.send("Runtime.evaluate", {
    expression: `(async function(){
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const sel = document.querySelector('#mapDateSel');
      const has = v => [].some.call(sel.options, o => o.value === v);
      const out = { opts: [].map.call(sel.options, o => o.value).slice(0, 4), hasA: has(${JSON.stringify(DATE_A)}), hasB: has(${JSON.stringify(DATE_B)}) };
      sel.value = ${JSON.stringify(DATE_B)}; sel.dispatchEvent(new Event('change'));
      out.clickedB = sel.value;
      await sleep(1000);
      sel.value = ${JSON.stringify(DATE_A)}; sel.dispatchEvent(new Event('change'));
      out.clickedA = sel.value;
      return JSON.stringify(out);
    })()`, returnByValue: true, awaitPromise: true
  });

  /* 时间轴采样：B 总共约 3×D_MID=7.2s，A 约 1.0+3×D_SLOW=19s */
  const marks = [];
  const t = [1200, 3000, 5000, 7000, 8600, 11000, 15000, 20000, 23000];
  let prev = 0;
  for (const ms of t) { await sleep(ms - prev); prev = ms; marks.push(await snap()); }

  /* 等界面真正静下来（遮罩关闭）再取"最终值"，否则拿一个还没画完的快照当基准会误判 */
  let last = marks[marks.length - 1];
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    last = await snap();
    if (last.mask === "none") break;
  }
  marks.push(last);

  console.log("日期选择：" + drive.result.value);
  console.log("首屏快照：" + JSON.stringify(t0));
  console.log("\n时间轴快照：");
  console.log("  (相对开始切换后的毫秒数)");
  marks.forEach(m => console.log("  " + JSON.stringify(m)));

  /* 判定：不变量是"遮罩关闭 ⇒ 色面已是最新"。
     窗口内"标签已新、色面仍旧、遮罩 flex"是正确状态（旧色面 + 加载提示），不算缺陷。 */
  const staleAll = marks.filter(m => m.tag.indexOf(DATE_A) >= 0 && m.fieldAtC !== last.fieldAtC);
  const maskOffStale = staleAll.filter(m => m.mask === "none");
  const maskOff = marks.filter(m => m.mask === "none");
  const maskOffOk = maskOff.filter(m => m.fieldAtC === last.fieldAtC);
  console.log("\n=== 判定 ===");
  console.log("  最终色面指纹(查询点)      : " + last.fieldAtC + "  缓存日期 " + JSON.stringify(last.cached));
  console.log("  窗口内标签新/色面旧       : " + staleAll.length + " 个采样点（其中遮罩仍开着才算正常）");
  console.log("  遮罩已关闭的采样点        : " + maskOff.length + " 个，色面等于最终值的有 " + maskOffOk.length + " 个");
  console.log("  ★ 遮罩关闭但色面为旧日期  : " + maskOffStale.length + " 个采样点");
  maskOffStale.forEach(function (m) {
    const mk = m.mask || "(空)";
    console.log("      t=" + m.t + "  标签「" + m.tag + "」  色面=" + m.fieldAtC + "  遮罩=" + mk);
  });
  console.log("  " + (maskOffStale.length
    ? "*** 复现成功：存在「无加载提示、且地图画着旧日期」的时间窗 ***"
    : "通过：不存在「遮罩已关但色面仍是旧日期」的时间窗"));
  /* 自守护：连"当前网格中心"都取不到值，说明值场是空的 —— 这时上面所有
     "指纹相等/不等"的比较都在拿 null 互相比较，一律为真，全绿也没有意义。 */
  if (last.fieldAtC == null) {
    console.log("  *** 探针失效：网格中心取不到值（值场为空），本次结论不可信 ***");
  }
  console.log("\n=== 控制台错误 (" + errs.length + ") ===");
  errs.slice(0, 10).forEach(e => console.log("  " + e));

  await cdp.send("Browser.close").catch(() => { });
  chrome.kill(); srv.close();
  process.exit((maskOffStale.length || last.fieldAtC == null) ? 1 : 0);
})().catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
