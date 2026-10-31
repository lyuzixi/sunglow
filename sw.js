/* =========================================================================
   SUNGLOW v2 · Service Worker（正式版，取代此前的一次性退役 shim）
   目标：可安装 + 断网可开 + 秒开；**不碰气象响应**（额度与新鲜度都不许缓存）。
   策略：
     · 导航请求（HTML）：网络优先，失败回落缓存 —— 保证更新能及时生效
     · 静态资源（图标/manifest）：stale-while-revalidate
     · 一切跨域请求（open-meteo、map.qq.com）：直接放行，不进缓存
   版本号变更即在 activate 里清掉旧缓存。
   ========================================================================= */
const VERSION = "glowcast-v2-pwa-4";
const CORE = [
  "./",
  "./index.html",
  "./tutorial.html",
  "./404.html",
  "./manifest.webmanifest",
  "./favicon-192.png",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    /* 逐个 add，单个失败不拖垮整体安装 */
    await Promise.all(CORE.map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== VERSION && k.startsWith("glowcast")).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

function isSameOrigin(url) {
  try { return new URL(url).origin === self.location.origin; } catch { return false; }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (!isSameOrigin(req.url)) return;                    // 气象接口/地图瓦片：不拦
  const url = new URL(req.url);
  if (url.pathname.endsWith("/sw.js")) return;

  /* 导航：网络优先，断网回落缓存里的 index.html（hash 路由，任意 hash 都算首页） */
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put("./index.html", fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        const cache = await caches.open(VERSION);
        return (await cache.match("./index.html")) ||
          (await cache.match("./")) ||
          new Response("<h1>离线</h1><p>还没有缓存到首屏，请连网打开一次。</p>",
            { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    })());
    return;
  }

  /* 静态：先给缓存，同时后台更新 */
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req);
    const net = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);
    return hit || (await net) || new Response("", { status: 504 });
  })());
});
