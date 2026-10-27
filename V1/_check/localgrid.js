/* B13 局部化采样回归：地图从「固定 152 个全国城市」改为「以查询点为心的局部网格」。
   本探针只验证**点集与视口**这部分，不涉及取数内容 ——
   所以断言全是几何量（点数、覆盖半径、间距、坐标随地点变化），不依赖真实网络。
   气象接口用 Fetch.requestPaused 回填合成数据，保证页面能正常初始化且不消耗额度。

   用法: node _check/localgrid.js
*/
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SERVE = path.join(ROOT, "_check");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 47877;
const DEBUG_PORT = 9337;

function serve() {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".png": "image/png" };
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split("?")[0]);
    const f = path.join(SERVE, u === "/" ? "/preview.html" : u);
    fs.readFile(f, (e, b) => {
      if (e) { res.writeHead(404); res.end("no"); return; }
      res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" });
      res.end(b);
    });
  });
  return new Promise(r => srv.listen(PORT, "127.0.0.1", () => r(srv)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pend = new Map(); this.handlers = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws error")); });
    const c = new CDP(ws);
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pend.has(m.id)) {
        const { res, rej } = c.pend.get(m.id); c.pend.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) c.handlers.forEach(h => h(m));
    };
    return c;
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pend.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.pend.has(id)) { this.pend.delete(id); rej(new Error("timeout " + method)); } }, 60000);
    });
  }
  on(f) { this.handlers.push(f); }
}

