/* =========================================================================
   check-consistency.mjs —— 文档与交付清单一致性门禁（npm run build 前置）

   2026-10-31：把「文档里写死的数字 / 旧命名空间」变成可执行判据：
     1) 文档与静态页不得残留旧存储前缀 glowcast.v2
     2) 文档里的「N 个交付文件 / 仓库根 N 个文件 / N 文件拷到仓库根 …」
        必须等于 publish-root 的 FILES 长度
     3) 文档里的「图标×N」必须等于 FILES 里的图标文件数
     4) 文档里出现的 SUNGLOW.v2.* 键必须在 v2/src 源码里真实存在（防键名漂移）

   失败即 exit 1，由 npm run build 前置拦截。
   ========================================================================= */
import fs from "node:fs";
import path from "node:path";

const v2 = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(v2, "..");

/* ---------- 唯一事实源：publish-root.mjs 的 FILES ---------- */
const publishSrc = fs.readFileSync(path.join(v2, "scripts/publish-root.mjs"), "utf8");
const filesBlock = publishSrc.match(/const FILES = \[([\s\S]*?)\];/);
if (!filesBlock) {
  console.error("✗ 解析不到 publish-root.mjs 的 FILES 清单（源码结构变了？）");
  process.exit(2);
}
const FILES = [...filesBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const ICON_COUNT = FILES.filter((f) => /^(favicon|icon|apple-touch-icon)-/.test(f)).length;

/* ---------- 被扫描的文档 ---------- */
const DOCS = [
  "README.md",
  "v2/README.md",
  "v2/tutorial.html",
  "v2/404.html",
  "code-wiki.html",
  "V1/README.md",
  "Skyglow/README.md"
];

/* ---------- 源码全文（键名存在性判据用） ---------- */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}
const srcText = walk(path.join(v2, "src")).map((f) => fs.readFileSync(f, "utf8")).join("\n");

const issues = [];
const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;

/* ---------- 判据 ---------- */
const LEGACY = "glowcast.v2";
const COUNT_PATTERNS = [
  /(\d+)\s*个交付文件/g,
  /仓库根\s*(\d+)\s*个文件/g,
  /发布文件全集（(\d+)\s*个）/g,
  /自动发布\s*(\d+)\s*(?:个)?文件/g,
  /自动更新仓库根\s*(\d+)\s*文件/g,
  /(\d+)\s*文件拷到仓库根/g,
  /(\d+)\s*文件逐个\s*sha256/g
];
const ICON_RE = /图标×(\d+)/g;
const KEY_RE = /SUNGLOW\.v2\.[A-Za-z0-9_.]+/g;

for (const rel of DOCS) {
  const p = path.join(repo, rel);
  if (!fs.existsSync(p)) {
    issues.push(`${rel}: 文件不存在`);
    continue;
  }
  const text = fs.readFileSync(p, "utf8");

  let i = text.indexOf(LEGACY);
  while (i !== -1) {
    issues.push(`${rel}:${lineOf(text, i)} 仍使用旧前缀 ${LEGACY}`);
    i = text.indexOf(LEGACY, i + 1);
  }

  for (const re of COUNT_PATTERNS) {
    for (const m of text.matchAll(re)) {
      if (Number(m[1]) !== FILES.length) {
        issues.push(`${rel}:${lineOf(text, m.index)} 写死「${m[0]}」，实际交付文件 ${FILES.length} 个`);
      }
    }
  }

  for (const m of text.matchAll(ICON_RE)) {
    if (Number(m[1]) !== ICON_COUNT) {
      issues.push(`${rel}:${lineOf(text, m.index)} 写死「${m[0]}」，实际图标 ${ICON_COUNT} 个`);
    }
  }

  for (const m of text.matchAll(KEY_RE)) {
    const key = m[0];
    if (key.includes("*")) continue;
    if (!srcText.includes(key)) {
      issues.push(`${rel}:${lineOf(text, m.index)} 文档键 ${key} 在 v2/src 里找不到（键名漂移？）`);
    }
  }
}

