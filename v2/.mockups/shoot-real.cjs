/* 一次性取证：真实产物在几个关键宽度/语言下的顶栏截图 */
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tb-real-"));
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
const Q = (name) =>
  BASE + "?name=" + encodeURIComponent(name) + "&lat=39.9042&lon=116.4074&date=2026-10-21&period=pm";

const cases = [
  { label: "real-1280-zh", w: 1280, h: 260, name: "北京市", lang: "zh", theme: "light" },
  { label: "real-1280-dark", w: 1280, h: 260, name: "北京市", lang: "zh", theme: "dark" },
  { label: "real-1080-fold", w: 1080, h: 300, name: "北京市", lang: "zh", theme: "light" },
  { label: "real-1280-en", w: 1280, h: 260, name: "北京市", lang: "en", theme: "light" },
  { label: "real-1280-en-long", w: 1280, h: 300, name: "克孜勒苏柯尔克孜自治州", lang: "en", theme: "light" },
  { label: "real-390", w: 390, h: 300, name: "北京市", lang: "zh", theme: "light" }
];

for (const c of cases) {
  ab("open", Q(c.name));
  ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'${c.lang}',theme:'${c.theme}'}))`);
  ab("set", "viewport", String(c.w), String(c.h));
  ab("reload");
  ab("wait", "1800");
  const p = path.join(OUT, "topbar-" + c.label + ".png");
  ab("screenshot", p);
  console.log(p);
}
ab("close", "--all");
