/* 多语言（i18n）探针 —— 只读，零额度，不发任何外部请求。
 *
 * 为什么单独写：多语言最典型的两种坏法都是**静默**的 ——
 *   ① 加了一句 `i18n("新文案")` 却忘了补词典 ⇒ 英文界面里冒出一句中文，
 *      不会报错、不会抛异常，只有人恰好看到才发现；
 *   ② 切了语言但只刷新了一半 UI（比如只改了静态 DOM、没重渲结果卡）⇒
 *      "一半英文一半中文"的界面。
 * 所以这个探针守两件事：**键的完整性**（静态）与**切换后的实际渲染**（运行时）。
 *
 * 判据取"词典值 ↔ DOM 文本"的**直接比对**，而不是"看起来像英文"这种模糊判断 ——
 * 后者抓不到"键写错了、回落成中文原文"这一类（那恰好是最常见的一种）。
 *
 * 量四组：
 *   A. 键覆盖（静态）：所有 i18n()/data-i18n 用到的键都在两份词典里；词典无孤儿键
 *   B. 切换（运行时）：html[lang]、静态 DOM、placeholder、aria-label、分段控件状态
 *   C. 往返与降级：zh → en → 繁体 → zh 全对；未知语言码降级为 zh
 *   D. 优先级与持久化：URL 参数 > 偏好存储 > 浏览器语言
 *
 * 用法: node _check/i18nprobe.js
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 47905;
const DEBUG_PORT = 9363;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readF = p => fs.readFileSync(path.join(ROOT, p), "utf8");

/* "动态键"：这些键在源码里是 `i18n(变量)` 形态出现的 —— 值来自数据表或档位表
   （QUALITY_LABEL 的四个词、ENS_CONF_BANDS 的 lv/txt/hint、云属名、颜色名、
   亮度分级文案、几何判定词），静态扫描看不到它们，会被误判成"孤儿键"。
   这里显式登记，好让"孤儿"这条断言只报**真正**写了却没用的键。
   注意：它们的译文会由 group A 的"词典键集合一致"间接守住 —— 两份词典必须同时有。 */
const DYNAMIC_KEYS = [
  /* 观赏质量档（QUALITY_LABEL / QUALITY_BANDS 的 key） */
  "优秀", "良好", "一般", "较差", "优", "良", "差",
  /* 可信度档（ENS_CONF_BANDS 的 lv / txt / hint） */
  "高", "中", "低",
  "三套算法结论接近", "三套算法存在一定分歧", "三套算法分歧较大",
  "可信度较高，可直接据此安排。", "分歧在可接受范围内，建议结合临近云图复核。", "请谨慎采信，临近日再确认一次。",
  /* 云量四档名（TX_BAND_NAMES 动态取词，2026-10-18 起图例四档色块行） */
  "晴", "少云", "多云", "阴",
  /* 几何判定词 */
  "火烧云三角几何条件成立", "几何条件不成立或云边界过远", "成立", "不成立",
  /* 云属名 / 云层名（_p3.js 的云属判据表） */
  "层云/雾", "层积云", "积云", "高积云", "高层云", "卷层云", "卷云", "低云", "中云", "高云",
  /* 光追峰值颜色名 */
  "灰暗无彩", "灰白（大气浑浊）", "深红 / 暗红", "红", "橘红", "橙色", "金黄 / 橘黄",
  "淡黄", "粉紫", "黄绿（少见）",
  /* 亮度分级文案 */
  "极亮（可能过曝、色泽偏白）", "明亮（最佳区间）", "明亮偏弱（仍清晰可见）",
  "较暗（闷烧）", "很暗（观赏价值低）", "极暗（基本看不到）", "完全不可见",
  /* 三元表达式里的字面量（静态扫描抓不到 i18n(isAM ? "日出" : "日落") 这种写法） */
  "日出", "日落", "AOD",
  /* _p5.js 的 FIELD_CN：变量名 → 中文显示名，展示时才过 i18n */
  "温度", "露点", "总云量", "低云量", "中云量", "高云量", "地面气压", "风速", "风向",
  "阵风", "0℃层高度", "边界层高度", "降水量", "对流有效位能", "短波辐射", "沙尘",
  /* _p3.js 的两条兜底文案（进入 primary.type 后由展示层 i18n） */
  "无样带数据", "日出/日落方向 400km 内无明显云盘",
  /* _p6.js 的 MAP_MODELS[].desc：值来自数据表，展示时才 i18n */
  "GFS / ECMWF / 光追 加权几何平均", "NOAA 全球模式 · 云属/湿度统计评分",
  "欧洲中心全球模式 · 云属/湿度统计评分", "纯物理：多波长光路积分 + CIE 色度",
  /* F3 的星期名：从 WD[] 里按 getUTCDay() 取，静态扫描看不到 */
  "周日", "周一", "周二", "周三", "周四", "周五", "周六",
  /* S5 全屏按钮：refreshFsBtn 里是 `const key = on ? "退出全屏" : "全屏"` 再
     i18n(key) —— 三元选出键、动态取词，静态扫描只认得出 "全屏"（它在模板
     data-i18n 里），"退出全屏"必须在此登记，否则每次跑都被误报成孤儿键。 */
  "退出全屏"
];

