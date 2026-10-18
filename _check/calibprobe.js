/* F4 探针 —— 实况回填与本地校准。
 *
 * 为什么必须**单独**写一个（而不是顺手加进 snapprobe）：
 *   这个功能有三条"看上去没什么"的纪律，而它们恰好就是它全部的价值所在：
 *     ① 校准值**不许改动**模型给出的概率与等级 —— 一旦改了，界面上就会出现
 *        "大字写 62%、校准行却说 80%" 这种两个数字互相矛盾的状态，而本项目
 *        最忌讳的正是这一类**静默**的自相矛盾；
 *     ② "没去 / 无法判断"**不许**当成"没有霞" —— 那是把缺席算成否定，会让
 *        校准被系统性低估，而且勤快标注的人偏得最少、懒得标的人偏得最多；
 *     ③ 样本不足时**不许**给结论 —— 三次标注就敢说"你这里实际八成能看到"
 *        是伪科学，比不给结论更糟。
 *   三条都不会报错、不会崩、不会打日志，只会安静地给出一个错的数字。
 *   所以判据必须逐条断死，而且第 ① 条要用**标注前后两次指纹比对**来量。
 *
 * 判据的"尺子"是探针里**另写一份**的分桶/命中实现（见 expectStats）——
 * 不复用页面任何中间字段。若哪天有人改了页面里的阈值而没同步这里，
 * A 组第 1 条会先报"常量不一致"，不会让后面的数值断言变成一团谜。
 *
 * 数据全部合成：拦截 open-meteo 回放合成响应，"过去日期的预报"这条真实链路
 * （URL 日期 → 算一次 → leadH<0 → 可标注）能完整走通，且**零额度**。
 *
 * 用法: node _check/calibprobe.js
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 47921;
const DEBUG_PORT = 9376;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CALIB_KEY = "sunsetbot.calib.v1";

/* ================= 合成气象数据（与 snapprobe 同一套，不花额度） ================= */
function gen(v, la, lo, h, isAQ) {
  const wob = Math.sin((la * 7 + lo * 3 + h) * 0.7) * 0.5 + 0.5;
  if (isAQ) {
    if (v === "aerosol_optical_depth") return 0.12 + wob * 0.2;
    if (v === "pm2_5") return 10 + wob * 30;
    return 5 + wob * 20;
  }
  switch (v) {
    case "temperature_2m": return 18 + wob * 8;
    case "dew_point_2m": return 10 + wob * 6;
    case "relative_humidity_2m": return 45 + wob * 30;
    case "cloud_cover_low": return 10 + wob * 20;
    case "cloud_cover_mid": return 20 + wob * 40;
    case "cloud_cover_high": return 30 + wob * 50;
    case "cloud_cover": return 30 + wob * 50;
    case "visibility": return 12000 + wob * 15000;
    case "pressure_msl": return 1010 + wob * 8;
    case "surface_pressure": return 1005 + wob * 8;
    case "wind_speed_10m": return 3 + wob * 6;
    case "wind_direction_10m": return wob * 360;
    case "wind_gusts_10m": return 6 + wob * 8;
    case "boundary_layer_height": return 400 + wob * 900;
    case "freezing_level_height": return 3500 + wob * 1500;
    case "precipitation": return wob * 0.6;
    case "cape": return wob * 900;
    case "shortwave_radiation": return 200 + wob * 400;
    case "dust": return wob * 20;
    default: return wob;
  }
}
function synthBody(reqUrl) {
  const u = new URL(reqUrl);
  const isAQ = u.host.indexOf("air-quality") >= 0;
  const lats = (u.searchParams.get("latitude") || "").split(",").filter(Boolean);
  const lons = (u.searchParams.get("longitude") || "").split(",").filter(Boolean);
  const vars = (u.searchParams.get("hourly") || "").split(",").filter(Boolean);
  const sD = u.searchParams.get("start_date"), eD = u.searchParams.get("end_date");
  const t0 = Date.parse(sD + "T00:00:00Z"), t1 = Date.parse(eD + "T23:00:00Z");
  const times = [];
  for (let ms = t0; ms <= t1; ms += 3600000) times.push(new Date(ms).toISOString().slice(0, 16));
  const out = lats.map((la, i) => {
    const A = +la, B = +lons[i];
    const hourly = { time: times };
    vars.forEach(v => {
      hourly[v] = times.map((_, k) => gen(v, A, B, new Date(t0 + k * 3600000).getUTCHours(), isAQ));
    });
    const o = { latitude: A, longitude: B, utc_offset_seconds: 28800, timezone: "Asia/Shanghai", hourly };
    const dv = u.searchParams.get("daily");
    if (dv) {
      const days = [];
      for (let ms = t0; ms <= t1; ms += 86400000) days.push(new Date(ms).toISOString().slice(0, 10));
      o.daily = { time: days };
      dv.split(",").filter(Boolean).forEach(v => {
        o.daily[v] = days.map(() => (v === "sunrise" ? "2026-10-13T05:50" : "2026-10-13T17:30"));
      });
    }
    return o;
  });
  return JSON.stringify(out);
}

