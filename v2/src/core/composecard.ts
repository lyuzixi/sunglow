/* =========================================================================
   SUNGLOW v2 · 合成分享卡（2026-11-11 重做）
   ---------------------------------------------------------------------------
   底卡＝**改造前的 780×400 结论核心**（模块 1 报头照片 / 模块 2 城市·日期·
   概率结论 / 模块 3 页脚），模块 2 的内部版式一字不改；14 个可选模块接在
   结论层之后，单列流、按内容实测高度累加，卡片总高随勾选变化。

   为什么不用 drawShareCard（780×1024 完整结论版）当底：那是「整块结论」的
   独立产物，塞进合成卡会与模块 7/8 大量重复，也不是用户要的「模块 2 原样式」。

   模块清单（编号只用于沟通，展示顺序由用户拖拽决定）：
     1  报头照片（固定）      2 城市·日期·概率结论（固定）
     3  页脚·数据源（固定）   4 天色带          10 最佳观赏窗口
     5  十日趋势              6 观测场缩略      11 模型卡
     7a 云体条件 7b 光路几何 7c 大气通透 7d 动力与对流
     8a 光追关键量 8b 光谱色样 8c 照亮时间轴 8d 亮度·彩度曲线
     9  二维码
   ========================================================================= */
import type { ForecastResult } from "./forecast";
import type { VerdictView } from "./verdict";
import { conclWord } from "./verdict";
import { skyBandOf } from "./skyband";
import { t, getLang } from "./i18n";
import { cityName } from "./citylang";
import { uAlt, uDist, uClock } from "./units";
import { clamp, isNum } from "./math";
import { rayRows, rayCurve, rayTimeline } from "./raydetail";
import { SNAP_FAC_NAME, snapFacFmt, judgmentOf } from "./factors";
import { isForeignTz, tzLabel } from "./tz";
import { qrSafeUrl } from "./snapshot";
import { glowWindowOf } from "./shareextras";
import {
  f, rr, fit, withAlpha, tokColor, gradeColor,
  modelCardsOf, drawModelCard, deliverBlob, shareFileName,
  type TrendDay, type MapPtLite
} from "./sharecard";
import qrcode from "qrcode-generator";

export const COMPOSE_W = 780;
const S = 2, PAD = 44, INNER = COMPOSE_W - PAD * 2;
const RIGHT = COMPOSE_W - PAD;
/** 两遍绘制时先撑到的高度（够放下全部模块，实测最大约 2500） */
const MEASURE_H = 6000;

import {
  COMPOSE_MODULES, COMPOSE_IDS, COMPOSE_DEFAULT_ORDER, COMPOSE_DEFAULT_ON,
  type ComposeModId, type ComposeModDef
} from "./composemods";
export {
  COMPOSE_MODULES, COMPOSE_IDS, COMPOSE_DEFAULT_ORDER, COMPOSE_DEFAULT_ON,
  type ComposeModId, type ComposeModDef
};

export interface ComposeInput {
  r: ForecastResult;
  view: VerdictView;
  url: string;
  days: TrendDay[];
  map: { pts: MapPtLite[]; n: number } | null;
  mapImg?: HTMLCanvasElement | null;
  photo?: HTMLImageElement | null;
}

export type ComposeAvail = Record<ComposeModId, boolean>;

/** 哪些块现在有数据可画；没有的禁选并写明原因（产物里绝不出现“尚未加载”） */
export function composeAvail(d: ComposeInput): ComposeAvail {
  const band = skyBandOf(d.r, Date.now(), d.r.dateStr);
  return {
    sky: true, window: !!band?.win,
    trend: d.days.length > 0,
    map: !!d.map && d.map.pts.length > 0,
    models: true,
    facCloud: true, facPath: true, facAir: true, facDyn: true,
    rayRows: true, raySwatch: true, rayTime: true, rayCurve: true,
    qr: !!d.url
  };
}

/* ------------------------------------------------------------------ 画布 */
interface Pal {
  dark: boolean;
  BG: string; T1: string; T2: string; T3: string;
  LINE: string; ACC: string; SP: [string, string, string];
}
function palette(): Pal {
  const dark = document.documentElement.dataset.theme === "dark";
  return {
    dark,
    BG: tokColor("--bg-card-solid", dark ? "#101a2e" : "#ffffff"),
    T1: tokColor("--tx-1", dark ? "#e9eefb" : "#111a2c"),
    T2: tokColor("--tx-2", dark ? "#a0b1cd" : "#46556f"),
    T3: tokColor("--tx-3", dark ? "#5c6c8c" : "#8693ab"),
    LINE: tokColor("--stroke", dark ? "rgba(148,178,232,.14)" : "rgba(40,60,100,.10)"),
    ACC: tokColor("--acc-1", "#ff4d82"),
    SP: [
      tokColor("--spectrum-1", "#ff4d82"),
      tokColor("--spectrum-2", "#ff9c3f"),
      tokColor("--spectrum-3", "#2ed5e8")
    ]
  };
}
/** 热力格染料：按概率在 from→to 之间线性插值（不用透明度叠加，避免高值发闷紫）。
    正式取值见 TREND_RAMP；渲染时允许 window.__gcRamp 临时覆盖，仅供配色比对。 */
