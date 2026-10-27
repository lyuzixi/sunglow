const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const { pathToFileURL } = require("url");
const cmd = path.join(path.dirname(process.execPath), "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cmp-"));
function ab(...args) {
  const o = path.join(TMP, "o.txt"), e = path.join(TMP, "e.txt");
  const fo = fs.openSync(o, "w"), fe = fs.openSync(e, "w");
  try { execFileSync(cmd, args, { stdio: ["ignore", fo, fe], timeout: 120000 }); }
  catch (err) { if (!fs.existsSync(o) || !fs.statSync(o).size) throw new Error(fs.existsSync(e) ? fs.readFileSync(e, "utf8") : String(err)); }
  finally { fs.closeSync(fo); fs.closeSync(fe); }
  return fs.readFileSync(o, "utf8").trim();
}
const BASE = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href;
const SH = path.resolve(__dirname, ".shots");

function base(lang) {
  ab("open", BASE + "?name=" + encodeURIComponent("广州市") + "&lat=23.1291&lon=113.2644&date=2026-10-22&period=pm");
  ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'${lang}',theme:'light'}))`);
  ab("set", "viewport", "1280", "900");
  ab("reload");
  ab("wait", "3200");
  ab("eval", `document.querySelector('#field').scrollIntoView();document.querySelector('.rank')&&(document.querySelector('.rank').style.display='none');1`);
  ab("wait", "700");
}
function info() {
  let r = ab("eval", `JSON.stringify({z:window.__gcMap().getZoom(), lb:window.__gcLabels()})`);
  let o = JSON.parse(r); if (typeof o === "string") o = JSON.parse(o);
  const lb = o.lb || {};
  return { z: o.z, span: Math.round(lb.span), drawn: lb.drawn, total: lb.total, names: (lb.names || []).slice(0, 8).join(", ") };
}

/* A：锁最小缩放 —— 英文，zoom 8（跨度约 265km），只有自绘层 */
base("en");
ab("eval", `(()=>{const m=window.__gcMap();m.setZoom(8);m.setCenter(new TMap.LatLng(23.1291,113.2644));return 1})()`);
ab("wait", "2200");
ab("screenshot", path.join(SH, "cmp-A-en-z8.png"));
console.log("A en z8   ", JSON.stringify(info()));

/* C1：不锁缩放 + 英文下保留底图中文文字 + 自绘也开着（看叠字） */
base("en");
ab("eval", `(()=>{const m=window.__gcMap();m.setBaseMap({type:'vector',features:['base','point','label','building2d']});m.setZoom(15);m.setCenter(new TMap.LatLng(23.1291,113.2644));return 1})()`);
ab("wait", "2600");
ab("screenshot", path.join(SH, "cmp-C1-en-z15-both.png"));
console.log("C1 en z15 ", JSON.stringify(info()));

/* C2：按缩放自动切 —— 街区级关自绘、开底图文字（示意：隐去叠加层） */
base("en");
ab("eval", `(()=>{const m=window.__gcMap();m.setBaseMap({type:'vector',features:['base','point','label','building2d']});m.setZoom(15);m.setCenter(new TMap.LatLng(23.1291,113.2644));document.querySelector('.overlay').style.visibility='hidden';return 1})()`);
ab("wait", "2600");
ab("screenshot", path.join(SH, "cmp-C2-en-z15-auto.png"));
console.log("C2 en z15 ", JSON.stringify(info()));

/* 参照：繁体在街区级（自绘层，繁体名） */
base("hant");
ab("eval", `(()=>{const m=window.__gcMap();m.setZoom(8);m.setCenter(new TMap.LatLng(23.1291,113.2644));return 1})()`);
ab("wait", "2200");
ab("screenshot", path.join(SH, "cmp-A-hant-z8.png"));
console.log("A hant z8 ", JSON.stringify(info()));

ab("close", "--all");
