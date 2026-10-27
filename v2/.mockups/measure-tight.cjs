/* 取证：D1 收紧后的中/英单行需宽（决定 one / tight / menu 三档阈值） */
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tb-tight-"));
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

const BASE = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href;
const Q = (n) => BASE + "?name=" + encodeURIComponent(n) + "&lat=39.9&lon=116.4&date=2026-10-21&period=pm";

/* D1 收紧：导航 padding 13→9 / 字号 .78rem / 藏 GLOWCAST / 按钮 gap 6 */
const TIGHT_CSS = `.nav-tabs a{padding:6px 9px!important;font-size:.78rem!important}
.top-actions{gap:6px!important}
.brand .name em{display:none!important}`;

const PROBE = `(()=>{
  const st=document.createElement('style'); st.textContent=${JSON.stringify(TIGHT_CSS)};
  document.head.appendChild(st);
  const inn=document.querySelector('.topbar-in');
  const kids=[...inn.children].filter(k=>getComputedStyle(k).display!=='none');
  const need=Math.round(kids.reduce((s,k)=>s+k.getBoundingClientRect().width,0)+12*(kids.length-1));
  const nav=Math.round(document.querySelector('.nav-tabs').getBoundingClientRect().width);
  const brand=Math.round(document.querySelector('.brand').getBoundingClientRect().width);
  const pillEl=document.querySelector('.top-actions > .meta-pill');
  const pill=pillEl&&getComputedStyle(pillEl).display!=='none'?Math.round(pillEl.getBoundingClientRect().width):0;
  return [need,nav,brand,pill].join(',');
})()`;

for (const lang of ["zh", "en"]) {
  ab("open", Q("北京市"));
  ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'${lang}',theme:'light'}))`);
  ab("set", "viewport", "1600", "900");
  ab("reload");
  ab("wait", "1200");
  console.log(lang + " 收紧后 need,nav,brand,pill : " + ab("eval", PROBE).split("\n").join(""));
}
ab("close", "--all");