export const TREND_RAMP: [string, string] = ["#EAF6FC", "#2E86C1"];
function hexToRgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function mixHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a), B = hexToRgb(b), k = Math.max(0, Math.min(1, t));
  const r = A.map((v, i) => Math.round(v + (B[i] - v) * k));
  return "rgb(" + r[0] + "," + r[1] + "," + r[2] + ")";
}
const DUSK: Record<string, string> = {
  "s-day": "#dde5ee", "s-civil": "#f0c48c", "s-naut": "#d9784a",
  "s-astro": "#7a759f", "s-night": "#2b3450"
};

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
function weekdayOf(date: string): string {
  const [Y, M, D] = date.split("-").map(Number);
  return t(WEEK[new Date(Date.UTC(Y, (M || 1) - 1, D || 1)).getUTCDay()]);
}

/** 模块标题：左侧 13px 半粗 + 右侧小字（可选） */
function head(c: CanvasRenderingContext2D, p: Pal, y: number, title: string, right?: string): void {
  c.font = f(600, 13); c.fillStyle = p.T1;
  c.fillText(t(title), PAD, y);
  if (right) {
    c.font = f(500, 10); c.fillStyle = p.T3; c.textAlign = "right";
    c.fillText(fit(c, right, INNER * 0.6), RIGHT, y);
    c.textAlign = "left";
  }
}

/* ------------------------------------------------------- 模块 1：报头照片 */
function drawPhoto(e: Env, y: number): number {
  const { c, p, d } = e;
  const H = 88;
  const im = d.photo;
  if (im && im.width > 1) {
    const ih = H - 3;
    const sc = Math.max(COMPOSE_W / im.width, ih / im.height);
    const sw = COMPOSE_W / sc, sh = ih / sc;
    c.drawImage(im, (im.width - sw) / 2, (im.height - sh) * 0.5, sw, sh, 0, y + 3, COMPOSE_W, ih);
  } else {
    c.fillStyle = withAlpha(p.T1, 0.06);
    c.fillRect(0, y + 3, COMPOSE_W, H - 3);
  }
  const veil = c.createLinearGradient(0, y + 3, 0, y + H);
  veil.addColorStop(0, p.dark ? "rgba(7,11,20,.26)" : "rgba(242,245,251,.60)");
  veil.addColorStop(0.45, p.dark ? "rgba(7,11,20,.06)" : "rgba(242,245,251,.30)");
  veil.addColorStop(1, p.BG);
  c.fillStyle = veil; c.fillRect(0, y + 3, COMPOSE_W, H - 3);
  const scrim = c.createLinearGradient(0, y + 3, 0, y + 46);
  scrim.addColorStop(0, p.dark ? "rgba(7,11,20,.52)" : "rgba(255,255,255,.80)");
  scrim.addColorStop(1, "rgba(" + (p.dark ? "7,11,20" : "255,255,255") + ",0)");
  c.fillStyle = scrim; c.fillRect(0, y + 3, COMPOSE_W, 43);
  c.font = f(600, 11);
  c.fillStyle = p.dark ? "rgba(233,238,251,.85)" : "rgba(17,26,44,.85)";
  c.fillText(t("霞光档案") + " · SUNGLOW", PAD, y + 23);
  c.font = f(500, 11);
  c.fillStyle = tokColor("--photo-credit", p.dark ? "rgba(233,238,251,.62)" : "rgba(17,26,44,.56)");
  c.textAlign = "right";
  c.fillText(t("广州 · 珠江 · 实拍"), RIGHT, y + 23);
  c.textAlign = "left";
  return y + H;
}

/* --------------------------------------------------------- 模块 4：天色带 */
/** 只画渐变与事件刻度；橙条窗口交给模块 10，避免重复 */
function drawSky(e: Env, y: number): number {
  const { c, p, d } = e;
  const band = skyBandOf(d.r, Date.now(), d.r.dateStr);
  const BY = y + 10, BH = 40, BR = 9;
  if (band) {
    const totalM = band.segs.reduce((a, s) => a + s.m, 0) || 1;
    c.save();
    rr(c, PAD, BY, INNER, BH, BR); c.clip();
    let x = PAD;
    band.segs.forEach((s) => {
      const w = (s.m / totalM) * INNER;
      c.fillStyle = DUSK[s.cls] || "#ccc";
      c.fillRect(x, BY, Math.ceil(w) + 0.5, BH);
      x += w;
    });
    const gx = PAD + (band.glowX / 100) * INNER;
    const rg = c.createRadialGradient(gx, BY + BH, 0, gx, BY + BH, INNER * 0.46);
    rg.addColorStop(0, "rgba(255,166,87,0.30)");
    rg.addColorStop(0.68, "rgba(255,166,87,0)");
    c.fillStyle = rg; c.fillRect(PAD, BY, INNER, BH);
    c.restore();
    c.strokeStyle = p.LINE; c.lineWidth = 1;
    rr(c, PAD + 0.5, BY + 0.5, INNER - 1, BH - 1, BR); c.stroke();

    c.font = f(500, 12); c.fillStyle = p.T3;
    const evMk = band.marks[0], darkMk = band.marks[3];
    const tzs = d.r.tz && isForeignTz(d.r.tz) ? " " + tzLabel(d.r.tz) : "";
    const px = (v: number) => PAD + (v / 100) * INNER;
    c.textAlign = "left";
    c.fillText(fit(c, evMk.name + " " + evMk.time + tzs, 240),
      Math.min(px(evMk.p), RIGHT - 200), BY + BH + 18);
    c.textAlign = "right";
    c.fillText(fit(c, darkMk.name + " " + darkMk.time, 180),
      Math.max(px(darkMk.p), PAD + 200), BY + BH + 18);
    c.textAlign = "left";
  }
  return y + 78;
}

