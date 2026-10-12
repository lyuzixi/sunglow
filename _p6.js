/* =========================================================================
   Part 6：地图模块（腾讯地图 GL JS）
   省级色块 / 热力层 + 悬停与点击查询 + 朝霞晚霞切换 + 日期切换 + 图例
   ========================================================================= */
const MapMod = {
  map: null, ok: false, polys: null, geo: null,
  layer: null, strips: [], field: null, rasterOK: false, host: null,
  data: {}, curDate: null, lastPx: { x: 0, y: 0 }, lbl: null,
  /* 取消"待处理的那一帧悬停"（initMap 里的局部函数挂上来，供全局 showMapTip 调用，
     见该函数中 cancelHover 的定义处注释） */
  cancelHover: null,
  /* 当前被点击"钉住"的位置（{lat, lon} 或 null）。手机端用于"再点一次同一处就收起" */
  pinLL: null,
  /* 上次因"所选算法模型本期无结果"而被强制回退的模型键（null＝没发生回退）。
     用来在提示区给出"已自动切换"的明确说明，而不是静默改选。 */
  modelFallback: null,
  /* 请求令牌：每次 loadMapData 自增。取数是异步的且可能并发（连续切日期/时段），
     先发出的响应可能**后**返回；只有令牌仍等于最新值的响应才允许写数据、画图、关遮罩。
     否则会出现"标签写着新日期、色面画着旧日期"的静默错误。 */
  reqSeq: 0,
  /* 本次色面是否为"陈旧结果"（无可用数值时保留上次色面，显式置灰并说明） */
  stale: false,
  /* 日期键的访问顺序（最近使用在末尾），供 B9 的 LRU 淘汰 */
  dataOrder: [],
  /* 数值直标（F6 第二编码）的当前标签集合 */
  labels: [],
  /* 采样点 / 查询点图钉层（第一批补充）：DOM 叠加，见 renderPins */
  pinLayer: null, pinSig: "", pins: null,
  /* 可信度叠加层：与 strips 同几何的独立画布集合（见 buildConfStrips） */
  confLayer: null, confStrips: null,
  /* 底图压暗层（插在底图与色面之间） */
  dimBaseEl: null,
  /* 日期下拉框里被标为「已就绪 / 已缓存」的选项数（供探针读取） */
  cachedN: 0,
  /* B1 · 数据范围边界线：edgePts ＝ 已投影的凸包顶点数（0 ＝ 没画出来）；
     edgeIn ＝ 落在色面真的有像素处的采样点数（0 ＝ 整圈都被掩膜裁掉 / 全在视野外）。
     两者都供探针读取。 */
  edgePts: 0, edgeIn: 0,
  /* C1 · 经纬网的用户偏好（唯一来源）。与 gratOn 是两件事，**必须分开**（见 setGratUser）：
     gratUser ＝「用户要不要这张网」，gratOn ＝「网此刻真的画出来了没」。 */
  gratUser: true,
  /* 行政区划索引（懒构建，供点击下钻命中省份） */
  provRings: null,
  /* 软失败计数：事件绑定 / SDK 胶水出问题时至少留下痕迹（B10） */
  warnCount: 0,
  /* 排行榜当前渲染的城市序列签名，供 P6 的差量更新判断"是否只需改数值" */
  rankSig: "",
  /* 数值直标（D5）当前按缩放定下的分级条数；0 表示尚未定级 */
  labelMax: 0,
  /* 当前局部网格的采样点（B13）与**网格中心**的坐标签名 —— 签名变了才重建。
     注意键取的是 gridC（网格中心）而不是 State.lat/lon：查询点只挪了一小步时
     网格沿用旧的，两者会短暂不一致，以中心为准才能保证"生成网格的中心"
     与"取数时用的中心"永远是同一个。 */
  pts: null, ptsKey: "", gridC: null,
  /* 地图提示条当前是不是"正在取数"的进度条（见 mapSetLoad）。
     true 时不允许被沿用分支收掉，否则会丢掉进度反馈。 */
  loading: false,
  /* 悬停提示上次写入 DOM 的那段 HTML（内容没变就不重写，见 showMapTip） */
  tipHtml: "",
  /* 提示卡上次实测的高度（M1）：翻转判据要用它，而高度只在**内容变化时**才需要重量 ——
     指针每动一下都调 offsetHeight 会强制同步布局，正是这条路径上最贵的一步。 */
  tipH: 0,
  /* M1 · 事件方位 / 距离环图层（见 drawAzimuthLayer） */
  aziLayer: null, aziSig: "", aziSvg: null,
  /* 当日值域缓存 { d, dim, mk, R }（见 mapRangeOf） */
  rangeCache: null
};
/* 地图取数的时区口径：直接引用全局唯一的 API_TZ（见 _p4.js 的注释与 _check/tzprobe.js 实测）。
   原先这里硬编码 "Asia/Shanghai"，与单点侧的 "auto" 是两个口径 —— 因为取样点全在中国，
   两者数值恰好一致，所以一直没暴露；一旦地图点位扩到境外就会静默算错时间轴。
   收敛为一个常量后，"两侧 timezone 必须统一"这条前置条件由结构保证，而不是靠人记住。 */
const MAP_TZ = API_TZ;
const MAP_AZ_KM = TRANSECT[TRANSECT.length - 1];   // 样带长度（与单点同：0…400 km）
/* 「多远之外不再可信」在下面 FIELD_REACH_KM / FIELD_OUT_KM 两处取值 —— 前者是
   悬停与候选取值半径，后者是色面（凸包）边界。这里原先写着 700，是"值场覆盖全国"
   时代的遗留值：局部化之后能画出来的区域离最近采样点最远也就一百来公里，700 早不可达。 */
const MAP_CACHE_TTL = 3 * 3600000;        // 本地缓存有效期

/* ---- 局部化采样（B13）----
   地图不再覆盖全国，改为"以当前查询点为心、半径 MAP_RADIUS_KM、间距 MAP_GRID_KM"的
   圆内等距网格。两个动机，一个是产品的、一个是额度的：

     · 产品：霞光看的是"我这儿今晚值不值得跑一趟"，答案在几百公里尺度上就定了。
       一张全国图把 2000 km 外的漂亮云系也涂成红色，对用户没有决策价值。
     · 额度：取数按坐标计费（3 路 × 点数），点数与面积成正比。全国固定 152 点下，
       不管用户人在哪都付同一笔账；改成局部后点数随所选半径/间距固定，且一降就是一半以上。

   为什么用等距经纬网格，而不是"附近的城市表"：城市分布本身东密西疏 ——
   按"500 km 内的城市"筛，东部一次能筛出七八十个、西部十几个，额度变得无法预期；
   网格布点则与地理位置无关，每次查询的花费是同一个数，用户和开发者都算得清。

   间距 120 km 是权衡后的取值：采样点间距必须显著小于云系的空间尺度（几百公里），
   否则插值出来的场只是几个孤立圆盘的叠加。它同时决定了色面边界（凸包羽化）与
   离最近采样点的最远距离 —— 后者的上限 ≈ 格心到格点的 0.707 倍间距，见 FIELD_FULL。
   半径 500 km 对应"邻省 + 周边地级市"，恰好是一个周末出行的决策范围。 */
const MAP_RADIUS_KM = 500;                // 局部地图半径（以查询点为中心）
const MAP_GRID_KM = 120;                  // 局部网格间距
/* 查询点挪动多少公里以内，就沿用已有局部网格（不重取）。
   取值 = 一个采样间距：间距本身就是这套数据的分辨率，偏移不超过它时，
   "以新点为中心的场"与"以旧点为中心的场"用的是同一批 120 km 间隔样本、
   同一套 IDW 权重，统计上难以区分。沿用的收益是省掉一整批取数（3 × 点数 ≈ 171
   个加权调用）—— 这是"节省查询次数"这条目标的直接落点；代价只是值场中心
   与查询点相差 ≤120 km，覆盖范围从 380–620 km 而非均匀的 500 km。
   反例（不设这道闸门会怎样）：点一下地图上的"在此处精细查询"、或把上海改成苏州
   （约 80 km），都会把整张图清空并让用户重新付 171 次 —— 开着 #autoMap 时更是
   每次微调经纬度都自动重取。把它调成 0 即退化为"任何移动都整批作废"。 */
const MAP_KEEP_KM = MAP_GRID_KM;
/* 跟随查询时设置的地图缩放。zoom 每 +1 视野减半，zoom 4 约看全国（5000 km 宽），
   所以覆盖 500 km 半径（1000 km 直径）取 zoom 6 上下。 */
const MAP_FOLLOW_ZOOM = 6;

/* v2：点位里多了 p / q（分模型结果）。
   v3（D6）：采样点从 107 增至 152。
   v4（B13）：采样点从"固定 152 个全国城市"改为"随查询点变化的局部网格" ——
   缓存的 pts 数组就是点集本身，而 mapCacheGet 的结构校验只查"有没有 p/q 字段"，
   查不出点集变了，会把"北京周边的点"当成有效缓存喂给"上海周边"的栅格。
   升版本号是让旧缓存自然失效的**唯一**可靠手段。
   注意：仅升版本号还不够 —— 同一版本内换地点仍会串数据，所以键里必须带坐标，
   见 mapKeyOf()。两者是两道独立的闸门，缺一不可。 */
const MAP_CACHE_PREFIX = "sunsetbot.map.v5.";
/* 键族前缀（不含版本号）。用途只有一个但很关键：**升版本时清掉上一版的残留**。
   版本号一升，旧前缀的键就再没人读、也再没人删 —— 它们只是静静占着 localStorage，
   直到 5 MB 写满让新缓存静默失败。这正是硬约束 14 那一类故障（配额被看不见的
   东西吃掉）。所以必须成对定义：FAMILY 是"这一族都算"，PREFIX 是"只有这一版算"。 */
const MAP_CACHE_FAMILY = "sunsetbot.map.";
/* 值场栅格参数 */
/* 渲染分辨率，不是采样密度 —— 采样点仍只有 57 个网格点，两者解耦是"少取数、多插值"
   分工的关键，别把这个数字当成接口调用量。
   D3 时从 0.2° 加密到 0.1°（约 20 → 11 km），代价是格数 ×4；当时是全国版，
   86,010 → 约 34 万格，必须配合权重矩阵的因式分解才扛得住（见 buildGeom）。
   B13 局部化之后栅格只剩约 1 万格，于是又加密一档到 0.05°（约 5.5 km），几乎免费 ——
   而这一档是**分档填色能落地的前提**：档界是一条几何曲线，栅格越粗它越像台阶。
   0.1° 时屏上 4.6 px/格，档界是肉眼可见的锯齿；0.05° 降到 2.3 px，双线性一糊就平了。 */
const FIELD_STEP = 0.05;                  // 栅格分辨率（度，约 5.5 km）
/* 色面边界＝采样点的**凸包** + FIELD_OUT_KM 的羽化（凸包见 buildHull）。
   为什么不沿用"到最近采样点的距离"当边界（原来是 FULL=75 / RANGE=240）：
   那个量在网格**内部**最大只有 82 km（方格格心到最近格点 = 间距 × 0.707），
   而在网格**外**却要一路走到 240 km 才衰减到 0。于是
     · 色面比采样区胖出一整圈 —— 实测栅格 1464×1449 km，而采样网格直径只有 ~1000 km；
     · 边界是 57 个圆盘的并集，带着扇形缺口（放大看是一圈波浪）；
     · 完全透明的格子只占 28.9%，七成色面是半透明的；
     · 为了盖住上面两条，遮罩还得整个模糊 8 格（88 km）—— 于是屏幕上的淡出带宽约 180 px，
       看上去就是糊在底图上的一坨雾。
   凸包把"哪块有数据"讲清楚：包内是插值、包外是外推，而且最多外推 FIELD_OUT_KM。
   边界从此是一条直的折线（模糊半径可以降到 2 格），雾圈随之消失。 */
const FIELD_OUT_KM = 70;                  // 凸包外还画多远（羽化长度）
/* 羽化为什么给到 70 km（而不是 30–40）：凸包实测是 **8 边形**（内角 135.0°、边长交替
   509 / 240 km —— 用 buildHull 的同一算法在 57 个网格点上实算），羽化短了它看上去就是
   一个**硬边的多边形**，比雾圈还假。70 km 摊到屏上约 **46 px**（按实拍图上的经纬网标定：
   纬向 72.0 px/度 ⇒ 1.54 km/px），边界读起来是"覆盖范围到此淡出"而不是"画了个八边形"；
   同时它仍是原雾带（≈180 px）的 1/4。 */
/* 候选点搜索半径。实测（57 点 + 0.05° 栅格）色面内到最近采样点的距离**最大 108.7 km**，
   取 120 留 11.3 km 余量 ⇒ **不存在**"图上有色、悬停却没值"的环带（222,397 个上色格里 0 格越界）。
   （原注释是按"包外 40 km"推的，那是 FIELD_OUT_KM 还是 40 时代的算法；结论不变但推理对不上。） */
const FIELD_REACH_KM = 120;
/* 悬停/取值用"到最近采样点的距离"（`confOf(km)` 的语义就是这个），
   而色面可见性用凸包 + 羽化。两者**不是**同一个判据，所以 showMapTip 里
   另加了一道"像素可见"的闸门 —— 只靠距离会在凸包顶点附近留下一圈
   "图上没有、悬停却报数值"的环带（约束 16 踩过的那个坑）。 */
const MAP_IDW_MAX = FIELD_REACH_KM;       // IDW 的最远可信距离
const TIP_RANGE_KM = FIELD_REACH_KM;      // 悬停取值的最大距离（另有"像素可见"这道闸门）

/* 手机端判定：提示卡在这条路径上改走"贴底通栏"（.tip.dock）而不是跟随指针。
   **断点宽度 760 必须与 tpl/template.html 里那两条 @media (max-width:760px) 一致**
   —— 一个数字写在两个文件里，改一处就会让"JS 以为该贴底、CSS 却仍在居中定位"
   或反过来。窄屏下 tip 有行内 left/top（跟随指针那套留下的），行内优先级高于 CSS，
   必须由 JS 显式清掉，见 showMapTip 末尾。
   判据用 matchMedia 而不是 innerWidth：它跟着**视口**走，而我们要的正是"屏幕窄"
   （容器窄但视口宽的场合，如桌面浏览器拖窄侧栏，卡片仍应跟随指针）。 */
const TIP_DOCK_MQ = window.matchMedia ? window.matchMedia("(max-width:760px)") : null;
function tipDock() { return !!(TIP_DOCK_MQ && TIP_DOCK_MQ.matches); }
/* 「悬停卡里说『插值可信』」的那条距离线：到最近采样点不超过它就报"较高"。
   **它只管悬停卡的文案分级，不管可信度纱的边界** —— 纱的边界是凸包（见 buildConfStrips）。
   这两个量不是一回事：包内也有一半区域离最近点 50 km 以上，那里照样是**插值**；
   而贴着凸包顶点外侧一点 dkm 只有 1.4 km，却已经是**外推**了。
   取 90 的依据是实测：包内 dkm 最大 85.3 km（≈ 格心到最近格点 = 120 × 0.707），
   所以包内恒为"较高 / 高"，只有羽化带里（实测最远 110.5 km）才降到"中"。 */
const FIELD_FULL = 90;
/* 网格点借城市名时，"附近"二字最多能撑到多远。超过它就改报"城市 + 方位 + 距离"。
   取值与提示卡的"落点判定"共用（showMapTip 也用它决定直接用采样点还是走插值）。 */
const CITY_NEAR_KM = 60;
/* 用于「模型分歧」着色维度的三套独立模型。
   这不是新取数 —— 每一点的 p / q 里本来就同时存着 gfs / ec / rt 三套结果
   （见 loadMapData 里 `const p = { ens, gfs, ec, rt }`），ens 只是它们按
   W_ENS 重新归一后的加权几何平均。所以"三套模型之间分歧多大"是完全免费的：
   不增加任何接口调用、不需要新的缓存字段。 */
const DV_MODELS = ["gfs", "ec", "rt"];
/* 模糊半径按"格"计，所以格距再减半时必须同步加倍才能保持同一个物理半径
   （0.05°×2 ≈ 0.1°×1 ≈ 11 km）。原来取 8 格（88 km），因为那时遮罩边界是
   57 个圆盘的并集，必须大模糊才盖得住扇形缺口；换成凸包之后边界是一条折线，
   模糊只剩"给羽化收个边"这一个作用。 */
const FIELD_BLUR = 2;                     // 遮罩模糊半径（格，≈11 km）
const FIELD_OPACITY = 0.9;                // 覆盖层不透明度（保留少量底图信息）
/* 色面分档数。连续色阶在"值域被插值压扁"的场上看不出任何结构 —— 实测中间一半的
   格子只跨 9 分（当日值域 77 分），整片色面落在一条很窄的色段里，看上去就是一坨。
   分档之后档内同色、档间成边，色面立刻变成"几块区域"。这也是等值线与离散色斑
   共用的手法 —— **把连续场变成有边界的东西**。
   **7 是实测定的，不是"看着顺眼"**（第三轮方案 §5.2 的结论）：
     · 相邻档之间只有 **1.13–1.36** 的对比度 —— 也就是说**现在这 7 档已经偏密了**
       （旧注释那句"再多则相邻档颜色太接近"描述的是**已经发生的现状**，不是趋势）。
       档界现在还读得出来，靠的是**等值线**（实线正好压在每条档界上），不是色块之间的色差。
     · 减到 5 档收益很小：只把最低档对白底的对比度从 1.05 提到 1.22，而 1.22 仍远
       低于可辨阈值。**低端分不清不是档数造成的**（根因是浅色底图，见 FIELD_STEP
       与图例那段），减档治不了它 —— 那一段改用"画出数据范围边界"（B1）解决。
   所以保持 7；要动它得同时改 bandGradientCss、图例与 mapaudit 的档位断言。 */
const N_BANDS = 7;
/* 档位取色：地图上第 k 档就是这个颜色。悬停色块、排行榜条形、图例色块一律走它 ——
   否则"图上这一片"与"榜单里那条"会是两个颜色，同一屏自相矛盾。 */
function bandOf(v) { return clamp(Math.floor(clamp(v, 0, 100) / 100 * N_BANDS), 0, N_BANDS - 1); }
function bandColor(mode, v) { return rampColor(mode, (bandOf(v) + 0.5) / N_BANDS * 100); }
/* 图例色条：与 bandColor 逐档同色，用硬停止拼出来（不是渐变）——
   图例上一旦是渐变，用户就会以为地图上也是连续过渡的。 */
function bandGradientCss(deg) {
  const st = [];
  for (let k = 0; k < N_BANDS; k++) {
    const c = rampColor("pm", (k + 0.5) / N_BANDS * 100);
    st.push(c + " " + (k / N_BANDS * 100).toFixed(2) + "% " + ((k + 1) / N_BANDS * 100).toFixed(2) + "%");
  }
  return "linear-gradient(" + (deg == null ? 90 : deg) + "deg," + st.join(",") + ")";
}
const FIELD_BAND_DEG = 4;                 // 纬度条带最大高度（度）
/* 等值线：沿档界描一条细线。
   分档之后档与档之间**本来就有一条边**（相邻档颜色不同），为什么还要画线：
   那条边是"色块碰色块"，在浅色底图上、尤其在低端几档（浅黄→橙）之间对比度很低，
   远看仍然是一团。sunsetbot 的观感主要来自这条线 —— 它把"在这里跨过了一个等级"
   从"颜色变了一点"升级成"一条可以数的线"。
   线色取深暖灰而不是纯黑：纯黑压在满图暖色上太跳；而且「深色底图」会给这一层套反相，
   纯黑反相后是纯白，比色面还亮。alpha 再乘以色面自身的 alpha ⇒ 羽化区里的线跟着淡出，
   不会出现"色面没了、线还浮着"。
   画在独立图层（`.clayer`）而不是色面栅格里：色面像素与数值必须保持**单值映射**
   （zoomprobe 的像素级断言守护的就是这条，见 template 里 .clayer 的注释）。 */
const CONT_RGB = [38, 27, 20];
/* 线宽（CSS 像素）—— **一个常数，与缩放、与栅格分辨率都无关**。
   走到这一步之前试过两代"逐格栅格化"的做法，都不成立：
     · 一格宽的线：线宽 = 判边格子有多大，默认取景 1 格 ≈ 2.3 px ⇒ 是色带不是线；
     · 值场超采样 2 倍：格细到 1.14 px、可见宽 3.32 → 1.64 px，但**线宽仍绑在栅格上**
       ⇒ 放大后同比变粗；而且同样 alpha 下越细越淡，只能靠加 alpha 硬撑。
   真正成立的做法是**在屏幕空间描矢量**：几何（档位边界折线）只算一次、存在**栅格坐标**里，
   每帧 fitRaster 再把顶点投影到容器像素、用固定线宽描边 ⇒ 任何缩放都是 1 px。
   几何用 marching squares 在"档与档之间"（level = k + 0.5）沿格边**线性插值**抽取，
   所以边界位置连续光滑 —— 不会像逐格描边那样带台阶，也不会在斜边上断成虚线。 */
const CONT_PX = 1;
/* 线的峰值不透明度（再 × 所在格的色面 alpha / 255 ⇒ 羽化区里跟着淡出）。
   1 px 的线比原来 2 px 的线少一半墨，峰值要比栅格时代略高才读得出。 */
const CONT_ALPHA = 172;
/* 经纬网间隔（度）。墨卡托下等纬线是水平线、等经线是竖直线，所以它只是一张矩形网格；
   1° 在本项目视口里约十几条，与参照物密度相当 —— 再密会盖过色面，再疏就只剩装饰。 */
const GRAT_DEG = 1;
/* =========================================================================
   D2 · 跨地形插值：高程网格 + 按"高程段"筛选候选点
   -------------------------------------------------------------------------
   IDW 只看水平距离，于是拉萨（3650 m）与成都（500 m）虽然相隔 1250 km 也会互相投票 ——
   但两者的大气状态几乎无关，高原站点会把平原格点的值明显拉偏。物理上正确的做法是
   "跨地形降权"，但连续降权会毁掉权重矩阵的因式分解（见 buildGeom），内存立刻回到 90 MB。
   这里的做法是**把降权换成筛选，并把筛选粒度从"格点"放宽到"高程连续段"**：
     · 每一行按经度方向把相邻的、高程差 < FIELD_HTOL 的列并成一段；
     · 每段只保留"与段代表高程相差 ≤ FIELD_HTOL"的候选点（不足 FIELD_HMIN 个时按高差补足）；
     · 段内的所有列共用这份候选 —— 于是同一段内连续列的 dl 访问落在同一组下标上，
       天然 cache 友好；段数远小于格点数，索引表因此极小。
   效果：东部平缓区整行就是一段，行为与原来一致；青藏高原边缘会碎成若干段，
   高原段只看高原站、平原段只看平原站。高程网格取不到时退化为"全图单段"，即原行为。
   ========================================================================= */
const ELEV_RAW = "/*__ELEV_GRID__*/";
const ELEV_LAT0 = 11.0, ELEV_LON0 = 67.0, ELEV_STEP = 0.5;
const ELEV_NLAT = 95, ELEV_NLON = 149;
const ELEV_SCALE = 50, ELEV_OFFSET = -500;      // 米 = code × 50 − 500（覆盖 −500 … 12250 m）
const FIELD_HTOL = 1500;                        // 候选点与段代表高程的最大容许差（米）
const FIELD_HMIN = 4;                           // 每段至少保留的候选点数

const ELEV = (function () {
  const raw = ELEV_RAW;
  if (!raw || raw.indexOf("__ELEV_GRID__") >= 0 || raw.length < 64) return null;
  try {
    const bin = atob(raw);
    if (bin.length !== ELEV_NLAT * ELEV_NLON) return null;
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return { arr };
  } catch (e) { return null; }
})();
/* 双线性查表。返回米；越界返回 NaN（调用方按"无高程信息"处理）。 */
function elevAt(lat, lon) {
  if (!ELEV) return NaN;
  const fi = (lat - ELEV_LAT0) / ELEV_STEP, fj = (lon - ELEV_LON0) / ELEV_STEP;
  if (!(fi >= 0) || !(fj >= 0) || fi > ELEV_NLAT - 1 || fj > ELEV_NLON - 1) return NaN;
  const i0 = Math.floor(fi), j0 = Math.floor(fj);
  const i1 = Math.min(i0 + 1, ELEV_NLAT - 1), j1 = Math.min(j0 + 1, ELEV_NLON - 1);
  const ti = fi - i0, tj = fj - j0;
  const A = ELEV.arr, W = ELEV_NLON;
  const v00 = A[i0 * W + j0], v01 = A[i0 * W + j1];
  const v10 = A[i1 * W + j0], v11 = A[i1 * W + j1];
  const m = (v00 * (1 - tj) + v01 * tj) * (1 - ti) + (v10 * (1 - tj) + v11 * tj) * ti;
  return m * ELEV_SCALE + ELEV_OFFSET;
}

/* 软失败统一入口：既写控制台（softWarn），也在地图模块内计数（B10）。
   事件绑定、SDK 胶水这类地方出问题时不该中断主流程，但也绝不能完全静默 ——
   "悬停没反应"这种症状如果没有一行日志，排查成本极高。
   计数是为了让自动化测试能断言"本次运行没有发生静默降级"。 */
function mWarn(where, e) { MapMod.warnCount++; softWarn(where, e); }

function mapSetLoad(on, txt) {
  /* 显式记下"提示条当前是不是进度条"。地图确实有数据、但提示条还挂着
     （最现实的路径：某日期的 pm 取数失败留下错误提示条，用户把时段切到数据完好的 am）
     时必须把它收掉 —— 而取数进行中则相反，收掉就等于丢掉进度反馈。
     靠文本内容去猜"是不是进度条"太脆，用一个状态位最省事。 */
  MapMod.loading = !!on;
  const el = $("#mapLoad");
  el.style.display = on ? "flex" : "none";
  el.classList.remove("err");
  if (txt) $("#mapLoadTxt").textContent = txt;
}
/* 取数失败：给出可操作的重试入口，而不是一闪而过的提示 */
function mapShowError(msg, retry) {
  MapMod.loading = false;                 // 失败即不再有进度可报（见 mapSetLoad）
  const el = $("#mapLoad");
  el.style.display = "flex";
  el.classList.add("err");
  $("#mapLoadTxt").innerHTML = msg + (retry
    ? ` <button class="mretry" type="button">重试</button>` : "");
  const b = el.querySelector(".mretry");
  if (b) b.addEventListener("click", () => { mapSetLoad(true, "重新取数…"); loadMapData(true); });
}

/* ---- 局部采样点（B13）----
   以查询点为中心、半径 MAP_RADIUS_KM、间距 MAP_GRID_KM 的圆内等距网格。

   返回项的形状与城市表项**刻意保持一致**（{name, lat, lon, region}）：下游的取值、
   分省聚合、排行榜、悬停提示、下钻全部按这个形状消费（`meta[ci].city.name`、
   `o.region` 这类访问照旧成立），形状一致意味着它们一行都不用改 ——
   这是本次局部化改造能收敛在小范围内的关键。

   name 用最近城市补齐：网格点本身没有地名，但"上海附近"远比"31.00°N 120.85°E"好读。

   **但借名必须把距离说清楚**。旧实现只分两档（<15 km 用城市名、否则一律加"附近"），
   于是这张间距 120 km、半径 500 km 的网格里，出现了大量"XX 市附近"其实在几百公里外
   的情况 —— 实测宁德 541、临沂 561、济宁 499、濮阳 476、温州 368、衢州 357、
   台州 286 km。"附近"暗示几十公里，这是误导；更麻烦的是**重名**：多个网格点借到
   同一个城市（实测吉林省清单里"白山市附近"出现 4 次），排行榜与数值直标会列出
   多行同名不同值。所以改成三档，第三档顺带让名字唯一。
   （改动只在这一个函数里：下游的取值/分省/排行/悬停/下钻全部按 name 字符串消费，
   不解析它的含义，所以换命名格式对它们透明。）
   kmStep 是距离取整的步长，默认 10 km（标签给人读，1 km 级抖动只会让数值直标闪）。
   它留出一个参数口子，是给 buildLocalGrid 的兜底去重用的：8 方位 + 10 km 的
   分辨率在 400 km 处是不够的 —— 一个 45° 扇区在那里有 314 km 弧长，能装下 2.6 个
   网格点，于是会出现两个点都叫"釜山 西南 400 km"（实测上海网格里撞了一次）。
   撞名会让排行榜列出两行同名不同值，所以在点集建好后做一次去重，让后来者退回
   1 km 精度 —— 同一城市、同一方位、10 km 同格的另一条，其原始距离必然不同。 */
