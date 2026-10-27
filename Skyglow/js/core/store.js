/* P0 本地结果缓存：只存单日完整 payload，键 = 坐标 + 日期。
   TTL 按日期远近分层：当天 60 min / 次日 3 h / 更远 6 h。 */
const Store = (() => {
  const PREFIX = "skyglow.p0.point.";
  const MAP_PREFIX = "skyglow.p0.map.v6.";

  function ymd(d) {
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }
  function ttlFor(dateStr) {
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const sel = Date.parse(dateStr + "T00:00:00Z");
    const diff = Math.round((sel - today) / 86400000);
    if (diff <= 0) return 60 * 60;
    if (diff === 1) return 3 * 60 * 60;
    return 6 * 60 * 60;
  }
  function keyPoint(lat, lon, dateStr) {
    return PREFIX + lat.toFixed(3) + "." + lon.toFixed(3) + "." + dateStr;
  }
  function getPoint(lat, lon, dateStr) {
    try {
      const raw = localStorage.getItem(keyPoint(lat, lon, dateStr));
      if (!raw) return null;
      const j = JSON.parse(raw);
      if (!j || !j.v || !j.ts) return null;
      const ttl = ttlFor(dateStr);
      const age = Math.max(0, (Date.now() - j.ts) / 1000);
      if (age > ttl) { localStorage.removeItem(keyPoint(lat, lon, dateStr)); return null; }
      return { v: j.v, age, ttl };
    } catch (e) { return null; }
  }
  function putPoint(lat, lon, dateStr, payload) {
    try {
      localStorage.setItem(keyPoint(lat, lon, dateStr), JSON.stringify({ ts: Date.now(), v: payload }));
    } catch (e) { /* 配额不足时静默降级为无缓存 */ }
  }
  /* ---- 统计与分类清理：WeatherAPI Key / 额度不参与 ---- */
  function kindOf(k) {
    if (k.indexOf(PREFIX) === 0) return "point";
    if (k.indexOf(MAP_PREFIX) === 0) return "map";
    if (k.indexOf("skyglow:http") === 0) return "raw";
    return null;
  }
  function bytesOf(k, v) {
    try { return new Blob([k, v]).size; } catch (e) { return (k.length + v.length) * 2; }
  }
  function stats() {
    const out = { point: { n: 0, bytes: 0 }, map: { n: 0, bytes: 0 }, raw: { n: 0, bytes: 0 } };
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        const kind = kindOf(k);
        if (!kind) continue;
        out[kind].n++;
        out[kind].bytes += bytesOf(k, localStorage.getItem(k) || "");
      }
    } catch (e) { /* ignore */ }
    out.total = {
      n: out.point.n + out.map.n + out.raw.n,
      bytes: out.point.bytes + out.map.bytes + out.raw.bytes,
    };
    return out;
  }
  function clear(kind) {
    const want = kind || "all";
    try {
      const del = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        const kd = kindOf(k);
        if (kd && (want === "all" || want === kd)) del.push(k);
      }
      del.forEach(k => localStorage.removeItem(k));
      return del.length;
    } catch (e) { return 0; }
  }

  /* ---- 地图场：只存 probs / grades，TTL 全国 6 h、城市 3 h ---- */
  function mapKey(scope, dateStr, mode, lat, lon) {
    const base = MAP_PREFIX + scope + "." + dateStr + "." + mode;
    return scope === "national" ? base : base + "." + lat.toFixed(3) + "." + lon.toFixed(3);
  }
  function mapTtl(scope) { return scope === "national" ? 6 * 3600 : 3 * 3600; }
  function getMap(scope, dateStr, mode, lat, lon) {
    try {
      const raw = localStorage.getItem(mapKey(scope, dateStr, mode, lat, lon));
      if (!raw) return null;
      const j = JSON.parse(raw);
      if (!j || !j.v || !j.ts) return null;
      const ttl = mapTtl(scope);
      const age = Math.max(0, (Date.now() - j.ts) / 1000);
      if (age > ttl) { localStorage.removeItem(mapKey(scope, dateStr, mode, lat, lon)); return null; }
      return { v: j.v, age, ttl };
    } catch (e) { return null; }
  }
  function putMap(scope, dateStr, mode, lat, lon, payload) {
    try {
      localStorage.setItem(mapKey(scope, dateStr, mode, lat, lon), JSON.stringify({ ts: Date.now(), v: payload }));
    } catch (e) { /* 配额不足时静默降级 */ }
  }
  return { ymd, ttlFor, keyPoint, getPoint, putPoint, clear, stats,
    mapKey, mapTtl, getMap, putMap };
})();
