/* 时间管道单测（纯 Node，不联网、不进 DOM）
   -------------------------------------------------------------------------
   验的是「城市墙钟 ↔ 真实时间戳」这一层：接口返回的墙钟字符串必须用响应自带的
   utc_offset_seconds 折回真实时刻，太阳事件必须按同一时区显示。
   任何一条失败都意味着外城市的时刻会整体平移「浏览器偏移 − 城市偏移」那么多。 */
import { sunEvents } from "../src/core/astro";
import {
  wallIsoToReal, fmtClock, tzLabel, offsetAt, todayInTz,
  estimateOffsetSec, addDaysIso, type TzInfo
} from "../src/core/tz";
import { makeSeries } from "../src/core/series";
import { snapEncode, snapDecode } from "../src/core/snap";

type Case = { name: string; run: () => unknown; want: unknown };
const cases: Case[] = [];
const eq = (name: string, run: () => unknown, want: unknown) =>
  cases.push({ name, run, want });

const NY: TzInfo = { iana: "America/New_York", offsetSec: -4 * 3600, est: false };
const BJ: TzInfo = { iana: "Asia/Shanghai", offsetSec: 8 * 3600, est: false };
const TK: TzInfo = { iana: "Asia/Tokyo", offsetSec: 9 * 3600, est: false };
const utcDay = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

/* ---- 1. 墙钟字符串 → 真实时间戳 ---- */
eq("纽约墙钟 18:00 → 22:00Z", () => new Date(wallIsoToReal("2026-10-21T18:00", -14400)).toISOString(),
  "2026-10-21T22:00:00.000Z");
eq("北京墙钟 18:00 → 10:00Z", () => new Date(wallIsoToReal("2026-10-21T18:00", 28800)).toISOString(),
  "2026-10-21T10:00:00.000Z");
eq("带 Z 后缀按原样解析", () => wallIsoToReal("2026-10-21T22:00:00Z", -14400),
  Date.UTC(2026, 9, 21, 22, 0, 0));

/* ---- 2. 序列取值：查询时刻若落在当地 18:00，必须拿到 18:00 那一格 ---- */
function seriesAtLocalHour(off: number, hour: number, queryRealMs: number): number | null {
  const times: string[] = [];
  const vis: number[] = [];
  for (let h = 0; h < 24; h++) {
    times.push("2026-10-21T" + String(h).padStart(2, "0") + ":00");
    vis.push(1000 + h);               /* 每格一个可辨识值 */
  }
  const s = makeSeries({ hourly: { time: times, visibility: vis }, utc_offset_seconds: off, timezone: "" });
  return s.at("visibility", queryRealMs);
}
/* 纽约 18:06 EDT = 22:06Z → 应落在「当地 18 时 ~ 19 时」这一格之间，
   而不是被钳到序列末尾（修好之前这里恒为最后一格 23 时） */
const bucket = (v: number | null) => (v == null ? null : Math.floor(v - 1000));
eq("纽约日落时刻落在当地 18 时这一格",
  () => bucket(seriesAtLocalHour(-14400, 18, Date.UTC(2026, 9, 21, 22, 6))), 18);
/* 东京 16:58 JST = 07:58Z → 当地 16 时这一格（修好之前会取到 15 时，早一小时） */
eq("东京日落时刻落在当地 16 时这一格",
  () => bucket(seriesAtLocalHour(32400, 17, Date.UTC(2026, 9, 21, 7, 58))), 16);
/* 反证：整点查询必须命中整点值本身（不是插值近似） */
eq("整点查询命中整点值",
  () => seriesAtLocalHour(-14400, 18, Date.UTC(2026, 9, 21, 22, 0)), 1018);

/* ---- 3. 太阳事件 + 按城市时区显示（2026-10-21 的真实天文值） ---- */
function sunset(off: number, lat: number, lon: number): string {
  const ev = sunEvents(utcDay(2026, 10, 21) - off * 1000, lat, lon);
  return fmtClock(ev.setMs!, { iana: null, offsetSec: off, est: false }, false);
}
eq("北京 2026-10-21 日落 17:26", () => sunset(28800, 39.9042, 116.4074), "17:26");
eq("东京 2026-10-21 日落 16:58", () => sunset(32400, 35.6762, 139.6503), "16:58");
eq("纽约 2026-10-21 日落 18:06", () => sunset(-14400, 40.7128, -74.006), "18:06");
eq("北京 12 小时制 17:26 → 05:26 PM",
  () => fmtClock(sunEvents(utcDay(2026, 10, 21) - 28800000, 39.9042, 116.4074).setMs!, BJ, true),
  "05:26 PM");

