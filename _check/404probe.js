/* 404 页探针 —— 只读，零额度，不发任何外部请求。
 *
 * 为什么单独写：纯静态站**没有前端路由**，404 只能靠托管平台那条约定 ——
 * 路径匹配不到任何文件时，取站点根下的 `404.html` 并以 404 状态返回。
 * 这条链路有三件事是肉眼在开发环境里**永远看不到的**：
 *   ① 页面是在**任意深度**的 URL 下被返回的（/a/b/c 也算），页内地址一旦写成
 *      相对形式就会按请求路径解析 —— 越深的错链错得越离谱；
 *   ② 它被各种奇怪客户端打开（爬虫、被拦截了 JS 的浏览器），所以"没有 JS 也能
 *      回首页"是硬要求，而"返回上一页"反过来**必须**依赖 JS 判断有没有上一页；
 *   ③ 桌面与窄屏都得显示正常，而窄屏那条（顶部条单行、按钮竖排、不横向溢出）
 *      是本项目踩过最多的一条。
 *
 * 量四组：
 *   S. 静态：产物里不能残留占位符、不能有任何外部引用（这页要能独立打开）
 *   T. 令牌：`:root` 与主页逐字一致（404 页最容易悄悄跟主页配色脱节）
 *   D. 桌面 1440×900：深路径渲染 / 路径行转义 / 首页链接指向站点根 / 零外部请求
 *   M. 窄屏 390×844：不横向溢出 / 按钮通栏 / 顶部条单行 / 卡片在首屏
 *   B. 出口：从首页进 → 「返回上一页」显形 → 点了真的回到首页
 *
 * 用法: node _check/404probe.js
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 47899;
const DEBUG_PORT = 9360;
/* 站点根**由构建好的 404.html 自己声明**（构建期注入的 `__SITE_BASE__`），
   不写死 "/" —— 部署在子路径下时（GitHub Pages 的项目页 = `/仓库名/`），页内地址
   必须写成 `/仓库名/`，否则"返回首页"会跳到域名根（那是**别人的**站点）。
   探针跟着产物走，两种部署形态才能测到同一条性质；
   写死 "/" 的话，一旦按子路径构建，这条断言就会变成假失败。 */
const SITE_BASE = (function () {
  const m = readProduct().match(/data-home="([^"]*)"/);
  return (m && m[1] && m[1][0] === "/" && m[1].slice(-1) === "/") ? m[1] : "/";
})();
const HOME = SITE_BASE;
const MISS = "/a/b/c-d?x=1&y=2";
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------------- 静态检查 */