function gridName(la, lo, nc, kmStep) {
  if (!nc) return coordName(la, lo);
  const c = nc.city, km = nc.distKm;
  if (km < 15) return c.name;
  if (km < CITY_NEAR_KM) return c.name + "附近";
  /* 8 方位。经度差必须乘 cos(lat) 折算成实际距离，否则高纬度整片会偏向东/西。 */
  const dx = (lo - c.lon) * Math.cos(la * Math.PI / 180), dy = la - c.lat;
  const DIRS = ["东", "东北", "北", "西北", "西", "西南", "南", "东南"];   // 从正东起逆时针
  const ang = Math.atan2(dy, dx) * 180 / Math.PI;
  const dir = DIRS[Math.round(((ang + 360) % 360) / 45) % 8];
  const step = kmStep || 10;
  return c.name + " " + dir + " " + (Math.round(km / step) * step) + " km";
}
function buildLocalGrid(lat, lon) {
  const dLa = MAP_GRID_KM / 110.574;
  const dLo = MAP_GRID_KM / (111.32 * Math.max(0.15, Math.cos(lat * Math.PI / 180)));
  const nSide = Math.floor(MAP_RADIUS_KM / MAP_GRID_KM);
  const out = [], ncs = [];
  for (let i = -nSide; i <= nSide; i++) {
    for (let j = -nSide; j <= nSide; j++) {
      /* 判圆用「公里偏移」而不是「度数偏移」：经度每度对应的实际距离随纬度收缩，
         直接拿 dLa/dLo 比长度会把圆盘压成椭圆，高纬度地区尤其明显
         （在 50°N，同样度数的经度span只有纬度span的 0.64 倍）。 */
      const kx = j * MAP_GRID_KM, ky = i * MAP_GRID_KM;
      if (kx * kx + ky * ky > MAP_RADIUS_KM * MAP_RADIUS_KM + 1e-6) continue;
      const la = clamp(lat + i * dLa, -85, 85);
      const lo = ((lon + j * dLo + 540) % 360) - 180;
      const nc = nearestCity(la, lo, ALL_CITIES);
      ncs.push(nc);
      out.push({
        lat: la, lon: lo,
        name: gridName(la, lo, nc),
        region: nc ? nc.city.region : ""
      });
    }
  }
  /* 兜底去重（详见 gridName 注释）：三档命名在 400 km 量级仍可能撞名，
     撞名的第二点退回 1 km 精度。10 km 档的名字一律以 0 结尾，因此它们
     不可能与某条 1 km 档的兜底名相同 —— 去重不会自己制造新的重名。 */
  const used = Object.create(null);
  out.forEach(function (p, i) {
    if (used[p.name]) p.name = gridName(p.lat, p.lon, ncs[i], 1);
    used[p.name] = 1;
  });
  return out;
}
/* 网格点落在无城市可参照的地方（境外、远海）时的兜底名称 */
function coordName(la, lo) {
  return Math.abs(la).toFixed(1) + "°" + (la >= 0 ? "N" : "S") + " "
    + Math.abs(lo).toFixed(1) + "°" + (lo >= 0 ? "E" : "W");
}
/* 当前局部网格的采样点（带缓存）。换地点才重建 ——
   建一次要跑「点数 × 城市表」次球面距离（57 × 486 ≈ 2.8 万次），
   而它被引导文案、图例、取数三处都要读，不值得每次渲染都重来一遍。
   中心取 MapMod.gridC（见 mapOnPlaceChanged 的 MAP_KEEP_KM）：查询点只挪了一小步时
   网格沿用旧的，此处必须跟着沿用，否则"取数用的点集"会和"界面上展示的点集"分家。 */
function mapPts() {
  const c = MapMod.gridC || { lat: State.lat, lon: State.lon };
  const key = c.lat.toFixed(4) + "," + c.lon.toFixed(4);
  if (MapMod.ptsKey !== key || !MapMod.pts) {
    MapMod.pts = buildLocalGrid(c.lat, c.lon);
    MapMod.ptsKey = key;
    MapMod.gridC = { lat: c.lat, lon: c.lon };
  }
  return MapMod.pts;
}

/* 把视口移到当前查询点（B13）。只在**地点真的变了**时调用 ——
   改日期不该动视口，用户好不容易拖到想看的位置，不该因为切了个日期就被拽回去。 */
function mapFollow() {
  if (!MapMod.ok || !MapMod.map) return;
  try {
    MapMod.map.setCenter(new TMap.LatLng(State.lat, State.lon));
    MapMod.map.setZoom(MAP_FOLLOW_ZOOM);
  } catch (e) { mWarn("视口跟随查询失败", e); }
}

/* 查询地点变了（B13）。分两种情况，判据是"新点离网格中心多远"：

   · 仍在 MAP_KEEP_KM 以内 → **沿用**：数据留着，只把视口挪过去。
     理由：MapMod.data 里存的是"网格上各点在各地日期/时段的取值"，它在物理上
     与"谁当中心"无关；会失效的只有**覆盖面**，而偏移一个采样间距以内时，
     覆盖面依然明显以新点为中心。沿用的收益是省掉一整批取数（3 × 点数）。
     注意这里**不动 reqSeq**：在途请求拿的正是同一个网格的数据，仍然有效。

   · 超出 → 整批作废。这不是"缓存未命中"，是"缓存不适用" —— 局部网格是围绕
     网格中心生成的，北京那 57 个点对上海没有意义，留着只会让用户看到一张
     套错地方的热力图（而且它看起来完全正常，不报错，属于最难发现的那类错误）。
     作废后回到待加载引导，视口跟到新地点，由用户决定何时取数 —— 额度口径与 B11 一致。 */
function mapOnPlaceChanged() {
  const g = MapMod.gridC;
  if (g && mapSet() && MapMod.dataOrder.length) {
    const dd = haversineKm(State.lat, State.lon, g.lat, g.lon);
    if (dd <= MAP_KEEP_KM) {
      /* 值场、条带、标注、排行榜全部照旧 —— 它们描述的是同一个网格。
         只把视口跟到新查询点。顺带收掉残留的待加载/失败提示条：数据明明还在，
         挂着"点击加载周边地图"会让人以为地图已经失效；正在取数时则留着（进度反馈）。 */
      if (!MapMod.loading) mapSetLoad(false);
      mapFollow();
      return;
    }
  }
  MapMod.data = {};
  MapMod.dataOrder = [];
  MapMod.curDate = null;
  MapMod.reqSeq++;                  // 作废在途请求：它的响应属于旧地点
  MapMod.pts = null; MapMod.ptsKey = ""; MapMod.gridC = null;
  MapMod.field = null; MapMod.strips = [];
  MapMod.stale = false; MapMod.rankSig = ""; MapMod.labels = [];
  /* 三个叠加层也要跟着作废，否则旧地点的东西会留在新地点上：
     可信度纱是旧网格的、图钉是旧网格的。pinSig 必须一起清空 ——
     只清 DOM 不清签名，renderPins 会认为"已经画过了"而永远不再重建。 */
  MapMod.confStrips = null;
  MapMod.pinSig = ""; MapMod.pins = null;
  /* 换地点顺手收一遍跨地点缓存（见 mapCacheSweep）：LRU 只在当前地点内按日期淘汰，
     旧地点的键它永远命中不到，不收就会一路涨到配额耗尽。 */
  mapCacheSweep();
  try { if (MapMod.layer) { MapMod.layer.innerHTML = ""; MapMod.layer.classList.remove("on", "stale"); } }
  catch (e) { mWarn("清空色面失败", e); }
  try { if (MapMod.confLayer) { MapMod.confLayer.innerHTML = ""; MapMod.confLayer.classList.remove("on"); } }
  catch (e) { mWarn("清空可信度层失败", e); }
  try { if (MapMod.pinLayer) { MapMod.pinLayer.innerHTML = ""; MapMod.pinLayer.classList.remove("on"); } }
  catch (e) { mWarn("清空图钉层失败", e); }
  try { const lb = $("#mapLabels"); if (lb) { lb.innerHTML = ""; lb.classList.remove("on"); } }
  catch (e) { mWarn("清空标注失败", e); }
  /* 缓存键里带坐标，换地点之后旧地点的条目一律不再是"这个地点可用的缓存"，
     标记必须重算（mapCacheGet 用的就是当前坐标）。 */
  markCachedDates();
  mapFollow();
  /* 作废之后：若**新地点该日期已有缓存**（上次看过）就直接画出来，否则回到待加载引导。
     走的就是首屏那条 autoLoadMapFromCache（内部未命中时会 showMapIdle，
     所以这行完全替代了原来的 `if (MapMod.ok) showMapIdle()`）。
     **只能挂在这个作废分支里**：上面的"沿用"分支地图并没有失效，
     在那里尝试自动加载、且恰好没缓存时，会把一张好图换成"待加载引导"
     （localgrid 的「小幅移动不弹待加载引导」断言正是盯这个）。 */
  autoLoadMapFromCache();
}

/* 地图待加载态（B11）：首屏只取单点结果，地图数据等用户真正要看时再取。
   原因是量级差得太远 —— 一次地图取数 = 点集大小 × 2 套模式 + 气溶胶
   ≈ 3 × 点集大小 个加权调用，而单点查询只要 65 个；Open-Meteo 免费层又是按
   「出口 IP」计的每日 10,000 次，首屏就把地图带上等于把全站每天的开页次数砍到二十次。
   地图取过一次后按「日期 + 坐标」缓存（LRU 3 个日期），同一地点同一天再进来不再消耗额度。
   B13 局部化之后点集本身也小了（152 → 约 57），但**懒加载这条纪律不变**：
   首屏不取地图，与点集大小无关 —— 它是一条"不让任何取数随页面打开自动发生"的规则。 */
function showMapIdle() {
  const el = $("#mapLoad");
  MapMod.loading = false;          // 待加载态不是进度条（见 mapSetLoad 的说明）
  el.style.display = "flex";
  el.classList.remove("err");
  const n = mapPts().length;
  /* 别说成"不占用额度" —— 首屏的单点查询同样要计费，只是比地图那批小一个数量级。
     把两个数摆出来，用户才知道点与不点的差别到底在哪。
     同时报出覆盖半径：用户得知道这张图"看到多远"，才谈得上判断要不要点。 */
  $("#mapLoadTxt").innerHTML = i18n("地图数据尚未加载。一次取周边 {r} km 内的 {n} 个网格点 × 2 套模式 + 气溶胶，约 {c} 个计费调用", { r: MAP_RADIUS_KM, n: n, c: 3 * n })
    + i18n("（首屏只取了单点结果，这部分等你要看时再取）。")
    + (n ? "" : i18n("（当前地点没有生成网格点）"))
    + ' <button class="mretry" type="button">' + i18n("加载周边地图") + '</button>';
  const b = el.querySelector(".mretry");
  if (b) b.addEventListener("click", () => loadMapData(true));
}

/* ---- 已有缓存就自动画出来（零额度）----
   —— 这是硬约束 9「首屏不自动取地图数据」的**有界放宽**，放宽的边界恰好在
   "发不发请求"这条线上：那条纪律的本意是**别让取数随页面打开自动发生**
   （首屏 520 个加权调用里地图占 456 个，等于把全站每天的开页次数砍到二十次），
   而**缓存命中根本不发请求** —— 用户上次看过的城市 + 日期，没有理由每次重开
   都再点一次「加载周边地图」。
   实现上把"能不能取数"整个交给 loadMapData 自己：传 cacheOnly=true，它在两条
   快路径之后、任何网络调用之前直接 return false。所以"自动加载不会烧额度"
   由 loadMapData 里**那一行**硬保证，这里不需要复制一份命中条件去跟它对齐。
   返回 true = 这一次真的画出来了（调用方据此决定要不要显示待加载引导）。 */
async function autoLoadMapFromCache() {
  const drawn = await loadMapData(false, true);
  if (!drawn && MapMod.ok) showMapIdle();
  return drawn;
}

/* 地图代理地址"还没配过"的判据。
   收成一个函数，是因为它有三个使用方，而且占位符形态将来还会增加：
     · initMap 的兜底文案（下面）—— 决定要不要把"其实是部署没配"说清楚；
     · assemble.py 构建期检查注入是否成功（Python 侧同名逻辑）；
     · _check/cdp.js 的部署缺陷探测。
   目前两种形态：开发兜底 `http://127.0.0.1:__WB_HTTP_PORT__/…`（WorkBuddy
   运行时在服务页面时替换它），以及构建时没取到环境变量而原样留下的
   `__TMAP_SERVICE_HOST__`。两者在用户眼里是同一个现象：地图起不来。
   空值也算 —— 没有中转端点就是没配。 */
function isMapProxyPlaceholder(host) {
  return !host || /__WB_|__TMAP_SERVICE_HOST__/.test(String(host));
}

/* M1 · 排行榜每行 → 该处的精细查询。
   用**事件委托**而不是逐行绑定：renderRank 有两条路径（整体重建 / 只改数值），
   而"换地点、换维度、换模型"都会重建 DOM —— 逐行绑定必然在某条路径上丢。
   #rank 本身是静态节点，只在 initMap 里挂一次。
   行为与提示卡的「在此处精细查询」逐字一致：**不自动重取地图**（除非用户勾了
   #autoMap），所以一次点击只花掉一次单点查询的额度，而不是顺手再花一整套网格。 */
function bindRankClicks() {
  const host = $("#rank");
  if (!host || host.__rankBound) return;
  host.__rankBound = true;
  const go = row => {
    if (!row || !row.classList.contains("rr")) return;
    const la = parseFloat(row.dataset.lat), lo = parseFloat(row.dataset.lon);
    if (!isNum(la) || !isNum(lo)) return;
    hideMapTip();
    gotoLatLng(la, lo);
    runForecast(true);
    if ($("#autoMap") && $("#autoMap").checked) loadMapData(false);
  };
  host.addEventListener("click", e => {
    const row = e.target && e.target.closest ? e.target.closest(".rr") : null;
    go(row);
  });
  /* 有 tabindex 就必须配键盘：Enter / Space 等价于点击 */
  host.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    const row = e.target && e.target.closest ? e.target.closest(".rr") : null;
    if (!row) return;
    e.preventDefault();                    // Space 默认会滚动页面
    go(row);
  });
}

async function initMap() {
  const box = $("#map");
  if (!window.TMap) {
    /* 地图起不来有三种完全不同的原因，必须分开说，否则会把用户带错方向：
       ① 脚本被网络/插件拦截 —— 联网后确实会自动恢复；
       ② 代理服务地址仍是占位符 —— 这是**部署**问题，不是网络问题。
          腾讯地图的 key 不能直接写在前端产物里（会被抄走），官方要求由一个服务端
          中转端点代发请求；这个端点的地址由**部署环境在服务页面时注入**。
          所以"把文件下载到本地双击打开"必然失败，"联网会自动恢复"在这里是误导。
          （早期文案写的是"请在本应用预览/分享页里打开" —— 那会把自行部署的用户
          引到错误方向，任何一种部署方式都应该能靠 README 自己配好。）
       ③ 其它未知异常。 */
    let detail = i18n("地图组件未能加载（脚本被拦截或网络不可达）。") + "<br>" + i18n("上方查询功能不依赖地图，仍可正常使用；地图在联网环境下会自动恢复。");
    try {
      const host = (window._TMapSecurityConfig && window._TMapSecurityConfig.serviceHost) || "";
      if (isMapProxyPlaceholder(host)) {
        detail = i18n("地图需要一个把请求转发给腾讯位置服务的<b>中转端点</b>（配置方式见 <code>README.md</code>）。") + "<br>" +
          i18n("当前页面里这个地址仍是<b>未替换的占位符</b>，说明部署时没有配置过 ——") + " " +
          i18n("它由<b>服务这个页面的环节</b>注入，把文件下载到本地直接双击打开不会有这一步。<br>") +
          i18n("上方查询功能不依赖地图，仍可正常使用。");
      }
    } catch (e) { mWarn("读取地图代理配置失败", e); }
    box.innerHTML = `<div class="mapfail">${detail}</div>`;
    mapSetLoad(false);
    return;
  }
  try {
    MapMod.map = new TMap.Map(box, {
      /* 视口起点就是当前查询点（B13）：默认查询是广州市，所以打开页面看到的是
         广州周边那一片，而不是一张缩到能看见全国的地图。
         原先写死 (35.2, 105.0) + zoom 4 是"全国热力图"时代的取值 —— 那时值场
         覆盖整个国土，视口当然要退到能看全；局部化之后值场只有 500 km 半径，
         再退到 zoom 4 只会看到一小块色斑悬在空图中央。 */
      center: new TMap.LatLng(State.lat, State.lon),
      zoom: MAP_FOLLOW_ZOOM,
      pitch: 0,
      viewMode: "2D"
    });
    MapMod.ok = true;
  } catch (e) {
    console.error(e);
    mapSetLoad(false, "地图初始化失败");
    return;
  }
  /* 值场覆盖层：需要 projectToContainer 把地理范围换算成容器像素。
     不使用 TMap.visualization.Heat —— 它是"密度累加"图层（颜色 = clamp(累加值, min, max)，
     官方文档中 max 默认取数据最大值），格点的屏幕间距随缩放变化会让累加和剧烈变化，
     在密网格 + 固定像素半径下必然出现"缩小全图同色、放大颜色消失"。详见 buildField 注释。 */
  try {
    MapMod.rasterOK = typeof MapMod.map.projectToContainer === "function";
  } catch (e) { MapMod.rasterOK = false; }
  if (MapMod.rasterOK) {
    MapMod.host = box;
    if (!mountRaster(box)) MapMod.rasterOK = false;
  }

  /* 省级边界（用于色块降级方案与点击命中） */
  try {
    mapSetLoad(true, "正在载入行政区划…");
    const r = await fetch("https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json");
    MapMod.geo = await r.json();
  } catch (e) {
    console.warn("底图边界数据加载失败", e);
  }
  /* 收掉"正在载入行政区划…"：它只是一句初始化过渡文案。
     少了这一句，MapMod.loading 会一直停在 true —— 后续任何"是不是正在取数"的判断
     都会得到错误答案（典型后果：提示条该收的时候收不掉）。 */
  mapSetLoad(false);
  if (MapMod.geo && !MapMod.rasterOK) buildProvinceLayer();

  /* 数值直标叠加层（F6 第二编码）：与色面栅格无关的一层 DOM，见 renderLabels 注释 */
  mountLabels(box);
  /* 采样点 / 查询点图钉层（第一批补充） */
  mountPins(box);
  /* 可信度叠加层：与色面同几何、但像素完全独立的另一层画布 */
  mountConf(box);
  /* 等值线 + 经纬网层（第 9 批）：同样与色面同几何、像素独立（z-index 在色面之上、纱之下） */
  mountGridLayer(box);
  /* 底图压暗层：必须插在色面层之前，否则会盖住颜色 */
  mountDimBase(box);
  /* M1 · 事件方位线 + 距离环：压在色面之上、数值直标之下（z-index 3） */
  mountAzi(box);

  /* 交互 */
  box.addEventListener("mousemove", e => {
    const r = box.getBoundingClientRect();
    MapMod.lastPx = { x: e.clientX - r.left, y: e.clientY - r.top };
  });
  /* 悬停合并到帧。
     地图的 mousemove 在指针快速划过时一秒能来上百次，而每次都要"就近取点（O(点数)）
     + 拼提示卡"，最后只有一帧的内容会被看到。所以只记下最后一个位置，
     在下一帧统一处理；mouseleave 时把待处理的那一帧一并取消，
     否则它会在提示卡收起之后又把它弹回来。 */
  let hoverRaf = 0, hoverLL = null;
  const cancelHover = () => {
    if (hoverRaf) { cancelAnimationFrame(hoverRaf); hoverRaf = 0; }
    hoverLL = null;
  };
  /* 挂到 MapMod 上：提示卡的关闭按钮在 showMapTip 里绑定，而 showMapTip 是
     **全局函数**、拿不到这里的局部 cancelHover。没有这一步，取消按钮只能
     藏卡片、藏不掉那一帧待处理的悬停 —— 它会在下一帧又把卡片弹回来。 */
  MapMod.cancelHover = cancelHover;
  box.addEventListener("mouseleave", () => {
    cancelHover();
    hideMapTip();
  });

  const onMove = evt => {
    const ll = llFrom(evt);
    if (!ll) return;
    hoverLL = ll;
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      if (hoverLL) showMapTip(hoverLL);
    });
  };
  /* 点击：既要钉住悬停卡（原行为），也要给出"改用什么"的两个出口 ——
     ① 在此处发起单点精细查询；② 下钻该位置所属省份的城市清单（F4）。
     此前点一下只是把提示钉在原地，地图与单点两条链路是割裂的。
     触屏上再加一条**再点一次同一处就收起**：手机上没有 mouseleave，
     卡片钉住后唯一的出路就是自己再点它一下 —— 这是触屏上的通用手势，
     而"点别处"在下面的 document 级监听里处理。 */
  const onPick = ll => {
    const tip = $("#tip");
    if (tipDock() && tip && tip.classList.contains("on")) {
      const p = MapMod.pinLL;
      if (p && Math.abs(p.lat - ll.lat) < 1e-6 && Math.abs(p.lon - ll.lon) < 1e-6) {
        hideMapTip();
        return;
      }
    }
    MapMod.pinLL = { lat: ll.lat, lon: ll.lon };
    showMapTip(ll, true);
    renderDrill(provOf(ll.lat, ll.lon));
  };
  try { MapMod.map.on("mousemove", onMove); } catch (e) { mWarn("绑定 mousemove 失败", e); }
  try { MapMod.map.on("click", ev => { const ll = llFrom(ev); if (ll) onPick(ll); }); } catch (e) { mWarn("绑定 click 失败", e); }

  /* 点地图以外的任何地方 ⇒ 收起卡片。这是 mouseleave 在触屏上的等价物：
     在桌面端 pointer 事件不该影响地图之外的交互，所以只在触屏断点上挂。
     卡片与 .tgo / .tclose 都在 .mapwrap 内，因此这条不会误伤卡片自己的按钮；
     换地点、切日期等重置路径另有各处的 classList.remove("on")，与本条并存。 */
  /* 点地图以外的任何地方 ⇒ 收起卡片。这是 mouseleave 在触屏上的等价物。
     监听**无条件挂载、事件时再判 tipDock()**：若在 init 时求值，窗口跨过 760 px
     之后（平板转竖屏、手机横竖屏切换、桌面拖窄/拉宽）这条就与 onPick 里的
     "再点一次同一处就收起"一起失配了。卡片与 .tgo / .tclose 都在 .mapwrap 内，
     所以这条不会误伤卡片自己的按钮。 */
document.addEventListener("pointerdown", e => {
    if (!tipDock()) return;
    const tip = $("#tip");
    if (!tip || !tip.classList.contains("on")) return;
    if (e.target && e.target.closest && e.target.closest(".mapwrap")) return;
    hideMapTip();
  }, true);

  /* 拖动地图 ⇒ 收起贴底卡片（bottom sheet 惯例：Google Maps 点出地点卡后
     一拖地图卡片就走）。真机反馈"部分时候无法滑动地图"的主因：
     .tip.dock 是 326×302 的通栏（pointer-events:auto），而窄屏地图只有 420 px
     高 —— 卡片开着时下半区起手的一切触摸都被卡片吃掉，感知就是"地图滑不动"。
     实现要点：
     ① **用 touchmove 位移而不是 pointerdown**：pointerdown 时无法区分"点击"
        与"拖动"，若在那里收卡会破坏 onPick 的"再点一次同一处收起"（pointerdown
        先把卡片藏了，click 到来时 pinLL 已清空，同一处会重新弹卡）。
     ② 阈值 12 px：低于它算点击/抖动，不收 —— 三条既有关闭路径一个都不动。
     ③ 起手在卡片内（target.closest("#tip")）不收：那是滚卡片，是卡片自己的事。
     ④ passive + capture：只读不拦截，绝不 preventDefault —— 地图手势仍由
        腾讯地图 SDK 全权处理（#map 的 touch-action:none 保证 move 流完整）。
     ⑤ touchend/touchcancel 清记录，防陈旧状态串场。 */
  let dockSwipe = null;
  document.addEventListener("touchstart", e => {
    dockSwipe = null;
    if (!tipDock()) return;
    const tip = $("#tip");
    if (!tip || !tip.classList.contains("on")) return;
    if (!e.touches || !e.touches.length) return;
    dockSwipe = {
      x: e.touches[0].clientX, y: e.touches[0].clientY,
      inTip: !!(e.target && e.target.closest && e.target.closest("#tip"))
    };
  }, { capture: true, passive: true });
  document.addEventListener("touchmove", e => {
    if (!dockSwipe || dockSwipe.inTip) return;
    if (!e.touches || !e.touches.length) return;
    const t = e.touches[0];
    if (Math.abs(t.clientX - dockSwipe.x) + Math.abs(t.clientY - dockSwipe.y) > 12) {
      dockSwipe = null;
      hideMapTip();
    }
  }, { capture: true, passive: true });
  document.addEventListener("touchend", () => { dockSwipe = null; }, { capture: true, passive: true });
  document.addEventListener("touchcancel", () => { dockSwipe = null; }, { capture: true, passive: true });

  /* 键盘可达路径（F6）：地图交互此前只有鼠标悬停，键盘与触屏用户没有入口。
     方向键移动焦点（按 Shift 加速）、Enter/空格 查看该处数值并下钻。 */
  box.setAttribute("tabindex", "0");
  box.addEventListener("keydown", e => {
    const map = MapMod.map;
    if (!map || typeof map.getCenter !== "function") return;
    let c = null;
    try { c = map.getCenter(); } catch (e2) { c = null; }
    if (!c) return;
    const la = (typeof c.getLat === "function") ? c.getLat() : c.lat;
    const lo = (typeof c.getLng === "function") ? c.getLng() : c.lng;
    if (!isNum(la) || !isNum(lo)) return;
    const step = e.shiftKey ? 4 : 1.2;
    let dLa = 0, dLo = 0;
    if (e.key === "ArrowUp") dLa = step;
    else if (e.key === "ArrowDown") dLa = -step;
    else if (e.key === "ArrowLeft") dLo = -step;
    else if (e.key === "ArrowRight") dLo = step;
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick({ lat: la, lon: lo });
      return;
    } else return;
    e.preventDefault();
    const nLa = clamp(la + dLa, -85, 85), nLo = clamp(lo + dLo, -180, 180);
    try { map.setCenter(new TMap.LatLng(nLa, nLo)); } catch (e2) { mWarn("键盘移动地图失败", e2); }
    scheduleFit();
    showMapTip({ lat: nLa, lon: nLo });
  });

  /* 地图一移动/缩放，覆盖层就要重新贴合（只改 CSS 位置与尺寸，不重算色值） */
  ["bounds_changed", "zoom_changed", "center_changed", "drag", "idle", "tilesloaded",
    "pitch_changed", "rotation_changed"].forEach(ev => {
      try { MapMod.map.on(ev, scheduleFit); } catch (e) { mWarn("绑定 " + ev + " 失败", e); }
    });

  /* 响应式断点切换 / 横竖屏旋转后容器尺寸会变，需通知底图重排画布 */
  if (typeof ResizeObserver === "function") {
    try {
      const ro = new ResizeObserver(() => {
        if (MapMod.map && typeof MapMod.map.resize === "function") {
          try { MapMod.map.resize(); } catch (e) { mWarn("地图 resize 失败", e); }
        }
        scheduleFit();
      });
      ro.observe(box);
      MapMod.ro = ro;
    } catch (e) { mWarn("ResizeObserver 初始化失败", e); }
  } else {
    window.addEventListener("resize", () => {
      if (MapMod.map && typeof MapMod.map.resize === "function") {
        try { MapMod.map.resize(); } catch (e) { mWarn("地图 resize 失败", e); }
      }
      scheduleFit();
    });
  }

  /* M1：排行榜每行 → 该处精细查询（委托绑定，只挂这一次） */
  bindRankClicks();

  /* 展示偏好里有两项依赖地图 DOM（经纬网要 MapMod.gratUser、深色底图要
     MapMod.dimBaseEl），在 initUI 里读偏好时还挂不上 —— 留到这里统一生效。
     必须排在 autoLoadMapFromCache **之前**：它可能立刻画出缓存色面，
     而经纬网/底图应当在那一帧就是用户上次选择的样子，不能先闪一下默认态。 */
  applyMapLayerPrefs();

  /* 首屏：**已有缓存就直接画出来**（零额度），没有缓存才渲染待加载引导。
     原来这里是 mapSetLoad(false) + await loadMapData(false)：一进页面就把地图数据
     取回来 —— 首屏额度从约 520 个加权调用降到约 65（只取单点）就是靠砍掉它，
     地图那 456 个改由用户显式点击触发。现在改走 autoLoadMapFromCache：
     同样**一个请求都不发**，但用户上次看过的城市/日期不必每次重开都再点一次。 */
  autoLoadMapFromCache();
}
function llFrom(evt) {
  if (!evt) return null;
  const l = evt.latLng || evt.latlng;
  if (!l) return null;
  const lat = (typeof l.getLat === "function") ? l.getLat() : l.lat;
  const lon = (typeof l.getLng === "function") ? l.getLng() : l.lng;
  return (isNum(lat) && isNum(lon)) ? { lat, lon } : null;
}

/* ---- 省级色块（降级路径） ----
   色阶统一走 rampColor（白→黄→橙→红）。三处针对方便辨识的调整：
   ① 边界线不用白色 —— 低值省区本身接近白色，白边会完全看不出来，改用中性半透明灰；
   ② "无数据"单独占一个样式 id `sN`（偏冷的灰）：原先它复用了 `s0`，而 `s0` 在下面的
      循环里会被色阶覆盖成"最低值＝白"，于是"无数据"和"数值很低"在图上完全分不出来；
   ③ 色阶档位仍是 s0…s23，供 paintProvince 按数值取档。 */
const PROV_STYLES = (mode) => {
  const EDGE = "rgba(92,102,122,.32)";
  const styles = { sN: new TMap.PolygonStyle({ color: "rgba(212,220,232,.72)", showBorder: true, borderColor: EDGE, borderWidth: 1 }) };
  for (let i = 0; i < 24; i++) {
    const c = rampColor(mode || "pm", 100 * (i / 23));
    styles["s" + i] = new TMap.PolygonStyle({
      color: hexA(c, 0.82), showBorder: true, borderColor: EDGE, borderWidth: 1
    });
  }
  return styles;
};
function buildProvinceLayer() {
  const geoms = [];
  MapMod.provGeoms = [];
  MapMod.geo.features.forEach(f => {
    const p = f.properties || {};
    if (!p.name || !f.geometry) return;      // 无名字要素（九段线等）由底图正确绘制，此处不叠加
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    const rings = [];
    polys.forEach(poly => { if (poly && poly[0] && poly[0].length > 2) rings.push(poly[0]); });
    if (!rings.length) return;
    const paths = rings.map(rr => rr.map(c => new TMap.LatLng(c[1], c[0])));
    MapMod.provGeoms.push({ id: p.name, paths });
    geoms.push({ id: p.name, styleId: "sN", paths });
  });
  MapMod.polys = new TMap.MultiPolygon({ map: MapMod.map, styles: PROV_STYLES("pm"), geometries: geoms });
}
function hexA(h, a) {
  const [r, g, b] = hex2rgb(h);
  return `rgba(${r},${g},${b},${a})`;
}
/* 用省级色块渲染（热力层不可用时的降级方案） */
function paintProvince(byProv, mode, R) {
  const styles = PROV_STYLES(mode);
  const geos = MapMod.provGeoms.map(g => {
    const arr = byProv[g.id];
    let sid = "sN";                       // 无数据 → 专用灰，不与"最低值（白）"混淆
    if (arr && arr.length) {
      const m = arr.reduce((a, b) => a + b, 0) / arr.length;
      sid = "s" + clamp(Math.round(scaleT(m, R.lo, R.hi) * 23), 0, 23);
    }
    return { id: g.id, styleId: sid, paths: g.paths };
  });
  try {
    if (MapMod.polys.setStyles) MapMod.polys.setStyles(styles);
    if (MapMod.polys.setGeometries) MapMod.polys.setGeometries(geos);
    if (!MapMod.polys.setGeometries || !MapMod.polys.setStyles) throw new Error("no setter");
  } catch (e) {
    try { MapMod.polys.setMap(null); } catch (e2) { }
    MapMod.polys = new TMap.MultiPolygon({ map: MapMod.map, styles, geometries: geos });
  }
}

