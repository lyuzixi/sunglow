/* =========================================================================
   SUNGLOW v2 · 全功能快照包（2026-11-11）
   ---------------------------------------------------------------------------
   旧的 snap= 只有结论卡的 21 个字段，打开后是一张孤立的「快照结果卡」：
   趋势、观测场、影响因素全都看不到，等于把主页砍掉八成。
   这一版把分享者本地**已经缓存的全部板块**一起打包进链接：
     · 单点结论（ForecastResult）—— 结论卡 / 影响因素 / 光追 / 分享卡都靠它
     · 十日趋势（TrendRow[]）
     · 观测场（MapDateBox，121 点 × 朝/晚）
     · 多观测点对比列表
   被分享者打开后**直接是完整主页**：包内条目以内存 overlay 的形式排在
   localStorage 前面，六个缓存读取入口优先读它，因此各板块照常显示
   「缓存 · …」提示，且不发一个请求、不烧额度。overlay 不写入
   localStorage，绝不覆盖被分享者自己的缓存。

   体积控制：观测场原始 148 KB，直接塞进 URL 不现实（实测线上站点查询串
   超过 8 KB 就 414）。做法是把 MapPoint 压成「字符串表 + 量化整数行」，
   再整体 deflate + base64url，放进 **hash 查询串** `#/?pack=…`
   （本项目本就是 hash 路由，hash 不发给服务器，彻底绕开请求行长度限制）。
   仍设 7600 字符软上限：超了就先减其它板块、再把观测场按 stride 抽稀，
   保证微信/短信里发出去的链接不至于长到被截断。
   ========================================================================= */
import { ref } from "vue";
import { clamp, isNum } from "./math";

export const PACK_PARAM = "pack";
/** 生成的 pack 字符数软上限（超过就逐级降精度） */
export const PACK_MAX_CHARS = 7600;
/** 二维码（qrcode-generator，L 级）单码上限约 2.9 KB，超了就用精简链接 */
const QR_MAX_URL = 2600;
export function qrSafeUrl(url: string): string {
  return url && url.length > QR_MAX_URL ? url.split("#")[0] : url;
}
/** 解码前的硬上限，防止恶意超长串卡住主线程 */
const PACK_HARD_MAX = 40000;
/** 缓存族白名单：包里只允许这些键，绝不写任意 localStorage 键 */
const FAMILIES = ["SUNGLOW.v2.point.", "SUNGLOW.v2.trend.", "SUNGLOW.v2.map."];
const CMP_KEY = "SUNGLOW.v2.cmp.v1";

export interface SnapPackInfo {
  gen: number;
  /** 已打包的板块：point / trend / map / compare */
  parts: string[];
  name: string;
  date: string;
  period: string;
  mapDate: string;
  /** 观测场抽稀步长，1 = 完整 121 点 */
  mapStride: number;
  entries: number;
}

/** 快照包就绪戳：子组件 onMounted 早于父组件的异步解码，靠它补一次缓存读取 */
export const snapshotReady = ref(0);
/** 当前快照信息（null = 普通模式），横幅与门禁都读它 */
export const snapInfo = ref<SnapPackInfo | null>(null);

const entries = new Map<string, unknown>();
let activeRaw = "";

export function isSnapshot(): boolean { return snapInfo.value !== null; }
export function activePackRaw(): string { return activeRaw; }

/** 缓存读取入口统一走这里：命中就返回该条目的原始 localStorage 包装对象 */
export function snapCacheEntry(key: string): Record<string, unknown> | null {
  if (!snapInfo.value) return null;
  const v = entries.get(key);
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}
/** 快照数据不参与 6h TTL：本地这份是刚装进来的，年龄按「刚刚」报 */
export function snapCacheAge(key: string): number | null {
  return snapCacheEntry(key) ? 0 : null;
}
export function snapCmpList(): unknown[] | null {
  if (!snapInfo.value) return null;
  const v = entries.get(CMP_KEY);
  return Array.isArray(v) ? v : null;
}

/* ---------------------------------------------------------------- base64url */
function bytesToB64u(b: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64uToBytes(s: string): Uint8Array {
  let t = String(s || "").replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------- deflate/inflate */
async function deflate(u8: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const cs = new CompressionStream("deflate");
    const w = cs.writable.getWriter();
    void w.write(u8 as unknown as BufferSource);
    void w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  } catch { return null; }
}
async function inflate(u8: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const ds = new DecompressionStream("deflate");
    const w = ds.writable.getWriter();
    void w.write(u8 as unknown as BufferSource);
    void w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  } catch { return null; }
}

