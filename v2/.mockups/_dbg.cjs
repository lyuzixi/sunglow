/* 调试：为什么 buildCount 恒 0、#field 为 null */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const cmd = path.join(path.dirname(process.execPath), "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dbg-"));
function ab(...args) {
  const out = path.join(TMP, "o.txt"), err = path.join(TMP, "e.txt");
  const fo = fs.openSync(out, "w"), fe = fs.openSync(err, "w");
  try { execFileSync(cmd, args, { stdio: ["ignore", fo, fe], timeout: 120000 }); }
  catch (e) {
    const m = fs.existsSync(err) ? fs.readFileSync(err, "utf8").trim() : "";
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error(m || String(e && e.message));
  } finally { fs.closeSync(fo); fs.closeSync(fe); }
  return fs.readFileSync(out, "utf8").trim();
}
const ev = (js) => { const s = ab("eval", js); try { return JSON.parse(s); } catch { return s; } };
const PAGE = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href + "?lat=23.1291&lon=113.2644&date=2026-10-22&period=pm";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  ab("close", "--all");
  ab("open", PAGE, "--width", "1280", "--height", "820");
  await sleep(1500);
  console.log("sections:", ev(`document.querySelectorAll('section').length`));
  console.log("#field:", ev(`!!document.querySelector('#field')`));
  console.log("canvas:", ev(`(()=>{const c=document.querySelector('.map-box canvas');return c?[c.width,c.height,c.clientWidth,c.clientHeight]:null})()`));
  console.log("pref:", ev(`localStorage.getItem('glowcast.v2.pref')`));
  ev(`(()=>{window.__logs=[];const oe=console.error;console.error=function(){window.__logs.push(Array.prototype.map.call(arguments,x=>{try{return typeof x==='string'?x:(x&&x.stack)||String(x)}catch(e){return '?'}}).join(' | '));oe.apply(console,arguments)};return 1})()`);
  ev(`(()=>{window.__errs=[];window.addEventListener('error',e=>window.__errs.push('ERR '+e.message+' @'+(e.filename||'')+':'+(e.lineno||'')));window.addEventListener('unhandledrejection',e=>window.__errs.push('REJ '+String(e.reason&&e.reason.message||e.reason)));return 1})()`);
  ev(`document.querySelector('#field .btn-primary').click();1`);
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    const n = ev(`(window.__gcPts?window.__gcPts().pts.length:0)`);
    if (typeof n === "number" && n > 0) { console.log("pts", n, "after", (i + 1) * 1.5, "s"); break; }
  }
  await sleep(1500);
  console.log("after: #field", ev(`!!document.querySelector('#field')`));
  console.log("sections", ev(`document.querySelectorAll('section').length`));
  console.log("cv", ev(`JSON.stringify(window.__gcCV&&window.__gcCV())`));
  console.log("errors", ev(`JSON.stringify(window.__errs||[])`));
  console.log("consoleErrors", ev(`JSON.stringify((window.__logs||[]).slice(0,4))`));
  ab("close", "--all");
})();