/* ---- 值场覆盖层（自绘栅格） ----
   为什么要自绘、不用 TMap.visualization.Heat：
   Heat 是"密度累加"图层 —— 每个点以固定像素半径做核函数叠加，颜色 = clamp(累加值, min, max)。
   把 0.7° 的规则密网格（约 2000 点）喂进去时，格点的"屏幕像素间距"会随缩放级别成倍变化：
     · 缩小（默认 zoom=4）：0.7° 只有几像素，一个 36px 半径内压着几百个格点，
                          Σcount 远超 max → 每个像素都被 clamp 到最强档 → 整片同色；
     · 放大（zoom≥8）  ：0.7° 已远大于 36px，格点彼此孤立、中间完全没有覆盖，
                         且单点的累加值远达不到 max → 大片空白、颜色淡到看不见。
   我们要表达的是"每个位置的数值"，而不是"点的疏密"，所以改为直接把插值结果画成栅格图，
   再按地理范围贴到地图上。这样颜色只由数值决定，与缩放级别无关。 */

/* 挂载覆盖层容器：插在"底图容器之后、控件之前"，从而位于底图之上、控件之下
   （不依赖 z-index 猜测，控件仍可正常点击） */
function mountRaster(box) {
  const layer = document.createElement("div");
  layer.className = "rlayer";
  layer.id = "mapRaster";
  const kids = Array.prototype.slice.call(box.children);
  const holder = kids.filter(el => el.tagName === "CANVAS" ||
    (el.querySelector && el.querySelector("canvas")))[0];
  if (holder && holder.nextSibling) box.insertBefore(layer, holder.nextSibling);
  else box.appendChild(layer);
  MapMod.layer = layer;
  return true;
}

/* =========================================================================
   F6 · 第二编码：数值直标
   -------------------------------------------------------------------------
   颜色是这个地图唯一的编码，色觉障碍用户实际拿不到任何信息；而"颜色→数值"
   的对应关系也需要读图例才能建立。这里把数值最高的一批城市直接标成数字，
   等于给颜色补一条不依赖色觉的通道。
   它是**纯 DOM 叠加层**，不参与色面栅格 —— 色面依旧只是数值的函数，
   "看图（像素）反查数值"这条被 zoomprobe 像素级断言守护的性质不受影响。
   ========================================================================= */
function numLabelOn() { const c = $("#numLabels"); return !!(c && c.checked); }
function mountLabels(box) {
  const el = document.createElement("div");
  el.className = "mlayer";
  el.id = "mapLabels";
  box.appendChild(el);
  MapMod.lblLayer = el;
}
/* D5 · 标注分级
   -------------------------------------------------------------------------
   原先固定标 12 个，在全国视角下这 12 个标签会挤成一团（尤其长三角、珠三角），
   放大到城市尺度后又明显不够用。改成按缩放分级：一个标签的屏幕占位基本固定
   （约 90×18 px），能同时容纳几个取决于视口面积，而视口面积随 zoom 每级 ×4 ——
   所以条数按级数台阶式放开，而不是线性。
   ========================================================================= */
const LABEL_TIERS = [[5, 8], [7, 16], [9, 28], [99, 48]];
function labelMaxForZoom(z) {
  for (let i = 0; i < LABEL_TIERS.length; i++) if (z < LABEL_TIERS[i][0]) return LABEL_TIERS[i][1];
  return 48;
}
function renderLabels() {
  const box = $("#mapLabels");
  if (!box) return;
  const d = mapSet();
  if (!numLabelOn() || !d) {
    box.innerHTML = ""; box.classList.remove("on");
    MapMod.labels = [];
    return;
  }
  const dim = State.mapDim || "mix", mk = currentModel(d);
  const cap = MapMod.labelMax || labelMaxForZoom(mapZoom());
  const list = d.pts.filter(o => isNum(dimOf(o, dim, mk)))
    .sort((a, b) => dimOf(b, dim, mk) - dimOf(a, dim, mk)).slice(0, cap);
  MapMod.labels = list.map(o => ({ lat: o.lat, lon: o.lon, txt: o.name + " " + Math.round(dimOf(o, dim, mk)) }));
  box.classList.add("on");
  box.innerHTML = MapMod.labels.map(() => `<span class="mlbl"></span>`).join("");
  placeLabels();
}
function mapZoom() {
  const map = MapMod.map;
  if (!map || typeof map.getZoom !== "function") return 4;
  try { const z = map.getZoom(); return isNum(z) ? z : 4; } catch (e) { return 4; }
}
/* 缩放跨过分级台阶时重排标签。放在 fitRaster 里，但只在台阶真的变了时才重建 DOM ——
   地图每次拖动都会触发 fitRaster，无条件重建会让标签一直闪。 */
function syncLabelTier() {
  const want = labelMaxForZoom(mapZoom());
  if (want === MapMod.labelMax) return;
  const had = MapMod.labelMax > 0;
  MapMod.labelMax = want;
  if (had) renderLabels();
}
function placeLabels() {
  const box = $("#mapLabels"), map = MapMod.map;
  if (!box || !map || !box.classList.contains("on")) return;
  if (!MapMod.labels || !MapMod.labels.length || typeof map.projectToContainer !== "function") return;
  const kids = box.children;
  for (let i = 0; i < MapMod.labels.length && i < kids.length; i++) {
    const L = MapMod.labels[i], el = kids[i];
    let p = null;
    try { p = ptOf(map.projectToContainer(new TMap.LatLng(L.lat, L.lon))); } catch (e) { p = null; }
    if (!p) { el.style.display = "none"; continue; }
    el.style.display = "";
    el.textContent = L.txt;
    el.style.transform = "translate(" + p.x.toFixed(1) + "px," + p.y.toFixed(1) + "px)";
  }
}

/* =========================================================================
   第一批补充 · 采样点与查询点图钉
   -------------------------------------------------------------------------
   "颜色和我所在的位置对不上"这个疑问，根因是两个位置此前完全不可见：
   ① 查询点本身 —— 用户一旦拖动过地图，就再也不知道自己刚才查的是哪儿；
   ② 57 个采样点 —— 值场完全由它们插值而来，而 MAP_KEEP_KM 明确允许
      "值场中心与查询点相差最多 120 km"（沿用旧网格时）。这个偏移在界面上
      没有任何提示，用户只会觉得图错了。
   两层都是**纯 DOM 叠加**（用 projectToContainer 定位），不碰色面栅格，
   所以 zoomprobe 的像素级断言不受影响。
   ========================================================================= */
function ptsOn() { const c = $("#showPts"); return !!(c && c.checked); }
function mountPins(box) {
  const el = document.createElement("div");
  el.className = "pinlayer";
  el.id = "mapPins";
  box.appendChild(el);
  MapMod.pinLayer = el;
}
/* 按"勾选状态 + 采样点数 + 值场中心 + 查询点"的签名决定要不要重建 DOM。
   拖动地图时 fitRaster 每帧都会调到这里，而拖动**不会**改变这四个量 ——
   所以正常情况下拖动只走 placePins（改 transform），一个节点都不重建。 */
function renderPins() {
  const box = MapMod.pinLayer;
  if (!box) return;
  const showPts = ptsOn();
  const c = MapMod.gridC || { lat: State.lat, lon: State.lon };
  const offKm = haversineKm(State.lat, State.lon, c.lat, c.lon);
  /* 值场中心与查询点几乎重合时不重复画一个 —— 常态下两者就是同一个位置，
     叠两个图钉只会让人以为有两个不同的东西。有偏移（沿用旧网格）时才显式画出来。 */
  const drift = offKm > 5 ? c : null;
  const all = showPts ? mapPts() : null;
  const sig = (all ? all.length : 0) + "|" + (drift ? 1 : 0)
    + "|" + State.lat.toFixed(4) + "," + State.lon.toFixed(4)
    + "|" + c.lat.toFixed(4) + "," + c.lon.toFixed(4);
  if (sig === MapMod.pinSig) return;
  MapMod.pinSig = sig;
  MapMod.pins = { pts: all || [], drift: drift, offKm: offKm };
  box.innerHTML =
    `<span class="pin q"><i></i><b>查询点</b></span>` +
    (drift ? `<span class="pin c"><i></i><b>值场中心（偏移 ${Math.round(offKm)} km）</b></span>` : "") +
    (all || []).map(() => `<span class="pin s"></span>`).join("");
  box.classList.add("on");
}
function placePins() {
  const box = MapMod.pinLayer, map = MapMod.map;
  if (!box || !map || !MapMod.pins || typeof map.projectToContainer !== "function") return;
  const kids = box.children;
  const put = (el, la, lo) => {
    let p = null;
    try { p = ptOf(map.projectToContainer(new TMap.LatLng(la, lo))); } catch (e) { p = null; }
    if (!p) { el.style.display = "none"; return; }
    el.style.display = "";
    el.style.transform = "translate(" + p.x.toFixed(1) + "px," + p.y.toFixed(1) + "px)";
  };
  let k = 0;
  if (kids[k]) put(kids[k++], State.lat, State.lon);
  if (MapMod.pins.drift && kids[k]) put(kids[k++], MapMod.pins.drift.lat, MapMod.pins.drift.lon);
  const ps = MapMod.pins.pts;
  for (let i = 0; i < ps.length && k < kids.length; i++, k++) put(kids[k], ps[i].lat, ps[i].lon);
}

/* =========================================================================
   F4 · 点击下钻：命中省份 → 列出该省采样点与当前数值
   -------------------------------------------------------------------------
   命中判定用 GeoJSON 的多边形做射线法。这份 GeoJSON 在 initMap 里本来就要取
   （省级色块降级路径与点击命中都用它），这里只是把它复用成一份懒构建的索引，
   不额外发请求。识别不到省份（例如点到境外）时就只保留悬停卡的"精细查询"入口。
   ========================================================================= */
function provRings() {
  if (MapMod.provRings) return MapMod.provRings;
  const out = [];
  try {
    ((MapMod.geo && MapMod.geo.features) || []).forEach(f => {
      const p = f.properties || {};
      if (!p.name || !f.geometry) return;
      const g = f.geometry;
      const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      const rings = [];
      polys.forEach(poly => { if (poly && poly[0] && poly[0].length > 2) rings.push(poly[0]); });
      if (rings.length) out.push({ name: p.name, rings });
    });
  } catch (e) { mWarn("行政区划索引构建失败", e); }
  MapMod.provRings = out;
  return out;
}

/* =========================================================================
   M1 · 事件方位线 + 距离环
   -------------------------------------------------------------------------
   为什么要加：这套模型的核心几何**就是方向** —— 单点与地图的样带都是沿当日
   日出/日落方位量出去的 0…400 km 共 17 点，`o.d` 是这条线上第一处挡光云的边界距离。
   而图面上此前没有任何方向或距离参照（_check/mapaudit.js 段 F 实测 hasRing=false），
   提示卡写着"云边界 425 km"却不说是往哪边量的 —— 而"西边 300 km 那片云会挡光"
   与"东边 300 km 那片云完全无关"是两回事。
   零取数：方位走 **与模型同一条** `sunEvents` + `solarPosition(...).azimuth`，
   落点走同一个 `destPoint`（球面，方位角正北为 0、顺时针）。
   ========================================================================= */
const AZI_RINGS = [100, 200, 300, 400];
/* 当日的朝/晚霞方位（度，正北 0、顺时针）。与 loadMapData 里算 azR/azS 的那两行同源。 */
function azimEventOf(dateS, per, lat, lon) {
  try {
    if (typeof sunEvents !== "function" || typeof solarPosition !== "function") return null;
    const [Y, M, D] = String(dateS).split("-").map(Number);
    if (!isNum(Y) || !isNum(M) || !isNum(D)) return null;
    const ev = sunEvents(Date.UTC(Y, M - 1, D), lat, lon);
    if (!ev) return null;
    const ms0 = per === "am" ? ev.riseMs : ev.setMs;
    const ms = (ms0 == null) ? ev.noonMs + 12 * 3600000 : ms0;   // 极昼/极夜兜底，同 loadMapData
    const az = solarPosition(ms, lat, lon).azimuth;
    return isNum(az) ? ((az % 360) + 360) % 360 : null;
  } catch (e) { return null; }
}
/* 起点 → 终点的方位角（度，正北 0、顺时针）。经度差乘 cos(lat) 折算成实际距离 ——
   与 gridName 里那份 8 方位取词同一个道理（那边的角是"从正东起逆时针"，
   差一个 90° 与旋向，取到的词是一样的），所以别在这里再写一遍三角函数之外的近似。 */
function bearingOf(lat1, lon1, lat2, lon2) {
  const la = (lat1 + lat2) / 2 * Math.PI / 180;
  const dx = (lon2 - lon1) * Math.cos(la), dy = lat2 - lat1;
  return ((Math.atan2(dx, dy) * 180 / Math.PI) % 360 + 360) % 360;
}
const DIRS_BRG = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
function dirWordOf(brg) { return DIRS_BRG[Math.round(((brg % 360) + 360) % 360 / 45) % 8]; }
function mountAzi(box) {
  const el = document.createElement("div");
  el.className = "azilayer";
  el.id = "mapAzi";
  box.appendChild(el);
  MapMod.aziLayer = el;
}
/* 只在"图面已经画出来"时显示：它的作用是给当前色面一个方向与距离的参照，
   待加载状态下显示反而是噪声。 */
function drawAzimuthLayer() {
  const layer = MapMod.aziLayer, map = MapMod.map;
  if (!layer) return;
  const d = mapSet();
  if (!d || !map || typeof map.projectToContainer !== "function") {
    layer.classList.remove("on"); MapMod.aziSig = ""; return;
  }
  const per = d.period || State.mapPeriod || "pm";
  const az = azimEventOf(d.dateS, per, State.lat, State.lon);
  if (!isNum(az)) { layer.classList.remove("on"); MapMod.aziSig = ""; return; }
  const P = (la, lo) => {
    try { return ptOf(map.projectToContainer(new TMap.LatLng(la, lo))); } catch (e) { return null; }
  };
  const c = P(State.lat, State.lon);
  if (!c) { layer.classList.remove("on"); MapMod.aziSig = ""; return; }
  /* 每环 24 个顶点（15° 一档）：400 km 环上的最大弦高 ≈ 400×(1−cos7.5°) ≈ 3.4 km，
     换算到屏幕约 2 px，已经低于 1.5 px 的线宽，所以画出来是光滑的。
     直接用投影后的真实点连折线，不用"屏幕空间画圆"那种近似。 */
  let sig = d.dateS + "|" + per + "|" + az.toFixed(2) + "|" + State.lat.toFixed(4)
    + "|" + State.lon.toFixed(4) + "|" + Math.round(c.x) + "," + Math.round(c.y) + "|";
  const paths = [];
  for (const R of AZI_RINGS) {
    const pts = [];
    for (let i = 0; i < 24; i++) {
      const t = destPoint(State.lat, State.lon, az + i * 15, R);
      const q = P(t.lat, t.lon);
      if (!q) { pts.length = 0; break; }
      pts.push(Math.round(q.x) + "," + Math.round(q.y));
    }
    if (!pts.length) continue;
    sig += R + ":" + pts.join(";") + "|";
    paths.push({ R, d: "M" + pts.join(" L") + " Z" });
  }
  const tip = P(destPoint(State.lat, State.lon, az, AZI_RINGS[AZI_RINGS.length - 1]).lat,
    destPoint(State.lat, State.lon, az, AZI_RINGS[AZI_RINGS.length - 1]).lon);
  layer.classList.add("on");
  /* 位置没变就一个 DOM 都不碰 —— fitRaster 会被 tilesloaded 这类事件反复触发，
     而绝大多数帧里几何其实没变。 */
  if (sig === MapMod.aziSig) return;
  MapMod.aziSig = sig;
  let svg = MapMod.aziSvg;
  if (!svg || svg.parentNode !== layer) {
    layer.innerHTML = "";
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.position = "absolute";
    svg.style.left = "0"; svg.style.top = "0";
    svg.style.pointerEvents = "none";
    layer.appendChild(svg);
    MapMod.aziSvg = svg;
  }
  const line = (x1, y1, x2, y2, dash, w, col) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${w}"` +
    ` stroke-dasharray="${dash}" vector-effect="non-scaling-stroke"/>`;
  let inner = "";
  for (const p of paths) {
    inner += `<path d="${p.d}" fill="none" stroke="rgba(120,132,150,.5)" stroke-width="1"`
      + ` stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>`;
  }
  if (tip) {
    inner += line(c.x, c.y, tip.x, tip.y, "6 4", 1.6, "rgba(192,122,16,.9)");
  }
  /* 距离刻度标在**方位线**与每环的交点上：那才是"这条线上 200 km 处"的位置，
     标在圆周别处反而会让人以为自己要沿着圆周量。 */
  for (const p of paths) {
    const t = P(destPoint(State.lat, State.lon, az, p.R).lat, destPoint(State.lat, State.lon, az, p.R).lon);
    if (!t) continue;
    inner += `<text x="${Math.round(t.x + 6)}" y="${Math.round(t.y - 4)}" fill="#6b7486"` +
      ` font-size="10.5" font-family="ui-monospace,Menlo,Consolas,monospace">${p.R} km</text>`;
  }
  if (tip) {
    /* 方位词要按**该时段**取：朝霞看东、晚霞看西，同一个地点两条线差 180° 左右。
       不写这两个字，用户很容易忘了自己看的是朝还是晚。 */
    const hd = (per === "am" ? "朝霞方位 " : "晚霞方位 ") + dirWordOf(az) + " " + Math.round(az) + "°";
    inner += `<text x="${Math.round(tip.x + 8)}" y="${Math.round(tip.y + 14)}" fill="#8a5306"` +
      ` font-size="11" font-weight="700">${hd}</text>`;
  }
  svg.innerHTML = inner;
}

/* =========================================================================
   经纬网（第 9 批）
   -------------------------------------------------------------------------
   墨卡托（也正是本项目的 viewMode:"2D" + pitch:0）下，**等纬线是水平直线、
   等经线是竖直直线**，所以经纬网本质上只是一张正规矩形网格 —— 不需要画折线。
   关键点：**不去猜投影公式**。联调环境用的是等距圆柱（纬度方向线性）、真机是墨卡托
   （纬度方向非线性），两者的纵向伸缩完全不同；只依赖 projectToContainer 的**单调性**
   （y 随纬度递减、x 随经度递增），对容器四条边各做一次二分求出对应经纬度，
   再对区间内的整数度逐条精确投影。两套投影下都成立，换 SDK 也不用改。
   ========================================================================= */
function visLonLat() {
  const map = MapMod.map, host = MapMod.host;
  if (!map || !host || typeof map.projectToContainer !== "function") return null;
  const W = host.clientWidth || 0, H = host.clientHeight || 0;
  if (!(W > 0) || !(H > 0)) return null;
  const px = (la, lo) => {
    try {
      const p = ptOf(map.projectToContainer(new TMap.LatLng(la, lo)));
      return (p && isFinite(p.x) && isFinite(p.y)) ? p : null;
    } catch (e) { return null; }
  };
  const cla = State.lat, clo = State.lon;
  if (!px(cla, clo)) return null;
  const yAt = la => { const p = px(la, clo); return p ? p.y : NaN; };
  const xAt = lo => { const p = px(cla, lo); return p ? p.x : NaN; };
  /* f 单调不减；目标值落在区间外就夹到端点（视口跑到极区/跨日界线时仍然可用） */
  const bisect = (f, a0, b0, target) => {
    let a = a0, b = b0, fa = f(a), fb = f(b);
    if (!(isFinite(fa) && isFinite(fb))) return null;
    if (target <= fa) return a;
    if (target >= fb) return b;
    for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (f(m) < target) a = m; else b = m; }
    return (a + b) / 2;
  };
  const la1 = bisect(la => -yAt(la), -85, 85, 0);          // 顶边（y=0）；取负把 y 翻成递增
  const la0 = bisect(la => -yAt(la), -85, 85, -H);         // 底边（y=H）
  const lo0 = bisect(xAt, -180, 180, 0);
  const lo1 = bisect(xAt, -180, 180, W);
  if (la1 == null || la0 == null || lo0 == null || lo1 == null) return null;
  if (!(la1 > la0) || !(lo1 > lo0)) return null;
  return { la0, la1, lo0, lo1, W, H, px, cla, clo };
}
function gratLatLab(la) { return la === 0 ? "0°" : Math.abs(la) + "°" + (la > 0 ? "N" : "S"); }
function gratLonLab(lo) { return lo === 0 ? "0°" : Math.abs(lo) + "°" + (lo > 0 ? "E" : "W"); }
function drawGraticule() {
  const layer = MapMod.gridLayer;
  if (!layer) return;
  /* 与方位环同一口径：图面还没画出来时不加这层参照，否则是一屏噪声。
     C1 之后这里多一道**用户开关**（`#showGrid` / `MapMod.gratUser`）——
     `gratOn` 只表示"网真的画出来了"，用户偏好另存一位，两者都满足才继续。
     两件事必须分开：`drawGraticule` 会在图面就绪时把 `gratOn` 置回 true，
     若只加一个开关（把 gratUser 直接写进 gratOn），用户关掉会被下一次
     fitRaster 静默打开，而 `gridOn()` 还会误判 `.clayer` 的可见性。 */
  const vb = (MapMod.gratUser && mapSet()) ? visLonLat() : null;
  if (!vb) {
    /* 关掉时**必须显式隐藏 svg**：`.clayer` 的 .on 语义是"等值线或经纬网有其一的显示"，
       等值线还在的时候整层不会被关掉，光靠 gratOn 是盖不住那张网的。 */
    if (MapMod.gridSvg) MapMod.gridSvg.style.display = "none";
    if (MapMod.gratOn) { MapMod.gratOn = false; MapMod.gratSig = ""; refreshGrid(); }
    return;
  }
  const { la0, la1, lo0, lo1, W, H, px, cla, clo } = vb;
  /* 位置没变就一个 DOM 都不碰 —— fitRaster 会被 tilesloaded 这类事件反复触发 */
  const sig = [la0, la1, lo0, lo1, W, H].map(v => (typeof v === "number" ? v.toFixed(3) : v)).join("|");
  if (!MapMod.gratOn) { MapMod.gratOn = true; refreshGrid(); }
  if (sig === MapMod.gratSig) return;
  MapMod.gratSig = sig;
  let svg = MapMod.gridSvg;
  if (!svg || svg.parentNode !== layer) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.position = "absolute";
    svg.style.left = "0"; svg.style.top = "0";
    svg.style.pointerEvents = "none";
    layer.appendChild(svg);
    MapMod.gridSvg = svg;
  }
  svg.style.display = "";                 // 关掉时被置成 none，重新打开要恢复
  const FONT = "ui-monospace,Menlo,Consolas,monospace";
  const STROKE = "rgba(107,116,134,.34)";
  const FILL = "rgba(107,116,134,.78)";
  let inner = "";
  /* 落在整像素**中心**（+0.5）：1px 线压在半像素上会被浏览器糊成 2px 灰带 */
  for (let la = Math.ceil(la0 / GRAT_DEG) * GRAT_DEG; la <= la1 + 1e-9; la += GRAT_DEG) {
    const p = px(la, clo); if (!p) continue;
    const y = Math.round(p.y) + 0.5;
    inner += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${STROKE}" stroke-width="1"/>`;
    inner += `<text x="4" y="${(y - 3).toFixed(1)}" font-size="9.5" font-family="${FONT}" fill="${FILL}">`
      + gratLatLab(Math.round(la)) + `</text>`;
  }
  for (let lo = Math.ceil(lo0 / GRAT_DEG) * GRAT_DEG; lo <= lo1 + 1e-9; lo += GRAT_DEG) {
    const p = px(cla, lo); if (!p) continue;
    const x = Math.round(p.x) + 0.5;
    inner += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${STROKE}" stroke-width="1"/>`;
    inner += `<text x="${(x + 3).toFixed(1)}" y="11" font-size="9.5" font-family="${FONT}" fill="${FILL}">`
      + gratLonLab(Math.round(lo)) + `</text>`;
  }
  svg.innerHTML = inner;
}

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
  }
  return inside;
}
function provOf(lat, lon) {
  const list = provRings();
  for (const p of list) {
    for (const r of p.rings) if (inRing(lon, lat, r)) return p.name;
  }
  return null;
}
const DIM_TXT = { p: "出现概率", q: "观赏质量", mix: "综合指数", dv: "模型分歧" };
/* 维度名的显示层：DIM_TXT 存中文键（它同时也是数据口径的标识），展示时才过 i18n */
function dimText(d) { return i18n(DIM_TXT[d] || DIM_TXT.mix); }
function renderDrill(provName) {
  const box = $("#drill");
  if (!box) return;
  if (!provName) { box.classList.remove("on"); box.innerHTML = ""; return; }
  const d = mapSet();
  const dim = State.mapDim || "mix", mk = currentModel(d);
  const rows = d ? d.pts.filter(o => o.prov === provName) : [];
  /* "应有"数量的口径随点集走（B13）：旧实现读 MAP_CITIES，局部化后必须读当前网格，
     否则会拿全国 152 城市的省份分布去解释一张只有 57 个点的局部图。 */
  const total = mapPts().filter(c => c.region === provName).length;
  const html = rows.length
    ? rows.map(o => {
      const v = dimOf(o, dim, mk);
      const g = isNum(o.Q) ? o.Q : v;
      const gr = isNum(g) ? gradeOf(g) : "—";
      return `<button class="dcity" type="button" data-lat="${o.lat}" data-lon="${o.lon}"
          data-nm="${esc(o.name)}" data-rg="${esc(o.prov)}">
        <span class="dn">${esc(o.name)}</span>
        <span class="dv">${isNum(v) ? Math.round(v) : "—"}</span>
        <span class="grade g-${gr}">${gr}</span></button>`;
    }).join("")
    : `<div class="hint">${i18n("该省在当前周边 {n} 个网格点里没有落点", { n: mapPts().length })}${total ? "" : i18n("（采样点未覆盖）")}。</div>`;
  /* 分歧维度下"当前用的哪个模型"是无意义的（它度量的就是模型之间），
     照抄模型名会读成"这是多模型综合的分歧"。 */
  const dsub = i18n("{n} 个采样点 · 当前口径 {dim}", { n: rows.length, dim: dimText(dim) }) +
    (dim === "dv" ? i18n("（与所选模型无关）") : ` · ${mk === "ens" ? i18n("多模型综合") : modelName(mk)}`);
  box.innerHTML = `<div class="dhead"><b>${esc(provName)}</b>
      <span class="dsub">${dsub}</span>
      <button class="dx" type="button" aria-label="${i18n("收起")}">${i18n("收起")}</button></div>
    <div class="dlist">${html}</div>
    <div class="hint" style="margin-top:6px">${i18n("点城市可发起该点的单点精细查询（含 400 km 样带与光追模型）。")}</div>`;
  box.classList.add("on");
  const x = box.querySelector(".dx");
  if (x) x.addEventListener("click", () => { box.classList.remove("on"); box.innerHTML = ""; });
  box.querySelectorAll("button.dcity").forEach(b => b.addEventListener("click", () => {
    setLocation(parseFloat(b.dataset.lat), parseFloat(b.dataset.lon), b.dataset.nm, b.dataset.rg);
    runForecast(true);
  }));
}

/* =========================================================================
   B9 · 日期键的 LRU 上限
   -------------------------------------------------------------------------
   MapMod.data 原本只增不减：每个日期键约 145 K 字符（152 城市 × 2 时段 × 9 个变量
   的分模型结果；_check/cachesize.js 实测 145,406 字符 / 152,482 字节 UTF-8 ——
   107 城市时为 102,550 字符，采样点加密后再增约 42%），
   反复切 10 个日期就常驻约 1.5 M 字符 —— 手机上这是实打实的压力。
   这里做最简单的 LRU：最多保留 MAP_DATA_MAX 个日期键，最近使用者在末尾，
   且**正在显示的那个日期永不淘汰**（否则切回来又要重新取数，反而更慢）。
   localStorage 同步按同一上限清理（它另有 5 MB 的硬配额）。

   B13 补充：上面的 LRU 只按**日期**计数，而局部化之后 localStorage 的键多了一维
   坐标（mapKeyOf = 前缀 + 日期 + "@lat,lon"）。于是出现了 LRU 管不到的一类条目：
   换地点以后，旧地点的键再也没人删 —— mapDataTouch 用 mapKeyOf(old) 拼的是**当前**
   坐标，根本命中不到它们。用户每走一个地方就留下最多 3 条（实测 57,083 字符/条），
   单向增长到 5 MB 配额耗尽，之后写缓存开始静默失败（只留一行 mWarn）。
   所以这里再补一道**跨地点**的总闸门 mapCacheSweep()：按写入时间保留最近
   MAP_CACHE_MAX 条，当前地点的一条都不删。
   ========================================================================= */
const MAP_DATA_MAX = 3;
/* 总条目上限。取 2 个地点 × MAP_DATA_MAX 个日期：既给"返回上一个地点"留了命中机会
   （这正是键里带坐标的收益），又只有约 6 × 57 K ≈ 0.35 MB —— 即便同源下还有别的
   localStorage 占用，离 5 MB 配额也还很远。 */
