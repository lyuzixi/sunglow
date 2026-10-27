/* 教程页探针 —— 只读，零额度，不发任何外部请求。
 *
 * 为什么单独写：`tutorial.html` 是**独立手写文件**，不进 `assemble.py` 的构建链
 * —— 也就是说 index.html 那一整套探针一条都盖不到它。它能悄悄烂掉的姿势很具体：
 *   ① 三语词典只补了半边：新写一段正文忘了加译，英文读者看到的是中文，或者更糟——
 *      看到 `ov.lead` 这种**键原文**（这条真的发生过：applyLang 写成 tr(key)||zh，
 *      而 tr() 在简体下返回的正是键本身）；
 *   ② 主题三态退化成两态：auto 不再跟随系统，或 light 被系统的 dark 反超；
 *   ③ 窄屏溢出：新加一张宽表就够了 —— 这是本项目踩过最多的一条；
 *   ④ 与主页的**互通**断掉：偏好键各写各的（两页各记一份），或 ← 回不去 / 主页进不来。
 * 这四件事在开发环境里肉眼几乎发现不了：词典漏一条看不出来，溢出要真机才知道，
 * 互通只有"从主页点进来、再点回去"这一条路径能测到。
 *
 * 量六组：
 *   S. 静态：自包含（零外部引用）/ 无未替换占位符 / 引导脚本排在 CSS 之前（防 FOUC）
 *      / 三语词典覆盖**全部** DOM 键
 *   L. 三语：zh / zhHant / en 切换后 html[lang]、<title>、正文真的变了，且无键原文泄漏
 *   T. 主题三态：auto 跟随系统（含**不刷新**的实时跟随）/ light 压过系统 / dark 生效
 *      / 点选后写回偏好键
 *   V. 四档：按钮 ↔ 视图一一对应、恰一个 aria-pressed、hash 深链直达、
 *      且按钮在**命中测试**下真的可点（合成 click 绕过命中测试，被盖住照样绿 —— 踩过）
 *   X. 互通：← 回主页 / 主页书本图标进教程 / 偏好键**只补字段、不擦掉别人的**
 *   M. 窄屏 390·360：无横向溢出、顶栏单行、四档按钮都在视口内
 *
 * 两条纪律（与 404probe 同源）：
 *   · 计数器在**被测动作结束那一刻**取值 —— 后面还要载入主页，而主页会真的去取气象
 *     数据（被掐断、会计进外部请求数）。放到最后统一读，等于把主页的请求算在教程页头上。
 *   · 判"页面就绪"用 `location.href + readyState` 握手，不用 `window.State` 之类
 *     业务全局（本项目的 `State` 是顶层 const，`window.State` 恒为 undefined，
 *     写错会让轮询静默跑满预算、探针零输出被杀）。
 *
 * 用法: node _check/tutorialprobe.js
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 47877;
const DEBUG_PORT = 9358;
const TUT = "/tutorial.html";
const HOME = "/index.html";
const PREF_KEY = "sunsetbot.pref.v1";
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------------- 服务器桩 */
function serve() {
  const files = {};
  for (const [u, f] of [[TUT, "tutorial.html"], [HOME, "index.html"], ["/", "index.html"]]) {
    files[u] = fs.readFileSync(path.join(ROOT, f));
  }
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
    const b = files[u];
    if (!b) { res.writeHead(404); res.end("no"); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(b);
  });
  return new Promise(r => srv.listen(PORT, "127.0.0.1", () => r(srv)));
}

/* ---------------------------------------------------------------- CDP */
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

/* ---------------------------------------------------------------- 页内快照
 * 一次取全：语言 / 主题 / 四档 / 词典覆盖 / 关键几何。分多次 eval 会让
 * "同一时刻的状态"散成几个时刻的状态，判据之间就不自洽了。 */
