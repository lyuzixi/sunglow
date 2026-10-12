/* =========================================================================
   Part 5：主流程与渲染
   ========================================================================= */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
/* 分段控件的选中态：视觉态与 aria-pressed 必须同步，
   否则读屏软件读到的一直是最初的默认值（F6）。 */
function setSegActive(sel, btn) {
  $$(sel + " button").forEach(x => {
    const on = x === btn;
    x.classList.toggle("on", on);
    x.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

const State = {
  lat: 23.1291, lon: 113.2644, name: "广州市", region: "广东省",
  period: "pm", dateStr: "", busy: false, result: null, cache: {},
  /* 计算进行中又来了新请求时置位：当前这轮结束后立刻补跑一次，
     保证用户最终看到的一定是"最后一次操作"对应的结果（而不是被静默丢弃）。 */
  pending: false,
  /* 趋势（F5）：一次多日多坐标取数的结果 + 算好的 TREND_DAYS×2 个格子。
     按位置缓存，setLocation 会把它清掉（换了地方这份数据就不成立了）。 */
  trend: null,
  /* 展示偏好（F7）：只影响展示，不参与任何计算与判定 */
  units: "metric", hour12: false,
  /* 地图端的选择（与单点查询相互独立）：
     mapPeriod 朝/晚霞、mapDim 着色依据、mapModel 算法模型 */
  mapPeriod: "pm", mapDim: "mix", mapModel: "ens"
};
const PRESETS = [
  ["北京", 39.9042, 116.4074], ["上海", 31.2304, 121.4737], ["广州", 23.1291, 113.2644],
  ["深圳", 22.5431, 114.0579], ["成都", 30.5728, 104.0668], ["西安", 34.3416, 108.9398],
  ["拉萨", 29.6520, 91.1721], ["哈尔滨", 45.8038, 126.5349], ["乌鲁木齐", 43.8256, 87.6168],
  ["三亚", 18.2528, 109.5119], ["香港", 22.3193, 114.1694], ["台北", 25.0330, 121.5654],
  ["东京", 35.6762, 139.6503], ["纽约", 40.7128, -74.0060]
];

/* =========================================================================
   B1 · 展示偏好持久化（`sunsetbot.pref.v1`）
   -------------------------------------------------------------------------
   在此之前项目**一个偏好键都没有**：localStorage 的全部使用点都落在两个缓存
   键族上（`sunsetbot.map.v5.*` / `sunsetbot.point.v1.*`）。于是下列 9 个状态
   刷新一次全部回到默认 —— 用户把"深色底图 + 只看数值直标"调好之后，每次重开
   都要重调一遍：

     图层开关 ×5   数值直标 / 采样点 / 可信度 / 经纬网 / 深色底图
     显示选项 ×2   单位制（公制/英制）· 时间制（24h/12h）
     地图选择 ×2   着色依据（mapDim）· 算法模型（mapModel）

   **刻意不存的两类**（存了会打架，不是忘了）：
     · **位置与日期** —— 它们已经由 URL 承载（`State` ← `readUrl()` / `saveDate()`）。
       再存一份就会与"我的位置"和分享链接互相覆盖：打开一个 `?lat=..&lon=..` 的
       分享链接，却被上次的偏好改回旧城市。
     · **`mapPeriod`（地图时段）** —— 它在初始化时由 `State.period`（同样是 URL 承载的）
       派生（`State.mapPeriod = State.period`）。持久化它会让"地图在看晚霞、上方算的是
       朝霞"这种自相矛盾的界面成为常态 —— 这正是本项目在 `period` 上踩过一次的
       "静默错位"（分段控件高亮停在 am、State.period 却是 pm）。

   **时序纪律（本模块最容易出错的地方）**：`applyPrefs()` 必须在 `initUI` 里任何
   "控件初值 / 派生状态"赋值**之前**调用。否则会出现"控件写着 A、State 是 B"：
   界面与计算各说各话，而且**没有任何报错**。
   但依赖地图 DOM 的那两项（经纬网要 `MapMod.gratUser`、深色底图要
   `MapMod.dimBaseEl`）此刻还挂不上，所以只写控件本身，真正"生效"留到
   `initMap` 末尾统一走 `applyMapLayerPrefs()`。

   **写盘纪律**：只在用户操作时同步写，不做轮询、不挂 `requestIdleCallback`
   （与 `mapCachePut` 不同）—— 偏好只有几百字节，同步写就是微秒级；
   而"用户改了但没写进去"是比"掉一帧"难查得多的问题。

   **与缓存族的边界**：键前缀与两个缓存族天然不同，**不进任何 sweep 家族**。
   偏好不是缓存：它不需要 LRU，更绝不能被"配额清理"顺手删掉。
   ========================================================================= */
const PREF_KEY = "sunsetbot.pref.v1";
/* 白名单：布尔字段（图层开关 / 时间制） */
const PREF_BOOL = ["numLabels", "showPts", "showConf", "showGrid", "dimBase", "hour12"];
/* 白名单：枚举字段 —— 值必须落在允许集合里，防止旧值/脏值把控件设成不存在的选项 */
const PREF_STR = {
  units: ["metric", "imperial"],
  mapDim: ["mix", "p", "q", "dv"],
  mapModel: ["ens", "gfs", "ec", "rt"],
  /* 语言：与其它枚举同一套白名单。坏值/未知码降级为"没有偏好"，
     下一步 detectLang() 自然回落（URL > 偏好 > 浏览器 > 简体）。 */
  lang: ["zh", "zhHant", "en"]
};
/* 读：不存在 / 解析失败 / 字段类型不对 一律静默降级为"没有偏好"。
   版本号写在键里 —— 升 `v2` 即隔离，旧值自然作废（与 `MAP_CACHE_PREFIX` 同一惯例），
   所以这里**不需要**任何迁移代码。 */
function prefRead() {
  const out = {};
  try {
    const j = JSON.parse(localStorage.getItem(PREF_KEY) || "null");
    if (!j || typeof j !== "object" || Array.isArray(j)) return out;
    PREF_BOOL.forEach(k => { if (typeof j[k] === "boolean") out[k] = j[k]; });
    Object.keys(PREF_STR).forEach(k => { if (PREF_STR[k].indexOf(j[k]) >= 0) out[k] = j[k]; });
  } catch (e) { softWarn("读展示偏好失败", e); }
  return out;
}
/* 写：先读后合并（顺带把白名单之外的一切脏字段挡在外面）。 */
function prefWrite(patch) {
  try {
    const next = Object.assign({}, prefRead(), patch);
    localStorage.setItem(PREF_KEY, JSON.stringify(next));
  } catch (e) { softWarn("写展示偏好失败（隐私模式或配额不足）", e); }
}
/* 把偏好铺到 State 与控件上。返回读到的偏好对象（测试与诊断用）。 */
function applyPrefs() {
  const p = prefRead();
  if (p.units) State.units = p.units;
  if (typeof p.hour12 === "boolean") State.hour12 = p.hour12;
  if (p.mapDim) State.mapDim = p.mapDim;
  if (p.mapModel) State.mapModel = p.mapModel;
  PREF_BOOL.forEach(k => {
    const el = $("#" + k);
    if (el && typeof p[k] === "boolean") el.checked = p[k];
  });
  const dim = $("#mapDim"); if (dim && p.mapDim) dim.value = p.mapDim;
  const mdl = $("#mapModel"); if (mdl && p.mapModel) mdl.value = p.mapModel;
  /* 分段控件的视觉态与 aria-pressed 必须跟着 State 走 —— 否则读屏软件读到的
     一直是最初的默认值（F6 那条纪律），而肉眼也看不出高亮与 State 已经分家。 */
  setSegActive("#unitSeg", $("#unitSeg button[data-u='" + State.units + "']"));
  setSegActive("#clockSeg", $("#clockSeg button[data-c='" + (State.hour12 ? "12" : "24") + "']"));
  return p;
}
/* initMap 末尾调用：把两个"依赖地图 DOM"的偏好真正挂上去。
   经纬网走 `setGratUser`（唯一入口，见 _p6.js）—— 它同时负责写 `MapMod.gratUser`
   与让 `gratSig` 失效，别在这里再写一遍。 */
function applyMapLayerPrefs() {
  refreshDimBase();
  const g = $("#showGrid");
  setGratUser(!!(g && g.checked));
}

/* ---------- 三处"由 JS 生成的静态文案" ----------
   抽成函数是为了多语言：它们原本内联在 initUI 里，切语言时没法重跑。
   内容一字未改，只是从"初始化时跑一次"变成"可重入"。 */
/* 日期下拉的选项：（今天）/（明天）那套文案只在这里定义一次 */
function refreshDateSelect() {
  const sel = $("#mapDateSel");
  if (!sel) return;
  const keep = sel.value;
  sel.innerHTML = "";
  for (let k = -7; k <= 10; k++) {
    const d = new Date(Date.now() + k * 86400000);
    const v = ymd(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v + (k === 0 ? i18n("（今天）") : (k === 1 ? i18n("（明天）") : ""));
    /* 基础文案存进 dataset：「已缓存」标记要反复拼在它后面，
       而（今天）/（明天）那套判断只该有一处定义（见 markCachedDates）。 */
    o.dataset.base = o.textContent;
    sel.appendChild(o);
  }
  sel.value = keep || State.dateStr;
}
/* 趋势卡的标题与按钮：天数一律从 TREND_DAYS 取，模板里不留数字。
   原先标题 / 按钮 / 提示三处各写死一个 7，改窗口长度时全靠 grep 才不会漏 ——
   漏一处就会出现"标题写 10 天、按钮写 7 日"这种自相矛盾的界面。
   文案里刻意不含"周"：窗口不一定是 7 天（现在是 10 天）。 */
function refreshTrendLabels() {
  const tTitle = $("#trendTitle"), tBtn = $("#trendGo");
  if (tTitle) tTitle.textContent = i18n("未来 {n} 天趋势", { n: TREND_DAYS });
  if (tBtn && !tBtn.disabled) tBtn.textContent = i18n("加载 {n} 日趋势", { n: TREND_DAYS });
}
/* 顶栏徽标：等待 / 结果摘要 / 失败三态，文案都随语言走 */
function refreshBadge() {
  const el = $("#topBadge");
  if (!el) return;
  const r = State.result;
  el.textContent = r
    ? r.name + " · " + r.dateStr + " · " + i18n(r.period === "am" ? "朝霞" : "晚霞")
    : i18n("等待计算");
}
/* 当前地点的提示行（定位状态也写在这里，切语言时只重铺这一句） */
function refreshLocHint() {
  const el = $("#locHint");
  if (!el) return;
  el.textContent = i18n("当前：{v}", { v: State.name + "（" + State.lat.toFixed(3) + "°, " + State.lon.toFixed(3) + "°）" });
}

/* ---------- 初始化界面 ---------- */
function initUI() {
  /* 语言最先定：它是**所有静态文案的渲染前提**（data-i18n 那批）。
     这里传 silent=true —— 此刻页面还没算过任何东西，不需要重渲染结果卡，
     只把 DOM 文案铺好即可（relang() 会做的事此刻无事可做）。
     它与下面的 applyPrefs() 不冲突：这里动的是文案，那边动的是控件值。
     优先级由 detectLang() 决定：URL 参数 > 偏好存储 > 浏览器语言 > 简体。 */
  setLang(detectLang(), true);
  /* 先读地址栏状态（F4）：分享链接、刷新、后退都靠它把"地区 / 日期 / 时段"带回来。
     必须在下面写默认值之前调用，否则会被默认值覆盖。 */
  readUrl();
  /* 再读展示偏好（B1）——**同样必须在任何控件初值/派生状态赋值之前**，
     理由见上面 PREF_KEY 那段的"时序纪律"。 */
  applyPrefs();
  const today = new Date();
  if (!State.dateStr) State.dateStr = ymd(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())));
  $("#date").value = State.dateStr;
  $("#date").min = ymd(new Date(Date.now() - 7 * 86400000));
  $("#date").max = ymd(new Date(Date.now() + 10 * 86400000));

  refreshTrendLabels();
  refreshDateSelect();
  /* 打开页面就把"哪些日期是免费的"标出来（只读 localStorage，不取数） */
  markCachedDates();

  $("#presets").innerHTML = PRESETS.map(p =>
    `<button data-lat="${p[1]}" data-lon="${p[2]}" data-nm="${p[0]}">${p[0]}</button>`).join("");

  /* 图例色条：直接铺一条与栅格同源的 CSS 线性渐变（白→黄→橙→红）。
     8 个 <i> 只是等分占位（保持原有 DOM 结构），本身不参与取色。 */
  const bar0 = $("#lgBar");
  if (bar0) { bar0.style.background = heatGradientCss(); bar0.innerHTML = "<i></i>".repeat(8); }
  updateLegend();

  /* 事件绑定 */
  $("#go").addEventListener("click", () => runForecast(true));
  /* 分享卡（B1）：初始禁用，首屏出结果后由 renderAll 启用 —— 免得用户在还没有结论时
     点出一个空白的 PNG。 */
  const scb = $("#shareCard");
  if (scb) scb.addEventListener("click", shareCard);
  $("#geoBtn").addEventListener("click", useGeo);
  $("#nowBtn").addEventListener("click", () => { $("#date").value = State.dateStr; saveDate(); });
  $("#date").addEventListener("change", saveDate);
  $$("#periodSeg button").forEach(b => b.addEventListener("click", () => {
    setSegActive("#periodSeg", b);
    State.period = b.dataset.p; updateLegend(); renderTrend(); runForecast(true);
  }));
  $("#presets").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    setLocation(parseFloat(b.dataset.lat), parseFloat(b.dataset.lon), b.dataset.nm, "");
    runForecast(true);
  });
  $("#q").addEventListener("input", onSearch);
  $("#q").addEventListener("focus", onSearch);
  document.addEventListener("click", e => { if (!e.target.closest(".field")) $("#sug").classList.remove("on"); });
  $("#lat").addEventListener("change", () => { State.lat = clamp(parseFloat($("#lat").value) || 0, -90, 90); $("#lat").value = State.lat; });
  $("#lon").addEventListener("change", () => { State.lon = clamp(parseFloat($("#lon").value) || 0, -180, 180); $("#lon").value = State.lon; });

  $$("#mapPeriod button").forEach(b => b.addEventListener("click", () => {
    setSegActive("#mapPeriod", b);
    State.mapPeriod = b.dataset.p;
    /* 朝霞/晚霞共用同一次取数结果，切换无需重新请求 */
    loadMapData(false);
  }));
  State.mapPeriod = State.period;
  /* 地图时段同样按 State 反推（原来地图高亮写死 "am"，与 State.mapPeriod="pm" 也不一致） */
  setSegActive("#mapPeriod", $("#mapPeriod button[data-p='" + State.mapPeriod + "']"));
  $("#mapGo").addEventListener("click", () => loadMapData(true));
  $("#mapDateSel").addEventListener("change", () => loadMapData(false));
  $("#mapDim").addEventListener("change", () => {
    State.mapDim = $("#mapDim").value; prefWrite({ mapDim: State.mapDim }); paintMap();
  });
  /* 切换算法模型：三套模型的结果在同一次取数里已全部算好（就在 box[period].pts[i].p / .q 上），
     所以只重绘、不重新请求接口；若所选模型本次无数据，paintMap 会先自动回退到综合并给出提示。
     需要重试取数时仍走「刷新地图」。 */
  const mSel = $("#mapModel");
  if (mSel) {
    State.mapModel = mSel.value || "ens";
    mSel.addEventListener("change", () => {
      State.mapModel = mSel.value || "ens";
      prefWrite({ mapModel: State.mapModel });
      modelNote(null);
      paintMap();
    });
  }

  /* 时段分段控件要反映真实状态。此前这里有个静默的错位：State.period 与
     State.mapPeriod 的初值都是 "pm"，而两个分段控件的高亮停在 "am" ——
     也就是"界面写着朝霞、算出来的却是晚霞"。静默错位的成因是没有单一来源，
     所以这里统一由 State 反推控件状态（含从地址栏读进来的时段）。 */
  setSegActive("#periodSeg", $("#periodSeg button[data-p='" + State.period + "']"));

  /* 七日趋势（F5）：按需取数，不自动触发 —— 它是一次额外的多坐标请求，
     不该在用户没要的时候占用额度与首屏时间。 */
  const tGo = $("#trendGo");
  if (tGo) tGo.addEventListener("click", () => loadTrend());

  /* 单位制 / 时间制切换（F7）：只影响展示 —— 改完重绘即可，不重新取数、
     不改任何判定阈值。 */
  const bindSeg = (sel, apply) => {
    const box = $(sel);
    if (!box) return;
    $$(sel + " button").forEach(b => b.addEventListener("click", () => {
      setSegActive(sel, b);
      apply(b.dataset);
      if (State.result) renderAll(State.result);
      renderTrend();
    }));
  };
  bindSeg("#unitSeg", d => { State.units = d.u; });
  bindSeg("#clockSeg", d => { State.hour12 = (d.c === "12"); });

  bindSeg("#unitSeg", d => { State.units = d.u; prefWrite({ units: State.units }); });
  bindSeg("#clockSeg", d => { State.hour12 = (d.c === "12"); prefWrite({ hour12: State.hour12 }); });

  /* 语言切换：按钮由 LANGS 生成（模板里不写死，加一种语言不必改 HTML）。
     与其它分段控件同款 —— setSegActive 负责视觉态与 aria-pressed 同步。
     切换后三件事：setLang 重渲全部动态区（relang）、落盘、把语言写进地址栏
     （分享链接带走语言；URL 参数在 detectLang 里是最高优先级）。 */
  const lseg = $("#langSeg");
  if (lseg) {
    lseg.innerHTML = LANGS.map(l =>
      `<button type="button" data-lang="${l.k}" aria-pressed="${l.k === LANG}">${l.name}</button>`).join("");
    setSegActive("#langSeg", lseg.querySelector('button[data-lang="' + LANG + '"]'));
    $$("#langSeg button").forEach(b => b.addEventListener("click", () => {
      setSegActive("#langSeg", b);
      setLang(b.getAttribute("data-lang"));
      prefWrite({ lang: LANG });
      syncUrl();
    }));
  }

  /* 图层开关（F6 第二编码 / C1）：纯重绘或只切叠加层显隐，都不取数。
     五个开关一律"先应用、再落盘" —— 落盘失败（隐私模式）不影响本次生效。 */
  const nl = $("#numLabels");
  if (nl) nl.addEventListener("change", () => { renderLabels(); prefWrite({ numLabels: nl.checked }); });
  /* 采样点图钉：纯 DOM 叠加，不取数、不重绘色面 */
  const sp = $("#showPts");
  if (sp) sp.addEventListener("change", () => { renderPins(); placePins(); prefWrite({ showPts: sp.checked }); });
  /* 可信度纱：只切换叠加层的显隐，色面像素一个也不动 */
  const sconf = $("#showConf");
  if (sconf) sconf.addEventListener("change", () => { refreshConf(); prefWrite({ showConf: sconf.checked }); });
  /* 经纬网开关（C1）：只切这一层里那张 SVG 的显隐，**不动等值线**（两者共用 .clayer）。
     走 setGratUser 这个唯一入口 —— 它负责把"用户偏好"与"网画出来了没"两位分开。 */
  const sgrid = $("#showGrid");
  if (sgrid) sgrid.addEventListener("change", () => {
    setGratUser(sgrid.checked); prefWrite({ showGrid: sgrid.checked });
  });
  /* 底图压暗：只改一层 CSS 的 opacity */
  const db = $("#dimBase");
  if (db) db.addEventListener("change", () => { refreshDimBase(); prefWrite({ dimBase: db.checked }); });

  /* 首屏定位：**唯一来源是 `State`** —— 它的初值就是默认城市，地址栏带了参数时
     已在上面的 readUrl() 里覆盖。这里绝不能再另写一份写死的城市名：那样改默认城市
     要改两处，漏一处就会出现"标题写着上海、数据却是广州"这种自相矛盾的首屏。 */
  setLocation(State.lat, State.lon, State.name || i18n("我的位置"), State.region || "");
  syncUrl();
  renderTrend();
  /* 趋势也"有缓存就直接画出来"（B2，与地图 B14 同构）：
     命中零请求，未命中**什么都不做**（loadTrend 在 cacheOnly 模式下会在任何
     网络调用之前 return false，连按钮文案都不碰）—— 所以这里不必再判一次。 */
  loadTrend(true);
  runForecast(true);
  /* 地图数据由 initMap() 统一加载，避免重复请求 */
}

