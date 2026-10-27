/* F1 探针 —— 离线可用（PWA 化）。
 *
 * F1 与本项目的一个核心约束正面冲突：**产物必须是单文件**。而 PWA 物理上做不到
 * 单文件（SW 的注册脚本必须是同源 http(s) 的真实 URL，blob:/data: 一律被拒），
 * 所以设计成 `PWA=1` 的**可选产物**。这个探针于是有两组性质要同时守住：
 *   A. 默认构建**仍然**是单文件（无 manifest、无占位符残留、脚本块数不变）；
 *   B. PWA 构建真能离线打开，且**绝不缓存气象响应**。
 * 只测 B 不测 A，等于悄悄把单文件约束丢掉了。
 *
 * 离线那一半用**真实浏览器**测：起 SW → reload 让它接管 → CDP 切 offline →
 * 再 reload。断言"页面还能打开"而不是"SW 文件存在" —— 后者测不到任何真东西。
 *
 * 用法: node _check/pwaprobe.js
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PY = process.env.PY || "python";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 47941;
const DEBUG_PORT = 9384;
const DIR_PWA = path.join(ROOT, "_scratch", "pwa");
const DIR_PLAIN = path.join(ROOT, "_scratch", "pwa-plain");
const DIR_SUB = path.join(ROOT, "_scratch", "pwa-sub");
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 构建三套产物 ----------
 * **环境里的构建开关必须清掉**（2026-10-19 踩过）：`SITE_BASE=sunglow python _check/all.py`
 * 是部署约定（docfacts 比对的正是那样构建出来的字节数），于是探针也继承了这个变量 ——
 * `build({PWA:"1"}, DIR_PWA)` 名义上构建"站点根 /"的那套，实际被构建成了子路径版。
 * C 组用 `/` 起服务，页面却去注册 `/sunglow/sw.js` ⇒ 注册 404 ⇒
 * "SW 没装上 / 离线打不开"五条一起红，而错误信息指向的方向完全不对。
 * 现在显式清掉 PWA / SITE_BASE / OUT_DIR，逐次按调用方意图设置。 */
function build(env, dir) {
  const base = Object.assign({}, process.env);
  delete base.SITE_BASE;
  delete base.PWA;
  delete base.OUT_DIR;
  const e = Object.assign(base, { SITE_BASE: "/" }, env, { OUT_DIR: dir });
  const r = spawnSync(PY, ["assemble.py"], { cwd: ROOT, env: e, encoding: "utf8" });
  if (r.status !== 0) {
    console.log("BUILD FAIL %s\n%s\n%s", dir, r.stdout || "", r.stderr || "");
    process.exit(1);
  }
  return r.stdout || "";
}
function rd(p) { return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : ""; }
function pngSize(p) {
  const b = fs.readFileSync(p);
  if (b.slice(0, 8).toString("binary") !== "\x89PNG\r\n\x1a\n") return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}
function inlineBlocks(html) {
  return (html.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || []).length;
}
function sha12(buf) { return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12); }

