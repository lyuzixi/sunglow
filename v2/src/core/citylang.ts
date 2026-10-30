/* =========================================================================
   SUNGLOW v2 · 城市名的取词与拼串（手写，不参与生成）
   -------------------------------------------------------------------------
   数据表在 cityname.ts（由 scripts/gen-cityname.mjs 生成，勿手改）。
   这里只做三件事：
     1. 按当前语言从表里取显示名（查不到就回中文原名 —— 宁可中文，不要空）
     2. 「城市 · 省区」拼串，各处显示点共用同一口径
     3. 把生成式点位名（「广州市 东南 30 km」）拆开、逐段本地化
   ========================================================================= */
import { getLang, t, type Lang } from "./i18n";
import { EN_CITY, EN_REGION, TW_CITY, TW_REGION } from "./cityname";

/** 城市名按语言取显示名。未知城市原样返回。 */
export function cityName(zh: string, lang: Lang = getLang()): string {
  if (!zh) return zh;
  if (lang === "en") return EN_CITY[zh] || zh;
  if (lang === "hant") return TW_CITY[zh] || zh;
  return zh;
}

/** 省区 / 国家名按语言取显示名 */
export function regionName(zh: string, lang: Lang = getLang()): string {
  if (!zh) return zh;
  if (lang === "en") return EN_REGION[zh] || zh;
  if (lang === "hant") return TW_REGION[zh] || zh;
  return zh;
}

/** 「城市 · 省区」拼成一行；省区为空时只给城市（海外城市与「我的位置」常见） */
export function cityWithRegion(
  nameZh: string, regionZh: string, lang: Lang = getLang()
): string {
  const n = cityName(nameZh, lang);
  const r = regionName(regionZh, lang);
  return r ? n + " · " + r : n;
}

/* ---------------- 搜索别名 ----------------
   英文名与繁体名都进 city.ts 的检索索引，让小写英文 / 繁体输入也能命中。
   城市表优先，同一条也当省区用（省区表里的条目同样能检索）。 */
export function searchAliases(zh: string): string[] {
  if (!zh) return [];
  const out: string[] = [];
  const en = EN_CITY[zh] || EN_REGION[zh];
  if (en) out.push(en.toLowerCase().replace(/[^a-z]/g, ""));
  const tw = TW_CITY[zh] || TW_REGION[zh];
  if (tw && tw !== zh) out.push(tw);
  return out;
}

/* ---------------- 生成式点位名 ----------------
   网格点名字是拼出来的：「广州市」「广州市附近」「广州市 东南 30 km」。
   整串查词典必然查不到，只能把「城市名 + 后缀」拆开，各自本地化再拼回去。 */
const NEAR_RE = /^(.+?)附近$/;
const OFFSET_RE = /^(.+?)\s+(东北|西北|东南|西南|东|西|南|北)\s+(\d+)\s*km$/;
const MY_POS = "我的位置";

export function pointName(zh: string, lang: Lang = getLang()): string {
  if (!zh) return zh;
  if (zh === MY_POS) return t(MY_POS);
  const n = NEAR_RE.exec(zh);
  if (n) {
    /* 「广州附近」/“Guangzhou nearby”：中文直接拼，拉丁字母加空格 */
    const near = t("附近");
    return cityName(n[1], lang) + (/^[A-Za-z]/.test(near) ? " " : "") + near;
  }
  const o = OFFSET_RE.exec(zh);
  if (o) return cityName(o[1], lang) + " " + t(o[2]) + " " + o[3] + " km";
  return cityName(zh, lang);
}
