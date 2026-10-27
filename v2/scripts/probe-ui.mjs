#!/usr/bin/env node
/**
 * v2 顶栏界面探针（2026-10-21）
 *
 * 守三件事，别的一概不碰：
 *   1) 设置按钮与右侧三个 .icon-btn 完全同规格（尺寸/圆角/类名口径）
 *   2) 桌面导航 7 项齐全、锚点都活着、滚动高亮跟着走；≤860 交回汉堡抽屉
 *   3) 手机（390px）设置面板不出界、关得掉、与抽屉互斥
 *
 * 用 agent-browser 驱动已有的 file:// 产物 v2/index.html（构建后才有意义）。
 * 每条链都以 open 开头、截图落绝对路径 —— agent-browser 跨进程调用会丢目标。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "glowcast-probe-"));
const PAGE = "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/");

const NAV_LABELS = ["结论", "十日趋势", "观测场", "多地对比", "影响因素", "实况校准", "光追细节"];
const NAV_IDS = ["#verdict", "#trend", "#field", "#compare", "#factors", "#calib", "#ray"];

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log("  ✓ " + name);
  } else {
    fails.push(name + (detail ? " — " + detail : ""));
    console.log("  ✗ " + name + (detail ? " — " + detail : ""));
  }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `得 ${JSON.stringify(got)}，应 ${JSON.stringify(want)}`);
}

/* Windows 上 agent-browser 是 .cmd/.sh 壳，execFileSync 不能直接 spawn 壳脚本，
   所以这里直接定位真正的可执行体（win32 是 .exe，其它平台落到 bin 的 js）。 */
function resolveAB() {
  const exeDir = path.dirname(process.execPath);
  const cands =
    process.platform === "win32"
      ? [path.join(exeDir, "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe")]
      : [path.join(exeDir, "node_modules", "agent-browser", "bin", "agent-browser.js")];
  for (const c of cands) if (fs.existsSync(c)) return { cmd: c, shell: false };
  return { cmd: "agent-browser", shell: true };
}
const AB = resolveAB();

function ab(...args) {
  /* 输出必须落文件、不能接管道：常驻的浏览器守护进程会继承 stdout 的写端，
     execFileSync 因此永远等不到 EOF（表现为命令「卡住」，可它其实已经跑完了）。 */
  const out = path.join(TMP, "ab-out.txt");
  const err = path.join(TMP, "ab-err.txt");
  const fo = fs.openSync(out, "w");
  const fe = fs.openSync(err, "w");
  try {
    execFileSync(AB.cmd, args, {
      stdio: ["ignore", fo, fe],
      timeout: 120000,
      shell: AB.shell
    });
  } catch (e) {
    const msg = fs.existsSync(err) ? fs.readFileSync(err, "utf8").trim() : "";
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
      throw new Error("agent-browser " + args[0] + " 失败：" + (msg || String(e && e.message)));
    }
  } finally {
    fs.closeSync(fo);
    fs.closeSync(fe);
  }
  return fs.readFileSync(out, "utf8").trim();
}
function ev(expr) {
  const raw = ab("eval", `JSON.stringify(${expr})`);
  let v = JSON.parse(raw);
  if (typeof v === "string") v = JSON.parse(v); // CLI 偶尔把结果再编码一层
  return v;
}
const wait = (ms) => ab("wait", String(ms));
const vp = (w, h) => ab("set", "viewport", String(w), String(h));

/* ================= i18n 词典键集差集（静态，先于浏览器） =================
   键=简体原文，t() 缺译时静默回落简体 —— 界面看着「没报错」但英/繁没翻。
   HANT 与 EN 键集必须逐键相等，这是抓静默失败的唯一手段。 */
console.log("\n[i18n 词典键集]");
function dictKeys(file, marker) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const i = src.indexOf(marker);
  if (i < 0) return new Set();
  const j = src.indexOf("{", i);
  const end = src.indexOf("\n};", j);
  const block = src.slice(j, end);
  const re = /^\s*"((?:[^"\\]|\\.)*)"\s*:/gm;
  const out = new Set();
  let m;
  while ((m = re.exec(block))) out.add(m[1]);
  return out;
}
{
  const hant = new Set([
    ...dictKeys("src/core/i18n.ts", "const HANT: Dict"),
    ...dictKeys("src/core/i18n-extra.ts", "HANT_EXTRA: Record")
  ]);
  const en = new Set([
    ...dictKeys("src/core/i18n.ts", "const EN: Dict"),
    ...dictKeys("src/core/i18n-extra.ts", "EN_EXTRA: Record")
  ]);
  const hOnly = [...hant].filter((k) => !en.has(k));
  const eOnly = [...en].filter((k) => !hant.has(k));
  ok("HANT/EN 键集一致（零差集）", hOnly.length === 0 && eOnly.length === 0,
    JSON.stringify({ hantOnly: hOnly, enOnly: eOnly }));
  ok("词典非空（>200 词条）", hant.size > 200 && en.size > 200,
    JSON.stringify({ hant: hant.size, en: en.size }));
}

/* ---------- 页面内的通用取样 ---------- */
const SAMPLE_ICONS = `[...document.querySelectorAll('.top-actions .icon-btn')].map(e=>{
  const r=e.getBoundingClientRect(), s=getComputedStyle(e);
  return {w:Math.round(r.width), h:Math.round(r.height), r:s.borderRadius, cls:e.className};
})`;
const PANEL_RECT = `(()=>{const p=document.querySelector('.settings .panel');
  if(!p) return null; const r=p.getBoundingClientRect();
  return {l:Math.round(r.left), r:Math.round(r.right), t:Math.round(r.top), b:Math.round(r.bottom), w:Math.round(r.width)};})()`;
const OPEN_SETTINGS = `(()=>{const b=document.querySelector('.settings > .icon-btn'); if(!b) return false; b.click(); return true;})()`;
const CLICK_OUTSIDE = `(()=>{document.querySelector('footer')?.click(); return true;})()`;

console.log("v2 顶栏探针 · " + PAGE);
ab("open", PAGE);
/* 上一轮可能把 lang / theme / 折叠态留在 localStorage 里，先清干净再开跑，
   否则断言会拿到上一轮的语言与折叠状态 */
ab("eval", `localStorage.removeItem('glowcast.v2.pref')`);
ab("reload");
wait(1500);

/* ================= 1280px：单行（one）—— 徽标胶囊在四按钮右侧 ================= */
console.log("\n[1280px 宽屏单行]");
vp(1280, 900);
wait(450);
eq("1280px 顶栏收成单行 63px",
  ev(`Math.round(document.querySelector('.topbar').getBoundingClientRect().height)`), 63);
eq("1280px 形态是 mode-one（不收紧、不汉堡）",
  ev(`[...document.querySelector('.topbar').classList]`), ["topbar", "mode-one"]);
eq("导航 7 项文案与顺序", ev(`[...document.querySelectorAll('.nav-tabs a')].map(a=>a.textContent.trim())`), NAV_LABELS);
const PILL = `(()=>{const p=document.querySelector('.top-actions > .meta-pill'); if(!p) return null;
  const r=p.getBoundingClientRect(); const cs=getComputedStyle(p);
  const kids=[...p.parentElement.children].filter(k=>getComputedStyle(k).display!=='none');
  const prev=kids[kids.length-2].getBoundingClientRect();
  const bar=document.querySelector('.topbar').getBoundingClientRect();
  const wrap=document.querySelector('.topbar-in').getBoundingClientRect();
  return {vis:cs.display!=='none', txt:p.innerText.replace(/\\s+/g,' ').trim(),
    w:Math.round(r.width), h:Math.round(r.height), gapLeft:Math.round(r.left-prev.right),
    cy:Math.round(r.top+r.height/2), barCy:Math.round(bar.top+bar.height/2),
    right:Math.round(r.right), wrapRight:Math.round(wrap.right), rad:parseFloat(cs.borderRadius)};})()`;
const pill = ev(PILL);
ok("宽屏徽标是胶囊 .meta-pill 且可见", !!pill && pill.vis === true, JSON.stringify(pill));
ok("胶囊文案 = 城市 · 日期 · 朝/晚霞",
  !!pill && /^.+ · \d{4}-\d{2}-\d{2} · (朝霞|晚霞)$/.test(pill.txt), pill && pill.txt);
ok("胶囊紧跟四按钮右侧（间距 10–18px）", !!pill && pill.gapLeft >= 10 && pill.gapLeft <= 18, JSON.stringify(pill && pill.gapLeft));
ok("胶囊在顶栏里垂直居中", !!pill && Math.abs(pill.cy - pill.barCy) <= 2, JSON.stringify(pill && [pill.cy, pill.barCy]));
ok("胶囊高 26–34px（不撑高单行顶栏）", !!pill && pill.h >= 26 && pill.h <= 34, JSON.stringify(pill && pill.h));
ok("胶囊是圆角胶囊（999）", !!pill && pill.rad >= 100, JSON.stringify(pill && pill.rad));
ok("胶囊不出内容右界", !!pill && pill.right <= pill.wrapRight, JSON.stringify(pill && [pill.right, pill.wrapRight]));
eq("窄屏时代那个第二行徽标已彻底移除（DOM 里没有 .topbar-meta）",
  ev(`document.querySelectorAll('.topbar-meta').length`), 0);

/* 第 7 项是 2026-10-26 新增：点它必须滚到 #ray，且滚动高亮要跟过去。
   先等结果区真正长出来（首屏取数/骨架切换期间点导航可能落空），
   smooth scroll 时长随页长变化，和上面 #calib 一样轮询到进视口再断言。 */
for (let i = 0; i < 16; i++) {
  wait(250);
  if (ev(`!!document.querySelector('#ray') && document.querySelector('#ray').getBoundingClientRect().height > 200`)) break;
}
ev(`document.querySelectorAll('.nav-tabs a')[6].click()`);
let rayNav = null;
for (let i = 0; i < 40; i++) {
  wait(250);
  rayNav = ev(`(()=>{const el=document.querySelector('#ray');const r=el.getBoundingClientRect();
    const on=document.querySelector('.nav-tabs a.on');
    return {top:Math.round(r.top),h:innerHeight,on:on?on.textContent.trim():null};})()`);
  if (rayNav && rayNav.top >= 0 && rayNav.top < rayNav.h && rayNav.on === "光追细节") break;
}
ok("点「光追细节」后 #ray 进入视口", !!rayNav && rayNav.top >= 0 && rayNav.top < rayNav.h, JSON.stringify(rayNav));
eq("滚动高亮落在「光追细节」", rayNav && rayNav.on, "光追细节");

/* ================= 1000px：收紧档（tight）—— 导航还在，字号收一档 ================= */
console.log("\n[1000px 收紧档]");
vp(1000, 900);
wait(500);
eq("1000px 走 mode-tight", ev(`[...document.querySelector('.topbar').classList]`), ["topbar", "mode-tight"]);
eq("1000px 顶栏仍是单行 63px",
  ev(`Math.round(document.querySelector('.topbar').getBoundingClientRect().height)`), 63);
eq("1000px 7 项导航仍是一行且可见",
  ev(`(()=>{const n=document.querySelector('.nav-tabs'); if(getComputedStyle(n).display==='none') return 'hidden';
    const tops=new Set([...n.querySelectorAll('a')].map(a=>Math.round(a.getBoundingClientRect().top)));
    return n.querySelectorAll('a').length + '/' + tops.size;})()`), "7/1");
eq("收紧档导航内边距 6/9", ev(`(()=>{const a=document.querySelector('.nav-tabs a');const cs=getComputedStyle(a);
  return cs.paddingTop+' '+cs.paddingLeft;})()`), "6px 9px");
eq("收紧档藏起 GLOWCAST 副标", ev(`getComputedStyle(document.querySelector('.brand .name em')).display`), "none");
ok("收紧档徽标仍在第一行", ev(`getComputedStyle(document.querySelector('.top-actions > .meta-pill')).display`) !== "none"
  && ev(`document.querySelectorAll('.topbar-meta').length`) === 0);

/* ================= 861px：汉堡档（menu）—— 收紧也放不下，交回抽屉 ================= */
console.log("\n[861px 汉堡档]");
vp(861, 900);
wait(500);
eq("861px 走 mode-menu", ev(`[...document.querySelector('.topbar').classList]`), ["topbar", "mode-menu"]);
eq("861px 顶栏仍是单行 63px（不再折回两行）",
  ev(`Math.round(document.querySelector('.topbar').getBoundingClientRect().height)`), 63);
ok("861px 导航隐藏、汉堡出现",
  ev(`getComputedStyle(document.querySelector('.nav-tabs')).display`) === "none"
  && ev(`getComputedStyle(document.querySelector('.hamburger')).display`) !== "none");
ok("861px 抽屉进入 armed（可见性交给形态判定，不再是 860 media query）",
  ev(`document.querySelector('.mdrawer').classList.contains('armed')`) === true);
ok("861px 徽标仍在第一行（不再有第二行）",
  ev(`getComputedStyle(document.querySelector('.top-actions > .meta-pill')).display`) !== "none"
  && ev(`document.querySelectorAll('.topbar-meta').length`) === 0);

eq("7 个锚点都能落到真实 section",
  ev(`[${NAV_IDS.map((s) => `!!document.querySelector('${s}')`).join(",")}]`),
  NAV_IDS.map(() => true));

const icons861 = ev(SAMPLE_ICONS);
eq("顶栏图标共 4 个（设置+语言+主题+教程）", icons861.length, 4);
eq("图标尺寸统一 34×34", icons861.map((i) => [i.w, i.h]), [[34, 34], [34, 34], [34, 34], [34, 34]]);
eq("图标圆角统一", [...new Set(icons861.map((i) => i.r))].length, 1);
ok("设置按钮走的是 .icon-btn", String(icons861[0].cls).includes("icon-btn"), String(icons861[0].cls));

ok("设置面板能打开", ev(OPEN_SETTINGS) === true);
wait(200);
const p861 = ev(PANEL_RECT);
ok("861px 面板不出右界", !!p861 && p861.r <= 861, JSON.stringify(p861));
ok("861px 面板不出左界", !!p861 && p861.l >= 0, JSON.stringify(p861));

/* 中段：#field 后面还有三节 + 页脚，一定顶得满，用它验 scroll-margin
   （smooth scroll 时长不定，轮询到落位再取样 —— 固定 wait 会读到未滚动的旧坐标）
   scroll-margin 现在由 --topbar-h 派生（单行 63 / 手机两行 80，各 + 26），所以判据从页面读，不写死 112 */
const smTop = Number(ev(`parseFloat(getComputedStyle(document.querySelector('#field')).scrollMarginTop)`));
ok("scroll-margin 跟随顶栏高度（--topbar-h + 26）", smTop >= 60 && smTop <= 120, JSON.stringify(smTop));
ev(`document.querySelectorAll('.nav-tabs a')[2].click()`);
let field = null;
for (let i = 0; i < 30; i++) {
  wait(250);
  field = ev(`(()=>{const el=document.querySelector('#field');const r=el.getBoundingClientRect();
    const on=document.querySelector('.nav-tabs a.on');
    return {top:Math.round(r.top), on:on?on.textContent.trim():null};})()`);
  /* 高亮判定线 = scroll-margin + 12：必须等坐标落进 scroll-margin 且高亮归位再取样，
     否则会在「还在滑」的位置读到上一节的高亮 */
  if (field && Math.abs(field.top - smTop) <= 6 && field.on === "观测场") break;
}
ok("点「观测场」后 #field 停在 scroll-margin 处",
  !!field && Math.abs(field.top - smTop) <= 6, JSON.stringify({ top: field && field.top, smTop }));
eq("滚动高亮落在「观测场」", field.on, "观测场");

