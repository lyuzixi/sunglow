import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

// GLOWCAST v2 —— 单一交付形态：**一个 HTML 文件**（JS/CSS/字体全部内联）。
//   源码入口：app.html（开发/构建入口，不对外）
//   交付产物：index.html（npm run build 生成，双击即可离线使用）
// 已删除：dist/ 多文件产物、PWA（sw.js/manifest/图标）、v2 独立 404 页 ——
// 它们都要"多个文件"才能成立，与单文件形态互斥。
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
