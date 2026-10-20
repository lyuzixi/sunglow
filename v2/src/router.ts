import { createRouter, createWebHashHistory } from "vue-router";
import HomeView from "./views/HomeView.vue";
import TutorialView from "./views/TutorialView.vue";
import NotFoundView from "./views/NotFoundView.vue";

// hash 模式：双击 index.html 与任意静态托管都能开（file:// 也稳）。
// 需要干净 URL 时切 createWebHashHistory -> createWebHistory 即可。
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "home", component: HomeView },
    { path: "/tutorial", name: "tutorial", component: TutorialView },
    { path: "/:pathMatch(.*)*", name: "not-found", component: NotFoundView }
  ],
  scrollBehavior(_to, _from, saved) {
    return saved ? { top: saved.top } : { top: 0 };
  }
});
