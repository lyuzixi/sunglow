/* =========================================================================
   GLOWCAST v3「追光航志」· 轻量探针（主链路关键行为）
   运行：node probes/probe.mjs   （Node 22 直跑 TS，经 --experimental-strip-types）
   覆盖：口径常量 / 评分综合 / 推导规则 / 缓存键隔离 / 色阶 / 分档 / i18n。
   判据纪律：每条断言先自证可失败（assert 之外打印通过数），退出码非 0 = 红。
   ========================================================================= */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "src");

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); n++; };
const close = (a, b, tol, msg) => { assert.ok(Math.abs(a - b) <= tol, msg + ` (${a} vs ${b})`); n++; };

/* ---- 动态导入核心（TS 直跑） ---- */
const math = await import("../src/core/math.ts");
const scoring = await import("../src/core/scoring.ts");
const ramp = await import("../src/core/ramp.ts");
const suggest = await import("../src/core/suggest.ts");
const consts = await import("../src/core/consts.ts");
const mapdata = await import("../src/core/mapdata.ts");
const forecast = await import("../src/core/forecast.ts");
const i18n = await import("../src/core/i18n.ts");

/* ---- 1. 口径常量 ---- */
eq(consts.TRANSECT.length, 17, "TRANSECT 必须 17 点");
eq(consts.TRANSECT[0], 0, "TRANSECT 起点 0 km");
eq(consts.TRANSECT[16], 400, "TRANSECT 终点 400 km");
eq(consts.MODEL_NAME.gfs, "gfs_seamless", "GFS 模型名与原版一致");
eq(consts.MODEL_NAME.ec, "ecmwf_ifs025", "EC 模型名与原版一致");
eq(consts.F_MAP_VARS.length, 10, "地图字段集 10 项（计费下限档）");
eq(consts.MAP_GRID_KM, 120, "网格间距 120 km");
eq(consts.MAP_RADIUS_KM, 500, "网格半径 500 km");
eq(consts.TREND_DAYS, 7, "机会日历 7 天");

/* ---- 2. 综合与分歧口径 ---- */
close(scoring.mixedIndex(80, 60), 0.55 * 80 + 0.45 * 60, 0.01, "mixedIndex 0.55/0.45");
eq(scoring.mixedIndex(200, 100), 100, "mixedIndex 截断到 100");
eq(scoring.mixedIndex(-50, -100), 0, "mixedIndex 截断到 0");
const w = math.wgeo([[80, 0.3], [80, 0.7]]);
close(w, 80, 0.01, "wgeo 同值=该值");
const w2 = math.wgeo([[10, 1], [90, 1]]);
ok(w2 > 10 && w2 < 50, "wgeo 一票否决：低值显著拉低综合");
eq(scoring.gradeOf(85), "优", "85 → 优");
eq(scoring.gradeOf(70), "良", "70 → 良");
eq(scoring.gradeOf(50), "一般", "50 → 一般");
eq(scoring.gradeOf(20), "差", "20 → 差");
eq(scoring.ensConfOf(10).key, "hi", "dv 10 → 高可信");
eq(scoring.ensConfOf(25).key, "mid", "dv 25 → 中");
eq(scoring.ensConfOf(40).key, "lo", "dv 40 → 低");
eq(scoring.ensConfOf(null).key, "mid", "分歧缺失 → 中（不假装可信）");
close(scoring.cloudBlockOf({ cLow: 0, cMid: 0 }), 0, 0.01, "无云 → 遮挡 0");
ok(scoring.cloudBlockOf({ cLow: 80, cMid: 80 }) > 80, "高遮挡合成 > 80");

/* ---- 3. 网格 ---- */
const pts = mapdata.buildLocalGrid(39.9, 116.4);
ok(pts.length >= 45 && pts.length <= 69, `局部网格点数约 57（实际 ${pts.length}）`);
ok(pts.every((p) => math.haversineKm(39.9, 116.4, p.lat, p.lon) <= 500.5), "全部点在 500 km 半径内");
ok(pts.some((p) => p.name.includes("北京")), "命名能落到城市名");
const names = pts.map((p) => p.name);
eq(new Set(names).size, names.length, "网格命名无重复");

