/* 跨脚本块命名冲突扫描
   =========================================================================
   为什么需要这个探针：
     单文件产物里有 3 个内联 <script>，其中
       块 0 = _p2.js + _p3.js + _p4.js + _p5.js + _p5b.js
       块 1 = _TMapSecurityConfig（124 字符，无声明）
       块 2 = _p6.js
     三个块**共享同一个全局作用域**，于是：

       · 两个块声明同名 `function`  → 后执行的块**静默顶掉**前者。
                                     不报错、不警告，调用点照旧通过，
                                     只是语义完全变成了另一个函数。
       · 两个块声明同名 `const/let/class` → 抛 SyntaxError，整个块不执行。
                                     （这个响，反而安全。）

     这不是假想风险：`_p6.js` 的 `confOf(km)`（可信度纱用）曾顶掉 `_p4.js` 新增的
     `confOf(dv)`，导致结论卡徽标显示成"可信度 较高 / 距最近采样点 11 km / undefined"。
     值域断言抓不到它 —— 返回值结构合法，只是语义完全不同。

   本探针做两件事：
     ① 扫描块 0 与块 2 的**顶层**声明，报告跨块重名（按危险等级分类）；
     ② 额外检查：是否声明了与浏览器内置全局同名的标识符（例如 `function close()`
        会顶掉 `window.close`，`function name()` 同理）—— 这一类的后果同样是静默的。

   用法：node _check/globals.js
   退出码：0 = 通过（无致命项），1 = 存在致命项（块间 const 冲突 / 内置名遮蔽）
   ========================================================================= */
"use strict";
const fs = require("fs");
const path = require("path");

const BASE = path.resolve(__dirname, "..");

/* 块划分必须与 assemble.py 的 PARTS / 注入方式保持一致。
   改 assemble.py 的 PARTS 顺序或块归属时，这里要同步改。 */
const BLOCK0_FILES = ["_p2.js", "_p3.js", "_p4.js", "_p5.js", "_p5b.js"];
const BLOCK2_FILES = ["_p6.js"];

/* 顶层声明。项目约定顶格写（列 0），块内嵌套声明有缩进，因此 ^ 锚定足够。
   刻意匹配 `async function` / `export` 之外的常见形态即可，不追求完整解析。 */
