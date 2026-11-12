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
import { uAlt, uDist, uClock } from "./units";
import { mixedIndex, QUALITY_BANDS, gradeOf, type StatResult } from "./scoring";
import { typeDetail } from "./physics";
import { isNum } from "./math";
import type { TrendRow } from "./trend";
import { trendCacheGet } from "./trend";
import { SNAP_FAC_NAME, snapFacFmt } from "./factors";
import { mapCacheGet, type MapPoint, type MapDateBox } from "./mapdata";
import { glowWindowOf } from "./shareextras";
import { isForeignTz, tzLabel } from "./tz";
import {
  paintField, drawCityLabels, drawAziLayer,
  type FieldPt, type FieldCache, type CityLabel, type Proj, type Rect4
} from "./maprender";
import { glowColor, glowRgb, glowAlpha, GLOW_BANDS, rampColor } from "./ramp";
import heroPhoto from "../assets/hero-photo.webp";
import qrcode from "qrcode-generator";
import { qrSafeUrl } from "./snapshot";

/* 2026-11-11：结论卡从 780×400 扩成 780×1024 —— 用户要求「把整个结论板块的
   内容全部做进去」，只留概率大字的横版塞不下。宽度不变（社交平台友好），
   高度按内容固定；合成卡的可选块继续接在 H 之下。 */
const W = 780, H = 1024, S = 2;
/** 顶部实拍报头带高度（与首屏 M2 报头带同一套照片与署名） */
const BAND_H = 88;

/* =========================================================================
   合成块（方案 D）—— 一张卡，模块自己拼
   结论层 780×400 是不动的核；天色带 / 十日趋势 / 观测场缩略 / 三因子 / 二维码
   按勾选追加在结论层下方，卡片高度随内容走（780×400 ~ 780×1430）。
   全部不勾 = 与结论卡逐像素相同（COMPOSE_DEFAULT 就是全关，别改）。
   ========================================================================= */
export interface ComposeMods { sky: boolean; trend: boolean; map: boolean; fac: boolean; qr: boolean }
export const COMPOSE_DEFAULT: ComposeMods =
  { sky: false, trend: false, map: false, fac: false, qr: false };
export const COMPOSE_BLOCK_H = { sky: 150, trend: 232, map: 300, fac: 148, qr: 300 } as const;
export function composeExtraH(m: ComposeMods): number {
  return (m.sky ? COMPOSE_BLOCK_H.sky : 0) + (m.trend ? COMPOSE_BLOCK_H.trend : 0) +
    (m.map ? COMPOSE_BLOCK_H.map : 0) + (m.fac ? COMPOSE_BLOCK_H.fac : 0) +
    (m.qr ? COMPOSE_BLOCK_H.qr : 0);
}
/** 观测场缩略的点：相对城市的公里偏移 + 值 + 颜色（只读缓存，不取数） */
export interface MapPtLite { dxKm: number; dyKm: number; v: number; color: string }

/* 字体栈与 tokens.css 的 --font-display / --font-body 同源（canvas 读不到 CSS 变量，
   只能写同一串字面量；改栈时两处一起改）。构建把 woff2 内联进单文件，族名照可用。 */
const DISPLAY = '"Space Grotesk","PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif';
const BODY = '"Inter","PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif';
export const f = (w: number, size: number, display = false) =>
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
  /** 结论区内容实际画到的最底 y（不含页脚）；只有完整结论卡会填 */
  contentEnd?: number;
}

