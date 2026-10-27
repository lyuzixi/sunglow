/* 口径一致性核查（一次性，需真实网络）：
   同一地点、同一日期、同一时段，
     A. 结论卡（单点路径）：`computeAll` 用 TRANSECT 的 **17 点** 真实样带；
     B. 地图中心（地图路径）：`loadMapData` 每个网格点只构造 **2 点**粗样带
        （d=0 本地真实值 + d=250 由 57 点云场 IDW 插值）。
   两条路径的 P/Q 若差得明显，用户在地图中心悬停时会看到与上方大数字不同的值。
   本脚本只做测量与打印，不做断言、不改任何文件。

   会花掉一次首页 + 一次地图的额度（约 65 + 171 个加权调用）。
   用法: node _check/consistency.js
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
const PORT = 47907;
const WANT_PERIOD = process.argv[2] || "pm";

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
const jget = async u => (await fetch(u)).json();

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pend = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws error")); });
    const c = new CDP(ws);
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pend.has(m.id)) { const p = c.pend.get(m.id); c.pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    };
    return c;
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.pend.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); });
  }
  eval(expr, awaitPromise) {
    return this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
  }
}

(async function main() {
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "cdpcs-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=9347", "--user-data-dir=" + udd, "--window-size=1280,1000", "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let cerr = ""; chrome.stderr.on("data", d => { cerr += d.toString(); });

  let ver = null;
  for (let i = 0; i < 60; i++) { try { ver = await jget("http://127.0.0.1:9347/json/version"); break; } catch (e) { await sleep(500); } }
  if (!ver) { console.log("CHROME_START_FAIL\n" + cerr.slice(0, 1500)); process.exit(1); }

  const list = await jget("http://127.0.0.1:9347/json/list");
  const page = list.find(t => t.type === "page");
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/preview.html" });

  /* 等首屏单点结果 */
  let ok = false;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const r = await cdp.eval(`(typeof State!=='undefined') && !State.busy && !!State.result`);
    if (r.result.value) { ok = true; break; }
  }
  if (!ok) { console.log("首屏未出结果，退出"); chrome.kill(); srv.close(); process.exit(1); }

  const r = await cdp.eval(`(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const out={};
    /* 把时段切到目标时段，保证单点与地图同一时段 */
    const btn=document.querySelector('#periodSeg button[data-p="'+${JSON.stringify(WANT_PERIOD)}+'"]');
    if(btn){ btn.click(); const t=Date.now(); while(State.busy && Date.now()-t<60000) await sleep(400); await sleep(400); }
    const rr=State.result;
    out.hero={ period:rr.period, date:rr.dateStr, P:rr.P, Q:rr.Q, I:mixedIndex(rr.P,rr.Q),
               parts:rr.parts.map(function(x){return {k:x.k,P:+x.P.toFixed(2),Q:+x.Q.toFixed(2)};}),
               transectN:TRANSECT.length, dFar:rr.sRT&&rr.sRT.a?rr.sRT.a.dFar:null };
    out.lat=State.lat; out.lon=State.lon; out.name=State.name;
    out.callsBefore=apiCallStats();

    /* 地图时段与单点时段对齐 */
    var mb=document.querySelector('#mapPeriod button[data-p="'+${JSON.stringify(WANT_PERIOD)}+'"]'); if(mb) mb.click();
    if(MapMod.data){ MapMod.data={}; }
    var go=document.getElementById('mapGo'); if(go) go.click();
    const t0=Date.now();
    while(Date.now()-t0<120000){
      await sleep(500);
      var dd=mapSet();                       /* mapSet() 返回的**已经是**该时段那一层 */
      if(dd && (dd.pts||[]).length) break;
    }
    const d=mapSet();                        /* ← 同上：d 就是 {pts:[...]} */
    out.mapPeriod=State.mapPeriod; out.mapDate=MapMod.curDate;
    out.callsAfter=apiCallStats();
    if(!d || !(d.pts||[]).length){ out.err='地图数据为空'; return JSON.stringify(out); }
    const arr=d.pts;
    let best=null,bd=1e9;
    for(const o of arr){ const dd=haversineKm(State.lat,State.lon,o.lat,o.lon); if(dd<bd){bd=dd;best=o;} }
    out.grid={ n:arr.length, nearestKm:+bd.toFixed(3),
               lat:best&&+best.lat.toFixed(4), lon:best&&+best.lon.toFixed(4),
               P:best&&best.P, Q:best&&best.Q, I:best?mixedIndex(best.P,best.Q):null,
               p:best&&best.p, q:best&&best.q, d:best&&best.d, type:best&&best.type };
    out.fieldValue=(function(){ try{ var v=fieldValue(State.lat,State.lon); return isNum(v)?+v.toFixed(2):v; }catch(e){ return 'ERR '+e; } })();
    out.sampleRaster=(function(){ try{ var s=sampleRaster(State.lat,State.lon); return s?(isNum(s.P)?{P:+s.P.toFixed(2),Q:+s.Q.toFixed(2)}:String(s)):null; }catch(e){ return 'ERR '+e; } })();
    out.strips=(MapMod.strips||[]).length;
    out.tip=(function(){ try{ showMapTip({lat:State.lat,lon:State.lon},true);
      return ((document.querySelector('#tip')||{}).textContent||'').replace(/\\s+/g,' ').slice(0,240); }catch(e){ return 'ERR '+e; } })();
    return JSON.stringify(out);
  })()`, true);

  const raw = r.result && r.result.value;
  if (typeof raw !== "string") {
    console.log("原始返回不是字符串，先看它长什么样：");
    console.log(JSON.stringify(r).slice(0, 1200));
    if (r.result && r.result.description) console.log("description: " + r.result.description.slice(0, 600));
    await cdp.send("Browser.close").catch(() => { });
    chrome.kill(); srv.close();
    process.exit(2);
  }
  const O = JSON.parse(raw);
  console.log(JSON.stringify(O, null, 1));

  const nz = x => (typeof x === 'number' && isFinite(x));
  if (O.hero && O.grid && nz(O.grid.P) && nz(O.hero.P)) {
    const dP = O.grid.P - O.hero.P, dQ = O.grid.Q - O.hero.Q;
    const dI = O.grid.I - O.hero.I;
    console.log("\n===== 结论卡(17点真实样带) vs 地图中心(同构样带, 外点由云场 IDW 推求) =====");
    console.log("  地点        : " + O.name + "  (" + O.lat.toFixed(4) + ", " + O.lon.toFixed(4) + ")");
    console.log("  日期/时段   : " + O.hero.date + " / " + O.hero.period);
    console.log("  单点  P/Q/I : " + O.hero.P.toFixed(1) + " / " + O.hero.Q.toFixed(1) + " / " + O.hero.I.toFixed(1));
    console.log("  地图  P/Q/I : " + O.grid.P.toFixed(1) + " / " + O.grid.Q.toFixed(1) + " / " + O.grid.I.toFixed(1));
    console.log("  差值  ΔP/ΔQ/ΔI : " + dP.toFixed(1) + " / " + dQ.toFixed(1) + " / " + dI.toFixed(1));
    console.log("  悬停取值 I  : " + O.fieldValue + "（应等于地图中心点自身值）");
    console.log("  最近网格点距查询点: " + O.grid.nearestKm + " km");
    console.log("  样带点数: 单点 " + O.hero.transectN + " · 地图与单点同构（A1 前是 2 点，" +
    "step=250 会把开边界 dFar 算成 500 km，而单点是 400+25=425 km）");
  }
  if (O.callsBefore && O.callsAfter) {
    console.log("\n本轮加权调用：首屏 " + O.callsBefore.weight + " → " + O.callsAfter.weight
      + "（地图追加 " + (O.callsAfter.weight - O.callsBefore.weight) + "）");
  }

  await cdp.send("Browser.close").catch(() => { });
  chrome.kill(); srv.close();
  process.exit(0);
})().catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
