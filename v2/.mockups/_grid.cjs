/* 打印 11x11 分数网格，判断"斑点感"是渲染问题还是数据本身逐点跳 */
const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const { pathToFileURL } = require("url");
const cmd = path.join(path.dirname(process.execPath), "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "grid-"));
function ab(...a) {
  const o = path.join(TMP, "o.txt"), e = path.join(TMP, "e.txt");
  const fo = fs.openSync(o, "w"), fe = fs.openSync(e, "w");
  try { execFileSync(cmd, a, { stdio: ["ignore", fo, fe], timeout: 120000 }); }
  catch (err) { const m = fs.existsSync(e) ? fs.readFileSync(e, "utf8").trim() : ""; if (!fs.existsSync(o) || fs.statSync(o).size === 0) throw new Error(m || String(err)); }
  finally { fs.closeSync(fo); fs.closeSync(fe); }
  return fs.readFileSync(o, "utf8").trim();
}
const ev = (js) => { const s = ab("eval", js); try { return JSON.parse(s); } catch { return s; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href +
  "?name=%E5%B9%BF%E5%B7%9E%E5%B8%82&lat=23.1291&lon=113.2644&date=2026-10-22&period=pm";
const STUB = fs.readFileSync(path.join(__dirname, "_shot2.cjs"), "utf8").match(/const STUB = `([\s\S]*?)`;\n/)[1];
(async () => {
  ab("close", "--all");
  ab("open", PAGE, "--width", "1300", "--height", "1250");
  await sleep(1000);
  ev(`localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'zh',theme:'light'}));1`);
  ab("reload"); await sleep(1200);
  ab("eval", STUB); await sleep(500);
  ev(`document.querySelector('#field .btn-primary').click();1`);
  for (let i = 0; i < 25; i++) { await sleep(600); const n = ev(`(window.__gcPts?window.__gcPts().pts.length:0)`); if (n > 0) break; }
  await sleep(1200);
  const g = ev(`(()=>{const p=window.__gcPts().pts;
    const lats=[...new Set(p.map(x=>x.lat))].sort((a,b)=>b-a);
    const lons=[...new Set(p.map(x=>x.lon))].sort((a,b)=>a-b);
    return {lats,lons,rows:lats.map(la=>lons.map(lo=>{
      const q=p.find(x=>Math.abs(x.lat-la)<1e-6&&Math.abs(x.lon-lo)<1e-6);
      return q&&q.v!=null?Math.round(q.v):null;}))};})()`);
  console.log("vals grid (北在上, 西在左):");
  for (const r of g.rows) console.log(r.map((v) => String(v ?? "-").padStart(4)).join(""));
  ab("close", "--all");
})();
