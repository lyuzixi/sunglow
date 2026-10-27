/* 合成数据 + 广州 + 固定取景的**只截图**工具（不量任何指标）。
 * 用途：抓"改前 / 改后"的并排对比图。
 *
 * 为什么不能直接用 styleprobe.js 拍旧版：它的量测段引用了
 * FIELD_REACH_KM / FIELD_OUT_KM / N_BANDS / GEOM_CACHE.geom.hud ——
 * 这些常量与字段在**改造前**的产物里根本不存在，直接跑会抛 ReferenceError，
 * 连截图都拍不出来。而要做对比，两边必须用**完全相同的取景与合成数据**，
 * 否则差异里混进了取景差异，看图的人无从判断。
 *
 * 标准流程（务必成对做，且用 md5 确认换回的是同一份源码）：
 *   1) cp _p6.js tpl/template.html _scratch/swap/        # 暂存当前源码
 *   2) cp _backup/<改造前>/_p6.js _p6.js                # 换入旧版
 *      cp _backup/<改造前>/tpl/template.html tpl/template.html
 *   3) python assemble.py && python mkpreview.py
 *      node _check/_shotonly.js style-before.png
 *   4) cp _scratch/swap/* 还原 → 重新 assemble + mkpreview  # **忘了这步就用旧代码跑回归**
 *   5) node _check/_shotonly.js style-after.png
 * 注：本文件不进 all.py 序列（它不产生断言）。
 *
 * 用法: node _check/_shotonly.js <输出文件名> [zoom] [lat] [lon]
 *      不给 zoom 就是默认取景（对比图一律用默认取景，否则差异里混进取景差异）。
 *      给了 zoom 就走 __TMAP_SETVIEW —— 用来验"线宽与缩放无关"。
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
const PORT = 47911;
const DEBUG_PORT = 9361;
const OUT = process.argv[2] || "shotonly.png";
const ZOOM = process.argv[3] ? Number(process.argv[3]) : 0;
const LAT = process.argv[4] ? Number(process.argv[4]) : 23.1291;
const LON = process.argv[5] ? Number(process.argv[5]) : 113.2644;
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
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "so-"));
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
  await sleep(800);
  if (ZOOM) {
    /* 缩放到指定档位：等值线是屏幕空间矢量，线宽**不该**跟着变 */
    await ev(`(function(){ try { window.__TMAP_SETVIEW(${ZOOM}, ${LAT}, ${LON}); } catch(e){} })()`);
    await sleep(1200);
  }
  /* 关掉提示卡、把可能的叠加层状态复位，保证两边拍的是同一状态 */
  await ev(`(function(){ const t=document.getElementById('tip'); if(t) t.classList.remove('on');
    const md=document.querySelector('.mapwrap'); if(md) md.classList.remove('dark');
    window.scrollTo(0,0); })()`);
  await sleep(300);
  const geom = await ev(`(function(){ try{ const f=MapMod.field;
    return f.cols+'x'+f.rows+' · 条带 '+MapMod.strips.length; }catch(e){ return String(e); } })()`);
  console.log("色面栅格 " + geom);

  const r = await ev(`(function(){ const b = document.querySelector('.mapwrap').getBoundingClientRect();
    return { x: Math.round(b.x + window.scrollX), y: Math.round(b.y + window.scrollY),
             width: Math.round(b.width), height: Math.round(b.height) }; })()`);
  const s = await cdp.send("Page.captureScreenshot", {
    format: "png", captureBeyondViewport: true,
    clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 2 }
  });
  fs.writeFileSync(path.join(SERVE, OUT), Buffer.from(s.data, "base64"));
  console.log("  实拍 -> _check/" + OUT);

  try { chrome.kill(); } catch (e) { }
  srv.close();
  process.exit(0);
})().catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
