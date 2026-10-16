/* 霞光预报 · Service Worker
   **由 assemble.py 生成，勿手改**（改了会被下一次构建覆盖）。
   缓存版本 106a74b9bccd —— 它是**产物内容的 sha256 前 12 位**，不是手写的版本号。

   只做一件事：让"打开页面"这件事不再依赖网络。
   刻意不做的事：**不缓存任何气象响应**。过期预报比没有预报更危险 ——
   用户在山顶、海边拿着昨天的数据当今天的看，而页面上根本看不出那是旧的。
   所以这里只认下面这份预缓存名单（同源静态资源 + 404 页），名单之外的请求
   一律不拦截：跨域（气象接口 / 腾讯地图 SDK 与瓦片 / 省界 GeoJSON）连看都不看，
   同源但不在名单里的（自建部署时地图代理 /_TMapService 就在同源下）同样不碰。

   策略是 **stale-while-revalidate**：先用缓存应答（秒开），再在后台回源更新，
   于是"下次打开"是新版本，而"这次打开"不用等。
*/
'use strict';
var CACHE = 'sunglow-106a74b9bccd';
/* 相对地址：SW 挂在站点根下，随 scope 一起解析 —— 子路径部署也成立。 */
var PRECACHE = ['./', './index.html', './404.html', './manifest.json',
                './icon-192.png', './icon-512.png'];

function abs(p) { return new URL(p, self.location.href).href; }
function isListed(href) {
  for (var i = 0; i < PRECACHE.length; i++) { if (abs(PRECACHE[i]) === href) return true; }
  return false;
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var u = new URL(req.url);
  /* 跨域一律放行（见文件头：气象 / 地图 / 省界都不碰） */
  if (u.origin !== self.location.origin) return;
  /* 同源但不在名单里 —— 例如自建部署时的地图代理，同样放行 */
  if (!isListed(u.href)) return;

  e.respondWith((function () {
    var cache = caches.open(CACHE);
    /* 后台回源更新。失败（离线）就当没发生 —— 缓存那份照样能用。 */
    var net = cache.then(function (c) {
      return fetch(req).then(function (r) {
        if (r && r.ok) c.put(req, r.clone());
        return r;
      });
    }).catch(function () { return null; });

    return cache.then(function (c) { return c.match(req); }).then(function (hit) {
      if (hit) return hit;                       /* 先给缓存：秒开 */
      return net.then(function (r) {
        if (r) return r;
        /* 离线且这份没缓存过：导航请求回落到缓存的 404 页 —— 它本来就是
           为"取不到"准备的，而且同样自包含、能在任意路径下独立打开。 */
        if (req.mode === 'navigate') {
          return cache.then(function (c) { return c.match(abs('./404.html')); })
                      .then(function (nf) { return nf || new Response('', { status: 503 }); });
        }
        return new Response('', { status: 503 });
      });
    });
  })());
});
