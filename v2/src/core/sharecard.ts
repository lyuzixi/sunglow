/* =========================================================================
   SUNGLOW v2 · 分享卡（保存图片）
   纯 canvas 手绘，不引任何外部库 —— 单文件产物里不可能放 html2canvas。
   版式对齐V1 _p5b.shareCard()：等级色 / 天色带 / 概率大字 / 城市与日期 /
   质量分与等级胶囊 / 结论句 / 四行细节 / 页脚，780×400 画布，2 倍像素密度。

   与V1的三处差异（都是 v2 独有语义）：
   1) 主数字跟随结论卡的模型切换器；非综合时图上标出模型名，避免被当成综合结论
   2) 配色随主题：令牌从 documentElement 现读，深色主题导出深色卡
   3) 非 live 数据要标注：mock 打「演示数据」水印，cache 在日期旁标「缓存」

   所有文案与数值都来自 core 里的同一份口径（verdict / skyband / scoring），
   图与页面不会说出两个结论。
   ========================================================================= */
import type { ForecastResult } from "./forecast";
import type { VerdictView } from "./verdict";
import { conclWord } from "./verdict";
import { skyBandOf } from "./skyband";
import { t, getLang } from "./i18n";
import { cityName } from "./citylang";
import { uAlt, uDist } from "./units";
import { mixedIndex, QUALITY_BANDS } from "./scoring";
import { isNum } from "./math";
import type { TrendRow } from "./trend";
import { isForeignTz, tzLabel } from "./tz";
import {
  paintField, drawCityLabels, drawAziLayer,
  type FieldPt, type FieldCache, type CityLabel, type Proj, type Rect4
} from "./maprender";
import { glowColor, glowRgb, glowAlpha, GLOW_BANDS } from "./ramp";
import heroPhoto from "../assets/hero-photo.webp";

const W = 780, H = 400, S = 2;
/** 顶部实拍报头带高度（与首屏 M2 报头带同一套照片与署名） */
const BAND_H = 88;

/* 字体栈与 tokens.css 的 --font-display / --font-body 同源（canvas 读不到 CSS 变量，
   只能写同一串字面量；改栈时两处一起改）。构建把 woff2 内联进单文件，族名照可用。 */
const DISPLAY = '"Space Grotesk","PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif';
const BODY = '"Inter","PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif';
const f = (w: number, size: number, display = false) =>
  w + " " + size + "px " + (display ? DISPLAY : BODY);

export interface ShareMeta {
  w: number; h: number;
  theme: "dark" | "light";
  /** 主数字所属模型（"ens" 表示综合） */
  model: string;
  single: boolean;
  src: string;
  watermark: boolean;
  fileName: string;
  rows: string[];
  bg: string;
  grade: string;
  band: boolean;
}

/* ---------- 小工具 ---------- */
function tok(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
/** 令牌可能是 var() 引用（--acc-1 → var(--spectrum-1)），canvas 不认，退一层 */
function tokColor(name: string, fallback: string): string {
  const v = tok(name);
  if (!v) return fallback;
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  if (m) {
    const inner = tok(m[1]);
    return inner || fallback;
  }
  return v;
}
function withAlpha(color: string, a: number): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const n = parseInt(color.slice(1), 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(color);
  if (m) {
    const p = m[1].split(",").map((s) => s.trim());
    return "rgba(" + p[0] + "," + p[1] + "," + p[2] + "," + a + ")";
  }
  return color;
}
function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rd: number) {
  c.beginPath();
  c.moveTo(x + rd, y);
  c.arcTo(x + w, y, x + w, y + h, rd);
  c.arcTo(x + w, y + h, x, y + h, rd);
  c.arcTo(x, y + h, x, y, rd);
  c.arcTo(x, y, x + w, y, rd);
  c.closePath();
}
/** 超宽截断加省略号 —— 长城市名不会把排版顶出画布 */
function fit(c: CanvasRenderingContext2D, s: string, maxW: number): string {
  if (c.measureText(s).width <= maxW) return s;
  let i = s.length;
  while (i > 1 && c.measureText(s.slice(0, i) + "…").width > maxW) i--;
  return s.slice(0, i) + "…";
}
function gradeColor(grade: string, dark: boolean): string {
  const b = QUALITY_BANDS.find((x) => x.key === grade) || QUALITY_BANDS[QUALITY_BANDS.length - 1];
  return dark ? b.dark : b.color;
}
function safeName(s: string): string {
  return String(s).replace(/[\\/:*?"<>|]/g, "").trim() || t("点位");
}

/** 文件名：霞光档案_城市_日期_晚霞.png（与V1同构，随语言变） */
export function shareFileName(r: ForecastResult): string {
  return t("霞光档案") + "_" + safeName(cityName(r.city.name, getLang())) + "_" + r.dateStr + "_" +
    t(r.period === "am" ? "朝霞" : "晚霞") + ".png";
}

/* ---------- 绘制 ---------- */
/** 实拍报头图：产物里是 base64 data URL，加载一次缓存复用 */
let photoPromise: Promise<HTMLImageElement> | null = null;
function loadHeroPhoto(): Promise<HTMLImageElement> {
  if (!photoPromise) {
    photoPromise = new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("hero photo load failed"));
      im.src = heroPhoto;
    });
  }
  return photoPromise;
}

