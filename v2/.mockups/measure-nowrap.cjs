/* 取证：强制 nowrap 后，中/英顶栏的自然需宽与溢出（决定折回断点与降级方案） */
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tb-nowrap-"));
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

/* 注入 nowrap 后量：品牌 + 导航 + 四按钮(+胶囊) 的自然需宽，以及各块宽度 */
const PROBE = `(()=>{
  const st=document.createElement('style');
  st.textContent='.nav-tabs a,.brand .name{white-space:nowrap!important}';
  document.head.appendChild(st);
  const inn=document.querySelector('.topbar-in');
  const kids=[...inn.children].filter(k=>getComputedStyle(k).display!=='none');
  const need=Math.round(kids.reduce((s,k)=>s+k.getBoundingClientRect().width,0)+12*(kids.length-1));
  const brand=Math.round(document.querySelector('.brand').getBoundingClientRect().width);
  const nav=Math.round(document.querySelector('.nav-tabs').getBoundingClientRect().width);
  const acts=Math.round(document.querySelector('.top-actions').getBoundingClientRect().width);
  const pillEl=document.querySelector('.top-actions > .meta-pill');
  const pill=pillEl&&getComputedStyle(pillEl).display!=='none'?Math.round(pillEl.getBoundingClientRect().width):0;
  return [need,brand,nav,acts,pill,Math.round(inn.getBoundingClientRect().width),inn.scrollWidth].join(',');
})()`;

for (const lang of ["zh", "en"]) {
  for (const w of [1280, 1180, 1100, 1080, 1024, 960, 900, 861]) {
    ab("open", Q("北京市"));
    ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'${lang}',theme:'light'}))`);
    ab("set", "viewport", String(w), "900");
    ab("reload");
    ab("wait", "900");
    const raw = ab("eval", PROBE).split("\n").join("");
    console.log(lang + " " + w + "px => need,brand,nav,acts,pill,wrapW,scrollW : " + raw);
  }
}
ab("close", "--all");