/* `_pi18n.js` 顶层只有声明、没有副作用，可以直接执行取词典 ——
   比用正则解析对象字面量可靠得多（正则遇到 `"` 里的 `"` 就错）。 */
function loadDicts() {
  const src = readF("_pi18n.js");
  return new Function(src + "\nreturn { LANGS: LANGS, I18N: I18N };")();
}
/* 收集"用到的键"：源文件里的 i18n("…") 字面量 + 模板里的 data-i18n* 属性。
   只认字面量：`i18n(变量)` 这类动态键（云属名、颜色名）无法静态校验，
   它们靠中文回落兜底，是本表刻意不覆盖的部分。
   **404 页不在这张表里** —— 它是独立产物、自带最小词典，由 check404Dict() 单独核对。 */
/* 出现在 i18n(...) 参数里、但**不是翻译键**的字面量：
   它们是判据（`i18n(period === "am" ? … : …)`），扫到了也不能当键。 */
const NOT_KEYS = ["am", "pm", "ens", "dv", "auto", "light", "dark", ""];

function usedKeys() {
  const keys = new Set();
  /* 括号配对扫描：取 `i18n(` 之后到配对右括号之间的**全部**字符串字面量。
     只认"紧跟在 i18n( 后面的那个字面量"是不够的 —— 大量键写在**三元表达式**里
     （`i18n(cond ? "甲" : "乙")`、`i18n(a < 0.2 ? "很少" : "较多")`），
     单字面量正则会把它们全部漏掉，于是它们在"孤儿键"里被误报。
     扫描时跳过字符串内部（含转义），所以参数里的 `"` 不会打乱括号计数。 */
  const scan = src => {
    const re = /\bi18n\(/g;
    let m;
    while ((m = re.exec(src))) {
      let i = m.index + m[0].length - 1, depth = 0, brace = 0, inStr = null, esc = false, buf = "";
      for (; i < src.length; i++) {
        const c = src[i];
        if (inStr) {
          if (esc) { buf += c; esc = false; continue; }
          if (c === "\\") { esc = true; continue; }
          if (c === inStr) {
            /* 只收**第一层实参**里的字面量：深度 >1 说明它在嵌套调用里，
               在 {} / [] 里说明它是参数对象的字段值（如 { v: "am" }）——
               两者都不是翻译键，收进来会制造一堆假缺译。 */
            if (depth === 1 && brace === 0 && NOT_KEYS.indexOf(buf) < 0) keys.add(buf);
            inStr = null; continue;
          }
          buf += c; continue;
        }
        if (c === '"' || c === "'" || c === "`") { inStr = c; buf = ""; continue; }
        if (c === "(") depth++;
        else if (c === "{") brace++;
        else if (c === "}") brace--;
        else if (c === ")") { depth--; if (depth === 0) break; }
      }
      /* 关键：只推进到 `i18n(` 之后，**不要**跳到配对右括号 ——
         否则嵌在参数里的 i18n(...) 永远不会被单独扫到，
         那些键（三元表达式、嵌套模板）就会被误报成"孤儿键"。 */
      re.lastIndex = m.index + m[0].length;
    }
  };
  for (const f of ["_p2.js", "_p3.js", "_p4.js", "_p5.js", "_p5b.js", "_p6.js"]) scan(readF(f));
  const src = readF("tpl/template.html");
  const re = /data-i18n(?:-ph|-aria|-title|-html)?="([^"]*)"/g;
  let m;
  while ((m = re.exec(src))) keys.add(m[1]);
  return keys;
}