const DECL_RE = /^(?:async\s+)?(function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;

function readDecls(file) {
  const src = fs.readFileSync(path.join(BASE, file), "utf8");
  const out = [];
  DECL_RE.lastIndex = 0;
  let m;
  while ((m = DECL_RE.exec(src)) !== null) {
    /* 计算行号，便于直接定位 */
    const line = src.slice(0, m.index).split("\n").length;
    out.push({ kind: m[1], name: m[2], file, line });
  }
  return out;
}

/* 浏览器/JS 内置全局名：顶层 `function`/`var` 声明会写进 window，
   同名即遮蔽内置。只列真正可能被无意占用的常见名。 */
const BUILTINS = new Set([
  "close", "open", "name", "length", "status", "origin", "top", "self", "parent",
  "focus", "blur", "print", "stop", "find", "alert", "confirm", "prompt",
  "fetch", "history", "location", "navigator", "screen", "frames", "closed",
  "scroll", "scrollBy", "scrollTo", "moveBy", "moveTo", "resizeBy", "resizeTo",
  "setTimeout", "setInterval", "clearTimeout", "clearInterval",
  "addEventListener", "removeEventListener", "dispatchEvent",
  "requestAnimationFrame", "cancelAnimationFrame", "queueMicrotask",
  "encodeURIComponent", "decodeURIComponent", "parseInt", "parseFloat", "isNaN",
  "structuredClone", "atob", "btoa", "matchMedia", "getComputedStyle",
  "Image", "Event", "CustomEvent", "Node", "Element", "Text", "Comment",
  "Map", "Set", "Promise", "Proxy", "Reflect", "Symbol", "BigInt",
  "Worker", "WebSocket", "IntersectionObserver", "ResizeObserver", "MutationObserver",
]);

const block0 = BLOCK0_FILES.flatMap(readDecls);
const block2 = BLOCK2_FILES.flatMap(readDecls);

const fails = [];
const warns = [];
const notes = [];

/* ---- ① 跨块重名 ------------------------------------------------------- */
function crossBlock(a, b, labelA, labelB) {
  const mapA = new Map();
  for (const d of a) {
    if (!mapA.has(d.name)) mapA.set(d.name, []);
    mapA.get(d.name).push(d);
  }
  for (const d of b) {
    const hits = mapA.get(d.name);
    if (!hits) continue;
    for (const h of hits) {
      /* 词法声明（const/let/class）重复 → SyntaxError，整个块不执行。致命。 */
      const lexical = k => k === "const" || k === "let" || k === "class";
      if (lexical(h.kind) || lexical(d.kind)) {
        fails.push(
          `[块间词法冲突] ${d.name}：${h.file}:${h.line} (${h.kind}) ↔ ` +
          `${d.file}:${d.line} (${d.kind}) —— 重复声明会抛 SyntaxError，导致 ${labelB} 整块不执行`
        );
      } else if (h.kind === "function" && d.kind === "function") {
        fails.push(
          `[静默覆盖] ${d.name}：${labelB} 的 ${d.file}:${d.line} 会顶掉 ` +
          `${labelA} 的 ${h.file}:${h.line}（函数声明是覆盖语义，不报错；` +
          `调用点仍能跑，但语义已换）`
        );
      } else {
        warns.push(
          `[同名但未必有害] ${d.name}：${h.file}:${h.line} (${h.kind}) ↔ ` +
          `${d.file}:${d.line} (${d.kind})`
        );
      }
    }
  }
}
crossBlock(block0, block2, "块 0", "块 2");

/* ---- ② 块内重复（同一块里的 const 重复同样致命） ---------------------- */
function withinBlock(list, label) {
  const seen = new Map();
  for (const d of list) {
    if (!seen.has(d.name)) { seen.set(d.name, []); }
    seen.get(d.name).push(d);
  }
  for (const [name, ds] of seen) {
    if (ds.length < 2) continue;
    const lexical = ds.some(x => x.kind === "const" || x.kind === "let" || x.kind === "class");
    const msg = `${name} 在${label}内声明了 ${ds.length} 次：` +
      ds.map(x => `${x.file}:${x.line}(${x.kind})`).join(" / ");
    if (lexical) fails.push(`[块内词法冲突] ${msg}`);
    else if (ds.every(x => x.kind === "function")) fails.push(`[块内静默覆盖] ${msg}`);
    else warns.push(`[块内重复] ${msg}`);
  }
}
withinBlock(block0, "块 0");
withinBlock(block2, "块 2");

/* ---- ③ 遮蔽内置全局 --------------------------------------------------- */
for (const d of block0.concat(block2)) {
  if (!BUILTINS.has(d.name)) continue;
  if (d.kind === "function" || d.kind === "var") {
    fails.push(
      `[遮蔽内置全局] ${d.name}（${d.file}:${d.line}，${d.kind}）—— ` +
      `顶层 function/var 会写进 window 并顶掉同名内置，后果静默`
    );
  } else {
    warns.push(`[同名于内置] ${d.name}（${d.file}:${d.line}，${d.kind}）—— 词法声明不写 window，通常无害，确认一下`);
  }
}

/* ---- 报告 ------------------------------------------------------------- */
const total = block0.length + block2.length;
console.log(`扫描顶层声明：块 0 = ${block0.length} 条 / 块 2 = ${block2.length} 条（共 ${total}）`);

/* 顺带把两个块都声明了的"高风险命名族"打印出来，供人工确认是否该加前缀。
   不是断言，只是把可疑清单摆到眼前。 */
const namesIn0 = new Set(block0.map(d => d.name));
const namesIn2 = new Set(block2.map(d => d.name));
const shared = [...namesIn0].filter(n => namesIn2.has(n));
if (shared.length) {
  notes.push(`两个块都出现的名字（已逐条判定，未必有问题）：${shared.join(", ")}`);
}

if (warns.length) {
  console.log("\n-- 提醒（不致命，需人工确认）--");
  for (const w of warns) console.log("  WARN " + w);
}
if (notes.length) {
  console.log("\n-- 备注 --");
  for (const n of notes) console.log("  NOTE " + n);
}

if (fails.length) {
  console.log("\n-- 失败项 --");
  for (const f of fails) console.log("  FAIL " + f);
  console.log(`\nFAIL 计数: ${fails.length}`);
  process.exitCode = 1;
} else {
  console.log("\n跨块命名冲突：0 项。OK");
  process.exitCode = 0;
}
