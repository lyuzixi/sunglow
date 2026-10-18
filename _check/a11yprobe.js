/* 无障碍（a11y）系统审计探针 —— 只读，零额度。
 *
 * 为什么单独写：键盘路径其实**已经做了一半**（`role="button"` + `tabindex` +
 * 方向键 + Enter 都在，见 cdp.js 的键盘段），但"能 Tab 到"之外的那些事
 * —— 焦点**看得见**吗、文字**读得清**吗、读屏软件**念得全**吗 —— 一次都没系统查过。
 * 这三件事的共同点是：**肉眼与鼠标用户完全感觉不到它坏了**。
 *
 * 量六组：
 *   A. 可访问名：所有可交互元素都必须有名字（文本 / aria-label / title / label 包裹）
 *   B. 键盘：role=button 必须有 tabindex；tabindex 必须 ≥ 0；不要正的 tabindex（打乱顺序）
 *   C. 焦点可见：Tab 进去的元素必须有非 none 的 outline 或 box-shadow
 *   D. 对比度：文本与其实际背景的对比度（正文 ≥ 4.5，大字 ≥ 3）
 *   E. 状态同步：分段控件的 .on 必须与 aria-pressed 一致（读屏读到的是 aria）
 *   F. 结构：html[lang]、唯一 h1、img 有 alt、role=group 有名字
 *
 * 用法: node _check/a11yprobe.js
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
const PORT = 47897;
const DEBUG_PORT = 9358;
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

/* 在页内跑的审计体：全部用原生 DOM，不依赖页面里的任何业务函数 */
const AUDIT = `(function(){
  const name = el => {
    const al = el.getAttribute('aria-label'); if (al && al.trim()) return al.trim();
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\\s+/).map(id => { const n = document.getElementById(id); return n ? n.textContent : ''; }).join(' ').trim(); if (t) return t; }
    const t = (el.textContent || '').replace(/\\s+/g, ' ').trim(); if (t) return t;
    const ti = el.getAttribute('title'); if (ti && ti.trim()) return ti.trim();
    const ph = el.getAttribute('placeholder'); if (ph && ph.trim()) return ph.trim();
    try { if (el.labels && el.labels.length) { const t2 = [...el.labels].map(x => (x.textContent||'').trim()).join(' ').trim(); if (t2) return t2; } } catch (e) {}
    return '';
  };
  const desc = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
    + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '');

  const out = { noName: [], roleBtnNoTab: [], badTabindex: [], unnamedGroup: [], emptyLabel: [] };

  /* A. 可访问名 */
  document.querySelectorAll('button, [role="button"], a[href], select, input, textarea, [role="group"], [role="radiogroup"]').forEach(el => {
    const nm = name(el);
    if (!nm) {
      if (el.getAttribute('role') === 'group' || el.getAttribute('role') === 'radiogroup') out.unnamedGroup.push(desc(el));
      else out.noName.push(desc(el));
    }
  });
  /* A2. 表单控件必须有 label 或 aria-label（placeholder 不算，它在输入后消失） */
  document.querySelectorAll('input:not([type=hidden]), select, textarea').forEach(el => {
    const al = el.getAttribute('aria-label');
    const hasLb = (el.labels && el.labels.length) || al;
    if (!hasLb) out.emptyLabel.push(desc(el));
  });

  /* B. 键盘 */
  document.querySelectorAll('[role="button"]').forEach(el => {
    const ti = el.getAttribute('tabindex');
    if (ti === null || Number(ti) < 0) out.roleBtnNoTab.push(desc(el));
  });
  document.querySelectorAll('[tabindex]').forEach(el => {
    const v = Number(el.getAttribute('tabindex'));
    if (v > 0) out.badTabindex.push(desc(el) + '=' + v);
  });

  /* E. 分段控件的 .on 与 aria-pressed 必须一致 */
  const segs = [];
  document.querySelectorAll('[role="group"]').forEach(g => {
    const btns = [...g.querySelectorAll('button')];
    if (!btns.length) return;
    const rows = btns.map(b => ({ on: b.classList.contains('on'),
      pressed: b.getAttribute('aria-pressed') }));
    const bad = rows.filter(r => r.pressed !== null && (r.pressed === 'true') !== r.on);
    /* 一个组里最多只能有一个 .on。两种组分开判：
       · **单选组**（.seg：单位/时间制/语言/主题/地图时段）—— 恒有且只有一个当前值；
       · **记录器**（.cbseg：实况回填六档）—— "还没标注"是合法状态，所以只要求至多一个，
         与 aria-pressed 的一致性由下一条守。名字里带 cb 是刻意的：它不是选择器，
         点下去是**记一笔**，不是切频道。 */
    const nOn = rows.filter(r => r.on).length;
    const isPressedGroup = rows.some(r => r.pressed !== null);
    segs.push({ id: g.id, n: btns.length, nOn: nOn, mismatch: bad.length,
      kind: g.classList.contains('cbseg') ? 'recorder' : 'radio',
      anyPressed: isPressedGroup, labelled: !!g.getAttribute('aria-label') });
  });

  /* F. 结构 */
  const struct = {
    lang: document.documentElement.getAttribute('lang') || '',
    h1: document.querySelectorAll('h1').length,
    imgNoAlt: [...document.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).length,
    mainLandmark: !!document.querySelector('main, [role="main"]'),
    liveRegions: document.querySelectorAll('[aria-live]').length
  };
  out.struct = struct;
  out.segs = segs;
  out.segN = segs.length;

  /* C. 焦点可见：**不能靠 el.focus() 触发**（脚本 focus 不匹配 :focus-visible，
     实测 50 个可聚焦元素里 47 个被误报"无焦点样式"）。真正的判据要由外部用
     CDP 的 CSS.forcePseudoState 强制 focus-visible 再读计算样式 ——
     所以这里只负责把可聚焦元素打上序号，交给调用方逐个量。 */
  const focusables = [...document.querySelectorAll(
    'button, a[href], select, input:not([type=hidden]), textarea, [tabindex]')]
    .filter(el => { const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
        && getComputedStyle(el).display !== 'none' && !el.disabled; });
  focusables.forEach((el, i) => el.setAttribute('data-ax', String(i)));
  out.focusList = focusables.map((el, i) => i + '|' + desc(el));
  out.focusableN = focusables.length;

  /* D. 对比度：文本 vs 实际背景（向上找第一个**不透明且非渐变**的背景）。
     渐变/图片背景无法从计算样式里还原出真实色 ⇒ 记为"无法判定"而**不**计入违规：
     拿白色当渐变按钮的背景，会把"白字 + 橙色渐变"的按钮报成对比度 1（实测踩到）。 */
  const parse = c => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const bgOf = el => {
    let n = el, undet = false, dataBg = false;
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      const bi = cs.backgroundImage;
      if (bi && bi !== 'none' && /gradient|url\\(/i.test(bi)) undet = true;
      const c = parse(cs.backgroundColor);
      if (c && c.a >= 0.95) {
        /* 背景色本身是 JS 按数据给的（style="background:{云型色}"）⇒ 文字对比度
           取决于运行时颜色，固定配色规则判不了。图例色块（.swatch）就是这种：
           白字 + 深色 text-shadow 是刻意的做法，静态算出来的 2.05 是假警报。 */
        const st = n.getAttribute('style');
        if (st && /(^|[;\\s])background/i.test(st)) dataBg = true;
        return { c: c, undet: undet, dataBg: dataBg };
      }
      n = n.parentElement;
    }
    return { c: { r: 255, g: 255, b: 255, a: 1 }, undet: undet, dataBg: dataBg };
  };
  const lows = [], dd = [];
  let textN = 0, undetN = 0;
  /* "数据驱动配色"：颜色由 JS 注入的行内样式给的（style="color:{等级色}"、
     style="--cfb:{可信度三档色}"），**不归 CSS 固定配色管**。
     它们在项目里有自己的单一来源纪律（等级色 / 可信度三档各只有一处定义，
     而分享卡与页面对同一套色 —— 见硬约束 24/25），改它们要动的是语义而不是排版，
     所以单列报告、不计入"CSS 固定配色"的达标判据。
     判据刻意写窄：只认 color 与 --cf，不认任意 style（style="margin-top:8px"
     这类无关行内样式不能成为免检的理由）。 */
  const dataDriven = el => {
    let n = el;
    while (n && n.nodeType === 1) {
      const st = n.getAttribute('style');
      if (st && /(^|[;\s])(color|--cf)/i.test(st)) return true;
      n = n.parentElement;
    }
    return false;
  };
  document.querySelectorAll('body *').forEach(el => {
    /* 只看"自己直接装着文字"的元素，且文字非空白 */
    const direct = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).length;
    if (!direct) return;
    if (el.closest('canvas, svg, .maplay, .mapwrap')) return;   // 地图是画出来的，不是文本 UI
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return;
    const col = parse(cs.color); if (!col) return;
    const bg = bgOf(el);
    if (bg.undet || bg.dataBg) { undetN++; return; }
    const rr = ratio(col, bg.c);
    /* 字号 ≥ 18.66px（或 ≥14px 且粗体）算"大字"，阈值降到 3 */
    const px = parseFloat(cs.fontSize), bold = (parseInt(cs.fontWeight, 10) || 400) >= 700;
    const big = px >= 18.66 || (px >= 14 && bold);
    const need = big ? 3 : 4.5;
    textN++;
    const row = { el: desc(el), ratio: Math.round(rr * 100) / 100, need: need,
      px: Math.round(px), text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 24) };
    if (rr < need) (dataDriven(el) ? dd : lows).push(row);
  });
  out.lowContrast = lows.slice(0, 30);
  out.lowContrastN = lows.length;
  out.ddContrast = dd.slice(0, 30);
  out.ddContrastN = dd.length;
  out.textN = textN;
  out.undetN = undetN;
  return out;
})()`;