/* 末段：页尾那节顶不到判定线，高亮必须靠「到底兜底」跟过去
   （smooth scroll 时长随页长变化，必须轮询到 #calib 进视口且高亮归位再断言
   ——只断「进视口」会在滚动途中取样，高亮还停在上一节） */
ev(`document.querySelectorAll('.nav-tabs a')[5].click()`);
let calib = null;
for (let i = 0; i < 40; i++) {
  wait(250);
  calib = ev(`(()=>{const el=document.querySelector('#calib');const r=el.getBoundingClientRect();
    const on=document.querySelector('.nav-tabs a.on');
    return {top:Math.round(r.top), h:innerHeight, on:on?on.textContent.trim():null};})()`);
  if (calib && calib.top >= 0 && calib.top < calib.h && calib.on === "实况校准") break;
}
ok("点「实况校准」后 #calib 进入视口", calib.top >= 0 && calib.top < calib.h, JSON.stringify(calib));
eq("页尾高亮仍落在「实况校准」", calib.on, "实况校准");

/* ================= 860px：断点交回抽屉 ================= */
console.log("\n[860px 断点]");
vp(860, 900);
wait(300);
ok("860px 导航隐藏", ev(`getComputedStyle(document.querySelector('.nav-tabs')).display`) === "none");
ok("860px 汉堡出现", ev(`getComputedStyle(document.querySelector('.hamburger')).display`) !== "none");

/* ================= 660px：首帧无滚动条 → 有滚动条 的窄带 =================
   回归：refit() 首次跑时页面还没有纵向滚动条，.topbar-in 量到 620px 判「menu 放得下」，
   滚动条随后出现把可用宽压到 610px，品牌名被挤成两行却没有任何事件重判。
   现在由 ResizeObserver 监听顶栏宽度重跑判定 —— 这条断言防的就是那个回归。 */
console.log("\n[660px 首帧竞态带]");
vp(660, 900);
wait(700);
const band660 = ev(`(()=>{const tb=document.querySelector('.topbar');
  const nm=tb.querySelector('.brand .name'), cs=getComputedStyle(nm);
  let lh=parseFloat(cs.lineHeight); if(!isFinite(lh)) lh=parseFloat(cs.fontSize)*1.4;
  return {cls:tb.className.replace('topbar','').trim(), nameH:Math.round(nm.getBoundingClientRect().height),
    lh:Math.round(lh), fit:window.__gcFit};})()`);
eq("660px 落到 mode-mini（menu 放不下就不硬撑）", band660.cls, "mode-mini");
ok("660px 品牌名保持单行（不被挤成两行）",
  band660.nameH <= band660.lh * 1.35, JSON.stringify(band660));
eq("判定链完整走到最后一级", band660.fit, "one!>tight!>menu!>mini");

/* ================= 390px：手机 ================= */
console.log("\n[390px 手机]");
vp(390, 844);
wait(300);
ab("reload");
wait(700);

ok("390px 导航隐藏", ev(`getComputedStyle(document.querySelector('.nav-tabs')).display`) === "none");
ok("390px 汉堡出现", ev(`getComputedStyle(document.querySelector('.hamburger')).display`) !== "none");
eq("390px 走 mode-mini（判定链 one>tight>menu>mini）",
  ev(`[...document.querySelector('.topbar').classList]`), ["topbar", "mode-mini"]);
eq("390px 顶栏是单行 57px（不再折回第二行 80px）",
  ev(`Math.round(document.querySelector('.topbar').getBoundingClientRect().height)`), 57);
ok("390px 顶栏不再有徽标（胶囊隐藏 + 第二行 DOM 已删除）",
  ev(`getComputedStyle(document.querySelector('.top-actions > .meta-pill')).display`) === "none"
  && ev(`document.querySelectorAll('.topbar-meta').length`) === 0);
ok("390px 教程按钮撤出顶栏（入口在抽屉「指南」组）",
  ev(`getComputedStyle(document.querySelector('.tut-btn')).display`) === "none"
  && ev(`!!document.querySelector('.mdrawer .md-group a[href$="tutorial.html"]')`) === true);
ok("390px 品牌名单行（藏 GLOWCAST 副标，不被挤成两行）", ev(`(()=>{
  const nm=document.querySelector('.brand .name'); const cs=getComputedStyle(nm);
  let lh=parseFloat(cs.lineHeight); if(!isFinite(lh)) lh=parseFloat(cs.fontSize)*1.4;
  return nm.getBoundingClientRect().height <= lh*1.35
    && getComputedStyle(nm.querySelector('em')).display === 'none';})()`) === true);
ok("390px 顶栏自身不横向溢出", ev(`(()=>{const i=document.querySelector('.topbar-in');
  return i.scrollWidth - i.clientWidth <= 0 && document.querySelector('.topbar').getBoundingClientRect().right <= 390;})()`) === true);
/* .icon-btn 仍是 4 个 DOM（教程那个 display:none，量到 0×0），只看实际渲染的三个 */
eq("mini 态图标收到 32×32（给 360/375 机型让出余量）",
  ev(SAMPLE_ICONS).filter((i) => i.w > 0).map((i) => [i.w, i.h]),
  [[32, 32], [32, 32], [32, 32]]);

/* 手机顶栏没徽标了，状态改由抽屉顶部一行承担 —— 打开抽屉验它 */
ev(`document.querySelector('.hamburger').click()`);
wait(420);
const mdStatus = ev(`(()=>{const s=document.querySelector('.mdrawer .md-status');
  if(!s) return null; const r=s.getBoundingClientRect();
  return {txt:s.innerText.replace(/\\s+/g,' ').trim(), l:Math.round(r.left), r:Math.round(r.right),
    top:Math.round(r.top), pre:Math.round(document.querySelector('.mdrawer .md-label').getBoundingClientRect().top)};})()`);
ok("抽屉顶部补出状态行（城市 · 日期 · 朝/晚霞）",
  !!mdStatus && /^.+ · \d{4}-\d{2}-\d{2} · (朝霞|晚霞)$/.test(mdStatus.txt), JSON.stringify(mdStatus));
ok("状态行在「目录」标题之上且不出界",
  !!mdStatus && mdStatus.top < mdStatus.pre && mdStatus.l >= 0 && mdStatus.r <= 390,
  JSON.stringify(mdStatus && [mdStatus.top, mdStatus.pre, mdStatus.l, mdStatus.r]));
ev(`document.querySelector('.mdrawer-mask')?.click()`);
wait(320);

ok("手机设置面板能打开", ev(OPEN_SETTINGS) === true);
wait(250);
const p390 = ev(PANEL_RECT);
ok("面板存在", !!p390, JSON.stringify(p390));
ok("面板左不越界", !!p390 && p390.l >= 0, JSON.stringify(p390));
ok("面板右不越界", !!p390 && p390.r <= 390, JSON.stringify(p390));
ok("面板贴边自适应（宽 ≥ 340）", !!p390 && p390.w >= 340, JSON.stringify(p390));
ok("面板纵向不出视口底", !!p390 && p390.b <= 844, JSON.stringify(p390));
ok("面板内容可滚动且未被压扁", ev(`(()=>{const p=document.querySelector('.settings .panel');
  return p.scrollHeight>0 && p.clientHeight>120;})()`) === true);

/* Esc 关闭 */
ab("eval", `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
wait(200);
ok("Esc 能关掉面板", ev(`!document.querySelector('.settings .panel')`) === true);

/* 点外部关闭 */
ev(OPEN_SETTINGS);
wait(200);
ev(CLICK_OUTSIDE);
wait(200);
ok("点面板外能关掉", ev(`!document.querySelector('.settings .panel')`) === true);

/* 抽屉与设置互斥 */
ev(OPEN_SETTINGS);
wait(200);
ev(`document.querySelector('.hamburger').click()`);
wait(300);
ok("开抽屉会收掉设置面板", ev(`!document.querySelector('.settings .panel')`) === true);
ok("抽屉确实开了", ev(`document.querySelector('#mnav').classList.contains('on')`) === true);

/* 反向：开设置会把抽屉收掉 */
ev(OPEN_SETTINGS);
wait(300);
ok("开设置会把抽屉收掉", ev(`!document.querySelector('#mnav').classList.contains('on')`) === true);
ok("此时设置面板在", ev(`!!document.querySelector('.settings .panel')`) === true);

/* 抽屉里 7 个主锚点（含光追算法细节）+ 1 个技术细节入口（附注）都齐全（导航缺席时的替代口径）
   光追算法细节已进桌面导航，抽屉这一份是 ≤860px 的唯一入口，必须还在。 */
ab("eval", `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
wait(150);
ev(`document.querySelector('.hamburger').click()`);
wait(250);
const DRAWER_IDS = [...NAV_IDS, "#notes"];
eq("抽屉内含 7 个主锚点 + 1 个技术细节入口",
  ev(`(()=>{const ids=[${DRAWER_IDS.map((s) => `'${s}'`).join(",")}];
    return ids.filter(id=>!!document.querySelector('#mnav a[href="'+id+'"]')).length;})()`),
  DRAWER_IDS.length);
/* 桌面短标签、抽屉全称：两处文案刻意不同，断住免得日后被「统一」掉 */
eq("抽屉里的光追项保留全称",
  ev(`document.querySelector('#mnav a[href="#ray"]').textContent.trim()`), "光追算法细节");

/* ================= 自绘下拉：替代原生 select / input[type=date] =================
   原生弹层的底色、行高、选中态、深色适配由浏览器自己决定（Chrome / Firefox / Safari 各不同），
   页面能改的只有 select 的 background 与 option 的配色，旧版浏览器还不认。
   所以整套自绘。这里断言：没有原生控件、弹层实色、落在视口内、键盘可用。 */
console.log("\n[自绘下拉]");
vp(1200, 900);
ab("eval", `localStorage.removeItem('glowcast.v2.pref')`);
ab("reload");
wait(1500);

eq("页面里不再有原生 select 与日期输入",
  ev(`[document.querySelectorAll('select').length, document.querySelectorAll('input[type=date]').length]`),
  [0, 0]);
eq("观测场两个下拉都是自绘触发器",
  ev(`document.querySelectorAll('.ctl button.sel').length`), 2);
eq("触发器语义齐全（aria-haspopup=listbox / aria-expanded=false）",
  ev(`[...document.querySelectorAll('.ctl button.sel')]
    .filter(b=>b.getAttribute('aria-haspopup')==='listbox'&&b.getAttribute('aria-expanded')==='false').length`),
  2);

const TRIG_TEXT = `[...document.querySelectorAll('.ctl button.sel')].map(b=>b.querySelector('.sel-txt').textContent.trim())`;
const POP_GEO = `(()=>{const p=document.querySelector('.sel-pop'); if(!p) return null;
  const r=p.getBoundingClientRect(), cs=getComputedStyle(p);
  const t=document.querySelectorAll('.ctl button.sel')[0].getBoundingClientRect();
  return {l:Math.round(r.left),t:Math.round(r.top),r:Math.round(r.right),b:Math.round(r.bottom),
    tb:Math.round(t.bottom),vw:innerWidth,vh:innerHeight,bg:cs.backgroundColor,z:cs.zIndex,
    n:p.querySelectorAll('[role=option]').length,
    sel:p.querySelectorAll('[role=option][aria-selected="true"]').length,
    tick:p.querySelectorAll('.pop-tick').length,
    focused:p.contains(document.activeElement)};})()`;

ev(`document.querySelector('#field').scrollIntoView({block:'center'})`);
wait(500);
ev(`document.querySelectorAll('.ctl button.sel')[0].click()`);
wait(280);
const p1 = ev(POP_GEO);
ok("点触发器弹出列表", !!p1);
eq("日期下拉 10 项，恰好一项选中并带勾", [p1?.n, p1?.sel, p1?.tick], [10, 1, 1]);
ok("弹层贴在触发器下方 6px", Math.abs(p1.t - (p1.tb + 6)) <= 2, `popTop=${p1.t} trigBottom=${p1.tb}`);
ok("弹层四边都留在视口内（各留 12px）",
  p1.l >= 12 && p1.t >= 12 && p1.r <= p1.vw - 12 && p1.b <= p1.vh - 12, JSON.stringify(p1));
ok("弹层是实色底（透明底会透出下层内容）", /^rgb\(\d+, \d+, \d+\)$/.test(p1.bg || ""), p1.bg);
eq("弹层层级高于全屏地图（2100）", p1.z, "2400");
ok("打开后焦点落进列表（键盘能直接走）", p1.focused === true, JSON.stringify(p1));

/* 点某一项 → 值跟着变、弹层关闭 */
const picked = ev(`(()=>{const o=document.querySelectorAll('.sel-pop [role=option]')[5];
  const t=o.querySelector('.pop-name').textContent.trim(); o.click(); return t;})()`);
wait(220);
eq("选中第 6 项后触发器文案跟着变", ev(TRIG_TEXT)[0], picked);
ok("选中即关闭", ev(`!document.querySelector('.sel-pop')`) === true);

/* 键盘：↓ 打开、↓↓ 移动、Enter 选中并交还焦点、Esc 关闭 */
ab("focus", ".ctl button.sel");
ab("press", "ArrowDown");
wait(240);
eq("↓ 键打开列表", ev(`document.querySelectorAll('.sel-pop [role=option]').length`), 10);
ab("press", "ArrowDown");
ab("press", "ArrowDown");
ok("↓↓ 把焦点移到了列表项上",
  ev(`(()=>{const p=document.querySelector('.sel-pop');
    return !!p && p.contains(document.activeElement) && document.activeElement.getAttribute('role')==='option';})()`) === true);
ab("press", "Enter");
wait(240);
ok("Enter 选中并关闭", ev(`!document.querySelector('.sel-pop')`) === true);
ok("焦点交还触发器", ev(`document.activeElement === document.querySelectorAll('.ctl button.sel')[0]`) === true);

ab("press", "ArrowDown");
wait(220);
ab("press", "Escape");
wait(220);
ok("Esc 关闭列表", ev(`!document.querySelector('.sel-pop')`) === true);

/* 深/浅色：弹层是实色且随主题切换（这是当初原生弹层出问题的地方） */
const opaque = (v) => /^rgb\(\d+, \d+, \d+\)$/.test(v || "");
function popLook(theme) {
  vp(1200, 900);
  ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('glowcast.v2.pref')||'{}'),{theme:'${theme}'})))`);
  ab("reload");
  wait(1300);
  ev(`document.querySelectorAll('.ctl button.sel')[0].click()`);
  wait(260);
  const r = ev(`(()=>{const p=document.querySelector('.sel-pop'); if(!p) return null;
    const it=p.querySelector('[role=option]');
    return {bg:getComputedStyle(p).backgroundColor, item:getComputedStyle(it).color};})()`);
  ab("press", "Escape");
  wait(150);
  return r;
}
const darkPop = popLook("dark");
const lightPop = popLook("light");
ok("深色：弹层实色、选项是浅字",
  !!darkPop && opaque(darkPop.bg) && darkPop.item !== "rgb(16, 26, 46)", JSON.stringify(darkPop));
ok("浅色：弹层实色且底色与深色不同",
  !!lightPop && opaque(lightPop.bg) && lightPop.bg !== (darkPop || {}).bg, JSON.stringify(lightPop));

/* ================= 自绘月历（替代 input[type=date]） ================= */
console.log("\n[自绘月历]");
vp(1200, 900);
ab("eval", `localStorage.removeItem('glowcast.v2.pref')`);
ab("reload");
wait(1500);
ev(`window.scrollTo(0,0)`); /* 浏览器可能恢复上次滚动位置，回顶部再验英雄区 */
wait(200);
eq("英雄区日期换成了自绘触发器", ev(`document.querySelectorAll('.hero .dp-trigger').length`), 1);

const CAL_GEO = `(()=>{const p=document.querySelector('.dp-pop'); if(!p) return null;
  const r=p.getBoundingClientRect();
  return {l:Math.round(r.left),t:Math.round(r.top),r:Math.round(r.right),b:Math.round(r.bottom),
    vw:innerWidth,vh:innerHeight,
    days:p.querySelectorAll('.dp-day').length,
    dis:p.querySelectorAll('.dp-day:disabled').length,
    today:p.querySelectorAll('.dp-day.today').length,
    cur:p.querySelectorAll('.dp-day.cur').length,
    week:p.querySelectorAll('.dp-week span').length};})()`;

ev(`document.querySelector('.dp-trigger').click()`);
wait(280);
const cal = ev(CAL_GEO);
ok("点日期触发器弹出月历", !!cal);
eq("固定 6 行 42 格 + 7 个星期表头", [cal?.days, cal?.week], [42, 7]);
ok("今天与当前值各有标记", cal.today === 1 && cal.cur === 1, JSON.stringify(cal));
ok("范围外的日期被禁用（选不到接口取不到的那天）", cal.dis > 0, String(cal.dis));
ok("月历四边也留在视口内",
  cal.l >= 12 && cal.r <= cal.vw - 12 && cal.t >= 12 && cal.b <= cal.vh - 12, JSON.stringify(cal));

/* 选一个可用的其它日期 → 触发器跟着变、弹层关闭 */
const dpPicked = ev(`(()=>{const days=[...document.querySelectorAll('.dp-day:not(:disabled)')];
  const other=days.find(d=>!d.classList.contains('cur'));
  const iso=other.getAttribute('aria-label'); other.click(); return iso;})()`);
wait(240);
eq("点某天后触发器显示该日期", ev(`document.querySelector('.dp-trigger .dp-val').textContent.trim()`), dpPicked);
ok("选完即关闭", ev(`!document.querySelector('.dp-pop')`) === true);

/* 键盘：↓ 打开、→ 移一天、Esc 关闭 */
ab("focus", ".dp-trigger");
ab("press", "ArrowDown");
wait(240);
ok("↓ 打开月历并把焦点放在当前值上",
  ev(`(()=>{const p=document.querySelector('.dp-pop');
    return !!p && p.contains(document.activeElement) &&
      document.activeElement.classList.contains('dp-day');})()`) === true);
const dayBefore = ev(`document.activeElement.getAttribute('aria-label')`);
ab("press", "ArrowRight");
wait(200);
const dayAfter = ev(`document.activeElement.getAttribute('aria-label')`);
ok("→ 把焦点往后移一天", !!dayAfter && dayAfter !== dayBefore, `${dayBefore} → ${dayAfter}`);
ab("press", "Escape");
wait(220);
ok("Esc 关闭月历", ev(`!document.querySelector('.dp-pop')`) === true);

/* 390px：同样贴着触发器，但必须收进视口 */
vp(390, 844);
ab("reload");
wait(1400);
ev(`window.scrollTo(0,0)`);
wait(200);
ev(`document.querySelector('.dp-trigger').click()`);
wait(280);
const mCal = ev(`(()=>{const p=document.querySelector('.dp-pop'); if(!p) return null;
  const r=p.getBoundingClientRect();
  return {l:Math.round(r.left),r:Math.round(r.right),t:Math.round(r.top),b:Math.round(r.bottom),
    vw:innerWidth,vh:innerHeight};})()`);
ok("390px 下月历不出界",
  !!mCal && mCal.l >= 12 && mCal.r <= mCal.vw - 12 && mCal.t >= 12 && mCal.b <= mCal.vh - 12,
  JSON.stringify(mCal));
ok("390px 下日期触发器不折行",
  ev(`(()=>{const v=document.querySelector('.dp-trigger .dp-val');
    const lh=parseFloat(getComputedStyle(v).lineHeight)||16;
    return v.getBoundingClientRect().height < lh*1.5;})()`) === true);
ok("390px 下页面没有横向溢出",
  ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`) === true,
  JSON.stringify(ev(`[document.documentElement.scrollWidth, document.documentElement.clientWidth]`)));
