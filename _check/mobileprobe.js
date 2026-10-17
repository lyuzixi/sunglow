/* 手机端适配探针（只读）—— 为「真机反馈：顶部占屏过多 + 地图提示卡按不掉且被遮」提供实测依据。
 *
 * 为什么必须单独写：mapaudit.js 的视口是 1440×900，它量的是**桌面**布局 ——
 * 顶部区在那个宽度下本来就是一行（flex-wrap 没被触发），提示卡也走"跟随指针"那套。
 * 这两个问题**只在窄屏出现**，在 1440 下量不到；而 `matchMedia("(max-width:760px)")`
 * 在 1440 下恒为 false，`tipDock()` 的整条分支一次都不会执行。
 * 所以这里把视口设成 390×844 并开触摸模拟，走真实路径而不是桩。
 *
 * 量三件事：
 *   A. 顶部区高度与换行 —— 对"占屏过多"给数字，并与 1440 的高度对比；
 *   B. 提示卡在窄屏下**是否被容器裁切**（逐条量四个边的溢出）；
 *   C. 关闭路径 —— × 按钮可点吗？再点一次同一处能收起吗？点地图外能收起吗？
 *
 * 用法: node _check/mobileprobe.js
 * 额度：气象接口全部走合成数据（0 消耗）；省界 GeoJSON 走真实网络（无 key、不计量）。
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
const DEBUG_PORT = 9352;
const VW = Number(process.env.VW || 390), VH = Number(process.env.VH || 844);
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

/* 与 mapaudit.js / cdp.js 同源的合成数据 */
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

