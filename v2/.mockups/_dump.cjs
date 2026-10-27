/* 取真实色面采样值 dump 成 JSON，供离线复现插值算法（牛眼诊断） */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const cmd = path.join(
  path.dirname(process.execPath), "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe"
);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dump-"));
function ab(...args) {
  const out = path.join(TMP, "o.txt"), err = path.join(TMP, "e.txt");
  const fo = fs.openSync(out, "w"), fe = fs.openSync(err, "w");
  try { execFileSync(cmd, args, { stdio: ["ignore", fo, fe], timeout: 240000 }); }
  catch (e) {
    const m = fs.existsSync(err) ? fs.readFileSync(err, "utf8").trim() : "";
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error(m || String(e && e.message));
  } finally { fs.closeSync(fo); fs.closeSync(fe); }
  return fs.readFileSync(out, "utf8").trim();
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href + "?v=" + Date.now();

/* ev 包 JSON.stringify —— 只放表达式；语句走 ab("eval", ...) */
const ev = (js) => {
  const s = ab("eval", js);
  try { return JSON.parse(s); } catch { return s; }
};

(async () => {
  ab("close", "--all");
  ab("open", PAGE);
  await wait(2500);
  ab("eval", `document.querySelector('#field')?.scrollIntoView({behavior:'instant',block:'start'});1`);
  await wait(800);
  ab("eval", `document.querySelector('#field .btn-primary')?.click();1`);
  await wait(15000);
  const has = ev(`(()=>{const g=window.__gcPts&&window.__gcPts();return g?g.pts.length:-1})()`);
  if (has <= 0) { console.error("没拿到点（可能仍在取数）"); process.exit(1); }
  const dump = (() => {
    let v = ab("eval", `JSON.stringify(window.__gcPts())`);
    for (let i = 0; i < 4; i++) {
      if (v && typeof v === "object") return v;
      try { v = JSON.parse(v); } catch { break; }
    }
    return v;
  })();
  if (!dump || !dump.pts) { console.error("parse 失败:", String(dump).slice(0, 120)); process.exit(1); }
  const out = path.join(__dirname, ".build", "pts.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(dump), "utf8");
  console.log("点数:", dump.pts.length, "dim:", dump.dim, "model:", dump.model);
  console.log("样例:", JSON.stringify(dump.pts.slice(0, 3)));
  ab("close", "--all");
})();
