/* 一次性量测：把"色面看起来像一团雾"落到具体数字上。用完即删。
 * 用法: node _check/_styleprobe.js
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
const PORT = 47891;
const DEBUG_PORT = 9351;
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

const VALS = {
  cloud_cover_low: 55, cloud_cover_mid: 45, cloud_cover_high: 60, cloud_cover: 55,
  visibility: 22000, relative_humidity_2m: 60, dew_point_2m: 15, temperature_2m: 22,
  surface_pressure: 1008, wind_speed_10m: 5, boundary_layer_height: 900,
  freezing_level_height: 3600, wind_direction_10m: 200
};

(async function main() {
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "sp-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + DEBUG_PORT, "--user-data-dir=" + udd,
    "--window-size=1280,900", "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });

  let ver = null;
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    try { ver = await (await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/version")).json(); break; } catch (e) { }
  }
  if (!ver) { console.log("CHROME_START_FAIL"); process.exit(1); }
  const list = await (await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/list")).json();
  const page = list.find(t => t.type === "page") || list[0];
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
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
      const sd = u.searchParams.get("start_date") || "2026-10-11";
      const ed = u.searchParams.get("end_date") || sd;
      const t0 = Date.parse(sd + "T00:00:00Z"), t1 = Date.parse(ed + "T00:00:00Z");
      const nDay = Math.max(1, Math.round((t1 - t0) / 86400000) + 1);
      const times = [];
      for (let k = 0; k < nDay * 24; k++) {
        const d = new Date(t0 + k * 3600000);
        times.push(d.toISOString().slice(0, 10) + "T" + String(d.getUTCHours()).padStart(2, "0") + ":00");
      }
      const body = lats.map((la, i) => {
        const lo = lons[i] == null ? 0 : lons[i];
        const hourly = { time: times };
        /* 让各云层量在**不同的位置**起伏。原来四个变量共用同一个 bump，算出来的指数
           是一整片同心渐变 —— 那种场看不出"分档 / 边界 / 纱"这些画法好不好，
           只能看出"是不是一个圆"。真实数据是斑块状的，这里照着造。 */
        const B = {
          cloud_cover_low:  [21.2, 111.3, 4.0, 46],
          cloud_cover_mid:  [24.6, 115.0, 5.0, 42],
          cloud_cover_high: [22.3, 112.6, 2.6, 48],
          cloud_cover:      [23.9, 110.4, 7.0, 30]
        };
        vars.forEach(v => {
          const b = B[v];
          hourly[v] = times.map((_, k) => {
            if (isAQ) return 0.18;
            const base = VALS[v] == null ? 50 : VALS[v];
            if (!b) return base;
            const d2 = Math.pow(la - b[0], 2) + Math.pow(lo - b[1], 2);
            const wob = 1 + 0.25 * Math.sin(k / 6 + la);
            return base + b[3] * Math.exp(-d2 / b[2]) * wob;
          });
        });
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
  const ev = async (expr, awaitP) => {
    const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: !!awaitP });
    if (r.exceptionDetails) throw new Error("页内异常: " + JSON.stringify(r.exceptionDetails.text));
    return r.result.value;
  };

  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const s = await ev(`({ res: !!State.result, geo: !!(MapMod.geo && MapMod.geo.features && MapMod.geo.features.length) })`);
    if (s.res && s.geo) break;
  }
  await ev(`setLocation(23.1291, 113.2644, "广州市", "广东省")`);
  await ev(`(async()=>{ await loadMapData(true); })()`, true);
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await ev(`!!(mapSet() && mapSet().pts.length && MapMod.field)`)) break;
  }
  await sleep(600);

  const R = await ev(`(function(){
    const f = MapMod.field, n = f.cols * f.rows;
    const FULLA = Math.round(255 * FIELD_OPACITY);
    let a0 = 0, aFull = 0, veilDkm = 0, colored = 0;
    /* C2 之后纱的判据是**凸包外**，不再是"距最近采样点 > FIELD_FULL"。
       这里同时量两个，好让"纱覆盖多少"永远带着那个 dkm 对照数一起看 ——
       实测两者差了一个数量级（1.25% vs 25.35%），原因见 _p6.js buildConfStrips。 */
    const gg = GEOM_CACHE.geom, hud = gg && gg.hud, HH = hud ? hud.edges : null;
    let veilHull = 0;
    for (let r = 0; r < f.rows; r++) {
      const Y = HH ? ((f.laN - r * f.dLa) - hud.olat) * 110.574 : 0;
      for (let c = 0; c < f.cols; c++) {
        const o = r * f.cols + c;
        if (f.img[o*4+3] === 0) continue;
        let sd = -1e9;
        if (HH) {
          const X = (f.loW + c * f.dLo - hud.olon) * hud.kx;
          for (let k = 0; k < HH.length; k += 3) {
            const d = HH[k]*X + HH[k+1]*Y + HH[k+2];
            if (d > sd) sd = d;
          }
        }
        if (sd > 0) veilHull++;
      }
    }
    const veil = veilHull;
    const A = [];
    for (let o = 0; o < n; o++) {
      const a = f.img[o*4+3];
      if (a > 0) { colored++; A.push(Math.round(f.dkm[o])); }
      if (a === FULLA) aFull++;
      if (a > 0 && f.dkm[o] > FIELD_FULL) veilDkm++;
    }
    A.sort((x,y)=>x-y);
    const q = p => A[Math.floor((A.length-1)*p)];
    /* 采样区"内部"（离最近点 ≤ FIELD_FULL，理论上应处处 alpha=1）的调制量：
       若这里出现大量 <209 的格子，说明 FULL 这个阈值没盖住格心距离，
       色面内部会周期性地"发虚"，叠上 blur 就成了一团一团的气泡。 */
    let iN = 0, iSoft = 0, iMin = 255, iSum = 0;
    const bucket = {};
    for (let o = 0; o < n; o++) {
      if (f.dkm[o] <= FIELD_FULL) {
        iN++; const a = f.img[o*4+3]; iSum += a; if (a < FULLA) iSoft++; if (a < iMin) iMin = a;
        const b = a === 0 ? "0" : a < 60 ? "1-59" : a < 120 ? "60-119" : a < 180 ? "120-179" : a < FULLA ? "180-full" : "full";
        bucket[b] = (bucket[b] || 0) + 1;
      }
    }
    /* 取一个采样点周围的 26×26 窗口，把 alpha 打成字符画 —— 看是格点周期还是海岸线形状 */
    let art = [];
    if (typeof mapSet === "function" && mapSet()) {
      const p0 = mapSet().pts[0];
      const c0 = Math.round((p0.lon - f.lo0) / f.dLo), r0 = Math.round((f.la1 - p0.lat) / f.dLa);
      for (let y = -13; y <= 13; y++) {
        let s = "";
        for (let x = -13; x <= 13; x++) {
          const rr = r0 + y, cc = c0 + x;
          if (rr < 0 || rr >= f.rows || cc < 0 || cc >= f.cols) { s += "?"; continue; }
          const a = f.img[(rr*f.cols+cc)*4+3];
          s += a === 0 ? "." : a < 60 ? "1" : a < 120 ? "2" : a < 180 ? "3" : a < FULLA ? "4" : "#";
        }
        art.push(s);
      }
    }
    /* 采样格距 & 方格格心到最近格点的距离 —— FULL 是否该按方格算 */
    const pts = mapSet().pts;
    let near = 1e9;
    for (let i = 0; i < pts.length; i++) for (let j = i+1; j < pts.length; j++) {
      const dy = (pts[i].lat - pts[j].lat) * 110.574;
      const dx = (pts[i].lon - pts[j].lon) * 111.32 * Math.cos(pts[i].lat*Math.PI/180);
      const d = Math.sqrt(dx*dx + dy*dy); if (d < near) near = d;
    }
    /* 色阶用了几档：数 img 里出现的不同 RGB 组合 */
    const seen = new Set();
    for (let o = 0; o < n; o += 7) seen.add(f.img[o*4] + "," + f.img[o*4+1] + "," + f.img[o*4+2]);
    /* 数值分布：每格的值 */
    const V = [];
    for (let o = 0; o < n; o++) if (isNum(f.vals[o])) V.push(f.vals[o]);
    V.sort((x,y)=>x-y);
    const vq = p => V[Math.floor((V.length-1)*p)];
    /* 屏幕比例：取第一条 strip 的 transform */
    const cv = MapMod.layer && MapMod.layer.firstChild;
    const tf = cv ? getComputedStyle(cv).transform : "";
    const sc = tf && tf.indexOf("matrix") === 0 ? parseFloat(tf.slice(7).split(",")[0]) : null;
    return { cols: f.cols, rows: f.rows, dLa: f.dLa,
             rasterKm: Math.round(f.cols * f.dLa * 111.32 * Math.cos(23.13*Math.PI/180)) + " x " + Math.round(f.rows*f.dLa*110.574),
             pxScale: sc,
             coloredFrac: +(colored/n).toFixed(3), fullFrac: +(aFull/n).toFixed(3),
             veilFrac: +(veil/n).toFixed(3), veilOfColored: +(veil/Math.max(1,colored)).toFixed(3),
             veilDkmOfColored: +(veilDkm/Math.max(1,colored)).toFixed(3),
             dkmP10: q(0.10), dkmP50: q(0.50), dkmP90: q(0.90), dkmMax: A[A.length-1],
             nearKm: +near.toFixed(1),
             iN: iN, iSoft: iSoft, iMin: iMin, iMean: +(iSum/Math.max(1,iN)).toFixed(1),
             bucket: bucket, art: art,
             cf: { FULL: FIELD_FULL, REACH: FIELD_REACH_KM, OUT: FIELD_OUT_KM, BLUR: FIELD_BLUR, OP: FIELD_OPACITY },
             hullEdges: (typeof GEOM_CACHE !== "undefined" && GEOM_CACHE.geom && GEOM_CACHE.geom.hud)
               ? GEOM_CACHE.geom.hud.edges.length / 3 : 0,
             colors: seen.size,
             valMin: +vq(0).toFixed(1), valP25: +vq(0.25).toFixed(1), valP50: +vq(0.5).toFixed(1),
             valP75: +vq(0.75).toFixed(1), valMax: +vq(1).toFixed(1),
             fullAlpha: FULLA };
  })()`);
  console.log("=== 色面几何与分布（广州，合成数据）===");
  console.log("  栅格 " + R.cols + "×" + R.rows + " 格 · 覆盖约 " + R.rasterKm + " km");
  console.log("  地图像素/栅格格 = " + (R.pxScale == null ? "?" : R.pxScale.toFixed(2)));
  console.log("  上色格占比 " + (R.coloredFrac*100).toFixed(1) + "%  ·  其中完全不透明(alpha=" + R.fullAlpha + ") " + (R.fullFrac*100).toFixed(1) + "%");
  console.log("  可信度纱覆盖 " + (R.veilFrac*100).toFixed(1) + "% 的栅格  ＝ 已上色部分的 " + (R.veilOfColored*100).toFixed(1)
    + "%（凸包外判据；旧 dkm>FIELD_FULL 判据只有 " + (R.veilDkmOfColored*100).toFixed(2) + "%）");
  console.log("  到最近采样点距离：P10 " + R.dkmP10 + " · P50 " + R.dkmP50 + " · P90 " + R.dkmP90 + " · max " + R.dkmMax + " km");
  console.log("  实际最近邻点距 " + R.nearKm + " km（方格格心到最近格点 = 间距×0.707）");
  console.log("  采样区内部(dkm≤FIELD_FULL=" + R.cf.FULL + ")：" + R.iN + " 格，其中 alpha<" + R.fullAlpha + " 的有 "
    + R.iSoft + " 格（" + (R.iSoft/Math.max(1,R.iN)*100).toFixed(1) + "%）· alpha 最低 " + R.iMin + " · 均值 " + R.iMean);
  console.log("    alpha 分布：" + JSON.stringify(R.bucket));
  console.log("  常量 FIELD_OUT=" + R.cf.OUT + " FIELD_REACH=" + R.cf.REACH + " FIELD_FULL=" + R.cf.FULL
    + " BLUR=" + R.cf.BLUR + " OPACITY=" + R.cf.OP);
  console.log("  凸包边数 " + R.hullEdges);
  console.log("  第一个采样点周围 27×27 的 alpha 字符画（# =" + R.fullAlpha + "，. =0，1/2/3/4 = 低到高）:");
  R.art.forEach(l => console.log("   " + l));
  console.log("  色面里实际出现的不同 RGB 数（抽样 1/7）: " + R.colors);
  console.log("  数值分布 P0/P25/P50/P75/P100 = " + R.valMin + " / " + R.valP25 + " / " + R.valP50 + " / " + R.valP75 + " / " + R.valMax);

  /* 沿一条水平线把 alpha 打出来，看过渡带有多宽 */
  const scan = await ev(`(function(){
    const f = MapMod.field, r = Math.round(f.rows*0.62);
    const out = [];
    for (let c = 0; c < f.cols; c += 4) out.push(f.img[(r*f.cols+c)*4+3]);
    return out;
  })()`);
  console.log("  一条水平扫描线上的 alpha（每 4 格取 1）:");
  console.log("   " + scan.join(" "));

  /* 实拍：文件名可由命令行给（默认 style-now.png），方便逐步对比 */
  const shotOf = async (name) => {
    const r = await ev(`(function(){ const b = document.querySelector('.mapwrap').getBoundingClientRect();
      return { x: Math.round(b.x + window.scrollX), y: Math.round(b.y + window.scrollY),
               width: Math.round(b.width), height: Math.round(b.height) }; })()`);
    const s = await cdp.send("Page.captureScreenshot", {
      format: "png", captureBeyondViewport: true,
      clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 2 }
    });
    fs.writeFileSync(path.join(ROOT, "_check", name), Buffer.from(s.data, "base64"));
    console.log("  实拍 -> _check/" + name);
  };
  await ev(`(function(){ const t = document.getElementById('tip'); if (t) t.classList.remove('on'); window.scrollTo(0, 0); })()`);
  await sleep(250);
  await shotOf(process.argv[2] || "style-now.png");

  try { chrome.kill(); } catch (e) { }
  srv.close();
  process.exit(0);
})().catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
