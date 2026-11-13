/* SUNGLOW · App pack 反向校验（R2-5）
 * 用法：node native/tools/verify-pack.mjs D:\sunglow\.tmp\r2-pack.txt
 * 只做结构校验：包能否解开、键是否命中网页缓存族、字段名是否与网页 schema 对齐。
 */
import { readFileSync } from "node:fs";
import { inflateRawSync, inflateSync } from "node:zlib";

const file = process.argv[2];
if (!file) {
  console.error("usage: node native/tools/verify-pack.mjs <pack-file>");
  process.exit(2);
}
const raw = readFileSync(file, "utf8").trim();
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

ok(raw.length <= 7600, `pack 长度 ${raw.length} 应 ≤ 7600`);
const mode = raw[0];
ok(mode === "z" || mode === "j", `首字符应为 z/j，实际 ${mode}`);
const b64 = raw.slice(1).replace(/-/g, "+").replace(/_/g, "/");
const bytes = Buffer.from(b64, "base64");
let json;
try {
  json = mode === "z" ? inflateRawSync(bytes) : bytes;
} catch {
  json = inflateSync(bytes);
}
const obj = JSON.parse(json.toString("utf8"));

ok(obj.v === 2, `信封版本应为 2，实际 ${obj.v}`);
ok(Number.isFinite(obj.g), "g 应为生成时间戳");
ok(obj.q && typeof obj.q.n === "string", "q.n 应为城市名");
ok(Array.isArray(obj.e) && obj.e.length > 0 && obj.e.length <= 40,
   `e 应为 1–40 条，实际 ${Array.isArray(obj.e) ? obj.e.length : "非数组"}`);

const keys = obj.e.map(([k]) => k);
const pointKey = keys.find((k) => k.startsWith("SUNGLOW.v2.point."));
const trendKey = keys.find((k) => k.startsWith("SUNGLOW.v2.trend."));
const mapKey = keys.find((k) => k.startsWith("SUNGLOW.v2.map."));
ok(pointKey, "缺少 SUNGLOW.v2.point.* 条目");
if (pointKey) {
  ok(/^SUNGLOW\.v2\.point\.v3\.\d{4}-\d{2}-\d{2}\|(am|pm)@-?\d+\.\d,-?\d+\.\d$/.test(pointKey),
     `point 键格式不符：${pointKey}`);
}
if (trendKey) {
  ok(/^SUNGLOW\.v2\.trend\.\d{4}-\d{2}-\d{2}@-?\d+\.\d,-?\d+\.\d$/.test(trendKey),
     `trend 键格式不符：${trendKey}`);
}

const pv = obj.e.find(([k]) => k === pointKey)?.[1];
const o = pv?.obj;
ok(o && typeof o === "object", "point 条目应有 obj");
if (o) {
  for (const k of ["P", "Q", "grade", "dateStr", "period", "envM", "sRT", "sG", "conf", "factorRows", "src"]) {
    ok(k in o, `point.obj 缺少字段 ${k}`);
  }
  ok(o.period === "am" || o.period === "pm", `period 应为 am/pm，实际 ${o.period}`);
  ok(typeof o.P === "number" && typeof o.Q === "number", "P/Q 应为数字");
  ok(o.src === "live" || o.src === "cache", `src 应为 live/cache，实际 ${o.src}`);
  ok(Array.isArray(o.factorRows) && o.factorRows.length === 13,
     `factorRows 应 13 行，实际 ${Array.isArray(o.factorRows) ? o.factorRows.length : "非数组"}`);
  ok(o.factorRows?.[0]?.length === 3, "factorRows 行应为 [key, raw, score]");
  ok(o.conf?.dark && typeof o.conf.dark === "object", "conf.dark 应为嵌套对象");
  ok(typeof o.conf?.lv === "string", "conf.lv 应为字符串");
  ok(o.envM && "T" in o.envM && "Pmsl" in o.envM, "envM 应为 T/Td/RH/P/Pmsl 大写字段");
  ok(o.sRT?.Heq !== undefined, "sRT 应有 Heq");
  ok(o.sRT?.primary?.name, "sRT.primary 应有 name（网页 Deck.name）");
}

const tv = obj.e.find(([k]) => k === trendKey)?.[1];
ok(!trendKey || (tv && Array.isArray(tv.rows)), "trend 条目应有 rows 数组");
if (tv?.rows) {
  ok(tv.rows.length === 2, `本样例趋势应 2 行，实际 ${tv.rows.length}`);
  for (const row of tv.rows) {
    ok(row.period === "am" || row.period === "pm", `趋势 period 非法：${row.period}`);
    ok(typeof row.P === "number" && typeof row.Q === "number", "趋势 P/Q 应为数字");
    ok(typeof row.date === "string" && typeof row.grade === "string", "趋势 date/grade 缺字段");
  }
}

const mv = obj.e.find(([k]) => k === mapKey)?.[1];
if (mapKey) {
  ok(/^SUNGLOW\.v2\.map\.v9\.\d{4}-\d{2}-\d{2}@-?\d+\.\d,-?\d+\.\d$/.test(mapKey),
     `map 键格式不符：${mapKey}`);
  const cm = mv?.cm;
  ok(cm && cm.m === 1, "map 条目应有 cm 且 m=1");
  ok(Array.isArray(cm?.s), "cm.s 应为字符串表");
  ok(Array.isArray(cm?.r), "cm.r 应为行数组");
  ok(cm?.r?.every((row) => Array.isArray(row) && row.length === 32),
     "cm.r 每行应为 32 个整数");
  ok(typeof cm?.d === "string" && Number.isInteger(cm?.na) && Number.isInteger(cm?.ds),
     "cm.d/na/ds 缺字段");
}

console.log(JSON.stringify({
  packChars: raw.length,
  mode,
  version: obj.v,
  city: obj.q?.n,
  date: obj.q?.d,
  period: obj.q?.p,
  entries: obj.e.length,
  keys,
  point: o ? { P: o.P, Q: o.Q, grade: o.grade, factors: o.factorRows?.length, src: o.src } : null,
  trendRows: tv?.rows?.length ?? 0,
  failures: fails
}, null, 2));

if (fails.length) {
  console.error(`\n校验失败 ${fails.length} 项`);
  process.exit(1);
}
console.log("\n校验通过：App pack 可被网页缓存读取入口命中");