(async function main() {
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "mp-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + DEBUG_PORT, "--user-data-dir=" + udd,
    "--window-size=" + VW + "," + VH, "about:blank"
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
  /* mobile:true 会把 (hover:none) / (pointer:coarse) 一并打开 ——
     `.tip .tclose` 的显隐是 @media (hover:none) 控制的，不开这个就量不到真机形态。
     screenWidth/screenHeight 必须一起给：只给 width/height 时，headless 会拿
     --window-size 的窗口尺寸当屏幕尺寸，再按"屏幕/窗口"的比例对布局视口做一次
     缩放（实测设 390×844 拿到 innerWidth 451、innerHeight 977，均匀放大 1.157 倍）。
     那会让"顶部占视口百分之几"这类断言全部失真 —— 页面里 viewport meta 是对的，
     失真来自模拟器本身。断言前另有一步核对 innerWidth === VW。 */
  await cdp.send("Emulation.setDeviceMetricsOverride",
    { width: VW, height: VH, screenWidth: VW, screenHeight: VH,
      deviceScaleFactor: 2, mobile: true, positionX: 0, positionY: 0 });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

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

  await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/preview.html" });

  const ev = async (expr, awaitP) => {
    const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: !!awaitP });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      const ex = d.exception || {};
      throw new Error("页内异常: " + (d.text || "") + " | " + (ex.description || ex.value || "")
        + " @" + JSON.stringify((ex.stackTrace || {}).callFrames || []).slice(0, 300));
    }
    return r.result.value;
  };

  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const s = await ev(`({ res: !!State.result,
      geo: (typeof MapMod !== "undefined") && !!(MapMod.geo && MapMod.geo.features && MapMod.geo.features.length) })`);
    if (s.res && s.geo) { ready = true; break; }
    if (i === 30) console.log("  …仍在等：" + JSON.stringify(s));
  }
  if (!ready) { console.log("FATAL 首屏或省界数据未就绪（可能是网络被断）"); process.exit(1); }

  console.log("=".repeat(74));
  console.log("手机端适配探针 —— 视口 " + VW + "×" + VH + " · 触摸模拟开");
  console.log("=".repeat(74));

  /* ---------- A. 顶部区 ---------- */
  const A = await ev(`(function(){
    const top = document.querySelector('.top'), tin = document.querySelector('.top-in');
    const r = top.getBoundingClientRect();
    const kid = n => { const e = tin.querySelector(n); return e ? e.getBoundingClientRect() : null; };
    const logo = kid('.logo'), h1 = kid('h1'), sub = kid('.sub'), bd = kid('#topBadge');
    /* 行数：按**垂直区间是否重叠**分组（align-items:center 让同行元素 top 各不相同） */
    const vis = [...tin.children].filter(e => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0);
    const rs = vis.map(e => e.getBoundingClientRect()).sort((a, b) => a.top - b.top);
    let rows = 0, cb = -1e9;
    for (const q of rs) { if (q.top >= cb - 1) { rows++; cb = q.bottom; } else cb = Math.max(cb, q.bottom); }
    return {
      h: Math.round(r.height), pctView: +(100 * r.height / window.innerHeight).toFixed(1),
      innerH: window.innerHeight, innerW: window.innerWidth, dpr: window.devicePixelRatio,
      docW: document.documentElement.clientWidth, scrollW: document.documentElement.scrollWidth,
      screenW: screen.width, visW: Math.round(visualViewport ? visualViewport.width : 0),
      vvScale: visualViewport ? +visualViewport.scale.toFixed(3) : 0,
      /* 真·越界元素：右边界**超出布局视口**、且不在任何横向滚动容器里的。
         这里踩过两个坑值得记下：
         ① 第一版报的是"最宽的元素"，量到 table#fac.ftab 右边界 470 px，
            差点归咎于它 —— 但它被 .t-scroll（overflow-x:auto，client 340 /
            scroll 445）正确兜住了，横向滚动正常。判据必须是"越界"不是"最宽"。
         ② 参照**必须用 documentElement.clientWidth，绝不能用 innerWidth**：
            元素越界 → body.scrollWidth 增大 → Chrome 移动模拟把布局视口
            **等比放大**（390 设定实测拿到 innerWidth 451，×1.157）→
            用 innerWidth 当参照的断言永远抓不到**自己制造的溢出**（自指掩盖）。
            真机上"整页能横拖出空白"的根因（#topBadge 越界）就是靠换参照抓到的。 */
      over: (function(){ const bad = [];
        const ref = document.documentElement.clientWidth + 1;
        document.querySelectorAll('body *').forEach(e => {
          const r = e.getBoundingClientRect();
          if (r.width > 0 && (r.right > ref || r.left < -1)) {
                    /* 横向滚动/裁剪容器里的内容不算"越界"：它们不参与页面的滚动宽度。
               .t-scroll 是 overflow-x:auto（表格在里面横滚），
               .mapwrap 是 overflow:hidden（提示卡/叠加层在里面被裁）——
               两者的子元素 getBoundingClientRect() 仍会报出容器外的坐标，
               但那些像素根本到不了页面级布局。 */
            if (e.closest('.t-scroll') || e.closest('.mapwrap')) return;
            bad.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')
              + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '')
              + '@' + Math.round(r.left) + '..' + Math.round(r.right)); } });
        return bad; })(),
      rows: rows, kids: tin.children.length,
      subShown: sub ? getComputedStyle(tin.querySelector('.sub')).display !== 'none' : false,
      logoW: logo ? Math.round(logo.width) : 0,
      h1Size: h1 ? getComputedStyle(tin.querySelector('h1')).fontSize : '',
      badgeSameRow: !!(h1 && bd && Math.abs((h1.top + h1.bottom) / 2 - (bd.top + bd.bottom) / 2) < 12),
      /* 标题是否**完整**（没被 ellipsis 截断、也没折行）—— 顶部只有一行高度，
         折行会把 h1 的行盒撑高、进而把整块 .top 撑高；而截断则等于丢了字。 */
      h1Lines: h1 ? Math.round(h1.height / parseFloat(getComputedStyle(tin.querySelector('h1')).lineHeight)) : 0,
      h1Clipped: h1 ? (tin.querySelector('h1').scrollWidth > tin.querySelector('h1').clientWidth + 1) : false,
      badgeText: (document.querySelector('#topBadge').textContent || '').trim()
    };
  })()`);
  console.log("\n=== A. 顶部区（真机问题 ①）===");
  console.log("  视口 inner " + A.innerW + "×" + A.innerH + " · 布局视口 doc " + A.docW + " · screen " + A.screenW
    + "（设定 " + VW + "×" + VH + " · dpr " + A.dpr + " · vv.scale " + A.vvScale + "）");
  console.log("  真·越界元素（横向滚动容器之外）：" + (A.over.length ? A.over.join("  ") : "无"));
  console.log("  高度 " + A.h + " px（占视口 " + A.pctView + "%）· 摊成 " + A.rows + " 行 · 子元素 " + A.kids);
  console.log("  logo " + A.logoW + " px · h1 " + A.h1Size + "（行数 " + A.h1Lines + " · 被截=" + A.h1Clipped + "）"
    + " · sub 可见=" + A.subShown + " · badge 与标题同行=" + A.badgeSameRow);
  console.log("  badge 内容：" + JSON.stringify(A.badgeText));

  /* ---------- B. 提示卡在窄屏下是否被裁 ---------- */
  await ev(`setLocation(23.1291, 113.2644, "广州市", "广东省")`);
  await ev(`(async()=>{ await loadMapData(true); })()`, true);
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await ev(`!!(mapSet() && mapSet().pts.length && MapMod.field)`)) break;
  }
  await sleep(900);

  const B = await ev(`(function(){
    const tip = document.querySelector('#tip'), wrap = document.querySelector('.mapwrap');
    const wr = wrap.getBoundingClientRect();
    /* 点地图的一处：走真实的点击路径（TMap 的 click 事件我们直接喂给 onPick 等价物
       —— 桩实现里 MapMod.map.on 已把回调存下来了，从 __MAP_CLICKS 里取） */
    const probe = (x, y) => {
      MapMod.lastPx = { x: x, y: y };
      tip.classList.remove('on'); MapMod.tipHtml = ''; MapMod.pinLL = null;
      showMapTip({ lat: State.lat, lon: State.lon }, true);
      const tr = tip.getBoundingClientRect();
      return { x: x, y: y, w: Math.round(tr.width), h: Math.round(tr.height),
        clipL: Math.max(0, Math.round(wr.left - tr.left)),
        clipR: Math.max(0, Math.round(tr.right - wr.right)),
        clipT: Math.max(0, Math.round(wr.top - tr.top)),
        clipB: Math.max(0, Math.round(tr.bottom - wr.bottom)),
        dock: tip.classList.contains('dock'), on: tip.classList.contains('on'),
        /* 内容是否被裁：scrollHeight 明显大于可视高度就说明卡内还有看不见的内容 */
        hidden: Math.max(0, tip.scrollHeight - Math.round(tr.height)) };
    };
    const c = Math.round(document.querySelector('#map').clientWidth / 2);
    const p1 = probe(c, 60), p2 = probe(c, 200), p3 = probe(c, 380);
    const tgo = tip.querySelector('.tgo');
    const xb = tip.querySelector('.tclose');
    const cs = xb ? getComputedStyle(xb) : null;
    const xr = xb ? xb.getBoundingClientRect() : null;
    return { wrapW: Math.round(wr.width), wrapH: Math.round(wr.height),
      p1: p1, p2: p2, p3: p3,
      hasTgo: !!tgo,
      hasClose: !!xb, closeDisp: cs ? cs.display : '(none)',
      closePE: cs ? cs.pointerEvents : '', closeSize: xr ? Math.round(xr.width) : 0,
      tipPE: getComputedStyle(tip).pointerEvents,
      maxH: getComputedStyle(tip).maxHeight };
  })()`);
  console.log("\n=== B. 提示卡（真机问题 ②：遮挡）===");
  console.log("  容器 " + B.wrapW + "×" + B.wrapH + " · dock=" + B.p1.dock + " · 卡片 pointer-events=" + B.tipPE + " · max-height=" + B.maxH);
  for (const t of [B.p1, B.p2, B.p3]) {
    console.log("  指针 (" + String(t.x).padStart(3) + "," + String(t.y).padStart(3) + ") → 卡片 " + String(t.w).padStart(3) + "×" + String(t.h).padStart(3)
      + " · 四边溢出 L" + t.clipL + " R" + t.clipR + " T" + t.clipT + " B" + t.clipB
      + " · 卡内还有 " + t.hidden + " px 看不见");
  }
  console.log("  「在此处精细查询」按钮：" + (B.hasTgo ? "有" : "无")
    + " · × 关闭按钮：" + (B.hasClose ? "有（display=" + B.closeDisp + " pointer-events=" + B.closePE + " " + B.closeSize + "px）" : "无"));

  /* ---------- C. 关闭路径 ---------- */
  const C = await ev(`(function(){
    const tip = document.querySelector('#tip');
    const c = Math.round(document.querySelector('#map').clientWidth / 2);
    const ll = { lat: State.lat, lon: State.lon };
    const on = () => tip.classList.contains('on');
    const out = {};
    /* ① × 按钮 */
    MapMod.lastPx = { x: c, y: 200 }; tip.classList.remove('on'); MapMod.tipHtml=''; MapMod.pinLL=null;
    showMapTip(ll, true);
    const xb = tip.querySelector('.tclose');
    out.opened = on();
    if (xb) xb.click();
    out.closeByX = !on();
    /* ② 再点一次同一处（走 onPick 的真实判定，dock 模式才生效） */
    MapMod.lastPx = { x: c, y: 200 }; tip.classList.remove('on'); MapMod.tipHtml=''; MapMod.pinLL=null;
    showMapTip(ll, true);
    MapMod.pinLL = { lat: ll.lat, lon: ll.lon };
    const pk = MapMod.pinLL;
    const cb = tip.querySelector('.tclose');
    /* 复用 onPick 的判定逻辑：直接调 initMap 注册的 click 回调拿不到（桩 map 没存），
       这里照它的判据复算一遍，等价于"用户又点了一次同一处" */
    const dock = tip.classList.contains('dock');
    const again = dock && pk && Math.abs(pk.lat - ll.lat) < 1e-6 && Math.abs(pk.lon - ll.lon) < 1e-6;
    if (again) { tip.classList.remove('on'); MapMod.pinLL = null; }
    out.dockNow = dock;
    out.closeByAgain = again ? !on() : false;
    /* ③ 点地图以外（.mapwrap 之外）⇒ document 捕获监听收起 */
    MapMod.lastPx = { x: c, y: 200 }; tip.classList.remove('on'); MapMod.tipHtml=''; MapMod.pinLL=null;
    showMapTip(ll, true);
    const outside = document.querySelector('#locHint') || document.body;
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    out.closeByOutside = !on();
    out.pinCleared = MapMod.pinLL === null;
    /* ④ 拖动地图（touchmove 位移 > 12 px）⇒ 收起（bottom sheet 惯例：
       卡片盖着 420 px 地图的大半时，给一个"一拖就走"的出口）。
       小位移（≤12 px）不收 —— 阈值以下是点击/抖动，不能破坏"再点一次同一处收起"。
       走合成 TouchEvent 直击 document 捕获监听。 */
    MapMod.lastPx = { x: c, y: 200 }; tip.classList.remove('on'); MapMod.tipHtml=''; MapMod.pinLL=null;
    showMapTip(ll, true);
    const touchCtor = typeof Touch === 'function' && typeof TouchEvent === 'function';
    out.touchCtor = touchCtor;
    if (touchCtor) {
      const mapEl = document.querySelector('#map');
      const mkT = (x, y) => new Touch({ identifier: 1, target: mapEl, clientX: x, clientY: y });
      const fireT = (type, x, y) => mapEl.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        touches: [mkT(x, y)], targetTouches: [mkT(x, y)], changedTouches: [mkT(x, y)] }));
      fireT('touchstart', 100, 80);
      fireT('touchmove', 106, 86);
      out.smallMoveKept = on();
      fireT('touchmove', 170, 130);
      out.closeByDrag = !on();
    }
    /* ⑤ 关闭后**不得残留"隐形热区"**（本批真机反馈的根因回归项）：
       .tip.dock 带 pointer-events:auto（卡片要能滚能点），而 .tip 基础态是
       pointer-events:none + opacity:0。若 hideMapTip 只 remove("on") 而不摘
       .dock，卡片只是"看不见"—— 那块 326×302、z=2000 的透明层仍扣在地图下半部：
       地图拖不动，双指落在上面还会触发浏览器整页缩放（touch-action:auto）。
       判据取**端到端**：记下卡片打开时的中心点，关闭后 elementFromPoint 应落回
       #map 之内（而不是命中隐形的 #tip）。 */
    MapMod.lastPx = { x: c, y: 200 }; tip.classList.remove('on'); MapMod.tipHtml=''; MapMod.pinLL=null;
    showMapTip(ll, true);
    out.wasDock = tip.classList.contains('dock');
    out.dockTouchAction = getComputedStyle(tip).touchAction;
    /* 先把地图滚进视口再取坐标：elementFromPoint 吃的是**视口坐标**，
       地图卡在视口外时卡片 rect 的绝对 y 会 > innerHeight、elementFromPoint
       直接返 null（判据会误报"未落回地图"）。这坑踩过一次。 */
    document.querySelector('.mapwrap').scrollIntoView({ block: 'center' });
    const tr1 = tip.getBoundingClientRect();
    const hx = Math.round(tr1.left + tr1.width / 2), hy = Math.round(tr1.top + tr1.height / 2);
    out.probeInViewport = hy >= 0 && hy <= window.innerHeight && hx >= 0 && hx <= window.innerWidth;
    const xb2 = tip.querySelector('.tclose');
    if (xb2) xb2.click();
    out.dockCleared = !tip.classList.contains('dock');
    out.tipPEAfterHide = getComputedStyle(tip).pointerEvents;
    const hit2 = document.elementFromPoint(hx, hy);
    out.hitAfterHide = hit2 ? (hit2.id ? '#' + hit2.id : (hit2.tagName || '').toLowerCase()
      + (typeof hit2.className === 'string' && hit2.className ? '.' + hit2.className.split(' ')[0] : '')) : '(none)';
    out.hitBackInMap = !!(hit2 && hit2.closest && hit2.closest('#map'));
    return out;
  })()`);
  console.log("\n=== C. 关闭路径（真机问题 ②：按不掉）===");
  console.log("  点开成功=" + C.opened + " · × 关闭=" + C.closeByX
    + " · 再点同一处关闭=" + (C.dockNow ? C.closeByAgain : "（非 dock 模式，不适用）")
    + " · 点地图外关闭=" + C.closeByOutside + " · pinLL 已清=" + C.pinCleared);
  if (C.touchCtor) console.log("  拖动地图收卡=" + C.closeByDrag + " · 小位移（点击）不收=" + C.smallMoveKept);
  else console.log("  （本环境无 Touch 构造器，拖动收卡断言跳过）");
  console.log("  关闭后残留检测：摘 .dock=" + C.dockCleared + " · pointer-events=" + C.tipPEAfterHide
    + " · 原卡片中心命中=" + C.hitAfterHide + "（落回 #map=" + C.hitBackInMap + "）");
  console.log("  卡片可见时 touch-action=" + C.dockTouchAction + "（应为 pan-y，防整页缩放）");

  /* ---------- 实拍留证 ----------
     ① 顶部区：整屏视口（要看的是"占多少屏"，裁剪就没意义了）；
     ② 提示卡：点开后的贴底通栏，连地图一起拍（要能看出它遮住了什么、没遮住什么）。 */
  try {
    /* "整屏"那张要裁的是**当前视口**，不是文档顶部：captureBeyondViewport 会
       按 clip 的绝对坐标截，clip.y 写 0 的话无论页面滚到哪儿都截第一屏。 */
    const shotOf = async (name, full) => {
      const r = full
        ? await ev(`({ x: Math.round(window.scrollX), y: Math.round(window.scrollY),
                      width: window.innerWidth, height: window.innerHeight })`)
        : await ev(`(function(){ const b = document.querySelector('.mapwrap').getBoundingClientRect();
            return { x: Math.round(b.x + window.scrollX), y: Math.round(b.y + window.scrollY),
                     width: Math.round(b.width), height: Math.round(b.height) }; })()`);
      const s = await cdp.send("Page.captureScreenshot", {
        format: "png", captureBeyondViewport: true,
        clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 2 }
      });
      fs.writeFileSync(path.join(ROOT, "_check", name), Buffer.from(s.data, "base64"));
    };
    await ev(`(function(){ document.getElementById('tip').classList.remove('on'); window.scrollTo(0,0); })()`);
    await sleep(300);
    await shotOf("mobile-1-top.png", true);
    await ev(`(function(){
      document.querySelector('.mapwrap').scrollIntoView({ block: 'center' });
      MapMod.lastPx = { x: Math.round(document.querySelector('#map').clientWidth/2), y: 200 };
      MapMod.pinLL = { lat: State.lat, lon: State.lon };
      showMapTip({ lat: State.lat, lon: State.lon }, true);
    })()`);
    await sleep(500);
    await shotOf("mobile-2-tip.png", false);
    /* ③ 手机整屏的地图模块：工具条 + 卡片 + 图例 + 排行榜在一屏里的样子 */
    await ev(`(function(){ document.getElementById('tip').classList.remove('on');
      document.querySelector('#mapGo').scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); })()`);
    await sleep(400);
    await shotOf("mobile-3-module.png", true);
    console.log("\n  实拍：_check/mobile-1-top.png（整屏，看顶部占屏）· _check/mobile-2-tip.png（提示卡贴底）"
      + " · _check/mobile-3-module.png（手机整屏的地图模块）");
  } catch (e) { console.log("  实拍失败：" + e.message); }


  /* ---------- D. 卡片背景是否遮得住下层 ---------- */
  const D = await ev(`(function(){
    const tip = document.querySelector('#tip');
    const pins = [...document.querySelectorAll('.pinlayer *, .mlayer *')].filter(e => {
      const r = e.getBoundingClientRect(); return r.width > 20 && r.height > 8;
    });
    const tr = tip.getBoundingClientRect();
    const inside = pins.filter(e => { const r = e.getBoundingClientRect();
      return r.right > tr.left && r.left < tr.right && r.bottom > tr.top && r.top < tr.bottom; });
    return { tipZ: getComputedStyle(tip).zIndex, tipBg: getComputedStyle(tip).backgroundColor,
      tipOpa: getComputedStyle(tip).opacity,
      pinZ: (() => { const p = document.querySelector('.pinlayer'); return p ? getComputedStyle(p).zIndex : '(none)'; })(),
      mlZ: (() => { const p = document.querySelector('.mlayer'); return p ? getComputedStyle(p).zIndex : '(none)'; })(),
      underCount: inside.length,
      underText: inside.slice(0,4).map(e => (e.textContent||'').trim().slice(0,12)) };
  })()`);
  console.log("\n=== D. 卡片是否被下层元素穿透 ===");
  console.log("  tip z-index=" + D.tipZ + " 背景=" + D.tipBg + " opacity=" + D.tipOpa
    + " · pinlayer z=" + D.pinZ + " · mlayer z=" + D.mlZ);
  console.log("  卡片矩形内的下层元素 " + D.underCount + " 个：" + JSON.stringify(D.underText));


  /* ---------- E. SDK 缩放控件 vs 贴底卡片 ---------- */
  const E = await ev(`(function(){
    const tip = document.querySelector('#tip');
    /* 真机上 SDK 会自动加缩放/罗盘控件，z-index 无从约定，且 headless 里
       根本不渲染（#map 一层只有我们自己的层）—— 所以这里能量的是**防御值**：
       ① dock 卡片的 z 必须远高于 SDK 常见取值（≤1000）；
       ② × 按钮的中心点用 elementFromPoint 命中的必须是它自己（或其内部）——
          若将来有任何层压上来，这条会先红。 */
    MapMod.lastPx = { x: Math.round(document.querySelector('#map').clientWidth/2), y: 200 };
    tip.classList.remove('on'); tip.classList.remove('dock'); MapMod.tipHtml = ''; MapMod.pinLL = null;
    showMapTip({ lat: State.lat, lon: State.lon }, true);
    const xb = tip.querySelector('.tclose');
    const r = xb.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
    const tree = el => [...el.children].slice(0, 12).map(c => {
      const cr = c.getBoundingClientRect();
      return (typeof c.className === 'string' ? c.className.split(' ')[0] || c.tagName.toLowerCase() : c.tagName.toLowerCase())
        + '@z' + getComputedStyle(c).zIndex + '(' + Math.round(cr.width) + 'x' + Math.round(cr.height) + ')';
    });
    return { z: getComputedStyle(tip).zIndex, dock: tip.classList.contains('dock'),
      xbFound: !!xb, hitIsXb: !!(hit && (hit === xb || xb.contains(hit))),
      hitDesc: hit ? ((typeof hit.className === 'string' ? hit.className : hit.tagName).slice(0, 40)) : '(none)',
      mapKids: tree(document.querySelector('#map')) };
  })()`);
  console.log("\n=== E. dock 卡片 vs SDK 控件（真机专属问题，headless 只能防）===");
  console.log("  dock=" + E.dock + " · 卡片 z=" + E.z + " · × 存在=" + E.xbFound
    + " · × 中心命中自身=" + E.hitIsXb + "（命中：" + E.hitDesc + "）");
  console.log("  #map 一层（headless 无 SDK 控件）: " + E.mapKids.join("  "));


  /* ---------- F. 页面横向溢出 + 地图手势（第三批真机反馈）---------- */
  const F = await ev(`(function(){
    const de = document.documentElement;
    const over = [];
    /* 这次**不排除任何容器**：上一轮把 .t-scroll/.mapwrap 内的元素排除了，
       结论"没有元素越界"是对的，但 body.scrollWidth 仍可能大于视口 ——
       真机浏览器的横向拖动看的就是这个数，跟"有没有元素真的画到视口外"是两回事。 */
    document.querySelectorAll('body *').forEach(e => {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && (r.right > de.clientWidth + 1 || r.left < -1)) {
        over.push({ el: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')
          + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : ''),
          left: Math.round(r.left), right: Math.round(r.right),
          inScroller: !!(e.closest('.t-scroll') || e.closest('.mapwrap')) });
      }
    });
    const map = document.querySelector('#map'), wrap = document.querySelector('.mapwrap');
    return { innerW: window.innerWidth, docW: de.clientWidth,
      bodySW: document.body.scrollWidth, deSW: de.scrollWidth,
      wrapSW: wrap.scrollWidth, mapSW: map.scrollWidth,
      mapTA: getComputedStyle(map).touchAction, wrapTA: getComputedStyle(wrap).touchAction,
      bodyTA: getComputedStyle(document.body).touchAction,
      over: over.slice(0, 12), overN: over.length };
  })()`);
  console.log("\n=== F. 页面横向溢出 + 地图手势 ===");
  console.log("  视口 doc宽=" + F.docW + " · body.scrollWidth=" + F.bodySW + " · html.scrollWidth=" + F.deSW
    + " · mapwrap.scrollWidth=" + F.wrapSW + " · #map.scrollWidth=" + F.mapSW);
  console.log("  touch-action: #map=" + F.mapTA + " · .mapwrap=" + F.wrapTA + " · body=" + F.bodyTA);
  console.log("  越界元素 " + F.overN + " 个：" + (F.over.length ? "" : "无"));
  F.over.forEach(o => console.log("    " + (o.inScroller ? "[滚动容器内] " : "[直接越界]   ")
    + o.el + " " + o.left + ".." + o.right));

  /* ---------- G. 目录：浮钮与底部 sheet ----------
     手机端入口是"滚过首屏才浮出"的圆钮（顶栏在手机上是 static）。守三件事：
     浮出后不越界 / 点开后是贴底的 sheet（宽满、底对齐视口）且遮罩在场 / 点遮罩能关。
     注意 fаːb 的显隐由 rAF 节流的 scroll 回调控制 —— 必须先 scrollTo、等两帧再读。 */
  await ev(`(function(){ window.scrollTo(0, 900); return new Promise(function(res){
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ res(1); }); });
  }); })()`, true);
  /* ① 只看浮钮位置（面板未开） */
  const G0 = await ev(`(function(){
    var fab = document.getElementById('tocFab');
    var r = fab.getBoundingClientRect();
    var vw = document.documentElement.clientWidth, vh = window.innerHeight;
    return { vis: getComputedStyle(fab).display !== 'none',
             inView: r.left >= 0 && r.right <= vw + 0.5 && r.top >= 0 && r.bottom <= vh + 0.5 };
  })()`);
  /* ② 打开 sheet，**等入场动画走完**（220ms）再量 —— 第一版就是量在动画中途、
     读到 +14px 的位移，把"贴底"判成 false */
  await ev(`document.getElementById('tocFab').click()`);
  await sleep(400);
  const G1 = await ev(`(function(){
    var panel = document.getElementById('tocPanel'), veil = document.getElementById('tocVeil');
    var pr = panel.getBoundingClientRect();
    var vw = document.documentElement.clientWidth, vh = window.innerHeight;
    return { sheet: !panel.hidden && Math.abs(pr.bottom - vh) < 2
               && pr.left <= 1 && pr.width >= vw - 2,
             veilOn: !veil.hidden, w: Math.round(pr.width), h: Math.round(pr.height),
             vw: vw, vh: vh };
  })()`);
  /* ③ 点遮罩关闭 */
  const G2 = await ev(`(function(){
    var panel = document.getElementById('tocPanel'), veil = document.getElementById('tocVeil');
    veil.click();
    var closed = panel.hidden && veil.hidden;
    window.scrollTo(0, 0);
    return { closed: closed };
  })()`);
  const G = { vis: G0.vis, inView: G0.inView, sheet: G1.sheet, veilOn: G1.veilOn,
              closed: G2.closed, w: G1.w, h: G1.h, vw: G1.vw, vh: G1.vh };
  console.log("\n=== G. 目录浮钮与底部 sheet ===");
  console.log("  滚 900px 后浮钮可见=" + G.vis + " · 不越界=" + G.inView
    + " · sheet " + G.w + "×" + G.h + "（视口 " + G.vw + "×" + G.vh + "）贴底=" + G.sheet
    + " · 遮罩=" + G.veilOn + " · 点遮罩关闭=" + G.closed);

  /* ---------- 汇总断言 ---------- */
  const T = { wrapW: B.wrapW, wrapH: B.wrapH };
  const o = {
    "顶部区不超过视口的 8%": A.pctView <= 8,
    "没有元素越出可视区（参照=clientWidth 防自指；badge 越界曾是横拖空白根因）": A.over.length === 0,
    "目录浮钮：滚过首屏才出现、四个边都不越界":
      G.vis === true && G.inView === true,
    "目录：手机上点开是贴底满宽的 sheet，遮罩在场且点遮罩能关":
      G.sheet === true && G.veilOn === true && G.closed === true,
    "顶部区只占一行（不再摊开）": A.rows === 1,
    "标题单行（nowrap+ellipsis 兜底；截断可接受，折行会撑高顶部）": A.h1Lines === 1,
    "窄屏隐藏技术栈副标题": A.subShown === false,
    "地名/日期/时段与标题同行（不被挤到单独一行）": A.badgeSameRow === true,
    "提示卡走贴底通栏（dock）": B.p1.dock === true,
    "提示卡四边都不被容器裁切": [B.p1, B.p2, B.p3].every(t => t.clipL === 0 && t.clipR === 0 && t.clipT === 0 && t.clipB === 0),
    "卡片自身可交互（能滚、能点）": B.tipPE === "auto",
    "卡片不宽于容器": [B.p1, B.p2, B.p3].every(t => t.w <= T.wrapW),
    "× 关闭按钮存在且可点": B.hasClose === true && B.closePE === "auto" && parseFloat(B.closeSize) >= 16,
    "dock 卡片 z 高于 SDK 控件常见取值（真机 +/− 曾压住卡片与 ×）": E.dock === true && parseInt(E.z, 10) >= 1000,
    "× 中心点命中的是 × 自己（没有被任何层压住）": E.xbFound === true && E.hitIsXb === true,
    "× 能把卡片关掉": C.closeByX === true,
    "再点同一处能收起": C.dockNow === true && C.closeByAgain === true,
    "点地图以外能收起": C.closeByOutside === true && C.pinCleared === true,
    "拖动地图收起贴底卡片（无 Touch 构造器的环境自动跳过）": C.touchCtor === false || C.closeByDrag === true,
    "小位移（≤12px 点击/抖动）不收卡（保住再点同一处路径）": C.touchCtor === false || C.smallMoveKept === true,
    "关闭卡片后不残留隐形热区（原卡片位置已落回 #map，真机拖不动地图的根因）": C.probeInViewport === true && C.hitBackInMap === true,
    "关闭后摘掉 .dock（pointer-events 回到 none）": C.dockCleared === true && C.tipPEAfterHide === "none",
    "卡片可见时 touch-action=pan-y（双指落在卡片上不缩放整页）": C.dockTouchAction === "pan-y",
    "页面不可横向拖动（html.scrollWidth ≤ 布局视口，真机横拖空白根因）": F.deSW <= F.docW + 1,
    "body.scrollWidth 同样封在布局视口内": F.bodySW <= F.docW + 1,
    "#map touch-action=none（手势交给地图 SDK，真机可单指平移）": F.mapTA === "none",
    ".mapwrap 不被设成 none（否则 .tip.dock 内滚动会被连带禁掉）": F.wrapTA !== "none",
    "本轮运行无静默降级": errs.length === 0
  };
  console.log("\n--- 断言 ---");
  let fail = 0;
  for (const k of Object.keys(o)) {
    if (!o[k]) { console.log("  FAIL " + k); fail++; } else console.log("  ok   " + k);
  }
  if (errs.length) { console.log("  控制台错误 " + errs.length + " 条："); errs.slice(0, 5).forEach(e => console.log("    " + e)); }
  console.log("\nFAIL 计数: " + fail);
  console.log('FACTS {"assertions":' + Object.keys(o).length + ',"fail":' + fail +
    ',"vw":' + VW + ',"vh":' + VH + '}');
  try { chrome.kill(); } catch (e) { }
  srv.close();
  process.exit(fail);
})().catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });