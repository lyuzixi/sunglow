/* 量腾讯底图地名相对锚点的偏移：给 __gcProj(广州) 的像素位置，截附近区域目检 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const cmd = path.join(
  path.dirname(process.execPath), "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe"
);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lb-"));
function ab(...args) {
  const out = path.join(TMP, "o.txt"), err = path.join(TMP, "e.txt");
  const fo = fs.openSync(out, "w"), fe = fs.openSync(err, "w");
  try { execFileSync(cmd, args, { stdio: ["ignore", fo, fe], timeout: 180000 }); }
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
  ab("reload");
  await wait(6000);
  ev(`document.querySelector('#field').scrollIntoView({behavior:'instant',block:'start'});1`);
  await wait(1200);
  /* 把地图中部滚到视口中央，让广州市落在截图里 */
  ev(`(()=>{const b=document.querySelector('.map-box').getBoundingClientRect();
    window.scrollTo({top:window.scrollY+b.top-40,behavior:'instant'});return 1})()`);
  await wait(1200);
  const info = ev(`(()=>{const p=window.__gcProj(23.1252,113.2806);
    const b=document.querySelector('.map-box').getBoundingClientRect();
    const sd=!!(window.__gcMap&&window.__gcMap());
    return JSON.stringify({p:p&&{x:Math.round(p.x),y:Math.round(p.y)},
      box:{x:Math.round(b.left),y:Math.round(b.top),w:Math.round(b.width),h:Math.round(b.height)},
      page:p&&{x:Math.round(b.left+p.x),y:Math.round(b.top+p.y)},
      sdk:sd})})()`);
  console.log("proj:", info);
  /* 在 __gcProj(广州) 处钉一个红框：直接看它有没有框住「广州市」三个字 */
  ev(`(()=>{const b=document.querySelector('.map-box');
    const d=document.createElement('div');
    d.style.cssText='position:absolute;left:388px;top:189px;width:20px;height:20px;border:2px solid red;border-radius:50%;z-index:9999;pointer-events:none';
    b.appendChild(d);return 1})()`);
  await wait(400);
  ab("screenshot", path.join(__dirname, ".shots", "label-anchor.png"));
  console.log("shot ok");
  ab("close", "--all");
})();
