// 由 scripts/gen-sw.mjs 生成，勿手改。
const cacheName = "glowcast-v2-ea46405533ed";
const PRECACHE = ["./404.html", "./assets/index-CPasUqmr.js", "./assets/index-DOVYp2Zm.css", "./assets/inter-latin-400-normal-C38fXH4l.woff2", "./assets/inter-latin-400-normal-CyCys3Eg.woff", "./assets/inter-latin-500-normal-BL9OpVg8.woff", "./assets/inter-latin-500-normal-Cerq10X2.woff2", "./assets/inter-latin-600-normal-CiBQ2DWP.woff", "./assets/inter-latin-600-normal-LgqL8muc.woff2", "./assets/space-grotesk-latin-400-normal-BnQMeOim.woff", "./assets/space-grotesk-latin-400-normal-CJ-V5oYT.woff2", "./assets/space-grotesk-latin-500-normal-CNSSEhBt.woff", "./assets/space-grotesk-latin-500-normal-lFbtlQH6.woff2", "./assets/space-grotesk-latin-600-normal-BflQw4A9.woff", "./assets/space-grotesk-latin-600-normal-DjKNqYRj.woff2", "./assets/space-grotesk-latin-700-normal-CwsQ-cCU.woff", "./assets/space-grotesk-latin-700-normal-RjhwGPKo.woff2", "./icon-192.png", "./icon-512.png", "./index.html", "./manifest.webmanifest", "./tutorial.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.indexOf("glowcast-v2-") === 0 && k !== cacheName)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// 气象 / 空气质量 API：绝对不缓存，直接网络透传（不 respondWith = 走浏览器默认网络）。
const NEVER_CACHE_HOSTS = ["api.open-meteo.com", "air-quality-api.open-meteo.com"];

// 同源 cache-first：未命中则网络，成功的响应回填缓存。
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, res.clone());
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (NEVER_CACHE_HOSTS.indexOf(url.hostname) >= 0) return;
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // 导航：cache-first，网络也挂了（离线）才回退到缓存的 index.html；
    // 在线时深路径照常交给服务端，让 404.html 兜底。
    event.respondWith(
      (async () => {
        try {
          return await cacheFirst(request);
        } catch (err) {
          const shell = await caches.match("./index.html");
          return shell || Response.error();
        }
      })()
    );
    return;
  }

  event.respondWith(cacheFirst(request));
});