const MAP_CACHE_MAX = 6;
/* =========================================================================
   单点结果缓存（B1）
   -------------------------------------------------------------------------
   与地图那套刻意对称：版本号闸门 + 坐标/日期/时段键 + TTL + 同一道总闸门。
   补它的理由：地图有完整的持久化缓存，单点却**一点都没有** —— `State.cache`
   只是内存（见 _p5.js 的 computeAll），刷新页面就没了。于是"刷新一下看看有没有
   更新"这种最自然的动作，每次都要重新花 65 个加权调用。

   存的是**原始 API 响应**（{gfsD, ecD, aqD}），不是算好的结果：
     · 它本来就是 JSON.parse 出来的，序列化必然无损。算好的结果里有没有
       非普通对象（TypedArray 之类）需要另行验证，bundle 不需要验证；
     · 计算本身不花额度、只花几毫秒，所以命中后重算一遍是零成本的 ——
       于是将来调权重/阈值不必强制作废旧缓存。

   **必须与硬约束 13 同等对待**：样带几何（TRANSECT、事件方位算法）一变就等于
   "请求形状"变了，旧缓存里存的就成了**按旧坐标取回的响应**，命中后会得到一份
   位置不对的数据，而且界面上看不出任何异常 ⇒ **必须升 POINT_CACHE_PREFIX**。
   ========================================================================= */
const POINT_CACHE_PREFIX = "sunsetbot.point.v1.";
/* 与 MAP_CACHE_FAMILY 同义：POINT_CACHE_PREFIX 必须以其开头。
   升版本时靠它把 v1 的残留整个清掉（见 dropStalePrefixFamily）。 */
const POINT_CACHE_FAMILY = "sunsetbot.point.";
const POINT_CACHE_TTL = MAP_CACHE_TTL;
/* 条目上限。一份 bundle（17 坐标 × 3 天 × 三路响应）明显比地图那条大 ——
   地图是 57 坐标 × 1 天 × 单路结果，实测约 57 K 字符。所以条数取得少一些，
   刚好覆盖"今天/明天 × 朝/晚"这四种最常见组合。 */
const POINT_CACHE_MAX = 4;
/* =========================================================================
   日期下拉框的「已缓存」标记
   -------------------------------------------------------------------------
   切日期本来就是零取数的（内存里命中 MapMod.data，或 localStorage 命中），
   但在此之前用户看不到哪些日期是免费的 —— 下拉框里 18 个选项长得一模一样，
   想知道"这个日期切过去要不要等 30 秒取数"，只能试。
   标记分两级，因为它们的时间代价确实不同：
     「已就绪」＝内存里就有，切过去是同步重绘；
     「已缓存」 ＝只在 localStorage 里，切过去要读盘 + 校验（仍不取数）。
   标注写在 option 的 textContent 上而不是 value 上，`sel.value` 不受影响。
   ========================================================================= */
function cachedTag(dateS) {
  if (MapMod.data[dateS] && MapMod.data[dateS].am && MapMod.data[dateS].pm) return i18n("已就绪");
  const c = mapCacheGet(dateS);
  return (c && c.am && c.pm) ? i18n("已缓存") : "";
}
function markCachedDates() {
  const sel = $("#mapDateSel");
  if (!sel) return 0;
  let n = 0;
  for (const o of sel.options) {
    /* base 在建选项时存进 dataset —— （今天）/（明天）那套文案只该有一处定义 */
    const base = o.dataset.base || o.value;
    const tag = cachedTag(o.value);
    if (tag) n++;
    o.textContent = tag ? base + " · " + tag : base;
  }
  MapMod.cachedN = n;
  return n;
}
/* 淘汰一个键族：保留最近 max 条。
   键的末尾必须是 "@lat,lon" —— 这个位置约定是"这条缓存属不属于当前地点"的
   唯一判据，所以地图键、单点键与趋势键都把它放在最后（前两者把日期放在最前，
   单点把 period 放在中间）。

   keepMine 决定"当前地点的条目"是不是免死金牌，**三个键族必须按各自的实际情况取**：
     · 地图（true）—— 地图另有一条"当前地点内按日期淘汰"的 LRU（mapDataTouch，
       上限 MAP_DATA_MAX=3），内存与磁盘同时受它约束，所以这里豁免当前地点是安全的，
       而且能保证"切回上一个日期"不用重新取数。_check/localgrid.js ⑦ 也断言了
       当前地点的 2 条必须活下来。
     · 单点（false）—— **单点没有任何别的淘汰机制**。若豁免当前地点，一个用户
       在同一城市里翻 18 个日期 × 2 个时段就是 36 条，实测每条约 754 K 字符
       （_check/pointcache.js，3 天 × 17 坐标 × 三路响应），那就是 27 MB ——
       配额会在几秒内写满，之后所有缓存静默失效。所以这里必须真淘汰，
       只靠 ts 排序保证"刚写进去的那条最后才轮到"。
     · 趋势（false）—— 理由同单点：趋势也没有别处的淘汰机制。但它比单点轻得多
       （存的是**算好的 rows**，约 1 KB，不是原始响应，见 TREND_CACHE_PREFIX），
       所以上限给 3 条就够，且真的淘汰也不会带来什么损失。
   keep 是"无论如何都不删"的那些键，由写入者把自己传进来，把上面那句话
   从"排序上的巧合"变成一条显式保证。接受字符串或数组 —— 三个键族各写各的，
   一次 sweep 里可能同时要保住好几种键。 */
function sweepPrefix(prefix, max, keepMine, keep) {
  const own = "@" + State.lat.toFixed(1) + "," + State.lon.toFixed(1);
  const kept = keep == null ? [] : (Array.isArray(keep) ? keep : [keep]);
  const items = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || k.indexOf(prefix) !== 0) continue;
    let ts = 0;
    try { const v = JSON.parse(localStorage.getItem(k) || "null"); ts = (v && v.ts) || 0; }
    catch (e) { ts = 0; }
    items.push({ k, ts, mine: k.slice(-own.length) === own });
  }
  if (items.length <= max) return;
  /* 先非当前地点（旧→新），再当前地点（旧→新）—— 即"能腾的先生腾"，
     而最近写的总排在最后。 */
  items.sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || (a.ts - b.ts));
  let n = items.length;
  for (const it of items) {
    if (n <= max) break;
    if (kept.indexOf(it.k) >= 0) continue;
    if (keepMine && it.mine) continue;
    localStorage.removeItem(it.k);
    n--;
  }
}
/* 清掉同一键族里**不属于当前版本**的残留。
   不加这一条的话，每次升版本号都会留下最多 max 条永远读不到、也永远删不掉的
   条目 —— 它们只在配额账上存在。判据取"同族但前缀不同"，而不是写死旧版本号：
   写死的话每升一次版本就得回来改这里一处，迟早漏掉。 */
function dropStalePrefixFamily(family, keep) {
  const dead = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.indexOf(family) === 0 && k.indexOf(keep) !== 0) dead.push(k);
  }
  for (const k of dead) { try { localStorage.removeItem(k); } catch (e) { /* 配额/隐私模式，忽略 */ } }
  return dead.length;
}
/* 缓存总闸门。名字保持 mapCacheSweep 不变（_check/localgrid.js ⑦ 直接调它并断言
   行为），但它现在管**三个键族**：地图、单点结果、趋势结果。
   后两者共用同一个 localStorage 配额，任一方涨满都会让另一方静默失败 ——
   所以必须收口在同一处，而不是各写一套淘汰逻辑（那正是硬约束 14 的由来：
   只按日期计数的 LRU 管不到跨地点的条目）。
   三个键族的豁免策略**故意不同**（见 sweepPrefix 的 keepMine）：
   地图 true / 单点 false / 趋势 false。
   keep：写入者可以把"我刚写的那条"传进来（字符串或数组）。
   不传也没关系 —— 严格淘汰时最新写的排在最后，本来就会活下来；
   传进来只是把这条从"排序上的巧合"变成显式保证
   （例如写入后用户立刻换了地点，那条就不再算"当前地点"了）。 */
function mapCacheSweep(keep) {
  try {
    dropStalePrefixFamily(MAP_CACHE_FAMILY, MAP_CACHE_PREFIX);
    dropStalePrefixFamily(POINT_CACHE_FAMILY, POINT_CACHE_PREFIX);
    dropStalePrefixFamily(TREND_CACHE_FAMILY, TREND_CACHE_PREFIX);
    sweepPrefix(MAP_CACHE_PREFIX, MAP_CACHE_MAX, true, null);
    sweepPrefix(POINT_CACHE_PREFIX, POINT_CACHE_MAX, false, keep || null);
    sweepPrefix(TREND_CACHE_PREFIX, TREND_CACHE_MAX, false, keep || null);
  } catch (e) { mWarn("清理缓存失败", e); }
}
function mapDataTouch(dateS) {
  const ord = MapMod.dataOrder;
  const i = ord.indexOf(dateS);
  if (i >= 0) ord.splice(i, 1);
  ord.push(dateS);
  let guard = 0;
  while (ord.length > MAP_DATA_MAX && guard++ < 64) {
    const old = ord[0];
    if (old === MapMod.curDate) { ord.shift(); ord.push(old); continue; }
    ord.shift();
    delete MapMod.data[old];
    /* 淘汰时用 mapKeyOf 而不是拼前缀：键里那一维坐标取自当前 State，
       而内存里的数据必然都属于当前地点（换地点会整体作废，见 mapOnPlaceChanged），
       所以这样删掉的正是这条日期对应的那份缓存。 */
    try { localStorage.removeItem(mapKeyOf(old)); } catch (e) { /* 配额/隐私模式，忽略 */ }
  }
}

/* 可分离盒式模糊（O(n)，只用于遮罩通道）。
   工作缓冲提到模块级复用：栅格尺寸在同一份几何里恒定，每次重建都新分配
   一个 cols×rows 的 Float32Array 纯属给 GC 添乱。 */
let blurTmp = null;
function boxBlur(a, cols, rows, K) {
  if (K < 1) return a;
  const w = 2 * K + 1;
  if (!blurTmp || blurTmp.length !== cols * rows) blurTmp = new Float32Array(cols * rows);
  const tmp = blurTmp;
  const cl = v => (v < 0 ? 0 : (v >= cols ? cols - 1 : v));
  const rl = v => (v < 0 ? 0 : (v >= rows ? rows - 1 : v));
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    let s = 0;
    for (let c = -K; c <= K; c++) s += a[base + cl(c)];
    for (let c = 0; c < cols; c++) {
      tmp[base + c] = s / w;
      s += a[base + cl(c + K + 1)] - a[base + cl(c - K)];
    }
  }
  for (let c = 0; c < cols; c++) {
    let s = 0;
    for (let r = -K; r <= K; r++) s += tmp[rl(r) * cols + c];
    for (let r = 0; r < rows; r++) {
      a[r * cols + c] = s / w;
      s += tmp[rl(r + K + 1) * cols + c] - tmp[rl(r - K) * cols + c];
    }
  }
  return a;
}

/* ---------------------------------------------------------------------------
   值场：几何层 / 取值层分离（P1）
   IDW 的几何量（每个格点命中的采样点、各自的权重、最小距离、遮罩）只取决于
   "参与插值的采样点坐标集合 + 栅格规格"，与算法模型、着色维度**完全无关**。
   注意点集本身在 B13 局部化之后**不再是编译期常量** —— 它随查询地点变化，
   栅格范围也随之收缩。所以这里不能假设"一份几何用到底"：geomSig 把参与点的
   坐标编进签名，换地点必然改签名，旧几何自动弃用并重建。
   同一地点内，切模型、切维度、切日期、切时段仍命中同一份缓存；
   只有"某模型整批无数据"导致参与点集合变化时才会重建。

     buildGeom(pts, ok)        几何层：CSR 稀疏权重 + 每格 sw/aMin/exact（一次算好）
     evalField(g, cv, lut)     取值层：纯加权求和 + 查表，无三角函数、无分支

   两条与旧实现严格对齐的约束（保证像素级输出逐位不变）：
     ① 行内候选按城市下标升序保存，取值层的加权求和顺序与旧的单层循环完全一致
        —— 浮点加法不满足结合律，顺序一变最低位就变；
     ② aMin / exact 的取值语义与旧代码逐字对应（含 a<1e-9 时"取第一个命中点"）。
   D3 起权重矩阵改为**因式分解存储**（不再物化 CSR），内存从 72 MB 降到约 1 MB，
   算式与运算顺序不变、结果逐位一致 —— 详见 buildGeom 内的说明。
--------------------------------------------------------------------------- */
const GEOM_CACHE = { sig: "", geom: null, built: 0, reused: 0 };

/* =========================================================================
   D4 · 海陆掩膜：把色面裁到国境线以内
   -------------------------------------------------------------------------
   全国版时代采样点全在中国境内，而遮罩是个纯圆盘 ——
   蒙古、俄罗斯、东南亚、印度洋都会被"外推"出颜色，那些地方既没有样本，
   也不在这份预报的适用范围内。这里直接复用 initMap 里本来就要取的那份省级
   GeoJSON（零额外请求、零额外体积）栅格化成掩膜位图。

   B13 局部化之后这条前提只在**查询点位于中国境内**时成立（见 cnMaskOn）：
   网格是规则布点，境外的网格点同样是真实样本，不该被中国省界裁掉。
   算法：**逐省单独扫描线**，而不是把所有省的点混在一起排序取交点 ——
   相邻省共享边界时同一条边会被两个省各贡献一次，混在一起会让偶奇配对错位、整行花掉。
   每省内部（外环 + 湖岛内环）用偶奇规则是自洽的，各省之间取并集即可。
   成本：只扫"该省 bbox 覆盖到的行"，实测约 2~3 M 次判断 → 一次性几十毫秒。
   只作用于 alpha 通道，**不动 RGB** —— "像素颜色 ↔ 数值"这条单值映射必须保住。
   GeoJSON 取不到时返回 null，自动退化为"不裁剪"，其余功能不受影响。
   ========================================================================= */
let LAND_CACHE = { sig: "", mask: null };
/* 近海放宽的半径（M1）。省界位图只有**中国陆域**，所以它把全部海域一并裁掉 ——
   而海域是这个模型的主战场：MAP_AZ_KM=400 的样带本来就沿朝/晚霞方位量出去，
   沿海城市的答案几乎一定在近海。实测（_check/mapaudit.js 段 D）被裁比例：
   三亚 86%、上海 58%、丹东 54%、大连 47%，而排行榜只看"有没有值"、不看可见性，
   于是出现"榜上有名、图上无影"（三亚榜前 8 全部不可见）。
   这里把"国界以内"放宽成"国界外 KEEP 以内"，境外陆域照旧裁掉。
   300 km 是相对**采样网格**取的：网格最外圈离岸最远也就两三百公里，
   留一档余量即可 —— 再大就等于把中国省界这层判据整个废掉。 */
const MASK_KEEP_KM = 300;
/* 是否应用「中国省界」掩膜（B13）。判据是**查询点**是否落在中国境内，
   用真实省界多边形判断（provOf），而不是经纬度包围盒 ——
   包围盒会把首尔、乌兰巴托这类邻近首都也算成"境内"，而那些地方套上掩膜后
   整张图同样会被裁成空白，正是这里要避免的错误。
   GeoJSON 尚未就绪时返回 false（不裁）：宁可多显示一片，也不要误裁成空白。 */
function cnMaskOn() {
  try {
    if (typeof provOf !== "function") return false;
    return !!provOf(State.lat, State.lon);
  } catch (e) { return false; }
}
function buildLandMask(rows, cols, laN, loW, dLa, dLo) {
  const geo = MapMod.geo;
  if (!geo || !geo.features || !geo.features.length) return null;
  /* KEEP_KM 进签名：掩膜是编译期常量，同一会话内不会失效，但把它写进签名是
     零成本的保险 —— 将来若把它做成可调项，不加就会读到上一版的掩膜。 */
  const sig = [rows, cols, laN.toFixed(5), loW.toFixed(5), dLa, dLo, MASK_KEEP_KM].join("|");
  if (LAND_CACHE.sig === sig) return LAND_CACHE.mask;

  const out = new Uint8Array(rows * cols);
  let hit = 0;
  const xs = [];
  geo.features.forEach(f => {
    const p = f.properties || {};
    if (!p.name || !f.geometry) return;                 // 九段线等无名要素交给底图
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    const rings = [];
    let laMin = 90, laMax = -90;
    polys.forEach(poly => {
      for (let ri = 0; ri < poly.length; ri++) {
        const rr = poly[ri];
        if (!rr || rr.length < 3) continue;
        rings.push(rr);
        for (let k = 0; k < rr.length; k++) {
          const y = rr[k][1];
          if (y < laMin) laMin = y;
          if (y > laMax) laMax = y;
        }
      }
    });
    if (!rings.length) return;
    let r0 = Math.floor((laN - laMax) / dLa), r1 = Math.ceil((laN - laMin) / dLa);
    if (r1 < 0 || r0 > rows - 1) return;
    if (r0 < 0) r0 = 0;
    if (r1 > rows - 1) r1 = rows - 1;
    for (let r = r0; r <= r1; r++) {
      const lat = laN - r * dLa;
      xs.length = 0;
      for (let n = 0; n < rings.length; n++) {
        const rr = rings[n];
        for (let j = rr.length - 1, k = 0; k < rr.length; j = k++) {
          const yj = rr[j][1], yk = rr[k][1];
          if ((yj > lat) === (yk > lat)) continue;
          const xj = rr[j][0], xk = rr[k][0];
          xs.push(xj + (lat - yj) / (yk - yj) * (xk - xj));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      const o0 = r * cols;
      for (let n = 0; n + 1 < xs.length; n += 2) {
        let c0 = Math.ceil((xs[n] - loW) / dLo - 0.5);
        let c1 = Math.floor((xs[n + 1] - loW) / dLo - 0.5);
        if (c1 < 0 || c0 > cols - 1) continue;
        if (c0 < 0) c0 = 0;
        if (c1 > cols - 1) c1 = cols - 1;
        for (let c = c0; c <= c1; c++) if (!out[o0 + c]) { out[o0 + c] = 1; hit++; }
      }
    }
  });
  if (!hit) return null;
  /* M1 · 近海放宽：把"国界以内"扩到"国界外 MASK_KEEP_KM 以内"。
     可分离定距膨胀 —— 先纬度方向（像素步长恒定），再经度方向
     （窗口按 cos(lat) 折算，否则高纬横向会鼓出一大块）。
     成本 O(rows·cols·窗宽)：139×131 的栅格、窗宽 ~55 ⇒ 约 100 万次比较，
     与上面那段扫描线同量级，仍是一次性几十毫秒。
     两端"取窗口时先夹到 [0, rows-1]"：位图外一律视为"无陆"，不会绕回来误扩。 */
  const kh = Math.max(1, Math.round(MASK_KEEP_KM / (dLa * 110.574)));
  const pass1 = new Uint8Array(rows * cols);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const r0 = r - kh < 0 ? 0 : r - kh;
      const r1 = r + kh > rows - 1 ? rows - 1 : r + kh;
      for (let k = r0; k <= r1; k++) {
        if (out[k * cols + c]) { pass1[r * cols + c] = 1; break; }
      }
    }
  }
  for (let r = 0; r < rows; r++) {
    /* 该行的纬度：r=0 是最北一行（与 evalField 的行序一致） */
    const lat = laN - r * dLa;
    const kw = Math.max(1, Math.round(MASK_KEEP_KM / (dLo * 111.32 * Math.max(0.2, Math.cos(lat * Math.PI / 180)))));
    for (let c = 0; c < cols; c++) {
      const c0 = c - kw < 0 ? 0 : c - kw;
      const c1 = c + kw > cols - 1 ? cols - 1 : c + kw;
      for (let k = c0; k <= c1; k++) {
        if (pass1[r * cols + k]) { out[r * cols + c] = 1; break; }
      }
    }
  }
  LAND_CACHE = { sig, mask: out };
  return out;
}

/* 几何签名：只由"哪些点参与 + 它们的坐标"决定。用 FNV-1a 压成一个 32 位整数。 */
function geomSig(pts, ok) {
  let h = 2166136261;
  for (let i = 0; i < pts.length; i++) {
    if (!ok[i]) continue;
    h = ((h ^ i) * 16777619) >>> 0;
    h = ((h ^ Math.round(pts[i].lat * 1e4)) * 16777619) >>> 0;
    h = ((h ^ Math.round(pts[i].lon * 1e4)) * 16777619) >>> 0;
  }
  return pts.length + ":" + h;
}

/* =========================================================================
   色面边界：采样点的凸包（单调链），外加一段羽化
   -------------------------------------------------------------------------
   返回 { olat, olon, kx, edges }：
     · olat/olon 是局部等距投影的原点（取采样点均值），kx = 111.32·cos(olat)
       —— 投影后的单位就是公里，所以凸包到格点的距离可以直接当公里用；
     · edges 是 Float64Array，每三个一组 (a, b, c)，法向 (a,b) 已归一化，
       取的是**外**法向，约定 `a·x + b·y + c ≤ 0` 表示包内。
       于是格点"在包外多少公里"＝ max over edges —— 一个 max，没有开方。
   点数 ≤ 57，O(n log n) 单调链绰绰有余；它只在几何重建时跑一次
   （换地点、或某次取数缺了一批点），与"每次换模型/维度都重算"的取值层无关。
   ========================================================================= */
function buildHull(pts, ok) {
  let sLat = 0, sLon = 0, m = 0;
  for (let i = 0; i < pts.length; i++) if (ok[i]) { sLat += pts[i].lat; sLon += pts[i].lon; m++; }
  if (m < 3) return null;
  const olat = sLat / m, olon = sLon / m;
  const kx = 111.32 * Math.max(0.15, Math.cos(olat * Math.PI / 180));
  const P = [];
  for (let i = 0; i < pts.length; i++) if (ok[i]) {
    P.push({ x: (pts[i].lon - olon) * kx, y: (pts[i].lat - olat) * 110.574 });
  }
  P.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const p of P) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));     // 逆时针
  if (hull.length < 3) return null;
  const edges = new Float64Array(hull.length * 3);
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1;
    /* 逆时针 ⇒ 内侧在行进方向左边 ⇒ 外法向 = (dy, -dx)/L */
    const nx = dy / L, ny = -dx / L;
    edges[i * 3] = nx; edges[i * 3 + 1] = ny;
    edges[i * 3 + 2] = -(nx * a.x + ny * a.y);
  }
  /* 顶点经纬度：B1 的「数据范围边界线」要把它投影到容器像素（见 drawContours）。
     这里存**经纬度**而不是 km —— 投影只能走地图 SDK，而它只吃 LatLng。 */
  const latlng = new Float64Array(hull.length * 2);
  for (let i = 0; i < hull.length; i++) {
    latlng[i * 2] = olat + hull[i].y / 110.574;
    latlng[i * 2 + 1] = olon + hull[i].x / kx;
  }
  return { olat, olon, kx, edges, latlng };
}

function buildGeom(pts, ok) {
  const n = pts.length;
  let laMin = 90, laMax = -90, loMin = 180, loMax = -180, cnt = 0, fallback = -1;
  for (let i = 0; i < n; i++) {
    if (!ok[i]) continue;
    const p = pts[i];
    if (fallback < 0) fallback = i;
    cnt++;
    if (p.lat < laMin) laMin = p.lat;
    if (p.lat > laMax) laMax = p.lat;
    if (p.lon < loMin) loMin = p.lon;
    if (p.lon > loMax) loMax = p.lon;
  }
  if (!cnt) return null;
  /* 栅格外扩＝羽化长度：色面最远只画到凸包外 FIELD_OUT_KM，栅格再大也只是白算。
     （原来按 FIELD_RANGE=240 外扩，栅格 1464×1449 km，而采样网格直径只有 ~1000 km。） */
  const mLa = FIELD_OUT_KM / 110.574;                                 // 纬度外扩（度）
  const mLo = FIELD_OUT_KM / (111.32 * Math.max(0.15, Math.cos(laMax * Math.PI / 180)));
  const laN = laMax + mLa, laS = laMin - mLa;                          // 北/南外沿
  const loW = loMin - mLo, loE = loMax + mLo;
  const dLa = FIELD_STEP, dLo = FIELD_STEP;
  const rows = Math.max(2, Math.round((laN - laS) / dLa) + 1);
  const cols = Math.max(2, Math.round((loE - loW) / dLo) + 1);

  const D2R = Math.PI / 180;
  const win = FIELD_REACH_KM / 110.574 + 0.15;                        // 纬度预剪枝窗口（度）
  const ccos = new Float64Array(n);
  for (let i = 0; i < n; i++) ccos[i] = Math.cos(pts[i].lat * D2R);

  /* 每行的候选城市：只在这里做一次纬度窗口筛选。
     旧实现把这次筛选放在"格点 × 全部城市"的最内层（当时 0.2° 栅格、107 城），
     86,010 格 × 107 城 = 9.2e6 次比较里只有 2.3e6 次真正进入内层计算 —— 4 倍无用功全在这里。 */
  const rowOff = new Int32Array(rows + 1);
  const candList = [];
  for (let r = 0; r < rows; r++) {
    const la = laN - r * dLa;
    rowOff[r] = candList.length;
    for (let i = 0; i < n; i++) {
      if (!ok[i]) continue;
      const dy = la - pts[i].lat;
      if (dy > win || dy < -win) continue;
      candList.push(i);
    }
  }
  rowOff[rows] = candList.length;
  const cand = Int32Array.from(candList);

  /* 每行的列经度（与旧实现的 lo = loW + c*dLo 逐位一致，只是提到循环外算一次） */
  const los = new Float64Array(cols);
  for (let c = 0; c < cols; c++) los[c] = loW + c * dLo;

  /* 色面边界用的凸包，以及每列的投影 X（公里）。取值层每个格点只要算一次
     max over edges —— 包内为负、包外为正（正数就是"在包外多少公里"）。 */
  const hull = buildHull(pts, ok);
  const hx = new Float64Array(cols);
  if (hull) for (let c = 0; c < cols; c++) hx[c] = (los[c] - hull.olon) * hull.kx;

  /* ---- 权重矩阵：因式分解存储（D3）+ 按高程段筛候选（D2） ----
     球面距离平方的等比值 a = dr² + cosLa·ccos[i]·dl²，按"依赖谁"拆成三项：
         a0(r,i) = dr·dr                只依赖 行 × 点
         b0(r,i) = cosLa·ccos[i]        只依赖 行 × 点
         dl(i,c) = (los[c]-clo_i)·D2R   只依赖 点 × 列（与行无关！）
     a = a0 + b0·dl·dl —— 算式、运算顺序、结合方式与原实现逐字相同，浮点结果逐位一致
     （用 40 万随机样本比对过 IEEE-754 字节，0 差异）。存储量从
         Σ_行(候选数) × 列数 ≈ 1.6e4 × 732 ≈ 1.2e7 项 → Float64 约 91 MB
     降到
         rows×点数×2 + 点数×列数 ≈ 1.4e5 + 1.1e5 ≈ 2.5e5 项 → 约 2 MB
     本质原因：原实现把 (行,点,列) 三元组的完整外积物化成了二维数组，而它只有三项。
     （这也顺带否掉了"改 Float32 省内存"那条路 —— 那会带来 ~1e-7 的相对误差、
     约 2–3 个格点的色阶档位漂一级，破坏逐位回归基线；因式分解既省得更多又不损精度。）
     D2 的高程筛选让"每段候选不同"成为可能，代价是 topA/topB 从"按行候选序号 k 索引"
     改成"按 (行, 点下标) 索引"，多花约 1 MB，换来跨地形不再互相污染。 */
  const topA = new Float64Array(rows * n);                            // a0(r,i)
  const topB = new Float64Array(rows * n);                            // b0(r,i)
  for (let r = 0; r < rows; r++) {
    const la = laN - r * dLa;
    const cosLa = Math.cos(la * D2R);
    const abase = r * n;
    for (let i = 0; i < n; i++) {
      if (!ok[i]) continue;
      const dy = la - pts[i].lat;
      const dr = dy * D2R;
      topA[abase + i] = dr * dr;
      topB[abase + i] = cosLa * ccos[i];
    }
  }
  /* dlT 按 (列, 点) 转置存放：取值层内层循环固定列、遍历段内候选点，
     这样同一列上连续的点下标落在同一段连续内存里，一个 cache line 能装 8 个下标；
     若按 (点, 列) 存放，同一列不同点之间要跨 cols×8 字节，每个候选一次 cache miss。 */
  const dlT = new Float64Array(cols * n);
  for (let c = 0; c < cols; c++) {
    const base = c * n, lc = los[c];
    for (let i = 0; i < n; i++) dlT[base + i] = (lc - pts[i].lon) * D2R;
  }

  /* ---- D2：按"高程连续段"筛选候选 ---- */
  const hPt = new Float64Array(n);
  for (let i = 0; i < n; i++) hPt[i] = elevAt(pts[i].lat, pts[i].lon);
  const cellSeg = new Int32Array(rows * cols);
  const segOffA = [0], segCandA = [];
  const hRow = new Float64Array(cols);
  const tmp = [];
  for (let r = 0; r < rows; r++) {
    const la = laN - r * dLa;
    const k0 = rowOff[r], kEnd = rowOff[r + 1];
    if (kEnd === k0) continue;
    const o0 = r * cols;
    if (ELEV) for (let c = 0; c < cols; c++) hRow[c] = elevAt(la, loW + c * dLo);
    let c0 = 0;
    while (c0 < cols) {
      let c1 = c0;
      if (ELEV && isNum(hRow[c0])) {
        const h0 = hRow[c0];
        while (c1 + 1 < cols && isNum(hRow[c1 + 1]) &&
          Math.abs(hRow[c1 + 1] - h0) < FIELD_HTOL) c1++;
      } else {
        c1 = cols - 1;                        // 无高程信息 → 整行一段，退化为原行为
      }
      const hMid = (ELEV && isNum(hRow[c0])) ? hRow[(c0 + c1) >> 1] : NaN;
      tmp.length = 0;
      for (let k = k0; k < kEnd; k++) {
        const i = cand[k];
        tmp.push({ i: i, dh: isNum(hMid) ? Math.abs(hPt[i] - hMid) : 0 });
      }
      let keep = isNum(hMid) ? tmp.filter(x => x.dh <= FIELD_HTOL) : tmp;
      if (isNum(hMid) && keep.length < FIELD_HMIN) {
        const rest = tmp.filter(x => x.dh > FIELD_HTOL)
          .sort((x, y) => x.dh - y.dh || x.i - y.i);
        keep = keep.concat(rest.slice(0, FIELD_HMIN - keep.length));
      }
      /* 按城市下标升序写入 → 加权求和的浮点顺序仍是确定的（与原实现同一约定） */
      keep.sort((x, y) => x.i - y.i);
      const sg = segOffA.length - 1;
      for (let t = 0; t < keep.length; t++) segCandA.push(keep[t].i);
      segOffA.push(segCandA.length);
      for (let c = c0; c <= c1; c++) cellSeg[o0 + c] = sg;
      c0 = c1 + 1;
    }
  }
  const segOff = Int32Array.from(segOffA);
  const segCand = Int32Array.from(segCandA);

  /* aMin / exact 逐格点算（每段候选集不同，不能再按行共享）。
     sw（权重和）不在这里存 —— 取值层逐格点遍历时顺手累加，省一个 rows×cols 的 Float64。 */
  const aMin = new Float32Array(rows * cols);
  const exact = new Int16Array(rows * cols);
  aMin.fill(1e9);
  exact.fill(-1);
  for (let r = 0; r < rows; r++) {
    const o0 = r * cols, abase = r * n;
    for (let c = 0; c < cols; c++) {
      const o = o0 + c;
      const sg = cellSeg[o];
      const e0 = segOff[sg], e1 = segOff[sg + 1];
      if (e1 === e0) continue;
      const dbase = c * n;
      let am = 1e9, ex = -1;
      for (let e = e0; e < e1; e++) {
        const i = segCand[e];
        const d = dlT[dbase + i];
        const a = topA[abase + i] + topB[abase + i] * d * d;
        if (a < am) am = a;
        if (a < 1e-9 && ex < 0) ex = i;
      }
      aMin[o] = am;
      exact[o] = ex;
    }
  }

  /* 海陆掩膜（D4）：尺寸与栅格绑定，所以和几何一起构建、一起缓存，
     避免每次换日期都重算一遍扫描线。
     B13 局部化后这里多了一道前提判断：D4 原本假设"采样点全在中国境内，
     境外区域必然是无样本外推"，于是拿省界把境外一刀裁掉。
     但局部化后网格是**规则布点**，落在境外的点同样是真实采样 ——
     查询东京时若仍套用中国省界掩膜，整张图会被裁成空白（最坏情况下用户
     看到的是"没有数据"，而其实数据好好的，只是被自己的掩膜抹掉了）。
     所以只在查询点位于中国境内时才应用掩膜：那时"裁掉境外外推区"的初衷仍成立；
     查询境外时返回 null，evalField 里的 `land ? ... : al` 会自动跳过。 */
  const land = cnMaskOn() ? buildLandMask(rows, cols, laN, loW, dLa, dLo) : null;

  return {
    cols, rows, dLa, dLo, laN, loW,
    la1: laN + dLa / 2, la0: laN - (rows - 0.5) * dLa,
    lo0: loW - dLo / 2, lo1: loW + (cols - 0.5) * dLo,
    hud: hull, hx,
    cellSeg, segOff, segCand, topA, topB, dlT, aMin, exact, land, fallback, n
  };
}

