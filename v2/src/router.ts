import { createRouter, createWebHashHistory } from "vue-router";
import HomeView from "./views/HomeView.vue";
import NotFoundView from "./views/NotFoundView.vue";

// hash 模式：双击 index.html 与任意静态托管都能开（file:// 也稳）。
// 需要干净 URL 时切 createWebHashHistory -> createWebHistory 即可。
// 使用教程不在应用内：独立静态文件 tutorial.html（顶栏书本图标进入，
// 四档三语，与主页共享语言/主题偏好）。2026-10-26 删除了无入口的
// /tutorial 孤儿路由及其视图，避免两份教程各自漂移。
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "home", component: HomeView },
    { path: "/:pathMatch(.*)*", name: "not-found", component: NotFoundView }
  ],
  scrollBehavior(_to, _from, saved) {
    return saved ? { top: saved.top } : { top: 0 };
  }
});
