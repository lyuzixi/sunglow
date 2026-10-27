/* 边界取证：英文导航 / 超长州名 / 窄视口，单行顶栏是否溢出 */
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tb-edge-"));
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
const PROBE = `(()=>{
  const inn=document.querySelector('.topbar-in');
  const pill=document.querySelector('.top-actions > .meta-pill');
  const pr=pill?pill.getBoundingClientRect():null;
  const ir=inn.getBoundingClientRect();
  return [inn.scrollWidth, inn.clientWidth, inn.scrollWidth-inn.clientWidth,
          Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
          pill?Math.round(pr.right-ir.right):'nopill'].join(',');
})()`;

function run(label, url, w, lang) {
  ab("open", url);
  ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'${lang}',theme:'light'}))`);
  ab("set", "viewport", String(w), "900");
  ab("reload");
  ab("wait", "1200");
  console.log(label + " [" + lang + " " + w + "px] scrollW,clientW,over,barH,pillOverRight : " + ab("eval", PROBE).split("\n").join(""));
}

const Q = (enc) => BASE + "?name=" + encodeURIComponent(enc) + "&lat=39.9&lon=116.4&date=2026-10-21&period=pm";
run("广州市", Q("广州市"), 1280, "zh");
run("广州市", Q("广州市"), 1280, "en");
run("克孜勒苏柯尔克孜自治州", Q("克孜勒苏柯尔克孜自治州"), 1280, "zh");
run("克孜勒苏柯尔克孜自治州", Q("克孜勒苏柯尔克孜自治州"), 1280, "en");
run("广州市", Q("广州市"), 1100, "zh");
run("广州市", Q("广州市"), 1090, "zh");
ab("close", "--all");