(async function main() {
  const srv = await serve();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "lg-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + DEBUG_PORT, "--user-data-dir=" + udd,
    "--window-size=1280,900", "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let cerr = "";
  chrome.stderr.on("data", d => { cerr += d.toString(); });

  let ver = null;
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    try { ver = await (await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/version")).json(); break; } catch (e) { }
  }
  if (!ver) { console.log("CHROME_START_FAIL\n" + cerr.slice(0, 2000)); process.exit(1); }
  const list = await (await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/list")).json();
  const page = list.find(t => t.type === "page") || list[0];
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);

  const errs = [], logs = [];
  let bulkReq = 0;      // 坐标数 ≥ 50 的气象请求数（地图取数；见拦截器里的说明）
  cdp.on(m => {
    if (m.method === "Runtime.consoleAPICalled") {
      const t = (m.params.args || []).map(a => a.value === undefined ? a.description : a.value).join(" ");
      if (m.params.type === "error") errs.push(t); else logs.push(m.params.type + ": " + t);
    } else if (m.method === "Runtime.exceptionThrown") {
      errs.push((m.params.exceptionDetails || {}).text || "exception");
    }
  });

  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  /* 拦截气象接口，回填合成数据 —— 只为让页面完成初始化，本探针不校验取数内容 */
  await cdp.send("Fetch.enable", { patterns: [
    { urlPattern: "*://api.open-meteo.com/*" },
    { urlPattern: "*://air-quality-api.open-meteo.com/*" }
  ] });
  cdp.on(async m => {
    if (m.method !== "Fetch.requestPaused") return;
    const { requestId, request } = m.params;
    try {
      const u = new URL(request.url);
      const lats = (u.searchParams.get("latitude") || "").split(",").map(Number);
      const lons = (u.searchParams.get("longitude") || "").split(",").map(Number);
      /* 地图级批量请求计数（B14 自动加载的判据）：地图取数一次 57 个坐标，
         单点 1 个、趋势 34 个 —— 取 ≥50 作分界，是"这一批是不是地图取数"的
         唯一可靠特征（不能按 URL 里有没有 dew_point_2m 判，趋势也带它）。 */
      if (lats.length >= 50) bulkReq++;
      const vars = (u.searchParams.get("hourly") || "").split(",").filter(Boolean);
      const sd = u.searchParams.get("start_date") || "2026-10-09";
      const ed = u.searchParams.get("end_date") || sd;
      const times = [];
      const t0 = Date.parse(sd + "T00:00:00Z"), t1 = Date.parse(ed + "T00:00:00Z");
      const nDay = Math.max(1, Math.round((t1 - t0) / 86400000) + 1);
      for (let k = 0; k < nDay * 24; k++) {
        const d = new Date(t0 + k * 3600000);
        times.push(d.toISOString().slice(0, 10) + "T" + String(d.getUTCHours()).padStart(2, "0") + ":00");
      }
      const body = lats.map((la, i) => {
        const lo = lons[i] == null ? 0 : lons[i];
        const hourly = { time: times };
        vars.forEach(v => { hourly[v] = times.map(() => 30 + 20 * Math.sin(la / 6) * Math.sin(lo / 7)); });
        return { latitude: la, longitude: lo, utc_offset_seconds: 28800, timezone: "Asia/Shanghai", hourly };
      });
      await cdp.send("Fetch.fulfillRequest", {
        requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" },
          { name: "Access-Control-Allow-Origin", value: "*" }],
        body: Buffer.from(JSON.stringify(body), "utf8").toString("base64")
      });
    } catch (e) { await cdp.send("Fetch.continueRequest", { requestId }).catch(() => { }); }
  });

  await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/preview.html" });

  /* 等首屏单点结果就绪（局部化改造后首屏不再取地图数据，所以不等地图） */
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(1200);
    const r = await cdp.send("Runtime.evaluate", {
      expression: `(function(){ try{ return (typeof mapPts==="function") && (document.querySelector("#hero")||{}).innerText && document.querySelector("#hero").innerText.length>50; }catch(e){ return false; } })()`,
      returnByValue: true
    });
    if (r.result.value) { ready = true; break; }
  }
  if (!ready) { console.log("WARN 首屏未在 72 秒内就绪，仍继续跑几何断言"); }

  /* ---------- 首屏地图加载行为（B14：已有缓存自动加载）----------
     两次加载对照，看的是**同一件事的两面**：
       ① 全新用户（localStorage 空）首屏 → 只有"待加载引导"、一个地图批量请求都没有
          （这是硬约束 9 的守卫：地图数据不许随页面打开自动取）；
       ② 先让它取一次地图（制造真缓存）→ 重新加载 → 地图应**自动画出来**，
          且**依然零批量请求**（复用缓存，零额度）。
     判据都取端到端（页面真实状态 + Node 侧请求计数），不读任何内部标志。 */
  const probeMap = async () => (await cdp.send("Runtime.evaluate", {
    expression: `(function(){
      let n=0; try{ n = (MapMod.data && Object.keys(MapMod.data).length) || 0; }catch(e){}
      const el=document.getElementById('mapLoad');
      return { dataKeys:n, idleShown: !!el && getComputedStyle(el).display !== 'none',
               strips:((MapMod.strips||[]).length), hasField: !!MapMod.field,
               ok: !!MapMod.ok };
    })()`, returnByValue: true
  })).result.value;
  const waitField = async (limit) => {
    for (let i = 0; i < limit; i++) {
      await sleep(600);
      const p = await probeMap();
      if (p.hasField && p.strips > 0) return p;
    }
    return await probeMap();
  };

  const fresh = await probeMap();
  const freshBulk = bulkReq;
  console.log("\n--- 首屏 · 无缓存（全新用户）---");
  console.log("  data 键数 " + fresh.dataKeys + " · 待加载引导=" + fresh.idleShown
    + " · hasField=" + fresh.hasField + " · 地图批量请求 " + freshBulk + " 次");

  /* 制造真缓存：走一次完整地图取数（合成数据），等色面画出来、缓存落盘。
     mapCachePut 用 requestIdleCallback(timeout 250) 落盘，等 1.2 s 足够。 */
  await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{ await loadMapData(true); })()`, awaitPromise: true
  });
  const drawn = await waitField(40);
  await sleep(1200);
  const afterFetchBulk = bulkReq;
  console.log("  取数后：hasField=" + drawn.hasField + " · 条带 " + drawn.strips
    + " · 地图批量请求 " + afterFetchBulk + " 次（这次是显式点击触发的，应 +1 以上）");

  /* 重新加载：URL 不带位置参数（此时还没 setLocation 过），仍回到默认城市 */
  await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/preview.html" });
  for (let i = 0; i < 60; i++) {
    await sleep(1200);
    const p = await probeMap();
    if (p.ok) break;
  }
  const warm = await waitField(20);
  const warmBulk = bulkReq - afterFetchBulk;
  console.log("\n--- 首屏 · 有缓存（重新加载）---");
  console.log("  data 键数 " + warm.dataKeys + " · 待加载引导=" + warm.idleShown
    + " · hasField=" + warm.hasField + " · 条带 " + warm.strips
    + " · 本次加载地图批量请求 " + warmBulk + " 次（应 0）");

  const res = await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const out={};
      const R=MAP_RADIUS_KM, G=MAP_GRID_KM;
      out.cfg={ prefix:MAP_CACHE_PREFIX, radius:R, grid:G, followZoom:MAP_FOLLOW_ZOOM, keep:MAP_KEEP_KM,
                cacheMax:MAP_CACHE_MAX, dataMax:MAP_DATA_MAX,
                fieldReach:FIELD_REACH_KM, fieldOut:FIELD_OUT_KM, fieldFull:FIELD_FULL,
                fieldStep:FIELD_STEP, fieldBlur:FIELD_BLUR, nBands:N_BANDS,
                idwMax:MAP_IDW_MAX, tipRange:TIP_RANGE_KM, cityNear:CITY_NEAR_KM };
      /* ---- ① 点集几何（以**默认城市**为查询点；下面第 ③ 段才显式切到上海）---- */
      const pts=mapPts();
      out.qName0=State.name;
      out.n=pts.length;
      out.shape=Object.keys(pts[0]||{}).sort().join(",");
      const ds=pts.map(p=>haversineKm(State.lat,State.lon,p.lat,p.lon));
      out.dMin=Math.min.apply(null,ds);
      out.dMax=Math.max.apply(null,ds);
      /* 最近邻间距：取中心点(距 0 最近的那个)到其它点的最小距离 */
      const ci=ds.indexOf(out.dMin);
      let nn=1e9;
      pts.forEach((p,i)=>{ if(i===ci) return; const d=haversineKm(pts[ci].lat,pts[ci].lon,p.lat,p.lon); if(d<nn) nn=d; });
      out.nn=nn;
      out.names=pts.slice(0,4).map(p=>p.name);
      out.allNamed=pts.every(p=>!!p.name && !!p.region);
      out.allInside=ds.every(d=>d<=R+1e-6);
      out.key=mapKeyOf("2026-10-09");
      out.ptsKey0=MapMod.ptsKey;

      /* ---- ⑧ 采样点命名：借名必须把距离说清楚 ----
         网格间距 120 km、半径 500 km，而被借名的城市常在几百公里外。旧实现一律写
         "XX 市附近"（实测宁德 541 / 临沂 561 / 济宁 499 / 濮阳 476 km），既是误导，
         又会让多个网格点共用同一个名字（实测吉林省清单里"白山市附近"出现 4 次），
         排行榜与数值直标就会出现多行同名不同值。 */
      let dupN = 0, seenN = {}, farN = 0, nearN = 0, cityN = 0, badFar = [], badNear = [];
      pts.forEach(function(p){
        const n = nearestCity(p.lat, p.lon, ALL_CITIES);
        const km = n ? n.distKm : null;
        if (seenN[p.name]) dupN++; seenN[p.name] = (seenN[p.name] || 0) + 1;
        if (km === null) return;
        if (km < 15) { cityN++; if (/ km$/.test(p.name)) badNear.push(p.name); }
        else if (km < CITY_NEAR_KM) { nearN++; if (/ km$/.test(p.name)) badNear.push(p.name); }
        else { farN++; if (!/ km$/.test(p.name)) badFar.push(p.name + "/" + Math.round(km)); }
      });
      out.nameStat = { dup: dupN, far: farN, near: nearN, city: cityN, badFar: badFar, badNear: badNear,
                       dupNames: pts.filter(function(p){ return seenN[p.name] > 1; })
                                    .map(function(p){ return p.name + "@" + p.lat.toFixed(2) + "," + p.lon.toFixed(2); }),
                       farEx: pts.filter(function(p){ return / km$/.test(p.name); }).slice(0,4)
                                 .map(function(p){ return p.name; }) };
      /* 八个方位用**构造用例**核对，而不是碰运气抽网格点：
         造 8 个已知方向的位移，检查名字里出现的方位与预期一致。 */
      const FC = { name: "测试市", lat: 30, lon: 120, region: "X" };
      const mkCase = function(dLa, dLo){ return gridName(30 + dLa, 120 + dLo,
        { city: FC, distKm: haversineKm(30, 120, 30 + dLa, 120 + dLo) }); };
      out.dirCases = [["北",mkCase(1,0)],["东北",mkCase(1,1)],["东",mkCase(0,1)],["东南",mkCase(-1,1)],
                      ["南",mkCase(-1,0)],["西南",mkCase(-1,-1)],["西",mkCase(0,-1)],["西北",mkCase(1,-1)]];
      out.dirOk = out.dirCases.every(function(c){ return c[1].indexOf(c[0]) >= 0 && / km$/.test(c[1]); });
      /* 近处不该出现距离后缀：落在城里直接报城市名，一个城区的尺度才叫"附近" */
      out.nearCase = [gridName(30, 120, { city: FC, distKm: 0 }),
                      gridName(30.3, 120, { city: FC, distKm: 33 })];
      out.nearOk = out.nearCase[0] === "测试市" && out.nearCase[1] === "测试市附近";

      /* ---- ② 换地点：点集重建、缓存作废、键随之改变 ---- */
      const keyBefore=mapKeyOf("2026-10-09");
      /* 先塞一条假数据，验证换地点确实把它清掉 */
      MapMod.data["2026-10-09"]={pm:{pts:[]},am:{pts:[]}}; MapMod.dataOrder.push("2026-10-09");
      setLocation(39.9042,116.4074,"北京市","北京市");
      await sleep(600);
      out.afterMove={ ptsKeyChanged: MapMod.ptsKey!==out.ptsKey0,
                      dataKeys: Object.keys(MapMod.data).length,
                      orderLen: MapMod.dataOrder.length,
                      keyChanged: mapKeyOf("2026-10-09")!==keyBefore,
                      strips: (MapMod.strips||[]).length };
      const bj=mapPts();
      out.nBJ=bj.length;
      out.bjNames=bj.slice(0,3).map(p=>p.name);
      out.bjMax=Math.max.apply(null,bj.map(p=>haversineKm(39.9042,116.4074,p.lat,p.lon)));

      /* ---- ⑥ 小幅移动沿用旧网格（MAP_KEEP_KM）----
         查询点挪动不超过一个采样间距时，值场用的还是同一批 120 km 间隔样本，
         "以新点为中心"与"以旧点为中心"在统计上难以区分；而重取一次要花
         3 × 点数 ≈ 171 个加权调用。所以这种情况必须**沿用**，只挪视口。
         反过来，一旦超过这个距离就必须整批作废 —— 否则留下的是一张套错地方的
         热力图（看起来完全正常、不报错，属于最难发现的那类错误）。
         两个方向都要钉住，只钉一个等于放任另一个出错。 */
      mapPts();                                  /* 确保 gridC 就位 */
      const g0 = { lat: MapMod.gridC.lat, lon: MapMod.gridC.lon };
      const g0key = MapMod.ptsKey;
      const fakeBox = () => ({ pm: { pts: [] }, am: { pts: [] } });
      MapMod.data = { "2026-10-09": fakeBox() };
      MapMod.dataOrder = ["2026-10-09"];
      MapMod.curDate = "2026-10-09";
      /* (a) 挪 0.5 × MAP_KEEP_KM ≈ 60 km → 必须沿用 */
      const keepLa = g0.lat + (MAP_KEEP_KM * 0.5) / 110.574;
      setLocation(keepLa, g0.lon, "近处", "");
      await sleep(300);
      out.keep = {
        dataKeys: Object.keys(MapMod.data).length,
        ptsKeySame: MapMod.ptsKey === g0key,
        gridCSame: Math.abs(MapMod.gridC.lat - g0.lat) < 1e-9 && Math.abs(MapMod.gridC.lon - g0.lon) < 1e-9,
        followed: (function(){ try{ const c = MapMod.map.getCenter();
          return Math.abs((isNum(c.lat) ? c.lat : c.getLat()) - keepLa) < 0.02; }catch(e){ return false; } })(),
        idleHidden: (function(){ const e = document.getElementById('mapLoad');
          return !e || getComputedStyle(e).display === 'none'; })()
      };
      /* (b) 挪 1.5 × MAP_KEEP_KM = 180 km → 必须整批作废 */
      MapMod.data = { "2026-10-09": fakeBox() };
      MapMod.dataOrder = ["2026-10-09"];
      MapMod.curDate = "2026-10-09";
      setLocation(g0.lat + (MAP_KEEP_KM * 1.5) / 110.574, g0.lon, "远处", "");
      await sleep(300);
      out.drop = { dataKeys: Object.keys(MapMod.data).length, orderLen: MapMod.dataOrder.length };

      /* ---- ③ 高纬度的经度收缩：同样的"公里"，经度跨度必须更大 ---- */
      setLocation(52.3353,124.7115,"大兴安岭地区","黑龙江省");
      await sleep(400);
      const hi=mapPts();
      out.nHI=hi.length;
      const lo0=Math.min.apply(null,hi.map(p=>p.lon)), lo1=Math.max.apply(null,hi.map(p=>p.lon));
      setLocation(31.2304,121.4737,"上海市","上海市");
      await sleep(400);
      const low=mapPts();
      const lb0=Math.min.apply(null,low.map(p=>p.lon)), lb1=Math.max.apply(null,low.map(p=>p.lon));
      out.lonSpanHigh=lo1-lo0; out.lonSpanLow=lb1-lb0;

      /* ---- ⑤ 境外查询：不得套用中国省界掩膜 ----
         D4 的掩膜假设"采样点全在境内、境外必是外推"，局部化后不成立：
         网格是规则布点，境外点同样是真实样本。若查询东京仍套中国省界掩膜，
         整张图会被裁成空白。这里验证判据会随查询点正确翻转。 */
      setLocation(35.6895,139.6917,"东京","日本");
      await sleep(400);
      out.cnOnTokyo=(function(){ try{ return cnMaskOn(); }catch(e){ return "err:"+e; } })();
      out.provOfTokyo=(function(){ try{ return provOf(35.6895,139.6917)||null; }catch(e){ return null; } })();
      out.nTokyo=mapPts().length;
      setLocation(31.2304,121.4737,"上海市","上海市");
      await sleep(400);
      out.cnOnSH=(function(){ try{ return cnMaskOn(); }catch(e){ return "err:"+e; } })();
      out.provOfSH=(function(){ try{ return provOf(31.2304,121.4737)||null; }catch(e){ return null; } })();

      /* ---- ⑦ 跨地点的缓存总闸门（mapCacheSweep）----
         B13 之后 localStorage 的键多了一维坐标，条目随"去过的地点 × 日期"增长；
         而 LRU（mapDataTouch）只在**当前地点内**按日期淘汰 —— 它用 mapKeyOf(old)
         拼的是当前坐标，旧地点的键它永远命中不到。没有这道闸门就会一路涨到
         5 MB 配额耗尽，之后写缓存静默失败。 */
      const cnt=(mineOnly)=>{ const own="@"+State.lat.toFixed(1)+","+State.lon.toFixed(1);
        let n=0,m=0; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i);
          if(k&&k.indexOf(MAP_CACHE_PREFIX)===0){ n++; if(k.slice(-own.length)===own) m++; } }
        return mineOnly?m:n; };
      localStorage.clear();
      const seeds=[["2016-01-01",31.2,121.5],["2016-01-02",31.2,121.5],
                   ["2016-02-01",39.9,116.4],["2016-02-02",39.9,116.4],
                   ["2016-03-01",23.1,113.3],["2016-03-02",23.1,113.3],
                   ["2016-04-01",45.8,126.6],["2016-04-02",45.8,126.6]];
      seeds.forEach(function(k,i){ localStorage.setItem(
        MAP_CACHE_PREFIX+k[0]+"@"+k[1].toFixed(1)+","+k[2].toFixed(1),
        JSON.stringify({ ts:1000+i, obj:{ am:null, pm:null } })); });
      out.sweepBefore=cnt(false);
      mapCacheSweep();
      out.sweepAfter={ total:cnt(false), mine:cnt(true) };
      /* 幂等：再收一次不该有任何变化 */
      mapCacheSweep();
      out.sweepAgain=cnt(false);
      localStorage.clear();

      /* ---- ④ 视口跟随 ---- */
      await sleep(500);
      try{ const c=MapMod.map.getCenter(); out.center={ lat:isNum(c.lat)?c.lat:c.getLat(), lng:isNum(c.lng)?c.lng:c.getLng() };
           out.zoom=MapMod.map.getZoom(); }catch(e){ out.center=null; }
      out.stateLat=State.lat; out.stateLon=State.lon;
      return out;
    })()`, returnByValue: true, awaitPromise: true
  });
  const O = res.result.value || {};

  const checks = [];
  const ok = (name, pass, extra) => {
    checks.push(pass);
    console.log((pass ? "PASS" : "FAIL"), name + (extra === undefined ? "" : "  " + extra));
  };
  console.log("\n===== B13 地图局部化（以查询点为心）=====");
  console.log("  配置: " + JSON.stringify(O.cfg));
  /* 不断言具体的 vN —— 那个数字每次"值场几何/数值变了"都得再加一，
     写死在探针里只会每隔一批就误报一次。断言的是两件真正重要的事：
     ① 前缀形状合法；② **不低于 v5**（v5 = A1「地图样带与单点同构」那道门槛，
     它改变了值场数值，必须作废旧缓存）。以后升到 v6/v7 这条会自动过。 */
  const pv = /^sunsetbot\.map\.v(\d+)\.$/.exec(O.cfg.prefix || "");
  ok("缓存前缀形状合法且 ≥ v5（A1 样带同构的门槛）",
    !!pv && Number(pv[1]) >= 5, O.cfg.prefix);
  ok("覆盖半径 500 km", O.cfg.radius === 500, String(O.cfg.radius));
  ok("网格间距 120 km", O.cfg.grid === 120, String(O.cfg.grid));
  /* 沿用阈值必须锚在采样间距上，而不是随手一个魔数：间距就是这套数据的分辨率，
     偏移不超过它时"以新点为中心的场"与"以旧点为中心的场"在统计上难以区分。 */
  const KEEP = O.cfg.keep;
  const MAXC = O.cfg.cacheMax;
  ok("沿用阈值 = 一个采样间距（不是随手取的魔数）", KEEP === O.cfg.grid,
    "keep=" + KEEP + " grid=" + O.cfg.grid);
  ok("跨地点缓存上限 = 2 个地点 × 每日上限（可容一次「返回上一地点」）",
    MAXC === O.cfg.dataMax * 2, "cacheMax=" + MAXC + " dataMax=" + O.cfg.dataMax);
  /* 「多远之外不再可信」此前被写成三份数字：遮罩半径 240、idwSample 的 700、
     悬停的 260 —— 于是有 20 km 宽的一圈"图上已透明、悬停却仍有值"。
     第 8 批之后**色面边界**换成了采样点凸包 + FIELD_OUT_KM 羽化，那是另一个量：
     凸包讲"哪块是插值、哪块是外推"，而这三个数讲"离采样点多远还允许取值"。
     同源的那三处因此是 IDW / 悬停 / **候选搜索半径 FIELD_REACH_KM**。 */
  ok("「多远算可信」三处口径同源（IDW / 悬停 / 候选搜索半径）",
    O.cfg.idwMax === O.cfg.fieldReach && O.cfg.tipRange === O.cfg.fieldReach,
    "IDW " + O.cfg.idwMax + " / 悬停 " + O.cfg.tipRange + " / 搜索 " + O.cfg.fieldReach);
  /* 边界那两个量必须小得合理：羽化长度要能盖过凸包折线的棱角（否则看得出十二边形），
     又不能大到把"外推"画得像"插值"；搜索半径要能覆盖"包外最远一格到最近采样点"的距离。 */
  ok("凸包羽化长度合理（>0 且不超过搜索半径）",
    O.cfg.fieldOut > 0 && O.cfg.fieldOut <= O.cfg.fieldReach,
    "fieldOut=" + O.cfg.fieldOut + " fieldReach=" + O.cfg.fieldReach);
  ok("可信度阈值大于羽化长度（阈值讲「外推」，羽化讲「边界」，是两个量）",
    O.cfg.fieldFull > O.cfg.fieldOut, "fieldFull=" + O.cfg.fieldFull + " fieldOut=" + O.cfg.fieldOut);
  console.log("  --- 点集几何（默认城市 " + (O.qName0 || "?") + "）---");
  console.log("  点数 " + O.n + " · 距心 " + (O.dMin && O.dMin.toFixed(1)) + " – "
    + (O.dMax && O.dMax.toFixed(1)) + " km · 最近邻间距 " + (O.nn && O.nn.toFixed(1))
    + " km · " + JSON.stringify(O.names));
  ok("点数与独立推算一致（57）", O.n === 57, "实测 " + O.n);
  ok("点项形状与城市项一致（name,lat,lon,region）",
    O.shape === "lat,lon,name,region", O.shape);
  ok("每个点都有名称与地区（下游无需改）", O.allNamed === true);
  ok("含中心点（距心为 0）", O.dMin < 1e-6, "dMin=" + O.dMin);
  ok("最远点不超出覆盖半径", O.allInside === true && O.dMax <= 500, "dMax=" + (O.dMax && O.dMax.toFixed(2)));
  ok("最外圈确实铺到 ~495 km（不是只铺了几圈）", O.dMax > 480, "dMax=" + (O.dMax && O.dMax.toFixed(2)));
  /* 容差 2 km：网格用「每度 110.574 / 111.32 km」换算，而 haversineKm 走球面模型
     （每度 111.19 km），两套常数有约 0.6% 的系统差 ——
     于是经度向邻居落在 119.87、纬度向邻居落在 120.66，最近邻自然略小于 120。
     这是换算模型的正常差异，不是采样偏了。 */
  ok("最近邻间距 ≈ 网格间距（±2 km）", Math.abs(O.nn - 120) < 2, "nn=" + O.nn.toFixed(3));
  ok("缓存键带上了坐标", /@[\d.]+,[\d.]+$/.test(O.key), O.key);
  console.log("  --- 采样点命名（借城市名必须说明距离）---");
  console.log("  分档: " + JSON.stringify(O.nameStat && { 远端: O.nameStat.far, 附近: O.nameStat.near, 城中: O.nameStat.city, 重名: O.nameStat.dup }));
  console.log("  远端示例: " + JSON.stringify(O.nameStat && O.nameStat.farEx));
  console.log("  重名明细: " + JSON.stringify(O.nameStat && O.nameStat.dupNames));
  console.log("  方位构造用例: " + JSON.stringify(O.dirCases));
  ok("远端采样点不再自称「附近」（必须带方位与距离）",
    !!(O.nameStat && O.nameStat.far > 0 && O.nameStat.badFar.length === 0),
    (O.nameStat && O.nameStat.far) + " 个远端点，违例 " + JSON.stringify(O.nameStat && O.nameStat.badFar));
  ok("近端采样点不出现裸距离后缀", !!(O.nameStat && O.nameStat.badNear.length === 0),
    JSON.stringify(O.nameStat && O.nameStat.badNear));
  ok("57 个采样点名字互不重复（旧实现最多重名 4 次）",
    !!(O.nameStat && O.nameStat.dup === 0), "重复 " + (O.nameStat && O.nameStat.dup) + " 个");
  ok("八个方位全部正确（构造用例，不靠抽样）", O.dirOk === true);
  ok("落在城里报城市名、一个城区尺度报「附近」，都不带距离",
    O.nearOk === true, JSON.stringify(O.nearCase));
  console.log("  --- 换地点 ---");
  console.log("  北京点数 " + O.nBJ + " · " + JSON.stringify(O.bjNames)
    + " · 距心最远 " + (O.bjMax && O.bjMax.toFixed(1)) + " km");
  ok("换地点后点集签名已改变", O.afterMove && O.afterMove.ptsKeyChanged === true);
  ok("换地点后地图数据整个作废", O.afterMove && O.afterMove.dataKeys === 0,
    "剩余键 " + (O.afterMove && O.afterMove.dataKeys));
  ok("换地点后 LRU 顺序一并清空", O.afterMove && O.afterMove.orderLen === 0);
  ok("换地点后缓存键随坐标改变", O.afterMove && O.afterMove.keyChanged === true);
  ok("新地点重新采样出同样点数", O.nBJ === 57, "实测 " + O.nBJ);
  ok("新地点的点在它自己的半径内", O.bjMax <= 500, "最远 " + (O.bjMax && O.bjMax.toFixed(2)));
  console.log("  --- 小幅移动沿用旧网格（MAP_KEEP_KM=" + KEEP + "）---");
  console.log("  挪 " + (KEEP * 0.5).toFixed(0) + " km: " + JSON.stringify(O.keep));
  console.log("  挪 " + (KEEP * 1.5).toFixed(0) + " km: " + JSON.stringify(O.drop));
  ok("小幅移动后地图数据仍在（不白花 171 个加权调用）",
    O.keep && O.keep.dataKeys === 1, "键数 " + (O.keep && O.keep.dataKeys));
  ok("小幅移动后网格中心未变（沿用同一批采样点）",
    O.keep && O.keep.gridCSame === true && O.keep.ptsKeySame === true);
  ok("小幅移动后视口仍然跟到了新查询点", O.keep && O.keep.followed === true);
  ok("小幅移动不弹待加载引导（地图并未失效）", O.keep && O.keep.idleHidden === true);
  ok("超出 MAP_KEEP_KM 后地图数据整批作废", O.drop && O.drop.dataKeys === 0,
    "键数 " + (O.drop && O.drop.dataKeys));
  ok("超出 MAP_KEEP_KM 后 LRU 顺序一并清空", O.drop && O.drop.orderLen === 0);
  console.log("  --- 高纬度经度收缩 ---");
  console.log("  经度跨度 52.3°N: " + (O.lonSpanHigh && O.lonSpanHigh.toFixed(2))
    + "° / 31.2°N: " + (O.lonSpanLow && O.lonSpanLow.toFixed(2)) + "°");
  ok("高纬度的经度跨度更大（判圆用公里而非度数）",
    O.lonSpanHigh > O.lonSpanLow * 1.1,
    (O.lonSpanHigh && O.lonSpanHigh.toFixed(2)) + " vs " + (O.lonSpanLow && O.lonSpanLow.toFixed(2)));
  console.log("  --- 视口跟随 ---");
  console.log("  地图中心 " + JSON.stringify(O.center) + " · zoom " + O.zoom
    + " · State (" + O.stateLat + ", " + O.stateLon + ")");
  ok("视口中心已跟随查询点", !!(O.center && O.stateLat &&
    Math.abs(O.center.lat - O.stateLat) < 0.6 && Math.abs(O.center.lng - O.stateLon) < 0.6),
    O.center ? ("Δ=" + Math.abs(O.center.lat - O.stateLat).toFixed(3) + "/" + Math.abs(O.center.lng - O.stateLon).toFixed(3)) : "无");
  ok("缩放为局部级（zoom 6 附近，不再退到全国）",
    typeof O.zoom === "number" && O.zoom >= 5 && O.zoom <= 8, "zoom=" + O.zoom);
  ok("高纬度点数不变（网格只随半径/间距定，与纬度无关）", O.nHI === 57, "实测 " + O.nHI);
  console.log("  --- 境外查询与海陆掩膜 ---");
  console.log("  provOf(东京)=" + JSON.stringify(O.provOfTokyo)
    + " · provOf(上海)=" + JSON.stringify(O.provOfSH)
    + " · cnMaskOn 东京/上海 = " + O.cnOnTokyo + "/" + O.cnOnSH);
  ok("查询境外（东京）时不套用中国省界掩膜", O.cnOnTokyo === false, "cnMaskOn=" + O.cnOnTokyo);
  ok("东京不在任何中国省份内", O.provOfTokyo === null || O.provOfTokyo === undefined);
  ok("东京同样采样出 57 个点", O.nTokyo === 57, "实测 " + O.nTokyo);
  /* 条件断言：GeoJSON 就绪时才能判定境内。未就绪时 cnMaskOn 一律 false（宁可不裁），
     这正是设计意图，所以只有拿到省级归属时才要求它同时翻成 true。 */
  if (O.provOfSH) {
    ok("查询境内（上海）时启用掩膜", O.cnOnSH === true, "cnMaskOn=" + O.cnOnSH);
  console.log("  --- 跨地点缓存总闸门（MAP_CACHE_MAX=" + MAXC + "）---");
  console.log("  造 8 条 → 收一遍 → " + JSON.stringify(O.sweepAfter) + " · 再收一遍 → " + O.sweepAgain);
  ok("跨地点缓存被收到总上限以内",
    O.sweepBefore === 8 && O.sweepAfter && O.sweepAfter.total === MAXC,
    O.sweepBefore + " → " + (O.sweepAfter && O.sweepAfter.total));
  ok("当前地点的缓存一条都不删（马上要用的是它）",
    O.sweepAfter && O.sweepAfter.mine === 2, "保留 " + (O.sweepAfter && O.sweepAfter.mine) + " 条");
  ok("闸门幂等（反复调用不再变化）", O.sweepAgain === MAXC, "再次收后 " + O.sweepAgain);
  } else {
    console.log("  SKIP 上海掩膜判定 —— GeoJSON 未就绪（此时一律不裁，属预期降级）");
  }

  console.log("\n=== 首屏地图加载行为（B14）===");
  console.log("  无缓存首屏：data 键 " + fresh.dataKeys + " · 引导=" + fresh.idleShown
    + " · 地图批量请求 " + freshBulk);
  console.log("  有缓存首屏：data 键 " + warm.dataKeys + " · 引导=" + warm.idleShown
    + " · 条带 " + warm.strips + " · 地图批量请求 " + warmBulk);
  /* 判据自检：这一条是上面两条"零请求"断言的**有效性守卫** —— 若计数机制失灵
     （比如拦截器换了实现、坐标数判据不再匹配），它会先红，而不是让"没有请求"
     全部静默通过。 */
  ok("判据自检：显式取数确实被计成批量请求", afterFetchBulk >= 1,
    "取数前 " + freshBulk + " → 取数后 " + afterFetchBulk);
  ok("无缓存首屏不自动取地图数据（硬约束 9 的守卫）",
    freshBulk === 0 && fresh.dataKeys === 0 && fresh.hasField === false,
    "批量请求 " + freshBulk + " · data 键 " + fresh.dataKeys);
  ok("无缓存首屏显示待加载引导", fresh.idleShown === true);
  ok("有缓存首屏自动把地图画出来（不用再手点）",
    warm.dataKeys >= 1 && warm.hasField === true && warm.strips > 0,
    "data 键 " + warm.dataKeys + " · 条带 " + warm.strips);
  ok("有缓存首屏不再显示待加载引导", warm.idleShown === false);
  ok("有缓存首屏零地图批量请求（复用缓存，不烧额度）", warmBulk === 0,
    "本次加载 " + warmBulk + " 次");

  console.log("\n=== 控制台错误 (" + errs.length + ") ===");
  errs.slice(0, 20).forEach(e => console.log("  " + e));
  console.log("FAIL 计数:", checks.filter(x => !x).length);

  await cdp.send("Browser.close").catch(() => { });
  chrome.kill();
  srv.close();
  process.exit(checks.some(x => !x) ? 2 : 0);
})().catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
