/* B1 单点结果缓存 · 验收探针
   =========================================================================
   为什么需要它：
     "刷新一下看看有没有更新"是这个应用最自然的动作，而在 B1 之前它每次都要
     重新花 65 个加权调用 —— 因为 `State.cache` 只是内存（见 _p5.js 的 computeAll），
     地图有完整的持久化缓存，单点一点都没有。

   本探针用合成数据（`Fetch.requestPaused` 回填，不依赖真实网络、不花额度）
   跑完整的 computeAll，逐条断言缓存行为。"零请求"是这里唯一有意义的证据 ——
   它由页面自己的 `apiCallStats()` 记账，不是靠猜。

   与 cdp.js 的区别：**不点 #mapGo、不碰地图**。B1 是纯单点侧的事，
   把地图拉进来只会让首屏等待变长、断言更难定位。

   用法: node _check/pointcache.js
   退出码：0 = 全部通过；1 = 有未通过项（末尾打印 FAIL 计数: N）
   ========================================================================= */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SERVE = path.join(ROOT, "_check");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 47881, DBG = 9342;

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

/* 合成数据生成器：与 cachesize.js 同一份，保证两处算的是同一套"合成的真实"。
   刻意做成空间相关（wave）而非常数 —— 常数值会让值场恒等、插值与缓存都测不出差别。 */
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

/* ---- 页面内测试序列 ---------------------------------------------------
   用字符串塞进 Runtime.evaluate。注意：**注释里不能出现反引号**（会提前闭合模板串），
   正则里的反斜杠要按"模板串内部"的规则双写（Node 会吃掉单层的 \s、\.）。 */