/* ------------------------------------------- 模块 2：城市·日期·概率结论 */
/** 改造前 780×400 的结论层原样平移：内部间距、字号、行序都不动 */
function drawVerdict(e: Env, y: number): number {
  const { c, p, d } = e;
  const r = d.r, view = d.view;
  const isAM = r.period === "am";
  const gc = gradeColor(view.grade, p.dark);
  const X = 252, maxW = COMPOSE_W - X - PAD;

  c.fillStyle = p.T1; c.font = f(700, 22, true);
  c.fillText(fit(c, cityName(r.city.name, getLang()), maxW), PAD, y + 10);

  c.font = f(500, 13); c.fillStyle = p.T2;
  let sub = r.dateStr + "　" + t(isAM ? "朝霞" : "晚霞");
  if (r.src === "cache") sub += "　·　" + t("缓存");
  c.fillText(sub, PAD, y + 29);
  let subX = PAD + c.measureText(sub + "　").width;
  if (view.single) {
    const tag = t(view.label);
    c.font = f(600, 12);
    const tw = c.measureText(tag).width + 16;
    rr(c, subX, y + 16, tw, 18, 9);
    c.fillStyle = withAlpha(p.ACC, 0.12); c.fill();
    c.strokeStyle = withAlpha(p.ACC, 0.4); c.lineWidth = 1; c.stroke();
    c.fillStyle = p.ACC; c.textAlign = "center";
    c.fillText(tag, subX + tw / 2, y + 29);
    c.textAlign = "left";
  }

  const LY = y + 84;
  c.fillStyle = p.T1; c.font = f(700, 46, true);
  c.fillText(Math.round(view.P) + "%", PAD, LY);
  c.fillStyle = p.T3; c.font = f(500, 12);
  c.fillText(t("出现概率"), PAD, LY + 20);

  const qNum = String(Math.round(view.Q));
  c.font = f(700, 34, true); c.fillStyle = gc;
  c.fillText(qNum, X, LY);
  const qw = c.measureText(qNum).width;
  c.font = f(600, 16); c.fillStyle = p.T1;
  c.fillText(t("分"), X + qw + 5, LY);
  const uw = c.measureText(t("分")).width;
  const pillTxt = t("观赏质量") + " " + t(view.grade);
  c.font = f(600, 13);
  const pw = c.measureText(pillTxt).width + 24;
  const px = X + qw + 5 + uw + 14;
  rr(c, px, LY - 20, pw, 26, 13);
  c.fillStyle = withAlpha(gc, p.dark ? 0.16 : 0.12); c.fill();
  c.strokeStyle = withAlpha(gc, 0.4); c.lineWidth = 1; c.stroke();
  c.fillStyle = gc; c.textAlign = "center";
  c.fillText(pillTxt, px + pw / 2, LY - 2);
  c.textAlign = "left";

  c.font = f(500, 18); c.fillStyle = p.T1;
  c.fillText(
    fit(c, t(conclWord(view.P)) + " · " + t("概率") + " " + Math.round(view.P) + "%", maxW),
    X, y + 120
  );

  const p2 = r.sRT.primary;
  const rows: string[] = [];
  rows.push(
    t("载霞云层 {v}", { v: t(p2.type) }) + " · " +
    t("覆盖 {v}", { v: Math.round(p2.cover) + "%" }) + " · " +
    t("云底高度") + " " + uAlt(p2.base * 1000)
  );
  rows.push(
    t("云边界距离") + " " + (isNum(r.sRT.d) ? uDist(r.sRT.d as number) : t("无明显边界")) +
    " · " + t("等效云底高度") + " " + uAlt(r.sRT.hEff * 1000) +
    " · AOD " + (isNum(r.sRT.aodUp) ? (r.sRT.aodUp as number).toFixed(2) : "—")
  );
  rows.push(
    t("可信度") + " " + t(r.conf.lv) + " · " + t(r.conf.txt) +
    (isNum(r.dvI) ? " · ΔI " + Math.round(r.dvI as number) : "")
  );
  const mname = (id: string) => (id === "gfs" ? "GFS " : id === "ec" ? "EC " : t("光追") + " ");
  rows.push(
    r.models.map((m) => mname(m.id) + Math.round(m.P) + "%").join(" · ")
  );

  c.font = f(500, 12.5);
  rows.forEach((s, k) => {
    c.fillStyle = k === 2 ? (p.dark ? r.conf.dark.color : r.conf.color) : p.T2;
    c.fillText(fit(c, s, maxW), X, y + 142 + k * 15);
  });

  c.font = f(500, 12); c.fillStyle = p.T3;
  c.fillText(fit(c, t("让每一次追霞，都有迹可循"), 190), PAD, y + 172);
  return y + 212; // 与改造前 780×400 的结论层同高（156→368）
}

