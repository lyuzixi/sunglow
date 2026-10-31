import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

// SUNGLOW v2 —— 单一交付形态：**一个 HTML 文件**（JS/CSS/字体全部内联）。
//   源码入口：app.html（开发/构建入口，不对外）
//   交付产物：index.html（npm run build 生成，双击即可离线使用）
// Vite 只负责产出单文件 app.html；404/tutorial/sw/manifest/图标是 v2/ 下的
// 静态伴侣，由 publish-root 与 index.html 一并发布到仓库根（不经过 Vite）。
export default defineConfig(() => ({
  plugins: [vue(), viteSingleFile()],
  base: "./",
  build: {
    outDir: "dist-standalone",
    emptyOutDir: true,
    assetsInlineLimit: 4 * 1024 * 1024,
    chunkSizeWarningLimit: 2000,
    /* 入口不是 index.html：index.html 是**产物名**，源码入口叫 app.html */
    rollupOptions: {
      input: resolve(__dirname, "app.html")
    }
  }
}));
