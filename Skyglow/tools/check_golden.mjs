/* Check the inlined browser core against Python golden vectors.
   Usage: node tools/check_golden.mjs [path/to/golden.json] */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FILES = ["util", "solar", "spectrum", "model", "nn"].map(
  n => path.join(HERE, "js", "core", n + ".js"));
FILES.push(path.join(HERE, "js", "data", "params.js"));

const goldenPath = process.argv[2] || path.join(HERE, "data", "golden.json");
const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8"));

const code = FILES.map(f => fs.readFileSync(f, "utf8")).join("\n");
const js = vm.runInNewContext(
  code + "\n;({MODEL, NN, solarPosition, eventTimes, assess, featuresFromWeather,"
  + " nnPredict, deckLight});",
  { console }, { filename: "core-bundle.js" });

const failures = [];
function cmp(name, a, b, tol) {
  if (a === null || b === null || a === undefined || b === undefined) {
    if (a !== b) failures.push(`${name}: py=${a} js=${b}`);
    return;
  }
  if (typeof a === "number" && typeof b === "number") {
    if (!(Math.abs(a - b) <= tol)) failures.push(`${name}: py=${a} js=${b} Δ=${Math.abs(a - b)}`);
    return;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`${name}: py=${JSON.stringify(a)} js=${JSON.stringify(b)}`);
}

let worst = 0;
for (const c of golden.cases) {
  const [y, m, d] = c.date;
  const evMs = js.eventTimes(c.lat, c.lon, y, m, d, c.tz, 2, c.mode)[c.mode];
  const [elev, az] = js.solarPosition(c.lat, c.lon, c.event_ms);
  const r = js.assess(c.w, elev, c.mode, js.MODEL);
  const f = js.featuresFromWeather(c.w, elev);
  const feats = [c.w.cc_low || 0, c.w.cc_mid || 0, c.w.cc_high || 0,
    c.w.cc_low_up || 0, c.w.cc_mid_up || 0, c.w.rh || 0, c.w.blh || 0, elev,
    f.canvas, f.canvas_high, f.light, f.horizon, f.purity, f.aod, f.precip];
  const pnn = js.nnPredict(feats, js.NN);
  const dl = js.deckLight(8.6 + 0.45 * 1.6, elev, c.w.aod);

  const before = failures.length;
  cmp(`${c.label}/event_ms`, c.event_ms, evMs, 2);
  cmp(`${c.label}/sun_elev`, c.sun_elev, elev, 1e-6);
  cmp(`${c.label}/sun_az`, c.sun_az, az, 1e-6);
  cmp(`${c.label}/prob`, c.prob, r.probability, 1e-4);
  cmp(`${c.label}/index`, c.index, r.index, 1e-3);
  cmp(`${c.label}/grade`, c.grade, r.grade, 0);
  cmp(`${c.label}/rgb`, c.rgb, r.colour.rgb, 0);
  cmp(`${c.label}/lum`, c.lum, r.colour.luminance, 1e-4);
  for (const k of Object.keys(c.features)) cmp(`${c.label}/feat.${k}`, c.features[k], r.features[k], 1e-3);
  cmp(`${c.label}/nn`, c.nn, pnn, 1e-5);
  cmp(`${c.label}/deck.lum`, c.deck.lum, dl.lum, 1e-6);
  cmp(`${c.label}/deck.rgb`, c.deck.rgb, dl.rgb, 0);
  cmp(`${c.label}/deck.tangent`, c.deck.tangent, dl.tangent_km, 1e-6);
  cmp(`${c.label}/deck.m_ray`, c.deck.m_ray, dl.m_ray, 1e-6);
  cmp(`${c.label}/deck.m_aer`, c.deck.m_aer, dl.m_aer, 1e-6);

  const dProb = Math.abs(c.prob - r.probability);
  worst = Math.max(worst, dProb);
  const mark = failures.length === before ? "PASS" : "FAIL";
  console.log(`${mark}  ${c.label.padEnd(16)} prob=${r.probability.toFixed(4)}`
    + ` grade=${r.grade} nn=${pnn === null ? "-" : pnn.toFixed(4)}`);
}

for (const f of failures) console.log("   " + f);
console.log(`\n${golden.cases.length} cases · worst prob Δ=${worst.toExponential(2)}`
  + ` · failures=${failures.length}`);
process.exit(failures.length ? 1 : 0);
