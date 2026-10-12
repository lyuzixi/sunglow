/* 缩放级别 × 颜色渲染 诊断脚本
   用法: node _check/zoomprobe.js [tag]

   验证两件事：
   ① 缩放不变性：同一个经纬度，在 zoom 4…12 各档读到的【实际渲染像素】必须一致；
   ② 颜色正确性：该像素必须等于「该处值场数值 → **档位色**」算出来的颜色
      （第 8 批起色面是 N_BANDS 档填色，"数值→颜色"不再是单射，所以走 bandColor），
      且该数值必须接近最近城市自身的数值（这一条能抓出栅格错位 / 上下翻转）。

   像素读法走 DOM：projectToContainer 求容器像素 → getBoundingClientRect 定位到具体条带画布
   → getImageData 取色。也就是说，覆盖层位置贴合错了，断言一样会失败。
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
const PORT = 47833;
const TAG = process.argv[2] || "run";

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
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) c.handlers.forEach(h => h(m));
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
function gen(v, lat, lon, h, isAQ) {
  const wave = (a, b) => Math.sin((lat + a) / 6) * Math.sin((lon + b) / 7);
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

const ZOOMS = [4, 5, 6, 7, 8, 10, 12];
/* 取样点。B13 局部化之后这里会被 main 用**当前网格里的点**动态覆盖（见那里的注释）——
   下面这组只是取点失败时的兜底。原先它是硬编码的四个跨省城市（北京/上海/广州/拉萨），
   那是"值场覆盖全国"时代的取样；局部化后它们的像素本来就该是透明的。 */
let REF = [
  ["北京市", 39.9042, 116.4074],
  ["上海市", 31.2304, 121.4737],
  ["广州", 23.1291, 113.2644],
  ["拉萨市", 29.6600, 91.1320]
];

/* 页面内探针：把视口对准某点，等两帧 rAF（覆盖层是按帧重贴的），再读实际像素 */
const PROBE = `(async function(z, lat, lon){
  try { window.__TMAP_SETVIEW(z, lat, lon); } catch(e){ return JSON.stringify({zoom:z, err:'setview'}); }
  await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); });
  var out = { zoom: z };
  var d = null; try { d = mapSet(); } catch(e){}
  if (!d || !d.pts || !d.pts.length) { out.err = 'no-data'; return JSON.stringify(out); }
  var dim = State.mapDim || 'mix';
  var R = scaleRange(d.pts.map(function(o){ return dimValue(o, dim); }));
  var fv = (typeof fieldValue === 'function') ? fieldValue(lat, lon) : null;
  var best = null, bd = 1e9;
  for (var i = 0; i < d.pts.length; i++) {
    var p = d.pts[i], dd = haversineKm(lat, lon, p.lat, p.lon);
    if (dd < bd) { bd = dd; best = p; }
  }
  var own = best ? 100 * scaleT(dimValue(best, dim), R.lo, R.hi) : null;
  var px = (typeof sampleRaster === 'function') ? sampleRaster(lat, lon) : null;
  /* 期望色必须走 bandColor()：分档之后"数值 → 颜色"不再是单射，
     同一个档位区间内的任意数值都该渲染成同一个颜色。 */
  var exp = (fv == null) ? null : hex2rgb(bandColor(d.period, fv));
  out.fv = (fv == null) ? null : +fv.toFixed(1);
  out.own = (own == null) ? null : +own.toFixed(1);
  out.near = best ? best.name : '';
  out.nearKm = Math.round(bd);
  out.px = px;
  out.exp = exp;
  /* 屏幕像素读到的颜色 = 合成阶段对位图重采样的结果。
     fitRaster 只改 CSS scale()，画布位图本身与缩放**无关**（putImageData 是确定的），
     所以只要 scale >= 1（放大）就应该逐像素相等；scale < 1（缩小）则一个屏幕像素
     覆盖多个画布像素，浏览器按面积加权平均 —— 此时"该点应有的颜色"不再是唯一正确值，
     正确期望是整个覆盖块的通道包围盒。这里把块一并取出来，交给 node 侧判定。 */
  out.blk = (function(){
    try{
      var strips = MapMod.strips || []; if (!strips.length) return null;
      var cur = null;
      for (var i2 = 0; i2 < strips.length; i2++) {
        var q = strips[i2];
        if (lat <= q.laTop + 1e-9 && lat >= q.laBot - 1e-9) { cur = q; break; }
      }
      if (!cur) return null;
      /* 不用正则：这段代码在 Node 的模板字符串里，模板串会把反斜杠开头的非法转义
         （如 \s、\( ）里的反斜杠吃掉，正则会静默地永不匹配。用 indexOf 切最稳。 */
      var tf = cur.cv.style.transform || "";
      var sc = null;
      var ip = tf.indexOf("scale(");
      if (ip >= 0) {
        sc = parseFloat(tf.slice(ip + 6).split(")")[0].split(",")[0]);
        if (!(sc > 0)) sc = null;
      }
      var cols = cur.cv.width, h = cur.cv.height;
      var col = Math.floor((lon - cur.loL) / (cur.loR - cur.loL) * cols);
      var row = Math.floor((cur.laTop - lat) / (cur.laTop - cur.laBot) * h);
      /* 一个屏幕像素在画布上覆盖 k×k 个像素：
         - 缩小（scale<1）时是重采样要求，k 至少 1/scale；
         - 任何缩放档下，投影取整都可能让屏幕像素落到**相邻格**上（见下方注释），
           所以 k 至少 3，取的是"以该点为中心的一格邻域"。 */
      var k = (sc && sc > 0) ? Math.max(3, Math.ceil(1 / sc) + 1) : 3;
      var x0 = Math.max(0, col - (k >> 1)), y0 = Math.max(0, row - (k >> 1));
      var w = Math.min(k, cols - x0), hh = Math.min(k, h - y0);
      if (!(w > 0) || !(hh > 0)) return null;
      var d2 = cur.cv.getContext("2d").getImageData(x0, y0, w, hh).data;
      var lo = [255, 255, 255, 255], hi = [0, 0, 0, 0], sum = [0, 0, 0, 0], n = 0;
      for (var j = 0; j < d2.length; j += 4) {
        for (var c2 = 0; c2 < 4; c2++) {
          var v = d2[j + c2];
          if (v < lo[c2]) lo[c2] = v;
          if (v > hi[c2]) hi[c2] = v;
          sum[c2] += v;
        }
        n++;
      }
      var avg = [0, 0, 0, 0];
      for (var c3 = 0; c3 < 4; c3++) avg[c3] = Math.round(sum[c3] / n);
      return { sc: sc, k: k, col: col, row: row, w: w, h: hh, lo: lo, hi: hi, avg: avg };
    } catch (e) { return { err: String(e) }; }
  })();
  out.strips = (MapMod.strips || []).length;
  var lr = document.getElementById('mapRaster');
  out.layerOn = !!(lr && lr.className.indexOf('on') >= 0);
  out.layerCls = lr ? lr.className : '(无)';
  out.cvRect = (function(){ try{ var s=(MapMod.strips||[])[0]; if(!s) return null;
    var r=s.cv.getBoundingClientRect();
    return [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)].join(','); }catch(e){ return 'ERR '+e; } })();
  out.hostRect = (function(){ try{ var h=MapMod.host; if(!h) return null;
    var r=h.getBoundingClientRect();
    return [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)].join(','); }catch(e){ return 'ERR '+e; } })();
  return JSON.stringify(out);
})`;

function colEq(a, b, tol) {
  if (!a || !b) return false;
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
}
const rgbTxt = c => c ? ("rgb(" + c[0] + "," + c[1] + "," + c[2] + ")" + (c[3] != null ? "/a" + c[3] : "")) : "—";

