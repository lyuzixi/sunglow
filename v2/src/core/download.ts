/* =========================================================================
   SUNGLOW v2 · 原生 Android 内测包的唯一口径（网页端 + 构建脚本共用）
   2026-11-12 拍板：走 GitHub Release 的 apk-latest 稳定直链，网页端不托管二进制。
   emit-download-qr.mjs 会解析本文件里的 APK_URL / RELEASE_API，注入独立下载页，
   避免 URL 在 Vue 源码、静态页和二维码里出现三份互相漂移的副本。
   ========================================================================= */

/** CI（.github/workflows/android.yml）每次推 native/ 都会覆盖这个资产。 */
export const APK_URL =
  "https://github.com/lyuzixi/sunglow/releases/download/apk-latest/app-debug.apk";

/** 下载页运行时读取资产大小 / 更新时间 / 下载次数；失败走兜底文案。 */
export const RELEASE_API =
  "https://api.github.com/repos/lyuzixi/sunglow/releases/tags/apk-latest";

/** 独立下载页：由 emit-download-qr.mjs 生成到仓库根，不在 publish-root FILES 内。 */
export const DOWNLOAD_PAGE = "./download.html";

/** 浮层「不再提示」：永久标记，Android 顶部横幅与桌面二维码卡共用。 */
export const APK_DISMISS_KEY = "SUNGLOW.v2.apkBannerDismissed";