/* 取值层：只做"加权求和 + 查表"。cv[i] 按**原 pts 下标**索引（几何层保存的就是下标）。 */
function evalField(g, cv, lut) {
  const { cols, rows, n, cellSeg, segOff, segCand, topA, topB, dlT, aMin, exact, land } = g;
  const img = new Uint8ClampedArray(cols * rows * 4);
  const vals = new Float32Array(cols * rows);
  /* 遮罩缓冲只在本函数内部使用、尺寸与几何绑定，所以可以挂在几何上复用 */
  if (!g._mask || g._mask.length !== cols * rows) g._mask = new Float32Array(cols * rows);
  const mask = g._mask;
  mask.fill(0);
  /* 档位数组：等值线只需要"这一格是第几档"，不需要值本身。
     -1 ＝ 该格不在色面范围内（凸包外太远 / 被掩膜裁掉），等值线沿它断开。 */
  const bnd = new Int8Array(cols * rows);
  bnd.fill(-1);
  vals.fill(NaN);                                                     // NaN＝该格无数据（不上色）
  /* 色面边界＝凸包外 FIELD_OUT_KM。格点"在包外多少公里"只要对每条凸包边算一次
     内积再取 max —— 这就是取代原来 `aCut`（到最近采样点距离）的那道闸门。
     原来的判据在网格外要一路放到 240 km，色面因此比采样区胖出整整一圈。 */
  const hud = g.hud, hx = g.hx, H = hud ? hud.edges : null;
  const aCut = Math.pow(FIELD_REACH_KM / 6371.0088, 2);               // 仅凸包退化时的兜底
  const fb = cv[g.fallback];                                          // 对应旧实现的 cv[0]
  /* 行序：canvas 第 0 行在最上方，所以从北往南逐行。
     与改造前的差别：候选集改成"每段一份"（D2），列之间不再共享，
     所以内层由"行内一次遍历 + 共享 sw"变成"逐格点遍历 + 就地累加 sw"。
     逐格点的求和顺序仍是段内城市下标升序 —— 浮点结果是确定的、可复现的。 */
  for (let r = 0; r < rows; r++) {
    const o0 = r * cols, abase = r * n;
    const Y = H ? ((g.laN - r * g.dLa) - hud.olat) * 110.574 : 0;     // 该行的投影 Y（公里）
    for (let c = 0; c < cols; c++) {
      const o = o0 + c;
      let sd = 0;
      if (H) {
        const X = hx[c];
        sd = -1e9;
        for (let k = 0; k < H.length; k += 3) {
          const d = H[k] * X + H[k + 1] * Y + H[k + 2];
          if (d > sd) sd = d;
        }
        if (sd > FIELD_OUT_KM) continue;                              // 凸包外太远 → 不上色
      } else if (aMin[o] > aCut) {
        continue;                                                     // 无可用凸包时的兜底
      }
      const sg = cellSeg[o];
      const e0 = segOff[sg], e1 = segOff[sg + 1];
      const dbase = c * n;
      let svv = 0, sww = 0;
      /* 权重在线重建：w = 1/(a0+b0·dl²)。算式与 buildGeom 里预计算 aMin 时**完全同序** ——
         同一格点的 a 在两处必须逐位相同，否则 aMin 定的"最近点"会与实际权重不一致。 */
      for (let e = e0; e < e1; e++) {
        const i = segCand[e];
        const d = dlT[dbase + i];
        const w = 1 / (topA[abase + i] + topB[abase + i] * d * d);
        svv += w * cv[i];
        sww += w;
      }
      const ex = exact[o];
      const v = ex >= 0 ? cv[ex] : (sww > 0 ? svv / sww : fb);
      vals[o] = v;
      /* 分档：档内同色、档间成边（N_BANDS 的取值理由见常量旁）。
         v 已经是"按当日值域拉伸到 0–100"的位置，所以这里直接按它切档。 */
      const k = bandOf(v);
      bnd[o] = k;
      const q = o * 4;
      img[q] = lut[k * 3]; img[q + 1] = lut[k * 3 + 1]; img[q + 2] = lut[k * 3 + 2];
      /* 羽化：包内恒为 1（那里是插值），包外 FIELD_OUT_KM 内平滑到 0（那里是外推）。
         原来这里是"到最近采样点 240 km 才衰减完"，那 165 km 的渐变就是屏幕上的雾圈。 */
      let al = H ? (FIELD_OUT_KM - sd) / FIELD_OUT_KM : 1;
      if (al > 1) al = 1; else if (al < 0) al = 0;
      al = al * al * (3 - 2 * al);
      /* 海陆掩膜（D4）：只压 alpha，RGB 保持"数值 → 颜色"的原样，
         这样境外/海上的像素虽然不显示，颜色通道依然可被反查验证。 */
      mask[o] = land ? al * land[o] : al;
    }
  }
  /* 模糊遮罩：凸包边界是一条折线，模糊只为给羽化收边（FIELD_BLUR 已降到 2 格）。
     同时保持"无数据"格不被渗色染上。 */
  boxBlur(mask, cols, rows, FIELD_BLUR);
  for (let o = 0; o < mask.length; o++) {
    const a = isNum(vals[o]) ? mask[o] : 0;
    img[o * 4 + 3] = a > 0.004 ? Math.round(255 * Math.min(1, a) * FIELD_OPACITY) : 0;
  }
  /* 栅格像素 (r,c) 代表的地理方格中心：r=0 是最北一行，c=0 是最西一列 */
  return {
    cols, rows, dLa: g.dLa, dLo: g.dLo, vals, img, band: bnd, laN: g.laN, loW: g.loW,
    la1: g.la1, la0: g.la0, lo0: g.lo0, lo1: g.lo1
  };
}

/* 对外入口保持不变：几何层按签名缓存，取值层每次都重算（它才是随模型/维度变的部分）。
   用"球面距离平方的等比值"a=(d/R)² 代替真实距离：
   权重 1/a 与 1/d² 只差一个常数因子，归一化后加权平均结果完全相同，
   但几何层省掉了所有三角函数。 */
function buildField(pts, dim, mk, R, mode) {
  const n = pts.length;
  const ok = new Uint8Array(n);
  let cnt = 0;
  for (let i = 0; i < n; i++) if (isNum(dimOf(pts[i], dim, mk))) { ok[i] = 1; cnt++; }
  if (!cnt) return null;

  const sig = geomSig(pts, ok);
  if (GEOM_CACHE.sig !== sig) {
    GEOM_CACHE.geom = null;                                           // 先释放旧几何，避免重建时双份驻留
    const g = buildGeom(pts, ok);
    if (!g) return null;
    GEOM_CACHE.geom = g;
    GEOM_CACHE.sig = sig;
    GEOM_CACHE.built++;
  } else {
    GEOM_CACHE.reused++;
  }
  const g = GEOM_CACHE.geom;

  /* 取值层：城市数值 → 0–100 的色阶位置（按原 pts 下标对齐几何层） */
  const cv = new Float64Array(n);
  for (let i = 0; i < n; i++) if (ok[i]) cv[i] = 100 * scaleT(dimOf(pts[i], dim, mk), R.lo, R.hi);

  /* 色阶查找表：一次算好 N_BANDS 档 RGB，内层循环只做查表。
     取每档的**中点**色 —— 档内没有渐变，所以中点就是这一档的代表色。 */
  const lut = new Uint8Array(N_BANDS * 3);
  for (let k = 0; k < N_BANDS; k++) {
    const c = hex2rgb(rampColor(mode, (k + 0.5) / N_BANDS * 100));
    lut[k * 3] = c[0]; lut[k * 3 + 1] = c[1]; lut[k * 3 + 2] = c[2];
  }
  const f = evalField(g, cv, lut);
  /* 每格到最近采样点的距离。它只依赖几何（aMin 就在几何缓存里），与维度/模型无关，
     所以挂在几何对象上只算一次 —— 可信度叠加层每次绘制都要读它。
     evalField 里已经算过同一个量（dKm = √a·R）来做遮罩，这里只是把它留出来。 */
  f.dkm = geomDistKm(g);
  return f;
}
function geomDistKm(g) {
  if (g._dkm && g._dkm.length === g.cols * g.rows) return g._dkm;
  const d = new Float32Array(g.cols * g.rows);
  const a = g.aMin;
  for (let o = 0; o < d.length; o++) d[o] = Math.sqrt(a[o]) * 6371.0088;
  return (g._dkm = d);
}

/* 把栅格切成按纬度排列的条带。
   墨卡托投影下纬度是"非线性"的：整块矩形用两个角做线性贴合，中间会偏离上百公里。
   按 ≤FIELD_BAND_DEG 度分条、每条各自贴合，误差可以压到几公里以内。
   P2：条带数不变时复用已有 canvas，只换像素 —— 避免每次刷新都新建 12 个 canvas
   （GC 压力 + 首帧抖动）。同时把结果写回 MapMod.strips，
   使"DOM 里的画布"与"MapMod.strips 指向的画布"永远一致（否则调用方一旦漏接返回值，
   就会拿着已被移除的旧画布去量位置，量出来恒为 0）。 */
function buildStrips(f) {
  const layer = MapMod.layer;
  if (!layer) return [];
  const per = Math.max(1, Math.round(FIELD_BAND_DEG / f.dLa));
  const count = Math.ceil(f.rows / per);
  let strips = (MapMod.strips && MapMod.strips.length === count) ? MapMod.strips : null;
  if (!strips) {
    layer.innerHTML = "";
    strips = [];
    for (let i = 0; i < count; i++) {
      const cv = document.createElement("canvas");
      layer.appendChild(cv);
      strips.push({ cv, ctx: null, laTop: 0, laBot: 0, loL: 0, loR: 0 });
    }
  }
  let si = 0;
  for (let r0 = 0; r0 < f.rows; r0 += per, si++) {
    const h = Math.min(per, f.rows - r0);
    const s = strips[si];
    /* 行数/列数变了（换城市集合）才重建后备存储，否则同一块画布反复用 */
    if (s.cv.width !== f.cols || s.cv.height !== h) { s.cv.width = f.cols; s.cv.height = h; }
    const ctx = s.ctx || (s.ctx = s.cv.getContext("2d"));
    const id = ctx.createImageData(f.cols, h);
    id.data.set(f.img.subarray(r0 * f.cols * 4, (r0 + h) * f.cols * 4));
    ctx.putImageData(id, 0, 0);
    /* 上一轮因"完全在容器外"被 fitRaster 隐藏的条带要恢复显示 */
    s.cv.style.display = "";
    s.laTop = f.la1 - r0 * f.dLa;
    s.laBot = f.la1 - (r0 + h) * f.dLa;
    s.loL = f.lo0; s.loR = f.lo1;
    /* 这条带在**栅格里的起始行**。等值线要拿它把"栅格坐标"换算成容器像素
       （见 drawContours 的投影），少一个就会整条线错行。 */
    s.r0 = r0;
  }
  MapMod.strips = strips;
  return strips;
}

/* =========================================================================
   可信度叠加层
   -------------------------------------------------------------------------
   在此之前，"可信度"只存在于悬停卡的一行文字里 —— 用户必须先怀疑某个地方、
   再把鼠标移上去，才能知道那里的数值是插值还是外推。而一张色面上最容易被误读的
   恰恰是**外围那一圈**：它看起来和中心一样实心、一样"确定"。
   这里把那份不确定性画出来：**凸包之外**（＝色面开始淡出的那一圈）铺一层中性灰纱。
   于是"实心＝包内插值（有观测支撑）"、"起纱＝包外外推"。纱的边界与色面淡出的边界、
   与 B1 画的那条虚线**是同一条**，三者在图上永远对齐。

   两条硬约束：
   ① **绝不动色面的像素**。灰纱是独立画布，`sampleRaster` / `zoomprobe` 读的
      仍然是 MapMod.strips 里的原始像素，"像素颜色 → 数值"依旧是单值映射。
      这也正是当初否掉"让色面透明度随可信度变化"的原因。
   ② **边界直接取色面的淡出边界（凸包外）**，不新造判据 —— 淡出区与低可信区
      因此天然是同一片区域，不会出现"纱与淡出对不齐"。
   ========================================================================= */
function confOn() { const c = $("#showConf"); return !!(c && c.checked); }
function mountConf(box) {
  const el = document.createElement("div");
  el.className = "conflayer";
  el.id = "mapConf";
  /* 插在色面层之后，保证盖在它上面；具体层级交给 z-index，不依赖 DOM 顺序 */
  const l = MapMod.layer;
  if (l && l.parentNode === box && l.nextSibling) box.insertBefore(el, l.nextSibling);
  else box.appendChild(el);
  MapMod.confLayer = el;
}
function refreshConf() {
  const layer = MapMod.confLayer;
  if (!layer) return;
  layer.classList.toggle("on", confOn() && !!(MapMod.confStrips && MapMod.confStrips.length));
}
/* =========================================================================
   等值线 + 经纬网层（第 9 批建层 / 第 10 批换成矢量）
   -------------------------------------------------------------------------
   一个容器装两种东西，两者都是**矢量**（都不进色面栅格）：
     · **等值线**：几何在栅格坐标里算一次（`buildContourGeometry`），
       每帧投影到一张**容器分辨率**的画布上，用固定的 `CONT_PX` 描边；
     · **经纬网**：一张覆盖整层的 SVG（见 drawGraticule）。
   两者共用一个 .on —— 只要求"有其一即显示"，否则两处各自 toggle 会互相打架。
   等值线为什么不能做进色面栅格：色面像素与数值必须保持单值映射（"看图反查数值"，
   zoomprobe 的像素级断言守护它），在色面栅格上描线会把这个性质打掉 —— 宁可多一层。
   为什么也不能"逐格栅格化"到这一层：线宽会绑死在栅格上（放大多少就粗多少），
   这正是用户连着两次说"还粗"的根因。
   ========================================================================= */
function gridOn() {
  return !!((MapMod.contGeo && MapMod.contGeo.n) || MapMod.gratOn);
}
function refreshGrid() {
  const layer = MapMod.gridLayer;
  if (layer) layer.classList.toggle("on", gridOn());
}
/* C1 · 经纬网开关的**唯一入口**（`#showGrid` 的 change 事件调它，见 `_p5.js`）。
   只做三件事：写偏好、让签名失效、立刻重算一次可见性。
   为什么签名要失效：关→开时若视野没动，`drawGraticule` 会在签名那一关直接 return，
   于是 `svg.style.display` 停在 `none`、网再也回不来。
   默认值有**两个来源必须一致**：`MapMod.gratUser` 初值 true（这里）与模板里
   `#showGrid` 的 `checked`（tpl/template.html）。两处都是"默认开"。 */
function setGratUser(on) {
  MapMod.gratUser = !!on;
  MapMod.gratSig = "";
  drawGraticule();
}
function mountGridLayer(box) {
  const el = document.createElement("div");
  el.className = "clayer";
  el.id = "mapGrid";
  /* 插在色面层之后（可信度纱之前由 z-index 决定，不依赖 DOM 顺序） */
  const l = MapMod.layer;
  if (l && l.parentNode === box && l.nextSibling) box.insertBefore(el, l.nextSibling);
  else box.appendChild(el);
  /* 等值线画布：尺寸跟着容器走（**不是**栅格条带），所以必须排在经纬网 SVG 前面
     —— 同在 .clayer 里、都是 absolute，后插入的 SVG 画在上面。 */
  const cv = document.createElement("canvas");
  cv.id = "mapContour";
  el.appendChild(cv);
  MapMod.contCv = cv;
  MapMod.gridLayer = el;
}
/* 底图处理（②-4，第 8 批扩成「深色底图」开关）：
   色阶的低值端接近白色，而底图也是浅色 —— 两者接近时，"数值很低"与"这块没数据"
   在观感上分不开（图例里只能写一句"属正常现象"）。原来的做法是夹一层 `.dimbase`
   把底图整体压暗；第 8 批起这个开关同时给 `#map` 与**全部叠加层**套同一个
   `invert(1) hue-rotate(180deg)`（见 template 的 `.mapwrap.dark`）：底图变成深色，
   而两层反相在色面这一侧恰好抵消 —— 色面像素一个都不变。复选框文案因此改成「深色底图」，
   但 **id 仍是 `dimBase`**（沿用既有探针里的选择器）。
   不用腾讯地图的自定义样式：那需要一个样式 ID，而本项目的联调环境用的是
   地图 API 的替身，样式请求根本发不出去 —— 改了也无法验证，只能靠"看起来对"。
   纯 CSS 层没有这个问题，且随时可关。默认关闭：它改变的是底图观感，
   不该在用户没要求的时候悄悄换掉整张图的底子。 */
function mountDimBase(box) {
  const el = document.createElement("div");
  el.className = "dimbase";
  el.id = "mapDimBase";
  const l = MapMod.layer;
  if (l && l.parentNode === box) box.insertBefore(el, l);
  else box.appendChild(el);
  MapMod.dimBaseEl = el;
}
function refreshDimBase() {
  const c = $("#dimBase");
  const on = !!(c && c.checked);
  if (MapMod.dimBaseEl) MapMod.dimBaseEl.classList.toggle("on", on);
  /* 深色底图＝压暗层 + 给 #map 加反相（见 template 里 .mapwrap.dark 的注释）。
     两件事由同一个勾选驱动：只压暗，城市名这类**深色文字标签**还是深的，读不出来。 */
  const w = document.querySelector(".mapwrap");
  if (w) w.classList.toggle("dark", on);
}
function buildConfStrips(f) {
  const layer = MapMod.confLayer;
  if (!layer || !f.dkm) return null;
  /* 纱的边界＝**色面的淡出边界**，也就是凸包外那一条 —— 与 drawDataEdge 画的那条
     虚线同一条。这条"起纱 ≡ 淡出 ≡ 外推"的不变量本来就在注释里写着，但实现一直
     用的是 `dkm > FIELD_FULL`（凸包改造**之前**的写法：当时色面边界是"距最近采样点
     FULL(75) 起淡出、RANGE(240) 归零"，所以两者碰巧重合）。换了凸包之后淡出边界
     挪到了凸包上、判据没跟着走，覆盖率就从 46% 掉到 1% 左右。
     实测（广州默认取景，栅格 217×200，已上色 31,342 格）证得判据选错了，不只是阈值：
       · 包内 dkm 最大只有 **85.3 km**（≈ 格心到最近格点的 120×0.707）⇒ `dkm > 90`
         只可能在羽化带里触发；
       · 羽化带里 dkm 最小只有 **1.4 km** —— 贴着凸包顶点外侧一点明明已经是外推，
         dkm 却是 1.4 km。
     ⇒ **dkm 根本无法表达"外推"**（它是"离最近观测点多远"，不是"在不在采样区里"）。
     另外两个量本来也不是一回事：包内也有一半区域 dkm > 50 km，那里是**插值**。 */
  const g = GEOM_CACHE.geom, hud = g && g.hud, H = hud ? hud.edges : null;
  const per = Math.max(1, Math.round(FIELD_BAND_DEG / f.dLa));
  const count = Math.ceil(f.rows / per);
  let strips = (MapMod.confStrips && MapMod.confStrips.length === count) ? MapMod.confStrips : null;
  if (!strips) {
    layer.innerHTML = "";
    strips = [];
    for (let i = 0; i < count; i++) {
      const cv = document.createElement("canvas");
      layer.appendChild(cv);
      strips.push({ cv, ctx: null });
    }
  }
  let si = 0;
  for (let r0 = 0; r0 < f.rows; r0 += per, si++) {
    const h = Math.min(per, f.rows - r0);
    const s = strips[si];
    if (s.cv.width !== f.cols || s.cv.height !== h) { s.cv.width = f.cols; s.cv.height = h; }
    const ctx = s.ctx || (s.ctx = s.cv.getContext("2d"));
    const id = ctx.createImageData(f.cols, h);
    const D = id.data;
    for (let y = 0; y < h; y++) {
      const o0 = (r0 + y) * f.cols;
      /* 该行的投影 Y（公里）——与 evalField 里算 sd 的同一套局部等距投影 */
      const Y = H ? ((f.laN - (r0 + y) * f.dLa) - hud.olat) * 110.574 : 0;
      for (let x = 0; x < f.cols; x++) {
        const o = o0 + x;
        /* 只看两件事：这一格色面是否真的画了东西、以及它是否在凸包**之外**。
           不满足就整格透明，所以纱不会铺到边界之外的空白上。 */
        if (f.img[o * 4 + 3] === 0) continue;
        if (H) {
          const X = (f.loW + x * f.dLo - hud.olon) * hud.kx;
          let sd = -1e9;
          for (let k = 0; k < H.length; k += 3) {
            const d = H[k] * X + H[k + 1] * Y + H[k + 2];
            if (d > sd) sd = d;
          }
          if (!(sd > 0)) continue;                 // 包内＝插值，不起纱
        } else if (!(f.dkm[o] > FIELD_FULL)) {
          continue;                                // 无凸包（几何退化）时的兜底：沿用旧判据
        }
        const q = (y * f.cols + x) * 4;
        D[q] = 100; D[q + 1] = 116; D[q + 2] = 139; D[q + 3] = 96;
      }
    }
    ctx.putImageData(id, 0, 0);
  }
  MapMod.confStrips = strips;
  refreshConf();
  return strips;
}

/* =========================================================================
   等值线的**几何**：在栅格坐标下抽出"档与档之间"的边界
   -------------------------------------------------------------------------
   为什么抽的是**值/档位的边界**而不是"逐格描边"：逐格描边只能画在格边上，
   于是线是台阶状、粗细恒等于一格，且**粗细绑死在栅格上**（放大多少就粗多少）。
   做法：marching squares 找 `v = 档界对应值` 的等值线，交叉点沿格边**线性插值**。

   **插值必须在连续值场 `f.vals` 上做，不能在档位（整数 0..6）上做** ——
   这条是踩过的：档位只有 7 个取值，任意相邻两格的"界"都在 0.5 处，
   于是 `(t-v0)/(v1-v0)` 恒等于 ±0.5，交叉点**永远落在格边中点**，
   画出来是一条贴着格子走的折线（放大后满屏直角台阶）。
   改成在值场上找"档界对应的那个值"，交叉点才是真实插值出来的位置。

   输出用**栅格角点坐标**（格 (c,r) 的左上角就是 (c,r)），投影到容器像素是
   drawContours 的事；这里一个像素都不碰，所以几何只跟值场有关、与取景无关。

   顺带保留两条老性质：
     · 四角里任一格无数据（NaN）⇒ 整格跳过，线在数据边缘断开；
     · 四角色面 alpha 平均为 0 ⇒ 整格跳过。于是线在掩膜外与羽化尽头自然消失，
       不会出现"色面没了、线还悬在外面"。
   每个线段还带一份**所在格的色面 alpha**，描边时按它分档 —— 羽化区里线跟着淡出。
   ========================================================================= */
const CONT_SADDLE = [                                    // 16 种角落组合 → 交叉边对
  [], [[2, 3]], [[1, 2]], [[1, 3]], [[0, 1]], null, [[0, 2]], [[0, 3]],
  [[0, 3]], [[0, 2]], null, [[0, 1]], [[1, 3]], [[1, 2]], [[2, 3]], []
];
/* 档界对应的**值**：(k+1)/N_BANDS × 100。与 bandOf 的分档是同一条尺子
   （bandOf(v) = clamp(floor(clamp(v,0,100)/100 × N_BANDS), 0, N_BANDS−1)）——
   改分档口径这里必须跟着改，否则线会落在档界之外。 */
const CONT_LEVELS = (function () {
  const a = [];
  for (let k = 0; k + 1 < N_BANDS; k++) a.push((k + 1) * 100 / N_BANDS);
  return a;
})();
function buildContourGeometry(f) {
  const cols = f.cols, rows = f.rows, v = f.vals, img = f.img;
  const seg = [], al = [];
  const push = (p, q, a) => { if (p && q) { seg.push(p.x, p.y, q.x, q.y); al.push(a); } };
  const clampV = x => (x < 0 ? 0 : (x > 100 ? 100 : x));
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      const o00 = r * cols + c, o10 = o00 + 1, o01 = o00 + cols, o11 = o01 + 1;
      const w00 = v[o00], w10 = v[o10], w11 = v[o11], w01 = v[o01];
      if (!(isNum(w00) && isNum(w10) && isNum(w11) && isNum(w01))) continue;
      /* 与 bandOf 一样把值夹到 [0,100]：不夹的话超出量程的核心区会同时跨过全部
         6 条档界线，在一格里画出一束平行线。 */
      const v00 = clampV(w00), v10 = clampV(w10), v11 = clampV(w11), v01 = clampV(w01);
      let lo = v00, hi = v00;
      if (v10 < lo) lo = v10; else if (v10 > hi) hi = v10;
      if (v11 < lo) lo = v11; else if (v11 > hi) hi = v11;
      if (v01 < lo) lo = v01; else if (v01 > hi) hi = v01;
      if (!(hi > lo)) continue;
      const a4 = Math.round((img[o00 * 4 + 3] + img[o10 * 4 + 3]
        + img[o11 * 4 + 3] + img[o01 * 4 + 3]) / 4);
      if (a4 < 1) continue;                              // 色面这一格没上色 ⇒ 线不悬空
      for (let li = 0; li < CONT_LEVELS.length; li++) {
        const t = CONT_LEVELS[li];
        if (!(t > lo && t < hi)) continue;
        /* 一条边"被穿过" ⇔ 两端落在 t 的两侧（值域上，不是档位上） */
        const p0 = v10 !== v00 ? { x: c + (t - v00) / (v10 - v00), y: r } : null;
        const p1 = v11 !== v10 ? { x: c + 1, y: r + (t - v10) / (v11 - v10) } : null;
        const p2 = v01 !== v11 ? { x: c + 1 - (t - v11) / (v01 - v11), y: r + 1 } : null;
        const p3 = v00 !== v01 ? { x: c, y: r + 1 - (t - v01) / (v00 - v01) } : null;
        const idx = ((v00 > t) ? 8 : 0) | ((v10 > t) ? 4 : 0) | ((v11 > t) ? 2 : 0) | ((v01 > t) ? 1 : 0);
        const tab = CONT_SADDLE[idx];
        if (tab) {
          for (const [e1, e2] of tab) push([p0, p1, p2, p3][e1], [p0, p1, p2, p3][e2], a4);
        } else {
          /* 鞍点（四角两两对角，四条边**全被穿过**）：靠格心值决定两条线怎么连。
             idx 5 是「c1/c3 在上」、idx 10 是「c0/c2 在上」；mid = 格心也在上。
             mid ⇒ 在上的那一对是连着的 ⇒ 去切**另一对**角（[[0,1],[2,3]] 切 c1 与 c3，
             [[0,3],[1,2]] 切 c0 与 c2）。连错只在这**一格**里长出一对短竖线，不影响周围。 */
          const mid = (v00 + v10 + v11 + v01) / 4 > t;
          const pair = ((idx === 5) !== mid) ? [[0, 1], [2, 3]] : [[0, 3], [1, 2]];
          for (const [e1, e2] of pair) push([p0, p1, p2, p3][e1], [p0, p1, p2, p3][e2], a4);
        }
      }
    }
  }
  MapMod.contGeo = { seg: Float32Array.from(seg), al: Uint8Array.from(al), n: al.length };
  MapMod.contSig = "";                                   // 几何换了，强制重画
  return MapMod.contGeo;
}