ab("press", "Escape");
wait(150);

/* ================= 折叠接线（语义：folds[key]=true 表示收起） =================
   本轮改的是「默认值来源」：设置页那组「折叠默认」开关已删除，初始状态写在
   state.ts 的 FOLD_DEFAULT 里 —— 两张整卡（光追详情 / 附注）默认展开，
   三处卡内说明块（结论 / 趋势 / 图例）默认收起；之后只按用户手点的结果记忆。
   所以断言分两段：① 清空偏好后拿到的初始态；② 页面上手点是否双向写偏好。 */
console.log("\n[折叠接线]");
vp(1200, 900);
ab("eval", `localStorage.removeItem('glowcast.v2.pref')`);
ab("reload");
wait(1800);

const FOLD_STATE = `(()=>{const p=JSON.parse(localStorage.getItem('glowcast.v2.pref')||'{}');
  return {
    pref:['rayFold','notesFold','heroFold','trendFold','legendFold'].map(k=>k in p?p[k]:null),
    details:[...document.querySelectorAll('.fnote')].map(d=>d.open),
    ray:getComputedStyle(document.querySelector('#ray-body')).display!=='none',
    notes:getComputedStyle(document.querySelector('#notes-body')).display!=='none',
    rayBtn:document.querySelector('#ray .fc-head .btn')?.textContent.trim(),
    notesBtn:document.querySelector('#notes .fc-head .btn')?.textContent.trim()
  };})()`;

const f0 = ev(FOLD_STATE);
eq("五个折叠目标都挂在页面上（3 个说明块 + 2 张卡）",
  [f0.details.length, ev(`!!document.querySelector('#ray-body') && !!document.querySelector('#notes-body')`)],
  [3, true]);
ok("初始态：三处卡内说明块全部收起（结论/趋势/图例）",
  f0.details.every((o) => o === false), JSON.stringify(f0.details));
ok("初始态：光追详情与附注两张整卡展开",
  f0.ray === true && f0.notes === true, JSON.stringify([f0.ray, f0.notes]));
eq("初始态：偏好里还没有折叠键（默认来自代码而非落盘）",
  f0.pref, [null, null, null, null, null]);
eq("整卡胶囊初始文案是「收起」", [f0.rayBtn, f0.notesBtn], ["收起", "收起"]);

/* 设置页不再提供「折叠默认」组 */
ev(`document.querySelector('.settings > .icon-btn').click()`);
wait(250);
const sett = ev(`(()=>{const p=document.querySelector('.settings .panel');
  if(!p) return null;
  return {hasFold: p.innerText.includes('折叠默认') || p.innerText.includes('收起光追'),
          groups:[...p.querySelectorAll('.grp-h')].map(h=>h.innerText.trim()),
          checks:p.querySelectorAll('input[type=checkbox]').length};})()`);
ok("设置页已无「折叠默认」组", sett && sett.hasFold === false, JSON.stringify(sett));
eq("设置页不再有任何勾选框（「关闭校准记录」已删，校准开关只在实况校准卡）",
  sett ? sett.checks : -1, 0);
ok("设置页也没有「显示」分组", sett && !sett.groups.includes("显示"), JSON.stringify(sett && sett.groups));

/* 校准开关的唯一入口挪进实况校准卡后，切换必须写偏好 —— 否则关掉刷新又自动开 */
ev(`document.querySelector('#calib .sw')?.click()`);
wait(300);
const calibPersist = ev(`(()=>{const pref=JSON.parse(localStorage.getItem('glowcast.v2.pref')||'{}');
  const sw=document.querySelector('#calib .sw');
  return {calibOff:pref.calibOff===true, on:sw?sw.classList.contains('on'):null};})()`);
ok("点校准卡的开关会写偏好（calibOff 翻转为 true、开关显示关闭）",
  calibPersist && calibPersist.calibOff === true && calibPersist.on === false, JSON.stringify(calibPersist));
ev(`document.querySelector('#calib .sw')?.click()`);
wait(300);
const calibRestore = ev(`JSON.parse(localStorage.getItem('glowcast.v2.pref')||'{}').calibOff`);
ok("再点一次恢复默认（calibOff 回 false）", calibRestore !== true, String(calibRestore));
ab("press", "Escape");
wait(200);

/* 手点说明块（结论卡的「说明 · 概率与质量分怎么算」）→ 展开并写偏好 false */
ev(`document.querySelectorAll('.fnote')[0].querySelector('summary').click()`);
wait(300);
const f1 = ev(FOLD_STATE);
ok("手点结论卡说明块会展开", f1.details[0] === true, JSON.stringify(f1.details));
eq("展开后 heroFold 落盘为 false", f1.pref[2], false);

/* 刷新后仍是展开（记忆生效，不会被默认值盖回去） */
ab("reload");
wait(1600);
const f2 = ev(FOLD_STATE);
ok("刷新后结论说明块保持展开", f2.details[0] === true && f2.pref[2] === false, JSON.stringify(f2));

/* 整卡胶囊：附注默认展开 → 点一下收起 → 偏好 true */
ev(`document.querySelector('#notes .fc-head .btn').click()`);
wait(300);
const f3 = ev(FOLD_STATE);
ok("点附注卡胶囊后正文隐藏", f3.notes === false, JSON.stringify(f3));
eq("附注卡收起后 notesFold=true", f3.pref[1], true);
eq("胶囊文案变成「展开」", f3.notesBtn, "展开");

/* 刷新后保持 */
ab("reload");
wait(1600);
const f4 = ev(FOLD_STATE);
ok("刷新后附注仍是收起态", f4.notes === false && f4.pref[1] === true, JSON.stringify(f4));

/* 抽屉点「附注」→ 就地展开并写偏好（用户明确去找它 = 意图） */
vp(390, 844);
ab("reload");
wait(1200);
ev(`document.querySelector('.hamburger').click()`);
wait(250);
ev(`document.querySelector('#mnav a[href="#notes"]').click()`);
wait(900);
const f5 = ev(FOLD_STATE);
ok("抽屉点附注会就地展开（已被收起的卡不跳进死胡同）",
  f5.notes === true && f5.pref[1] === false, JSON.stringify(f5));

/* 英文模式：新文案不能漏翻 */
ev(`document.querySelector('.hamburger').click()`);
wait(200);
vp(1200, 900);
wait(200);
ab("eval", `(()=>{const b=[...document.querySelectorAll('.icon-btn')].find(x=>/简|繁|EN/.test(x.textContent)); b.click(); return 1})()`);
wait(250);
ab("eval", `(()=>{const b=[...document.querySelectorAll('.menu-pop button')].find(x=>x.textContent.includes('English')); b.click(); return 1})()`);
wait(1200);
const en = ev(`(()=>{const b=document.querySelector('#ray-body')?document.querySelector('#ray-body').innerText:'';
  return {notes:[...document.querySelectorAll('.fnote summary')].map(s=>s.textContent.trim()),
          cards:['#ray h2','#notes h2'].map(s=>document.querySelector(s)?.textContent.trim()),
          cjk:/[\\u4e00-\\u9fa5]/.test(b)};})()`);
ok("英文下三段说明标题已翻译", en.notes.every((s) => /[A-Za-z]/.test(s) && !/[\u4e00-\u9fa5]/.test(s)), JSON.stringify(en.notes));
ok("英文下两张新卡标题已翻译", en.cards.every((s) => s && /[A-Za-z]/.test(s) && !/[\u4e00-\u9fa5]/.test(s)), JSON.stringify(en.cards));
ok("英文下光追卡正文无残留中文", en.cjk === false, JSON.stringify(en.cjk));

/* ================= 各模型独立结果（2×2 卡） =================
   四张卡：综合 / GFS / ECMWF / 光追（与标题右侧切换器同序）。
   语义按「方案 A」：点任意一张卡＝把上方主数字切到该模型，选中卡 aria-pressed=true。 */
console.log("\n[模型卡]");
vp(1200, 900);
ab("open", PAGE + "?name=%E5%8C%97%E4%BA%AC&lat=39.9042&lon=116.4074&date=2026-10-21&period=pm");
ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'zh',theme:'dark'}))`);
ab("reload");
wait(5200);

const MC = `(()=>{const cs=[...document.querySelectorAll('.mc-grid .mcard')];
  const num=e=>{const x=e&&e.querySelector('.mnum');return x?x.textContent.replace(/\\s+/g,'').trim():null;};
  return {n:cs.length,
    ids:cs.map(c=>c.dataset.mid),
    tags:cs.map(c=>c.tagName),
    on:cs.map(c=>c.classList.contains('on')),
    pressed:cs.map(c=>c.getAttribute('aria-pressed')),
    nums:cs.map(num),
    facts:cs.map(c=>c.querySelectorAll('.facts span').length),
    bigNum:(document.querySelector('.v-grid .metric .num')||{textContent:''}).textContent.trim(),
    subShown:cs.map(c=>{const e=c.querySelector('.sub');return !!e&&getComputedStyle(e).display!=='none';}),
    stack:cs.map(c=>Math.round(c.getBoundingClientRect().left)+':'+Math.round(c.getBoundingClientRect().width))
  };})()`;

const m0 = ev(MC);
eq("四张模型卡都在，顺序＝综合/GFS/ECMWF/光追", m0.ids, ["ens", "gfs", "ec", "rt"]);
ok("非缺数卡片都是按钮语义（可点）", m0.tags.filter((x) => x === "BUTTON").length >= 3, JSON.stringify(m0.tags));
/* ECMWF 这一路可能没取到（mock 或接口缺测）：此时它是占位卡，不该有 aria-pressed */
ok("默认选中综合：只有第一张 aria-pressed=true",
  m0.pressed[0] === "true" && [1, 2, 3].every((i) => m0.pressed[i] !== "true"),
  JSON.stringify(m0.pressed));
ok("ECMWF 缺数时降级为占位卡，不编数字",
  m0.tags[2] === "BUTTON"
    ? !!m0.nums[2]
    : ev(`(()=>{const c=document.querySelector('.mc-grid .mcard[data-mid="ec"]');
        return !!c && c.classList.contains('missing');})()`) === true,
  JSON.stringify([m0.tags[2], m0.nums[2]]));
ok("默认选中态与 class 一致", m0.on[0] === true && m0.on.slice(1).every((x) => x === false), JSON.stringify(m0.on));
ok("每张有数的卡都给了主数字与至少 5 条事实行",
  m0.nums.filter((x) => x).length >= 3 && m0.facts.filter((n) => n >= 5).length >= 3,
  JSON.stringify([m0.nums, m0.facts]));
eq("卡上的综合数字与上方大字一致", m0.nums[0], m0.bigNum);

/* 点 GFS 卡 → 主数字跟着换（这是方案 A 的核心承诺） */
ev(`document.querySelector('.mc-grid .mcard[data-mid="gfs"]').click()`);
wait(300);
const m1 = ev(MC);
eq("点 GFS 卡后选中态转移", m1.on, [false, true, false, false]);
eq("点 GFS 卡后上方大字换成 GFS 的概率", m1.bigNum, m1.nums[1]);

/* 键盘：聚焦 + 回车等价于点击 */
ev(`document.querySelector('.mc-grid .mcard[data-mid="rt"]').focus()`);
ab("press", "Enter");
wait(300);
const m2 = ev(MC);
eq("键盘回车也能切到光追卡", m2.on, [false, false, false, true]);
eq("键盘切换后大字同步", m2.bigNum, m2.nums[3]);

/* 窄屏：单列堆叠，副标题不被隐藏 */
vp(390, 844);
wait(400);
const m3 = ev(MC);
ok("390px 下四张卡纵向单列（同一 left，宽度接近容器）",
  new Set(m3.stack.map((s) => s.split(":")[0])).size === 1 && Number(m3.stack[0].split(":")[1]) > 240,
  JSON.stringify(m3.stack));
ok("390px 下综合卡的权重副标题仍然可见", m3.subShown[0] === true, JSON.stringify(m3.subShown));

/* 英文：卡名与事实行不能留中文 */
vp(1200, 900);
wait(300);
ab("eval", `(()=>{const b=[...document.querySelectorAll('.icon-btn')].find(x=>/简|繁|EN/.test(x.textContent)); b.click(); return 1})()`);
wait(250);
ab("eval", `(()=>{const b=[...document.querySelectorAll('.menu-pop button')].find(x=>x.textContent.includes('English')); b.click(); return 1})()`);
wait(1200);
const m4 = ev(`(()=>{const w=document.querySelector('.mc-wrap'); if(!w) return null;
  return {cjk:/[\\u4e00-\\u9fa5]/.test(w.innerText), txt:w.innerText.replace(/\\s+/g,' ').slice(0,160)};})()`);
ok("英文下模型卡无残留中文", m4 && m4.cjk === false, JSON.stringify(m4));
ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'zh',theme:'dark'}))`);