const SNAP = `(function(){
  var de = document.documentElement;
  function q(s){ return document.querySelector(s); }
  function box(el){ if(!el) return null; var b = el.getBoundingClientRect();
    return {x:b.x, y:b.y, w:b.width, h:b.height, right:b.right, bottom:b.bottom}; }
  var SEL = ['data-i18n','data-i18n-html','data-i18n-aria','data-i18n-title'];
  var els = [].slice.call(document.querySelectorAll('[data-i18n],[data-i18n-html],[data-i18n-aria],[data-i18n-title]'));
  var domKeys = {}, leak = [], trad = 0;
  els.forEach(function(el){
    SEL.forEach(function(a){ var v = el.getAttribute(a); if(v) domKeys[v] = 1; });
    /* 键原文泄漏：正文节点的文字**正好等于它的键**。
       键是中文原文时 "译文缺失"；键是 slug（ov.lead）时 "拿键当文案"。
       两件事都不该出现在非简体页面上。
       **只对英文成立** —— 繁體里「日落 / 朝霞 / 部署」这类词简繁同形，
       文字等于键是正确结果，拿它当判据会把正常页面判红（踩过）。 */
    var k = el.getAttribute('data-i18n') || el.getAttribute('data-i18n-html');
    if (!k) return;
    var tx = (el.textContent || "").trim();
    /* 繁體专用字（简体文本里不会出现）：用来证明 applyLang 真的换过一套词，
       而不是"lang 属性变了、正文没动"。 */
    if (/[預報據圖雲間價機體網讀選與為這]/.test(tx)) trad++;
    if (tx !== k.trim()) return;
    if (/[\\u4e00-\\u9fa5]/.test(k) || /^[a-z]{2,4}\\.[a-zA-Z0-9]+$/.test(k)) leak.push(k);
  });
  function miss(d){ return Object.keys(domKeys).filter(function(k){ return !(k in d) || !d[k]; }); }
  var hant = miss(window.ZH_HANT || {}), en = miss(window.EN || {});
  /* 两个口径都取：hidden 属性（JS 的意图）与 computed display（用户真正看到的）。
     只判属性会假绿 —— 样式表里写成 .view[hidden]{display:block} 这种笔误照样让
     属性为 true，而屏幕上四档全摊开着。 */
  var views = [].map.call(document.querySelectorAll('.view'), function(v){ return v.id; })
    .filter(function(id){ var el = document.getElementById(id); return el && !el.hidden; });
  var shown = [].map.call(document.querySelectorAll('.view'), function(v){ return v.id; })
    .filter(function(id){
      var el = document.getElementById(id);
      return el && getComputedStyle(el).display !== "none";
    });
  var tabs = [].map.call(document.querySelectorAll('.tab'), function(b){
    return { v: b.getAttribute('data-view'), pressed: b.getAttribute('aria-pressed'),
      on: b.classList.contains('on'), text: (b.textContent||"").trim(), box: box(b) };
  });
  var colors = [].map.call(document.querySelectorAll('meta[name="theme-color"]'),
    function(m){ return { c: m.getAttribute('content'), media: m.getAttribute('media') }; });
  var back = document.getElementById('backBtn');
  var tb = q('.top-in');
  return {
    lang: de.getAttribute('lang'),
    theme: de.getAttribute('data-theme'),
    pref: de.getAttribute('data-theme-pref'),
    scheme: getComputedStyle(de).colorScheme,
    title: document.title,
    bg: getComputedStyle(document.body).backgroundColor,
    vw: de.clientWidth, sw: de.scrollWidth,
    topH: tb ? Math.round(tb.getBoundingClientRect().height) : null,
    views: views, shown: shown, viewCount: document.querySelectorAll('.view').length,
    tabs: tabs, pressed: tabs.filter(function(t){ return t.pressed === 'true'; }).length,
    nodeCount: els.length, keyCount: Object.keys(domKeys).length,
    missHant: hant, missEn: en, leak: leak, trad: trad,
    colors: colors,
    backTag: back ? back.tagName : null, backHref: back ? back.getAttribute('href') : null,
    backAbs: back ? back.href : null, backName: back ? back.getAttribute('aria-label') : null,
    langName: (document.getElementById('langBtn')||{}).textContent,
    themeIco: (document.getElementById('themeBtn')||{}).textContent,
    homeEntry: (function(){
      var a = document.getElementById('tutBtn');
      return a ? { tag: a.tagName, href: a.getAttribute('href'), abs: a.href } : null;
    })(),
    h1: (q('.top h1')||{}).textContent || null
  };
})()`;

