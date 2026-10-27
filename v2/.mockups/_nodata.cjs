/* 边界：完全没加载地图数据（curPts 空）时点城市名，仍应出城市卡 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const cmd = path.join(
  path.dirname(process.execPath), "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe"
);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "nodata-"));
function ab(...args) {
  const out = path.join(TMP, "o.txt"), err = path.join(TMP, "e.txt");
  const fo = fs.openSync(out, "w"), fe = fs.openSync(err, "w");
  try { execFileSync(cmd, args, { stdio: ["ignore", fo, fe], timeout: 240000 }); }
  catch (e) {
    const m = fs.existsSync(err) ? fs.readFileSync(err, "utf8").trim() : "";
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error(m || String(e && e.message));
  } finally { fs.closeSync(fo); fs.closeSync(fe); }
  return fs.readFileSync(out, "utf8").trim();
}
const ev = (js) => ab("eval", js).replace(/^"|"$/g, "");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href;

(async () => {
  ab("open", PAGE + "?name=" + encodeURIComponent("香港") + "&lat=22.3193&lon=114.1694&date=2026-10-22&period=pm");
  ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'zh',theme:'light',cityName:'香港'}))`);
  ab("eval", `Object.keys(localStorage).filter(k=>k.startsWith('glowcast.v2.')&&k!=='glowcast.v2.pref').forEach(k=>localStorage.removeItem(k))`);
  ab("reload");
  await wait(6000);
  ab("eval", `(()=>{const b=document.querySelector('.map-box').getBoundingClientRect();
    window.scrollTo({top:window.scrollY+b.top-8,behavior:'instant'});return 1})()`);
  await wait(700);
  console.log("格点:", ev(`(()=>{const s=window.__gcSnap(10,10);return s.nearest?'有':'空（未加载地图数据）'})()`));
  const G = JSON.parse(ev(`JSON.stringify((()=>{const p=window.__gcProj(23.1252,113.2806);
    return {x:Math.round(p.x),y:Math.round(p.y)}})())`).replace(/\\"/g, '"'));
  ev(`(()=>{const b=document.querySelector('.map-box');const r=b.getBoundingClientRect();
    const el=document.elementFromPoint(r.left+${G.x},r.top+${G.y-8})||b;
    const o={bubbles:true,cancelable:true,clientX:r.left+${G.x},clientY:r.top+${G.y-8},view:window};
    el.dispatchEvent(new MouseEvent('mousemove',o));
    el.dispatchEvent(new MouseEvent('mousedown',o));
    el.dispatchEvent(new MouseEvent('mouseup',o));
    el.dispatchEvent(new MouseEvent('click',o));return 1})()`);
  await wait(700);
  console.log("卡片:", ev(`(()=>{const c=document.querySelector('.pincard');
    return c?c.innerText.replace(/\\n+/g,' | '):'（没有卡片）'})()`));
  ab("screenshot", path.join(__dirname, ".shots", "city-nodata.png"));
  ab("close", "--all");
})();