/* ================= 页面时刻按「所选城市的当地时间」显示 =================
   浏览器在 Asia/Shanghai。若时刻仍按浏览器时区显示，东京会差 1 小时、纽约会差 12 小时。
   这里用三个城市把「日落时刻 + 时区标注」钉死。 */
console.log("\n[城市当地时间]");
const MINUS = "\u2212";
const TZ_CASES = [
  { name: "北京", lat: 39.9042, lon: 116.4074, time: "17:26", hint: null },
  { name: "东京", lat: 35.6762, lon: 139.6503, time: "16:58", hint: "UTC+9" },
  { name: "纽约", lat: 40.7128, lon: -74.006, time: "18:06", hint: "UTC" + MINUS + "4" }
];
let tzSkipped = 0;
for (const c of TZ_CASES) {
  ab("open", PAGE + "?name=" + encodeURIComponent(c.name) +
    "&lat=" + c.lat + "&lon=" + c.lon + "&date=2026-10-21&period=pm");
  ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'zh',theme:'dark'}))`);
  ab("eval", `Object.keys(localStorage).filter(k=>k.startsWith('glowcast.v2.point')||k.startsWith('glowcast.v2.tz')).forEach(k=>localStorage.removeItem(k))`);
  ab("reload");
  /* 固定等待在网络慢时会读到空 DOM（时刻=null、又不是 mock）——
     轮询到「结果就绪」或「mock 兜底」再取样。 */
  for (let i = 0; i < 24; i++) {
    wait(500);
    const ready = ev(`document.querySelectorAll('.sun-row').length > 0 ||
      !![...document.querySelectorAll('.hero-city .pill')].find(e=>e.textContent.trim()==='MOCK')`);
    if (ready) break;
  }
  const r = ev(`(()=>{
    const row = document.querySelectorAll('.sun-row')[0];
    const b = row ? row.querySelector('b') : null;
    const hint = row ? row.querySelector('.tz-hint') : null;
    const txt = b ? b.innerText.trim() : '';
    const marks = [...document.querySelectorAll('.skyaxis .mk')].map(e => e.innerText.replace(/\\s+/g, ' ').trim());
    const mock = !![...document.querySelectorAll('.hero-city .pill')].find(e => e.textContent.trim() === 'MOCK');
    return { time: (txt.match(/\\d{2}:\\d{2}/) || [null])[0], hint: hint ? hint.textContent.trim() : null, marks, mock };
  })()`);
  if (r.mock) {
    /* mock 模式下时区只能靠经度估算（夏令时地区会差 1 小时），这几条不计分 */
    tzSkipped++;
    console.log("  – " + c.name + "：本次是 mock 数据，跳过精确时刻断言");
    continue;
  }
  eq(c.name + " 日落按当地钟显示（" + c.time + "）", r.time, c.time);
  eq(c.name + " 时区标注", r.hint, c.hint);
  ok(c.name + " 天色带首个刻度与结论卡一致", !!r.marks[0] && r.marks[0].includes(c.time), JSON.stringify(r.marks));
}
if (tzSkipped) console.log("  （跳过 " + tzSkipped + " 条：无实时数据时不校验精确时刻）");

/* ================= 保存图片（分享卡） =================
   桌面直接下载、手机走系统分享。这里不验下载通道，只验「图上画了什么」：
   拦 toBlob 拿到画布本身（尺寸 / 像素 / 元信息），拦 <a>.click 拿到文件名。 */
console.log("\n[保存图片]");
const SHARE_SETUP = `(()=>{
  window.__share = null; window.__dl = null;
  const origToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function(cb, type, q){
    const cv = this;
    try{
      const c = cv.getContext('2d');
      const d = c.getImageData(0, 0, cv.width, cv.height).data;
      const step = 4 * 997;
      let sum = 0, n = 0; const set = new Set();
      for (let i = 0; i < d.length; i += step){
        sum += d[i] + d[i+1] + d[i+2]; n++;
        set.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
      }
      const px = (x, y) => { const p = c.getImageData(x, y, 1, 1).data; return [p[0], p[1], p[2]]; };
      window.__share = {
        w: cv.width, h: cv.height,
        meta: JSON.parse(cv.dataset.shareMeta || 'null'),
        corner: px(6, cv.height - 8),
        topLeft: px(2, 2),
        mean: Math.round(sum / Math.max(1, n) / 3),
        colors: set.size
      };
    }catch(e){ window.__share = { err: String((e && e.message) || e) }; }
    return origToBlob.call(cv, cb, type, q);
  };
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function(){
    if (this.download){ window.__dl = { name: this.download, scheme: String(this.href).slice(0, 5) }; return; }
    return origClick.call(this);
  };
  return true;
})()`;
const SHARE_GEO = `(()=>{
  const b = document.querySelector('.share-btn');
  const head = document.querySelector('#verdict .head-right');
  if (!b || !head) return null;
  const kids = [...head.children];
  const r = b.getBoundingClientRect();
  return {
    inHead: head.contains(b),
    beforeSeg: kids.indexOf(b) < kids.findIndex(k => k.classList.contains('seg')),
    w: Math.round(r.width), h: Math.round(r.height),
    disabled: b.disabled,
    label: b.getAttribute('aria-label') || '',
    title: b.getAttribute('title') || ''
  };
})()`;

ab("open", PAGE + "?name=%E5%8C%97%E4%BA%AC&lat=39.9042&lon=116.4074&date=2026-10-21&period=pm");
ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'zh',theme:'dark'}))`);
ab("eval", `Object.keys(localStorage).filter(k=>k.startsWith('glowcast.v2.point')||k.startsWith('glowcast.v2.tz')).forEach(k=>localStorage.removeItem(k))`);
ab("reload");
wait(4500);
vp(1200, 900);
wait(400);
ev(`document.querySelector('#verdict').scrollIntoView({block:'center'})`);
wait(400);

const sg = ev(SHARE_GEO);
ok("结论小节里有「保存图片」按钮", !!sg, JSON.stringify(sg));
ok("按钮在标题右侧、排在模型切换器之前", !!sg && sg.inHead && sg.beforeSeg, JSON.stringify(sg));
ok("有结果时按钮可用", !!sg && sg.disabled === false, JSON.stringify(sg));
ok("按钮有可读的 aria-label", !!sg && sg.label.length > 0 && sg.label === sg.title, JSON.stringify(sg));

ev(SHARE_SETUP);
/* canvas 是异步绘制的：固定 wait 偶发读到上一张或 null（实测两轮一次）。
   一律「清空标记 → 点 → 轮询到新结果」，不靠睡固定时长。 */
function shootShare() {
  ev(`window.__share = null`);
  ev(`document.querySelector('.share-btn').click()`);
  for (let i = 0; i < 40; i++) {
    wait(250);
    const s = ev(`window.__share`);
    if (s) return s;
  }
  return null;
}
const sh1 = shootShare();
const dl1 = ev(`window.__dl`);
ok("点一下真的画出了画布", !!sh1 && !sh1.err, JSON.stringify(sh1 && sh1.err));
eq("画布 2 倍像素密度（1560×800）", [sh1?.w, sh1?.h], [1560, 800]);
ok("画面不是空白（取样出足够多颜色）", !!sh1 && sh1.colors > 30, String(sh1 && sh1.colors));
ok("元信息挂在画布上（模型/来源/细节行）",
  !!sh1?.meta && sh1.meta.rows.length === 4, JSON.stringify(sh1?.meta && sh1.meta.rows));
ok("文件名＝霞光预报_城市_日期_晚霞.png",
  /^霞光预报_北京_2026-10-21_晚霞\.png$/.test((dl1 && dl1.name) || ""), JSON.stringify(dl1));
ok("<a download> 走的是 blob URL", (dl1 && dl1.scheme) === "blob:", JSON.stringify(dl1));
ok("深色主题导出深色底（角落接近 #101a2e）",
  !!sh1 && sh1.corner[0] < 60 && sh1.corner[2] > sh1.corner[0], JSON.stringify(sh1 && sh1.corner));
eq("综合模式：single=false 且标 ens", [sh1?.meta?.single, sh1?.meta?.model], [false, "ens"]);
eq("数据来源跟着结果走（mock 才打水印）",
  [sh1?.meta?.src, sh1?.meta?.watermark],
  [sh1?.meta?.src, sh1?.meta?.src === "mock"]);

/* 切到 GFS → 图上的主数字必须跟着切换器，并标出模型名 */
ev(`[...document.querySelectorAll('#verdict .seg button')].find(b=>b.textContent.trim()==='GFS').click()`);
wait(300);
const sh2 = shootShare();
eq("单模型：图上标出 GFS 且 single=true",
  [sh2?.meta?.single, sh2?.meta?.model], [true, "GFS 统计"]);

/* 浅色主题 → 同一张卡换成纸面浅底 */
ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'zh',theme:'light'}))`);
ab("reload");
wait(4200);
vp(1200, 900);
wait(300);
ev(SHARE_SETUP);
ev(`document.querySelector('#verdict').scrollIntoView({block:'center'})`);
wait(300);
const sh3 = shootShare();
ok("浅色主题导出浅底（角落接近白）", !!sh3 && sh3.corner[0] > 200, JSON.stringify(sh3 && sh3.corner));
ok("深/浅两版底色确实不同", !!sh1 && !!sh3 && sh1.meta.bg !== sh3.meta.bg,
  JSON.stringify([sh1?.meta?.bg, sh3?.meta?.bg]));

/* 390px：按钮收成 34×34 图标，文案进 aria-label，页面不横向溢出 */
vp(390, 844);
ab("reload");
wait(4200);
ev(`document.querySelector('#verdict').scrollIntoView({block:'center'})`);
wait(400);
const sg390 = ev(SHARE_GEO);
eq("390px 下按钮收成 34×34 图标", [sg390?.w, sg390?.h], [34, 34]);
ok("390px 下文案仍在 aria-label 里", !!sg390 && /保存图片/.test(sg390.label), JSON.stringify(sg390));
ok("390px 下页面没有横向溢出",
  ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`) === true,
  JSON.stringify(ev(`[document.documentElement.scrollWidth, document.documentElement.clientWidth]`)));

/* 英文模式：按钮与文件名都要翻译 */
ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'en',theme:'light'}))`);
vp(1200, 900);
ab("reload");
wait(4200);
ev(`document.querySelector('#verdict').scrollIntoView({block:'center'})`);
wait(300);
const sgEn = ev(SHARE_GEO);
ok("英文下按钮文案是 Save image", !!sgEn && /^Save image$/.test(sgEn.label), JSON.stringify(sgEn));
ev(SHARE_SETUP);
ev(`document.querySelector('.share-btn').click()`);
wait(1800);
const dlEn = ev(`window.__dl`);
ok("英文下文件名也翻译（Glow Forecast_…）",
  /^Glow Forecast_北京_2026-10-21_.+\.png$/.test((dlEn && dlEn.name) || ""), JSON.stringify(dlEn));

/* ================= 缓存优先 / 显式取数（2026-10-21 额度审计后） =================
   断言「点了不取数」必须数真实请求数 —— 看界面文案是看不出来的。
   用假成功 fetch 桩：只回合法 JSON、绝不碰网络，因此跑探针不烧额度。 */
console.log("\n[缓存优先与显式取数]");
const FETCH_STUB = `(()=>{window.__calls=[];
  const fake=(u)=>{u=String(u); window.__calls.push(u);
    const q=new URL(u, location.href).searchParams;
    const nLoc=(q.get('latitude')||'').split(',').filter(Boolean).length||1;
    const vars=(q.get('hourly')||'').split(',').filter(Boolean);
    const sd=q.get('start_date'), ed=q.get('end_date'), fd=+q.get('forecast_days')||7;
    let t0,nH;
    if(sd){t0=Date.parse(sd+'T00:00:00Z');const t1=ed?Date.parse(ed+'T00:00:00Z'):t0;
      nH=Math.round((t1-t0)/3600000)+24;}
    else{t0=Date.now()-3*86400000;nH=24*(fd+3);}
    const time=[];
    for(let i=0;i<nH;i++) time.push(new Date(t0+i*3600000).toISOString().slice(0,16));
    const DEF={temperature_2m:15,dew_point_2m:8,relative_humidity_2m:60,
      cloud_cover_low:20,cloud_cover_mid:45,cloud_cover_high:30,visibility:20000,
      pressure_msl:1013,boundary_layer_height:800,freezing_level_height:2000,
      aerosol_optical_depth:0.2};
    const hourly={time};
    for(const v of vars) hourly[v]=time.map(()=>(v in DEF?DEF[v]:null));
    const one={hourly,utc_offset_seconds:28800,timezone:'Asia/Shanghai'};
    const body=nLoc>1?Array.from({length:nLoc},()=>one):one;
    return Promise.resolve({ok:true,status:200,headers:{get:()=>null},
      json:()=>Promise.resolve(body),text:()=>Promise.resolve('')});
  };
  window.fetch=(u)=>fake(u); return 1})()`;
const takeCalls = () => ev(`(()=>{const c=window.__calls.slice(); window.__calls=[]; return c;})()`);
const FRESH_INFO = (sec) => `(()=>{const s=document.querySelector('${sec} .fresh');
  return s?{txt:s.innerText,refetch:!!s.querySelector('.linkbtn')}:null;})()`;

/* URL 钉死城市/日期/时段，避免跨时区跑出不同的「今天」；
   语言强制回简体 —— 上一段留了英文 pref，会让中文断言全部失效 */
ab("open", PAGE + "?name=%E5%8C%97%E4%BA%AC&lat=39.9042&lon=116.4074&date=2026-10-21&period=pm");
ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'zh',theme:'light'}))`);
ab("eval", `Object.keys(localStorage).filter(k=>k.startsWith('glowcast.v2.')&&k!=='glowcast.v2.pref').forEach(k=>localStorage.removeItem(k))`);
ab("eval", FETCH_STUB);
ab("reload");
wait(1200);
ab("eval", FETCH_STUB); /* reload 会把桩冲掉，必须重装 */
wait(4500);
/* 挂载期的 run() 跑在桩装好之前（reload 后有空窗）：真请求失败会落 src=mock，
   结论卡就不标来源了。统一用桩重算一次把状态钉成「桩数据」，再丢掉这批调用。 */
ev(`document.querySelector('.hero .btn-primary')?.click()`);
wait(4500);
takeCalls(); /* 丢掉挂载期与重算的调用，下面只数被测动作 */

/* --- 地图 --- */
ev(`document.querySelector('#field .btn-primary').click()`);
wait(5000);
const mq1 = takeCalls();
ok("点「加载地图」会取数", mq1.length > 0, JSON.stringify(mq1.length));
const mfq1 = ev(FRESH_INFO("#field"));
ok("新取数据标「刚刚取数」且不给重取入口",
  !!mfq1 && /刚刚取数/.test(mfq1.txt) && mfq1.refetch === false, JSON.stringify(mfq1));

