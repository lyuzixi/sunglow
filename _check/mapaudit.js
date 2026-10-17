/* 地图模块审计（只读）——为「地图模块改进方案」提供实测依据，不做任何修改。
 *
 * 为什么单独写一个：这一批要查的问题分散在 CSS 布局、提示卡定位、排行榜口径、
 * 图例体量四个互不相干的地方，用现有探针都不好表达（它们各自钉死的是一类不变量）。
 * 这里只做两件事：**量出事实**、**对"本该成立"的性质下断言**。
 *
 * 目前它已转绿（26 条具名断言），并已接入 `_check/all.py`（第 11 项）。
 * 第 9 批新增 I 段：等值线层的存在/层序/跟随羽化/不动色面像素，以及经纬网间距。
 * B1  给 I 段补了数据范围边界线两条（顶点数一致 / 仍画出了一段）。
 * C1+C2 新增 J 段 4 条：经纬网开关（存在·关得掉·不影响等值线·开得回来）
 *     与可信度纱的边界（起纱 ≡ 淡出 ≡ 外推，判据是凸包外）。
 *
 * 用法: node _check/mapaudit.js
 * 额度：气象接口全部走合成数据（0 消耗）；省界 GeoJSON 走真实网络（无 key、不计量）。
 * 对 8 个沿海/内陆城市各扫一遍网格 —— 走 localStorage 缓存，不额外消耗气象额度。
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
const PORT = 47883;
const DEBUG_PORT = 9345;

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

/* 与 cdp.js / localgrid.js 同源的合成数据：逐小时、按绝对日序，保证跨窗口一致 */
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
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "ma-"));
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
  /* 桌面宽度 + 右列卡片的实际可用宽度：地图卡在右侧 sticky 列里，比整页窄很多，
     所以布局问题必须在**该宽度下**量，全屏宽度量不出来。 */
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
    if (r.exceptionDetails) throw new Error("页内异常: " + JSON.stringify(r.exceptionDetails.text));
    return r.result.value;
  };

  /* 等首屏 + 省界 GeoJSON（掩膜与 provOf 都要它）。
     注意别写成 `window.MapMod`：MapMod 是**顶层 const**，词法声明不会挂到 window 上，
     这样写会永远取到 undefined，探针会以"数据未就绪"退化成空转。 */
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
  console.log("地图模块审计 —— 只读，不改任何状态");
  console.log("=".repeat(74));

  /* ---------- A. 工具条布局 ---------- */
  const A = await ev(`(function(){
    /* 行数必须按**垂直区间是否重叠**分组，不能按 rect.top 的精确值分组 ——
       同一行里的元素高度不同（select 36px、label 20px），align-items:center 会让
       top 各不相同，按 top 分组会把一行数成三行（第一版就这么错了）。 */
    const bands = els => {
      const rs = els.map(e => e.getBoundingClientRect()).sort((a, b) => a.top - b.top);
      let n = 0, curBottom = -1e9;
      for (const r of rs) { if (r.top >= curBottom - 1) { n++; curBottom = r.bottom; } else curBottom = Math.max(curBottom, r.bottom); }
      return n;
    };
    const tool = document.querySelector('.maptool');
    const kids = [...tool.children];
    /* 复选框"自然宽度"取 13 px（浏览器默认方块 + 边框）。被 CSS 撑宽的像素数
       ＝ input 宽 − 13，这是**不依赖任何渲染假设**的事实量。
       注意别用 label 宽 − input 宽 当"死区" —— 那等于"文字宽 + 间隙"，
       归零 input 后它仍然有 45~58 px（就是那四个汉字的宽度），会把结论带歪。 */
    const NATURAL = 13;
    const chks = [...document.querySelectorAll('.maptool label.chk')].map(l => {
      const i = l.querySelector('input'), ir = i.getBoundingClientRect(), lr = l.getBoundingClientRect();
      return { id: i.id, type: i.type, inputW: Math.round(ir.width),
               minW: getComputedStyle(i).minWidth, labelW: Math.round(lr.width),
               overPx: Math.round(ir.width) - NATURAL,
               textW: Math.round(lr.width - ir.width) };
    });
    const sels = [...document.querySelectorAll('.maptool select')].map(s => Math.round(s.getBoundingClientRect().width));
    const items = kids.map(k => {
      const r = k.getBoundingClientRect();
      return { tag: k.tagName.toLowerCase() + (k.id ? '#' + k.id : ''),
               w: Math.round(r.width), top: Math.round(r.top),
               label: k.tagName === 'LABEL' ? k.textContent.trim() : '' };
    });
    const GAP = 10;                                  /* .maptool 的 gap */
    const areaRows = (sumW, n) => Math.ceil((sumW + GAP * (n - 1)) / document.querySelector('#map').closest('.card').getBoundingClientRect().width);
    const before = { rows: bands(kids), h: Math.round(tool.getBoundingClientRect().height),
                     sumW: Math.round(items.reduce((a, x) => a + x.w, 0)),
                     minRows: areaRows(items.reduce((a, x) => a + x.w, 0), items.length) };
    /* 反事实：只把复选框的 min-width 归零（select 不动），看工具条能省下多少行与多高。
       这是"修它值不值"的直接依据，而不是靠猜。 */
    const st = document.createElement('style');
    st.textContent = '.maptool input[type=checkbox]{min-width:0;width:13px;height:13px;padding:0;margin:0}';
    document.head.appendChild(st);
    const afterRows = bands(kids), afterH = Math.round(tool.getBoundingClientRect().height);
    const afterItems = kids.map(k => Math.round(k.getBoundingClientRect().width));
    const afterSumW = afterItems.reduce((a, x) => a + x, 0);
    const afterMinRows = areaRows(afterSumW, afterItems.length);
    const afterChk = [...document.querySelectorAll('.maptool label.chk')]
      .map(l => Math.round(l.getBoundingClientRect().width - l.querySelector('input').getBoundingClientRect().width));
    st.remove();
    return { cardW: Math.round(document.querySelector('#map').closest('.card').getBoundingClientRect().width),
             before: before, afterRows: afterRows, afterH: afterH, afterChk: afterChk,
             afterSumW: afterSumW, afterMinRows: afterMinRows,
             overSum: chks.reduce((a, c) => a + c.overPx, 0),
             nChk: chks.length,
             chks: chks, sels: sels, items: items };
  })()`);
  console.log("\n=== A. 工具条布局 ===");
  console.log("  卡片宽度 " + A.cardW + " px");
  console.log("  现状：工具条 " + A.before.h + " px 高 · 折成 " + A.before.rows + " 行"
    + " · 控件总宽 " + A.before.sumW + " px（面积下界 " + A.before.minRows + " 行）");
  A.chks.forEach(c => console.log("    复选框 #" + c.id + "（" + c.type + "）input 宽 " + c.inputW
    + " px（min-width " + c.minW + "）· 被撑宽 " + c.overPx + " px · 文字+间隙 " + c.textW + " px"));
  console.log("    下拉框宽度 " + JSON.stringify(A.sels));
  console.log("  ⇒ " + A.nChk + " 个复选框共被撑宽 " + A.overSum + " px ＝ 卡片宽度的 "
    + Math.round(A.overSum / A.cardW * 100) + "%（这些宽度全是 label 的可点区域，"
    + "所以不是「死区」、也不影响行数，纯粹是方块与文字被拉开）");
  console.log("  反事实（只把复选框 min-width 归零，select 不动）："
    + A.afterH + " px 高 · " + A.afterRows + " 行"
    + "（控件总宽 " + A.afterSumW + " px，面积下界 " + A.afterMinRows + " 行）"
    + " ⇒ 省 " + (A.before.h - A.afterH) + " px / " + (A.before.rows - A.afterRows) + " 行");
  console.log("  现状逐行排布：");
  const bandsOf = {};
  A.items.forEach(it => {
    const rr = A.items.filter(x => Math.abs(x.top - it.top) < 10);
    bandsOf[it.top] = rr;
  });
  const seen = new Set();
  Object.keys(bandsOf).sort((a, b) => a - b).forEach(t => {
    if (seen.has(t)) return;
    const grp = bandsOf[t];
    grp.forEach(g => seen.add(String(g.top)));
    console.log("     y≈" + t + "  " + grp.map(g => g.tag + "(" + g.w + ")" + (g.label ? "「" + g.label + "」" : "")).join("  "));
  });

  /* ---------- 点一次「刷新地图」把地图数据准备好（合成数据，0 额度） ---------- */
  await ev(`(function(){ const b=document.querySelector('#mapGo'); if(b) b.click(); return 1; })()`);
  let loaded = false;
  for (let i = 0; i < 60; i++) {
    await sleep(800);
    if (await ev(`!!(window.mapSet && mapSet() && mapSet().pts && mapSet().pts.length)`)) { loaded = true; break; }
  }
  if (!loaded) { console.log("\nFATAL 地图数据未就绪，后续段落无法进行"); process.exit(1); }
  await sleep(600);   /* 等一帧渲染 */

  /* ---------- B. 提示卡：定位与内容 ---------- */
  const B = await ev(`(function(){
    const tip = document.querySelector('#tip'), wrap = document.querySelector('.mapwrap');
    const wr = wrap.getBoundingClientRect();
    const probe = y => {
      MapMod.lastPx = { x: Math.round(document.querySelector('#map').clientWidth/2), y: y };
      tip.classList.remove('on'); MapMod.tipHtml = '';
      /* showMapTip 收的是 { lat, lon } 普通对象（由 llFrom() 转换），不是 TMap.LatLng ——
         桩实现的 LatLng 只有 lat/lng，传进去取不到 lon，nearestCity 会算出 NaN、
         提示卡直接早退，量出来是一张 20 px 高的空卡片。 */
      showMapTip({ lat: State.lat, lon: State.lon }, true);
      const tr = tip.getBoundingClientRect();
      /* 上、下两侧都要量：只判顶部会漏掉"翻到下方之后底部被裁"这一种 */
      return { y: y, h: Math.round(tr.height), topRel: Math.round(tr.top - wr.top),
               clipped: Math.max(0, Math.round(wr.top - tr.top)),
               clippedB: Math.max(0, Math.round(tr.bottom - wr.bottom)),
               below: tip.classList.contains('below'), on: tip.classList.contains('on') };
    };
    const t100 = probe(100), t300 = probe(300), t500 = probe(500);
    /* 提示卡里到底给了哪些行 —— 用它判断"有没有距查询点的距离/方位" */
    const labels = [...tip.querySelectorAll('.t3')].map(e => (e.querySelector('span')||{}).textContent||'');
    const t1 = (tip.querySelector('.t1')||{}).textContent || '';
    return { t100: t100, t300: t300, t500: t500, labels: labels, t1: t1, wrapH: Math.round(wr.height) };
  })()`);
  console.log("\n=== B. 悬停 / 点击提示卡 ===");
  console.log("  卡片高度 " + B.t100.h + " px · 容器高 " + B.wrapH + " px · 首行 " + JSON.stringify(B.t1));
  for (const t of [B.t100, B.t300, B.t500]) {
    console.log("  指针 y=" + String(t.y).padEnd(4) + " → 卡片顶边相对容器 " + String(t.topRel).padStart(5)
      + " px · " + (t.below ? "向下展开" : "向上展开")
      + " · 上方裁掉 " + t.clipped + " px · 下方裁掉 " + t.clippedB + " px");
  }
  console.log("  提示卡条目：" + JSON.stringify(B.labels));
  const hasDist = B.labels.some(s => /距离|方位/.test(s));
  console.log("  提示卡含「距离/方位」条目：" + (hasDist ? "有" : "无"));

  /* ---------- C. 排行榜：可点击性与口径 ---------- */
  const C = await ev(`(function(){
    const rows0 = [...document.querySelectorAll('#rank .rr')];
    const r0 = rows0[0];
    const st = r0 ? { cursor: getComputedStyle(r0).cursor, role: r0.getAttribute('role') || '',
                      tabindex: r0.getAttribute('tabindex') || '' } : {};
    const lat0 = State.lat, lon0 = State.lon;
    let clickable = false;
    if (r0) { r0.click(); clickable = (State.lat !== lat0 || State.lon !== lon0); }
    /* 给了 tabindex 就必须能用键盘触发，否则那是个假的入口 */
    const lat1 = State.lat, lon1 = State.lon;
    let kb = false;
    const rows1 = [...document.querySelectorAll('#rank .rr')];
    if (rows1[1]) {
      rows1[1].focus();
      rows1[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      kb = (State.lat !== lat1 || State.lon !== lon1);
    }
    return { n: rows0.length, clickable: clickable, kb: kb, cursor: st.cursor,
             role: st.role, tabindex: st.tabindex };
  })()`);
  console.log("\n=== C. 排行榜（前 8） ===");
  console.log("  行数 " + C.n + " · 鼠标点击触发跳转：" + (C.clickable ? "是" : "否")
    + " · 键盘 Enter 触发跳转：" + (C.kb ? "是" : "否")
    + " · cursor=" + C.cursor + " · role=" + JSON.stringify(C.role) + " · tabindex=" + JSON.stringify(C.tabindex));

  /* ---------- D. 「榜上有名、图上无影」的普遍性：沿海 + 边境城市扫描 ----------
     省界掩膜只裁 alpha、不动 RGB；而排行榜只按"有没有值"筛选，不看可见性。
     要量的就是这个差：**有值、但被掩膜裁掉**的点里，有多少进了前 8。 */
  const SWEEP = [
    ["广州市", 23.1291, 113.2644], ["上海市", 31.2304, 121.4737],
    ["青岛市", 36.0671, 120.3826], ["大连市", 38.9140, 121.6147],
    ["丹东市", 40.0006, 124.3556], ["三亚市", 18.2528, 109.5119],
    ["拉萨市", 29.6500, 91.1000], ["乌鲁木齐市", 43.8256, 87.6168]
  ];
  const sweep = [];
  for (const [nm, la, lo] of SWEEP) {
    await ev(`setLocation(${la}, ${lo}, ${JSON.stringify(nm)}, "")`);
    await ev(`(async()=>{ await loadMapData(true); })()`, true);
    let ok = false;
    for (let i = 0; i < 40; i++) {
      await sleep(600);
      /* 判据用"网格中心是否已跟到新地点"，别只看"有没有点集" ——
         旧地点的点集在换地点后仍会短暂存在，那样会把上一个城市的结果记到这一行。 */
      if (await ev(`(function(){ const c = MapMod.gridC; return !!(c && Math.abs(c.lat - ${la}) < 0.05
            && Math.abs(c.lon - ${lo}) < 0.05 && mapSet() && mapSet().pts.length); })()`)) { ok = true; break; }
    }
    if (!ok) { sweep.push({ name: nm, err: "未就绪" }); continue; }
    await sleep(500);
    const r = await ev(`(function(){
      const d = mapSet();
      const dim = State.mapDim || "mix", mk = State.mapModel || "ens";
      const withN = d.pts.filter(o => isNum(dimOf(o, dim, mk)));
      const a = p => { const q = sampleRaster(p.lat, p.lon); return q ? q[3] : null; };
      const dead = p => { const al = a(p); return al === null || al === 0; };
      /* ★ 可见性的正确判据是"图上这一格有没有像素"（alpha > 0），
         而**不是**"在不在中国省界内" —— 后者正是被放宽掉的那个旧掩膜口径。
         本探针第一版就是这么量错的：掩膜放宽生效后，同一行里被裁点的 alpha
         已经从 0 变成 208，它却还在报"三亚被裁掉 49 个"。 */
      const vis = withN.filter(p => !dead(p));
      const inCN = withN.filter(p => { try { return !!provOf(p.lat, p.lon); } catch (e) { return false; } });
      const hid = withN.filter(dead);
      const top8 = withN.slice().sort((a, b) => dimOf(b, dim, mk) - dimOf(a, dim, mk)).slice(0, 8);
      const hid8 = top8.filter(dead);
      /* 争议点的诊断：页面的 mapVisibleAt 读**栅格** img、探针读**画布**像素，
         两者在"边缘那一格"上会差 1 格（取整方式不同：round vs floor）。
         优先诊断**榜前 8 里**那个点 —— 那才是要判定的对象。 */
      const f = MapMod.field;
      const nbMax = (la, lo) => {
        if (!f || !f.img) return 0;
        const r = Math.round((f.laN - la) / f.dLa), c = Math.round((lo - f.loW) / f.dLo);
        let mx = 0;
        for (let rr = r - 1; rr <= r + 1; rr++) for (let cc = c - 1; cc <= c + 1; cc++) {
          if (rr < 0 || cc < 0 || rr >= f.rows || cc >= f.cols) continue;
          const v = f.img[(rr * f.cols + cc) * 4 + 3];
          if (v > mx) mx = v;
        }
        return mx;
      };
      /* ★ 真正的验收项：**榜单 DOM 里的每一行，图上都要看得见**。
         判据用"画布 alpha > 0 或栅格 3×3 邻域有像素" —— 容一格，因为
         round/floor 两种取整在边缘会差一格（这与 zoomprobe 量颜色时
         "比的是以该点为中心的一格邻域"是同一条纪律）。 */
      const domRows = [...document.querySelectorAll('#rank .rr')];
      const domBadList = domRows.filter(e => {
        const la = parseFloat(e.dataset.lat), lo = parseFloat(e.dataset.lon);
        if (!isNum(la) || !isNum(lo)) return true;
        const ca = a({ lat: la, lon: lo });
        if (ca !== null && ca > 0) return false;
        return nbMax(la, lo) <= 0;
      }).map(e => (e.querySelector('.nm') || {}).textContent || "?");
      const p = hid8[0] || hid[0];
      let diag = null;
      if (p) {
        diag = { name: p.name, la: p.lat, lo: p.lon, nb3: nbMax(p.lat, p.lon), canvas: a(p),
                 inTop8: hid8.indexOf(p) >= 0,
                 inDom: domRows.some(e => (e.querySelector('.nm') || {}).textContent === p.name),
                 pageSays: f ? mapVisibleAt(f, p.lat, p.lon) : null };
      }
      return { maskOn: cnMaskOn(), n: d.pts.length, withN: withN.length,
               vis: vis.length, inCN: inCN.length,
               hidden: hid.length, top8Hidden: hid8.length,
               domN: domRows.length, domBad: domBadList.length, domBadList: domBadList,
               hidAlpha: hid.length ? a(hid[0]) : null,
               visAlpha: vis.length ? a(vis[0]) : null,
               hidNames: hid8.map(p => p.name), diag: diag,
               rankDOM: [...document.querySelectorAll('#rank .rr .nm')].map(e => e.textContent) };
    })()`);
    sweep.push(Object.assign({ name: nm }, r));
  }
  console.log("\n=== D. 「榜上有名、图上无影」扫描（图面可见性 × 排行榜口径） ===");
  console.log("  城市         掩膜  网格  有值  图上可见  省界内  图上无影  被剔除  无影点alpha/可见点alpha");
  for (const r of sweep) {
    if (r.err) { console.log("  " + r.name.padEnd(11, " ") + r.err); continue; }
    console.log("  " + r.name.padEnd(11, " ") + String(r.maskOn).padEnd(6, " ")
      + String(r.n).padEnd(6, " ") + String(r.withN).padEnd(6, " ")
      + String(r.vis).padEnd(10, " ") + String(r.inCN).padEnd(8, " ")
      + String(r.hidden).padEnd(10, " ") + String(r.top8Hidden).padEnd(13, " ")
      + r.hidAlpha + " / " + r.visAlpha);
  }
  const okRows = sweep.filter(r => !r.err);
  const sum = k => okRows.reduce((a, r) => a + (r[k] || 0), 0);
  const D = {
    anyHidden: okRows.some(r => r.hidden > 0),
    worstTop8: okRows.length ? Math.max(...okRows.map(r => r.top8Hidden)) : 0,
    worstFrac: okRows.length ? Math.max(...okRows.map(r => r.hidden / Math.max(1, r.withN))) : 0,
    citiesWithHidden: okRows.filter(r => r.hidden > 0).length,
    cities: okRows.length,
    /* ★ 真正的验收项：榜单 DOM 里有没有"图上其实看不见"的行 */
    domBad: sum("domBad"),
    domN: sum("domN"),
    domBadList: okRows.reduce((a, r) => a.concat(r.domBadList || []), []),
    /* 放宽掩膜实际救回来的点数 ＝ 图上可见 − 省界内。
       这正是"同一个点在放宽前会被白裁掉"的数量，是 M1-1 甲的直接验收量。 */
    rescued: sum("vis") - sum("inCN"),
    visSum: sum("vis"), inCNSum: sum("inCN"), withN: sum("withN"),
    /* 按数值本会进前 8、但因为图上无影而被剔除的点 —— 这是**修复生效**的证据，
       不是缺陷。字段名别再叫 sample/"榜上却图上无影"，上一版就是这么把
       "修好了"读成"还没修"的。 */
    cut: (okRows.find(r => r.top8Hidden > 0) || {}).hidNames || []
  };
  console.log("  ⇒ " + D.citiesWithHidden + "/" + D.cities + " 个城市仍有图上无影的网格点；"
    + "单城市比例最高 " + Math.round(D.worstFrac * 100) + "%；被榜单剔除的「本会进前 8」点数最多 " + D.worstTop8 + " 个");
  console.log("  ⇒ 放宽掩膜救回：" + D.inCNSum + " → " + D.visSum + " 个可见点（共 " + D.withN
    + " 个有值点，Δ = " + D.rescued + "）");
  console.log("  ⇒ 榜单 DOM 共 " + D.domN + " 行，其中图上无影的 " + D.domBad + " 行"
    + (D.domBadList.length ? "：" + JSON.stringify(D.domBadList) : ""));
  if (D.cut.length) console.log("     被榜单剔除的点（按数值本会进前 8，图上无影）：" + JSON.stringify(D.cut));
  const dg = ((okRows.find(r => r.diag && r.top8Hidden > 0) || okRows.find(r => r.diag)) || {}).diag;
  if (dg) console.log("     诊断（" + dg.name + " @" + dg.la.toFixed(3) + "," + dg.lo.toFixed(3) + "）："
    + "栅格 3×3 邻域最大 alpha=" + dg.nb3 + " · 画布 alpha=" + dg.canvas
    + " · 页面判可见=" + dg.pageSays + " · 按数值本会进前 8=" + dg.inTop8
    + " · 实际在榜单 DOM=" + dg.inDom);

  /* ---------- D2. 现状核对：放宽后的掩膜到底保留了多少 ----------
     D 段已经把"图面可见点数"量成 8 个城市的真实像素；这里不再做"再放宽一倍"的
     加码反事实（那已经变成"改另一个常量"了，与本次要交付的状态无关），
     只直接核对当前掩膜位图的保留量，并顺带把实拍的城市选出来。 */
  const worstRow = okRows.length ? okRows.reduce((a, b) => (b.hidden > a.hidden ? b : a)) : null;
  const worstXY = worstRow ? (SWEEP.find(s => s[0] === worstRow.name) || []) : [];
  const D2 = await ev(`(function(){
    const g = GEOM_CACHE.geom;
    if (!g || !g.land) return { err: "几何无掩膜（cnMaskOn 未生效）" };
    let kept = 0;
    for (let i = 0; i < g.land.length; i++) if (g.land[i]) kept++;
    return { kept: kept, total: g.land.length, keepKm: MASK_KEEP_KM };
  })()`);
  console.log("\n=== D2. 掩膜现状（放宽后） ===");
  if (D2.err) console.log("  跳过：" + D2.err);
  else console.log("  MASK_KEEP_KM = " + D2.keepKm + " km ⇒ 保留 " + D2.kept + " / " + D2.total
    + " 格（" + Math.round(D2.kept / D2.total * 100) + "%）");
  /* 实拍的城市固定取**三亚**：它是最"靠海"的一个 —— 放宽掩膜前 86% 的网格点被裁、
     榜前 8 全部不可见，修复后既是"近海有色"的最直观证据，也是"方位线/距离环落在海上"
     的样本（日落方位朝西、西边 400 km 全是南海）。按 hidden 数取最大会挑到上海，
     那看不出什么。 */
  const shotCity = SWEEP.find(s => s[0] === "三亚市") || worstXY;
  /* ---------- E. 图例说明体量 ---------- */
  /* 第五轮 UI：图例长文默认收进 <details>（#legendFold），closed 的 details
     内容不渲染 ⇒ getBoundingClientRect().height 恒为 0。这段量的是"说明文字
     有多长"（它一直是地图卡片里最重的一块静态文字），所以先临时打开再量、
     量完还原 —— 不改变默认态（默认态由 uiprobe 守）。 */
  const E = await ev(`(function(){
    const det = document.getElementById('legendFold');
    const wasOpen = det ? det.open : null;
    if (det) det.open = true;
    const n = document.querySelector('#lgNote'), r = document.querySelector('#lgRows');
    const em = [...n.querySelectorAll('br')].length;
    const out = { chars: n.textContent.length, h: Math.round(n.getBoundingClientRect().height),
             br: em, fs: getComputedStyle(n).fontSize, lh: getComputedStyle(n).lineHeight,
             lgRows: r ? r.children.length : 0,
             cardH: Math.round(n.closest('.card').getBoundingClientRect().height) };
    if (det) det.open = !!wasOpen;
    return out;
  })()`);
  console.log("\n=== E. 图例与说明的体量 ===");
  console.log("  说明文字 " + E.chars + " 字符 / " + E.br + " 个换行 → 渲染高度 " + E.h + " px"
    + "（字号 " + E.fs + " 行高 " + E.lh + "）");
  console.log("  整张地图卡片高度 " + E.cardH + " px · 等级行 " + E.lgRows + " 条");

  /* ---------- F. 地图上有没有"方位/距离"参照 ---------- */
  const F = await ev(`(function(){
    const host = MapMod.host || document.querySelector('.mapwrap');
    const cls = [...host.querySelectorAll('*')].map(e => e.className).filter(c => typeof c === 'string');
    const hay = cls.join(' ');
    const lay = host.querySelector('.azilayer');
    const svg = lay ? lay.querySelector('svg') : null;
    const ml = host.querySelector('.mlayer');
    const z = el => (el ? Number(getComputedStyle(el).zIndex) : NaN);
    return { hasRing: /azilayer|azim|bearing|compass|ring|sector/i.test(hay),
             aziOn: !!(lay && lay.classList.contains('on')),
             aziZ: z(lay), confZ: z(host.querySelector('.conflayer')), mlZ: z(ml),
             paths: svg ? svg.querySelectorAll('path').length : 0,
             lines: svg ? svg.querySelectorAll('line').length : 0,
             texts: svg ? [...svg.querySelectorAll('text')].map(t => t.textContent) : [],
             hasCross: /cross|axis|grat/i.test(hay),
             layerNames: [...new Set(cls)].filter(c => c && !c.startsWith('pin')).slice(0, 24) };
  })()`);
  console.log("\n=== F. 地图上的方位 / 距离参照 ===");
  console.log("  存在方位/距离环图层：" + (F.hasRing ? "有" : "无") + "（.on=" + F.aziOn + "）"
    + " · 环 " + F.paths + " 条 · 方位线 " + F.lines + " 条");
  console.log("  环上的文字：" + JSON.stringify(F.texts));
  console.log("  图层次序：色面 1 / 可信度纱 " + F.confZ + " / 方位环 " + F.aziZ + " / 数值直标 " + F.mlZ);
  console.log("  .mapwrap 内层类名：" + JSON.stringify(F.layerNames));

  /* ---------- G. 掩膜对用户是否可见 ----------
     被裁掉的那一片，用户看到的只是"什么都没有" —— 与"没有数据"完全无法区分。
     三亚这类城市地图近乎空白，而页面上没有任何一句话解释这件事。 */
  const G = await ev(`(function(){
    const card = document.querySelector('.mapwrap').closest('.card');
    const t = card ? card.innerText : "";
    return { mentionsMask: /境外|国境|省界|掩膜|裁剪|裁掉/.test(t),
             textLen: t.length, mapH: Math.round(document.getElementById('map').getBoundingClientRect().height) };
  })()`);
  console.log("\n=== G. 掩膜在界面上是否可解释 ===");
  console.log("  地图卡片内出现「境外/国境/省界/掩膜」字样：" + (G.mentionsMask ? "是" : "否")
    + "（卡片文字共 " + G.textLen + " 字符）");

  /* ---------- H. 「用 ETOPO1 高程判海」这条路走不走得通 ----------
     放宽掩膜的另一种实现是"凡是高程 < 0 的格子都算海、都保留"。
     产物里已经有 ETOPO1 0.5° 栅格（elevAt，零网络），看起来免费 ——
     但它同时对**低于海平面的陆地**与**近岸混合像元**敏感。
     拿已知点打一遍，用实测而不是推理来决定。 */
  const H = await ev(`(function(){
    var P = [["上海·人民广场",31.23,121.47,4],["上海·外海 60km",31.23,122.13,-40],
             ["天津·市区",39.13,117.20,5],["南海·外海",18.25,111.50,-1500],
             ["三亚·市区",18.25,109.51,8],["珠江口外 80km",21.60,113.60,-60],
             ["吐鲁番盆地",42.95,89.19,-155],["蒙古·戈壁",46.00,105.00,1200],
             ["舟山群岛",30.00,122.20,10],["舟山外海 50km",30.00,122.75,-30]];
    return P.map(function(p){
      var e = elevAt(p[1], p[2]);
      return { n: p[0], lat: p[1], lon: p[2], real: p[3], elev: isNum(e) ? Math.round(e) : null };
    });
  })()`);
  console.log("\n=== H. ETOPO1（0.5°）能不能当海陆判据 ===");
  console.log("  已知点            实测高程     真实大致高程    elev<0 判为海");
  let seaAsLand = 0, landAsSea = 0;
  for (const h of H) {
    const isSea = h.real < 0;
    if (h.elev === null) { console.log("  " + h.n.padEnd(16, " ") + "越界"); continue; }
    const verdict = h.elev < 0;
    const bad = verdict !== isSea;
    if (bad) { if (isSea) seaAsLand++; else landAsSea++; }
    console.log("  " + h.n.padEnd(16, " ") + String(h.elev).padStart(7, " ") + " m"
      + String(h.real).padStart(12, " ") + " m        " + (verdict ? "是" : "否")
      + (bad ? "   ← 判错（" + (isSea ? "真海判成陆" : "真陆判成海") + "）" : ""));
  }
  console.log("  ⇒ 判错 " + (seaAsLand + landAsSea) + "/" + H.length + " 点："
    + "真海判成陆 " + seaAsLand + " 个（后果=仍然被裁，放宽失效）；"
    + "真陆判成海 " + landAsSea + " 个（后果=多显示，无害）");

  /* ---------- I. 等值线 + 经纬网 ----------
     等值线是**独立图层**（不进色面栅格）：色面像素与数值的单值映射必须原样保留
     —— zoomprobe 的像素级断言守的就是它。所以这里正面验证"色面一个像素都没被动过"：
       · **不透明区（alpha ≥ 200）的每个像素都必须等于某个档位色（±2）**。
         （阈值 2 是给 canvas 预乘往返的取整误差留的；200 取在羽化带之上。）
     等值线本身是**矢量**（屏幕空间描边，见 drawContours），验三件事：
       · **画布＝容器分辨率** ⇒ 线宽不随缩放变化。这是"变细"能成立的结构前提：
         栅格时代线宽绑在栅格上，放大 4 倍线就粗 4 倍。
       · **墨迹不悬空** —— 线的每一处都必须落在色面真的上过色的地方。
       · **可见宽度 = 墨迹覆盖面积 ÷ 折线总长**（单位 CSS 像素）。
         这个量才与线方向无关：水平行程在竖线上量得准、在横线上就是无穷大。
     探针自己重建投影（读 DOM 的 getBoundingClientRect，不读实现里的 rect），
     顺带把"线到底画在屏幕哪个位置"这件事也验了一遍。
     经纬网要求间距恒为 1°：相邻两条纬度标注之差只能有一种取值。 */
  const I = await ev(`(function(){
    var out = {};
    var gl = document.querySelector('.clayer');
    var rl = document.querySelector('.rlayer'), cf = document.querySelector('.conflayer');
    var z = function(el){ return el ? Number(getComputedStyle(el).zIndex) : NaN; };
    out.hasLayer = !!gl;
    out.on = gl ? gl.classList.contains('on') : false;
    out.z = z(gl); out.rlZ = z(rl); out.confZ = z(cf);
    out.colorN = (MapMod.strips || []).length;
    out.nBands = N_BANDS;
    var perStr = (mapSet() && mapSet().period) || State.mapPeriod || 'pm';
    var pal = [];
    for (var kk = 0; kk < N_BANDS; kk++) pal.push(hex2rgb(rampColor(perStr, (kk + 0.5) / N_BANDS * 100)));

    /* ---- 色面：不透明区必须只有分档色（等值线一个像素都不许混进去） ---- */
    var cpix = 0, offPal = 0, opaque = 0, i, q, t;
    var strips = MapMod.strips || [], A = [];
    for (i = 0; i < strips.length; i++) {
      var cs = strips[i];
      var d = cs.ctx.getImageData(0, 0, cs.cv.width, cs.cv.height).data;
      A.push(d);
      for (q = 3; q < d.length; q += 4) {
        if (!d[q]) continue;
        cpix++;
        if (d[q] < 200) continue;
        opaque++;
        var best = 1e9;
        for (t = 0; t < pal.length; t++) {
          var e = Math.max(Math.abs(d[q-3]-pal[t][0]), Math.abs(d[q-2]-pal[t][1]),
                           Math.abs(d[q-1]-pal[t][2]));
          if (e < best) best = e;
        }
        if (best > 2) offPal++;
      }
    }
    out.colorPix = cpix; out.opaquePix = opaque; out.offPalette = offPal;
    var bnd = MapMod.field.band, rowsF = MapMod.field.rows;
    var cols = MapMod.field.cols, n = 0, alMax = 0;
    var fimg = MapMod.field.img;
    for (var m = 0; m < bnd.length; m++) {
      if (bnd[m] >= 0) n++;
      var av = fimg[m * 4 + 3];
      if (av > alMax) alMax = av;
    }
    out.bandCells = n; out.alMax = alMax;
    /* "色面完全不透明"的阈值取**实测峰值 − 2**，不写死 255：
       海陆掩膜边缘被 boxBlur 抹过，整张色面的 alpha 峰值只有 230 左右
       （实测 230），写死 255/250 会一格都取不到。−2 是为了落在同一个描边档位里。 */
    var AOP = Math.max(1, alMax - 2);
    var perRow = Math.max(1, Math.round(FIELD_BAND_DEG / MapMod.field.dLa));

    /* ---- 等值线：几何 + 画布 ---- */
    var geo = MapMod.contGeo;
    out.contN = geo ? geo.n : 0;
    var cv = MapMod.contCv, host = MapMod.host;
    var dpr = Math.min(3, window.devicePixelRatio || 1);
    out.dpr = dpr;
    out.hostW = host ? host.clientWidth : 0;
    out.hostH = host ? host.clientHeight : 0;
    out.cvW = cv ? cv.width : 0;
    out.cvH = cv ? cv.height : 0;
    /* 投影自己重建：用条带**实测**的 DOM 矩形，不读实现里的 rect */
    var hr = host ? host.getBoundingClientRect() : null;
    var R = [];
    for (i = 0; i < strips.length; i++) {
      var r = strips[i].cv.getBoundingClientRect();
      var hs = strips[i].cv.height;
      R.push((hr && r.width > 0 && r.height > 0 && hs > 0)
        ? { x: r.left - hr.left, ty: r.top - hr.top, w: r.width, h: r.height,
            r0: strips[i].r0 || 0, h0: hs }
        : null);
    }
    /* 只统计**色面完全不透明**的那部分折线。两个理由：
       · 色面栅格的包围盒常比视口大，画布外的段被裁掉、没有墨迹，长度却照样算得进去
         ⇒ 会把"覆盖面积 ÷ 总长"系统性压低；
       · 线的 alpha 是"墨色浓度"（≈0.67）而不是几何覆盖率，直接拿 alpha/255 当面积
         会再矮一截。只在色面 alpha = 255 的区间里量，描边就落在**同一个档位**上，
         用该区间的实测峰值 alpha 归一后，比值才等于真正的几何宽度。
       （两者都会把 1 px 的线量成 0.60 px —— 这就是要绕开的坑。） */
    var pathLen = 0, pathAll = 0;
    if (geo) {
      for (var s = 0; s < geo.n; s++) {
        var o = s * 4;
        var rc = R[Math.floor(Math.floor(geo.seg[o+1]) / perRow)];
        if (!rc) continue;
        var kx = rc.w / cols, ky = rc.h / rc.h0, yb = rc.ty - rc.r0 * ky;
        var ax = geo.seg[o] * kx, ay = yb + geo.seg[o+1] * ky;
        var ex = geo.seg[o+2] * kx, ey = yb + geo.seg[o+3] * ky;
        var L = Math.sqrt((ex-ax)*(ex-ax) + (ey-ay)*(ey-ay));
        pathAll += L;
        if (geo.al[s] >= AOP) pathLen += L;
      }
    }
    out.pathLen = pathLen; out.pathAll = pathAll;

    /* ---- B1：数据范围边界线（凸包虚线）
       只做**结构性**检查：线得把凸包的每个顶点都连上（edgePts 是 drawDataEdge
       自己的计数，所以顺带验了"实现真的把所有顶点投影成功了"）。
       **"不悬空"不在这里单独量** —— 实现是按色面 alpha 沿边裁断后才画的，
       而上面那条"等值线墨迹不悬空"读的就是同一块画布，它已经是端到端的证明：
       只要 B1 画出哪怕一像素浮在没上色的地方，那条断言就会红。
       顶点数**不能硬编码**：去共线后几何是正八边形（顶点 (±4,±1)(±1,±4)，
       内角 135°，长边 509 km、短边 240 km），但长边上的网格点（如 (3,2)、(2,3)）
       与长边**严格共线**，单调链是否弹掉它们只看浮点噪声；何况 ok[] 还随
       当前模型的数据可用性变化 —— 实测同一份代码在 8 / 10 / 12 之间浮动，
       画出来却是同一条八边形。所以只比"已连 == 凸包顶点数"。 */
    var hull = (GEOM_CACHE.geom && GEOM_CACHE.geom.hud) || null;
    var hll = hull && hull.latlng;
    out.hullN = hll ? hll.length / 2 : 0;
    out.edgePts = MapMod.edgePts;
    out.edgeIn = MapMod.edgeIn;

    /* ---- 墨迹 ---- */
    var contPix = 0, ink = 0, susp = 0;
    if (cv && host && hr && cv.width > 0) {
      var W = cv.width, H = cv.height;
      var D = cv.getContext('2d').getImageData(0, 0, W, H).data;
      for (var Y = 0; Y < H; Y++) {
        var cy = Y / dpr;
        for (var X = 0; X < W; X++) {
          var al = D[(Y * W + X) * 4 + 3];
          if (!al) continue;
          /* 把这个点落到色面上（容器像素 → 条带局部像素），拿到该处的色面 alpha */
          var cx = X / dpr, ca = -1;
          for (var ii = 0; ii < R.length; ii++) {
            var rr = R[ii];
            if (!rr) continue;
            if (cx < rr.x || cx > rr.x + rr.w || cy < rr.ty || cy > rr.ty + rr.h) continue;
            var lx = Math.floor((cx - rr.x) / rr.w * cols);
            var ly = Math.floor((cy - rr.ty) / rr.h * rr.h0);
            lx = lx < 0 ? 0 : (lx > cols - 1 ? cols - 1 : lx);
            ly = ly < 0 ? 0 : (ly > rr.h0 - 1 ? rr.h0 - 1 : ly);
            ca = A[ii][(ly * cols + lx) * 4 + 3];
            break;
          }
          /* 悬空判据：线不许画在色面没上色的地方（掩膜外、羽化尽头） */
          if (al >= 64 && !(ca > 0)) susp++;
          if (ca < AOP) continue;                  // 只在色面全不透明的区间里量宽度
          contPix++; ink += al;
        }
      }
    }
    /* 标尺：**完全被覆盖**的一个像素该有多大 alpha。
       描边按色面 alpha 分 16 档、取档中点（见 drawContours），色面全不透明的格子
       落在同一个档上，所以参考 alpha = round(CONT_ALPHA × (档 + 0.5) / 16)。
       用 Σalpha ÷ 参考 alpha 就还原出**几何覆盖面积** —— 于是量到的是几何宽度，
       与墨色深浅无关（改 CONT_ALPHA 不会让宽度读数变，改 CONT_PX / 线宽才会）。
       为什么不用 max(alpha) 当标尺：不同档位的线在交叉处会 alpha 合成（156 压 156
       → 216），少数交叉点就能把峰值抬高，把 1 px 的线量成 0.82 px。
       为什么不用直方图峰：dpr=1 时一条斜线的大多数像素只被**部分**覆盖，
       alpha 分布是弥散的，根本没有"峰"可取。 */
    var bAOP = (AOP * 16) >> 8;
    var fullA = Math.max(1, Math.round(CONT_ALPHA * (bAOP + 0.5) / 16));
    out.contPix = contPix; out.suspended = susp; out.amax = fullA;
    /* 几何覆盖面积 = Σ(alpha) / 峰值 alpha（单位仍是设备像素²）→ 换算成 CSS 像素²，
       再除以折线总长 ⇒ 宽度。与线方向无关，也不受"墨色浓度"影响。 */
    out.inkArea = (ink / fullA) / (dpr * dpr);
    out.inkW = pathLen > 0 ? out.inkArea / pathLen : null;
    var svg = gl ? gl.querySelector('svg') : null;
    var txt = svg ? [].slice.call(svg.querySelectorAll('text')).map(function(t){ return t.textContent; }) : [];
    out.gratLines = svg ? svg.querySelectorAll('line').length : 0;
    out.gratTexts = txt.length;
    out.gratDeg = (typeof GRAT_DEG === 'number') ? GRAT_DEG : null;
    out.gratStep = (function(){
      var a = txt.filter(function(s){ return /N$/.test(s); })
                   .map(function(s){ return parseInt(s, 10); })
                   .filter(function(v){ return !isNaN(v); })
                   .sort(function(x, y){ return x - y; });
      if (a.length < 3) return NaN;
      var dd = {}; for (var k2 = 1; k2 < a.length; k2++) dd[a[k2] - a[k2 - 1]] = 1;
      return Object.keys(dd).length;
    })();
    return out;
  })()`);
  console.log("\n=== I. 等值线 + 经纬网（第 10 批：矢量描边）===");
  console.log("  等值线层：" + (I.hasLayer ? "有" : "无") + "（.on=" + I.on + " · z=" + I.z
    + "，色面 " + I.rlZ + " / 可信度纱 " + I.confZ + "）· 折线 " + I.contN + " 段"
    + " · 总长 " + I.pathLen.toFixed(0) + " px（色面 " + I.colorN + " 条带）");
  console.log("  画布：" + I.cvW + "×" + I.cvH + " 设备像素 ＝ 容器 " + I.hostW + "×" + I.hostH
    + " × dpr " + I.dpr + " ⇒ " + (I.cvW === Math.round(I.hostW * I.dpr)
      && I.cvH === Math.round(I.hostH * I.dpr) ? "**随容器走，与缩放无关**" : "尺寸对不上"));
  console.log("  墨迹 " + I.contPix + " 像素（色面全不透明区）· 几何覆盖 " + I.inkArea.toFixed(0) + " px²"
    + " ⇒ **可见宽 " + (I.inkW == null ? "?" : I.inkW.toFixed(2)) + " px**"
    + "（＝覆盖面积 ÷ 折线总长 " + I.pathLen.toFixed(0) + " px，与线方向无关）"
    + " · 悬空 " + I.suspended + " 处");
  console.log("  色面不透明像素 " + I.opaquePix + " 中**不在 " + I.nBands + " 个档位色"
    + "（±2）上**的：" + I.offPalette + "（0 ⇒ 等值线一个像素都没混进色面）");
  console.log("  色面有 alpha 的格子 " + I.colorPix + " ≤ 有档位的格子 " + I.bandCells
    + "（掩膜只会减，不会增） · 色面 alpha 峰值 " + I.alMax);
  console.log("  经纬网：" + I.gratLines + " 条线 · " + I.gratTexts + " 个标注 · 间距 "
    + I.gratDeg + "° → 相邻纬度标注之差的取值种数 " + I.gratStep + "（1 ＝ 严格等距）");
  console.log("  数据范围边界线（B1）：凸包顶点 " + I.hullN + " → 已连 " + I.edgePts
    + "（须相等；顶点数随浮点噪声在 8/10/12 间浮动，几何都是同一八边形）"
    + " · 落在色面有像素处的采样点 " + I.edgeIn + "（掩膜裁断后真正画出来的部分）");

  /* ---------- J. C1 经纬网开关 + C2 可信度纱的边界 ----------
     C1： gratOn 曾经兼两职（"网画了没"的派生位 + gridOn() 读的图层可见性），
     所以加用户开关时**必须先拆开**。这里钉的是拆开之后仍然成立的三件事：
       ① 关掉后那张 SVG **真的隐藏** —— 不能只靠 .clayer 的 .on，因为等值线还在的
          时候整层不会被关掉（.on 的语义是"等值线或经纬网有其一即显示"）；
       ② 关掉经纬网**不影响等值线**（层仍 .on、折线还在）；
       ③ 再打开能完全恢复（签名要失效，否则视野没动时会卡在 none 上回不来）。
     C2： 纱的边界改为**凸包外**（与色面淡出边界、B1 那条虚线同一条）。断言是
          "纱的覆盖格数逐格等于「色面有像素 ∧ 凸包外」"，即"起纱 ≡ 淡出 ≡ 外推"
          这条不变量。判据为什么不能是"距最近采样点 > FIELD_FULL"见输出里的数。 */
  const J = await ev(`(function(){
    var out = {};
    var cb = document.getElementById('showGrid');
    out.hasCtl = !!cb;
    var layer = MapMod.gridLayer, svg = MapMod.gridSvg;
    out.gratOnBefore = !!MapMod.gratOn;
    out.layOnBefore = layer ? layer.classList.contains('on') : null;
    out.gratLines = svg ? svg.querySelectorAll('line').length : 0;
    if (cb) {
      cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true }));
      out.dispOff = svg ? svg.style.display : null;
      out.gratOnOff = !!MapMod.gratOn;
      out.layOnOff = layer ? layer.classList.contains('on') : null;
      cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
      out.dispOn = svg ? svg.style.display : null;
      out.gratOnBack = !!MapMod.gratOn;
    }
    out.contN = (MapMod.contGeo && MapMod.contGeo.n) || 0;

    var f = MapMod.field, hud = GEOM_CACHE.geom && GEOM_CACHE.geom.hud;
    var H = hud ? hud.edges : null;
    var want = 0, painted = 0, inside = 0, dkmOver = 0;
    if (f && H) {
      for (var r = 0; r < f.rows; r++) {
        var Y = ((f.laN - r * f.dLa) - hud.olat) * 110.574;
        for (var c = 0; c < f.cols; c++) {
          var o = r * f.cols + c;
          if (f.img[o * 4 + 3] === 0) continue;
          painted++;
          var X = (f.loW + c * f.dLo - hud.olon) * hud.kx;
          var sd = -1e9;
          for (var k = 0; k < H.length; k += 3) {
            var d = H[k] * X + H[k + 1] * Y + H[k + 2];
            if (d > sd) sd = d;
          }
          if (sd > 0) want++; else inside++;
          if (f.dkm[o] > FIELD_FULL) dkmOver++;
        }
      }
    }
    var got = 0;
    var cs = MapMod.confStrips || [];
    for (var i = 0; i < cs.length; i++) {
      var dd = cs[i].ctx.getImageData(0, 0, cs[i].cv.width, cs[i].cv.height).data;
      for (var q = 3; q < dd.length; q += 4) if (dd[q] > 0) got++;
    }
    out.veilWant = want; out.veilGot = got; out.painted = painted; out.hullInside = inside;
    out.dkmOver = dkmOver;
    return out;
  })()`);
  console.log("\n=== J. C1 经纬网开关 + C2 可信度纱边界 ===");
  console.log("  开关：" + (J.hasCtl ? "有 #showGrid" : "**没有**") + " · 默认 gratOn=" + J.gratOnBefore
    + " · 网格线 " + J.gratLines + " 条");
  console.log("  关掉后：SVG display=" + JSON.stringify(J.dispOff) + "（须 \"none\"）· gratOn=" + J.gratOnOff
    + "（须 false）· .clayer 仍 .on=" + J.layOnOff + " · 等值线折线 " + J.contN + " 段（须 >0，不受影响）");
  console.log("  再打开：SVG display=" + JSON.stringify(J.dispOn) + "（须非 none）· gratOn=" + J.gratOnBack);
  console.log("  可信度纱：实测覆盖 " + J.veilGot + " 格 ＝ 期望（色面有像素 ∧ 凸包外）" + J.veilWant
    + " 格 · 已上色 " + J.painted + " 格 ⇒ 覆盖 " + (100 * J.veilGot / Math.max(1, J.painted)).toFixed(2)
    + "%（包内 " + J.hullInside + " 格不纱）");
  console.log("  对照：旧判据「dkm > FIELD_FULL」只命中 " + J.dkmOver + " 格 ＝ "
    + (100 * J.dkmOver / Math.max(1, J.painted)).toFixed(2)     + "% —— 这就是它形同没起作用的原因");

  try {
    await ev(`setLocation(${shotCity[1]}, ${shotCity[2]}, ${JSON.stringify(shotCity[0])}, "")`);
    await ev(`(async()=>{ await loadMapData(true); })()`, true);
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      if (await ev(`(function(){ const c = MapMod.gridC; return !!(c && Math.abs(c.lat - ${shotCity[1]}) < 0.05
            && Math.abs(c.lon - ${shotCity[2]}) < 0.05 && mapSet() && mapSet().pts.length); })()`)) break;
    }
    await sleep(400);

  /* 实拍留证（改后）：① 三亚的近海色面 + 方位环/距离环 ② 提示卡翻到下方后完整可见。
     与之配对的是改动前那两张：audit-map-before.png（三亚，南海一片空白、无方位环）、
     audit-tip-before.png（卡片上半部分被容器上沿裁掉 178 px）。
     两两并排就是最直观的交付证据。
     改前那两张由 `_backup/第七批前/` 的源码构建后用一次性脚本抓取（该脚本已删）——
     别用当前构建重跑，那会把"改前"覆盖成"改后"。 */
  try {
    const shotOf = async (name) => {
      const r = await ev(`(function(){ const b = document.querySelector('.mapwrap').getBoundingClientRect();
        return { x: Math.round(b.x + window.scrollX), y: Math.round(b.y + window.scrollY),
                 width: Math.round(b.width), height: Math.round(b.height) }; })()`);
      const s = await cdp.send("Page.captureScreenshot", {
        format: "png", captureBeyondViewport: true,
        clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 2 }
      });
      fs.writeFileSync(path.join(ROOT, "_check", name), Buffer.from(s.data, "base64"));
      return r;
    };
    await ev(`(function(){ document.getElementById('tip').classList.remove('on'); window.scrollTo(0, 0); })()`);
    await sleep(250);
    await shotOf("audit-map-nearshore.png");
    /* 再拍一张"提示卡被裁"：把指针放到容器顶部，用与页面同一条路径展示提示卡
       （点击态，所以必须传普通对象 {lat,lon}，不是 TMap.LatLng） */
    await ev(`(function(){
      const b = document.querySelector('.mapwrap').getBoundingClientRect();
      MapMod.lastPx = { x: Math.round(b.width / 2), y: 100 };
      window.scrollTo(0, Math.round(b.top + window.scrollY - 60));
    })()`);
    await sleep(200);
    await ev(`showMapTip({ lat: State.lat, lon: State.lon }, true)`);
    await sleep(300);
    await shotOf("audit-tip-below.png");
    await ev(`document.getElementById('tip').classList.remove('on')`);
    console.log("  实拍（改后）：_check/audit-map-nearshore.png · _check/audit-tip-below.png（查询点="
      + shotCity[0] + "）；配对的是改前的 audit-map-before.png · audit-tip-before.png");
  } catch (e) {
    console.log("  实拍失败（不影响其余结论）：" + e.message);
  }
  } catch (e) {
    /* 外层 try（切到三亚 + 等地图就绪）。截不到图只是"少一张证据"，
       不该把整轮审计拖成 FATAL —— 后面的断言仍然要跑完。 */
    console.log("  实拍准备失败（不影响其余结论）：" + e.message);
  }

  /* ---------- 汇总 ----------
     逐条具名，别串成一个巨型 && —— 挂了只知道"未通过"，不知道是哪一条。
     这里的"期望值"就是改进方案要达成的状态；落地后本探针应当转绿。 */
  const checks = {
    "复选框不被撑成下拉框宽度": A.chks.every(c => c.inputW <= 24),
    "复选框被撑宽的宽度不超过卡片 20%": A.overSum / A.cardW <= 0.2,
    "提示卡上下都不被裁": [B.t100, B.t300, B.t500].every(t => t.clipped === 0 && t.clippedB === 0),
    "提示卡给出距查询点的距离/方位": hasDist,
    "排行榜行可点击跳转": C.clickable === true,
    "排行榜行可用键盘触发": C.kb === true,
    "榜单 DOM 里没有图上无影的行": D.domBad === 0,
    "图上无影的点不超过 10%": D.worstFrac <= 0.10,
    "掩膜放宽确实救回了点": D.rescued > 0,
    "掩膜在界面上可解释": G.mentionsMask === true,
    "方位/距离环有内容": F.aziOn && F.paths >= 1 && F.lines >= 1,
    "方位环在色面之上、数值直标之下": F.aziZ > 1 && F.aziZ < F.mlZ,
    /* 等值线：8 条。前两条是结构，第 3 条是"细"能成立的前提，第 4/5 条是"细且干净"。 */
    "等值线层有内容（抽出了档位边界折线）": I.hasLayer && I.on === true && I.contN > 0 && I.pathLen > 0,
    "等值线在色面之上、可信度纱之下": I.z > I.rlZ && I.z < I.confZ,
    /* 栅格时代的线宽绑在栅格上 ⇒ 放大 4 倍线就粗 4 倍，这是用户连说两次"还粗"的根因。
       画布跟着容器走之后线宽是屏幕常数，这条是那个解法的**结构前提**，必须正面守住。 */
    "等值线画布＝容器分辨率（线宽与缩放解耦）":
      I.cvW === Math.max(1, Math.round(I.hostW * I.dpr))
      && I.cvH === Math.max(1, Math.round(I.hostH * I.dpr)),
    /* 线不许画在色面没上色的地方（掩膜外、羽化尽头）—— 否则就是一撮浮在空处的黑线 */
    "等值线墨迹不悬空（只落在色面上过色的地方）": I.contPix > 0 && I.suspended === 0,
    /* 可见宽度 = 墨迹覆盖面积 ÷ 折线总长。1 px 的描边落在 1.0 附近；
       区间给到 [0.6, 1.6] 是留给"斜线的抗锯齿把墨摊到两个像素"的。 */
    "等值线的可见宽度约为一个屏幕像素": I.inkW != null && I.inkW >= 0.6 && I.inkW <= 1.6,
    "色面不透明区只有分档色（等值线没混进去）": I.opaquePix > 0 && I.offPalette === 0,
    "色面可见格数不超过有档位的格数": I.colorPix > 0 && I.colorPix <= I.bandCells,
    "经纬网有内容且间距恒定": I.gratLines >= 4 && I.gratTexts >= 4 && I.gratStep === 1,
    /* B1：数据范围边界线。顶点数不硬编码（浮点噪声 + ok[] 随模型变 ⇒ 实测 8/10/12），
       只要求"凸包有几个顶点就连几个"，且真的画出了一段。
       "不悬空"由上面那条等值线墨迹断言统一守着（同一块画布）。 */
    "数据范围边界线与凸包顶点数一致": I.hullN >= 3 && I.edgePts === I.hullN,
    "数据范围边界线仍画出了一段（没被掩膜整圈裁掉）": I.edgeIn > 0,
    /* C1：三条分别钉三种失效模式 —— 开关不存在 / 关不掉 / 关掉连累等值线 / 开不回来 */
    "经纬网开关存在且默认是开的": J.hasCtl === true && J.gratOnBefore === true && J.gratLines >= 4,
    "关掉经纬网：SVG 隐藏，但等值线不受影响":
      J.dispOff === "none" && J.gratOnOff === false && J.layOnOff === true && J.contN > 0,
    "重新打开经纬网能完全恢复": J.gratOnBack === true && J.dispOn !== "none",
    /* C2：起纱 ≡ 淡出 ≡ 外推。判据是凸包外，不是"距最近采样点 > 阈值"。 */
    "可信度纱覆盖＝凸包外（起纱≡淡出≡外推）": J.veilWant > 0 && J.veilWant === J.veilGot,
  };
  const bad = Object.keys(checks).filter(k => !checks[k]);
  console.log("\n" + "-".repeat(74));
  /* 结论行必须能被动 all.py 的 judge() 解析：失败走「失败 N 项」，成功走「PASS N」。
     两者都是 all.py 已认的模式 —— 只靠退出码也能判，但那样总表里只会写"无断言计数"。 */
  console.log("  审计结论：" + (bad.length
    ? ("失败 " + bad.length + " 项")
    : ("全部符合预期 · PASS " + Object.keys(checks).length)));
  console.log('FACTS {"assertions":' + Object.keys(checks).length + ',"fail":' + bad.length + '}');
  bad.forEach(k => console.log("    ✗ " + k));
  console.log("  控制台错误 " + errs.length + " 条" + (errs.length ? "：" + errs.slice(0, 5).join(" | ") : ""));
  console.log("-".repeat(74));

  try { chrome.kill(); } catch (e) { }
  srv.close();
  /* 失败必须反映到退出码上。同样的教训在 cdp.js / run_self.py / cachesize.js 上
     各踩过一次：恒 exit 0 时，漏解析 stdout 的调用方会把失败当成功。 */
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