function serve() {
  const idx = fs.readFileSync(path.join(ROOT, "index.html"));
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(idx);
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

/* ============ 探针侧的"第三方参考实现" ============
   刻意**不复用**页面上的任何中间字段：常量与算法都另写一份。
   这样"页面算错了"和"两边都错了"才能区分开。 */
const R_BUCKET = 20, R_HIT_MIN = 2, R_MIN_N = 8, R_MIN_BUCKET = 3, R_GRID = 0.5;
const rBucketOf = P => Math.min(Math.max(Math.floor(Math.min(Math.max(P, 0), 100) / R_BUCKET), 0), 4);
const rGroupOf = (lat, lon) => Math.round(lat / R_GRID) + "," + Math.round(lon / R_GRID);
function rStats(rows, lat, lon, P) {
  const g = rGroupOf(lat, lon);
  const valid = rows.filter(r => r.a >= 0 && rGroupOf(r.lat, r.lon) === g);
  const b = rBucketOf(P);
  const inB = valid.filter(r => rBucketOf(r.P) === b);
  const hit = inB.filter(r => r.a >= R_HIT_MIN).length;
  const pred = inB.length ? inB.reduce((s, r) => s + r.P, 0) / inB.length : null;
  const obs = inB.length ? hit / inB.length * 100 : null;
  return { b: b, lo: b * R_BUCKET, hi: (b + 1) * R_BUCKET, nAll: valid.length,
    nB: inB.length, hit: hit, pred: pred, obs: obs,
    enough: valid.length >= R_MIN_N && inB.length >= R_MIN_BUCKET };
}

(async function main() {
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "cal-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + DEBUG_PORT, "--user-data-dir=" + udd,
    "--window-size=1440,1200", "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let cerr = "";
  chrome.stderr.on("data", d => { cerr += d.toString(); });
  let ver = null;
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    try { ver = await (await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/version")).json(); break; } catch (e) { }
  }
  if (!ver) { console.log("CHROME_START_FAIL\n" + cerr.slice(0, 1200)); process.exit(1); }
  const list = await (await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/list")).json();
  const page = list.find(t => t.type === "page") || list[0];
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");

  /* 拦截所有请求：本地放行，open-meteo 回放合成响应，其余（腾讯瓦片 / 省界 /
     地图代理）一律 block —— 与 snapprobe 同一策略：探针只关心单点链路。 */
  const reqs = [];
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  cdp.on(async m => {
    if (m.method !== "Fetch.requestPaused") return;
    const { requestId, request } = m.params;
    const u = request.url;
    try {
      if (u.indexOf("http://127.0.0.1:" + PORT) === 0) { await cdp.send("Fetch.continueRequest", { requestId }); return; }
      if (u.indexOf("open-meteo.com") >= 0) {
        const k = u.indexOf("air-quality") >= 0 ? "aq" : "fc";
        reqs.push(k);
        await cdp.send("Fetch.fulfillRequest", {
          requestId, responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: "application/json" },
            { name: "Access-Control-Allow-Origin", value: "*" }
          ],
          body: Buffer.from(synthBody(u), "utf8").toString("base64")
        });
        return;
      }
      await cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
    } catch (e) { }
  });

  const logs = [];
  cdp.on(m => {
    if (m.method === "Runtime.consoleAPICalled") {
      logs.push(m.params.type + ": " + (m.params.args || []).map(a => a.value === undefined ? a.description : a.value).join(" "));
    }
    if (m.method === "Runtime.exceptionThrown") logs.push("EXC: " + (m.params.exceptionDetails || {}).text);
  });

  const q = async (expr) => (await cdp.send("Runtime.evaluate",
    { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  const fcN = () => reqs.filter(k => k === "fc").length;

  /* 导航完成判据必须**证明换了一份 document**，不能只看 readyState：
     `Page.navigate` 返回时旧文档往往还是 "complete"，于是第一次轮询就会
     当场通过、后面的操作全打在**上一页**上 —— 这是最隐蔽的一类假绿
     （每一步都"跑通"了，只是跑在了错误的页面上）。
     做法：导航前往 window 上打一个随机标记，之后等"标记不见了 + complete"。
     轮询期间执行上下文可能被销毁（Runtime.evaluate 会报错），所以整段 try 住。 */
  async function go(url) {
    const mark = "n" + Date.now() + "_" + Math.random();
    try { await q("window.__navMark=" + JSON.stringify(mark)); } catch (e) { }
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + url });
    for (let i = 0; i < 200; i++) {
      await sleep(100);
      let st;
      try {
        st = await q("(document.readyState === 'complete' && window.__navMark !== " +
          JSON.stringify(mark) + ") ? 'ok' : 'wait'");
      } catch (e) { st = "wait"; }
      if (st === "ok") return true;
    }
    /* 导航没完成必须**响** —— 静默继续会让后面一长串断言都打在旧页面上，
       报出来的失败点会指向完全无关的地方。 */
    throw new Error("导航未完成（200×100 ms 超时）：" + url);
  }
  /* 轮询等结果，不写固定 sleep（纪律：固定 sleep 等异步必然要么慢要么假红）。
     **判据里不能写 `window.State`**：`State` 是顶层 `const`，是**词法**全局，
     不是 window 的属性 ⇒ `window.State` 恒为 undefined，这条轮询会永远等下去
     （这一版踩过：8 处轮询各跑满预算，探针慢到被外层掐掉，而且"没结果"
     这件事本身不会报错 —— 是最典型的自指式假绿）。 */
  let waitMs = 0;
  async function waitResult(ms) {
    const t0 = Date.now();
    waitMs = 0;
    while (Date.now() - t0 < (ms || 40000)) {
      if (await q("typeof State !== 'undefined' && !!State.result && !!document.querySelector('#fac tbody tr')")) {
        waitMs = Date.now() - t0;
        return true;
      }
      await sleep(200);
    }
    waitMs = Date.now() - t0;
    return false;
  }
  const setRows = async (rows) => await q(
    "(function(){ localStorage.setItem('" + CALIB_KEY + "', " +
    JSON.stringify(JSON.stringify({ v: 1, rows: rows })) +
    "); calibReload(); renderCalibBox(); return calibRows().length; })()");
  const rowsNow = async () => JSON.parse(await q("JSON.stringify(calibRows())"));
  const statTxt = async () => await q("(document.querySelector('#calibStat')||{}).textContent || ''");
  const headTxt = async () => await q("(document.querySelector('#calibHead')||{}).textContent || ''");
  const boxHidden = async () => await q("document.querySelector('#calibBox').hidden");
  const boxDisplay = async () => await q("getComputedStyle(document.querySelector('#calibBox')).display");
  /* 模型输出的"指纹"：校准若改了任何一个数字，这里立刻对不上。
     视觉方案 P1 起，普通 hero 的概率环退役、改衬线大字（.hero-num）——
     指纹字段跟着换，**不能丢概率**：它是最该守住的那个数。 */
  const heroSig = async () => await q(
    "(function(){ var h=document.querySelector('#hero');" +
    "var num=h.querySelector('.hero-num');" +
    "return JSON.stringify({pct:num?num.textContent:''," +
    "big:(h.querySelector('.big')||{}).textContent||''," +
    "badge:(h.querySelector('.cfbadge b')||{}).textContent||''," +
    "models:Array.prototype.slice.call(document.querySelectorAll('#models .mnum')).map(function(e){return e.textContent;}).join('|')," +
    "facN:document.querySelectorAll('#fac tbody tr').length}); })()");

  const DAY = 86400000;
  const PAST = new Date(Date.now() - 3 * DAY).toISOString().slice(0, 10);
  const FUT = new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10);
  const NM = encodeURIComponent("广州市");
  const base = "/?lat=23.1291&lon=113.2644&name=" + NM + "&period=pm&date=";
  const URL_PAST = base + PAST, URL_FUT = base + FUT;

  /* ================= 0. 过去日期：真实跑一轮（走合成数据） ================= */
  await go(URL_PAST);
  const okPast = await waitResult();
  const firstWaitMs = waitMs;
  const lat = await q("State.result ? State.result.lat : 0");
  const lon = await q("State.result ? State.result.lon : 0");
  const P0 = await q("State.result ? State.result.P : 0");
  const leadH = await q("State.result ? Math.round(State.result.leadH) : 0");
  const gate = JSON.parse(await q(
    "JSON.stringify({can:calibCanAnnotate(State.result), marks:CALIB_MARKS.slice()," +
    "segN:document.querySelectorAll('#calibSeg button').length," +
    "on:document.querySelectorAll('#calibSeg button.on').length," +
    "pressed:Array.prototype.slice.call(document.querySelectorAll('#calibSeg button')).filter(function(b){return b.getAttribute('aria-pressed')==='true';}).length," +
    "consts:[CALIB_GRID_DEG,CALIB_BUCKET,CALIB_HIT_MIN,CALIB_MIN_N,CALIB_MIN_BUCKET,CALIB_MAX,CALIB_AFTER_H]," +
    "snapHide:document.querySelector('#calibBox').hasAttribute('data-snaphide')})"));

  /* 纯函数：分桶边界、分组网格、坏值白名单 */
  const pure = JSON.parse(await q(
    "JSON.stringify({" +
    "bk:[-5,0,19.9,20,39.9,40,59.9,60,79.9,80,100,140].map(calibBucketOf)," +
    "g1:calibGroupOf(23.1,113.2)===calibGroupOf(23.24,113.2)," +
    "g2:calibGroupOf(23.1,113.2)===calibGroupOf(23.7,113.2)," +
    "okRow:!!calibClean({lat:23.1,lon:113.2,date:'2026-10-13',period:'pm',P:60,Q:70,a:2,t:1})," +
    "badA:calibClean({lat:23.1,lon:113.2,date:'2026-10-13',period:'pm',P:60,Q:70,a:null})," +
    "badA2:calibClean({lat:23.1,lon:113.2,date:'2026-10-13',period:'pm',P:60,Q:70,a:9})," +
    "badLat:calibClean({lat:999,lon:113.2,date:'2026-10-13',period:'pm',P:60,Q:70,a:2})," +
    "badLat2:calibClean({lat:'23.1',lon:113.2,date:'2026-10-13',period:'pm',P:60,Q:70,a:2})," +
    "badDate:calibClean({lat:23.1,lon:113.2,date:'2026/10/13',period:'pm',P:60,Q:70,a:2})," +
    "badPer:calibClean({lat:23.1,lon:113.2,date:'2026-10-13',period:'xx',P:60,Q:70,a:2})," +
    "badObj:calibClean('nope')" +
    "})"));

  /* ================= 1. 统计口径 =================
     样本全部由探针自己造：P 取"当前这一档以内"的值，于是分桶可预期。 */
  const st0 = rStats([], lat, lon, P0);
  const inB = (off) => Math.min(st0.lo + off, st0.hi - 0.01);
  const row = (a, P, dla, dlo) => ({ lat: lat + (dla || 0), lon: lon + (dlo || 0),
    date: PAST, period: "pm", P: P, Q: 70, a: a, t: 1 });

  /* ① "无法判断"（a=-1）不进统计；a=1 不算出现、a=2 算 */
  const NA = [];
  for (let i = 0; i < 5; i++) NA.push(row(-1, inB(2)));
  await setRows(NA);
  const naTxt = await statTxt();
  const naProgress = await q("!!document.querySelector('#calibStat .cbprog')");

  /* ② 同桶 4 条：a=3 / a=2 各算一次"出现"，a=1 / a=0 不算 ⇒ obs=50%。
        另在**别的档**放 6 条 —— 档位必须离当前档足够远：当前档就是 0 时用 90+，
        否则用 3+（3+ 与 90+ 都不可能与当前档重合）。 */
  const SAME = [row(3, inB(2)), row(2, inB(5)), row(1, inB(8)), row(0, inB(11))];
  const otherBase = (st0.b === 0) ? 90 : 3;
  const OTHER = [];
  for (let i = 0; i < 6; i++) OTHER.push(row(3, otherBase + i));
  const ALL = SAME.concat(OTHER);
  await setRows(ALL);
  const e1 = rStats(ALL, lat, lon, P0);
  const t1 = await statTxt();
  const title1 = await q("(document.querySelector('#calibStat .cbsh b')||{}).textContent || ''");

  /* ③ 样本不足就**不给**结论（把别的档那些去掉 ⇒ nAll=4 < 8，虽然本桶=4 ≥ 3） */
  await setRows(SAME);
  const e2 = rStats(SAME, lat, lon, P0);
  const prog2 = await q("!!document.querySelector('#calibStat .cbprog')");
  const title2 = await q("(document.querySelector('#calibStat .cbsh b')||{}).textContent || ''");

  /* ④ 只有**同一片区域**才算（远处 0.6° 之外的 12 条全不算） */
  const FAR = [];
  for (let i = 0; i < 12; i++) FAR.push(row(3, inB(2), 0.6, 0));
  FAR.push(row(3, inB(2)));                                    /* 只有这一条是同组 */
  await setRows(FAR);
  const e3 = rStats(FAR, lat, lon, P0);
  const prog3 = await q("!!document.querySelector('#calibStat .cbprog')");

  /* ================= 2. 模型输出不受影响（标注前后指纹） ================= */
  await setRows([]);
  const sigBefore = await heroSig();
  await setRows(ALL);
  const sigAfter = await heroSig();
  await setRows(NA);                        /* 只有"无法判断"时也一样 */
  const sigNA = await heroSig();

  /* 刷新一次，确认"加载路径"（而不是只有手动重渲）也一致 */
  await go(URL_PAST);
  await waitResult();
  const sigReloadNoRows = await heroSig();

  /* ================= 3. 端到端交互 ================= */
  await go(URL_PAST);
  await waitResult();
  await setRows([]);
  const beforeClick = await rowsNow();
  reqs.length = 0;
  /* CALIB_MARKS = [-1, 0, 1, 2, 3, 4]，所以下标 2 → a=1、下标 4 → a=3 */
  await q("document.querySelectorAll('#calibSeg button')[2].click()");     /* a = 1 */
  await sleep(200);
  const afterOne = await rowsNow();
  const segOne = JSON.parse(await q(
    "JSON.stringify({on:document.querySelectorAll('#calibSeg button.on').length," +
    "pressed:Array.prototype.slice.call(document.querySelectorAll('#calibSeg button')).filter(function(b){return b.getAttribute('aria-pressed')==='true';}).length," +
    "idx:Array.prototype.indexOf.call(document.querySelectorAll('#calibSeg button'),document.querySelector('#calibSeg button.on'))})"));
  await q("document.querySelectorAll('#calibSeg button')[4].click()");     /* 改成 a = 3 */
  await sleep(200);
  const afterTwo = await rowsNow();
  const segTwo = JSON.parse(await q(
    "JSON.stringify({on:document.querySelectorAll('#calibSeg button.on').length," +
    "idx:Array.prototype.indexOf.call(document.querySelectorAll('#calibSeg button'),document.querySelector('#calibSeg button.on'))})"));
  const clickFc = fcN();

  /* 未来时段：不给标注入口 */
  await go(URL_FUT);
  await waitResult();
  const fut = JSON.parse(await q(
    "JSON.stringify({can:calibCanAnnotate(State.result)," +
    "segN:document.querySelectorAll('#calibSeg button').length," +
    "hidden:document.querySelector('#calibBox').hidden," +
    "txt:(document.querySelector('#calibHead')||{}).textContent||''})"));

  /* 关闭 / 数据仍在 / 持久化 / 重开 */
  await go(URL_PAST);
  await waitResult();
  await setRows(SAME);
  await q("(function(){var c=document.querySelector('#calibOff');c.checked=true;" +
    "c.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await sleep(200);
  const off = JSON.parse(await q(
    "JSON.stringify({hidden:document.querySelector('#calibBox').hidden," +
    "rows:calibRows().length," +
    "pref:JSON.parse(localStorage.getItem('sunsetbot.pref.v1')||'{}').calibOff})"));
  await go(URL_PAST);
  await waitResult();
  const persisted = JSON.parse(await q(
    "JSON.stringify({hidden:document.querySelector('#calibBox').hidden," +
    "rows:calibRows().length," +
    "boxChecked:document.querySelector('#calibOff').checked})"));
  await q("(function(){var c=document.querySelector('#calibOff');c.checked=false;" +
    "c.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await sleep(200);
  const backOn = await boxHidden();

  /* 清空：confirm 打桩为"确认"，不弹窗 */
  await q("window.confirm=function(){return true;}");
  await q("document.querySelector('#calibClear').click()");
  await sleep(200);
  const cleared = JSON.parse(await q(
    "JSON.stringify({rows:calibRows().length," +
    "stored:JSON.parse(localStorage.getItem('" + CALIB_KEY + "')||'{}').rows.length," +
    "prog:!!document.querySelector('#calibStat .cbprog')," +
    "txt:(document.querySelector('#calibStat')||{}).textContent||''})"));

  /* ================= 4. 坏数据 / 恶意载荷 ================= */
  const evil = [];
  evil.push({ lat: 23.1, lon: 113.2, date: "<img src=1 onerror=window.__p1=1>", period: "pm", P: 60, Q: 70, a: 2, t: 1 });
  evil.push({ lat: null, lon: 113.2, date: PAST, period: "pm", P: 60, Q: 70, a: 2, t: 1 });
  evil.push({ lat: 23.1, lon: 113.2, date: PAST, period: "pm", P: 60, Q: 70, a: null, t: 1 });
  evil.push({ lat: 23.1, lon: 113.2, date: PAST, period: "pm", P: 60, Q: 70, a: 99, t: 1 });
  evil.push({ lat: 23.1, lon: 113.2, date: PAST, period: "pm", P: 60, Q: 70, a: 2, t: 1, extra: "<script>x</script>" });
  evil.push("not-an-object");
  const evilLen = await setRows(evil);
  const evilDom = JSON.parse(await q(
    "JSON.stringify({rows:calibRows().length," +
    "valid:calibRows().filter(function(r){return r.date==='" + PAST + "';}).length," +
    "imgs:document.querySelectorAll('#calibBox img, #calibBox script, #calibBox iframe').length," +
    "attr:document.querySelectorAll('#calibBox [onerror], #calibBox [onload], #calibBox [onclick]').length," +
    "html:(document.querySelector('#calibBox')||{}).innerHTML||''})"));
  const pwned = await q("typeof window.__p1");

  /* 存储层直接塞一段垃圾（非对象 / rows 不是数组） */
  const garbage = [];
  for (const raw of ["null", "[]", "{\"v\":1}", "{\"v\":1,\"rows\":\"x\"}", "{oops", "\"str\""]) {
    garbage.push(await q("(function(){ try{ localStorage.setItem('" + CALIB_KEY + "', " +
      JSON.stringify(raw) + "); }catch(e){} calibReload(); renderCalibBox();" +
      "return calibRows().length + '|' + document.querySelector('#calibBox').hidden; })()"));
  }

  /* ================= 5. 快照模式整块收起 ================= */
  await go(URL_PAST);
  await waitResult();
  await setRows(SAME);
  const snapLink = await q("snapUrl()");
  await go(snapLink.replace("http://127.0.0.1:" + PORT, ""));
  await sleep(900);
  const inSnap = JSON.parse(await q(
    "JSON.stringify({snap:!!State.snap, disp:getComputedStyle(document.querySelector('#calibBox')).display," +
    "hidden:document.querySelector('#calibBox').hidden," +
    "segN:document.querySelectorAll('#calibSeg button').length})"));

  /* ================= 6. 英文界面 ================= */
  await go(URL_PAST + "&lang=en");
  await waitResult();
  await setRows(ALL);
  const enStat = await statTxt();
  const enHead = await headTxt();

  /* ================= 汇总 ================= */
  const rxStat = /模型在 (\d+)–(\d+)% 这一档平均报 (\d+)%；你标注的 (\d+) 次实况中实际出现 (\d+)%（(\d+) 次），偏差 ([+-]\d+) 个百分点。该位置共 (\d+) 次标注。/;
  const m1 = rxStat.exec(t1);
  const expNum = [e1.lo, e1.hi, Math.round(e1.pred), e1.nB, Math.round(e1.obs), e1.hit, e1.nAll];
  const expSign = (e1.obs - e1.pred >= 0 ? "+" : "-") + Math.round(Math.abs(e1.obs - e1.pred));
  /* 捕获组 1..8 里第 7 个是**带符号**的偏差，其余是纯数字 ⇒ 分开比。 */
  const parsed = m1 ? [1, 2, 3, 4, 5, 6, 8].map(i => Number(m1[i])) : null;
  const numsMatch = !!m1 && JSON.stringify(parsed) === JSON.stringify(expNum) && m1[7] === expSign;

  const A = {
    /* --- A 组：常量与纯函数 --- */
    "A 页面常量与探针参考实现一致（改阈值必须同步探针，否则后面的数值断言会变成谜）":
      gate.consts[0] === R_GRID && gate.consts[1] === R_BUCKET && gate.consts[2] === R_HIT_MIN &&
      gate.consts[3] === R_MIN_N && gate.consts[4] === R_MIN_BUCKET,
    "A calibBucketOf 分桶边界正确且越界夹紧":
      JSON.stringify(pure.bk) === JSON.stringify([0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4]),
    "A 归组网格：0.14° 同组、0.6° 不同组": pure.g1 === true && pure.g2 === false,
    "A 坏行一律丢弃（非对象 / 坐标系字符串 / 越界纬度 / 坏日期 / 坏时段 / 缺标注档 / 档位越界）":
      pure.okRow === true && pure.badObj === null && pure.badA === null && pure.badA2 === null &&
      pure.badLat === null && pure.badLat2 === null && pure.badDate === null && pure.badPer === null,
    "A 标注档位六档且含「无法判断」（a=-1）": gate.marks.length === 6 && gate.marks[0] === -1,

    /* --- B 组：统计口径 --- */
    "B 「无法判断」不进统计：5 条 a=-1 之后仍是进度态、不给校准值":
      naProgress === true && naTxt.indexOf("0 次实况标注") >= 0,
    "B 样本够了才给校准值，且校准句里的每个数字都与参考实现逐项相同":
      title1.indexOf("本地校准") >= 0 && numsMatch === true,
    "B 「实际出现」按 a≥2 计（a=1 / a=0 不算）：同一批里 4 条只认 2 条":
      !!m1 && Number(m1[6]) === e1.hit && e1.hit === 2 && e1.nB === 4,
    "B 只统计**同一片区域**：0.6° 之外的 12 条不计入（nAll=1 ⇒ 进度态）":
      e3.nAll === 1 && prog3 === true,
    "B 样本不足就不给结论（本桶 4 条但总数 4 < 8 ⇒ 只有进度、没有校准值）":
      e2.nAll === 4 && e2.nB === 4 && e2.enough === false && prog2 === true && title2 === "",

    /* --- C 组：端到端 --- */
    "C 过去日期（leadH<0）的结果里出现标注入口，且 6 个按钮都没有预选":
      okPast === true && leadH <= -1 && gate.can === true && gate.segN === 6 &&
      gate.on === 0 && gate.pressed === 0,
    "C 未来时段不给标注入口，只说明“等事后回来标”":
      fut.can === false && fut.segN === 0 && fut.hidden === false && fut.txt.indexOf("未来时段") >= 0,
    "C 点一档：落盘 + 按钮选中态与 aria-pressed 同步（各恰一个）":
      beforeClick.length === 0 && afterOne.length === 1 && afterOne[0].a === 1 &&
      afterOne[0].date === PAST && afterOne[0].period === "pm" &&
      Math.abs(afterOne[0].lat - lat) < 0.02 && segOne.on === 1 && segOne.pressed === 1 && segOne.idx === 2,
    "C 再点另一档是**改写**上一次（条数不变、值被改），不是又记一笔":
      afterTwo.length === 1 && afterTwo[0].a === 3 && segTwo.on === 1 && segTwo.idx === 4,
    "C 标注与重渲全程 0 次气象请求（整个功能不取数）": clickFc === 0,
    "C **校准不改模型输出**：标注前后，概率/结论句/可信度/环形偏移/模型卡/因素表逐字符相同":
      sigBefore === sigAfter && sigBefore === sigNA && sigReloadNoRows === sigBefore,
    "C 关闭开关：整块隐藏，但**数据一条不删**；偏好落盘": 
      off.hidden === true && off.rows === SAME.length && off.pref === true,
    "C 关闭状态刷新后仍生效，且数据仍在（关闭 ≠ 清空）":
      persisted.hidden === true && persisted.rows === SAME.length && persisted.boxChecked === true,
    "C 重新打开开关即恢复显示": backOn === false,
    "C 清空：内存与磁盘都归零，并回到进度态":
      cleared.rows === 0 && cleared.stored === 0 && cleared.prog === true && cleared.txt.indexOf("0 次实况标注") >= 0,
    "C 坏行全部丢弃：6 条里只有 1 条合法（其余字段类型/取值越界）":
      evilLen === 1 && evilDom.rows === 1 && evilDom.valid === 1,
    "C 恶意载荷（date 里塞 <img onerror>）不产生元素、不产生 on* 属性、不执行":
      evilDom.imgs === 0 && evilDom.attr === 0 && evilDom.html.indexOf("onerror=") < 0 &&
      evilDom.html.indexOf("<img") < 0 && pwned === "undefined",
    "C 存储层塞进垃圾（null / [] / 缺 rows / rows 非数组 / 截断 JSON / 裸字符串）都不崩且读成 0 条":
      garbage.every(s => s.split("|")[0] === "0"),
    "C 快照模式下整块 display:none（别人分享来的结论不该标成自己的实况）":
      inSnap.snap === true && inSnap.disp === "none" && inSnap.segN === 0,
    "C 界面切英文后，标注提问与校准句都是英文":
      /Local calibration/.test(enHead) === false && /Did you actually see a glow/.test(enHead) === true &&
      /band the model averaged/.test(enStat) === true
  };

  console.log("=== F4 实况回填与本地校准探针 ===");
  const errs = logs.filter(x => x.indexOf("EXC") === 0);
  console.log("  页面异常 " + errs.length + " 条" + (errs.length ? "：\n    " + errs.slice(0, 3).join("\n    ").slice(0, 600) : ""));
  console.log("  过去日期 " + PAST + " 的结果 P = " + P0.toFixed(1) + "% · leadH " + leadH + " h · 可标注 " + gate.can);
  console.log("  首屏判据 okPast=" + okPast + "（首轮轮询 " + firstWaitMs + " ms）· 标注按钮 " + gate.segN +
    " 个 · .on " + gate.on + " · aria-pressed=true " + gate.pressed + " · data-snaphide " + gate.snapHide);
  console.log("  当前档 " + st0.lo + "–" + st0.hi + "%（bucket " + st0.b + "）");
  console.log("  校准句（同桶 4 条 + 别档 6 条）：" + t1.replace(/\s+/g, " ").slice(0, 150));
  console.log("  参考实现期望：" + JSON.stringify(expNum) + " 偏差 " + expSign +
    " · 页面读出：" + JSON.stringify(parsed) + " 偏差 " + (m1 ? m1[7] : "-"));
  console.log("  进度句（清空后）：" + String(cleared.txt).replace(/\s+/g, " ").slice(0, 120));
  console.log("  标注前后模型指纹：" + (sigBefore === sigAfter ? "完全相同 ✔" : "不同 ✘") +
    "（指纹长度 " + String(sigBefore).length + " 字符）");
  console.log("  点击后落盘 " + JSON.stringify(afterTwo));
  console.log("  坏行注入 6 条 → 有效 " + evilDom.rows + " 条 · 元素 " + evilDom.imgs + " · on* " + evilDom.attr +
    " · __p1 " + pwned);
  console.log("  英文：" + enHead.replace(/\s+/g, " ").slice(0, 60) + " | " + enStat.replace(/\s+/g, " ").slice(0, 90));
  console.log("\n--- 断言 ---");
  let fail = 0;
  for (const k of Object.keys(A)) {
    if (!A[k]) { console.log("  FAIL " + k); fail++; } else console.log("  ok   " + k);
  }
  console.log("\nFAIL 计数: " + fail);
  console.log('FACTS {"assertions":' + Object.keys(A).length + ',"fail":' + fail + '}');
  try { chrome.kill(); } catch (e) { }
  srv.close();
  process.exit(fail);
})().catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
