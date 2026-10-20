/* =========================================================================
   emit-single.mjs —— 把单文件构建产物落到 v2/index.html
   输入：dist-standalone/app.html（viteSingleFile 已把 JS/CSS/字体全部内联）
   输出：index.html（唯一交付文件），随后清掉中间目录
   ========================================================================= */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const build = path.join(root, "dist-standalone");
const src = path.join(build, "app.html");
const out = path.join(root, "index.html");

if (!fs.existsSync(src)) {
  console.error("emit-single: 找不到 " + src + "（构建失败？）");
  process.exit(1);
}

const raw = fs.readFileSync(src, "utf8");
if (/<script[^>]+src=|<link[^>]+rel=["']stylesheet["']/i.test(raw)) {
  console.error("emit-single: 产物里仍有外链资源，不是单文件，已中止");
  process.exit(2);
}

/* PWA 附属文件（manifest / 图标）无法内联，Vite 会给它们加内容哈希并改名，
   而它们被我们删掉的中间目录一起带走了 ⇒ 线上 404。
   这里把引用改回同目录下的稳定文件名（文件本身由仓库提供，不再由构建生成）。 */
const RENAME = [
  [/\.\/manifest-[A-Za-z0-9_-]+\.webmanifest/g, "./manifest.webmanifest"],
  [/\.\/icon-192-[A-Za-z0-9_-]+\.png/g, "./icon-192.png"],
  [/\.\/icon-512-[A-Za-z0-9_-]+\.png/g, "./icon-512.png"]
];
let html = raw;
for (const [re, to] of RENAME) html = html.replace(re, to);

/* 引用必须能在同目录找到实体文件，否则宁可构建失败也别上线一个装不了的 PWA */
for (const f of ["manifest.webmanifest", "icon-192.png", "icon-512.png"]) {
  if (html.includes("./" + f) && !fs.existsSync(path.join(root, f))) {
    console.error("emit-single: 引用了 " + f + "，但 " + root + " 下没有这个文件");
    process.exit(3);
  }
}
if (/\.\/[a-z0-9-]+-[A-Za-z0-9_-]{6,}\.(webmanifest|png)/i.test(html)) {
  console.error("emit-single: 仍有带哈希的附属文件引用，已中止");
  process.exit(4);
}

/* 产物文件名统一成 index.html（GitHub Pages 的目录入口） */
fs.writeFileSync(out, html, "utf8");
fs.rmSync(build, { recursive: true, force: true });

const kb = (fs.statSync(out).size / 1024).toFixed(1);
console.log("emit-single: index.html 已生成（" + kb + " KB，零外链）");