function saveDate() {
  const v = $("#date").value;
  if (!v) return;
  if (v < $("#date").min) $("#date").value = $("#date").min;
  if (v > $("#date").max) $("#date").value = $("#date").max;
  State.dateStr = $("#date").value;
  $("#mapDateSel").value = State.dateStr;
  syncUrl();
  /* 已加载的趋势区间内换日期无需重新取数，只需把高亮挪过去 */
  renderTrend();
  runForecast(true);
  if ($("#autoMap").checked) loadMapData(false);
}
function setLocation(lat, lon, name, region) {
  const moved = (Math.abs(lat - State.lat) > 1e-6) || (Math.abs(lon - State.lon) > 1e-6);
  State.lat = clamp(lat, -90, 90); State.lon = clamp(lon, -180, 180);
  State.name = name; State.region = region || "";
  $("#lat").value = State.lat.toFixed(4);
  $("#lon").value = State.lon.toFixed(4);
  refreshLocHint();
  /* 换了地方，已加载的趋势数据不再成立（它是按位置取的 34 个坐标） */
  if (moved && State.trend) { State.trend = null; renderTrend(); }
  /* 地图同理，而且更彻底：局部网格是围绕查询点生成的（B13），
     旧数据属于旧地点 —— 必须整个作废，不能当缓存留着。 */
  if (moved) mapOnPlaceChanged();
  syncUrl();
}
function useGeo() {
  /* 用页面内的提示条代替 alert()：alert 会阻塞主线程、样式与整体 UI 不一致，
     在移动端还会打断用户操作（F6）。 */
  if (!navigator.geolocation) { $("#locHint").textContent = i18n("当前浏览器不支持定位，请手动输入经纬度"); return; }
  $("#locHint").textContent = i18n("正在获取定位…");
  navigator.geolocation.getCurrentPosition(pos => {
    const la = pos.coords.latitude, lo = pos.coords.longitude;
    const nc = nearestCity(la, lo, ALL_CITIES);
    setLocation(la, lo, nc && nc.distKm < 120 ? nc.city.name : "我的位置", "");
    runForecast(true);
  }, err => {
    const why = (err && err.code === 1) ? "定位权限被拒绝" : "定位失败";
    $("#locHint").textContent = i18n("{why}，请手动输入经纬度或搜索城市。", { why: why });
  }, { timeout: 8000 });
}
function onSearch() {
  const q = $("#q").value;
  const box = $("#sug");
  /* 直接粘贴经纬度 */
  const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,，\s]+\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const a = parseFloat(m[1]), b = parseFloat(m[2]);
    box.innerHTML = `<div data-lat="${a}" data-lon="${b}" data-nm="${i18n("自定义坐标")}"><div class="s1">${i18n("使用坐标：{v}", { v: a.toFixed(4) + ", " + b.toFixed(4) })}</div><div class="s2">${i18n("直接定位")}</div></div>`;
    box.classList.add("on");
    return;
  }
  const list = searchCity(q, 26);
  if (!list.length) { box.classList.remove("on"); return; }
  box.innerHTML = list.map(c =>
    `<div data-lat="${c.lat}" data-lon="${c.lon}" data-nm="${esc(c.name)}" data-rg="${esc(c.region)}">
       <div class="s1">${esc(c.name)}</div><div class="s2">${esc(c.region)} ${c.lat.toFixed(3)},${c.lon.toFixed(3)}</div></div>`).join("");
  box.classList.add("on");
  box.onclick = e => {
    const d = e.target.closest("div[data-lat]"); if (!d) return;
    setLocation(parseFloat(d.dataset.lat), parseFloat(d.dataset.lon), d.dataset.nm, d.dataset.rg);
    $("#q").value = d.dataset.nm;
    box.classList.remove("on");
    runForecast(true);
    /* 这里原来是 loadMapData(true)：强制刷新会让每次按城市搜索都白白重发整批
       152 坐标 × 3 路的地图取数（约 456 个加权调用）。地图数据只按**日期**索引，
       与查询地点无关 —— 换城市根本不影响它，所以与 saveDate 保持一致走缓存即可。
       真正需要重新取数时，用户手上还有明确入口：「刷新地图」按钮。 */
    if ($("#autoMap").checked) loadMapData(false);
  };
}

