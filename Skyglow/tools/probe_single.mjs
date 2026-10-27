/* Skyglow single-file probe: open index.html over file:// with a deterministic
   Open-Meteo stub, then walk the real UI.

   Usage:
     node tools/probe_single.mjs                     # chrome + edge + webkit
     node tools/probe_single.mjs --browser=chrome
     node tools/probe_single.mjs --browser=edge
     node tools/probe_single.mjs --browser=webkit
   Missing kernels are reported as SKIP and do not fail the run. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PAGE = path.join(HERE, "index.html");
const PAGE_URL = pathToFileURL(PAGE).href;

/* Playwright's browser cache lives in AppData by default; use the sandbox-friendly
   cache dir unless the caller overrides it. Must be set before importing. */
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(os.homedir(), ".cache", "ms-playwright");
}
const { chromium, webkit } = await import("playwright");

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=(.*)$/);
  return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
}));
const wanted = (args.browser || "all").split(",");
const TARGETS = [
  { id: "chrome", kind: "chromium", channel: "chrome" },
  { id: "edge", kind: "chromium", channel: "msedge" },
  { id: "webkit", kind: "webkit" },
].filter(t => wanted.includes("all") || wanted.includes(t.id));

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- deterministic upstream stub ---------------- */
function series(name, n, hours, modelIdx) {
  const out = [];
  for (let i = 0; i < n; i++) {
    for (let h = 0; h < hours; h++) {
      let v;
      switch (name) {
        case "cloud_cover_low": v = 15 + ((i * 17 + h * 7) % 45) + (modelIdx - 1.5) * 4; break;
        case "cloud_cover_mid": v = 25 + ((i * 11 + h * 5) % 55) + (modelIdx - 1.5) * 3; break;
        case "cloud_cover_high": v = 40 + ((i * 13 + h * 3) % 55) + (modelIdx - 1.5) * 2; break;
        case "relative_humidity_2m": v = 60 + ((i * 3 + h) % 30); break;
        case "precipitation": v = h % 11 === 0 ? 0.8 : 0.0; break;
        case "boundary_layer_height": v = 500 + ((i * 5 + h * 9) % 1500); break;
        case "visibility": v = 12000 + (i % 5) * 3000; break;
        case "aerosol_optical_depth": v = 0.05 + ((i * 7 + h) % 40) / 100; break;
        default: v = 50;
      }
      out.push(Math.round(Math.max(0, Math.min(name === "visibility" || name === "boundary_layer_height" ? 1e6 : name === "precipitation" ? 10 : name === "aerosol_optical_depth" ? 2 : 100, v)) * 1000) / 1000);
    }
  }
  return out;
}

function timesFor(start, end) {
  const out = [];
  const t0 = Date.parse(start + "T00:00:00Z");
  const t1 = Date.parse(end + "T00:00:00Z");
  const hours = Math.round((t1 - t0) / 3600000) + 24;
  for (let i = 0; i < hours; i++) {
    out.push(new Date(t0 + i * 3600000).toISOString().slice(0, 16));
  }
  return out;
}

function stubPayload(url) {
  const u = new URL(url);
  if (/geocoding-api/.test(u.hostname)) {
    return { results: [{ name: "杭州", admin1: "浙江", country: "中国",
      latitude: 30.2936, longitude: 120.1614, population: 11936010 }] };
  }
  const lats = (u.searchParams.get("latitude") || "0").split(",");
  const n = lats.length;
  const start = u.searchParams.get("start_date") || "2026-10-27";
  const end = u.searchParams.get("end_date") || start;
  const hourlyVars = (u.searchParams.get("hourly") || "").split(",").filter(Boolean);
  const models = (u.searchParams.get("models") || "").split(",").filter(Boolean);
  const zoned = u.searchParams.get("timezone") === "auto";
  const time = timesFor(start, end);
  const hourly = { time };
  for (const v of hourlyVars) {
    if (models.length) {
      models.forEach((m, mi) => { hourly[`${v}_${m}`] = series(v, n, time.length, mi); });
    } else {
      hourly[v] = series(v, n, time.length, 1.5);
    }
  }
  const points = [];
  for (let i = 0; i < n; i++) {
    points.push({
      latitude: +lats[i], longitude: +(u.searchParams.get("longitude") || "0").split(",")[i],
      utc_offset_seconds: zoned ? 28800 : 0, timezone: zoned ? "Asia/Shanghai" : "UTC",
      elevation: 50, hourly,
    });
  }
  return points.length === 1 ? points[0] : points;
}