/* 把栅格坐标的等值线投影到**容器像素**再描边 —— 每帧（拖动/缩放）都跑。
   投影直接复用色面条带那份 rect（同一个地理范围 ⇒ 同一组 scale），
   所以线必然落在色面的档界上，不可能错位；而**线宽是屏幕像素常数**，
   因此无论怎么放大都还是 CONT_PX 那么细。 */
function drawContours(rect) {
  const cv = MapMod.contCv, host = MapMod.host, f = MapMod.field;
  if (!cv || !host || !f) return;
  const W = host.clientWidth, H = host.clientHeight;
  if (!(W > 0) || !(H > 0)) return;
  const dpr = Math.min(3, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
  const pw = Math.max(1, Math.round(W * dpr)), ph = Math.max(1, Math.round(H * dpr));
  const geo = MapMod.contGeo;
  const n = geo ? geo.n : 0;
  /* 位置没变就一个像素都不碰 —— fitRaster 会被 tilesloaded 这类事件反复触发。
     签名里带上 GEOM_CACHE.built：换地点时凸包会重建，而边界线跟着它变。 */
  const sig = pw + "x" + ph + "#" + n + "#" + GEOM_CACHE.built + "#" + (rect
    ? rect.map(r => r ? (r.x.toFixed(1) + "," + r.ty.toFixed(1) + ","
      + r.w.toFixed(1) + "," + r.h.toFixed(1)) : "-").join("|") : "none");
  if (sig === MapMod.contSig) return;
  MapMod.contSig = sig;
  if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
  if (cv.style.width !== W + "px") cv.style.width = W + "px";
  if (cv.style.height !== H + "px") cv.style.height = H + "px";
  const ctx = cv.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pw, ph);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  /* 数据范围边界线**先画、且在等值线的早退之前** —— 它不依赖等值线存不存在。
     传 rect/f 进去是为了让它按色面 alpha 裁断（见 drawDataEdge）。 */
  drawDataEdge(ctx, rect, f);
  if (!n || !rect) return;
  const per = Math.max(1, Math.round(FIELD_BAND_DEG / f.dLa));
  const cols = f.cols, gseg = geo.seg, gal = geo.al;
  /* 按色面 alpha 分 16 档：同一档只 stroke 一次，省掉几千次状态切换；
     档内取中点，误差 ≤ 8/255 —— 肉眼不可分。 */
  const NB = 16, buckets = [];
  for (let i = 0; i < NB; i++) buckets.push([]);
  for (let s = 0; s < n; s++) {
    const q = s * 4;
    const x1 = gseg[q], y1 = gseg[q + 1], x2 = gseg[q + 2], y2 = gseg[q + 3];
    const rc = rect[Math.floor(Math.floor(y1) / per)];
    if (!rc) continue;
    const kx = rc.w / cols, ky = rc.h / rc.h0, yb = rc.ty - rc.r0 * ky;
    const b = (gal[s] * NB) >> 8;
    buckets[b < NB ? b : NB - 1].push(
      rc.x + x1 * kx, yb + y1 * ky, rc.x + x2 * kx, yb + y2 * ky);
  }
  ctx.lineWidth = CONT_PX;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const pre = "rgba(" + CONT_RGB[0] + "," + CONT_RGB[1] + "," + CONT_RGB[2] + ",";
  for (let i = 0; i < NB; i++) {
    const p = buckets[i];
    if (!p.length) continue;
    const a = Math.round(CONT_ALPHA * (i + 0.5) / NB);
    if (a < 1) continue;
    ctx.strokeStyle = pre + (a / 255).toFixed(4) + ")";
    ctx.beginPath();
    for (let j = 0; j < p.length; j += 4) { ctx.moveTo(p[j], p[j + 1]); ctx.lineTo(p[j + 2], p[j + 3]); }
    ctx.stroke();
  }
}

/* B1 · 数据范围边界线（凸包）。
   色面在凸包内是**插值**、包外 70 km 是**外推并淡出**，但这条分界原本在图上没有线；
   而低值区（档 0/1 的浅黄接近白）几乎与浅色底图同色 ⇒ "这片到底算过没有"读不出来。
   画在**凸包本身**而不是羽化带外缘：那里 alpha = 1，线才看得见；而且它就是那条分界。
   样式与等值线**同色系但更淡、且用虚线** —— 同一屏里要能分清"档界"（实线）与"范围"（虚线）。
   线宽走容器像素（固定 1 px），理由与等值线相同：放大多少都不变粗。
   与等值线共用一个画布、同一次重画：两者都依赖视野与几何，闸门本来就是同一道。
   **必须按色面 alpha 裁断**，这是与等值线**同一条纪律**（buildContourGeometry 里
   `a4 < 1 → continue` 那句）。海陆掩膜会成片删掉色面（沿海城市的凸包大半伸进海里），
   若照几何原样连成一圈，虚线就会有一段浮在没有颜色的海面上 —— 那正是"一撮浮在空处的线"，
   也正是等值线那条断言要拦的东西。所以沿每条边采样，只画色面真的有像素的弧段。
   采样在**容器像素**里做（与非等值线的投影同一套 rect），保证"哪一段在色面上"与
   "画在哪"用的是同一个坐标，不会因为两种插值而在边中间错开。 */
function drawDataEdge(ctx, rect, f) {
  const hud = GEOM_CACHE.geom && GEOM_CACHE.geom.hud;
  const ll = hud && hud.latlng, map = MapMod.map;
  MapMod.edgePts = 0; MapMod.edgeIn = 0;
  if (!ll || !ll.length || !map || !f) return;
  const cols = f.cols, rows = f.rows, img = f.img;
  /* 容器像素 → 该处色面有没有像素。列不分条带，行要靠条带的 r0 偏移回全栅格行号
     （rect 里的 h0 是**本条带**的行数，不是全栅格的）。 */
  const hasColor = (px, py) => {
    if (!rect || !img) return true;
    for (let i = 0; i < rect.length; i++) {
      const r = rect[i];
      if (!r) continue;
      if (px < r.x || px > r.x + r.w || py < r.ty || py > r.ty + r.h) continue;
      let lx = Math.floor((px - r.x) / r.w * cols);
      let ly = r.r0 + Math.floor((py - r.ty) / r.h * r.h0);
      lx = lx < 0 ? 0 : (lx > cols - 1 ? cols - 1 : lx);
      ly = ly < 0 ? 0 : (ly > rows - 1 ? rows - 1 : ly);
      return img[(ly * cols + lx) * 4 + 3] > 0;
    }
    return false;                       // 落在所有条带之外（视野外）⇒ 那里没有色面
  };
  const V = [];
  for (let i = 0; i < ll.length; i += 2) {
    const p = ptOf(map.projectToContainer(new TMap.LatLng(ll[i], ll[i + 1])));
    if (p) V.push(p);
  }
  MapMod.edgePts = V.length;
  if (V.length < 3) return;
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1;
  ctx.lineCap = "butt";
  ctx.strokeStyle = "rgba(" + CONT_RGB[0] + "," + CONT_RGB[1] + "," + CONT_RGB[2] + ",0.42)";
  /* 步长取 1 px：色面在掩膜边缘是**逐格**截断的，步长再大一点就可能多画出去一格，
     而那正是"悬空"。多出来的采样开销只在这一层重画时付一次（签名不变就整段跳过）。 */
  let inN = 0, cur = null;
  const flush = () => {
    if (cur && cur.length >= 4) {
      ctx.beginPath();
      ctx.moveTo(cur[0], cur[1]);
      for (let i = 2; i < cur.length; i += 2) ctx.lineTo(cur[i], cur[i + 1]);
      ctx.stroke();                     // 每条弧段单独 stroke：同一路径反复 stroke 会让 alpha 叠加变深
    }
    cur = null;
  };
  for (let e = 0; e < V.length; e++) {
    const a = V[e], b = V[(e + 1) % V.length];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(L));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
      if (hasColor(px, py)) {
        if (!cur) cur = [];
        cur.push(px, py);
        inN++;
      } else flush();
    }
    flush();                            // 顶点处收段，避免跨顶点连出一条"抄近路"的假线
  }
  ctx.setLineDash([]);
  MapMod.edgeIn = inN;
}

/* 逐条带把地理范围换算成容器像素，只改 CSS transform（不重算色值）。
   用 scale() 而不是 width/height：画布的布局尺寸保持真实像素小尺寸，
   放大只发生在合成阶段（对位图做双线性平滑），避免出现几十万像素宽的布局盒。 */
function fitRaster() {
  const map = MapMod.map, strips = MapMod.strips;
  if (!map) return;
  /* 图钉层与色面无关（没有数据时"查询点在哪"这个问题照样成立），
     所以放在 strips 的早退之前。renderPins 有签名兜底，拖动时只走 placePins。 */
  renderPins();
  placePins();
  /* 经纬网与色面无关（"这个坐标在哪"在没数据时照样成立），放在 strips 的早退之前。
     它靠 mapSet() 自己判断"图面是否已经画出来"，与方位环同一口径。 */
  drawGraticule();
  if (!strips || !strips.length) return;
  if (MapMod.layer) MapMod.layer.classList.add("on");
  const W = MapMod.host ? MapMod.host.clientWidth : 0;
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  const snap = v => Math.round(v * dpr) / dpr;
  /* 逐条带投影 → **统一取整上下沿**，让相邻条带共用同一个边界像素。
     为什么不能沿用"每条带加 0.75px 高度去盖住亚像素缝隙"（那是旧做法）：
     色面是**半透明**的，重叠的那一行会被 alpha 合成两次 —— 浅色底图上就是一条
     比邻行更深的横线。旧的连续色阶 + 88 km 大模糊把 28.9% 的不透明格摊得很淡，
     这条线看不出来；换成凸包边界 + 分档填色后完全不透明格占 50.6%，它就显形了
     （实测该行亮度比邻行低 7.7）。
     条带在纬度上本就首尾相接（上一条的 laBot === 下一条的 laTop），
     投影结果逐位相同 ⇒ 取整一次、两边共用，缝隙与重叠同时消失，不需要任何"补丁"。 */
  const P = strips.map(s => {
    const a = ptOf(map.projectToContainer(new TMap.LatLng(s.laTop, s.loL)));   // 西北角
    const b = ptOf(map.projectToContainer(new TMap.LatLng(s.laBot, s.loR)));   // 东南角
    return (a && b && (b.x - a.x) > 0 && (b.y - a.y) > 0) ? { a, b } : null;
  });
  const yTop = P.map(p => p ? snap(p.a.y) : null);
  /* 每条带的投影矩形留一份（等值线要用**同一份**结果把栅格坐标投影到容器像素） */
  const rect = [];
  for (let i = 0; i < P.length; i++) {
    const s = strips[i], p = P[i];
    if (!p) { s.cv.style.display = "none"; rect.push(null); continue; }
    /* 完全在容器外的条带直接不参与渲染 */
    if (p.a.x > W + 2 || p.b.x < -2) { s.cv.style.display = "none"; rect.push(null); continue; }
    /* 底沿优先取"下一条的顶"（两者本应相等）—— 让边界严格共用，而不是各算各的 */
    const ty = yTop[i];
    const by = (i + 1 < P.length && yTop[i + 1] != null) ? yTop[i + 1] : snap(p.b.y);
    const h = by - ty, w = p.b.x - p.a.x;
    if (!(h > 0) || !(w > 0)) { s.cv.style.display = "none"; rect.push(null); continue; }
    s.cv.style.display = "block";
    s.cv.style.transform = "translate(" + p.a.x.toFixed(2) + "px," + ty.toFixed(2) + "px) scale(" +
      (w / s.cv.width).toFixed(5) + "," + (h / s.cv.height).toFixed(5) + ")";
    /* r0 / h0 ＝ 这条带在栅格里的起始行与行数。等值线要把**栅格坐标**投影到容器像素，
       靠的就是这三个数（x, ty, w/h0 与 r0）—— 与色面共用同一份投影，不会错位。 */
    rect.push({ x: p.a.x, ty, w, h, r0: s.r0 || 0, h0: s.cv.height });
  }
  /* 数值直标层跟着同一次投影更新（它只是 DOM 标签，不参与色面栅格）。
     先按当前缩放校准分级（跨台阶时可能重建标签集合），再摆位置。 */
  syncLabelTier();
  placeLabels();
  /* 叠加层与色面条带**逐条一一对应**（同 per / 同 count / 同覆盖范围），
     所以复用上面那份 rect，不必再投影一遍、也绝不可能对不齐：
       · 可信度纱：画布尺寸与色面**完全相同** ⇒ 直接复制 transform 字符串（最省）；
       · 等值线：不在栅格里，而是一张**容器分辨率**的画布 —— 用同一个 rect 把
         栅格坐标投影过去、按屏幕像素描边（见 drawContours）。它**不是**条带，
         所以不参与 refit，也不该有 transform。 */
  const refit = (arr) => {
    if (!arr || arr.length !== strips.length) return;
    for (let i = 0; i < arr.length; i++) {
      const cv = arr[i].cv, r = rect[i];
      if (!r) { cv.style.display = "none"; continue; }
      cv.style.display = "block";
      cv.style.transform = strips[i].cv.style.transform;
    }
  };
  refit(MapMod.confStrips);
  drawContours(rect);
  refreshConf();
  /* M1：方位/距离环也要跟着重新投影（拖动、缩放、换地点都会走到这里）。
     放在 fitRaster 末尾而不是各处单独调用，是为了让"所有叠加层一起重贴合"这件事
     只有一个入口 —— 少一个入口就少一处会忘记同步的地方。 */
  drawAzimuthLayer();
}
/* 地图事件很密集，按帧合并，避免一次拖动里重复投影几十次 */
let fitRaf = 0;
function scheduleFit() {
  if (fitRaf) return;
  fitRaf = requestAnimationFrame(() => { fitRaf = 0; fitRaster(); });
}
function ptOf(p) {
  if (!p) return null;
  const x = (typeof p.getX === "function") ? p.getX() : p.x;
  const y = (typeof p.getY === "function") ? p.getY() : p.y;
  return (isNum(x) && isNum(y)) ? { x, y } : null;
}
/* 读取覆盖层在某经纬度处的"真实渲染像素"（DOM 实测，可用于自检地理锚定是否正确） */
function sampleRaster(lat, lon) {
  const map = MapMod.map, strips = MapMod.strips, host = MapMod.host;
  if (!map || !strips || !strips.length || !host) return null;
  const p = ptOf(map.projectToContainer(new TMap.LatLng(lat, lon)));
  if (!p) return null;
  const hr = host.getBoundingClientRect();
  const X = hr.left + p.x, Y = hr.top + p.y;
  for (const s of strips) {
    const r = s.cv.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (X < r.left || X > r.right || Y < r.top || Y > r.bottom) continue;
    const ix = clamp(Math.floor((X - r.left) / r.width * s.cv.width), 0, s.cv.width - 1);
    const iy = clamp(Math.floor((Y - r.top) / r.height * s.cv.height), 0, s.cv.height - 1);
    const d = s.cv.getContext("2d").getImageData(ix, iy, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }
  return null;
}
/* 值场在某经纬度处的数值（最近格点）；越界或无数据返回 null。
   用于自检："渲染出来的颜色" 是否等于 "该数值应对应的颜色"。 */
function fieldValue(lat, lon) {
  const f = MapMod.field;
  if (!f) return null;
  const r = Math.round((f.laN - lat) / f.dLa);
  const c = Math.round((lon - f.loW) / f.dLo);
  if (r < 0 || r >= f.rows || c < 0 || c >= f.cols) return null;
  const v = f.vals[r * f.cols + c];
  return isNum(v) ? v : null;
}

/* ---- 数据：地图各城市 ----
   取数策略（控制接口调用量）：
   ① 每个采样点各请求一次（接口按"变量数 × 坐标数"计费；B13 后为周边约 57 个）；
   ② 样带外点（沿日出/日落方位，与单点**同构**的 0…400 km 共 17 点）不额外请求，
      改用采样网格对云场做反距离加权插值（IDW）推求 —— 这是本快视图的核心近似；
   ③ 同一天的朝霞与晚霞共用这一次取数（只是取用不同时刻与方向的样本）；
   ④ 结果写入 localStorage 缓存（3 小时），页面重载或切换时段不再发起请求。   */
/* 地图缓存键（B13）：日期 **+ 查询坐标**。
   坐标是局部化之后必须补上的一维 —— 局部网格随查询点变化，而键里只有日期的话，
   "看完北京再看上海"会直接命中北京那条缓存，画出一张套错地方、却看不出任何异常的热力图。
   精度取 0.1°（约 11 km）：远小于 120 km 的采样间距，不影响结果适用性；
   同时让"拖开一点再查回来"这类小幅移动仍能命中缓存。 */
function mapKeyOf(dateS) {
  return MAP_CACHE_PREFIX + dateS + "@" + State.lat.toFixed(1) + "," + State.lon.toFixed(1);
}
function mapCacheGet(dateS) {
  try {
    const s = localStorage.getItem(mapKeyOf(dateS));
    if (!s) return null;
    const j = JSON.parse(s);
    if (!j || !j.obj || Date.now() - j.ts > MAP_CACHE_TTL) return null;
    /* 结构校验：只有同时带 p / q 分模型结果的数据才可用。
       旧版本缓存里的点是 {P,Q} 而没有分模型字段，直接当"无缓存"处理、重新取数，
       否则切到任一具体模型都会取到全 null，地图会变成一片空白。 */
    const probe = (j.obj.pm && j.obj.pm.pts && j.obj.pm.pts[0]) ||
      (j.obj.am && j.obj.am.pts && j.obj.am.pts[0]);
    if (!probe || !probe.p || !probe.q) return null;
    return j.obj;
  } catch (e) { return null; }
}
function mapCachePut(dateS, obj) {
  /* P5：这个对象实测约 100 K 字符（_check/cachesize.js 实测 102,550 字符），同步
     JSON.stringify 是毫秒级开销，而本函数就在取数完成、
     马上要画色面的那一帧里被调用 —— 低端机上正好是一帧掉帧。挪到空闲回调：
     用户看到色面的时刻不受影响，序列化也不再挡关键帧。
     requestIdleCallback 在 Safari 上还没有，退回 setTimeout(0)。
     timeout 给 250 ms 而不是 2 s：关键帧只占 ~16 ms，250 ms 早已出帧，没必要把
     落盘拖到最后期限；有界还能让"缓存多久内一定写好"这件事可断言。 */
  const run = () => {
    /* 到这一步时可能已经切过好几个日期了：若该日期已被 B9 的 LRU 淘汰
       （内存里没了、localStorage 也删了），就不要再把它写回去 —— 否则延迟写入
       会变成一条"复活"已淘汰键的路径，localStorage 会慢慢超出 MAP_DATA_MAX。 */
    if (MapMod.dataOrder.indexOf(dateS) < 0) return;
    try {
      localStorage.setItem(mapKeyOf(dateS), JSON.stringify({ ts: Date.now(), obj }));
      mapCacheSweep();          // 写完立刻收一遍，别等配额满了才发现（见 mapCacheSweep）
    } catch (e) { mWarn("写地图缓存失败（可能配额不足或隐私模式）", e); }
    /* 落盘成功或失败都要重标一次：成功则下拉框里多一个「已缓存」，
       失败（配额满/隐私模式）则不能留着一个骗人的标记。 */
    markCachedDates();
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 250 });
  else setTimeout(run, 0);
}
/* 单点缓存键（B1）：日期 + 时段 + **坐标**。
   坐标放末尾是为了让 sweepPrefix 的"是不是当前地点"判据（键尾 @lat,lon）成立；
   period 必须参与 —— 样带是沿**该时段**的事件方位（日出 vs 日落）构造的，
   两次的坐标集合并不相同，所以朝霞与晚霞各自取一次数不是冗余。
   精度取 0.1°（约 11 km）：这已在模式自身的分辨率之下（GFS 约 13 km / EC 约 25 km），
   再细也换不来不同的网格点，却会让"稍微挪一下再查回来"永远不命中。 */
function pointKeyOf(lat, lon, dateS, period) {
  return POINT_CACHE_PREFIX + dateS + "|" + period + "@" + lat.toFixed(1) + "," + lon.toFixed(1);
}
function pointCacheGet(lat, lon, dateS, period) {
  try {
    const s = localStorage.getItem(pointKeyOf(lat, lon, dateS, period));
    if (!s) return null;
    const j = JSON.parse(s);
    if (!j || !j.obj || Date.now() - j.ts > POINT_CACHE_TTL) return null;
    /* 结构校验：GFS 那份必须在；另外两份允许为 null（取数时它们本来就可能因失败
       被替换成 null）。命中一个残缺 bundle 会让 computeAll 在更深处炸掉，
       所以宁可当"无缓存"重取 —— 与 mapCacheGet 对旧结构的处理同一思路。 */
    const b = j.obj;
    const nullable = v => v === null || v === undefined || Array.isArray(v);
    if (!Array.isArray(b.gfsD) || !nullable(b.ecD) || !nullable(b.aqD)) return null;
    return b;
  } catch (e) { return null; }
}
function pointCachePut(lat, lon, dateS, period, obj) {
  /* 与 mapCachePut 一样挪到空闲回调：这一份 JSON.stringify 比地图那份更大
     （三路响应），而它就在取数完成、马上要 renderAll 的那一帧里被调用。
     timeout 给 250 ms 而不是 2 s —— 关键帧只占 ~16 ms，250 ms 早已出帧，
     有界才能让"缓存多久内一定写好"这件事可断言。 */
  const run = () => {
    try {
      localStorage.setItem(pointKeyOf(lat, lon, dateS, period), JSON.stringify({ ts: Date.now(), obj }));
      mapCacheSweep();          // 写完立刻收一遍，别等配额满了才发现
    } catch (e) { mWarn("写单点缓存失败（可能配额不足或隐私模式）", e); }
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 250 });
  else setTimeout(run, 0);
}
/* =========================================================================
   趋势结果缓存（B2）
   -------------------------------------------------------------------------
   为什么值得补：趋势是**单页额度的大头** —— 一次点击发 3 路 × 34 个样带坐标
   × trendWindow() 天（≈129 个加权调用，占全量 236 的 55%），而它在此之前
   **完全不复用**：结果只放在内存 `State.trend` 里，换城市再换回来、或者刷新页面，
   这 129 个调用要再花一遍。

   **存什么：存算好的 rows，绝不存原始响应。** 这一点与单点缓存相反，而且必须先算账：
     · 原始响应 = 3 路 × 34 坐标 × 10 天 × 24 小时 × 9 个变量。以单点缓存实测的
       754,398 字符（3 路 × 17 坐标 × 3 天）为尺子等比放大，是 **≈ 5 MB** ——
       localStorage 配额是 5 MB，一条就撑满，而且是"写进去以后所有缓存一起静默失效"
       那种最难查的坏法。
     · 算好的 rows = 10 天 × 2 时段 × {P, Q, grade, ec} ≈ **1 KB**。
   代价是"命中后不再重算"，于是**权重/阈值一变，旧缓存就是错的** —— 所以
   版本号必须写在键里（`v1`），改动计算口径时**必须升 `TREND_CACHE_PREFIX`**，
   与 `POINT_CACHE_PREFIX` 那条纪律完全同源（硬约束 13）。

   坐标放**末尾**（`@lat,lon`）⇒ 直接复用 sweepPrefix 的"是不是当前地点"判据，
   与地图/单点两个键族同一套机制。

   与 B14 地图那条**同构**的硬约束：`loadTrend(cacheOnly)` 的
   `if (cacheOnly) return false;` 必须放在缓存快路径**之后**、任何网络调用**之前** ——
   "开页自动加载不烧额度"由**那一行**保证，而不是靠调用方复制一份命中条件去对齐
   （镜像条件迟早漂移）。
   ========================================================================= */
const TREND_CACHE_PREFIX = "sunsetbot.trend.v1.";
const TREND_CACHE_FAMILY = "sunsetbot.trend.";
const TREND_CACHE_TTL = MAP_CACHE_TTL;
/* 条数与单点缓存同量级，但它只有 1 KB/条 —— 3 条足够覆盖"最近看过的地点"，
   而且它是**真淘汰**（keepMine=false），不会像单点那样有配额压力。 */
const TREND_CACHE_MAX = 3;

function trendKeyOf(dayMs) {
  return TREND_CACHE_PREFIX + ymd(new Date(dayMs)) + "@"
    + State.lat.toFixed(1) + "," + State.lon.toFixed(1);
}
/* 只留 renderTrend 真正读的那些字段。`b`（原始响应）与 `pts`（样带几何）
   都是计算过程的中间物，落盘既撑爆配额又毫无用处。 */
function trendSnapshot(t) {
  return {
    lat: t.lat, lon: t.lon, name: t.name, day0: t.day0,
    sD: t.sD, eD: t.eD, n: t.n, ecOK: t.ecOK, aqOK: t.aqOK, rows: t.rows
  };
}
function trendCacheGet(dayMs) {
  try {
    const s = localStorage.getItem(trendKeyOf(dayMs));
    if (!s) return null;
    const j = JSON.parse(s);
    if (!j || !j.obj || Date.now() - j.ts > TREND_CACHE_TTL) return null;
    /* 结构校验：rows 必须是数组且非空 —— 一个残缺的 rows 会让 renderTrend
       渲染出一张空表，而不是"没缓存"。宁可当无缓存重取（与 mapCacheGet /
       pointCacheGet 对旧结构的处理同一思路）。 */
    const o = j.obj;
    if (!Array.isArray(o.rows) || !o.rows.length) return null;
    if (typeof o.sD !== "string" || typeof o.eD !== "string") return null;
    return o;
  } catch (e) { return null; }
}
function trendCachePut(dayMs, obj) {
  /* 与 mapCachePut / pointCachePut 不同，这里**不挪到空闲回调**：一条只有约 1 KB，
     同步序列化是微秒级，而挪走反而会引入"写好没有"的时序问题（趋势没有 LRU
     那样的淘汰竞态要防）。 */
  const key = trendKeyOf(dayMs);
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), obj }));
    mapCacheSweep(key);        // 写完立刻收一遍，别等配额满了才发现
  } catch (e) { mWarn("写趋势缓存失败（可能配额不足或隐私模式）", e); }
}

/* 当前时段的数据集 */
function mapSet() {
  const dateS = MapMod.curDate || $("#mapDateSel").value || State.dateStr;
  const box = MapMod.data[dateS];
  return box ? box[State.mapPeriod || "pm"] : null;
}