/* -------------------------------------------------- 模块 10：观赏窗口 */
function drawWindow(e: Env, y: number): number {
  const { c, p, d } = e;
  const band = skyBandOf(d.r, Date.now(), d.r.dateStr);
  const win = band?.win ?? null;
  head(c, p, y + 16, "最佳观赏窗口", t("当日霞光时段"));

  if (!win) {
    c.font = f(500, 12); c.fillStyle = p.T3;
    c.fillText(t("该时段没有明确的霞光窗口（云量与光路不配合）"), PAD, y + 44);
    return y + 62;
  }
  const gw = glowWindowOf(d.r);
  const durMin = Math.max(1, Math.round((gw.endMs - gw.startMs) / 60000));
  c.font = f(700, 22, true); c.fillStyle = p.T1;
  c.fillText(uClock(gw.startMs, d.r.tz) + " – " + uClock(gw.endMs, d.r.tz), PAD, y + 48);
  c.font = f(500, 12); c.fillStyle = p.T2;
  c.textAlign = "right";
  c.fillText(t("约 {n} 分钟 · 光线穿过云底、颜色最浓", { n: durMin }), RIGHT, y + 47);
  c.textAlign = "left";

  const by = y + 60;
  c.fillStyle = withAlpha(p.T1, 0.08);
  rr(c, PAD, by, INNER, 6, 3); c.fill();
  c.fillStyle = p.ACC;
  rr(c, PAD + (win.left / 100) * INNER, by, Math.max(4, (win.width / 100) * INNER), 6, 3); c.fill();
  return y + 80;
}

/* ---------------------------------------------------------- 模块 5：趋势 */
/** 结论胶囊 + 双行热力格。
    上半：三枚「最值得出门」胶囊（①②③ 日期 星期 朝/晚 · 质量分 · 概率），
          直接回答「哪天去」——这是柱状图版最缺的一句话。
    下半：10 天 × 2 行格子。底色深浅＝概率，格内左＝概率、右＝质量分
          （按优/良/一般/差上色）；①②③ 徽标骑在上边中点；缺时段灰底虚框
          + 破折号（绝不静默用另一时段补）；当前时段的行标加竖条。 */
function drawTrend(e: Env, y: number): number {
  const { c, p, d } = e;
  const days = d.days.slice(0, 10);
  const LAB_W = 25, GAP = 5, CELL_H = 34, ROW_GAP = 12;
  const n = Math.max(1, days.length);
  const cellW = (INNER - LAB_W - GAP * (n - 1)) / n;
  const x0 = PAD + LAB_W;

  /* 排名跨两个时段统一算，取前三 */
  const all: Array<{ date: string; per: "am" | "pm"; P: number; Q: number }> = [];
  for (const dd of days) {
    if (dd.am) all.push({ date: dd.date, per: "am", P: dd.am.P, Q: dd.am.Q });
    if (dd.pm) all.push({ date: dd.date, per: "pm", P: dd.pm.P, Q: dd.pm.Q });
  }
  all.sort((a, b) => (b.Q - a.Q) || (b.P - a.P));
  const ranked = all.slice(0, 3);
  const rankOf = (date: string, per: "am" | "pm") =>
    ranked.findIndex((r2) => r2.date === date && r2.per === per) + 1;

  /* 标题右侧不再重复「最佳 …」——下面 ① 号胶囊就是同一件事 */
  head(c, p, y + 20, days.length >= 10 ? t("十日趋势") : t("{n} 日趋势", { n: days.length }));

  /* ---- 结论胶囊：先给答案，再给数据 ---- */
  if (ranked.length) {
    let px = PAD;
    const py = y + 34, ph = 22;
    c.font = f(500, 9.5); c.fillStyle = p.T3;
    const lab = t("最值得出门");
    c.fillText(lab, px, py + 15);
    px += c.measureText(lab).width + 9;
    const marks = ["①", "②", "③"];
    ranked.forEach((r2, i) => {
      const txt = marks[i] + " " + r2.date.slice(5) + " " + weekdayOf(r2.date) +
        t(r2.per === "am" ? "朝" : "晚") + " · " + Math.round(r2.Q) + " " + t("分") +
        " · " + Math.round(r2.P) + "%";
      c.font = f(500, 9.5);
      const w = c.measureText(txt).width + 16;
      rr(c, px, py, w, ph, 11);
      c.fillStyle = withAlpha(p.ACC, i === 0 ? 0.15 : 0.06); c.fill();
      c.strokeStyle = withAlpha(p.ACC, i === 0 ? 0.5 : 0.22); c.lineWidth = 1; c.stroke();
      c.fillStyle = i === 0 ? p.ACC : p.T2;
      c.fillText(txt, px + 8, py + 15);
      px += w + 6;
    });
  }

  /* ---- 双行热力格 ---- */
  const rowY = [y + 66, y + 66 + CELL_H + ROW_GAP];
  const pers: Array<"am" | "pm"> = ["am", "pm"];

  pers.forEach((per, ri) => {
    const cy = rowY[ri];
    const cur = d.r.period === per;

    if (cur) { c.fillStyle = p.ACC; rr(c, PAD, cy + CELL_H / 2 - 7, 3, 14, 1.5); c.fill(); }
    c.font = f(cur ? 600 : 500, 11);
    c.fillStyle = cur ? p.T1 : p.T3;
    c.fillText(t(per === "am" ? "朝" : "晚"), PAD + (cur ? 7 : 0), cy + CELL_H / 2 + 4);

    days.forEach((dd, i) => {
      const row = per === "am" ? dd.am : dd.pm;
      const x = x0 + i * (cellW + GAP);

      /* 缺时段：灰底 + 虚线框 + 破折号 */
      if (!row) {
        rr(c, x, cy, cellW, CELL_H, 6);
        c.fillStyle = withAlpha(p.T1, 0.035); c.fill();
        c.setLineDash([3, 3]);
        c.strokeStyle = withAlpha(p.T1, 0.16); c.lineWidth = 1; c.stroke();
        c.setLineDash([]);
        c.font = f(500, 11); c.fillStyle = p.T3; c.textAlign = "center";
        c.fillText("—", x + cellW / 2, cy + CELL_H / 2 + 4);
        c.textAlign = "left";
        return;
      }

      const ramp = TREND_RAMP;
      const tt = clamp(row.P, 0, 100) / 100;
      rr(c, x, cy, cellW, CELL_H, 6);
      c.fillStyle = p.dark
        ? mixHex("#1B2436", ramp[1], 0.28 + 0.54 * tt)
        : mixHex(ramp[0], ramp[1], tt * 0.78);
      c.fill();
      /* 发丝边框：低概率格在深色下几乎等于底色，没有边框会看不出「这里有一格」 */
      rr(c, x + 0.5, cy + 0.5, cellW - 1, CELL_H - 1, 5.5);
      c.strokeStyle = withAlpha(p.T1, p.dark ? 0.10 : 0.06); c.lineWidth = 1; c.stroke();

      /* 极值兜底：100% 与三位质量分并排会贴在一起，逐档降字号直到中间留出 6px */
      const pTxt = Math.round(row.P) + "%";
      const qTxt = String(Math.round(row.Q));
      let fp = 12, fq = 11;
      const pairW = (a2: number, b2: number) => {
        c.font = f(600, a2); const wa = c.measureText(pTxt).width;
        c.font = f(600, b2); const wb = c.measureText(qTxt).width;
        return wa + wb;
      };
      while (fp > 9 && pairW(fp, fq) + 12 + 6 > cellW) { fp -= 0.5; fq = Math.max(9, fq - 0.5); }
      c.font = f(600, fp); c.fillStyle = p.T1;
      c.fillText(pTxt, x + 6, cy + CELL_H / 2 + 4.4);
      c.font = f(600, fq); c.fillStyle = gradeColor(row.grade, p.dark);
      c.textAlign = "right";
      c.fillText(qTxt, x + cellW - 6, cy + CELL_H / 2 + 4);
      c.textAlign = "left";

      const rk = rankOf(dd.date, per);
      if (rk) {
        rr(c, x + 0.75, cy + 0.75, cellW - 1.5, CELL_H - 1.5, 5.5);
        c.strokeStyle = p.ACC; c.lineWidth = 1.5; c.stroke();
        c.beginPath();
        c.arc(x + cellW / 2, cy, 7.5, 0, Math.PI * 2);
        c.fillStyle = p.ACC; c.fill();
        c.font = f(600, 9.5); c.fillStyle = "#ffffff"; c.textAlign = "center";
        c.fillText(String(rk), x + cellW / 2, cy + 3.4);
        c.textAlign = "left";
      }
    });
  });

  /* 日期 + 星期 */
  const dy = rowY[1] + CELL_H + 16;
  days.forEach((dd, i) => {
    const cx = x0 + i * (cellW + GAP) + cellW / 2;
    c.textAlign = "center";
    c.font = f(500, 10.5); c.fillStyle = p.T2;
    c.fillText(dd.date.slice(5), cx, dy);
    c.font = f(500, 9.5); c.fillStyle = p.T3;
    c.fillText(weekdayOf(dd.date), cx, dy + 12);
    c.textAlign = "left";
  });

  /* 图例 */
  c.font = f(500, 9.5); c.fillStyle = p.T3;
  c.fillText([
    t("左＝出现概率"), t("右＝质量分"), t("①②③＝前三名"), t("—＝该时段无数据")
  ].join("　"), PAD, dy + 30);

  return dy + 42;
}

