/* 一次性单测（不进门禁）：重试次数 / 错误分级 / 旧缓存兜底
   esbuild 打包成 CJS 后跑 node；fetch 与 localStorage 全用桩，不碰网络。 */
import "./globals";
import { apiForecastBatched, MapFetchError } from "../../src/core/mapload";
import { runForecast, pointCacheClear } from "../../src/core/forecast";

const ctl = (globalThis as unknown as { __omc: { mode: string; calls: string[] } }).__omc;
const store = (globalThis as unknown as { __store: Map<string, string> }).__store;

let pass = 0; const fails: string[] = [];
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fails.push(name + (detail ? " — " + detail : "")); console.log("  ✗ " + name + (detail ? " — " + detail : "")); }
}

const PTS = [{ lat: 22.54, lon: 114.06 }, { lat: 22.6, lon: 114.12 }];

async function tryBatch(): Promise<unknown> {
  try {
    await apiForecastBatched("gfs_seamless", PTS, "2026-11-19", "2026-11-19", "Asia/Shanghai", ["cloud_cover_mid"]);
    return null;
  } catch (e) { return e; }
}

async function main() {
  console.log("\n[1] 网络错误（fetch reject）→ 3 次尝试 + 可读文案");
  ctl.mode = "reject"; ctl.calls = [];
  const e1 = await tryBatch() as MapFetchError | null;
  ok("抛错而不是静默返回", !!e1);
  ok("恰好 3 次尝试", ctl.calls.length === 3, "实际 " + ctl.calls.length);
  ok("错误带可读文案", /连续 3 次失败/.test(e1?.friendly || ""), e1?.friendly || "(空)");

  console.log("\n[2] 5xx → 也重试 3 次");
  ctl.mode = "500"; ctl.calls = [];
  await tryBatch();
  ok("5xx 尝试 3 次", ctl.calls.length === 3, "实际 " + ctl.calls.length);

  console.log("\n[3] 4xx → 只打 1 次（不拿额度换同样的错误）");
  ctl.mode = "400"; ctl.calls = [];
  await tryBatch();
  ok("400 尝试 1 次", ctl.calls.length === 1, "实际 " + ctl.calls.length);

  console.log("\n[4] 429 → 只打 1 次（限流期间绝不重试）");
  ctl.mode = "429"; ctl.calls = [];
  const e4 = await tryBatch() as MapFetchError | null;
  ok("429 尝试 1 次", ctl.calls.length === 1, "实际 " + ctl.calls.length);
  ok("429 文案讲的是限流", /限流/.test(e4?.friendly || ""), e4?.friendly || "(空)");

  console.log("\n[5] 取数成功 → 落缓存");
  ctl.mode = "ok"; ctl.calls = []; store.clear(); pointCacheClear();
  const city = { name: "深圳市", region: "广东省", lat: 22.5431, lon: 114.0579 } as never;
  const r1 = await runForecast({ city, dateStr: "2026-11-19", period: "pm" }) as Record<string, unknown>;
  ok("成功返回 ok:true", r1.ok === true, String(r1.error || ""));
  ok("src=live", r1.src === "live", String(r1.src));
  ok("缓存已写入", store.size > 0, "键数 " + store.size);

  console.log("\n[6] 之后 fetch 全失败 + force → 回落到旧缓存并带 staleH");
  ctl.mode = "reject"; ctl.calls = [];
  const r2 = await runForecast({ city, dateStr: "2026-11-19", period: "pm", force: true }) as Record<string, unknown>;
  ok("仍然有结果（ok:true）", r2.ok === true, String(r2.error || ""));
  ok("来源标成 cache", r2.src === "cache", String(r2.src));
  ok("带 staleH 年龄", typeof r2.staleH === "number", String(r2.staleH));

  console.log("\n[6b] 缓存已过 12h 窗口 + fetch 全失败 → 不许再兜底");
  for (const k of Array.from(store.keys())) {
    const j = JSON.parse(store.get(k) || "null");
    if (j && j.ts) { j.ts = Date.now() - 13 * 3600000; store.set(k, JSON.stringify(j)); }
  }
  const r2b = await runForecast({ city, dateStr: "2026-11-19", period: "pm", force: true }) as Record<string, unknown>;
  ok("超窗后不再给旧数据", r2b.ok === false, JSON.stringify(r2b).slice(0, 100));

  console.log("\n[7] 没有缓存 + fetch 全失败 → 报错且不造数");  store.clear(); pointCacheClear();
  const r3 = await runForecast({ city, dateStr: "2026-11-19", period: "pm", force: true }) as Record<string, unknown>;
  ok("ok:false", r3.ok === false, JSON.stringify(r3).slice(0, 120));
  ok("错误文案可操作", /重试|重新计算|网络/.test(String(r3.error || "")), String(r3.error || "(空)"));
  ok("失败结果没有写进缓存", !Array.from(store.keys()).some((k) => k.indexOf("SUNGLOW.v2.point") === 0), Array.from(store.keys()).join(","));

  console.log("\n[8] 断网（navigator.onLine=false）→ 只说「没有联网」");
  (globalThis as unknown as { navigator: { onLine: boolean } }).navigator.onLine = false;
  ctl.mode = "reject";
  const r4 = await runForecast({ city, dateStr: "2026-11-19", period: "pm", force: true }) as Record<string, unknown>;
  ok("给出离线文案", /没有联网/.test(String(r4.error || "")), String(r4.error || "(空)"));
  (globalThis as unknown as { navigator: { onLine: boolean } }).navigator.onLine = true;

  console.log(`\n结果：${pass} 通过 / ${fails.length} 失败`);
  if (fails.length) { console.log(fails.map((f) => " - " + f).join("\n")); process.exit(1); }
}

void main();
