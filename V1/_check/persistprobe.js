/* 状态持久化探针（B1 展示偏好 + B2 趋势缓存）—— 零额度（全部合成数据）。
 *
 * 为什么必须单独写：这两条改动都是"**跨页面加载**才看得出对错"的 ——
 *   B1：偏好写盘之后，到底有没有在**下一次** initUI 里被读回来并铺到控件上；
 *   B2：趋势缓存命中之后，开页是不是真的**零请求**就画出了表格。
 * 单页面内的断言（mapaudit / cdp 那一批）看不到 reload，也就测不到这两件事。
 * 这两条又恰好是"错了也不报错"的那一类：偏好没读回来只是"又回到默认"，
 * 趋势没命中只是"又花了一次额度" —— 用户不会觉得是 bug，只会觉得"这软件怎么这样"。
 *
 * 量五组：
 *   A. 初始干净：新 profile 下不得有任何偏好键（否则后面的"默认态"断言全是假的）
 *   B. 写：拨动控件 ⇒ 偏好键出现且内容正确（白名单 + 只原始类型）
 *   C. 读回：重新加载 ⇒ 控件与 State 都被恢复（且**没有**出现"控件 A、State B"）
 *   D. 坏值与版本：v1 里塞脏数据 / 塞错类型 / 换成 v2 ⇒ 一律降级为默认，不报错、不崩
 *   E. 趋势：点一次加载（合成数据）⇒ 落盘；重新加载 ⇒ **自动画出且 0 请求**；无缓存时开页 0 请求也不打扰
 *
 * 第五轮 UI 起，A/B/C/D/E 五段各自多带一两句折叠态（rayFold 等 5 个"默认收起"开关）：
 *   A 段量四处默认收起（光追/数据质量卡 + 结论卡详情 + 图例说明；趋势表要等 E 段加载出趋势才存在）；
 *   B 段多点一下折叠按钮 ⇒ 落盘；C 段验证类 / aria-expanded / 文案三处读回一致；
 *   D 段的脏数据里补两个错类型的折叠值。落盘机制与既有偏好完全同构，不新增第二条通路。
 *
 * 用法: node _check/persistprobe.js
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
const PORT = 47893;
const DEBUG_PORT = 9354;
const PREF_KEY = "sunsetbot.pref.v1";
const TREND_PREFIX = "sunsetbot.trend.v1.";
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

/* 与 mapaudit / mobileprobe / cdp 同源的合成数据 */
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

let reqN = 0;            // 批量/单点请求计数（只数 open-meteo）
let bulkN = 0;           // 其中"坐标数 ≥ 20"的（趋势 34 / 地图 57）