/* ------------------------------------------------------ 模块 6：观测场 */
function drawMap(e: Env, y: number): number {
  const { c, p, d } = e;
  const mp = d.map;
  head(c, p, y + 22, "观测场缩略",
    mp && mp.n ? t("{n} 格点 · 半径 500 km", { n: mp.n }) : "");

  const fx = PAD, fy = y + 38, fw = INNER, fh = 210;
  rr(c, fx, fy, fw, fh, 12);
  c.fillStyle = p.dark ? "rgba(255,255,255,0.028)" : "rgba(20,30,50,0.028)";
  c.fill();
  c.strokeStyle = p.LINE; c.lineWidth = 1; c.stroke();

  const mi = d.mapImg;
  if (mi && mi.width > 1) {
    c.save();
    rr(c, fx + 1, fy + 1, fw - 2, fh - 2, 11); c.clip();
    const ta = fw / fh, ia = mi.width / mi.height;
    let sw = mi.width, sh = mi.height, sx = 0, sy = 0;
    if (ia > ta) { sw = mi.height * ta; sx = (mi.width - sw) / 2; }
    else { sh = mi.width / ta; sy = (mi.height - sh) / 2; }
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
    c.drawImage(mi, sx, sy, sw, sh, fx + 1, fy + 1, fw - 2, fh - 2);
    c.restore();
  } else if (mp && mp.pts.length) {
    const cx = fx + fw / 2, cy = fy + fh / 2;
    const R = Math.min(fw, fh) / 2 - 10;
    c.save();
    rr(c, fx + 1, fy + 1, fw - 2, fh - 2, 11); c.clip();
    const blobR = Math.max(12, R / 6.25);
    for (const pt of mp.pts) {
      const x = cx + (pt.dxKm / 500) * R;
      const yy = cy - (pt.dyKm / 500) * R;
      const a = 0.18 + 0.44 * clamp(pt.v / 100, 0, 1);
      const g = c.createRadialGradient(x, yy, 0, x, yy, blobR);
      g.addColorStop(0, withAlpha(pt.color, a));
      g.addColorStop(1, withAlpha(pt.color, 0));
      c.fillStyle = g;
      c.fillRect(x - blobR, yy - blobR, blobR * 2, blobR * 2);
    }
    for (const pt of mp.pts) {
      const x = cx + (pt.dxKm / 500) * R;
      const yy = cy - (pt.dyKm / 500) * R;
      c.beginPath(); c.arc(x, yy, 2.6, 0, Math.PI * 2);
      c.fillStyle = withAlpha(p.T1, 0.16); c.fill();
      c.beginPath(); c.arc(x, yy, 1.2, 0, Math.PI * 2);
      c.fillStyle = p.dark ? "rgba(255,255,255,.82)" : "rgba(255,255,255,.92)"; c.fill();
    }
    c.beginPath(); c.arc(cx, cy, 6.5, 0, Math.PI * 2);
    c.fillStyle = p.dark ? "#0d1526" : "#fff"; c.fill();
    c.lineWidth = 2; c.strokeStyle = p.ACC; c.stroke();
    c.restore();
  }
  c.font = f(500, 10); c.fillStyle = p.T3;
  c.fillText(
    mi ? t("地图截屏 · 与屏上同一张图") : t("热力面 + 采样点 + 城市锚点 · 与地图同一份数据"),
    PAD, fy + fh + 18
  );
  return y + 300;
}

