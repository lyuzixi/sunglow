/* 目检：暗色主题下的城市卡与悬停小卡（简体底图地名） */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const cmd = path.join(
  path.dirname(process.execPath), "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe"
);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dark-"));
function ab(...args) {
  const out = path.join(TMP, "o.txt"), err = path.join(TMP, "e.txt");
  const fo = fs.openSync(out, "w"), fe = fs.openSync(err, "w");
  try { execFileSync(cmd, args, { stdio: ["ignore", fo, fe], timeout: 240000 }); }
  catch (e) {
    const m = fs.existsSync(err) ? fs.readFileSync(err, "utf8").trim() : "";
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error(m || String(e && e.message));
  } finally { fs.closeSync(fo); fs.closeSync(fe); }
  return fs.readFileSync(out, "utf8").trim();
}
const ev = (js) => ab("eval", js).replace(/^"|"$/g, "");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href;
const STUB = `(()=>{window.__calls=[];const fake=(u)=>{window.__calls.push(String(u));
  const q=new URL(u,location.href).searchParams;
  const nLoc=(q.get('latitude')||'').split(',').filter(Boolean).length||1;
  const vars=(q.get('hourly')||'').split(',').filter(Boolean);
  const sd=q.get('start_date'),ed=q.get('end_date'),fd=+q.get('forecast_days')||7;
  let t0,nH;
  if(sd){t0=Date.parse(sd+'T00:00:00Z');const t1=ed?Date.parse(ed+'T00:00:00Z'):t0;nH=Math.round((t1-t0)/3600000)+24;}
  else{t0=Date.now()-3*86400000;nH=24*(fd+3);}
  const time=[];for(let i=0;i<nH;i++)time.push(new Date(t0+i*3600000).toISOString().slice(0,16));
  const DEF={temperature_2m:15,dew_point_2m:8,relative_humidity_2m:60,cloud_cover_low:20,
    cloud_cover_mid:45,cloud_cover_high:30,visibility:20000,pressure_msl:1013,
    boundary_layer_height:800,freezing_level_height:2000,aerosol_optical_depth:0.2};
  const hourly={time};for(const v of vars)hourly[v]=time.map(()=>(v in DEF?DEF[v]:null));
  const one={hourly,utc_offset_seconds:28800,timezone:'Asia/Shanghai'};
  const body=nLoc>1?Array.from({length:nLoc},()=>one):one;
  return Promise.resolve({ok:true,status:200,headers:{get:()=>null},
    json:()=>Promise.resolve(body),text:()=>Promise.resolve('')});};
  window.fetch=(u)=>fake(u);return 1})()`;

(async () => {
  ab("open", PAGE + "?name=" + encodeURIComponent("香港") + "&lat=22.3193&lon=114.1694&date=2026-10-22&period=pm");
  ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'zh',theme:'dark',cityName:'香港'}))`);
  ab("eval", `Object.keys(localStorage).filter(k=>k.startsWith('glowcast.v2.')&&k!=='glowcast.v2.pref').forEach(k=>localStorage.removeItem(k))`);
  ab("eval", STUB);
  ab("reload");
  await wait(1400);
  ab("eval", STUB);
  await wait(4600);
  ab("eval", `document.querySelector('#field .btn-primary')?.click();1`);
  await wait(6000);
  ab("eval", `(()=>{const b=document.querySelector('.map-box').getBoundingClientRect();
    window.scrollTo({top:window.scrollY+b.top-8,behavior:'instant'});return 1})()`);
  await wait(700);
  const G = JSON.parse(ev(`JSON.stringify((()=>{const p=window.__gcProj(23.1252,113.2806);
    return {x:Math.round(p.x),y:Math.round(p.y)}})())`).replace(/\\"/g, '"'));
  /* 悬停 */
  ev(`(()=>{const b=document.querySelector('.map-box');const r=b.getBoundingClientRect();
    const el=document.elementFromPoint(r.left+${G.x},r.top+${G.y-8})||b;
    el.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:r.left+${G.x},clientY:r.top+${G.y-8}}));return 1})()`);
  await wait(500);
  ab("screenshot", path.join(__dirname, ".shots", "city-hover-dark.png"));
  /* 点击 → 城市卡 */
  ev(`(()=>{const b=document.querySelector('.map-box');const r=b.getBoundingClientRect();
    const el=document.elementFromPoint(r.left+${G.x},r.top+${G.y-8})||b;
    const o={bubbles:true,cancelable:true,clientX:r.left+${G.x},clientY:r.top+${G.y-8},view:window};
    el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new MouseEvent('mouseup',o));
    el.dispatchEvent(new MouseEvent('click',o));return 1})()`);
  await wait(600);
  ab("screenshot", path.join(__dirname, ".shots", "city-card-dark.png"));
  console.log("ok");
  ab("close", "--all");
})();