/* ---- 4. 时区标签 ---- */
eq("UTC+8", () => tzLabel(BJ), "UTC+8");
eq("UTC−4", () => tzLabel(NY), "UTC\u22124");
eq("UTC+5:30", () => tzLabel({ iana: "Asia/Kolkata", offsetSec: 19800, est: false }), "UTC+5:30");
eq("UTC−3:30", () => tzLabel({ iana: "America/St_Johns", offsetSec: -12600, est: false }), "UTC\u22123:30");

/* ---- 5. 夏令时：同一城市夏冬偏移不同（IANA 名才算得对） ---- */
eq("纽约 7 月偏移 −4h", () => offsetAt("America/New_York", Date.UTC(2026, 6, 1, 12)), -14400);
eq("纽约 12 月偏移 −5h", () => offsetAt("America/New_York", Date.UTC(2026, 11, 1, 12)), -18000);
eq("伦敦 7 月偏移 +1h", () => offsetAt("Europe/London", Date.UTC(2026, 6, 1, 12)), 3600);

/* ---- 6. 经度估算：中国全境必须统一 +8（不能被经度带偏） ---- */
eq("乌鲁木齐估算 +8", () => estimateOffsetSec(43.8, 87.6), 28800);
eq("拉萨估算 +8", () => estimateOffsetSec(29.65, 91.1), 28800);
eq("纽约估算 −5", () => estimateOffsetSec(40.7, -74), -18000);
eq("东京估算 +9", () => estimateOffsetSec(35.7, 139.7), 32400);

/* ---- 7. 城市当地「今天」 ---- */
const now = Date.UTC(2026, 9, 21, 2, 51); /* 北京 10:51 / 纽约 10-20 22:51 */
eq("北京此刻是 10-21", () => todayInTz(BJ, now), "2026-10-21");
eq("纽约此刻还是 10-20", () => todayInTz(NY, now), "2026-10-20");
eq("日期加天", () => addDaysIso("2026-10-31", 1), "2026-11-01");
eq("日期减天", () => addDaysIso("2026-03-01", -1), "2026-02-28");

/* ---- 8. 快照：新快照带真实时区，老快照不再被假 480 带偏 ---- */
const snapIn = {
  dateStr: "2026-10-21", period: "pm", lat: 40.7128, lon: -74.006,
  name: "纽约", region: "", P: 62, Q: 64, consist: 70,
  offsetS: -14400, primaryLevel: 1, primaryType: "卷云", primaryBase: 6.17,
  dKm: 40, durMin: 9,
  factors: [{ k: "cover", v: 40, s: 0.5 }]
};
eq("新快照往返保住真实时区", () => snapDecode(snapEncode(snapIn))?.tzMin, -240);
/* 手工造一条老格式（21 字段、tzMin 恒 480）的快照，解码应按坐标重算 */
function legacySnap(): string {
  const f = [
    "1", "abc", "2026-10-21", "pm", "40.7128", "-74.0060", "纽约", "",
    "62", "64", "70", "", "", "", "480", "1", "6", "6.17", "40.0", "9", ""
  ];
  return Buffer.from(f.join("|"), "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
eq("老快照忽略假 480，按坐标重算", () => snapDecode(legacySnap())?.tzMin, -300);
eq("老快照其余字段仍可读", () => snapDecode(legacySnap())?.P, 62);

/* ---- 跑 ---- */
let pass = 0;
const fails: string[] = [];
for (const c of cases) {
  let got: unknown, err = "";
  try { got = c.run(); } catch (e) { err = String(e); }
  const okRun = !err && JSON.stringify(got) === JSON.stringify(c.want);
  if (okRun) { pass++; console.log("  ✓ " + c.name); }
  else {
    fails.push(c.name);
    console.log("  ✗ " + c.name + "\n      want " + JSON.stringify(c.want) + "\n      got  " + JSON.stringify(err || got));
  }
}
console.log("\n结果：" + pass + " 通过 / " + fails.length + " 失败");
process.exit(fails.length ? 1 : 0);
