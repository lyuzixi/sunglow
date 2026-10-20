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

const html = fs.readFileSync(src, "utf8");
if (/<script[^>]+src=|<link[^>]+rel=["']stylesheet["']/i.test(html)) {
  console.error("emit-single: 产物里仍有外链资源，不是单文件，已中止");
  process.exit(2);
}

/* 产物文件名统一成 index.html（GitHub Pages 的目录入口） */
fs.writeFileSync(out, html, "utf8");
fs.rmSync(build, { recursive: true, force: true });

const kb = (fs.statSync(out).size / 1024).toFixed(1);
console.log("emit-single: index.html 已生成（" + kb + " KB，零外链）");