/* -------------------------------------------------- 模块 7：影响因素分组 */
const FAC_GROUPS: Record<string, string[]> = {
  facCloud: ["cover", "base", "block"],
  facPath: ["heq", "heff", "dedge"],
  facAir: ["aod", "vis", "rh"],
  facDyn: ["stab", "wind", "cape"]
};
function drawFactors(e: Env, y: number, id: ComposeModId): number {
  const { c, p, d } = e;
  const keys = FAC_GROUPS[id] || [];
  const map = new Map<string, [number | null, number | null]>();
  for (const row of d.r.factorRows) map.set(row[0], [row[1], row[2]]);
  head(c, p, y + 20, COMPOSE_MODULES.find((m) => m.id === id)?.name || "", t("{n} 项", { n: keys.length }));

  let ry = y + 44;
  for (const k of keys) {
    const [v, s] = map.get(k) || [null, null];
    c.font = f(500, 11.5); c.fillStyle = p.T2;
    c.fillText(fit(c, t(SNAP_FAC_NAME[k] || k), 150), PAD, ry);
    c.font = f(600, 11.5); c.fillStyle = p.T1;
    c.fillText(fit(c, snapFacFmt(k, v), 120), PAD + 152, ry);

    const bw = 132, bx = PAD + 300;
    c.fillStyle = withAlpha(p.T1, p.dark ? 0.09 : 0.06);
    rr(c, bx, ry - 8, bw, 6, 3); c.fill();
    const j = judgmentOf(s);
    const jc = j.cls === "j-ok" ? (p.dark ? "#5fce97" : "#178a52")
      : j.cls === "j-mid" ? tokColor("--q-mid", "#c07a10")
        : j.cls === "j-bad" ? tokColor("--q-bad", "#c2603a") : p.T3;
    c.fillStyle = jc;
    rr(c, bx, ry - 8, Math.max(2, bw * clamp(s ?? 0, 0, 1)), 6, 3); c.fill();

    c.font = f(600, 9.5); c.fillStyle = jc;
    c.textAlign = "right";
    c.fillText(t(j.key), RIGHT, ry);
    c.textAlign = "left";
    ry += 26;
  }
  return ry + 6;
}

/* ------------------------------------------------ 模块 8：光追推导四块 */
const RAY_KEYS = [
  "几何窗口", "亮度等级", "峰值透射率 T(550nm)", "峰值路径光学厚度 τ",
  "峰值颜色", "色相跨距（颜色丰富度）", "气溶胶标高 Hs",
  "近边界角（云遮挡）", "远边界角（地球遮挡）"
];
function drawRayRows(e: Env, y: number): number {
  const { c, p, d } = e;
  head(c, p, y + 20, "光追关键量", t("来自同一份取数，不额外请求"));
  const all = rayRows(d.r);
  const rows = RAY_KEYS.map((k) => all.find((r) => r.k === k)).filter(Boolean) as typeof all;
  const colW = (INNER - 24) / 2;
  rows.forEach((row, i) => {
    const cx = PAD + (i % 2) * (colW + 24);
    const cy = y + 44 + Math.floor(i / 2) * 24;
    c.font = f(500, 11); c.fillStyle = p.T3;
    c.fillText(fit(c, t(row.k), colW - 132), cx, cy);
    c.font = f(600, 11.5); c.fillStyle = p.T2; c.textAlign = "right";
    c.fillText(fit(c, row.v, 120), cx + colW, cy);
    c.textAlign = "left";
  });
  return y + 44 + Math.ceil(rows.length / 2) * 24 + 10;
}

