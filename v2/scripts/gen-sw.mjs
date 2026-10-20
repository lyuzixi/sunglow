// scripts/gen-sw.mjs —— 依据 dist/ 产物生成 Service Worker。
// 零依赖：只用 node:fs / node:path / node:crypto。由 npm run build（与 build:standalone）
// 在 vite build 之后调用。dist/index.html 不存在时直接跳过（standalone 单文件链路不产 dist/）。
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const distDir = join(process.cwd(), "dist");
const indexPath = join(distDir, "index.html");

if (!existsSync(indexPath)) {
  console.log("gen-sw: dist/index.html 不存在，跳过 Service Worker 生成");
  process.exit(0);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// 预缓存清单：dist/ 全部文件的相对路径，POSIX 斜杠。sw.js 自己不进清单
// （写盘前它还不存在；重跑时带上它也只会让清单随运行次数抖动）。
const files = walk(distDir)
  .map((p) => relative(distDir, p).split(sep).join("/"))
  .filter((rel) => rel !== "sw.js")
  .sort();

// 缓存名以 dist/index.html 内容哈希打版本：内容一变整套缓存换代，旧缓存由 activate 清掉。
const cacheName =
  "glowcast-v2-" + createHash("sha256").update(readFileSync(indexPath)).digest("hex").slice(0, 12);

const precache = files.map((f) => '"./' + f + '"').join(", ");

const sw = `// 由 scripts/gen-sw.mjs 生成，勿手改。
const cacheName = ${JSON.stringify(cacheName)};
const PRECACHE = [${precache}];

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
`;

writeFileSync(join(distDir, "sw.js"), sw);
console.log("gen-sw: 已生成 dist/sw.js（预缓存 " + files.length + " 个文件，cacheName=" + cacheName + "）");