export function drawShareCard(
  cv: HTMLCanvasElement, r: ForecastResult, view: VerdictView, nowMs = Date.now(),
  photo?: HTMLImageElement | null
): ShareMeta {
  const dark = document.documentElement.dataset.theme === "dark";
  const theme: "dark" | "light" = dark ? "dark" : "light";

  cv.width = W * S; cv.height = H * S;
  const c = cv.getContext("2d");
  if (!c) throw new Error("canvas 2d unavailable");

  /* 令牌现读：深/浅色各自一套，不在这里复制色值 */
  const BG = tokColor("--bg-card-solid", dark ? "#101a2e" : "#ffffff");
  const TX1 = tokColor("--tx-1", dark ? "#e9eefb" : "#111a2c");
  const TX2 = tokColor("--tx-2", dark ? "#a0b1cd" : "#46556f");
  const TX3 = tokColor("--tx-3", dark ? "#5c6c8c" : "#8693ab");
  const LINE = tokColor("--stroke", dark ? "rgba(148,178,232,.14)" : "rgba(40,60,100,.10)");
  const ACC = tokColor("--acc-1", "#ff4d82");
  const SP = [
    tokColor("--spectrum-1", "#ff4d82"),
    tokColor("--spectrum-2", "#ff9c3f"),
    tokColor("--spectrum-3", "#2ed5e8")
  ];
  const DUSK: Record<string, string> = {
    "s-day": tokColor("--dusk-day", "#dde5ee"),
    "s-civil": tokColor("--dusk-civil", "#f0c48c"),
    "s-naut": tokColor("--dusk-nautical", "#d9784a"),
    "s-astro": tokColor("--dusk-astro", "#7a759f"),
    "s-night": tokColor("--dusk-night", "#2b3450")
  };

  c.scale(S, S);
  c.textBaseline = "alphabetic";
  c.textAlign = "left";

  /* 底 + 顶部光谱线（v2 的识别，替代V1 6px 等级色条） */
  c.fillStyle = BG; c.fillRect(0, 0, W, H);
  const sg = c.createLinearGradient(0, 0, W, 0);
  sg.addColorStop(0, SP[0]); sg.addColorStop(0.5, SP[1]); sg.addColorStop(1, SP[2]);
  c.fillStyle = sg; c.fillRect(0, 0, W, 3);

  /* 顶部实拍报头带：与首屏 M2 报头同一张照片、同一条署名；
     下沿渐隐到卡片底色，不做硬边（全幅模式下首屏也用同样的收口方式）。 */
  if (photo) {
    const ih = BAND_H - 3;
    const sc = Math.max(W / photo.width, ih / photo.height);
    const sw = W / sc, sh = ih / sc;
    c.drawImage(photo, (photo.width - sw) / 2, (photo.height - sh) * 0.5, sw, sh, 0, 3, W, ih);
  }
  const veil = c.createLinearGradient(0, 3, 0, BAND_H);
  veil.addColorStop(0, dark ? "rgba(7,11,20,.26)" : "rgba(242,245,251,.60)");
  veil.addColorStop(0.45, dark ? "rgba(7,11,20,.06)" : "rgba(242,245,251,.30)");
  veil.addColorStop(1, BG);
  c.fillStyle = veil; c.fillRect(0, 3, W, BAND_H - 3);
  /* 顶部局部压一层：品牌名与署名压在这条带上，需要一块稳定的底，才不会被天空亮度影响 */
  const scrim = c.createLinearGradient(0, 3, 0, 46);
  scrim.addColorStop(0, dark ? "rgba(7,11,20,.52)" : "rgba(255,255,255,.80)");
  scrim.addColorStop(1, "rgba(" + (dark ? "7,11,20" : "255,255,255") + ",0)");
  c.fillStyle = scrim; c.fillRect(0, 3, W, 43);
  c.font = f(600, 11);
  c.fillStyle = dark ? "rgba(233,238,251,.85)" : "rgba(17,26,44,.85)";
  c.fillText(t("霞光档案") + " · SUNGLOW", 44, 26);
  c.font = f(500, 11);
  c.fillStyle = tokColor("--photo-credit", dark ? "rgba(233,238,251,.62)" : "rgba(17,26,44,.56)");
  c.textAlign = "right";
  c.fillText(t("广州 · 珠江 · 实拍"), W - 44, 26);
  c.textAlign = "left";

  const gc = gradeColor(view.grade, dark);
  const isAM = r.period === "am";
  const band = skyBandOf(r, nowMs, r.dateStr);

  /* 天色带：与页面同一份 skyBandOf 结果。
     做成内嵌圆角带（而不是满宽）：满宽时最亮的白昼段与最暗的夜间段会跟卡片底色糊在一起，
     整条带看起来像「浮在中间」—— 加一层底衬 + 圆角边界，五段始终读得出。 */
  const BX = 44, BW = W - 88, BY = BAND_H + 10, BH = 40, BR = 9;
  if (band) {
    const totalM = band.segs.reduce((a, s) => a + s.m, 0) || 1;
    c.save();
    rr(c, BX, BY, BW, BH, BR);
    c.clip();
    c.fillStyle = withAlpha(TX1, dark ? 0.05 : 0.04);
    c.fillRect(BX, BY, BW, BH);
    let x = BX;
    band.segs.forEach((s) => {
      const w = (s.m / totalM) * BW;
      c.fillStyle = DUSK[s.cls] || "#ccc";
      c.fillRect(x, BY, Math.ceil(w) + 0.5, BH);
      x += w;
    });
    /* 霞光位置柔光（页面用 CSS radial-gradient，这里用画布渐变近似同一效果） */
    const gx = BX + (band.glowX / 100) * BW;
    const rg = c.createRadialGradient(gx, BY + BH, 0, gx, BY + BH, BW * 0.46);
    rg.addColorStop(0, "rgba(255,166,87,0.30)");
    rg.addColorStop(0.68, "rgba(255,166,87,0)");
    c.fillStyle = rg; c.fillRect(BX, BY, BW, BH);

    /* 霞光窗口：橙条 + 白上沿 */
    if (band.win) {
      const wx = BX + (band.win.left / 100) * BW;
      const ww = Math.max(3, (band.win.width / 100) * BW);
      c.fillStyle = ACC;
      c.fillRect(wx, BY + BH - 4, ww, 4);
      c.fillStyle = dark ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.85)";
      c.fillRect(wx, BY + BH - 4, ww, 1);
    }
    c.restore();
    c.strokeStyle = LINE; c.lineWidth = 1;
    rr(c, BX + 0.5, BY + 0.5, BW - 1, BH - 1, BR);
    c.stroke();

    /* 轴：日落/日出（左）与天黑（右），落在带上的真实位置，不贴卡片边 */
    c.font = f(500, 12); c.fillStyle = TX3;
    const evMk = band.marks[0], darkMk = band.marks[3];
    const tzs = r.tz && isForeignTz(r.tz) ? " " + tzLabel(r.tz) : "";
    const px = (p: number) => BX + (p / 100) * BW;
    c.textAlign = "left";
    c.fillText(
      fit(c, evMk.name + " " + evMk.time + tzs, 240),
      Math.min(px(evMk.p), BX + BW - 200), BY + BH + 18
    );
    c.textAlign = "right";
    c.fillText(
      fit(c, darkMk.name + " " + darkMk.time, 180),
      Math.max(px(darkMk.p), BX + 200), BY + BH + 18
    );
    c.textAlign = "left";
  }

  /* 左栏：概率大字 */
  const LY = 252;
  c.fillStyle = TX1; c.font = f(700, 46, true);
  c.fillText(Math.round(view.P) + "%", 44, LY);
  c.fillStyle = TX3; c.font = f(500, 12);
  c.fillText(t("出现概率"), 44, LY + 20);

  /* 右栏：城市 / 日期 / 质量 / 结论 / 细节 */
  const X = 252, maxW = W - X - 44;
  c.fillStyle = TX1; c.font = f(700, 22, true);
  c.fillText(fit(c, cityName(r.city.name, getLang()), maxW), 44, 178);

  /* 副标题：日期 + 朝/晚霞 + 非 live 标注 + 单模型标注 */
  c.font = f(500, 13); c.fillStyle = TX2;
  let sub = r.dateStr + "　" + t(isAM ? "朝霞" : "晚霞");
  if (r.src === "cache") sub += "　·　" + t("缓存");
  let subX = 44;
  c.fillText(sub, subX, 197);
  subX += c.measureText(sub + "　").width;
  if (view.single) {
    const tag = t(view.label);
    c.font = f(600, 12);
    const tw = c.measureText(tag).width + 16;
    rr(c, subX, 184, tw, 18, 9);
    c.fillStyle = withAlpha(ACC, 0.12); c.fill();
    c.strokeStyle = withAlpha(ACC, 0.4); c.lineWidth = 1; c.stroke();
    c.fillStyle = ACC; c.textAlign = "center";
    c.fillText(tag, subX + tw / 2, 197);
    c.textAlign = "left";
  }

  /* 质量分 + 等级胶囊 */
  const qNum = String(Math.round(view.Q));
  c.font = f(700, 34, true); c.fillStyle = gc;
  c.fillText(qNum, X, LY);
  const qw = c.measureText(qNum).width;
  c.font = f(600, 16); c.fillStyle = TX1;
  c.fillText(t("分"), X + qw + 5, LY);
  const uw = c.measureText(t("分")).width;
  const pillTxt = t("观赏质量") + " " + t(view.grade);
  c.font = f(600, 13);
  const pw = c.measureText(pillTxt).width + 24;
  const px = X + qw + 5 + uw + 14;
  rr(c, px, LY - 20, pw, 26, 13);
  c.fillStyle = withAlpha(gc, dark ? 0.16 : 0.12); c.fill();
  c.strokeStyle = withAlpha(gc, 0.4); c.lineWidth = 1; c.stroke();
  c.fillStyle = gc; c.textAlign = "center";
  c.fillText(pillTxt, px + pw / 2, LY - 2);
  c.textAlign = "left";

  /* 结论句：与页面标题里那句同源 */
  c.font = f(500, 18); c.fillStyle = TX1;
  c.fillText(
    fit(c, t(conclWord(view.P)) + " · " + t("概率") + " " + Math.round(view.P) + "%", maxW),
    X, 288
  );

  /* 四行细节（口径同V1分享卡） */
  const p2 = r.sRT.primary;
  const cfb = r.conf;
  const rowList: string[] = [];
  rowList.push(
    t("载霞云层 {v}", { v: t(p2.type) }) + " · " +
    t("覆盖 {v}", { v: Math.round(p2.cover) + "%" }) + " · " +
    t("云底高度") + " " + uAlt(p2.base * 1000)
  );
  rowList.push(
    t("云边界距离") + " " + (isNum(r.sRT.d) ? uDist(r.sRT.d as number) : t("无明显边界")) +
    " · " + t("等效云底高度") + " " + uAlt(r.sRT.hEff * 1000) +
    " · AOD " + (isNum(r.sRT.aodUp) ? (r.sRT.aodUp as number).toFixed(2) : "—")
  );
  rowList.push(
    t("可信度") + " " + t(cfb.lv) + " · " + t(cfb.txt) +
    (isNum(r.dvI) ? " · ΔI " + Math.round(r.dvI as number) : "")
  );
  const mname = (id: string) => (id === "gfs" ? "GFS " : id === "ec" ? "EC " : t("光追") + " ");
  rowList.push(
    r.models.map((m) => mname(m.id) + Math.round(m.P) + "%").join(" · ") +
    " · " + t("综合 I {v}", { v: Math.round(mixedIndex(r.P, r.Q)) })
  );

  c.font = f(500, 12.5);
  rowList.forEach((s, k) => {
    c.fillStyle = k === 2 ? (dark ? cfb.dark.color : cfb.color) : TX2;
    c.fillText(fit(c, s, maxW), X, 310 + k * 15);
  });

  /* 左栏底部：品牌 slogan。照片报头占了竖向空间后，概率下方留出这块空档，
     用它压住，比空着更像一张排过版的卡（右栏四行细节不受影响）。 */
  c.font = f(500, 12); c.fillStyle = TX3;
  c.fillText(fit(c, t("让每一次追霞，都有迹可循"), 190), 44, 340);

  /* 页脚 */
  c.strokeStyle = LINE; c.lineWidth = 1;
  c.beginPath(); c.moveTo(44, 368); c.lineTo(W - 44, 368); c.stroke();
  c.font = f(500, 12); c.fillStyle = TX3;
  c.fillText(
    fit(c, t("霞光档案 · 数据源 Open-Meteo（GFS / ECMWF-IFS / CAMS 气溶胶）· 结论仅供观赏参考"), W - 250),
    44, 388
  );
  c.textAlign = "right";
  c.fillText(
    r.leadH > 0 ? t("预报时效约 {n} 小时", { n: Math.round(r.leadH) }) : t("实况 / 历史分析场"),
    W - 44, 388
  );
  c.textAlign = "left";

  /* mock 数据必须看得出来是演示 —— 用角标，不用斜向大字水印：
     实测 74px 斜字会把质量分与结论句糊掉，转发出去反而更难读。 */
  if (r.src === "mock") {
    const badge = t("演示数据");
    c.font = f(600, 12);
    const bw = c.measureText(badge).width + 22;
    const bx = 44, by = 292, bh = 26;
    rr(c, bx, by, bw, bh, 13);
    c.fillStyle = withAlpha("#e2b45e", dark ? 0.18 : 0.16); c.fill();
    c.strokeStyle = withAlpha("#e2b45e", 0.55); c.lineWidth = 1; c.stroke();
    c.fillStyle = dark ? "#e2b45e" : "#8a5a00";
    c.textAlign = "center";
    c.fillText(badge, bx + bw / 2, by + 17);
    c.textAlign = "left";
  }

  return {
    w: cv.width, h: cv.height, theme,
    model: view.single ? view.label : "ens",
    single: view.single,
    src: r.src,
    watermark: r.src === "mock",
    fileName: shareFileName(r),
    rows: rowList,
    bg: BG,
    grade: view.grade,
    band: !!band
  };
}