/* =========================================================================
   核心计算
   ========================================================================= */
async function runForecast(scroll) {
  /* 并发点击（连点「开始预报」、连切预设城市、连改日期）此前被静默丢弃：
     界面毫无反应，用户只能再点一次。改为记下"还有一轮待跑"并给出即时反馈，
     当前这轮结束后自动补跑 —— 最终结果一定是最后一次操作的输入。 */
  if (State.busy) {
    State.pending = true;
    $("#topBadge").textContent = i18n("上一次计算仍在进行，完成后将按最新条件自动重算…");
    return;
  }
  State.busy = true;
  const btn = $("#go");
  btn.disabled = true; btn.textContent = i18n("计算中…");
  $("#topBadge").textContent = i18n("正在获取数据…");
  const lat = parseFloat($("#lat").value), lon = parseFloat($("#lon").value);
  State.lat = clamp(isNum(lat) ? lat : State.lat, -90, 90);
  State.lon = clamp(isNum(lon) ? lon : State.lon, -180, 180);
  State.dateStr = $("#date").value || State.dateStr;
  /* 本次请求的输入快照：await 期间用户随时可能改地区/时段/日期，
     后续所有标签都必须用这份快照（以 res 为准），不能读会被改动的 State。 */
  const name = State.name, period = State.period, dateStr = State.dateStr;

  try {
    const res = await computeAll(State.lat, State.lon, dateStr, period, name);
    State.result = res;
    renderAll(res);
    refreshBadge();
    if (scroll && window.innerWidth < 900) $("#cardHero").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    console.warn("预报失败", e);
    const st = e && e.status;
    /* friendly 优先：它是取数层对「为什么失败、该怎么办」给出的针对性说明。
       尤其是 429 的两种情况（短时限流 vs 日额度耗尽）处置方式完全相反，
       用同一句"请稍候 1 分钟重试"会把人引到错误方向。 */
    const head = (e && e.friendly)
      ? e.friendly
      : e && e.timeout
        ? i18n("气象接口响应超时（超过 12 秒），请检查网络后重试。")
        : st === 429
          ? i18n("气象接口暂时限流（同一 IP 请求过于频繁），请稍候约 1 分钟后重试。")
          : i18n("数据获取失败：{v}", { v: String(e.message || e) });
    const tail = (e && e.fatal)
      ? i18n("额度会在次日重置，之后即可恢复。想继续使用的话：地图数据占单次首屏约 88% 的调用量，不点「加载周边地图」就不会消耗；也可以改用付费计划或自建实例。")
      : i18n("请检查网络连接或稍后重试；也可能是该日期超出模式可提供的范围（可预报范围约 今天−7 天 ~ 今天+10 天）。");
    $("#hero").innerHTML = `<div class="note n-bad">${head}<br>${tail}</div>`;
    $("#models").innerHTML = ""; $("#fac").innerHTML = ""; $("#ray").innerHTML = "";
    $("#notes").innerHTML = `<div class="note n-bad">${i18n("请求未完成，无结果可展示。")}</div>`;
    $("#topBadge").textContent = i18n("获取失败");
  } finally {
    State.busy = false;
    btn.disabled = false; btn.textContent = i18n("开始预报");
    if (State.pending) { State.pending = false; runForecast(scroll); }
  }
}

