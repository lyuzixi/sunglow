/* 一次性效果图取证脚本：测量 + 分段截图。用法：node .mockups/shoot.cjs */
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tb-mock-"));

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
const shotDir = path.join(__dirname, ".shots");
fs.mkdirSync(shotDir, { recursive: true });

ab("open", PAGE);
ab("set", "viewport", "1400", "1000");
ab("wait", "900");

/* 每帧的「自然所需宽度」= 子元素宽之和 + 12px 间隙；用来定折回断点 */
const probe = `[...document.querySelectorAll('.frame')].map((f)=>{
  const inn=f.querySelector('.topbar-in');
  const kids=[...inn.children].filter(k=>getComputedStyle(k).display!=='none');
  const need=kids.reduce((s,k)=>s+k.getBoundingClientRect().width,0)+12*(kids.length-1);
  const meta=f.querySelector('.badge-meta');
  return [Math.round(need), !!f.querySelector('.topbar-meta'), meta?Math.round(meta.getBoundingClientRect().width):0, Math.round(f.querySelector('.topbar').getBoundingClientRect().height)].join(',');
}).join('|')`;
const measured = ab("eval", probe).split("\n").join("");
console.log("NEED,TWOROW,METAW,BARH");
for (const line of measured.split("|")) console.log(line);

const shots = [];
for (let y = 0; y < 7; y++) {
  ab("eval", "window.scrollTo(0," + y * 940 + ")");
  ab("wait", "260");
  const p = path.join(shotDir, "seg" + y + ".png");
  ab("screenshot", p);
  shots.push(p);
}
ab("close", "--all");
console.log("TMP=" + TMP);
console.log(shots.join("\n"));