function readProduct() {
  const p = path.join(ROOT, "404.html");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

/* 主页与 404 页的 :root 令牌块必须逐字一致 —— 404 页是"站点的一部分"，
   配色漂移是这类页面最常见的慢性死亡方式。 */
function rootTokens(src) {
  const m = src.match(/:root\s*\{([\s\S]*?)\}/);
  return m ? m[1].replace(/\s+/g, "") : null;
}

/* ---------------------------------------------------------------- 服务器桩
 * 只认两个文件：站点根 → index.html，其它一律**以 404 状态**返回 404.html。
 * 这就是 Cloudflare Pages / GitHub Pages 对纯静态站的行为，本地把它复刻出来，
 * 深路径那条链路才测得到（直接打开 file:// 或者 /404.html 都测不到）。 */
function serve() {
  const idx = fs.readFileSync(path.join(ROOT, "index.html"));
  const nf = fs.readFileSync(path.join(ROOT, "404.html"));
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split("?")[0]);
    if (u === HOME || u === "/index.html" || u === HOME + "index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(idx);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(nf);
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

/* ---------------------------------------------------------------- 页内审计 */

const AUDIT = `(function(){
  var de = document.documentElement;
  function q(s){ return document.querySelector(s); }
  function box(el){ if(!el) return null; var b = el.getBoundingClientRect();
    return {x:b.x, y:b.y, w:b.width, h:b.height, right:b.right, bottom:b.bottom}; }
  var home = document.getElementById('btnHome');
  var back = document.getElementById('btnBack');
  var pathBox = document.getElementById('missPath');
  var hb = box(home), bb = box(back);
  var vh = de.clientHeight;
  return {
    title: document.title,
    code: (q('.nf-code')||{}).textContent ? q('.nf-code').textContent.trim() : null,
    h2: (q('.nf h2')||{}).textContent ? q('.nf h2').textContent.trim() : null,
    badge: (q('.badge')||{}).textContent ? q('.badge').textContent.trim() : null,
    pathShown: !!(pathBox && !pathBox.hidden),
    pathTx: (document.getElementById('missPathTx')||{}).textContent || null,
    homeHref: home ? home.href : null,
    homeAttr: home ? home.getAttribute('href') : null,
    backHidden: back ? back.hidden : null,
    vw: de.clientWidth, sw: de.scrollWidth, vh: vh,
    topH: box(q('.top-in')) ? box(q('.top-in')).h : null,
    nfTop: box(q('.nf')) ? box(q('.nf')).y : null,
    homeBox: hb, backBox: bb,
    /* 两个按钮都得**能点到**：在视口内、有尺寸。窄屏整页不该出现要滚动才够得着的出口。 */
    homeUsable: !!hb && hb.w > 40 && hb.h > 30 && hb.y >= 0 && hb.bottom <= vh,
    backUsable: !!bb && bb.w > 40 && bb.h > 30 && bb.y >= 0 && bb.bottom <= vh,
    /* 竖排通栏：两个按钮等宽且都贴住卡片内容区（窄屏那条媒体查询的实际效果） */
    sameWidth: !!hb && !!bb && Math.abs(hb.w - bb.w) <= 1
  };
})()`;

(async function main() {
  const html = readProduct();
  const tplMain = fs.readFileSync(path.join(ROOT, "tpl", "template.html"), "utf8");
  const tpl404 = fs.readFileSync(path.join(ROOT, "tpl", "404.html"), "utf8");

  /* ---------- S. 静态 ---------- */
  const holes = ["__ICON_SVG__", "__ICON_PNG180__", "__SITE_BASE__"].filter(h => html.indexOf(h) >= 0);
  /* 这页会被套在任意路径下返回，**不允许有任何外部引用**：
     · 相对地址会按请求路径解析（/a/b → /a/x.css），等于没有；
     · 外部地址则让这页在网络不通时变成一张白板。图标一律内联（与主页同款）。 */
  const extRefs = (html.match(/(?:src|href)\s*=\s*["']https?:\/\//gi) || []);
  const aHome = (html.match(/<a\b[^>]*id="btnHome"[^>]*>/) || [null])[0];
  const bBack = (html.match(/<button\b[^>]*id="btnBack"[^>]*>/) || [null])[0];
  const s = {
    "产物 404.html 存在且非空": html.length > 2000,
    "产物里没有未替换的占位符": holes.length === 0,
    "产物不含任何外部引用（自包含）": extRefs.length === 0,
    "设计令牌 :root 与主页逐字一致": rootTokens(tpl404) !== null &&
      rootTokens(tpl404) === rootTokens(tplMain),
    /* 主出口必须是 <a href>（没有 JS 也能回首页），次出口必须是默认 hidden 的 <button>
       —— 它要靠 JS 确认"确实有上一页"才显形，写死在 HTML 里会在新标签页把人扔去空白页。 */
    "主出口是真链接、次出口默认隐藏": !!aHome && /href="[^"]+"/.test(aHome) &&
      !!bBack && /\bhidden\b/.test(bBack),
  };

  /* ---------- 起浏览器 ---------- */
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "nf-"));
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
  let extHits = 0;                       // 非本机的请求数（404 页必须是 0）
  const blocked = [];                    // 被掐断的地址（最多留 8 条，供诊断）
  cdp.on(m => {
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errs.push((m.params.args || []).map(a => a.value === undefined ? a.description : a.value).join(" "));
    } else if (m.method === "Runtime.exceptionThrown") {
      errs.push((m.params.exceptionDetails || {}).text || "exception");
    }
  });

  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  cdp.on(async m => {
    if (m.method !== "Fetch.requestPaused") return;
    const { requestId, request } = m.params;
    try {
      if (request.url.indexOf("http://127.0.0.1:" + PORT) === 0) {
        await cdp.send("Fetch.continueRequest", { requestId });
      } else {
        extHits++;                        // 记下来，并掐断 —— 探针不该碰真实网络
        if (blocked.length < 8) blocked.push(request.url);
        await cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
      }
    } catch (e) { }
  });

  async function go(url) {
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + url });
    for (let i = 0; i < 60; i++) {
      await sleep(200);
      const r = await cdp.send("Runtime.evaluate", {
        expression: "document.readyState", returnByValue: true
      });
      if (r.result.value === "complete") break;
    }
    await sleep(300);
  }
  async function audit() {
    const r = await cdp.send("Runtime.evaluate", { expression: AUDIT, returnByValue: true });
    return r.result.value;
  }
  async function metrics(w, h, mobile) {
    await cdp.send("Emulation.setDeviceMetricsOverride",
      { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile });
    if (mobile) await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  }

  /* ---------- D. 桌面 ---------- */
  await metrics(1440, 900, false);
  extHits = 0;
  await go(MISS);
  const D = await audit();
  const errs404 = errs.length;
  /* 计数器必须**当场**取值：下面 B 组要载入两次首页，而首页会真的去取气象数据
     （被掐断、会被计进 extHits）。先前是到最后才读，等于把"首页的请求"算在
     "404 页零外部请求"头上 —— 靠"首页请求还没发出来就被导航取消"侥幸通过，
     机器一忙就翻红。这类"判据口径和名字对不上"的断言比起它漏测更危险。 */
  const dExt = extHits;

  /* ---------- B. 出口：从首页进来 → 返回上一页 ---------- */
  await go(HOME);                                  // 制造一条"上一页"
  const homeOk = await cdp.send("Runtime.evaluate", {
    expression: "!!document.querySelector('.top h1') && document.querySelector('.top h1').textContent.indexOf('霞光预报') >= 0",
    returnByValue: true
  });
  await go(MISS);
  const B = await audit();
  await cdp.send("Runtime.evaluate", { expression: "document.getElementById('btnBack').click()" });
  let backTo = null;
  for (let i = 0; i < 40; i++) {
    await sleep(200);
    const r = await cdp.send("Runtime.evaluate", { expression: "location.pathname", returnByValue: true });
    if (r.result.value === HOME) { backTo = r.result.value; break; }
  }

  /* ---------- M. 窄屏 ---------- */
  await metrics(390, 844, true);
  extHits = 0;
  await go(MISS);
  const M = await audit();
  const mExt = extHits;                            // 同上：当场取值

  const o = Object.assign({}, s, {
    /* D 组 */
    "深路径下渲染出来的就是 404 页": D.code === "404" && /找不到/.test(D.h2 || ""),
    "顶部条沿用主页那一条（badge 写明 404）": /404/.test(D.badge || ""),
    "请求路径显示正确（转义后原样呈现）": D.pathShown && D.pathTx === MISS,
    "首页链接指向站点根（绝对形式，不随请求路径漂）":
      /^\/.*\/$/.test(D.homeAttr || "") && D.homeAttr === SITE_BASE &&
      D.homeHref === "http://127.0.0.1:" + PORT + SITE_BASE,
    "两个出口在桌面视口内都可点": D.homeUsable && D.backUsable,
    "桌面无横向溢出（scrollWidth ≤ clientWidth）": D.sw <= D.vw + 1,
    "404 页零外部请求": dExt === 0,
    "404 页无控制台报错": errs404 === 0,
    /* B 组 */
    "首页能正常打开（回得去的地方是好的）": homeOk.result.value === true,
    "有上一页时「返回上一页」显形": B.backHidden === false,
    "点「返回上一页」真的回到上一页": backTo === HOME,
    /* M 组 */
    "窄屏无横向溢出（参照 documentElement.clientWidth）": M.sw <= M.vw + 1,
    "窄屏两个按钮竖排通栏（等宽且不越界）": M.sameWidth && M.homeUsable &&
      M.backUsable && M.homeBox.right <= M.vw + 1,
    /* 顶部条单行：34px 语言按钮 + 上下 8px = 50px（2026-10-19 语言入口进顶栏后的
       设计值，与主页 pwaprobe 的 52 同一条线）。换行会直接翻到 90px 左右。 */
    "窄屏顶部条仍是单行": M.topH !== null && M.topH <= 52,
    "窄屏 404 卡片在首屏内": M.nfTop !== null && M.nfTop < M.vh,
    "窄屏仍零外部请求": mExt === 0,
  });

  console.log("=== 404 页探针 ===");
  console.log("  产物 " + Buffer.byteLength(html, "utf8") + " 字节 · 站点根 " + JSON.stringify(D.homeAttr));
  console.log("  桌面 " + D.vw + "×" + D.vh + "  · scrollWidth " + D.sw
    + " · 路径行 " + JSON.stringify(D.pathTx));
  console.log("  窄屏 " + M.vw + "×" + M.vh + "  · scrollWidth " + M.sw
    + " · 顶部条 " + Math.round(M.topH) + "px · 按钮宽 " + Math.round(M.homeBox.w) + "px");
  console.log("  外部请求 404页 " + dExt + " / 窄屏 " + mExt + " · 控制台错误 " + errs404);

  console.log("\n--- 断言 ---");
  let fail = 0;
  for (const k of Object.keys(o)) {
    if (!o[k]) { console.log("  FAIL " + k); fail++; } else console.log("  ok   " + k);
  }
  if (errs.length) { console.log("  控制台错误 " + errs.length + " 条："); errs.slice(0, 5).forEach(e => console.log("    " + e)); }
  /* 真被外部请求打中时，把地址摊出来 —— 否则只知道"非零"，无从查起。
     注意 blocked 也含 B 组载入首页时的气象请求（那是预期的，不计入 dExt/mExt）。 */
  if (blocked.length) {
    console.log("  被掐断的地址 " + blocked.length + " 条（含 B 组首页取数，预期）：");
    blocked.forEach(u => console.log("    " + u));
  }
  console.log("\nFAIL 计数: " + fail);
  console.log('FACTS {"assertions":' + Object.keys(o).length + ',"fail":' + fail + '}');
  try { chrome.kill(); } catch (e) { }
  srv.close();
  process.exit(fail);
})().catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
