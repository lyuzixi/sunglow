/* 深色模式探针 —— 只读，零额度，不发任何外部请求。
 *
 * 为什么单独写：深色模式最典型的坏法是**局部没跟上** —— 一块浅色底、一行深色字
 * 压在深底上、原生控件还是白底。它们都不会报错，只会"看着别扭"。
 * 靠肉眼点一遍几十个界面状态既不可靠也不可回归，所以这里把它做成两台扫描仪：
 *
 *   ① **浅色漏网扫描**：遍历视口内所有元素，算出它们**实际呈现的底色**，
 *      找出在深色模式下仍然接近白色的大面积底色 —— 那就是"某个组件漏了令牌"。
 *      同一台扫描仪在浅色模式下必须扫出 0（否则说明判据本身有问题，而不是模式有问题）
 *      —— 这一步叫**扫描器自检**，缺了它，绿灯可能只是"判据永远不会响"。
 *   ② **对比度扫描**：对一批关键文本节点算 WCAG 对比度（正文 ≥4.5 / 大字 ≥3），
 *      专抓"深色字压在深色底上"这类漏覆盖。
 *
 * 另外量：无闪烁的结构保证（引导脚本必须在 <style> 之前）、跟随系统、
 * 显式选择覆盖系统、color-scheme 与 theme-color 同步、持久化、404 页同步、窄屏不溢出。
 *
 * 用法: node _check/darkprobe.js
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 47909;   // 47907 归 consistency.js，别撞
const DEBUG_PORT = 9366;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readF = p => fs.readFileSync(path.join(ROOT, p), "utf8");

function serve() {
  const idx = fs.readFileSync(path.join(ROOT, "index.html"));
  const nf = fs.readFileSync(path.join(ROOT, "404.html"));
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split("?")[0]);
    if (u === "/" || u === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(idx); return;
    }
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" }); res.end(nf);
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

/* ---- 页内扫描体。注意：本段是模板串内部，**注释里绝对不能出现反引号**。 ---- */
const SCAN = `(function(){
  var LUM = function(c){
    var f = function(v){ v = v/255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
    return 0.2126*f(c[0]) + 0.7152*f(c[1]) + 0.0722*f(c[2]);
  };
  var parse = function(s){
    var m = /rgba?\\(([^)]+)\\)/.exec(s || "");
    if (!m) return null;
    var p = m[1].split(",").map(function(x){ return parseFloat(x); });
    if (p.length < 3) return null;
    var a = p.length > 3 ? p[3] : 1;
    return { rgb: [p[0], p[1], p[2]], a: a };
  };
  /* 实际呈现的底色：向上找第一个"基本不透明"的背景（alpha >= .5），
     与自己的底色按 alpha 简单合成一层；找不到就返回白（浏览器默认画布色）。 */
  var bgOf = function(el){
    var stack = [], node = el;
    while (node && node.nodeType === 1) {
      var c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.02) {
        stack.push(c);
        if (c.a >= 0.5) break;
      }
      node = node.parentElement;
    }
    var base = [255, 255, 255];
    for (var i = stack.length - 1; i >= 0; i--) {
      var c = stack[i];
      base = [base[0]*(1-c.a) + c.rgb[0]*c.a, base[1]*(1-c.a) + c.rgb[1]*c.a, base[2]*(1-c.a) + c.rgb[2]*c.a];
    }
    return base;
  };
  var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  var lightBg = [], lowContrast = [], seen = 0;
  var SKIP = ".swatch, #lgBar, .lgBar, .rcL, .rcC, .pin, .logo, .dialbg, #map, canvas, svg, .chipc, .seg2, .mload .spin";
  var all = document.querySelectorAll("body *");
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (el.closest && el.closest(SKIP)) continue;
    var st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || parseFloat(st.opacity) < 0.05) continue;
    var r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 12) continue;
    if (r.bottom < -40 || r.top > vh + 40 || r.right < -40 || r.left > vw + 40) continue;
    seen++;
    var bg = bgOf(el);
    var bl = LUM(bg);
    /* 深色模式下：底色亮度还这么高，就说明这块没吃到令牌 */
    if (bl > 0.55) {
      var tag = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
        (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/)[0] : "");
      if (lightBg.length < 14) lightBg.push(tag + " bg=" + Math.round(bl * 100) / 100 + " " +
        Math.round(r.width) + "x" + Math.round(r.height));
    }
    /* 直接文本的对比度 */
    var txt = "";
    for (var k = 0; k < el.childNodes.length; k++) {
      var n = el.childNodes[k];
      if (n.nodeType === 3) txt += n.nodeValue;
    }
    txt = txt.replace(/\\s+/g, " ").trim();
    if (txt.length < 2) continue;
    var col = parse(st.color);
    if (!col) continue;
    var fg = col, L1 = LUM(fg) + 0.05, L2 = LUM(bg) + 0.05;
    var ratio = L1 > L2 ? L1 / L2 : L2 / L1;
    var fs = parseFloat(st.fontSize), bold = (parseInt(st.fontWeight, 10) || 400) >= 700;
    var need = (fs >= 24 || (fs >= 18.66 && bold)) ? 3 : 4.5;
    if (ratio < need) {
      var tag2 = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
        (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/)[0] : "");
      if (lowContrast.length < 14) lowContrast.push(tag2 + " " + ratio.toFixed(2) + "<" + need +
        " \\"" + txt.slice(0, 18) + "\\"");
    }
  }
  /* 等级徽章：临时插 4 个进 DOM 量一次（它们是按主题取色的语义色，最容易漏） */
  var grades = ["优", "良", "一般", "差"], gradeBad = [];
  var host = document.createElement("div");
  host.style.position = "fixed"; host.style.left = "-9999px"; host.style.top = "0";
  document.body.appendChild(host);
  for (var g = 0; g < grades.length; g++) {
    var s = document.createElement("span");
    s.className = "grade g-" + grades[g];
    s.textContent = grades[g];
    host.appendChild(s);
    var cs = getComputedStyle(s), b2 = bgOf(s), c2 = parse(cs.color);
    var l1 = LUM(c2.rgb) + 0.05, l2 = LUM(b2) + 0.05;
    var rt = l1 > l2 ? l1 / l2 : l2 / l1;
    if (rt < 4.5) gradeBad.push(grades[g] + " " + rt.toFixed(2));
  }
  host.remove();
  return JSON.stringify({
    theme: document.documentElement.getAttribute("data-theme"),
    pref: document.documentElement.getAttribute("data-theme-pref"),
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    seen: seen, lightBg: lightBg, lowContrast: lowContrast, gradeBad: gradeBad,
    vw: vw, sw: document.documentElement.scrollWidth,
    metas: Array.prototype.map.call(document.querySelectorAll('meta[name="theme-color"]'), function(m){
      return m.getAttribute("content") + "|" + m.getAttribute("media");
    })
  });
})()`;

