/* hash 路由（双击/任意静态托管可开） */
import { createRouter, createWebHashHistory } from "vue-router";
import HomeView from "./views/HomeView.vue";
import NotFoundView from "./views/NotFoundView.vue";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "home", component: HomeView },
    { path: "/:pathMatch(.*)*", name: "404", component: NotFoundView }
  ],
  scrollBehavior() {
    return { top: 0 };
  }
});