/* ---- 4. 缓存键隔离（glowcast.v3.*） ---- */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; }
};
const box = {
  am: { pts: [], dateS: "2026-10-20", period: "am", note: "" },
  pm: {
    pts: [{ P: 50, Q: 50, p: { ens: 50, gfs: 50, ec: null, rt: 50 }, q: { ens: 50, gfs: 50, ec: null, rt: 50 } }],
    dateS: "2026-10-20", period: "pm", note: ""
  }
};
mapdata.mapCachePut(39.9, 116.4, "2026-10-20", box);
const keys = [...store.keys()];
ok(keys.length === 1, "地图缓存只写一条");
ok(keys[0].startsWith("glowcast.v3.map.v1."), `地图缓存键前缀 glowcast.v3.map.v1.*（实际 ${keys[0]}）`);
ok(!keys[0].includes("sunsetbot") && !keys[0].includes("glowcast.v2"), "不与原版/v2 键族混用");
const got = mapdata.mapCacheGet(39.9, 116.4, "2026-10-20");
ok(got && got.pm.pts.length === 1, "缓存命中可读回");
eq(mapdata.mapCacheGet(31.2, 121.5, "2026-10-20"), null, "换坐标不误命中（键带坐标）");
store.clear();
store.set("sunsetbot.map.v6.x@1.0,2.0", "{}");   // 原版键
store.set("glowcast.v2.map.x@1.0,2.0", "{}");    // v2 键
store.set("glowcast.v3.map.v0.old@1.0,2.0", "{}"); // v3 自家旧版本键
mapdata.dropStaleMapFamily();
ok(store.has("sunsetbot.map.v6.x@1.0,2.0"), "绝不碰原版键（互不影响）");
ok(store.has("glowcast.v2.map.x@1.0,2.0"), "绝不碰 v2 键（互不影响）");
ok(!store.has("glowcast.v3.map.v0.old@1.0,2.0"), "自家同族旧前缀残留被清掉");

/* ---- 5. 色阶（航图新尺，0–100 绝对刻度） ---- */
eq(ramp.CHART_RAMP.length, 8, "色阶 8 锚点");
for (let i = 1; i < ramp.CHART_RAMP.length; i++) {
  ok(ramp.CHART_RAMP[i].v > ramp.CHART_RAMP[i - 1].v, "锚点单调递增");
}
ok(ramp.CHART_RAMP[0].v === 0, "锚点从 0 起");
ok(ramp.CHART_RAMP[ramp.CHART_RAMP.length - 1].v === 100, "锚点到 100 止");
ok(ramp.rampColor(0).startsWith("rgb"), "rampColor(0) 返回 rgb()");
ok(ramp.rampColor(100).includes("247"), "rampColor(100) 落在暖白（r≈247）");
ok(ramp.rampColor(-5) === ramp.rampColor(0), "越界截断到 0");
ok(ramp.rampColor(150) === ramp.rampColor(100), "越界截断到 100");
ok(ramp.rampColorA(50, 0.5).startsWith("rgba"), "rampColorA 带 alpha");

/* ---- 6. 推导规则（新能力 = 基线输出的展示层推导） ---- */
const dayMs = Date.UTC(2026, 9, 20);
const evMs = suggest.eventOfDay(dayMs, 39.9, 116.4, "pm");
ok(evMs > dayMs && evMs < dayMs + 86400000, "事件时刻落在当日");
const mkPt = (i) => ({
  name: "P" + i, prov: "X", lat: 39.9 + i * 0.3, lon: 116.4,
  P: 40 + i * 10, Q: 50 + i * 5,
  p: { ens: 50, gfs: 50, ec: 50, rt: 50 }, q: { ens: 50, gfs: 50, ec: 50, rt: 50 },
  grade: "良", type: "高积云", cover: 50, base: 3, d: 100, dur: 12, aod: 0.2, cld: 40,
  T550: 1.2, color: "rgb(1,2,3)", distKm: i * 20
});
const spots = suggest.topSpots([mkPt(0), mkPt(1), mkPt(2), mkPt(3)], {
  centerLat: 39.9, centerLon: 116.4, evMs, period: "pm", dayMs, n: 3
});
eq(spots.length, 3, "Top3 返回 3 个");
ok(spots[0].I >= spots[1].I && spots[1].I >= spots[2].I, "按综合指数降序");
eq(spots[0].name, "P3", "最高 I 的点排第一");
close(spots[0].winStart, evMs - 25 * 60000, 50, "窗口起点 = 事件 − 25min");
close(spots[0].winEnd, evMs + 12 * 60000, 50, "窗口终点 = 事件 + dur(12)min");
close(spots[0].arriveBy, evMs - 45 * 60000, 50, "到位建议 = 窗口起点 − 20min");
ok(spots[0].az >= 0 && spots[0].az < 360, "朝向角在 [0,360)");
ok(/^[东南西北]/.test(suggest.azLabel(247)), "朝向标签带方位词");