/* --------------------------------------------------- 观测场紧凑行（协议固定） */
/* 每行 32 个整数；字段顺序即协议，改动必须同步升 PACK_V。
   0/1 字符串表索引，2/3 经纬度（×100），4..28 量化值，29..31 字符串表索引。
   255 在「可空」字段上表示 null。 */
const ROW_LEN = 32;
interface CompactMap {
  m: 1;
  s: string[];
  r: number[][];
  n: [string, string];
  d: string;
  na: number;
  ds: number;
}
const qv = (v: unknown, scale = 1, nullable = false): number => {
  if (!isNum(v)) return nullable ? 255 : 0;
  return clamp(Math.round((v as number) * scale), 0, nullable ? 254 : 255);
};
const dqv = (v: number, scale = 1, nullable = false): number | null =>
  nullable && v >= 255 ? null : v / scale;

function compactMap(w: Record<string, unknown>, stride: number): CompactMap | null {
  const obj = w.obj as {
    am?: { pts: Array<Record<string, unknown>>; note?: string; dateS?: string };
    pm?: { pts: Array<Record<string, unknown>>; note?: string };
  } | undefined;
  if (!obj || !obj.am || !obj.pm || !Array.isArray(obj.am.pts) || !Array.isArray(obj.pm.pts)) return null;
  const s: string[] = [];
  const ix = new Map<string, number>();
  const si = (v: unknown): number => {
    const k = String(v ?? "");
    if (!ix.has(k)) { ix.set(k, s.length); s.push(k); }
    return ix.get(k) as number;
  };
  const row = (p: Record<string, unknown>): number[] => {
    const pp = (p.p || {}) as Record<string, unknown>;
    const qq = (p.q || {}) as Record<string, unknown>;
    const cv = (p.covers || []) as unknown[];
    return [
      si(p.name), si(p.prov),
      Math.round((isNum(p.lat) ? (p.lat as number) : 0) * 100),
      Math.round((isNum(p.lon) ? (p.lon as number) : 0) * 100),
      qv(p.P), qv(p.Q),
      qv(pp.ens), qv(pp.gfs, 1, true), qv(pp.ec, 1, true), qv(pp.rt), qv(pp.ref, 1, true),
      qv(qq.ens), qv(qq.gfs, 1, true), qv(qq.ec, 1, true), qv(qq.rt), qv(qq.ref, 1, true),
      qv(p.cover), qv(cv[0]), qv(cv[1]), qv(cv[2]),
      qv(p.base, 10), qv(p.d, 0.5, true), qv(p.dur), qv(p.aod, 100),
      qv(p.cld), qv(p.T550), qv(p.occ), qv(p.ref), qv(p.refGap),
      si(p.grade), si(p.type), si(p.color)
    ];
  };
  const thin = (arr: Array<Record<string, unknown>>) =>
    stride <= 1 ? arr : arr.filter((_, i) => i % stride === 0);
  const am = thin(obj.am.pts), pm = thin(obj.pm.pts);
  return {
    m: 1, s,
    r: [...am.map(row), ...pm.map(row)],
    n: [String(obj.am.note || ""), String(obj.pm.note || "")],
    d: String(obj.am.dateS || ""),
    na: am.length,
    ds: stride
  };
}

function expandMap(c: CompactMap): Record<string, unknown> | null {
  if (!c || c.m !== 1 || !Array.isArray(c.r) || !Array.isArray(c.s)) return null;
  const s = (i: number) => String(c.s[i] ?? "");
  const mk = (rows: number[][], period: "am" | "pm", note: string) => ({
    dateS: c.d, period, note,
    pts: rows.map((r) => {
      if (!Array.isArray(r) || r.length < ROW_LEN) return null;
      const nn = (v: number, scale = 1, nullable = false) => dqv(v, scale, nullable);
      return {
        name: s(r[0]), prov: s(r[1]), lat: r[2] / 100, lon: r[3] / 100,
        P: r[4], Q: r[5],
        p: { ens: r[6], gfs: nn(r[7]), ec: nn(r[8]), rt: r[9], ref: nn(r[10]) },
        q: { ens: r[11], gfs: nn(r[12]), ec: nn(r[13]), rt: r[14], ref: nn(r[15]) },
        grade: s(r[29]), type: s(r[30]), cover: r[16],
        covers: [r[17], r[18], r[19]],
        base: r[20] / 10,
        d: nn(r[21]) == null ? null : (nn(r[21]) as number) * 2,
        dur: r[22], aod: r[23] / 100, cld: r[24], T550: r[25],
        color: s(r[31]), occ: r[26], ref: r[27], refGap: r[28]
      };
    }).filter(Boolean)
  });
  const na = clamp(isNum(c.na) ? c.na : 0, 0, c.r.length);
  return {
    am: mk(c.r.slice(0, na), "am", String(c.n?.[0] || "")),
    pm: mk(c.r.slice(na), "pm", String(c.n?.[1] || ""))
  };
}

