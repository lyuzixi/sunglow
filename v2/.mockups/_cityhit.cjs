/* 验证「点城市名 = 取该城市真实数据」链路
   1) 搜香港 → 点广州市锚点 → 城市卡（无数字、有取数按钮、零请求）
   2) 点「取该城市数据」→ 计数=真实请求数 → 卡片出数字 + 加入对比
   3) 再点广州 → 命中 6h 缓存，零请求直接出数字
   4) 点香港（当前城市）→ 仍是格点卡，零请求 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const cmd = path.join(
  path.dirname(process.execPath), "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe"
);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cityhit-"));
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
const CN = (s) => s.replace(/\\"/g, '"').replace(/\n/g, " ");

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

/* 在 map-box 局部坐标 (x,y) 上派发一次真实点击序列（落在 elementFromPoint 顶层元素） */
const clickAt = (x, y) => ev(`(()=>{const b=document.querySelector('.map-box');
  const r=b.getBoundingClientRect();
  const el=document.elementFromPoint(r.left+${x}, r.top+${y})||b;
  const opt={bubbles:true,cancelable:true,clientX:r.left+${x},clientY:r.top+${y}};
  el.dispatchEvent(new MouseEvent('mousemove',opt));
  el.dispatchEvent(new MouseEvent('mousedown',opt));
  el.dispatchEvent(new MouseEvent('mouseup',opt));
  el.dispatchEvent(new MouseEvent('click',opt));
  return el.className||el.tagName})()`);

const cardTxt = () => CN(ev(`(()=>{const c=document.querySelector('.pincard');
  return c?c.innerText.replace(/\\n+/g,' | '):''})()`));
const calls = () => ev(`(()=>{const c=window.__calls.slice();window.__calls=[];return c.length})()`);
const callsInfo = () => CN(ev(`(()=>{const c=window.__calls.slice();window.__calls=[];
  return JSON.stringify(c.map(u=>{const q=new URL(u,location.href).searchParams;
    return (String(u).split('?')[0].split('/').pop()||'')+' 点数='+(q.get('latitude')||'').split(',').length}))})()`));

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
  await wait(800);
  ev(`document.querySelector('#field .btn-primary')?.click()`);
  await wait(6000);
  calls(); /* 丢掉地图加载这一批 */
  /* 让地图本身贴住视口顶部，卡片才完整可见（截图目检用） */
  ev(`(()=>{const b=document.querySelector('.map-box').getBoundingClientRect();
    window.scrollTo({top:window.scrollY+b.top-8,behavior:'instant'});return 1})()`);
  await wait(700);

  const gz = JSON.parse(CN(ev(`(()=>{const p=window.__gcProj(23.1252,113.2806);
    return JSON.stringify({x:Math.round(p.x),y:Math.round(p.y)})})()`)));
  const hk = JSON.parse(CN(ev(`(()=>{const p=window.__gcProj(22.3193,114.1694);
    return JSON.stringify({x:Math.round(p.x),y:Math.round(p.y)})})()`)));
  console.log("广州锚点:", gz, " 香港锚点:", hk);
  console.log("[1] 命中判定:", CN(ev(`(()=>{const s=window.__gcSnap(${gz.x},${gz.y});
    return JSON.stringify({city:s.city&&s.city.name,nearest:s.nearest&&s.nearest.name,
      dist:s.nearest&&s.nearest.dist,radii:s.radii})})()`)));
  /* 悬停城市名：只读小卡必须报城市本身，不能报邻市格点 */
  ev(`(()=>{const b=document.querySelector('.map-box');const r=b.getBoundingClientRect();
    const el=document.elementFromPoint(r.left+${gz.x}, r.top+${gz.y - 8})||b;
    el.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:r.left+${gz.x},clientY:r.top+${gz.y-8}}));return 1})()`);
  await wait(400);
  console.log("[1b] 悬停卡:", CN(ev(`(()=>{const t=document.querySelector('.tip');return t?t.innerText.replace(/\\n+/g,' | '):''})()`)));

  /* 点广州市（锚点上方的文字区，模拟用户点字） */
  clickAt(gz.x, gz.y - 8);
  await wait(600);
  console.log("[2] 点广州后的卡片:", cardTxt());
  console.log("    请求数:", calls());
  ab("screenshot", path.join(__dirname, ".shots", "city-card-empty.png"));

  /* 点「取该城市数据」 */
  const btn = ev(`(()=>{const b=document.querySelector('.pincard-city .tip-add');
    if(!b) return 'no-btn'; b.click(); return b.innerText.trim()})()`);
  console.log("[3] 按钮:", CN(btn));
  await wait(6000);
  console.log("    取数后卡片:", cardTxt());
  console.log("    请求明细:", callsInfo());

  /* 再点一次广州：应命中缓存，零请求 */
  clickAt(gz.x, gz.y - 8);
  await wait(700);
  console.log("[4] 再点广州（缓存）卡片:", cardTxt());
  console.log("    请求数:", calls());

  /* 点香港（当前城市）→ 格点卡（先点空白把上一张卡关掉，否则点击被卡片吞掉） */
  clickAt(40, 430);
  await wait(400);
  clickAt(hk.x, hk.y - 8);
  await wait(700);
  console.log("[5] 点香港卡片:", cardTxt());
  console.log("    请求数:", calls());
  console.log("    判定:", CN(ev(`(()=>{const s=window.__gcSnap(${hk.x},${hk.y-8});
    return JSON.stringify({city:s.city&&s.city.name,pin:s.pin,pinCity:s.pinCity})})()`)));

  /* 点空白 → 取消选择 */
  clickAt(40, 430);
  await wait(400);
  console.log("[6] 点空白后卡片:", JSON.stringify(cardTxt()));

  /* ---- 英文模式：地名是我们自绘的，命中要走 labelsInfo.geo 的精确矩形 ---- */
  ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'en',theme:'light',cityName:'香港'}))`);
  ab("reload");
  await wait(1200);
  ab("eval", STUB);
  await wait(5000);
  ab("eval", `document.querySelector('#field').scrollIntoView({behavior:'instant',block:'start'});1`);
  await wait(900);
  const gzEn = JSON.parse(CN(ev(`(()=>{const p=window.__gcProj(23.1252,113.2806);
    const L=window.__gcLabels(); const g=(L.geo||[]).find(x=>x.text==='Guangzhou');
    return JSON.stringify({x:Math.round(p.x),y:Math.round(p.y),label:g||null,span:L.span})})()`)));
  console.log("[7] en 自绘地名:", CN(JSON.stringify(gzEn)));
  if (gzEn.label) {
    const mx = Math.round((gzEn.label.x0 + gzEn.label.x1) / 2);
    clickAt(mx, gzEn.label.y);
    await wait(700);
    console.log("    en 点 Guangzhou 卡片:", cardTxt());
    console.log("    请求数:", calls());
    ab("screenshot", path.join(__dirname, ".shots", "city-card-en.png"));
  } else {
    console.log("    ⚠ 英文模式没画出 Guangzhou（跨度分级%d），跳过", gzEn.span);
  }

  ab("screenshot", path.join(__dirname, ".shots", "city-card.png"));
  ab("close", "--all");
})();
