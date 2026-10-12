/* C1 量化：气溶胶（AOD）的空间相关尺度 是否支持"隔点取样"。

背景：地图 57 点，其中 air-quality 那一批 57 个坐标只为取 AOD。若 AOD 在
120 km 尺度上足够平滑，就可以只对约一半的点真实取样、其余用邻近点代替，
把地图 171 → ≈143 个加权调用（−16%）。

但这是一个**物理问题**，不是工程问题：AOD 有强局地性（城市 vs 郊区、海陆、沙尘带），
样本不足就会把"重霾 / 洁净"的对比抹平，热力图上直接表现为大片同色 ——
那正是之前花大力气修掉的缺陷。所以先量化，量化不通过就明确写"不做"。

本脚本做三件事（都只用一次真实请求：7×7 网格 × 1 变量 × 1 天 = 49 个加权调用）：
  1. AOD 的空间统计：极差、变异系数、相邻点（≈56 km）与隔点（≈111 km）差分的分布
  2. 模拟"隔点取样"（保留棋盘格 16 点，其余用最近保留点代替）的 AOD 代理误差
  3. 把该误差传导到评分：aeroF → P / Q 的分差
     （aeroF 的 trap 表直接从 _p4.js 源文件抓，不手抄，改表时自动跟上）

用法: node _check/aodscale.js
*/
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const tpl = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const b0 = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/.exec(tpl)[1];

const p4 = fs.readFileSync(path.join(ROOT, "_p4.js"), "utf8");
const mA = /const aeroF = isNum\(aodUp\) \? trap\(aodUp, (\[\[[\s\S]*?\]\])\)/.exec(p4);
if (!mA) { console.log("FATAL 未能从 _p4.js 提取 aeroF 的 trap 表（实现变了？）"); process.exit(1); }
const AERO_TBL = mA[1];

const q = arr => {
  const a = arr.slice().sort((x, y) => x - y);
  const p = f => a.length ? a[Math.min(a.length - 1, Math.max(0, Math.round(f * (a.length - 1))))] : NaN;
  return { n: a.length, min: p(0), p50: p(.5), p90: p(.9), max: p(1), mean: a.reduce((x, y) => x + y, 0) / (a.length || 1) };
};
const f3 = x => (typeof x === "number" && isFinite(x)) ? x.toFixed(3) : "—";