(async function main() {
  const html = readF("index.html");

  /* ---------- S. 结构（静态） ---------- */
  const iStyle = html.indexOf("<style>");
  const iBoot = html.indexOf("<script>", 0);
  const bootSeg = html.slice(iBoot, html.indexOf("</script>", iBoot));
  const deepBlock = /html\[data-theme="dark"\]\s*\{[\s\S]*?--bg:#11151c/.test(html);
  /* 令牌化完成度哨兵：CSS 里允许剩下的硬编码色只应是品牌渐变、地图叠加、
     色阶条这些"本来就不该跟主题走"的东西。数字变大 = 有人又写了硬编码色。 */
  const cssBlock = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  /* 只数**令牌块之外**的硬编码色：:root 与深色块里全是颜色定义，它们正是"收敛"的产物，
     算进去等于用"令牌多"去否定"令牌化成功"。剥掉两块之后剩下的才是真漏网
     （品牌渐变、地图叠加的白描边、底图压暗层……这些本来就不该跟主题走）。 */
  const cssNoTokens = cssBlock
    .replace(/:root\{[\s\S]*?\n\}/, "")
    .replace(/html\[data-theme="dark"\]\{[\s\S]*?\n\}/, "");
  const hardcoded = (cssNoTokens.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || []).length;
  const S = {
    "引导脚本在 <head> 且早于 <style>（无闪烁的结构保证）": iBoot > 0 && iStyle > 0 && iBoot < iStyle,
    "引导脚本自包含（不依赖 i18n()/prefRead 等外部函数）":
      bootSeg.indexOf("i18n(") < 0 && bootSeg.indexOf("prefRead(") < 0 && bootSeg.indexOf("softWarn(") < 0,
    "CSS 里有深色令牌块 html[data-theme=dark]": deepBlock,
    "两条 theme-color meta（浅/深各一）": (html.match(/<meta name="theme-color"/g) || []).length === 2,
    "令牌块之外的硬编码色已收敛（≤45 处）": hardcoded <= 45
  };

  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "dk-"));
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
  if (!ver) { console.log("CHROME_START_FAIL\n" + cerr.slice(0, 1200)); process.exit(1); }
  const list = await (await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/list")).json();
  const page = list.find(t => t.type === "page") || list[0];
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  /* 掐断外部请求：本探针只关心配色，不需要地图 SDK / 接口 */
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  cdp.on(async m => {
    if (m.method !== "Fetch.requestPaused") return;
    const { requestId, request } = m.params;
    try {
      await (request.url.indexOf("http://127.0.0.1:" + PORT) === 0
        ? cdp.send("Fetch.continueRequest", { requestId })
        : cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }));
    } catch (e) { }
  });
  const q = async (expr) => (await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true })).result.value;
  const setSys = async (v) => cdp.send("Emulation.setEmulatedMedia",
    { features: [{ name: "prefers-color-scheme", value: v }] });
  async function go(url) {
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + url });
    for (let i = 0; i < 60; i++) {
      await sleep(200);
      if (await q("document.readyState") === "complete") break;
    }
    await sleep(350);
  }
  const scan = async () => JSON.parse(await q(SCAN));
  const pick = async (k) => { await q('document.querySelector(\'#themeSeg button[data-theme-k="' + k + '"]\').click()'); await sleep(250); };

  /* ---------- B/C. 跟随系统 / 显式覆盖 ---------- */
  await setSys("dark");
  await go("/");
  const autoDark = await scan();
  await setSys("light");
  await go("/");
  const autoLight = await scan();

  await setSys("dark");
  await go("/");
  await pick("light");
  const forcedLight = await scan();
  await setSys("light");
  await go("/");
  await pick("dark");
  const forcedDark = await scan();

  /* 深色下的两台扫描仪 */
  await go("/");
  const darkScan = await scan();
  /* 对着色的对照：浅色下同一台扫描器必须干净（否则是判据的问题） */
  await pick("light");
  const lightScan = await scan();

  /* ---------- F. 持久化 ----------
     用一条**干净序列**测：清盘 → 重载 → 点深色 → 重载。
     直接接着前面的 pick 序列测会混进"上一次点击"的影响，定位不到是哪一步断的。 */
  await go("/");
  await q("localStorage.clear()");
  await go("/");
  await pick("dark");
  const afterClick = await scan();
  const lsAfterClick = await q("localStorage.getItem('sunsetbot.pref.v1')");
  await go("/");
  const persisted = await scan();
  const lsAfterReload = await q("localStorage.getItem('sunsetbot.pref.v1')");
  console.log("  【诊断】点击后 pref=" + afterClick.pref + " theme=" + afterClick.theme +
    " 盘=" + lsAfterClick + " ｜ 重载后 pref=" + persisted.pref + " theme=" + persisted.theme +
    " 盘=" + lsAfterReload);
  /* 切回"跟随系统"之后，**两个方向都要测**：把模拟系统分别设成浅/深再看页面跟不跟。
     只测一个方向是不行的 —— 那样断言会暗含"当时系统恰好在某一侧"的假设，
     而前面的用例早就把模拟系统改过了（第一版就这么栽的：期望 dark，实际系统是 light）。 */
  await pick("auto");
  await setSys("light"); await go("/"); const autoFollowL = await scan();
  await setSys("dark"); await go("/"); const autoFollowD = await scan();

  /* ---------- H. 窄屏 ---------- */
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await pick("dark");
  const narrowDark = await scan();
  await cdp.send("Emulation.clearDeviceMetricsOverride");

  /* ---------- G. 404 页 ---------- */
  await setSys("dark");
  await go("/no/such/path");
  const nfDark = await scan();

  const B = {
    "系统深色时 data-theme 自动为 dark": autoDark.theme === "dark" && autoDark.pref === "auto",
    "系统浅色时 data-theme 自动为 light": autoLight.theme === "light",
    "系统深色下显式选浅色 → light（用户选择压过系统）": forcedLight.theme === "light" && forcedLight.pref === "light",
    "系统浅色下显式选深色 → dark": forcedDark.theme === "dark" && forcedDark.pref === "dark",
    "color-scheme 与 data-theme 一致（原生控件不会白底）":
      forcedDark.colorScheme.indexOf("dark") >= 0 && forcedLight.colorScheme.indexOf("light") >= 0,
    "theme-color 只放行与当前主题匹配的那条":
      forcedDark.metas.filter(x => x.indexOf("|all") >= 0).length === 1 &&
      forcedDark.metas.filter(x => x.indexOf("#11151c|all") >= 0).length === 1,
    "深色下没有浅色底漏网（扫描器抓到 0 处）": darkScan.lightBg.length === 0,
    "深色下关键文本对比度全部达标": darkScan.lowContrast.length === 0,
    "深色下四级等级徽章对比度达标": darkScan.gradeBad.length === 0,
    "扫描器自检：浅色下能扫出大量浅色底（判据不是恒真）": lightScan.lightBg.length >= 5,
    "选择被持久化（重载后仍是深色）": persisted.theme === "dark",
"跟随系统”真的两头都跟（系统浅→浅、系统深→深）":
      autoFollowL.theme === "light" && autoFollowL.pref === "auto" &&
      autoFollowD.theme === "dark" && autoFollowD.pref === "auto",
    "深色 + 390 窄屏不横向溢出": narrowDark.sw <= narrowDark.vw + 1,
    "404 页也吃到深色（同一套令牌与引导）": nfDark.theme === "dark" && nfDark.lightBg.length === 0
  };
  const o = Object.assign({}, S, B);

  console.log("=== 深色模式探针 ===");
  console.log("  系统 " + (await q("window.matchMedia('(prefers-color-scheme: dark)').matches") ? "dark" : "light") +
    " · 重载后 theme=" + persisted.theme + " pref=" + persisted.pref +
    " · localStorage=" + (await q("localStorage.getItem('sunsetbot.pref.v1')")));
  console.log("  CSS 硬编码色 " + hardcoded + " 处 · 扫描元素 " + darkScan.seen + " 个（深色）");
  console.log("  深色扫描：" + darkScan.lightBg.length + " 处浅色底 · " +
    darkScan.lowContrast.length + " 处低对比 · 徽章 " + darkScan.gradeBad.length + " 处不达标");
  if (darkScan.lightBg.length) darkScan.lightBg.forEach(x => console.log("    · 浅底 " + x));
  if (darkScan.lowContrast.length) darkScan.lowContrast.forEach(x => console.log("    · 低对比 " + x));
  if (darkScan.gradeBad.length) darkScan.gradeBad.forEach(x => console.log("    · 徽章 " + x));
  if (lightScan.lightBg.length || lightScan.lowContrast.length) {
    console.log("  浅色对照（应干净）：" + lightScan.lightBg.length + " 浅底 / " + lightScan.lowContrast.length + " 低对比");
  }
  if (nfDark.lightBg.length) nfDark.lightBg.forEach(x => console.log("    · 404 浅底 " + x));

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