/* ---------- 小工具 ---------- */
function tok(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
/** 令牌可能是 var() 引用（--acc-1 → var(--spectrum-1)），canvas 不认，退一层 */
export function tokColor(name: string, fallback: string): string {
  const v = tok(name);
  if (!v) return fallback;
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  if (m) {
    const inner = tok(m[1]);
    return inner || fallback;
  }
  return v;
}
export function withAlpha(color: string, a: number): string {
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
export function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rd: number) {
  c.beginPath();
  c.moveTo(x + rd, y);
  c.arcTo(x + w, y, x + w, y + h, rd);
  c.arcTo(x + w, y + h, x, y + h, rd);
  c.arcTo(x, y + h, x, y, rd);
  c.arcTo(x, y, x + w, y, rd);
  c.closePath();
}
/** 超宽截断加省略号 —— 长城市名不会把排版顶出画布 */
export function fit(c: CanvasRenderingContext2D, s: string, maxW: number): string {
  if (c.measureText(s).width <= maxW) return s;
  let i = s.length;
  while (i > 1 && c.measureText(s.slice(0, i) + "…").width > maxW) i--;
  return s.slice(0, i) + "…";
}
export function gradeColor(grade: string, dark: boolean): string {
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

/* ---------- 多行文本 / 模型卡（结论区完整版共用） ---------- */
/** 按画布宽度逐字断行；返回下一行的基线 y。maxLines 之后截断加省略号。 */
function wrapText(
  c: CanvasRenderingContext2D, text: string, x: number, y: number,
  maxW: number, lh: number, maxLines = 3
): number {
  const chars = Array.from(String(text));
  let line = "", ly = y, n = 1;
  for (const ch of chars) {
    const next = line + ch;
    if (c.measureText(next).width > maxW && line) {
      if (n >= maxLines) {
        let cut = line;
        while (cut && c.measureText(cut + "…").width > maxW) cut = cut.slice(0, -1);
        c.fillText(cut + "…", x, ly);
        return ly + lh;
      }
      c.fillText(line, x, ly);
      ly += lh; n++;
      line = ch;
    } else line = next;
  }
  if (line) { c.fillText(line, x, ly); ly += lh; }
  return ly;
}

export interface ModelCardView {
  id: string;
  name: string;
  sub: string;
  P: number;
  Q: number;
  grade: string;
  facts: Array<[string, string]>;
  missing?: boolean;
}
const MC_DOT: Record<string, string> = {
  ens: "#BA7517", gfs: "#378ADD", ec: "#1D9E75", rt: "#D85A30"
};

/** 与 components/ModelCards.vue 同一份口径：四张卡、各自的事实行。
    点（这里没有交互）不需要，但数字与页面必须一模一样。 */
export function modelCardsOf(r: ForecastResult): ModelCardView[] {
  const out: ModelCardView[] = [{
    id: "ens",
    name: "多模型综合",
    sub: "GFS 30% + EC 34% + 光追 36%",
    P: r.P, Q: r.Q, grade: r.grade,
    facts: [
      [t("可信度"), t(r.conf.lv)],
      ["ΔI", r.dvI != null ? String(Math.round(r.dvI)) : "—"],
      ["ΔP", r.spread != null ? String(Math.round(r.spread)) : "—"],
      ["ΔQ", r.spreadQ != null ? String(Math.round(r.spreadQ)) : "—"],
      [t("等级"), t(r.grade)],
      [t("时效"), r.leadH > 0 ? Math.round(r.leadH) + " " + t("小时") : t("实况/历史")],
      [t("综合指数"), String(Math.round(mixedIndex(r.P, r.Q)))]
    ]
  }];
  const pack = (id: "gfs" | "ec", name: string, sub: string, s: StatResult): ModelCardView => ({
    id, name, sub, P: s.P, Q: s.Q, grade: gradeOf(s.Q),
    facts: [
      [t("云型"), t(s.primary.type)],
      [t("主云量"), Math.round(s.primary.cover) + "%"],
      [t("云底高度"), uAlt(s.primary.base * 1000)],
      [t("云边界"), isNum(s.d) ? uDist(s.d as number) : t("无明显边界")],
      [t("等效云底"), uDist(s.hEff, 2)],
      [t("持续时间"), Math.round(s.geom.dur) + " " + t("分钟")],
      ["AOD", isNum(s.aodUp) ? (s.aodUp as number).toFixed(2) : "—"]
    ]
  });
  out.push(pack("gfs", "GFS 模式", "NOAA 全球模式 · 1 小时分辨率", r.sG));
  const e = r.sE;
  if (e) out.push(pack("ec", "ECMWF-IFS 模式", "欧洲中心全球模式", e));
  else {
    out.push({
      id: "ec", name: "ECMWF-IFS 模式", sub: "欧洲中心全球模式",
      P: NaN, Q: NaN, grade: "", facts: [], missing: true
    });
  }
  const rt = r.sRT;
  out.push({
    id: "rt", name: "光追算法", sub: "纯物理：多波长光路积分 + CIE 色度",
    P: rt.P, Q: rt.Q, grade: gradeOf(rt.Q),
    facts: [
      [t("主云型"), t(rt.primary.type)],
      [t("等效地表"), uDist(rt.Heq, 2)],
      [t("峰值透射"), rt.peak.T550.toExponential(2)],
      [t("亮度"), t(rt.bright.txt).split(/[（(]/)[0].trim()],
      [t("颜色"), t(rt.peak.name)],
      [t("饱和"), Math.round(rt.peak.sat * 100) + "%"],
      [t("几何"), t(rt.geom.ok ? "成立" : "不成立")]
    ]
  });
  return out;
}

export function drawModelCard(
  c: CanvasRenderingContext2D, cd: ModelCardView,
  x: number, y: number, w: number, h: number,
  o: { dark: boolean; T1: string; T2: string; T3: string; LINE: string }
): void {
  const gc = gradeColor(cd.grade, o.dark);
  rr(c, x, y, w, h, 12);
  c.fillStyle = withAlpha(o.T1, o.dark ? 0.045 : 0.03); c.fill();
  c.strokeStyle = o.LINE; c.lineWidth = 1; c.stroke();

  const px = x + 14, py = y + 14;
  c.fillStyle = MC_DOT[cd.id] || o.T2;
  c.beginPath(); c.arc(px + 3, py + 7, 3, 0, Math.PI * 2); c.fill();
  c.font = f(600, 12.5); c.fillStyle = o.T1;
  c.fillText(fit(c, t(cd.name), w - 172), px + 13, py + 11);
  c.font = f(500, 9); c.fillStyle = o.T3; c.textAlign = "right";
  c.fillText(fit(c, t(cd.sub), 152), x + w - 14, py + 11);
  c.textAlign = "left";

  if (cd.missing) {
    c.font = f(500, 10.5); c.fillStyle = o.T3;
    wrapText(c, t("该日期/点位未取到 ECMWF 数据，本次综合结果由 GFS 与光追算法构成。"),
      px, py + 32, w - 28, 15, 3);
    return;
  }

  c.font = f(700, 26, true); c.fillStyle = o.T1;
  const ps = Math.round(cd.P) + "%";
  c.fillText(ps, px, py + 48);

  const tag = t(cd.grade);
  c.font = f(600, 9.5);
  const tw = c.measureText(tag).width + 14;
  const gx = x + w - 14 - tw, gy = py + 30;
  rr(c, gx, gy, tw, 18, 9);
  c.fillStyle = withAlpha(gc, o.dark ? 0.18 : 0.12); c.fill();
  c.strokeStyle = withAlpha(gc, 0.45); c.lineWidth = 1; c.stroke();
  c.fillStyle = gc; c.textAlign = "center";
  c.fillText(tag, gx + tw / 2, gy + 13);
  c.textAlign = "left";

  const barY = py + 57, barW = w - 28;
  c.fillStyle = withAlpha(o.T1, o.dark ? 0.1 : 0.07);
  rr(c, px, barY, barW, 3, 1.5); c.fill();
  c.fillStyle = MC_DOT[cd.id] || o.T2;
  rr(c, px, barY, Math.max(2, barW * Math.min(1, Math.max(0, cd.P / 100))), 3, 1.5); c.fill();

  c.font = f(500, 9.8);
  let fx = px, fy = py + 78;
  for (const [k, v] of cd.facts) {
    const segW = c.measureText(k + " " + v).width + 12;
    if (fx + segW > x + w - 14 && fx > px) { fx = px; fy += 13; }
    if (fy > y + h - 8) break;
    c.fillStyle = o.T3; c.fillText(k, fx, fy);
    const kw = c.measureText(k).width;
    c.fillStyle = o.T2; c.fillText(" " + v, fx + kw, fy);
    fx += segW;
  }
}

/* ---------- 绘制 ---------- */
/** 实拍报头图：产物里是 base64 data URL，加载一次缓存复用。
    合成面板画预览要用同一张图，故对外暴露；不要在别处再建第二个加载器。 */
let photoPromise: Promise<HTMLImageElement> | null = null;
export function loadHeroPhoto(): Promise<HTMLImageElement> {
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
  photo?: HTMLImageElement | null,
  compose?: {
    mods: ComposeMods; url?: string; days?: TrendDay[];
    map?: { pts: MapPtLite[]; n: number } | null;
    /** 地图本体截屏（captureMapComposite）：有就直接贴，出图＝屏上看到的那张图 */
    mapImg?: HTMLCanvasElement | null;
  }
): ShareMeta {
  const dark = document.documentElement.dataset.theme === "dark";
  const theme: "dark" | "light" = dark ? "dark" : "light";

  /* 可选块：默认全关时 extraH = 0，画布与页脚位置与旧版完全一致 */
  const mods = compose?.mods ?? COMPOSE_DEFAULT;
  const extraH = composeExtraH(mods);
  const CH = H + extraH;

  cv.width = W * S; cv.height = CH * S;
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
  c.fillStyle = BG; c.fillRect(0, 0, W, CH);
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

    /* 与页面 .skyfoot 同一句：这条带子怎么读 */
    c.font = f(500, 10.5); c.fillStyle = TX3;
    const footL = t("五段曙暮光：白昼余晖 / 民用 / 航海 / 天文 / 夜间") +
      (band.win ? "　·　" + t("底部橙条＝霞光窗口") : "");
    c.fillText(fit(c, footL, BW * 0.72), BX, BY + BH + 36);
    if (band.tzHint) {
      c.textAlign = "right";
      c.fillText(fit(c, t("当地时间") + " " + band.tzHint, BW * 0.26), BX + BW, BY + BH + 36);
      c.textAlign = "left";
    }
  }

  /* =====================================================================
     结论区：整块照搬页面 #verdict（2026-11-11 用户要求「全做进去」）
     可信度 → 标题与结论词 → 说明 → 四项指标 → 太阳与云的事实 → 几何判定
     → 霞色条 → 四张模型卡 → 口径说明。所有数字都取同一份 ForecastResult。
     ===================================================================== */
  const PAD = 44, innerW = W - PAD * 2;
  const cfb = r.conf;
  const confCol = dark ? cfb.dark.color : cfb.color;

  /* ① 可信度胶囊：可信度 高 · 三套算法结论接近 */
  const confTxt = t("可信度") + " " + t(cfb.lv) + " · " + t(cfb.txt);
  c.font = f(600, 12);
  const confW = c.measureText(confTxt).width + 26;
  const pillY = 194;
  rr(c, PAD, pillY, confW, 24, 12);
  c.fillStyle = withAlpha(confCol, dark ? 0.16 : 0.1); c.fill();
  c.strokeStyle = withAlpha(confCol, 0.42); c.lineWidth = 1; c.stroke();
  c.fillStyle = confCol;
  c.fillText(confTxt, PAD + 13, pillY + 16);

  /* 单模型：紧跟可信度标出这是哪一路（页面上的 .mk-tag） */
  if (view.single) {
    const tag = t(view.label);
    c.font = f(600, 11);
    const tw = c.measureText(tag).width + 18;
    const tx = PAD + confW + 8;
    rr(c, tx, pillY, tw, 24, 12);
    c.fillStyle = withAlpha(ACC, 0.12); c.fill();
    c.strokeStyle = withAlpha(ACC, 0.4); c.lineWidth = 1; c.stroke();
    c.fillStyle = ACC;
    c.fillText(tag, tx + 9, pillY + 16);
  }

  /* ② 标题：城市 日期 朝/晚霞 + 结论词（结论词吃掉光谱渐变） */
  c.font = f(700, 22, true);
  let head = cityName(r.city.name, getLang()) + " " + r.dateStr + " " + t(isAM ? "朝霞" : "晚霞");
  if (r.src === "cache") head += " · " + t("缓存");
  head = fit(c, head, innerW - 150);
  c.fillStyle = TX1;
  c.fillText(head, PAD, 248);
  const headW = c.measureText(head).width;
  const word = t(conclWord(view.P));
  const wordW = c.measureText(word).width;
  const wordX = PAD + headW + 14;
  if (wordX + wordW <= W - PAD) {
    const wg2 = c.createLinearGradient(wordX, 0, wordX + wordW, 0);
    wg2.addColorStop(0, SP[0]); wg2.addColorStop(0.5, SP[1]); wg2.addColorStop(1, SP[2]);
    c.fillStyle = wg2;
    c.fillText(word, wordX, 248);
  }

  /* ③ 说明行：概率 / 观赏质量 / 等级 + 可信度提示（最多两行） */
  c.font = f(500, 13); c.fillStyle = TX2;
  const desc =
    t("概率") + " " + Math.round(view.P) + "%，" +
    t("观赏质量") + " " + Math.round(view.Q) + " " + t("分") + " · " +
    t("等级") + " " + t(view.grade) + "。" + t(cfb.hint);
  let dy = wrapText(c, desc, PAD, 270, innerW, 19, 2);

  /* 气溶胶兜底提示（只有真兜底才出现，与页面同一条） */
  if (r.aodFallback) {
    c.font = f(500, 11.5);
    c.fillStyle = tokColor("--q-mid", "#c08a2e");
    dy = wrapText(
      c, t("本次没有取到气溶胶数据，颜色浓淡按默认值估算，实际霞光可能比预报更淡或更浓。"),
      PAD, dy + 3, innerW, 17, 2
    );
  }

  /* ④ 四项指标：出现概率 / 观赏质量 / 等级 / 模型分歧 ΔI */
  const metY = dy + 10, metH = 58, metGap = 10;
  const metW = (innerW - metGap * 3) / 4;
  const met = [
    { v: Math.round(view.P) + "%", l: t("出现概率"), col: tokColor("--acc-1", "#ff4d82") },
    { v: String(Math.round(view.Q)), l: t("观赏质量"), col: tokColor("--acc-2", "#ff9c3f") },
    { v: t(view.grade), l: t("等级"), col: gc },
    /* 这一格画的是 ΔI 原始值：越大＝三路越不一致，别再标成「可信度」 */
    { v: r.dvI != null ? (r.dvI as number).toFixed(1) : "—", l: t("模型分歧 ΔI"), col: TX2 }
  ];
  met.forEach((m, i) => {
    const mx = PAD + i * (metW + metGap);
    rr(c, mx, metY, metW, metH, 10);
    c.fillStyle = withAlpha(TX1, dark ? 0.05 : 0.035); c.fill();
    c.strokeStyle = LINE; c.lineWidth = 1; c.stroke();
    c.fillStyle = m.col; c.font = f(700, 23, true);
    c.fillText(fit(c, m.v, metW - 22), mx + 12, metY + 31);
    c.fillStyle = TX3; c.font = f(500, 11);
    c.fillText(fit(c, m.l, metW - 22), mx + 12, metY + 49);
  });

  /* ⑤ 太阳与云的事实：页面 .v-right 的六行，两列摆 */
  const p2 = r.sRT.primary;
  const tzs = r.tz && isForeignTz(r.tz) ? " " + tzLabel(r.tz) : "";
  const factRows: Array<[string, string]> = [
    [t(r.evName), uClock(r.evMs, r.tz) + tzs],
    [t("方位角"), r.evAz.toFixed(1) + "°"],
    [t("云型"), typeDetail(p2.type, r.sRT.decks.map((d) => d.cover))],
    [t("云底高度"), uAlt(p2.base * 1000)],
    [t("持续时间"), Math.round(r.sRT.geom.dur) + " " + t("分钟")],
    [t("能见度"), uDist(r.envM.vis ? r.envM.vis / 1000 : null, 1)]
  ];
  const factY = metY + metH + 22, colW = (innerW - 30) / 2;
  factRows.forEach(([k, v], i) => {
    const cx = PAD + (i % 2) * (colW + 30);
    const cy = factY + Math.floor(i / 2) * 30;
    c.fillStyle = TX3; c.font = f(500, 11.5);
    c.fillText(k, cx, cy);
    c.fillStyle = TX2; c.font = f(600, 12);
    c.fillText(fit(c, v, colW - 74), cx + 74, cy);
  });

  /* 几何条件：不成立时给出具体原因（可换两行），与页面 .geom-no 同一句 */
  const geomOk = !!r.sRT.geom.ok;
  const geomTxt = geomOk
    ? t("火烧云三角几何条件成立")
    : isNum(r.sRT.d)
      ? t("几何条件不成立：云边界距离 {d} 已超过霞光深入距离上限 {m}（该云盘范围内阳光无法从云底下方射入）", {
          d: uDist(r.sRT.d as number), m: uDist(r.sRT.geom.xMax)
        })
      : t("几何条件不成立：日出/日落方向 400 km 内没有找到可承载霞光的云盘");
  const geomY = factY + 3 * 30 - 4;
  c.font = f(500, 11.5); c.fillStyle = TX3;
  c.fillText(t("几何条件"), PAD, geomY);
  c.font = f(500, 12);
  c.fillStyle = geomOk ? TX2 : tokColor("--q-bad", "#c2603a");
  const geomEnd = wrapText(c, geomTxt, PAD + 74, geomY, innerW - 74, 17, 2);

  /* ⑥ 霞色条 + 颜色名（页面 .color-strip / .color-names） */
  let colY = Math.max(geomY + 18, geomEnd + 6);
  const samples = r.sRT.samples || [];
  if (samples.length) {
    const sw = innerW / samples.length;
    c.save();
    rr(c, PAD, colY, innerW, 14, 7); c.clip();
    samples.forEach((s, i) => {
      c.fillStyle = s.hex;
      c.fillRect(PAD + i * sw, colY, sw + 0.5, 14);
    });
    c.restore();
    c.font = f(500, 10); c.fillStyle = TX3;
    samples.forEach((s, i) => {
      c.fillText(fit(c, t(s.name), sw - 4), PAD + i * sw, colY + 28);
    });
    colY += 40;
  } else colY += 6;

  /* ⑦ 各模型独立结果：2×2，与页面上四张卡同数据 */
  const mcTop = colY + 6;
  c.font = f(600, 13); c.fillStyle = TX1;
  c.fillText(t("各模型独立结果"), PAD, mcTop + 12);
  c.font = f(500, 10); c.fillStyle = TX3; c.textAlign = "right";
  /* 静态图上不能写「点任意一张卡」——那是页面交互，出图后没有可点的地方 */
  c.fillText(t("同一份取数，四路独立评分"), W - PAD, mcTop + 12);
  c.textAlign = "left";

  const cards = modelCardsOf(r);
  const cardGap = 12, cardW = (innerW - cardGap) / 2, cardH = 118;
  cards.slice(0, 4).forEach((cd, i) => {
    drawModelCard(
      c, cd,
      PAD + (i % 2) * (cardW + cardGap),
      mcTop + 22 + Math.floor(i / 2) * (cardH + cardGap),
      cardW, cardH, { dark, T1: TX1, T2: TX2, T3: TX3, LINE }
    );
  });
  const endY = mcTop + 22 + 2 * cardH + cardGap;

  /* ⑧ 口径说明：页面上是可折叠的 FoldNote，图上直接铺开（最多两行一段） */
  const noteY = endY + 14;
  c.fillStyle = LINE; c.fillRect(PAD, noteY, innerW, 1);
  c.font = f(600, 11.5); c.fillStyle = TX2;
  c.fillText(t("说明 · 概率与质量分怎么算"), PAD, noteY + 18);
  c.font = f(500, 10.5); c.fillStyle = TX3;
  let ny = noteY + 34;
  ny = wrapText(c, t("概率 P 来自多模型的加权几何平均：GFS、ECMWF 与光追物理各给一份，缺哪一路就自动剔除，其余权重不变。"),
    PAD, ny, innerW, 15, 2);
  ny = wrapText(c, t("质量分 Q 由云型、云量、云底高度、几何持续与大气通透度共同评分，再换算成等级；它回答「好不好看」，概率回答「有没有」。" ),
    PAD, ny, innerW, 15, 2);
  ny = wrapText(c, t("可信度看模型分歧 ΔI：分歧越小，综合值越可信；有效模型少于两路时不给分歧值，右上角显示为破折号。ΔI 是三套算法综合指数的极差，ΔP / ΔQ 是出现概率与质量分的极差。"),
    PAD, ny, innerW, 15, 2);
  void ny;

  /* meta.rows：探针与外部消费的摘要（4 行，口径与旧版一致） */
  const rowList: string[] = [
    t("载霞云层 {v}", { v: t(p2.type) }) + " · " +
    t("覆盖 {v}", { v: Math.round(p2.cover) + "%" }) + " · " +
    t("云底高度") + " " + uAlt(p2.base * 1000),
    t("云边界距离") + " " + (isNum(r.sRT.d) ? uDist(r.sRT.d as number) : t("无明显边界")) +
    " · " + t("等效云底高度") + " " + uAlt(r.sRT.hEff * 1000) +
    " · AOD " + (isNum(r.sRT.aodUp) ? (r.sRT.aodUp as number).toFixed(2) : "—"),
    t("可信度") + " " + t(cfb.lv) + " · " + t(cfb.txt) +
    (isNum(r.dvI) ? " · ΔI " + Math.round(r.dvI as number) : ""),
    r.models.map((m) => (m.id === "gfs" ? "GFS " : m.id === "ec" ? "EC " : t("光追") + " ") +
      Math.round(m.P) + "%").join(" · ") +
    " · " + t("综合 I {v}", { v: Math.round(mixedIndex(r.P, r.Q)) })
  ];

  /* ---- 可选块（方案 D）：接在结论层下方、页脚之前 ----
     块内坐标都是绝对值；改块内容时同步改 COMPOSE_BLOCK_H。 */
  const ctx = c;
  let by = H - 32;
  /* padL 与结论区的 PAD 同值；innerW 已在上方声明，这里不重复定义 */
  const padL = 44;

  if (mods.sky) {
    const top = by + 22;
    ctx.font = f(600, 13); ctx.fillStyle = TX1;
    ctx.fillText(t("天色带与观赏窗口"), padL, top);
    ctx.font = f(500, 10); ctx.fillStyle = TX3; ctx.textAlign = "right";
    ctx.fillText(t("同页面口径"), W - padL, top);
    ctx.textAlign = "left";

    const sb = band;
    const bx = padL, bw = innerW, bh = 46, byy = top + 16;
    if (sb) {
      const totalM = sb.segs.reduce((a, s) => a + s.m, 0) || 1;
      ctx.save();
      rr(ctx, bx, byy, bw, bh, 9); ctx.clip();
      let x = bx;
      sb.segs.forEach((s) => {
        const w = (s.m / totalM) * bw;
        ctx.fillStyle = DUSK[s.cls] || "#ccc";
        ctx.fillRect(x, byy, Math.ceil(w) + 0.5, bh);
        x += w;
      });
      const gx = bx + (sb.glowX / 100) * bw;
      const rg = ctx.createRadialGradient(gx, byy + bh, 0, gx, byy + bh, bw * 0.46);
      rg.addColorStop(0, "rgba(255,166,87,0.30)");
      rg.addColorStop(0.68, "rgba(255,166,87,0)");
      ctx.fillStyle = rg; ctx.fillRect(bx, byy, bw, bh);
      if (sb.win) {
        const wx = bx + (sb.win.left / 100) * bw;
        const ww = Math.max(3, (sb.win.width / 100) * bw);
        ctx.fillStyle = ACC;
        ctx.fillRect(wx, byy + bh - 5, ww, 5);
        ctx.fillStyle = dark ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.85)";
        ctx.fillRect(wx, byy + bh - 5, ww, 1);
      }
      ctx.restore();
      ctx.strokeStyle = LINE; ctx.lineWidth = 1;
      rr(ctx, bx + 0.5, byy + 0.5, bw - 1, bh - 1, 9); ctx.stroke();

      /* 轴标注：左右各两点，时间取自同一份 skyBandOf */
      const tzs2 = r.tz && isForeignTz(r.tz) ? " " + tzLabel(r.tz) : "";
      const px2 = (p: number) => bx + (p / 100) * bw;
      ctx.font = f(500, 11); ctx.fillStyle = TX3;
      ctx.textAlign = "left";
      ctx.fillText(
        fit(ctx, sb.marks[0].name + " " + sb.marks[0].time + tzs2, 200),
        Math.max(px2(sb.marks[0].p), bx), byy + bh + 18
      );
      ctx.textAlign = "right";
      ctx.fillText(
        fit(ctx, sb.marks[3].name + " " + sb.marks[3].time, 200),
        Math.min(px2(sb.marks[3].p), bx + bw), byy + bh + 18
      );
      ctx.textAlign = "left";
    } else {
      ctx.font = f(500, 12); ctx.fillStyle = TX3;
      ctx.fillText(t("该时段没有天色带数据"), padL, byy + 20);
    }
    by += COMPOSE_BLOCK_H.sky;
  }

  if (mods.trend) {
    const top = by + 22;
    ctx.font = f(600, 13); ctx.fillStyle = TX1;
    ctx.fillText(t("十日趋势"), padL, top);

    const days = (compose?.days ?? []).slice(0, 10);
    const pick = (d: TrendDay): TrendRow | undefined => isAM ? d.am || d.pm : d.pm || d.am;
    let best: TrendDay | undefined; let bestQ = -1;
    for (const d of days) {
      const q = pick(d)?.Q ?? -1;
      if (q > bestQ) { bestQ = q; best = d; }
    }
    ctx.font = f(500, 11); ctx.fillStyle = TX3; ctx.textAlign = "right";
    ctx.fillText(
      days.length
        ? t("最佳 {d} · {q} 分", { d: (best?.date ?? "").slice(5), q: Math.round(Math.max(0, bestQ)) })
        : t("趋势尚未加载"),
      W - padL, top
    );
    ctx.textAlign = "left";

    const baseY = by + COMPOSE_BLOCK_H.trend - 30;
    const areaH = 122;
    const colW = innerW / 10;
    days.forEach((d, i) => {
      const row = pick(d);
      if (!row) return;
      const x = padL + i * colW + colW * 0.22;
      const bw = colW * 0.56;
      const bh = 10 + (Math.max(0, Math.min(100, row.P)) / 100) * (areaH - 10);
      ctx.fillStyle = d === best ? SP[1] : withAlpha(SP[0], 0.52);
      rr(ctx, x, baseY - bh, bw, bh, 3); ctx.fill();
      ctx.textAlign = "center";
      ctx.font = f(600, 10); ctx.fillStyle = TX2;
      ctx.fillText(Math.round(row.P) + "%", x + bw / 2, baseY - bh - 6);
      ctx.font = f(500, 9.5); ctx.fillStyle = TX3;
      ctx.fillText(d.date.slice(5), x + bw / 2, baseY + 15);
      ctx.textAlign = "left";
    });
    by += COMPOSE_BLOCK_H.trend;
  }

  if (mods.map) {
    const top = by + 22;
    ctx.font = f(600, 13); ctx.fillStyle = TX1;
    ctx.fillText(t("观测场缩略"), padL, top);
    const mp = compose?.map;
    ctx.font = f(500, 10); ctx.fillStyle = TX3; ctx.textAlign = "right";
    ctx.fillText(
      mp && mp.n ? t("{n} 格点 · 半径 500 km", { n: mp.n }) : t("地图尚未加载"),
      W - padL, top
    );
    ctx.textAlign = "left";

    const fx = padL, fy = top + 16, fw = innerW, fh = 210;
    rr(ctx, fx, fy, fw, fh, 12);
    ctx.fillStyle = dark ? "rgba(255,255,255,0.028)" : "rgba(20,30,50,0.028)";
    ctx.fill();
    ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.stroke();

    const mi = compose?.mapImg;
    if (mi && mi.width > 1) {
      /* 有地图本体截屏就贴截屏（居中裁成块比例，不变形）——
         底图、热力面、地名都在，观感与屏上一致，远好于自绘色斑。 */
      ctx.save();
      rr(ctx, fx + 1, fy + 1, fw - 2, fh - 2, 11); ctx.clip();
      const ta = fw / fh, ia = mi.width / mi.height;
      let sw = mi.width, sh = mi.height, sx = 0, sy = 0;
      if (ia > ta) { sw = mi.height * ta; sx = (mi.width - sw) / 2; }
      else { sh = mi.width / ta; sy = (mi.height - sh) / 2; }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(mi, sx, sy, sw, sh, fx + 1, fy + 1, fw - 2, fh - 2);
      ctx.restore();
    } else if (mp && mp.pts.length) {
      const cx = fx + fw / 2, cy = fy + fh / 2;
      const R = Math.min(fw, fh) / 2 - 10;
      ctx.save();
      rr(ctx, fx + 1, fy + 1, fw - 2, fh - 2, 11); ctx.clip();
      /* 自绘兜底：热力场用径向渐变斑。alpha 比早先更实（0.18~0.62），
         否则淡得像一层脏雾；采样点用反差芯 + 发丝光环，保证同色面上仍看得见落点。 */
      const blobR = Math.max(12, (R / 6.25));
      for (const p of mp.pts) {
        const x = cx + (p.dxKm / 500) * R;
        const y = cy - (p.dyKm / 500) * R;
        const a = 0.18 + 0.44 * Math.max(0, Math.min(1, p.v / 100));
        const g = ctx.createRadialGradient(x, y, 0, x, y, blobR);
        g.addColorStop(0, withAlpha(p.color, a));
        g.addColorStop(1, withAlpha(p.color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - blobR, y - blobR, blobR * 2, blobR * 2);
      }
      /* 采样点：反差芯 + 发丝光环，保证在同色面上仍看得见落点 */
      for (const p of mp.pts) {
        const x = cx + (p.dxKm / 500) * R;
        const y = cy - (p.dyKm / 500) * R;
        ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(TX1, 0.16); ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = dark ? "rgba(255,255,255,.82)" : "rgba(255,255,255,.92)";
        ctx.fill();
      }
      /* 城市锚点：空心圆 + 外环，落在正中 */
      ctx.beginPath(); ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = dark ? "#0d1526" : "#fff"; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = ACC; ctx.stroke();
      ctx.restore();
    } else {
      ctx.font = f(500, 12); ctx.fillStyle = TX3;
      ctx.fillText(t("先在观测场点「加载地图」，本次不含此块"), padL + 18, fy + 28);
    }
    ctx.font = f(500, 10); ctx.fillStyle = TX3;
    ctx.fillText(
      mi ? t("地图截屏 · 与屏上同一张图") : t("热力面 + 采样点 + 城市锚点 · 与地图同一份数据"),
      padL, fy + fh + 18
    );
    by += COMPOSE_BLOCK_H.map;
  }

  if (mods.fac) {
    const top = by + 20;
    ctx.font = f(600, 13); ctx.fillStyle = TX1;
    ctx.fillText(t("关键因素"), padL, top);
    ctx.font = f(500, 10); ctx.fillStyle = TX3; ctx.textAlign = "right";
    ctx.fillText(t("越靠右越有利"), W - padL, top);
    ctx.textAlign = "left";

    r.factorRows.slice(0, 3).forEach((row, i) => {
      const y = top + 28 + i * 34;
      ctx.font = f(500, 11.5); ctx.fillStyle = TX2;
      ctx.fillText(fit(ctx, t(SNAP_FAC_NAME[row[0]] || row[0]), 150), padL, y);
      ctx.textAlign = "right"; ctx.font = f(600, 11.5); ctx.fillStyle = TX1;
      ctx.fillText(snapFacFmt(row[0], row[1]), 268, y);
      ctx.textAlign = "left";
      const bx = 288, bw = W - padL - bx;
      ctx.fillStyle = withAlpha(TX3, 0.16);
      rr(ctx, bx, y - 7, bw, 6, 3); ctx.fill();
      const sc = Math.max(0, Math.min(1, Number(row[2]) || 0));
      if (sc > 0.02) {
        ctx.fillStyle = sc >= 0.6 ? SP[1] : withAlpha(SP[0], 0.7);
        rr(ctx, bx, y - 7, bw * sc, 6, 3); ctx.fill();
      }
    });
    by += COMPOSE_BLOCK_H.fac;
  }

  if (mods.qr) {
    const qy = by + 24;
    const PL = 216;
    if (compose?.url) {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.20)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
      ctx.fillStyle = "#ffffff";
      rr(ctx, padL, qy, PL, PL, 18); ctx.fill();
      ctx.restore();

      const qr = qrcode(0, "L");
      /* 完整链接带 pack 会超出二维码容量：码里用精简链接，复制按钮给完整版 */
      qr.addData(qrSafeUrl(compose.url));
      qr.make();
      const n = qr.getModuleCount();
      const pad = 14;
      const cell = Math.max(1, Math.floor((PL - pad * 2) / n));
      const qs = cell * n;
      const qx = padL + (PL - qs) / 2, qy2 = qy + (PL - qs) / 2;
      ctx.fillStyle = "#0b1020";
      for (let yy2 = 0; yy2 < n; yy2++) {
        for (let xx2 = 0; xx2 < n; xx2++) {
          if (qr.isDark(yy2, xx2)) ctx.fillRect(qx + xx2 * cell, qy2 + yy2 * cell, cell, cell);
        }
      }

      const tx = padL + PL + 32;
      ctx.fillStyle = TX1; ctx.font = f(600, 16);
      ctx.fillText(t("扫码查看完整结论"), tx, qy + 40);
      ctx.fillStyle = TX2; ctx.font = f(500, 12);
      ctx.fillText(t("快照链接 · 打开不重新取数"), tx, qy + 66);
      ctx.fillStyle = TX3; ctx.font = f(500, 11);
      ctx.fillText(t("趋势、地图、因子明细都在里面"), tx, qy + 92);
      ctx.font = f(600, 11); ctx.fillStyle = withAlpha(ACC, 0.9);
      ctx.fillText("SUNGLOW.CLOUD", tx, qy + 128);
    } else {
      ctx.fillStyle = TX3; ctx.font = f(500, 12);
      ctx.fillText(t("快照链接尚未生成，本次不含二维码"), padL, qy + 20);
    }
    by += COMPOSE_BLOCK_H.qr;
  }

  /* 页脚：跟着块高一起下移，永远压在卡片最后一屏 */
  const FY = H - 32 + extraH;
  c.strokeStyle = LINE; c.lineWidth = 1;
  c.beginPath(); c.moveTo(44, FY); c.lineTo(W - 44, FY); c.stroke();
  c.font = f(500, 12); c.fillStyle = TX3;
  c.fillText(
    fit(c, t("霞光档案 · 数据源 Open-Meteo（GFS / ECMWF-IFS / CAMS 气溶胶）· 结论仅供观赏参考"), W - 250),
    44, FY + 20
  );
  c.textAlign = "right";
  c.fillText(
    r.leadH > 0 ? t("预报时效约 {n} 小时", { n: Math.round(r.leadH) }) : t("实况 / 历史分析场"),
    W - 44, FY + 20
  );
  c.textAlign = "left";

  /* mock 数据必须看得出来是演示 —— 用角标，不用斜向大字水印：
     实测 74px 斜字会把质量分与结论句糊掉，转发出去反而更难读。 */
  if (r.src === "mock") {
    const badge = t("演示数据");
    c.font = f(600, 12);
    const bw = c.measureText(badge).width + 22;
    /* 放在可信度胶囊同一行的最右：不压任何数字、说明与页脚 */
    /* 放在可信度胶囊同一行的最右：不压任何数字、说明与页脚 */
    const bx = W - 44 - bw, mby = 194, bh = 26;
    rr(c, bx, mby, bw, bh, 13);
    c.fillStyle = withAlpha("#e2b45e", dark ? 0.18 : 0.16); c.fill();
    c.strokeStyle = withAlpha("#e2b45e", 0.55); c.lineWidth = 1; c.stroke();
    c.fillStyle = dark ? "#e2b45e" : "#8a5a00";
    c.textAlign = "center";
    c.fillText(badge, bx + bw / 2, mby + 17);
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
    band: !!band,
    contentEnd: Math.round(ny)
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
export async function deliverBlob(blob: Blob, fileName: string): Promise<ShareOutcome> {
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

/* =========================================================================
   快照二维码卡（保存二维码图片用）
   版式 C3「玻璃叠层 · 双数字」：实拍照片铺满 3:4，顶部压暗放品牌 / 城市 / 日期，
   底部一块液态玻璃里把「出现概率」和「质量」并排放，等级胶囊与扫码提示在下。
   文案与数值全部取自同一份 ForecastResult，和页面结论不会打架。
   注：照片源只有 1024×683，竖裁后 512 宽，1080 画布必然有插值；
   这是「整幅照片当封面」的固有代价，换取与站点一致的观感。
   ========================================================================= */
const QW = 1080, QH = 1440;

/** 逐字绘制并手动加字距：canvas 的 letter-spacing 在旧内核里不可用 */
function spaced(c: CanvasRenderingContext2D, s: string, x: number, y: number, gap: number) {
  let cx = x;
  for (const ch of s) {
    c.fillText(ch, cx, y);
    cx += c.measureText(ch).width + gap;
  }
}

export async function saveQrCard(url: string, r: ForecastResult): Promise<void> {
  const cv = document.createElement("canvas");
  cv.width = QW; cv.height = QH;
  const c = cv.getContext("2d");
  if (!c) throw new Error("canvas 2d unavailable");
  c.imageSmoothingQuality = "high";
  c.textBaseline = "top";
  c.textAlign = "left";

  /* ---- 照片：3:4 竖裁居中（源 3:2，两侧各裁四分之一） ---- */
  let photo: HTMLImageElement | null = null;
  try { photo = await loadHeroPhoto(); } catch { photo = null; }
  let sx = 0, sy = 0, sw = QW, sh = QH;
  if (photo && photo.width) {
    const tr = QW / QH, sr = photo.width / photo.height;
    if (sr > tr) { sw = photo.height * tr; sh = photo.height; sx = (photo.width - sw) / 2; }
    else { sw = photo.width; sh = photo.width / tr; sy = (photo.height - sh) * 0.5; }
    c.drawImage(photo, sx, sy, sw, sh, 0, 0, QW, QH);
  } else {
    const g = c.createLinearGradient(0, 0, 0, QH);
    g.addColorStop(0, "#1b2440"); g.addColorStop(1, "#0b1220");
    c.fillStyle = g; c.fillRect(0, 0, QW, QH);
  }

  /* ---- 顶部压暗：到 62% 收干净，下半张照片不受影响 ---- */
  const scrim = c.createLinearGradient(0, 0, 0, QH * 0.62);
  scrim.addColorStop(0, "rgba(3,6,12,.76)");
  scrim.addColorStop(0.34, "rgba(3,6,12,.40)");
  scrim.addColorStop(1, "rgba(3,6,12,0)");
  c.fillStyle = scrim; c.fillRect(0, 0, QW, QH * 0.62);

  /* ---- 顶部信息 ---- */
  const PAD = 76, BRAND_Y = 70;
  c.fillStyle = "rgba(255,255,255,.88)";
  c.font = f(600, 32, true);
  spaced(c, "SUNGLOW", PAD, BRAND_Y, 9);
  c.textAlign = "right";
  c.fillStyle = "rgba(255,255,255,.64)";
  c.font = f(500, 32);
  c.fillText(t("霞光档案"), QW - PAD, BRAND_Y);
  c.textAlign = "left";

  c.fillStyle = "#ffffff";
  c.font = f(700, 98);
  c.fillText(fit(c, cityName(r.city.name, getLang()), QW - PAD * 2), PAD, BRAND_Y + 72);

  /* ---- 玻璃面板：阴影 → 模糊照片 → 暗化 → 顶部高光 ---- */
  const GX = 51, GH = 580, GY = QH - 51 - GH, GW = QW - GX * 2, GR = 51;
  c.save();
  c.shadowColor = "rgba(0,0,0,.38)"; c.shadowBlur = 44; c.shadowOffsetY = 20;
  c.fillStyle = "rgba(10,15,24,.42)";
  rr(c, GX, GY, GW, GH, GR); c.fill();
  c.restore();

  c.save();
  rr(c, GX, GY, GW, GH, GR); c.clip();
  if (photo && photo.width) {
    c.filter = "blur(46px)";
    c.drawImage(photo, sx, sy, sw, sh, 0, 0, QW, QH);
    c.filter = "none";
  }
  c.fillStyle = "rgba(10,15,24,.42)"; c.fillRect(GX, GY, GW, GH);
  const hl = c.createLinearGradient(0, GY, 0, GY + 120);
  hl.addColorStop(0, "rgba(255,255,255,.16)");
  hl.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = hl; c.fillRect(GX, GY, GW, 120);
  c.restore();

  /* ---- 日期：并入玻璃面板首行，深底白字不受照片亮度影响 ---- */
  const DATE_Y = GY + 44;
  const [yy, mm, dd] = r.dateStr.split("-").map(Number);
  const dow = new Date(yy, (mm || 1) - 1, dd || 1).getDay();
  const dateLine = r.dateStr + " · " + t(WEEK[dow] || "周日") + " · " +
    t(r.period === "am" ? "朝霞" : "晚霞");
  c.fillStyle = "rgba(255,255,255,.72)";
  c.font = f(400, 32);
  c.fillText(fit(c, dateLine, GW - 88), GX + 44, DATE_Y);
  const ROW_Y = DATE_Y + 54;

  /* ---- 二维码：白卡靠右，码点按画布精度重绘（不是放大位图） ---- */
  const PLATE = 432, PIN = 29;
  const PLX = QW - 51 - 44 - PLATE, PLY = ROW_Y;
  c.save();
  c.shadowColor = "rgba(0,0,0,.35)"; c.shadowBlur = 30; c.shadowOffsetY = 12;
  c.fillStyle = "#ffffff";
  rr(c, PLX, PLY, PLATE, PLATE, 32); c.fill();
  c.restore();

  const qr = qrcode(0, "L");
  qr.addData(qrSafeUrl(url));
  qr.make();
  const n = qr.getModuleCount();
  const cell = Math.max(1, Math.floor((PLATE - PIN * 2) / n));
  const qs = cell * n;
  const qx = PLX + (PLATE - qs) / 2, qy = PLY + (PLATE - qs) / 2;
  c.fillStyle = "#0b1020";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.isDark(y, x)) c.fillRect(qx + x * cell, qy + y * cell, cell, cell);
    }
  }

  /* ---- 左侧文字列：概率与质量并列（C3），等级胶囊单独一行 ---- */
  const LX = 95, LY = ROW_Y, LW = PLX - 44 - LX;
  const CELL_GAP = 36, CELL_W = (LW - CELL_GAP) / 2;

  const stat = (x: number, label: string, val: number, unit: string) => {
    c.fillStyle = "rgba(255,255,255,.66)";
    c.font = f(500, 32);
    c.fillText(fit(c, label, CELL_W), x, LY + 4);
    c.fillStyle = "#ffffff";
    c.font = f(700, 96, true);
    const s = String(val);
    c.fillText(s, x, LY + 44);
    const w = c.measureText(s).width;
    c.font = f(500, 32);
    c.fillStyle = "rgba(255,255,255,.82)";
    c.fillText(unit, x + w + 6, LY + 108);
  };
  stat(LX, t("出现概率"), Math.round(r.P), "%");
  stat(LX + CELL_W + CELL_GAP, t("质量"), Math.round(r.Q), t("分"));

  /* 等级胶囊：颜色跟等级走（差不能是绿的） */
  const QY = LY + 158, PH = 48;
  const tag = t(r.grade);
  const gc = gradeColor(r.grade, true);
  c.font = f(600, 32);
  const tw = c.measureText(tag).width;
  const pillW = tw + 44;
  c.fillStyle = withAlpha(gc, 0.20);
  rr(c, LX, QY, pillW, PH, 24); c.fill();
  c.strokeStyle = withAlpha(gc, 0.5); c.lineWidth = 2; c.stroke();
  c.fillStyle = gc;
  c.textBaseline = "middle";
  c.fillText(tag, LX + 22, QY + PH / 2 + 1);
  c.textBaseline = "top";

  /* 分隔线 + 底部提示 */
  c.fillStyle = "rgba(255,255,255,.16)";
  c.fillRect(LX, QY + PH + 40, LW, 1);
  c.fillStyle = "rgba(255,255,255,.74)";
  c.font = f(400, 32);
  c.fillText(t("扫码查看快照"), LX, GY + GH - 44 - 32);

  const blob = await new Promise<Blob>((resolve, reject) => {
    cv.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
  await deliverBlob(blob, shareFileName(r));
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

/* ---------- 合成卡（方案 D）的取数口径：只读缓存，绝不触发请求 ----------
   「不自动取数」是硬约束：趋势只查 6h 趋势缓存、观测场只查地图缓存；
   查不到就把对应块置灰，而不是偷偷跑一次请求补数据。 */
export function trendDaysCached(r: ForecastResult): TrendDay[] {
  const [Y, M, D] = r.dateStr.split("-").map(Number);
  const day0 = Date.UTC(Y, (M || 1) - 1, D || 1);
  const rows = trendCacheGet(day0, r.city.lat, r.city.lon);
  if (!rows || !rows.length) return [];
  const byDate = new Map<string, TrendDay>();
  for (const row of rows) {
    const day = byDate.get(row.date) || { date: row.date };
    if (row.period === "am") day.am = row; else day.pm = row;
    byDate.set(row.date, day);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** 观测场缩略：从地图缓存取当前时段的格点，换算成相对城市的公里偏移。
    没缓存就返回 null —— 勾选项置灰，绝不自动加载地图（地图是额度大头）。 */
/* =========================================================================
   地图本体截图（观测场图 / 合成卡的「观测场缩略」共用）
   —— 直接合成 .map-host 里的 SDK 画布 + 我们的 overlay，出图与屏上看到的是
   同一张图（底图、热力面、地名、方位环都在），不再用程序化的色斑代替。
   —— 不做 getImageData 的「空图判定」：跨域瓦片会把画布污染（tainted），
   getImageData 直接抛 SecurityError，判定会把好图误判成空图。是否污染留给
   导出环节（canvasToBlob 抛错再回退自绘）。
   ========================================================================= */
export function captureMapComposite(): HTMLCanvasElement | null {
  const host = document.querySelector<HTMLElement>(".map-host");
  const overlay = document.querySelector<HTMLCanvasElement>(".map-box canvas.overlay");
  if (!host) return null;
  const layers = Array.from(host.querySelectorAll("canvas")) as HTMLCanvasElement[];
  if (!layers.length) return null;
  const w = layers[0].width, h = layers[0].height;
  if (w < 2 || h < 2) return null;
  try {
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const c = out.getContext("2d");
    if (!c) return null;
    /* SDK 可能把底图与注记放在不同画布上，按 DOM 顺序叠一遍最稳 */
    for (const layer of layers) {
      if (layer.width > 1 && layer.height > 1) c.drawImage(layer, 0, 0, w, h);
    }
    if (overlay && overlay.width > 1 && overlay.height > 1) c.drawImage(overlay, 0, 0, w, h);
    /* 空图判定（缓冲没保留时整张全透明）—— 但要在污染面前让路：
       getImageData 在 tainted 画布上抛 SecurityError，而抛错恰恰说明有跨域瓦片
       （有内容），按「非空」继续用；真读到像素才做透明度判定。 */
    try {
      let opaque = 0;
      for (const [x, y] of [[4, 4], [w - 5, 4], [w >> 1, h >> 1], [4, h - 5]]) {
        if (c.getImageData(x, y, 1, 1).data[3] > 0) opaque++;
      }
      if (opaque < 2) return captureFieldLayer();
    } catch { /* tainted：有瓦片内容，不作空图处理 */ }
    return out;
  } catch {
    return null;
  }
}

/** 只截我们自己的覆盖层（热力面 + 地名 + 方位环 + 采样点）。
    2D 画布从不被跨域污染，导出永远安全 —— SDK 层污染导致 toBlob 抛错时，
    用它顶上，好过退回一堆自绘色斑。 */
export function captureFieldLayer(): HTMLCanvasElement | null {
  const overlay = document.querySelector<HTMLCanvasElement>(".map-box canvas.overlay");
  if (!overlay || overlay.width < 2 || overlay.height < 2) return null;
  try {
    const out = document.createElement("canvas");
    out.width = overlay.width; out.height = overlay.height;
    const c = out.getContext("2d");
    if (!c) return null;
    c.drawImage(overlay, 0, 0);
    return out;
  } catch {
    return null;
  }
}

/** 观测场缩略的点：从一份 MapDateBox 换算成相对城市的公里偏移。
    纯函数，不碰 localStorage —— 内存里的地图数据（MapView 装载即写入 mapBox）
    才是「现在有没有观测场」的权威来源；缓存落盘是延迟的、localStorage 满了
    还会静默失败，只配当回落。 */
export function mapThumbFromBox(
  box: MapDateBox | null, period: "am" | "pm",
  city: { lat: number; lon: number }
): { pts: MapPtLite[]; n: number } | null {
  if (!box) return null;
  const per = period === "am" ? box.am : box.pm;
  const src: MapPoint[] = per && per.pts ? per.pts : [];
  if (!src.length) return null;
  const pts: MapPtLite[] = src.map((p) => ({
    dxKm: (p.lon - city.lon) * Math.cos((city.lat * Math.PI) / 180) * 111.32,
    dyKm: (city.lat - p.lat) * 110.57,
    v: p.P,
    /* MapPoint.color 是「霞色名」（绯红/粉紫…，供对比卡当标签用），
       不是 CSS 颜色，直接拿去 fillStyle 会静默画不出任何东西。
       这里按值走与页面同源的光谱 ramp。 */
    color: rampColor(p.P)
  }));
  return { pts, n: src.length };
}

/** 落盘缓存里的观测场（跨会话恢复用的回落路径） */
export function mapThumbCached(r: ForecastResult): { pts: MapPtLite[]; n: number } | null {
  return mapThumbFromBox(
    mapCacheGet(r.dateStr, r.city.lat, r.city.lon), r.period, r.city
  );
}

/** 合成卡落地：一张卡，勾了哪些块由 mods 决定，产物永远一个文件。
    days / map 可由调用方传入（分享面板用内存里那份，保证预览与导出同源），
    不传才回落到只读缓存。 */
export async function saveComposeCard(
  r: ForecastResult, view: VerdictView, mods: ComposeMods, url = "",
  extra?: {
    days?: TrendDay[];
    map?: { pts: MapPtLite[]; n: number } | null;
    mapImg?: HTMLCanvasElement | null;
  }
): Promise<ShareOutcome> {
  await ensureFonts();
  const photo = await loadHeroPhoto().catch(() => null);
  const days = extra?.days ?? (mods.trend ? trendDaysCached(r) : []);
  const map = extra?.map ?? (mods.map ? mapThumbCached(r) : null);
  const cv = document.createElement("canvas");
  const meta = drawShareCard(cv, r, view, Date.now(), photo,
    { mods, url, days, map, mapImg: extra?.mapImg ?? null });
  cv.dataset.shareMeta = JSON.stringify(meta);
  try {
    const blob = await canvasToBlob(cv);
    return deliverBlob(blob, meta.fileName);
  } catch (e) {
    /* 地图截屏被跨域瓦片污染时 toBlob 抛 SecurityError。
       两级回退：先换「只截覆盖层」（真实热力面 + 地名，永不污染），再无截屏自绘。 */
    if (extra?.mapImg) {
      for (const alt of [captureFieldLayer(), null] as (HTMLCanvasElement | null)[]) {
        if (alt === extra.mapImg) continue;
        try {
          const cv2 = document.createElement("canvas");
          const meta2 = drawShareCard(cv2, r, view, Date.now(), photo,
            { mods, url, days, map, mapImg: alt });
          cv2.dataset.shareMeta = JSON.stringify(meta2);
          const blob2 = await canvasToBlob(cv2);
          return deliverBlob(blob2, meta2.fileName);
        } catch { /* 继续试下一级 */ }
      }
    }
    throw e;
  }
}

/* =========================================================================
   十日趋势分享卡（横版 780×680）
   顶部 116 章首抬头：实拍照片铺底、大标题压在上面（与教程页 T1、结论卡
   报头带同一套语言）；抬头下先给「最佳窗口」前三名（与页面同一口径：
   全部朝 / 晚行按观赏质量 Q 降序，Q 相同看概率 P），再是照搬页面趋势表
   的两列 × 5 天：每天 朝 / 晚 各一行，概率条 + 概率数字 + 质量徽章
   （等级与分数），转发到聊天里与屏上看到的是同一套表达。
   数字直接取趋势表的同一份 rows，图与页面不会说出两套数。
   ========================================================================= */
const TW = 780, TH = 680, T_BAND = 116;

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
  veil.addColorStop(0, dark ? "rgba(7,11,20,.26)" : "rgba(242,245,251,.60)");
  veil.addColorStop(0.45, dark ? "rgba(7,11,20,.06)" : "rgba(242,245,251,.30)");
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
  c.fillText(t("十日趋势"), 44, 96);

  c.font = f(500, 11.5); c.fillStyle = TX3;
  c.fillText(t("朝") + " / " + t("晚") + "　" + count + " " + t("条实算结果"), 44, 140);

  c.textAlign = "right"; c.font = f(500, 11.5); c.fillStyle = TX2;
  c.fillText(
    fit(c, opts.city + "　" + range + (srcTxt ? "　·　" + srcTxt : ""), 470),
    TW - 44, 140
  );
  c.textAlign = "left";

  c.strokeStyle = LINE; c.lineWidth = 1;
  c.beginPath(); c.moveTo(44, 156); c.lineTo(TW - 44, 156); c.stroke();

  /* 最佳窗口：与页面同一口径 —— 全部朝 / 晚行按 Q 降序，Q 相同看 P，取前 3 */
  const best = days
    .flatMap((d) => (d.am ? [d.am] : []).concat(d.pm ? [d.pm] : []))
    .sort((a, b) => b.Q - a.Q || b.P - a.P)
    .slice(0, 3);
  c.font = f(600, 11.5); c.fillStyle = TX2;
  c.fillText(t("最佳窗口"), 44, 178);
  c.textAlign = "right"; c.font = f(500, 11.5); c.fillStyle = TX3;
  c.fillText(t("未来 {n} 天", { n: days.length }), TW - 44, 178);
  c.textAlign = "left";

  const BW3 = (TW - 88 - 20) / 3, BY3 = 188, BH3 = 58;
  best.forEach((w, i) => {
    const x = 44 + i * (BW3 + 10);
    const gc = gradeColor(w.grade, dark);
    c.fillStyle = i === 0 ? withAlpha(SP[1], dark ? 0.12 : 0.08) : withAlpha(TX1, dark ? 0.035 : 0.028);
    rr(c, x, BY3, BW3, BH3, 9); c.fill();
    c.strokeStyle = i === 0 ? withAlpha(SP[1], 0.46) : LINE; c.lineWidth = 1;
    rr(c, x + 0.5, BY3 + 0.5, BW3 - 1, BH3 - 1, 9); c.stroke();

    /* 第一行：名次 / 日期 / 星期 / 朝晚 */
    c.textAlign = "left"; c.font = f(600, 10.5, true); c.fillStyle = TX3;
    c.fillText("#" + (i + 1), x + 12, BY3 + 19);
    const rw = c.measureText("#" + (i + 1)).width;
    c.font = f(700, 14, true); c.fillStyle = TX1;
    c.fillText(w.date.slice(5), x + 12 + rw + 8, BY3 + 19);
    const dww = c.measureText(w.date.slice(5)).width;
    c.font = f(500, 10.5); c.fillStyle = TX3;
    c.fillText(weekdayOf(w.date), x + 12 + rw + 8 + dww + 6, BY3 + 19);
    c.textAlign = "right"; c.font = f(500, 10.5); c.fillStyle = TX2;
    c.fillText(t(w.period === "am" ? "朝霞" : "晚霞"), x + BW3 - 12, BY3 + 19);

    /* 第二行：质量分（主）/ 概率 / 等级徽章 */
    c.textAlign = "left"; c.font = f(700, 21, true); c.fillStyle = gc;
    const qs = String(Math.round(w.Q));
    c.fillText(qs, x + 12, BY3 + 46);
    const qw = c.measureText(qs).width;
    c.font = f(500, 10); c.fillStyle = TX3;
    c.fillText(t("分"), x + 12 + qw + 2, BY3 + 46);
    const fw = c.measureText(t("分")).width;
    c.font = f(500, 12); c.fillStyle = TX2;
    c.fillText(Math.round(w.P) + "%", x + 12 + qw + fw + 12, BY3 + 46);

    /* 等级徽章：底色是等级淡色，文字与描边同色，与页面徽章同一套 */
    c.font = f(600, 10.5);
    const tag = t(w.grade);
    const tw = c.measureText(tag).width + 14;
    const bx = x + BW3 - 12 - tw;
    c.fillStyle = withAlpha(gc, 0.10);
    rr(c, bx, BY3 + 34, tw, 17, 8.5); c.fill();
    c.strokeStyle = withAlpha(gc, 0.30);
    rr(c, bx + 0.5, BY3 + 34.5, tw - 1, 16, 8); c.stroke();
    c.textAlign = "center"; c.fillStyle = gc;
    c.fillText(tag, bx + tw / 2, BY3 + 46);
    c.textAlign = "left";
  });

  /* 体：照搬页面趋势表 —— 每天一行，左侧日期，右侧 朝 / 晚 两行：
     概率条 + 概率数字 + 质量徽章；两列 × 5 天。 */
  const COLX = [44, 404], COLW = 334, ROWH = 56, Y0 = 270, PX = 86, PW = COLW - PX;

  /** 概率条：底槽 + 光谱填充（与页面 .bar 同一视觉） */
  function barCell(x: number, y: number, w: number, p: number | null) {
    const h = 5;
    rr(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = withAlpha(TX1, dark ? 0.09 : 0.07); ctx.fill();
    if (p == null || p <= 0) return;
    const fw = Math.max(0, Math.min(w, (p / 100) * w));
    if (fw <= 0) return;
    ctx.save();
    rr(ctx, x, y, fw, h, Math.min(h / 2, fw / 2)); ctx.clip();
    const g = ctx.createLinearGradient(x, 0, x + fw, 0);
    g.addColorStop(0, SP[0]); g.addColorStop(0.5, SP[1]); g.addColorStop(1, SP[2]);
    ctx.fillStyle = g; ctx.fillRect(x, y, fw, h);
    ctx.restore();
  }

  /** 质量徽章：等级 + 分数，颜色即等级（与页面 .qb 同款）；返回宽度 */
  function badgeCell(xRight: number, y: number, grade: string | null, q: number | null): number {
    const label = grade ? t(grade) : "—";
    const gc = grade ? gradeColor(grade, dark) : TX3;
    ctx.font = f(600, 10);
    const lw = ctx.measureText(label).width;
    const qtxt = q == null ? "" : String(Math.round(q));
    const qw = qtxt ? ctx.measureText(qtxt).width + 4 : 0;
    const w = lw + qw + 12;
    const x = xRight - w;
    const top = y - 12;
    rr(ctx, x, top, w, 17, 8.5);
    if (grade) {
      ctx.fillStyle = withAlpha(gc, dark ? 0.12 : 0.08);
      ctx.fill();
    }
    ctx.strokeStyle = grade ? withAlpha(gc, 0.30) : LINE;
    ctx.lineWidth = 1;
    rr(ctx, x + 0.5, top + 0.5, w - 1, 16, 8); ctx.stroke();
    ctx.textAlign = "left"; ctx.font = f(600, 10);
    ctx.fillStyle = grade ? gc : TX3;
    ctx.fillText(label, x + 6, y + 1);
    if (qtxt) {
      ctx.save();
      ctx.globalAlpha = 0.72;
      ctx.font = f(500, 10);
      ctx.fillStyle = grade ? gc : TX3;
      ctx.fillText(qtxt, x + 6 + lw + 4, y + 1);
      ctx.restore();
    }
    return w;
  }

  /** 朝/晚一行：概率条在中间，数字右对齐，质量徽章贴列尾 */
  function rowCell(row: TrendRow | undefined, label: string, x: number, y: number) {
    ctx.textAlign = "left"; ctx.font = f(500, 10.5); ctx.fillStyle = TX3;
    ctx.fillText(label, x, y);
    const bw = badgeCell(x + PW, y, row?.grade ?? null, row ? row.Q : null);
    const pvRight = x + PW - bw - 8;
    const barX = x + 24;
    const barW = Math.max(28, pvRight - 34 - barX);
    barCell(barX, y - 8, barW, row ? row.P : null);
    ctx.textAlign = "right";
    if (row) {
      ctx.font = f(600, 13, true); ctx.fillStyle = rampColor(row.P);
      ctx.fillText(Math.round(row.P) + "%", pvRight, y);
    } else {
      ctx.font = f(500, 12); ctx.fillStyle = TX3;
      ctx.fillText("—", pvRight, y);
    }
    ctx.textAlign = "left";
  }

  days.forEach((d, idx) => {
    const col = idx < 5 ? 0 : 1;
    const i = idx % 5;
    const x = COLX[col];
    const top = Y0 + i * ROWH;

    ctx.font = f(700, 14, true); ctx.fillStyle = TX1;
    ctx.fillText(d.date.slice(5), x, top + 20);
    ctx.font = f(500, 9.5); ctx.fillStyle = TX3;
    ctx.fillText(d.date, x, top + 34);

    rowCell(d.am, t("朝"), x + PX, top + 20);
    rowCell(d.pm, t("晚"), x + PX, top + 42);

    /* 行分隔线：每列最后一天不画，两列底部齐平 */
    if (i < 4) {
      ctx.strokeStyle = LINE; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, top + 53); ctx.lineTo(x + COLW, top + 53); ctx.stroke();
    }
  });

  /* 图例：与页面 .trend-key 同一套（概率条 / 质量徽章） */
  const LG = 580;
  let lx = 44;
  ctx.textAlign = "left"; ctx.font = f(500, 10.5); ctx.fillStyle = TX3;
  const lgd = ctx.createLinearGradient(lx, 0, lx + 14, 0);
  lgd.addColorStop(0, SP[0]); lgd.addColorStop(0.5, SP[1]); lgd.addColorStop(1, SP[2]);
  rr(ctx, lx, LG - 8, 14, 4, 2); ctx.fillStyle = lgd; ctx.fill();
  lx += 20;
  ctx.fillText(t("出现概率"), lx, LG);
  lx += ctx.measureText(t("出现概率")).width + 18;
  rr(ctx, lx, LG - 8, 14, 4, 2); ctx.fillStyle = SP[1]; ctx.fill();
  lx += 20;
  ctx.fillText(t("质量徽章（右列）"), lx, LG);

  /* 页脚：口径 + 数据源 */
  ctx.strokeStyle = LINE;
  ctx.beginPath(); ctx.moveTo(44, 628); ctx.lineTo(TW - 44, 628); ctx.stroke();
  ctx.font = f(500, 11); ctx.fillStyle = TX3;
  ctx.fillText(
    fit(ctx, "P " + t("出现概率") + "　　Q " + t("观赏质量") + "　　·　　" + t("数据源") + " Open-Meteo", 540),
    44, 652
  );
  ctx.textAlign = "right"; ctx.font = f(600, 11); ctx.fillStyle = TX3;
  ctx.fillText("SUNGLOW", TW - 44, 652);
  ctx.textAlign = "left";

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
   竖版故事卡（9:16 · 540×960，2 倍密度 → 1080×1920）
   给小红书 / 朋友圈这类竖屏场景用：实拍抬头、超大出现概率、质量与等级、
   一句话结论、天色带、关键细节与最佳观赏窗口。数值全部取同一份
   ForecastResult / VerdictView，与结论卡和横版分享图不会出现两套数。
   ========================================================================= */
const STW = 540, STH = 960, ST_BAND = 300;

export function storyShareFileName(r: ForecastResult): string {
  return t("霞光档案") + "_" + safeName(cityName(r.city.name, getLang())) + "_" +
    r.dateStr + "_" + t(r.period === "am" ? "朝霞" : "晚霞") + "_" +
    t("竖版故事卡") + ".png";
}

export function drawStoryCard(
  cv: HTMLCanvasElement, r: ForecastResult, view: VerdictView, nowMs = Date.now(),
  photo?: HTMLImageElement | null
): ShareMeta {
  const dark = document.documentElement.dataset.theme === "dark";
  const theme: "dark" | "light" = dark ? "dark" : "light";

  cv.width = STW * S; cv.height = STH * S;
  const c = cv.getContext("2d");
  if (!c) throw new Error("canvas 2d unavailable");

  const BG = tokColor("--bg-card-solid", dark ? "#101a2e" : "#ffffff");
  const TX1 = tokColor("--tx-1", dark ? "#e9eefb" : "#111a2c");
  const TX2 = tokColor("--tx-2", dark ? "#a0b1cd" : "#46556f");
  const TX3 = tokColor("--tx-3", dark ? "#7f8fb0" : "#667287");
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

  c.fillStyle = BG; c.fillRect(0, 0, STW, STH);
  const sg = c.createLinearGradient(0, 0, STW, 0);
  sg.addColorStop(0, SP[0]); sg.addColorStop(0.5, SP[1]); sg.addColorStop(1, SP[2]);
  c.fillStyle = sg; c.fillRect(0, 0, STW, 4);

  /* 顶部实拍带 */
  if (photo) {
    const ih = ST_BAND - 3;
    const sc = Math.max(STW / photo.width, ih / photo.height);
    const sw = STW / sc, sh = ih / sc;
    c.drawImage(photo, (photo.width - sw) / 2, (photo.height - sh) * 0.42, sw, sh,
      0, 3, STW, ih);
  }
  const veil = c.createLinearGradient(0, 3, 0, ST_BAND);
  veil.addColorStop(0, dark ? "rgba(7,11,20,.30)" : "rgba(242,245,251,.58)");
  veil.addColorStop(0.4, dark ? "rgba(7,11,20,.06)" : "rgba(242,245,251,.18)");
  veil.addColorStop(0.72, dark ? "rgba(7,11,20,.42)" : "rgba(242,245,251,.44)");
  veil.addColorStop(1, BG);
  c.fillStyle = veil; c.fillRect(0, 3, STW, ST_BAND - 3);
  /* 标题压在照片下沿：再压一层竖向渐变，保证城市名在亮天空上也读得清 */
  const low = c.createLinearGradient(0, 150, 0, ST_BAND);
  low.addColorStop(0, "rgba(" + (dark ? "7,11,20" : "255,255,255") + ",0)");
  low.addColorStop(1, dark ? "rgba(7,11,20,.56)" : "rgba(255,255,255,.64)");
  c.fillStyle = low; c.fillRect(0, 150, STW, ST_BAND - 150);
  const scrim = c.createLinearGradient(0, 3, 0, 48);
  scrim.addColorStop(0, dark ? "rgba(7,11,20,.52)" : "rgba(255,255,255,.80)");
  scrim.addColorStop(1, "rgba(" + (dark ? "7,11,20" : "255,255,255") + ",0)");
  c.fillStyle = scrim; c.fillRect(0, 3, STW, 45);

  const BX = 36, BW = STW - 72;
  c.font = f(600, 11);
  c.fillStyle = dark ? "rgba(233,238,251,.85)" : "rgba(17,26,44,.85)";
  c.fillText(t("霞光档案") + " · SUNGLOW", BX, 26);
  c.textAlign = "right"; c.font = f(500, 11);
  c.fillStyle = tokColor("--photo-credit", dark ? "rgba(233,238,251,.62)" : "rgba(17,26,44,.56)");
  c.fillText(t("广州 · 珠江 · 实拍"), STW - BX, 26);
  c.textAlign = "left";

  c.font = f(700, 34, true); c.fillStyle = TX1;
  c.fillText(fit(c, cityName(r.city.name, getLang()), BW), BX, 238);
  c.font = f(500, 13.5); c.fillStyle = TX2;
  c.fillText(
    r.dateStr + "　" + t(r.period === "am" ? "朝霞" : "晚霞"),
    BX, 266
  );

  c.strokeStyle = LINE; c.lineWidth = 1;
  c.beginPath(); c.moveTo(BX, 318); c.lineTo(STW - BX, 318); c.stroke();

  const gc = gradeColor(view.grade, dark);
  const band = skyBandOf(r, nowMs, r.dateStr);

  /* 主数字：出现概率 */
  c.font = f(500, 12); c.fillStyle = TX3;
  c.fillText(t("出现概率"), BX, 352);
  c.fillText(t("观赏质量"), 286, 352);

  c.font = f(700, 84, true); c.fillStyle = TX1;
  c.fillText(Math.round(view.P) + "%", BX, 440);

  c.font = f(700, 44, true); c.fillStyle = gc;
  const qs = String(Math.round(view.Q));
  c.fillText(qs, 286, 428);
  const qw = c.measureText(qs).width;
  c.font = f(500, 12); c.fillStyle = TX3;
  c.fillText(t("分"), 286 + qw + 4, 428);

  /* 等级胶囊 */
  c.font = f(600, 11.5);
  const tag = t(view.grade);
  const tw = c.measureText(tag).width + 20;
  rr(c, 286, 442, tw, 24, 12);
  c.fillStyle = withAlpha(gc, 0.12); c.fill();
  c.strokeStyle = withAlpha(gc, 0.40); c.lineWidth = 1; c.stroke();
  c.fillStyle = gc; c.textAlign = "center";
  c.fillText(tag, 286 + tw / 2, 459);
  c.textAlign = "left";

  /* 一句话结论 */
  c.font = f(600, 22, true); c.fillStyle = TX1;
  c.fillText(t(conclWord(view.P)), BX, 488);

  /* 天色带 */
  const BY = 522, BH = 64, BR = 10;
  if (band) {
    const totalM = band.segs.reduce((a, s) => a + s.m, 0) || 1;
    c.save();
    rr(c, BX, BY, BW, BH, BR); c.clip();
    c.fillStyle = withAlpha(TX1, dark ? 0.05 : 0.04);
    c.fillRect(BX, BY, BW, BH);
    let x = BX;
    band.segs.forEach((s) => {
      const w = (s.m / totalM) * BW;
      c.fillStyle = DUSK[s.cls] || "#ccc";
      c.fillRect(x, BY, Math.ceil(w) + 0.5, BH);
      x += w;
    });
    const gx = BX + (band.glowX / 100) * BW;
    const rg = c.createRadialGradient(gx, BY + BH, 0, gx, BY + BH, BW * 0.5);
    rg.addColorStop(0, "rgba(255,166,87,0.30)");
    rg.addColorStop(0.68, "rgba(255,166,87,0)");
    c.fillStyle = rg; c.fillRect(BX, BY, BW, BH);
    if (band.win) {
      const wx = BX + (band.win.left / 100) * BW;
      const ww = Math.max(4, (band.win.width / 100) * BW);
      c.fillStyle = ACC;
      c.fillRect(wx, BY + BH - 5, ww, 5);
      c.fillStyle = dark ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.88)";
      c.fillRect(wx, BY + BH - 5, ww, 1);
    }
    c.restore();
    c.strokeStyle = LINE; c.lineWidth = 1;
    rr(c, BX + 0.5, BY + 0.5, BW - 1, BH - 1, BR); c.stroke();

    c.font = f(500, 12); c.fillStyle = TX3;
    const evMk = band.marks[0], darkMk = band.marks[3];
    const tzs = r.tz && isForeignTz(r.tz) ? " " + tzLabel(r.tz) : "";
    const px = (p: number) => BX + (p / 100) * BW;
    c.textAlign = "left";
    c.fillText(fit(c, evMk.name + " " + evMk.time + tzs, 230),
      Math.min(px(evMk.p), BX + BW - 200), BY + BH + 20);
    c.textAlign = "right";
    c.fillText(fit(c, darkMk.name + " " + darkMk.time, 170),
      Math.max(px(darkMk.p), BX + 200), BY + BH + 20);
    c.textAlign = "left";
  }

  /* 关键细节：与横版分享卡同一份口径 */
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

  c.strokeStyle = LINE; c.lineWidth = 1;
  c.beginPath(); c.moveTo(BX, 634); c.lineTo(STW - BX, 634); c.stroke();
  c.font = f(500, 12.5);
  rowList.forEach((s, k) => {
    c.fillStyle = k === 2 ? (dark ? cfb.dark.color : cfb.color) : TX2;
    c.fillText(fit(c, s, BW), BX, 660 + k * 24);
  });

  /* 最佳观赏窗口：与天色带同一份计算 */
  const win = glowWindowOf(r);
  const range = uClock(win.startMs, r.tz) + "–" + uClock(win.endMs, r.tz);
  const durMin = Math.max(1, Math.round((win.endMs - win.startMs) / 60000));
  c.font = f(500, 12); c.fillStyle = TX3;
  c.fillText(win.geom ? t("最佳观赏窗口") : t("参考时段"), BX, 770);
  c.font = f(700, 20, true); c.fillStyle = TX1;
  c.fillText(range + "　·　" + durMin + " " + t("分钟"), BX, 796);

  c.font = f(500, 12.5); c.fillStyle = TX3;
  c.fillText(fit(c, t("让每一次追霞，都有迹可循"), BW), BX, 842);

  /* 页脚 */
  c.strokeStyle = LINE;
  c.beginPath(); c.moveTo(BX, 880); c.lineTo(STW - BX, 880); c.stroke();
  c.font = f(500, 11); c.fillStyle = TX3;
  c.fillText(
    fit(c, t("霞光档案 · 数据源 Open-Meteo（GFS / ECMWF-IFS / CAMS 气溶胶）· 结论仅供观赏参考"), 390), BX, 904
  );
  c.textAlign = "right"; c.font = f(600, 11);
  c.fillText("SUNGLOW", STW - BX, 904);
  c.textAlign = "left";

  /* mock 数据角标 */
  if (r.src === "mock") {
    const badge = t("演示数据");
    c.font = f(600, 11.5);
    const bw = c.measureText(badge).width + 22;
    rr(c, BX, 44, bw, 24, 12);
    c.fillStyle = withAlpha("#e2b45e", dark ? 0.18 : 0.16); c.fill();
    c.strokeStyle = withAlpha("#e2b45e", 0.55); c.lineWidth = 1; c.stroke();
    c.fillStyle = dark ? "#e2b45e" : "#8a5a00";
    c.textAlign = "center";
    c.fillText(badge, BX + bw / 2, 60);
    c.textAlign = "left";
  }

  return {
    w: cv.width, h: cv.height, theme,
    model: view.single ? view.label : "ens",
    single: view.single,
    src: r.src,
    watermark: r.src === "mock",
    fileName: storyShareFileName(r),
    rows: rowList,
    bg: BG,
    grade: view.grade,
    band: !!band
  };
}

export async function saveStoryCard(
  r: ForecastResult, view: VerdictView
): Promise<ShareOutcome> {
  await ensureFonts();
  let photo: HTMLImageElement | null = null;
  try { photo = await loadHeroPhoto(); } catch { photo = null; }
  const cv = document.createElement("canvas");
  const meta = drawStoryCard(cv, r, view, Date.now(), photo);
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
  try {
    const blob = await canvasToBlob(cv);
    return deliverBlob(blob, meta.fileName);
  } catch (e) {
    /* 跨域瓦片会把地图截屏污染（tainted），toBlob 抛 SecurityError ——
       这时整张图都导不出。两级回退：先换「只截覆盖层」（2D 画布永不污染，
       仍是真实的热力面与地名），再退回完全无截屏的自绘版。 */
    if (o.base) {
      for (const alt of [captureFieldLayer(), null] as (HTMLCanvasElement | null)[]) {
        if (alt === o.base) continue;
        try {
          const cv2 = document.createElement("canvas");
          const meta2 = drawMapCard(cv2, { ...o, base: alt }, photo);
          cv2.dataset.shareMeta = JSON.stringify(meta2);
          const blob2 = await canvasToBlob(cv2);
          return deliverBlob(blob2, meta2.fileName);
        } catch { /* 继续试下一级 */ }
      }
    }
    throw e;
  }
}

export { W as SHARE_CARD_W, H as SHARE_CARD_H, TW as TREND_CARD_W, TH as TREND_CARD_H };

