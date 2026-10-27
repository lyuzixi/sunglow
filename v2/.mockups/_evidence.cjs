/* 取证：把 57 个采样点按真实投影叠到地图截图上，看「圆」的圆心是不是采样点 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const cmd = path.join(
  path.dirname(process.execPath), "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe"
);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ev-"));
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href + "?v=" + Date.now();

function parseAny(v) {
  for (let i = 0; i < 4; i++) {
    if (v && typeof v === "object") return v;
    try { v = JSON.parse(v); } catch { return v; }
  }
  return v;
}
const ev = (js) => parseAny(ab("eval", js));

(async () => {
  ab("close", "--all");
  ab("open", PAGE);
  await wait(2500);
  ab("eval", `document.querySelector('#field')?.scrollIntoView({behavior:'instant',block:'start'});1`);
  await wait(900);
  ab("eval", `document.querySelector('#field .btn-primary')?.click();1`);
  for (let i = 0; i < 40; i++) {
    await wait(1500);
    const n = ev(`(()=>{try{return window.__gcPts().pts.length}catch(e){return -1}})()`);
    if (n > 0) { console.log('就绪，点数', n); break; }
  }

  ab("eval", `document.querySelector('.map-box').scrollIntoView({behavior:'instant',block:'center'});1`);
  await wait(600);
  const info = ev(`JSON.stringify((()=>{
    const g = window.__gcPts();
    const b = document.querySelector('.map-box').getBoundingClientRect();
    const out = g.pts.map(p=>{const s=window.__gcProj(p.lat,p.lon);
      return {n:p.name, v:p.v, x:Math.round(b.left+s.x), y:Math.round(b.top+s.y),
              lx:Math.round(s.x), ly:Math.round(s.y)};});
    return {box:{x:Math.round(b.left),y:Math.round(b.top),w:Math.round(b.width),h:Math.round(b.height)},
            span: window.__gcSnap(0,0).span, pts: out,
            dpr: window.devicePixelRatio};
  })())`);
  console.log("box:", JSON.stringify(info.box), "span:", info.span, "dpr:", info.dpr);
  fs.mkdirSync(path.join(__dirname, ".build"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, ".build", "screen.json"), JSON.stringify(info, null, 1));

  const shot = path.join(__dirname, ".shots", "field-evidence.png");
  ab("screenshot", shot);
  console.log("shot:", shot, "pts:", info.pts.length);
  ab("close", "--all");
})();
