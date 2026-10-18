/* 绘制性能基线探针（只测量，不改产线）—— 零额度（合成数据）。
 *
 * 为什么需要它：`paintMap()` 是整条渲染链路的唯一入口（值场重建 → 分档栅格 →
 * 等值线几何 → 可信度纱 → 方位环 → 数值直标 → 图钉 → 图例/排行榜），
 * 但在此之前**一次都没有被量过**。43,400 格的栅格与屏幕空间矢量等值线都不是
 * 免费操作，而"在我的机器上感觉不慢"不是结论 —— 低端安卓与桌面浏览器的差距
 * 可以是一个数量级。
 *
 * 量法：CDP `Emulation.setCPUThrottlingRate` 模拟 4×/6× 降速（低端手机的粗略类比），
 * 分三个场景各取**分位数**：
 *   ① 复绘（值场几何命中缓存）—— 用户切模型/切维度/切图层时走的那条；
 *   ② 首次（强制 GEOM_CACHE.sig="" 让值场几何与遮罩重建）—— 首次出图、换地点走的那条；
 *   ③ 全开（五个图层全开的最坏情况，在 ① 的基础上加四层叠加）。
 * 每个场景 9 次采样，报中位数与最大值（9 个样本的"最大值"即 p89，够用且诚实）。
 *
 * **先量后定预算**：本探针只出数字，不判成败、不进 _check/all.py 序列
 * （CPU 节流下的耗时与机器负载强相关，拿它当门禁必然 flaky）。
 * 结论记在 `_check/.perf.json`，下次运行会自动打印与上次的对比。
 *
 * 用法: node _check/perfprobe.js
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
const PORT = 47895;
const DEBUG_PORT = 9356;
const BASELINE = path.join(SERVE, ".perf.json");
const RATES = [1, 4, 6];
const N = 9;
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
      setTimeout(() => { if (this.pend.has(id)) { this.pend.delete(id); rej(new Error("timeout " + method)); } }, 120000);
    });
  }
  on(f) { this.handlers.push(f); }
}

function gen(v, la, lo, hh, isAQ, dof) {
  const s = Math.sin((la + 3) / 6) * Math.sin((lo - 5) / 7) * Math.sin(hh / 24 * Math.PI);
  switch (v) {
    case "cloud_cover_low": return 40 + 35 * s;
    case "cloud_cover_mid": return 35 + 30 * Math.sin(la / 5) * Math.cos(lo / 6);
    case "cloud_cover_high": return 45 + 40 * Math.cos((la + lo) / 9 + dof * 0.3);
    case "cloud_cover": return 50 + 25 * s;
    case "visibility": return 18000 + 12000 * Math.sin(la / 4 + lo / 8);
    case "relative_humidity_2m": return 55 + 25 * Math.cos(la / 7);
    case "dew_point_2m": return 12 + 8 * Math.sin((la + lo) / 11);
    case "temperature_2m": return 18 + 10 * Math.sin(la / 8);
    case "surface_pressure": return 1005 + 12 * Math.sin(lo / 9);
    case "wind_speed_10m": return 4 + 5 * Math.abs(Math.sin((la + lo) / 12));
    case "boundary_layer_height": return 700 + 500 * Math.sin(la / 6);
    case "freezing_level_height": return 3200 + 900 * Math.sin(lo / 7);
    case "wind_direction_10m": return 180 + 90 * Math.sin(la / 5);
    default: return isAQ ? (0.14 + 0.25 * Math.abs(Math.sin((la + lo) / 10))) : 50;
  }
}

const med = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = v => Math.round(v * 10) / 10;

(async function main() {
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "pf-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + DEBUG_PORT, "--user-data-dir=" + udd,
    "--window-size=1440,900", "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let cerr = "";
  chrome.stderr.on("data", d => { cerr += d.toString(); });

  let ver = null;
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    try { ver = await (await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/version")).json(); break; } catch (e) { }
  }
  if (!ver) { console.log("CHROME_START_FAIL\n" + cerr.slice(0, 1500)); process.exit(1); }
  const list = await (await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/list")).json();
  const page = list.find(t => t.type === "page") || list[0];
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);

  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
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
      const sd = u.searchParams.get("start_date") || "2026-10-10";
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
        vars.forEach(v => {
          hourly[v] = times.map((_, k) => gen(v, la, lo, new Date(t0 + k * 3600000).getUTCHours(),
            isAQ, Math.floor((t0 + k * 3600000) / 86400000)));
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

  const ev = async (expr, awaitP) => {
    const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: !!awaitP });
    if (r.exceptionDetails) throw new Error("页内异常: " + (r.exceptionDetails.text || ""));
    return r.result.value;
  };

  console.log("=".repeat(74));
  console.log("绘制性能基线 —— paintMap() 全链路（合成数据，零额度）");
  console.log("=".repeat(74));

  await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/preview.html" });
  for (let i = 0; i < 60; i++) {
    await sleep(700);
    let s = null;
    try { s = await ev(`({ res: !!(typeof State !== 'undefined' && State.result),
      geo: !!(typeof MapMod !== 'undefined' && MapMod.geo && MapMod.geo.features && MapMod.geo.features.length) })`); }
    catch (e) { continue; }
    if (s.res && s.geo) break;
  }
  /* 取一次地图数据（合成）。走 loadMapData(true) 的显式路径，不动任何用户偏好。 */
  await ev(`(async()=>{ await loadMapData(true); })()`, true);
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (await ev(`!!(mapSet() && mapSet().pts.length && MapMod.field)`)) break;
  }
  const geo = await ev(`({ pts: mapPts().length, bands: N_BANDS, step: FIELD_STEP,
    cols: (MapMod.field && MapMod.field.cols) || 0, rows: (MapMod.field && MapMod.field.rows) || 0,
    strips: (MapMod.strips || []).length })`);
  console.log("\n  场景几何：采样点 " + geo.pts + " 个 · 分档 " + geo.bands
    + " · FIELD_STEP=" + geo.step + "° · 值场 " + geo.cols + "×" + geo.rows
    + " = " + (geo.cols * geo.rows).toLocaleString() + " 格 · 色面条带 " + geo.strips + " 条");
  console.log("  每个场景采样 " + N + " 次，报中位数 / 最大值（ms）。\n");

  /* 采样方式：**每一次 paintMap() 单独一次 Runtime.evaluate**。
     第一版把 9 次循环写在同一段脚本里，量出来的数字自相矛盾（6× 节流下"重建值场"
     反而比 1× 还快）—— 原因是 CDP 的 CPU 节流是注入在**任务调度**上的，而一整段
     同步 JS 是**一个**长任务，节流在里面基本不生效；同时一次长任务里的第一次
     冷启动开销会被后面几次的 JIT 热路径摊平。
     拆成一次一个任务后，① 节流按真实比例生效，② 每个样本都是"从冷到热的同一起点"，
     也更贴近真实调用场景（用户点一下 = 一个独立任务）。
     setupEach 在**每次**采样前执行 —— 场景②靠它把 GEOM_CACHE.sig 清成 ""；
     不能只清一次：buildField 重建后会把 sig 写回去，第 2 次就命中缓存了。 */
  const run = async (label, setup, setupEach, rate) => {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: rate });
    await sleep(250);
    await ev(setup);
    /* 预热：让 JIT 与各层 DOM 都进入稳态，否则第一个样本量的是编译时间 */
    await ev(`(function(){ ${setupEach} paintMap(); })()`);
    await sleep(120);
    const times = [];
    for (let i = 0; i < N; i++) {
      times.push(await ev(`(function(){ ${setupEach}
        const a = performance.now(); paintMap(); return performance.now() - a; })()`));
    }
    return { label: label, rate: rate, med: r1(med(times)), max: r1(Math.max(...times)), all: times.map(r1) };
  };

  const rows = [];
  for (const rate of RATES) {
    /* ① 复绘：值场几何命中缓存（切模型/切维度/切图层走这条） */
    rows.push(await run("复绘", `(function(){
      /* 2026-10-18：dimBase 已删（深色底图并入主题），只拨四个真实开关 */
      ['numLabels','showPts','showTx'].forEach(id => {
        const e = document.getElementById(id); if (e && e.checked) { e.checked = false;
          e.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      State.mapDim = 'mix'; paintMap();
    })()`, "void 0;", rate));
    /* ② 首次：每次强制值场几何 + 遮罩重建（首次出图、换地点走这条） */
    rows.push(await run("首次（重建值场）", `void 0;`, `GEOM_CACHE.sig = "";`, rate));
    /* ③ 全开：五个图层全开的最坏情况 */
    rows.push(await run("复绘 · 全图层", `(function(){
      ['numLabels','showPts','showTx'].forEach(id => {
        const e = document.getElementById(id); if (e && !e.checked) { e.checked = true;
          e.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      paintMap();
    })()`, "void 0;", rate));
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => { });

  console.log("  " + "场景".padEnd(18) + "节流".padEnd(8) + "中位数".padEnd(10) + "最大");
  console.log("  " + "-".repeat(50));
  rows.forEach(r => {
    console.log("  " + (r.label + (r.rate > 1 ? "" : "（基准）")).padEnd(18)
      + (r.rate + "×").padEnd(8) + (r.med + " ms").padEnd(10) + r.max + " ms");
  });

  /* 与上次基线对比（同一个"场景 × 节流"为一行） */
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(BASELINE, "utf8")); } catch (e) { }
  if (prev && prev.rows) {
    console.log("\n  与上次基线（" + prev.ts + "）对比：");
    rows.forEach(r => {
      const k = r.label + "@" + r.rate;
      const p = (prev.rows.find(x => (x.label + "@" + x.rate) === k) || {}).med;
      if (p == null) { console.log("    " + k + " —— 上次没有这一行"); return; }
      const d = r.med - p;
      console.log("    " + k.padEnd(24) + "上次 " + String(p).padStart(7) + " ms → 本次 "
        + String(r.med).padStart(7) + " ms  （" + (d >= 0 ? "+" : "") + r1(d) + "）");
    });
  } else {
    console.log("\n  没有上次基线 —— 本次写入 " + path.relative(ROOT, BASELINE) + " 作为起点。");
  }
  /* 基线只在降速档下记，1× 那档与机器性能强相关、跨机器比没有意义 */
  try {
    fs.writeFileSync(BASELINE, JSON.stringify({
      ts: new Date().toISOString().slice(0, 19).replace("T", " "),
      grid: geo, n: N, rows: rows.map(r => ({ label: r.label, rate: r.rate, med: r.med, max: r.max }))
    }, null, 1));
  } catch (e) { console.log("  （写基线失败：" + e.message + "）"); }

  try { chrome.kill(); } catch (e) { }
  srv.close();
  process.exit(0);       /* 只测量，不判成败 */
})().catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
