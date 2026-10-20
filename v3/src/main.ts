/* GLOWCAST v3「追光航志」· 入口 */
import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { initState } from "./state";
import "@fontsource/ibm-plex-serif/latin-400.css";
import "@fontsource/ibm-plex-serif/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./styles/tokens.css";
import "./styles/main.css";

initState();
createApp(App).use(router).mount("#app");
