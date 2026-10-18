/* UI 默认态与分组结构探针（第五轮 UI）—— 零额度（全部合成数据）。
 *
 * 为什么必须单独写：这一轮全是"**默认态**"决策 —— 哪里默认收起、控件怎么分组。
 * 而默认态是**最容易静默回退**的一类东西：
 *   · 某人为了调试把⑤展开，忘关，提交 —— 没有任何现存断言会红；
 *   · 调整布局时把分组标签删了 —— 视觉上"只是少一行小字"，机器无感；
 *   · 把 <details> 的 open 写死成 true —— "详情层"悄悄变成"永远展开"。
 * 存量探针里没有一条守这些（mobileprobe 守窄屏布局、a11yprobe 守可访问性、
 * snapprobe 守快照模式的 data-snaphide 总数），所以新开这一支。
 *
 * 量与判（全部单页内，不起第二次导航 —— 跨加载的持久化归 persistprobe）：
 *   A. 查询区三组：标签齐全且顺序正确；每个控件都落在决策指定的组里
 *   B. 地图工具条两组：标签齐全；五个图层复选框在「显示层」、取数控件在「数据源」
 *   C. 四处默认收起：光追/数据质量卡（folded + aria-expanded=false + 文案=展开）、
 *      结论卡详情 / 趋势表 / 图例说明三个 details 全部 open=false；
 *      且"图例的本体"（色条 / 等级行）与 F3 日历都在 details **之外**（没被折叠埋掉）
 *   D. 折叠交互：点按钮能展开、再点能收起，aria-expanded 与文案同步
 *   E. 快照兼容：body.snapmode 下光追/数据质量卡仍整卡隐藏（data-snaphide 不被折叠破坏）
 *   F. 上述全部是纯显示操作 ⇒ 零新增请求（额度纪律：UI 重组不许偷额度）
 *
 * 与 persistprobe 的分工：那边管"折叠状态跨加载读写回 + 坏值降级"，
 * 这边管"默认态本身长什么样 + 分组结构 + 交互 + 快照兼容"。互不重复。
 *
 * 用法: node _check/uiprobe.js
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

/* 与 mapaudit / mobileprobe / cdp / persistprobe 同源的合成数据 */
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

let reqN = 0;            // 请求计数（只数 open-meteo）

