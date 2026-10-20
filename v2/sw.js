/* 一次性退役 shim：v2 改为单文件形态，不再使用 Service Worker。
   旧版本注册的 SW 是 cache-first，会把老页面一直喂给回访者；
   这个文件存在的唯一目的就是把自己注销掉、清掉 glowcast-v2-* 缓存。
   生效一次后本文件即可删除。 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("glowcast-v2-")).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const cs = await self.clients.matchAll({ type: "window" });
    cs.forEach((c) => c.navigate(c.url));
  })());
});
