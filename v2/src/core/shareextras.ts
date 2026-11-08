/* =========================================================================
   SUNGLOW v2 · 分享扩展（文案 / 日历）
   —— 服务「分享与内容创作闭环」，全部在前端完成，不依赖任何后端。

   口径说明：
   · 最佳观赏窗口取自 core/skyband.ts 的同一份 skyBandOf 结果（与页面天色带、
     分享卡一致）；没有几何窗口时退回「日出/日落 ±15 分钟」参考时段。
   · 文案与日历都用当前综合结论（与快照链接同一口径）；故事卡则跟随结论卡
     当前选中的模型，由调用方传 view。
   ========================================================================= */
import type { ForecastResult } from "./forecast";
import type { VerdictView } from "./verdict";
import { skyBandOf } from "./skyband";
import { t, getLang } from "./i18n";
import { cityName } from "./citylang";
import { uClock } from "./units";
import { todayInTz, addDaysIso } from "./tz";

export interface GlowWindow {
  startMs: number;
  endMs: number;
  midMs: number;
  /** 几何窗口成立（云边界 → 地球遮挡），而不是日落 ±15 分钟的兜底 */
  geom: boolean;
}

/** 最佳观赏窗口（时间轴与页面天色带同一份） */
export function glowWindowOf(r: ForecastResult): GlowWindow {
  const band = skyBandOf(r, Date.now(), r.dateStr);
  if (band?.win) {
    const span = band.endMs - band.startMs;
    const startMs = band.startMs + (band.win.left / 100) * span;
    const endMs = startMs + (band.win.width / 100) * span;
    return { startMs, endMs, midMs: (startMs + endMs) / 2, geom: true };
  }
  const half = 15 * 60000;
  return { startMs: r.evMs - half, endMs: r.evMs + half, midMs: r.evMs, geom: false };
}

/** 文案里的「今晚 / 明晚 / 今早 / 明早」，其余日期直接写 MM-DD */
function whenWord(r: ForecastResult): string {
  const today = todayInTz(r.tz);
  const tomorrow = addDaysIso(today, 1);
  const isAM = r.period === "am";
  if (r.dateStr === today) return t(isAM ? "今早" : "今晚");
  if (r.dateStr === tomorrow) return t(isAM ? "明早" : "明晚");
  return r.dateStr.slice(5);
}

/** 现成文案：今晚 18:32，广州晚霞概率 72%，良 */
export function captionOf(r: ForecastResult, view: VerdictView): string {
  const win = glowWindowOf(r);
  return t("{when} {time}，{city}{period}概率 {p}%，{grade}", {
    when: whenWord(r),
    time: uClock(win.midMs, r.tz),
    city: cityName(r.city.name, getLang()),
    period: t(r.period === "am" ? "朝霞" : "晚霞"),
    p: Math.round(view.P),
    grade: t(view.grade)
  });
}

/* ---------- 日历（.ics） ---------- */
function safeName(s: string): string {
  return String(s).replace(/[\\/:*?"<>|]/g, "").trim() || t("点位");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** ICS 时间必须是 UTC：YYYYMMDDTHHMMSSZ */
function icsTime(ms: number): string {
  const d = new Date(ms);
  return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + "T" +
    pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + "Z";
}

function icsEsc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545：单行不超过 75 个八位组，续行以空格开头 */
function icsFold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 73) {
      out.push(cur);
      cur = " " + ch;
      bytes = 1 + b;
    } else {
      cur += ch;
      bytes += b;
    }
  }
  out.push(cur);
  return out.join("\r\n");
}

export interface IcsResult { text: string; fileName: string }

export function icsFileName(r: ForecastResult): string {
  return t("霞光档案") + "_" + safeName(cityName(r.city.name, getLang())) + "_" +
    r.dateStr + "_" + t(r.period === "am" ? "朝霞" : "晚霞") + ".ics";
}

/**
 * 把最佳窗口写成一条日历事件：事件本身覆盖观赏窗口，提前 30 分钟提醒。
 * 时间用 UTC（Z 后缀），不引入 VTIMEZONE，任何日历客户端都能正确显示当地时间。
 */
export function buildIcs(r: ForecastResult, view: VerdictView, url = ""): IcsResult {
  const win = glowWindowOf(r);
  const start = win.startMs;
  const end = Math.max(win.endMs, start + 5 * 60000);
  const city = cityName(r.city.name, getLang());
  const period = t(r.period === "am" ? "朝霞" : "晚霞");
  const summary = t("霞光档案 · {city}{period} {p}%", {
    city, period, p: Math.round(view.P)
  });
  const range = uClock(start, r.tz) + "–" + uClock(end, r.tz);
  const desc = (win.geom
    ? t("最佳观赏窗口 {start}–{end}，出现概率 {p}%，观赏质量 {q} 分（{grade}）。", {
        start: uClock(start, r.tz), end: uClock(end, r.tz),
        p: Math.round(view.P), q: Math.round(view.Q), grade: t(view.grade)
      })
    : t("参考时段 {start}–{end}（无几何窗口），出现概率 {p}%，观赏质量 {q} 分（{grade}）。", {
        start: uClock(start, r.tz), end: uClock(end, r.tz),
        p: Math.round(view.P), q: Math.round(view.Q), grade: t(view.grade)
      })) + (url ? "\n" + t("查看快照：{url}", { url }) : "");
  const uid = "sunglow-" + r.dateStr + "-" + r.period + "-" +
    r.city.lat.toFixed(3) + "-" + r.city.lon.toFixed(3) + "-" +
    Math.round(start / 60000) + "@sunglow.local";
  const stamp = icsTime(Date.now());

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SUNGLOW//Glow Forecast//CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:" + uid,
    "DTSTAMP:" + stamp,
    "DTSTART:" + icsTime(start),
    "DTEND:" + icsTime(end),
    "SUMMARY:" + icsEsc(summary),
    "DESCRIPTION:" + icsEsc(desc),
    "LOCATION:" + icsEsc(city + " " + r.city.lat.toFixed(3) + "," + r.city.lon.toFixed(3)),
    "GEO:" + r.city.lat.toFixed(4) + ";" + r.city.lon.toFixed(4),
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    "DESCRIPTION:" + icsEsc(range + " · " + summary),
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  ];
  return {
    text: lines.map(icsFold).join("\r\n") + "\r\n",
    fileName: icsFileName(r)
  };
}

/** 触发下载（桌面与手机浏览器都可用；iOS 会交给「日历」App 打开） */
export function saveIcs(r: ForecastResult, view: VerdictView, url = ""): string {
  const ics = buildIcs(r, view, url);
  const blob = new Blob([ics.text], { type: "text/calendar;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = ics.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 5000);
  return ics.fileName;
}
