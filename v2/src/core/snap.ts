/* =========================================================================
   SUNGLOW v2 · 快照编解码（与V1格式互通）
   口径来源：V1 _p5.js snapEncode/snapDecode。SNAP_VER="1"，字段顺序即协议，
   与V1完全一致 —— 任一侧生成的快照链接双方都能解码。
   ========================================================================= */
import {
  b64uEnc, b64uDec, clamp, isNum, nz, safeLabel
} from "./math";
import { estimateOffsetSec } from "./tz";

export const SNAP_VER = "1";
export const SNAP_MAX = 2000;
export const SNAP_N_FAC = 4;

/** 因素白名单（与V1 SNAP_KEYS 完全一致） */
export const SNAP_KEYS = [
  "cover", "base", "heq", "heff", "dedge", "block",
  "aod", "vis", "rh", "stab", "wind", "cape"
] as const;

export const SNAP_TYPES = [
  "层云/雾", "层积云", "积云", "高积云", "高层云", "卷层云", "卷云"
] as const;

export interface SnapFactor { k: string; v: number | null; s: number | null }

export interface SnapInput {
  dateStr: string; period: string;
  lat: number; lon: number;
  name: string; region: string;
  P: number; Q: number;
  consist?: number | null;
  dvI?: number | null;
  spread?: number | null;
  spreadQ?: number | null;
  offsetS?: number | null;
  primaryLevel?: number | null;
  primaryType?: string | null;
  primaryBase?: number | null;
  dKm?: number | null;
  durMin?: number | null;
  factors?: SnapFactor[];
}

export interface SnapData {
  gen: number;
  date: string; period: string;
  lat: number; lon: number;
  name: string; region: string;
  P: number; Q: number;
  consist: number;
  dvI: number | null; spread: number | null; spreadQ: number | null;
  tzMin: number;
  deck: number;
  type: string | null;
  baseKm: number | null; dKm: number | null; durMin: number | null;
  factors: SnapFactor[];
}

export function snapEncode(r: SnapInput | null | undefined): string | null {
  if (!r || !isNum(r.P) || !isNum(r.Q)) return null;
  const fac = (r.factors || [])
    .filter(
      (x) =>
        (SNAP_KEYS as readonly string[]).indexOf(x.k) >= 0 &&
        isNum(x.v) && isNum(x.s)
    )
    .sort((a, b) => Math.abs((b.s as number) - 0.5) - Math.abs((a.s as number) - 0.5))
    .slice(0, SNAP_N_FAC)
    .map(
      (x) => x.k + "~" + +(x.v as number).toFixed(3) + "~" + +(x.s as number).toFixed(2)
    );
  const tIdx =
    r.primaryType != null
      ? (SNAP_TYPES as readonly string[]).indexOf(r.primaryType)
      : -1;
  const f = [
    SNAP_VER,
    Math.round(Date.now() / 1000).toString(36),
    r.dateStr, r.period,
    (+r.lat).toFixed(4), (+r.lon).toFixed(4),
    safeLabel(r.name || "", 24), safeLabel(r.region || "", 16),
    Math.round(clamp(r.P, 0, 100)), Math.round(clamp(r.Q, 0, 100)),
    Math.round(clamp(isNum(r.consist) ? r.consist : 0, 0, 100)),
    isNum(r.dvI) ? r.dvI.toFixed(1) : "",
    isNum(r.spread) ? Math.round(r.spread).toString() : "",
    isNum(r.spreadQ) ? Math.round(r.spreadQ).toString() : "",
    Math.round(isNum(r.offsetS) ? r.offsetS / 60 : 480),
    r.primaryLevel != null ? String(clamp(r.primaryLevel | 0, 0, 2)) : "",
    tIdx >= 0 ? String(tIdx) : "",
    isNum(r.primaryBase) ? r.primaryBase.toFixed(2) : "",
    isNum(r.dKm) ? r.dKm.toFixed(1) : "",
    isNum(r.durMin) ? Math.round(r.durMin).toString() : "",
    fac.join("!")
  ];
  /* 末尾追加第 22 位：真实 UTC 偏移（分钟）。老解码器只读前 21 位，多一位不影响互通；
     新解码器靠「字段数 = 22」区分「有真实时区」与「老快照的假 480」。 */
  if (isNum(r.offsetS)) f.push(String(Math.round((r.offsetS as number) / 60)));
  try {
    return b64uEnc(f.join("|"));
  } catch {
    return null;
  }
}

export function snapDecode(raw: unknown): SnapData | null {
  if (typeof raw !== "string" || !raw || raw.length > SNAP_MAX) return null;
  let txt = "";
  try {
    txt = b64uDec(raw);
  } catch {
    return null;
  }
  if (!txt || txt.length > 4000) return null;
  const f = txt.split("|");
  if (f.length < 21 || f[0] !== SNAP_VER) return null;
  const num = (v: string): number | null => {
    const x = parseFloat(v);
    return isNum(x) ? x : null;
  };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(f[2]) ? f[2] : null;
  const period = f[3] === "am" || f[3] === "pm" ? f[3] : null;
  const lat = num(f[4]), lon = num(f[5]);
  const P = num(f[8]), Q = num(f[9]);
  if (!date || !period || lat == null || lon == null || P == null || Q == null)
    return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const fac: SnapFactor[] = String(f[20] || "")
    .split("!")
    .filter(Boolean)
    .map((seg) => {
      const p = seg.split("~");
      return { k: p[0], v: num(p[1]), s: num(p[2]) } as unknown as SnapFactor;
    })
    .filter(
      (x) =>
        (SNAP_KEYS as readonly string[]).indexOf(x.k) >= 0 &&
        x.v != null && x.s != null
    )
    .slice(0, SNAP_N_FAC);
  const tRaw = /^\d$/.test(f[16]) ? parseInt(f[16], 10) : -1;
  const dRaw = /^[012]$/.test(f[15]) ? parseInt(f[15], 10) : -1;
  const g = parseInt(f[1], 36);
  /* 时区：老快照（21 字段）的 tzMin 恒写 480，那是程序缺陷留下的假值 ——
     不能信，按坐标重新估算；新快照（22 字段）末尾多一位真实偏移，才采纳。 */
  const tzNew = f.length >= 22 ? num(f[21]) : null;
  const tzMin = tzNew != null && Math.abs(tzNew) <= 1440
    ? tzNew
    : Math.round(estimateOffsetSec(lat ?? 0, lon ?? 0) / 60);
  return {
    gen: isNum(g) ? g * 1000 : 0,
    date, period, lat, lon,
    name: safeLabel(f[6] || "", 24) || "该地点",
    region: safeLabel(f[7] || "", 16),
    P: clamp(P, 0, 100), Q: clamp(Q, 0, 100),
    consist: clamp(nz(num(f[10]), 0), 0, 100),
    dvI: num(f[11]), spread: num(f[12]), spreadQ: num(f[13]),
    tzMin,
    deck: dRaw,
    type: tRaw >= 0 && tRaw < SNAP_TYPES.length ? SNAP_TYPES[tRaw] : null,
    baseKm: num(f[17]), dKm: num(f[18]), durMin: num(f[19]),
    factors: fac
  };
}