function drawRaySwatch(e: Env, y: number): number {
  const { c, p, d } = e;
  const sm = d.r.sRT.samples || [];
  head(c, p, y + 20, "光谱色样", t("左＝刚被照亮，右＝掠地最红"));
  const n = Math.max(1, sm.length);
  const gap = 8, sw = (INNER - gap * (n - 1)) / n;
  sm.forEach((s, i) => {
    const x = PAD + i * (sw + gap);
    rr(c, x, y + 32, sw, 44, 7);
    c.fillStyle = s.hex; c.fill();
    c.font = f(500, 10); c.fillStyle = p.T3;
    c.fillText(fit(c, t(s.name), sw), x, y + 90);
  });
  return y + 102;
}

function drawRayTime(e: Env, y: number): number {
  const { c, p, d } = e;
  const tl = rayTimeline(d.r);
  head(c, p, y + 20, "照亮时间轴", t("本地云底被照亮的时段"));
  if (!tl.ok) {
    c.font = f(500, 10.5); c.fillStyle = tokColor("--q-mid", "#c07a10");
    c.fillText(fit(c, tl.warn, INNER), PAD, y + 44);
    return y + 66;
  }
  const bx = PAD, bw = INNER, by = y + 40;
  c.fillStyle = withAlpha(p.T1, p.dark ? 0.08 : 0.05);
  rr(c, bx, by, bw, 10, 5); c.fill();
  const l = tl.startFrac * bw, w = Math.max(4, (tl.endFrac - tl.startFrac) * bw);
  c.fillStyle = p.ACC;
  rr(c, bx + l, by, w, 10, 5); c.fill();
  c.font = f(500, 10); c.fillStyle = p.T3;
  c.fillText(t("开始") + " " + tl.start, bx, y + 72);
  c.textAlign = "right";
  c.fillText(t("结束") + " " + tl.end, bx + bw, y + 72);
  c.textAlign = "left";
  return y + 86;
}

function drawRayCurve(e: Env, y: number): number {
  const { c, p, d } = e;
  const cv = rayCurve(d.r);
  head(c, p, y + 20, "亮度·彩度曲线", cv ? t("峰值 +{v} 分钟", { v: cv.peakMin.toFixed(1) }) : "");
  if (!cv) {
    c.font = f(500, 11); c.fillStyle = p.T3;
    c.fillText(t("本次没有足够的采样点"), PAD, y + 44);
    return y + 66;
  }
  const cx = PAD, cy = y + 34, cw = INNER, ch = 96;
  c.strokeStyle = p.LINE; c.lineWidth = 1;
  [0, 0.25, 0.5, 0.75, 1].forEach((fq) => {
    const yy = cy + ch - fq * ch;
    c.beginPath(); c.moveTo(cx, yy); c.lineTo(cx + cw, yy); c.stroke();
  });
  const X = (min: number) => cx + (min / cv.maxMin) * cw;
  const Y = (v: number) => cy + ch - clamp(v, 0, 1) * ch;
  const poly = (get: (q: { lum: number; chroma: number }) => number, color: string) => {
    c.beginPath();
    cv.points.forEach((q, i) => {
      const x = X(q.min), yy = Y(get(q));
      if (i === 0) c.moveTo(x, yy); else c.lineTo(x, yy);
    });
    c.strokeStyle = color; c.lineWidth = 2; c.stroke();
  };
  poly((q) => q.lum, p.SP[1]);
  poly((q) => q.chroma, p.SP[2]);
  cv.points.forEach((q) => {
    c.fillStyle = q.hex;
    c.fillRect(X(q.min) - 1.5, cy + ch + 2, 3, 8);
  });
  c.font = f(500, 9.5); c.fillStyle = p.T3;
  c.fillText(cv.axis[0], cx, cy + ch + 24);
  c.textAlign = "right";
  c.fillText(cv.axis[2], cx + cw, cy + ch + 24);
  c.textAlign = "left";
  return y + 152;
}

/* -------------------------------------------------------- 模块 11：模型卡 */
function drawModels(e: Env, y: number): number {
  const { c, p, d } = e;
  head(c, p, y + 20, "各模型独立结果", t("同一份取数，四路独立评分"));
  const cards = modelCardsOf(d.r).slice(0, 4);
  const gap = 12, cw = (INNER - gap) / 2, ch = 118;
  cards.forEach((cd, i) => {
    drawModelCard(
      c, cd,
      PAD + (i % 2) * (cw + gap),
      y + 34 + Math.floor(i / 2) * (ch + gap),
      cw, ch,
      { dark: p.dark, T1: p.T1, T2: p.T2, T3: p.T3, LINE: p.LINE }
    );
  });
  return y + 34 + 2 * ch + gap;
}

/* ---------------------------------------------------------- 模块 9：二维码 */
function drawQr(e: Env, y: number): number {
  const { c, p, d } = e;
  const url = qrSafeUrl(d.url);
  const PL = 150, px = PAD, py = y + 14;
  c.fillStyle = "#ffffff";
  rr(c, px, py, PL, PL, 12); c.fill();
  try {
    const qr = qrcode(0, "L");
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    const pad = 12;
    const cell = Math.max(1, Math.floor((PL - pad * 2) / n));
    const qs = cell * n;
    const qx = px + (PL - qs) / 2, qy = py + (PL - qs) / 2;
    c.fillStyle = "#0b1020";
    for (let yy = 0; yy < n; yy++) {
      for (let xx = 0; xx < n; xx++) {
        if (qr.isDark(yy, xx)) c.fillRect(qx + xx * cell, qy + yy * cell, cell, cell);
      }
    }
  } catch { /* 生成失败就留白底板 */ }

  const tx = px + PL + 24;
  c.font = f(600, 13); c.fillStyle = p.T1;
  c.fillText(t("扫码查看完整结论"), tx, py + 26);
  c.font = f(500, 11); c.fillStyle = p.T2;
  c.fillText(t("快照链接：打开不重新取数，趋势、地图、因子明细都在里面"), tx, py + 48);
  c.font = f(500, 10); c.fillStyle = p.T3;
  let host = url;
  try { host = new URL(url).host + "/"; } catch { /* file:// 等 */ }
  c.fillText(t("链接") + " " + host, tx, py + 70);
  return y + 176;
}