(async function main() {
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "cdpz-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=9334", "--user-data-dir=" + udd,
    "--window-size=1200,900", "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let cerr = ""; chrome.stderr.on("data", d => { cerr += d.toString(); });

  let ver = null;
  for (let i = 0; i < 60; i++) {
    try { ver = await jget("http://127.0.0.1:9334/json/version"); break; } catch (e) { await sleep(500); }
  }
  if (!ver) { console.log("CHROME_START_FAIL\n" + cerr.slice(0, 2000)); process.exit(1); }

  const list = await jget("http://127.0.0.1:9334/json/list");
  const page = list.find(t => t.type === "page");
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);

  const errs = [];
  cdp.on(m => {
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
      errs.push(m.params.args.map(a => a.value || a.description || a.type).join(" ").slice(0, 240));
    else if (m.method === "Runtime.exceptionThrown")
      errs.push("EXCEPTION: " + String(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || "").slice(0, 240));
  });
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
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
      const body = lats.map((la, i) => {
        const lo = lons[i] == null ? 0 : lons[i];
        const times = [];
        for (let h = 0; h < 24; h++) times.push(u.searchParams.get("start_date") + "T" + String(h).padStart(2, "0") + ":00");
        const hourly = { time: times };
        vars.forEach(v => { hourly[v] = times.map((_, h) => gen(v, la, lo, h, isAQ)); });
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
  for (let i = 0; i < 90; i++) {
    await sleep(1500);
    const r = await cdp.send("Runtime.evaluate", {
      expression: `(function(){ try{ var d=mapSet(); return !!(d && d.pts && d.pts.length && MapMod.strips && MapMod.strips.length); }catch(e){ return false; } })()`,
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
  if (!ready) { console.log("数据/值场未就绪，退出"); process.exit(1); }
  await sleep(1200);

  /* 值场重建耗时 + 分段拆解（不随缩放变化，只在切换日期/时段/模型/维度时发生）。
     每段都连跑多次取最小值：单次样本会被 GC（18 MB 几何分配）与调度抖动带偏，
     最小值才是这段代码的"真实成本"。 */
  const perf = await cdp.send("Runtime.evaluate", {
    expression: `(function(){
      function minOf(n, fn){ var best = 1e9; for (var k = 0; k < n; k++) {
        var a = performance.now(); fn(); var b = performance.now(); if (b - a < best) best = b - a; } return best; }
      var d = mapSet();
      var dim = State.mapDim || 'mix', mk = State.mapModel || 'ens';
      var R = scaleRange(d.pts.map(function(o){ return dimOf(o, dim, mk); }));
      /* ① 全流程 paintMap（含取值 + 条带 + 贴合） */
      var paintMs = minOf(3, function(){ paintMap(); });
      var f = MapMod.field;
      var f2 = buildField(d.pts, dim, mk, R, d.period);
      /* ② 取值层热路径（命中几何缓存）—— 切模型/切维度真正走的路径 */
      var buildFieldMs = minOf(5, function(){ buildField(d.pts, dim, mk, R, d.period); });
      var stripsMs = minOf(3, function(){ buildStrips(f2); });
      var fitMs = minOf(3, function(){ fitRaster(); });
      /* ③ 模拟"新建 canvas + 只更新像素"的代价（取前 30 行做样本再折算），
            用来对照 P2 复用 canvas 的收益上限 */
      var rowsSample = Math.min(30, f2.rows);
      var putAll = minOf(3, function(){
        var cv = document.createElement('canvas'); cv.width = f2.cols; cv.height = rowsSample;
        var ex = cv.getContext('2d'); var id = ex.createImageData(f2.cols, rowsSample);
        id.data.set(f2.img.subarray(0, f2.cols * rowsSample * 4)); ex.putImageData(id, 0, 0);
      }) * (f2.rows / rowsSample);
      /* ④ 几何层冷路径（含 CSR 分配）—— 只在参与插值的点集合变化时才走 */
      var okA = new Uint8Array(d.pts.length), ccn = 0, q;
      for (q = 0; q < d.pts.length; q++) if (isNum(dimOf(d.pts[q], dim, mk))) { okA[q] = 1; ccn++; }
      var gA = buildGeom(d.pts, okA);
      var buildGeomMs = minOf(2, function(){ gA = buildGeom(d.pts, okA); });
      var cvA = new Float64Array(d.pts.length);
      for (q = 0; q < d.pts.length; q++) if (okA[q]) cvA[q] = 100 * scaleT(dimOf(d.pts[q], dim, mk), R.lo, R.hi);
      var lutA = new Uint8Array(N_BANDS * 3);
      for (q = 0; q < N_BANDS; q++) { var cx = hex2rgb(rampColor(d.period, (q + 0.5) / N_BANDS * 100));
        lutA[q*3] = cx[0]; lutA[q*3+1] = cx[1]; lutA[q*3+2] = cx[2]; }
      var evalMs = minOf(6, function(){ evalField(gA, cvA, lutA); });
      /* 每行平均候选城市数：决定内层循环规模 */
      var win = FIELD_REACH_KM / 110.574 + 0.15, cand = 0;
      for (var r = 0; r < f2.rows; r++) {
        var la = f2.laN - r * f2.dLa;
        for (var i = 0; i < d.pts.length; i++) if (Math.abs(la - d.pts[i].lat) <= win) cand++;
      }
      /* 上面的 buildStrips 会清空并重建覆盖层画布，此时 MapMod.strips 指向的可能是
         已被移除的旧画布（detached），getBoundingClientRect() 会恒为 0。
         再 paintMap() 一次让 DOM 与 MapMod.strips 重新一致，否则后续像素采样全部读空。 */
      paintMap();
      return JSON.stringify({
        paintMs: +paintMs.toFixed(1),
        buildFieldMs: +buildFieldMs.toFixed(1),
        buildGeomMs: +buildGeomMs.toFixed(1),
        evalFieldMs: +evalMs.toFixed(1),
        buildStripsMs: +stripsMs.toFixed(1),
        fitRasterMs: +fitMs.toFixed(1),
        putImageDataAllMs: +putAll.toFixed(1),
        cols: f2.cols, rows: f2.rows, strips: MapMod.strips.length, pts: d.pts.length,
        avgCandPerRow: +(cand / f2.rows).toFixed(1),
        csrPairs: gA.topA.length, dlCells: gA.dlT.length,
        segs: gA.segOff.length - 1, segCandN: gA.segCand.length,
        /* 几何层实际驻留内存：Float64 的 topA/topB/dlT + Float32 的 aMin +
           Int16 的 exact + Int32 的 cellSeg/segCand/segOff + Uint8 的 land */
        geomMB: +(((gA.topA.length + gA.topB.length + gA.dlT.length) * 8 +
          gA.aMin.length * 4 + gA.exact.length * 2 +
          (gA.cellSeg.length + gA.segCand.length + gA.segOff.length) * 4 +
          (gA.land ? gA.land.length : 0)) / 1048576).toFixed(2),
        okCount: ccn, geomBuilt: GEOM_CACHE.built, geomReused: GEOM_CACHE.reused
      });
    })()`, returnByValue: true
  });
  console.log("值场重建： " + perf.result.value);

  /* ---- 值场等价性（双重差分）----
     第 8 批（视觉改造）把色面边界从"到最近采样点的距离"换成了"采样点凸包"，
     并把连续色阶换成 N_BANDS 档填色。**这是一次有意的语义变更**，所以不能拿
     改造前的实现当基准（差异数无法解读）。这里用的是记忆里那条方法论：
       ① 一把**冻结**的旧实现 refField（当时的常量写死成字面量，不跟着页面变）；
       ② 一份**结构完全独立**的第三方实现 refThird，带两个正交开关
          （旧/新边界语义 × 是否启用 D2 高程分段）；
       ③ 双重差分：refThird(旧语义) vs refField → 0 ⇒ 尺子可信；
                   buildField      vs refThird(新语义) → 0 ⇒ 新实现正确；
                   refThird(新,分段) vs refThird(新,不分段) → 单独量化 D2 的覆盖面。
     全程逐格比对 vals 与 img：完全相等，不容任何容差。 */
  const equiv = await cdp.send("Runtime.evaluate", {
    expression: `(function(){
      /* ↓↓↓ refField：改造前 buildField 的原样复制，仅去掉注释。
         它用的常量（FIELD_STEP=0.1 / FIELD_RANGE=240 / FIELD_FULL=75 /
         FIELD_BLUR=8 / FIELD_OPACITY=0.82）现在已经从页面里删掉了，所以这里
         写成**字面量** —— 一把尺子就该被冻结，不该跟着被测代码一起漂移。
         （数值取自 _backup/第七批后/_p6.js 的常量块。） ↓↓↓ */
      function refField(pts, dim, mk, R, mode) {
        var OLD_STEP = 0.1, OLD_RANGE = 240, OLD_FULL = 75, OLD_BLUR = 8, OLD_OP = 0.82;
        var src = pts.filter(function(p){ return isNum(dimOf(p, dim, mk)); });
        if (src.length < 1) return null;
        var laMin=90, laMax=-90, loMin=180, loMax=-180;
        src.forEach(function(p){ laMin=Math.min(laMin,p.lat); laMax=Math.max(laMax,p.lat);
          loMin=Math.min(loMin,p.lon); loMax=Math.max(loMax,p.lon); });
        var mLa=OLD_RANGE/110.574;
        var mLo=OLD_RANGE/(111.32*Math.max(0.15, Math.cos(laMax*Math.PI/180)));
        var laN=laMax+mLa, laS=laMin-mLa, loW=loMin-mLo, loE=loMax+mLo;
        var dLa=OLD_STEP, dLo=OLD_STEP;
        var rows=Math.max(2, Math.round((laN-laS)/dLa)+1);
        var cols=Math.max(2, Math.round((loE-loW)/dLo)+1);
        var n=src.length;
        var cla=new Float64Array(n), clo=new Float64Array(n), ccos=new Float64Array(n), cv=new Float64Array(n);
        for (var i=0;i<n;i++){ var p=src[i];
          cla[i]=p.lat; clo[i]=p.lon; ccos[i]=Math.cos(p.lat*Math.PI/180);
          cv[i]=100*scaleT(dimOf(p,dim,mk), R.lo, R.hi); }
        var lut=new Uint8Array(256*3);
        for (var i2=0;i2<256;i2++){ var cc=hex2rgb(rampColor(mode, i2/255*100));
          lut[i2*3]=cc[0]; lut[i2*3+1]=cc[1]; lut[i2*3+2]=cc[2]; }
        var D2R=Math.PI/180, aCut=Math.pow(OLD_RANGE/6371.0088,2);
        var win=OLD_RANGE/110.574+0.15;
        var img=new Uint8ClampedArray(cols*rows*4), vals=new Float32Array(cols*rows), mask=new Float32Array(cols*rows);
        vals.fill(NaN);
        for (var r=0;r<rows;r++){
          var la=laN-r*dLa, cosLa=Math.cos(la*D2R);
          for (var c=0;c<cols;c++){
            var lo=loW+c*dLo, sw=0, sv=0, aMin=1e9, exact=-1;
            for (var i3=0;i3<n;i3++){
              var dy=la-cla[i3];
              if (dy>win||dy<-win) continue;
              var dr=dy*D2R, dl=(lo-clo[i3])*D2R;
              var a=dr*dr+cosLa*ccos[i3]*dl*dl;
              if (a<aMin) aMin=a;
              if (a<1e-9){ exact=i3; break; }
              var w=1/a; sw+=w; sv+=w*cv[i3];
            }
            if (aMin>aCut) continue;
            var v=exact>=0?cv[exact]:(sw>0?sv/sw:cv[0]);
            var o=r*cols+c; vals[o]=v;
            var k=Math.round(clamp(v,0,100)/100*255), q=o*4;
            img[q]=lut[k*3]; img[q+1]=lut[k*3+1]; img[q+2]=lut[k*3+2];
            var dKm=Math.sqrt(aMin)*6371.0088;
            var al=(OLD_RANGE-dKm)/(OLD_RANGE-OLD_FULL);
            if (al>1) al=1; else if (al<0) al=0;
            mask[o]=al*al*(3-2*al);
          }
        }
        boxBlur(mask, cols, rows, OLD_BLUR);
        for (var o2=0;o2<mask.length;o2++){
          var aa=isNum(vals[o2])?mask[o2]:0;
          img[o2*4+3]= aa>0.004 ? Math.round(255*Math.min(1,aa)*OLD_OP) : 0;
        }
        return { cols:cols, rows:rows, vals:vals, img:img };
      }

      /* ↓↓↓ refThird：**结构完全独立**的第三方参考实现 ↓↓↓
         与 refField 的区别不是"新旧"，而是**数据组织方式**：refThird 不碰新实现的任何字段
         （topA/topB/dlT/cellSeg/segOff/segCand/aMin/exact/hud/hx 一个都不用），
         自己按行重算候选、自己按高程切段、自己用朴素双循环算距离、自己求凸包。
         它读的输入只有 pts（原始城市表）、ELEV（原始高程网格）和 elevAt()（公开插值函数）。

         两个开关正交：
           useElev = false/true   是否启用 D2 高程分段
           useNew  = false/true   边界语义
             false = 旧的「到最近采样点 FIELD_RANGE 截断 + 256 档连续色阶」
             true  = 新的「采样点凸包 + FIELD_OUT_KM 羽化 + N_BANDS 档填色」
         于是三条比对构成完整的双重差分：
           ① refThird(旧语义) vs refField             → 0 ⇒ 这把尺子忠实复现了改造前的实现
           ② buildField       vs refThird(新语义)     → 0 ⇒ 新实现正确
           ③ refThird(新,有分段) vs refThird(新,无分段) → 单独量化 D2 的覆盖面

         浮点纪律：只有**数据组织**不同，算式必须与实现逐字相同（含结合顺序），
         否则"逐位相等"是不可能达成的。几处易错点已在代码里标注。 */
      function refThird(pts, dim, mk, R, mode, useNew, useElev) {
        var STEP  = useNew ? FIELD_STEP    : 0.1;
        var BLUR  = useNew ? FIELD_BLUR    : 8;
        var OP    = useNew ? FIELD_OPACITY : 0.82;
        var OUT   = useNew ? FIELD_OUT_KM  : 240;     // 栅格外扩＝边界半径
        var REACH = useNew ? FIELD_REACH_KM: 240;     // 候选搜索半径
        var OLD_FULL = 75;                            // 仅旧语义用到
        var n = pts.length;
        var ok = new Uint8Array(n), cnt = 0;
        for (var ia=0; ia<n; ia++) if (isNum(dimOf(pts[ia],dim,mk))) { ok[ia]=1; cnt++; }
        if (!cnt) return null;
        var laMin=90, laMax=-90, loMin=180, loMax=-180;
        for (var ib=0; ib<n; ib++){ if(!ok[ib]) continue; var pb=pts[ib];
          if(pb.lat<laMin)laMin=pb.lat; if(pb.lat>laMax)laMax=pb.lat;
          if(pb.lon<loMin)loMin=pb.lon; if(pb.lon>loMax)loMax=pb.lon; }
        var mLa=OUT/110.574;
        var mLo=OUT/(111.32*Math.max(0.15, Math.cos(laMax*Math.PI/180)));
        var laN=laMax+mLa, laS=laMin-mLa, loW=loMin-mLo, loE=loMax+mLo;
        var dLa=STEP, dLo=STEP;
        var rows=Math.max(2, Math.round((laN-laS)/dLa)+1);
        var cols=Math.max(2, Math.round((loE-loW)/dLo)+1);
        var D2R=Math.PI/180;
        var win=REACH/110.574+0.15, aCut=Math.pow(REACH/6371.0088,2);
        var ccos=new Float64Array(n), cv=new Float64Array(n);
        for (var ic=0; ic<n; ic++){ ccos[ic]=Math.cos(pts[ic].lat*D2R);
          cv[ic]= ok[ic] ? 100*scaleT(dimOf(pts[ic],dim,mk), R.lo, R.hi) : 0; }
        /* 色阶查表：新语义 N_BANDS 档（取档中点色），旧语义 256 档连续 */
        var NL = useNew ? N_BANDS : 256;
        var lut=new Uint8Array(NL*3);
        for (var id=0; id<NL; id++){ var ccd=hex2rgb(rampColor(mode, useNew ? (id+0.5)/NL*100 : id/255*100));
          lut[id*3]=ccd[0]; lut[id*3+1]=ccd[1]; lut[id*3+2]=ccd[2]; }
        /* 数值 → 查表下标。必须与 bandOf()（新）/ Math.round(…/100*255)（旧）逐位同义 */
        function pick(v){
          var c0 = v<0 ? 0 : (v>100 ? 100 : v);
          if (useNew){ var k0=Math.floor(c0/100*NL); return k0<0?0:(k0>NL-1?NL-1:k0); }
          return Math.round(c0/100*255);
        }
        /* 凸包：只存**顶点表**（实现存的是半平面系数表 —— 另一种数据组织）。
           顶点序可能与实现不同，但半平面距离取的是 max：max 与次序无关、对浮点无损，
           所以只要顶点集合与算式一致，结果就与 buildGeom 逐位相同。 */
        var HV=null, OLAT=0, OLON=0, KX=0;
        if (useNew) {
          var sLat=0, sLon=0, mm=0;
          for (var i0=0;i0<n;i0++) if(ok[i0]){ sLat+=pts[i0].lat; sLon+=pts[i0].lon; mm++; }
          if (mm>=3){
            OLAT=sLat/mm; OLON=sLon/mm;
            KX=111.32*Math.max(0.15, Math.cos(OLAT*Math.PI/180));
            var PP=[];
            for (var i1=0;i1<n;i1++) if(ok[i1])
              PP.push({x:(pts[i1].lon-OLON)*KX, y:(pts[i1].lat-OLAT)*110.574});
            PP.sort(function(a,b){ return a.x-b.x || a.y-b.y; });
            var cr=function(o,a,b){ return (a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x); };
            var low=[], up=[], jj;
            for (jj=0;jj<PP.length;jj++){
              while(low.length>=2 && cr(low[low.length-2],low[low.length-1],PP[jj])<=0) low.pop();
              low.push(PP[jj]); }
            for (jj=PP.length-1;jj>=0;jj--){
              while(up.length>=2 && cr(up[up.length-2],up[up.length-1],PP[jj])<=0) up.pop();
              up.push(PP[jj]); }
            HV = low.slice(0,-1).concat(up.slice(0,-1));
            if (HV.length<3) HV=null;
          }
        }
        var hPt=new Float64Array(n);
        for (var ie=0; ie<n; ie++) hPt[ie]=elevAt(pts[ie].lat, pts[ie].lon);
        var fallback=-1; for (var ifx=0; ifx<n; ifx++) if(ok[ifx]){ fallback=ifx; break; }
        var fb=cv[fallback];
        var img=new Uint8ClampedArray(cols*rows*4), vals=new Float32Array(cols*rows), mask=new Float32Array(cols*rows);
        vals.fill(NaN);
        var rowC=[], hRow=new Array(cols);
        for (var r=0; r<rows; r++){
          var la=laN-r*dLa, cosLa=Math.cos(la*D2R);
          /* 该行的投影 Y（公里），与 evalField 的 ((g.laN - r*g.dLa) - olat)*110.574 同式 */
          var Yc = HV ? (la - OLAT)*110.574 : 0;
          /* 行候选：纬度窗口筛一次，按原 pts 下标升序 */
          rowC.length=0;
          for (var ig=0; ig<n; ig++){
            if(!ok[ig]) continue;
            var dyg=la-pts[ig].lat;
            if(dyg>win||dyg<-win) continue;
            rowC.push(ig);
          }
          for (var ih=0; ih<cols; ih++) hRow[ih]= (useElev && ELEV) ? elevAt(la, loW+ih*dLo) : NaN;
          /* 切段 + 逐列取值，段内候选就地构造（不落任何全局结构） */
          var c0=0;
          while (c0<cols){
            var c1=c0;
            if (useElev && ELEV && isNum(hRow[c0])){
              var h0=hRow[c0];
              while (c1+1<cols && isNum(hRow[c1+1]) && Math.abs(hRow[c1+1]-h0)<FIELD_HTOL) c1++;
            } else c1=cols-1;
            var hMid=(useElev && ELEV && isNum(hRow[c0])) ? hRow[(c0+c1)>>1] : NaN;
            var cands=[];
            if (isNum(hMid)){
              var rest=[];
              for (var ii=0; ii<rowC.length; ii++){
                var ix=rowC[ii], dhx=Math.abs(hPt[ix]-hMid);
                if (dhx<=FIELD_HTOL) cands.push(ix); else rest.push({i:ix, dh:dhx});
              }
              if (cands.length<FIELD_HMIN){
                rest.sort(function(x,y){ return x.dh-y.dh || x.i-y.i; });
                for (var iy=0; iy<rest.length && cands.length<FIELD_HMIN; iy++) cands.push(rest[iy].i);
                cands.sort(function(x,y){ return x-y; });   // 补足后重排回下标升序
              }
            } else {
              for (var iz=0; iz<rowC.length; iz++) cands.push(rowC[iz]);
            }
            for (var c2=c0; c2<=c1; c2++){
              var lo2=loW+c2*dLo;
              /* 新语义：先判凸包（包外太远直接跳过，与 evalField 的 continue 同义） */
              var sd=0;
              if (HV){
                var Xc=(lo2-OLON)*KX;
                sd=-1e9;
                for (var hv=0; hv<HV.length; hv++){
                  var ea=HV[hv], eb=HV[(hv+1)%HV.length];
                  var ex2=eb.x-ea.x, ey2=eb.y-ea.y;
                  var EL=Math.hypot(ex2,ey2) || 1;
                  var enx=ey2/EL, eny=-ex2/EL;
                  var edd=enx*Xc + eny*Yc + (-(enx*ea.x + eny*ea.y));
                  if (edd>sd) sd=edd;
                }
                if (sd>FIELD_OUT_KM) continue;
              }
              var sw=0, sv=0, aMin=1e9, exact=-1;
              for (var j=0; j<cands.length; j++){
                var ij=cands[j];
                var dy2=la-pts[ij].lat;
                var dr=dy2*D2R, dl=(lo2-pts[ij].lon)*D2R;
                /* 与 buildGeom 同构：b0=cosLa·ccos，再 (b0·dl)·dl。
                   乘法可交换 ⇒ ccos*cosLa 与 cosLa*ccos 逐位相同；
                   左结合的 * 链必须照抄 —— 写成 b0*(dl*dl) 就换了一种结合方式。 */
                var b0=cosLa*ccos[ij];
                var a=dr*dr + b0*dl*dl;
                if(a<aMin) aMin=a;
                if(a<1e-9 && exact<0) exact=ij;
                var w=1/a; sw+=w; sv+=w*cv[ij];
              }
              if (!HV && aMin>aCut) continue;                 // 旧语义的截断判据
              var o=r*cols+c2;
              var v= exact>=0 ? cv[exact] : (sw>0?sv/sw:fb);
              vals[o]=v;
              var kk=pick(v), q=o*4;
              img[q]=lut[kk*3]; img[q+1]=lut[kk*3+1]; img[q+2]=lut[kk*3+2];
              var al;
              if (HV){
                al=(FIELD_OUT_KM-sd)/FIELD_OUT_KM;
                if(al>1)al=1; else if(al<0)al=0;
              } else {
                var dKm=Math.sqrt(aMin)*6371.0088;
                al=(REACH-dKm)/(REACH-OLD_FULL);
                if(al>1)al=1; else if(al<0)al=0;
              }
              mask[o]=al*al*(3-2*al);
            }
            c0=c1+1;
          }
        }
        boxBlur(mask, cols, rows, BLUR);
        for (var oo=0; oo<mask.length; oo++){
          var aa=isNum(vals[oo])?mask[oo]:0;
          img[oo*4+3]= aa>0.004 ? Math.round(255*Math.min(1,aa)*OP) : 0;
        }
        return { cols:cols, rows:rows, vals:vals, img:img };
      }

      /* 逐格比对两个 field 的 vals / RGB。
         vals 的差异再细分三类，用来回答"这套语义有没有把某片区域打成空洞"：
           toNaN   A 有值、B 无值  （B 相对 A 少掉的覆盖）
           fromNaN A 无值、B 有值  （B 相对 A 多出的覆盖）
           dv      两边都有值但数值不同
         bV = toNaN + fromNaN + dv，与"逐位不同"的定义严格一致。
         geo 传入 {cols,laN,loW,dLa,dLo} 时，额外把 toNaN 格点按 5°×5° 分块统计，
         用来判断丢覆盖是"集中在高原腹地"还是"碎成斑块"。 */
      function cmpField(A, B, geo){
        if(!A||!B) return { null:1 };
        var shape=(A.cols===B.cols && A.rows===B.rows);
        /* 栅格分辨率从 0.1° 改成 0.05° 之后，"新 vs 旧"两版的行列数本来就不同，
           再按下标逐格比对毫无意义（下标指向的不是同一个地理位置）。直接返回，
           由调用方按 !shape 处理 —— 三处**必须**同形的比对（尺子自检 / 主断言 /
           D2 覆盖面）在形状不一致时会因此判失败，正是我们想要的。 */
        if(!shape) return { shape:false, cells:A.vals.length };
        var bV=0,bR=0,bA=0,maxV=0,toNaN=0,fromNaN=0,dv=0,p,q;
        var boxes={}, cnBoxes={}, cnLose=0, osLose=0, cnKeep=0, osKeep=0;
        for(p=0;p<A.vals.length;p++){
          var x=A.vals[p], y=B.vals[p];
          var xn=(x!==x), yn=(y!==y);
          if((xn&&yn) || (!xn&&!yn&&x===y)) continue;       // 两边同为 NaN、或同值 → 不算差异
          bV++;
          if(xn){
            fromNaN++;
            /* B 有值、A 无值 —— 即 A 相对 B 丢失的覆盖，也是地图上的潜在空洞。
               按海陆掩膜区分境内/境外：境内丢覆盖才是真问题，境外丢覆盖是"纠正错误外推"。 */
            var isCN = (geo && geo.land) ? (geo.land[p] ? 1 : 0) : -1;
            if(isCN===1) cnLose++; else if(isCN===0) osLose++;
            if(geo){
              var rr=Math.floor(p/geo.cols), cc=p%geo.cols;
              var la=geo.laN-rr*geo.dLa, lo=geo.loW+cc*geo.dLo;
              var bk=(Math.floor(la/5)*5)+"N,"+(Math.floor(lo/5)*5)+"E";
              if(isCN===1) cnBoxes[bk]=(cnBoxes[bk]||0)+1;
              else boxes[bk]=(boxes[bk]||0)+1;
            }
          }
          else if(yn){ toNaN++; }
          else { dv++; var dd=Math.abs(x-y); if(dd>maxV) maxV=dd; }
        }
        for(p=0;p<A.vals.length;p++){ q=p*4;
          if(A.img[q]!==B.img[q]||A.img[q+1]!==B.img[q+1]||A.img[q+2]!==B.img[q+2]) bR++;
          if(A.img[q+3]!==B.img[q+3]) bA++; }
        for(p=0;p<A.vals.length;p++){
          if(A.vals[p]!==A.vals[p]) continue;
          if(geo && geo.land) { if(geo.land[p]) cnKeep++; else osKeep++; }
        }
        var top=Object.keys(boxes).map(function(k){return [k,boxes[k]];})
          .sort(function(a,b){return b[1]-a[1];}).slice(0,6);
        var cnTop=Object.keys(cnBoxes).map(function(k){return [k,cnBoxes[k]];})
          .sort(function(a,b){return b[1]-a[1];}).slice(0,8);
        return { shape:shape, bV:bV, bR:bR, bA:bA, maxV:+maxV.toFixed(6),
          toNaN:toNaN, fromNaN:fromNaN, dv:dv, cells:A.vals.length, top:top, cnTop:cnTop,
          cnLose:cnLose, osLose:osLose, cnKeep:cnKeep, osKeep:osKeep };
      }

      var d = mapSet();
      var DIMS=['p','q','mix'], MKS=['ens','gfs','ec','rt'];
      var out={ n:0, bad:0, selfBad:0, cases:[], reference:[], err:null,
        geomBuilt:0, geomReused:0, elevUsed:0 };
      out.elevUsed = (typeof ELEV !== 'undefined' && ELEV) ? 1 : 0;
      try {
        for (var a2=0;a2<DIMS.length;a2++) for (var b2=0;b2<MKS.length;b2++){
          var dim=DIMS[a2], mk=MKS[b2];
          var vv=d.pts.map(function(o){ return dimOf(o,dim,mk); }).filter(isNum);
          if (!vv.length){ out.cases.push(dim+'/'+mk+' → 本期无数据（跳过）'); continue; }
          var R=scaleRange(vv);
          var nf   = buildField(d.pts, dim, mk, R, d.period);                  // 新实现
          var of   = refField(d.pts, dim, mk, R, d.period);                    // 旧实现（冻结）
          var tOld = refThird(d.pts, dim, mk, R, d.period, false, false);      // 第三方 · 旧语义
          var tNew = refThird(d.pts, dim, mk, R, d.period, true,  true);       // 第三方 · 新语义
          var tNoE = refThird(d.pts, dim, mk, R, d.period, true,  false);      // 第三方 · 新语义但不分段
          out.n++;
          if(!nf||!of||!tOld||!tNew||!tNoE){ out.bad++; out.cases.push(dim+'/'+mk+' → 有实现返回 null'); continue; }
          var geo = { cols:nf.cols, laN:nf.laN, loW:nf.loW, dLa:nf.dLa, dLo:nf.dLo,
            land:(GEOM_CACHE.geom && GEOM_CACHE.geom.land) || null };
          var cSelf = cmpField(tOld, of);          // ① 尺子自检
          var cMain = cmpField(tNew, nf);          // ② 主断言
          var cElev = cmpField(tNew, tNoE, geo);   // ③ D2 覆盖面（同一栅格，只差高程分段）
          if(cSelf.null||!cSelf.shape||cSelf.bV||cSelf.bR) out.selfBad++;
          if(cMain.null||!cMain.shape||cMain.bV||cMain.bR) out.bad++;
          out.reference.push({ dim:dim, mk:mk, cells:cMain.cells,
            refVals:cElev.bV, refRGB:cElev.bR, refMaxV:cElev.maxV,
            gain:cElev.toNaN, lose:cElev.fromNaN, changed:cElev.dv,
            cnLose:cElev.cnLose, osLose:cElev.osLose,
            cnKeep:cElev.cnKeep, osKeep:cElev.osKeep,
            loseTop:cElev.top, cnTop:cElev.cnTop, alphaDiff:cMain.bA });
          out.cases.push(dim+'/'+mk+
            '  自检(旧语义) vals '+cSelf.bV+' RGB '+cSelf.bR+' |'+
            ' 主断言(新语义) vals '+cMain.bV+' RGB '+cMain.bR+' |'+
            ' alpha '+cMain.bA+'（海陆掩膜所致，不计入断言） | '+cMain.cells+' 格');
        }
        /* 快照取 mix/ens 这一组：它同时含三模型，代表性最强 */
        var vv0=d.pts.map(function(o){ return dimOf(o,'mix','ens'); }).filter(isNum);
        var R0=scaleRange(vv0);
        var nf0=buildField(d.pts,'mix','ens',R0,d.period);
        var of0=refField(d.pts,'mix','ens',R0,d.period);
        /* 差异图必须两侧同栅格：新的 0.05° 与旧的 0.1° 行列数不同，
           逐格相减是没意义的。所以 diff 用「新语义·有分段」对「新语义·无分段」，
           量的是**高程分段**的覆盖面（与主断言同源）。 */
        var dA=refThird(d.pts,'mix','ens',R0,d.period,true,true);
        var dB=refThird(d.pts,'mix','ens',R0,d.period,true,false);
        out.geomBuilt = GEOM_CACHE.built; out.geomReused = GEOM_CACHE.reused;
        /* D2 到底有没有可能生效？量化它的**触发条件**：
           · 采样点高程的跨度；
           · 每一行内 elevAt 的极差最大值（只有超过 FIELD_HTOL 才会切段）。
           两者都不超过阈值 ⇒ 这套数据里高程筛选一次都没触发，
           "覆盖面 0 格"就是**如实**的 0，而不是漏测 —— 这条信息必须打出来，
           否则一个恒为 0 的段落会让人误以为断言被架空了。 */
        try {
          if (typeof ELEV === 'undefined' || !ELEV || !nf0) { out.elevStats = { elev: 0 }; }
          else {
            var hp = d.pts.map(function(p){ return elevAt(p.lat, p.lon); });
            var hmin = Math.min.apply(null, hp), hmax = Math.max.apply(null, hp);
            var spread = 0, r;
            for (r = 0; r < nf0.rows; r++) {
              var la = nf0.laN - r * nf0.dLa, lo = 1e9, hi = -1e9, c;
              for (c = 0; c < nf0.cols; c++) {
                var hi2 = elevAt(la, nf0.loW + c * nf0.dLo);
                if (!isNum(hi2)) continue;
                if (hi2 < lo) lo = hi2; if (hi2 > hi) hi = hi2;
              }
              if (hi > -1e8 && (hi - lo) > spread) spread = hi - lo;
            }
            out.elevStats = { ptMin: Math.round(hmin), ptMax: Math.round(hmax),
              ptSpan: Math.round(hmax - hmin), rowSpreadMax: Math.round(spread), htol: FIELD_HTOL };
          }
        } catch (e) { out.elevStats = { err: String(e) }; }
      } catch(e){ out.err = String(e && e.stack || e); }
      /* 值场快照：新旧两版的值场分别渲染成 PNG（各自一份，尺寸不必相同），
         差异图用来目视确认高程分段的"丢覆盖"是"收在极端地形带的一圈"还是"连片破洞"。
         差异图配色：白=两版都无值 / 浅灰=都同值 / 黄=数值改变 / 红=丢失覆盖 / 绿=新增覆盖。 */
      function pngOf(f, mode){
        var cv=document.createElement('canvas'); cv.width=f.cols; cv.height=f.rows;
        var ctx=cv.getContext('2d');
        var id=ctx.createImageData(f.cols,f.rows);
        if(mode==='img'){ id.data.set(f.img); }
        else {
          for(var i=0;i<f.vals.length;i++){
            var v=f.vals[i], q=i*4;
            if(v!==v){ id.data[q]=255; id.data[q+1]=255; id.data[q+2]=255; id.data[q+3]=255; }
            else { var g=Math.max(0,Math.min(255,Math.round(255-v/100*255)));
              id.data[q]=g; id.data[q+1]=g; id.data[q+2]=g; id.data[q+3]=255; }
          }
        }
        ctx.putImageData(id,0,0);
        return cv.toDataURL('image/png');
      }
      function pngDiff(A,B){
        var cv=document.createElement('canvas'); cv.width=A.cols; cv.height=A.rows;
        var ctx=cv.getContext('2d');
        var id=ctx.createImageData(A.cols,A.rows);
        for(var i=0;i<A.vals.length;i++){
          var x=A.vals[i], y=B.vals[i], q=i*4;
          var xn=(x!==x), yn=(y!==y);
          var r,g2,b;
          if(xn&&yn){ r=255;g2=255;b=255; }
          else if(xn){ r=200;g2=30;b=30; }          // A 无值、B 有值
          else if(yn){ r=30;g2=180;b=60; }          // A 有值、B 无值
          else if(x!==y){ r=255;g2=200;b=0; }       // 数值改变
          else { r=215;g2=215;b=215; }
          id.data[q]=r; id.data[q+1]=g2; id.data[q+2]=b; id.data[q+3]=255;
        }
        ctx.putImageData(id,0,0);
        return cv.toDataURL('image/png');
      }
      out.snap = {
        newImg: pngOf(nf0, 'img'), oldImg: pngOf(of0, 'img'),
        newVal: pngOf(nf0, 'val'), oldVal: pngOf(of0, 'val'),
        diff:   pngDiff(dA, dB)
      };
      return JSON.stringify(out);
    })()`, returnByValue: true
  });
  let EQ = {};
  try { EQ = JSON.parse(equiv.result.value); } catch (e) { EQ = { err: "解析失败 " + e }; }
  console.log("\n===== 值场等价性（双重差分，0 容差）=====");
  console.log("  高程网格注入: " + (EQ.elevUsed ? "是（D2 高程分段生效）" : "否（ELEV=null，退化为整行单段）"));
  if (EQ.err) console.log("  执行异常: " + EQ.err);
  (EQ.cases || []).forEach(c => console.log("  " + c));
  console.log("  比对组合 " + EQ.n + " 组");
  console.log("  · ① 尺子自检 refThird(旧语义) vs refField      → 不一致 " + EQ.selfBad + " 组（必须 0）");
  console.log("  · ② 主断言   buildField vs refThird(新语义)   → 不一致 " + EQ.bad + " 组（必须 0）");
  console.log("  几何构建次数 " + EQ.geomBuilt + " / 复用次数 " + EQ.geomReused);
  /* D2 的触发条件：说明"覆盖面 0 格"是如实的 0 还是漏测。 */
  if (EQ.elevStats) {
    const e = EQ.elevStats;
    if (e.err) console.log("  D2 触发条件量测失败：" + e.err);
    else if (e.elev === 0) console.log("  D2 触发条件：高程网格不可用（ELEV=null）⇒ 全程退化为整行单段");
    else {
      const trig = (e.ptSpan > e.htol) || (e.rowSpreadMax >= e.htol);
      console.log("  D2 触发条件：采样点高程 " + e.ptMin + "–" + e.ptMax + " m（跨度 " + e.ptSpan +
        "）· 单行高程极差最大 " + e.rowSpreadMax + " m · 阈值 FIELD_HTOL=" + e.htol +
        (trig ? "  ⇒ 本批数据会触发分段" : "  ⇒ 都没超过阈值，本批数据**不触发**分段（故上面全是 0 格，属如实结果）"));
    }
  }
  /* D2（高程分段）的**覆盖面**审计：确认它改的是"数值"而不是"有无"。
     若 lose（分段后无值、不分段有值）成片出现，说明高原被插值半径放空、地图会破洞 —— 那是缺陷。
     这一组比对两侧用的是**同一个栅格**（都走新语义），所以差异只可能来自高程分段本身。 */
  if ((EQ.reference || []).length) {
    const r0 = EQ.reference[0];
    console.log("  【D2 高程分段覆盖面】以 " + r0.dim + "/" + r0.mk + " 为例（共 " + r0.cells + " 格）：" +
      "数值改变 " + r0.changed + " 格 · 新增覆盖 " + r0.gain + " 格 · 丢失覆盖 " + r0.lose + " 格" +
      " · 最大数值变化 " + r0.refMaxV + " 分");
    const L = EQ.reference.map(r => r.lose), G = EQ.reference.map(r => r.gain),
      C = EQ.reference.map(r => r.changed), X = EQ.reference.map(r => r.refMaxV);
    console.log("  全部 " + EQ.reference.length + " 组：数值改变 " + Math.min(...C) + "–" + Math.max(...C) +
      " 格 · 新增覆盖 " + Math.min(...G) + "–" + Math.max(...G) +
      " 格 · 丢失覆盖 " + Math.min(...L) + "–" + Math.max(...L) +
      " 格 · 最大数值变化 " + Math.min(...X) + "–" + Math.max(...X) + " 分");
    const CL = EQ.reference.map(r => r.cnLose), OL = EQ.reference.map(r => r.osLose),
      CK = EQ.reference.map(r => r.cnKeep), OK = EQ.reference.map(r => r.osKeep);
    console.log("  丢失覆盖按海陆拆解：境内 " + Math.min(...CL) + "–" + Math.max(...CL) +
      " 格 / 境外 " + Math.min(...OL) + "–" + Math.max(...OL) + " 格");
    console.log("  分段后有值格点按海陆拆解：境内 " + CK[0] + " 格 / 境外 " + OK[0] + " 格" +
      "（不分段时境内 " + (CK[0] + CL[0]) + " 格 / 境外 " + (OK[0] + OL[0]) + " 格）");
    if (r0.cnTop && r0.cnTop.length) {
      console.log("  境内丢失覆盖的 5°×5° 分块 TOP8（共 " + r0.cnLose + " 格）：");
      r0.cnTop.forEach(t => console.log("      " + t[0] + "  →  " + t[1] + " 格"));
    }
    if (r0.loseTop && r0.loseTop.length) {
      console.log("  境外丢失覆盖的 5°×5° 分块 TOP6（共 " + r0.osLose + " 格）：");
      r0.loseTop.forEach(t => console.log("      " + t[0] + "  →  " + t[1] + " 格"));
    }
  }
  /* 值场快照落盘：目视验收用。field_* 是带 alpha 的最终渲染（即地图上真正看到的），
     vals_* 是纯数值场灰度（越深值越高），diff 是两版逐格差异图。 */
  if (EQ.snap) {
    const dir = path.join(ROOT, "_scratch", "snap");
    fs.mkdirSync(dir, { recursive: true });
    const wr = (name, durl) => {
      if (!durl || durl.indexOf(",") < 0) return;
      const b = Buffer.from(durl.split(",")[1], "base64");
      fs.writeFileSync(path.join(dir, name), b);
      console.log("  快照 → _scratch/snap/" + name + "  (" + b.length + " 字节)");
    };
    wr("field_new.png", EQ.snap.newImg);
    wr("field_old.png", EQ.snap.oldImg);
    wr("vals_new.png", EQ.snap.newVal);
    wr("vals_old.png", EQ.snap.oldVal);
    wr("diff.png", EQ.snap.diff);
  }

  /* 条带覆盖审计：相邻条带的屏幕矩形必须首尾相接，中间不能有没被任何条带覆盖的 y */
  if (process.env.SEAM === "1") {
    const sm = await cdp.send("Runtime.evaluate", {
      expression: `(function(){
        var out=[], prevBot=null, gap=0, worstGap=0;
        MapMod.strips.forEach(function(s,i){
          var r=s.cv.getBoundingClientRect();
          if(prevBot!==null){ var g=+(r.top-prevBot).toFixed(2); if(g>worstGap)worstGap=g; if(g>0.6)gap++; }
          prevBot=r.bottom;
          if(i<3||i===MapMod.strips.length-1) out.push(i+':'+r.top.toFixed(1)+'~'+r.bottom.toFixed(1)+' 高'+r.height.toFixed(1));
        });
        return JSON.stringify({n:MapMod.strips.length, gapCount:gap, worstGap:+worstGap.toFixed(2), head:out});
      })()`, returnByValue: true
    });
    console.log("条带衔接审计： " + sm.result.value);
  }

  /* ---- B13：把取样点换成当前局部网格里的点 ----
     硬编码的北京/上海/广州/拉萨是"全国值场"时代的取样。局部化后值场只覆盖查询点
     周边（半径 500 km + 过渡带），那四点里只有上海还在场内，其余三点的像素
     **本来就该是透明的** —— 继续拿它们断言"颜色正确"，测到的是
     "没有值的地方是否透明"，而不是"有值的地方颜色对不对"。
     改为按距离从当前网格里挑：查询点本身 + 150/320/470 km 各取最近的一个点。
     这样既有网格单元内部（靠近某个采样点）、也有最外圈（过渡带附近）两类位置。 */
  const picks = await cdp.send("Runtime.evaluate", {
    expression: `(function(){
      try{
        var all=mapPts(), w=all.map(function(p){ return {p:p, d:haversineKm(State.lat,State.lon,p.lat,p.lon)}; });
        var out=[{nm:"查询点", lat:State.lat, lon:State.lon}];
        [150,320,470].forEach(function(t){
          var best=null, bd=1e9;
          w.forEach(function(o){ var dd=Math.abs(o.d-t); if(dd<bd){bd=dd;best=o;} });
          /* 名字带上距离：不同距离上很可能取到同一个地名（都是"上海市附近"），
             而结果字典以名字为键，不去重会互相覆盖。 */
          if(best) out.push({nm:best.p.name+"@"+Math.round(best.d)+"km", lat:best.p.lat, lon:best.p.lon});
        });
        return out;
      }catch(e){ return null; }
    })()`, returnByValue: true
  });
  if (picks.result.value && picks.result.value.length >= 2) {
    REF = picks.result.value.map(function (o) { return [o.nm, o.lat, o.lon]; });
    console.log("B13 取样点（取自当前局部网格）: "
      + REF.map(function (r) { return r[0] + "(" + r[1].toFixed(2) + "," + r[2].toFixed(2) + ")"; }).join(" / "));
  } else {
    console.log("B13 取点失败，沿用兜底取样点（其结果仅供参考）");
  }

  /* ---- A. 逐城市 × 逐缩放 读实际像素 ---- */
  const data = {};
  for (const [nm, la, lo] of REF) {
    data[nm] = {};
    for (const z of ZOOMS) {
      const r = await cdp.send("Runtime.evaluate", {
        expression: PROBE + "(" + z + "," + la + "," + lo + ")",
        returnByValue: true, awaitPromise: true
      });
      let o = null; try { o = JSON.parse(r.result.value); } catch (e) { }
      data[nm][z] = o;
      await sleep(120);
    }
  }

  /* ---- B. 视觉截图（对齐用户反馈的两种视角） ---- */
  async function shotAt(z, la, lo, out) {
    await cdp.send("Runtime.evaluate", {
      expression: `(async function(){ window.__TMAP_SETVIEW(${z},${la},${lo});
        await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); }); return 1; })()`,
      returnByValue: true, awaitPromise: true
    });
    const b = await cdp.send("Runtime.evaluate", {
      expression: `(function(){var e=document.querySelector('#map');var r=e.getBoundingClientRect();
        return JSON.stringify({x:r.left+window.scrollX,y:r.top+window.scrollY,width:r.width,height:r.height});})()`,
      returnByValue: true
    });
    const c = JSON.parse(b.result.value);
    const s = await cdp.send("Page.captureScreenshot", {
      format: "png", captureBeyondViewport: true,
      clip: { x: Math.max(0, c.x - 4), y: Math.max(0, c.y - 4), width: c.width + 8, height: c.height + 8, scale: 1 }
    });
    fs.writeFileSync(path.join(SERVE, out), Buffer.from(s.data, "base64"));
  }
  await shotAt(4, 35.2, 105.0, "zoom-" + TAG + "-map-z4.png");
  await shotAt(7, 23.13, 113.26, "zoom-" + TAG + "-map-z7.png");
  await shotAt(11, 23.13, 113.26, "zoom-" + TAG + "-map-z11.png");
  /* 3 倍放大截一小块，用来确认横线究竟是不是条带缝隙（缝隙在低倍下难以判别） */
  if (process.env.CROP === "1") {
    const b = await cdp.send("Runtime.evaluate", {
      expression: `(function(){var e=document.querySelector('#map');var r=e.getBoundingClientRect();
        return JSON.stringify({x:r.left+window.scrollX,y:r.top+window.scrollY});})()`, returnByValue: true
    });
    const o = JSON.parse(b.result.value);
    for (const [dy, nm] of [[60, "a"], [150, "b"]]) {
      const s = await cdp.send("Page.captureScreenshot", {
        format: "png", captureBeyondViewport: true,
        clip: { x: o.x + 60, y: o.y + dy, width: 220, height: 90, scale: 3 }
      });
      fs.writeFileSync(path.join(SERVE, "zoom-" + TAG + "-crop-" + nm + ".png"), Buffer.from(s.data, "base64"));
    }
  }

  /* ---- 判定 ---- */
  console.log("===== 缩放 × 颜色 验证 (" + TAG + ") =====");
  let fail = 0, checks = 0;
  /* 值场等价性（双重差分）并入断言计数：每个组合贡献 2 项 ——
     自检（第三方实现忠实于旧语义）与主断言（新实现等于带 D2 语义的正确结果）。
     "参考"那一列（D2 相对旧版的差异）是**预期的语义变更**，只作信息输出，不计失败。 */
  if (EQ.err) { checks++; fail++; }
  else if (EQ.n) { checks += EQ.n * 2; fail += (EQ.selfBad || 0) + (EQ.bad || 0); }
  for (const [nm, la, lo] of REF) {
    const rows = data[nm];
    const base = rows[ZOOMS[0]];
    console.log("\n【" + nm + "】最近城市 " + (base && base.near) + " 距离 " + (base && base.nearKm) + " km" +
      " | 值场 " + (base && base.fv) + " / 自身归一 " + (base && base.own) + " | 条带数 " + (base && base.strips));
    if (base) console.log("  诊断：layer=\"" + base.layerCls + "\"  strip0 rect=" + base.cvRect + "  host rect=" + base.hostRect);
    /* 缩放不变性的锚点：取**最大缩放**里那个 scale>=1（逐像素呈现）的像素。
       缩小档本身是重采样混合的结果，拿它当基准会把"混合误差"记到"缩放不变性"头上。 */
    let anchor = null;
    for (const z2 of ZOOMS) {
      const o2 = rows[z2];
      if (o2 && !o2.err && o2.px && (!o2.blk || o2.blk.err || o2.blk.sc == null || o2.blk.sc >= 1)) anchor = o2.px;
    }
    if (!anchor) anchor = (rows[ZOOMS[ZOOMS.length - 1]] || {}).px || null;
    for (const z of ZOOMS) {
      const o = rows[z];
      if (!o || o.err) { console.log("  zoom " + String(z).padStart(2) + "  探针失败 " + JSON.stringify(o)); fail++; continue; }
      /* 1) 有颜色（不透明） */
      checks++;
      const opaque = o.px && o.px[3] > 8;
      /* 2) 颜色 == 值场在该处的颜色。
            为什么比较的是「包围盒」而不是单点色：exp 由 fieldValue() 取**最近格**算出，
            而屏幕像素是"先投影到容器像素、再反查画布像素"，两级取整都可能落到相邻格。
            FIELD_STEP=0.05° 时相邻格只有 5.5 km，而采样间距是 120 km ——
            这个偏移量远小于数据自身的分辨率，对用户不可见。
            所以正确期望是「以该点为中心的一格邻域内出现过的颜色」，而不是唯一一个值。
            盒外的像素则一定是真错位（原缺陷量级 200）。 */
      checks++;
      const bk = (o.blk && !o.blk.err) ? o.blk : null;
      let okCol;
      if (!bk) {
        okCol = colEq(o.px, o.exp, 3);
      } else {
        okCol = !!(o.px &&
          o.px[0] >= bk.lo[0] - 3 && o.px[0] <= bk.hi[0] + 3 &&
          o.px[1] >= bk.lo[1] - 3 && o.px[1] <= bk.hi[1] + 3 &&
          o.px[2] >= bk.lo[2] - 3 && o.px[2] <= bk.hi[2] + 3);
      }
      /* 3) 数值 ≈ 最近城市自身数值（抓错位/翻转） */
      checks++;
      const okVal = (o.fv != null && o.own != null && Math.abs(o.fv - o.own) <= 3.5);
      /* 4) 透明度不随缩放变化 —— 直接对应"过度放大时颜色完全消失"那个反馈。
            色面透明度来自同一位图（与缩放无关），所以必须恒定。
            容差给到 12（≈5% 不透明度）而不是 3：色面边界改成凸包、又叠了海陆掩膜之后，
            掩膜边缘那一圈被 boxBlur 抹出**逐格**的 alpha 台阶（实测相邻格 225 / 229），
            而"投影到容器像素再反查画布像素"本来就会让不同缩放档落到相邻格上 ——
            那是"取到了邻格"，不是"随缩放变化"。要抓的是量级崩塌：原缺陷是 209 → 0。 */
      checks++;
      const okZoom = !!(o.px && o.px[3] > 8 && anchor && Math.abs(o.px[3] - anchor[3]) <= 12);
      const bad = !(opaque && okCol && okVal && okZoom);
      if (bad) fail++;
      console.log("  zoom " + String(z).padStart(2) +
        "  " + (bad ? "✗" : "✓") +
        "  像素 " + rgbTxt(o.px).padEnd(22) +
        " 期望 " + rgbTxt(o.exp).padEnd(18) +
        " 值 " + String(o.fv).padStart(6) + "/" + String(o.own).padStart(6) +
        (bk ? "  [sc" + (bk.sc == null ? "?" : bk.sc.toFixed(2)) + " 盒" + bk.w + "×" + bk.h +
              " " + bk.lo.slice(0, 3).join(",") + "–" + bk.hi.slice(0, 3).join(",") + "]" : "  [无盒]") +
        "  " + (opaque ? "" : "[透明] ") + (okCol ? "" : "[色不符] ") +
        (okVal ? "" : "[值偏离] ") + (okZoom ? "" : "[不透明度随缩放变化]"));
    }
  }
  console.log("\n断言 " + checks + " 项，失败 " + fail + " 项");
  /* 机器可读的事实行：给 _check/docfacts.py 读「断言条数」用。
     约定见 _check/docfacts.py 头部 —— 一行一个 JSON，前缀固定 FACTS，别改格式。 */
  console.log('FACTS {"assertions":' + checks + ',"fail":' + fail + '}');
  console.log("=== 控制台错误 (" + errs.length + ") ===");
  errs.slice(0, 20).forEach(e => console.log("  " + e));

  await cdp.send("Browser.close").catch(() => { });
  chrome.kill(); srv.close();
  process.exit((fail || EQ.bad || EQ.selfBad || EQ.err) ? 2 : 0);
})().catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
