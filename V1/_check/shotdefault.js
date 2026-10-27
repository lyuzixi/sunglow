/* 一次性核对：用**真实接口**打开 _check/preview.html 的首屏，验证默认城市是广州。
   不mock网络（只想看首屏文案），所以会花掉一次单点查询的额度（约 51 坐标）。
   用法: node _check/shotdefault.js
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
const PORT = 47901;

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
}

(async function main() {
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "cdpsd-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=9341", "--user-data-dir=" + udd, "--window-size=1280,1000", "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let cerr = ""; chrome.stderr.on("data", d => { cerr += d.toString(); });

  let ver = null;
  for (let i = 0; i < 60; i++) { try { ver = await jget("http://127.0.0.1:9341/json/version"); break; } catch (e) { await sleep(500); } }
  if (!ver) { console.log("CHROME_START_FAIL\n" + cerr.slice(0, 1500)); process.exit(1); }

  const list = await jget("http://127.0.0.1:9341/json/list");
  const page = list.find(t => t.type === "page");
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/preview.html" });

  /* 等首屏单点预报出结果（不再 busy），最多 60 s */
  let ok = false;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const r = await cdp.send("Runtime.evaluate", {
      expression: `(typeof State!=='undefined') && !State.busy && !!State.result`, returnByValue: true
    });
    if (r.result.value) { ok = true; break; }
  }

  const r = await cdp.send("Runtime.evaluate", {
    expression: `JSON.stringify({
      name: State.name, region: State.region,
      lat: +State.lat.toFixed(4), lon: +State.lon.toFixed(4),
      url: location.search,
      locHint: (document.querySelector('#locHint')||{}).textContent || '',
      hero: ((document.querySelector('#hero')||{}).textContent||'').replace(/\\s+/g,' ').slice(0,150),
      cityLine: (document.querySelector('#cityLine')||document.querySelector('.cityline')||{}).textContent || '',
      mapTag: (document.querySelector('#mapTag')||{}).textContent || ''
    })`, returnByValue: true
  });
  console.log("首屏状态：" + r.result.value);
  console.log("预报已出：" + ok);

  const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const out = path.join(SERVE, "shot-default-city.png");
  fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("截图 -> " + out);

  await cdp.send("Browser.close").catch(() => { });
  chrome.kill(); srv.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
