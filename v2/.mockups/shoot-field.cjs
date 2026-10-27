/* 一次性取证：载入色面后的渲染目检（缓存重构后热力场/云纹/等值线是否正常） */
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "field-shot-"));
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
const PAGE = BASE + "?name=%E5%8C%97%E4%BA%AC&lat=39.9042&lon=116.4074&date=2026-10-21&period=pm";

const FETCH_STUB = `(()=>{window.__calls=[];
  const fake=(u)=>{u=String(u); window.__calls.push(u);
    const q=new URL(u, location.href).searchParams;
    const nLoc=(q.get('latitude')||'').split(',').filter(Boolean).length||1;
    const vars=(q.get('hourly')||'').split(',').filter(Boolean);
    const sd=q.get('start_date'), ed=q.get('end_date'), fd=+q.get('forecast_days')||7;
    let t0,nH;
    if(sd){t0=Date.parse(sd+'T00:00:00Z');const t1=ed?Date.parse(ed+'T00:00:00Z'):t0;
      nH=Math.round((t1-t0)/3600000)+24;}
    else{t0=Date.now()-3*86400000;nH=24*(fd+3);}
    const time=[];
    for(let i=0;i<nH;i++) time.push(new Date(t0+i*3600000).toISOString().slice(0,16));
    const DEF={temperature_2m:15,dew_point_2m:8,relative_humidity_2m:60,
      cloud_cover_low:20,cloud_cover_mid:45,cloud_cover_high:30,visibility:20000,
      pressure_msl:1013,boundary_layer_height:800,freezing_level_height:2000,
      aerosol_optical_depth:0.2};
    const hourly={time};
    for(const v of vars) hourly[v]=time.map((_,i)=>(v in DEF?DEF[v]:(i*7)%100));
    const one={hourly,utc_offset_seconds:28800,timezone:'Asia/Shanghai'};
    const body=nLoc>1?Array.from({length:nLoc},(_,k)=>({hourly,utc_offset_seconds:28800,
      timezone:'Asia/Shanghai',lat:39.9+(k%7)*0.8,lon:116.4+Math.floor(k/7)*0.9})):one;
    return Promise.resolve({ok:true,status:200,headers:{get:()=>null},
      json:()=>Promise.resolve(body),text:()=>Promise.resolve('')});
  };
  window.fetch=(u)=>fake(u); return 1})()`;

ab("open", PAGE);
ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'zh',theme:'light'}))`);
ab("reload");
ab("wait", "1500");
ab("eval", FETCH_STUB);
ab("eval", `document.querySelector('.hero .btn-primary')?.click();1`);
ab("wait", "3500");
ab("eval", FETCH_STUB);
ab("eval", `document.querySelector('#field .btn-primary')?.click();1`);
ab("wait", "2500");
ab("eval", `document.querySelector('#field').scrollIntoView({block:'start'});1`);
ab("wait", "900");
ab("screenshot", path.join(OUT, "field-after-cache.png"));
console.log("loaded, calls:", ab("eval", `window.__calls?window.__calls.length:-1`));
ab("close", "--all");