/* ---------- 落地：系统分享（手机）或下载（桌面） ---------- */
function canvasToBlob(cv: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    cv.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
}

/** 字体就绪再画：否则第一帧可能用回退字体把中文/数字画歪 */
async function ensureFonts(): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  try {
    await Promise.all([
      fonts.load(f(700, 46, true)),
      fonts.load(f(500, 13.5, false))
    ]);
    await fonts.ready;
  } catch { /* 字体加载失败就退回系统字体，不影响出图 */ }
}

function isMobileLike(): boolean {
  if (typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches) return true;
  return typeof innerWidth === "number" && innerWidth <= 860;
}

export type ShareOutcome = "shared" | "downloaded" | "cancelled";

/** 落地：手机优先唤起系统分享面板（可直接发微信/存相册），
    桌面、以及不支持带文件分享的浏览器，回退到下载。 */
async function deliverBlob(blob: Blob, fileName: string): Promise<ShareOutcome> {
  const nav = navigator as Navigator & {
    canShare?: (d?: ShareData) => boolean;
    share?: (d?: ShareData) => Promise<void>;
  };
  const canTryShare =
    isMobileLike() && typeof File !== "undefined" && !!nav.share && !!nav.canShare;
  if (canTryShare) {
    const file = new File([blob], fileName, { type: "image/png" });
    if (nav.canShare!({ files: [file] })) {
      try {
        await nav.share!({ files: [file], title: t("霞光档案"), text: fileName });
        return "shared";
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return "cancelled";
        /* 其它错误（权限/被策略拦）继续走下载 */
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return "downloaded";
}

export async function saveShareCard(
  r: ForecastResult, view: VerdictView
): Promise<ShareOutcome> {
  await ensureFonts();
  /* 报头照片是 data URL，解码很快；失败也不阻塞出图，只是没有照片带 */
  const photo = await loadHeroPhoto().catch(() => null);

  const cv = document.createElement("canvas");
  const meta = drawShareCard(cv, r, view, Date.now(), photo);
  /* 供探针读取：canvas 不进 DOM，只能把元信息挂在自身上 */
  cv.dataset.shareMeta = JSON.stringify(meta);

  const blob = await canvasToBlob(cv);
  return deliverBlob(blob, meta.fileName);
}

/* =========================================================================
   十日趋势分享卡（横版 780×600）
   顶部 150 章首抬头：实拍照片铺底、大标题压在上面（与教程页 T1、结论卡
   报头带同一套语言）；两列并排、每列 5 天；每天 朝 / 晚 各一行，只留数字
   （概率 / 质量），不画概率条、不带等级 —— 转发到聊天里不会被拉成一条竖长图。
   数字直接取趋势表的同一份 rows，图与页面不会说出两套数。
   ========================================================================= */
const TW = 780, TH = 600, T_BAND = 150;

export interface TrendDay {
  date: string;
  am?: TrendRow;
  pm?: TrendRow;
}

export interface TrendCardMeta {
  w: number; h: number;
  theme: "dark" | "light";
  src: string;
  days: number;
  rows: number;
  fileName: string;
}

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function weekdayOf(date: string): string {
  const [Y, M, D] = date.split("-").map(Number);
  return t(WEEK[new Date(Date.UTC(Y, M - 1, D)).getUTCDay()]);
}

/** 文件名：霞光档案_城市_起始日期_十日趋势.png */
export function trendShareFileName(city: string, firstDate: string): string {
  return t("霞光档案") + "_" + safeName(city) + "_" + firstDate + "_" + t("十日趋势") + ".png";
}

export function drawTrendCard(
  cv: HTMLCanvasElement, daysIn: TrendDay[], opts: { city: string; src: "cache" | "live" | "" },
  photo?: HTMLImageElement | null
): TrendCardMeta {
  const dark = document.documentElement.dataset.theme === "dark";
  const theme: "dark" | "light" = dark ? "dark" : "light";

  cv.width = TW * S; cv.height = TH * S;
  const c = cv.getContext("2d");
  if (!c) throw new Error("canvas 2d unavailable");
  /* 嵌套的 line() 里也要拿到非空上下文：TS 不会把外层 narrowing 带进闭包 */
  const ctx = c;

  const BG = tokColor("--bg-card-solid", dark ? "#101a2e" : "#ffffff");
  const TX1 = tokColor("--tx-1", dark ? "#e9eefb" : "#111a2c");
  const TX2 = tokColor("--tx-2", dark ? "#a0b1cd" : "#46556f");
  const TX3 = tokColor("--tx-3", dark ? "#5c6c8c" : "#8693ab");
  const LINE = tokColor("--stroke", dark ? "rgba(148,178,232,.14)" : "rgba(40,60,100,.10)");
  const SP = [
    tokColor("--spectrum-1", "#ff4d82"),
    tokColor("--spectrum-2", "#ff9c3f"),
    tokColor("--spectrum-3", "#2ed5e8")
  ];

  c.scale(S, S);
  c.textBaseline = "alphabetic";
  c.textAlign = "left";
  c.fillStyle = BG; c.fillRect(0, 0, TW, TH);

  /* 顶部光谱线：与页面、结论卡同一条识别 */
  const sg = c.createLinearGradient(0, 0, TW, 0);
  sg.addColorStop(0, SP[0]); sg.addColorStop(0.5, SP[1]); sg.addColorStop(1, SP[2]);
  c.fillStyle = sg; c.fillRect(0, 0, TW, 3);

  const days = daysIn.slice(0, 10);
  const first = days[0]?.date ?? "";
  const last = days[days.length - 1]?.date ?? "";
  const range = first ? first + " → " + last.slice(5) : "";
  const count = days.reduce((n, d) => n + (d.am ? 1 : 0) + (d.pm ? 1 : 0), 0);
  const srcTxt =
    opts.src === "cache" ? t("缓存数据") : opts.src === "live" ? t("实时数据") : "";

  /* 章首抬头：实拍照片铺底，下沿渐隐到卡片底色（不做硬边）；
     大标题压在下半段，靠渐隐层本身给足对比 */
  if (photo) {
    const ih = T_BAND - 3;
    const sc = Math.max(TW / photo.width, ih / photo.height);
    const sw = TW / sc, sh = ih / sc;
    c.drawImage(photo, (photo.width - sw) / 2, (photo.height - sh) * 0.58, sw, sh,
      0, 3, TW, ih);
  }
  const veil = c.createLinearGradient(0, 3, 0, T_BAND);
  veil.addColorStop(0, dark ? "rgba(7,11,20,.30)" : "rgba(242,245,251,.55)");
  veil.addColorStop(0.4, dark ? "rgba(7,11,20,.06)" : "rgba(242,245,251,.18)");
  veil.addColorStop(0.74, dark ? "rgba(7,11,20,.45)" : "rgba(242,245,251,.45)");
  veil.addColorStop(1, BG);
  c.fillStyle = veil; c.fillRect(0, 3, TW, T_BAND - 3);
  /* 顶部压一层：品牌名与署名压在这条带上，需要一块稳定的底 */
  const scrim = c.createLinearGradient(0, 3, 0, 47);
  scrim.addColorStop(0, dark ? "rgba(7,11,20,.52)" : "rgba(255,255,255,.80)");
  scrim.addColorStop(1, "rgba(" + (dark ? "7,11,20" : "255,255,255") + ",0)");
  c.fillStyle = scrim; c.fillRect(0, 3, TW, 44);

  /* 报头：品牌 / 署名（压在照片带的顶部） */
  c.font = f(600, 11); c.fillStyle = dark ? "rgba(233,238,251,.85)" : "rgba(17,26,44,.85)";
  c.fillText(t("霞光档案") + " · SUNGLOW", 44, 26);
  c.textAlign = "right"; c.font = f(500, 11);
  c.fillStyle = tokColor("--photo-credit", dark ? "rgba(233,238,251,.62)" : "rgba(17,26,44,.56)");
  c.fillText(t("广州 · 珠江 · 实拍"), TW - 44, 26);
  c.textAlign = "left";

  c.font = f(700, 30, true); c.fillStyle = TX1;
  c.fillText(t("十日趋势"), 44, 124);

  c.font = f(500, 11.5); c.fillStyle = TX3;
  c.fillText(t("朝") + " / " + t("晚") + "　" + count + " " + t("条实算结果"), 44, 178);

  c.textAlign = "right"; c.font = f(500, 11.5); c.fillStyle = TX2;
  c.fillText(
    fit(c, opts.city + "　" + range + (srcTxt ? "　·　" + srcTxt : ""), 470),
    TW - 44, 178
  );
  c.textAlign = "left";

  c.strokeStyle = LINE; c.lineWidth = 1;
  c.beginPath(); c.moveTo(44, 196); c.lineTo(TW - 44, 196); c.stroke();

  /* 体：两列 × 5 天，中间一条竖线 */
  const COLX = [44, 404], COLW = 334, ROWH = 60, Y0 = 248, HDRY = 220;
  c.strokeStyle = LINE;
  c.beginPath(); c.moveTo(390, 208); c.lineTo(390, 516); c.stroke();

  c.font = f(500, 10.5); c.fillStyle = TX3;
  COLX.forEach((x) => {
    c.textAlign = "left";
    c.fillText(t("日期"), x, HDRY);
    c.fillText(t("时段"), x + 96, HDRY);
    c.textAlign = "right";
    c.fillText(t("概率"), x + 264, HDRY);
    c.fillText(t("质量"), x + COLW, HDRY);
  });
  c.textAlign = "left";

  /* 朝/晚一行：概率右对齐到 x+264，质量右对齐到列尾 */
  function line(row: TrendRow | undefined, label: string, x: number, y: number) {
    ctx.font = f(500, 11); ctx.fillStyle = TX3;
    ctx.textAlign = "left";
    ctx.fillText(label, x + 96, y);
    ctx.textAlign = "right";
    if (row) {
      ctx.font = f(700, 18, true); ctx.fillStyle = TX1;
      ctx.fillText(Math.round(row.P) + "%", x + 264, y);
      ctx.font = f(500, 15); ctx.fillStyle = TX2;
      ctx.fillText(Math.round(row.Q) + "", x + COLW, y);
    } else {
      ctx.font = f(500, 15); ctx.fillStyle = TX3;
      ctx.fillText("—", x + 264, y);
      ctx.fillText("—", x + COLW, y);
    }
    ctx.textAlign = "left";
  }

  days.forEach((d, idx) => {
    const col = idx < 5 ? 0 : 1;
    const i = idx % 5;
    const x = COLX[col];
    const base = Y0 + i * ROWH;

    /* 隔行底衬：5 天两列，长图里靠它把行读出来 */
    if (i % 2 === 1) {
      c.fillStyle = withAlpha(TX1, dark ? 0.035 : 0.028);
      rr(c, x - 8, base - 21, COLW + 8, 50, 7);
      c.fill();
    }

    c.font = f(700, 15, true); c.fillStyle = TX1;
    c.fillText(d.date.slice(5), x, base);
    const dw = c.measureText(d.date.slice(5)).width;
    c.font = f(500, 11); c.fillStyle = TX3;
    c.fillText(weekdayOf(d.date), x + dw + 7, base);

    line(d.am, t("朝"), x, base);
    line(d.pm, t("晚"), x, base + 20);
  });

  /* 页脚：口径 + 数据源 */
  c.strokeStyle = LINE;
  c.beginPath(); c.moveTo(44, 530); c.lineTo(TW - 44, 530); c.stroke();
  c.font = f(500, 11); c.fillStyle = TX3;
  c.fillText(
    fit(c, "P " + t("出现概率") + "　　Q " + t("观赏质量") + "　　·　　" + t("数据源") + " Open-Meteo", 540),
    44, 556
  );
  c.textAlign = "right"; c.font = f(600, 11); c.fillStyle = TX3;
  c.fillText("SUNGLOW V2", TW - 44, 556);
  c.textAlign = "left";

  return {
    w: cv.width, h: cv.height, theme,
    src: opts.src || "live",
    days: days.length,
    rows: count,
    fileName: trendShareFileName(opts.city, first)
  };
}

export async function saveTrendCard(
  days: TrendDay[], opts: { city: string; src: "cache" | "live" | "" }
): Promise<ShareOutcome> {
  await ensureFonts();
  /* 照片加载失败不阻断导出：退回无照片版，只少一条抬头 */
  let photo: HTMLImageElement | null = null;
  try { photo = await loadHeroPhoto(); } catch { photo = null; }
  const cv = document.createElement("canvas");
  const meta = drawTrendCard(cv, days, opts, photo);
  cv.dataset.shareMeta = JSON.stringify(meta);
  const blob = await canvasToBlob(cv);
  return deliverBlob(blob, meta.fileName);
}

/* =========================================================================
   观测场分享卡（横版 780×660）
   -------------------------------------------------------------------------
   观测场是「腾讯 GL 底图 + 自绘覆盖层」。分享图优先直接截屏上的合成图
   （MapView 在 GL 开启 preserveDrawingBuffer 后取像素，底图与覆盖层一起），
   这样底图、地名、色面都跟用户看到的一模一样；截不到时（跨域污染、
   缓冲没保留、SDK 没起来）再回退到用同一份 core/maprender 口径重画 ——
   色面 / 等值线 / 方位线 / 距离环 / 地名按同一份采样点与同一套投影画出，
   只是没有底图，地理参照由经纬网 + 城市名 + 距离环给出。
   ========================================================================= */
const MW = 780, MH = 660, M_BAND = 88;
/* 图面区（CSS px） */
const MX = 44, MY = 156, MWB = 692, MHB = 400;
const LAT2KM = 110.574;

export interface MapCardLabel {
  text: string;
  lat: number;
  lon: number;
  tier: 0 | 1 | 2;
}

export interface MapCardOpts {
  /** 已按当前语言翻好的城市名 */
  city: string;
  date: string;
  period: "am" | "pm";
  /** 已翻好的维度名 / 模型名 */
  dimLabel: string;
  modelLabel: string;
  src: "cache" | "live" | "";
  /** 与屏上同一份采样点（v = 当前维度的值） */
  pts: FieldPt[];
  labels: MapCardLabel[];
  center: { lat: number; lon: number };
  /** 图面纵向跨度（km），与屏上 visibleSpanKm() 同源 */
  spanKm: number;
  az: number | null;
  /** 方位文案（已翻好），无方位时为空串 */
  azHead: string;
  showOcclusion: boolean;
  showContours: boolean;
  showPts: boolean;
  /** 屏上「底图 + 覆盖层」的合成截图；拿不到（跨域污染 / 空图）时传 null，走重画 */
  base?: HTMLCanvasElement | null;
  /** 屏上那份色面缓存：栅格在地理空间里固定，直接复用即可，不重复插值 */
  cache: FieldCache;
}

export interface MapCardMeta {
  w: number; h: number;
  theme: "dark" | "light";
  src: string;
  pts: number;
  labels: number;
  spanKm: number;
  fileName: string;
  /** capture = 用了屏上真地图截图；redraw = 回退到自绘色面 */
  base: "capture" | "redraw";
}

/** 文件名：霞光档案_城市_日期_晚霞_观测场.png */
export function mapShareFileName(city: string, date: string, period: "am" | "pm"): string {
  return t("霞光档案") + "_" + safeName(city) + "_" + date + "_" +
    t(period === "am" ? "朝霞" : "晚霞") + "_" + t("观测场") + ".png";
}

/** 球面落点：从中心沿方位角走 km 公里（与屏上方位层同一几何） */
function dest(
  center: { lat: number; lon: number }, az: number, km: number
): { lat: number; lon: number } {
  const rad = (az * Math.PI) / 180;
  return {
    lat: center.lat + (km * Math.cos(rad)) / LAT2KM,
    lon: center.lon + (km * Math.sin(rad)) / (LAT2KM * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)))
  };
}

export function drawMapCard(
  cv: HTMLCanvasElement, o: MapCardOpts, photo?: HTMLImageElement | null
): MapCardMeta {
  const dark = document.documentElement.dataset.theme === "dark";
  const theme: "dark" | "light" = dark ? "dark" : "light";

  cv.width = MW * S; cv.height = MH * S;
  const c = cv.getContext("2d");
  if (!c) throw new Error("canvas 2d unavailable");

  const BG = tokColor("--bg-card-solid", dark ? "#101a2e" : "#ffffff");
  const TX1 = tokColor("--tx-1", dark ? "#e9eefb" : "#111a2c");
  const TX2 = tokColor("--tx-2", dark ? "#a0b1cd" : "#46556f");
  const TX3 = tokColor("--tx-3", dark ? "#5c6c8c" : "#8693ab");
  const LINE = tokColor("--stroke", dark ? "rgba(148,178,232,.14)" : "rgba(40,60,100,.10)");
  const ACC = tokColor("--acc-1", "#ff4d82");
  const SP = [
    tokColor("--spectrum-1", "#ff4d82"),
    tokColor("--spectrum-2", "#ff9c3f"),
    tokColor("--spectrum-3", "#2ed5e8")
  ];
  /* 图面底衬：没有底图，色面直接压在卡片上会糊掉边界，先给一层稳定的场底 */
  const PLATE = dark ? ["#0b1424", "#080d19"] : ["#f3f7fd", "#e8eef8"];

  c.scale(S, S);
  c.textBaseline = "alphabetic";
  c.textAlign = "left";

  c.fillStyle = BG; c.fillRect(0, 0, MW, MH);
  const sg = c.createLinearGradient(0, 0, MW, 0);
  sg.addColorStop(0, SP[0]); sg.addColorStop(0.5, SP[1]); sg.addColorStop(1, SP[2]);
  c.fillStyle = sg; c.fillRect(0, 0, MW, 3);

  /* 顶部实拍报头带：与结论卡 / 十日趋势卡同一张照片、同一条署名 */
  if (photo) {
    const ih = M_BAND - 3;
    const sc = Math.max(MW / photo.width, ih / photo.height);
    const sw = MW / sc, sh = ih / sc;
    c.drawImage(photo, (photo.width - sw) / 2, (photo.height - sh) * 0.5, sw, sh, 0, 3, MW, ih);
  }
  const veil = c.createLinearGradient(0, 3, 0, M_BAND);
  veil.addColorStop(0, dark ? "rgba(7,11,20,.26)" : "rgba(242,245,251,.60)");
  veil.addColorStop(0.45, dark ? "rgba(7,11,20,.06)" : "rgba(242,245,251,.30)");
  veil.addColorStop(1, BG);
  c.fillStyle = veil; c.fillRect(0, 3, MW, M_BAND - 3);
  const scrim = c.createLinearGradient(0, 3, 0, 46);
  scrim.addColorStop(0, dark ? "rgba(7,11,20,.52)" : "rgba(255,255,255,.80)");
  scrim.addColorStop(1, "rgba(" + (dark ? "7,11,20" : "255,255,255") + ",0)");
  c.fillStyle = scrim; c.fillRect(0, 3, MW, 43);
  c.font = f(600, 11);
  c.fillStyle = dark ? "rgba(233,238,251,.85)" : "rgba(17,26,44,.85)";
  c.fillText(t("霞光档案") + " · SUNGLOW", 44, 26);
  c.font = f(500, 11);
  c.fillStyle = tokColor("--photo-credit", dark ? "rgba(233,238,251,.62)" : "rgba(17,26,44,.56)");
  c.textAlign = "right";
  c.fillText(t("广州 · 珠江 · 实拍"), MW - 44, 26);
  c.textAlign = "left";

  /* 抬头：标题 + 城市 / 日期时段 / 维度与模型 */
  c.font = f(700, 26, true); c.fillStyle = TX1;
  c.fillText(t("观测场"), 44, 122);
  c.font = f(500, 11.5); c.fillStyle = TX3;
  c.fillText(
    fit(c, o.dimLabel + " · " + o.modelLabel + " · " + t(o.period === "am" ? "朝霞" : "晚霞"), 380),
    44, 141
  );
  c.textAlign = "right";
  c.font = f(700, 15, true); c.fillStyle = TX1;
  c.fillText(fit(c, o.city, 270), MW - 44, 120);
  c.font = f(500, 12); c.fillStyle = TX2;
  c.fillText(o.date, MW - 44, 139);
  c.textAlign = "left";

  /* ---------- 图面区 ---------- */
  const spanKm = Math.max(120, o.spanKm || 1120);
  const kmPerLon = 111.32 * Math.max(0.2, Math.cos((o.center.lat * Math.PI) / 180));
  const scale = MHB / spanKm;
  const proj: Proj = (lat, lon) => ({
    x: MWB / 2 + (lon - o.center.lon) * kmPerLon * scale,
    y: MHB / 2 - (lat - o.center.lat) * LAT2KM * scale
  });

  c.save();
  rr(c, MX, MY, MWB, MHB, 12);
  c.clip();
  const plate = c.createLinearGradient(0, MY, 0, MY + MHB);
  plate.addColorStop(0, PLATE[0]); plate.addColorStop(1, PLATE[1]);
  c.fillStyle = plate; c.fillRect(MX, MY, MWB, MHB);

  /* 有屏上截图就贴截图（居中裁成图框比例，保证不变形），
     否则保留自绘分支：没有底图时至少还有经纬网 + 地名 + 方位环。 */
  const live = !o.base;
  if (o.base) {
    const img = o.base;
    const targetAspect = MWB / MHB;
    const imgAspect = img.width / img.height;
    let sw = img.width, sh = img.height, sx = 0, sy = 0;
    if (imgAspect > targetAspect) {
      sw = img.height * targetAspect;
      sx = (img.width - sw) / 2;
    } else {
      sh = img.width / targetAspect;
      sy = (img.height - sh) / 2;
    }
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    c.drawImage(img, sx, sy, sw, sh, MX, MY, MWB, MHB);
    /* GL 画布不带 DOM 里的腾讯 logo 与审图号，分享图自己补一条版权 */
    c.font = f(600, 9);
    c.textAlign = "right";
    const credit = "© 腾讯地图";
    const cw = c.measureText(credit).width;
    c.fillStyle = "rgba(8,12,20,.42)";
    rr(c, MX + MWB - cw - 15, MY + MHB - 21, cw + 10, 15, 4);
    c.fill();
    c.fillStyle = "rgba(245,248,255,.88)";
    c.fillText(credit, MX + MWB - 10, MY + MHB - 10);
    c.textAlign = "left";
  }

  /* 画布原点挪到图面左上角：后续所有绘制都用图面局部坐标 */
  c.translate(MX, MY);

  /* 经纬网：跨度决定密度（1°/2°/5°），在左右下缘标坐标 */
  const latHalf = spanKm / 2 / LAT2KM;
  const lonHalf = spanKm / 2 / kmPerLon;
  const step = latHalf * 2 > 24 || lonHalf * 2 > 24 ? 5 : latHalf * 2 > 10 || lonHalf * 2 > 10 ? 2 : 1;
  const gridCol = dark ? "rgba(200,216,244,.10)" : "rgba(40,60,100,.10)";
  const tickCol = dark ? "rgba(200,216,244,.34)" : "rgba(40,60,100,.34)";
  c.strokeStyle = gridCol; c.lineWidth = 1;
  c.font = f(500, 9); c.fillStyle = tickCol;
  if (live) {
    for (let lon = Math.ceil((o.center.lon - lonHalf) / step) * step; lon <= o.center.lon + lonHalf; lon += step) {
      const x = proj(o.center.lat, lon).x;
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, MHB); c.stroke();
      if (x > 36 && x < MWB - 36) c.fillText(Math.abs(lon) + "°" + (lon >= 0 ? "E" : "W"), x + 3, MHB - 6);
    }
    for (let lat = Math.ceil((o.center.lat - latHalf) / step) * step; lat <= o.center.lat + latHalf; lat += step) {
      const y = proj(lat, o.center.lon).y;
      c.beginPath(); c.moveTo(0, y); c.lineTo(MWB, y); c.stroke();
      if (y > 16 && y < MHB - 14) c.fillText(Math.abs(lat) + "°" + (lat >= 0 ? "N" : "S"), 5, y - 4);
    }
  }

  if (live && o.pts.length) {
    paintField(c, {
      pts: o.pts, proj, w: MWB, h: MHB, dark, dpr: S,
      showOcclusion: o.showOcclusion,
      showContours: o.showContours,
      cache: o.cache
    });
  }

  /* 距离环 + 方位线：口径与屏上 drawAziLayer 一致（400 km 射线、100–400 km 环）；
     环标签只留 200 / 400 km 两档 —— 缩到 900 km 跨度时四档会挤在一起。
     方位为空（该日期太阳事件不存在）时不画，与屏上一致。 */
  const azAvoid: Rect4[] = [];
  if (live && o.az != null) {
    drawAziLayer(c, proj, {
      lat: o.center.lat, lon: o.center.lon, az: o.az,
      head: o.azHead,
      ringLabel: (km) => (km === 200 || km === 400 ? km + " km" : ""),
      dark, w: MWB, h: MHB
    });
    /* 方位层先画、地名后画：把它的文字占位交给地名层避让，
       否则「晚霞方位 西 262°」会被城市名压掉（屏上也有这问题）。 */
    c.font = f(600, 10);
    const ringW = c.measureText("400 km").width;
    for (const km of [200, 400]) {
      const p = dest(o.center, o.az, km);
      const s = proj(p.lat, p.lon);
      azAvoid.push([s.x + 4, s.y - 14, s.x + 8 + ringW, s.y + 3]);
    }
    const tip = proj(dest(o.center, o.az, 400).lat, dest(o.center, o.az, 400).lon);
    c.font = f(700, 11);
    azAvoid.push([tip.x + 6, tip.y + 2, tip.x + 10 + c.measureText(o.azHead).width, tip.y + 18]);
  }

  /* 地名：先给当前城市钉一个标签，再把它当避让区交给自绘地名层 */
  let labelCount = 0;
  if (live) {
    const centerPt = proj(o.center.lat, o.center.lon);
    c.font = f(700, 12.5);
    const homeText = fit(c, o.city, 200);
    const homeW = c.measureText(homeText).width;
    const homeX = centerPt.x + 10;
    const homeY = centerPt.y - 9;
    const avoid: Rect4[] = [
      [Math.min(centerPt.x - 9, homeX - 2), homeY - 9, homeX + homeW + 2, homeY + 9],
      ...azAvoid
    ];
    const labels: CityLabel[] = o.labels.map((l) => {
      const p = proj(l.lat, l.lon);
      return { text: l.text, x: p.x, y: p.y, tier: l.tier };
    }).sort((a, b) => a.tier - b.tier);
    drawCityLabels(c, { labels, dark, w: MWB, h: MHB, avoid });
    labelCount = labels.length;

    /* 当前城市：实心点 + 光环，文字带描边，压在色面上也读得出 */
    c.beginPath(); c.arc(centerPt.x, centerPt.y, 6.5, 0, Math.PI * 2);
    c.strokeStyle = withAlpha(ACC, 0.55); c.lineWidth = 2; c.stroke();
    c.beginPath(); c.arc(centerPt.x, centerPt.y, 3.2, 0, Math.PI * 2);
    c.fillStyle = ACC; c.fill();
    c.font = f(700, 12.5);
    c.textAlign = "left";
    c.lineJoin = "round";
    c.strokeStyle = dark ? "rgba(6,10,20,.85)" : "rgba(255,255,255,.92)";
    c.lineWidth = 3;
    c.strokeText(homeText, homeX, homeY + 4);
    c.fillStyle = TX1;
    c.fillText(homeText, homeX, homeY + 4);
  }

  /* 采样点：只在用户屏上打开了这一层时才画，保持「图上即屏上」 */
  if (live && o.showPts && o.pts.length) {
    const core = dark ? "rgba(242,246,255,0.88)" : "rgba(16,24,40,0.88)";
    const halo = dark ? "rgba(4,8,16,0.55)" : "rgba(255,255,255,0.9)";
    for (const p of o.pts) {
      const s = proj(p.lat, p.lon);
      if (s.x < 0 || s.x > MWB || s.y < 0 || s.y > MHB) continue;
      c.beginPath(); c.arc(s.x, s.y, 3, 0, Math.PI * 2);
      c.strokeStyle = halo; c.lineWidth = 1.4; c.stroke();
      c.beginPath(); c.arc(s.x, s.y, 1.6, 0, Math.PI * 2);
      c.fillStyle = core; c.fill();
    }
  }
  c.restore();

  /* 图面描边（画在裁剪之外，圆角不会被色面吃掉） */
  c.strokeStyle = LINE; c.lineWidth = 1;
  rr(c, MX + 0.5, MY + 0.5, MWB - 1, MHB - 1, 12);
  c.stroke();

  /* ---------- 图例：与屏上同一套分级与色阶 ---------- */
  const DOTS = [12, 44, 70, 90];
  c.font = f(500, 11); c.fillStyle = TX3;
  let lx = 44;
  GLOW_BANDS.forEach((b, i) => {
    c.beginPath(); c.arc(lx + 4, 584, 4, 0, Math.PI * 2);
    c.fillStyle = glowColor(DOTS[i]); c.fill();
    const name = t(b.key);
    c.fillStyle = TX3;
    c.fillText(name, lx + 13, 588);
    lx += 13 + c.measureText(name).width + 18;
  });
  c.textAlign = "right";
  c.font = f(500, 10.5);
  c.fillText(t("热力图测试中 · 结果仅供参考"), MW - 44, 588);
  c.textAlign = "left";

  const barY = 598, barH = 8;
  const track = c.createLinearGradient(44, 0, MW - 44, 0);
  for (let v = 0; v <= 100; v += 4) {
    const rgb = glowRgb(v);
    track.addColorStop(v / 100, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + glowAlpha(v) + ")");
  }
  rr(c, 44, barY, MW - 88, barH, 4);
  c.fillStyle = withAlpha(TX1, dark ? 0.05 : 0.04);
  c.fill();
  c.fillStyle = track;
  c.fill();
  c.strokeStyle = LINE; c.lineWidth = 1;
  rr(c, 44.5, barY + 0.5, MW - 89, barH - 1, 4);
  c.stroke();

  c.font = f(500, 9.5); c.fillStyle = TX3;
  c.textAlign = "left"; c.fillText("0", 44, 622);
  c.textAlign = "center";
  [25, 50, 75].forEach((v) => c.fillText(String(v), 44 + ((MW - 88) * v) / 100, 622));
  c.textAlign = "right"; c.fillText("100", MW - 44, 622);

  /* 页脚：数据源 + 数据来源（实时 / 缓存）+ 采样点数 */
  c.strokeStyle = LINE; c.lineWidth = 1;
  c.beginPath(); c.moveTo(44, 634); c.lineTo(MW - 44, 634); c.stroke();
  c.textAlign = "left";
  c.font = f(500, 11); c.fillStyle = TX3;
  c.fillText(
    fit(c, t("霞光档案 · 数据源 Open-Meteo（GFS / ECMWF-IFS / CAMS 气溶胶）· 结论仅供观赏参考"), 460),
    44, 650
  );
  c.textAlign = "right";
  c.font = f(500, 11);
  const srcTxt = o.src === "cache" ? t("缓存数据") : o.src === "live" ? t("实时数据") : "";
  c.fillText(
    fit(c, [srcTxt, o.pts.length + " " + t("个网格点")].filter(Boolean).join("　·　"), 210),
    MW - 44, 650
  );
  c.textAlign = "left";

  return {
    w: cv.width, h: cv.height, theme,
    src: o.src || "live",
    pts: o.pts.length,
    labels: labelCount,
    spanKm: Math.round(spanKm),
    fileName: mapShareFileName(o.city, o.date, o.period),
    base: o.base ? "capture" : "redraw"
  };
}

export async function saveMapCard(o: MapCardOpts): Promise<ShareOutcome> {
  await ensureFonts();
  /* 照片加载失败不阻断导出：退回无照片版，只少一条抬头 */
  let photo: HTMLImageElement | null = null;
  try { photo = await loadHeroPhoto(); } catch { photo = null; }
  const cv = document.createElement("canvas");
  const meta = drawMapCard(cv, o, photo);
  cv.dataset.shareMeta = JSON.stringify(meta);
  const blob = await canvasToBlob(cv);
  return deliverBlob(blob, meta.fileName);
}

export { W as SHARE_CARD_W, H as SHARE_CARD_H, TW as TREND_CARD_W, TH as TREND_CARD_H };

