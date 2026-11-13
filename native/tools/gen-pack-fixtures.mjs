/* SUNGLOW · pack fixture 生成器（R2）
 * 直接复用网页 v2/src/core/snapshot.ts 的 buildSharePack，产出真实 pack 链接，
 * 供 Kotlin 单测反向校验，避免「自己编自己解」的假互通。
 * 用法：node native/tools/gen-pack-fixtures.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "../..");
const req = createRequire(import.meta.url);
const ts = req(path.join(root, "v2/node_modules/typescript/lib/typescript.js"));
const src = fs.readFileSync(path.join(root, "v2/src/core/snapshot.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

const mod = { exports: {} };
const fakeRequire = (id) => {
  if (id === "vue") return { ref: (v) => ({ value: v }) };
  if (id === "./math") return {
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    isNum: (v) => typeof v === "number" && Number.isFinite(v)
  };
  throw new Error("unexpected import " + id);
};
new Function("require", "module", "exports", js)(fakeRequire, mod, mod.exports);
const { buildSharePack } = mod.exports;

const lat = 23.1291, lon = 113.2644, date = "2026-11-13", mapDate = "2026-11-13";
const coord = "@" + lat.toFixed(1) + "," + lon.toFixed(1);

function point(period, p, q) {
  return {
    ts: 1790000000000,
    obj: {
      ok: true, dateStr: date, period, P: p, Q: q, grade: q > 70 ? "you" : "liang",
      consist: 82, dvI: 6, spread: 4, spreadQ: 5,
      city: { name: "广州市", shortName: "广州", prov: "广东省", lat, lon },
      factorRows: [], sRT: {}, sG: {}, sE: null, models: [], envM: {}, tz: {},
      conf: { key: "hi", level: "高", txt: "多模型一致" },
      src: "live", aodFallback: false
    }
  };
}
const pts = Array.from({ length: 121 }, (_, i) => ({
  name: "点" + i, prov: "广东省",
  lat: lat + (i % 11) * 0.08, lon: lon + Math.floor(i / 11) * 0.08,
  P: 40 + (i % 30), Q: 30 + (i % 50), grade: "liang", type: "高积云",
  cover: 35, covers: [10, 15, 10], base: 2.4, d: 120, dur: 28, aod: 0.28,
  cld: 0.2, T550: 0.71, color: "amber", occ: 0.4, ref: 0.3, refGap: 0.1,
  p: { ens: 45, gfs: 48, ec: 42, rt: 44, ref: 46 },
  q: { ens: 52, gfs: 55, ec: 49, rt: 51, ref: 50 }
}));
const store = {
  ["SUNGLOW.v2.point.v3." + date + "|am" + coord]: JSON.stringify(point("am", 62, 74)),
  ["SUNGLOW.v2.point.v3." + date + "|pm" + coord]: JSON.stringify(point("pm", 55, 68)),
  ["SUNGLOW.v2.trend.v3." + date + coord]: JSON.stringify({
    ts: 1790000000000,
    obj: [{ date, am: { p: 62, q: 74, grade: "you" }, pm: { p: 55, q: 68, grade: "liang" } }]
  }),
  ["SUNGLOW.v2.map.v2." + mapDate + coord]: JSON.stringify({
    ts: 1790000000000,
    obj: { am: { pts, note: "朝霞", dateS: mapDate }, pm: { pts, note: "晚霞", dateS: mapDate } }
  })
};
globalThis.localStorage = {
  get length() { return Object.keys(store).length; },
  key: (i) => Object.keys(store)[i],
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = v; },
  removeItem: (k) => { delete store[k]; }
};

const q = { lat, lon, date, period: "am", mapDate, name: "广州" };
const out = await buildSharePack(q);
if (!out) throw new Error("buildSharePack returned null");
const dir = path.join(root, "native/app/src/test/resources/pack");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "web-pack.txt"), out.pack + "\n", "utf8");
fs.writeFileSync(path.join(dir, "web-pack-meta.json"), JSON.stringify(out.info, null, 2), "utf8");
console.log("pack chars", out.pack.length, "parts", out.info.parts.join(","), "stride", out.info.mapStride, "entries", out.info.entries);