async function loadMapData(force, cacheOnly) {
  if (!MapMod.ok) { mapSetLoad(false); return false; }
  const dateS = $("#mapDateSel").value || State.dateStr;
  const per = State.mapPeriod || "pm";
  MapMod.curDate = dateS;
  /* 令牌 + 进度回调：本次调用之后若又发起了新的取数，本函数的一切界面副作用都要收敛，
     包括加载文案、失败提示与遮罩开关 —— 它们都属于"最新一次请求"。 */
  const seq = ++MapMod.reqSeq;
  const cur = () => seq === MapMod.reqSeq;
  const load = txt => { if (cur()) mapSetLoad(true, txt); };
  /* 标签统一由 updateMapTag() 负责（含模型名），失败态也能正确显示 */
  updateMapTag();
  /* 命中本地数据 / 缓存是无等待的快路径。这里必须顺手关掉遮罩：
     若上一次请求（别的日期）还在飞，它的遮罩会一直挂着不灭，而它返回时又会被令牌拦住，
     结果是"界面永远停在加载中"。遮罩的开关权只属于当前这次请求。 */
  if (MapMod.data[dateS] && MapMod.data[dateS][per] && !force) {
    mapSetLoad(false); paintMap(); return true;
  }
  if (!MapMod.data[dateS] && !force) {
    const c = mapCacheGet(dateS);
    if (c && c.am && c.pm) { MapMod.data[dateS] = c; mapDataTouch(dateS); mapSetLoad(false); paintMap(); return true; }
  }
  /* ---- cacheOnly：**只查缓存，绝不取数**（autoLoadMapFromCache 专用）----
     走到这里说明上面两条快路径都没命中 —— 也就是"没有缓存可用"。
     位置刻意放在快路径之后、任何网络调用之前：于是"自动加载不会烧额度"这件事
     由**这一行**硬保证，而不是靠调用方复制一份条件去跟上面两行对齐
     （镜像条件迟早会漂移 —— 那正是硬约束 9 最怕的事）。
     返回 false 让调用方知道"没画出来"，好去渲染待加载引导；
     这条路径**不动任何界面状态**（进度条/标签都保持在原来的样子）。 */
  if (cacheOnly) return false;

  mapSetLoad(true, i18n("正在取模式数据（周边 {n} 个网格点，朝/晚霞共用）…", { n: mapPts().length }));
  let box;
  try {
    const [Y, M, D] = dateS.split("-").map(Number);
    const dayMs = Date.UTC(Y, M - 1, D);
    const meta = [];
    /* 局部网格点（B13）替代原先固定的 152 个全国城市。点项形状与城市项一致，
       所以下面这段与旧实现逐字相同 —— 变化只在"点从哪来"。 */
    const ptList = mapPts();
    const cityPts = ptList.map(c => ({ lat: c.lat, lon: c.lon }));
    ptList.forEach(c => {
      const ev = sunEvents(dayMs, c.lat, c.lon);
      const fix = m => (m == null ? ev.noonMs + 12 * 3600000 : m);
      const riseMs = fix(ev.riseMs), setMs = fix(ev.setMs);
      meta.push({
        city: c, riseMs, setMs,
        azR: solarPosition(riseMs, c.lat, c.lon).azimuth,
        azS: solarPosition(setMs, c.lat, c.lon).azimuth,
        v: sunsetSpeedKmph(Math.abs(c.lat), new Date(dayMs)),
        omR: sunAltRate(riseMs, c.lat, c.lon), omS: sunAltRate(setMs, c.lat, c.lon)
      });
    });

    const sD = dateS, eD = dateS;
    /* 顺序请求 + 组间留白：多坐标请求按坐标计费，并发突发容易触发限流 */
    load(i18n("正在取 GFS 模式数据…"));
    const gD = await apiForecastBatched(MODEL_NAME.gfs, cityPts, sD, eD, MAP_TZ, F_MAP_VARS);
    if (!cur()) return;
    await sleep(300);
    if (!cur()) return;
    load(i18n("正在取 ECMWF 模式数据…"));
    const eD2 = await apiForecastBatched(MODEL_NAME.ec, cityPts, sD, eD, MAP_TZ, F_MAP_VARS).catch(() => null);
    if (!cur()) return;
    await sleep(300);
    if (!cur()) return;
    load(i18n("正在取气溶胶数据…"));
    const aD = await apiAQBatched(cityPts, sD, eD, MAP_TZ).catch(() => null);
    if (!cur()) return;
    load(i18n("正在计算 {n} 个网格点…", { n: ptList.length }));
    const sG = gD.map(makeSeries);
    const sE = eD2 ? eD2.map(makeSeries) : null;
    const sA = aD ? aD.map(makeSeries) : null;
    /* 综合场：逐城市把两套模式逐时平均 */
    const sM = sG.map((g, i) => mergeSeries(g, sE ? sE[i] : null));

    /* 样带外点（沿日出/日落方位，与单点同长的 TRANSECT 0…400 km）不额外请求接口，
       而是用采样网格对云场做反距离加权插值推求 —— 已在图例中说明该近似。

       权重只跟**目标点位置**有关、与变量无关，所以按「网格点 × 样带点」预算一次、
       4 个变量共用。若照 idwSample 那样每个变量各算一遍，57 点 × 16 外点 × 4 变量
       × 2 时段要算 150 万次球面距离（每个都含三角函数），会明显卡住取数。 */
    const fieldAt = (sers, key, ms) => sers.map(s => (s ? s.at(key, ms) : null));
    const idwPlan = (lat, lon) => {
      const idx = [], w = [];
      let sw = 0, near = 1e9, best = -1;
      for (let i = 0; i < cityPts.length; i++) {
        const d = haversineKm(lat, lon, cityPts[i].lat, cityPts[i].lon);
        if (d < near) { near = d; best = i; }
        if (d < 1e-6) return { exact: i };          // 正好落在采样点上：取它自己的值
        const ww = 1 / (d * d);
        idx.push(i); w.push(ww); sw += ww;
      }
      return near > MAP_IDW_MAX ? null : { idx, w, sw, best };
    };
    /* 与 idwSample 同语义：只累加**有值**的点；全无有效值则返回 null
       （此时最近点本身也没值，原实现返回的 best 同样是 null）。 */
    const idwOf = (plan, vals) => {
      if (!plan) return null;
      if (plan.exact != null) return vals[plan.exact];
      let sw = 0, sv = 0;
      for (let j = 0; j < plan.idx.length; j++) {
        const v = vals[plan.idx[j]];
        if (!isNum(v)) continue;
        sw += plan.w[j]; sv += plan.w[j] * v;
      }
      return sw ? sv / sw : null;
    };

    /* 本期数据缺什么，明确写进 note：地图端据此禁用对应模型并给出可操作提示 */
    const notes = [];
    if (!sE) notes.push(i18n("ECMWF-IFS 模式本次未能取到数据"));
    if (!sA) notes.push(i18n("气溶胶（AOD）数据缺失，已按默认值 0.25 估算"));
    const note = notes.join(LANG === "en" ? "; " : "；");
    box = {
      am: { pts: [], dateS, period: "am", note },
      pm: { pts: [], dateS, period: "pm", note }
    };
    const once = (ci, evMs, om, az) => {
      /* 样带与单点**完全同构**：用同一张 TRANSECT（0/25/…/400 km，17 点）。
         这一点很关键 —— analyseTransect 里 `step = transect[1].d − transect[0].d`
         并且"云盘延伸到样带之外"时 `dFar = 最末点.d + step`，
         所以**步长不同就会算出不同的云边界距离**：旧实现只有 2 点（0 与 250），
         step=250 ⇒ dFar=500 km，而单点同口径是 400+25=425 km。
         两个入口因此对同一片云给出不同的几何结论。
         取值来源仍然不同（d=0 是本网格点自己的真实值，其余 16 点由云场 IDW 推求），
         但那只是"真实样带 vs 插值样带"的精度差，不再是口径差。 */
      const trOf = (sers) => {
        if (!sers || !sers[ci]) return null;
        const base = meta[ci].city;
        const cv = (k) => sers[ci].at(k, evMs);
        /* d = 0：本地点，取真实值 */
        const rows = [{
          d: 0, cLow: cv("cloud_cover_low"), cMid: cv("cloud_cover_mid"), cHigh: cv("cloud_cover_high"),
          vis: cv("visibility"), rh: cv("relative_humidity_2m"), aod: null
        }];
        for (let i = 1; i < TRANSECT.length; i++) {
          const d = TRANSECT[i];
          const tp = destPoint(base.lat, base.lon, az, d);
          const plan = idwPlan(tp.lat, tp.lon);
          rows.push({
            d,
            cLow: idwOf(plan, fieldAt(sers, "cloud_cover_low", evMs)),
            cMid: idwOf(plan, fieldAt(sers, "cloud_cover_mid", evMs)),
            cHigh: idwOf(plan, fieldAt(sers, "cloud_cover_high", evMs)),
            vis: idwOf(plan, fieldAt(sers, "visibility", evMs)),
            rh: null, aod: null
          });
        }
        return rows;
      };
      const sAod = a => (a && a[ci]) ? a[ci].at("aerosol_optical_depth", evMs) : null;
      const trG = trOf(sG), trE = trOf(sE), trM = trOf(sM);
      if (!trG) return null;
      const aodUse = isNum(sAod(sA)) ? clamp(sAod(sA), 0.005, 5) : 0.25;
      [trG, trE, trM].forEach(tr => { if (tr) tr.forEach(x => { x.aod = aodUse; }); });
      const envOf = (sers) => {
        const env = buildEnv(sers && sers[ci] ? sers[ci] : null, evMs);
        env.aod = aodUse;
        return env;
      };
      const envG = envOf(sG), envE = sE ? envOf(sE) : null, envM = envOf(sM);
      if (envE) ["fz", "blh", "vis", "cape", "precip"].forEach(k => { if (!isNum(envE[k]) && isNum(envG[k])) envE[k] = envG[k]; });
      const ctx = { v: meta[ci].v, omega: om, aod: aodUse };
      const rt = scoreRay(envM, analyseTransect(trM, primaryDeck(envM).primary.key), ctx);
      const sGs = scoreStat(envG, analyseTransect(trG, primaryDeck(envG).primary.key), ctx);
      let sEs = null;
      if (envE) sEs = scoreStat(envE, analyseTransect(trE, primaryDeck(envE).primary.key), ctx);
      /* 各模型独立结果：某一模型本次算不出来时显式记 null，
         地图端据此禁用该项并自动回退到综合，不会留下空白色面 */
      const p = { ens: null, gfs: sGs.P, ec: sEs ? sEs.P : null, rt: rt.P };
      const q = { ens: null, gfs: sGs.Q, ec: sEs ? sEs.Q : null, rt: rt.Q };
      /* 综合＝非空子集按 W_ENS 重新归一后的加权几何平均（与"各模型独立结果"同口径） */
      const parts = [{ P: sGs.P, Q: sGs.Q, w: W_ENS.gfs }];
      if (sEs) parts.push({ P: sEs.P, Q: sEs.Q, w: W_ENS.ec });
      parts.push({ P: rt.P, Q: rt.Q, w: W_ENS.rt });
      const P = wgeo(parts.map(x => [x.P, x.w]));
      const Q = wgeo(parts.map(x => [x.Q, x.w]));
      p.ens = P; q.ens = Q;
      return {
        name: meta[ci].city.name, prov: meta[ci].city.region,
        lat: meta[ci].city.lat, lon: meta[ci].city.lon,
        P, Q, p, q, grade: gradeOf(Q), type: rt.primary.type, cover: rt.primary.cover,
        base: rt.primary.base, d: rt.d, dur: rt.geom.dur, aod: aodUse,
        T550: rt.peak.T550, color: hexA(rampColor("pm", mixedIndex(P, Q)), 0.95)
      };
    };
    meta.forEach((m, ci) => {
      const pm = once(ci, m.setMs, m.omS, m.azS);
      const am = once(ci, m.riseMs, m.omR, m.azR);
      if (pm) box.pm.pts.push(pm);
      if (am) box.am.pts.push(am);
    });

  } catch (e) {
    console.warn("地图数据获取失败", e);
    /* 已经切换到别的日期/时段了 → 这次失败与当前界面无关，不打扰用户 */
    if (!cur()) return;
    const st = e && e.status;
    /* friendly 优先（口径同 _p5.js）：429 分两类，处置方式完全相反。
       并且在不可恢复时**不显示「重试」按钮** —— 给一个点下去必然失败的按钮，
       比不给按钮更糟，它会让用户反复点、把时间耗在一件做不到的事上。 */
    const fatal = !!(e && e.fatal);
    const head = (e && e.friendly) ? e.friendly
      : e && e.timeout
        ? i18n("气象接口响应超时，请检查网络后重试；若长期如此，可能是当前网络到接口的链路不稳定。")
        : st === 429
          ? i18n("气象接口暂时限流（同一 IP 请求过于频繁），请稍候 1 分钟后重试。")
          : i18n("地图数据获取失败（{m}）。", { m: (e && e.message ? e.message : i18n("网络异常")) });
    mapShowError(head + (fatal ? i18n("额度会在次日重置，之后即可恢复。") : ""), !fatal);
    return;
  }
  /* 结果已过期：丢弃，不写缓存、不画图、不动遮罩（遮罩归最新一次请求管） */
  if (!cur()) return;
  /* 渲染与缓存同取数解耦：渲染异常不应伪装成“取数失败” */
  MapMod.data[dateS] = box;
  mapDataTouch(dateS);
  markCachedDates();
  mapCachePut(dateS, box);
  try {
    paintMap();
  } catch (e2) {
    console.warn("地图渲染失败", e2);
  }
  mapSetLoad(false);
}
const avgv = (a, b) => (isNum(a) && isNum(b)) ? (a + b) / 2 : (isNum(a) ? a : (isNum(b) ? b : null));

/* 注：原先这里有一个通用的 idwSample()，用于把云场外推到样带外点。
   A1 之后地图样带改成与单点同构的 17 点，同一目标点要对 4 个变量各插一次值，
   于是拆成了 loadMapData 里的 idwPlan（按目标点算权重，只算一次球面距离）
   + idwOf（把权重套到任意变量上）。语义不变：只累加有值的点、超出 MAP_IDW_MAX 返回 null。
   通用版本已无调用方，删除以免留下"两处 IDW 实现"的隐患。 */

/* ---- 算法模型 ----
   与"各模型独立结果"完全同源：同一次取数里三套模型都已经算好，切换模型只重绘、不重新请求。
   多模型综合＝ GFS / ECMWF / 光追 的空缺剔除后按 W_ENS 权重做加权几何平均（与单点结论同口径）。 */
const MAP_MODELS = [
  { k: "ens", name: "多模型综合", desc: "GFS / ECMWF / 光追 加权几何平均" },  // name/desc 展示时均过 i18n
  { k: "gfs", name: "GFS", desc: "NOAA 全球模式 · 云属/湿度统计评分" },
  { k: "ec", name: "ECMWF-IFS", desc: "欧洲中心全球模式 · 云属/湿度统计评分" },
  { k: "rt", name: "光追算法", desc: "纯物理：多波长光路积分 + CIE 色度" }
];
function modelName(k) {
  const m = MAP_MODELS.find(x => x.k === k);
  return i18n(m ? m.name : "多模型综合");
}
/* 某点在指定模型下的出现概率 / 观赏质量（该模型无结果时返回 null） */
function modelP(o, mk) { return (o && o.p) ? (isNum(o.p[mk]) ? o.p[mk] : null) : null; }
function modelQ(o, mk) { return (o && o.q) ? (isNum(o.q[mk]) ? o.q[mk] : null) : null; }
/* 该模型下有多少城市算出了结果（ens 走自身字段，缺字段的旧缓存点不计入） */
function modelCount(d, mk) {
  if (!d || !d.pts) return 0;
  if (mk === "ens") {
    let n = 0;
    for (const o of d.pts) if (isNum(o.P) || isNum(modelP(o, "ens"))) n++;
    return n;
  }
  let n = 0;
  for (const o of d.pts) if (isNum(modelP(o, mk)) && isNum(modelQ(o, mk))) n++;
  return n;
}
/* 模型分歧：同一点上三套独立模型算出的综合指数 I 的极差（max − min）。
   为什么不直接用 P 或 Q 的极差：I 才是"综合指数"维度下真正被着色的那个量，
   分歧也应该在同一个量上度量，否则"分歧大的地方"与"颜色可疑的地方"不是同一片区域。
   少于两套模型有结果时返回 null（一个值谈不上分歧）—— 这一条很关键：
   否则 EC 取数失败那天，全图的分歧会是 0（只有一个值），看起来像"三模型高度一致"，
   正好把最该被提示的情况伪装成最可信的情况。 */
function divergeOf(o) {
  let lo = Infinity, hi = -Infinity, n = 0;
  for (const k of DV_MODELS) {
    const P = modelP(o, k), Q = modelQ(o, k);
    if (!isNum(P) || !isNum(Q)) continue;
    const v = mixedIndex(P, Q);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    n++;
  }
  return n >= 2 ? hi - lo : null;
}
/* 取色值：dim = p(概率) / q(质量) / mix(综合指数 I) / dv(模型分歧) */
function dimOf(o, dim, mk) {
  /* 分歧维度与"当前选中哪个模型"无关（它度量的是三个模型之间），
     所以必须在取 mk 之前分流 —— 否则切模型会让这张图莫名其妙地变。 */
  if (dim === "dv") return divergeOf(o);
  mk = mk || "ens";
  const P = modelP(o, mk), Q = modelQ(o, mk);
  if (dim === "p") return P;
  if (dim === "q") return Q;
  if (isNum(P) && isNum(Q)) return mixedIndex(P, Q);
  return isNum(P) ? P : Q;
}
/* 兼容用法：默认取多模型综合 */
function dimValue(o, dim) { return dimOf(o, dim, "ens"); }
/* 当日值域（色阶拉伸区间）的缓存。
   showMapTip 与 paintMap 都要它，而它的输入是"整份点集 × 当前维度 × 当前模型"——
   每次重算就是一次 57 元素的数组分配加一遍 min/max，而悬停是每秒几十次的路径。
   键用「数据对象引用 + 维度 + 模型」三元组：换日期或时段会换掉 mapSet() 返回的对象
   引用，换维度或模型会改后两项，任一变化都必然失效，不需要额外的清理钩子
   （换地点会整体作废数据，引用自然也变）。 */
function mapRangeOf(d, dim, mk) {
  const c = MapMod.rangeCache;
  if (c && c.d === d && c.dim === dim && c.mk === mk) return c.R;
  const R = scaleRange(d.pts.map(p => dimOf(p, dim, mk)));
  MapMod.rangeCache = { d: d, dim: dim, mk: mk, R: R };
  return R;
}

/* 当前该用哪个模型 —— **纯函数**：只读，不碰 State、不碰 DOM。
   只读路径（悬停、排行榜、图例）必须用这个：此前它们调用的是带副作用的版本，
   于是"鼠标在地图上划一下"就会把 State.mapModel 改回 ens 并清掉回退标记，
   用户看到的"已自动切换"提示会莫名其妙消失。 */
function currentModel(d) {
  const want = State.mapModel || "ens";
  if (!d || modelCount(d, want) > 0) return want;
  return "ens";
}
/* 在 currentModel 的基础上补做"把界面切回去"的副作用：改 State、改下拉框、记回退标记。
   只在 paintMap() 里调用（一次绘制恰好做一次界面校正）。 */
function ensureModel(d) {
  const want = State.mapModel || "ens";
  const mk = currentModel(d);
  if (mk === want) { MapMod.modelFallback = null; return mk; }
  MapMod.modelFallback = want;              // 交给 refreshModelNote 统一出提示文案
  State.mapModel = "ens";
  const sel = $("#mapModel");
  if (sel) sel.value = "ens";
  return "ens";
}
function modelNote(cls, html) {
  const el = $("#modelNote");
  if (!el) return;
  if (!cls || !html) { el.style.display = "none"; el.innerHTML = ""; el.className = "hint"; return; }
  el.className = "note " + cls;
  el.innerHTML = html;
  el.style.display = "";
}
/* 按"本期数据里各模型是否有结果"刷新下拉框（只在可用性变化时重建，避免打断交互） */
function syncModelSel(d) {
  const sel = $("#mapModel");
  if (!sel) return;
  const cur = State.mapModel || "ens";
  const ok = MAP_MODELS.map(m => m.k === "ens" || (d && modelCount(d, m.k) > 0));
  const sig = ok.map(x => (x ? "1" : "0")).join("");
  if (sel.dataset.sig !== sig) {
    sel.dataset.sig = sig;
    sel.innerHTML = MAP_MODELS.map((m, i) =>
      `<option value="${m.k}"${ok[i] ? "" : " disabled"}>${i18n("模型：{v}", { v: i18n(m.k === "ens" ? "多模型综合" : m.name) })}` +
      `${ok[i] ? "" : i18n("（本次无数据）")}</option>`).join("");
  }
  sel.value = MAP_MODELS.some(m => m.k === cur) ? cur : "ens";
}
/* 本期数据的可用性说明（数据缺失时给出可操作的提示） */
function refreshModelNote(d) {
  if (!d) { modelNote(null); return; }
  const miss = MAP_MODELS.filter(m => m.k !== "ens" && modelCount(d, m.k) === 0).map(m => m.name);
  const fb = MapMod.modelFallback;
  if (fb) {
    /* 用户选了某模型，但本期没有它的结果 → 自动回退到综合，必须说清楚 */
    const others = miss.filter(n => n !== modelName(fb));
    modelNote("bad", `<b>${i18n("已自动切换为多模型综合")}</b>：${i18n("所选模型「{v}」在本次取数中没有可用结果", { v: modelName(fb) })}` +
      (d.note ? `（${d.note}）` : "") + "。" +
      (others.length ? i18n("另外 {v} 也没有可用结果。", { v: listJoin(others) }) : "") +
      i18n("多模型综合会自动剔除缺失模型后重新归一。可点「刷新地图」重试，或改选其它模型。"));
    return;
  }
  const parts = [];
  if (miss.length) parts.push(listJoin(miss) + " " + i18n("本次没有可用结果，已在选择框中禁用"));
  if (d.note) parts.push(d.note);
  if (parts.length) { modelNote("warn", parts.join(LANG === "en" ? "; " : "；") + i18n("。多模型综合会自动剔除缺失模型后重新归一。")); return; }
  const mk = State.mapModel || "ens";
  if (mk !== "ens") {
    const n = modelCount(d, mk), tot = d.pts.length;
    if (n < tot) {
      modelNote("warn", i18n("当前模型（{v}）有 {n}/{t} 个点算出结果，色面按这些点插值。", { v: modelName(mk), n: n, t: tot }));
      return;
    }
  }
  modelNote(null);
}
function updateMapTag() {
  const el = $("#mapTag");
  if (!el) return;
  const dateS = MapMod.curDate || $("#mapDateSel").value || State.dateStr;
  const per = (State.mapPeriod || "pm") === "am" ? "朝霞" : "晚霞";
  const mk = State.mapModel || "ens";
  /* 分歧维度下"哪个模型"是无意义的（它度量的就是模型之间），
     标签里不要留一个会让人误以为"这是 GFS 的分歧"的模型名。 */
  const tail = (State.mapDim || "mix") === "dv" ? "模型分歧"
    : (mk === "ens" ? "多模型综合" : modelName(mk));
  el.textContent = dateS + " · " + per + " · " + tail;
}
function paintMap() {
  const d = mapSet();
  if (!d || !MapMod.ok) return;
  const mode = d.period, dim = State.mapDim || "mix";
  const mk = ensureModel(d);
  syncModelSel(d);
  updateMapTag();
  /* 分歧维度下"选哪个模型"没有意义 —— 它度量的就是模型之间。
     置灰而不是留着可选：留着会让用户以为"这张图 = 所选模型的分歧"。 */
  const mSelEl = $("#mapModel");
  if (mSelEl) mSelEl.disabled = (dim === "dv");
  /* 兜底：本次数据里没有可用数值（例如缓存结构异常）。
     此时**不清空**上一次的色面 —— 清空会留下一张"看着正常但其实没数据"的白图，
     用户无从分辨；改为保留上一次的成功色面并整体置灰，同时在提示区说明情况。 */
  const dimVals = d.pts.map(o => dimOf(o, dim, mk)).filter(isNum);
  if (!dimVals.length) {
    MapMod.stale = true;
    /* 若上一次已画过（有 strips），保留下来的就是上一次的结果；否则连底都没有 */
    const had = !!(MapMod.strips && MapMod.strips.length);
    if (MapMod.layer) MapMod.layer.classList.toggle("on", had);
    if (MapMod.layer) MapMod.layer.classList.add("stale");
    /* 等值线要跟着一起置灰：它的线是上一次色面的档界，单独留在那儿会被当成当前结果。
       只压 opacity、不碰 filter —— .mapwrap.dark 已经把 invert 挂在同一个元素上了，
       再加一条 filter 会把它顶掉（见 template 里 .rlayer.stale 的同类问题）。 */
    if (MapMod.gridLayer) {
      MapMod.gridLayer.classList.toggle("on", had);
      MapMod.gridLayer.classList.add("stale");
    }
    modelNote("bad", dim === "dv"
      ? i18n("本次取数中没有任何点位同时具备两套以上模型的结果，无法计算模型分歧。") +
        i18n("多半是 ECMWF-IFS 那一路整批缺失 —— 此时若把分歧画成“全图一致”会是彻头彻尾的误导。") +
        (had ? i18n("地图上显示的是<b>上一次成功渲染的色面</b>（已置灰），请不要按当前日期与时段解读。") : "") +
        i18n("请点「刷新地图」重新取数。")
      : i18n("本次取数中「{v}」没有任何可用数值，无法着色。", { v: mk === "ens" ? i18n("多模型综合") : modelName(mk) }) +
        (had ? i18n("地图上显示的是<b>上一次成功渲染的色面</b>（已置灰），请不要按当前日期与时段解读。") : "") +
        i18n("请点「刷新地图」重新取数。"));
    renderRank();
    updateLegend({ lo: 0, hi: 100 }, mode, mk);
    return;
  }
  /* 有数据了：解除陈旧标记 */
  MapMod.stale = false;
  if (MapMod.layer) MapMod.layer.classList.remove("stale");
  /* 当日实际值域：色阶按它线性拉伸，地域差异才看得出来。
     顺手把结果填进 mapRangeOf 的缓存（dimVals 这里已经算过，不额外开销），
     悬停提示随即命中，不必自己再来一遍 57 元素的 map + min/max。 */
  const R = scaleRange(dimVals);
  MapMod.rangeCache = { d: d, dim: dim, mk: mk, R: R };

  /* 本次真正画出来的那张色面（降级渲染时为 null）—— 排行榜的可见性判据要用它，
     所以必须是**本次**的，不能读 MapMod.field 那个可能还停在上一次的对象。 */
  let fld = null;
  if (MapMod.rasterOK) {
    const f = buildField(d.pts, dim, mk, R, mode);
    if (f) {
      MapMod.field = f;
      fld = f;
      MapMod.strips = buildStrips(f);
      buildConfStrips(f);
      /* 几何只算一次（换日期/时段/模型才重算）；投影与描边每帧走 fitRaster → drawContours */
      buildContourGeometry(f);
      if (MapMod.gridLayer) MapMod.gridLayer.classList.remove("stale");
      refreshGrid();
      fitRaster();
    }
  } else if (MapMod.polys) {
    const byProv = {};
    d.pts.forEach(o => {
      const v = dimOf(o, dim, mk);
      if (isNum(v)) (byProv[o.prov] = byProv[o.prov] || []).push(v);
    });
    paintProvince(byProv, mode, R);
  }
  refreshModelNote(d);
  /* 把**本次**的色面传进去：榜单只列图上真画出来的点（见 mapVisibleAt）。
     传参而不是读 MapMod.field，是因为"无可用数值"那条提前返回的路径上
     MapMod.field 还停在上一次的对象上。 */
  renderRank(fld);
  updateLegend(R, mode, mk);
  renderLabels();
  /* 数据换了一批，之前下钻出来的省份清单里的数值已经过期 —— 收起它，
     免得用户拿着旧数字做判断。 */
  renderDrill(null);
}

function updateLegend(R, mode, mk) {
  mode = mode || (State.mapPeriod || "pm");
  mk = mk || State.mapModel || "ens";
  const lo = R ? R.lo : 0, hi = R ? R.hi : 100;
  /* 色条＝与栅格**逐档同色**的硬停止渐变（见 bandGradientCss）。
     8 个 <i> 只是等分占位，本身不着色 —— 这样图例与地图上的颜色一定一致。
     用硬停止而不是热力渐变：地图上现在是 N_BANDS 档离散色，图例要是还画成连续过渡，
     用户就会以为图上是渐变的，反倒觉得地图"糊"。 */
  const bar = $("#lgBar");
  bar.style.background = bandGradientCss();
  bar.innerHTML = "<i></i>".repeat(8);
  const tick = bar.nextElementSibling;
  /* 刻度直接标出真实数值（色阶两端＝当日最低/最高） */
  if (tick) tick.innerHTML = [0, 20, 40, 60, 80, 100]
    .map(v => `<span>${Math.round(lo + (hi - lo) * v / 100)}</span>`).join("");
  const dim = State.mapDim || "mix";
  const dimTxt = dim === "p" ? i18n("出现概率 P") : dim === "q" ? i18n("观赏质量分 Q")
    : dim === "dv" ? i18n("模型分歧 ΔI") : i18n("综合指数 I");
  /* 等级行：质量档直接由 QUALITY_BANDS 推导（区间文案 + 代表色位置），
     不再手抄一份阈值 —— 等级边界只有一处定义。概率档是 P 自己的区间，与质量等级无关。
     分歧档的边界是"分数"尺度（ΔI 就是综合指数的极差），所以也按分数区间写，
     但语义相反：越红＝模型之间越不一致。 */
  const lv = dim === "p"
    ? [[90, i18n("概率高（≥80%）")], [72, i18n("概率较高（65–79%）")], [55, i18n("概率一般（45–64%）")], [30, i18n("概率低（&lt;45%）")]]
    : dim === "dv"
      ? [[88, i18n("分歧大（ΔI ≥ 30 分）")], [70, i18n("分歧较大（20–29 分）")],
         [52, i18n("分歧中等（10–19 分）")], [26, i18n("分歧小（&lt;10 分）")]]
      : QUALITY_BANDS.map(b => [bandMid(b), i18n(b.key) + "（" + bandRangeHtml(b, i18n("分")) + "）"]);
  $("#lgRows").innerHTML = lv.map(x =>
    `<span><i class="chipc" style="background:${bandColor(mode, 100 * scaleT(x[0], lo, hi))}"></i>${x[1]}</span>`).join("");
  /* 色阶与算法模型无关（白＝低、红＝高），变的是各模型的数值本身；
     所以图例只需把"当前用的是哪套模型、用的是它的哪个维度"说清楚。 */
  const modelLine = dim === "dv"
    ? i18n("当前着色依据是<b>模型分歧</b>：GFS / ECMWF / 光追 三套模型各自算出的综合指数 取<b>极差 ΔI = max − min</b>。<b>它与“当前选中哪个模型”无关</b>，所以算法模型下拉框在本维度下不可选。分歧大不等于霞光差，而是<b>这次预报本身没把握</b> —— 越红越应该以单点精细结果为准。")
    : mk === "ens"
      ? i18n("当前算法模型：<b>多模型综合</b>（GFS / ECMWF / 光追 按 0.30 / 0.34 / 0.36 加权几何平均；某模型缺数据时自动剔除并重新归一）。")
      : i18n("当前算法模型：<b>{v}</b>（{desc}）。色面只由该模型自己的结果生成，与其它模型无关。", { v: modelName(mk), desc: i18n((MAP_MODELS.find(x => x.k === mk) || {}).desc || "") });
  $("#lgNote").innerHTML = modelLine +
    i18n("统一色阶：<b>白 → 黄 → 橙 → 红</b>，色面按 <b>{bands} 档分级填色</b>（同一档内同色），档与档之间描一条<b>等值线</b>把等级边界显式画出来 —— 低端几档颜色本来就接近，只有颜色变化时远看仍是一团，有一条线才数得清跨了几级。<b>最浅一档＝当日最低值、最红一档＝当日最高值</b>，{scale}朝霞 / 晚霞、各算法模型、各着色维度共用同一条色阶、同一套分档。<br>当前着色依据：<b>{dim}</b>。{mixRule}<br>地图只覆盖<b>以查询为中心约 {radius} km</b> 的范围（约 {pts} 个网格点，间距 {grid} km）。<b>图上只保留中国境内、以及国界向外 {mask} km 以内的区域</b>：更远的境外陆域与远海会被裁掉，所以图面的边界不是数据的边界 —— <b>被裁掉的区域不是“没有数据”，只是不显示</b>；下方榜单也只列图面上看得见的点。<br>颜色不是唯一的编码，五个勾选项：<b>数值直标</b>标出数值最高的一批网格点 · <b>采样点</b>画出全部采样点并标出查询点 · <b>可信度</b>给外推区铺一层灰纱 · <b>深色底图</b>把底图整体翻成深色，让接近白色的低值区更容易分辨 · <b>经纬网</b>开关底层那张 {gdeg}° 坐标网。<br>那张 <b>{gdeg}° 经纬网</b>（细灰线，标了度数与 N/E）是地图坐标参照、与色面无关：等值线告诉你“值跨了一级”，经纬网告诉你“这里是哪”。<br><b>虚线多边形＝数据范围边界</b>（{pts} 个采样点的凸包）：线内是<b>插值</b>，线外到色面淡出处（约 {out} km）是<b>外推</b>、越往外越不可信。颜色再浅，只要在虚线以内就代表<b>“这里算过、就是这个值”</b>，而不是空白。<br><b>悬停</b>查看该处数值与数据可信度；<b>点击地图、或下方榜单的任意一行</b>，都可以该处发起单点精细查询（含 400 km 样带与光追模型）。", {
      bands: N_BANDS, dim: dimTxt, radius: MAP_RADIUS_KM, pts: mapPts().length, grid: MAP_GRID_KM,
      mask: MASK_KEEP_KM, gdeg: GRAT_DEG, out: FIELD_OUT_KM,
      scale: i18n(dim === "dv" ? "颜色越靠红代表<b>三套模型之间分歧越大</b>（越不确定）。" : "颜色越靠红代表概率越高、质量越好。"),
      mixRule: dim === "mix" ? i18n("两个维度合并规则：<b>I = 0.55×出现概率 + 0.45×观赏质量分</b>，再映射到色阶。") : ""
    });
  /* M2-3：细节说明默认收起。第一次读需要、之后再也不看的那几段放这里，
     实测它单独占 480 px（整张地图卡片 1713 px）。 */
  $("#lgMore").innerHTML =
    (dim === "dv" ? i18n("某点只有一套模型有结果时 ΔI 无意义，该点不上色；<b>EC 取数失败时不是“分歧为 0”</b>，而是大面积不上色 —— 这是在提示“少了一套模型”。<br>") : "") +
    i18n("为避免地域差异被压缩，色阶按<b>当日该模型实际值域 {lo}–{hi}</b> 线性拉伸（刻度即真实数值），再切成 {bands} 档 —— 所以要看清“哪一块和哪一块是一档”，看的是<b>区域</b>而不是色深；最低那一档接近白色、与浅色底图接近属正常现象（可勾选<b>「深色底图」</b>让低值区更容易分辨；也可以看那条<b>虚线数据范围边界</b> ——颜色再浅，只要落在虚线以内就是“算过且有值”）。<br>地图上只有<b>数值高低</b>这一种颜色含义，与结论卡片里按等级着色的徽章（优绿 / 差红）是两套独立配色，请勿混看。降级渲染（按省着色）时，<b>灰色省区＝该省所有城市都没有可用数据</b>，与“数值很低（白）”是两回事。<br>每个网格点取一次模式数据，其朝/晚霞方向 0–400 km 的云况由网格反距离加权插值推求（样带几何与单点一致，但取值非逐点精细样带）。单点精细结果请使用上方查询。<br><b>换一个查询地点会重新采样、重新取数</b>（挪动不超过 {keep} km 时沿用现有网格，不重复取数）；范围外的区域不参与计算，所以图上不会出现本范围之外的颜色。<br>色面按地理范围贴合底图，<b>颜色只由数值决定、与缩放级别无关</b>：放大只是看局部，不会丢失颜色。<br>勾选<b>「数值直标」</b>会在图上标出数值最高的一批网格点（随缩放级别 8–48 个，越小比例尺标得越少以免互相压盖）；勾选<b>「采样点」</b>会画出全部 {pts} 个采样点，并标出<b>查询点</b>（挪动不超过 {keep} km 而沿用旧网格时，值场中心会与查询点错开，错开超过 5 km 会额外标出<b>值场中心</b>）。<br>勾选<b>「可信度」</b>会在<b>虚线以外、色面淡出之前</b>的那一圈铺一层灰纱：那里已经在<b>外推</b>（不只在采样点的包围范围内），越靠边越不可信。纱只画在叠加层上，<b>不改变色面本身的像素</b>，所以“图上颜色 → 数值”的对应关系不受影响。悬停时给的“可信度”是另一个量 —— <b>该处离最近采样点有多远</b>（包内实测最远 85 km）。", {
      lo: Math.round(lo), hi: Math.round(hi), bands: N_BANDS,
      pts: mapPts().length, keep: MAP_KEEP_KM
    }) +
    `<br><b>点击</b>地图可钉住提示，并看该处所属省份的城市清单；` +
    `地图可用方向键移动、Enter/空格 查看该处数值（键盘用户）。底图由腾讯地图提供。`;
}

