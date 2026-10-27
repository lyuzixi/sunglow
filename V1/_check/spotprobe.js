/* F3 / F2 探针 —— 拦截网络、用合成数据跑真实链路，重点量**额度纪律**。
 *
 * 为什么必须拦网络而不是"只测渲染函数"：
 *   F3 与 F2 的设计承诺是「**零/低额度**」——
 *     · F3 只读 State.trend.rows，渲染日历一次请求都不该产生；
 *     · F2 命中单点缓存的点**不进请求**，请求里只剩未命中的坐标。
 *   这两条只有在**真实链路上数请求**才算数；直接调渲染函数是测不到的。
 *   实测口径：拦截 Fetch，按 URL 记下每次请求的端点与坐标数，再拿操作前后
 *   的计数差做断言（"渲染不取数"就是"计数不变"）。
 *
 * 同时接的还有：F2 的收藏上限 / 重复收藏 / 脏数据降级 / 持久化 /
 * 以及**三处失效**（换地点、换日期、换时段都必须让对比结果作废）。
 *
 * 用法: node _check/spotprobe.js
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 47911;
const DEBUG_PORT = 9368;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- 合成数据：结构必须与 Open-Meteo 一致（computeAll / makeSeries 要吃它） ---- */
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

(async function main() {
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "sp-"));
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

  /* ---- 请求账本：按端点分类，并记下每次请求的坐标数 ---- */
  const reqs = [];   // { kind, n, url }
  let fulfillOn = true;
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  cdp.on(async m => {
    if (m.method !== "Fetch.requestPaused") return;
    const { requestId, request } = m.params;
    const u = request.url;
    try {
      if (u.indexOf("http://127.0.0.1:" + PORT) === 0) {
        await cdp.send("Fetch.continueRequest", { requestId }); return;
      }
      const isMeteo = u.indexOf("open-meteo.com") >= 0;
      if (isMeteo) {
        const k = u.indexOf("air-quality") >= 0 ? "aq" : "fc";
        const n = (new URL(u).searchParams.get("latitude") || "").split(",").filter(Boolean).length;
        reqs.push({ kind: k, n: n });
        if (fulfillOn) {
          const body = synthBody(u);
          await cdp.send("Fetch.fulfillRequest", {
            requestId, responseCode: 200,
            responseHeaders: [
              { name: "Content-Type", value: "application/json" },
              /* 跨域！没有这一行浏览器直接判 Failed to fetch ——
                 页面在 127.0.0.1 上、接口在 open-meteo.com 上，
                 合成响应同样要走 CORS 这道门。 */
              { name: "Access-Control-Allow-Origin", value: "*" }
            ],
            body: Buffer.from(body, "utf8").toString("base64")
          });
          return;
        }
      }
      await cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
    } catch (e) { }
  });

  /* 捕获页面 console：软失败（softWarn）只打 warn，不抛出来，
     "趋势算不出结果"这类静默失败必须靠它才看得见 */
  const logs = [];
  cdp.on(m => {
    if (m.method === "Runtime.consoleAPICalled") {
      logs.push(m.params.type + ": " + (m.params.args || []).map(a => a.value === undefined ? a.description : a.value).join(" "));
    }
    if (m.method === "Runtime.exceptionThrown") logs.push("EXC: " + (m.params.exceptionDetails || {}).text);
  });
  const q = async (expr) => (await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  async function go(url) {
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + url });
    for (let i = 0; i < 60; i++) {
      await sleep(200);
      if (await q("document.readyState") === "complete") break;
    }
    await sleep(400);
  }
  const nreq = () => reqs.length;
  const fcReqs = () => reqs.filter(r => r.kind === "fc");
  const click = async (sel) => { await q("document.querySelector('" + sel + "').click()"); await sleep(300); };
  const waitIdle = async (ms) => { await sleep(ms || 900); };

  /* ================= F3 ================= */
  await go("/");
  await q("localStorage.clear()");
  await go("/");
  const r0 = nreq();
  await click("#trendGo");                 // 加载趋势（这一步本来就该取数）
  await waitIdle(2500);
  const rTrend = nreq() - r0;
  const calInfo = JSON.parse(await q(`(function(){
    var cells = document.querySelectorAll("#trendCal .tcal-d");
    var rows = (State.trend && State.trend.rows) || [];
    var best = document.querySelectorAll("#trendCal .tcal-d.best").length;
    /* 手工按 Q 排序，与页面上"最值得去"的前三名对账 */
    var flat = [];
    rows.forEach(function(r){ ["am","pm"].forEach(function(p){ if (r[p]) flat.push(r[p].Q); }); });
    flat.sort(function(a,b){ return b-a; });
    return JSON.stringify({ cells: cells.length, rows: rows.length, best: best,
      top3: flat.slice(0,3), sumText: (document.querySelector("#trendCal .tcal-sum")||{}).textContent || "" });
  })()`));

  /* 切语言 + 切主题：日历要重画，但**一次请求都不该发** */
  const rA = nreq();
  await q("setLang('en')"); await sleep(250);
  await q("document.querySelector('#themeSeg button[data-theme-k=dark]').click()"); await sleep(250);
  const rRender = nreq() - rA;
  await q("setLang('zh')");

  /* 点日历格：切日期/时段，走缓存 ⇒ 也不该发请求 */
  const rB = nreq();
  const beforeDate = await q("State.dateStr + '|' + State.period");
  /* 点**最后**一格：第一格很可能就是"今天"（与当前 State 相同），那样日期不变、
     断言会因为"没变化"而失败 —— 那是判据的坑，不是功能的坑。 */
  await q("(function(){ var c = document.querySelectorAll('#trendCal .tcal-d'); c[c.length-1].click(); })()");
  await waitIdle(2500);
  const afterDate = await q("State.dateStr + '|' + State.period");
  const rClick = nreq() - rB;

  /* ================= F2 ================= */
  const addSpot = async (la, lo, nm) => {
    await q("State.lat=" + la + ";State.lon=" + lo + ";State.name='" + nm + "';spotAdd();");
    await sleep(120);
  };
  await q("localStorage.removeItem('sunsetbot.spots.v1')");
  await go("/");
  const emptyBody = await q("document.querySelector('#spotBody').textContent.trim().length");
  const rE = nreq();
  await click("#spotGo");
  await waitIdle(600);
  const rEmpty = nreq() - rE;
  await addSpot(23.1291, 113.2644, "广州");
  await click("#spotAdd");                    // 真实按钮走一遍（同坐标 ⇒ 应被拒）
  const dupMsg = await q("State.spotMsg");
  const n1 = await q("(State.spots||[]).length");
  await addSpot(31.2304, 121.4737, "上海");
  await addSpot(39.9042, 116.4074, "北京");
  const n3 = await q("(State.spots||[]).length");
  const chips = await q("document.querySelectorAll('#spotList .sp-chip').length");

  const missBefore = await q("spotMissCount()");   /* 未命中缓存的点数（首屏查过广州 ⇒ 它算命中） */
  const fcBefore = fcReqs().length;
  const rC = nreq();
  await click("#spotGo");
  await waitIdle(2600);
  /* 只统计"这次点击"产生的请求：全会话累计会把首屏单点、趋势那些也算进来
     （第一版就这么错了：把趋势的 34 坐标请求算进了对比的账里）。 */
  const seg = fcReqs().slice(fcBefore);
  const rCmp = seg.length;
  const cmpReqs = seg.map(r => r.n);
  const tbl = JSON.parse(await q(`(function(){
    var rows = document.querySelectorAll(".t-spot tbody tr");
    var qs = [];
    rows.forEach(function(tr){
      var tds = tr.querySelectorAll("td");
      qs.push(parseFloat((tds[2].textContent||"").replace(/[^0-9.]/g,"")));
    });
    return JSON.stringify({ rows: rows.length, qs: qs,
      cached: document.querySelectorAll(".t-spot tbody tr td.nm i").length });
  })()`));

  /* 再点一次：全部命中缓存 ⇒ 零新请求 */
  const rD = nreq();
  await click("#spotGo");
  await waitIdle(2200);
  const rAgain = nreq() - rD;

  /* 失效：换地点 / 换日期 / 换时段 */
  const aliveAfterMove = await q("(function(){ setLocation(1.3521,103.8198,'新加坡',''); return State.spotRows===null; })()");
  await click("#spotGo"); await waitIdle(2200);          // 重新算出来，供下面两条测
  const aliveAfterDate = await q("(function(){ document.querySelector('#date').value='2026-10-20'; saveDate(); return State.spotRows===null; })()");
  await click("#spotGo"); await waitIdle(2200);
  const aliveAfterPeriod = await q("(function(){ document.querySelector('#periodSeg button[data-p=am]').click(); return State.spotRows===null; })()");

  /* 上限：加到第 6 个应被拒 */
  await q("localStorage.removeItem('sunsetbot.spots.v1')");
  await go("/");
  for (let i = 0; i < 5; i++) await addSpot(20 + i, 100 + i, "P" + i);
  const nMax = await q("(State.spots||[]).length");
  await addSpot(30.5, 111.5, "溢出");
  const nAfter6 = await q("(State.spots||[]).length");
  const fullMsg = await q("State.spotMsg");

  /* 持久化：重载后列表还在 */
  await go("/");
  const nAfterReload = await q("(State.spots||[]).length");

  /* 脏数据降级：塞入越界坐标 / 非数组 / 坏 JSON */
  await q("localStorage.setItem('sunsetbot.spots.v1', JSON.stringify([{lat:999,lon:0,name:'坏'},{lat:23.1,lon:113.3,name:'<img src=x>'},{lat:'x',lon:1},{lat:30,lon:120,name:'好'}]))");
  await go("/");
  const dirty = JSON.parse(await q(`(function(){
    var l = State.spots||[];
    return JSON.stringify({ n: l.length, ok: l.every(function(s){ return Math.abs(s.lat)<=90 && Math.abs(s.lon)<=180; }),
      safe: l.every(function(s){ return s.name.indexOf("<")<0; }) });
  })()`));
  await q("localStorage.setItem('sunsetbot.spots.v1', '{不是 JSON')");
  await go("/");
  const badJsonN = await q("(State.spots||[]).length");

  const A = {
    "F3 加载趋势会产生取数请求（基准：本来就要取）": rTrend >= 3,
    "F3 日历格子数 = 趋势天数": calInfo.cells === calInfo.rows && calInfo.rows >= 7,
    "F3 日历标出 1–3 个“最值得去”窗口": calInfo.best >= 1 && calInfo.best <= 3,
    "F3 “最值得去”一行的最高分 = 全表最高 Q":
      calInfo.top3.length > 0 && calInfo.sumText.indexOf(String(Math.round(calInfo.top3[0]))) >= 0,
    "F3 切语言 + 切主题重画日历：零取数": rRender === 0,
    "F3 点日历格会切到那天的那个时段（并照常走一次单点取数，≤6 次请求）":
      beforeDate !== afterDate && rClick <= 6 && rClick >= 1,
    "F2 收藏按钮生效、列表渲染出 3 个点": n3 === 3 && chips === 3,
    "F2 重复收藏同一地点被拒（数量不变 + 有提示）": n1 === 1 && dupMsg.length > 0,
    "F2 对比：只发 2 类请求（GFS/EC 各一次），坐标数 = **未命中缓存的点数** × 17":
      rCmp === 2 && missBefore >= 1 && missBefore <= 3 &&
      cmpReqs[0] === missBefore * 17 && cmpReqs[1] === missBefore * 17,
    "F2 已在缓存里的点不进请求（命中数 = 总量 − 请求里的点数）":
      missBefore < 3 && tbl.cached >= 1,
    "F2 对比表按质量分降序": tbl.rows === 3 && tbl.qs.length === 3 &&
      tbl.qs.every((v, i) => i === 0 || tbl.qs[i - 1] >= v),
    "F2 再点一次对比：全部命中缓存 ⇒ 零请求": rAgain === 0,
    "F2 结果标出“已缓存”": tbl.cached >= 1,
    "F2 换地点 ⇒ 对比结果作废": aliveAfterMove === true,
    "F2 换日期 ⇒ 对比结果作废": aliveAfterDate === true,
    "F2 换时段 ⇒ 对比结果作废": aliveAfterPeriod === true,
    "F2 收藏上限 5：第 6 个被拒且给出提示": nMax === 5 && nAfter6 === 5 && fullMsg.length > 0,
    "F2 收藏列表跨重载持久化": nAfterReload === 5,
    "F2 脏数据降级：越界/非数值被丢弃，名字走白名单": dirty.n === 2 && dirty.ok === true && dirty.safe === true,
    "F2 坏 JSON 不崩、当没有收藏": badJsonN === 0
  };
  const o = Object.assign({}, A, {
    "F2 未收藏任何点时：对比按钮零请求、只给引导文案": emptyBody > 0 && rEmpty === 0
  });

  console.log("=== F3 / F2 探针 ===");
  const errs = logs.filter(x => x.indexOf("软失败") >= 0 || x.indexOf("EXC") === 0 || x.indexOf("失败") >= 0);
  console.log("  页面告警 " + errs.length + " 条" + (errs.length ? "：\n    " + errs.slice(0, 4).join("\n    ").slice(0, 600) : ""));
  console.log("  趋势取数 " + rTrend + " 次 · 日历 " + calInfo.cells + " 格 / 标记 " + calInfo.best + " 格");
  console.log("  渲染零额度：" + rRender + " · 点格子：" + rClick + " · 3 点对比 fc 请求 " + rCmp +
    "（坐标 " + cmpReqs.join("/") + "）· 复点：" + rAgain);
  console.log("  对比表 " + tbl.rows + " 行 · Q " + tbl.qs.join(",") + " · 缓存标记 " + tbl.cached);
  console.log("  收藏上限 " + nMax + "→" + nAfter6 + " · 重载后 " + nAfterReload + " · 脏数据 " + dirty.n + " 条");
  if (calInfo.sumText) console.log("  最值得去：" + calInfo.sumText.replace(/\s+/g, " ").slice(0, 90));
  console.log("\n--- 断言 ---");
  let fail = 0;
  for (const k of Object.keys(o)) {
    if (!o[k]) { console.log("  FAIL " + k); fail++; } else console.log("  ok   " + k);
  }
  console.log("\nFAIL 计数: " + fail);
  console.log('FACTS {"assertions":' + Object.keys(o).length + ',"fail":' + fail + '}');
  try { chrome.kill(); } catch (e) { }
  srv.close();
  process.exit(fail);
})().catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