/* 计算一次预报。
   pre 是可选注入项 { bundle, pts }：趋势视图（F5）用**一次**多日多坐标取数
   算出 TREND_DAYS 天 × 朝/晚霞的结果，所以这里要允许把"已取好的数据"和"已构造好的样带"
   直接喂进来，避免为每一天各发一轮请求。
   注入时样带用所选日期的方位构造（见 trendFetch 的注释），因而存在一个小近似：
   其余日期用的是"所选日期的样带几何"，而不是各自当天的方位。 */
async function computeAll(lat, lon, dateStr, period, name, pre) {
  const [Y, M, D] = dateStr.split("-").map(Number);
  const dayMs = Date.UTC(Y, M - 1, D);
  const dObj = new Date(dayMs);
  const ev = sunEvents(dayMs, lat, lon);
  const notes = [];

  /* 极昼/极夜 */
  let tMs = period === "am" ? ev.riseMs : ev.setMs;
  if (tMs == null) {
    if (ev.polarNight) notes.push(["bad", i18n("该日该地处于极夜（或太阳整天不升起），不存在朝霞/晚霞。")]);
    else notes.push(["warn", i18n("该纬度该日期太阳不落（极昼），无日出/日落时刻，已改用太阳最低高度角时刻近似。")]);
    tMs = ev.noonMs + 12 * 3600000;
  }
  const sp = solarPosition(tMs, lat, lon);
  const az = sp.azimuth;
  const vSpd = sunsetSpeedKmph(Math.abs(lat), dObj);
  const omega = sunAltRate(tMs, lat, lon);

  /* 沿日出/日落方位的样带点 */
  const pts = (pre && pre.pts) ? pre.pts
    : TRANSECT.map(d => d === 0 ? { lat, lon } : destPoint(lat, lon, az, d));

  /* 三个请求（GFS / EC / 空气质量）。
     两层缓存，键统一由 pointKeyOf()（_p6.js）给出 —— 内存与磁盘必须用**同一个**
     判据，否则会出现"内存没命中、磁盘却命中"这种让人以为缓存坏了的组合：
       · State.cache —— 会话内。键本来就带 period，因为样带是沿**该时段**事件方位
         （日出 vs 日落）构造的，两次的坐标集合并不相同，所以朝霞与晚霞各自取一次数
         不是冗余；
       · pointCacheGet / pointCachePut —— 跨会话（B1）。刷新页面、关掉再打开都能复用，
         这才让"刷新一下看看有没有更新"不再重新花 65 个加权调用。 */
  const key = pointKeyOf(lat, lon, dateStr, period);
  let bundle = pre ? pre.bundle : State.cache[key];
  let fromDisk = false;
  if (!bundle && !pre) { bundle = pointCacheGet(lat, lon, dateStr, period); fromDisk = !!bundle; }
  if (!bundle) {
    const gfsP = apiForecast(MODEL_NAME.gfs, pts, ymd(new Date(dayMs - 86400000)), ymd(new Date(dayMs + 86400000)), API_TZ, "sunrise,sunset");
    let ecP = apiForecast(MODEL_NAME.ec, pts, ymd(new Date(dayMs - 86400000)), ymd(new Date(dayMs + 86400000)), API_TZ)
      .catch(e => { notes.push(["warn", i18n("ECMWF-IFS 模式数据请求失败，已退化为仅用 GFS 数据计算综合结果。")]); return null; });
    let aqP = apiAQ(pts, ymd(new Date(dayMs - 86400000)), ymd(new Date(dayMs + 86400000)), API_TZ)
      .catch(e => { notes.push(["warn", i18n("气溶胶（AOD）数据请求失败，已按中等偏洁净大气 AOD=0.25 估算，结果不确定性上升。")]); return null; });
    const [gfsD, ecD, aqD] = await Promise.all([gfsP, ecP, aqP]);
    bundle = { gfsD, ecD, aqD };
    /* 只有自主取回来的才写缓存。pre（趋势注入）用的是**所选日期的样带几何**，
       把它写进 (日期 D, 时段) 这个键，会让 D 这一天之后命中一份坐标不对的数据。
       注入路径一律不写 —— 这是改造前就有的行为，别顺手"补上"。 */
    if (!pre) { State.cache[key] = bundle; pointCachePut(lat, lon, dateStr, period, bundle); }
  } else if (!pre) {
    State.cache[key] = bundle;    // 磁盘命中顺手提进内存，同一会话里后续切回不再读盘
    notes.push(["info", i18n(fromDisk
      ? "本次使用了本地缓存的气象数据（同地点、同日期、同时段在 3 小时内不重复请求）。"
      : "本次使用了缓存的气象数据（同一地点与日期在本次会话中不重复请求）。")]);
  }
  const { gfsD, ecD, aqD } = bundle;

  const offsetS = nz((gfsD[0] || {}).utc_offset_seconds, 8 * 3600);
  const tzName = (gfsD[0] || {}).timezone_abbreviation || "";

  /* 序列 */
  const serG = gfsD.map(makeSeries), serE = ecD ? ecD.map(makeSeries) : null;
  const serA = aqD ? aqD.map(makeSeries) : null;

  /* 主点环境场 */
  const envG = buildEnv(serG[0], tMs);
  let envE = serE ? buildEnv(serE[0], tMs) : null;
  let fallbackFields = [];
  if (envE) {
    ["vis", "fz", "blh", "ws", "cape", "precip"].forEach(k => {
      if (!isNum(envE[k]) && isNum(envG[k])) { envE[k] = envG[k]; fallbackFields.push(k); }
    });
    if (fallbackFields.length && fallbackFields.some(k => k === "vis" || k === "fz")) {
      notes.push(["warn", i18n("ECMWF-IFS 模式不提供 能见度 / 0℃层高度 / 边界层高度，已用 GFS 同点位数据补全后再参与计算（已在结果中标注）。")]);
    }
  }
  const aodMain = serA ? serA[0].at("aerosol_optical_depth", tMs) : null;
  const pm25 = serA ? serA[0].at("pm2_5", tMs) : null;
  const dust = serA ? serA[0].at("dust", tMs) : null;
  const aodUse = isNum(aodMain) ? clamp(aodMain, 0.005, 5) : 0.25;
  const aodAnomaly = isNum(aodMain) && (aodMain > 2 || aodMain < 0);
  envG.aod = aodUse;
  if (envE) envE.aod = aodUse;
  if (!isNum(aodMain)) notes.push(["warn", i18n("未取到 AOD（气溶胶光学厚度），按 0.25 估算。")]);
  else if (aodAnomaly) notes.push(["warn", i18n("AOD 数值异常（{v}），已截断到合理范围后使用。", { v: aodMain.toFixed(2) })]);

  /* 样带分析 */
  const mk = (serArr) => TRANSECT.map((d, i) => ({
    d, lat: pts[i].lat, lon: pts[i].lon,
    cLow: serArr[i] ? serArr[i].at("cloud_cover_low", tMs) : null,
    cMid: serArr[i] ? serArr[i].at("cloud_cover_mid", tMs) : null,
    cHigh: serArr[i] ? serArr[i].at("cloud_cover_high", tMs) : null,
    vis: serArr[i] ? serArr[i].at("visibility", tMs) : null,
    rh: serArr[i] ? serArr[i].at("relative_humidity_2m", tMs) : null,
    aod: serA && serA[i] ? serA[i].at("aerosol_optical_depth", tMs) : null
  }));
  const trG = mk(serG), trE = serE ? mk(serE) : null;

  const ctx = { v: vSpd, omega, aod: aodUse, offsetS, lat, lon, period, tMs, dP: pressureTrend(serG[0], tMs) };

  const pdG = primaryDeck(envG);
  const aG = analyseTransect(trG, pdG.primary.key);
  const sG = scoreStat(envG, aG, ctx);

  let sE = null, aE = null;
  if (envE && trE) {
    const pdE = primaryDeck(envE);
    aE = analyseTransect(trE, pdE.primary.key);
    sE = scoreStat(envE, aE, ctx);
  }

  /* 综合场（GFS 与 EC 平均）用于光追 */
  const envM = {};
  ["T", "Td", "RH", "cTot", "cLow", "cMid", "cHigh", "vis", "P", "Pmsl", "ws", "wd", "gust", "fz", "blh", "precip", "cape", "aod"]
    .forEach(k => {
      const a = envG[k], b = envE ? envE[k] : null;
      envM[k] = (isNum(a) && isNum(b)) ? (a + b) / 2 : (isNum(a) ? a : (isNum(b) ? b : null));
    });
  const trM = TRANSECT.map((d, i) => {
    const o = { d };
    ["cLow", "cMid", "cHigh", "vis", "rh", "aod"].forEach(k => {
      const a = trG[i][k], b = trE ? trE[i][k] : null;
      o[k] = (isNum(a) && isNum(b)) ? (a + b) / 2 : (isNum(a) ? a : (isNum(b) ? b : null));
    });
    return o;
  });
  const pdM = primaryDeck(envM);
  const aM = analyseTransect(trM, pdM.primary.key);
  const sRT = scoreRay(envM, aM, ctx);

  /* 综合：加权几何平均（任一模式否决时显著拉低结论，与要素级融合口径一致） */
  const parts = [{ k: "gfs", P: sG.P, Q: sG.Q, w: W_ENS.gfs }];
  if (sE) parts.push({ k: "ec", P: sE.P, Q: sE.Q, w: W_ENS.ec });
  parts.push({ k: "rt", P: sRT.P, Q: sRT.Q, w: W_ENS.rt });
  const P = wgeo(parts.map(p => [p.P, p.w]));
  const Q = wgeo(parts.map(p => [p.Q, p.w]));
  /* 分歧（B3）：口径与地图的「模型分歧」维度**同源** —— 都取 mixedIndex(P,Q) 的极差。
     每个算法自己那个 I 也留着，供结论卡并列显示三家的值。 */
  const spanOf = arr => arr.length >= 2 ? Math.max(...arr) - Math.min(...arr) : null;
  parts.forEach(x => { x.I = mixedIndex(x.P, x.Q); });
  const spread = spanOf(parts.map(x => x.P));
  const spreadQ = spanOf(parts.map(x => x.Q));
  const dvI = spanOf(parts.map(x => x.I));
  /* 一致性改由 dvI（综合指数极差）导出，与 ensConfOf 同一把尺子。
     此前用的是 spread（P 的极差），于是同一屏里会出现"一致性 62%"配上
     "可信度 高"这种自相矛盾的组合 —— 两个数字来自不同的极差。
     地图的 dv 维度也是 I 的极差，三处现在同源。 */
  const consist = clamp(100 - nz(dvI, 0) * 1.9, 0, 100);
  const conf = ensConfOf(dvI);

  /* 数据质量提示 */
  const leadH = (tMs - Date.now()) / 3600000;
  if (leadH > 120) notes.push(["warn", i18n("预报时效约 {n} 小时，远超教程建议的 36 小时上限，霞光受云的三维分布影响极大，结论仅供参考。", { n: Math.round(leadH) })]);
  else if (leadH > 36) notes.push(["warn", i18n("预报时效约 {n} 小时，已超过 36 小时，建议临近时再用实况外推订正。", { n: Math.round(leadH) })]);
  else if (leadH > 0) notes.push(["ok", i18n("预报时效约 {n} 小时，处于数值模式较可信区间。", { n: Math.round(leadH) })]);
  else notes.push(["info", i18n("所选时间为{when}，数据来源于模式分析场/历史存档，可用于复盘。", {
    when: leadH < -1 ? i18n("过去 {n} 小时", { n: Math.round(-leadH) }) : i18n("当前时刻") })]);
  /* 分歧提示（B3）：档位与文案都改由 ENS_CONF_BANDS 驱动，不再手写 18/35；
     措辞也从「GFS 与 EC」改成「三套算法」—— 这个极差本来就把光追算在内，
     旧文案漏掉它，会让人以为分歧只可能来自两套全球模式。 */
  if (isNum(dvI)) {
    const cfT = confText(conf);
    notes.push([conf.key === "hi" ? "ok" : (conf.key === "mid" ? "info" : "warn"),
      cfT.txt + "（ΔI " + Math.round(dvI) + " " + i18n("分") + "）· " + ensConfDetail(spread, spreadQ) + "。" + cfT.hint]);
  }
  /* 云边界不确定性：云边界上的风速沿日出/日落方向的投影（教程 4.x）
     <15 m/s 不确定度小；15~30 偏大；>30 很大 */
  let along = null;
  if (isNum(envG.ws) && isNum(envG.wd) && isNum(az)) along = alongComponent(envG.ws, envG.wd, az);
  if (along != null) {
    if (along > 30) notes.push(["bad", i18n("日落/日出方向的风分量约 {v} m/s，云边界位置不确定性很大，云边界距离的参考价值明显下降。", { v: along.toFixed(0) })]);
    else if (along > 15) notes.push(["warn", i18n("日落/日出方向的风分量约 {v} m/s，云边界位置存在一定不确定性，请结合临近云图复核。", { v: along.toFixed(0) })]);
    else notes.push(["ok", i18n("日落/日出方向的风分量约 {v} m/s（<15 m/s），云边界位置不确定性较小。", { v: along.toFixed(0) })]);
  }
  const apiRise = gfsD[0] && gfsD[0].daily && gfsD[0].daily.sunrise && gfsD[0].daily.sunrise[0];
  const apiSet = gfsD[0] && gfsD[0].daily && gfsD[0].daily.sunset && gfsD[0].daily.sunset[0];
  function diffMin(apiStr, ms) {
    if (!apiStr || !isNum(ms)) return null;
    const t = Date.parse(apiStr + "Z") - offsetS * 1000;
    return Math.abs(t - ms) / 60000;
  }
  const dRise = diffMin(apiRise, ev.riseMs), dSet = diffMin(apiSet, ev.setMs);
  if ((isNum(dRise) && dRise > 8) || (isNum(dSet) && dSet > 8))
    notes.push(["warn", i18n("本地天文计算的事件时刻与模式给出的日出日落相差 {n} 分钟，可能与该点位高程或时区偏移有关，已以天文计算为准。", { n: Math.round(Math.max(dRise || 0, dSet || 0)) })]);
  if (Math.abs(lat) > 60) notes.push(["info", i18n("高纬度地区：日出/日落线速度与太阳高度角变化率均显著变小，霞光可持续很久，但也可能因太阳高度角过低而偏暗。")]);
  const missAll = Array.from(new Set(envG.missing.concat(envE ? envE.missing : [])));
  if (missAll.length) notes.push(["warn", i18n("以下要素缺失并已做插值或替代：{v}。", { v: listJoin(missAll.map(f => i18n(fieldName(f)))) })]);
  if (sRT.peak.T550 < 0.002) notes.push(["warn", i18n("光路消光很强（550nm 透射率 {v}），即使出现霞光也偏暗弱。", { v: sRT.peak.T550.toExponential(2) })]);
  if (!isNum(aodMain)) notes.push(["info", i18n("气溶胶数据缺失时的替代值会影响颜色鲜艳度判断，请留意。")]);
  if (dust != null && dust > 50 && aodUse > 0.5) notes.push(["warn", i18n("沙尘或强霾信号明显（dust≈{v} μg/m³），霞光颜色很可能偏浑浊发白。", { v: Math.round(dust) })]);

  return {
    name, lat, lon, dateStr, period, ev, tMs, az, vSpd, omega, offsetS, tzName,
    envG, envE, envM, aG, aE, aM, sG, sE, sRT, P, Q, spread, spreadQ, dvI, consist, conf, parts,
    aodUse, aodMain, pm25, dust, notes, pts, trG, trE, trM, leadH, trendVal: ctx.dP, along,
    fallbackFields, apiRise, apiSet, dRise, dSet
  };
}
const FIELD_CN = {
  temperature_2m: "温度", dew_point_2m: "露点", relative_humidity_2m: "相对湿度", cloud_cover: "总云量",
  cloud_cover_low: "低云量", cloud_cover_mid: "中云量", cloud_cover_high: "高云量", visibility: "能见度",
  surface_pressure: "地面气压", pressure_msl: "海平面气压", wind_speed_10m: "风速", wind_direction_10m: "风向",
  wind_gusts_10m: "阵风", freezing_level_height: "0℃层高度", boundary_layer_height: "边界层高度",
  precipitation: "降水量", cape: "对流有效位能", shortwave_radiation: "短波辐射", dust: "沙尘", pm2_5: "PM2.5"
};
const fieldName = k => FIELD_CN[k] || k;