const SCRIPT = `
(async function(){
  const out = { checks: {}, info: {} };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms) => { const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };
  const lsKeys = pre => { const a = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i);
      if (k && k.indexOf(pre) === 0) a.push(k); } return a; };
  const one = async (la, lo, ds, pe) => { apiCallReset();
    await computeAll(la, lo, ds, pe, State.name); return apiCallStats().requests; };

  const lat = State.lat, lon = State.lon, ds = State.dateStr;
  const per = State.period, other = per === "am" ? "pm" : "am";
  const kk = pointKeyOf(lat, lon, ds, per);

  out.info.lat = lat; out.info.lon = lon; out.info.date = ds;
  out.info.period = per; out.info.prefix = POINT_CACHE_PREFIX;
  out.info.max = POINT_CACHE_MAX; out.info.ttlH = POINT_CACHE_TTL / 3600000;
  out.info.key = kk;

  /* ① 首次取数：应发请求，并落盘 */
  localStorage.clear(); State.cache = {};
  out.info.firstReq = await one(lat, lon, ds, per);
  out.checks.firstFetches = out.info.firstReq > 0;
  out.checks.firstWrote = await waitFor(() => lsKeys(POINT_CACHE_PREFIX).length === 1, 4000);

  /* 体积：存的是原始 bundle，和"算好的结果"对比一下，说明选择 */
  const bdl = pointCacheGet(lat, lon, ds, per);
  out.info.bundleChars = bdl ? JSON.stringify(bdl).length : null;
  out.info.bundleUtf8 = bdl ? new Blob([JSON.stringify(bdl)]).size : null;
  out.info.entryChars = localStorage.getItem(kk) ? localStorage.getItem(kk).length : null;
  out.info.resultRef = 0;

  /* ② 会话内重复 → 0 请求（内存命中） */
  out.info.memReq = await one(lat, lon, ds, per);
  out.checks.memHitFree = out.info.memReq === 0;

  /* ③ 清空内存（等价于刷新页面）→ 磁盘命中 → 0 请求 ★ B1 的核心 */
  State.cache = {};
  out.info.diskReq = await one(lat, lon, ds, per);
  out.checks.diskHitFree = out.info.diskReq === 0;

  /* ④ 换时段 → 必须重新取数（样带沿不同事件方位，坐标集合不同） */
  out.info.otherPerReq = await one(lat, lon, ds, other);
  out.checks.otherPerFetches = out.info.otherPerReq > 0;
  out.checks.otherPerWrote = await waitFor(() => lsKeys(POINT_CACHE_PREFIX).length === 2, 4000);

  /* ⑤ 切回原时段 → 磁盘命中 */
  State.cache = {};
  out.info.backReq = await one(lat, lon, ds, per);
  out.checks.backFree = out.info.backReq === 0;

  /* ⑥ 换坐标 → 必须重新取数 */
  State.cache = {};
  out.info.otherCoordReq = await one(lat + 3, lon + 3, ds, per);
  out.checks.otherCoordFetches = out.info.otherCoordReq > 0;

  /* ⑦ 键形状：前缀(含版本) + 日期 + |时段 + @lat,lon（坐标必须在末尾） */
  out.info.keys = lsKeys(POINT_CACHE_PREFIX);
  const shape = /^sunsetbot[.]point[.]v[0-9]+[.]\\d{4}-\\d{2}-\\d{2}\\|(am|pm)@-?[0-9]+(?:[.][0-9]+)?,-?[0-9]+(?:[.][0-9]+)?$/;
  out.checks.keyShape = out.info.keys.length > 0 && out.info.keys.every(k => shape.test(k));
  out.checks.keyCoordsAtEnd = out.info.keys.every(k => /@-?[0-9]+(?:[.][0-9]+)?,-?[0-9]+(?:[.][0-9]+)?$/.test(k));

  /* ⑧ TTL 过期 → 重新取数 */
  State.cache = {};
  const raw = JSON.parse(localStorage.getItem(kk));
  raw.ts = Date.now() - POINT_CACHE_TTL - 1000;
  localStorage.setItem(kk, JSON.stringify(raw));
  out.info.expiredReq = await one(lat, lon, ds, per);
  out.checks.expiredFetches = out.info.expiredReq > 0;
  await waitFor(() => localStorage.getItem(kk) !== null, 4000);

  /* ⑨ 残缺 bundle（缺 gfsD）→ 视为无缓存，重新取数。
       先 removeItem 再取数：这样"键又出现"就等于"这一次的 put 确实落盘了"。
       不这么做的话 waitFor 会被上一步留下的同一条键立刻满足，
       而真正待写的那次 put 会在后面某一刻落地 —— 把残缺 bundle 覆盖掉，
       于是这条断言变成"碰运气通过"。 */
  localStorage.removeItem(kk);
  State.cache = {};
  await one(lat, lon, ds, per);
  await waitFor(() => localStorage.getItem(kk) !== null, 4000);
  localStorage.setItem(kk, JSON.stringify({ ts: Date.now(), obj: { ecD: null, aqD: null } }));
  State.cache = {};
  out.info.brokenReq = await one(lat, lon, ds, per);
  out.checks.brokenRejected = out.info.brokenReq > 0;

  /* ⑩ 版本闸门（读取侧）：同坐标的数据写在**旧版本前缀**下，必须读不到。
       此刻没有待写的 put 挂在那，所以那条 v0 一定还在，断言不会落空。 */
  State.cache = {};
  localStorage.clear();
  await one(lat, lon, ds, per);
  await waitFor(() => localStorage.getItem(kk) !== null, 4000);
  const good = localStorage.getItem(kk);
  localStorage.removeItem(kk);
  localStorage.setItem(kk.replace(POINT_CACHE_PREFIX, "sunsetbot.point.v0."), good);
  out.info.staleVerPresent = lsKeys("sunsetbot.point.v0.").length;
  State.cache = {};
  out.info.staleVerReq = await one(lat, lon, ds, per);
  out.checks.staleVerIgnored = out.info.staleVerPresent === 1 && out.info.staleVerReq > 0;

  /* ⑪ 版本残留（清理侧 · 手工触发）：不清理的话，每升一次版本就留下一批
       永远读不到、也永远删不掉的条目，只在配额账上占位。 */
  localStorage.setItem("sunsetbot.point.v0.2016-01-01|pm@23.1,113.3",
    JSON.stringify({ ts: Date.now(), obj: { gfsD: [] } }));
  out.info.staleSeed = lsKeys("sunsetbot.point.v0.").length;
  mapCacheSweep();
  out.info.staleAfterManual = lsKeys("sunsetbot.point.v0.").length;
  out.checks.staleSweptManual = out.info.staleSeed === 1 && out.info.staleAfterManual === 0;

  /* ⑪b 版本残留（清理侧 · 自动）：不该要求用户/代码显式调总闸门 ——
       任意一次落盘都会顺带收一遍，残留应在那一刻就没了。
       注意这里必须换坐标，否则会命中上面刚写好的缓存、不发生落盘。 */
  localStorage.setItem("sunsetbot.point.v0.2016-01-02|pm@23.1,113.3",
    JSON.stringify({ ts: Date.now(), obj: { gfsD: [] } }));
  out.info.staleSeedB = lsKeys("sunsetbot.point.v0.").length;
  State.cache = {};
  const kk2 = pointKeyOf(lat + 2, lon + 2, ds, per);
  await one(lat + 2, lon + 2, ds, per);
  /* 等**这一条具体的键**，不要等"总数 >= 1" —— 后者早就被别的键满足了，
     等于没等，待写的 put 会飘到后面某一步才落地（踩过一次）。 */
  await waitFor(() => localStorage.getItem(kk2) !== null, 4000);
  out.info.staleAfterAuto = lsKeys("sunsetbot.point.v0.").length;
  out.checks.staleSweptAuto = out.info.staleSeedB === 1 && out.info.staleAfterAuto === 0;

  /* ⑫ 总闸门对单点键族同样生效：灌入超限的异地条目，应收敛到 POINT_CACHE_MAX */
  localStorage.clear(); State.cache = {};
  for (let i = 0; i < POINT_CACHE_MAX + 4; i++) {
    localStorage.setItem("sunsetbot.point.v1.2016-01-0" + ((i % 9) + 1) + "|pm@" + (30 + i) + ".0,120.0",
      JSON.stringify({ ts: 1000 + i, obj: { gfsD: [], ecD: null, aqD: null } }));
  }
  out.info.sweepBefore = lsKeys(POINT_CACHE_PREFIX).length;
  mapCacheSweep();
  out.info.sweepAfter = lsKeys(POINT_CACHE_PREFIX).length;
  out.checks.sweepCaps = out.info.sweepBefore === POINT_CACHE_MAX + 4 && out.info.sweepAfter === POINT_CACHE_MAX;
  mapCacheSweep();
  out.checks.sweepIdempotent = lsKeys(POINT_CACHE_PREFIX).length === POINT_CACHE_MAX;

  /* ⑬ 注入路径（趋势 pre）**不得**写缓存：它用的是所选日期的样带几何，
       写进 (日期 D, 时段) 这个键会让 D 之后命中一份坐标不对的数据 */
  localStorage.clear();
  await sleep(400);          // 先让任何尚在路上的 put 落地…
  localStorage.clear();      // …再清一次，保证从这里开始的键数只由本步产生
  State.cache = {};
  await one(lat, lon, ds, per);
  await waitFor(() => lsKeys(POINT_CACHE_PREFIX).length === 1, 4000);
  const n0 = lsKeys(POINT_CACHE_PREFIX).length;
  const inj = pointCacheGet(lat, lon, ds, per);
  const fpts = TRANSECT.map(function (d, i) { return { lat: lat + i / 1000, lon: lon }; });
  await computeAll(lat, lon, ds, other, State.name, { bundle: inj, pts: fpts });
  await sleep(500);
  out.checks.preNoWrite = lsKeys(POINT_CACHE_PREFIX).length === n0;
  out.info.keysAfterPre = lsKeys(POINT_CACHE_PREFIX).length;

  /* ⑭ 单点缓存与地图缓存互不干扰：清空单点后地图条目仍在 */
  localStorage.clear();
  localStorage.setItem(MAP_CACHE_PREFIX + "2016-05-05@23.1,113.3",
    JSON.stringify({ ts: Date.now(), obj: { am: null, pm: null } }));
  out.info.mapKeySurvives = lsKeys(MAP_CACHE_PREFIX).length === 1;

  localStorage.clear();
  return JSON.stringify(out);
})()
`;

