/* 取证：降级方案对照板 —— 读回实测标注 + 分段截图 */
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tb-dg-"));
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

const PAGE = pathToFileURL(path.resolve(__dirname, "topbar-badge.html")).href;
ab("open", PAGE);
ab("set", "viewport", "1400", "1000");
ab("wait", "900");

const fits = ab("eval", `[...document.querySelectorAll('.fit')].map(e=>e.id.replace('fit-','')+': '+e.textContent).join(' | ')`)
  .split("\n")
  .join("");
console.log("FITS " + fits);

const shots = [];
for (let y = 0; y < 6; y++) {
  ab("eval", "window.scrollTo(0," + y * 900 + ")");
  ab("wait", "250");
  const p = path.join(OUT, "dg" + y + ".png");
  ab("screenshot", p);
  shots.push(p);
}
ab("close", "--all");
console.log(shots.join("\n"));