/* =========================================================================
   地址栏状态同步（F4）
   -------------------------------------------------------------------------
   把"地区 + 日期 + 时段"回写进查询串，使页面可分享、可收藏、刷新后不丢状态。
   用 replaceState 而不是 pushState：本应用没有真正的路由，
   每点一次城市就压一条历史记录会让浏览器的后退键变得难以预期
   （用户以为会回到上一个页面，实际只是回到上一个城市）。
   ========================================================================= */
function syncUrl() {
  try {
    if (!window.history || !window.history.replaceState) return;
    /* 只认 http/https：内联预览、file:// 或 about:blank 下改地址没有意义，
       也可能直接抛异常（不同内核行为不一致）。 */
    if (!/^https?:$/.test(location.protocol)) return;
    const q = "?lat=" + State.lat.toFixed(4) + "&lon=" + State.lon.toFixed(4) +
      "&date=" + encodeURIComponent(State.dateStr) + "&period=" + State.period +
      (State.name ? "&name=" + encodeURIComponent(State.name) : "") +
      (State.region ? "&region=" + encodeURIComponent(State.region) : "") +
      /* 语言也进地址栏：分享链接要能固定语言（否则对方按浏览器语言看到另一种）。
         它同时是 detectLang() 里的最高优先级来源。 */
      "&lang=" + encodeURIComponent(LANG);
    window.history.replaceState(null, "", location.pathname + q);
  } catch (e) { softWarn("地址栏状态同步失败", e); }
}
/* 从地址栏恢复状态。返回是否读到了有效坐标 —— 没读到就沿用默认的广州市。 */
function readUrl() {
  let got = false;
  try {
    const p = new URLSearchParams(location.search || "");
    const la = parseFloat(p.get("lat")), lo = parseFloat(p.get("lon"));
    if (isNum(la) && isNum(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
      State.lat = la; State.lon = lo; got = true;
    }
    const d = p.get("date");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) State.dateStr = d;
    const pe = p.get("period");
    if (pe === "am" || pe === "pm") State.period = pe;
    /* 地名只走白名单（safeLabel），**不是**截断了事：`name`/`region` 是地址栏里
       用户可控的字符串，它们最终会落进结果卡的 innerHTML。40 字符的截断挡不住
       `<img src=1 onerror=eval(location.hash)>`（正好 39 字符），而 hash 里可以
       放任意长度的载荷。详见 _p2.js 里 safeLabel 的注释。 */
    const nm = p.get("name");
    if (nm) State.name = safeLabel(nm);
    const rg = p.get("region");
    if (rg) State.region = safeLabel(rg);
  } catch (e) { softWarn("地址栏状态读取失败", e); }
  return got;
}
/* 供地图点击查询复用：带地名解析地跳转到一个坐标 */
function gotoLatLng(lat, lon) {
  let nm = "自定义坐标", rg = "";
  try {
    const nc = nearestCity(lat, lon, ALL_CITIES);
    if (nc && nc.distKm < 120) { nm = nc.city.name; rg = nc.city.region; }
  } catch (e) { softWarn("点位地名解析失败", e); }
  setLocation(lat, lon, nm, rg);
}

