/* 目检取证：空间变化的确定性数据桩 → 载入色面 → 截图 + 关键指标 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const cmd = path.join(path.dirname(process.execPath), "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "shot-"));
const OUT = path.join(__dirname, ".shots");
fs.mkdirSync(OUT, { recursive: true });

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

/* 空间变化桩：广州东南一片高云带（60–85%），西南一片低云遮挡（挡光），
   西侧一片晴空（低值应完全不占墨）。所有值由经纬度解析算出，可复现。 */
const STUB = `(()=>{window.__calls=[];window.__logs=[];
  const oe=console.error;console.error=function(){window.__logs.push(Array.prototype.map.call(arguments,x=>{try{return typeof x==='string'?x:(x&&x.stack)||String(x)}catch(e){return '?'}}).join(' | '));oe.apply(console,arguments)};
  const G=(la,lo,cx,cy,sx,sy)=>Math.exp(-(((lo-cx)/sx)**2+((la-cy)/sy)**2));
  const fake=(u)=>{u=String(u);window.__calls.push(u);
    const q=new URL(u,location.href).searchParams;
    const lats=(q.get('latitude')||'').split(',').filter(Boolean).map(Number);
    const lons=(q.get('longitude')||'').split(',').filter(Boolean).map(Number);
    const vars=(q.get('hourly')||'').split(',').filter(Boolean);
    const sd=q.get('start_date'); const t0=sd?Date.parse(sd+'T00:00:00Z'):Date.now()-3*86400000;
    const nH=48; const time=[];for(let i=0;i<nH;i++)time.push(new Date(t0+i*3600000).toISOString().slice(0,16));
    const mk=(la,lo)=>{
      if(!isFinite(la))la=23.1; if(!isFinite(lo))lo=113.2;
      const band=G(la,lo,114.6,22.6,2.2,1.4);        // 东南高云带
      const hole=G(la,lo,112.2,24.4,1.1,0.9);        // 西北一个低值坑
      const cHigh=Math.round(70*band*(1-0.9*hole)+6);
      const cMid=Math.round(30*band+8);
      const cLow=Math.round(55*G(la,lo,111.2,21.8,1.5,1.2)+6);
      const pp=Math.round(60*G(la,lo,110.8,21.6,1.2,1.0)+5);
      return {cHigh,cMid,cLow,pp};
    };
    const one=(la,lo)=>{const p=mk(la,lo);
      const DEF={temperature_2m:15,dew_point_2m:8,relative_humidity_2m:55,
        cloud_cover_low:p.cLow,cloud_cover_mid:p.cMid,cloud_cover_high:p.cHigh,
        visibility:22000,pressure_msl:1013,boundary_layer_height:900,
        freezing_level_height:5200,precipitation_probability:p.pp,aerosol_optical_depth:0.18};
      const hourly={time};for(const v of vars)hourly[v]=time.map(()=>(v in DEF?DEF[v]:null));
      return {hourly,utc_offset_seconds:28800,timezone:'Asia/Shanghai'};};
    const body=lats.length>1?lats.map((la,i)=>one(la,lons[i])):one(lats[0],lons[0]);
    return Promise.resolve({ok:true,status:200,headers:{get:()=>null},
      json:()=>Promise.resolve(body),text:()=>Promise.resolve('')});};
  window.fetch=(u)=>fake(u);return 1})()`;

(async () => {
  ab("close", "--all");
  ab("open", PAGE, "--width", "1300", "--height", "1250");
  await sleep(1000);
  ev(`localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'zh',theme:'light'}));1`);
  ev(`Object.keys(localStorage).filter(k=>k.startsWith('glowcast.v2.map.')).forEach(k=>localStorage.removeItem(k));1`);
  ab("reload");
  await sleep(1200);
  ev(STUB);
  await sleep(600);
  ev(`document.querySelector('#field .btn-primary').click();1`);
  for (let i = 0; i < 25; i++) {
    await sleep(600);
    const n = ev(`(window.__gcPts?window.__gcPts().pts.length:0)`);
    if (typeof n === "number" && n > 0) break;
  }
  await sleep(1500);
  console.log("cv", ev(`JSON.stringify(window.__gcCV())`));
  console.log("spikes", ev(`JSON.stringify(window.__gcPts().spikes.slice(0,5))`));
  /* 采样点正上 vs 40 km 外：场必须过点且不出现平台 */
  console.log("probe", ev(`JSON.stringify((()=>{const p=window.__gcPts().pts;const a=p[60];const f=(d)=>+window.__gcTrend(a.lat+d*0.0090,a.lon).toFixed(1);return {v0:+a.v.toFixed(1),d0:f(0),d10:f(10),d40:f(40),d80:f(80)}})())`));
  /* 想看的三个位置：低值区应不着色 */
  console.log("lowzone", ev(`JSON.stringify(window.__gcCV(24.4,112.2))`));
  ev(`document.body.style.zoom='0.62'; window.scrollTo(0, document.querySelector('#field').offsetTop*0.62 - 8);1`);
  await sleep(900);
  ab("screenshot", path.join(OUT, "v2-field2-light.png"));
  ab("eval", `document.documentElement.dataset.theme='dark'; document.body.style.zoom='0.62'; window.scrollTo(0, document.querySelector('#field').offsetTop*0.62 - 8);1`);
  await sleep(1100);
  ab("screenshot", path.join(OUT, "v2-field2-dark.png"));
  /* 采样点层目检：这张图和上面那张的唯一差别就是那 121 个空心环 ——
     用来确认「色面的每一块到底压着几个真实采样点」。 */
  ev(`document.documentElement.dataset.theme='light';1`);
  const ptsOn = ev(`(()=>{const ls=[...document.querySelectorAll('#field label')];
    const l=ls.find((x)=>/采样点/.test(x.textContent)); if(!l) return 'no-label';
    const i=l.querySelector('input[type=checkbox]'); if(!i) return 'no-input';
    if(!i.checked) i.click(); return i.checked;})()`);
  console.log("showPts", JSON.stringify(ptsOn));
  await sleep(900);
  ev(`document.body.style.zoom='0.62'; window.scrollTo(0, document.querySelector('#field').offsetTop*0.62 - 8);1`);
  await sleep(700);
  ab("screenshot", path.join(OUT, "v2-field2-pts.png"));
  ev(`(()=>{const ls=[...document.querySelectorAll('#field label')];
    const l=ls.find((x)=>/采样点/.test(x.textContent)); const i=l&&l.querySelector('input');
    if(i&&i.checked) i.click(); return 1;})()`); /* 复位，别把镜头留给下一个人 */
  ab("close", "--all");
})();
