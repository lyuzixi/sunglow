/* 腾讯位置服务（TMap）代理中转 —— Cloudflare Pages Function。
 *
 * 为什么需要这个文件
 * ------------------
 * 腾讯地图 JS API 的 key 不能明文写进前端产物：产物是单文件 HTML，谁都能看到
 * key，然后拿它去刷你的配额。腾讯位置服务官方因此要求**公网发布必须改用代理方案**
 * （官方原话：「明文 Key 仅限本地，公网发布必须改用代理方案」，做法叫 glKeyDelegate）。
 * 这个 Functions 文件就是那个代理：它把四条官方路由转发给腾讯的服务器，并在
 * **服务端**把 key 拼上去。key 只存在于 Pages 的环境变量里，永不进入产物。
 *
 * 四条路由（顺序与前端 `serviceHost` 的相对路径一一对应，来自官方文档）
 * -------------------------------------------------------------------
 *   /_TMapService              → https://pr.map.qq.com/pingd?appid=jsapi_v3          &key=
 *   /_TMapService/checkKey     → https://apikey.map.qq.com/mkey/index.php/mkey/check &key=
 *   /_TMapService/oversea      → https://overseactrl.map.qq.com                      &apikey=
 *   /_TMapService/service/...  → https://apis.map.qq.com/ws/...                      &key=
 *
 * 注意最后一条：路径要**透传**。腾讯的 WebService API 把接口写在路径里
 * （例如 /ws/place/v1/search），只把主机换掉、路径丢掉的话所有业务接口都会 404。
 *
 * 怎么用
 * ------
 *   1. 去 https://lbs.qq.com 申请一个「Web 端 (JS API)」key，并在控制台把
 *      你的站点域名加进白名单。
 *   2. 在 Pages 项目的 Settings → Environment variables 里加一个变量：
 *        TMAP_KEY = 你的 key
 *   3. 构建时把 serviceHost 指到同源的 /_TMapService：
 *        TMAP_SERVICE_HOST=https://你的域名/_TMapService python assemble.py
 *      （不设这个环境变量时 assemble.py 会回落到本地预览用的占位符形态，
 *        也就是开发预览环境的行为完全不变。）
 *
 * 同源带来的好处：没有 CORS、没有混合内容问题（Pages 默认 HTTPS）。
 *
 * 合规说明：本文件只是转发，底图与地理数据仍由腾讯位置服务提供 ——
 * 在中国境内展示地图需要测绘资质，请勿为了省一个 key 换成 OSM 之类的境外底图。
 */

const UPSTREAMS = [
  // [路径段,        上游基址,                                              参数名 ]
  ["", "https://pr.map.qq.com/pingd?appid=jsapi_v3", "key"],
  ["checkKey", "https://apikey.map.qq.com/mkey/index.php/mkey/check", "key"],
  ["oversea", "https://overseactrl.map.qq.com", "apikey"],
  ["service", "https://apis.map.qq.com/ws", "key"],
];

export async function onRequest({ request, params, env }) {
  const seg = (params.path || [])[0] || "";
  // "" 是合法的一段（对应 /_TMapService 本身），所以用 find 而不是真值判断。
  const up = UPSTREAMS.find((u) => u[0] === seg);
  if (!up) return new Response("not found", { status: 404 });

  const key = env && env.TMAP_KEY;
  if (!key) {
    // 明确说清楚是"没配 key"，而不是返回一个上游的 4xx 让人去猜。
    return new Response(
      "TMAP_KEY 未配置：请在 Pages 的环境变量里设置它（见 functions/_TMapService/[[path]].js 顶部说明）",
      { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  const url = new URL(request.url);
  // 保留上游已有的查询参数（pingd 的 appid 就在里面），再补上 key。
  const q = new URLSearchParams(url.search);
  q.set(up[2], key);

  // 只有 service 这一条把接口路径写在 URL 里，需要透传。
  // 正则用贪婪的 .* 是为了剥到**最后**一个 /service —— 万一站点部署在子路径下
  // （例如 /app/_TMapService/service/...），非贪婪会把前缀留在路径里。
  const tail = seg === "service" ? url.pathname.replace(/^.*\/service/, "") : "";

  const method = request.method;
  const init = { method, headers: {} };
  if (method !== "GET" && method !== "HEAD") {
    // WebService 有些接口是 POST JSON，body 必须原样转过去。
    init.body = request.body;
    const ct = request.headers.get("content-type");
    if (ct) init.headers["content-type"] = ct;
  }

  return fetch(up[1] + tail + "?" + q.toString(), init);
}
