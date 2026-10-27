/* 一次性取证：多语言下的城市名与地图自绘地名（英 / 繁 / 简 + 手机英文） */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const cmd = path.join(
  path.dirname(process.execPath),
  "node_modules",
  "agent-browser",
  "bin",
  "agent-browser-win32-x64.exe"
);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lang-shot-"));
const OUT = path.join(__dirname, ".shots");
fs.mkdirSync(OUT, { recursive: true });

function ab(...args) {
  const out = path.join(TMP, "o.txt");
  const err = path.join(TMP, "e.txt");
  const fo = fs.openSync(out, "w");
  const fe = fs.openSync(err, "w");
  try {
    execFileSync(cmd, args, { stdio: ["ignore", fo, fe], timeout: 120000 });
  } catch (e) {
    const m = fs.existsSync(err) ? fs.readFileSync(err, "utf8").trim() : "";
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error(m || String(e && e.message));
  } finally {
    fs.closeSync(fo);
    fs.closeSync(fe);
  }
  return fs.readFileSync(out, "utf8").trim();
}

const BASE = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href;
const Q = (name, lat, lon) =>
  BASE + "?name=" + encodeURIComponent(name) + "&lat=" + lat + "&lon=" + lon +
  "&date=2026-10-22&period=pm";

const cases = [
  { label: "lang-en", lang: "en", theme: "light", w: 1280, h: 900 },
  { label: "lang-hant", lang: "hant", theme: "light", w: 1280, h: 900 },
  { label: "lang-zh", lang: "zh", theme: "light", w: 1280, h: 900 },
  { label: "lang-en-dark", lang: "en", theme: "dark", w: 1280, h: 900 },
  { label: "lang-hant-390", lang: "hant", theme: "light", w: 390, h: 844 }
];

for (const c of cases) {
  ab("open", Q("广州市", 23.1291, 113.2644));
  ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'${c.lang}',theme:'${c.theme}',cityName:'广州市'}))`);
  ab("set", "viewport", String(c.w), String(c.h));
  ab("reload");
  ab("wait", "2600");
  ab("screenshot", path.join(OUT, "hero-" + c.label + ".png"));
  if (c.w > 900) {
    ab("eval", `document.querySelector('#field').scrollIntoView({block:'start'});1`);
    ab("wait", "900");
    ab("screenshot", path.join(OUT, "map-" + c.label + ".png"));
  }
  console.log(c.label, "ok");
}
ab("close", "--all");