/* 命中测试：合成 click 会绕过它，被顶栏盖住的按钮照样"点得动" —— 必须用
   elementFromPoint 验一次真实可达性（全屏退出按钮那次就是这么漏过去的）。 */
const HIT = `(function(){
  var out = {};
  [['backBtn', document.getElementById('backBtn')],
   ['tabUsers', document.querySelector('.tab[data-view="users"]')],
   ['tabCreator', document.querySelector('.tab[data-view="creator"]')],
   ['langBtn', document.getElementById('langBtn')],
   ['themeBtn', document.getElementById('themeBtn')]].forEach(function(p){
    var el = p[1]; if (!el) { out[p[0]] = 'MISSING'; return; }
    var b = el.getBoundingClientRect();
    if (!b.width || !b.height) { out[p[0]] = 'ZERO'; return; }
    var x = b.x + b.width / 2, y = b.y + b.height / 2;
    var hit = document.elementFromPoint(x, y);
    out[p[0]] = hit === el || el.contains(hit) ? 'ok' : 'covered:' + (hit ? hit.tagName + '.' + hit.className : 'null');
  });
  return out;
})()`;

(async function main() {
  const html = fs.readFileSync(path.join(ROOT, "tutorial.html"), "utf8");

  /* ---------- S. 静态 ---------- */
  const holes = ["__SITE_BASE__", "__TMAP_SERVICE_HOST__", "__ICON_SVG__", "__ICON_PNG180__", "__WB_SITE__"]
    .filter(h => html.indexOf(h) >= 0);
  /* 教程页要能双击文件直接打开，所以**不允许任何外部引用**：
     外部字体/图标/CDN 一断网就白板，而且会往访客的 IP 上记一笔第三方请求。
     注意 favicon 是 data-URI，里面含 xmlns='http://…'（单引号、非 src/href），不算外部引用。 */
  const ext = html.match(/<(?:script|link|img|iframe|source|video|audio)\b[^>]*\b(?:src|href)\s*=\s*["']https?:/gi) || [];
  /* 引导脚本必须排在 <style> 之前：晚一帧就会先闪一下浅色（FOUC），
     深色用户每次刷新都看见一次白屏 —— 这条只有"顺序"能守。 */
  const iBoot = html.indexOf('data-theme-pref');
  const iCss = html.indexOf("<style>");
  const s = {
    "产物 tutorial.html 存在且非空": html.length > 60000,
    "产物里没有未替换的占位符": holes.length === 0,
    "自包含：零外部引用（断网也打得开）": ext.length === 0,
    "主题引导脚本排在第一块 CSS 之前（防 FOUC）": iBoot > 0 && iCss > iBoot,
    /* 教程页是手写独立文件 —— 一旦有人把它塞进 assemble.py 的模板替换，
       它就会多出 __SITE_BASE__ 之类的注入点，与"双击可开"的定位冲突。 */
    "仍是独立手写文件（不进构建链）":
      !/tutorial\.html/.test(fs.readFileSync(path.join(ROOT, "assemble.py"), "utf8")),
  };

  /* ---------- 起浏览器 ---------- */
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "tutp-"));
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
  let extHits = 0;
  const blocked = [];
  cdp.on(m => {
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errs.push((m.params.args || []).map(a => a.value === undefined ? a.description : a.value).join(" "));
    } else if (m.method === "Runtime.exceptionThrown") {
      errs.push((m.params.exceptionDetails || {}).text || "exception");
    }
  });
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  cdp.on(async m => {
    if (m.method !== "Fetch.requestPaused") return;
    const { requestId, request } = m.params;
    try {
      if (request.url.indexOf("http://127.0.0.1:" + PORT) === 0) {
        await cdp.send("Fetch.continueRequest", { requestId });
      } else {
        extHits++;
        if (blocked.length < 8) blocked.push(request.url);
        await cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
      }
    } catch (e) { }
  });

  const ev = async expr => {
    const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error("页内异常: " + JSON.stringify(r.exceptionDetails.text));
    return r.result.value;
  };
  /* 判"到站"用 pathname + hash 比对，**不比 whole href**：主页会把位置/日期写进
     查询串（history.replaceState），整个 href 必然对不上；而只比 pathname 又会让
     "TUT 与 TUT#creator" 互相冒充。search 一律忽略。 */
  async function go(url) {
    const i = url.indexOf("#");
    const wantPath = i < 0 ? url : url.slice(0, i);
    const wantHash = i < 0 ? "" : url.slice(i);
    const want = "complete|" + wantPath + wantHash;
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + url });
    let last = "";
    for (let n = 0; n < 80; n++) {
      await sleep(120);
      let r = "";
      try { r = await ev("document.readyState + '|' + location.pathname + location.hash"); }
      catch (e) { r = "ERR " + e.message; }          // 旧文档的上下文已销毁：正常，继续等
      last = r;
      if (r === want) return true;
    }
    throw new Error("导航未到达 " + want + "（最后状态 " + last + "）");
  }
  /* 写偏好必须站在站点源上：about:blank 的 localStorage 是另一个（不透明）源。
     写完跳一次 about:blank 再回来 —— 只改 hash 是**同文档导航**，引导脚本不重跑，
     测到的还是上一次的偏好（踩过）。 */
  async function setPref(obj) {
    await go(TUT);
    await ev("localStorage.setItem(" + JSON.stringify(PREF_KEY) + "," +
      JSON.stringify(JSON.stringify(obj)) + ")");
    await cdp.send("Page.navigate", { url: "about:blank" });
    await sleep(150);
  }
  const pref = async () => JSON.parse(await ev("localStorage.getItem(" + JSON.stringify(PREF_KEY) + ")||'null'") || "null");
  const snap = async () => await ev(SNAP);
  async function metrics(w, h, mobile) {
    await cdp.send("Emulation.setDeviceMetricsOverride",
      { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile });
    if (mobile) await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  }
  const media = v => cdp.send("Emulation.setEmulatedMedia",
    { features: [{ name: "prefers-color-scheme", value: v }] });

  await metrics(1440, 900, false);
  await media("light");

  /* ---------- S 补充：三语词典覆盖（词表在页面里，静态读不准） ---------- */
  extHits = 0;
  await setPref({ lang: "zh", theme: "light" });
  await go(TUT);
  const base = await snap();
  const tutExt = extHits;                       // 当场取值：下面要载入主页，会真的去取数

  /* ---------- L. 三语 ---------- */
  await setPref({ lang: "zhHant", theme: "light" });
  await go(TUT);
  const hant = await snap();
  await setPref({ lang: "en", theme: "light" });
  await go(TUT);
  const en = await snap();
  /* 从英文切回简体：走**真实交互**（点语言菜单里的「中文」），验 applyLang 能还原 */
  await ev(`document.getElementById("langBtn").click()`);
  await sleep(180);
  const menuOpen = await ev(`!document.getElementById("langMenu").hidden`);
  await ev(`document.querySelector('#langSeg button[data-k="zh"]').click()`);
  await sleep(250);
  const backZh = await snap();
  const zhPref = (await pref() || {}).lang;

  /* ---------- T. 主题三态 ---------- */
  await media("dark");
  await setPref({ lang: "zh", theme: "auto" });
  await go(TUT);
  const autoDark = await snap();
  /* auto 的"实时跟随"：不刷新页面，只翻系统偏好，页面必须自己跟上。
     这条守的是 matchMedia 那个 change 监听 —— 没有它，切系统主题得手动刷新。 */
  await media("light");
  await sleep(250);
  const autoFlip = await snap();
  await media("dark");
  await setPref({ lang: "zh", theme: "light" });   // 系统深色 + 显式浅色 = 浅色
  await go(TUT);
  const forceLight = await snap();
  await media("light");
  await setPref({ lang: "zh", theme: "dark" });
  await go(TUT);
  const dark = await snap();
  /* 点选写回：从深色点「浅色」，data-theme 与偏好键都得跟着变 */
  await ev(`document.getElementById("themeBtn").click()`);
  await sleep(180);
  await ev(`document.querySelector('#themeSeg button[data-k="light"]').click()`);
  await sleep(250);
  const afterPick = await snap();
  const themePrefNow = (await pref() || {}).theme;

  /* ---------- V. 四档 ---------- */
  await media("light");
  await setPref({ lang: "zh", theme: "light" });
  await go(TUT);
  const v0 = await snap();
  await ev(`document.querySelector('.tab[data-view="users"]').click()`);
  await sleep(250);
  const v1 = await snap();
  await ev(`document.querySelector('.tab[data-view="dev"]').click()`);
  await sleep(250);
  const v2 = await snap();
  await go(TUT + "#creator");                    // 深链直达（分享出去的地址就是这个形态）
  const v3 = await snap();
  const loadedHash = await ev("location.hash");
  const hit = await ev(HIT);

  /* ---------- X. 互通 ---------- */
  /* 计数器当场取值：下面要载入主页，而主页会真的去取气象数据 —— 那些请求被掐断后
     会在控制台留下一串错误。放到最后统一读，等于把"主页取数失败"算成"教程页报错"。 */
  const errsTut = errs.length;
  /* 主页 → 教程：先证明主页真的有那个入口，再点它过来。
     `#tutBtn` 是 <a href="tutorial.html">，真链接（中键、右键新窗口都成立）。 */
  await go(HOME);
  await sleep(600);
  const home = await snap();
  const homeOk = await ev("!!document.querySelector('.top h1') && document.querySelector('.top h1').textContent.indexOf('霞光预报')>=0");
  await ev(`document.getElementById("tutBtn").click()`);
  let landed = null;
  for (let i = 0; i < 50; i++) {
    await sleep(150);
    try { landed = await ev("location.pathname"); } catch (e) { }
    if (landed === TUT) break;
  }
  /* 教程 → 主页：← 必须是真链接（没脚本也能回），且真的回到主页 */
  await go(TUT);
  await ev(`document.getElementById("backBtn").click()`);
  let backHome = null;
  for (let i = 0; i < 50; i++) {
    await sleep(150);
    try { backHome = await ev("location.pathname"); } catch (e) { }
    if (backHome === HOME) break;
  }
  /* 偏好键"只补不擦"：预置几个**教程不认识的**字段（units / numLabels / 一个假键），
     在教程里改语言与主题，然后看它们还在不在。
     教程刻意不复用主页 prefWrite 的白名单过滤 —— 那会顺手删掉别人写进去的字段。 */
  await setPref({ lang: "zh", theme: "light", units: "metric", numLabels: true, zzProbeKeep: "keep" });
  await go(TUT);
  await ev(`document.getElementById("themeBtn").click()`);
  await sleep(150);
  await ev(`document.querySelector('#themeSeg button[data-k="dark"]').click()`);
  await sleep(150);
  await ev(`document.getElementById("langBtn").click()`);
  await sleep(150);
  await ev(`document.querySelector('#langSeg button[data-k="en"]').click()`);
  await sleep(250);
  const kept = await pref() || {};

  /* ---------- M. 窄屏 ---------- */
  const narrow = {};
  for (const [w, h] of [[390, 844], [360, 640]]) {
    await metrics(w, h, true);
    await setPref({ lang: "zh", theme: "light" });
    await go(TUT);
    narrow[w] = await snap();
    narrow[w].hit = await ev(HIT);
    narrow[w].tabScroll = await ev(`(function(){
      var t=document.getElementById('tabs');
      return t ? {sw:t.scrollWidth, cw:t.clientWidth} : null;
    })()`);
  }

  const o = Object.assign({}, s, {
    /* S：词典覆盖 —— 缺一条，那个节点在繁/英里就是中文（或 slug 键） */
    "三语词典覆盖全部 DOM 键（含繁体与英文）":
      base.keyCount > 200 && base.missHant.length === 0 && base.missEn.length === 0,
    "教程页零外部请求": tutExt === 0,

    /* L */
    "默认简体：lang=zh-CN、标题是中文": base.lang === "zh-CN" && /使用教程/.test(base.title),
    /* 繁體：lang/标题换了 + 正文真的用上繁体字。
       "有没有回落中文"由上面那条**词典覆盖率**精确判定 —— 回落只可能发生在缺词时；
       而"文字是否等于键"在这里不可用作判据（日落/朝霞/部署 简繁同形）。 */
    "繁體：lang 与标题都换了，正文真的换了字形":
      hant.lang === "zh-Hant-TW" && /使用教學/.test(hant.title) && hant.trad >= 20,
    "英文：lang 与标题都换了、正文没有回落中文":
      en.lang === "en" && /User guide/.test(en.title) && en.leak.length === 0,
    "语言菜单能打开，点「中文」后正文还原（往返一致）":
      menuOpen === true && backZh.lang === "zh-CN" && /使用教程/.test(backZh.title) &&
      backZh.backName === base.backName && backZh.tabs[1].text === base.tabs[1].text,
    "切语言写回偏好键": zhPref === "zh",

    /* T */
    "auto 跟随系统深色（不刷新也跟得上）":
      autoDark.theme === "dark" && autoDark.pref === "auto" &&
      autoDark.scheme === "dark" && autoFlip.theme === "light",
    "auto 时地址栏配色跟着换（只放行匹配的那条 theme-color）":
      (autoDark.colors.filter(c => c.media === "all")[0] || {}).c === "#11151c" &&
      (autoFlip.colors.filter(c => c.media === "all")[0] || {}).c === "#f6f7f8",
    "light 压过系统深色": forceLight.theme === "light" && forceLight.scheme === "light",
    "dark 生效（系统浅色下仍然深）": dark.theme === "dark" && dark.scheme === "dark",
    "点「浅色」即时生效并写回偏好键": afterPick.theme === "light" && themePrefNow === "light",

    /* V */
    "四档：4 个按钮 / 4 个视图 / 默认只显示概览":
      v0.tabs.length === 4 && v0.viewCount === 4 &&
      v0.shown.length === 1 && v0.shown[0] === "overview" && v0.views.length === 1,
    "切到「用户版」：只显示该档、恰一个按钮按下、hash 跟随":
      v1.shown.length === 1 && v1.shown[0] === "users" && v1.views[0] === "users" &&
      v1.pressed === 1 &&
      v1.tabs.filter(t => t.pressed === "true")[0].v === "users" &&
      v1.tabs.filter(t => t.on).length === 1,
    "再切「开发者版」仍是一一对应":
      v2.shown.length === 1 && v2.shown[0] === "dev" && v2.pressed === 1,
    "深链 #creator 直达该档":
      v3.shown.length === 1 && v3.shown[0] === "creator" &&
      loadedHash === "#creator" && v3.pressed === 1,
    "桌面顶栏两枚按钮与档位按钮都在命中测试下可点":
      Object.keys(hit).every(k => hit[k] === "ok"),

    /* X */
    "主页顶栏有教程入口（真链接，指向同目录 tutorial.html）":
      !!home.homeEntry && home.homeEntry.tag === "A" && home.homeEntry.href === "tutorial.html" &&
      home.homeEntry.abs === "http://127.0.0.1:" + PORT + TUT,
    "点主页的书本图标能进教程": homeOk === true && landed === TUT,
    "教程的 ← 是真链接且指向主页": base.backTag === "A" && base.backHref === "index.html" &&
      base.backAbs === "http://127.0.0.1:" + PORT + HOME,
    "点 ← 真的回到主页": backHome === HOME,
    "偏好键只补字段：工具认的其它字段原样保留":
      kept.units === "metric" && kept.numLabels === true && kept.zzProbeKeep === "keep",
    "偏好键：教程改的语言与主题就是主页看的那两个字段":
      kept.lang === "en" && kept.theme === "dark",

    /* M */
    "390 窄屏无横向溢出": narrow[390].sw <= narrow[390].vw + 1,
    "360 窄屏无横向溢出": narrow[360].sw <= narrow[360].vw + 1,
    "窄屏顶栏仍是单行（34px 按钮 + 上下 8px = 50px 设计值）":
      narrow[390].topH !== null && narrow[390].topH <= 52 &&
      narrow[360].topH !== null && narrow[360].topH <= 52,
    "窄屏四档按钮全在视口内（不靠横向滑动才够得着）":
      [390, 360].every(w => narrow[w].tabs.length === 4 &&
        narrow[w].tabs.every(t => t.box && t.box.x >= -1 && t.box.right <= narrow[w].vw + 1)),
    "窄屏按钮命中测试全部可点":
      [390, 360].every(w => Object.keys(narrow[w].hit).every(k => narrow[w].hit[k] === "ok")),
    "教程页无控制台报错": errsTut === 0,
  });

  console.log("=== 教程页探针 ===");
  console.log("  产物 " + Buffer.byteLength(html, "utf8") + " 字节 · DOM 键 " + base.keyCount
    + " · 繁体缺 " + base.missHant.length + " · 英文缺 " + base.missEn.length);
  console.log("  简体 " + base.lang + " / 繁體 " + hant.lang + " / 英文 " + en.lang
    + " · 标题 " + JSON.stringify(en.title));
  console.log("  主题 auto+系统深 → " + autoDark.theme + " · auto+系统浅 → " + autoFlip.theme
    + " · light+系统深 → " + forceLight.theme + " · dark+系统浅 → " + dark.theme);
  console.log("  四档 " + v0.tabs.map(t => t.text).join(" / ") + " · 深链 " + loadedHash);
  console.log("  窄屏 390 " + narrow[390].vw + "（sw " + narrow[390].sw + "，顶栏 "
    + narrow[390].topH + "px，档位条 " + JSON.stringify(narrow[390].tabScroll) + "）");
  console.log("  窄屏 360 " + narrow[360].vw + "（sw " + narrow[360].sw + "，顶栏 "
    + narrow[360].topH + "px，档位条 " + JSON.stringify(narrow[360].tabScroll) + "）");
  console.log("  外部请求 教程页 " + tutExt + " · 控制台错误 " + errs.length);

  console.log("\n--- 断言 ---");
  let fail = 0;
  for (const k of Object.keys(o)) {
    if (!o[k]) { console.log("  FAIL " + k); fail++; } else console.log("  ok   " + k);
  }
  if (base.missHant.length) console.log("  繁體缺词：" + base.missHant.slice(0, 12).join(" / "));
  if (base.missEn.length) console.log("  英文缺词：" + base.missEn.slice(0, 12).join(" / "));
  if (en.leak.length) console.log("  英文键原文泄漏（前 12）：" + en.leak.slice(0, 12).join(" / "));
  if (errs.length) { console.log("  控制台错误 " + errs.length + " 条："); errs.slice(0, 5).forEach(e => console.log("    " + e)); }
  const badHit = Object.assign({}, hit, narrow[390].hit, narrow[360].hit);
  const badKeys = Object.keys(badHit).filter(k => badHit[k] !== "ok");
  if (badKeys.length) console.log("  命中测试未通过：" + badKeys.map(k => k + "=" + badHit[k]).join(" · "));
  if (blocked.length) {
    console.log("  被掐断的地址 " + blocked.length + " 条（含 X 组载入主页时的气象取数，预期）：");
    blocked.forEach(u => console.log("    " + u));
  }
  console.log("\nFAIL 计数: " + fail);
  console.log('FACTS {"assertions":' + Object.keys(o).length + ',"fail":' + fail + '}');
  try { chrome.kill(); } catch (e) { }
  srv.close();
  process.exit(fail);
})().catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