ev(`document.querySelector('#field .btn-primary').click()`);
wait(3000);
eq("缓存命中时再点「加载地图」一个请求都不发", takeCalls().length, 0);
const mfq2 = ev(FRESH_INFO("#field"));
ok("命中后小字变「缓存 · …」并给出「重新取数」",
  !!mfq2 && /缓存/.test(mfq2.txt) && mfq2.refetch === true, JSON.stringify(mfq2));

ev(`[...document.querySelectorAll('#field .linkbtn')].find(b=>/重新取数/.test(b.textContent)).click()`);
wait(5000);
const mq3 = takeCalls();
ok("点「重新取数」才会真的取数", mq3.length > 0, JSON.stringify(mq3.length));

/* --- 场重建（2026-10-22 重做）：Shepard 过点，但不许长出「单点主场盘」 ---
   旧做法：IDW 正则化尺度 30km = 格距的 1/4 → 每个采样点周围长出一个半径
   30–60km 的小圆盘（屏幕直径 50–100px），7 档量化再把盘边切成硬边圆环。
   用户看到的「一堆规整的圆」就是它 —— 实测把 57 个采样点叠回地图，圆心
   逐个落在采样点上。
   新做法：自适应核 Shepard（R = 第 9 近邻距离 × 1.06），权重 w=((R−d)/(R·d))²。
   两个方向都要断，缺一不可：
     · 过点：采样点上的插值必须等于真值（否则「真实准确」名不副实）
     · 无平台：离开采样点后必须一路单调回落（否则就是牛眼/主场盘换了个名字）
   线上数据全是同一套桩值，断不出这两条，所以用合成数据。 */
console.log("\n[场重建 · 过点且无平台]");
const PEAK = ev(`(()=>{const a=[];
  for(let k=0;k<8;k++){const r=k*Math.PI/4;
    a.push({lat:24+Math.cos(r)*1.085,lon:118+Math.sin(r)*1.085/Math.cos(24*Math.PI/180),v:10});}
  a.push({lat:24,lon:118,v:85});
  const K=111.32*Math.cos(24*Math.PI/180);
  const at=(km)=>{const t=window.__gcFieldProbe(a,24,118+km/K);
    return t==null?null:Math.round(t*10)/10;};
  return {center:at(0), out10:at(10), out30:at(30), out60:at(60), out90:at(90)};})()`);
ok("孤峰在采样点上取真值（Shepard 过点，85 分不被打折）",
  !!PEAK && PEAK.center >= 80, JSON.stringify(PEAK));
ok("离开孤峰一路单调回落（0>10>30>60>90km，没有平台段）",
  !!PEAK && PEAK.center > PEAK.out10 && PEAK.out10 > PEAK.out30 &&
    PEAK.out30 > PEAK.out60 && PEAK.out60 > PEAK.out90,
  JSON.stringify(PEAK));
ok("60km 处已不足峰值一半（是缓坡不是平台盘）",
  !!PEAK && PEAK.out60 < PEAK.center * 0.55, JSON.stringify(PEAK));
ok("90km 外基本回到背景水平（周围 10 分 ⇒ 不画成圆盘、不画成牛眼）",
  !!PEAK && PEAK.out90 < 20, JSON.stringify(PEAK));
/* 过冲是最典型的插值伪影：单调场里不该冒出比两端更极端的值 */
const OVER = ev(`(()=>{const a=[];const K=111.32*Math.cos(24*Math.PI/180);
  for(let k=0;k<=5;k++) a.push({lat:24,lon:118+k*20/K,v:10+k*15});
  const s=[];for(let k=0;k<=10;k++){
    const t=window.__gcFieldProbe(a,24,118+k*10/K); s.push(t==null?null:Math.round(t*10)/10);}
  return s;})()`);
ok("单调梯度场（10→85 分 / 20km 格距）上插值不过冲且单调不减",
  Array.isArray(OVER) && OVER.every((v) => v != null && v >= 9.9 && v <= 85.1) &&
    OVER.every((v, i) => i === 0 || v >= OVER[i - 1] - 0.05),
  JSON.stringify(OVER));
const SPKR = ev(`(()=>{const g=window.__gcPts&&window.__gcPts();return g?g.spikes.map(s=>s.rKm):null})()`);
ok("残差异常点半径在 40–70km（相邻的会连成带，不排成一串珠子）",
  Array.isArray(SPKR) && SPKR.every((r) => r >= 40 && r <= 70), JSON.stringify(SPKR));

/* --- 采样密度与精度（2026-10-22 重做：80km / 121 点 + 留一法 CV） ---
   精度不能自证：必须跟「最近邻直接取值」这个最笨的基线比，插值才有意义。
   注意桩数据也不是常值场 —— 气象要素虽全同，太阳高度角随经纬度变，
   物理核本来就会给出空间差异，所以这里能断出真东西。 */
console.log("\n[采样密度与插值精度]");
const CV1 = ev(`window.__gcCV ? window.__gcCV() : null`);
ok("网格已加密到 80km / 121 点", !!CV1 && CV1.n === 121, JSON.stringify(CV1 && CV1.n));
ok("留一法 RMSE 明显优于最近邻基线（< 0.75×nnRmse 才算插值带来信息）",
  !!CV1 && CV1.cv && CV1.cv.nnRmse > 0 && CV1.cv.rmse < CV1.cv.nnRmse * 0.75,
  JSON.stringify(CV1 && CV1.cv));
ok("留一法 MAE 也优于基线（不被个别大残差带偏）",
  !!CV1 && CV1.cv && CV1.cv.mae < CV1.cv.nnRmse * 0.5, JSON.stringify(CV1 && CV1.cv));
/* 栅格规模是**确定性**判据，墙钟时间只是量级护栏 —— 同一份代码在负载不同的
   机器上 builtMs 能差 4 倍（实测 415ms / 1561ms），拿它当阈值断死活是自找 flaky。
   真正要守的是「分辨率别偷偷翻倍」和「拖动别重建」。 */
ok("栅格规模在有界范围内（0.05° 步长，实测约 220×160）",
  !!CV1 && CV1.cells > 5000 && CV1.cells <= 160000, JSON.stringify(CV1 && { cols: CV1.cols, rows: CV1.rows, cells: CV1.cells }));
ok("栅格构建耗时在数量级内（< 3000ms，仅防 O(n²) 爆炸）",
  !!CV1 && typeof CV1.builtMs === "number" && CV1.builtMs < 3000, JSON.stringify(CV1 && CV1.builtMs));
ok("可见区可信度均值 > 0.5（按透明度加权 —— 只算你看得见的那片，不含淡出的外推区）",
  !!CV1 && CV1.conf && CV1.conf.mean > 0.5, JSON.stringify(CV1 && CV1.conf));
/* 栅格缓存：拖动/悬停只重贴图，不许重建 —— buildCount 翻了就是退回每帧重算 */
const BC0 = ev(`window.__gcCV ? window.__gcCV().buildCount : -1`);
ev(`(()=>{const b=document.querySelector('.map-box'); if(!b) return 0;
  const r=b.getBoundingClientRect();
  for(let k=1;k<=4;k++) b.dispatchEvent(new MouseEvent('mousemove',
    {clientX:r.left+r.width*0.3+k*8, clientY:r.top+r.height*0.4, bubbles:true}));
  return 1;})()`);
wait(600);
const BC1 = ev(`window.__gcCV ? window.__gcCV().buildCount : -1`);
eq("悬停重绘不重建栅格（buildCount 不动）", BC1, BC0);

/* --- 色阶编码（2026-10-22 二次返工：SunsetBot 全光谱 + 低值有色） ---
   上一版「低值完全不着色」实测出来是一块孤零零的红斑，所以口径改了：
   低值很淡但**不是 0**，靠淡蓝把整片填满；远处靠距离 fade 收掉。 */
console.log("\n[色阶编码]");
const R_LO = ev(`window.__gcRamp ? window.__gcRamp(8) : null`);
ok("低值区很淡但不是空白（8 分 alpha 在 0.05–0.2）",
  !!R_LO && R_LO.alpha >= 0.05 && R_LO.alpha <= 0.2, JSON.stringify(R_LO));
ok("低值区偏冷色（蓝紫/浅蓝，不是暖色）",
  !!R_LO && R_LO.rgb[2] > R_LO.rgb[0] + 20 && R_LO.rgb[2] > R_LO.rgb[1],
  JSON.stringify(R_LO && R_LO.rgb));
const R_MID = ev(`window.__gcRamp ? window.__gcRamp(50) : null`);
ok("中值区是绿/黄（色相换了段，不再一路暖色）",
  !!R_MID && R_MID.rgb[1] > R_MID.rgb[2] + 30, JSON.stringify(R_MID && R_MID.rgb));
const R_HI = ev(`window.__gcRamp ? window.__gcRamp(96) : null`);
ok("高值区接近满墨（96 分 alpha ≥ 0.8）", !!R_HI && R_HI.alpha >= 0.8, JSON.stringify(R_HI));
const MONO = ev(`(()=>{const r=window.__gcRamp; if(!r) return null;
  const s=[0,10,25,40,55,70,85,100].map(v=>r(v).alpha);
  return {s, up:s.every((a,i)=>i===0||a>=s[i-1])};})()`);
ok("透明度随分数单调不减（不会出现「越高越淡」）", !!MONO && MONO.up, JSON.stringify(MONO));
/* 连续性的证据在颜色上：7 档量化会让相邻 1 分的色差达到整档跨度，
   连续插值时每步最多走十几个 sRGB 单位（橙→红那段跨度最大）。 */
const CONT = ev(`(()=>{const r=window.__gcRamp; if(!r) return null;
  let mx=0, at=0;
  for(let v=0;v<100;v++){const a=r(v).rgb, b=r(v+1).rgb;
    const d=Math.max(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]),Math.abs(a[2]-b[2]));
    if(d>mx){mx=d;at=v;}}
  return {maxStep:mx, at};})()`);
ok("色阶连续（相邻 1 分色差 ≤ 14 个 sRGB 单位，无 7 档硬边）",
  !!CONT && CONT.maxStep <= 14, JSON.stringify(CONT));
ok("四档语义 + 三条等值线", !!R_HI && R_HI.bands === 4 && R_HI.contourLevels.length === 3,
  JSON.stringify(R_HI && { bands: R_HI.bands, lv: R_HI.contourLevels }));
/* 铺满：栅格地理跨度必须远大于采样范围（800km ≈ 7.2°），否则又会看到一条边界 */
ok("色面栅格铺到视口外（经向跨度 > 12°）",
  !!CV1 && !!CV1.spanDeg && CV1.spanDeg.lon > 12 && CV1.spanDeg.lat > 10,
  JSON.stringify(CV1 && CV1.spanDeg));

/* --- 采样点层（本次修掉的老坑：开关在、paint() 里压根没画） ---
   色面是插值出来的，用户判断「这片有没有根据」只能看采样落点在哪。
   断言走画布像素指纹 —— 只看 checkbox 状态是断不出「画没画」的。 */
console.log("\n[采样点层]");
/* 必须选 .overlay —— .map-box 里第一个 canvas 是腾讯 SDK 的 WebGL 底图，
   getContext('2d') 对它返回 null，拿错了会直接抛异常。 */
const CSIG = `(()=>{const c=document.querySelector('.map-box canvas.overlay');
  if(!c||!c.getContext) return null;
  const cx=c.getContext('2d'); if(!cx) return null;
  const d=cx.getImageData(0,0,c.width,c.height).data;
  let s=0; for(let i=0;i<d.length;i+=8) s=(s*33+d[i]+d[i+1])>>>0; return s;})()`;
const PTS_TOGGLE = (on) => ev(`(()=>{const ls=[...document.querySelectorAll('#field label')];
  const l=ls.find((x)=>/采样点/.test(x.textContent)); if(!l) return null;
  const i=l.querySelector('input[type=checkbox]'); if(!i) return null;
  if(i.checked !== ${on}) i.click(); return i.checked;})()`);
ok("采样点开关在「观测场」图层区", ev(`(()=>{const ls=[...document.querySelectorAll('#field label')];
  return ls.some((x)=>/采样点/.test(x.textContent)&&x.querySelector('input[type=checkbox]'));})()`) === true);
const ptsWasOn = ev(`(()=>{const ls=[...document.querySelectorAll('#field label')];
  const l=ls.find((x)=>/采样点/.test(x.textContent)); const i=l&&l.querySelector('input');
  return i?i.checked:null;})()`);
if (ptsWasOn) ev(`(()=>{const ls=[...document.querySelectorAll('#field label')];
  const l=ls.find((x)=>/采样点/.test(x.textContent)); l.querySelector('input').click(); return 1;})()`);
wait(400);
const sigBase = ev(CSIG);
eq("采样点默认关闭（默认视图只呈现色面本身）", ptsWasOn, false);
eq("勾上采样点返回 true", PTS_TOGGLE(true), true);
wait(500);
const sigPts = ev(CSIG);
ok("勾上采样点后画面真的变了（不再是死开关）",
  typeof sigBase === "number" && typeof sigPts === "number" && sigPts !== sigBase,
  JSON.stringify({ off: sigBase, on: sigPts }));
PTS_TOGGLE(false); /* 复位，免得影响后面截图的断言 */
wait(300);

/* --- 方位图层（2026-10-21 V1 M1 同口径）：射线 + 距离环 + 线端标签 --- */
const azi = ev(`window.__gcAzi ? window.__gcAzi() : null`);
ok("方位图层调试钩子在线且已算出方位角", !!azi && typeof azi.az === 'number' && isFinite(azi.az),
  JSON.stringify(azi));
ok("线端标签是「晚霞方位/朝霞方位 + 8 方位词 + 角度」",
  !!azi && /^(晚霞方位|朝霞方位) (北|东北|东|东南|南|西南|西|西北) \d+°$/.test(azi.head || ""),
  JSON.stringify(azi && azi.head));
ok("射线几何落点齐全（中心与 400km 线端）",
  !!azi && azi.geo && ['cx','cy','tx','ty'].every(k => typeof azi.geo[k] === 'number' && isFinite(azi.geo[k])),
  JSON.stringify(azi && azi.geo));
if (azi && azi.geo) {
  /* 北朝上投影里方位角应与屏幕向量同向（正北=上）。400km 折算到屏幕的
     经纬度曲率很小，20° 容差只防「射线画反」这种整类错。 */
  const rad = azi.az * Math.PI / 180;
  const ex = Math.sin(rad), ey = -Math.cos(rad);
  const vx = azi.geo.tx - azi.geo.cx, vy = azi.geo.ty - azi.geo.cy;
  const len = Math.hypot(vx, vy);
  const cosA = len > 0 ? (vx * ex + vy * ey) / len : 0;
  ok("射线指向与方位角一致（北朝上）", cosA > Math.cos(20 * Math.PI / 180),
    JSON.stringify({ az: azi.az, v: [Math.round(vx), Math.round(vy)] }));
} else {
  ok("射线指向与方位角一致（北朝上）", false, "无几何落点");
}

/* --- 地图选点与定格卡（2026-10-22 重做交互）： ---
   悬停只读小卡（48px 命中、无按钮、pointer-events:none）；
   点击 60px 内吸附选点 → 定格卡钉在点旁、「加入对比」按钮稳定可点；
   点空白取消。旧版 hover/点击都是 26px 且按钮被 .tip 的
   pointer-events:none 吃掉 —— 按钮从上线起就没被点中过。 */