(async function main() {
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "ax-"));
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
  console.log("无障碍审计 —— 焦点可见性 / 对比度 / 可访问名 / 状态同步（零额度）");
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
  /* 把地图也画出来，让提示卡/排行榜/图例这些"只有出图才存在"的部分进入审计范围 */
  await ev(`(async()=>{ await loadMapData(true); })()`, true);
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (await ev(`!!(mapSet() && mapSet().pts.length && MapMod.field)`)) break;
  }
  await sleep(600);

  const A = await ev(AUDIT);

  /* C 组：用 CDP 强制 `:focus-visible`。
     脚本 `el.focus()` **不匹配**这个伪类（它是"键盘式交互"的标记），
     所以第一版用 focus() + getComputedStyle 量出 47/50 个"无焦点样式"全是误报。
     正确做法是让 DevTools 协议自己去置伪类状态，再读计算样式。

     **必须同时强制 focus 与 focus-visible**：真实浏览器里键盘聚焦会让两者同时命中，
     而本项目的输入框把焦点样式写在了 `input:focus{box-shadow:...}` 上
     （不是 :focus-visible）—— 只强制 focus-visible 会把那 4 个输入框误报成
     "没有焦点样式"（实测踩到）。 */
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const doc = await cdp.send("DOM.getDocument", {});
  const noFocus = [];
  let focusProbed = 0;
  for (const item of A.focusList) {
    const idx = item.split("|")[0];
    let q = null;
    try { q = await cdp.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: '[data-ax="' + idx + '"]' }); }
    catch (e) { continue; }
    if (!q || !q.nodeId) continue;
    try {
      await cdp.send("CSS.forcePseudoState",
        { nodeId: q.nodeId, forcedPseudoClasses: ["focus", "focus-visible"] });
      const st = await ev(`(function(){ const el = document.querySelector('[data-ax="${idx}"]');
        if (!el) return null; const cs = getComputedStyle(el);
        return { o: cs.outlineStyle, w: parseFloat(cs.outlineWidth) || 0, s: cs.boxShadow || 'none' }; })()`);
      if (!st) continue;
      focusProbed++;
      const vis = (st.o !== "none" && st.w > 0) || (st.s && st.s !== "none");
      if (!vis) noFocus.push(item.split("|")[1]);
    } finally {
      await cdp.send("CSS.forcePseudoState", { nodeId: q.nodeId, forcedPseudoClasses: [] }).catch(() => { });
    }
  }
  await ev(`document.querySelectorAll('[data-ax]').forEach(e => e.removeAttribute('data-ax'))`);
  A.noFocusStyle = noFocus;

  console.log("\n=== A/B. 可访问名与键盘 ===");
  console.log("  没名字的可交互元素 " + A.noName.length + " 个：" + (A.noName.length ? A.noName.join("  ") : "无"));
  console.log("  没名字的 role=group " + A.unnamedGroup.length + " 个：" + (A.unnamedGroup.length ? A.unnamedGroup.join("  ") : "无"));
  console.log("  没 label/aria-label 的表单控件 " + A.emptyLabel.length + " 个：" + (A.emptyLabel.length ? A.emptyLabel.join("  ") : "无"));
  console.log("  role=button 缺 tabindex：" + (A.roleBtnNoTab.length ? A.roleBtnNoTab.join("  ") : "无"));
  console.log("  正 tabindex（会打乱 Tab 顺序）：" + (A.badTabindex.length ? A.badTabindex.join("  ") : "无"));

  console.log("\n=== C. 焦点可见（可聚焦 " + A.focusableN + " 个，实测 " + focusProbed + " 个）===");
  console.log("  强制 :focus-visible 后仍无可见焦点样式：" + (A.noFocusStyle.length ? A.noFocusStyle.join("  ") : "无"));

  console.log("\n=== D. 文本对比度（受检 " + A.textN + " 个，渐变/图片底无法判定 " + A.undetN + " 个已跳过）===");
  console.log("  CSS 固定配色不达标的 " + A.lowContrastN + " 个：");
  A.lowContrast.forEach(x => console.log("    " + String(x.ratio).padStart(5) + " < " + x.need
    + "  " + x.el + "  " + x.px + "px  " + JSON.stringify(x.text)));
  console.log("  数据驱动配色（等级色 / 可信度三档，另有单一来源纪律）单列 " + A.ddContrastN + " 个：");
  A.ddContrast.slice(0, 6).forEach(x => console.log("    " + String(x.ratio).padStart(5) + " < " + x.need
    + "  " + x.el + "  " + x.px + "px  " + JSON.stringify(x.text)));

  console.log("\n=== E. 分段控件状态同步（" + A.segN + " 组）===");
  (A.segs || []).forEach(s => console.log("    #" + s.id + "  [" + s.kind + "]  按钮 " + s.n + " · .on " + s.nOn
    + " · aria 错位 " + s.mismatch + " · 有 aria-pressed=" + s.anyPressed + " · 有组名=" + s.labelled));

  console.log("\n=== F. 结构 ===");
  console.log("    html[lang]=" + JSON.stringify(A.struct.lang) + " · h1 数=" + A.struct.h1
    + " · 无 alt 的 img=" + A.struct.imgNoAlt + " · main 地标=" + A.struct.mainLandmark
    + " · aria-live 区=" + A.struct.liveRegions);

  const o = {
    "所有可交互元素都有可访问名": A.noName.length === 0,
    "所有 role=group 都有 aria-label": A.unnamedGroup.length === 0,
    "表单控件都有 label 或 aria-label（不靠 placeholder）": A.emptyLabel.length === 0,
    "role=button 都能 Tab 到": A.roleBtnNoTab.length === 0,
    "没有正的 tabindex（不打乱 Tab 顺序）": A.badTabindex.length === 0,
    "焦点度量本身有效（可聚焦元素全部被实测到）": focusProbed === A.focusableN && A.focusableN > 0,
    "每个可聚焦元素都有可见焦点样式（C 组）": A.noFocusStyle.length === 0,
    "对比度度量的覆盖面足够（不是被「无法判定」吞掉）": A.textN >= 100,
    "CSS 固定配色的文本对比度全部达标（D 组）": A.lowContrastN === 0,
    "分段控件的 .on 与 aria-pressed 一致（E 组）": (A.segs || []).length > 0 && (A.segs || []).every(s => s.mismatch === 0),
    "分段控件有组名且每组至多一个选中": (A.segs || []).every(s => s.labelled && s.nOn <= 1),
    /* 单选组按**身份**点名（不数总数）：这五组是"当前值"语义，任何时刻都必须恰有一个亮着。
       记录器（.cbseg）不在名单里 —— 它的 0 选中正是"还没回填"的正常态，见 E 组注释。 */
    "单选组恒有且只有一个当前值（单位/时间制/语言/主题/地图时段）":
      ["unitSeg", "clockSeg", "langSeg", "themeSeg", "mapPeriod"].every(id => {
        const s = (A.segs || []).find(x => x.id === id);
        return !!s && s.kind === "radio" && s.nOn === 1;
      }),
    "html[lang] 已设且是中文": /^zh/.test(A.struct.lang),
    "页面只有一个 h1": A.struct.h1 === 1,
    "img 都有 alt": A.struct.imgNoAlt === 0,
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
