/* 浏览器环境最小桩（必须在其它 import 之前加载：i18n.ts / snapshot.ts
   在模块初始化阶段就摸 document 与 localStorage） */
const el: Record<string, unknown> = {
  setAttribute() { /* noop */ },
  getAttribute() { return null; },
  removeAttribute() { /* noop */ },
  appendChild() { /* noop */ },
  removeChild() { /* noop */ },
  addEventListener() { /* noop */ },
  removeEventListener() { /* noop */ },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  style: {},
  dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  textContent: "",
  innerHTML: ""
};
const doc = {
  documentElement: el,
  body: el,
  head: el,
  title: "",
  readyState: "complete",
  createElement: () => el,
  createTextNode: () => el,
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener() { /* noop */ },
  removeEventListener() { /* noop */ },
  head_appendChild: undefined
};

const g = globalThis as unknown as Record<string, unknown>;
function put(k: string, v: unknown) {
  Object.defineProperty(globalThis, k, { value: v, writable: true, configurable: true, enumerable: true });
}
put("document", doc);
put("window", globalThis);
put("self", globalThis);
put("HTMLElement", class {});
put("HTMLCanvasElement", class {});
put("Node", class {});
put("requestAnimationFrame", (f: (t: number) => void) => setTimeout(() => f(0), 0));
put("cancelAnimationFrame", () => { /* noop */ });
put("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
put("navigator", { onLine: true, language: "zh-CN", userAgent: "node" });
put("location", { href: "https://sunglow.cloud/", search: "", hash: "", pathname: "/", origin: "https://sunglow.cloud" });
put("history", { state: null, replaceState() {}, pushState() {} });

/* localStorage 桩：store 从 g.__store 暴露给测试读 */
const store = new Map<string, string>();
put("__store", store);
put("localStorage", {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
  clear() { store.clear(); }
});

/* fetch 桩：mode 由测试切换；calls 记录每次尝试 */
const ctl: { mode: string; calls: string[] } = { mode: "ok", calls: [] };
put("__omc", ctl);

function bodyOf(nPts: number, vars: string[]) {
  const t0 = Date.parse("2026-11-19T00:00:00Z");
  const time = Array.from({ length: 24 }, (_, i) => new Date(t0 + i * 3600000).toISOString().slice(0, 16));
  const hourly: Record<string, unknown> = { time };
  const DEF: Record<string, number> = {
    temperature_2m: 18, dew_point_2m: 12, relative_humidity_2m: 65,
    cloud_cover_low: 20, cloud_cover_mid: 45, cloud_cover_high: 30,
    visibility: 20000, pressure_msl: 1013, wind_speed_10m: 3, wind_direction_10m: 90,
    boundary_layer_height: 800, freezing_level_height: 3000,
    precipitation: 0, cape: 0, aerosol_optical_depth: 0.18
  };
  for (const v of vars) hourly[v] = time.map(() => (v in DEF ? DEF[v] : null));
  const one = { hourly, utc_offset_seconds: 28800, timezone: "Asia/Shanghai" };
  return nPts > 1 ? Array.from({ length: nPts }, () => one) : one;
}

put("fetch", (u: string) => {
  ctl.calls.push(String(u));
  const q = new URL(String(u), "https://x/").searchParams;
  const n = (q.get("latitude") || "").split(",").filter(Boolean).length || 1;
  const vars = (q.get("hourly") || "").split(",").filter(Boolean);
  const nullHeaders = { get: () => null };
  if (ctl.mode === "reject") return Promise.reject(new TypeError("Failed to fetch"));
  if (ctl.mode === "429") {
    return Promise.resolve({
      ok: false, status: 429, headers: nullHeaders,
      text: () => Promise.resolve("Minutely API request limit exceeded")
    });
  }
  if (ctl.mode === "500" || ctl.mode === "400") {
    const code = ctl.mode === "500" ? 500 : 400;
    return Promise.resolve({ ok: false, status: code, headers: nullHeaders, text: () => Promise.resolve("") });
  }
  return Promise.resolve({
    ok: true, status: 200, headers: nullHeaders,
    json: () => Promise.resolve(bodyOf(n, vars)),
    text: () => Promise.resolve("")
  });
});