/* ---------- 静态服务器：把一个目录当站点根 ---------- */
function serve(dir) {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split("?")[0]);
    const rel = u === "/" ? "index.html" : u.replace(/^\/+/, "");
    const f = path.join(dir, rel);
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(path.join(dir, "404.html")));
      return;
    }
    const type = /\.png$/.test(f) ? "image/png"
      : /\.js$/.test(f) ? "application/javascript"
        : /\.json$/.test(f) ? "application/manifest+json"
          : "text/html; charset=utf-8";
    res.writeHead(200, { "Content-Type": type });
    res.end(fs.readFileSync(f));
  });
  return new Promise(r => srv.listen(PORT, "127.0.0.1", () => r(srv)));
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pend = new Map(); this.handlers = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws")); });
    const c = new CDP(ws);
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pend.has(m.id)) { const p = c.pend.get(m.id); c.pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
      else if (m.method) c.handlers.forEach(h => h(m));
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
  console.log("=== F1 离线 / PWA 探针 ===");
  /* ---------- A. 构建 ---------- */
  build({}, DIR_PLAIN);                                   // 默认（不带 PWA）
  build({ PWA: "1" }, DIR_PWA);                            // PWA，站点根 /
  const subOut = build({ PWA: "1", SITE_BASE: "sunglow" }, DIR_SUB);   // PWA，子路径

  const plain = rd(path.join(DIR_PLAIN, "index.html"));
  const pwaHtml = rd(path.join(DIR_PWA, "index.html"));
  const subHtml = rd(path.join(DIR_SUB, "index.html"));
  const manTxt = rd(path.join(DIR_PWA, "manifest.json"));
  const subManTxt = rd(path.join(DIR_SUB, "manifest.json"));
  const swTxt = rd(path.join(DIR_PWA, "sw.js"));
  let man = null, subMan = null;
  try { man = JSON.parse(manTxt); } catch (e) { }
  try { subMan = JSON.parse(subManTxt); } catch (e) { }

  /* 判"有没有 manifest 链接"必须**先剥掉 HTML 注释**：模板里那段解释 PWA_HEAD
     占位符的注释就写着 `<link rel="manifest">` 这几个字，直接全文匹配会命中它
     —— 扫描器把注释算进去，是这类"文本扫描型判据"最经典的假阳性
     （darkprobe 那次是扫到了令牌块本身，同一个坑）。 */
  const stripComments = h => h.replace(/<!--[\s\S]*?-->/g, "");
  const hasManifestLink = h => /<link\s+rel="manifest"/i.test(stripComments(h));
  const icon192 = pngSize(path.join(DIR_PWA, "icon-192.png"));
  const icon512 = pngSize(path.join(DIR_PWA, "icon-512.png"));
  /* SW 的缓存版本必须**等于**当前产物的 sha256 前 12 位 —— 这是"内容一变缓存就作废"
     的机读判据，比"字符串里有个版本号"强得多。 */
  const wantBid = sha12(Buffer.from(pwaHtml, "utf8"));
  const mBid = swTxt.match(/var\s+CACHE\s*=\s*'sunglow-([0-9a-f]+)'/);
  const bidOk = !!mBid && mBid[1] === wantBid;
  /* 同理：sw.js 的文件头注释里提到了 `_TMapService`，全文匹配必然命中。
     只取 PRECACHE 这个数组字面量来看 —— 那才是真正决定"缓存什么"的东西。 */
  const mPc = swTxt.match(/var\s+PRECACHE\s*=\s*\[([\s\S]*?)\]/);
  const precacheHasApi = !mPc || /open-meteo|map\.qq|_TMapService|datav/i.test(mPc[1]);

  /* ---------- B. 浏览器端到端 ---------- */
  const srv = await serve(DIR_PWA);
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "pwa-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + DEBUG_PORT, "--user-data-dir=" + udd,
    "--window-size=1440,1200", "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let ver = null;
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    try { ver = await (await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/version")).json(); break; } catch (e) { }
  }
  if (!ver) { console.log("CHROME_START_FAIL"); process.exit(1); }
  const list = await (await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/list")).json();
  const cdp = await CDP.connect((list.find(t => t.type === "page") || list[0]).webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Network.enable");

  /* 气象请求照旧用合成数据回填；地图等外部请求一律挡掉（它们本就不该被缓存） */
  const meteo = [];
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  cdp.on(async m => {
    if (m.method !== "Fetch.requestPaused") return;
    const { requestId, request } = m.params;
    try {
      if (request.url.indexOf("http://127.0.0.1:" + PORT) === 0) {
        await cdp.send("Fetch.continueRequest", { requestId }); return;
      }
      if (/open-meteo\.com/.test(request.url)) {
        meteo.push(request.url);
        await cdp.send("Fetch.failRequest", { requestId, errorReason: "Failed" });
        return;
      }
      await cdp.send("Fetch.failRequest", { requestId, errorReason: "Failed" });
    } catch (e) { }
  });

  const q = async e => (await cdp.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result.value;
  async function go(u) {
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + (u || "/") });
    for (let i = 0; i < 60; i++) { await sleep(200); if (await q("document.readyState") === "complete") break; }
    await sleep(500);
  }
  const offline = async on => cdp.send("Network.emulateNetworkConditions",
    { offline: !!on, latency: 0, downloadThroughput: on ? 0 : -1, uploadThroughput: on ? 0 : -1 });

  /* ① 在线：起 SW */
  await go("/");
  let swState = null;
  for (let i = 0; i < 60; i++) {
    swState = await q(`(async()=>{ if(!('serviceWorker' in navigator)) return 'none';
      const r = await navigator.serviceWorker.getRegistration();
      return r ? (r.active ? 'activated' : (r.installing ? 'installing' : (r.waiting ? 'waiting' : '?'))) : 'no-reg'; })()`);
    if (swState === "activated") break;
    await sleep(400);
  }
  /* ② reload 让它接管（首次加载 controller 是 null，这是 SW 的既定行为） */
  await go("/");
  await sleep(800);
  const controlled = await q("!!navigator.serviceWorker.controller");
  const cacheNames = await q(`(async()=>{ const ks = await caches.keys(); return JSON.stringify(ks); })()`);

  /* ③ 在线时跑一次取数（让气象请求真的发出去），随后查缓存里有没有它 */
  const hadMeteo = meteo.length;
  await q(`(function(){ const d=new Date(Date.now()+3*86400000);
    document.querySelector('#date').value = d.toISOString().slice(0,10); saveDate(); })()`);
  await sleep(2500);
  const meteoSeen = meteo.length - hadMeteo;
  const cacheUrls = JSON.parse(await q(`(async()=>{
    const ks = await caches.keys(); const out = [];
    for (const k of ks) { const c = await caches.open(k); const rs = await c.keys();
      rs.forEach(r => out.push(r.url)); }
    return JSON.stringify(out); })()`));
  const cachedMeteo = cacheUrls.filter(u => /open-meteo|map\.qq|_TMapService|datav/i.test(u)).length;

  /* ④ 切离线 → reload：页面必须还能打开 */
  await offline(true);
  await go("/");
  const offOk = await q(`!!document.querySelector('.top h1') &&
    document.querySelector('.top h1').textContent.indexOf('霞光预报') >= 0`);
  const offNav = await q(`!!document.querySelector('.top h1')`);
  const bar = await q(`(function(){ var b=document.querySelector('#netBar');
    return JSON.stringify({ hidden: b.hidden, txt: b.textContent || '' }); })()`);
  const barInfo = JSON.parse(bar || "{}");

  /* ⑤ 离线时点「开始预报」：必须给**离线专属**文案，而不是"稍候 1 分钟重试" */
  await q(`(function(){ const d=new Date(Date.now()+6*86400000);
    document.querySelector('#date').value = d.toISOString().slice(0,10); saveDate(); })()`);
  await sleep(3000);
  const heroOff = await q("(document.querySelector('#hero')||{}).textContent || ''");

  /* ⑥ 窄屏：离线提示条不能把顶栏挤成两行（约束 44）。
     上限 52：2026-10-19 grill 定稿顶栏加高后手机档设计值 50px
     （汉堡 34 + 上下 8px padding），360 下限探针的 8% 线是 51.2 —— 同一条线。 */
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  const topH = await q("Math.round((document.querySelector('.top-in')||{getBoundingClientRect:()=>({height:0})}).getBoundingClientRect().height)");
  const swNarrow = await q("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1");
  await cdp.send("Emulation.clearDeviceMetricsOverride");

  /* ⑦ 恢复在线：提示条消失 */
  await offline(false);
  await sleep(600);
  const barAfter = await q("document.querySelector('#netBar').hidden");

  const A = {
    "A 默认构建仍无 manifest 链接（单文件约束保持）": !hasManifestLink(plain),
    "A 默认构建无 PWA 占位符残留": plain.indexOf("__PWA_HEAD__") < 0 && plain.indexOf("__SITE_BASE__") < 0,
    "A 默认构建的内联脚本块数仍是 4（新增 PWA 没多出块）": inlineBlocks(plain) === 4,
    "A 默认构建目录里只有 index.html 与 404.html 两个产物":
      fs.readdirSync(DIR_PLAIN).filter(n => !/^(index|404)\.html$/.test(n)).length === 0,
    "B manifest.json 是合法 JSON 且字段齐全":
      !!man && !!man.name && !!man.short_name && !!man.start_url && !!man.scope &&
      man.display === "standalone" && Array.isArray(man.icons) && man.icons.length >= 2,
    "B 图标是真 PNG 且尺寸为 192 / 512":
      !!icon192 && icon192[0] === 192 && icon192[1] === 192 &&
      !!icon512 && icon512[0] === 512 && icon512[1] === 512,
    "B manifest 的 start_url / scope 随 SITE_BASE 走（子路径部署）":
      !!subMan && subMan.start_url === "/sunglow/" && subMan.scope === "/sunglow/" &&
      /href="\/sunglow\/manifest\.json"/.test(subHtml),
    "B sw.js 的缓存版本 == 产物内容的 sha256 前 12 位（内容变 ⇒ 缓存自动作废）": bidOk,
    "B sw.js 的预缓存名单里没有任何接口域名": precacheHasApi === false,
    "C SW 在真实浏览器里装上了并进入 activated": swState === "activated",
    "C reload 后 SW 真的接管了页面（controller 非空）": controlled === true,
    "C 离线后仍能打开页面（SW 从缓存应答 —— 这是 F1 的全部意义）": offOk === true && offNav === true,
    "C 离线时显示离线提示条": barInfo.hidden === false && /离线/.test(barInfo.txt || ""),
    "C 离线时取数失败给的是**离线专属**文案（不是「稍候 1 分钟重试」）":
      /离线状态/.test(heroOff) && !/稍候约 1 分钟/.test(heroOff),
    "C 气象响应**一个都没进** SW 缓存（过期预报比没预报更危险）":
      meteoSeen >= 1 && cachedMeteo === 0,
    "C 缓存里只有同源的预缓存名单（无越界条目）":
      cacheUrls.length > 0 && cacheUrls.every(u => u.indexOf("http://127.0.0.1:" + PORT) === 0),
    "C 窄屏 390 下有离线条时顶栏不摊成三行、页面不横向溢出（两行设计值约 70，上限 78）": topH > 0 && topH <= 78 && swNarrow === true,
    "C 恢复网络后离线提示条消失": barAfter === true
  };

  console.log("  产物：默认 " + fs.readdirSync(DIR_PLAIN).length + " 个文件 · PWA " +
    fs.readdirSync(DIR_PWA).length + " 个文件");
  console.log("  缓存版本 sw=" + (mBid ? mBid[1] : "?") + " / 期望 " + wantBid + (bidOk ? " ✔" : " ✘"));
  console.log("  SW 状态 " + swState + " · controller " + controlled + " · 缓存键 " + cacheNames);
  console.log("  气象请求 " + meteoSeen + " 次 · 缓存里气象条目 " + cachedMeteo + " · 缓存条目 " +
    cacheUrls.length + " 条");
  console.log("  离线：页面打开 " + offOk + " · 提示条 " + (barInfo.hidden ? "隐藏" : "显示") +
    " · 顶栏高 " + topH + "px");
  console.log("  离线文案：" + heroOff.replace(/\s+/g, " ").slice(0, 80));
  console.log("\n--- 断言 ---");
  let fail = 0;
  for (const k of Object.keys(A)) {
    if (!A[k]) { console.log("  FAIL " + k); fail++; } else console.log("  ok   " + k);
  }
  console.log("\nFAIL 计数: " + fail);
  console.log('FACTS {"assertions":' + Object.keys(A).length + ',"fail":' + fail + '}');
  try { chrome.kill(); } catch (e) { }
  srv.close();
  process.exit(fail);
})().catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
