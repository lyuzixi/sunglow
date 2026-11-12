/* =========================================================================
   emit-download-qr.mjs —— 生成独立下载页 download.html（仓库根）

   2026-11-12 拍板：二维码不依赖任何图片服务，构建时用项目已有的
   qrcode-generator 把 Release 直链编成内联 SVG 注入模板；页面离线也能显示码。

   为什么直接写仓库根、而不是加进 publish-root.mjs 的 FILES：
     · FILES 是「原样拷贝 + sha256 校验」的清单，本页需要按 URL 重新生成，不能原样拷；
     · FILES 长度是 check-consistency 卡文档里「N 个交付文件」的唯一事实源，
       往里加一项会连带改 tutorial 三语词典的键，代价远大于收益。
   源码在 v2/download.src.html，常量唯一来源在 v2/src/core/download.ts。
   产物是仓库根的 download.html（与 index.html 一样属于发布副本，禁手改）。
   ========================================================================= */
import fs from "node:fs";
import path from "node:path";
import qrcode from "qrcode-generator";

const v2 = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(v2, "..");
const tplPath = path.join(v2, "download.src.html");
const constPath = path.join(v2, "src/core/download.ts");
const outPath = path.join(repo, "download.html");

function pick(text, name) {
  const m = text.match(new RegExp("export const " + name + "\\s*=\\s*\\n?\\s*\"([^\"]+)\""));
  if (!m) throw new Error("core/download.ts 里解析不到 " + name + "（常量格式变了？）");
  return m[1];
}

const consts = fs.readFileSync(constPath, "utf8");
const apkUrl = pick(consts, "APK_URL");
const releaseApi = pick(consts, "RELEASE_API");
const apkFile = apkUrl.split("/").pop() || "app-debug.apk";

/* L 级容错、自动选版本：与 ShareQrDialog.vue 同一套参数，白底深码便于扫码。 */
const qr = qrcode(0, "L");
qr.addData(apkUrl);
qr.make();
const n = qr.getModuleCount();
const cell = 6;
const margin = 4;
const size = (n + margin * 2) * cell;
let d = "";
for (let y = 0; y < n; y++) {
  for (let x = 0; x < n; x++) {
    if (!qr.isDark(y, x)) continue;
    const px = (x + margin) * cell;
    const py = (y + margin) * cell;
    d += "M" + px + " " + py + "h" + cell + "v" + cell + "h-" + cell + "z";
  }
}
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
  '" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges">' +
  '<rect width="100%" height="100%" fill="#ffffff"/>' +
  '<path d="' + d + '" fill="#0b1020"/></svg>';

let html = fs.readFileSync(tplPath, "utf8").replace(/\r\n/g, "\n");
for (const [key, val] of Object.entries({
  __APK_URL__: apkUrl,
  __RELEASE_API__: releaseApi,
  __APK_FILE__: apkFile,
  __QR_SVG__: svg
})) {
  if (!html.includes(key)) throw new Error("下载页模板缺少占位符 " + key);
  html = html.replaceAll(key, val);
}
if (/__APK_URL__|__RELEASE_API__|__APK_FILE__|__QR_SVG__/.test(html)) {
  throw new Error("下载页模板占位符未全部替换");
}
/* 全仓 LF：产物也强制归一化，避免 Windows 上生成 CRLF 后再被 sha256 判漂移。 */
fs.writeFileSync(outPath, html.replace(/\r\n/g, "\n"), "utf8");
console.log("  ✓ download.html <- download.src.html（内联二维码 " + size + "px，指向 " + apkFile + "）");
