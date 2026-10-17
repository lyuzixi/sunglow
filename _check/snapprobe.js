/* F5 探针 —— 结果快照分享链接。
 *
 * 为什么必须走真实链路（而不是只测编解码函数）：
 *   F5 的设计承诺是「**零额度、零等待**」—— 带 snap= 的链接打开后
 *   不应该发出任何气象请求。这条只有在**数请求**时才算数。
 *   判据此前最容易踩的坑正是"零请求"：**如果根本没有走到快照分支**，
 *   请求数也可能是 0。所以这里配了一条自检断言 —— 同一个页面不带 snap
 *   打开时必须产生请求，否则"0 次"就是空转的绿灯。
 *
 * 另一半是安全：snap= 是**完全用户可控**的输入，且要被渲染进 innerHTML。
 * 所以这里直接构造一段恶意载荷（地名里塞 <img onerror>、因素里塞非法键）
 * 走一遍真实渲染，断言页面上没有凭空多出 img / script / iframe。
 *
 * 用法: node _check/snapprobe.js
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 47913;
const DEBUG_PORT = 9372;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function gen(v, la, lo, h, isAQ) {
  const wob = Math.sin((la * 7 + lo * 3 + h) * 0.7) * 0.5 + 0.5;
  if (isAQ) {
    if (v === "aerosol_optical_depth") return 0.12 + wob * 0.2;
    if (v === "pm2_5") return 10 + wob * 30;
    return 5 + wob * 20;
  }
  switch (v) {
    case "temperature_2m": return 18 + wob * 8;
    case "dew_point_2m": return 10 + wob * 6;
    case "relative_humidity_2m": return 45 + wob * 30;
    case "cloud_cover_low": return 10 + wob * 20;
    case "cloud_cover_mid": return 20 + wob * 40;
    case "cloud_cover_high": return 30 + wob * 50;
    case "cloud_cover": return 30 + wob * 50;
    case "visibility": return 12000 + wob * 15000;
    case "pressure_msl": return 1010 + wob * 8;
    case "surface_pressure": return 1005 + wob * 8;
    case "wind_speed_10m": return 3 + wob * 6;
    case "wind_direction_10m": return wob * 360;
    case "wind_gusts_10m": return 6 + wob * 8;
    case "boundary_layer_height": return 400 + wob * 900;
    case "freezing_level_height": return 3500 + wob * 1500;
    case "precipitation": return wob * 0.6;
    case "cape": return wob * 900;
    case "shortwave_radiation": return 200 + wob * 400;
    case "dust": return wob * 20;
    default: return wob;
  }
}
function synthBody(reqUrl) {
  const u = new URL(reqUrl);
  const isAQ = u.host.indexOf("air-quality") >= 0;
  const lats = (u.searchParams.get("latitude") || "").split(",").filter(Boolean);
  const lons = (u.searchParams.get("longitude") || "").split(",").filter(Boolean);
  const vars = (u.searchParams.get("hourly") || "").split(",").filter(Boolean);
  const sD = u.searchParams.get("start_date"), eD = u.searchParams.get("end_date");
  const t0 = Date.parse(sD + "T00:00:00Z"), t1 = Date.parse(eD + "T23:00:00Z");
  const times = [];
  for (let ms = t0; ms <= t1; ms += 3600000) times.push(new Date(ms).toISOString().slice(0, 16));
  const out = lats.map((la, i) => {
    const A = +la, B = +lons[i];
    const hourly = { time: times };
    vars.forEach(v => {
      hourly[v] = times.map((_, k) => gen(v, A, B, new Date(t0 + k * 3600000).getUTCHours(), isAQ));
    });
    const o = { latitude: A, longitude: B, utc_offset_seconds: 28800, timezone: "Asia/Shanghai", hourly };
    const dv = u.searchParams.get("daily");
    if (dv) {
      const days = [];
      for (let ms = t0; ms <= t1; ms += 86400000) days.push(new Date(ms).toISOString().slice(0, 10));
      o.daily = { time: days };
      dv.split(",").filter(Boolean).forEach(v => {
        o.daily[v] = days.map(() => (v === "sunrise" ? "2026-10-13T05:50" : "2026-10-13T17:30"));
      });
    }
    return o;
  });
  return JSON.stringify(out);
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
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "snb-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + DEBUG_PORT, "--user-data-dir=" + udd,
    "--window-size=1440,1200", "about:blank"
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
  try {
    await cdp.send("Browser.grantPermissions", {
      origin: "http://127.0.0.1:" + PORT,
      permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"]
    });
  } catch (e) { /* 没有这个权限也不影响：兜底路径同样在测 */ }

  const reqs = [];
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  cdp.on(async m => {
    if (m.method !== "Fetch.requestPaused") return;
    const { requestId, request } = m.params;
    const u = request.url;
    try {
      if (u.indexOf("http://127.0.0.1:" + PORT) === 0) {
        await cdp.send("Fetch.continueRequest", { requestId }); return;
      }
      if (u.indexOf("open-meteo.com") >= 0) {
        const k = u.indexOf("air-quality") >= 0 ? "aq" : "fc";
        const n = (new URL(u).searchParams.get("latitude") || "").split(",").filter(Boolean).length;
        reqs.push({ kind: k, n: n });
        await cdp.send("Fetch.fulfillRequest", {
          requestId, responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: "application/json" },
            /* 跨域：没有这一行浏览器直接判 Failed to fetch */
            { name: "Access-Control-Allow-Origin", value: "*" }
          ],
          body: Buffer.from(synthBody(u), "utf8").toString("base64")
        });
        return;
      }
      await cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
    } catch (e) { }
  });

  const logs = [];
  cdp.on(m => {
    if (m.method === "Runtime.consoleAPICalled") {
      logs.push(m.params.type + ": " + (m.params.args || []).map(a => a.value === undefined ? a.description : a.value).join(" "));
    }
    if (m.method === "Runtime.exceptionThrown") logs.push("EXC: " + (m.params.exceptionDetails || {}).text);
  });
  const q = async (expr) => (await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  async function go(url) {
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + url });
    for (let i = 0; i < 60; i++) {
      await sleep(200);
      if (await q("document.readyState") === "complete") break;
    }
    await sleep(500);
  }
  const waitIdle = async (ms) => { await sleep(ms || 1200); };
  const fcN = () => reqs.filter(r => r.kind === "fc").length;

  /* ============ 0. 基准：没有快照时，首屏照常取数 ============
     这条是"零额度"判据的**自检**：如果连普通首屏都不发请求，
     那后面"快照页 0 请求"就是一句空话。 */
  reqs.length = 0;
  await go("/");
  await waitIdle(2200);
  const baseFc = fcN();
  const hasResult = await q("!!State.result");

  /* ============ 1. 生成快照链接 ============ */
  const info = JSON.parse(await q(`(function(){
    var u = snapUrl();
    var raw = State.snapRaw;
    var enc = snapEncode(State.result);
    var d = snapDecode(enc);
    return JSON.stringify({
      url: u, len: u.length, encLen: (enc||"").length,
      hasSnapParam: u.indexOf("&snap=") >= 0,
      b64safe: !!enc && /^[A-Za-z0-9_-]+$/.test(enc),
      round: d ? { date: d.date, period: d.period, P: Math.round(d.P), Q: Math.round(d.Q),
                   lat: +d.lat.toFixed(4), lon: +d.lon.toFixed(4), nf: d.factors.length } : null,
      orig: { date: State.result.dateStr, period: State.result.period,
              P: Math.round(State.result.P), Q: Math.round(State.result.Q),
              lat: +State.result.lat.toFixed(4), lon: +State.result.lon.toFixed(4) }
    });
  })()`));

  /* ============ 2. 打开快照链接：零取数 ============ */
  reqs.length = 0;
  await go(info.url.replace("http://127.0.0.1:" + PORT, ""));
  await waitIdle(2200);
  const snapFc = fcN();
  const st = JSON.parse(await q(`(function(){
    var h = document.querySelector("#hero") || {};
    return JSON.stringify({
      snapmode: document.body.classList.contains("snapmode"),
      snapOn: !!State.snap, raw: !!State.snapRaw,
      tag: (document.querySelector("#heroTag")||{}).textContent || "",
      heroLen: (h.textContent||"").length,
      pct: (h.querySelector(".dv b")||{}).textContent || "",
      hidden: Array.prototype.slice.call(document.querySelectorAll("[data-snaphide]"))
                .filter(function(el){ return getComputedStyle(el).display === "none"; }).length,
      totalHide: document.querySelectorAll("[data-snaphide]").length,
      /* ③④⑤⑥ 是**卡片**（div.card），与"快照模式下该收起的一切"不是同一集合 ——
         例如 F4 的本地校准块也是 data-snaphide，但它是结论卡的子块、不是一张卡。
         判据按卡片身份数，不按 data-snaphide 总数：后者会随新块加入而变成
         "改数字"式的假失败（已踩过一次）。 */
      hideCards: Array.prototype.slice.call(document.querySelectorAll("div.card[data-snaphide]"))
                .filter(function(el){ return getComputedStyle(el).display === "none"; }).length,
      totalCards: document.querySelectorAll("div.card[data-snaphide]").length,
      facs: document.querySelectorAll("#hero .snapfac .sf").length,
      hasRefresh: !!document.querySelector("#snapRefresh"),
      note: (document.querySelector("#hero .snapnote")||{}).textContent || "",
      shareOff: document.querySelector("#shareCard").disabled && document.querySelector("#snapUrl").disabled,
      kvVals: Array.prototype.slice.call(document.querySelectorAll("#hero .kv .it .v")).map(function(e){ return e.textContent; }),
      urlHasSnap: location.search.indexOf("snap=") >= 0
    });
  })()`));

  /* ============ 3. 改日期 ⇒ 快照失效 ============ */
  const inv = JSON.parse(await q(`(function(){
    document.querySelector("#date").value = "2026-10-20";
    saveDate();
    return JSON.stringify({ snap: State.snap, raw: State.snapRaw,
      mode: document.body.classList.contains("snapmode"),
      urlHasSnap: location.search.indexOf("snap=") >= 0 });
  })()`));
  await waitIdle(2200);

  /* ============ 4. 恶意载荷：地名塞标签、因素塞非法键 ============ */
  const evilRaw = await q(`(function(){
    var f = ["1", Math.round(Date.now()/1000).toString(36), "2026-10-20", "pm",
      "23.1291", "113.2644",
      "<img src=1 onerror=window.__pwned=1>", "广东",
      "72", "68", "82", "3.5", "4", "6", "480", "1", "3", "3.20", "85.0", "26",
      /* 6 个因素：一个非法键、一个非法值，其余正常 —— 全部应被裁到 ≤4 个 */
      "cover~38~0.85!__evil__~1~0.9!aod~0.31~0.72!base~3.2~0.55!heq~1.1~0.8!vis~18000~0.9"];
    return b64uEnc(f.join("|"));
  })()`);
  reqs.length = 0;
  await go("/?snap=" + evilRaw);
  await waitIdle(1600);
  const evil = JSON.parse(await q(`(function(){
    var h = document.querySelector("#hero");
    var html = h.innerHTML;
    return JSON.stringify({
      injected: document.querySelectorAll("#hero img, #hero script, #hero iframe, #hero object, #hero embed").length,
      /* 关键区分：文本里出现 "onerror" 无所谓（白名单只删符号、不删字母），
         出现 **"onerror="** 或带 on* 属性的元素才叫注入。 */
      attrHit: document.querySelectorAll("#hero [onerror], #hero [onload], #hero [onclick], #hero [srcdoc]").length,
      onerrorAttr: html.indexOf("onerror="),
      imgTag: html.indexOf("<img"),
      pwned: typeof window.__pwned,
      facs: document.querySelectorAll("#hero .snapfac .sf").length,
      big: (h.querySelector(".big") || {}).textContent || "",
      snapOn: !!State.snap
    });
  })()`));
  const evilFc = fcN();

  /* ============ 5. 坏输入：乱码 / 超长 / 错版本 / 字段不足 ============ */
  const bad = {};
  for (const [k, val] of [
    ["garbage", "@@@not-base64@@@"],
    ["long", "A".repeat(2400)],
    ["ver", b64u("2|abc|2026-10-20|pm|23|113|广州||72|68|82|3.5|4|6|480|1|3|3.2|85|26|cover~38~0.85")],
    ["short", b64u("1|abc|2026-10-20")],
    ["badDate", b64u("1|abc|2026/10/20|pm|23|113|广州||72|68|82|3.5|4|6|480|1|3|3.2|85|26|cover~38~0.85")],
    ["badPeriod", b64u("1|abc|2026-10-20|xx|23|113|广州||72|68|82|3.5|4|6|480|1|3|3.2|85|26|cover~38~0.85")],
    ["badLat", b64u("1|abc|2026-10-20|pm|999|113|广州||72|68|82|3.5|4|6|480|1|3|3.2|85|26|cover~38~0.85")]
  ]) {
    await go("/?snap=" + val);
    await sleep(300);
    bad[k] = await q("(State.snap === null) && !document.body.classList.contains('snapmode')");
  }
  /* 坏输入不该让页面崩：坏 snap 落回普通首屏，照常算出结果 */
  await go("/?snap=@@@not-base64@@@");
  await waitIdle(2400);
  const recovered = await q("!!State.result && document.querySelectorAll('#fac tbody tr').length > 0");

  /* ============ 6. 过期提示：生成时刻设为 3 天前 ============ */
  const oldRaw = await q(`(function(){
    var old = Math.round((Date.now() - 3*86400000)/1000).toString(36);
    var f = ["1", old, "2026-10-20", "pm", "23.1291", "113.2644", "广州", "广东",
      "72", "68", "82", "3.5", "4", "6", "480", "1", "3", "3.20", "85.0", "26", "cover~38~0.85"];
    return b64uEnc(f.join("|"));
  })()`);
  await go("/?snap=" + oldRaw);
  await waitIdle(1200);
  const stale = await q(`(function(){
    var n = document.querySelector("#hero .snapnote");
    return JSON.stringify({ warn: !!n && n.className.indexOf("n-warn") >= 0,
      txt: n ? n.textContent.slice(0, 60) : "" });
  })()`);
  const staleInfo = JSON.parse(stale);

  /* ============ 7. 切英文：快照卡跟着变英文 ============ */
  await go("/?snap=" + oldRaw + "&lang=en");
  await waitIdle(1200);
  const enSnap = await q("(document.querySelector('#hero .snapnote')||{}).textContent || ''");
  const enBig = await q("(document.querySelector('#hero .big')||{}).textContent || ''");

  /* ============ 8. 重新计算按钮 ============ */
  await go("/?snap=" + oldRaw);
  await waitIdle(1200);
  reqs.length = 0;
  await q("document.querySelector('#snapRefresh').click()");
  await waitIdle(2600);
  /* 注意：**不数请求**。这一步的地点的同一天在前面第 3 步已经取过数，
     命中单点缓存 ⇒ 请求数就是 0。用"请求数 ≥1"当判据会得到假失败
     （与 F2 那次踩的是同一个坑）。真正的性质是"完整结果回来了"。 */
  const afterRefresh = JSON.parse(await q(`(function(){
    return JSON.stringify({ mode: document.body.classList.contains("snapmode"),
      snap: State.snap, result: !!State.result,
      facRows: document.querySelectorAll("#fac tbody tr").length,
      urlHasSnap: location.search.indexOf("snap=") >= 0,
      snapBtn: document.querySelector("#snapUrl").disabled,
      resultDate: State.result ? State.result.dateStr : "" });
  })()`));
  const refreshFc = fcN();

  /* ============ 9. 复制按钮 ============ */
  await go("/");
  await waitIdle(2400);
  const btnBefore = await q("document.querySelector('#snapUrl').disabled");
  await q("document.querySelector('#snapUrl').click()");
  await sleep(900);
  const copyState = JSON.parse(await q(`(function(){
    var b = document.querySelector("#snapUrl"), o = document.querySelector("#snapOut");
    return JSON.stringify({ label: b.textContent, outShown: !o.hidden,
      hasInput: !!o.querySelector("input"), val: o.querySelector("input") ? o.querySelector("input").value : "" });
  })()`));

  const A = {
    "判据自检：不带 snap 的首屏照常取数（否则“0 请求”是空转绿灯）": baseFc >= 1 && hasResult === true,
    "F5 快照链接含 snap= 参数，且整条 URL 在 2000 字符内": info.hasSnapParam && info.len < 2000,
    "F5 快照串是纯 base64url（可直接进查询串，无需再转义）": info.b64safe === true,
    "F5 编解码往返：日期 / 时段 / 概率 / 质量 / 坐标逐项一致":
      !!info.round && info.round.date === info.orig.date && info.round.period === info.orig.period &&
      info.round.P === info.orig.P && info.round.Q === info.orig.Q &&
      info.round.lat === info.orig.lat && info.round.lon === info.orig.lon,
    "F5 快照只带 ≤4 个因素": info.round && info.round.nf >= 1 && info.round.nf <= 4,
    "F5 打开快照链接：零气象请求（这是本功能的核心承诺）": snapFc === 0,
    "F5 快照模式：进入 snapmode、卡片标记为「快照」": st.snapmode === true && st.snapOn === true && st.tag === "快照",
    "F5 快照卡画出了概率环与结论": st.heroLen > 60 && /%/.test(st.pct),
    "F5 快照模式下 ③④⑤⑥ 四张卡收起（其余照常可用），且所有 data-snaphide 块都收起":
      st.hidden === st.totalHide && st.hideCards === st.totalCards && st.totalCards === 4,
    "F5 快照卡带「按当前条件重新计算」按钮": st.hasRefresh === true,
    "F5 快照卡明确写出“生成于 … / 不消耗额度”": /前/.test(st.note) && /不消耗/.test(st.note),
    "F5 分享类按钮在快照模式下禁用（快照只有摘要，导不出完整图）": st.shareOff === true,
    "F5 日出日落时刻与方位角**现算**（链接里不带，因此也改不了）":
      st.kvVals.length >= 2 && /\d/.test(st.kvVals[0] || "") && (st.kvVals[1] || "").indexOf("°") >= 0,
    "F5 改日期 ⇒ 快照作废，且地址栏不再带 snap=":
      inv.snap === null && inv.raw === null && inv.mode === false && inv.urlHasSnap === false,
    "F5 恶意地名不产生任何 img / script / iframe / object": evil.injected === 0,
    /* 两条一起看才成立，而且互为自检：
       · big 里**有** "onerror" ⇒ payload 确实走到了渲染路径（不是"整条被拒"的空绿）；
       · 但 big 里**没有** < 和 =，DOM 里也没有任何带 on* 属性的元素，也没有 <img
       ⇒ 它只是被当成一段普通文本画了出来。 */
    "F5 恶意载荷进了 DOM，但只作为**纯文本**出现（无元素、无属性、无事件）":
      evil.snapOn === true && evil.big.indexOf("onerror") >= 0 &&
      evil.big.indexOf("<") < 0 && evil.big.indexOf("=") < 0 &&
      evil.injected === 0 && evil.attrHit === 0 && evil.onerrorAttr < 0 &&
      evil.imgTag < 0 && evil.pwned === "undefined",
    "F5 非法因素键被白名单剔除，且因素数被裁到 ≤4": evil.facs >= 1 && evil.facs <= 4,
    "F5 恶意载荷下仍是零取数": evilFc === 0,
    "F5 乱码 / 超长 / 错版本 / 字段不足 / 坏日期 / 坏时段 / 越界纬度 一律作废":
      bad.garbage === true && bad.long === true && bad.ver === true && bad.short === true &&
      bad.badDate === true && bad.badPeriod === true && bad.badLat === true,
    "F5 坏快照不拖垮页面：落回普通首屏并照常算出结果": recovered === true,
    "F5 超过一天的快照给出过期提示（n-warn）": staleInfo.warn === true,
    "F5 快照卡随界面语言切换（同一条链接，英文界面就是英文）":
      /Snapshot|snapshot|computed at/.test(enSnap) && /%/.test(enBig),
    "F5 点「按当前条件重新计算」：退出快照模式 + 拿回完整分析 + 地址栏去掉 snap=":
      afterRefresh.mode === false && afterRefresh.snap === null &&
      afterRefresh.result === true && afterRefresh.facRows >= 10 &&
      afterRefresh.urlHasSnap === false && afterRefresh.snapBtn === false,
    "F5 复制按钮：有结果才可用，点了要么复制成功要么把链接摊出来手动复制":
      btnBefore === false && (copyState.label === "已复制" || (copyState.outShown && copyState.hasInput && copyState.val.indexOf("snap=") >= 0))
  };

  console.log("=== F5 结果快照探针 ===");
  const errs = logs.filter(x => x.indexOf("EXC") === 0 || x.indexOf("失败") >= 0);
  console.log("  页面异常 " + errs.length + " 条" + (errs.length ? "：\n    " + errs.slice(0, 4).join("\n    ").slice(0, 600) : ""));
  console.log("  首屏基准 fc " + baseFc + " 次 · 快照页 fc " + snapFc + " 次 · 恶意载荷页 fc " + evilFc +
    " 次 · 重新计算 fc " + refreshFc + " 次");
  console.log("  快照 URL 长度 " + info.len + "（snap 串 " + info.encLen + " 字符）· 因素 " +
    (info.round ? info.round.nf : 0) + " 个");
  console.log("  快照卡：" + st.note.replace(/\s+/g, " ").slice(0, 80));
  console.log("  恶意载荷：注入元素 " + evil.injected + " · on* 属性 " + evil.attrHit +
    " · onerror= 出现位置 " + evil.onerrorAttr + " · __pwned " + evil.pwned);
  console.log("  恶意载荷作为文本渲染：" + JSON.stringify(evil.big.replace(/\s+/g, " ").slice(0, 70)));
  console.log("  重新计算后：完整因素表 " + afterRefresh.facRows + " 行 · 结果日期 " +
    afterRefresh.resultDate + " · 地址栏仍带 snap=" + afterRefresh.urlHasSnap);
  console.log("  英文界面：" + enSnap.replace(/\s+/g, " ").slice(0, 80));
  console.log("  复制结果：" + JSON.stringify(copyState).slice(0, 160));
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

/* 与页面里同款：base64url 编码（探针侧只用来造“坏输入”） */
function b64u(s) {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