/* 404 页自带词典：从产物里把 `var DICT = {...};` 抠出来直接执行。
   这里用**大括号配对**扫描而不是正则 —— 词典的值里就有 `{`/`}`（`{n}` 之类），
   正则截不准。 */
function dict404() {
  const html = readF("404.html");
  const i = html.indexOf("var DICT =");
  if (i < 0) return null;
  const j = html.indexOf("{", i);
  let depth = 0, k = j, inStr = null, esc = false;
  for (; k < html.length; k++) {
    const c = html[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) break; }
  }
  const lit = html.slice(j, k + 1);
  /* 词典里可能带注释，先去掉行注释再求值 */
  const clean = lit.replace(/^\s*\/\/.*$/gm, "");
  return new Function("return " + clean + ";")();
}
/* 404 页用到的键（模板里的 data-i18n* 属性） */
function keys404() {
  const src = readF("tpl/404.html");
  const re = /data-i18n(?:-ph|-aria|-title|-html)?="([^"]*)"/g;
  const out = new Set();
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return out;
}

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
  /* ---------- A. 键覆盖 ---------- */
  const { LANGS, I18N } = loadDicts();
  const used = usedKeys();
  const hant = I18N.zhHant, en = I18N.en;
  const missHant = [...used].filter(k => !(k in hant));
  const missEn = [...used].filter(k => !(k in en));
  const onlyHant = Object.keys(hant).filter(k => !(k in en));
  const onlyEn = Object.keys(en).filter(k => !(k in hant));
  const orphans = [...Object.keys(hant), ...Object.keys(en)]
    .filter(k => !used.has(k) && DYNAMIC_KEYS.indexOf(k) < 0);

  /* ---------- A2. 404 页自带的词典 ---------- */
  const d404 = dict404(), k404 = keys404();
  const miss404En = [...k404].filter(k => !d404 || !(k in d404.en));
  const miss404Hant = [...k404].filter(k => !d404 || !(k in d404.zhHant));

  const A = {
    "用到的键在繁体词典里齐全": missHant.length === 0,
    "用到的键在英文词典里齐全": missEn.length === 0,
    "两份词典键集合一致": onlyHant.length === 0 && onlyEn.length === 0,
    "词典里没有孤儿键（写了却没用）": orphans.length === 0,
    "语言表定义了三种语言且都带 htmllang": LANGS.length === 3 &&
      LANGS.every(x => x.k && x.name && x.htmllang),
    "模板静态文案的覆盖量达标（≥40 条 data-i18n）":
      (readF("tpl/template.html").match(/data-i18n(?:-ph|-aria|-title|-html)?=/g) || []).length >= 40,
    "404 页自带词典覆盖它自己的全部文案": miss404En.length === 0 && miss404Hant.length === 0,
    "404 页词典两份键集合一致": !!d404 &&
      Object.keys(d404.en).length === Object.keys(d404.zhHant).length
  };

  /* ---------- 起浏览器 ---------- */
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "lg-"));
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
  await cdp.send("Page.enable");
  /* 掐断外部请求：本探针不需要网络，不掐断会让"控制台错误"这条断言随
     地图 SDK 是否可达而抖动。 */
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
  async function go(url) {
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + url });
    for (let i = 0; i < 60; i++) {
      await sleep(200);
      if (await q("document.readyState") === "complete") break;
    }
    await sleep(350);
  }
  /* 页内：把静态 DOM 与词典逐条比对。只报"不等的条目"，页面侧不引入词典。 */
  const CMP = `(function(){
    var out = { lang: document.documentElement.lang, bad: [], n: 0, phBad: [], ariaBad: [] };
    document.querySelectorAll("[data-i18n]").forEach(function(el){
      out.n++;
      var k = el.getAttribute("data-i18n");
      var want = (window.__DICT && window.__DICT[k] !== undefined) ? window.__DICT[k] : k;
      if (el.textContent !== want) out.bad.push(k + " → \\"" + el.textContent + "\\"");
    });
    /* 含行内标签的长段落（页脚算法说明）：比 innerHTML，不能比 textContent */
    document.querySelectorAll("[data-i18n-html]").forEach(function(el){
      out.n++;
      var k = el.getAttribute("data-i18n-html");
      var want = (window.__DICT && window.__DICT[k] !== undefined) ? window.__DICT[k] : k;
      /* 规范化：先放进一个游离节点让浏览器解码实体（&lt; 变成 <）并统一属性写法，
         再比对 innerHTML —— 否则词典里的实体写法与 DOM 里的字符永远不相等，
         这条断言会恒假（第一版就是这样）。
         注意：本段是**模板串内部**，注释里绝不能出现反引号 —— 会当场截断模板串。 */
      var tmp = document.createElement("div");
      tmp.innerHTML = want;
      if (el.innerHTML !== tmp.innerHTML) out.bad.push("[html] " + k.slice(0, 28));
    });
    document.querySelectorAll("[data-i18n-ph]").forEach(function(el){
      var k = el.getAttribute("data-i18n-ph");
      var want = (window.__DICT && window.__DICT[k] !== undefined) ? window.__DICT[k] : k;
      if (el.getAttribute("placeholder") !== want) out.phBad.push(k);
    });
    document.querySelectorAll("[data-i18n-aria]").forEach(function(el){
      var k = el.getAttribute("data-i18n-aria");
      var want = (window.__DICT && window.__DICT[k] !== undefined) ? window.__DICT[k] : k;
      if (el.getAttribute("aria-label") !== want) out.ariaBad.push(k);
    });
    return JSON.stringify(out);
  })()`;

  async function checkLang(code, dict) {
    await cdp.send("Runtime.evaluate", { expression: "window.__DICT = " + JSON.stringify(dict) + ";", returnByValue: true });
    await cdp.send("Runtime.evaluate", { expression: "setLang(" + JSON.stringify(code) + ")", returnByValue: true });
    await sleep(250);
    return JSON.parse(await q(CMP));
  }

  /* ---------- B/C. 切换与往返 ---------- */
  await go("/");
  errs.length = 0;
  const zh = await checkLang("zh", {});
  const enRes = await checkLang("en", en);
  const hantRes = await checkLang("zhHant", hant);
  const errsAfter = errs.length;
  const zh2 = await checkLang("zh", {});

  /* 分段控件的选中态：与 visual(.on) 必须同步（同 F6 那条纪律） */
  const seg = JSON.parse(await q(`(function(){
    var g = document.getElementById("langSeg");
    if (!g) return JSON.stringify({ ok: false });
    var b = Array.prototype.slice.call(g.querySelectorAll("button"));
    return JSON.stringify({
      ok: true, n: b.length,
      on: b.filter(function(x){ return x.classList.contains("on"); }).length,
      pressed: b.filter(function(x){ return x.getAttribute("aria-pressed") === "true"; }).length,
      sync: b.every(function(x){ return (x.getAttribute("aria-pressed") === "true") === x.classList.contains("on"); }),
      labels: b.map(function(x){ return x.textContent; })
    });
  })()`));

  /* 未知语言码降级 */
  const norm = await q('normalizeLang("fr-CA") + "|" + normalizeLang("zh-HK") + "|" + normalizeLang("zh-TW") + "|" + normalizeLang("") + "|" + normalizeLang("en-GB")');

  /* ---------- D. 优先级与持久化 ---------- */
  await go("/?lang=zhHant");
  const urlLang = await q("document.documentElement.lang");
  await cdp.send("Runtime.evaluate", { expression: 'setLang("en")' });
  await sleep(150);
  await go("/?lang=en");                     // 带参数重载：偏好里已有 en，参数也 en
  const persisted = await q("document.documentElement.lang");
  await go("/?lang=zhHant");                 // 参数应压过偏好里的 en
  const urlWins = await q("document.documentElement.lang");

  /* 英文文案普遍更长：窄屏下最容易撑破布局（本项目的 46 号约束） */
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await go("/?lang=en");
  const narrow = JSON.parse(await q(`(function(){
    var de = document.documentElement;
    return JSON.stringify({ vw: de.clientWidth, sw: de.scrollWidth });
  })()`));

  const B = {
    "切到英文后 html[lang] 变为 en": enRes.lang === "en",
    "英文下静态文案全部替换（没有残留中文）": enRes.bad.length === 0,
    "英文下 placeholder 全部替换": enRes.phBad.length === 0,
    "英文下 aria-label 全部替换": enRes.ariaBad.length === 0,
    "切到繁体后 html[lang] 变为 zh-Hant-TW": hantRes.lang === "zh-Hant-TW",
    "繁体下静态文案全部替换": hantRes.bad.length === 0,
    "切回中文后与键本身逐字相等（往返）": zh2.bad.length === 0 && zh.bad.length === 0,
    "英文下页面无控制台错误": errsAfter === 0,
    "语言分段控件：三个按钮、恰好一个选中、aria 与 .on 同步": seg.ok && seg.n === 3 && seg.on === 1 &&
      seg.pressed === 1 && seg.sync === true,
    "控件文字用各语言自己的写法（中文/繁體/English）": seg.ok &&
      seg.labels[0] === "中文" && seg.labels[1] === "繁體" && seg.labels[2] === "English",
    "未知语言码降级正确（fr→zh、zh-HK/zh-TW→繁体、空→zh、en-GB→en）":
      norm === "zh|zhHant|zhHant|zh|en",
    "URL 参数 lang 生效": urlLang === "zh-Hant-TW",
    "选择被持久化（重载后仍是英文）": persisted === "en",
    "URL 参数优先于偏好（?lang=zhHant 压过偏好里的 en）": urlWins === "zh-Hant-TW",
    "英文文案加长后窄屏不横向溢出（390 视口）": narrow.sw <= narrow.vw + 1
  };

  const o = Object.assign({}, A, B);

  console.log("=== 多语言探针 ===");
  console.log("  用到的键 " + used.size + " 条 · 繁体词典 " + Object.keys(hant).length +
    " · 英文词典 " + Object.keys(en).length);
  console.log("  静态 data-i18n 元素 " + zh.n + " 个 · 语言 " + LANGS.map(x => x.k).join("/"));
  console.log("  窄屏(en) " + narrow.vw + "×844 · scrollWidth " + narrow.sw);
  if (missEn.length) console.log("  英文缺译：" + missEn.slice(0, 12).join(" | ") + (missEn.length > 12 ? " …" : ""));
  if (missHant.length) console.log("  繁体缺译：" + missHant.slice(0, 12).join(" | ") + (missHant.length > 12 ? " …" : ""));
  if (orphans.length) console.log("  孤儿键：" + orphans.slice(0, 12).join(" | ") + (orphans.length > 12 ? " …" : ""));
  if (enRes.bad.length) console.log("  英文未替换：" + enRes.bad.slice(0, 8).join(" | "));
  if (hantRes.bad.length) console.log("  繁体未替换：" + hantRes.bad.slice(0, 8).join(" | "));

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