console.log("\n[地图选点与定格卡]");
/* 画布中心 = gridCenter 投影，121 格点（80km）必有 1 个正落中心（0 环） */
const MB = ev(`(()=>{const b=document.querySelector('.map-box');
  if(!b) return null; const r=b.getBoundingClientRect();
  return {cx:r.left+r.width/2, cy:r.top+r.height/2, l:r.left, t:r.top};})()`);
const fire = (type, x, y) => ev(`(()=>{const b=document.querySelector('.map-box');
  if(!b) return 0;
  b.dispatchEvent(new MouseEvent('${type}',{clientX:${x},clientY:${y},bubbles:true}));
  return 1;})()`);
if (MB) {
  fire("mousemove", MB.cx, MB.cy);
  wait(240);
  const hov = ev(`(()=>{const t=document.querySelector('.tip');
    return t?{on:!!t,btn:!!t.querySelector('.tip-add'),name:!!t.querySelector('b')}:null;})()`);
  ok("悬停格点弹出只读小卡（48px 命中，旧 26px 在点间死区弹不出）",
    !!hov && hov.on && hov.name, JSON.stringify(hov));
  ok("悬停小卡没有「加入对比」按钮（按钮只在定格卡上）",
    !!hov && hov.btn === false, JSON.stringify(hov));
  const nBefore = ev(`document.querySelectorAll('#compare .rcard').length`);
  fire("click", MB.cx, MB.cy);
  wait(300);
  const pin1 = ev(`(()=>{const c=document.querySelector('.pincard');
    return c?{btn:!!c.querySelector('.tip-add'),msg:(c.querySelector('.tip-cmpmsg')||{}).innerText||null}:null;})()`);
  ok("点击格点出现定格卡（钉在点旁、不跟随鼠标）", !!pin1 && pin1.btn, JSON.stringify(pin1));
  /* 主场特权守卫：本市格点吸附圈放宽到近整环距 —— 远景环距仅 ~54px，
     点「广州市」偏 30px 曾几何上更靠近邻市格点、弹出「惠州市/澳门附近」
     （用户报「点击广州市不显示广州市」的根因）。 */
  fire("click", MB.cx + 30, MB.cy);
  wait(300);
  const pinHome = ev(`(()=>{const c=document.querySelector('.pincard');
    return c?c.innerText.split('\\n')[0]:null;})()`);
  ok("点本市格点偏 30px 仍吸本市（主场特权，不弹邻市）",
    pinHome === "北京市", JSON.stringify(pinHome));
  /* elementFromPoint 命中测试：腾讯 SDK 交互容器自带 z-index:1000，曾把定格卡
     整个盖住 —— 真实点击全被 SDK 吃掉，而 el.click() 直发绕过命中测试探针
     全绿漏网。map-host 已封 z-index:0，这条守住「按钮真的在最上层」。 */
  ok("「加入对比」按钮未被任何层遮挡（elementFromPoint 命中按钮本身）",
    ev(`(()=>{const b=document.querySelector('.pincard .tip-add');
      if(!b) return false;
      /* 按钮多半在视口外：elementFromPoint 对屏外坐标恒 null，先滚进视口再测 */
      const host=document.querySelector('.canvas-host');
      window.scrollTo({top:host.getBoundingClientRect().top+window.scrollY-100,behavior:'instant'});
      const r=b.getBoundingClientRect();
      const t=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
      return t===b || b.contains(t);})()`) === true);
  ok("定格后移动鼠标不再弹悬停小卡（防两卡同屏）",
    (fire("mousemove", MB.cx, MB.cy), wait(200),
     ev(`document.querySelector('.tip') === null`)) === true);
  /* 真实语义点击：elementFromPoint 找顶层元素，完整 mousedown→mouseup→click
     派到顶层（不用 el.click() 直发 —— 那会绕过命中测试，SDK 遮挡就漏网） */
  ev(`(()=>{const b=document.querySelector('.pincard .tip-add');
    const r=b.getBoundingClientRect();
    const cx=r.left+r.width/2, cy=r.top+r.height/2;
    const top=document.elementFromPoint(cx,cy)||b;
    const opts={clientX:cx,clientY:cy,bubbles:true,cancelable:true,view:window};
    top.dispatchEvent(new MouseEvent('mousedown',opts));
    top.dispatchEvent(new MouseEvent('mouseup',opts));
    top.dispatchEvent(new MouseEvent('click',opts)); return 1})()`);
  wait(300);
  const pin2 = ev(`(()=>{const c=document.querySelector('.pincard');
    return {msg:(c&&c.querySelector('.tip-cmpmsg')||{}).innerText||null};})()`);
  ok("点「加入对比」真的入列（旧版按钮被 pointer-events:none 吃掉永远点不了）",
    /已加入对比|该点已在对比中/.test(pin2.msg || ""), JSON.stringify(pin2));
  const nAfter = ev(`document.querySelectorAll('#compare .rcard').length`);
  ok("对比卡数 +1（地图选点 0 额度路径通到面板）", nAfter === nBefore + 1,
    JSON.stringify({ nBefore, nAfter }));
  fire("click", MB.l + 5, MB.t + 5); /* 画布角落：60px 内无格点 */
  wait(240);
  ok("点空白处取消选择（定格卡收起）",
    ev(`document.querySelector('.pincard') === null`) === true,
    JSON.stringify(ev(`!!document.querySelector('.pincard')`)));
} else {
  ok("地图选点与定格卡", false, "找不到 .map-box（页面状态异常）");
}

/* --- 换日期：不许自动取数，未命中就清空并提示 --- */
ev(`(()=>{document.querySelector('#field .ctl .sel').click(); return 1})()`);
wait(600);
const beforeDate = ev(`document.querySelector('#field .ctl .sel').innerText`);
ev(`(()=>{const it=[...document.querySelectorAll('.pop-item')]; const i=it.findIndex(x=>x.className.includes('on'));
  (it[i+1]||it[i-1]||it[0]).click(); return 1})()`);
wait(3000);
const afterDate = ev(`document.querySelector('#field .ctl .sel').innerText`);
ok("日期确实换掉了（否则后面的断言没有意义）", beforeDate !== afterDate,
  JSON.stringify([beforeDate, afterDate]));
eq("换日期不再自动取数", takeCalls().length, 0);
const stTxt = ev(`document.querySelector('#field .status')?.innerText || ''`);
ok("未命中缓存时清空图面并提示「该日期尚未取数」",
  /该日期尚未取数/.test(stTxt), stTxt);
eq("图面确实被清空（排行榜回到待取数）",
  ev(`document.querySelector('#field .rank-empty')?.innerText || ''`), "待取数");

/* --- 趋势 --- */
ev(`document.querySelector('#trend .btn').click()`);
wait(6000);
const tq1 = takeCalls();
ok("点「加载趋势」会取数", tq1.length > 0, JSON.stringify(tq1.length));
ev(`document.querySelector('#trend .btn').click()`);
wait(3000);
eq("趋势命中缓存后再点不发请求", takeCalls().length, 0);
const tfq = ev(FRESH_INFO("#trend"));
ok("趋势命中后同样给出「缓存 ·」与「重新取数」",
  !!tfq && /缓存/.test(tfq.txt) && tfq.refetch === true, JSON.stringify(tfq));
ev(`[...document.querySelectorAll('#trend .linkbtn')].find(b=>/重新取数/.test(b.textContent)).click()`);
wait(6000);
const tq3 = takeCalls();
ok("趋势「重新取数」会真的取数", tq3.length > 0, JSON.stringify(tq3.length));

/* --- 结论卡同一套 --- */
const cfq = ev(FRESH_INFO("#verdict"));
ok("结论卡也标出数据来源（缓存 · N … / 刚刚取数）",
  !!cfq && (/缓存/.test(cfq.txt) || /刚刚取数/.test(cfq.txt)), JSON.stringify(cfq));
ok("结论卡缓存命中时给「重新取数」，新取时则不给",
  !!cfq && (/缓存/.test(cfq.txt) ? cfq.refetch === true : cfq.refetch === false), JSON.stringify(cfq));

/* --- 结论卡 sun-rows：云型长格式 + 火烧云三角几何判定（2026-10-21） --- */
const sunRow = (label) => `(()=>{const rows=[...document.querySelectorAll('#verdict .sun-rows .sun-row')];
  const r=rows.find(x=>x.querySelector('.k')?.textContent.trim()==='${label}');
  return r?{txt:(r.querySelector('b')?.innerText||'').replace(/\\s+/g,' ').trim(), no:!!r.querySelector('b')?.classList.contains('geom-no')}:null;})()`;
const vType = ev(sunRow("云型"));
ok("结论卡云型是长格式「云型（低云 N% / 中云 N% / 高云 N%）」",
  !!vType && /（低云 \d+% \/ 中云 \d+% \/ 高云 \d+%）$/.test(vType.txt), JSON.stringify(vType));
const geomRow = ev(sunRow("几何条件"));
ok("结论卡 sun-rows 有「几何条件」判定行", !!geomRow && !!geomRow.txt, JSON.stringify(geomRow));
ok("几何判定文案是V1三分支之一（成立 / 超距离上限 / 无云盘）",
  !!geomRow && (/^火烧云三角几何条件成立$/.test(geomRow.txt) ||
    /^几何条件不成立：云边界距离 .+ 已超过霞光深入距离上限 .+（该云盘范围内阳光无法从云底下方射入）$/.test(geomRow.txt) ||
    /^几何条件不成立：日出\/日落方向 400 km 内没有找到可承载霞光的云盘$/.test(geomRow.txt)),
  JSON.stringify(geomRow));
ok("geom-no 标记与文案一致（成立不标、不成立标）",
  !!geomRow && geomRow.no === !/^火烧云三角几何条件成立$/.test(geomRow.txt), JSON.stringify(geomRow));

/* ================= 因素面板（2026-10-21 详细化） =================
   判据：13 项（含模式一致性）、每卡有判定 pill、数值是富文本（不是裸 0）、
   描述换成长文案。dedge 那条是本轮修的根因（nz(sRT.d,0) 把「无边界」压成 0）。 */
if (ev(`document.querySelectorAll('#factors .fac-card').length`) < 13) {
  ev(`document.querySelector('#verdict .linkbtn')?.click() || document.querySelector('.hero .btn-primary')?.click()`);
  wait(4000);
}
const facN = ev(`document.querySelectorAll('#factors .fac-card').length`);
ok("因素面板给出 13 张卡", facN === 13, JSON.stringify(facN));
const facKeys = ev(`[...document.querySelectorAll('#factors .fac-card')].map(e=>e.dataset.fkey)`);
ok("第 13 项是「模式一致性」", Array.isArray(facKeys) && facKeys[12] === "consist",
  JSON.stringify(facKeys));
const pillTxt = ev(`[...document.querySelectorAll('#factors .fj')].map(e=>e.innerText.trim())`);
ok("每张卡都有判定 pill（有利/中性/不利/数据缺失）",
  pillTxt.length === 13 && pillTxt.every(x => ["有利", "中性", "不利", "数据缺失"].includes(x)),
  JSON.stringify(pillTxt));
const dedgeVal = ev(`document.querySelector('#factors .fac-card[data-fkey=dedge] .fac-val')?.innerText || ''`);
ok("云边界距离是文字描述（无明显云边界 / 带上限），不是 0",
  dedgeVal === "无明显云边界" || /上限/.test(dedgeVal), JSON.stringify(dedgeVal));
ok("云边界距离不再显示裸 0", dedgeVal !== "0" && !/^0(\.0)?\s*(km)?$/.test(dedgeVal.trim()),
  JSON.stringify(dedgeVal));
const coverVal = ev(`(document.querySelector('#factors .fac-card[data-fkey=cover] .fac-val')?.innerText || '').replace(/\\s+/g,' ').trim()`);
ok("云量显示长格式「云型（低云 N% / 中云 N% / 高云 N%）」",
  /^.+（低云 \d+% \/ 中云 \d+% \/ 高云 \d+%）$/.test(coverVal), JSON.stringify(coverVal));
const consistVal = ev(`document.querySelector('#factors .fac-card[data-fkey=consist] .fac-val')?.innerText || ''`);
ok("模式一致性给出 ΔI/ΔP/ΔQ 或「数据不足」",
  /ΔI|ΔP|数据不足/.test(consistVal), JSON.stringify(consistVal));
const facSub = ev(`document.querySelector('#factors .sub')?.innerText || ''`);
ok("副标题写 13 项判据", /13/.test(facSub), JSON.stringify(facSub));
const dedgeDescLen = ev(`document.querySelector('#factors .fac-card[data-fkey=dedge] p')?.innerText.length || 0`);
ok("描述换成长文案（>40 字）", dedgeDescLen > 40, JSON.stringify(dedgeDescLen));
const missVals = ev(`[...document.querySelectorAll('#factors .fac-card')].map(e=>e.querySelector('.fac-val').innerText.trim())`);
ok("缺失值显示 — 而不是 0", missVals.every(x => x !== "0"), JSON.stringify(missVals));

/* ================= 多观测点对比（2026-10-21） =================
   同一纪律：断「点了不取数」数真实请求；列表跨刷新记住；当前地点零取数。 */
console.log("\n[多观测点对比]");
function waitCmp(minCards, noMiss) {
  for (let i = 0; i < 50; i++) {
    wait(300);
    const st = ev(`(()=>{const sec=document.querySelector('#compare'); if(!sec) return {n:0,miss:0};
      return {n:sec.querySelectorAll('.rcard').length, miss:sec.querySelectorAll('.rcard.miss').length};})()`);
    if (st && st.n >= minCards && (!noMiss || st.miss === 0)) return st;
  }
  return ev(`({n:document.querySelectorAll('#compare .rcard').length,
    miss:document.querySelectorAll('#compare .rcard.miss').length})`);
}
ab("eval", `localStorage.removeItem('glowcast.v2.cmp.v1')`);
ab("eval", FETCH_STUB);
ab("reload");
wait(1200);
ab("eval", FETCH_STUB); /* reload 冲掉桩，必须重装 */
ev(`document.querySelector('.hero .btn-primary')?.click()`); /* 用桩重算主结果 */
waitCmp(1, false);
takeCalls(); /* 丢弃挂载/重算期请求 */
wait(900);
const cAuto1 = takeCalls();
ok("对比区挂载（auto）不发任何请求", cAuto1.length === 0, JSON.stringify(cAuto1.length));
const mainCard = ev(`(()=>{const c=document.querySelector('#compare .rcard'); return c?c.innerText.slice(0,80):'';})()`);
ok("当前地点卡自动加入且标注来源", /当前地点/.test(mainCard), JSON.stringify(mainCard));

/* 结构（2026-10-21 太宽修复）：根节点必须 section>wrap，玻璃卡限宽不再通栏；
   卡区固定两列；仅 1 卡时右侧补虚线占位卡（.phcard 不带 rcard 类，不进计数）。 */
const struct = ev(`(()=>{const s=document.querySelector('#compare'); if(!s) return null;
  const w=s.querySelector('.wrap'), c=s.querySelector('.cmp'), g=s.querySelector('.grid');
  if(!w||!c||!g) return {hasWrap:!!w,hasCmp:!!c,hasGrid:!!g};
  const wr=w.getBoundingClientRect(), cr=c.getBoundingClientRect();
  return {sec:s.classList.contains('section'), wrapW:Math.round(wr.width), cmpW:Math.round(cr.width),
    cols:getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length,
    ph:!!s.querySelector('.phcard')};})()`);
ok("对比区是 section>wrap 且玻璃卡不超出 wrap（不再通栏）",
  !!struct && struct.sec === true && struct.cmpW <= struct.wrapW + 1 && struct.wrapW <= 1180,
  JSON.stringify(struct));
ok("桌面卡区固定两列", !!struct && struct.cols === 2, JSON.stringify(struct));
const phTxt = ev(`document.querySelector('#compare .phcard')?.innerText || ''`);
ok("仅 1 卡时右侧有「＋ 再加一个观测点」占位卡",
  !!struct && struct.ph === true && /再加一个观测点/.test(phTxt), JSON.stringify([struct, phTxt]));

