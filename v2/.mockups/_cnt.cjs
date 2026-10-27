const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const { pathToFileURL } = require("url");
const cmd = path.join(path.dirname(process.execPath), "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cnt-"));
function ab(...args) {
  const o = path.join(TMP, "o.txt"), e = path.join(TMP, "e.txt");
  const fo = fs.openSync(o, "w"), fe = fs.openSync(e, "w");
  try { execFileSync(cmd, args, { stdio: ["ignore", fo, fe], timeout: 120000 }); }
  catch (err) { if (!fs.existsSync(o) || !fs.statSync(o).size) throw new Error(fs.existsSync(e) ? fs.readFileSync(e, "utf8") : String(err)); }
  finally { fs.closeSync(fo); fs.closeSync(fe); }
  return fs.readFileSync(o, "utf8").trim();
}
const BASE = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href;
ab("open", BASE + "?name=" + encodeURIComponent("广州市") + "&lat=23.1291&lon=113.2644&date=2026-10-22&period=pm");
ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'zh',theme:'light'}))`);
ab("set", "viewport", "1280", "900");
ab("reload"); ab("wait", "3200");
ab("eval", `document.querySelector('#field').scrollIntoView();1`); ab("wait", "800");
for (const z of [6, 7, 8, 10]) {
  ab("eval", `(()=>{const m=window.__gcMap();if(!m)return 0;m.setZoom(${z});return 1})()`);
  ab("wait", z === 6 ? "1200" : "1800");
  const r = ab("eval", `JSON.stringify((()=>{const L=window.__gcLabels();return {z:window.__gcMap().getZoom(), span:L.span, tierMax:L.tierMax, drawn:L.drawn, total:L.total, uniq:new Set(L.geo.map(g=>g.text)).size};})())`);
  console.log(r);
}
ab("close", "--all");