async function installStub(page) {
  await page.route(/^https?:\/\//, async route => {
    const url = route.request().url();
    if (/open-meteo\.com/.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(stubPayload(url)),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: "text/plain",
      headers: { "access-control-allow-origin": "*" }, body: "stub: blocked" });
  });
}

/* ---------------- checks ---------------- */
function makeChecks() {
  const rows = [];
  const add = (name, ok, detail) => {
    rows.push({ name, ok, detail: detail == null ? "" : String(detail) });
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  · " + detail : ""}`);
    return ok;
  };
  return { rows, add, get failed() { return rows.filter(r => !r.ok); } };
}

async function canvasInk(page, sel) {
  return page.evaluate(s => {
    const cv = document.querySelector(s);
    if (!cv) return -1;
    const ctx = cv.getContext("2d");
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  }, sel);
}

async function runOne(target) {
  console.log(`\n=== ${target.id} ===`);
  const browser = target.kind === "webkit"
    ? await webkit.launch()
    : await chromium.launch({ channel: target.channel });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => {
    if (m.type() === "error") {
      const t = m.text();
      if (!/Failed to load resource|ERR_FILE_NOT_FOUND/.test(t)) errors.push("console: " + t);
    }
  });
  await installStub(page);
  const c = makeChecks();
  try {
    await page.goto(PAGE_URL, { waitUntil: "load" });
    await page.waitForSelector("#hero", { state: "visible" });
    await page.evaluate(() => localStorage.clear());

    /* 1. 首屏与内联数据 */
    const title = await page.title();
    c.add("首屏标题", /霞光/.test(title), title);
    c.add("验证区内联", (await page.textContent("#validation")).includes("0.802"), "AUC 0.802");
    c.add("页脚模型版本",
      (await page.textContent("#footMeta")).includes("ridge-v2.1")
      && (await page.textContent("#footMeta")).includes("mlp-15-8-4-1"));
    c.add("无直连/和风面板",
      (await page.$("#datasrc")) === null && (await page.$("#qweather")) === null);
    c.add("缓存面板初始为空", /0 条/.test(await page.textContent("#cacheSummary")),
      await page.textContent("#cacheSummary"));

    /* 2. 地名搜索 -> 预测 */
    await page.fill("#loc", "杭州");
    await page.waitForSelector("#suggest button", { timeout: 15000 });
    await page.click("#suggest button");
    c.add("地名解析回填", (await page.inputValue("#loc")).includes("杭州"));
    await page.click("#go");
    await page.waitForFunction(
      () => document.querySelector("#probNum").textContent.trim() !== "—",
      null, { timeout: 60000 });
    c.add("单日预测出数", /\d/.test(await page.textContent("#probNum")),
      (await page.textContent("#probNum")).trim());
    c.add("四源对照表 4 行",
      (await page.$$("#srcTable tbody tr")).length === 4);
    c.add("四源 chips", (await page.$$("#srcChips .src-chip")).length === 4);

    /* 3. 七日趋势 */
    await page.waitForFunction(
      () => document.querySelectorAll("#weekGrid > *").length >= 7,
      null, { timeout: 60000 });
    c.add("七日趋势 7 格", (await page.$$("#weekGrid > *")).length >= 7);

    /* 4. 缓存写入 */
    const nPoint = await page.textContent("#cacheNPoint");
    c.add("单点缓存已写入", parseInt(nPoint, 10) >= 1, nPoint);

    /* 5. 地图：城市 + 全国（含缓存命中） */
    await page.click("#genLocal");
    await page.waitForFunction(
      () => /0\.25°|失败|不可用/.test(document.querySelector("#mapLocalMeta").textContent),
      null, { timeout: 90000 });
    const locMeta = await page.textContent("#mapLocalMeta");
    c.add("城市地图生成", !/失败|不可用/.test(locMeta), locMeta.trim());
    c.add("城市画布有像素", (await canvasInk(page, "#mapLocal")) > 1000);

    await page.click("#genNational");
    await page.waitForFunction(
      () => /格点|失败|不可用/.test(document.querySelector("#mapNatMeta").textContent),
      null, { timeout: 180000 });
    const natMeta = await page.textContent("#mapNatMeta");
    c.add("全国地图生成", /格点/.test(natMeta), natMeta.trim());
    c.add("全国画布有像素", (await canvasInk(page, "#mapNational")) > 5000);

    c.add("全国图首次未命中缓存", !/缓存/.test(natMeta));
    const again = await page.evaluate(async () => {
      const q = new URLSearchParams(location.search);
      const r = await SkyglowService.glowMap({
        scope: "national", date: q.get("date"), mode: q.get("mode"),
        lat: +q.get("lat"), lon: +q.get("lon"), offset: 0,
      });
      return { cached: r.cached, nx: r.nx, ny: r.ny };
    });
    c.add("全国地图二次命中缓存", again.cached === true, JSON.stringify(again));
    c.add("全国格点 608", again.nx * again.ny === 608, `${again.nx}×${again.ny}`);

    /* 6. 无 Key 降级：没有 waKey 也能完整预测（前面已跑通） */
    c.add("未配置 WeatherAPI Key", await page.evaluate(
      () => localStorage.getItem("skyglow:waKey") === null));

    /* 7. 清缓存 */
    await page.click('[data-clear="all"]');
    await sleep(400);
    c.add("清缓存后归零", /0 条/.test(await page.textContent("#cacheSummary")),
      await page.textContent("#cacheSummary"));

    /* 8. 移端 390 */
    const m = await ctx.newPage();
    await m.setViewportSize({ width: 390, height: 844 });
    await installStub(m);
    await m.goto(PAGE_URL, { waitUntil: "load" });
    await m.waitForSelector("#hero", { state: "visible" });
    const ov = await m.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      nav: getComputedStyle(document.querySelector(".nav")).display,
    }));
    c.add("390px 无横向溢出", ov.sw <= ov.cw + 1, `${ov.sw}/${ov.cw}`);
    c.add("390px 顶部导航按设计收起", ov.nav === "none");
    await m.close();

    c.add("无 JS 报错", errors.length === 0, errors.slice(0, 2).join(" | "));
  } catch (e) {
    c.add("流程异常", false, e.message.split("\n")[0]);
  } finally {
    await ctx.close();
    await browser.close();
  }
  return { id: target.id, failed: c.failed };
}

const results = [];
for (const t of TARGETS) {
  try {
    results.push(await runOne(t));
  } catch (e) {
    const msg = String(e.message || e);
    if (/Executable doesn't exist|not found|Failed to launch/i.test(msg)) {
      console.log(`\n=== ${t.id} ===\n  SKIP  ${msg.split("\n")[0]}`);
      results.push({ id: t.id, skipped: true });
    } else {
      console.log(`\n=== ${t.id} ===\n  FAIL  ${msg.split("\n")[0]}`);
      results.push({ id: t.id, failed: [{ name: "launch", detail: msg.split("\n")[0] }] });
    }
  }
}

console.log("\n--- summary ---");
let bad = 0;
for (const r of results) {
  if (r.skipped) console.log(`${r.id.padEnd(7)} SKIP`);
  else if (r.failed.length) { bad++; console.log(`${r.id.padEnd(7)} FAIL (${r.failed.length})`); }
  else console.log(`${r.id.padEnd(7)} PASS`);
}
process.exit(bad ? 1 : 0);
