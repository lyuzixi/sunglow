/* =========================================================================
   probe-consist.mjs —— 一致性口径对拍（原版 vs v2）
   做法：**不重写公式**，而是从源码里把表达式原样抽出来 eval，再在同一个输入网格上比。
   这样任何一边改了口径，脚本立刻报差异（相当于一条活的口径守卫）。
   用法：node scripts/probe-consist.mjs
   ========================================================================= */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");      // v2/
const origDir = path.resolve(root, "..");                   // 仓库根（原版）
const ORIG = path.join(origDir, "_p5.js");                   // 结论合成（consist 在这）
const ORIG_BANDS = path.join(origDir, "_p4.js");             // ENS_CONF_BANDS
const V2 = path.join(root, "src/core/forecast.ts");
const V2_BANDS = path.join(root, "src/core/scoring.ts");

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const nz = (x, d) => (Number.isFinite(x) ? x : d);

function grab(file, re, label) {
  const s = fs.readFileSync(file, "utf8");
  const m = s.match(re);
  if (!m) {
    console.error("✗ 抽不到 " + label + "（源码结构变了？）");
    process.exit(2);
  }
  return m;
}

/* ---------- 1. consist 表达式 ---------- */
const oM = grab(ORIG, /const consist = (clamp\(100 - [^;]*\));/,
  "原版 consist");
const vM = grab(V2, /const consist = (clamp\(100 - [^;]*\));/,
  "v2 consist");

const origFn = new Function("dvI", "clamp", "nz", "return " + oM[1] + ";");
const v2Fn = new Function("dvFinal", "clamp", "nz", "return " + vM[1] + ";");

/* ---------- 2. 可信度分档阈值 ---------- */
const oBand = grab(ORIG_BANDS, /const ENS_CONF_BANDS = \[([\s\S]*?)\n\];/, "原版 ENS_CONF_BANDS")[1];
const vBand = grab(V2_BANDS, /export const ENS_CONF_BANDS: EnsBand\[\] = \[([\s\S]*?)\n\];/,
  "v2 ENS_CONF_BANDS")[1];
const maxes = (txt) => [...txt.matchAll(/max:\s*([\d.]+|Infinity)/g)].map((m) => m[1]);
const oMax = maxes(oBand), vMax = maxes(vBand);

/* ---------- 3. 同一网格上比 ---------- */
const GRID = [0, 1, 2, 5, 8, 10, 14, 18, 20, 26.3, 30, 35, 40, 52.6, 60, 100];
let bad = 0;
const rows = [];
for (const dv of GRID) {
  const a = origFn(dv, clamp, nz);
  const b = v2Fn(dv, clamp, nz);
  const d = Math.abs(a - b);
  if (!(d < 0.01)) bad++;
  rows.push({ dv, a, b, d });
}

console.log("ΔI  原版一致性   v2一致性   误差");
for (const r of rows) {
  console.log(
    String(r.dv).padStart(5),
    r.a.toFixed(1).padStart(10),
    r.b.toFixed(1).padStart(10),
    r.d.toFixed(2).padStart(8),
    r.d >= 0.01 ? "  ← 不一致" : ""
  );
}

const bandsOk = JSON.stringify(oMax) === JSON.stringify(vMax);
console.log("\n可信度分档阈值：原版 " + JSON.stringify(oMax) + " / v2 " + JSON.stringify(vMax) +
  (bandsOk ? "  ✓ 一致" : "  ← 不一致"));
console.log("consist 表达式：\n  原版 " + oM[1] + "\n  v2   " + vM[1]);

if (bad || !bandsOk) {
  console.log("\n✗ 对拍失败：" + bad + " 个采样点不一致；分档阈值" + (bandsOk ? "一致" : "不一致"));
  process.exit(1);
}
console.log("\n✓ 对拍通过：16 个采样点全部一致，分档阈值一致");