/* --------------------------------------------------------------- 收集条目 */
export interface PackQuery {
  lat: number; lon: number;
  date: string; period: string;
  mapDate: string;
  name: string;
}
interface Candidate { key: string; rank: number }

function lsKeys(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) out.push(k);
    }
  } catch { /* 隐私模式 */ }
  return out;
}
function readEntry(k: string): unknown {
  try {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** 按当前查询挑出要打包的键：本坐标的单点/趋势/观测场 + 对比点缓存 */
function collect(q: PackQuery): string[] {
  const keys = lsKeys();
  const coord = "@" + q.lat.toFixed(1) + "," + q.lon.toFixed(1);
  const rank = (k: string): number => {
    if (k.startsWith("SUNGLOW.v2.point.")) {
      if (k.includes(q.date + "|" + q.period + coord)) return 0;
      if (k.includes(q.date) && k.includes(coord)) return 1;
      if (k.includes(coord)) return 2;
      return 6;
    }
    if (k.startsWith("SUNGLOW.v2.trend.")) return k.includes(q.date) && k.includes(coord) ? 3 : 7;
    if (k.startsWith("SUNGLOW.v2.map.")) return k.includes(q.mapDate) && k.includes(coord) ? 4 : 8;
    return 9;
  };
  const cmpRaw = readEntry(CMP_KEY);
  const cmpPts = Array.isArray(cmpRaw)
    ? (cmpRaw as Array<{ lat?: number; lon?: number }>).slice(0, 4)
    : [];
  const cand: Candidate[] = [];
  for (const k of keys) {
    if (!FAMILIES.some((f) => k.startsWith(f))) continue;
    let r = rank(k);
    if (r >= 6 && k.startsWith("SUNGLOW.v2.point.") &&
        cmpPts.some((p) => isNum(p.lat) && isNum(p.lon) &&
          k.includes("@" + (p.lat as number).toFixed(1) + "," + (p.lon as number).toFixed(1)))) r = 5;
    if (r <= 5) cand.push({ key: k, rank: r });
  }
  cand.sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));
  /* 每个族各留一点余量，多带几份单点结果能让被分享者切朝/晚也不取数 */
  const out: string[] = [];
  const perFamily: Record<string, number> = {};
  for (const c of cand) {
    const fam = FAMILIES.find((f) => c.key.startsWith(f)) || "";
    perFamily[fam] = (perFamily[fam] || 0) + 1;
    const cap = fam.includes(".point.") ? 8 : fam.includes(".trend.") ? 2 : 1;
    if (perFamily[fam] > cap) continue;
    out.push(c.key);
  }
  if (cmpRaw) out.push(CMP_KEY);
  return out;
}

function partsOf(keys: string[]): string[] {
  const p: string[] = [];
  if (keys.some((k) => k.startsWith("SUNGLOW.v2.point."))) p.push("point");
  if (keys.some((k) => k.startsWith("SUNGLOW.v2.trend."))) p.push("trend");
  if (keys.some((k) => k.startsWith("SUNGLOW.v2.map."))) p.push("map");
  if (keys.includes(CMP_KEY)) p.push("compare");
  return p;
}

interface PackObj {
  v: 2;
  g: number;
  q: { n: string; d: string; p: string; md: string; la: number; lo: number };
  e: Array<[string, unknown]>;
}

async function encodePack(obj: PackObj): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  const z = await deflate(bytes);
  /* z = deflate；j = 未压缩 JSON（老浏览器没有 CompressionStream 时的兜底） */
  return z ? "z" + bytesToB64u(z) : "j" + bytesToB64u(bytes);
}

/**
 * 打包：先全量试，超长就按「少带条目 → 观测场抽稀 → 去掉观测场」逐级退。
 * 返回 null 表示连单点结果都没有（此时仍可用旧的精简 snap= 链接）。
 */
