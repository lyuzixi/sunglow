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
const ICON_COUNT = FILES.filter((f) => /^(favicon|icon)-/.test(f)).length;

/* ---------- 被扫描的文档 ---------- */
const DOCS = [
  "README.md",
  "v2/README.md",
  "v2/tutorial.html",
  "v2/404.html",
  "code-wiki.html"
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

if (issues.length) {
  console.error(`check-consistency: ${issues.length} 处不一致`);
  for (const s of issues) console.error("  ✗ " + s);
  process.exit(1);
}
console.log(
  `check-consistency: ✓ ${DOCS.length} 份文档与交付清单一致（${FILES.length} 个文件 / ${ICON_COUNT} 个图标）`
);
