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

/* PWA 注册与「新版本已就绪」提示统一在 PwaUpdatePrompt.vue 里处理：
   首次安装自动接管；后续更新先进入 waiting，由用户点「立即刷新」再激活。 */