/* ---------- FIX-05 ①：根 index.html 的版本互跳口径 ----------
   Skyglow 已独立部署（2026-11-10 拍板·方案甲），根产物里不得再出现仓库内
   路径 Skyglow/index.html，且必须带跨域绝对地址。 */
const rootIndex = path.join(repo, "index.html");
if (!fs.existsSync(rootIndex)) {
  issues.push("index.html: 根产物不存在（先 cd v2 && npm run build）");
} else {
  const html = fs.readFileSync(rootIndex, "utf8");
  if (html.includes("Skyglow/index.html")) {
    issues.push("index.html: 仍指向 Skyglow/index.html（Skyglow 已独立，应改 https://sky.sunglow.cloud/）");
  }
  if (!html.includes("https://sky.sunglow.cloud/")) {
    issues.push("index.html: 缺少 Skyglow 跨域入口 https://sky.sunglow.cloud/");
  }
}

/* ---------- FIX-05 ②：额度 / TTL / 预算 —— 文档数字必须由源码常量推导 ----------
   这些数字以前靠人手抄（地图额度在文档里落后了一个数量级），改成一算一验：
   单点 = 样带点数 × 3 路；地图 = 网格点数 × 3 路；趋势 = 朝晚两趟 × 样带点数 × 3 路。 */
const readSrc = (rel) => fs.readFileSync(path.join(v2, rel), "utf8");
const mapdataSrc = readSrc("src/core/mapdata.ts");
const forecastSrc = readSrc("src/core/forecast.ts");
const maploadSrc = readSrc("src/core/mapload.ts");
const apiSrc = readSrc("src/core/api.ts");
const num = (m) => (m ? Number(m[1]) : NaN);

const MAP_RADIUS_KM = num(mapdataSrc.match(/MAP_RADIUS_KM = (\d+)/));
const MAP_GRID_KM = num(mapdataSrc.match(/MAP_GRID_KM = (\d+)/));
const TRANSECT_N = (mapdataSrc.match(/export const TRANSECT = \[([\s\S]*?)\];/) || [, ""])[1]
  .split(",").map((s) => s.trim()).filter(Boolean).length;
const API_ROUTES = 3;                     /* GFS / EC / AQ */
const GRID_N = (() => {
  const n = Math.floor(MAP_RADIUS_KM / MAP_GRID_KM);
  let c = 0;
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      if ((j * MAP_GRID_KM) ** 2 + (i * MAP_GRID_KM) ** 2 > MAP_RADIUS_KM ** 2 + 1e-6) continue;
      c++;
    }
  }
  return c;
})();
const CALLS_POINT = TRANSECT_N * API_ROUTES;
const CALLS_MAP = GRID_N * API_ROUTES;
const CALLS_TREND = 2 * TRANSECT_N * API_ROUTES;
const POINT_BUDGET_S = num(forecastSrc.match(/withBudget\([\s\S]{0,240}?,\s*(\d{4,6})\s*\)/)) / 1000;
const REQ_TIMEOUT_S = num(apiSrc.match(/timeoutMs = (\d+)/)) / 1000;
const MAP_BUDGET_S = num(maploadSrc.match(/JGET_TIMEOUT_MS = (\d+)/)) / 1000;
const TTL_H = num(mapdataSrc.match(/MAP_CACHE_TTL = (\d+) \* 3600000/));

for (const [k, v] of Object.entries({
  MAP_RADIUS_KM, MAP_GRID_KM, TRANSECT_N, GRID_N, POINT_BUDGET_S, REQ_TIMEOUT_S, MAP_BUDGET_S, TTL_H
})) {
  if (!Number.isFinite(v) || v <= 0) {
    console.error(`✗ 无法从源码推导常量 ${k}（源码结构变了？）`);
    process.exit(2);
  }
}

