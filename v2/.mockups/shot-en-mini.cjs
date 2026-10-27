/* 英文手机（390）mini 态：品牌名四种处理方式的真实截图 + 实测需宽 */
const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const { pathToFileURL } = require("url");

const cmd = path.join(path.dirname(process.execPath), "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tb-enmini-"));
const OUT = path.resolve(process.cwd(), ".mockups", ".shots");
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

const MINI = ".topbar-meta{display:none!important}.meta-pill{display:none!important}.brand .name em{display:none!important}";

const PLANS = [
  { key: "E-tutorial", css: MINI + '.top-actions > a[href$="tutorial.html"]{display:none!important}', note: "教程进抽屉" },
  { key: "A-tighten", css: MINI + ".icon-btn{width:30px!important;height:30px!important}.top-actions{gap:4px!important}.topbar-in{gap:10px!important}", note: "缩按钮收间距" },
  { key: "B-logoonly", css: MINI + ".brand .name{display:none!important}", note: "只留 logo" },
  { key: "D-wrap", css: MINI + ".brand .name{max-width:62px!important}", note: "品牌名折行" }
];

const MEASURE = `(()=>{const tb=document.querySelector('.topbar');const inn=tb.querySelector('.topbar-in');
 const s2=document.createElement('style');
 s2.textContent='.topbar-in > *{flex:0 0 auto !important;margin-left:0 !important;margin-right:0 !important}.brand .name{flex-wrap:nowrap !important}';
 document.head.appendChild(s2);void inn.offsetWidth;
 const kids=[...inn.children].filter(k=>getComputedStyle(k).display!=='none');
 const gap=parseFloat(getComputedStyle(inn).columnGap)||0;
 const nat=Math.round(kids.reduce((t,k)=>t+k.getBoundingClientRect().width,0)+gap*(kids.length-1));
 const box=Math.round(inn.clientWidth);
 s2.remove();
 const nm=tb.querySelector('.brand .name');
 const cs=getComputedStyle(nm);let lh=parseFloat(cs.lineHeight);if(!isFinite(lh))lh=parseFloat(cs.fontSize)*1.4;
 const lines=nm&&getComputedStyle(nm).display!=='none'?Math.max(1,Math.round(nm.getBoundingClientRect().height/lh)):0;
 return JSON.stringify({need:nat,box,bar:Math.round(tb.getBoundingClientRect().height),lines});})()`;

for (const p of PLANS) {
  ab("open", Q);
  ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'en',theme:'light'}))`);
  ab("set", "viewport", "390", "260");
  ab("reload");
  ab("wait", "1600");
  ab("eval", `(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(p.css)};document.head.appendChild(s);})()`);
  if (p.rename) {
    ab("eval", `(()=>{const nm=document.querySelector('.brand .name');
      for(const n of nm.childNodes){ if(n.nodeType===3 && n.nodeValue.trim()){ n.nodeValue=${JSON.stringify(p.rename)}; break; } }})()`);
  }
  ab("wait", "350");
  let m = JSON.parse(ab("eval", MEASURE).split("\n").join(""));
  if (typeof m === "string") m = JSON.parse(m);
  console.log(`${p.key.padEnd(13)} 需 ${String(m.need).padStart(3)} / 容 ${m.box} → ${m.need <= m.box ? "余 " + (m.box - m.need) : "超 " + (m.need - m.box)} · 品牌 ${m.lines} 行 · 栏高 ${m.bar}`);
  ab("screenshot", path.join(OUT, `en-${p.key}.png`));
}
ab("close", "--all");
console.log("done");