/* 种入一个搜索点（天津市），刷新后列表应记住 */
ab("eval", `localStorage.setItem('glowcast.v2.cmp.v1', JSON.stringify([{name:"天津市",prov:"天津市",lat:39.13,lon:117.20,src:"search"}]))`);
ab("eval", FETCH_STUB);
ab("reload");
wait(1200);
ab("eval", FETCH_STUB); /* 重装桩 */
ev(`document.querySelector('.hero .btn-primary')?.click()`);
const stSeed = waitCmp(2, false);
ok("对比列表跨刷新记住（当前地点+天津共 2 卡）", stSeed.n === 2, JSON.stringify(stSeed));
ok("两张卡后占位卡消失", ev(`!document.querySelector('#compare .phcard')`) === true);
const cAuto2 = takeCalls();
wait(900);
const cAuto3 = takeCalls();
ok("未取数点在 auto 下保持空缺且不烧额度", cAuto2.length === 0 && cAuto3.length === 0,
  JSON.stringify([cAuto2.length, cAuto3.length]));
const missTxt = ev(`document.querySelector('#compare .rcard.miss')?.innerText || ''`);
ok("缺数卡提示「尚未取数」与取数入口", /尚未取数/.test(missTxt) && /加载对比/.test(missTxt), JSON.stringify(missTxt.slice(0, 60)));

ev(`document.querySelector('#compare .acts .btn-primary').click()`);
const stLoad = waitCmp(2, true);
const cLoad = takeCalls();
ok("「加载对比」为缺数点真实取数", stLoad.miss === 0 && cLoad.length > 0,
  JSON.stringify([stLoad, cLoad.length]));
const tCard = ev(`(()=>{const cs=[...document.querySelectorAll('#compare .rcard')];
  const c=cs.find(x=>x.innerText.includes('天津市')); if(!c) return null;
  const kv=c.querySelector('.kv');
  const rows=kv?[...kv.querySelectorAll('span')]:[];
  const ct=rows.find(s=>s.textContent.trim()==='云型');
  return {score:c.querySelector('.score')?.innerText||'', kv:rows.length,
    cover:ct&&ct.nextElementSibling?ct.nextElementSibling.innerText.trim():null};})()`);
ok("取数后天津卡有综合分与 6 行明细", tCard && /^\d+$/.test(String(tCard.score).trim()) && tCard.kv === 6, JSON.stringify(tCard));
ok("对比卡云型也是长格式「云型（低云 N% / 中云 N% / 高云 N%）」",
  !!tCard && !!tCard.cover && /（低云 \d+% \/ 中云 \d+% \/ 高云 \d+%）$/.test(tCard.cover),
  JSON.stringify(tCard && tCard.cover));
const scores = ev(`[...document.querySelectorAll('#compare .rcard .score')].map(e=>+e.innerText)`);
ok("卡片按综合分降序排列", scores.length === 2 && scores[0] >= scores[1], JSON.stringify(scores));

ev(`document.querySelector('#compare .acts .btn-primary').click()`);
wait(1200);
const cAgain = takeCalls();
ok("命中缓存后再点「加载对比」0 请求", cAgain.length === 0, JSON.stringify(cAgain.length));

ab("eval", FETCH_STUB);
ab("reload");
wait(1200);
ab("eval", FETCH_STUB); /* 重装桩 */
ev(`document.querySelector('.hero .btn-primary')?.click()`);
const stR = waitCmp(2, true);
const cR = takeCalls();
ok("刷新后列表与缓存仍在（0 请求复现）", stR.n === 2 && stR.miss === 0 && cR.length === 0,
  JSON.stringify([stR, cR.length]));

ev(`[...document.querySelectorAll('#compare .rcard')].find(x=>x.innerText.includes('天津市'))?.querySelector('.rm')?.click()`);
wait(500);
const nAfterRm = ev(`document.querySelectorAll('#compare .rcard').length`);
ok("移除单点后只剩当前地点卡", nAfterRm === 1, JSON.stringify(nAfterRm));
ev(`[...document.querySelectorAll('#compare .acts button')].find(b=>b.innerText.includes('清空'))?.click()`);
wait(500);
const lsCmp = ev(`localStorage.getItem('glowcast.v2.cmp.v1')`);
ok("「清空对比」清空列表与存储", lsCmp === "[]" && ev(`document.querySelectorAll('#compare .rcard').length`) === 1,
  JSON.stringify(lsCmp));

/* 390px：标题不得被挤成竖排（section-head 必须能换行，head-right 落下一行） */
vp(390, 844);
wait(400);
const mh = ev(`(()=>{const s=document.querySelector('#compare'); if(!s) return null;
  const h=s.querySelector('.section-head h2'), hr=s.querySelector('.head-right');
  if(!h||!hr) return {hasH:!!h,hasHr:!!hr};
  const r=h.getBoundingClientRect(), rr=hr.getBoundingClientRect();
  return {h2h:Math.round(r.height), stacked:rr.top>=r.bottom-2,
    noOverflow:document.documentElement.scrollWidth<=390};})()`);
ok("390px 标题不被挤扁（section-head 换行、head-right 落到下一行、无横向溢出）",
  !!mh && mh.h2h < 50 && mh.stacked === true && mh.noOverflow === true, JSON.stringify(mh));

/* ================= 1280px 英文：永远走不到单行/收紧，必须落汉堡档 =================
   实测：英文单行需 1373px、收紧后含胶囊约 1230px，而 .wrap 封顶 1180 —— 两条路都超。
   所以英文的判据是「导航不许折成两行、顶栏不许横向溢出」，形态落到 menu 是预期结果。 */