/* =========================================================================
   趋势视图（F5）
   -------------------------------------------------------------------------
   取数策略：**一次**多日多坐标请求覆盖 TREND_DAYS 天 × 朝/晚霞。
   样带按「所选日期」的日出/日落方位构造（am 17 点 + pm 17 点 = 34 点），
   其余日期沿用这套样带几何。之所以能这么做：方位角在窗口内的漂移很小 ——
   中纬度约 0.3°/天，10 天约 3°，在 400 km 处约合 21 km，仍在样带 25 km
   的采样间隔之内。换来两个好处：
     · 只花 34 个坐标的额度（约等于一次普通单点查询），而不是 10×34；
     · 所选日期那一列与上方「单日精细结果」**完全一致** —— 同坐标、同数据、
       同一个 computeAll，不会出现"同一日期两个数"。
   代价是其余日期的样带方位有几公里的偏差，已在卡片下方注明。
   注：窗口一拉长，这个"漂移 < 采样间隔"的前提就变薄了 —— 再加天数时
   必须重新核对（比如 14 天约 4.2° / 29 km，就**已经超过**采样间隔了）。
   ========================================================================= */
/* 窗口长度（天）。7 → 10 是**零成本**的：Open-Meteo 的加权调用里天数系数是
   max(1, 天数/14)，3 / 7 / 10 天全都落在同一个档位（系数 1.0）—— 也就是说
   多取这三天，请求条数、坐标数、计费额一个都不变。
   为什么是 10 而不是 14：应用自己声明的可预报范围是「今天−7 ~ 今天+10」
   （见上面 #date 的 min/max），再往外就越过自己划的界了；而且 >120 小时的行
   本来只会触发"时效过长、仅供参考"的警告，多给也只是多几个低可信度候选。
   后 3 天可信度很低，主要价值是横向比较"哪天值得去"时多两个候选。 */
