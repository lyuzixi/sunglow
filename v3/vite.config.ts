import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { viteSingleFile } from "vite-plugin-singlefile";

// 霞光预报 GLOWCAST v3「追光航志」—— 独立构建链，与原版 assemble.py、v2 工程完全隔离。
// 双轨产物：
//   npm run build            → dist/            标准多文件（部署用，需 HTTP 服务）
//   npm run build:standalone → standalone.html  单文件（JS/CSS/字体全内联，断网双击即开）
export default defineConfig(({ mode }) => {
  const standalone = mode === "standalone";
  return {
    plugins: standalone ? [vue(), viteSingleFile()] : [vue()],
    base: "./",
    build: {
      outDir: standalone ? "dist-standalone" : "dist",
      assetsInlineLimit: standalone ? 2 * 1024 * 1024 : 2048,
      chunkSizeWarningLimit: 1200
    }
  };
});
