/* 验证分层色面：趋势面无牛眼 + 光斑清单 + 目检截图 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const cmd = path.join(
  path.dirname(process.execPath), "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe"
);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vf-"));
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
  let n = 0;
  for (let i = 0; i < 40; i++) {
    await wait(1500);
    n = ev(`(()=>{try{return window.__gcPts().pts.length}catch(e){return -1}})()`);
    if (n > 0) break;
  }
  if (n <= 0) { console.error("没数据"); process.exit(1); }
  console.log("点数:", n);

  const g = ev(`JSON.stringify(window.__gcPts())`);
  console.log("异常点 %d 个:", g.spikes.length);
  for (const s of g.spikes) {
    console.log("   %s(%s,%s) v=%s 残差=%s", (s.resid > 0 ? "亮点" : "暗点"),
      s.lat.toFixed(2), s.lon.toFixed(2), s.v.toFixed(1), s.resid.toFixed(1));
  }

  /* 核心断言：采样点本身 vs 40km 外，趋势面必须缓变（旧算法差 20~30 分） */
  const diffs = ev(`JSON.stringify((()=>{
    const g = window.__gcPts();
    const out = [];
    for (const p of g.pts) {
      const dLon = 40 / (111.32 * Math.cos(p.lat * Math.PI / 180));
      const a = window.__gcTrend(p.lat, p.lon);
      const b = window.__gcTrend(p.lat, p.lon + dLon);
      if (a != null && b != null) out.push({n:p.name, d:Math.abs(a-b), a:+a.toFixed(1), b:+b.toFixed(1)});
    }
    out.sort((x,y)=>y.d-x.d);
    return {max:out[0], list:out.slice(0,5)};
  })())`);
  console.log("趋势面在采样点 vs 40km 外的偏差（应 < 8）:");
  console.log("   最大:", JSON.stringify(diffs.max));
  for (const t of diffs.list) console.log("   ", t.n, "Δ=" + t.d.toFixed(1), "(", t.a, "→", t.b, ")");

  ab("eval", `document.querySelector('.map-box')?.scrollIntoView({behavior:'instant',block:'center'});1`);
  await wait(600);
  ab("screenshot", path.join(__dirname, ".shots", "field-layered.png"));
  console.log("shot1 ok");

  /* 关掉数值直标 → 光斑自带分数 */
  ab("eval", `(()=>{const c=[...document.querySelectorAll('label')].find(l=>/数值直标/.test(l.textContent));
    const i=c&&c.querySelector('input'); if(i&&i.checked){i.click();return 1} return 0})()`);
  await wait(900);
  ab("screenshot", path.join(__dirname, ".shots", "field-layered-spikeval.png"));
  console.log("shot2 ok");

  ab("close", "--all");
})();
