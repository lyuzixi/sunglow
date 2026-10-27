const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const { pathToFileURL } = require("url");
const cmd = path.join(path.dirname(process.execPath), "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tone-"));
function ab(...args) {
  const o = path.join(TMP, "o.txt"), e = path.join(TMP, "e.txt");
  const fo = fs.openSync(o, "w"), fe = fs.openSync(e, "w");
  try { execFileSync(cmd, args, { stdio: ["ignore", fo, fe], timeout: 120000 }); }
  catch (err) { if (!fs.existsSync(o) || !fs.statSync(o).size) throw new Error(fs.existsSync(e) ? fs.readFileSync(e, "utf8") : String(err)); }
  finally { fs.closeSync(fo); fs.closeSync(fe); }
  return fs.readFileSync(o, "utf8").trim();
}
const BASE = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href;
const SH = path.resolve(__dirname, ".shots");

function shot(name, lang, theme, css) {
  ab("open", BASE + "?name=" + encodeURIComponent("广州市") + "&lat=23.1291&lon=113.2644&date=2026-10-22&period=pm");
  ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'${lang}',theme:'${theme}'}))`);
  ab("set", "viewport", "1280", "900");
  ab("reload");
  ab("wait", "3200");
  ab("eval", `document.querySelector('#field').scrollIntoView();document.querySelector('.rank')&&(document.querySelector('.rank').style.display='none');1`);
  ab("wait", "700");
  if (css) {
    ab("eval", `(()=>{const h=document.querySelector('.map-host');h.style.filter=${JSON.stringify(css)};return 1})()`);
    ab("wait", "400");
  }
  ab("screenshot", path.join(SH, name + ".png"));
  console.log("shot", name);
}

/* 浅色：去色 + 压对比 + 提亮，模拟「中性纸底」 */
shot("tone-light-c", "en", "light", "grayscale(1) contrast(1.15) opacity(0.3)");
/* 浅色更狠一档：再叠一层同底色膜，模拟「退得更远」 */
shot("tone-light-d", "en", "light", "grayscale(1) contrast(1.3) opacity(0.18)");
/* 深色：反相后去色压暗，模拟「墨底」 */
shot("tone-dark-c", "en", "dark", "invert(1) grayscale(1) brightness(1.5) opacity(0.34)");
/* 深色更狠一档 */
shot("tone-dark-d", "en", "dark", "invert(1) grayscale(1) brightness(1.8) opacity(0.2)");

ab("close", "--all");
