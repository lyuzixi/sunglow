/* 一次性取证：案 C·2 街区级自动切换（英文页，zoom 15 = 底图中文接管 / zoom 6 = 恢复自绘） */
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "c2-shot-"));
const OUT = path.join(__dirname, ".shots");
fs.mkdirSync(OUT, { recursive: true });

function ab(...args) {
  const out = path.join(TMP, "o.txt");
  const err = path.join(TMP, "e.txt");
  const fo = fs.openSync(out, "w");
  const fe = fs.openSync(err, "w");
  try {
    execFileSync(cmd, args, { stdio: ["ignore", fo, fe], timeout: 120000 });
  } catch (e) {
    const m = fs.existsSync(err) ? fs.readFileSync(err, "utf8").trim() : "";
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error(m || String(e && e.message));
  } finally {
    fs.closeSync(fo);
    fs.closeSync(fe);
  }
  return fs.readFileSync(out, "utf8").trim();
}
const ev = (js) => ab("eval", js).replace(/^"|"$/g, "");

const BASE = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href;
const Q =
  BASE + "?name=" + encodeURIComponent("广州市") + "&lat=23.1291&lon=113.2644" +
  "&date=2026-10-22&period=pm";

ab("open", Q);
ab("eval", `localStorage.setItem('glowcast.v2.pref', ` +
  `JSON.stringify({lang:'en',theme:'light',cityName:'广州市'}))`);
ab("reload");
ab("wait", "2200");
ab("eval", `(()=>{const m=window.__gcMap&&window.__gcMap();
  if(m&&typeof m.setZoom==='function'){m.setZoom(15);return 'ok'}return 'no'})()`);
ab("wait", "2600");
ab("eval", `document.querySelector('#field').scrollIntoView({block:'start'});1`);
ab("wait", "800");
console.log("z15:", ev(`window.__gcBaseMap?JSON.stringify(window.__gcBaseMap()):'n'`));
ab("screenshot", path.join(OUT, "c2-en-z15.png"));
ab("eval", `(()=>{const m=window.__gcMap(); m.setZoom(6); return 1})()`);
ab("wait", "2600");
console.log("z6:", ev(`window.__gcBaseMap?JSON.stringify(window.__gcBaseMap()):'n'`));
ab("screenshot", path.join(OUT, "c2-en-z6.png"));
ab("close", "--all");