console.log("\n[1280px 英文]");
ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'en',theme:'light'}))`);
ab("reload");
wait(1500);
vp(1280, 900);
wait(600);
const enTop = ev(`(()=>{const tb=document.querySelector('.topbar');
  const nm=tb.querySelector('.brand .name'), cs=getComputedStyle(nm);
  let lh=parseFloat(cs.lineHeight); if(!isFinite(lh)) lh=parseFloat(cs.fontSize)*1.4;
  const inn=tb.querySelector('.topbar-in');
  const nav=tb.querySelector('.nav-tabs');
  const links=[...nav.querySelectorAll('a')];
  const lines=getComputedStyle(nav).display==='none'?0:new Set(links.map(a=>Math.round(a.getBoundingClientRect().top))).size;
  return {cls:tb.className, lines, nameH:Math.round(nm.getBoundingClientRect().height*100)/100, lh:Math.round(lh*100)/100,
    bar:Math.round(tb.getBoundingClientRect().height),
    overflow:inn.scrollWidth-inn.clientWidth,
    pill:getComputedStyle(tb.querySelector('.top-actions > .meta-pill')).display,
    meta:document.querySelectorAll('.topbar-meta').length,
    armed:tb.parentElement.querySelector('.mdrawer').classList.contains('armed')};})()`);
eq("1280px 英文落到汉堡档（单行/收紧都放不下）", enTop.cls, "topbar mode-menu");
ok("英文顶栏不横向溢出", enTop.overflow <= 0, JSON.stringify(enTop.overflow));
ok("英文导航没有被折成两行（隐藏或一行）", enTop.lines <= 1, JSON.stringify(enTop.lines));
ok("英文品牌名仍是单行", enTop.nameH <= enTop.lh * 1.35, JSON.stringify(enTop));
ok("英文徽标仍在第一行（第二行结构已删除）",
  enTop.bar === 63 && enTop.pill !== "none" && enTop.meta === 0 && enTop.armed === true, JSON.stringify(enTop));

/* ================= 英文手机 390：品牌名不许把页面顶出横向滚动 =================
   "Glow Forecast" 与 "GLOWCAST" 之间没有空格，行内断不开，改前会把整页顶出 65px。 */
vp(390, 844);
ab("reload");
wait(1200);
const enMobile = ev(`(()=>{const nm=document.querySelector('.brand .name'), cs=getComputedStyle(nm);
  let lh=parseFloat(cs.lineHeight); if(!isFinite(lh)) lh=parseFloat(cs.fontSize)*1.4;
  const tb=document.querySelector('.topbar'), inn=tb.querySelector('.topbar-in');
  return {cls:tb.className, docW:document.documentElement.scrollWidth, brand:Math.round(nm.getBoundingClientRect().width),
    brandH:Math.round(nm.getBoundingClientRect().height), lh:Math.round(lh*100)/100,
    barRight:Math.round(tb.getBoundingClientRect().right),
    innOver:inn.scrollWidth-inn.clientWidth};})()`);
eq("英文手机也走 mode-mini", enMobile.cls, "topbar mode-mini");
ok("英文手机品牌名仍是单行（教程进抽屉换来的宽度）",
  !!enMobile && enMobile.brandH <= enMobile.lh * 1.35, JSON.stringify(enMobile));
ok("英文手机品牌名可折行（width ≤ 140px）", !!enMobile && enMobile.brand <= 140, JSON.stringify(enMobile));
/* 只断顶栏自身：整页 scrollWidth 在英文下还有模型切换器 .seg 的既有溢出（402 > 390），与本组件无关 */
ok("英文手机顶栏自身不出视口",
  !!enMobile && enMobile.barRight <= 390 && enMobile.innOver <= 0, JSON.stringify(enMobile));

/* ================= 城市名与地图地名 · 多语言 =================
   2026-10-22 需求：英文 / 繁体模式下城市名与「地图上的文字」仍是中文。口径：
   · 显示名走 core/citylang.ts（表由 scripts/gen-cityname.mjs 生成，486 城 / 104 省区）
   · 英 / 繁关掉腾讯底图的 point/label 要素，改由画布自绘地名
   · 自绘分级按「可视纵向跨度 km」判，不按 SDK zoom —— __gcLabels(span) 可强行试 */
console.log("\n[城市名与地图地名 · 多语言]");

/* 生成式点位名：网格点名字是拼出来的（「广州市 东南 30 km」），整串查词典必失败 */
const NAME_CASES = [
  ["广州市", "Guangzhou", "廣州市"],
  ["广州市附近", "Guangzhou nearby", "廣州市附近"],
  ["广州市 东南 30 km", "Guangzhou SE 30 km", "廣州市 東南 30 km"],
  ["我的位置", "My location", "我的位置"]
];

function cityLangCase(lang) {
  ab("open", PAGE);
  ab("eval", `localStorage.setItem('glowcast.v2.pref', ` +
    `JSON.stringify({lang:'${lang}',theme:'light',cityName:'广州市'}))`);
  ab("reload");
  wait(1600);
  vp(1280, 900);
  wait(400);
  return ev(`(()=>{
    const q=(s)=>document.querySelector(s);
    const pill=q('.top-actions > .meta-pill'), hero=q('.hero-city');
    const flat=(e)=>e?e.innerText.replace(/\\s+/g,' ').trim():null;
    const cands=(span)=>window.__gcLabels?window.__gcLabels(span):null;
    return {
      pill: flat(pill), hero: flat(hero),
      names: ${JSON.stringify(NAME_CASES.map((c) => c[0]))}.map(s=>window.__gcName?window.__gcName(s):null),
      bm: window.__gcBaseMap?window.__gcBaseMap():null,
      l1120: cands(1120), l500: cands(500), l100: cands(100)
    };})()`);
}

/* ---- 英文 ---- */
const ENC = cityLangCase("en");
ok("英文徽标以 Guangzhou 开头（地点随语言）",
  !!ENC.pill && ENC.pill.indexOf("Guangzhou") === 0, JSON.stringify(ENC.pill));
ok("英文 hero 地点写成 Guangzhou · Guangdong",
  !!ENC.hero && ENC.hero.indexOf("Guangzhou · Guangdong") === 0, JSON.stringify(ENC.hero));
eq("英文生成式点位名（城市 + 附近 + 方位距离 + 我的位置）",
  ENC.names, NAME_CASES.map((c) => c[1]));
ok("英文模式关掉底图的 point/label 要素（底图文字不再出中文）",
  !!ENC.bm && JSON.stringify(ENC.bm.conf) === JSON.stringify(["base", "building2d"]),
  JSON.stringify(ENC.bm));
ok("英文自绘地名远看只画省会级（tierMax=0）",
  !!ENC.l1120 && ENC.l1120.tierMax === 0 && ENC.l1120.tiers.every((t) => t === 0),
  JSON.stringify(ENC.l1120 && { tierMax: ENC.l1120.tierMax, tiers: ENC.l1120.tiers }));
ok("英文自绘地名用的是英文名（首字符为拉丁字母）",
  !!ENC.l1120 && ENC.l1120.names.length > 0 &&
  ENC.l1120.names.every((n) => /^[A-Za-z]/.test(n)), JSON.stringify(ENC.l1120 && ENC.l1120.names));
ok("中景（500 km）放开到地级市，近景（100 km）全量",
  !!ENC.l500 && ENC.l500.tierMax === 1 && !!ENC.l100 && ENC.l100.tierMax === 2,
  JSON.stringify({ l500: ENC.l500 && ENC.l500.tierMax, l100: ENC.l100 && ENC.l100.tierMax }));
ok("自绘地名确实落笔了（drawn > 0）", !!ENC.l1120 && ENC.l1120.drawn > 0,
  JSON.stringify(ENC.l1120 && ENC.l1120.drawn));
/* 城市命中在英/繁走的是「真实落笔矩形」这条分支（简体走底图锚点估算），
   两条分支都得守：命中矩形取错就又会弹邻市。 */
const enHit = ev(`(()=>{const L=window.__gcLabels();
  const g=(L.geo||[]).find(x=>x.text==='Guangzhou');
  if(!g) return null;
  const s=window.__gcSnap((g.x0+g.x1)/2, g.y);
  return {city:s.city&&s.city.name, nearest:s.nearest&&s.nearest.name};})()`);
ok("英/繁自绘地名可被点中（命中矩形取自真实落笔）",
  !!enHit && enHit.city === "广州市", JSON.stringify(enHit));
/* 贴边城市（台北）早前会被 +/− 控件盖掉半截：一是文字没翻边，二是控件压在上面。
   现在文字左右翻边、控件挪到右下 —— 这条守住「所有落笔都在框内」这个不变量。 */
ok("每条地名都完整落在画布内（不出框、不画半截字）",
  !!ENC.l1120 && ENC.l1120.geo.every((g) =>
    g.x0 >= 2 && g.x1 <= ENC.l1120.box.w - 2 && g.y >= 6 && g.y <= ENC.l1120.box.h - 6),
  JSON.stringify(ENC.l1120 && ENC.l1120.geo.filter((g) =>
    g.x0 < 2 || g.x1 > ENC.l1120.box.w - 2)));
/* 控件（缩放钮 / 罗盘 / 比例尺 / 腾讯 logo 与审图号）浮在画布之上：地名撞上去会被
   吃掉半截 —— 实测「Shanwei」被压成「…nwei」、「Guangzhou」被压成「Guangzh」。
   2026-10-22 起把控件实际占位量出来当避让区，这两条守它不再回归。 */
const rectOverlap = (a, b) => !(a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1]);
const labelRect = (g) => [g.x0, g.y - 8, g.x1, g.y + 8];
const hitChrome = (L) => !L ? [] : L.geo.filter((g) =>
  L.avoid.some((q) => rectOverlap(labelRect(g), q))).map((g) => g.text);
ok("控件避让区已量到（缩放钮 / 罗盘 / 比例尺 / logo）",
  !!ENC.l1120 && (ENC.l1120.avoid.length >= 3 || !ENC.bm || ENC.bm.applied === null),
  JSON.stringify(ENC.l1120 && ENC.l1120.avoid));
ok("没有一条地名压在 SDK 控件上（英文）",
  !!ENC.l1120 && hitChrome(ENC.l1120).length === 0, JSON.stringify(hitChrome(ENC.l1120)));
/* 英文名进检索索引：佛山市没有任何手写拼音别名，只能靠生成表命中 */
ab("eval", `(()=>{const i=document.querySelector('.hero-controls input');
  i.value='foshan';i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
wait(300);
const enSug = ev(`[...document.querySelectorAll('.hero .sug button b')].map(b=>b.innerText.trim())`);
ok("英文名可检索（foshan → Foshan）", enSug.indexOf("Foshan") >= 0, JSON.stringify(enSug.slice(0, 5)));

/* ---- 繁体 ---- */
const HTC = cityLangCase("hant");
ok("繁体徽标以 廣州市 开头（台湾正字）",
  !!HTC.pill && HTC.pill.indexOf("廣州市") === 0, JSON.stringify(HTC.pill));
ok("繁体 hero 地点写成 廣州市 · 廣東省",
  !!HTC.hero && HTC.hero.indexOf("廣州市 · 廣東省") === 0, JSON.stringify(HTC.hero));
eq("繁体生成式点位名", HTC.names, NAME_CASES.map((c) => c[2]));
ok("繁体模式同样关掉底图文字要素",
  !!HTC.bm && JSON.stringify(HTC.bm.conf) === JSON.stringify(["base", "building2d"]),
  JSON.stringify(HTC.bm));
ok("繁体自绘地名里出现 廣州市",
  !!HTC.l1120 && HTC.l1120.names.indexOf("廣州市") >= 0,
  JSON.stringify(HTC.l1120 && HTC.l1120.names));
ok("没有一条地名压在 SDK 控件上（繁体）",
  !!HTC.l1120 && hitChrome(HTC.l1120).length === 0, JSON.stringify(hitChrome(HTC.l1120)));
/* 繁体名进检索索引：廈門 只能靠生成表命中（手写别名只有 xiamen / xm） */
ab("eval", `(()=>{const i=document.querySelector('.hero-controls input');
  i.value='廈門';i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
wait(300);
const htSug = ev(`[...document.querySelectorAll('.hero .sug button b')].map(b=>b.innerText.trim())`);
ok("繁体名可检索（廈門 → 廈門市）", htSug.indexOf("廈門市") >= 0, JSON.stringify(htSug.slice(0, 5)));

/* ---- 简体：底图文字保留（自绘会与底图叠字），生成式名字原样 ---- */
const ZHC = cityLangCase("zh");
ok("简体徽标仍是 广州市", !!ZHC.pill && ZHC.pill.indexOf("广州市") === 0, JSON.stringify(ZHC.pill));
ok("简体 hero 仍是 广州市 · 广东省",
  !!ZHC.hero && ZHC.hero.indexOf("广州市 · 广东省") === 0, JSON.stringify(ZHC.hero));
eq("简体生成式点位名原样", ZHC.names, NAME_CASES.map((c) => c[0]));
ok("简体保留底图自带地名（point/label 要素在）",
  !!ZHC.bm && ZHC.bm.conf.indexOf("point") >= 0 && ZHC.bm.conf.indexOf("label") >= 0,
  JSON.stringify(ZHC.bm));

/* ---- 案 C·2（2026-10-22 拍板）：英/繁缩进街区级自动交棒底图中文文字 ----
   阈值 120 km，滞回 >132 才切回；切换静默；自绘整层退出防叠字。 */
console.log("\n[案 C·2 · 街区级自动切换底图文字]");

/* 换英文页：简体的 conf 与该状态无关，滞回链的语义要在英文模式下才验得真 */
ab("open", PAGE);
ab("eval", `localStorage.setItem('glowcast.v2.pref', ` +
  `JSON.stringify({lang:'en',theme:'light',cityName:'广州市'}))`);
ab("reload");
wait(1600);
vp(1280, 900);
wait(400);

/* 真实缩放集成：SDK 在场才跑。离线兜底没有底图可切（applied=null），自绘永远
   在 —— 属正常跳过，与「mock 兜底跳过时区精确断言」同理。 */
const BM0 = ev(`window.__gcBaseMap?window.__gcBaseMap():null`);
if (BM0 && BM0.applied) {
  const okZoom = ev(`(()=>{const m=window.__gcMap&&window.__gcMap();
    if(!m||typeof m.setZoom!=='function') return 'no-map'; m.setZoom(15); return 'ok';})()`);
  if (okZoom === "ok") {
    let on = false;
    for (let i = 0; i < 25 && !on; i++) {
      on = !!ev(`window.__gcBaseMap?window.__gcBaseMap().baseTextOn:false`);
      if (!on) wait(200);
    }
    const BM1 = ev(`window.__gcBaseMap?window.__gcBaseMap():null`);
    const L1 = ev(`window.__gcLabels?window.__gcLabels():null`);
    ok("缩进街区级（zoom 15）自动开底图文字（applied 含 point/label）",
      !!BM1 && BM1.baseTextOn === true && !!BM1.applied &&
      BM1.applied.indexOf("point") >= 0 && BM1.applied.indexOf("label") >= 0,
      JSON.stringify(BM1));
    ok("自动开后自绘整层退出（落笔 0，防叠字）",
      !!L1 && L1.drawn === 0, JSON.stringify(L1 && L1.drawn));
    ev(`(()=>{const m=window.__gcMap(); m.setZoom(6); return 1})()`);
    let off = false;
    for (let i = 0; i < 25 && !off; i++) {
      off = !!ev(`window.__gcBaseMap?(!window.__gcBaseMap().baseTextOn):false`);
      if (!off) wait(200);
    }
    const BM2 = ev(`window.__gcBaseMap?window.__gcBaseMap():null`);
    const L2 = ev(`window.__gcLabels?window.__gcLabels():null`);
    ok("跨回远景（zoom 6）自动切回自绘（applied 无 point/label，落笔恢复）",
      !!BM2 && BM2.baseTextOn === false && !!BM2.applied &&
      BM2.applied.indexOf("point") < 0 && !!L2 && L2.drawn > 0,
      JSON.stringify({ bm: BM2 && BM2.baseTextOn, drawn: L2 && L2.drawn }));
  } else {
    console.log("  - 跳过真实缩放集成（地图实例不可用）；滞回逻辑由纯链覆盖");
  }
} else {
  console.log("  - 跳过真实缩放集成（SDK 未就绪 applied=null，离线兜底自绘常开）；滞回逻辑由纯链覆盖");
}

/* 纯滞回链：__gcAutoText 同步推进状态机，无真实缩放、无 paint 竞态。
   顺序 [119,125,140,10,100000] 恰好走完 开→滞回带保持→关→再开→再关。 */
const HYST = ev(`(()=>{const a=window.__gcAutoText; if(!a) return null;
  a(100000);
  return [119,125,140,10,100000].map(s=>{const r=a(s);
    return [s, r.baseTextOn, r.conf.indexOf("point")>=0];});})()`);
eq("滞回全程：≤120 开、滞回带保持现状、>132 关",
  HYST, [[119,true,true],[125,true,true],[140,false,false],[10,true,true],[100000,false,false]]);

/* ================= 城市名选点：点「广州市」就得给广州市 =================
   用户报：搜香港后点地图上的广州市，弹的却是「清远市附近」。
   根因不是吸附半径 —— 城市名 486 个，旧网格 120km / 57 点，广州连最近的格点
   都要借清远的名字（18.6px）。加密到 80km / 121 点后锚点旁终于有了自家格点
   （6.3px），但「格点」与「城市本身」仍是两个坐标 —— 城市名单独命中且
   **标签优先**：有缓存直接出数，否则只给一个显式取数按钮。 */
console.log("\n[城市名选点（点广州市必须给广州市）]");
ab("open", PAGE + "?name=%E9%A6%99%E6%B8%AF&lat=22.3193&lon=114.1694&date=2026-10-22&period=pm");
ab("eval", `localStorage.setItem('glowcast.v2.pref', JSON.stringify({lang:'zh',theme:'light',cityName:'香港'}))`);
ab("eval", `Object.keys(localStorage).filter(k=>k.startsWith('glowcast.v2.')&&k!=='glowcast.v2.pref').forEach(k=>localStorage.removeItem(k))`);
ab("eval", FETCH_STUB);
ab("reload");
wait(1400);
ab("eval", FETCH_STUB);
wait(4600);
/* ev() 把表达式塞进 JSON.stringify(...)：带「;1」的语句片段必须走 ab("eval") */
ab("eval", `document.querySelector('#field').scrollIntoView({behavior:'instant',block:'start'});1`);
wait(600);
ab("eval", `document.querySelector('#field .btn-primary')?.click();1`);
wait(6000);
takeCalls(); /* 丢掉地图加载这一批 */

/* 真实点击序列打到 elementFromPoint 的顶层元素：el.click() 直发会绕过命中测试 */
const tap = (x, y) => ev(`(()=>{const b=document.querySelector('.map-box');
  if(!b) return 'no-box';
  const r=b.getBoundingClientRect();
  const el=document.elementFromPoint(r.left+${x}, r.top+${y})||b;
  const o={bubbles:true,cancelable:true,clientX:r.left+${x},clientY:r.top+${y},view:window};
  el.dispatchEvent(new MouseEvent('mousemove',o));
  el.dispatchEvent(new MouseEvent('mousedown',o));
  el.dispatchEvent(new MouseEvent('mouseup',o));
  el.dispatchEvent(new MouseEvent('click',o));
  return el.className||el.tagName;})()`);
const cardText = () => ev(`(()=>{const c=document.querySelector('.pincard');
  return c?c.innerText.replace(/\\n+/g,' | '):null;})()`);

const GZ = ev(`(()=>{const p=window.__gcProj(23.1252,113.2806);
  return p?{x:Math.round(p.x),y:Math.round(p.y)}:null;})()`);
const HKP = ev(`(()=>{const p=window.__gcProj(22.3193,114.1694);
  return p?{x:Math.round(p.x),y:Math.round(p.y)}:null;})()`);
ok("香港视图能定位到广州市与香港的屏幕坐标（否则后面全是空断）",
  !!GZ && !!HKP, JSON.stringify({ GZ, HKP }));

if (GZ && HKP) {
  /* 用户报的矛盾的量化版：同一像素点上，格点叫邻市、城市名是广州。
     加密到 80km（121 点）后广州锚点旁终于有了自家格点（6.3px）——
     旧 120km / 57 点网格最近的是「清远市附近」18.6px。几何层面的矛盾已缓解，
     但城市卡仍走标签优先：它给的是**广州本城坐标**的数据，不是 25km 外
     那个格点的数据，两件事不能混。 */
  const snap = ev(`(()=>{const s=window.__gcSnap(${GZ.x},${GZ.y});
    return {city:s.city&&s.city.name, nearest:s.nearest&&s.nearest.name,
      dist:s.nearest&&s.nearest.dist};})()`);
  ok("网格加密到 80km 后广州锚点旁已有自家格点（旧 120km 网格最近的是清远市附近）",
    !!snap && !!snap.nearest && snap.nearest.indexOf("广州") >= 0 && snap.dist < 20,
    JSON.stringify(snap));
  ok("同一坐标的城市命中给出广州市（标签优先于格点）",
    !!snap && snap.city === "广州市", JSON.stringify(snap));

  /* 悬停：只读小卡必须报城市本身，不能报 40 km 外的邻市格点 */
  ev(`(()=>{const b=document.querySelector('.map-box');const r=b.getBoundingClientRect();
    const el=document.elementFromPoint(r.left+${GZ.x}, r.top+${GZ.y-8})||b;
    el.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:r.left+${GZ.x},clientY:r.top+${GZ.y-8}}));return 1})()`);
  wait(300);
  const hovCity = ev(`(()=>{const t=document.querySelector('.tip');
    return t?{txt:t.innerText.replace(/\\n+/g,' | '),btn:!!t.querySelector('.tip-add')}:null;})()`);
  ok("悬停城市名报城市本身（不再报邻市格点），且无按钮",
    !!hovCity && hovCity.txt.indexOf("广州市") >= 0 && hovCity.btn === false,
    JSON.stringify(hovCity));

  takeCalls();
  tap(GZ.x, GZ.y - 8);
  wait(500);
  const c1 = cardText();
  const cityCard1 = ev(`(()=>{const c=document.querySelector('.pincard-city');
    return c?{btn:(c.querySelector('.tip-add')||{}).innerText||null}:null;})()`);
  ok("点广州市出城市卡（带「非网格点」身份，不是格点卡）",
    !!cityCard1 && !!c1 && c1.indexOf("广州市") >= 0 && /非网格点/.test(c1),
    JSON.stringify(c1));
  ok("城市卡先只给取数按钮，绝不自作主张取数（请求数 0）",
    !!cityCard1 && /取该城市数据/.test(cityCard1.btn || "") && takeCalls().length === 0,
    JSON.stringify(cityCard1));

  /* 真按下去：3 次多点请求（17 点样带 × GFS/EC/AQ）＝ 51 次加权调用 */
  ev(`(()=>{const b=document.querySelector('.pincard-city .tip-add');
    const r=b.getBoundingClientRect(); const cx=r.left+r.width/2, cy=r.top+r.height/2;
    const top=document.elementFromPoint(cx,cy)||b;
    const o={bubbles:true,cancelable:true,clientX:cx,clientY:cy,view:window};
    top.dispatchEvent(new MouseEvent('mousedown',o));
    top.dispatchEvent(new MouseEvent('mouseup',o));
    top.dispatchEvent(new MouseEvent('click',o)); return 1})()`);
  wait(4000);
  const fetched = takeCalls();
  /* 多点参数里的逗号是百分号编码（%2C），必须先解码再数点数 */
  const ptsOk = fetched.length > 0 && fetched.every((u) => {
    const m = String(u).match(/latitude=[^&]+/);
    return !!m && decodeURIComponent(m[0]).split(",").length === 17;
  });
  const c2 = cardText();
  ok("点「取该城市数据」真的取数（3 次请求 × 17 点样带）",
    fetched.length === 3 && ptsOk, JSON.stringify({ n: fetched.length, ptsOk }));
  ok("取数后城市卡显示该城市的数字与「加入对比」",
    !!c2 && /综合指数/.test(c2) && /加入对比/.test(c2), JSON.stringify(c2));

  /* 缓存：再点一次必须零请求（6h 点缓存，与主结果/对比同源） */
  takeCalls();
  tap(40, 430); /* 先点空白关掉卡，否则点击被卡片吞掉 */
  wait(300);
  tap(GZ.x, GZ.y - 8);
  wait(500);
  const c3 = cardText();
  ok("再点广州市直接吃缓存：零请求且仍有数字",
    takeCalls().length === 0 && !!c3 && /综合指数/.test(c3), JSON.stringify(c3));

  /* 当前城市仍是格点卡：它自己有 0 环格点，不该逼用户去取数 */
  tap(40, 430);
  wait(300);
  tap(HKP.x, HKP.y - 8);
  wait(500);
  const hkCard = ev(`(()=>{const c=document.querySelector('.pincard');
    return c?{city:!!c.classList.contains('pincard-city'),t:c.innerText.split('\\n')[0]}:null;})()`);
  ok("点当前城市（香港）仍出格点卡：不弹取数按钮、零请求",
    !!hkCard && hkCard.city === false && hkCard.t === "香港" && takeCalls().length === 0,
    JSON.stringify(hkCard));

  tap(40, 430);
  wait(300);
  ok("点空白清掉城市卡", ev(`document.querySelector('.pincard') === null`) === true);
}

console.log(`\n结果：${pass} 通过 / ${fails.length} 失败`);
if (fails.length) {
  for (const f of fails) console.log("  ✗ " + f);
  process.exit(1);
}