/* 数据可信度分级（B12）：入参是"到最近采样点的距离 km"。
   同一张色面上，采样点附近与外圈的颜色看起来一样"确定"，但后者是 IDW 外推出来的。
   这里把这份不确定性显式写出来。
   注：只做文字（+ 一层独立的灰纱，见 buildConfStrips），**不改色面的像素** ——
   色面的透明度若随可信度变化，"像素颜色→数值"就不再是单值映射，
   zoomprobe 的像素级断言会失去意义。
   这里是**逐点的距离读数**，与"纱铺在哪"用的是**两个不同的量**：
     · 纱的边界＝凸包外（色面淡出处），这是"在不在采样区里"；
     · 这里的分档＝到最近采样点的距离，这是"最近的观测点有多远"。
   两者可以不一致，而且必须说清楚：包内也有一半区域距最近点 50 km 以上（仍是插值），
   而贴着凸包顶点外侧一点只有 1.4 km（已是外推）—— 单看距离无法表达"插值/外推"。
   实测：包内 dkm 最大 85.3 km，所以 FIELD_FULL(90) 之内就是"包内插值"那一档。 */
function confOf(km) {
  if (!isNum(km)) return { lv: "低", cls: "cf-lo", txt: "无邻近采样点可比对" };
  if (km <= 1) return { lv: "高", cls: "cf-hi", txt: "数值来自该采样点自身" };
  if (km <= FIELD_FULL) return { lv: "较高", cls: "cf-hi", txt: "距最近采样点 " + Math.round(km) + " km，插值可信" };
  if (km <= FIELD_REACH_KM / 2) return { lv: "中", cls: "cf-mid", txt: "距最近采样点 " + Math.round(km) + " km，由邻近采样点插值" };
  return { lv: "低", cls: "cf-lo", txt: "距最近采样点 " + Math.round(km) + " km，远离采样点、属外推估计" };
}

/* ---- 收起提示卡的唯一入口 ----
   之前"藏卡片"这件事散在 7 处，每处只做 classList.remove("on")。加上手机端的
   "再点一次同一处就收起"之后，只藏卡片会留下两个不一致的状态：
   ① MapMod.pinLL 仍记着上一次钉住的位置 —— 换地点后在新位置点一下，
      若恰好与旧 pinLL 相同就会被误判成"再点一次"而直接收起；
   ② 待处理的那一帧悬停没取消 —— 卡片藏了，下一帧又被弹回来（mouseleave 上踩过）。
   凡是"主动收起"的路径都走这一个函数。showMapTip 内部那两处早退除外：
   那里卡片是被数据否掉的，不是用户主动收起，且 pinLL 没被写过。 */
function hideMapTip() {
  const tip = $("#tip");
  if (tip) {
    tip.classList.remove("on");
    /* **必须同时摘掉 .dock**（第四批真机反馈的根因所在）：窄屏媒体查询里
       `.tip.dock` 带 pointer-events:auto（卡片要能滚能点），而 `.tip` 基础态是
       pointer-events:none + opacity:0。只 remove("on") 的话卡片只是"看不见" ——
       那块 326×302（max-height 72%）、z-index 2000 的**隐形热区仍扣在地图下半部**。
       真机表现：点开过一次卡片、再关掉之后
       ① 地图下半部单指拖不动（触摸全被这块透明卡片吃掉）；
       ② 双指落在这块上时它的 touch-action 是 auto ⇒ 触发**浏览器整页缩放**
          （落在真地图上则被 #map 的 touch-action:none 拦住，所以表现为"有概率"）。
       这正是"部分时候无法滑动地图"的真正根因（此前误判为"卡片开着时挡住屏幕"，
       上一轮加的"拖动收卡"因此不对症 —— 卡片关了以后它还在挡）。
       摘掉 .dock 后卡片回到基础态：pointer-events:none + opacity:0，
       热区消失；下次打开时 showMapTip 的 dock 分支会重新 add("dock")。 */
    tip.classList.remove("dock");
  }
  MapMod.pinLL = null;
  if (MapMod.cancelHover) MapMod.cancelHover();
}

/* ---- 悬停提示 ---- */
function showMapTip(ll, isClick) {
  const d = mapSet();
  const tip = $("#tip");
  if (!d) return;
  const dim = State.mapDim || "mix";
  /* 只读路径：用纯函数取模型，绝不在这里改 State / DOM —— 否则一次悬停就会
     把 paintMap 刚设好的"已自动回退"提示清掉（提示只应随绘制变化，不随鼠标变化）。 */
  const mk = currentModel(d);
  /* 直接在**当前点集**里找最近采样点（B13）。旧实现先查全国城市表、再拿城市名回
     d.pts 里找，局部化之后这条路必然落空 —— 网格点的名字是"上海附近"这类派生名，
     按名字回找永远匹配不上；而且本来也没必要绕这一圈，就近取点更直接。 */
  const nc = nearestCity(ll.lat, ll.lon, d.pts);
  let o = (nc && nc.distKm < CITY_NEAR_KM) ? nc.city : null;
  let v = null, near = nc ? nc.city.name : null;
  /* mind 提到外面：下面计算"数据可信度"时两种分支都要用到它 */
  let mind = 1e9;
  if (o) v = dimOf(o, dim, mk);
  else {
    /* 反距离加权估计：只吃"当前模型下有值"的城市点 */
    let sw = 0, sv = 0;
    for (const p of d.pts) {
      const pv = dimOf(p, dim, mk);
      if (!isNum(pv)) continue;
      const dd = haversineKm(ll.lat, ll.lon, p.lat, p.lon);
      mind = Math.min(mind, dd);
      const w = 1 / Math.pow(dd, 2);
      sw += w; sv += w * pv;
    }
    /* 两道闸门，缺一不可：
       ① 到最近采样点的距离 ≤ TIP_RANGE_KM（= FIELD_REACH_KM，唯一来源）；
       ② 该处的**像素在色面上确实可见** —— 色面边界现在是"凸包 + 羽化"，
          它与 ① 不是同一个判据：凸包顶点外侧 60 km 的地方离最近采样点只有 60 km，
          却已经落在羽化区之外。只查 ① 又会留下"图上没有、悬停却报数值"的环带
          （约束 16 踩过的那个坑，只是环带换了个位置）。 */
    if (mind > TIP_RANGE_KM || !sw || !mapVisibleAt(MapMod.field, ll.lat, ll.lon)) {
      tip.classList.remove("on"); return;
    }
    v = sv / sw;
  }
  if (!isNum(v)) { tip.classList.remove("on"); return; }
  /* 数据可信度（B12）：由"到最近采样点的距离"映射。
     D6 加密后全图平均最近邻已从 224 km 降到 152 km，但最疏处（阿里一带）仍是 500 km 以上，
     但本质是 700 km 半径的 IDW 外推 —— 说得和长三角一样确定是不诚实的。 */
  const nearKm = o ? 0 : mind;
  const cf = confOf(nearKm);
  const P = o ? modelP(o, mk) : null, Q = o ? modelQ(o, mk) : null;
  const grade = isNum(Q) ? gradeOf(Q) : gradeOf(v);
  /* 与地图同源：用当日该模型值域拉伸后的位置取色，色块颜色与地图上该处一致 */
  const R = mapRangeOf(d, dim, mk);
  const c = bandColor(d.period, 100 * scaleT(v, R.lo, R.hi));
  const mkTxt = dim === "dv" ? i18n("模型分歧") : (mk === "ens" ? i18n("多模型综合") : modelName(mk));
  /* 首行＝当前着色依据对应的那个量，避免与下方参考行重复 */
  const mainRow = dim === "p"
    ? `<div class="t3"><span>${i18n("出现概率")}</span><b>${Math.round(isNum(P) ? P : v)}%</b></div>`
    : dim === "q"
      ? `<div class="t3"><span>${i18n("观赏质量")}</span><b>${Math.round(isNum(Q) ? Q : v)} ${i18n("分")} · ${i18n(grade)}</b></div>`
      : dim === "dv"
        ? `<div class="t3"><span>${i18n("模型分歧 ΔI")}</span><b>${Math.round(v)} ${i18n("分")}</b></div>`
        : `<div class="t3"><span>${i18n("综合指数")}</span><b>${Math.round(v)}</b></div>`;
  let extra = "";
  if (dim === "dv") {
    /* 分歧只有一个数字，光看它无法判断"是谁跟谁不一致"。
       把三套模型各自的综合指数并列出来，分歧的来源一目了然。
       只在真实采样点上给（插值点没有分模型明细，编不出来也不该编）。 */
    if (o) for (const k of DV_MODELS) {
      const Pk = modelP(o, k), Qk = modelQ(o, k);
      extra += isNum(Pk) && isNum(Qk)
        ? `<div class="t3"><span>${modelName(k)}</span><b>${Math.round(mixedIndex(Pk, Qk))}</b></div>`
        : `<div class="t3"><span>${modelName(k)}</span><b class="cf-lo">${i18n("本次无数据")}</b></div>`;
    }
    if (isNum(Q)) extra += `<div class="t3"><span>${i18n("综合观赏质量")}</span><b>${Math.round(Q)} ${i18n("分")} · ${i18n(grade)}</b></div>`;
  } else {
    if (dim !== "p" && isNum(P)) extra += `<div class="t3"><span>${i18n("出现概率")}</span><b>${Math.round(P)}%</b></div>`;
    if (dim !== "q" && isNum(Q)) extra += `<div class="t3"><span>${i18n("观赏质量")}</span><b>${Math.round(Q)} ${i18n("分")} · ${i18n(grade)}</b></div>`;
  }
  /* M1 · 方向与距离。此前 8 条里没有一条说得出"这一点在查询点的哪个方向、多远"，
     而提示卡又会写"云边界 425 km" —— 不说往哪边量，这个数字读不出意义
     （西边 300 km 那片云会挡光，东边 300 km 那片完全无关）。
     方位不另写一份算法：bearingOf 与 gridName 取 8 方位词是同一个道理
     （经度差乘 cos(lat)），只是参考零点不同。 */
  const dq = haversineKm(State.lat, State.lon, ll.lat, ll.lon);
  const brg = (isNum(dq) && dq >= 0.5) ? bearingOf(State.lat, State.lon, ll.lat, ll.lon) : null;
  const azEv = azimEventOf(d.dateS, d.period, State.lat, State.lon);
  const dirRow = brg === null
    ? `<div class="t3"><span>${i18n("距离 / 方位")}</span><b>${i18n("查询点本身")}</b></div>`
    : `<div class="t3"><span>${i18n("距离 / 方位")}</span><b>${Math.round(dq)} km · ${dirWordOf(brg)}</b></div>`;
  /* 样带长度直接引用 MAP_AZ_KM，不写死 400 —— 它是"云边界距离"这把尺子的量程，
     与 TRANSECT 末点同源，两处一旦不同口径就会给出不同的云边界（见硬约束 24）。 */
  const azRow = isNum(azEv)
    ? `<div class="t3"><span>${d.period === "am" ? "朝霞" : "晚霞"}方位</span>`
      + `<b>${dirWordOf(azEv)} ${Math.round(azEv)}° · 样带 0–${MAP_AZ_KM} km</b></div>`
    : "";
  const html = `
    <div class="t1"><i class="chipc" style="background:${c}"></i>${o ? o.name : (near || "该位置")}<button class="tclose" type="button" aria-label="关闭">×</button></div>
    <div class="t2">${o ? o.prov + " · " : ""}${d.dateS} ${d.period === "am" ? "朝霞" : "晚霞"} · ${mkTxt}${o ? "" : " · 插值估计"}</div>
    ${mainRow}${extra}${dirRow}${azRow}
    <div class="t3"><span>${dim === "dv" ? "参与模型" : "算法模型"}</span><b>${dim === "dv" ? "GFS / ECMWF / 光追" : mkTxt}</b></div>
    <div class="t3"><span>数据可信度</span><b class="${cf.cls}">${cf.lv}</b></div>
    <div class="t3 tflat"><span>${cf.txt}</span></div>
    ${o ? `<div class="t3"><span>主要云层</span><b>${o.type} ${Math.round(o.cover)}%</b></div>
           <div class="t3"><span>云底 / 云边界</span><b>${uAlt(o.base * 1000)} / ${isNum(o.d) ? uDist(o.d) : "无"}</b></div>` : ""}
    ${isClick ? `<button class="tgo" type="button" data-lat="${ll.lat}" data-lon="${ll.lon}">在此处精细查询（400 km 样带 + 光追）</button>` : ""}
  `;
  /* 位置每次都更新（指针一直在动），但**内容不变就不动 DOM**：innerHTML 全量重写
     要重新解析字符串再重排一次布局，是这条路径上最贵的一步。在一个网格单元里滑动、
     或轻微移动后取整结果没变时，都能直接跳过。tipHtml 记录的就是当前 DOM 里的那段，
     所以"相等即无需重写"是成立的；不同代码路径写提示卡时也只此一处，不会失配。 */
  tip.classList.add("on");
  /* 高度只在**内容变化时**量一次：offsetHeight 会强制同步布局，而这条路径上
     指针每动一帧都要走一遍。 */
  if (MapMod.tipHtml !== html) {
    MapMod.tipHtml = html;
    tip.innerHTML = html;
    MapMod.tipH = tip.offsetHeight;
    /* F4：把地图点变成单点查询的入口 —— 此前两条链路完全割裂，
       用户看到某处颜色漂亮，只能手动把经纬度抄到上方输入框。 */
    const gb = tip.querySelector(".tgo");
    if (gb) gb.addEventListener("click", () => {
      hideMapTip();
      gotoLatLng(parseFloat(gb.dataset.lat), parseFloat(gb.dataset.lon));
      runForecast(true);
      if ($("#autoMap") && $("#autoMap").checked) loadMapData(false);
    });
    /* 手机端：触屏没有 mouseleave，卡片被点击钉住后就再也没有自动收起的机会 ——
       真机上是"点一下弹出一张白卡片，遮住半张地图，且**按不掉**"。
       唯一的常驻出口就是卡片自带的 ×：它 pointer-events:auto（在 .dock 下
       整张卡都是交互层，桌面上只有它自己可点），且事件走监听器绑定在这次
       innerHTML 重写上，不依赖"内容是否变化"。 */
    const cb = tip.querySelector(".tclose");
    if (cb) cb.addEventListener("click", e => {
      e.stopPropagation();          /* 别把这次点击当成"又点了一下地图" */
      hideMapTip();
    });
  } else if (!MapMod.tipH) {
    MapMod.tipH = tip.offsetHeight;            // 首次内容为空时的兜底
  }
  /* 手机端（窄屏）：**不跟随指针**，位置完全交给 CSS 的 .tip.dock（贴底通栏）。
     JS 在这条路径上必须显式清掉 left/top/--tipshift 与 below —— 它们是上一次
     在宽屏（或 resize 之前）留下的行内样式，而行内样式的优先级高于 CSS 规则，
     不清掉就会把贴底卡片拽回"跟随指针"的老位置上去。
     判据与 CSS 的 @media (max-width:760px) 必须同宽；这是一个数字写两处的
     耦合，故下面用 tipDock() 收口，改断点只改这一处。 */
  if (tipDock()) {
    tip.classList.add("dock");
    tip.classList.remove("below");
    tip.style.left = tip.style.top = "";
    tip.style.setProperty("--tipshift", "0px");
    return;
  }
  tip.classList.remove("dock");
  tip.style.left = clamp(MapMod.lastPx.x, 96, ($("#map").clientWidth || 600) - 96) + "px";
  tip.style.top = clamp(MapMod.lastPx.y, 90, 100000) + "px";
  /* M1 · 上方放不下就翻到下方；两侧都放不下时再整体平移。
     判据必须放在**去重短路之后**（要用到卡片高度），但绝不能放在短路里面 ——
     内容不变时高度不变，而指针一直在动，放在短路里就会出现
     "卡片已经翻下去了、指针上移却翻不回来"。
     只翻不夹是不够的：卡片实测 305 px、容器 602 px，靠近中间时上下都放不下，
     翻到下方反而会把**底部**裁掉（旧代码只判顶部，量不出这个）。 */
  const h = MapMod.tipH || 0;
  const vh = ($("#map") && $("#map").clientHeight) || 600;
  const M = 14, PAD = 6, y = MapMod.lastPx.y;
  const below = (y - M - h) < PAD;
  const lo = below ? (PAD - M - y) : (PAD + M + h - y);
  const hi = below ? (vh - PAD - h - M - y) : (vh - PAD + M - y);
  /* 优先不位移；必须位移时选"能放下"的那个方向；两侧都放不下时保住顶部
     （卡片最有信息量的地点/时段/综合指数都在上半部分）。 */
  const sh = (lo > hi) ? lo : (lo > 0 ? lo : (hi < 0 ? hi : 0));
  tip.classList.toggle("below", below);
  tip.style.setProperty("--tipshift", Math.round(sh) + "px");
}
/* 跨断点时把**已打开**的卡片就地重排一次。
   .dock 是每次 showMapTip 顺手加/删的，而 showMapTip 只在有悬停或点击时才跑 ——
   窗口跨过 760 px（平板转竖屏、手机横竖屏、桌面拖窄）时，若卡片正开着，
   没人再调它一次，它就会带着上一套的行内 left/top 停在半路。
   收起最省事也最不容易错（下次交互自然重建），但要**静默**——
   用户没做任何操作，不该看到卡片凭空消失又出现。 */
if (TIP_DOCK_MQ && TIP_DOCK_MQ.addEventListener) {
  TIP_DOCK_MQ.addEventListener("change", () => {
    const tip = $("#tip");
    if (!tip || !tip.classList.contains("on")) return;
    const ll = MapMod.pinLL || (State ? { lat: State.lat, lon: State.lon } : null);
    hideMapTip();
    if (ll) showMapTip(ll, true);
  });
}

/* ---- 排行榜 ----
   P6：原来每次重建 8 行 DOM。切模型/维度时这份列表常常是"人没变、顺序没变，只有数值变了"，
   整体重建会把已有节点连同滚动位置一起丢掉。这里做差量：城市序列一致时只刷条长、
   数值与等级；序列变了才重建。 */
/* 该坐标在**本次色面栅格**上有没有像素（M1）。"图上看得见"的定义就是像素本身 ——
   用几何去近似它一定会差出来：栅格最后还要过一次 boxBlur(mask, FIELD_BLUR=2)，
   边缘的孤立格会被抹到阈值以下（evalField 里 `a > 0.004` 才写 alpha），
   于是"land[o] > 0 但图上确实看不见"是真实存在的
   （实测就差了 1 例：三亚榜前 8 里的"河内 南 440 km"，alpha 恒为 0）。
   按**地理坐标**读栅格、不读屏幕像素：榜单不该因为用户把地图拖走而变化。
   f 为空（降级渲染 / 尚未绘制）时一律返回 true：宁可多列一个，也不要凭空清空榜单。 */
function mapVisibleAt(f, lat, lon) {
  if (!f || !f.img || !f.cols || !f.rows) return true;
  const r = Math.round((f.laN - lat) / f.dLa), c = Math.round((lon - f.loW) / f.dLo);
  if (r < 0 || c < 0 || r >= f.rows || c >= f.cols) return false;
  return f.img[(r * f.cols + c) * 4 + 3] > 0;
}
function renderRank(fld) {
  const d = mapSet();
  if (!d) return;
  const dim = State.mapDim || "mix";
  const mk = State.mapModel || "ens";
  /* M1 · 口径必须与图面一致：**榜上有的点，图上必须真的看得见**。
     掩膜裁掉（以及被模糊抹掉）的点 alpha 恒为 0，而这里原先只按"有没有值"筛选，
     于是出现"榜上有名、图上无影"（三亚榜前 8 全部不可见）。
     注意色阶范围 R 仍按 all（含不可见点）算 —— 必须与 mapRangeOf 同源，
     否则条形的颜色会和地图上同值的颜色对不上。 */
  const vis = o => mapVisibleAt(fld, o.lat, o.lon);
  const all = d.pts.map(o => dimOf(o, dim, mk)).filter(isNum);
  const R = scaleRange(all);
  const shown = d.pts.filter(o => isNum(dimOf(o, dim, mk)) && vis(o));
  const list = shown.slice()
    .sort((a, b) => dimOf(b, dim, mk) - dimOf(a, dim, mk)).slice(0, 8);
  const sc = $("#rankScope");
  /* 分歧维度下排名口径与模型无关：这里排的是"模型之间最不一致的地点"。
     如果不换文案，会读成"多模型综合最高的地点"，与榜单里的数字对不上。 */
  const dv = dim === "dv";
  const rt = $("#rankTitle");
  if (rt) rt.textContent = dv ? i18n("模型分歧最大的地区") : i18n("当日数值最高的地区");
  if (sc) sc.textContent = (dv ? i18n("模型分歧 ΔI") : (mk === "ens" ? i18n("多模型综合") : modelName(mk)))
    + " · " + i18n("{n} 点可见", { n: shown.length })
    + (shown.length < all.length ? i18n("（另有 {n} 点不在显示范围内）", { n: all.length - shown.length }) : "");
  const rtop = $("#rankTop");
  if (rtop) rtop.textContent = i18n("（前 {n}）", { n: 8 });
  const host = $("#rank");
  if (!list.length) {
    /* 分歧维度下"没有可用结果"的含义完全不同：不是"这套模型没算出来"，
       而是"没有任何一点同时有两套以上模型的结果" —— 通常意味着 EC 那一路整批缺失。 */
    host.innerHTML = all.length
      /* 有值、但都在裁切区里：这跟"没算出结果"是两回事，文案必须分开，
         否则用户会以为程序坏了。 */
      ? `<div class="hint n-warn">本次有 <b>${all.length}</b> 个点位算出了数值，` +
        `但它们都落在<b>图面显示范围之外</b>（图中被裁切的区域），所以不列入榜单。` +
        `可以换一个查询地点，或点「刷新地图」重试。</div>`
      : dv
        ? `<div class="hint n-warn">当前时段没有任何点位同时具备两套以上模型的结果，无法计算分歧。` +
          `常见原因是 ECMWF-IFS 本次未取到数据 —— 此时"分歧小"是假象，请点「刷新地图」重试。</div>`
        : `<div class="hint n-warn">当前模型（${mk === "ens" ? "多模型综合" : modelName(mk)}）在本次取数中没有可用结果，暂无法排名。</div>`;
    MapMod.rankSig = "";
    return;
  }
  const sig = list.map(o => o.name).join("\u0001");
  const rows = host.querySelectorAll(".rr");
  if (sig === MapMod.rankSig && rows.length === list.length) {
    /* 同一批城市、同一顺序：只更新值，不动结构 */
    for (let i = 0; i < list.length; i++) {
      const o = list[i], v = dimOf(o, dim, mk), r = rows[i];
      const bar = r.children[1].firstElementChild;
      /* 条长按绝对值（0–100 的比例，便于直观读出大小），配色与地图同源（当日值域拉伸） */
      bar.style.width = clamp(v, 0, 100) + "%";
      bar.style.background = bandColor(d.period, 100 * scaleT(v, R.lo, R.hi));
      r.children[2].textContent = String(Math.round(v));
      const g = r.children[3];
      g.className = "grade g-" + o.grade;
      g.textContent = o.grade;
    }
    return;
  }
  host.innerHTML = list.map(o => {
    const v = dimOf(o, dim, mk);
    /* M1 · 每行都是"到该处精细查询"的入口（与点击地图走同一条通路）。
       role/tabindex 必须一起给，否则键盘用户拿不到这个入口。 */
    return `<div class="rr" role="button" tabindex="0" data-lat="${o.lat}" data-lon="${o.lon}"
      aria-label="查看 ${esc(o.name)} 的精细结果"><span class="nm">${esc(o.name)}</span>
      <span class="b3"><i style="width:${clamp(v, 0, 100)}%;background:${bandColor(d.period, 100 * scaleT(v, R.lo, R.hi))}"></i></span>
      <span class="vv">${Math.round(v)}</span>
      <span class="grade g-${o.grade}" style="transform:scale(.92)">${o.grade}</span></div>`;
  }).join("");
  MapMod.rankSig = sig;
}

/* =========================================================================
   语言切换后的重渲染入口（i18n）
   -------------------------------------------------------------------------
   `setLang()` 只负责换 LANG 与铺静态 DOM；**动态区域要重跑一遍**，
   否则会出现"一半英文一半中文"的界面 —— 多语言最典型的坏法之一。
   本函数是所有"由 JS 生成的文案"的收口处：
     · 由 JS 建的控件内容（日期下拉、语言分段、趋势标题按钮、顶栏徽标）
     · 结果卡 / 趋势 / 图例 / 榜单（有数据时重渲，没数据时是引导文案）
     · 地图卡里的引导与状态文案
   `setLang()` 用 `typeof relang === "function"` 探测后调用，所以本函数
   定义在最后一个片段里也不会出现"没加载到就抛错"。
   ========================================================================= */
function relang() {
  applyI18nDom(document);
  try {
    if (typeof refreshDateSelect === "function") refreshDateSelect();
    if (typeof refreshTrendLabels === "function") refreshTrendLabels();
    if (typeof refreshBadge === "function") refreshBadge();
    if (typeof refreshLocHint === "function") refreshLocHint();
    if (typeof markCachedDates === "function") markCachedDates();
    /* 结果卡与趋势：没算过时这两块本来就是引导文案，renderTrend 会自己处理 */
    if (typeof State !== "undefined" && State.result && typeof renderAll === "function") renderAll(State.result);
    if (typeof renderTrend === "function") renderTrend();
    if (typeof updateLegend === "function") updateLegend();
    /* 地图侧：引导/错误文案 + 模型下拉 + 榜单口径。
       mapShowGuide 与 applyModelOptions 都是幂等的；错误态文案不追（罕见路径）。 */
    if (typeof mapShowGuide === "function" && MapMod.ok && !mapSet()) mapShowGuide();
    if (typeof applyModelOptions === "function") applyModelOptions();
    if (typeof renderRank === "function" && mapSet()) renderRank(MapMod.field);
    if (typeof hideMapTip === "function") hideMapTip();
  } catch (e) { softWarn("语言切换后的重渲染失败", e); }
}

/* ---- 启动 ---- */
window.addEventListener("DOMContentLoaded", () => {
  initUI();
  initMap();
});
