import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { applyTheme } from "./state";
import "@fontsource/space-grotesk/latin-400.css";
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-600.css";
import "@fontsource/space-grotesk/latin-700.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "./styles/main.css";

applyTheme();
if (typeof matchMedia !== "undefined") {
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    applyTheme();
  });
}

createApp(App).use(router).mount("#app");

/* PWA：只在 http(s) 下注册 —— file:// 双击打开时没有 SW，也不该在控制台报错 */
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => { /* 不支持就算了，不影响主流程 */ });
  });
}