const TREND_DAYS = 10;
const TREND_N = TRANSECT.length;

/* 与 computeAll 内部的样带构造逐字同构，保证所选日期两侧结果一致 */
function transectFor(lat, lon, dayMs, period) {
  const ev = sunEvents(dayMs, lat, lon);
  let ms = period === "am" ? ev.riseMs : ev.setMs;
  if (ms == null) ms = ev.noonMs + 12 * 3600000;
  const az = solarPosition(ms, lat, lon).azimuth;
  return TRANSECT.map(d => d === 0 ? { lat, lon } : destPoint(lat, lon, az, d));
}
const trendCut = (arr, a, b) => (arr ? arr.slice(a, b) : null);

/* 实际可用的窗口长度。
   起点是**用户选的日期**（不是今天），所以"10 天窗口"在选到靠后日期时会顶到
   模式的预报上限之外：Open-Meteo 最远到今天+15（16 天含今天）。
   不夹的后果不是"少几行数据"，而是**整个趋势加载失败** —— apiForecast 用
   start_date/end_date 传区间，越界会被判 400；而 GFS 那一路没有 catch（EC 有），
   于是整个 Promise.all 直接掀掉。
   夹紧之后窗口变短，但**计费不变**：天数系数 max(1, 天数/14) 在 ≤14 天时恒为 1.0。
   注意 `#date` 的可选范围是 今天−7 ~ 今天+10，所以"选到靠后日期"是常态路径。 */
function trendWindow(day0) {
  const d = new Date();
  const today0 = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const maxIdx = Math.floor((today0 + 15 * 86400000 - day0) / 86400000) + 1;
  return Math.max(1, Math.min(TREND_DAYS, maxIdx));
}