const cells = suggest.dayCells([
  { date: "2026-10-20", am: { P: 30, Q: 40, grade: "一般" }, pm: { P: 80, Q: 70, grade: "良" } },
  { date: "2026-10-21", am: null, pm: { P: 20, Q: 20, grade: "差" } }
]);
eq(cells.length, 2, "日历 2 格");
eq(cells[0].bestPeriod, "pm", "强档判对（晚霞）");
eq(cells[1].bestPeriod, "pm", "只有晚霞时取晚霞");
eq(cells[0].weekday, new Date(Date.UTC(2026, 9, 20)).getUTCDay(), "星期口径 = UTC day");
const best = suggest.bestSlots([
  { date: "2026-10-20", am: { P: 30, Q: 40 }, pm: { P: 80, Q: 70 } },
  { date: "2026-10-21", am: null, pm: { P: 20, Q: 20 } }
], 2);
eq(best.length, 2, "最值得去取 2 席");
eq(best[0].period, "pm", "最强席是晚霞");

/* ---- 7. mock 计算链（离线回落出数） ---- */
const bundle = forecast.makeMockBundle(39.9, 116.4, "2026-10-20", "pm");
ok(bundle.gfsD.length === 17 && bundle.ecD.length === 17 && bundle.aqD.length === 17, "mock 三路各 17 点");
const r = forecast.computeFromBundle({
  lat: 39.9, lon: 116.4, dateStr: "2026-10-20", period: "pm", name: "北京",
  bundle, src: "mock"
});
ok(r.ok, "mock 计算通过");
if (r.ok) {
  ok(r.P >= 0 && r.P <= 100 && r.Q >= 0 && r.Q <= 100, "P/Q 在 0–100");
  ok(r.models.length === 3, "三套模型齐");
  ok(r.dvI == null || r.dvI >= 0, "分歧非负或 null");
  eq(typeof r.conf.key, "string", "可信度分档存在");
  ok(isFinite(r.evMs) && r.evMs > 0, "事件时刻有效");
  ok(r.dur >= 0, "火烧窗口时长非负");
  ok(Array.isArray(r.factorRows) && r.factorRows.length >= 8, "因素行齐");
  ok(r.skyCloud === null || r.skyCloud.length > 0, "云量切片可空不可半残");
}

/* ---- 8. i18n ---- */
i18n.setLang("zh");
eq(i18n.t("晚霞"), "晚霞", "简体原样");
eq(i18n.t("距 {a} 分钟", { a: 5 }), "距 5 分钟", "变量插值");
i18n.setLang("hant");
eq(i18n.t("晚霞"), "晚霞", "繁体同形词");
eq(i18n.t("观测场"), "觀測場", "繁体转换");
i18n.setLang("en");
eq(i18n.t("晚霞"), "Sunset Glow", "英文取词");
eq(i18n.t("不存在的键"), "不存在的键", "缺词回落键本身");
i18n.setLang("zh");

/* ---- 9. 静态检查：存储键命名空间 / 禁改面 ---- */
const constsSrc = readFileSync(join(SRC, "core", "consts.ts"), "utf8");
ok(constsSrc.includes("glowcast.v3.pref"), "偏好键 glowcast.v3.pref");
ok(constsSrc.includes("glowcast.v3.map.v1."), "地图缓存键族 v1");
ok(constsSrc.includes("glowcast.v3.trend.v1."), "趋势缓存键族 v1");
const srcAll = ["state.ts", "core/calib.ts", "core/trend.ts", "core/mapdata.ts"]
  .map((f) => readFileSync(join(SRC, f), "utf8")).join("\n");
ok(!srcAll.includes("glowcast.v2"), "v3 源码不写 v2 键族");
ok(!srcAll.includes("sunsetbot."), "v3 源码不写原版键族");

/* ---- 10. 天文 sanity ---- */
const astro = await import("../src/core/astro.ts");
const ev = astro.sunEvents(dayMs, 39.9, 116.4);
ok(ev.riseMs != null && ev.setMs != null && ev.riseMs < ev.setMs, "北京当日日出在日落前");
const az = astro.solarPosition(ev.setMs, 39.9, 116.4).azimuth;
ok(az > 180 && az < 300, `日落方位在西半天（${az}°）`);

console.log(`\n✅ probes passed: ${n} assertions`);
