/* CDP 无头浏览器联调：真实联网取数 + 全流程渲染 + 控制台异常采集
   用法: node _check/cdp.js  */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SERVE = path.join(ROOT, "_check");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 47821;

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

async function jget(url) {
  const r = await fetch(url);
  return r.json();
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pend = new Map(); this.handlers = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = e => rej(new Error("ws error")); });
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

/* 失败登记：本脚本的断言分散在十几个段落里，每段各自打印一行 "PASS …" / "FAIL …"。
   原先它无论如何都 `process.exit(0)`，于是 `all.py` 只按退出码判定时就把它当成了全绿 ——
   而它的 FAIL 文案是 "FAIL 下一批存在未通过的项"，既不含 "FAIL 计数" 也不含 "失败 N 项"，
   连文本兜底解析也命中不了。**一次"9/9 全绿"其实底下压着一个 FAIL。**
   现在把 console.log 包一层，凡是以 FAIL 开头的行都登记下来，末尾统一计数 + 用退出码表达。 */
const __fails = [];
const __log = console.log.bind(console);
console.log = function (...a) {
  const s = a.map(x => (typeof x === "string" ? x : String(x))).join(" ");
  if (/^\s*FAIL\b/.test(s)) __fails.push(s);
  __log.apply(console, a);
};

