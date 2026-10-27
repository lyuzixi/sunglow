const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const { pathToFileURL } = require("url");
const cmd = path.join(path.dirname(process.execPath), "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "zm-"));
function ab(...args) {
  const o = path.join(TMP, "o.txt"), e = path.join(TMP, "e.txt");
  const fo = fs.openSync(o, "w"), fe = fs.openSync(e, "w");
  try { execFileSync(cmd, args, { stdio: ["ignore", fo, fe], timeout: 120000 }); }
  catch (err) { if (!fs.existsSync(o) || !fs.statSync(o).size) throw new Error(fs.existsSync(e) ? fs.readFileSync(e, "utf8") : String(err)); }
  finally { fs.closeSync(fo); fs.closeSync(fe); }
  return fs.readFileSync(o, "utf8").trim();
}
const BASE = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href;
function run(name, lang) {
  ab("open", BASE + "?name=" + encodeURIComponent("广州市") + "&lat=23.1291&lon=113.2644&date=2026-10-22&period=pm");
  ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'${lang}',theme:'light'}))`);
  ab("set", "viewport", "1280", "900");
  ab("reload");
  ab("wait", "3200");
  ab("eval", `document.querySelector('#field').scrollIntoView();document.querySelector('.rank')&&(document.querySelector('.rank').style.display='none');1`);
  ab("wait", "700");
  ab("eval", `(()=>{const m=window.__gcMap();m.setZoom(15);m.setCenter(new TMap.LatLng(23.1291,113.2644));return 1})()`);
  ab("wait", "2500");
  ab("screenshot", path.resolve(__dirname, ".shots", name + ".png"));
  let r = ab("eval", `JSON.stringify({z:window.__gcMap().getZoom(), span:window.__gcLabels?window.__gcLabels().span:null, drawn:window.__gcLabels?window.__gcLabels().drawn:null})`);
  console.log(name, r);
}
run("zoom15-en", "en");
run("zoom15-zh", "zh");
ab("close", "--all");
