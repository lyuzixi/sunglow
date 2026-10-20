// 注册 Service Worker。file:// 下浏览器无 SW 环境，直接跳过；
// 其余场景注册 ./sw.js（相对路径，适配任意子路径部署），失败静默。
export function registerSW() {
  if (location.protocol === "file:") return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
