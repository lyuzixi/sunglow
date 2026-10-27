/* 一次性取证：真实构建产物里顶栏各断点的实测高度与徽标行高 */
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tb-real-"));
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

const PAGE =
  pathToFileURL(path.resolve(__dirname, "..", "index.html")).href +
  "?name=%E5%8C%97%E4%BA%AC&lat=39.9042&lon=116.4074&date=2026-10-21&period=pm";

ab("open", PAGE);
ab("eval", "localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'zh',theme:'light'}))");

const probe = `(()=>{
  const tb=document.querySelector('.topbar');
  const inn=document.querySelector('.topbar-in');
  const meta=document.querySelector('.topbar-meta');
  const sec=document.querySelector('#field');
  const kids=[...inn.children].filter(k=>getComputedStyle(k).display!=='none');
  const need=kids.reduce((s,k)=>s+k.getBoundingClientRect().width,0)+12*(kids.length-1);
  return [Math.round(tb.getBoundingClientRect().height),
          Math.round(inn.getBoundingClientRect().height),
          meta?Math.round(meta.getBoundingClientRect().height):0,
          Math.round(need),
          Math.round(parseFloat(getComputedStyle(sec).scrollMarginTop))].join(',');
})()`;

for (const w of [1280, 1060, 1000, 900, 861, 720, 390]) {
  ab("set", "viewport", String(w), "900");
  ab("wait", "320");
  const raw = ab("eval", probe).split("\n").join("");
  console.log(w + "px => bar,in,meta,need,scrollMargin : " + raw);
}
ab("close", "--all");
