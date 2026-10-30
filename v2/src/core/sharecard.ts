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
import { isForeignTz, tzLabel } from "./tz";

const W = 780, H = 400, S = 2;

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
export function drawShareCard(
  cv: HTMLCanvasElement, r: ForecastResult, view: VerdictView, nowMs = Date.now()
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

  const gc = gradeColor(view.grade, dark);
  const isAM = r.period === "am";
  const band = skyBandOf(r, nowMs, r.dateStr);

  /* 天色带：与页面同一份 skyBandOf 结果。
     做成内嵌圆角带（而不是满宽）：满宽时最亮的白昼段与最暗的夜间段会跟卡片底色糊在一起，
     整条带看起来像「浮在中间」—— 加一层底衬 + 圆角边界，五段始终读得出。 */
  const BX = 44, BW = W - 88, BY = 14, BH = 54, BR = 10;
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
  const LY = 176;
  c.fillStyle = TX1; c.font = f(700, 46, true);
  c.fillText(Math.round(view.P) + "%", 44, LY);
  c.fillStyle = TX3; c.font = f(500, 12);
  c.fillText(t("出现概率"), 44, LY + 20);

  /* 右栏：城市 / 日期 / 质量 / 结论 / 细节 */
  const X = 252, maxW = W - X - 44;
  c.fillStyle = TX1; c.font = f(700, 25, true);
  c.fillText(fit(c, cityName(r.city.name, getLang()), maxW), X, 106);

  /* 副标题：日期 + 朝/晚霞 + 非 live 标注 + 单模型标注 */
  c.font = f(500, 13); c.fillStyle = TX2;
  let sub = r.dateStr + "　" + t(isAM ? "朝霞" : "晚霞");
  if (r.src === "cache") sub += "　·　" + t("缓存");
  let subX = X;
  c.fillText(sub, subX, 128);
  subX += c.measureText(sub + "　").width;
  if (view.single) {
    const tag = t(view.label);
    c.font = f(600, 12);
    const tw = c.measureText(tag).width + 16;
    rr(c, subX, 115, tw, 18, 9);
    c.fillStyle = withAlpha(ACC, 0.12); c.fill();
    c.strokeStyle = withAlpha(ACC, 0.4); c.lineWidth = 1; c.stroke();
    c.fillStyle = ACC; c.textAlign = "center";
    c.fillText(tag, subX + tw / 2, 128);
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
    X, 210
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

  c.font = f(500, 13.5);
  rowList.forEach((s, k) => {
    c.fillStyle = k === 2 ? (dark ? cfb.dark.color : cfb.color) : TX2;
    c.fillText(fit(c, s, maxW), X, 242 + k * 23);
  });

  /* 品牌 slogan（全站品牌触点之一） */
  c.font = f(500, 13); c.fillStyle = TX2; c.textAlign = "center";
  c.fillText(fit(c, t("让每一次追霞，都有迹可循"), W - 120), W / 2, 330);
  c.textAlign = "left";

  /* 页脚 */
  c.strokeStyle = LINE; c.lineWidth = 1;
  c.beginPath(); c.moveTo(44, 340); c.lineTo(W - 44, 340); c.stroke();
  c.font = f(500, 12); c.fillStyle = TX3;
  c.fillText(
    fit(c, t("霞光档案 · 数据源 Open-Meteo（GFS / ECMWF-IFS / CAMS 气溶胶）· 结论仅供观赏参考"), W - 250),
    44, 366
  );
  c.textAlign = "right";
  c.fillText(
    r.leadH > 0 ? t("预报时效约 {n} 小时", { n: Math.round(r.leadH) }) : t("实况 / 历史分析场"),
    W - 44, 366
  );
  c.textAlign = "left";

  /* mock 数据必须看得出来是演示 —— 用角标，不用斜向大字水印：
     实测 74px 斜字会把质量分与结论句糊掉，转发出去反而更难读。 */
  if (r.src === "mock") {
    const badge = t("演示数据");
    c.font = f(600, 12);
    const bw = c.measureText(badge).width + 22;
    const bx = 44, by = 236, bh = 26;
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

export async function saveShareCard(
  r: ForecastResult, view: VerdictView
): Promise<ShareOutcome> {
  await ensureFonts();

  const cv = document.createElement("canvas");
  const meta = drawShareCard(cv, r, view);
  /* 供探针读取：canvas 不进 DOM，只能把元信息挂在自身上 */
  cv.dataset.shareMeta = JSON.stringify(meta);

  const blob = await canvasToBlob(cv);

  /* 手机优先唤起系统分享面板（可直接发微信/存相册）；
     桌面、以及不支持带文件分享的浏览器，回退到下载。 */
  const nav = navigator as Navigator & {
    canShare?: (d?: ShareData) => boolean;
    share?: (d?: ShareData) => Promise<void>;
  };
  const canTryShare =
    isMobileLike() && typeof File !== "undefined" && !!nav.share && !!nav.canShare;
  if (canTryShare) {
    const file = new File([blob], meta.fileName, { type: "image/png" });
    if (nav.canShare!({ files: [file] })) {
      try {
        await nav.share!({ files: [file], title: t("霞光档案"), text: meta.fileName });
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
  a.download = meta.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return "downloaded";
}

export { W as SHARE_CARD_W, H as SHARE_CARD_H };