async function loadTrend(cacheOnly) {
  const btn = $("#trendGo"), out = $("#trendBody");
  const lat = State.lat, lon = State.lon, name = State.name;
  const [Y, M, D] = State.dateStr.split("-").map(Number);
  const day0 = Date.UTC(Y, M - 1, D);
  /* ---- 缓存快路径（B2）：命中就直接画，**一个请求都不发** ----
     与地图那条（B14）逐字同构。位置在 cacheOnly 闸门**之前** —— 这一点是刻意的：
     命中缓存不算"取数"，所以自动加载命中时本来就该画出来。 */
  const hit = trendCacheGet(day0);
  if (hit) { State.trend = hit; renderTrend(); return true; }
  /* ---- cacheOnly：只查缓存，绝不取数（开页自动加载专用）----
     走到这里说明上面没命中 = 没有缓存可用。位置刻意放在快路径之后、任何网络调用
     之前：于是"自动加载不会烧额度"由**这一行**硬保证，而不是靠调用方复制一份
     命中条件去跟上面那两行对齐（镜像条件迟早会漂移）。 */
  if (cacheOnly) return false;

  const ptsAM = transectFor(lat, lon, day0, "am");
  const ptsPM = transectFor(lat, lon, day0, "pm");
  const all = ptsAM.concat(ptsPM);
  const sD = ymd(new Date(day0));
  const nDay = trendWindow(day0);
  const eD = ymd(new Date(day0 + (nDay - 1) * 86400000));
  if (btn) { btn.disabled = true; btn.textContent = i18n("取数中…"); }
  if (out) out.innerHTML = `<div class="hint">${i18n("正在取 {n} 天数据（{c} 个坐标 × 3 路，朝/晚霞共用一次取数）…", { n: nDay, c: all.length })}</div>`;
  try {
    /* 不请求 daily：趋势只需要逐时要素；daily 也会计入变量权重，且其日出日落
       只对应窗口第一天，对后续日期反而会算出无意义的"天文-模式时刻偏差"提示。 */
    const gP = apiForecast(MODEL_NAME.gfs, all, sD, eD, API_TZ);
    const eP = apiForecast(MODEL_NAME.ec, all, sD, eD, API_TZ).catch(() => null);
    const aP = apiAQ(all, sD, eD, API_TZ).catch(() => null);
    const [gD, eD2, aD] = await Promise.all([gP, eP, aP]);
    State.trend = {
      lat, lon, day0, sD, eD, name, n: nDay,
      pts: { am: ptsAM, pm: ptsPM },
      b: {
        am: { gfsD: trendCut(gD, 0, TREND_N), ecD: trendCut(eD2, 0, TREND_N), aqD: trendCut(aD, 0, TREND_N) },
        pm: { gfsD: trendCut(gD, TREND_N, 2 * TREND_N), ecD: trendCut(eD2, TREND_N, 2 * TREND_N), aqD: trendCut(aD, TREND_N, 2 * TREND_N) }
      },
      ecOK: !!eD2, aqOK: !!aD, rows: null
    };
    await computeTrend();
    /* 算完才落盘 —— 落盘的是**算好的 rows**（见 TREND_CACHE_PREFIX 的账目：
       存原始响应约 5 MB，一条就撑爆 localStorage 配额）。 */
    if (State.trend && State.trend.rows && State.trend.rows.length) {
      trendCachePut(day0, trendSnapshot(State.trend));
    }
    return true;
  } catch (e) {
    console.warn("趋势取数失败", e);
    const st = e && e.status;
    /* friendly 优先，理由与 runForecast 相同：429 分两类，而它们的正确处置完全相反。
       趋势取数同样会撞上日额度耗尽，甩一句"稍候 1 分钟重试"会把人引到错误方向。 */
    const m = (e && e.friendly) ? e.friendly
      : e && e.timeout ? "气象接口响应超时（超过 12 秒无响应），请检查网络后重试。"
        : st === 429 ? i18n("气象接口暂时限流（同一 IP 请求过于频繁），请稍候约 1 分钟后重试。")
          : i18n("趋势数据获取失败：{m}", { m: (e && e.message ? e.message : i18n("网络异常")) });
    const tail = (e && e.fatal) ? "<br>" + i18n("额度会在次日重置，之后即可恢复。") : "";
    if (out) out.innerHTML = `<div class="note n-bad">${m}${tail}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = i18n("重新加载趋势"); }
    renderTrend();
  }
}

/* 用已取到的 TREND_DAYS 天数据算出 TREND_DAYS × 2 个格子的 P / Q。
   直接复用 computeAll（注入 bundle 与样带）—— 与单日精细结果同一套物理模型与权重。 */
async function computeTrend() {
  const t = State.trend;
  if (!t) return;
  const rows = [];
  /* 天数取实际窗口（t.n），不是 TREND_DAYS —— 选到靠后日期时窗口会被夹短，
     这里若写常量就会去算一批根本没有数据的日期，白填一行行的"—"。 */
  const nDay = t.n || TREND_DAYS;
  for (let k = 0; k < nDay; k++) {
    const dMs = t.day0 + k * 86400000;
    const ds = ymd(new Date(dMs));
    const row = { date: ds, am: null, pm: null };
    for (const per of ["am", "pm"]) {
      const b = t.b[per];
      if (!b || !b.gfsD) continue;
      try {
        const r = await computeAll(t.lat, t.lon, ds, per, t.name || "该地点", { bundle: b, pts: t.pts[per] });
        row[per] = { P: r.P, Q: r.Q, grade: gradeOf(r.Q), ec: !!r.sE };
      } catch (e) { softWarn("趋势计算 " + ds + "/" + per, e); }
    }
    rows.push(row);
  }
  t.rows = rows;
}

function renderTrend() {
  const box = $("#trendBody");
  if (!box) return;
  const t = State.trend;
  if (!t || !t.rows) {
    box.innerHTML = `<div class="hint">${i18n("点上方按钮加载趋势（最长 {n} 天，具体天数受模式可预报范围限制）—— 一次取数即可比较“哪天值得去”，不用一天天手动切。（会额外发一轮约 {c} 个坐标的请求。）", { n: TREND_DAYS, c: 2 * TREND_N })}</div>`;
    return;
  }
  const cell = (row, per) => {
    const c = row[per];
    const cur = row.date === State.dateStr && State.period === per;
    if (!c) return `<td class="td-cell empty">—</td>`;
    const col = gradeColor(c.grade);
    return `<td class="td-cell${cur ? " on" : ""}" data-date="${row.date}" data-period="${per}"
      role="button" tabindex="0" title="查看 ${row.date} ${per === "am" ? "朝霞" : "晚霞"}">
      <span class="tp" style="color:${col}">${Math.round(c.P)}<i>%</i></span>
      <span class="tq"><i class="chipc" style="background:${col}"></i>${Math.round(c.Q)} 分 · ${c.grade}</span></td>`;
  };
  const body = t.rows.map(row => {
    const isCur = row.date === State.dateStr;
    return `<tr class="${isCur ? "cur" : ""}">
      <td class="td-date">${row.date.slice(5)}${isCur ? "<i>当前</i>" : ""}</td>
      ${cell(row, "am")}${cell(row, "pm")}</tr>`;
  }).join("");
  const miss = [];
  if (!t.ecOK) miss.push("ECMWF-IFS");
  if (!t.aqOK) miss.push("气溶胶");
  const inRange = t.rows.some(r => r.date === State.dateStr);
  box.innerHTML = `<div class="t-scroll"><table class="t-trend">
      <thead><tr><th>${i18n("日期")}</th><th>${i18n("朝霞")}</th><th>${i18n("晚霞")}</th></tr></thead><tbody>${body}</tbody></table></div>
    <div class="hint" style="margin-top:8px">
      ${i18n("区间 {a} ~ {b}；一次取数 {n} 个坐标（朝/晚霞共用），样带方位按 {a} 构造，其余日期有几公里量级的方位偏差；点任意格子可跳到该日期与该时段。", { a: t.sD, b: t.eD, n: 2 * TREND_N })}
      ${inRange ? "" : `<b>${i18n("当前所选日期不在已加载区间内，点「重新加载趋势」更新。")}</b>`}
      ${miss.length ? `<b>${i18n("本次缺少 {v} 数据，相应结论不确定性更高。", { v: miss.join("、") })}</b>` : ""}
    </div>`;
  box.querySelectorAll("td.td-cell[data-date]").forEach(td => {
    const go = () => {
      State.dateStr = td.dataset.date;
      $("#date").value = State.dateStr;
      $("#mapDateSel").value = State.dateStr;
      State.period = td.dataset.period;
      setSegActive("#periodSeg", $("#periodSeg button[data-p='" + State.period + "']"));
      syncUrl();
      renderTrend();
      runForecast(true);
    };
    td.addEventListener("click", go);
    td.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
}