(async function main() {
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "cdpp-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + DBG, "--user-data-dir=" + udd, "--window-size=1200,900", "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });

  let ver = null;
  for (let i = 0; i < 60; i++) { try { ver = await jget("http://127.0.0.1:" + DBG + "/json/version"); break; } catch (e) { await sleep(500); } }
  if (!ver) { console.log("FAIL chrome 启动失败"); process.exit(1); }
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
      const ed = u.searchParams.get("end_date") || sd;
      const dof = Number(sd.slice(-2)) % 7 * 0.9;
      /* 逐小时序列必须覆盖**请求给出的整个窗口**，不能写死 24 小时。
         写死的话 bundle 体积只有真实值的三分之一（单点是 3 天 = 72 小时），
         而"一条缓存有多大"正是 POINT_CACHE_MAX 要依据的数 ——
         用偏小的数去定上限，等于把 localStorage 配额赌在没有依据的估计上。 */
      const pad = n => String(n).padStart(2, "0");
      const fmt = ms => { const d = new Date(ms);
        return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) +
          "T" + pad(d.getUTCHours()) + ":00"; };
      const t0 = Date.parse(sd + "T00:00:00Z"), t1 = Date.parse(ed + "T00:00:00Z");
      const nH = Math.max(24, Math.round((t1 - t0) / 3600000) + 24);
      const body = lats.map((la, i) => {
        const lo = lons[i] == null ? 0 : lons[i];
        const times = [];
        for (let h = 0; h < nH; h++) times.push(fmt(t0 + h * 3600000));
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
  let ok = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const r = await cdp.send("Runtime.evaluate", {
      expression: `(typeof computeAll==='function') && (typeof pointCacheGet==='function') && !State.busy`,
      returnByValue: true
    });
    if (r.result.value) { ok = true; break; }
  }
  if (!ok) { console.log("FAIL 页面未就绪（computeAll / pointCacheGet 不可用）"); process.exit(1); }

  const res = await cdp.send("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) { console.log("FAIL 脚本异常: " + JSON.stringify(res.exceptionDetails).slice(0, 900)); process.exit(1); }
  const O = JSON.parse(res.result.value);

  console.log("\n===== B1 单点结果缓存 =====");
  console.log("  查询点: " + O.info.lat + ", " + O.info.lon + "  " + O.info.date + " " + O.info.period);
  console.log("  缓存键: " + O.info.key);
  console.log("  前缀  : " + O.info.prefix + "  上限 " + O.info.max + " 条  TTL " + O.info.ttlH + " 小时");
  console.log("  bundle 体积: " + O.info.bundleChars + " 字符 / " + O.info.bundleUtf8 + " 字节");
  console.log("  单条落盘体积: " + O.info.entryChars + " 字符");
  console.log("");
  console.log("  请求账目（0 表示命中缓存、未发请求）");
  const row = (name, v) => console.log("    " + (name + "                    ").slice(0, 20) + v);
  row("① 首次取数", O.info.firstReq);
  row("② 会话内重复", O.info.memReq);
  row("③ 模拟刷新后", O.info.diskReq);
  row("④ 换时段", O.info.otherPerReq);
  row("⑤ 切回原时段", O.info.backReq);
  row("⑥ 换坐标", O.info.otherCoordReq);
  row("⑧ TTL 过期后", O.info.expiredReq);
  row("⑨ 残缺 bundle", O.info.brokenReq);
  row("⑩ 旧版本前缀", O.info.staleVerReq + "（旧键在场 " + O.info.staleVerPresent + " 条）");
  row("⑪ 残留 手工 前/后", O.info.staleSeed + " / " + O.info.staleAfterManual);
  row("⑪b 残留 自动 前/后", O.info.staleSeedB + " / " + O.info.staleAfterAuto);
  row("⑫ 总闸门 前/后", O.info.sweepBefore + " / " + O.info.sweepAfter);
  row("⑬ pre 注入后键数", O.info.keysAfterPre);

  const bad = Object.keys(O.checks).filter(k => !O.checks[k]);
  console.log("");
  for (const k of Object.keys(O.checks)) console.log((O.checks[k] ? "PASS" : "FAIL") + " " + k);

  await cdp.send("Browser.close").catch(() => { });
  chrome.kill(); srv.close();

  if (bad.length) { console.log("\nFAIL 计数: " + bad.length + "（" + bad.join(", ") + "）"); process.exit(1); }
  console.log("\n全部通过（" + Object.keys(O.checks).length + " 项）");
  process.exit(0);
})().catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