/* ------------------------------------------------------------ 模块 3：页脚 */
function drawFooter(e: Env, y: number): number {
  const { c, p, d } = e;
  const FY = y + 8;
  c.strokeStyle = p.LINE; c.lineWidth = 1;
  c.beginPath(); c.moveTo(PAD, FY); c.lineTo(RIGHT, FY); c.stroke();
  c.font = f(500, 12); c.fillStyle = p.T3;
  c.fillText(
    fit(c, t("霞光档案 · 数据源 Open-Meteo（GFS / ECMWF-IFS / CAMS 气溶胶）· 结论仅供观赏参考"), COMPOSE_W - 250),
    PAD, FY + 20
  );
  c.textAlign = "right";
  c.fillText(
    d.r.leadH > 0 ? t("预报时效约 {n} 小时", { n: Math.round(d.r.leadH) }) : t("实况 / 历史分析场"),
    RIGHT, FY + 20
  );
  c.textAlign = "left";
  return FY + 32;
}

/* ---------------------------------------------------------------- 布局 */
interface Env { c: CanvasRenderingContext2D; p: Pal; d: ComposeInput }

const DRAW: Record<ComposeModId, (e: Env, y: number) => number> = {
  sky: drawSky,
  window: drawWindow,
  trend: drawTrend,
  map: drawMap,
  models: drawModels,
  facCloud: (e, y) => drawFactors(e, y, "facCloud"),
  facPath: (e, y) => drawFactors(e, y, "facPath"),
  facAir: (e, y) => drawFactors(e, y, "facAir"),
  facDyn: (e, y) => drawFactors(e, y, "facDyn"),
  rayRows: drawRayRows,
  raySwatch: drawRaySwatch,
  rayTime: drawRayTime,
  rayCurve: drawRayCurve,
  qr: drawQr
};

/** 按用户顺序整理出真正要画的模块（只保留已勾选且有数据的） */
export function composeRenderList(
  on: ComposeModId[], order: ComposeModId[], avail: ComposeAvail
): ComposeModId[] {
  const set = new Set(on.filter((id) => COMPOSE_IDS.includes(id) && avail[id]));
  const out = order.filter((id) => set.has(id));
  for (const id of set) if (!out.includes(id)) out.push(id);
  return out;
}

function paint(c: CanvasRenderingContext2D, d: ComposeInput, mods: ComposeModId[]): number {
  const p = palette();
  const e: Env = { c, p, d };
  c.fillStyle = p.BG; c.fillRect(0, 0, COMPOSE_W, MEASURE_H);
  const sg = c.createLinearGradient(0, 0, COMPOSE_W, 0);
  sg.addColorStop(0, p.SP[0]); sg.addColorStop(0.5, p.SP[1]); sg.addColorStop(1, p.SP[2]);
  c.fillStyle = sg; c.fillRect(0, 0, COMPOSE_W, 3);
  c.textBaseline = "alphabetic";
  c.textAlign = "left";

  let y = drawPhoto(e, 0);
  /* 锚定模块（天色带）固定在结论层上方：模块 2 的原版式就是
     「照片 → 天色带 → 标题」，把它拖到别处会让模块 2 顶着一块空白。 */
  const anchored = COMPOSE_MODULES.filter((m) => m.anchored).map((m) => m.id);
  for (const id of mods) if (anchored.includes(id)) y = DRAW[id](e, y);
  y = drawVerdict(e, y);
  for (const id of mods) {
    if (anchored.includes(id)) continue;
    y = DRAW[id](e, y);
  }
  return drawFooter(e, y);
}

/** 生成合成卡：两遍绘制（先量后定高），返回最终像素尺寸 */
export function drawComposeCard(
  cv: HTMLCanvasElement, d: ComposeInput, on: ComposeModId[], order: ComposeModId[]
): { w: number; h: number; mods: ComposeModId[] } {
  const avail = composeAvail(d);
  const mods = composeRenderList(on, order, avail);

  cv.width = COMPOSE_W * S;
  cv.height = MEASURE_H * S;
  let c = cv.getContext("2d");
  if (!c) throw new Error("canvas 2d unavailable");
  c.scale(S, S);
  const h = Math.ceil(paint(c, d, mods));

  cv.height = h * S;
  c = cv.getContext("2d");
  if (!c) throw new Error("canvas 2d unavailable");
  c.scale(S, S);
  paint(c, d, mods);
  return { w: cv.width, h: cv.height, mods };
}

/** 落地：与结论卡同一套 deliverBlob（手机系统分享 / 桌面下载） */
export async function saveComposeCard(
  d: ComposeInput, on: ComposeModId[], order: ComposeModId[]
): Promise<void> {
  const cv = document.createElement("canvas");
  drawComposeCard(cv, d, on, order);
  const blob = await new Promise<Blob>((resolve, reject) => {
    cv.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
  await deliverBlob(blob, shareFileName(d.r));
}

