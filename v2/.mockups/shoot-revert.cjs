/* 一次性取证：撤销「退到背景」后的底图观感（简体浅/深、英文浅，只看地图区） */
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "revert-shot-"));
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
const Q =
  BASE + "?name=" + encodeURIComponent("广州市") + "&lat=23.1291&lon=113.2644" +
  "&date=2026-10-22&period=pm";

const cases = [
  { label: "zh-light", lang: "zh", theme: "light" },
  { label: "zh-dark", lang: "zh", theme: "dark" },
  { label: "en-light", lang: "en", theme: "light" }
];

for (const c of cases) {
  ab("open", Q);
  ab("eval", `localStorage.setItem('glowcast.v2.pref', ` +
    `JSON.stringify({lang:'${c.lang}',theme:'${c.theme}',cityName:'广州市'}))`);
  ab("set", "viewport", "1280", "900");
  ab("reload");
  ab("wait", "2600");
  ab("eval", `document.querySelector('#field').scrollIntoView({block:'start'});1`);
  ab("wait", "1200");
  ab("screenshot", path.join(OUT, "revert-map-" + c.label + ".png"));
  console.log(c.label, "ok");
}
ab("close", "--all");