(async function main() {
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "pp-"));
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
      if (lats.length >= 20) bulkN++;
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
  console.log("状态持久化探针 —— B1 展示偏好 + B2 趋势缓存（全部合成数据，零额度）");
  console.log("=".repeat(74));

  /* ---------- A. 初始干净 ---------- */
  if (!await loadAndWait("首次加载")) { chrome.kill(); srv.close(); process.exit(1); }
  const A = await ev(`(function(){
    const keys = []; for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    return { pref: localStorage.getItem(${JSON.stringify(PREF_KEY)}),
      anyPref: keys.filter(k => k.indexOf('sunsetbot.pref.') === 0).length,
      nLabels: document.getElementById('numLabels').checked,
      nGrid: document.getElementById('showGrid').checked,
      units: State.units, h12: State.hour12,
      mDim: State.mapDim, mModel: State.mapModel,
      unitOn: document.querySelector('#unitSeg button.on').dataset.u,
      clockOn: document.querySelector('#clockSeg button.on').dataset.c,
      /* 第五轮 UI：四处"默认收起"。趋势表的 details 要等 E2 加载出趋势才存在，
         放到那段里量；这里量三个首屏就有的（光追/数据质量卡 + 结论卡详情 + 图例说明）。 */
      rayFolded: document.getElementById('cardRay').classList.contains('folded'),
      notesFolded: document.getElementById('cardNotes').classList.contains('folded'),
      rayBtnExp: document.getElementById('rayFoldBtn').getAttribute('aria-expanded'),
      heroFoldOpen: (function(){ var d = document.getElementById('heroFold'); return d ? d.open : null; })(),
      legendFoldOpen: document.getElementById('legendFold').open };
  })()`);
  console.log("\n=== A. 初始干净（新 profile 不得有偏好键）===");
  console.log("  sunsetbot.pref.* 键数=" + A.anyPref + " · 默认 numLabels=" + A.nLabels
    + " · showGrid=" + A.nGrid + " · units=" + A.units + " · hour12=" + A.h12
    + " · mapDim=" + A.mDim + " · mapModel=" + A.mModel);
  console.log("  默认折叠态：⑤=" + A.rayFolded + " ⑥=" + A.notesFolded
    + " · 按钮 aria-expanded=" + A.rayBtnExp + " · 结论卡详情开=" + A.heroFoldOpen
    + " · 图例说明开=" + A.legendFoldOpen);

  /* ---------- B. 拨动控件 ⇒ 写盘 ---------- */
  const B = await ev(`(function(){
    const fire = (id, v) => { const e = document.getElementById(id); e.checked = v;
      e.dispatchEvent(new Event('change', { bubbles: true })); };
    fire('numLabels', true); fire('showTx', false); fire('showGrid', false);
    const seg = (sel, attr, val) => { const b = document.querySelector(sel + ' button[' + attr + '="' + val + '"]');
      b.click(); };
    seg('#unitSeg', 'data-u', 'imperial');
    seg('#clockSeg', 'data-c', '12');
    /* 第五轮 UI：折叠按钮与其它显示偏好同一套机制（点展开 ⇒ rayFold 落盘） */
    document.getElementById('rayFoldBtn').click();
    const dim = document.getElementById('mapDim'); dim.value = 'q';
    dim.dispatchEvent(new Event('change', { bubbles: true }));
    const mdl = document.getElementById('mapModel'); mdl.value = 'ec';
    mdl.dispatchEvent(new Event('change', { bubbles: true }));
    let raw = null; try { raw = localStorage.getItem(${JSON.stringify(PREF_KEY)}); } catch (e) {}
    let j = null; try { j = JSON.parse(raw); } catch (e) {}
    return { raw: raw, j: j, size: raw ? raw.length : 0,
      state: { units: State.units, h12: State.hour12, dim: State.mapDim, model: State.mapModel,
               foldRay: State.folds.rayFold } };
  })()`);
  console.log("\n=== B. 拨动控件 ⇒ 写盘 ===");
  console.log("  键字节 " + B.size + " · 内容 " + JSON.stringify(B.j));
  console.log("  State 同步：" + JSON.stringify(B.state));

  /* ---------- C. 重新加载 ⇒ 读回 ---------- */
  if (!await loadAndWait("第二次加载（读回偏好）")) { chrome.kill(); srv.close(); process.exit(1); }
  const C = await ev(`(function(){
    const g = id => { const e = document.getElementById(id); return e ? e.checked : null; };
    return { numLabels: g('numLabels'), showTx: g('showTx'), showGrid: g('showGrid'),
      showPts: g('showPts'),
      units: State.units, h12: State.hour12, dim: State.mapDim, model: State.mapModel,
      unitOn: document.querySelector('#unitSeg button.on').dataset.u,
      clockOn: document.querySelector('#clockSeg button.on').dataset.c,
      dimSel: document.getElementById('mapDim').value,
      modelSel: document.getElementById('mapModel').value,
      gridOn: !!(typeof MapMod !== 'undefined' && MapMod.gratUser),
      /* 2026-10-18：深色底图改为跟随全局主题（#dimBase 已删）。
         默认主题下 .mapwrap.dark 必须不在 —— 浅色页面不该自带深色地图。 */
      dark: document.querySelector('.mapwrap').classList.contains('dark'),
      /* 第五轮 UI：折叠状态跨加载读回 —— 类 / aria-expanded / 按钮文案三处都要对 */
      rayFolded: document.getElementById('cardRay').classList.contains('folded'),
      rayBtnExp: document.getElementById('rayFoldBtn').getAttribute('aria-expanded'),
      rayBtnTxt: document.getElementById('rayFoldBtn').textContent,
      foldRay: State.folds.rayFold };
  })()`);
  console.log("\n=== C. 重新加载 ⇒ 偏好被读回 ===");
  console.log("  控件：numLabels=" + C.numLabels + " showTx=" + C.showTx + " showGrid=" + C.showGrid
    + " · units 高亮=" + C.unitOn + " · clock 高亮=" + C.clockOn
    + " · mapDim=" + C.dimSel + " · mapModel=" + C.modelSel);
  console.log("  State：units=" + C.units + " hour12=" + C.h12 + " mapDim=" + C.dim + " mapModel=" + C.model);
  console.log("  折叠态：⑤ folded=" + C.rayFolded + " · aria-expanded=" + C.rayBtnExp
    + " · 按钮文案=" + JSON.stringify(C.rayBtnTxt) + " · State.folds.rayFold=" + C.foldRay);
  console.log("  依赖地图 DOM 的偏好已生效：gratUser=" + C.gridOn
    + " · .mapwrap.dark=" + C.dark + "（默认浅色主题下须 false —— 深色底图已并入主题）");

  /* ---------- D. 坏值 / 版本 ---------- */
  const D = await ev(`(function(){
    const t = {};
    /* ① 脏字段 + 错类型：白名单之外的一律丢掉，类型不对的一律忽略 */
    localStorage.setItem(${JSON.stringify(PREF_KEY)}, JSON.stringify(
      { numLabels: 'yes', showPts: true, evil: { a: 1 }, mapDim: 'NOT_A_DIM', units: 42,
        rayFold: 'yes', heroFold: 42 }));
    t.dirty = prefRead();
    /* ② 完全不是 JSON */
    localStorage.setItem(${JSON.stringify(PREF_KEY)}, '{{{');
    t.broken = prefRead();
    /* ③ 数组（typeof 'object' 但语义不对） */
    localStorage.setItem(${JSON.stringify(PREF_KEY)}, '[1,2,3]');
    t.array = prefRead();
    /* ④ 版本隔离：把合法偏好写进 v2，v1 读不到 */
    localStorage.setItem('sunsetbot.pref.v2', JSON.stringify({ numLabels: true }));
    localStorage.removeItem(${JSON.stringify(PREF_KEY)});
    t.v2Isolated = prefRead().numLabels === undefined;
    localStorage.removeItem('sunsetbot.pref.v2');
    return t;
  })()`);
  console.log("\n=== D. 坏值 / 版本隔离 ===");
  console.log("  脏数据 → " + JSON.stringify(D.dirty));
  console.log("  非 JSON → " + JSON.stringify(D.broken) + " · 数组 → " + JSON.stringify(D.array)
    + " · v2 与 v1 隔离=" + D.v2Isolated);

  /* ---------- E. 趋势缓存 ---------- */
  await ev(`localStorage.clear(); State.cache = {};`);
  /* 先把"无缓存开页"这件事测掉：清空后重新加载，应该是 0 个批量请求、且不打扰用户 */
  reqN = 0; bulkN = 0;
  if (!await loadAndWait("第三次加载（无趋势缓存）")) { chrome.kill(); srv.close(); process.exit(1); }
  const E0 = await ev(`(function(){
    const b = document.getElementById('trendBody');
    return { hasTable: !!b.querySelector('table'),
      hasHint: b.textContent.indexOf('点上方按钮加载趋势') >= 0,
      btn: (document.getElementById('trendGo') || {}).textContent };
  })()`);
  const noCacheReq = reqN, noCacheBulk = bulkN;
  console.log("\n=== E1. 无趋势缓存开页 ===");
  console.log("  请求总数=" + noCacheReq + "（其中批量=" + noCacheBulk + "）· 表格=" + E0.hasTable
    + " · 引导文案=" + E0.hasHint + " · 按钮=" + JSON.stringify(E0.btn));

  /* 点一次真加载（合成数据），落盘 */
  reqN = 0; bulkN = 0;
  await ev(`document.getElementById('trendGo').click()`);
  let trendOK = false;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    trendOK = await ev(`!!(State.trend && State.trend.rows && State.trend.rows.length)`);
    if (trendOK) break;
  }
  await sleep(400);
  const fetchReq = reqN, fetchBulk = bulkN;
  const E1 = await ev(`(function(){
    const t = State.trend;
    const keys = []; for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    const tk = keys.filter(k => k.indexOf(${JSON.stringify(TREND_PREFIX)}) === 0);
    const raw = tk.length ? localStorage.getItem(tk[0]) : null;
    const j = raw ? JSON.parse(raw) : null;
    return { rows: t && t.rows ? t.rows.length : 0, n: t && t.n, sD: t && t.sD, eD: t && t.eD,
      keys: tk, rawSize: raw ? raw.length : 0,
      objKeys: j ? Object.keys(j.obj) : [],
      hasRawBundle: !!(j && (j.obj.b || j.obj.pts)),
      storedRows: j && j.obj.rows ? j.obj.rows.length : 0,
      bodyHasTable: !!document.getElementById('trendBody').querySelector('table'),
      /* 第五轮 UI：趋势表在默认收起的 details 里 —— 表格要能在 DOM 里找到
         （querySelector 不受 closed 影响），且 open 必须是 false */
      trendFoldOpen: (function(){ var d = document.getElementById('trendFold'); return d ? d.open : null; })() };
  })()`);
  console.log("\n=== E2. 点一次加载 ⇒ 落盘 ===");
  console.log("  请求 " + fetchReq + "（批量 " + fetchBulk + "）· rows=" + E1.rows
    + " · 区间 " + E1.sD + "~" + E1.eD + " · 缓存键 " + E1.keys.length + " 条"
    + " · 条目 " + E1.rawSize + " 字符（已存 rows " + E1.storedRows + " 行）");
  console.log("  落盘字段：" + JSON.stringify(E1.objKeys) + " · 是否误存原始响应=" + E1.hasRawBundle);

  /* 重新加载：应当自动画出，且 0 请求 */
  reqN = 0; bulkN = 0;
  if (!await loadAndWait("第四次加载（有趋势缓存）")) { chrome.kill(); srv.close(); process.exit(1); }
  await sleep(800);
  const E2 = await ev(`(function(){
    const b = document.getElementById('trendBody');
    return { hasTable: !!b.querySelector('table'),
      cellN: b.querySelectorAll('td.td-cell').length,
      hasHint: b.textContent.indexOf('点上方按钮加载趋势') >= 0,
      btn: (document.getElementById('trendGo') || {}).textContent };
  })()`);
  const reloadReq = reqN, reloadBulk = bulkN;
  console.log("\n=== E3. 有趋势缓存开页 ⇒ 自动画出且零请求 ===");
  console.log("  请求总数=" + reloadReq + "（批量 " + reloadBulk + "）· 表格=" + E2.hasTable
    + " · 格子 " + E2.cellN + " · 引导文案=" + E2.hasHint);

  /* 换地点 ⇒ 旧趋势不成立；不应拿旧缓存冒充新地点 */
  const E3 = await ev(`(function(){
    setLocation(39.9042, 116.4074, '北京市', '北京市');
    return { trendAfterMove: State.trend ? (State.trend.rows ? 'still-has-rows' : 'no-rows') : 'null',
      bodyHasTable: !!document.getElementById('trendBody').querySelector('table') };
  })()`);
  console.log("\n=== E4. 换地点后旧趋势作废 ===");
  console.log("  State.trend=" + E3.trendAfterMove + " · 表格=" + E3.bodyHasTable);

  /* ---------- 汇总断言 ---------- */
  const o = {
    "新 profile 下没有任何偏好键（后续默认态断言的地基）": A.anyPref === 0 && A.pref === null,
    /* ---- 第五轮 UI：四处默认收起（设计态由机器守，防将来某次改动悄悄展开） ---- */
    "光追/数据质量两张技术卡默认折叠（folded 类 + 按钮 aria-expanded=false）":
      A.rayFolded === true && A.notesFolded === true && A.rayBtnExp === "false",
    "结论卡详情与图例说明的 details 默认收起":
      A.heroFoldOpen === false && A.legendFoldOpen === false,
    /* ---- ---- */
    "拨动后偏好键出现且内容正确": !!B.j && B.j.numLabels === true && B.j.showTx === false
      && B.j.showGrid === false && B.j.units === "imperial" && B.j.hour12 === true
      && B.j.mapDim === "q" && B.j.mapModel === "ec",
    "折叠状态写盘（点展开 ⇒ rayFold 进偏好键）": B.j.rayFold === true && B.state.foldRay === true,
    "偏好体积很小（几百字节级，不会挤占缓存配额）": B.size > 0 && B.size < 400,
    "重新加载后 State 被恢复": C.units === "imperial" && C.h12 === true
      && C.dim === "q" && C.model === "ec",
    "重新加载后控件被恢复（控件与 State 不脱节）": C.numLabels === true && C.showTx === false
      && C.showGrid === false && C.unitOn === "imperial" && C.clockOn === "12"
      && C.dimSel === "q" && C.modelSel === "ec",
    "折叠状态跨加载读回（类 / aria-expanded / 按钮文案三处一致）":
      C.rayFolded === false && C.rayBtnExp === "true" && C.rayBtnTxt === "收起" && C.foldRay === true,
    "依赖地图 DOM 的偏好也生效（经纬网；深色底图 2026-10-18 起并入主题，默认浅色不残留）":
      C.gridOn === false && C.dark === false,
    "脏值与错类型被白名单挡掉（不污染 State）": JSON.stringify(D.dirty) === JSON.stringify({ showPts: true })
      && D.dirty.rayFold === undefined && D.dirty.heroFold === undefined,
    "非 JSON / 数组 / 版本不符一律降级为默认（不抛错）": Object.keys(D.broken).length === 0
      && Object.keys(D.array).length === 0 && D.v2Isolated === true,
    "无趋势缓存时开页不取数、不打扰用户": noCacheBulk === 0 && E0.hasTable === false && E0.hasHint === true,
    "点一次加载走的是真取数（3 路批量请求）": fetchBulk >= 3 && trendOK === true,
    "趋势缓存落盘的是 rows，不是原始响应": E1.storedRows > 0 && E1.hasRawBundle === false
      && E1.rawSize > 0 && E1.rawSize < 20000,
    "趋势表包在默认收起的 details 里（表格在 DOM 中可查、open=false）":
      E1.trendFoldOpen === false && E1.bodyHasTable === true,
    "有趋势缓存时开页自动画出且零请求": reloadBulk === 0 && E2.hasTable === true && E2.cellN >= 2
      && E2.hasHint === false,
    "换地点后旧趋势被作废（不拿旧缓存冒充新地点）": E3.trendAfterMove !== "still-has-rows",
    "本轮运行无静默降级": errs.length === 0
  };
  o["初始控件态与模板默认一致"] = A.nLabels === false && A.nGrid === true
    && A.units === "metric" && A.h12 === false && A.mDim === "mix" && A.mModel === "ens";

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