export async function buildSharePack(q: PackQuery): Promise<{
  pack: string; info: SnapPackInfo;
} | null> {
  const all = collect(q);
  if (!all.some((k) => k.startsWith("SUNGLOW.v2.point."))) return null;
  const steps: Array<{ maxExtra: number; stride: number; keepMap: boolean }> = [
    { maxExtra: 99, stride: 1, keepMap: true },
    { maxExtra: 4, stride: 1, keepMap: true },
    { maxExtra: 1, stride: 2, keepMap: true },
    { maxExtra: 1, stride: 3, keepMap: true },
    { maxExtra: 1, stride: 1, keepMap: false }
  ];
  let best: { pack: string; info: SnapPackInfo } | null = null;
  for (const st of steps) {
    const keys = all.filter((k) => {
      if (k === CMP_KEY) return true;
      if (!st.keepMap && k.startsWith("SUNGLOW.v2.map.")) return false;
      return true;
    });
    /* 按优先级顺序留下前 (maxExtra+2) 个单点键；collect 已把当天朝/晚排在最前 */
    let pn = 0;
    const finalKeys = keys.filter((k) => {
      if (!k.startsWith("SUNGLOW.v2.point.")) return true;
      pn++;
      return pn <= st.maxExtra + 2;
    });
    const e: Array<[string, unknown]> = [];
    for (const k of finalKeys) {
      const v = readEntry(k);
      if (v == null) continue;
      if (k.startsWith("SUNGLOW.v2.map.")) {
        const cm = compactMap(v as Record<string, unknown>, st.stride);
        if (!cm) continue;
        e.push([k, { ts: (v as { ts?: number }).ts || Date.now(), cm }]);
      } else e.push([k, v]);
    }
    const parts = partsOf(e.map((x) => x[0]));
    const obj: PackObj = {
      v: 2, g: Date.now(),
      q: { n: q.name, d: q.date, p: q.period, md: q.mapDate, la: q.lat, lo: q.lon },
      e
    };
    const pack = await encodePack(obj);
    const info: SnapPackInfo = {
      gen: obj.g, parts, name: q.name, date: q.date, period: q.period,
      mapDate: q.mapDate, mapStride: parts.includes("map") ? st.stride : 0,
      entries: e.length
    };
    best = { pack, info };
    if (pack.length <= PACK_MAX_CHARS) break;
  }
  return best;
}

/* ------------------------------------------------------------------ 安装 */
function allowedKey(k: string): boolean {
  return FAMILIES.some((f) => k.startsWith(f)) || k === CMP_KEY;
}

/** 解码并安装快照包；必须在主页取数前 await。返回是否真的进入了快照模式。 */
export async function installSharePack(raw: string | null | undefined): Promise<boolean> {
  entries.clear();
  activeRaw = "";
  snapInfo.value = null;
  if (!raw || raw.length > PACK_HARD_MAX) return false;
  const mode = raw[0];
  let bytes: Uint8Array | null = null;
  if (mode === "z") bytes = await inflate(b64uToBytes(raw.slice(1)));
  else if (mode === "j") bytes = b64uToBytes(raw.slice(1));
  if (!bytes) return false;
  let obj: PackObj;
  try { obj = JSON.parse(new TextDecoder().decode(bytes)) as PackObj; } catch { return false; }
  if (!obj || obj.v !== 2 || !Array.isArray(obj.e) || obj.e.length > 40 || !obj.q) return false;
  for (const pair of obj.e) {
    if (!Array.isArray(pair) || pair.length !== 2) return false;
    const [k, v] = pair;
    if (typeof k !== "string" || !allowedKey(k) || !v || typeof v !== "object") continue;
    if (k.startsWith("SUNGLOW.v2.map.")) {
      const cm = (v as { cm?: CompactMap }).cm;
      const box = cm ? expandMap(cm) : null;
      if (!box) continue;
      entries.set(k, { ts: (v as { ts?: number }).ts || obj.g, obj: box });
    } else entries.set(k, v);
  }
  if (!entries.size) return false;
  const parts = partsOf([...entries.keys()]);
  const mapCm = obj.e.find((p) => Array.isArray(p) && p[0] &&
    String(p[0]).startsWith("SUNGLOW.v2.map.") && (p[1] as { cm?: CompactMap })?.cm);
  const stride = mapCm ? (mapCm[1] as { cm: CompactMap }).cm.ds || 1 : 0;
  snapInfo.value = {
    gen: isNum(obj.g) ? obj.g : Date.now(),
    parts,
    name: String(obj.q.n || ""),
    date: String(obj.q.d || ""),
    period: String(obj.q.p || ""),
    mapDate: String(obj.q.md || ""),
    mapStride: stride,
    entries: entries.size
  };
  activeRaw = raw;
  snapshotReady.value++;
  return true;
}

/** 退出快照：清掉 overlay，URL 里的 pack 由调用方一起抹掉 */
export function exitSnapshot(): void {
  entries.clear();
  activeRaw = "";
  snapInfo.value = null;
  snapshotReady.value++;
}
