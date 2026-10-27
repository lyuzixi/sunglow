/* =========================================================================
   publish-root.mjs —— 把 V2 交付物发布到仓库根（GitHub Pages 入口）
   链在 build 之后自动跑：vite build && emit-single.mjs && publish-root.mjs

   背景（2026-10-26 拍板）：V2 是项目主线，交付物落到仓库根——根 index.html
   即线上站点，V1/、Skyglow/ 退为同级归档。源码工程留在 v2/（构建需要
   manifest.webmanifest / icon-192.png 等输入在场），根目录是发布副本。

   做法：7 个交付文件从 v2/ 拷贝到仓库根，逐文件 sha256 校验；
   缺文件 / 拷贝校验失败 / 根 index.html 残留指向上级的跨目录链接 ⇒ exit 1。
   为什么机制化：根副本是线上交付物，手动拷贝必漂移（仓库纪律：判据必须机制化，
   参照 emit-single 对稳定文件名与残留哈希的校验思路）。
   ========================================================================= */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");   // v2/
const repo = path.resolve(root, "..");                  // 仓库根

/* 交付文件全集：index.html 是构建产物，其余是静态伴侣（404/教程/PWA 四件套）。
   注意 app.html / README / package.json / src/ 等工程文件不发布。 */
const FILES = [
  "index.html",
  "404.html",
  "tutorial.html",
  "sw.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
];

/* 根副本位于仓库根，同级目录（V1/、Skyglow/）都不该出现 ../ 前缀链接；
   页脚「切换到V1」在源码里就写 V1/index.html（2026-10-26 拍板：源码直接改），
   所以根产物里任何 ../ 跨目录链接都视为回归。 */
const BAD_PATTERNS = ["../V1/", "../v2/", "../Skyglow/"];

const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

let bad = 0;

for (const f of FILES) {
  const src = path.join(root, f);
  const dst = path.join(repo, f);
  if (!fs.existsSync(src)) {
    console.error("✗ 缺交付文件（v2/ 下没有）:", f);
    bad++;
    continue;
  }
  fs.copyFileSync(src, dst);
  if (sha256(src) !== sha256(dst)) {
    console.error("✗ 拷贝校验失败（sha256 不一致）:", f);
    bad++;
    continue;
  }
  console.log("  ✓", f, "->", path.relative(repo, dst));
}

const htmlPath = path.join(repo, "index.html");
if (fs.existsSync(htmlPath)) {
  const html = fs.readFileSync(htmlPath, "utf8");
  for (const pat of BAD_PATTERNS) {
    if (html.includes(pat)) {
      console.error("✗ 根 index.html 残留跨目录链接:", pat);
      bad++;
    }
  }
} else {
  console.error("✗ 根 index.html 未生成");
  bad++;
}

if (bad) {
  console.error("publish-root: " + bad + " 项失败，构建失败");
  process.exit(1);
}
console.log("publish-root: " + FILES.length + " 个交付文件已发布到仓库根并校验通过");