const TEST = `
(async function () {
  const AERO_TBL = __AERO_TBL__;
  const aeroFOf = aod => trap(aod, AERO_TBL);

  /* ---- 1. 取数：7x7 网格，0.5° 间距（≈56 km），覆盖 32°N/117°E 一带 ---- */
  const BASE = { lat: 32.0, lon: 117.0 }, STEP = 0.5, N = 7, HALF = 3;
  const KM_PER_DEG = 111.32, KM = STEP * KM_PER_DEG;
  const pts = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++)
    pts.push({ i, j, lat: BASE.lat + (j - HALF) * STEP, lon: BASE.lon + (i - HALF) * STEP });

  const url = "https://air-quality-api.open-meteo.com/v1/air-quality"
    + "?latitude=" + pts.map(p => p.lat.toFixed(4)).join(",")
    + "&longitude=" + pts.map(p => p.lon.toFixed(4)).join(",")
    + "&hourly=aerosol_optical_depth&forecast_days=1&timezone=auto";
  console.log("请求 " + pts.length + " 个坐标的 AOD（1 个变量 / 1 天 = " + pts.length + " 个加权调用）...");
  const res = await fetch(url);
  if (!res.ok) { console.log("FATAL HTTP " + res.status + " —— " + (await res.text()).slice(0, 200)); return; }
  const js = await res.json();
  const arr = Array.isArray(js) ? js : [js];
  if (arr.length !== pts.length) { console.log("FATAL 返回点数 " + arr.length + " ≠ " + pts.length); return; }

  const H = 16;   /* 16:00 本地 —— 贴近日落取样时刻 */
  pts.forEach((p, k) => {
    const h = arr[k] && arr[k].hourly;
    p.aod = (h && h.aerosol_optical_depth) ? h.aerosol_optical_depth[H] : null;
  });
  const bad = pts.filter(p => !(typeof p.aod === "number" && isFinite(p.aod)));
  if (bad.length) { console.log("FATAL 有 " + bad.length + " 个点无 AOD 值"); return; }

  const at = (i, j) => pts[j * N + i].aod;
  const all = pts.map(p => p.aod);
  const S = __Q__(all);

  console.log("");
  console.log("===== 1. AOD 空间统计（" + N + "x" + N + " 网格，间距 " + KM.toFixed(0) + " km）=====");
  console.log("  范围 " + f3(S.min) + " ~ " + f3(S.max) + "   中位 " + f3(S.p50) + "   均值 " + f3(S.mean));
  const sd = Math.sqrt(all.reduce((a, b) => a + (b - S.mean) * (b - S.mean), 0) / all.length);
  console.log("  标准差 " + f3(sd) + "   变异系数 CV " + (sd / S.mean * 100).toFixed(1) + "%");
  console.log("  极差/中位 = " + ((S.max - S.min) / S.p50).toFixed(2) + " 倍");

  /* ---- 2. 差分尺度：相邻点 vs 隔点 ---- */
  const dAdj = [], dSkip = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (i + 1 < N) dAdj.push(Math.abs(at(i, j) - at(i + 1, j)));
    if (j + 1 < N) dAdj.push(Math.abs(at(i, j) - at(i, j + 1)));
    if (i + 2 < N) dSkip.push(Math.abs(at(i, j) - at(i + 2, j)));
    if (j + 2 < N) dSkip.push(Math.abs(at(i, j) - at(i, j + 2)));
  }
  const A1 = __Q__(dAdj), A2 = __Q__(dSkip);
  console.log("");
  console.log("===== 2. 差分随距离的增长 =====");
  console.log("  " + (KM).toFixed(0) + " km（相邻） |ΔAOD|  中位 " + f3(A1.p50) + "  均值 " + f3(A1.mean) + "  P90 " + f3(A1.p90) + "  最大 " + f3(A1.max));
  console.log("  " + (2 * KM).toFixed(0) + " km（隔点） |ΔAOD|  中位 " + f3(A2.p50) + "  均值 " + f3(A2.mean) + "  P90 " + f3(A2.p90) + "  最大 " + f3(A2.max));
  console.log("  ⇒ 距离翻倍后中位差分增长 " + (A1.p50 > 1e-6 ? (A2.p50 / A1.p50).toFixed(2) : "∞") + " 倍"
    + "（完全随机场≈1.41；完全相关≈1.00；越小说明越平滑）");

  /* ---- 3. 模拟隔点取样 ---- */
  console.log("");
  console.log("===== 3. 模拟「隔点取样 + 最近邻代替」=====");
  const keep = pts.filter(p => p.i % 2 === 0 && p.j % 2 === 0);
  console.log("  保留 " + keep.length + " / " + pts.length + " 个真实取样点");
  const errs = [];
  for (const p of pts) {
    if (p.i % 2 === 0 && p.j % 2 === 0) continue;
    let best = 1e9, bv = null;
    for (const k of keep) {
      const d2 = (p.i - k.i) * (p.i - k.i) + (p.j - k.j) * (p.j - k.j);
      if (d2 < best) { best = d2; bv = k.aod; }
    }
    errs.push({ km: Math.sqrt(best) * KM, da: Math.abs(p.aod - bv),
                rel: Math.abs(p.aod - bv) / Math.max(p.aod, 1e-6), true: p.aod, proxy: bv });
  }
  const E = __Q__(errs.map(x => x.da)), ER = __Q__(errs.map(x => x.rel * 100));
  const dKM = __Q__(errs.map(x => x.km));
  console.log("  代理距离（到最近保留点） 中位 " + f3(dKM.p50) + " km  最大 " + f3(dKM.max) + " km");
  console.log("  代理产生的 |ΔAOD|  中位 " + f3(E.p50) + "  均值 " + f3(E.mean) + "  P90 " + f3(E.p90) + "  最大 " + f3(E.max));
  console.log("  相对误差 %      中位 " + f3(ER.p50) + "  P90 " + f3(ER.p90) + "  最大 " + f3(ER.max));

  /* ---- 4. 传导到评分 ---- */
  console.log("");
  console.log("===== 4. 代理误差传导到评分（P / Q）=====");
  /* 取一个"条件不错"的代表性场景作为基线：
     geomF≈0.95 / 亮度 0.80 / 彩度 0.80 / 云量适中度 0.90 —— 这样 P 落在敏感区而不是饱和区 */
  const S0 = 0.40 * 0.95 + 0.22 * 0.80 + 0.16 * 0.80 + 0.10 * 0.90;
  const Pof = a => 100 * logistic(7 * (S0 + 0.12 * aeroFOf(a) - 0.46));
  const Qof = a => 100 * wgeo([[0.80, 0.26], [0.80, 0.22], [aeroFOf(a), 0.20],
                               [0.94, 0.16], [0.85, 0.08], [0.90, 0.08]]);
  const dP = [], dQ = [];
  for (const e of errs) { dP.push(Math.abs(Pof(e.true) - Pof(e.proxy))); dQ.push(Math.abs(Qof(e.true) - Qof(e.proxy))); }
  const DP = __Q__(dP), DQ = __Q__(dQ);
  console.log("  ΔP（百分点） 中位 " + f3(DP.p50) + "  均值 " + f3(DP.mean) + "  P90 " + f3(DP.p90) + "  最大 " + f3(DP.max));
  console.log("  ΔQ（分）     中位 " + f3(DQ.p50) + "  均值 " + f3(DQ.mean) + "  P90 " + f3(DQ.p90) + "  最大 " + f3(DQ.max));

  /* aeroF 的非线性：各 AOD 处的局部斜率 */
  const sl = [];
  for (let a = 0.05; a <= 1.6; a += 0.05) {
    const d = (aeroFOf(a + 0.05) - aeroFOf(Math.max(0, a - 0.05))) / (0.05 + 0.05);
    sl.push("AOD " + a.toFixed(2) + " → ∂aeroF/∂AOD " + d.toFixed(2));
  }
  console.log("  aeroF 局部斜率：" + sl.slice(0, 12).join(" | "));

  /* ---- 5. 判定 ---- */
  console.log("");
  console.log("===== 5. 判定 =====");
  const pass = {
    aodSmooth: A2.p50 <= 0.06,
    errSmall: E.p50 <= 0.03,
    pNegligible: DP.p90 <= 3,
    qNegligible: DQ.p90 <= 3
  };
  console.log("  AOD 在 " + (2 * KM).toFixed(0) + " km 尺度足够平滑（隔点中位差 ≤ 0.06）：" + (pass.aodSmooth ? "通过" : "不通过") + "  (实测 " + f3(A2.p50) + ")");
  console.log("  代理 AOD 误差中位 ≤ 0.03：" + (pass.errSmall ? "通过" : "不通过") + "  (实测 " + f3(E.p50) + ")");
  console.log("  ΔP 的 P90 ≤ 3 个百分点：" + (pass.pNegligible ? "通过" : "不通过") + "  (实测 " + f3(DP.p90) + ")");
  console.log("  ΔQ 的 P90 ≤ 3 分：" + (pass.qNegligible ? "通过" : "不通过") + "  (实测 " + f3(DQ.p90) + ")");
  const allPass = pass.aodSmooth && pass.errSmall && pass.pNegligible && pass.qNegligible;
  console.log("");
  console.log(allPass ? "结论：量化通过 —— 隔点取样在可接受误差内，C1 可以做。"
                      : "结论：量化不通过 —— 隔点取样会把局地气溶胶对比抹平，C1 不做。");
  /* 直接设退出码，不靠 new Function 的返回值 —— 拼接后的 body 未必把最后一句
     当成函数返回值，绕开这一层更可靠（第一版就栽在这里：判定为"不通过"却 exit 0）。 */
  process.exitCode = allPass ? 0 : 1;
  return allPass ? 0 : 1;
})();
`.replace("__AERO_TBL__", AERO_TBL);

/* 把外层的分位数函数注入进去 —— 模板串里不便再写一遍 */
const helper = "const __Q__ = " + q.toString() + ";\n"
             + "const f3 = " + f3.toString() + ";\n";

try {
  const run = new Function("require", "console", "process", "fetch", "AbortController",
    "setTimeout", "clearTimeout", helper + b0 + "\n" + TEST);
  const p = run(require, console, process, fetch, AbortController, setTimeout, clearTimeout);
  if (p && typeof p.then === "function") {
    p.then(code => { process.exitCode = code || 0; })
     .catch(e => { console.log("FATAL " + (e && e.stack || e)); process.exitCode = 1; });
  }
} catch (e) {
  console.log("FATAL 执行异常: " + (e && e.stack || e));
  process.exitCode = 1;
}
