const SUFFIX = ["特别行政区", "自治区", "自治州", "新区", "开发区", "地区", "林区",
  "省", "市", "区", "县", "旗", "盟", "镇", "乡", "街道"];

function splitAdmin(text) {
  const segs = []; let buf = "", i = 0;
  while (i < text.length) {
    buf += text[i];
    let hit = null;
    for (const suf of SUFFIX) if (text.startsWith(suf, i + 1)) { hit = suf; break; }
    if (hit && buf.length >= 2) {
      segs.push(buf + hit); buf = ""; i += 1 + hit.length; continue;
    }
    i++;
  }
  if (buf) { if (segs.length) segs[segs.length - 1] += buf; else segs.push(buf); }
  return segs;
}
function stripAdmin(t) {
  for (const suf of SUFFIX) if (t.endsWith(suf) && t.length - suf.length >= 2) return t.slice(0, -suf.length);
  return t;
}

async function geocode(q) {
  const raw = (q || "").trim();
  if (!raw) return [];
  const parts = raw.split(/[\s,，、/]+/).filter(Boolean).sort((a, b) => b.length - a.length);
  const terms = [];
  const add = t => { if (t && t.length >= 2 && !terms.includes(t)) terms.push(t); };
  for (const p of parts) {
    const segs = splitAdmin(p);
    [...segs].reverse().forEach(add);
    [...segs].reverse().forEach(s => add(stripAdmin(s)));
    add(p);
  }
  if (!terms.includes(raw)) terms.push(raw);

  const chinese = /[\u4e00-\u9fa5]/.test(raw);
  let pool = [];
  for (const t of terms) {
    try {
      const url = OM_GEO + "?name=" + encodeURIComponent(t) + "&count=8&language=zh&format=json";
      const d = await getJSON(url, 7 * 86400000);
      pool = d.results || [];
    } catch (e) { pool = []; }
    if (pool.length) break;
  }
  let out = pool.map(r => ({
    name: r.name, admin: r.admin1 || "", country: r.country || "",
    lat: r.latitude, lon: r.longitude, population: r.population || 0,
  }));
  if (chinese) {
    const cn = out.filter(x => x.country === "中国");
    if (cn.length) out = cn;
  }
  out.sort((a, b) => (b.population || 0) - (a.population || 0));
  return out;
}
const SkyglowGeocode = { search: geocode };
