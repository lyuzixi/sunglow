/* 用假 fetch 桩确定性复现「数据到达后 #field 消失」 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const cmd = path.join(path.dirname(process.execPath), "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dbg2-"));
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
const ev = (js) => { const s = ab("eval", js); try { return JSON.parse(s); } catch { return s; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href +
  "?name=%E5%B9%BF%E5%B7%9E%E5%B8%82&lat=23.1291&lon=113.2644&date=2026-10-22&period=pm";

const STUB = `(()=>{window.__calls=[];window.__logs=[];
  const oe=console.error;console.error=function(){window.__logs.push(Array.prototype.map.call(arguments,x=>{try{return typeof x==='string'?x:(x&&x.stack)||String(x)}catch(e){return '?'}}).join(' | '));oe.apply(console,arguments)};
  const fake=(u)=>{u=String(u);window.__calls.push(u);
    const q=new URL(u,location.href).searchParams;
    const nLoc=(q.get('latitude')||'').split(',').filter(Boolean).length||1;
    const vars=(q.get('hourly')||'').split(',').filter(Boolean);
    const sd=q.get('start_date'),fd=+q.get('forecast_days')||7;
    let t0,nH;
    if(sd){t0=Date.parse(sd+'T00:00:00Z');nH=48;}else{t0=Date.now()-3*86400000;nH=24*(fd+3);}
    const time=[];for(let i=0;i<nH;i++)time.push(new Date(t0+i*3600000).toISOString().slice(0,16));
    const DEF={temperature_2m:15,dew_point_2m:8,relative_humidity_2m:60,
      cloud_cover_low:20,cloud_cover_mid:45,cloud_cover_high:30,visibility:20000,
      pressure_msl:1013,boundary_layer_height:800,freezing_level_height:2000,
      precipitation_probability:10,aerosol_optical_depth:0.2};
    const hourly={time};for(const v of vars)hourly[v]=time.map(()=>(v in DEF?DEF[v]:null));
    const one={hourly,utc_offset_seconds:28800,timezone:'Asia/Shanghai'};
    const body=nLoc>1?Array.from({length:nLoc},()=>one):one;
    return Promise.resolve({ok:true,status:200,headers:{get:()=>null},
      json:()=>Promise.resolve(body),text:()=>Promise.resolve('')});};
  window.fetch=(u)=>fake(u);return 1})()`;

(async () => {
  ab("close", "--all");
  ab("open", PAGE, "--width", "1280", "--height", "820");
  await sleep(1000);
  ev(`localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'zh',theme:'light'}));1`);
  ev(`Object.keys(localStorage).filter(k=>k.startsWith('glowcast.v2.map.')).forEach(k=>localStorage.removeItem(k));1`);
  ab("reload");
  await sleep(1200);
  ev(STUB);
  await sleep(800);
  ev(`document.querySelector('#field .btn-primary').click();1`);
  for (let i = 0; i < 20; i++) {
    await sleep(600);
    const n = ev(`(window.__gcPts?window.__gcPts().pts.length:0)`);
    if (typeof n === "number" && n > 0) { console.log("pts", n); break; }
  }
  await sleep(1200);
  console.log("#field", ev(`!!document.querySelector('#field')`));
  console.log("cv", ev(`JSON.stringify(window.__gcCV&&window.__gcCV())`));
  console.log("logs", ev(`JSON.stringify((window.__logs||[]).slice(0,2))`));
  ab("close", "--all");
})();
