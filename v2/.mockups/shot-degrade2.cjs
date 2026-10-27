/* 手机档四方案的「真实产物」截图：在 index.html 上注入临时样式，不构建、不进 src。
   方案 1 顶栏无徽标 / 2 只 logo+只地点 / 3 徽标下移 hero 上方 / 4 两行左对齐信息带 */
const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const { pathToFileURL } = require("url");

const cmd = path.join(path.dirname(process.execPath), "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tb-d2-"));
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

const NO_PILL = ".topbar-meta{display:none !important}.meta-pill{display:none !important}";
const NO_EM = ".brand .name em{display:none !important}";

const PLANS = [
  { key: "1-nopill", css: NO_PILL + NO_EM, pill: null, h: 200 },
  { key: "2-logoonly", css: NO_PILL + ".brand .name{display:none !important}.meta-pill{display:inline-flex !important}", pill: "广州市", h: 200 },
  { key: "3-herobar", css: NO_PILL + NO_EM, pill: null, h: 330, infobar: true },
  {
    key: "4-leftband",
    css: NO_EM + ".meta-pill{display:none !important}.topbar-meta{display:flex !important;justify-content:flex-start !important;" +
         "padding:2px 0 6px 44px !important;border-top:1px solid var(--stroke) !important;margin-top:3px !important}",
    pill: null, h: 210
  }
];

const MEASURE = `(()=>{const tb=document.querySelector('.topbar');const inn=tb.querySelector('.topbar-in');
 const kids=[...inn.children].filter(k=>getComputedStyle(k).display!=='none');
 const st=document.createElement('style');document.head.appendChild(st);
 st.textContent='.topbar-in > *{flex:0 0 auto !important} .brand .name{flex-wrap:nowrap !important}';
 void inn.offsetWidth;
 const nat=Math.round(inn.scrollWidth);
 st.remove();
 const nm=tb.querySelector('.brand .name');
 return JSON.stringify({bar:Math.round(tb.getBoundingClientRect().height), need:nat, box:Math.round(inn.clientWidth),
   nameVis:nm?getComputedStyle(nm).display!=='none':false});})()`;

for (const w of [390, 430]) {
  for (const p of PLANS) {
    ab("open", Q);
    ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'zh',theme:'light'}))`);
    ab("set", "viewport", String(w), String(p.h + 40));
    ab("reload");
    ab("wait", "1600");

    if (p.infobar) {
      ab("eval", `(()=>{const hero=document.querySelector('.hero');
        const d=document.createElement('div');
        d.className='gc-infobar';
        d.textContent='广州市 · 2026-10-22 · 晚霞';
        d.style.cssText='padding:7px 20px;font-size:12px;letter-spacing:.2px;color:var(--tx-3);'+
          'background:color-mix(in srgb, var(--bg-base) 60%, transparent);'+
          'border-bottom:1px solid var(--stroke);font-variant-numeric:tabular-nums;';
        hero.parentNode.insertBefore(d, hero);})()`);
    }
    ab("eval", `(()=>{const s=document.createElement('style');s.id='inj';s.textContent=${JSON.stringify(p.css)};document.head.appendChild(s);})()`);
    if (p.pill !== null) {
      ab("eval", `(()=>{const el=document.querySelector('.meta-pill'); if(el) el.innerHTML='<span>${p.pill}</span>';})()`);
    }
    ab("wait", "320");
    let m = JSON.parse(ab("eval", MEASURE).split("\n").join(""));
    if (typeof m === "string") m = JSON.parse(m);
    console.log(`${w} ${p.key.padEnd(12)} 栏高 ${m.bar} · 需 ${m.need} / 容 ${m.box} · ${m.need <= m.box ? "放得下" : "超 " + (m.need - m.box)}`);
    const f = path.join(OUT, `d2-${w}-${p.key}.png`);
    ab("screenshot", f);
  }
}
ab("close", "--all");
console.log("done");
