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
