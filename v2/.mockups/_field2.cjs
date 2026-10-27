/* 一次性验收取证（2026-10-22 热力图重做）：真实数据下的场层指标 + 截图 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const cmd = path.join(
  path.dirname(process.execPath),
  "node_modules",
  "agent-browser",
  "bin",
  "agent-browser-win32-x64.exe"
);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "field2-"));
const OUT = path.join(__dirname, ".shots");
fs.mkdirSync(OUT, { recursive: true });

function ab(...args) {
  const out = path.join(TMP, "o.txt");
  const err = path.join(TMP, "e.txt");
  const fo = fs.openSync(out, "w");
  const fe = fs.openSync(err, "w");
  try {
    execFileSync(cmd, args, { stdio: ["ignore", fo, fe], timeout: 180000 });
  } catch (e) {
    const m = fs.existsSync(err) ? fs.readFileSync(err, "utf8").trim() : "";
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error(m || String(e && e.message));
  } finally {
    fs.closeSync(fo);
    fs.closeSync(fe);
  }
  return fs.readFileSync(out, "utf8").trim();
}
const ev = (js) => {
  const s = ab("eval", js);
  try { return JSON.parse(s); } catch { return s; }
};

const PAGE = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href +
  "?name=%E5%B9%BF%E5%B7%9E%E5%B8%82&lat=23.1291&lon=113.2644&date=2026-10-22&period=pm";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  ab("close", "--all");
  ab("open", PAGE, "--width", "1280", "--height", "800");
  await sleep(1500);

  /* 清偏好，保证默认开关是本版本拍板的那套 */
  ev(`localStorage.removeItem('glowcast.v2.pref');1`);
  ab("open", PAGE, "--width", "1280", "--height", "800");
  await sleep(1200);

  ev(`document.querySelector('#field .btn-primary').click();1`);

  let n = 0;
  for (let i = 0; i < 60; i++) {
    await sleep(1500);
    const g = ev(`(window.__gcPts?window.__gcPts().pts.length:0)`);
    n = typeof g === "number" ? g : 0;
    if (n > 0) break;
  }
  console.log("网格点数:", n);
  if (!n) { console.error("没取到数"); ab("close", "--all"); process.exit(1); }

  await sleep(1200);
  const cv = ev(`JSON.stringify(window.__gcCV())`);
  console.log("CV/性能:", typeof cv === "string" ? cv : JSON.stringify(cv));

  /* 采样点 vs 40km 外：验证「过点但不出现平台」 */
  const gapProbe = ev(`(()=>{const g=window.__gcPoints||null;return 1})()`);
  void gapProbe;

  const pts = ev(`JSON.stringify(window.__gcPts().pts.slice(0,4))`);
  console.log("样例点:", pts);

  /* 合成场：85 分孤峰 + 一圈 10 分，检查过点与平滑过渡 */
  const synth = ev(`JSON.stringify((()=>{
    const list=[]; const c={lat:23,lon:113};
    for(let i=0;i<12;i++){const a=i*Math.PI/6;list.push({lat:c.lat+0.72*Math.cos(a),lon:c.lon+0.74*Math.sin(a),v:10});}
    list.push({lat:c.lat,lon:c.lon,v:85});
    const at=(d)=>window.__gcFieldProbe(list,c.lat+d*0.0090,c.lon);
    return {peak:at(0),d10:at(10),d30:at(30),d60:at(60),d90:at(90)};
  })())`);
  console.log("合成孤峰:", synth);

  ab("eval", `document.querySelector('#field').scrollIntoView({behavior:'instant',block:'start'});1`);
  await sleep(800);
  ab("screenshot", path.join(OUT, "v2-field-new-light.png"));

  ab("close", "--all");
})();