(async function main() {
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=9333", "--user-data-dir=" + udd,
    "--window-size=1440,2400", "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let cerr = "";
  chrome.stderr.on("data", d => { cerr += d.toString(); });

  let ver = null;
  for (let i = 0; i < 60; i++) {
    try { ver = await jget("http://127.0.0.1:9333/json/version"); break; } catch (e) { await sleep(500); }
  }
  if (!ver) { console.log("CHROME_START_FAIL\n" + cerr.slice(0, 3000)); process.exit(1); }

  const list = await jget("http://127.0.0.1:9333/json/list");
  const page = list.find(t => t.type === "page");
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);

  /* ---- 分段计时（C2）----
     目的：把"cdp 一段就占了全量七成时间"这件事**拆开看清楚**，再决定快/慢段怎么切
     —— 而不是靠猜哪段慢。每过一个段落边界记一次累计耗时，结束时按耗时倒序打一张表。
     为什么**不做**并行：本项目的探针各自起一个 Chrome 并各占一个固定端口，并行必然
     EADDRINUSE（已踩过），所以省时间的唯一正路是"少做真正慢的那几段"。 */
  const SEG_FAST = process.env.CDP_SEG === "fast";
  const SEG_LOG = [];
  let segT0 = Date.now();
  /* mark(name)：给**刚跑完**的那一段命名，并开始计下一段。
     语义刻意选"命名已结束的段落"而不是"命名将来那段"—— 后者要在每处写上**下一段**
     的名字，读代码时得数位置对齐；本项目已经因为这种错位吃过一次亏（十一个标签整体
     位移一位，表里出现两行同名）。这里的 name 就是调用点**上面**那段代码的名字。 */
  const mark = n => { const now = Date.now(); SEG_LOG.push([n, now - segT0]); segT0 = now; };
  /* SEG_SLOW：CDP_SEG=fast 时跳过的段落。名单只按**实测数字**定，不看直觉：
     ① 算法模型切换 —— 与 S5 的 48 组合遍历（含 4 个模型逐一切换）高度重叠；
     ② B5 并发点击 —— 竞态覆盖另有 raceprobe（一键序列里的独立项），跳掉不丢覆盖面。
     跳过时**必须显式打一行**：静默少一段会让人以为探针漏跑 —— 那次"空等 125.8 s"
     就是靠"没报错"瞒过眼睛的，同一个坑不踩两次。 */
  const SEG_SLOW = ["B5 并发点击", "算法模型切换"];
  const skipSeg = n => SEG_FAST && SEG_SLOW.indexOf(n) >= 0;
  const skipNote = n => { if (skipSeg(n)) console.log("\n=== 已跳过（CDP_SEG=fast）：" + n + " ==="); };

  const logs = [], errs = [];
  const clip = s => (s && s.length > 260) ? s.slice(0, 260) + "…(" + s.length + ")" : s;
  cdp.on(m => {
    if (m.method === "Runtime.consoleAPICalled") {
      const t = m.params.type;
      const s = clip(m.params.args.map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(" "));
      logs.push("[" + t + "] " + s);
      if (t === "error") errs.push(s);
    } else if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      errs.push("EXCEPTION: " + clip(d.exception && d.exception.description ? d.exception.description : d.text));
    } else if (m.method === "Log.entryAdded") {
      const e = m.params.entry;
      if (e.level === "error" && !/favicon/.test(e.url || "")) errs.push("LOG: " + clip(e.text) + " @" + clip(e.url || ""));
    }
  });
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 2400, deviceScaleFactor: 1, mobile: false });

  /* ---- 拦截气象接口，回填可复现的合成数据（真实配额已耗尽，仅用于验证渲染与算法链路） ---- */
  const USE_MOCK = process.env.MOCK !== "0";
  /* NOEC=1：让 ECMWF 那一路直接返回 400，用来验证"某模型本次无数据"时的
     回退逻辑（选项禁用 + 提示 + 自动切回多模型综合），而不是只测 happy path。 */
  const NOEC = process.env.NOEC === "1";
  let mockN = 0, mockEC = 0;
  /* 每个被回填的请求的坐标数都要记下来：B11 懒加载的核心证据不是"看起来快"，
     而是"首屏阶段一个 coords>17 的大请求都没发出"。只靠总请求数不够 ——
     3 个小请求与 1 个大请求可能凑出同样的计数。 */
  const mockLog = [];
  if (USE_MOCK) {
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
        const mdl = u.searchParams.get("models") || "";
        if (NOEC && mdl === "ecmwf_ifs025") {
          mockEC++;
          await cdp.send("Fetch.fulfillRequest", {
            requestId, responseCode: 400,
            responseHeaders: [{ name: "Content-Type", value: "application/json" },
              { name: "Access-Control-Allow-Origin", value: "*" }],
            body: Buffer.from(JSON.stringify({ error: true, reason: "Mocked upstream failure" }), "utf8").toString("base64")
          });
          return;
        }
        const body = lats.map((la, i) => {
          const lo = lons[i] == null ? 0 : lons[i];
          /* 按 start_date ~ end_date 生成完整区间（原先只生成 start_date 那一天，
             于是七日趋势（F5）的取数在 mock 下拿不到后 6 天，测不出任何东西）。 */
          const sd = u.searchParams.get("start_date") || u.searchParams.get("forecast_days") || "";
          const ed = u.searchParams.get("end_date") || sd;
          const times = [];
          const t0 = Date.parse(sd + "T00:00:00Z"), t1 = Date.parse(ed + "T00:00:00Z");
          const nDay = Math.max(1, Math.round((t1 - t0) / 86400000) + 1);
          for (let k = 0; k < nDay * 24; k++) {
            const d = new Date(t0 + k * 3600000);
            times.push(d.toISOString().slice(0, 10) + "T" + String(d.getUTCHours()).padStart(2, "0") + ":00");
          }
          const hourly = { time: times };
          vars.forEach(v => {
            /* 日序号必须取**绝对**日序，不能取"窗口内第几天"：
               否则同一天在 3 天窗口（单点查询）与 7 天窗口（趋势查询）里会拿到
               不同的合成值，而真实接口对同一绝对时刻必然返回同一数值 ——
               这个假象会让"趋势与单日一致"这条断言永远失败。 */
            hourly[v] = times.map((_, k) => {
              const ms = t0 + k * 3600000, d = new Date(ms);
              return gen(v, la, lo, d.getUTCHours(), isAQ, Math.floor(ms / 86400000));
            });
          });
          return { latitude: la, longitude: lo, utc_offset_seconds: 28800, timezone: "Asia/Shanghai", hourly };
        });
        mockN++;
        mockLog.push({ n: mockN, host: isAQ ? "aq" : "fc", coords: lats.length, vars: vars.length });
        await cdp.send("Fetch.fulfillRequest", {
          requestId, responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "application/json" },
            { name: "Access-Control-Allow-Origin", value: "*" }],
          body: Buffer.from(JSON.stringify(body), "utf8").toString("base64")
        });
      } catch (e) {
        await cdp.send("Fetch.continueRequest", { requestId }).catch(() => { });
      }
    });
  }

  /* 合成场：位置与时刻都平滑可辨，便于肉眼核对热力图与等级分布。
     dd＝第几天（0 起），给各要素叠一个逐日缓变项，让七日趋势有可见差异。 */
  function gen(v, lat, lon, h, isAQ, dd) {
    const wave = (a, b) => Math.sin((lat + a) / 6) * Math.sin((lon + b) / 7);
    const diur = ph => Math.max(0, Math.sin((h - ph) / 24 * 2 * Math.PI));
    const dayw = Math.sin((dd || 0) / 3.2);
    if (isAQ) {
      if (v === "aerosol_optical_depth") return clampf(0.32 + 0.22 * wave(0, 0) + 0.09 * dayw, 0.02, 1.6);
      if (v === "pm2_5") return clampf(30 + 22 * wave(3, 5), 2, 220);
      if (v === "pm10") return clampf(52 + 30 * wave(3, 5), 4, 320);
      return clampf(8 + 6 * wave(1, 2), 0, 120);
    }
    switch (v) {
      case "temperature_2m": return 16 + 9 * Math.sin((h - 8) / 24 * 2 * Math.PI) - Math.abs(lat - 31) * 0.35 + 3 * dayw;
      case "dew_point_2m": return 8 + 5 * Math.sin((h - 6) / 24 * 2 * Math.PI) - Math.abs(lat - 31) * 0.28 + 2 * dayw;
      case "relative_humidity_2m": return clampf(62 + 22 * Math.sin((h - 14) / 24 * 2 * Math.PI) - 8 * dayw, 15, 98);
      case "cloud_cover_low": return clampf(38 + 40 * wave(0, 0) + 18 * diur(4) + 22 * dayw, 0, 100);
      case "cloud_cover_mid": return clampf(34 + 36 * wave(9, 4) + 16 * diur(2) - 12 * dayw, 0, 100);
      case "cloud_cover_high": return clampf(42 + 38 * wave(18, 9) + 14 * diur(0) + 16 * dayw, 0, 100);
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
  function clampf(v, a, b) { return v < a ? a : (v > b ? b : v); }

  const url = "http://127.0.0.1:" + PORT + "/preview.html" + ((process.env.NOHEAT === "1" ? "?noheat=1" : (process.env.NOPROJ === "1" ? "?noproj=1" : "")));
  await cdp.send("Page.navigate", { url });

  /* 等待数据渲染完成（轮询页面内状态） */
  const probe = `(() => ({
      ready: (typeof MapMod!=="undefined"),
      mapCalls: (window.__TMAP_CALLS||[]).slice(),
      mapOK: (typeof MapMod!=="undefined") && MapMod.ok,
      rasterOK: (typeof MapMod!=="undefined") && MapMod.rasterOK,
      rasterStrips: (function(){ try{ return MapMod.strips.length; }catch(e){ return -1; } })(),
      mapPts: (function(){ try{ const d=mapSet(); return d?d.pts.length:0; }catch(e){ return -1; } })(),
      rankLen: document.querySelectorAll('#rank .rr').length,
      res: !!(typeof State !== 'undefined' && State.result && State.result.P != null),
      rankScope: ((document.querySelector('#rankScope')||{}).textContent||''),
      mapTag: ((document.querySelector('#mapTag')||{}).textContent||''),
      modelNoteDisp: ((document.querySelector('#modelNote')||{}).style||{}).display||'',
      modelNoteTxt: ((document.querySelector('#modelNote')||{}).textContent||'').slice(0,200),
      modelSel: ((function(){var s=document.querySelector('#mapModel');if(!s)return null;
        return {v:s.value, sig:s.dataset.sig||'', opts:[].map.call(s.options,function(o){return o.value+(o.disabled?'#':'');}).join(',')};})()),
      lgBarLen: document.querySelectorAll('#lgBar i').length,
      /* 色阶统一性：朝霞与晚霞必须取到完全相同的一条色阶；图例色条自第 8 批起是
         **硬停止分档**（N_BANDS 段，不是渐变）—— 图例一旦是渐变，用户就会以为
         地图上也是连续过渡的。这里同时把"档位代表色"与"图例报出的渐变串"都取回来。 */
      ramp: (function(){ try{
        const k = function(p){ return rampColor(p,0)+'|'+rampColor(p,33)+'|'+rampColor(p,67)+'|'+rampColor(p,100); };
        const bands = [];
        for (let i = 0; i < N_BANDS; i++) bands.push(bandColor('pm', (i + 0.5) / N_BANDS * 100));
        const bar = document.querySelector('#lgBar');
        return {
          am: k('am'), pm: k('pm'), unified: k('am')===k('pm'),
          nBands: N_BANDS, bands: bands.join(','), bandCss: bandGradientCss(),
          barBg: getComputedStyle(bar).backgroundImage,
          barFill: getComputedStyle(bar).backgroundColor,
          chips: [].map.call(document.querySelectorAll('#lgRows .chipc'), function(e){ return e.style.background; }),
          rankBars: [].map.call(document.querySelectorAll('#rank .b3 i'), function(e){ return e.style.background; })
        };
      }catch(e){ return {err:String(e)}; } })(),
      tipChip: ((function(){ var e=document.querySelector('#tip .chipc'); return e?e.style.background:''; })()),
      lgNote: ((document.querySelector('#lgNote')||{}).textContent||'').slice(0,80),
      heroTxt: ((document.querySelector('#hero')||{}).innerText||'').slice(0,400),
      notesLen: document.querySelectorAll('#notes .note').length,
      modelsLen: document.querySelectorAll('#models *').length,
      modelsTxt: ((document.querySelector('#models')||{}).innerText||'').slice(0,300),
      facTxt: ((document.querySelector('#fac')||{}).innerText||'').slice(0,400),
      rayTxt: ((document.querySelector('#ray')||{}).innerText||'').slice(0,300),
      notesTxt: ((document.querySelector('#notes')||{}).innerText||'').slice(0,700),
      bodyLen: document.body.innerText.length
    }))()`;

  mark("启动与首屏");   /* 上一段结束 */
  /* ---- B11 地图懒加载：首屏只等单点结果，不再等地图 ----
     一进页面就取地图数据会花掉约 3 × MAP_CITIES.length 个计费调用（占单页全量取数的 88%），
     而 Open-Meteo 免费层是按「出口 IP」计的每日 10,000 次 —— 首屏就花掉近 5%，
     等于全站每天只够开二十来次。改成用户点「刷新地图」时才取。 */
  let st = null, homeWait = 0;
  /* 首屏就绪的判据 = **单点结果已渲染**（State.result 有值 + hero 文案出来了）。
     这里曾经写的是 `rankLen > 0`（#rank 里有行）—— 那是"首屏会自动取地图数据"年代的
     遗留：B11 把地图改成用户显式触发之后，首屏**根本没有地图数据**，排行榜自然是空的，
     于是这个条件永远不成立，循环每次都把 80 轮 × 1.5 s 预算跑满（实测 125.8 s，
     占 cdp 全段 59%）。而且它是**静默**的：条件不成立不会报错，只是白等两分钟。
     换成 res 之后同一个探针从 ~215 s 降到 ~95 s。
     下面另加一条断言盯着"等待没有跑满预算"，免得将来再有人把判据改回去。 */
  for (let i = 0; i < 80; i++) {
    homeWait = i + 1;
    await sleep(1500);
    const r = await cdp.send("Runtime.evaluate", { expression: probe, returnByValue: true });
    st = r.result.value;
    if (st && st.res && (st.heroTxt || "").length > 50) break;
  }
  const homeMock = mockN;
  /* 待加载引导必须在此时已渲染 —— 否则用户看到的是一块空白地图，分不清
     「还没加载」与「加载失败」（B1 关心的正是这两类原因的区分）。 */
  const idleState = (await cdp.send("Runtime.evaluate", {
    expression: `(function(){
      var el=document.getElementById("mapLoad"), cs=el?getComputedStyle(el):null;
      return { barVisible: !!(cs && cs.display!=="none"),
               isErr: !!(el && el.classList.contains("err")),
               txt: el ? (el.innerText||"").slice(0,220) : "",
               hasBtn: !!(el && el.querySelector(".mretry")),
               /* 注意别用 MapMod.ok 当"数据已就绪" —— 它表示的是**地图对象建成**
                  （initMap 里 new TMap.Map 成功即置 true），与取没取过数无关。
                  "没有地图数据"要看两样：取样集合为空、值场条带没建。 */
               strips: (function(){ try{ return MapMod.strips.length; }catch(e){ return -1; } })(),
               pts: (function(){ try{ var d=mapSet(); return d?d.pts.length:0; }catch(e){ return -1; } })(),
               /* 局部网格的点数（B13）。断言不写死数字：点集大小由半径/间距常量决定，
                 写死 57 的话，哪天调了 MAP_GRID_KM 就会得到一条与产品无关的假失败。 */
               ptN: (function(){ try{ return mapPts().length; }catch(e){ return -1; } })(),
               radius: (typeof MAP_RADIUS_KM === "number") ? MAP_RADIUS_KM : null };
    })()`, returnByValue: true
  })).result.value;
  /* 代替用户点一次「刷新地图」。只点一次 —— 反复点会让请求令牌自增、
     把上一次取数作废（raceprobe 专门测这条）。 */
  const kick = await cdp.send("Runtime.evaluate", {
    expression: `(function(){ try{ var b=document.getElementById("mapGo"); if(!b) return "no-btn"; b.click(); return "clicked"; }catch(e){ return String(e); } })()`,
    returnByValue: true
  });
  for (let i = 0; i < 80; i++) {
    await sleep(1500);
    const r = await cdp.send("Runtime.evaluate", { expression: probe, returnByValue: true });
    st = r.result.value;
    if (st && st.mapPts > 0 && st.mapOK) break;
  }
  const mapMock = mockN;

  /* 首屏账目断言。核心证据不是"看起来快"，而是"首屏阶段一个 coords>17 的大请求都没发出" ——
     只比总请求数不够：3 个小请求和 1 个大请求可能凑出同样的计数。 */
  const homeReqs = mockLog.filter(x => x.n <= homeMock);
  const mapReqs = mockLog.filter(x => x.n > homeMock && x.n <= mapMock);
  const b11ok = [
    ["首屏待加载引导已渲染", idleState.barVisible === true],
    ["引导是待加载态而非错误态", idleState.isErr === false],
    ["引导提供了可点击的加载入口", idleState.hasBtn === true],
    ["首屏就绪等待没有跑满预算（判据失效会静默空等两分钟）", homeWait < 40],
    ["引导文案点明了加载动作", /加载周边地图/.test(idleState.txt)],
    ["首屏确实没有地图数据点", idleState.pts === 0],
    ["首屏未构建值场（无条带）", idleState.strips === 0],
    ["首屏发出的全是单点查询（无 coords>17 的大请求）",
      homeReqs.length > 0 && homeReqs.every(x => x.coords <= 17)],
    ["引导入口可点击", kick.result.value === "clicked"],
    ["点击后才补上地图的 3 个请求", mapReqs.length === 3],
    ["补上的是整批局部网格请求（坐标数 = 局部点数）",
      mapReqs.length === 3 && idleState.ptN > 0 && mapReqs.every(x => x.coords === idleState.ptN)],
    ["局部点数显著小于全国版 152（说明范围真的收小了）", idleState.ptN > 0 && idleState.ptN < 100],
    ["点击后地图数据到位且值场建起", !!(st && st.mapPts > 0 && st.rasterStrips > 0)]
  ];
  console.log("\n===== B11 地图懒加载（首屏不取地图）=====");
  b11ok.forEach(([n, ok]) => console.log("  " + (ok ? "PASS" : "FAIL") + " " + n));
  console.log("  首屏 " + homeMock + " 个请求: " + JSON.stringify(homeReqs.map(x => x.host + "/" + x.coords + "x" + x.vars)));
  console.log("  点击后追加 " + mapReqs.length + " 个: " + JSON.stringify(mapReqs.map(x => x.host + "/" + x.coords + "x" + x.vars)));
  console.log("  首屏 点数 " + idleState.pts + " / 条带 " + idleState.strips
    + "  →  就绪后 " + st.mapPts + " 点 / 条带 " + st.rasterStrips);

  /* 触发地图悬停与点击（模拟腾讯地图事件）。
     顺带量化悬停链路的节流（第一批 ②）——这两条光看代码看不出来，必须实测：
     ① rAF 合并：同步连发 40 次 mousemove，真正落到提示卡的应**恰好 1 次**。
        连发必须一次同步完成：中间只要让出一帧，"一帧内合并"这件事就没被测到。
     ② DOM 写入去重：同一位置再触发一次，提示卡首个子节点应是**同一个对象**
        （说明走的是"内容没变就 return"，而不是"重写一遍恰好内容相同"）。 */
  const hover = await cdp.send("Runtime.evaluate", {
    expression: `(()=>{ if(!window.__TMAP_EMIT) return "no-emit";
      window.__HOVER_ORIG=window.showMapTip; window.__HOVER_N=0;
      window.showMapTip=function(){ window.__HOVER_N++; return window.__HOVER_ORIG.apply(this, arguments); };
      for(let i=0;i<40;i++) window.__TMAP_EMIT('mousemove', State.lat+(i%5)*0.02, State.lon+(i%7)*0.02);
      return {burst:40, atReturn:window.__HOVER_N}; })()`, returnByValue: true
  });
  await sleep(300);   /* 等那一帧落地，合并后的那一次才会计数 */
  /* 计数必须在 click 之前读走：onPick 里的 showMapTip 是**直接调用**（钉住提示卡），
     本来就不该经过 rAF，把它算进来会把"一帧画一次"测成两次。 */
  const hover1 = await cdp.send("Runtime.evaluate", {
    expression: `(()=>{ const painted=window.__HOVER_N;
      window.showMapTip=window.__HOVER_ORIG;
      const t1=(document.querySelector('#tip')||{}).className||'';
      window.__TMAP_EMIT('click', State.lat+0.30, State.lon+0.30);
      const t2=(document.querySelector('#tip')||{}).textContent||'';
      return {painted:painted, cls:t1, txt:t2.slice(0,220)}; })()`, returnByValue: true
  });
  const hover2 = await cdp.send("Runtime.evaluate", {
    expression: `(()=>{
      const tipEl=document.querySelector('#tip');
      const ll={lat:State.lat+0.05, lon:State.lon+0.05};
      showMapTip(ll,true); const n1=tipEl.firstChild;
      showMapTip(ll,true); const n2=tipEl.firstChild;
      return {sameNode:n1===n2, hasTip:!!n1}; })()`, returnByValue: true
  });
  const HV = hover2.result.value || {};
  const hoverok = (hover1.result.value || {}).painted === 1 && HV.sameNode === true && HV.hasTip === true;
  console.log("  悬停节流: 连发 " + (hover.result.value || {}).burst + " 次 → 实际画 "
    + (hover1.result.value || {}).painted + " 次 · 同位置重触发首节点同一=" + HV.sameNode);
  console.log("  " + (hoverok ? "PASS 悬停合并到帧（40 次同步移动只画 1 次），且内容未变时不重写 DOM"
    : "FAIL 悬停节流断言未通过"));

  /* 切换 朝霞/晚霞 + 维度切换，确认刷新 */
  const sw = await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{
      const btns=[...document.querySelectorAll('#mapPeriod button')];
      btns[0].click();
      const sel=document.querySelector('#mapDim'); sel.value='q'; sel.dispatchEvent(new Event('change'));
      await new Promise(r=>setTimeout(r,3000));
      return {period: State.mapPeriod, dim: State.mapDim,
              tag:(document.querySelector('#mapTag')||{}).textContent||'',
              btnOn:(document.querySelector('#mapPeriod button.on')||{}).textContent||'',
              lgNote:(document.querySelector('#lgNote')||{}).textContent.slice(0,120),
              rankTop:(document.querySelector('#rank .rr .nm')||{}).textContent||''};
    })()`, returnByValue: true, awaitPromise: true
  });

  mark("B11 懒加载");   /* 上一段结束 */
  /* ---- 算法模型切换 ----
     验证四件事：① 下拉框列出全部模型（无数据的置灰）；
     ② 切换后标签/排行榜/图例/悬停都跟着换模型；
     ③ 色面确实重绘（覆盖层像素校验和变化）；
     ④ 全程不产生新的接口请求（切模型只重绘，不重新取数）。 */
  const mockBefore = mockN;
  /* 快段：见 SEG_SLOW。跳过后 modelTest 置空、下面 mockAfter-mockBefore 自然为 0
     （下游只把它转储进 JSON，不做断言），语义与"切模型不产生新请求"一致。 */
  let modelTest = { result: { value: null } };
  if (!skipSeg("算法模型切换")) modelTest = await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      /* 着色指纹：自动适配两条渲染路径 ——
         ① 值场覆盖层：对栅格画布像素做 FNV 校验和（能抓出颜色与位置的变化）；
         ② 省级色块降级：取各省级行政区的 styleId 序列（换模型时应当随之变化）。 */
      const hash=()=>{ try{
        const cvs=[...document.querySelectorAll('.rlayer canvas')];
        if(cvs.length){ let h=2166136261,n=0;
          for(const c of cvs){ const g=c.getContext('2d'); if(!g) continue;
            const w=Math.min(c.width,300), hh=Math.min(c.height,240);
            const d=g.getImageData(0,0,w,hh).data;
            for(let i=0;i<d.length;i+=53){ h=((h^d[i])*16777619)>>>0; n++; } }
          return 'r'+h+':'+n+':'+cvs.length; }
        const geo=(window.__TMAP_POLYSTYLES||'')+'|'+(window.__TMAP_POLYCOLORS||'');
        let h=2166136261;
        for(let i=0;i<geo.length;i++){ h=((h^geo.charCodeAt(i))*16777619)>>>0; }
        return 'p'+h+':'+geo.length;
      }catch(e){ return 'ERR '+e; } };
      const polyPeek=()=>{ const s=window.__TMAP_POLYCOLORS||''; const a=s.split(';');
        return {n:a.length, head:a.slice(0,2), tail:a.slice(-2)}; };
      const sel=document.querySelector('#mapModel');
      const dim=document.querySelector('#mapDim'); dim.value='mix'; dim.dispatchEvent(new Event('change'));
      await sleep(1200);
      const snap=k=>({k,got:sel.value,tag:(document.querySelector('#mapTag')||{}).textContent,
        rank:(document.querySelector('#rankScope')||{}).textContent,hash:hash(),model:State.mapModel,
        noteTxt:((document.querySelector('#modelNote')||{}).textContent||'').slice(0,160),
        noteDisp:((document.querySelector('#modelNote')||{}).style||{}).display||''});
      const out={opts:[...sel.options].map(o=>o.value+(o.disabled?'(禁用)':'')),
                 ens:snap('ens'), steps:[], tipTxt:'', lgNote:''};
      for(const k of ['gfs','ec','rt','ens']){
        sel.value=k; sel.dispatchEvent(new Event('change'));
        await sleep(1600);
        out.steps.push(snap(k));
      }
      out.lgNote=((document.querySelector('#lgNote')||{}).textContent||'').slice(0,180);
      out.poly=polyPeek();
      if(window.__TMAP_EMIT) window.__TMAP_EMIT('mousemove',State.lat+0.12,State.lon+0.12);
      await sleep(400);
      out.tipTxt=((document.querySelector('#tip')||{}).textContent||'').slice(0,220);
      return out;
    })()`, returnByValue: true, awaitPromise: true
  });
  const mockAfter = mockN;
  skipNote("算法模型切换");

  mark("算法模型切换");   /* 上一段结束 */
  /* ---- S5：48 组合遍历（2 日期 × 2 时段 × 4 模型 × 3 维度）----
     单独测"模型切换"或"时段切换"都只能覆盖单变量；这里按笛卡尔积遍历，
     逐个核对"状态 → 标签 → 排行榜口径 → 下拉框 → 提示区 → 色面"六者自洽。
     这类组合错误（例如切维度后标签没跟着换、回退提示残留、色面空掉）
     在单变量测试里全都测不出来。 */
  const combos = await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const sel=document.querySelector('#mapModel'), dim=document.querySelector('#mapDim');
      const dateSel=document.querySelector('#mapDateSel');
      const perBtn=k=>document.querySelector('#mapPeriod button[data-p="'+k+'"]');
      const noteEl=document.querySelector('#modelNote');
      /* 色面指纹：栅格路径取像素校验和，省级色块降级路径取 styleId 序列 */
      const fp=()=>{ try{
        const cvs=[...document.querySelectorAll('.rlayer canvas')];
        if(cvs.length){ let h=2166136261,n=0;
          for(const c of cvs){ const g=c.getContext('2d'); if(!g) continue;
            const w=Math.min(c.width,200), hh=Math.min(c.height,160);
            const d=g.getImageData(0,0,w,hh).data;
            for(let i=0;i<d.length;i+=97){ h=((h^d[i])*16777619)>>>0; n++; } }
          return cvs.length? ('r'+h+':'+n) : 'none'; }
        const geo=(window.__TMAP_POLYSTYLES||'');
        return geo? ('p'+geo.length) : 'none';
      }catch(e){ return 'ERR'; } };
      /* 取两个日期：当前日期 + 次日（都走 mock，秒回） */
      const allOpts=[...dateSel.options].map(o=>o.value);
      const i0=allOpts.indexOf(State.dateStr);
      const dates=[allOpts[i0], allOpts[i0+1]];
      const PERS=['am','pm'], MKS=['ens','gfs','ec','rt'], DIMS=['p','q','mix'];
      const out={ n:0, bad:0, rows:[], err:null, dates:dates };
      try {
        for(const dts of dates){
          dateSel.value=dts; dateSel.dispatchEvent(new Event('change'));
          /* 等这一天真正取到数（比固定 sleep 稳，慢机器上不会误判成"无数据"） */
          for(let w=0; w<40; w++){
            const bx=MapMod.data[dts];
            if(bx && bx.pm && bx.pm.pts && bx.pm.pts.length && bx.am && bx.am.pts && bx.am.pts.length) break;
            await sleep(500);
          }
          if(!mapSet() || !mapSet().pts.length){ out.rows.push(dts+' → 该日期无数据，跳过'); continue; }
          for(const per of PERS){
            perBtn(per).click();
            await sleep(120);
            for(const mk of MKS){
              sel.value=mk; sel.dispatchEvent(new Event('change'));
              await sleep(120);
              for(const dm of DIMS){
                dim.value=dm; dim.dispatchEvent(new Event('change'));
                await sleep(200);
                const d=mapSet();
                const avail=modelCount(d,mk)>0;
                const expect=avail?mk:'ens';
                const tag=(document.querySelector('#mapTag')||{}).textContent||'';
                const scope=(document.querySelector('#rankScope')||{}).textContent||'';
                const nt=(noteEl&&noteEl.textContent)||'';
                const nd=(noteEl&&noteEl.style)?(noteEl.style.display||''):'';
                const perTxt=per==='am'?'朝霞':'晚霞';
                const mkName=expect==='ens'?'多模型综合':(MAP_MODELS.find(x=>x.k===expect)||{}).name;
                const probs=[];
                if(tag.indexOf(dts)<0) probs.push('标签日期≠'+dts);
                if(tag.indexOf(perTxt)<0) probs.push('标签时段≠'+perTxt);
                if(tag.indexOf(mkName)<0) probs.push('标签模型≠'+mkName);
                if(scope.indexOf(mkName)<0) probs.push('排行榜口径≠'+mkName);
                if(State.mapPeriod!==per) probs.push('时段状态错='+State.mapPeriod);
                if(State.mapDim!==dm) probs.push('维度状态错='+State.mapDim);
                if((State.mapModel||'ens')!==expect) probs.push('模型状态错='+State.mapModel);
                if(sel.value!==expect) probs.push('下拉框未对齐='+sel.value);
                const f=fp();
                if(f==='none'||f==='ERR') probs.push('色面为空/'+f);
                if(!avail && !/已自动切换|没有可用结果/.test(nt)) probs.push('模型不可用却无提示');
                if(!avail && nd==='none') probs.push('回退提示被隐藏');
                if(avail && /已自动切换/.test(nt)) probs.push('模型可用却残留回退提示');
                out.n++;
                if(probs.length){ out.bad++; out.rows.push(dts+' '+perTxt+' '+mk+'/'+dm+'  ✗ '+probs.join('；')); }
                else out.rows.push(dts+' '+perTxt+' '+mk+'/'+dm+'  ✓ '+f);
              }
            }
          }
        }
        /* 复位到默认视角，避免影响后续截图与其它用例 */
        sel.value='ens'; sel.dispatchEvent(new Event('change'));
        dim.value='mix'; dim.dispatchEvent(new Event('change'));
        perBtn('pm').click();
        await sleep(300);
      } catch(e){ out.err=String(e&&e.stack||e); }
      return out;
    })()`, returnByValue: true, awaitPromise: true
  });
  const CB = combos.result.value || {};
  console.log("\n===== S5 组合遍历（日期×时段×模型×维度）=====");
  console.log("  日期: " + JSON.stringify(CB.dates) + "   组合数 " + CB.n + "   失败 " + CB.bad);
  (CB.rows || []).filter(r => r.indexOf("✗") >= 0).forEach(r => console.log("    " + r));
  if (CB.err) console.log("  执行异常: " + CB.err);
  console.log("  " + (!CB.err && CB.bad === 0 && CB.n >= 48 ? "PASS 全部组合自洽" : "FAIL"));

  mark("S5 48 组合遍历");   /* 上一段结束 */
  /* ---- B5：并发点击不再静默丢弃 + 标签必须描述"本次算出的输入" ----
     两个独立子用例：
       ① 计算进行中把地区改成另一处 —— 完成后标签必须描述**发起时**的地区（res 内字段），
          而不是读取会被改动的 State；
       ② 计算进行中再次点「开始预报」—— 不能静默丢弃，要记下待跑并在结束后自动重跑，
          最终结果必须对应最后一次输入的地区。 */
  /* 快段：见 SEG_SLOW。整段（探针 + 打印）一起跳过 —— 探针里 setLocation/runForecast
     的副作用不影响后续段落（其后紧接的 re 会重新搜一个城市把状态拉回确定值）。 */
  if (!skipSeg("B5 并发点击")) {
  const b5 = await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const busyWait=async()=>{ for(let w=0;w<200 && !State.busy;w++) await sleep(25); };
      const idleWait=async()=>{ for(let w=0;w<1200 && (State.busy||State.pending);w++) await sleep(50); };
      const badge=()=>document.querySelector('#topBadge').textContent||'';
      const hero=()=>document.querySelector('#hero').innerText||'';
      const out={};
      /* ① 标签错位 */
      setLocation(39.9042,116.4074,'北京市','北京市');
      $('#q').value='北京市';
      runForecast(false);
      await busyWait();
      out.busy1=State.busy;
      setLocation(29.6600,91.1320,'拉萨市','');           // 计算还在跑时改地区
      await idleWait();
      out.labelBadge=badge();                              // 应由 res 得出 → 含"北京市"
      out.stateNameAfter=State.name;                       // State 已是"拉萨市"
      out.labelHero=hero().indexOf('北京市')>=0;
      /* ② 并发点击 */
      State.pending=false;
      setLocation(43.8256,87.6168,'乌鲁木齐市','乌鲁木齐市');
      runForecast(false);
      await busyWait();
      out.busy2=State.busy;
      runForecast(false);                                  // 第二次点击 → 应记 pending 而非丢弃
      out.pendingFlag=State.pending;
      out.pendingBadge=badge();
      await idleWait();
      out.finalPending=State.pending;
      out.finalBusy=State.busy;
      out.finalBadge=badge();                              // 重跑后应描述"乌鲁木齐市"
      out.resultName=State.result && State.result.name;
      return out;
    })()`, returnByValue: true, awaitPromise: true
  });
  const B5 = b5.result.value || {};
  const b5ok = [
    ["计算期间 busy 置位", B5.busy1 === true],
    ["标签取自 res（含发起时的『北京市』）", String(B5.labelBadge).indexOf("北京市") >= 0],
    ["结论卡片同样是发起时的地区", B5.labelHero === true],
    ["期间 State.name 已被改为另一地区（说明标签确非读 State）", B5.stateNameAfter === "拉萨市"],
    ["并发点击被记为待跑", B5.pendingFlag === true],
    ["待跑状态有即时反馈", /自动重算/.test(String(B5.pendingBadge))],
    ["结束后待跑标记已清", B5.finalPending === false],
    ["结束后不再 busy", B5.finalBusy === false],
    ["重跑结果对应最后一次输入的地区", B5.resultName === "乌鲁木齐市"],
    ["最终标签描述最后一次输入", String(B5.finalBadge).indexOf("乌鲁木齐市") >= 0]
  ];
  console.log("\n===== B5 并发点击 / 标签错位 =====");
  b5ok.forEach(([n, ok]) => console.log("  " + (ok ? "PASS" : "FAIL") + " " + n));
  console.log("  badge(①)=" + B5.labelBadge + "   重跑结果=" + B5.resultName + "   最终标签=" + B5.finalBadge);
  }
  skipNote("B5 并发点击");

  /* 修改地区后重算 */
  const re = await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{
      document.querySelector('#q').value='拉萨';
      const box=document.querySelector('#sug');
      document.querySelector('#q').dispatchEvent(new Event('focus'));
      await new Promise(r=>setTimeout(r,200));
      let n=0;
      if(box.children.length){ box.children[0].click(); n=1; }
      /* C2：原先固定等 20 s。mock 下预报响应是即时的，这 20 s 纯属浪费（实测占 cdp
         全段两成）。改成"等 busy 起来 → 等 idle"两段轮询，上限仍约 25 s，真机慢也
         不会提前放行；轮询是本文件既有纪律（勿用固定 sleep），见 ux / B5 两处写法。 */
      const bw=async()=>{ for(let w=0;w<200 && !State.busy;w++) await new Promise(r=>setTimeout(r,25)); };
      const iw=async()=>{ for(let w=0;w<500 && (State.busy||State.pending);w++) await new Promise(r=>setTimeout(r,50)); };
      await bw(); await iw(); await new Promise(r=>setTimeout(r,600));
      return {sugClicked:n, loc:(document.querySelector('#locHint')||{}).textContent||'',
              busy: State.busy,
              heroLen:((document.querySelector('#hero')||{}).textContent||'').length,
              heroHead:((document.querySelector('#hero')||{}).textContent||'').slice(0,220)};
    })()`, returnByValue: true, awaitPromise: true
  });

  /* 恢复默认视角（晚霞 + 综合指数）再截图，便于目视核对默认状态 */
  await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{const b=document.querySelectorAll('#mapPeriod button');b[1].click();
      const s=document.querySelector('#mapDim');s.value='mix';s.dispatchEvent(new Event('change'));
      await new Promise(r=>setTimeout(r,2500));return 1;})()`, returnByValue: true, awaitPromise: true
  });

  const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(path.join(ROOT, "_check", "shot-desktop.png"), Buffer.from(shot.data, "base64"));

  /* 只截面板：便于目视核对（原来 sel 参数被忽略，写死了 #map） */
  async function shotPanel(sel, out, scale) {
    const r = await cdp.send("Runtime.evaluate", {
      expression: `(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;
        e=(e.classList&&e.classList.contains('card'))?e:(e.closest('.card')||e);
        var b=e.getBoundingClientRect();return JSON.stringify({x:b.left+window.scrollX,y:b.top+window.scrollY,
        width:b.width,height:b.height});})()`, returnByValue: true
    });
    if (!r.result.value) { console.log("  [截图] 未找到 " + sel); return; }
    const c = JSON.parse(r.result.value);
    const s = await cdp.send("Page.captureScreenshot", {
      format: "png", captureBeyondViewport: true,
      clip: { x: Math.max(0, c.x - 8), y: Math.max(0, c.y - 8), width: c.width + 16, height: Math.min(c.height + 16, 3000), scale: scale || 1 }
    });
    fs.writeFileSync(path.join(ROOT, "_check", out), Buffer.from(s.data, "base64"));
    console.log("  [截图] " + out + "  " + Math.round(c.width) + "×" + Math.round(c.height));
  }
  await shotPanel("#map", "shot-map-desktop.png", 1);
  await shotPanel("#cardHero", "shot-hero.png", 1);
  await shotPanel("#ray", "shot-ray.png", 1);

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 1600, deviceScaleFactor: 2, mobile: true });
  await sleep(1500);
  const shot2 = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(path.join(ROOT, "_check", "shot-mobile.png"), Buffer.from(shot2.data, "base64"));
  await shotPanel("#map", "shot-map-mobile.png", 1);

  /* =====================================================================
     批次 5 / 6 新增能力的回归断言
     ===================================================================== */

  mark("B5 并发点击与截图");   /* 上一段结束 */
  /* ---- P4 计费请求账目 · B9 缓存上限 · 时区口径 ----
     ① 地图强制取数：3 个请求 ×（局部网格点数）坐标；
     ② 地图数据已在缓存里时按城市搜索：**不得**产生任何「整批局部网格」级别的地图请求
        —— 修掉的正是"每搜一次城市就白花一整批加权调用"；
     ③ 单点查询：3 个请求 × 17 坐标 = 51；
     注：B11 之后首屏本身只花 ③ 的 51（地图不再随页面打开自动取），
     ① 只在用户点「刷新地图」或勾选「地图跟随查询自动刷新」时才发生 ——
     所以下面这段是主动触发的地图账目，不代表首屏开销。
     ④ 连续切 4 个日期后 MapMod.data 的日期键不超过 3（B9 的 LRU）；
     ⑤ 所有请求的 timezone 必须是同一个口径（API_TZ="auto"）。 */
  const p4 = await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const coords=a=>a.reduce((s,x)=>s+x.coords,0);
      const detail=a=>a.map(c=>c.endpoint+'/'+c.coords+'x'+c.vars+'/'+c.tz);
      const sel=document.querySelector('#mapDateSel');
      sel.value=State.dateStr; sel.dispatchEvent(new Event('change'));
      await sleep(1500);
      apiCallReset();
      await loadMapData(true);
      await sleep(800);
      const M=apiCallStats();
      apiCallReset();
      document.querySelector('#q').value='哈尔滨';
      document.querySelector('#q').dispatchEvent(new Event('focus'));
      await sleep(300);
      const box=document.querySelector('#sug');
      let clicked=0;
      if(box.children.length){ box.children[0].click(); clicked=1; }
      /* 同上：固定 20 s → 轮询（C2）。这里只是等城市搜索触发的单点预报落定。 */
      const bw=async()=>{ for(let w=0;w<200 && !State.busy;w++) await sleep(25); };
      const iw=async()=>{ for(let w=0;w<500 && (State.busy||State.pending);w++) await sleep(50); };
      await bw(); await iw(); await sleep(600);
      const S=apiCallStats();
      const big=S.calls.filter(c=>c.coords>50).length;
      const opts=[...sel.options].map(o=>o.value).filter(v=>v!==sel.value).slice(0,4);
      for(const v of opts){ sel.value=v; sel.dispatchEvent(new Event('change')); await sleep(1000); }
      await sleep(2500);
      return { clicked:clicked, mapReqs:M.requests, mapCoords:coords(M.calls), mapDetail:detail(M.calls),
               /* 期望的坐标数不写死：它 = 3 路 × 局部网格点数（B13 后随地点变化） */
               ptN:(function(){ try{ return mapPts().length; }catch(e){ return -1; } })(),
               sgReqs:S.requests, sgCoords:coords(S.calls), sgBig:big, sgDetail:detail(S.calls),
               dataKeys:Object.keys(MapMod.data).length, dataDates:Object.keys(MapMod.data),
               tzSet:[...new Set(S.calls.concat(M.calls).map(c=>c.tz))] };
    })()`, returnByValue: true, awaitPromise: true
  });
  const P4 = p4.result.value || {};
  const p4ok = P4.mapReqs === 3 && P4.ptN > 0 && P4.mapCoords === 3 * P4.ptN && P4.sgBig === 0 && P4.sgCoords === 51 &&
    P4.dataKeys <= 3 && (P4.tzSet || []).length === 1 && P4.tzSet[0] === "auto";
  console.log("\n=== P4 计费请求 / B9 缓存上限 / 时区口径 ===");
  console.log("  地图一次强制取数: " + P4.mapReqs + " 个请求 / " + P4.mapCoords + " 坐标  " + JSON.stringify(P4.mapDetail));
  console.log("  按城市搜索后（地图已在缓存）: " + P4.sgReqs + " 个请求 / " + P4.sgCoords + " 坐标 / 其中大请求 " + P4.sgBig + " 个  " + JSON.stringify(P4.sgDetail));
  console.log("  单页「全量」（单点 + 地图）坐标数口径: 单点 " + P4.sgCoords + " + 地图 " + P4.mapCoords + " = " + ((P4.sgCoords || 0) + (P4.mapCoords || 0)) +
    "  ← 与「取并集合并」同值（坐标数守恒，见 _p4.js 注释）");
  console.log("  首屏实际开销（B11 懒加载后）: 只有单点的 " + P4.sgCoords + " 坐标，地图的 " + P4.mapCoords + " 需显式触发");
  console.log("  连切 4 个日期后 MapMod.data 日期键: " + P4.dataKeys + " " + JSON.stringify(P4.dataDates));
  console.log("  两侧时区口径: " + JSON.stringify(P4.tzSet));
  console.log("  " + (p4ok ? "PASS 地图 3×" + P4.ptN + "、城市搜索不再重复取数、缓存受 LRU 约束、时区口径统一" : "FAIL P4/B9/时区 断言未通过"));

  mark("P4 计费/B9/时区");   /* 上一段结束 */
  /* ---- F4 地图交互补全 · F3 演变曲线 · F6 可访问性 · F7 单位制 ----
     全部是 DOM 级断言，不产生新的取数（除点击"精细查询"那一次单点查询）。 */
  const ux = await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const waitIdle=async max=>{const t0=Date.now();while(State.busy&&Date.now()-t0<max)await sleep(300);return !State.busy;};
      const out={};
      out.url=location.search;
      /* F4 省份命中（射线法，直接用 GeoJSON 判定）—— 纯函数，与网格无关，照旧 */
      out.prov={SH:provOf(31.23,121.47), GD:provOf(23.13,113.26), XZ:provOf(29.65,91.17), overseas:provOf(35.0,140.0)};
      /* F4 省份下钻：必须选**当前网格真的覆盖到**的省份。
         B13 之后值场只覆盖查询点周围 500 km，原先硬编码的上海（此处查询点是哈尔滨，
         相距约 1300 km）在网格外，清单必然为空 —— 那是预期行为，界面上也有对应的
         空态文案（"该省在当前周边 N 个网格点里没有落点"），不是缺陷。
         改为从当前数据里取一个真实采样点，用它的省份下钻。 */
      const dDrill = mapSet();
      out.drillProv = (dDrill && dDrill.pts && dDrill.pts.length) ? dDrill.pts[0].prov : null;
      renderDrill(out.drillProv);
      await sleep(150);
      const dr=document.querySelector('#drill');
      out.drillOn=dr.classList.contains('on');
      out.drillCities=[...dr.querySelectorAll('.dcity .dn')].map(e=>e.textContent);
      out.drillHead=((dr.querySelector('.dhead')||{}).textContent||'').replace(/\\s+/g,' ').slice(0,80);
      renderDrill(null);
      /* F4 点图 → 精细查询入口。
         B13 之后值场只覆盖查询点周围 500 km，原先硬编码的南京（32.06,118.80）在网格外
         —— 此时查询点是哈尔滨，南京距其约 1500 km，showMapTip 会正确地拒绝显示
         （最近采样点 >260 km 就隐藏）。那是"范围收小"的预期结果，不是缺陷。
         所以改取**当前查询点附近**的一个非采样点：既走真实交互路径，
         又顺带覆盖"非采样点也能通过 IDW 取到值"这条。 */
      const tll = {lat: State.lat + 0.25, lon: State.lon + 0.25};
      out.tipName = (function(){ try{
        const nc = nearestCity(tll.lat, tll.lon, ALL_CITIES);
        return (nc && nc.distKm < 120) ? nc.city.name : "";
      }catch(e){ return ""; } })();
      showMapTip(tll, true);
      await sleep(200);
      const gb=document.querySelector('#tip .tgo');
      out.tgo=!!gb;
      out.tipHasConf=/数据可信度/.test((document.querySelector('#tip')||{}).textContent||'');
      if(gb){ gb.click(); await waitIdle(26000); }
      out.locAfter=(document.querySelector('#locHint')||{}).textContent||'';
      /* F6 数值直标（第二编码） */
      const nl=document.querySelector('#numLabels');
      nl.checked=true; nl.dispatchEvent(new Event('change'));
      await sleep(500);
      out.labels=document.querySelectorAll('#mapLabels .mlbl').length;
      out.labelTxt=[...document.querySelectorAll('#mapLabels .mlbl')].slice(0,3).map(e=>e.textContent);
      nl.checked=false; nl.dispatchEvent(new Event('change'));
      await sleep(200);
      out.labelsOff=document.querySelectorAll('#mapLabels .mlbl').length;
      /* F3 演变曲线。
         判据长期是"必须有 5 点双折线"，隐含前提是**几何条件成立**
         （geom.ok 为真时才有 5 个采样点；不成立时只有 1 个点，画不出曲线，
          renderRay 会改画一句"几何条件不成立"的说明 —— 那是设计内的合法状态）。
         而"几何成不成立"取决于前面几段把页面留在哪个点位 / 时段 / 日期上，
         日期还是**今天** —— 于是这条断言会随日历漂：2026-10-16 在 46°N 那一支上
         恰好不成立，就假失败了一次。
         改成"曲线或说明必有其一"，并把实际走了哪一支打出来 ——
         既不静默放宽（说明那一支也要验到），也不再把日历当输入。 */
      const rc=document.querySelector('#ray svg.rcurve');
      out.curve=!!rc;
      out.curveLines=rc?rc.querySelectorAll('polyline').length:0;
      out.curvePts=rc?((rc.querySelectorAll('polyline')[0].getAttribute('points')||'').trim().split(/\\s+/).length):0;
      out.curveMarks=rc?rc.querySelectorAll('line').length:0;
      out.geomOk=!!(State.result&&State.result.sRT&&State.result.sRT.geom&&State.result.sRT.geom.ok);
      out.rayNote=/几何条件不成立/.test((document.querySelector('#ray')||{}).textContent||'');
      /* F7 单位制 / 时间制（只影响展示，不重新取数） */
      const hero=()=>((document.querySelector('#hero')||{}).textContent||'');
      out.heroMetric=hero().replace(/\\s+/g,' ').slice(0,110);
      document.querySelector('#unitSeg button[data-u="imperial"]').click(); await sleep(300);
      out.imperialHasFt=/(ft|mi\\b|mph)/.test(hero());
      out.heroImperial=hero().replace(/\\s+/g,' ').slice(0,110);
      document.querySelector('#unitSeg button[data-u="metric"]').click(); await sleep(250);
      out.metricBack=/ km| m\\b|m \\//.test(hero());
      document.querySelector('#clockSeg button[data-c="12"]').click(); await sleep(250);
      out.clock12Has=/(AM|PM)/.test(hero());
      document.querySelector('#clockSeg button[data-c="24"]').click(); await sleep(200);
      /* 时段高亮与状态一致性（本轮顺手修掉的错位） */
      out.periodOn=(document.querySelector('#periodSeg button.on')||{}).dataset?document.querySelector('#periodSeg button.on').dataset.p:'';
      out.periodState=State.period;
      out.mapPeriodOn=(document.querySelector('#mapPeriod button.on')||{}).dataset?document.querySelector('#mapPeriod button.on').dataset.p:'';
      out.mapPeriodState=State.mapPeriod;
      out.ariaPressed=(document.querySelector('#periodSeg button.on')||{}).getAttribute?document.querySelector('#periodSeg button.on').getAttribute('aria-pressed'):'';
      out.warnCount=(typeof MapMod!=='undefined')?MapMod.warnCount:-1;
      out.softWarns=(typeof SOFT_WARNS!=='undefined')?SOFT_WARNS.slice(0,3):[];
      out.noscript=!!document.querySelector('noscript');
      out.labelsFor=[...document.querySelectorAll('label[for]')].map(e=>e.getAttribute('for'));
      return out;
    })()`, returnByValue: true, awaitPromise: true
  });
  const UX = ux.result.value || {};
  const uxok = /(^|\\?)lat=/.test(UX.url || "") && /period=/.test(UX.url || "")
    && UX.prov && UX.prov.SH === "上海市" && UX.prov.GD === "广东省" && UX.prov.XZ === "西藏自治区" && UX.prov.overseas === null
    && UX.drillOn === true && (UX.drillCities || []).length > 0 && !!UX.drillProv
    && (UX.drillHead || "").indexOf(UX.drillProv) >= 0
    && UX.tgo === true && UX.tipHasConf === true && !!UX.tipName && (UX.locAfter || "").indexOf(UX.tipName) >= 0
    && UX.labels > 0 && UX.labelsOff === 0
    && ((UX.curve === true && UX.curveLines === 2 && UX.curvePts === 5)
        || (UX.geomOk === false && UX.rayNote === true))
    && UX.imperialHasFt === true && UX.metricBack === true && UX.clock12Has === true
    && UX.periodOn === UX.periodState && UX.mapPeriodOn === UX.mapPeriodState && UX.ariaPressed === "true"
    && UX.noscript === true && (UX.labelsFor || []).indexOf("go") < 0 && (UX.labelsFor || []).length >= 4;
  console.log("\n=== F4 交互补全 / F3 曲线 / F6 可访问性 / F7 单位制 ===");
  console.log("  F4 地址栏: " + UX.url);
  console.log("  F4 省份命中: " + JSON.stringify(UX.prov) + "  下钻: " + UX.drillOn + " " + JSON.stringify(UX.drillCities) + " " + UX.drillHead);
  console.log("  F4 点图精细查询: 入口=" + UX.tgo + " 期望地名=" + UX.tipName + " 定位后=" + UX.locAfter);
  console.log("  F6 数值直标: 开=" + UX.labels + " " + JSON.stringify(UX.labelTxt) + " 关=" + UX.labelsOff + "  noscript=" + UX.noscript + "  label[for]=" + JSON.stringify(UX.labelsFor));
  console.log("  F3 演变曲线: svg=" + UX.curve + " 折线=" + UX.curveLines + " 采样点=" + UX.curvePts + " 竖线=" + UX.curveMarks +
    "  ← 几何" + (UX.geomOk ? "成立⇒画曲线" : "不成立⇒应给说明(" + (UX.rayNote ? "有" : "无") + ")"));
  console.log("  F7 单位制: 英制含 ft/mi/mph=" + UX.imperialHasFt + " 切回公制=" + UX.metricBack + " 12 时制=" + UX.clock12Has);
  console.log("  时段高亮一致性: 单点 " + UX.periodOn + "/" + UX.periodState + "  aria=" + UX.ariaPressed + " · 地图 " + UX.mapPeriodOn + "/" + UX.mapPeriodState);
  console.log("  地图模块软失败计数: " + UX.warnCount + " " + JSON.stringify(UX.softWarns));
  console.log("  " + (uxok ? "PASS F4/F3/F6/F7 全部就位" : "FAIL F4/F3/F6/F7 存在未通过的项"));

  mark("F4/F3/F6/F7 交互");   /* 上一段结束 */
  /* ---- P5 缓存写入不挡关键帧 · P6 排行榜差量更新 ----
     P5：写 localStorage 必须**异步**。同步调一次 mapCachePut 后立刻读，键应当还没出现；
         过一帧 + idle 再读，键应当已写入（证明只是推迟、不是丢掉）。
         另加一条守卫用例：把一个从不在 dataOrder 里的日期交给 mapCachePut，
         它不得被写进 localStorage（否则延迟写入会"复活"已被 LRU 淘汰的键）。
     P6：同一状态连调两次 renderRank，第二次必须复用已有节点（===
         比对失败就说明又整体重建了 DOM）。 */
  const P56 = (await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const out={};
      /* 必须取一个**确实在 LRU 记录里**的日期：前面的 P4 用例已经把地图日期切到
         别的天，State.dateStr 不一定还在 MapMod.dataOrder 中，那样守卫生效、
         合法写入也会被跳过，断言就成了假阴性。 */
      const ord = MapMod.dataOrder;
      const d = ord[ord.length - 1] || MapMod.curDate || State.dateStr;
      /* B13：缓存键里多了坐标维度（mapKeyOf = 前缀 + 日期 + "@lat,lon"），
         否则换地点后会读到旧地点的值场。断言必须跟着走 ——
         直接用 MAP_CACHE_PREFIX + d 拼键的话，读的是早已不存在的旧格式键，
         "延迟后已写入"会永远是 false（假阴性）。 */
      const key = mapKeyOf(d);
      const box = MapMod.data[d] || null;
      /* 同步读：刚调完就该"还没写" */
      localStorage.removeItem(key);
      mapCachePut(d, box || { am:null, pm:null });
      out.sync = localStorage.getItem(key) !== null;          /* 期望 false */
      /* 同一个空闲窗口里同时排两个写入：一个合法日期、一个从未出现在 dataOrder 里的日期。
         等窗口排空后分别读 —— 合法键应已写入（这同时证明"回调确实跑过了"），
         幽灵键必须仍然不存在（守卫生效，而不是"回调还没跑"造成的假通过）。 */
      localStorage.removeItem(key);
      mapCachePut(d, box || { am:null, pm:null });
      const ghost = "2000-01-01", gk = mapKeyOf(ghost);
      localStorage.removeItem(gk);
      mapCachePut(ghost, {});
      await sleep(700);
      out.late = localStorage.getItem(key) !== null;          /* 期望 true */
      out.ghost = localStorage.getItem(gk) !== null;          /* 期望 false */
      localStorage.removeItem(gk);
      /* P6 */
      renderRank();
      const r1 = document.querySelector('#rank .rr');
      const r2 = (renderRank(), document.querySelector('#rank .rr'));
      out.rows = document.querySelectorAll('#rank .rr').length;
      out.sameNode = !!(r1 && r2 && r1 === r2);
      return out;
    })()`, returnByValue: true, awaitPromise: true
  })).result.value || {};
  const p56ok = P56.sync === false && P56.late === true && P56.ghost === false &&
    P56.rows > 0 && P56.sameNode === true;
  console.log("\n=== P5 缓存写入 · P6 排行榜差量 ===");
  console.log("  P5 同步写入(期望 false)=" + P56.sync + "  延迟后已写入(期望 true)=" + P56.late +
    "  已淘汰日期被复活(期望 false)=" + P56.ghost);
  console.log("  P6 排行榜行数=" + P56.rows + "  连调两次复用同一节点=" + P56.sameNode);
  console.log("  " + (p56ok ? "PASS 缓存写入已移出关键帧且不复活淘汰键；排行榜为差量更新" : "FAIL P5/P6 断言未通过"));

  mark("P5 缓存/榜单");   /* 上一段结束 */
  /* ---- 趋势视图 ----
     关键一致性：所选日期那一格的概率，必须与上方单日精细结果**完全一致**
     （趋势与单日走同一个 computeAll、同一批数据、同一套样带几何）。
     行数**取自页面自己的 TREND_DAYS**，不再写死 7 —— 写死的话，改窗口长度后
     这里会以"断言失败"的形式报警，而它其实只是探针过期了，很容易被误当成代码 bug。
     （TREND_DAYS 是块 0 的顶层 const，在全局词法环境里，Runtime.evaluate 能直接按名取到。） */
  const f5 = await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      /* 先读**点之前**的初始文案：标题与按钮的天数由 initUI 从 TREND_DAYS 填进模板，
         点一次之后按钮文案会被 finally 改成"重新加载趋势"，那时就读不到了。
         模板里留的是不带数字的文案，所以这里没填上就说明 initUI 那段没生效 ——
         症状是界面上"未来趋势"永远缺个数字，很不起眼。 */
      const title0=(document.querySelector('#trendTitle')||{}).textContent||'';
      const btn0=(document.querySelector('#trendGo')||{}).textContent||'';
      document.querySelector('#trendGo').click();
      const t0=Date.now();
      while((!State.trend||!State.trend.rows)&&Date.now()-t0<45000) await sleep(500);
      const t=State.trend;
      const rows=[...document.querySelectorAll('#trendBody table.t-trend tbody tr')];
      const pvals=[...document.querySelectorAll('#trendBody td.td-cell .tp')]
        .map(e=>parseInt(e.textContent,10)).filter(v=>isFinite(v));
      const cur=document.querySelector('#trendBody td.td-cell.on');
      return { ok:!!(t&&t.rows), rows:rows.length, cells:pvals.length,
               emp:document.querySelectorAll('#trendBody td.td-cell.empty').length,
               uniq:[...new Set(pvals)].length,
               nDays:(typeof TREND_DAYS==='number'?TREND_DAYS:-1),
               winN:(t&&t.n)||-1, sD:t?t.sD:'', eD:t?t.eD:'',
               title0:title0, btn0:btn0,
               curCell:cur?(cur.querySelector('.tp')||{}).textContent:'', 
               curDate:State.dateStr, curPeriod:State.period,
               heroP:Math.round(State.result.P), heroQ:Math.round(State.result.Q),
               heroName:State.result.name,
               rowsJson:(t&&t.rows)?t.rows.map(r=>r.date+':'+(r.am?Math.round(r.am.P):'-')+'/'+(r.pm?Math.round(r.pm.P):'-')):[],
               ecOK:t?t.ecOK:null, aqOK:t?t.aqOK:null,
               btnTxt:(document.querySelector('#trendGo')||{}).textContent||'' };
    })()`, returnByValue: true, awaitPromise: true
  });
  const F5 = f5.result.value || {};
  /* 逐条列出，别串成一个巨型 && —— 挂了只知道"未通过"，不知道是哪一条。
     · rows === nDays：表格行数必须等于页面声明的窗口长度；
     · winN === nDays：本次默认（查询日=今天）窗口没有被夹短 —— 若被夹短，
       说明 trendWindow() 把"今天"也算到上限之外了，那是个真 bug；
     · cells === rows*2 且 emp === 0：合成数据覆盖整个请求区间，不该有空格子；
     · 初始文案含天数：验证 initUI 真的把 TREND_DAYS 填进了标题与按钮。 */
  const f5Checks = {
    "取数完成": F5.ok === true,
    "行数=TREND_DAYS": F5.rows === F5.nDays && F5.rows >= 7,
    "窗口未误夹": F5.winN === F5.nDays,
    "格子全有值": F5.cells === F5.rows * 2 && F5.emp === 0,
    "数值有区分度": F5.uniq >= 2,
    "当前格=单日精细": parseInt(F5.curCell, 10) === F5.heroP,
    "标题含天数": F5.title0.indexOf(String(F5.nDays)) >= 0,
    "按钮含天数": F5.btn0.indexOf(String(F5.nDays)) >= 0,
  };
  const f5bad = Object.keys(f5Checks).filter(k => !f5Checks[k]);
  const f5ok = f5bad.length === 0;
  console.log("\n=== 趋势视图（TREND_DAYS=" + F5.nDays + "） ===");
  console.log("  表格行数: " + F5.rows + "  实取天数: " + F5.winN + "  区间: " + F5.sD + " ~ " + F5.eD);
  console.log("  有值格子: " + F5.cells + "  空格子: " + F5.emp + "  不同数值个数: " + F5.uniq + "  EC缺=" + (F5.ecOK === false) + " AOD缺=" + (F5.aqOK === false));
  console.log("  逐日概率（朝/晚）: " + JSON.stringify(F5.rowsJson));
  console.log("  所选日期=" + F5.curDate + " 时段=" + F5.curPeriod + " 趋势格=" + F5.curCell + "  单日精细 P=" + F5.heroP + "%（" + F5.heroName + "）");
  console.log("  初始标题: " + JSON.stringify(F5.title0) + "  初始按钮: " + JSON.stringify(F5.btn0) + "  点后按钮: " + JSON.stringify(F5.btnTxt));
  console.log("  " + (f5ok ? "PASS 趋势 " + F5.rows + " 行 × 2 格全有值，且所选日期与单日精细结果逐位一致"
    : "FAIL 趋势视图：" + f5bad.join(" / ")));

  /* 趋势卡片与省份下钻面板的截图（此时是移动端 390 宽，正好顺带核对窄屏布局） */
  await shotPanel("#trendBody", "shot-trend.png", 1);
  await cdp.send("Runtime.evaluate", {
    expression: `(function(){renderDrill(provOf(23.13,113.26));return 1;})()`, returnByValue: true
  });
  await sleep(200);
  await shotPanel("#drill", "shot-drill.png", 1);
  await cdp.send("Runtime.evaluate", { expression: `(function(){renderDrill(null);return 1;})()`, returnByValue: true });

  /* =========================================================================
     第二批：分歧维度 / 图层叠加（图钉 · 可信度纱 · 底图压暗 · 缓存标记）
     -------------------------------------------------------------------------
     放在 B1 之前 —— B1 会把 #map 清空并留下兜底文案。
     ========================================================================= */
  const b2 = await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const out={};
      const d=mapSet();
      /* 色面指纹：只读 .rlayer 的画布像素 —— 可信度纱是**另一层**画布，
         如果它偷偷改动了色面，这个指纹就会变，断言即失败。 */
      const fp=()=>{ try{
        const cvs=[...document.querySelectorAll('.rlayer canvas')];
        let h=2166136261,n=0;
        for(const c of cvs){ const g=c.getContext('2d'); if(!g) continue;
          const d=g.getImageData(0,0,Math.min(c.width,200),Math.min(c.height,160)).data;
          for(let i=0;i<d.length;i+=97){ h=((h^d[i])*16777619)>>>0; n++; } }
        return 'r'+h+':'+n; }catch(e){ return 'ERR'; } };

      /* ---- ① 分歧纯函数：极差 / 缺模型 / 与所选模型无关 ---- */
      const pt=(g,e,r)=>({p:{gfs:g,ec:e,rt:r},q:{gfs:g,ec:e,rt:r}});
      out.dv1 = divergeOf(pt(80,60,40));                    // 80-40 = 40
      out.dv2 = divergeOf(pt(50,null,70));                  // 两套有值 → 20
      out.dv3 = divergeOf(pt(50,null,null));                // 只有一套 → 无意义
      out.dv4 = divergeOf({p:{},q:{}});
      out.dv5 = divergeOf(pt(30,30,30));                    // 完全一致 → 0（有值，不是 null）
      /* 与"当前选中哪个模型"无关：这是这条维度最容易被写错的地方 */
      const probe = d && d.pts ? d.pts.find(o=>isNum(dimOf(o,'dv','ens'))) : null;
      out.dvIndep = probe
        ? (dimOf(probe,'dv','gfs')===dimOf(probe,'dv','rt') && dimOf(probe,'dv','ens')===dimOf(probe,'dv','ec'))
        : null;
      /* 与 mix 维度必须给出不同的数（否则说明 dimOf 没分流） */
      out.dvDiffers = probe ? (dimOf(probe,'dv','ens') !== dimOf(probe,'mix','ens')) : null;

      /* ---- ② 分歧维度的界面联动 ---- */
      const dimSel=document.querySelector('#mapDim'), mSel=document.querySelector('#mapModel');
      const fpMix=fp();
      dimSel.value='dv'; dimSel.dispatchEvent(new Event('change'));
      await sleep(400);
      out.modelDisabled = mSel.disabled === true;
      out.tag = (document.querySelector('#mapTag')||{}).textContent||'';
      out.rankScope = (document.querySelector('#rankScope')||{}).textContent||'';
      out.rankTitle = (document.querySelector('#rankTitle')||{}).textContent||'';
      out.lgRows = ((document.querySelector('#lgRows')||{}).textContent||'').slice(0,90);
      out.dvPts = mapSet().pts.filter(o=>isNum(dimOf(o,'dv','ens'))).length;
      out.dvFpDiff = fp() !== fpMix;
      dimSel.value='mix'; dimSel.dispatchEvent(new Event('change'));
      await sleep(400);
      out.modelEnabled = mSel.disabled === false;

      /* ---- ③ 图钉层：查询点常显，采样点按需 ---- */
      const pin=document.querySelector('#mapPins');
      out.pinLayer = !!pin;
      out.pinQuery = pin ? pin.querySelectorAll('.pin.q').length : -1;
      const sp=document.querySelector('#showPts');
      sp.checked=true; sp.dispatchEvent(new Event('change'));
      await sleep(250);
      out.pinSamples = pin ? pin.querySelectorAll('.pin.s').length : -1;
      out.pinGrid = mapPts().length;
      /* 拖动/缩放后位置必须重算（改的是 transform），且**不该重建节点** */
      const nodeBefore = pin.querySelector('.pin.q');
      const t0 = nodeBefore.style.transform;
      window.__TMAP_SETVIEW(7, State.lat+0.6, State.lon+0.6);
      await sleep(250);
      const t1 = pin.querySelector('.pin.q').style.transform;
      out.pinMoved = !!t0 && !!t1 && t0 !== t1;
      out.pinSameNode = pin.querySelector('.pin.q') === nodeBefore;
      sp.checked=false; sp.dispatchEvent(new Event('change'));
      await sleep(150);
      out.pinAfterOff = pin.querySelectorAll('.pin.s').length;

      /* ---- ④ 可信度纱：独立画布，色面像素一个都不能变 ---- */
      const fpBefore = fp();
      const sconf=document.querySelector('#showConf'), conf=document.querySelector('#mapConf');
      out.confCanvas = conf ? conf.querySelectorAll('canvas').length : -1;
      out.confOnBefore = conf ? conf.classList.contains('on') : null;
      sconf.checked=true; sconf.dispatchEvent(new Event('change'));
      await sleep(300);
      out.confOn = conf ? conf.classList.contains('on') : null;
      out.fpSame = fp() === fpBefore;
      /* 纱的覆盖范围必须与几何完全一致：非透明格子数 = 「色面有像素 且 在凸包之外」的格子数。
         判据与 buildConfStrips 同源（凸包，不是"距最近采样点 > FIELD_FULL"）：
         凸包改造之后淡出边界挪到了凸包上，纱必须跟着走，否则两者对不齐
         （见 _p6.js buildConfStrips 顶上那段实测）。 */
      const fd = MapMod.field;
      let want=0;
      const gg=GEOM_CACHE.geom, hud=gg&&gg.hud, HH=hud?hud.edges:null;
      if (fd && HH) for(let r=0;r<fd.rows;r++){
        const Y=((fd.laN - r*fd.dLa) - hud.olat) * 110.574;
        for(let c=0;c<fd.cols;c++){
          const o=r*fd.cols+c;
          if(fd.img[o*4+3]===0) continue;
          const X=(fd.loW + c*fd.dLo - hud.olon) * hud.kx;
          let sd=-1e9;
          for(let k=0;k<HH.length;k+=3){
            const d=HH[k]*X+HH[k+1]*Y+HH[k+2];
            if(d>sd) sd=d;
          }
          if(sd>0) want++;
        }
      }
      let got=0;
      if (conf) for(const c of conf.querySelectorAll('canvas')){
        const g=c.getContext('2d'); const dd=g.getImageData(0,0,c.width,c.height).data;
        for(let i=3;i<dd.length;i+=4) if(dd[i]>0) got++;
      }
      out.veilWant=want; out.veilGot=got;

      /* ---- ⑤ 底图压暗：必须在色面层之前（DOM 顺序 + z-index 双保险）---- */
      const rl=document.querySelector('.rlayer'), dbEl=document.querySelector('.dimbase');
      out.dimExists = !!dbEl;
      out.dimBefore = !!(rl&&dbEl) && (dbEl.compareDocumentPosition(rl) & 4) !== 0;
      out.dimZ = dbEl ? getComputedStyle(dbEl).zIndex : '';
      out.rlZ = rl ? getComputedStyle(rl).zIndex : '';
      out.dimPxOff = dbEl ? getComputedStyle(dbEl).opacity : '';
      const dbc=document.querySelector('#dimBase');
      dbc.checked=true; dbc.dispatchEvent(new Event('change'));
      await sleep(300);
      out.dimPxOn = dbEl ? getComputedStyle(dbEl).opacity : '';
      dbc.checked=false; dbc.dispatchEvent(new Event('change'));
      await sleep(250);

      /* ---- ⑥ 日期下拉的缓存标记：只标 textContent，不动 value ---- */
      const sel2=document.querySelector('#mapDateSel');
      out.marked=[...sel2.options].filter(o=>/已就绪|已缓存/.test(o.textContent))
                    .map(o=>o.value+'/'+(/已就绪/.test(o.textContent)?'mem':'ls'));
      out.optCount=sel2.options.length;
      /* "标记不影响选中"的含义是：选中值仍是某个真实选项，且与地图当前日期一致。
         不能拿它跟 State.dateStr 比 —— 组合遍历那段会把 dateSel 拨到别的日期，
         那是上一个测试留下的状态，与本功能无关（第一版就在这里误判成 FAIL）。 */
      out.selValueOk = [...sel2.options].some(o=>o.value===sel2.value) && sel2.value === MapMod.curDate;
      out.baseKept = [...sel2.options].every(o=>o.textContent.indexOf(o.value)===0);
      out.readyCount = MapMod.cachedN;
      return out;
    })()`, returnByValue: true, awaitPromise: true
  });
  const B2 = b2.result.value || {};
  const b2ok = B2.dv1 === 40 && B2.dv2 === 20 && B2.dv3 === null && B2.dv4 === null && B2.dv5 === 0
    && B2.dvIndep === true && B2.dvDiffers === true && B2.dvPts > 0 && B2.dvFpDiff === true
    && B2.modelDisabled === true && B2.modelEnabled === true
    && /模型分歧/.test(B2.tag || "") && /模型分歧/.test(B2.rankScope || "")
    && /模型分歧/.test(B2.rankTitle || "")
    && B2.pinLayer === true && B2.pinQuery === 1
    && B2.pinSamples === B2.pinGrid && B2.pinGrid === 57 && B2.pinAfterOff === 0
    && B2.pinMoved === true && B2.pinSameNode === true
    && B2.confCanvas > 0 && B2.confOnBefore === false && B2.confOn === true && B2.fpSame === true
    && B2.veilWant > 0 && B2.veilWant === B2.veilGot
    && B2.dimExists === true && B2.dimBefore === true
    && Number(B2.dimZ) < Number(B2.rlZ)
    && B2.dimPxOff === "0" && Number(B2.dimPxOn) > 0
    && B2.baseKept === true && B2.selValueOk === true && B2.optCount === 18
    && B2.readyCount >= 1;
  console.log("\n=== 第二批 · 分歧维度 / 图钉 / 可信度纱 / 底图压暗 / 缓存标记 ===");
  console.log("  分歧纯函数: 极差=" + B2.dv1 + " 缺一模型=" + B2.dv2 + " 仅一套=" + B2.dv3
    + " 无数据=" + B2.dv4 + " 完全一致=" + B2.dv5);
  console.log("  分歧维度: 与所选模型无关=" + B2.dvIndep + " 与综合指数不同值=" + B2.dvDiffers
    + " 有值点=" + B2.dvPts + " 色面指纹变化=" + B2.dvFpDiff);
  console.log("  界面联动: #mapModel 置灰=" + B2.modelDisabled + "/恢复=" + B2.modelEnabled
    + " · 标签=" + JSON.stringify(B2.tag) + " · 榜单=" + JSON.stringify(B2.rankTitle) + " " + JSON.stringify(B2.rankScope));
  console.log("  图例等级行: " + JSON.stringify(B2.lgRows));
  console.log("  图钉: 层=" + B2.pinLayer + " 查询点=" + B2.pinQuery + " 采样点=" + B2.pinSamples + "/" + B2.pinGrid
    + " 关闭后=" + B2.pinAfterOff + " 移动后重定位=" + B2.pinMoved + " 节点复用=" + B2.pinSameNode);
  console.log("  可信度纱: 画布=" + B2.confCanvas + " 开启前=" + B2.confOnBefore + " 开启后=" + B2.confOn
    + " 色面指纹不变=" + B2.fpSame + " 覆盖格 " + B2.veilGot + " 期望 " + B2.veilWant);
  console.log("  底图压暗: z " + B2.dimZ + " < 色面 " + B2.rlZ + " · 在色面之前=" + B2.dimBefore
    + " · opacity " + B2.dimPxOff + " → " + B2.dimPxOn);
  console.log("  缓存标记: " + JSON.stringify(B2.marked) + " · 选项数=" + B2.optCount
    + " · value 未受影响=" + B2.selValueOk + " · 基础文案保留=" + B2.baseKept);
  console.log("  " + (b2ok ? "PASS 第二批五项全部就位（分歧维度 / 图钉 / 可信度纱 / 底图压暗 / 缓存标记）"
    : "FAIL 第二批存在未通过的项"));


  mark("趋势视图与第二批");   /* 上一段结束 */
  /* ---- 下一批：B2 可信度徽标 / B3 分歧口径统一 / B1 分享卡 ----
     三项都是纯渲染，零取数。这里钉住的是"同一个量在界面上只允许有一种口径"：
     徽标的档位、结论卡的"一致性 %"、因素表的"模式一致性"行、地图的 dv 维度，
     必须全部来自 parts 的 I 极差，且档位阈值只来自 ENS_CONF_BANDS。
     另外钉一条**防同名覆盖**：`_p6.js` 里有个同名不同义的 `confOf(km)`（空间可信度），
     函数声明是覆盖语义且不报错 —— 最初就是这样把单点的分歧档位顶掉了，
     徽标一度显示成"可信度 较高 / 距最近采样点 11 km / undefined"。
     所以这里既查 `r.conf` 必须是 ENS_CONF_BANDS 里的**同一个对象**（引用相等），
     也查 `confOf !== ensConfOf`（两者确实还存在、没被合并成一个）。
     分享卡则把 toBlob / a.click 打桩，验证"画了什么尺寸、下了什么文件名"，
     而不真的触发下载（无头模式下会往磁盘写文件）。 */
  const nx = await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const out={};
      const r=State.result;
      out.hasResult=!!r;
      if(!r) return out;

      /* --- B2 徽标 --- */
      const bd=document.querySelector('#hero .cfbadge');
      out.badge=!!bd;
      out.badgeTxt=bd?bd.textContent.replace(/\\s+/g,' ').trim():'';
      out.badgeVar=bd?bd.style.getPropertyValue('--cfb'):null;
      out.bandKeys=ENS_CONF_BANDS.map(b=>b.key).join('/');
      out.bandLv=ENS_CONF_BANDS.map(b=>b.lv).join('/');
      out.confKey=r.conf?r.conf.key:null;
      out.confColor=r.conf?r.conf.color:null;
      /* 防同名覆盖：r.conf 必须是 ENS_CONF_BANDS 里的同一个对象；且 _p6.js 的 confOf 仍在 */
      out.confIdentity=ENS_CONF_BANDS.indexOf(r.conf)>=0;
      out.confHint=!!(r.conf&&r.conf.hint);
      out.p6ConfDistinct=(function(){
        try{ return typeof confOf==='function' && typeof ensConfOf==='function' && confOf!==ensConfOf; }
        catch(e){ return false; }
      })();
      out.p6ConfSame=(function(){ try{ return confOf===ensConfOf; }catch(e){ return true; } })();

      /* --- B3 口径统一 --- */
      out.dvI=r.dvI; out.spread=r.spread; out.spreadQ=r.spreadQ; out.consist=r.consist;
      out.expectConsist=Math.max(0,Math.min(100,100-(r.dvI||0)*1.9));
      out.stillUsesSpread=Math.abs(r.consist-(100-(r.spread||0)*1.9))<0.01;
      out.mapDvSameFn=(function(){ try{ return typeof divergeOf==='function'; }catch(e){ return false; } })();
      out.partsI=(r.parts||[]).map(x=>Math.round(x.I)).join('/');
      const hints=[...document.querySelectorAll('#hero .hint')].map(e=>e.textContent.replace(/\\s+/g,' ').trim());
      out.iLine=hints.filter(t=>/综合指数/.test(t)).join(' | ');
      const rows=[...document.querySelectorAll('#fac tbody tr')];
      const fr=rows.filter(t=>{const td=t.querySelector('td');return td&&/模式一致性/.test(td.textContent);})[0];
      out.facRow=fr?[...fr.querySelectorAll('td')].map(td=>td.textContent.replace(/\\s+/g,' ').trim()).join(' || '):null;
      out.noOld18=!/个百分点/.test((out.facRow||'').split('||')[1]||'');
      out.heroHasPartNames=/GFS/.test(out.iLine||'')&&/EC/.test(out.iLine||'')&&/光追/.test(out.iLine||'');

      /* --- B1 分享卡（打桩，不落盘） --- */
      const btn=document.querySelector('#shareCard');
      out.cardBtn=!!btn; out.cardEnabled=!!(btn&&!btn.disabled);
      const oToBlob=HTMLCanvasElement.prototype.toBlob;
      const oClick=HTMLAnchorElement.prototype.click;
      const oCreate=URL.createObjectURL, oRevoke=URL.revokeObjectURL;
      let shot=null, dl=null;
      HTMLCanvasElement.prototype.toBlob=function(cb,type){
        const cv=this;
        return oToBlob.call(this,function(b){ shot={type:type,size:b?b.size:0,w:cv.width,h:cv.height}; cb(b); },type);
      };
      URL.createObjectURL=function(){ return 'blob:stub'; };
      URL.revokeObjectURL=function(){};
      HTMLAnchorElement.prototype.click=function(){ dl=this.download; };
      try{ shareCard(); }catch(e){ out.cardErr=String((e&&e.message)||e); }
      /* 轮询等 toBlob 回调，别用固定 sleep：1560x800 的 PNG 编码实测 800 KB 上下，
         机器一忙就会超过 500 ms，固定等待会让这条断言时灵时不灵（已经踩过一次）。 */
      const t0=Date.now();
      while(!shot && !out.cardErr && Date.now()-t0<10000) await sleep(100);
      HTMLCanvasElement.prototype.toBlob=oToBlob;
      HTMLAnchorElement.prototype.click=oClick;
      URL.createObjectURL=oCreate; URL.revokeObjectURL=oRevoke;
      out.shot=shot; out.dl=dl;
      out.cardW=CARD_W*2; out.cardH=CARD_H*2;
      return out;
    })()`, returnByValue: true, awaitPromise: true
  });
  const NX = nx.result.value || {};
  /* 逐条列出而不是串成一个巨型 &&：这条链上任何一处挂了，都要能一眼看出是哪一处。
     上次就是被一个写成 `/\\.png$/` 的正则（模板串内转义的写法带到了 node 侧，
     实际要求字符串里有字面反斜杠）挡住，整段只报"未通过"，害得重跑一次三分钟。 */
  const NXC = {
    "拿到结果": NX.hasResult === true,
    "徽标存在": NX.badge === true,
    "徽标文案含「可信度」「ΔI」": /可信度/.test(NX.badgeTxt || '') && /ΔI/.test(NX.badgeTxt || ''),
    "档位表三档": NX.bandKeys === 'hi/mid/lo' && NX.bandLv === '高/中/低',
    "徽标色 = 档位色": NX.badgeVar === NX.confColor,
    "conf 是 ENS_CONF_BANDS 的同一对象": NX.confIdentity === true,
    "conf.hint 有值": NX.confHint === true,
    "同名守护（confOf ≠ ensConfOf）": NX.p6ConfDistinct === true && NX.p6ConfSame === false,
    "一致性由 dvI 导出": Math.abs(NX.consist - NX.expectConsist) < 0.01 && NX.stillUsesSpread === false,
    "地图 divergeOf 仍在": NX.mapDvSameFn === true,
    "三家 I 并列": (NX.partsI || '').split('/').length === 3,
    "结论卡 I 行含三算法名": /综合指数/.test(NX.iLine || '') && /GFS/.test(NX.iLine || '')
      && /EC/.test(NX.iLine || '') && /光追/.test(NX.iLine || ''),
    "因素表行已换口径": /ΔI/.test(NX.facRow || '') && NX.noOld18 === true && /高|中|低/.test(NX.facRow || ''),
    "分享按钮可用": NX.cardBtn === true && NX.cardEnabled === true && !NX.cardErr,
    "分享卡 PNG 尺寸": !!NX.shot && NX.shot.type === 'image/png' && NX.shot.size > 2000
      && NX.shot.w === NX.cardW && NX.shot.h === NX.cardH,
    "分享卡文件名": /^霞光预报_/.test(NX.dl || '') && /\.png$/.test(NX.dl || '')
  };
  const nxBad = Object.keys(NXC).filter(k => !NXC[k]);
  const nxOk = nxBad.length === 0;
  console.log("\\n=== 下一批 · 可信度徽标 / 分歧口径统一 / 分享卡 ===");
  console.log("  徽标: 存在=" + NX.badge + " 档位=" + NX.confKey + " 色=" + NX.badgeVar + "（ENS_CONF_BANDS 给的 " + NX.confColor + "）");
  console.log("  徽标文案: " + JSON.stringify(NX.badgeTxt));
  console.log("  档位表: key=" + NX.bandKeys + " · lv=" + NX.bandLv);
  console.log("  同名守护: r.conf∈ENS_CONF_BANDS=" + NX.confIdentity + " · hint 有值=" + NX.confHint
    + " · confOf≠ensConfOf=" + NX.p6ConfDistinct + "（同=" + NX.p6ConfSame + "）");
  console.log("  口径: ΔI=" + NX.dvI + " ΔP=" + NX.spread + " ΔQ=" + NX.spreadQ
    + " · 一致性=" + Math.round(NX.consist) + "%（按 dvI 期望 " + Math.round(NX.expectConsist) + "%）"
    + " · 仍用 ΔP 口径=" + NX.stillUsesSpread);
  console.log("  三算法 I: " + NX.partsI + "  · 结论卡行: " + JSON.stringify(NX.iLine));
  console.log("  因素表行: " + JSON.stringify(NX.facRow));
  console.log("  分享卡: 按钮=" + NX.cardBtn + " 可用=" + NX.cardEnabled
    + " · 产物 " + (NX.shot ? NX.shot.w + "x" + NX.shot.h + " " + NX.shot.type + " " + NX.shot.size + "B" : "无")
    + " · 文件名 " + JSON.stringify(NX.dl) + (NX.cardErr ? " · 异常 " + NX.cardErr : ""));
  console.log("  断言 " + Object.keys(NXC).length + " 条，未通过 " + nxBad.length + " 条"
    + (nxBad.length ? "：" + nxBad.join(" / ") : ""));
  console.log("  " + (nxOk ? "PASS 徽标 / 分歧口径统一 / 分享卡全部就位" : "FAIL 下一批存在未通过的项"));


  mark("下一批 B2/B3/分享卡");   /* 上一段结束 */
  /* ---- B1 部署缺陷探测（放在最后：它会清空 #map） ----
     地图起不来有三种原因，兜底文案必须分开说：① 离线/脚本被拦（联网会恢复）；
     ② 代理地址仍是占位符 __WB_*（部署问题，联网也没用）。这里把 window.TMap 摘掉，
     分别在"占位符"与"真实地址"两种配置下调用 initMap()，核对输出文案。
     注意：本探测会把 #map 清空并留下兜底文案，所以必须排在所有截图之后。 */
  const b1 = await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{
      const saveT = window.TMap, saveCfg = window._TMapSecurityConfig;
      const run = async host => {
        delete window.TMap;
        window._TMapSecurityConfig = { serviceHost: host };
        const box = document.querySelector('#map');
        box.innerHTML = '';
        await initMap();
        const el = box.querySelector('.mapfail');
        return { found: !!el, txt: el ? el.textContent.replace(/\\s+/g,' ').trim() : '' };
      };
      const out = {};
      out.placeholder = await run('http://127.0.0.1:__WB_HTTP_PORT__/_TMapService/_wbt/__WB_TMAP_SECRET__');
      out.unreplaced = await run('__TMAP_SERVICE_HOST__');
      out.real = await run('http://127.0.0.1:1622/_TMapService/_wbt/50c4012a2a6c4d2b90dcf49e74af3418');
      window.TMap = saveT; window._TMapSecurityConfig = saveCfg;
      return out;
    })()`, returnByValue: true, awaitPromise: true
  });
  const B1 = b1.result.value || {};
  /* 占位符场景必须：点出"占位符"、给出可自救的出口（README）、且**不许**再出现
     "预览 / 分享页"这种把自行部署的用户引错方向的措辞。两种占位符形态都要覆盖 ——
     构建时没注入（__TMAP_SERVICE_HOST__）与开发兜底（__WB_*）用户看到的现象相同。 */
  const phOk = o => !!(o && o.found && /占位符/.test(o.txt) && /README/.test(o.txt)
    && !/预览|分享/.test(o.txt));
  const b1ok = phOk(B1.placeholder) && phOk(B1.unreplaced)
    && !!(B1.real && B1.real.found && !/占位符/.test(B1.real.txt) && /联网/.test(B1.real.txt));
  console.log("\n=== B1 地图兜底文案判定 ===");
  console.log("  占位符场景: " + JSON.stringify(B1.placeholder));
  console.log("  未注入场景: " + JSON.stringify(B1.unreplaced));
  console.log("  真实地址场景: " + JSON.stringify(B1.real));
  console.log("  " + (b1ok ? "PASS 已区分「占位符未替换」与「离线」两种原因" : "FAIL 兜底文案未正确区分原因"));

  console.log(JSON.stringify({ state: st, hover: hover.result.value,
    hoverThrottle: { raf: hover1.result.value, dom: hover2.result.value },
    sw: sw.result.value,
    model: modelTest.result.value, re: re.result.value, p4: P4, ux: UX, f5: F5, b2: B2,
    mock: { homeOnly: homeMock, afterMapKick: mapMock, modelSwitchDelta: mockAfter - mockBefore,
            ecFailed: mockEC, log: mockLog } }, null, 1));
  mark("B1 部署缺陷探测");
  /* 分段耗时表：按耗时倒序。每天真正常跑的人看这张表就知道该跳哪几段。
     SEG_FAST 下被跳过的段落已在上文各自打了"已跳过"一行，表里仍会出现该段
     （它只跳过探针本身，段内的等空转仍在），所以别按表的行数推断覆盖面。 */
  mark("收尾与报告");
  const segTotal = SEG_LOG.reduce((a, x) => a + x[1], 0);
  console.log("\n=== 分段耗时（总计 " + (segTotal / 1000).toFixed(1) + " s）===");
  SEG_LOG.slice().sort((a, b) => b[1] - a[1]).forEach(x => {
    console.log("  " + String((x[1] / 1000).toFixed(1)).padStart(6) + " s  "
      + String(Math.round(100 * x[1] / segTotal)).padStart(3) + "%  " + x[0]);
  });
  console.log("\n=== 控制台错误 (" + errs.length + ") ===");
  errs.slice(0, 40).forEach(e => console.log("  " + e));
  console.log("\n=== 控制台日志(末 25 条) ===");
  logs.slice(-25).forEach(l => console.log("  " + l));

  /* 汇总（用 __log，避免这句自己被上面那层包装登记进去） */
  __log("");
  __log("FAIL 计数: " + __fails.length);
  __fails.slice(0, 12).forEach(s => __log("  · " + s.replace(/\s+/g, " ").trim().slice(0, 150)));

  await cdp.send("Browser.close").catch(() => { });
  chrome.kill();
  srv.close();
  process.exit(__fails.length ? 1 : 0);
})().catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
