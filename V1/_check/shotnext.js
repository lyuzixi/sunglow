/* 一次性视觉核对：用**真实接口**打开首屏，把「可信度徽标」所在的结论卡截下来，
   并触发分享卡导出、把生成的 PNG 直接存盘（免得还要自己点一次按钮）。

   同时打印徽标文案 / 因素表「模式一致性」行 / 三家 I 值 —— 用来肉眼确认
   "同名函数静默覆盖"那个缺陷真的修好了（被顶掉时会显示成
   "可信度 较高 / 距最近采样点 11 km / undefined"）。

   会花掉一次单点查询的额度（约 65 个加权调用），所以**不进 all.py 序列**。
   用法: node _check/shotnext.js
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
const PORT = 47911, DBG = 9351;

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
    return new Promise((res, rej) => {
      this.pend.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.pend.has(id)) { this.pend.delete(id); rej(new Error("timeout " + method)); } }, 90000);
    });
  }
}

(async function main() {
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "cdpsn-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + DBG, "--user-data-dir=" + udd, "--window-size=1280,1400", "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let cerr = ""; chrome.stderr.on("data", d => { cerr += d.toString(); });

  let ver = null;
  for (let i = 0; i < 60; i++) { try { ver = await jget("http://127.0.0.1:" + DBG + "/json/version"); break; } catch (e) { await sleep(500); } }
  if (!ver) { console.log("CHROME_START_FAIL\n" + cerr.slice(0, 1500)); process.exit(1); }

  const list = await jget("http://127.0.0.1:" + DBG + "/json/list");
  const page = list.find(t => t.type === "page");
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1400, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/preview.html" });

  let ok = false;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const r = await cdp.send("Runtime.evaluate", {
      expression: `(typeof State!=='undefined') && !State.busy && !!State.result`, returnByValue: true
    });
    if (r.result.value) { ok = true; break; }
  }
  console.log("首屏已出结果：" + ok);
  if (!ok) { console.log("失败：等不到首屏结果（可能额度耗尽或网络不通）"); }

  /* ---- 关键读数：徽标 / 因素表 / 三家 I ---- */
  const info = await cdp.send("Runtime.evaluate", {
    expression: `(function(){
      const g=s=>{const e=document.querySelector(s);return e?e.textContent.replace(/\\s+/g,' ').trim():null;};
      const bd=document.querySelector('#hero .cfbadge');
      const fr=[...document.querySelectorAll('#fac tbody tr')].filter(t=>{const td=t.querySelector('td');return td&&/模式一致性/.test(td.textContent);})[0];
      return JSON.stringify({
        badge: g('#hero .cfbadge'),
        badgeColor: bd?bd.style.getPropertyValue('--cfb'):null,
        conf: State.result? State.result.conf : null,
        confInBands: State.result? (ENS_CONF_BANDS.indexOf(State.result.conf)>=0) : null,
        dvI: State.result? +State.result.dvI.toFixed(2) : null,
        consist: State.result? Math.round(State.result.consist) : null,
        partsI: State.result? State.result.parts.map(x=>x.k+'='+Math.round(x.I)).join(' ') : null,
        heroHint: [...document.querySelectorAll('#hero .hint')].map(e=>e.textContent.replace(/\\s+/g,' ').trim()).filter(t=>/综合指数/.test(t))[0] || null,
        facRow: fr? [...fr.querySelectorAll('td')].map(td=>td.textContent.replace(/\\s+/g,' ').trim()).join(' || ') : null
      }, null, 1);
    })()`, returnByValue: true
  });
  console.log("\n=== 关键读数 ===");
  console.log(info.result.value);

  /* ---- 结论卡截图（含徽标） ---- */
  const box = await cdp.send("Runtime.evaluate", {
    expression: `(function(){
      const el=document.querySelector('#cardHero');
      if(!el) return null;
      const r=el.getBoundingClientRect();
      return JSON.stringify({x:r.x+window.scrollX, y:r.y+window.scrollY, w:r.width, h:r.height});
    })()`, returnByValue: true
  });
  const bb = JSON.parse(box.result.value || "null");
  if (bb && bb.w > 10) {
    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png", captureBeyondViewport: true,
      clip: { x: Math.max(0, bb.x - 10), y: Math.max(0, bb.y - 10), width: Math.min(bb.w + 20, 1240), height: bb.h + 20, scale: 2 }
    });
    const f = path.join(SERVE, "shot-next-hero.png");
    fs.writeFileSync(f, Buffer.from(shot.data, "base64"));
    console.log("\n结论卡截图 -> " + f);
  }

  /* ---- 分享卡 PNG（toBlob 打桩接住 dataURL，click 打桩避免真下载） ---- */
  const card = await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{
      if(typeof shareCard!=='function') return 'NO_FN';
      const o=HTMLCanvasElement.prototype.toBlob;
      const oc=HTMLAnchorElement.prototype.click;
      let data=null;
      HTMLCanvasElement.prototype.toBlob=function(cb,type){
        return o.call(this,function(b){
          const fr=new FileReader();
          fr.onload=()=>{ data=fr.result; cb(b); };
          fr.readAsDataURL(b);
        },type);
      };
      HTMLAnchorElement.prototype.click=function(){};
      let err=null;
      try{ shareCard(); }catch(e){ err=String((e&&e.message)||e); }
      const t0=Date.now();
      while(!data && !err && Date.now()-t0<10000) await new Promise(r=>setTimeout(r,100));
      HTMLCanvasElement.prototype.toBlob=o;
      HTMLAnchorElement.prototype.click=oc;
      return err ? ('ERR '+err) : (data || 'NO_DATA');
    })()`, returnByValue: true, awaitPromise: true
  });
  const durl = card.result.value || "";
  if (durl.indexOf("base64,") > 0) {
    const buf = Buffer.from(durl.split("base64,")[1], "base64");
    /* 文件名与页面里 <a download> 的规则一致，便于一眼确认落地命名是"地点_日期_时段" */
    const meta = await cdp.send("Runtime.evaluate", {
      expression: `JSON.stringify({n:State.result.name, d:State.result.dateStr, p:State.result.period==='am'?'朝霞':'晚霞'})`,
      returnByValue: true
    });
    const m = JSON.parse(meta.result.value || "{}");
    const nm = "sharecard_" + String(m.n || "x").replace(/[\\/:*?"<>|,]/g, "") + "_" + (m.d || "") + "_" + (m.p || "") + ".png";
    const f = path.join(SERVE, nm);
    fs.writeFileSync(f, buf);
    console.log("分享卡 PNG  -> " + f + "   " + buf.length + " 字节");
  } else {
    console.log("分享卡导出失败：" + durl.slice(0, 200));
  }

  await cdp.send("Browser.close").catch(() => { });
  chrome.kill(); srv.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