/* 额度 / TTL / 预算只约束 Sunglow Spectrum Edition（V2）自己的文档：
   V1 与 Skyglow 是独立版本，各自有各自的额度与缓存口径，不能拿 V2 常量去卡。 */
const V2_DOCS = ["README.md", "v2/README.md", "v2/tutorial.html", "v2/404.html", "code-wiki.html"];

/* 额度：旧值 171 一律禁止（363 = 121 点 × 3 路）；总量必须能在总览 README 里查到。
   只匹配「171 次 / ≈171」这类额度表述，避免误伤行号 1712、V1 自己的「约 171 个」格点。 */
const LEGACY_QUOTA_RES = [/171\s*次/g, /≈\s*171(?!\d)/g];
for (const rel of V2_DOCS) {
  const p = path.join(repo, rel);
  if (!fs.existsSync(p)) continue;
  const text = fs.readFileSync(p, "utf8");
  for (const re of LEGACY_QUOTA_RES) {
    for (const m of text.matchAll(re)) {
      issues.push(`${rel}:${lineOf(text, m.index)} 仍写旧地图额度「${m[0]}」（应为 ${CALLS_MAP}）`);
    }
  }
  /* TTL 口径：凡写「缓存 N 小时」的都必须等于源码 TTL */
  for (const m of text.matchAll(/缓存\s*(\d+)\s*小时/g)) {
    if (Number(m[1]) !== TTL_H) {
      issues.push(`${rel}:${lineOf(text, m.index)} 写「${m[0]}」，源码 TTL 是 ${TTL_H} 小时`);
    }
  }
}

const rootReadme = fs.readFileSync(path.join(repo, "README.md"), "utf8");
for (const s of [`单点约 ${CALLS_POINT} 次`, `地图约 ${CALLS_MAP} 次`, `趋势约 ${CALLS_TREND} 次`]) {
  if (!rootReadme.includes(s)) issues.push(`README.md: 取数账目缺少「${s}」`);
}

/* 教程页三语必须同口径：词典以简体整句为键，键值缺一就会静默回落中文 */
const tutText = fs.readFileSync(path.join(repo, "v2/tutorial.html"), "utf8");
const countOf = (s) => tutText.split(s).length - 1;
if (countOf(`约 ${CALLS_MAP} 次加权调用`) < 1) {
  issues.push(`v2/tutorial.html: 简体正文 / 词典键缺少「约 ${CALLS_MAP} 次加权调用」`);
}
if (countOf(`約 ${CALLS_MAP} 次加權呼叫`) !== 1) {
  issues.push(`v2/tutorial.html: 繁体值「約 ${CALLS_MAP} 次加權呼叫」应恰好出现 1 次`);
}
if (countOf(`~${CALLS_MAP} weighted calls`) !== 1) {
  issues.push(`v2/tutorial.html: 英文值「~${CALLS_MAP} weighted calls」应恰好出现 1 次`);
}
if (!tutText.includes(`≈${CALLS_MAP}`)) {
  issues.push(`v2/tutorial.html: 数字卡应写 ≈${CALLS_MAP}`);
}

/* 预算：v2/README 的超时口径必须与源码一致 */
const v2Readme = fs.readFileSync(path.join(repo, "v2/README.md"), "utf8");
for (const s of [`${POINT_BUDGET_S}s`, `${REQ_TIMEOUT_S}s`, `${MAP_BUDGET_S}s`]) {
  if (!v2Readme.includes(s)) issues.push(`v2/README.md: 超时预算缺少「${s}」（与源码常量对齐）`);
}
if (/预算\s*9s/.test(v2Readme)) issues.push("v2/README.md: 仍写「预算 9s」（应为 12s）");

if (issues.length) {
  console.error(`check-consistency: ${issues.length} 处不一致`);
  for (const s of issues) console.error("  ✗ " + s);
  process.exit(1);
}
console.log(
  `check-consistency: ✓ ${DOCS.length} 份文档与交付清单一致（${FILES.length} 个文件 / ${ICON_COUNT} 个图标）`
);
