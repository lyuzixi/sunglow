/* 精确「自然需宽」：.top-actions 与 .nav-tabs 都有 margin:auto，
   scrollWidth 在「放得下」时会恒等于容器宽，量不出余量。
   只能先摘掉 flex 压缩与 auto margin，再累加各子项 width。 */
const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const { pathToFileURL } = require("url");

const cmd = path.join(path.dirname(process.execPath), "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tb-nat-"));
function ab(...args) {
  const out = path.join(TMP, "o.txt"), err = path.join(TMP, "e.txt");
  const fo = fs.openSync(out, "w"), fe = fs.openSync(err, "w");
  try { execFileSync(cmd, args, { stdio: ["ignore", fo, fe], timeout: 120000 }); }
  catch (e) {
    const m = fs.existsSync(err) ? fs.readFileSync(err, "utf8").trim() : "";
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error(m || String(e && e.message));
  } finally { fs.closeSync(fo); fs.closeSync(fe); }
  return fs.readFileSync(out, "utf8").trim();
}

const BASE = pathToFileURL(path.resolve(process.cwd(), "index.html")).href;
const Q = BASE + "?name=" + encodeURIComponent("广州市") + "&lat=23.13&lon=113.26&date=2026-10-22&period=pm";

const PROBE = (css) => `(()=>{const tb=document.querySelector('.topbar');const inn=tb.querySelector('.topbar-in');
 const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);
 const s2=document.createElement('style');
 s2.textContent='.topbar-in > *{flex:0 0 auto !important;margin-left:0 !important;margin-right:0 !important}.brand .name{flex-wrap:nowrap !important}';
 document.head.appendChild(s2);void inn.offsetWidth;
 const kids=[...inn.children].filter(k=>getComputedStyle(k).display!=='none');
 const gap=parseFloat(getComputedStyle(inn).columnGap)||0;
 const nat=Math.round(kids.reduce((t,k)=>t+k.getBoundingClientRect().width,0)+gap*(kids.length-1));
 const box=Math.round(inn.clientWidth);
 s.remove();s2.remove();
 return JSON.stringify({need:nat,box});})()`;

const CASES = {
  "mini（无胶囊·藏副标）": ".topbar-meta{display:none!important}.meta-pill{display:none!important}.brand .name em{display:none!important}",
  "menu（汉堡+完整胶囊）": ".topbar-meta{display:none!important}.meta-pill{display:inline-flex!important}",
  "menu-mini（汉堡+无胶囊·藏副标）": ".topbar-meta{display:none!important}.meta-pill{display:none!important}.brand .name em{display:none!important}",
  "tight-mini（收紧+无胶囊）": ".topbar-meta{display:none!important}.meta-pill{display:none!important}.brand .name em{display:none!important}" +
    ".nav-tabs a{padding:6px 9px!important;font-size:.78rem!important}.top-actions{gap:6px!important}"
};

for (const lang of ["zh", "en"]) {
  for (const w of [390, 430]) {
    ab("open", Q);
    ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'${lang}',theme:'light'}))`);
    ab("set", "viewport", String(w), "844");
    ab("reload");
    ab("wait", "1500");
    const line = [];
    for (const [k, css] of Object.entries(CASES)) {
      let r = JSON.parse(ab("eval", PROBE(css)).split("\n").join(""));
      if (typeof r === "string") r = JSON.parse(r);
      line.push(`${k.padEnd(28)} 需 ${String(r.need).padStart(4)} / 容 ${r.box} → ${r.need <= r.box ? "余 " + (r.box - r.need) : "超 " + (r.need - r.box)}`);
    }
    console.log(`\n=== ${lang} · 视口 ${w} ===`);
    console.log(line.join("\n"));
  }
}
ab("close", "--all");