(async function main() {
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "ui-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + DEBUG_PORT, "--user-data-dir=" + udd,
    "--window-size=1280,900", "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let cerr = "";
  chrome.stderr.on("data", d => { cerr += d.toString(); });

  let ver = null;
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    try { ver = await (await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/version")).json(); break; } catch (e) { }
  }
  if (!ver) { console.log("CHROME_START_FAIL\n" + cerr.slice(0, 2000)); process.exit(1); }
  const list = await (await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/list")).json();
  const page = list.find(t => t.type === "page") || list[0];
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);

  const errs = [];
  cdp.on(m => {
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errs.push((m.params.args || []).map(a => a.value === undefined ? a.description : a.value).join(" "));
    } else if (m.method === "Runtime.exceptionThrown") {
      errs.push((m.params.exceptionDetails || {}).text || "exception");
    }
  });

  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
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
      reqN++;
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
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      const ex = d.exception || {};
      throw new Error("页内异常: " + (d.text || "") + " | " + (ex.description || ex.value || ""));
    }
    return r.result.value;
  };
  /* 就绪判据用 typeof State !== 'undefined' —— State 是顶层 const（词法全局），
     window.State 恒为 undefined（calibprobe 踩过：写错会让轮询静默跑满预算）。 */
  const loadAndWait = async (label) => {
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/preview.html" });
    for (let i = 0; i < 60; i++) {
      await sleep(700);
      let s = null;
      try {
        s = await ev(`({ res: !!(typeof State !== 'undefined' && State.result),
          ui: !!(document.getElementById('numLabels')) })`);
      } catch (e) { continue; }
      if (s.res && s.ui) { await sleep(600); return true; }
    }
    console.log("  FATAL " + label + "：首屏未就绪");
    return false;
  };

  console.log("=".repeat(74));
  console.log("UI 默认态与分组结构探针 —— 第五轮 UI（全部合成数据，零额度）");
  console.log("=".repeat(74));

  if (!await loadAndWait("加载")) { chrome.kill(); srv.close(); process.exit(1); }

  /* ---------- A. 查询区：一行条 + 折叠面板三组（视觉方案二 P0） ---------- */
  const A = await ev(`(function(){
    var card = document.getElementById('q').closest('.card');
    var qs = card.querySelectorAll('.qgroup');
    var labels = [...card.querySelectorAll('.qgroup > .qlabel')].map(e => e.textContent);
    /* 面板里每个控件落在哪一组：取其最近的 .qgroup 的标签文案 */
    var groupOf = function(el){ var g = el && el.closest('.qgroup'); return g ? g.querySelector('.qlabel').textContent : null; };
    var g = function(id){ return groupOf(document.getElementById(id)); };
    /* 一行条上的控件：以 #qBar 为锚（决策四件套不再属于任何 .qgroup） */
    var barHas = function(id){ var bar = document.getElementById('qBar'); return !!bar && !!bar.querySelector('#' + id); };
    var qm = document.getElementById('qMore');
    return {
      qCount: qs.length, labels: labels,
      bar: { q: barHas('q'), date: barHas('date'), period: barHas('periodSeg'),
             go: barHas('go'), more: barHas('qMoreBtn') },
      geo: g('geoBtn'), now: g('nowBtn'),
      presets: g('presets'), locHint: g('locHint'),
      unit: g('unitSeg'), clock: g('clockSeg'),
      autoMap: g('autoMap'), lang: g('langSeg'), theme: g('themeSeg'),
      moreHidden: !!qm && qm.hidden,
      ariaExp: document.getElementById('qMoreBtn').getAttribute('aria-expanded'),
      /* 分组只换位置：控件 id 一个没动，外加一行条的三个新锚点 */
      ids: ['q','lat','lon','date','go','periodSeg','geoBtn','nowBtn','autoMap',
            'unitSeg','clockSeg','langSeg','themeSeg','presets','locHint',
            'qBar','qMore','qMoreBtn']
             .every(id => !!document.getElementById(id))
    };
  })()`);
  console.log("\n=== A. 查询区一行条 + 三组 ===");
  console.log("  组数=" + A.qCount + " · 标签=" + JSON.stringify(A.labels));
  console.log("  一行条：地点=" + A.bar.q + " 日期=" + A.bar.date + " 时段=" + A.bar.period
    + " 开始预报=" + A.bar.go + " 更多选项=" + A.bar.more);
  console.log("  面板：查什么组（定位=" + A.geo + " 今天=" + A.now + " 预设=" + A.presets + " 提示=" + A.locHint + ")"
    + " · 显示组：单位=" + A.unit + " 时间制=" + A.clock
    + " · 界面组：自动刷新=" + A.autoMap + " 语言=" + A.lang + " 主题=" + A.theme);
  console.log("  默认收起=" + A.moreHidden + " aria-expanded=" + A.ariaExp);

  /* ---------- A2. 两级卡片：只有结论与地图「有面」（视觉方案四） ----------
     九张卡拆成"两块面板 + 若干分区"是这套视觉的核心不变量。按**身份**判：
     .card:not(.q) 的 id 集合恰为 cardHero/cardMap —— 以后新增分区不会假失败，
     但只要有人给某个分区补回底色或阴影，dirty 就会非空、断言变红。
     结论数字的"衬线大字、不加粗"同理：字号与字重一起判，防止退回粗黑体。 */
  const A2 = await ev(`(function(){
    var all = [].slice.call(document.querySelectorAll('.card'));
    var panels = all.filter(function(c){ return !c.classList.contains('q'); })
                    .map(function(c){ return c.id; }).sort();
    var qs = all.filter(function(c){ return c.classList.contains('q'); });
    var dirty = qs.filter(function(c){
      var s = getComputedStyle(c);
      return s.boxShadow !== 'none' || s.backgroundColor !== 'rgba(0, 0, 0, 0)';
    }).map(function(c){ return c.id || '(匿名分区)'; });
    var num = document.querySelector('#hero .hero-num');
    var ns = num ? getComputedStyle(num) : null;
    return {
      panels: panels, dirty: dirty, qN: qs.length,
      numSerif: !!ns && /serif/i.test(ns.fontFamily),
      numPx: ns ? parseFloat(ns.fontSize) : 0,
      numW: ns ? parseInt(ns.fontWeight, 10) : 0
    };
  })()`);
  console.log("\n=== A2. 两级卡片（面板 / 分区）===");
  console.log("  面板（有面）：" + JSON.stringify(A2.panels) + " · 分区 " + A2.qN + " 块");
  console.log("  分区里还带底色/阴影的：" + JSON.stringify(A2.dirty));
  console.log("  结论数字：" + A2.numPx + "px / 字重 " + A2.numW + " / 衬线=" + A2.numSerif);

  /* ---------- A3. 轴标签：现在与太阳事件必须分行 ----------
     傍晚天黑前一小时内，"现在"与"天黑"在时间上必然相邻，单行里任何避让写法都会
     叠字（实拍：天黑 19:15 / 现在 19:18 压成"天黑 1现在 19:18"）。
     判据不能等真实钟点撞上——那样同一天里会忽绿忽红。这里**克隆**真实轴节点，
     把它摆到三个极端位置（0 / 50 / 100%）实测矩形：分行、贴刻度、不越界都是
     CSS 合约，与跑批钟点无关。 */
  const AX = await ev(`(function(){
    var axis = document.querySelector('.skyaxis');
    if (!axis) return { has: false };
    var host = axis.parentNode;
    var node = axis.cloneNode(true);
    node.classList.add('two');
    var nl = node.querySelector('.nowlbl');
    if (!nl) { nl = document.createElement('span'); nl.className = 'nowlbl'; nl.textContent = '现在 00:00'; node.appendChild(nl); }
    host.appendChild(node);
    var other = [].slice.call(node.querySelectorAll('span:not(.nowlbl)'));
    function at(p, cls){
      nl.className = 'nowlbl ' + cls;
      nl.style.left = p + '%';
      var ar = node.getBoundingClientRect(), r = nl.getBoundingClientRect();
      var tx = ar.left + ar.width * p / 100;
      var hit = other.some(function(s){ var b = s.getBoundingClientRect();
        return r.left < b.right - 0.5 && r.right > b.left + 0.5
            && r.top < b.bottom - 0.5 && r.bottom > b.top + 0.5; });
      var rows = Math.min.apply(null, other.map(function(s){
        return Math.abs(s.getBoundingClientRect().top - r.top); }));
      return { p: p, inBox: r.left >= ar.left - 0.5 && r.right <= ar.right + 0.5,
               ticks: r.left - 1.5 <= tx && tx <= r.right + 1.5, hit: hit, rows: rows };
    }
    var cases = [at(0, 'an-l'), at(50, 'an-m'), at(100, 'an-r')];
    /* 真实节点：有「现在」标签时，轴必须已经是两行 */
    var realNow = axis.querySelector('.nowlbl');
    var realTwo = axis.classList.contains('two');
    host.removeChild(node);
    return { has: true, cases: cases, realNow: !!realNow, realTwo: realTwo,
             realOK: !realNow || realTwo };
  })()`);
  console.log("\n=== A3. 轴：现在 / 太阳事件 分两行 ===");
  if (AX.has) {
    AX.cases.forEach(c => console.log("  现在@" + String(c.p).padStart(3) + "% · 在框内=" + c.inBox
      + " · 压住刻度=" + c.ticks + " · 与事件标签相交=" + c.hit
      + " · 与最近事件标签的行距=" + c.rows.toFixed(1) + "px"));
    console.log("  真实轴带「现在」标签=" + AX.realNow + " · 已两行=" + AX.realTwo);
  } else console.log("  （本次渲染没有轴 —— A3 按缺失判失败）");

  /* ---------- A4. 轴 = 时间尺：四道分界各挂「名称 + 时刻」 ----------
     守三件事（全部实测矩形，不猜字宽）：
     ① 四枚刻度齐全、时刻按时间递增、首尾（日落/天黑）永不舍弃；
     ② 每枚标签的**中心压在相邻色块的交界上**（±2px）—— 这正是"给颜色间隔
        标时间"的本体：标错位置比不标更糟；
     ③ 降级阶梯真的能工作：把轴压窄到 180px 逼出 .tonly（隐名称只留时刻），
        窄轴下仍无重叠；还原宽度后再跑 fitAxis 必须完全复位（幂等）。 */
  const AX4 = await ev(`(function(){
    var axis = document.querySelector('.skyaxis'), sky = document.querySelector('.sky');
    if (!axis || !sky) return { has: false };
    var segs = [].slice.call(sky.querySelectorAll('.s'));
    var mks  = [].slice.call(axis.querySelectorAll('.mk'));
    var box = axis.getBoundingClientRect();
    var bounds = [], acc = box.left;
    segs.forEach(function(s, i){ acc += s.getBoundingClientRect().width;
      if (i < segs.length - 1) bounds.push(acc); });
    var info = mks.map(function(m){
      var r = m.getBoundingClientRect(), nm = m.querySelector('.nm');
      return { r: r, cx: (r.left + r.right) / 2, off: m.classList.contains('off'),
               nmShown: !!nm && getComputedStyle(nm).display !== 'none',
               t: (m.textContent.match(/\\d{1,2}:\\d{2}/) || [""])[0] };
    });
    var vis = info.filter(function(x){ return !x.off; });
    var mins = vis.map(function(x){ var a = x.t.split(':'); return +a[0] * 60 + +a[1]; });
    var hit = vis.some(function(a, i){ return vis.some(function(b, j){ return j > i &&
      a.r.left < b.r.right - 0.5 && a.r.right > b.r.left + 0.5; }); });
    var edgeErr = 0, onEdge = vis.length === bounds.length &&
      vis.every(function(x, i){ var e = Math.abs(x.cx - bounds[i]);
        edgeErr = Math.max(edgeErr, e); return e <= 2; });
    /* 降级阶梯：压窄 → fitAxis → 检查；还原 → fitAxis → 必须复位 */
    var w = axis.style.width, tonly = false, narrowOK = false, restored = false;
    /* 180px：中文四条全称在这条几何下必重叠（13/36.6/63.8/91% 处各 ~64px 宽），
       逼出阶梯；实测 300px 时这条几何恰好排得开，测不出降级。 */
    axis.style.width = '180px';
    fitAxis();
    tonly = axis.classList.contains('tonly');
    var vis2 = [].slice.call(axis.querySelectorAll('.mk'))
      .filter(function(m){ return !m.classList.contains('off'); })
      .map(function(m){ return m.getBoundingClientRect(); });
    narrowOK = vis2.length >= 2 && !vis2.some(function(a, i){ return vis2.some(function(b, j){
      return j > i && a.left < b.right - 0.5 && a.right > b.left + 0.5; }); });
    axis.style.width = w;
    fitAxis();
    restored = !axis.classList.contains('tonly') &&
      [].slice.call(axis.querySelectorAll('.mk')).every(function(m){ return !m.classList.contains('off'); });
    return { has: true, n: mks.length, boundsN: bounds.length,
             onEdge: onEdge, edgeErr: Math.round(edgeErr * 10) / 10, hit: hit,
             names: vis.every(function(x){ return x.nmShown; }),
             tonly: tonly, narrowOK: narrowOK, restored: restored,
             minsIncr: mins.every(function(v, i){ return !i || v > mins[i - 1]; }),
             ends: info.length >= 2 && !info[0].off && !info[info.length - 1].off };
  })()`);
  console.log("\n=== A4. 轴 = 时间尺（四道分界） ===");
  if (AX4.has) console.log("  刻度 " + AX4.n + "/" + AX4.boundsN + " · 时刻递增=" + AX4.minsIncr
    + " · 首尾保留=" + AX4.ends + " · 全带名称=" + AX4.names);
  if (AX4.has) console.log("  标签中心压在色块边界=" + AX4.onEdge + "（最大偏差 " + AX4.edgeErr + "px）"
    + " · 重叠=" + AX4.hit);
  if (AX4.has) console.log("  降级阶梯：压窄后 tonly=" + AX4.tonly + " · 窄轴无重叠=" + AX4.narrowOK
    + " · 还原复位=" + AX4.restored);
  else console.log("  （本次渲染没有轴/天色带 —— A4 按缺失判失败）");

  /* ---------- B. 地图工具条两组 ---------- */
  const B = await ev(`(function(){
    var tool = document.querySelector('.maptool');
    var labels = [...tool.querySelectorAll('.mtgroup > .qlabel')].map(e => e.textContent);
    var tGroupOf = function(el){ var g = el && el.closest('.mtgroup'); return g ? g.querySelector('.qlabel').textContent : null; };
    var g = function(id){ return tGroupOf(document.getElementById(id)); };
    return {
      labels: labels,
      mapPeriod: g('mapPeriod'), mapDateSel: g('mapDateSel'), mapModel: g('mapModel'),
      mapDim: g('mapDim'), mapGo: g('mapGo'),
      numLabels: g('numLabels'), showPts: g('showPts'), showConf: g('showConf'),
      showGrid: g('showGrid'),
      /* S1 云纹（第六个复选框）：不补这一读法，"显示层组有几个勾选"
         就永远停留在五个 —— 新增控件静默漏守正是这条断言要防的。
         【2026-10-18】深色底图改为跟随全局主题，#dimBase 与它的读法一并删除 ——
         显示层从六个复选框回到五个；若日后再加图层，改的是这个数字。 */
      showTx: g('showTx')
    };
  })()`);
  console.log("\n=== B. 地图工具条两组 ===");
  console.log("  标签=" + JSON.stringify(B.labels));
  console.log("  数据源组：时段=" + B.mapPeriod + " 日期=" + B.mapDateSel + " 模型=" + B.mapModel
    + " 着色=" + B.mapDim + " 刷新=" + B.mapGo);
  console.log("  显示层组：直标=" + B.numLabels + " 采样点=" + B.showPts + " 云纹=" + B.showTx + " 可信度=" + B.showConf
    + " 经纬网=" + B.showGrid);

  /* ---------- C. 四处默认收起 + 分层结构 ---------- */
  const C = await ev(`(function(){
    var foldState = function(id){ var d = document.getElementById(id); return d ? d.open : null; };
    var core = document.querySelectorAll('#hero > .kv.hero-kv .it');
    var det = document.getElementById('heroFold');
    return {
      /* 光追/数据质量卡折叠 */
      rayFolded: document.getElementById('cardRay').classList.contains('folded'),
      notesFolded: document.getElementById('cardNotes').classList.contains('folded'),
      rayBtnExp: document.getElementById('rayFoldBtn').getAttribute('aria-expanded'),
      rayBtnTxt: document.getElementById('rayFoldBtn').textContent,
      notesBtnExp: document.getElementById('notesFoldBtn').getAttribute('aria-expanded'),
      /* 结论卡两层：核心层恰 3 格；其余 9 格 + 环境输入在默认收起的详情层里 */
      coreTiles: core.length,
      coreKeys: [...core].map(e => e.querySelector('.k').textContent),
      heroFold: det ? { open: det.open,
                        /* 只数**参数网格**那一个 .kv（环境输入是另一个 .kv，单独由 hasEnv 判） */
                        tiles: (function(){ var kv = det.querySelector('.kv.hero-kv');
                                             return kv ? kv.querySelectorAll('.it').length : 0; })(),
                        hasEnv: !!det.querySelector('.envstrip'),
                        hasIdxHint: /综合指数/.test(det.textContent) } : null,
      /* F4 校准块**不在**详情层里 —— 它的标注入口不能被折叠埋掉（硬约束） */
      calibInFold: !!document.getElementById('calibBox').closest('#heroFold'),
      /* 趋势表 / 图例说明默认收起，且"本体"在 details 之外 */
      trendFoldOpen: foldState('trendFold'),
      legendFold: (function(){ var d = document.getElementById('legendFold');
        return d ? { open: d.open, chars: document.getElementById('lgNote').textContent.length } : null; })(),
      lgBarOutside: !document.getElementById('lgBar').closest('#legendFold'),
      lgRowsOutside: !document.getElementById('lgRows').closest('#legendFold')
    };
  })()`);
  console.log("\n=== C. 默认收起与分层 ===");
  console.log("  ⑤ folded=" + C.rayFolded + "（aria-expanded=" + C.rayBtnExp + " 文案=" + JSON.stringify(C.rayBtnTxt) + "）"
    + " · ⑥ folded=" + C.notesFolded + "（aria-expanded=" + C.notesBtnExp + "）");
  console.log("  结论卡核心层 " + C.coreTiles + " 格：" + JSON.stringify(C.coreKeys));
  console.log("  详情层：open=" + (C.heroFold && C.heroFold.open) + " · " + (C.heroFold && C.heroFold.tiles)
    + " 格 · 环境输入=" + (C.heroFold && C.heroFold.hasEnv) + " · 指数说明=" + (C.heroFold && C.heroFold.hasIdxHint)
    + " · 校准块在详情层内=" + C.calibInFold);
  console.log("  图例说明：open=" + (C.legendFold && C.legendFold.open) + " · " + (C.legendFold && C.legendFold.chars)
    + " 字符 · 色条在外=" + C.lgBarOutside + " · 等级行在外=" + C.lgRowsOutside);

  /* ---------- C2. 天色带（视觉方案 P1 的 hero 核心） ----------
     它由 solarPosition() 现算：五段＝五个太阳高度角区间，段宽＝真实时长；
     霞光窗口按 fireGeometry 语义锚定（晚霞在事件后、朝霞在事件前）。
     守三件事：五段都在且有悬停解释 / 窗口与几何量一致 / 环已退役且数字对得上。 */
  const SK = await ev(`(function(){
    var sky = document.querySelector('#hero .sky');
    var segs = sky ? sky.querySelectorAll('.s') : [];
    var win = sky ? sky.querySelector('.win') : null;
    var axis = document.querySelector('#hero .skyaxis');
    var num = document.querySelector('#hero .hero-num');
    var r = null; try { r = State.result || null; } catch (e) {}
    return {
      hasSky: !!sky,
      segs: segs.length,
      titles: Array.prototype.slice.call(segs).map(function(s){ return s.getAttribute('title') || ""; }),
      winLeft: win ? parseFloat(win.style.left) : null,
      winWidth: win ? parseFloat(win.style.width) : null,
      /* 真时刻与"现在"标记**分开数**：.nowlbl 是 P2 加的第三种标签，
         它出不出现取决于"跑探针的这一刻是否落在带内"——
         把它一起数进 axisN，会让这条断言**按钟点随机变红**（实测 2026-10-17
         18:5x 跑批时正好命中）。判据按**身份**（是不是 .nowlbl）分，不按总数。
         2026-10-17 晚：轴升级为四道分界（0/−6/−12/−18° 各一枚 .mk），
         axisN 因此是 4 —— 仍是身份集合（.mk），不是"span 总数"。 */
      axisN: axis ? axis.querySelectorAll('.mk').length : 0,
      axisTxt: axis ? axis.textContent : "",
      nowN: axis ? axis.querySelectorAll('span.nowlbl').length : 0,
      nowTxt: axis && axis.querySelector('.nowlbl') ? axis.querySelector('.nowlbl').textContent : "",
      numTxt: num ? num.textContent : "",
      P: r ? Math.round(r.P) : null,
      geomOk: !!(r && r.sRT && r.sRT.geom && r.sRT.geom.ok),
      dials: document.querySelectorAll('#hero .dial').length,
      aria: sky ? sky.getAttribute('aria-label') : "",
      hasVeil: !!(sky && sky.querySelector('.veil')),
      veilBg: (function(){ var v = sky && sky.querySelector('.veil');
        return v ? (v.getAttribute('style') || '') : ''; })(),
      skyCloudN: (r && r.skyCloud) ? r.skyCloud.length : 0
    };
  })()`);
  /* 纯函数判据（不依赖当天合成数据的几何）：直接构造已知几何的 r 调 skyBand()。
     守的是**方位语义**：晚霞窗口整体在事件之后、朝霞整体在事件之前 ——
     这是 fireGeometry 的定义（θ 从 θnear 走向 θfar），画错方位图和数就对不上。 */
  const SB = await ev(`(function(){
    var dayMs = Date.UTC(2026, 9, 17);
    function mk(period, ok){
      var ev = sunEvents(dayMs, 30, 120);
      return { period: period, lat: 30, lon: 120, offsetS: 28800, ev: ev,
               sRT: { geom: { ok: ok, thNearDeg: 1.6, thFarDeg: 2.4 } } };
    }
    var pm = skyBand(mk("pm", true)), am = skyBand(mk("am", true));
    var noWin = skyBand(mk("pm", false));
    var pick = function(b){ return b ? { segs: b.segs.length, win: b.win,
      evPct: b.evPct, darkPct: b.darkPct, winNull: b.win == null,
      veilNull: b.veil == null } : null; };
    /* 现在标记的日期语义：把 Date.now 临时改成"该地日落 +30 分钟"（落在带内），
       日期对上 ⇒ 有 nowPct；日期对不上 ⇒ 没有。
       别把事件直接设成此刻 —— 现实此刻若不是傍晚，二分找不到日落穿越，整条带会是 null
       （第一版就这么错了）。mk() 不带 skyCloud ⇒ 同时验"无切片时薄纱为 null"。 */
    var dayMs = Date.UTC(2026, 9, 17);
    var ev2 = sunEvents(dayMs, 30, 120);
    var off = 28800;
    var dateStr = new Date(ev2.setMs + off * 1000).toISOString().slice(0, 10);
    function mkn(ds){
      return { period: "pm", lat: 30, lon: 120, offsetS: off, dateStr: ds,
               ev: { riseMs: ev2.riseMs, setMs: ev2.setMs },
               sRT: { geom: { ok: true, thNearDeg: 1.6, thFarDeg: 2.4 } } };
    }
    var realNow = Date.now;
    Date.now = function () { return ev2.setMs + 30 * 60000; };
    var bToday = skyBand(mkn(dateStr)), bOther = skyBand(mkn("2000-01-01"));
    Date.now = realNow;
    return { pm: pick(pm), am: pick(am), noWin: pick(noWin), noSlice: pick(pm),
             nowToday: bToday ? bToday.nowPct != null : null,
             nowOther: bOther ? bOther.nowPct : "no-band" };
  })()`);
  console.log("  纯函数：晚霞 win=" + JSON.stringify(SB.pm && SB.pm.win) + "（事件在 " +
    (SB.pm && SB.pm.evPct && SB.pm.evPct.toFixed(1)) + "%）· 朝霞 win=" +
    JSON.stringify(SB.am && SB.am.win) + "（事件在 " +
    (SB.am && SB.am.evPct && SB.am.evPct.toFixed(1)) + "%）");
  console.log("  几何不成立 ⇒ 窗口为空：" + (SB.noWin && SB.noWin.winNull)
    + " · 无云量切片 ⇒ 薄纱为空：" + (SB.noSlice && SB.noSlice.veilNull));
  console.log("  现在标记：日期＝今天 ⇒ " + SB.nowToday + " · 非今天 ⇒ " + JSON.stringify(SB.nowOther)
    + " · 页面薄纱=" + SK.hasVeil + "（切片 " + SK.skyCloudN + " 个）");

  console.log("\n=== C2. 天色带 ===");
  console.log("  存在=" + SK.hasSky + " · 分段 " + SK.segs + " 段（" + SK.titles.join(" / ") + "）");
  console.log("  霞光窗口 left=" + SK.winLeft + "% width=" + SK.winWidth + "% · 几何成立=" + SK.geomOk);
  console.log("  轴 " + SK.axisN + " 个时刻：" + JSON.stringify(SK.axisTxt)
    + " · 现在标记 " + SK.nowN + " 个 " + JSON.stringify(SK.nowTxt)
    + " · 衬线数字=" + JSON.stringify(SK.numTxt) + "（State.P=" + SK.P + "）· 环=" + SK.dials + " 个");

  /* ---------- D. 折叠交互 + 快照兼容 + 零请求 ---------- */
  /* 首屏预报的请求已经发生过了；从这里开始计数，检验后续纯显示操作不取数 */
  reqN = 0;
  const D = await ev(`(function(){
    var btn = document.getElementById('rayFoldBtn'), card = document.getElementById('cardRay');
    var out = {};
    btn.click();                       /* 展开 */
    out.afterOpen = { folded: card.classList.contains('folded'),
                      exp: btn.getAttribute('aria-expanded'), txt: btn.textContent };
    btn.click();                       /* 再点：收起 */
    out.afterClose = { folded: card.classList.contains('folded'),
                       exp: btn.getAttribute('aria-expanded'), txt: btn.textContent };
    /* 快照兼容：两张卡仍带 data-snaphide，snapmode 下必须整卡隐藏
       （折叠只收卡头以下，不许把 data-snaphide 的隐藏能力顶掉） */
    document.body.classList.add('snapmode');
    out.snap = { ray: getComputedStyle(card).display,
                 notes: getComputedStyle(document.getElementById('cardNotes')).display };
    document.body.classList.remove('snapmode');
    out.snaphideCount = document.querySelectorAll('div.card[data-snaphide]').length;
    return out;
  })()`);
  const structReq = reqN;
  console.log("\n=== D. 折叠交互 / 快照兼容 ===");
  console.log("  点展开 → folded=" + D.afterOpen.folded + " aria-expanded=" + D.afterOpen.exp
    + " 文案=" + JSON.stringify(D.afterOpen.txt));
  console.log("  再点收起 → folded=" + D.afterClose.folded + " aria-expanded=" + D.afterClose.exp
    + " 文案=" + JSON.stringify(D.afterClose.txt));
  console.log("  snapmode 下 ⑤ display=" + D.snap.ray + " · ⑥ display=" + D.snap.notes
    + " · div.card[data-snaphide] 计数=" + D.snaphideCount);
  console.log("  本段请求数=" + structReq + "（应为 0：纯显示操作不许偷额度）");

  /* ---------- E. 趋势表 details（要加载出趋势才存在） ---------- */
  reqN = 0;
  await ev(`document.getElementById('trendGo').click()`);
  let trendOK = false;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    trendOK = await ev(`!!(State.trend && State.trend.rows && State.trend.rows.length)`);
    if (trendOK) break;
  }
  await sleep(400);
  const E = await ev(`(function(){
    var d = document.getElementById('trendFold');
    return { has: !!d, open: d ? d.open : null,
             rows: d ? d.querySelectorAll('tbody tr').length : 0,
             /* F3 日历是主视图：必须在 details 之外，且格子已经画出来 */
             calOutside: !document.getElementById('trendCal').closest('#trendFold'),
             calTiles: document.querySelectorAll('#trendCal .tcal-d').length,
             foldKeys: Object.keys(State.folds) };
  })()`);
  console.log("\n=== E. 趋势表 details ===");
  console.log("  details 存在=" + E.has + " · open=" + E.open + " · 表格行数=" + E.rows
    + " · 日历在外=" + E.calOutside + " · 日历格子=" + E.calTiles);
  console.log("  折叠白名单：" + JSON.stringify(E.foldKeys));

  /* ---------- F. 目录菜单（grill 定稿） ----------
     守四件事：8 项分两组且跳转目标真实存在 / 入口开关与 Esc 同步 aria-expanded /
     点折叠卡项＝展开＋写偏好 / 快照模式三个入口全隐。
     注意本段会改 State.folds 与滚动位置 —— 所以放在所有"默认态"测量之后。 */
  const T = await ev(`(function(){
    var panel = document.getElementById('tocPanel');
    var items = panel ? Array.prototype.slice.call(panel.querySelectorAll('.toc-i')) : [];
    var groups = panel ? panel.querySelectorAll('.toc-g').length : 0;
    var missing = items.map(function(b){ return b.getAttribute('data-goto'); })
      .filter(function(id){ return !document.getElementById(id); });
    return {
      isNav: !!panel && panel.tagName === 'NAV',
      n: items.length, groups: groups, missing: missing,
      hidden: panel ? panel.hidden : null,
      expanded: document.getElementById('tocBtn').getAttribute('aria-expanded'),
      rayText: (items.filter(function(b){ return b.getAttribute('data-goto') === 'cardRay'; })[0] || {}).textContent || ''
    };
  })()`);
  console.log("\n=== F. 目录菜单 ===");
  console.log("  nav=" + T.isNav + " · 项 " + T.n + " 条 / 组 " + T.groups
    + " · 目标缺失 " + JSON.stringify(T.missing) + " · 初始 hidden=" + T.hidden);
  console.log("  折叠卡项文案：" + JSON.stringify(T.rayText.trim()));

  /* 开关：点开 → Esc 关 */
  const T1 = await ev(`(function(){
    var btn = document.getElementById('tocBtn'), panel = document.getElementById('tocPanel');
    btn.click();
    var open1 = !panel.hidden, exp1 = btn.getAttribute('aria-expanded');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    return { open1: open1, exp1: exp1, closedAfterEsc: panel.hidden,
             exp2: btn.getAttribute('aria-expanded') };
  })()`);
  console.log("  点开：hidden=" + T1.open1 + " aria-expanded=" + T1.exp1
    + " → Esc 后 hidden=" + T1.closedAfterEsc + " aria-expanded=" + T1.exp2);

  /* 点折叠卡项：展开 + 写偏好（偏好键在 localStorage 里） */
  const T2 = await ev(`(function(){
    var panel = document.getElementById('tocPanel');
    var item = panel.querySelector('.toc-i[data-goto="cardRay"]');
    var before = State.folds.rayFold;
    document.getElementById('tocBtn').click();
    item.click();
    var raw = null; try { raw = localStorage.getItem('sunsetbot.pref.v1'); } catch (e) {}
    var pref = null; try { pref = JSON.parse(raw); } catch (e) {}
    return { before: before, after: State.folds.rayFold,
             foldedClass: document.getElementById('cardRay').classList.contains('folded'),
             prefRay: pref ? pref.rayFold : null, panelHidden: panel.hidden };
  })()`);
  console.log("  点折叠卡项：rayFold " + T2.before + " → " + T2.after
    + " · 卡片仍 folded=" + T2.foldedClass + " · 偏好写盘=" + T2.prefRay
    + " · 面板已关=" + T2.panelHidden);

  /* 快照模式：三个入口（顶栏按钮 / 面板 / 浮钮）都隐藏 */
  const T3 = await ev(`(function(){
    document.body.classList.add('snapmode');
    var q = function(id){ var e = document.getElementById(id); return e ? getComputedStyle(e).display : null; };
    var out = { btn: q('tocBtn'), panel: q('tocPanel'), fab: q('tocFab') };
    document.body.classList.remove('snapmode');
    return out;
  })()`);
  console.log("  快照模式 display：顶栏钮=" + T3.btn + " 面板=" + T3.panel + " 浮钮=" + T3.fab);

  /* ---------- 查询区「更多选项」开合（视觉方案二 P0） ---------- */
  const Q1 = await ev(`(function(){
    var btn = document.getElementById('qMoreBtn'), panel = document.getElementById('qMore');
    var before = panel.hidden;
    btn.click();
    var open = !panel.hidden, exp1 = btn.getAttribute('aria-expanded');
    btn.click();
    return { before: before, open: open, exp1: exp1,
             reclosed: panel.hidden, exp2: btn.getAttribute('aria-expanded') };
  })()`);
  console.log("  更多选项：默认收起=" + Q1.before + " → 点开 visible=" + Q1.open
    + " aria=" + Q1.exp1 + " → 再点收起=" + Q1.reclosed + " aria=" + Q1.exp2);

  /* ---------- 天色带大气层（视觉方案二 P1）：柔光锚点 + 颗粒纹理 ---------- */
  const ATM = await ev(`(function(){
    var sky = document.querySelector('#hero .sky');
    if (!sky) return { has: false };
    var x = parseFloat(sky.style.getPropertyValue('--skyglow-x'));
    var after = getComputedStyle(sky, '::after');
    var before = getComputedStyle(sky, '::before');
    return {
      has: true,
      xInRange: isFinite(x) && x >= 0 && x <= 100,
      glowGrad: (before.backgroundImage || '').indexOf('radial-gradient') >= 0,
      grain: (after.backgroundImage || '').indexOf('data:image/svg+xml') >= 0,
      grainOp: parseFloat(after.opacity)
    };
  })()`);
  console.log("  天色带大气：柔光锚点在带内=" + ATM.xInRange + " 径向渐变=" + ATM.glowGrad
    + " 颗粒SVG=" + ATM.grain + " 颗粒不透明度=" + ATM.grainOp);

  /* ---------- 液态玻璃（视觉方案三）：配方块 + dock 豁免 + 卡片不沾 ----------
     走 CSSOM 而不是 computedStyle 全量比字符串：hidden 的 .sug/.tocpanel 在
     display:none 下 computed 值不可靠，而结构判据（规则在不在、在不在 supports 内、
     用没用令牌）才是这个功能的本质。cssText 里有空格，统一 strip 后再查子串。 */
  const GLS = await ev(`(function(){
    var found = 0, dockReset = false;
    var strip = function(s){ return s.split(' ').join(''); };
    var walk = function(rules, inSupports){
      for (var i = 0; i < rules.length; i++){
        var r = rules[i];
        if (r.type === CSSRule.SUPPORTS_RULE){
          walk(r.cssRules, strip(r.conditionText || '').indexOf('backdrop-filter') >= 0);
          continue;
        }
        if (r.type === CSSRule.MEDIA_RULE){ walk(r.cssRules, inSupports); continue; }
        if (r.type !== CSSRule.STYLE_RULE) continue;
        var key = strip(r.selectorText || '');
        var t = strip(r.cssText);
        if (inSupports && (key === '.top' || key === '.sug' || key === '.tip' || key === '.tocpanel')
          && t.indexOf('backdrop-filter:saturate') >= 0
          && t.indexOf('var(--glass)') >= 0
          && t.indexOf('var(--glass-sheen)') >= 0
          && t.indexOf('var(--glass-hi)') >= 0){ found++; }
        if (key.indexOf('.tip.dock') >= 0 && t.indexOf('backdrop-filter:none') >= 0) dockReset = true;
      }
    };
    for (var s = 0; s < document.styleSheets.length; s++){
      try { walk(document.styleSheets[s].cssRules, false); } catch (e) {}
    }
    var card = document.querySelector('.card');
    return {
      glassRules: found,
      dockReset: dockReset,
      supportsOK: (typeof CSS !== 'undefined') && CSS.supports('backdrop-filter', 'blur(1px)'),
      topBlur: (getComputedStyle(document.querySelector('.top')).backdropFilter || '').indexOf('blur') >= 0,
      cardClear: card ? (getComputedStyle(card).backdropFilter || 'none') === 'none' : false
    };
  })()`);
  console.log("  液态玻璃：配方规则=" + GLS.glassRules + "/4 dock已豁免=" + GLS.dockReset
    + " 环境支持=" + GLS.supportsOK + " 顶栏磨砂生效=" + GLS.topBlur + " 卡片未沾=" + GLS.cardClear);

  /* ---------- 汇总断言 ---------- */
  const o = {
    "液态玻璃配方只写在 @supports(backdrop-filter) 内且四处悬浮件各一条（顶栏/下拉/提示卡/目录）":
      GLS.supportsOK === true && GLS.glassRules === 4,
    "移动端贴底卡片显式豁免玻璃（backdrop-filter:none —— 不透明是硬约束）":
      GLS.dockReset === true,
    "玻璃只给悬浮件：正文卡片不沾 backdrop-filter，顶栏磨砂真实生效":
      GLS.cardClear === true && GLS.topBlur === true,
    "查询区三组标签齐全且顺序正确（查什么 → 显示 → 界面）":
      A.qCount === 3 && A.labels.join(",") === "查什么,显示,界面",
    "一行条四件套齐全（地点/日期/时段/开始预报 + 更多选项按钮都在 #qBar 上）":
      A.bar.q === true && A.bar.date === true && A.bar.period === true
      && A.bar.go === true && A.bar.more === true,
    "面板控件归位（定位/今天/预设/提示 → 查什么；单位/时间制 → 显示；自动刷新/语言/主题 → 界面）":
      A.geo === "查什么" && A.now === "查什么" && A.presets === "查什么"
      && A.locHint === "查什么"
      && A.unit === "显示" && A.clock === "显示"
      && A.autoMap === "界面" && A.lang === "界面" && A.theme === "界面",
    "更多选项默认收起（hidden + aria-expanded=false）":
      A.moreHidden === true && A.ariaExp === "false",
    "两级卡片：只有结论与地图是「有面」的面板，其余分区透明无阴影":
      A2.panels.join(",") === "cardHero,cardMap" && A2.dirty.length === 0,
    "结论数字是衬线大字（≥56px、字重 ≤600 —— 不靠加粗撑分量）":
      A2.numSerif === true && A2.numPx >= 56 && A2.numW <= 600,
    "轴分两行：现在标签与两个太阳事件标签不重叠、贴住刻度、不越出面板":
      AX.has === true && AX.realOK === true
      && AX.cases.every(c => c.inBox && c.ticks && !c.hit && c.rows >= 10),
    "四道分界各挂一枚刻度，时刻按时间递增，日落/天黑（首尾）永不舍弃":
      AX4.has === true && AX4.n === 4 && AX4.minsIncr === true && AX4.ends === true,
    "分界标签的中心压在色块边界上（±2px）且互不重叠，名称在桌面宽度下齐全":
      AX4.has === true && AX4.onEdge === true && AX4.hit === false && AX4.names === true,
    "名称放不下时自动降级：压窄轴 → 隐名称只留时刻且不重叠，还原后完全复位":
      AX4.has === true && AX4.tonly === true && AX4.narrowOK === true && AX4.restored === true,
    "「更多选项」开合：点开面板可见且 aria 同步，再点恢复收起":
      Q1.before === true && Q1.open === true && Q1.exp1 === "true"
      && Q1.reclosed === true && Q1.exp2 === "false",
    "天色带大气层：柔光锚点在带内（--skyglow-x ∈ [0,100] 且为径向渐变）":
      ATM.has === true && ATM.xInRange === true && ATM.glowGrad === true,
    "天色带颗粒纹理：::after 为 SVG 噪声瓦片且不透明度 ≤ 0.12":
      ATM.has === true && ATM.grain === true && ATM.grainOp <= 0.12,
    "分组只换位置：原有控件 id 一个没少（含一行条三个新锚点）":
      A.ids === true,
    "工具条两组标签齐全（数据源 → 显示层）":
      B.labels.join(",") === "数据源,显示层",
    "取数控件在「数据源」组、五个图层复选框在「显示层」组":
      B.mapPeriod === "数据源" && B.mapDateSel === "数据源" && B.mapModel === "数据源"
      && B.mapDim === "数据源" && B.mapGo === "数据源"
      && B.numLabels === "显示层" && B.showPts === "显示层" && B.showTx === "显示层"
      && B.showConf === "显示层"
      && B.showGrid === "显示层",
    "光追/数据质量卡默认折叠（folded + aria-expanded=false + 文案=展开）":
      C.rayFolded === true && C.notesFolded === true
      && C.rayBtnExp === "false" && C.rayBtnTxt === "展开" && C.notesBtnExp === "false",
    "结论卡核心层恰 3 格（时刻 / 方位角 / 持续时间）":
      C.coreTiles === 3 && C.coreKeys.join(",").indexOf("时刻") >= 0
      && C.coreKeys.join(",").indexOf("方位角") >= 0 && C.coreKeys.join(",").indexOf("持续") >= 0,
    "其余参数在默认收起的详情层里（9 格 + 环境输入 + 指数说明）":
      !!C.heroFold && C.heroFold.open === false && C.heroFold.tiles === 9
      && C.heroFold.hasEnv === true && C.heroFold.hasIdxHint === true,
    "F4 校准块不在详情层里（标注入口不被折叠埋掉）":
      C.calibInFold === false,
    "天色带：晚霞窗口在事件之后、朝霞窗口在事件之前（fireGeometry 语义）":
      !!SB.pm && !!SB.pm.win && SB.pm.win.left >= SB.pm.evPct - 0.5
      && !!SB.am && !!SB.am.win && (SB.am.win.left + SB.am.win.width) <= SB.am.evPct + 0.5,
    "天色带：几何不成立 ⇒ 窗口不画（只剩分段）":
      !!SB.noWin && SB.noWin.winNull === true && SB.noWin.segs === 5,
    "云量薄纱：有逐时切片时存在、透明度不超过 0.30；无切片（快照）时不画":
      SK.skyCloudN >= 2 && SK.hasVeil === true
      && (function(){
           var m = SK.veilBg.match(/rgba\(27,\s*37,\s*54,\s*([\d.]+)\)/g) || [];
           return m.length >= 2 && m.every(function (s) {
             var a = parseFloat(s.match(/,\s*([\d.]+)\)$/)[1]);
             return a >= 0 && a <= 0.3001;
           });
         })()
      && !!SB.noSlice && SB.noSlice.veilNull === true,
    "现在标记：日期是今天且此刻在带内才画（纯函数判据）":
      SB.nowToday === true && SB.nowOther === null,
    "天色带：段序按时间排好（朝霞晚霞各五段且顺序相反）":
      !!SB.pm && !!SB.am && SB.pm.segs === 5 && SB.am.segs === 5,
    "天色带五段齐全且有悬停解释（白昼/民用/航海/天文/夜间）":
      SK.hasSky === true && SK.segs === 5 && SK.titles.length === 5
      && SK.titles.every(function (x) { return x.length > 0; }),
    "霞光窗口与几何量一致（几何成立 ⇒ 在带内且位置合法；不成立 ⇒ 无窗口）":
      SK.geomOk ? (SK.winLeft != null && SK.winWidth != null && SK.winWidth > 0
        && SK.winLeft >= 0 && SK.winLeft + SK.winWidth <= 100.5)
        : (SK.winLeft == null),
    "轴上恰四道分界（0/−6/−12/−18° 各一枚刻度）+ 至多一个「现在」标记，都带本地时钟":
      SK.axisN === 4 && /\d{1,2}:\d{2}/.test(SK.axisTxt)
      && SK.nowN <= 1 && (SK.nowN === 0 || /\d{1,2}:\d{2}/.test(SK.nowTxt)),
    "概率环已从普通 hero 退役，衬线大字与 State 的概率一致":
      SK.dials === 0 && SK.P != null && SK.numTxt.indexOf(String(SK.P)) === 0,
    "图例长文默认收进 details，且图例本体（色条 / 等级行）在外":
      !!C.legendFold && C.legendFold.open === false && C.legendFold.chars > 100
      && C.lgBarOutside === true && C.lgRowsOutside === true,
    "折叠交互：点展开 / 再点收起，aria-expanded 与文案同步":
      D.afterOpen.folded === false && D.afterOpen.exp === "true" && D.afterOpen.txt === "收起"
      && D.afterClose.folded === true && D.afterClose.exp === "false" && D.afterClose.txt === "展开",
    "快照模式下光追/数据质量卡仍整卡隐藏（data-snaphide 不被折叠破坏）":
      D.snap.ray === "none" && D.snap.notes === "none" && D.snaphideCount === 4,
    "分组与折叠交互零新增请求（UI 重组不许偷额度）":
      structReq === 0,
    "趋势表包在默认收起的 details 里，F3 日历在外（主视图）":
      trendOK === true && E.has === true && E.open === false && E.rows >= 2
      && E.calOutside === true && E.calTiles >= 2,
    "目录：8 项分两组、每项跳转目标真实存在、是 nav 地标":
      T.isNav === true && T.n === 8 && T.groups === 2 && T.missing.length === 0,
    "目录：点开与 Esc 关闭时 aria-expanded 同步、面板真的开合":
      T1.open1 === true && T1.exp1 === "true" && T1.closedAfterEsc === true && T1.exp2 === "false",
    "目录：点折叠卡项 ⇒ 展开并写偏好（与手动点展开同效）":
      T2.before === false && T2.after === true && T2.foldedClass === false
      && T2.prefRay === true && T2.panelHidden === true,
    "目录：快照模式下三个入口全部隐藏":
      T3.btn === "none" && T3.panel === "none" && T3.fab === "none",
    "折叠白名单正是决策定的五个键":
      E.foldKeys.join(",") === "rayFold,notesFold,heroFold,trendFold,legendFold",
    "本轮运行无静默降级": errs.length === 0
  };

  console.log("\n--- 断言 ---");
  let fail = 0;
  for (const k of Object.keys(o)) {
    if (!o[k]) { console.log("  FAIL " + k); fail++; } else console.log("  ok   " + k);
  }
  if (errs.length) { console.log("  控制台错误 " + errs.length + " 条："); errs.slice(0, 5).forEach(e => console.log("    " + e)); }
  console.log("\nFAIL 计数: " + fail);
  console.log('FACTS {"assertions":' + Object.keys(o).length + ',"fail":' + fail + '}');
  try { chrome.kill(); } catch (e) { }
  srv.close();
  process.exit(fail);
})().catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
