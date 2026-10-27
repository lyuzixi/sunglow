/* 一次性取证：搜「香港」后点击地图上的「广州市」，看到底吸到哪个格点。
   复现路径与用户操作一致：URL 钉香港 → 桩数据 → 点「加载地图」→ 取广州市标签
   的屏幕位置 → __gcSnap 探测吸附结果。 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const cmd = path.join(
  path.dirname(process.execPath), "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe"
);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hk-snap-"));
function ab(...args) {
  const out = path.join(TMP, "o.txt"), err = path.join(TMP, "e.txt");
  const fo = fs.openSync(out, "w"), fe = fs.openSync(err, "w");
  try {
    execFileSync(cmd, args, { stdio: ["ignore", fo, fe], timeout: 180000 });
  } catch (e) {
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
  ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'zh',theme:'light',cityName:'香港'}))`);
  ab("eval", `Object.keys(localStorage).filter(k=>k.startsWith('glowcast.v2.')&&k!=='glowcast.v2.pref').forEach(k=>localStorage.removeItem(k))`);
  ab("eval", STUB);
  ab("reload");
  await wait(1200);
  ab("eval", STUB);
  await wait(4500);
  ab("eval", `document.querySelector('#field').scrollIntoView({behavior:'instant',block:'start'});1`);
  await wait(600);
  ev(`document.querySelector('#field .btn-primary')?.click()`);
  await wait(6000);
  console.log("pts:", ev(`(()=>{const g=window.__gcSnap(0,0); return JSON.stringify({span:g.span,radii:g.radii})})()`));
  /* 广州市标签的屏幕位置（自绘层，简体模式下也计算但可能不绘制 → 用候选算） */
  const label = ev(`(()=>{const L=window.__gcLabels?window.__gcLabels():null;
    if(!L) return 'no-hook';
    const c=(L.geo||[]).filter(g=>String(g.text||'').includes('广州'));
    return JSON.stringify({span:L.span,tierMax:L.tierMax,drawn:L.drawn,cands:(L.names||[]),gz:c})})()`);
  console.log("labels:", label);
  /* map-box 局部坐标：用画布中心 + 投影关系算广州市位置不方便，直接试一组偏移，看名字分布 */
  const box = ev(`(()=>{const b=document.querySelector('.map-box');const r=b.getBoundingClientRect();
    return JSON.stringify({w:Math.round(r.width),h:Math.round(r.height)})})()`);
  console.log("box:", box);
  /* 广州相对香港：北 ~90km、西 ~94km → 像素偏移（用 span/画布高换算，粗略即可定位） */
  const probe = ev(`(()=>{const J=JSON.stringify;
    const b=document.querySelector('.map-box').getBoundingClientRect();
    const g0=window.__gcSnap(0,0); const pxKm=b.height/g0.span;
    const cx=b.width/2, cy=b.height/2;
    const gx=cx-94*pxKm, gy=cy-90*pxKm;   /* 广州市在屏幕上的估算位置 */
    const out=[];
    for(const dy of [-30,-15,0,15,30]) for(const dx of [-30,-15,0,15,30]){
      const s=window.__gcSnap(gx+dx, gy+dy);
      out.push([dx,dy,s.nearest?s.nearest.name:'-',s.nearest?s.nearest.dist:-1]);
    }
    const here=window.__gcSnap(gx,gy);
    return J({box:[Math.round(b.width),Math.round(b.height)],span:g0.span,
      radii:g0.radii,pxPerKm:+pxKm.toFixed(3),
      gz:[Math.round(gx),Math.round(gy)],
      nearestHere:here.nearest, aroundHere:here.around, out})})()`);
  console.log("grid probe:", probe);
  ab("screenshot", path.join(__dirname, ".shots", "hk-snap.png"));
  ab("close", "--all");
})();
