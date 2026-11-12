/* =========================================================================
   publish-root.mjs —— 把 V2 交付物发布到仓库根（GitHub Pages 入口）
   链在 build 之后自动跑：vite build && emit-single.mjs && publish-root.mjs

   背景（2026-10-26 拍板）：V2 是项目主线，交付物落到仓库根——根 index.html
   即线上站点；V1/ 保留在仓库，Skyglow/ 为历史归档，入口已跨域
   （https://sky.sunglow.cloud/）。源码工程留在 v2/（构建需要
   manifest.webmanifest / icon-192.png 等输入在场），根目录是发布副本。

   做法：FILES 里的全部交付文件从 v2/ 拷贝到仓库根，逐文件 sha256 校验；
   例外：sw.js 发布时把 VERSION 重写成「index.html 内容哈希」—— Service Worker
   必须每次构建都换字节，浏览器才会发现新版本并交给页面弹「新版本已就绪」。
   缺文件 / 拷贝校验失败 / 根 index.html 残留指向上级的跨目录链接 ⇒ exit 1。
   为什么机制化：根副本是线上交付物，手动拷贝必漂移（仓库纪律：判据必须机制化，
   参照 emit-single 对稳定文件名与残留哈希的校验思路）。
   ========================================================================= */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");   // v2/
const repo = path.resolve(root, "..");                  // 仓库根

/* 交付文件全集：index.html 是构建产物，其余是静态伴侣（404/教程/PWA 配套）。
   注意 app.html / README / package.json / src/ 等工程文件不发布。

   2026-11-12 例外：根 download.html（Android 内测包下载页）**不在这里**。
   它需要先按 Release 直链生成内联二维码，不能原样拷贝；由 emit-download-qr.mjs
   从 v2/download.src.html 生成并直接落到仓库根，已在 build 链最前面跑。
   不把它计入 FILES，也避免改动「N 个交付文件」这一被门禁卡住的文档口径。 */
const FILES = [
  "index.html",
  "404.html",
  "tutorial.html",
  "sw.js",
  "manifest.webmanifest",
  "favicon-192.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "apple-touch-icon-180.png",
];

/* 根副本位于仓库根，同级目录（V1/）都不该出现 ../ 前缀链接；
   页脚的版本切换入口在源码里就写 V1/index.html（2026-10-26 拍板：源码直接改），
   Skyglow 走绝对地址 https://sky.sunglow.cloud/（已独立），
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

  /* Service Worker 是唯一需要「每次构建都换字节」的交付物：
     VERSION 由 index.html 内容哈希决定，旧缓存随之作废，页面才能弹出更新提示。 */
  if (f === "sw.js") {
    const indexSrc = fs.existsSync(path.join(repo, "index.html"))
      ? path.join(repo, "index.html")
      : path.join(root, "index.html");
    if (!fs.existsSync(indexSrc)) {
      console.error("✗ sw.js 无法构建戳：index.html 不存在");
      bad++;
      continue;
    }
    const buildId = crypto.createHash("sha256")
      .update(fs.readFileSync(indexSrc)).digest("hex").slice(0, 12);
    const text = fs.readFileSync(src, "utf8").replace(
      /const VERSION = "[^"]+";/,
      'const VERSION = "glowcast-v2-pwa-' + buildId + '";'
    );
    fs.writeFileSync(dst, text, "utf8");
    /* 两条都要过：戳写对了，且源文件的 __BUILD_ID__ 占位确实被替换掉
       （占位残留 = 浏览器永远认为没有新版本） */
    if (!text.includes('glowcast-v2-pwa-' + buildId) || text.includes("__BUILD_ID__")) {
      console.error("✗ sw.js 构建戳写入失败");
      bad++;
      continue;
    }
    console.log("  ✓ sw.js -> sw.js（构建戳 glowcast-v2-pwa-" + buildId + "）");
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
