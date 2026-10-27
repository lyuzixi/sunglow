/* XSS 防护探针 —— 只读，零额度，不发任何外部请求。
 *
 * 为什么单独写：本项目 49 处 innerHTML 插值，此前**一个转义函数都没有**，
 * 全靠"数据来自内置城市表"这个前提兜底 —— 而这条前提至少在两处不成立：
 *   ① `_p6.js` 的省份名来自**外部 GeoJSON**（DataV 省界）；
 *   ② `readUrl()` 把地址栏的 `?name=` 直接写进 `State.name`，最终落进
 *      `_p5b.js` 结果卡的 innerHTML ⇒ **一条分享链接即可触发的反射型 XSS**。
 * 40 字符截断挡不住它：`<img src=1 onerror=eval(location.hash)>` 正好 39 字符，
 * 超长载荷放 hash 里即可。所以修复用的是"输入侧白名单 + 输出侧转义"两层。
 *
 * 这个探针守的就是这两层：一处失效，下面任一条就会红。
 *
 * 量三组：
 *   A. 静态：产物里 5 个热点都走 esc()、URL 地名走 safeLabel()、转义函数存在
 *   B. 函数行为：esc() 的四类字符与边界输入、safeLabel() 对真实载荷的清洗
 *   C. 端到端：把载荷放进地址栏 → readUrl() → State.name 不含标签字符；
 *      页面在此载荷下加载后，DOM 里不存在被注入的元素
 *
 * 用法: node _check/xssprobe.js
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 47903;
const DEBUG_PORT = 9362;
/* 真实可利用载荷：39 字符，正好卡在旧的 40 字符截断之内。 */
const PAYLOAD = '<img src=1 onerror=eval(location.hash)>';
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

  /* ---------- A. 静态：热点有没有走转义 ---------- */
  /* 这 5 处正是审计里列出的"外部数据 / 用户可控数据进 innerHTML"的入口。
     断言写成"必须出现转义后的形态"，而不是"数 esc( 的个数" —— 后者会随
     无关改动漂移，前者才是我们要守的性质。 */
  const HOTSPOTS = [
    "esc(c.name)",      // _p5.js 城市建议列表（文本 + 属性两处）
    "esc(r.name)",      // _p5b.js 结果卡"预计 <地名> …"
    "esc(provName)",    // _p6.js 省份清单标题（外部 GeoJSON）
    "esc(o.name)",      // _p6.js 省份清单条目 / 排行榜条目
    "esc(o.prov)",      // _p6.js 省份清单条目属性
  ];
  const A = {
    "转义函数 esc() 已定义": /function esc\s*\(/.test(html),
    "URL 地名走白名单 safeLabel()": /safeLabel\(nm\)/.test(html) && /safeLabel\(rg\)/.test(html),
    "旧的 40 字符截断写法已消除": !/State\.name\s*=\s*nm\.slice/.test(html) && !/State\.region\s*=\s*rg\.slice/.test(html),
  };
  HOTSPOTS.forEach(h => { A["热点已转义：" + h] = html.indexOf(h) >= 0; });

  /* ---------- 起浏览器 ---------- */
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "xs-"));
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
  if (!ver) { console.log("CHROME_START_FAIL\n" + cerr.slice(0, 1500)); process.exit(1); }
  const list = await (await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/list")).json();
  const page = list.find(t => t.type === "page") || list[0];
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  /* 掐断一切非本机请求：腾讯地图 SDK 会自己建一批 <img>（控件/精灵图），
     不掐断的话"页面里有几个 img"就成了一个随外部脚本变化的量 —— 判据不可靠。
     这个探针只关心"载荷有没有变成 DOM"，不需要任何外部资源。 */
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  cdp.on(async m => {
    if (m.method !== "Fetch.requestPaused") return;
    const { requestId, request } = m.params;
    try {
      if (request.url.indexOf("http://127.0.0.1:" + PORT) === 0) {
        await cdp.send("Fetch.continueRequest", { requestId });
      } else {
        await cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
      }
    } catch (e) { }
  });

  /* 直接把载荷放进地址栏 —— 这正是"分享链接"的攻击路径。
     注意 readUrl() 只在 http/https 下动作，所以必须走本地服务器而不是 file://。 */
  const url = "http://127.0.0.1:" + PORT + "/?lat=23.1291&lon=113.2644&date=2026-10-12&period=pm"
    + "&name=" + encodeURIComponent(PAYLOAD) + "&region=" + encodeURIComponent(PAYLOAD);
  await cdp.send("Page.navigate", { url: url });
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    const r = await cdp.send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
    if (r.result.value === "complete") break;
  }
  await sleep(400);

  const q = async (expr) => (await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true })).result.value;

  /* ---------- B. 函数行为 ---------- */
  const b = JSON.parse(await q(`(function(){
    function t(f){ try { return f(); } catch (e) { return "THROW:" + e.message; } }
    return JSON.stringify({
      angle: t(function(){ return esc("<img src=x onerror=alert(1)>"); }),
      quote: t(function(){ return esc('a"b' + "'" + 'c'); }),
      amp:   t(function(){ return esc("a&b"); }),
      nulls: t(function(){ return esc(null) + "|" + esc(undefined) + "|" + esc(0); }),
      num:   t(function(){ return esc(12.5); }),
      label: t(function(){ return safeLabel(${JSON.stringify(PAYLOAD)}); }),
      labelKeep: t(function(){ return safeLabel("圣托里尼 Oia · 伊亚"); })
    });
  })()`));
  const B = {
    "esc() 把尖括号转成实体": b.angle === "&lt;img src=x onerror=alert(1)&gt;",
    "esc() 转义引号与 &": b.quote === "a&quot;b&#39;c" && b.amp === "a&amp;b",
    "esc() 对 null/undefined/0 不抛错": b.nulls === "||0",
    "esc() 接受数字": b.num === "12.5",
    /* 判据只盯**真正危险**的五个字符（< > " ' &）—— 括号是白名单里有意保留的
       （地名会出现「华盛顿 (D.C.)」这种写法），把它算进判据会得到一条
       "永远不为真"的断言，那是判据自己的 bug，不是代码的。 */
    "safeLabel() 剥掉真实载荷里的危险字符": typeof b.label === "string" &&
      !/[<>"'&]/.test(b.label) && b.label.length > 0,
    "safeLabel() 不误伤正常地名": b.labelKeep === "圣托里尼 Oia · 伊亚",
  };

  /* ---------- C. 端到端 ---------- */
  const c = JSON.parse(await q(`(function(){
    var out = {};
    out.name = (typeof State !== "undefined") ? State.name : null;
    out.region = (typeof State !== "undefined") ? State.region : null;
    /* 判据必须是"载荷有没有变成 DOM"，而不是"页面里有没有 img" ——
       地图 SDK 自己就会建一批 <img>，按后者写会得到一条与本次改动无关的断言
       （第一版就踩了：8 个 img 全是 SDK 的控件与精灵图）。
       第二版又踩一次：body.innerHTML 里**包含内联 script 的文本**，
       而载荷字符串正好出现在那两段 JS 注释里（源码注释里写着这个例子），
       于是"原始载荷串在 body 里"恒定成立 —— 又是一条恒假的判据。
       所以只查真正的元素层：特定的 src、任何 onerror 属性，
       外加"结果卡容器里没有标签级注入"（容器里的 <svg> 是仪表盘，属正常，故不列）。
       注意这条判据本身是**空的**（页面没算出结果时容器就是空的），
       真正守住注入点的是 A 组的 5 条"热点已转义" —— 两者配对使用。 */
    out.payloadImg = document.querySelectorAll('img[src="1"]').length;
    out.onerrorEls = document.querySelectorAll("[onerror]").length;
    var hero = document.getElementById("hero");
    out.heroInjected = hero ? /<img|<iframe|onerror=/i.test(hero.innerHTML) : false;
    out.title = document.title;
    out.hasEsc = (typeof esc === "function");
    return JSON.stringify(out);
  })()`));
  const C = {
    "URL 里的 name 已被清洗（不含危险字符）": typeof c.name === "string" && !/[<>"'&]/.test(c.name),
    "URL 里的 region 已被清洗": typeof c.region === "string" && !/[<>"'&]/.test(c.region),
    "DOM 里没有载荷元素": c.payloadImg === 0 && c.onerrorEls === 0 && c.heroInjected === false,
    "载荷 URL 下页面仍正常加载": c.title.indexOf("霞光预报") >= 0 && c.hasEsc === true,
  };

  const o = Object.assign({}, A, B, C);

  console.log("=== XSS 防护探针 ===");
  console.log("  载荷：" + PAYLOAD + "（" + PAYLOAD.length + " 字符，正好在旧的 40 字符截断之内）");
  console.log("  readUrl 后 State.name = " + JSON.stringify(c.name));
  console.log("  载荷元素 " + c.payloadImg + " · [onerror] " + c.onerrorEls + " · esc 可用 = " + c.hasEsc);

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
