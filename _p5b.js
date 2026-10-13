/* =========================================================================
   Part 5b：结果渲染
   ========================================================================= */
function pct(v) { return Math.round(v) + "%"; }
function n1(v, d) { return isNum(v) ? (Math.abs(v) >= 100 ? v.toFixed(d == null ? 0 : d) : v.toFixed(d == null ? 1 : d)) : "—"; }

/* =========================================================================
   单位制与时间制（F7）
   -------------------------------------------------------------------------
   只影响**展示**，不影响任何计算或判定阈值：评分内部一律用公制
   （m / km / m/s / ℃）跑完全程，避免"换个单位结论就变了"这种最糟糕的行为。
   温度以前根本没有在界面上出现 —— 单位切换就落不到实处，所以顺带把
   参与计算的环境要素（温度/露点/湿度/风/气压）显示出来，让结论可复核。
   ========================================================================= */
function imperial() { return typeof State !== "undefined" && State.units === "imperial"; }
/* 高度（输入 m） */
function uAlt(m) {
  if (!isNum(m)) return "—";
  return imperial() ? Math.round(m * 3.28084) + " ft" : Math.round(m) + " m";
}
/* 距离（输入 km） */
function uDist(km, d) {
  if (!isNum(km)) return "—";
  return imperial() ? (km * 0.621371).toFixed(d == null ? 0 : d) + " mi" : km.toFixed(d == null ? 0 : d) + " km";
}
/* 速度（输入 m/s） */
function uSpeed(ms, d) {
  if (!isNum(ms)) return "—";
  return imperial() ? (ms * 2.236936).toFixed(d == null ? 1 : d) + " mph" : ms.toFixed(d == null ? 1 : d) + " m/s";
}
/* 温度（输入 ℃） */
function uTemp(c, d) {
  if (!isNum(c)) return "—";
  return imperial() ? (c * 9 / 5 + 32).toFixed(d == null ? 1 : d) + " °F" : c.toFixed(d == null ? 1 : d) + " °C";
}
/* 时刻（输入"当天小时数"小数）：12 小时制与 24 小时制 */
function uClock(hf) {
  if (!isNum(hf)) return "—";
  if (!(typeof State !== "undefined" && State.hour12)) return fmtHM(hf);
  const h24 = Math.floor(hf) % 24, m = Math.round((hf - Math.floor(hf)) * 60);
  const suf = h24 < 12 ? "AM" : "PM";
  const h12 = (h24 % 12) === 0 ? 12 : (h24 % 12);
  return h12 + ":" + pad2(m === 60 ? 0 : m) + " " + suf;
}

function renderAll(r) {
  renderHero(r);
  renderModels(r);
  renderFactors(r);
  renderRay(r);
  renderNotes(r);
  /* 有结果了才放开分享卡按钮（初始 disabled 写在模板里） */
  const b = $("#shareCard");
  if (b) b.disabled = false;
}

/* 结论文案的唯一来源 —— 结论卡与分享卡共用，阈值只在这里出现一次 */
function conclOf(P) {
  if (P < 12) return i18n("出现霞光的可能性很低");
  if (P < 30) return i18n("有一定机会，但条件不够理想");
  if (P < 55) return i18n("较可能出现，值得留意");
  if (P < 78) return i18n("很可能出现，建议安排观赏");
  return i18n("出现霞光的可能性很高");
}

/* 可信度徽标（B2）：把原先散落在附注、因素表、地图维度里的"分歧"收敛成结论卡顶部的
   一枚徽标 —— 用户第一眼就能看到"这个结论该信到什么程度"，而不必翻到因素表最后一行。
   档位与配色唯一来自 ENS_CONF_BANDS；ΔI 与"一致性 %"同源（都取自 parts 的 I 极差）。 */
function confBadge(r) {
  const cf = confText(r.conf || ensConfOf(r.dvI));
  const d = isNum(r.dvI) ? "ΔI " + Math.round(r.dvI) : "ΔI —";
  const pTxt = isNum(r.spread) && isNum(r.spreadQ)
    ? " · ΔP " + Math.round(r.spread) + " / ΔQ " + Math.round(r.spreadQ) : "";
  return `<span class="cfbadge" style="--cfb:${cf.color};--cfbg:${cf.bg};--cfbd:${cf.bd}" title="${cf.hint}">
    <i></i>${i18n("可信度")} <b>${cf.lv}</b>
    <span class="cfsm">${cf.txt} · ${d}${pTxt} · ${i18n("一致性 {v}%", { v: Math.round(r.consist) })}</span>
  </span>`;
}

function renderHero(r) {
  const grade = gradeOf(r.Q), col = gradeColor(grade);
  const isAM = r.period === "am";
  const evName = i18n(isAM ? "日出" : "日落");
  const evMs = isAM ? r.ev.riseMs : r.ev.setMs;
  const evLocal = isNum(evMs) ? uClock(((evMs + r.offsetS * 1000) / 3600000 % 24 + 24) % 24) : "—";
  const p = r.sRT.primary;
  const decks = r.sRT.decks;
  const deckTxt = ["低云", "中云", "高云"].map((nm, i) => i18n(nm) + " " + Math.round(decks[i].cover) + "%").join(" / ");
  /* B3：三套算法各自的综合指数 I 并列摊开 —— 此前只说"一致性 62%"，
     用户看不到究竟是哪一家把结论拉开了。I 与徽标里的 ΔI 同源（都由 mixedIndex(P,Q) 得来），
     所以两处可以直接对账。 */
  const partTxt = r.parts.map(x => ({ gfs: "GFS", ec: "EC", rt: "光追" }[x.k] + " " + Math.round(x.I))).join(" · ");

  const concl = conclOf(r.P);
  /* 等级文案唯一取自 gradeOf / QUALITY_LABEL（阈值只在 QUALITY_BANDS 定义一次） */
  const qualTxt = i18n("观赏质量") + (QUALITY_LABEL[gradeOf(r.Q)] ? i18n(QUALITY_LABEL[gradeOf(r.Q)]) : "");

  const C = 2 * Math.PI * 54;
  $("#hero").innerHTML = `
  <div class="hero">
    <div class="dial">
      <svg width="126" height="126" viewBox="0 0 126 126">
        <circle class="dialbg" cx="63" cy="63" r="54" fill="none" stroke-width="11"/>
        <circle cx="63" cy="63" r="54" fill="none" stroke="${col}" stroke-width="11" stroke-linecap="round"
          stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - clamp01(r.P / 100))).toFixed(1)}"/>
      </svg>
      <div class="dv"><b>${Math.round(r.P)}<span style="font-size:15px">%</span></b><span>${i18n("出现概率")}</span></div>
    </div>
    <div class="hero-txt">
      ${confBadge(r)}
      <div class="big">${i18n("预计 {site} {date} {period}{concl}（{p}），{q} 分 · {qual} {grade}", {
        site: esc(r.name), date: r.dateStr, period: i18n(isAM ? "朝霞" : "晚霞"),
        concl: concl, p: pct(r.P), q: Math.round(r.Q), qual: qualTxt, grade: i18n(grade) })}</div>
      <div class="hint" style="margin-top:5px">
        ${i18n("承载霞光的主要云层：{type}（{decks}），云底约 {base}；{geom}，等效云底 {heff}，云边界 {d}。", {
          type: "<b>" + i18n(p.type) + "</b>", decks: deckTxt, base: uAlt(p.base * 1000),
          geom: i18n(r.sRT.geom.ok ? "火烧云三角几何条件成立" : "几何条件不成立或云边界过远"),
          heff: uAlt(r.sRT.hEff * 1000),
          d: isNum(r.sRT.d) ? uDist(r.sRT.d) : i18n("无明显边界") })}
      </div>
      <div class="hint" style="margin-top:5px">
        ${i18n("各算法综合指数 I（0–100，越高越好）：{parts} · 综合 {mix}", {
          parts: partTxt, mix: "<b>" + Math.round(mixedIndex(r.P, r.Q)) + "</b>" })}
      </div>
    </div>
  </div>
  <div class="kv" style="margin-top:14px">
    <div class="it"><div class="k">${i18n("{ev}时刻（本地）", { ev: evName })}</div><div class="v">${evLocal}</div></div>
    <div class="it"><div class="k">${i18n("{ev}方位角", { ev: evName })}</div><div class="v">${Math.round(r.az)}°</div></div>
    <div class="it"><div class="k">${i18n("日出日落线速度")}</div><div class="v">${r.vSpd.toFixed(1)} km/min</div></div>
    <div class="it"><div class="k">${i18n("太阳高度角变化率")}</div><div class="v">${r.omega.toFixed(3)} °/min</div></div>
    <div class="it"><div class="k">${i18n("霞光深入距离上限")}</div><div class="v">${uDist(r.sRT.geom.xMax)}</div></div>
    <div class="it"><div class="k">${i18n("云边界距离")}</div><div class="v">${isNum(r.sRT.d) ? uDist(r.sRT.d) : "—"}</div></div>
    <div class="it"><div class="k">${i18n("云底 / 等效云底")}</div><div class="v">${uAlt(r.sRT.primary.base * 1000)} / ${uAlt(r.sRT.hEff * 1000)}</div></div>
    <div class="it"><div class="k">${i18n("光学等效地表高度")}</div><div class="v">${uAlt(r.sRT.Heq * 1000)}</div></div>
    <div class="it"><div class="k">AOD(550nm)</div><div class="v">${n1(r.aodUse, 2)}</div></div>
    <div class="it"><div class="k">${i18n("550nm 透射率")}</div><div class="v">${r.sRT.peak.T550 < 0.01 ? r.sRT.peak.T550.toExponential(2) : r.sRT.peak.T550.toFixed(3)}</div></div>
    <div class="it"><div class="k">${i18n("预计持续时间（头顶）")}</div><div class="v">${fmtDur(r.sRT.geom.dur)}</div></div>
    <div class="it"><div class="k">${i18n("综合指数 I=0.55P+0.45Q")}</div><div class="v">${Math.round(mixedIndex(r.P, r.Q))}</div></div>
  </div>
  ${envStrip(r)}`;
}

/* 参与计算的环境要素读数（F7）：把"输入了什么"摊开，结论才可复核。
   数值取综合场 envM —— 与评分所用的输入完全一致，不是另取的一套。 */
function envStrip(r) {
  const e = r.envM || r.envG || {};
  const it = (k, v) => `<div class="it"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  return `<div class="envstrip">
    <div class="esh">${i18n("环境输入 · 评分所用的综合场（GFS 与 ECMWF-IFS 逐时平均）")}</div>
    <div class="kv">${[
      it(i18n("2m 温度"), uTemp(e.T)),
      it(i18n("2m 露点"), uTemp(e.Td)),
      it(i18n("相对湿度"), isNum(e.RH) ? Math.round(e.RH) + " %" : "—"),
      it(i18n("10m 风速"), uSpeed(e.ws)),
      it(i18n("海平面气压"), isNum(e.Pmsl) ? e.Pmsl.toFixed(1) + " hPa" : "—"),
      it(i18n("能见度"), isNum(e.vis) ? uDist(e.vis / 1000, 1) : "—")
    ].join("")}</div>
  </div>`;
}

/* F3：霞光强度与彩度随时间的演变曲线。
   横轴与下方时间轴同源 —— 都是"事件后多少分钟"：由太阳高度角变化率 ω
   把各采样点的掠射角换算成时间，所以曲线与时间轴是对齐的，可以直接读。
   纵轴归一到各自峰值（亮度＝相对亮度 lumRel，彩度＝OKLab 彩度 chroma）。
   此前只给了 5 个离散色卡，看不出这场霞是"越烧越红"还是"一闪而过"；
   竖线用每个采样点的实际颜色着色，等于把色卡也压进同一条时间轴上。 */
function rayCurve(s, omega) {
  const sm = s.samples || [];
  if (sm.length < 2) return "";
  const g = s.geom || {};
  const om = (isNum(omega) && omega > 0.01) ? omega : 0.2;
  const okGeo = isNum(g.thNearDeg) && isNum(g.thFarDeg);
  const mins = sm.map((x, i) => okGeo
    ? (g.thNearDeg + x.t * (g.thFarDeg - g.thNearDeg)) / om
    : i * 3);
  const mx = Math.max(Math.max.apply(null, mins) * 1.06, 0.5);
  const maxL = Math.max.apply(null, sm.map(x => x.lumRel || 0)) || 1;
  const maxC = Math.max.apply(null, sm.map(x => x.chroma || 0)) || 1;
  const W = 100, H = 34, PT = 4, PB = 6;
  const X = i => (mins[i] / mx) * (W - 2) + 1;
  const Y = v => H - PB - clamp01(v) * (H - PT - PB);
  const poly = (key, mxv) => sm.map((x, i) =>
    X(i).toFixed(2) + "," + Y((x[key] || 0) / mxv).toFixed(2)).join(" ");
  const grid = [0, 0.25, 0.5, 0.75, 1].map(f =>
    `<line class="rcg" x1="1" x2="${W - 1}" y1="${Y(f).toFixed(2)}" y2="${Y(f).toFixed(2)}" vector-effect="non-scaling-stroke"/>`).join("");
  const bars = sm.map((x, i) =>
    `<line x1="${X(i).toFixed(2)}" x2="${X(i).toFixed(2)}" y1="${PT}" y2="${H - PB}"
       stroke="${x.hex}" stroke-width="1.4" opacity=".55" vector-effect="non-scaling-stroke"/>`).join("");
  let pk = 0;
  for (let i = 1; i < sm.length; i++) if ((sm[i].lumRel || 0) > (sm[pk].lumRel || 0)) pk = i;
  return `<div class="rcwrap">
    <svg class="rcurve" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
      aria-label="${i18n("霞光相对亮度与彩度随时间的演变（横轴＝事件后分钟数，竖线＝各采样点的实际颜色）：")}">
      ${grid}${bars}
      <polyline class="rcL" points="${poly("lumRel", maxL)}" vector-effect="non-scaling-stroke"/>
      <polyline class="rcC" points="${poly("chroma", maxC)}" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="rcaxis"><span>${i18n("0 分")}</span><span>${fmtDur(mx / 2)}</span><span>${fmtDur(mx)}</span></div>
    <div class="rcleg"><span><i class="rcLi"></i>${i18n("相对亮度（峰值 +{v} 分）", { v: mins[pk].toFixed(1) })}</span>
      <span><i class="rcCi"></i>${i18n("彩度 · OKLab（峰值 {v}）", { v: maxC.toFixed(3) })}</span></div>
  </div>`;
}

/* ---------------------------------------------------------------------------
   快照卡（F5）：把一条 `snap=` 里的结论摘要画成结论卡，**零取数**。
   ---------------------------------------------------------------------------
   与 renderHero 共用 gradeOf / gradeColor / conclOf / confBadge —— 于是"快照里的
   等级"与"完整结果里的等级"必然是同一个，不会出现两处口径。差异只有两处，且都是刻意的：
     · 日出日落时刻与方位角**现算**（sunEvents / solarPosition 都是纯天文、零取数），
       所以链接里不必带，也因此不可能被篡改 —— 想改时刻就得连地点日期一起改；
     · 只带最决定性的 4 个因素，且不带长篇解读 —— 那是完整结果的事。
   安全边界：进 innerHTML 的只有四类东西 —— i18n() 的常量译文、esc() 过的地名、
   SNAP_FACTORS 里按白名单取出的展示名与 fmt() 算出的数字串、以及上面现算的天文量。
   链接里任何"自由文本"在 snapDecode 阶段就已经过 safeLabel / 白名单了。 */
function snapAgeH(genMs) { return genMs ? (Date.now() - genMs) / 3600000 : 0; }
/* "生成于"要**绝对时间 + 相对时间都给**：只给相对时间，对方不知道是哪天算的；
   只给绝对时间，还得自己做减法才知道过没过期。 */
function snapGenTxt(genMs) {
  if (!genMs) return i18n("未知时间");
  const d = new Date(genMs);
  /* 用**生成方本地**的挂钟时间：ymd() 是 UTC 口径，与 getHours() 混用会差一个时区。 */
  const abs = d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
    " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  const h = snapAgeH(genMs);
  if (h < 0) return abs;                    /* 对方机器的时钟往前飘了 */
  if (h < 1) return i18n("{abs}（{n} 分钟前）", { abs: abs, n: Math.max(1, Math.round(h * 60)) });
  if (h < 24) return i18n("{abs}（{n} 小时前）", { abs: abs, n: Math.round(h) });
  return i18n("{abs}（{n} 天前）", { abs: abs, n: Math.round(h / 24) });
}

function renderSnap(s) {
  const [Y, M, D] = s.date.split("-").map(Number);
  const dayMs = Date.UTC(Y, M - 1, D);
  const isAM = s.period === "am";
  const evName = i18n(isAM ? "日出" : "日落");
  let evMs = null, az = null;
  try {
    const ev = sunEvents(dayMs, s.lat, s.lon);
    evMs = isAM ? ev.riseMs : ev.setMs;
    if (!isNum(evMs)) evMs = ev.noonMs + 12 * 3600000;
    az = solarPosition(evMs, s.lat, s.lon).azimuth;
  } catch (e) { softWarn("快照天文量重算失败", e); }
  const evLocal = isNum(evMs) ? uClock(((evMs + s.tzMin * 60000) / 3600000 % 24 + 24) % 24) : "—";

  const grade = gradeOf(s.Q), col = gradeColor(grade);
  const C = 2 * Math.PI * 54;
  /* 徽标照旧走 confBadge：spread / spreadQ 缺失时它自己会收敛成"只报 ΔI"。 */
  const badge = confBadge({ consist: s.consist, dvI: s.dvI, spread: s.spread, spreadQ: s.spreadQ, conf: null });
  const stale = snapAgeH(s.gen) > 24;
  const deckTxt = s.deck >= 0 ? i18n(SNAP_DECKS[s.deck]) : "—";
  const typeTxt = s.type ? i18n(s.type) : "—";
  const qualTxt = i18n("观赏质量") + (QUALITY_LABEL[grade] ? i18n(QUALITY_LABEL[grade]) : "");

  const facHtml = s.factors.length ? `<div class="snapfac">
    <div class="sfh">${i18n("最决定性的几个因素")}</div>
    <div class="sfl">${s.factors.map(x => {
      const d = SNAP_FACTORS.filter(y => y.k === x.k)[0];
      return `<span class="sf">${esc(i18n(d.zh))}<b>${esc(d.fmt(x.v))}</b>${pill(x.s)}</span>`;
    }).join("")}</div>
  </div>` : "";

  $("#hero").innerHTML = `
  <div class="note ${stale ? "n-warn" : "n-info"} snapnote">
    <div class="snt"><b>${i18n("这是 {t} 的计算结果（快照）", { t: snapGenTxt(s.gen) })}</b>
      <span>${i18n("打开快照链接不会重新取数，因此不消耗接口额度。")}${stale ? " " + i18n("距今已超过一天，模式数据可能已更新多次，请谨慎参考。") : ""}</span></div>
    <button class="sm primary" id="snapRefresh">${i18n("按当前条件重新计算")}</button>
  </div>
  <div class="hero">
    <div class="dial">
      <svg width="126" height="126" viewBox="0 0 126 126">
        <circle class="dialbg" cx="63" cy="63" r="54" fill="none" stroke-width="11"/>
        <circle cx="63" cy="63" r="54" fill="none" stroke="${col}" stroke-width="11" stroke-linecap="round"
          stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - clamp01(s.P / 100))).toFixed(1)}"/>
      </svg>
      <div class="dv"><b>${Math.round(s.P)}<span style="font-size:15px">%</span></b><span>${i18n("出现概率")}</span></div>
    </div>
    <div class="hero-txt">
      ${badge}
      <div class="big">${i18n("预计 {site} {date} {period}{concl}（{p}），{q} 分 · {qual} {grade}", {
        site: esc(s.name), date: esc(s.date), period: i18n(isAM ? "朝霞" : "晚霞"),
        concl: conclOf(s.P), p: pct(s.P), q: Math.round(s.Q), qual: qualTxt, grade: i18n(grade) })}</div>
      <div class="hint" style="margin-top:5px">
        ${i18n("承载霞光的主要云层：{type}（{deck}），云底约 {base}；云边界 {d}。", {
          type: "<b>" + esc(typeTxt) + "</b>", deck: esc(deckTxt), base: uAlt((s.baseKm || 0) * 1000),
          d: isNum(s.dKm) ? uDist(s.dKm) : i18n("无明显边界") })}
      </div>
      <div class="hint" style="margin-top:5px">${i18n("综合指数 I=0.55P+0.45Q")} <b>${Math.round(mixedIndex(s.P, s.Q))}</b></div>
    </div>
  </div>
  <div class="kv" style="margin-top:14px">
    <div class="it"><div class="k">${i18n("{ev}时刻（本地）", { ev: evName })}</div><div class="v">${evLocal}</div></div>
    <div class="it"><div class="k">${i18n("{ev}方位角", { ev: evName })}</div><div class="v">${isNum(az) ? Math.round(az) + "°" : "—"}</div></div>
    <div class="it"><div class="k">${i18n("云底高度")}</div><div class="v">${uAlt((s.baseKm || 0) * 1000)}</div></div>
    <div class="it"><div class="k">${i18n("云边界距离")}</div><div class="v">${isNum(s.dKm) ? uDist(s.dKm) : "—"}</div></div>
    <div class="it"><div class="k">${i18n("预计持续时间（头顶）")}</div><div class="v">${isNum(s.durMin) ? fmtDur(s.durMin) : "—"}</div></div>
    <div class="it"><div class="k">${i18n("综合指数 I=0.55P+0.45Q")}</div><div class="v">${Math.round(mixedIndex(s.P, s.Q))}</div></div>
  </div>
  ${facHtml}`;
  const rb = $("#snapRefresh");
  if (rb) rb.addEventListener("click", () => { invalidateSnap(); syncUrl(); runForecast(true); });
}

function modelCard(title, sub, P, Q, facts, color, extraClass) {
  const grade = gradeOf(Q);
  return `<div class="mcard ${extraClass || ""}">
    <div class="mh"><span class="dot" style="background:${color}"></span><b>${title}</b>
      <span class="rt">${sub}</span></div>
    <div class="mrow">
      <div class="mnum" style="color:${color}">${Math.round(P)}<small>%</small></div>
      <div class="mmeta"><span class="grade g-${grade}">${i18n("质量 {q} 分 · {grade}", { q: Math.round(Q), grade: i18n(grade) })}</span></div>
    </div>
    <div class="bar"><i style="width:${clamp(P, 0, 100)}%;background:${gradeColor(grade)}"></i></div>
    <div class="mfacts">${facts}</div>
  </div>`;
}

function renderModels(r) {
  const out = [];
  const mk = (s, tr, env, label) => {
    const p = s.primary, g = s.geom;
    return `<span>${i18n("云型")} <b>${i18n(p.type)}</b></span><span>${i18n("主云量")} <b>${Math.round(p.cover)}%</b></span>
      <span>${i18n("云底")} <b>${Math.round(p.base * 1000)}m</b></span>
      <span>${i18n("云边界")} <b>${isNum(s.d) ? Math.round(s.d) + "km" : i18n("无")}</b></span>
      <span>${i18n("等效云底")} <b>${n1(s.hEff)}km</b></span>
      <span>${i18n("持续")} <b>${fmtDur(g.dur)}</b></span>
      <span>AOD <b>${n1(s.aodUp, 2)}</b></span>`;
  };
  out.push(modelCard(i18n("GFS 模式"), i18n("NOAA 全球模式 · 1 小时分辨率"), r.sG.P, r.sG.Q, mk(r.sG), "var(--mc-gfs)"));
  if (r.sE) out.push(modelCard(i18n("ECMWF-IFS 模式"), i18n("欧洲中心全球模式"), r.sE.P, r.sE.Q, mk(r.sE), "var(--mc-ec)"));
  else out.push(`<div class="mcard"><div class="mh"><span class="dot" style="background:#9aa4b2"></span><b>${i18n("ECMWF-IFS 模式")}</b></div>
    <div class="hint">${i18n("该日期/点位未取到 ECMWF 数据，本次综合结果由 GFS 与光追算法构成。")}</div></div>`);
  const rt = r.sRT;
  const brt = i18n(rt.bright.txt);
  const brtShort = brt.split(/[（(]/)[0];
  out.push(modelCard(i18n("光追算法"), i18n("纯物理：多波长光路积分 + CIE 色度"), rt.P, rt.Q,
    `<span>${i18n("主云型")} <b>${i18n(rt.primary.type)}</b></span><span>${i18n("等效地表")} <b>${n1(rt.Heq, 2)}km</b></span>
     <span>${i18n("峰值透射")} <b>${rt.peak.T550.toExponential(2)}</b></span>
     <span>${i18n("亮度")} <b>${brtShort}</b></span>
     <span>${i18n("颜色")} <b>${i18n(rt.peak.name)}</b></span><span>${i18n("饱和")} <b>${(rt.peak.sat * 100).toFixed(0)}%</b></span>
     <span>${i18n("几何")} <b>${i18n(rt.geom.ok ? "成立" : "不成立")}</b></span>`, "var(--mc-rt)"));
  const g = gradeOf(r.Q);
  /* 分歧口径统一（B3）：主指标由"P 的极差"改为 ΔI —— 与地图「模型分歧」维度同一把尺子，
     也与结论卡徽标、因素表同源。ΔP / ΔQ 作为分解项一并给出，
     用户能看出这次分歧究竟是落在出现概率还是观赏质量上。 */
  const cfb = confText(r.conf || ensConfOf(r.dvI));
  const rn = (v) => isNum(v) ? Math.round(v) : "—";
  out.push(modelCard(i18n("多模型综合"), i18n("GFS 30% + EC 34% + 光追 36%"), r.P, r.Q,
    `<span>${i18n("可信度")} <b style="color:${cfb.color}">${cfb.lv}</b></span>
     <span>ΔI <b>${rn(r.dvI)}</b>${i18n("（三算法综合指数极差）")}</span>
     <span>ΔP <b>${rn(r.spread)}</b> · ΔQ <b>${rn(r.spreadQ)}</b></span>
     <span>${i18n("等级")} <b>${i18n(g)}</b></span>
     <span>${i18n("时效")} <b>${r.leadH > 0 ? Math.round(r.leadH) + " " + i18n("小时") : i18n("实况/历史")}</b></span>
     <span>${i18n("综合指数")} <b>${Math.round(mixedIndex(r.P, r.Q))}</b></span>`, "var(--mc-ens)", "ens"));
  $("#models").innerHTML = out.join("");
}

function pill(score) {
  if (score == null) return `<span class="pill p-mid">${i18n("数据缺失")}</span>`;
  if (score >= 0.78) return `<span class="pill p-ok">${i18n("有利")}</span>`;
  if (score >= 0.5) return `<span class="pill p-mid">${i18n("中性")}</span>`;
  return `<span class="pill p-bad">${i18n("不利")}</span>`;
}
/* =========================================================================
   快照（F5）里"主要因素"的口径
   -------------------------------------------------------------------------
   链接里只存 `key + 原始数值 + 得分`；**展示名与单位在渲染时才由这里现算**。
   于是同一条快照链接：切到英文界面就是英文、切成英制就是 ft / mi / mph，
   链接本身一个字符都不用改。
   `fmt` 与下面 renderFactors 里那 12 个显示串必须**等价**（同一输入出同一串），
   否则快照卡与完整因素表会说出两个数。
   ========================================================================= */
const SNAP_FACTORS = [
  { k: "cover", zh: "云量类型与覆盖度", fmt: v => Math.round(v) + "%" },
  { k: "base", zh: "云底高度", fmt: v => uAlt(v * 1000) },
  { k: "heq", zh: "光学等效地表高度", fmt: v => uDist(v, 2) },
  { k: "heff", zh: "等效云底高度", fmt: v => uDist(v, 2) },
  { k: "dedge", zh: "云边界距离", fmt: v => uDist(v) },
  { k: "block", zh: "光路上游低层云遮挡", fmt: v => Math.round(v) + "%" },
  { k: "aod", zh: "气溶胶光学厚度 AOD", fmt: v => n1(v, 2) },
  { k: "vis", zh: "能见度", fmt: v => uDist(v / 1000, 1) },
  { k: "rh", zh: "2m 相对湿度", fmt: v => Math.round(v) + "%" },
  { k: "stab", zh: "气压稳定性", fmt: v => "|ΔP/Δt| = " + v.toFixed(2) + " hPa/h" },
  { k: "wind", zh: "云边界风速分量", fmt: v => uSpeed(v) },
  { k: "cape", zh: "对流活动", fmt: v => "CAPE " + Math.round(v) + " J/kg" }
];
/* 白名单：snapDecode 拿它过滤因素键 —— 不在名单里的键整条丢掉。 */
const SNAP_KEYS = SNAP_FACTORS.map(x => x.k);

function renderFactors(r) {
  const env = r.envM, s = r.sRT, tr = r.aM, p = s.primary;
  const rows = [];
  /* 快照（F5）要挑"最决定性的几个因素"，而它需要的是**原始量**（米 / 百分数 / J/kg），
     不是这里已经拼好单位的显示串 —— 否则对方把界面切成英制就对不上了。
     所以 add 多收一个 `key` 与 `numVal`，把 (键, 原始数值, 得分) 存进 State.factorRows。
     这一步的意义是：下面这 12 组 trap() 阈值**只有这一份**，快照侧不许再抄一遍。 */
  const snapRows = [];
  const add = (key, name, numVal, val, score, desc) => {
    rows.push([name, val, score, desc]);
    if (key) snapRows.push([key, numVal, score]);
  };
  State.factorRows = snapRows;

  const coverSc = trap(p.cover, [[0, 0], [8, 0.12], [22, 0.62], [38, 1], [75, 1], [88, 0.5], [100, 0.22]]);
  add("cover", i18n("云量类型与覆盖度"), p.cover, `${p.type} · ${Math.round(p.cover)}%`, coverSc,
    i18n("{type}属{deck}，云底约 {base}。{tail}", {
      type: i18n(p.type), deck: i18n(["低云", "中云", "高云"][p.level]), base: uAlt(p.base * 1000),
      tail: i18n(p.cover < 20 ? "云量偏少，可能没有足够云体承接霞光。"
        : p.cover > 90 ? "云量接近全覆盖，阳光难以穿透，易形成闷烧或无霞。"
          : "云量处于理想区间，云块之间既能透光又能承接低角度阳光。") }));

  const baseSc = trap(p.base, [[0.1, 0.05], [0.6, 0.24], [1.2, 0.55], [2.0, 0.8], [3.0, 1], [9, 1], [13, 0.68]]);
  add("base", i18n("云底高度"), p.base, uAlt(p.base * 1000), baseSc,
    i18n("云底越高，霞光可出现的范围与色相变化越丰富；云底越低，霞光越局限于橘红且持续时间短。"));

  const heqSc = trap(s.Heq, [[0, 1], [0.8, 1], [1.5, 0.8], [2.5, 0.5], [3.5, 0.3], [5, 0.12], [8, 0.03]]);
  add("heq", i18n("光学等效地表高度"), s.Heq, uDist(s.Heq, 2), heqSc,
    i18n("气溶胶把光线“垫高”的等效地表高度，由 AOD 与气溶胶标高 Hs={v} km 计算（z=Hs·ln(AOD/(Hs·k₀))）。该值越大，等效云底越低，霞光越难形成。", { v: n1(s.Hs, 2) }));

  const heffSc = trap(s.hEff, [[0, 0.03], [0.4, 0.25], [1, 0.6], [2, 0.85], [4, 1], [10, 1]]);
  add("heff", i18n("等效云底高度"), s.hEff, uDist(s.hEff, 2), heffSc, i18n("云底高度减去光学等效地表高度后的有效高度，是几何判定的真正输入。"));

  const dSc = s.geom.ok ? clamp(1 - s.d / s.geom.xMax, 0, 1) * 0.6 + 0.4 : 0.05;
  add("dedge", i18n("云边界距离"), s.d, isNum(s.d) ? uDist(s.d) + i18n("（上限 {v}）", { v: uDist(s.geom.xMax) }) : i18n("无明显云边界"), dSc,
    i18n("沿日出/日落方位以 25 km 间隔采样（地图批量估算时以采样网格插值代替实地采样）得到的云盘外缘距离。必须小于霞光深入距离 2√(2Rh)，阳光才能从云底下方照进来；距离越远，颜色越红、开始越晚。"));

  const blockSc = trap(isNum(tr.upstreamLowMax) ? tr.upstreamLowMax : (env.cLow || 0),
    [[0, 1], [25, 0.95], [45, 0.72], [65, 0.4], [85, 0.18], [100, 0.1]]);
  add("block", i18n("光路上游低层云遮挡"), (isNum(tr.upstreamLowMax) ? tr.upstreamLowMax : (env.cLow || 0)), `${Math.round(isNum(tr.upstreamLowMax) ? tr.upstreamLowMax : 0)}%`, blockSc,
    i18n("低云位于霞光光路下方，是最常见的“翻车”原因：低云量高会把阳光彻底挡住。"));

  const aeroSc = trap(r.aodUse, [[0, 1], [0.1, 1], [0.2, 0.88], [0.3, 0.72], [0.5, 0.52], [0.8, 0.26], [1.2, 0.12], [3, 0.03]]);
  add("aod", i18n("气溶胶光学厚度 AOD"), r.aodUse, `${n1(r.aodUse, 2)}（550nm）`, aeroSc,
    i18n(r.aodUse < 0.2 ? "气溶胶很少，瑞利散射占主导，阳光颜色纯净、饱和度高，水晶天。"
      : r.aodUse < 0.5 ? "气溶胶一般，天空通透度普通，颜色饱和度会略降。"
        : r.aodUse < 0.8 ? "气溶胶较多，天空偏霾，会明显削弱霞光的亮度与饱和度。"
          : "气溶胶大量存在，属“污烧”，低角度霞光细节会被灰霾吞掉。"));

  const visSc = isNum(env.vis) ? trap(env.vis / 1000, [[0.4, 0.05], [2, 0.2], [5, 0.42], [10, 0.66], [20, 0.92], [30, 1], [80, 1]]) : null;
  add("vis", i18n("能见度"), env.vis, isNum(env.vis) ? uDist(env.vis / 1000, 1) : "—", visSc,
    i18n("反映底层大气通透程度。能见度低于 5 km 时地面附近霾/雾显著，霞光的低角度部分会被遮挡。"));

  const humSc = isNum(env.RH) ? trap(env.RH, [[5, 0.7], [20, 0.92], [40, 1], [75, 1], [88, 0.78], [95, 0.45], [100, 0.3]]) : null;
  add("rh", i18n("2m 相对湿度"), env.RH, isNum(env.RH) ? Math.round(env.RH) + "%" : "—", humSc,
    i18n("湿度适中利于云的存在与散射；相对湿度过高（>90%）会形成雾并放大气溶胶消光，反而使天空浑浊；过低则可能没有云。"));

  const dPv = r.trendVal;
  const stabSc = isNum(dPv) ? trap(dPv, [[0, 1], [0.6, 1], [1.2, 0.8], [2.5, 0.52], [6, 0.3]]) : null;
  add("stab", i18n("气压稳定性"), dPv, isNum(dPv) ? "|ΔP/Δt| = " + dPv.toFixed(2) + " hPa/h" : "—", stabSc,
    i18n("气压稳定说明天气系统移动缓慢，云边界位置可预测；气压快速变化意味着云况随时可能改变，预报不确定性大。"));

  const comp = alongComponent(env.ws, env.wd, r.az);
  const compSc = isNum(comp) ? trap(comp, [[0, 1], [8, 1], [15, 0.75], [22, 0.5], [32, 0.3], [50, 0.15]]) : null;
  add("wind", i18n("云边界风速分量"), comp, isNum(comp) ? uSpeed(comp) : "—", compSc,
    i18n("云边界沿日出/日落方向的速度分量。经验上 <15 m/s 云边界位置不确定度小，>30 m/s 则很大（云边界会明显推移）。"));

  const cape = env.cape, pr = env.precip;
  const convSc = isNum(cape) ? trap(cape, [[0, 1], [300, 1], [800, 0.8], [1500, 0.55], [3000, 0.32]]) : null;
  add("cape", i18n("对流活动"), cape,
    (isNum(cape) ? "CAPE " + Math.round(cape) + " J/kg" : "—")
    + (isNum(pr) ? i18n(" · 降水 {v} mm", { v: pr.toFixed(1) }) : ""), convSc,
    i18n("对流强时局地积云/积雨云发展，会随机遮挡光路；但积雨云云砧本身也可能形成漂亮的云砧晚霞。"));

  /* 模式一致性（B2/B3）：档位、措辞一律来自 ENS_CONF_BANDS / ensConfDetail ——
     原先这里手写 18 / 35 两个阈值，措辞还只说"两套全球模式与光追"，
     等于在 _p4.js 之外又养了一份同义实现，阈值一改两处就会打架。
     判别量也统一成 ΔI（与地图「模型分歧」维度同源），ΔP / ΔQ 只作为分解项展示。 */
  const cfF = confText(r.conf || ensConfOf(r.dvI));
  add("consist", i18n("模式一致性"), null,
    isNum(r.dvI)
      ? `${cfF.lv} · ΔI ${Math.round(r.dvI)}（ΔP ${Math.round(nz(r.spread, 0))} · ΔQ ${Math.round(nz(r.spreadQ, 0))}）`
      : i18n("数据不足"),
    clamp(r.consist / 100, 0, 1),
    isNum(r.dvI)
      ? i18n("{txt}，{detail}。{hint}", { txt: cfF.txt, detail: ensConfDetail(r.spread, r.spreadQ), hint: cfF.hint })
      : i18n("不足两套算法给出结果，无法评估模型一致性。"));

  $("#fac").innerHTML = `<thead><tr><th style="width:170px">${i18n("因素")}</th><th style="width:180px">${i18n("数值")}</th>
    <th style="width:62px">${i18n("判定")}</th><th>${i18n("对霞光的影响")}</th></tr></thead><tbody>` +
    rows.map(x => `<tr><td>${x[0]}</td><td class="v">${x[1]}</td><td>${pill(x[2])}</td><td class="d">${x[3]}</td></tr>`).join("") +
    `</tbody>` +
    /* 非中文时给一行说明：因素的长篇解读属"全量"批次，此处明确告知而不是让用户
       对着一列中文发呆。 */
    (LANG === "zh" ? "" : `<tfoot><tr><td colspan="4" class="hint">${i18n("因素详细解读目前仅提供中文。")}</td></tr></tfoot>`);
}

function renderRay(r) {
  const s = r.sRT, g = s.geom;
  const sw = s.samples.map(x => `<div class="swatch" style="background:${x.hex}">${i18n(x.name)}</div>`).join("");
  const om = r.omega || 0.2;
  const t0 = g.thNearDeg / om, t1 = g.thFarDeg / om;
  const mx = Math.max(t1 * 1.12, 0.8);
  const tl = g.ok ? `
    <div class="tl">
      <div class="seg2" style="left:${(t0 / mx * 100).toFixed(1)}%;width:${((t1 - t0) / mx * 100).toFixed(1)}%"></div>
      <div class="mk" style="left:0"></div>
      <div class="mk" style="left:${(t0 / mx * 100).toFixed(1)}%"></div>
      <div class="mk" style="left:${(t1 / mx * 100).toFixed(1)}%"></div>
      <div class="lb3" style="left:${clamp(t0 / mx * 100, 6, 62)}%">${i18n("开始 +{v}", { v: fmtDur(t0) })}</div>
      <div class="lb3" style="left:${clamp(t1 / mx * 100, 40, 94)}%">${i18n("结束 +{v}", { v: fmtDur(t1) })}</div>
      <div class="lb2" style="left:6%">${i18n("{ev}时刻", { ev: i18n(r.period === "am" ? "日出" : "日落") })}</div>
    </div>` : `<div class="note n-warn">${i18n("几何条件不成立：{why}。光追结果按最接近的掠射情形估算，仅作参考。", { why: isNum(s.d)
      ? i18n("云边界距离 {d} 已超过霞光深入距离上限 {m}（该云盘范围内阳光无法从云底下方射入）",
          { d: Math.round(s.d) + " km", m: Math.round(g.xMax) + " km" })
      : i18n("日出/日落方向 400 km 内没有找到可承载霞光的云盘") })}</div>`;

  $("#ray").innerHTML = `
  <div class="kv">
    <div class="it"><div class="k">${i18n("峰值透射率 T(550nm)")}</div><div class="v">${s.peak.T550.toExponential(2)}</div></div>
    <div class="it"><div class="k">${i18n("亮度等级")}</div><div class="v" style="font-size:13px">${i18n(s.bright.txt)}</div></div>
    <div class="it"><div class="k">${i18n("峰值路径光学厚度 τ")}</div><div class="v">${s.peak.tau550.toFixed(1)}</div></div>
    <div class="it"><div class="k">${i18n("峰值颜色")}</div><div class="v" style="font-size:13px">${i18n(s.peak.name)} · ${i18n("饱和")} ${(s.peak.sat * 100).toFixed(0)}%</div></div>
    <div class="it"><div class="k">${i18n("色相跨距（颜色丰富度）")}</div><div class="v">${s.hueSpread.toFixed(0)}°</div></div>
    <div class="it"><div class="k">${i18n("气溶胶标高 Hs")}</div><div class="v">${n1(s.Hs, 2)} km</div></div>
    <div class="it"><div class="k">${i18n("近边界角（云遮挡）")}</div><div class="v">${n1(g.thNearDeg, 2)}°</div></div>
    <div class="it"><div class="k">${i18n("远边界角（地球遮挡）")}</div><div class="v">${n1(g.thFarDeg, 2)}°</div></div>
  </div>
  <div style="margin-top:13px">
    <div class="hint" style="margin-bottom:6px">${i18n("霞光强度与彩度随时间的演变（横轴＝事件后分钟数，竖线＝各采样点的实际颜色）：")}</div>
    ${rayCurve(s, r.omega)}
  </div>
  <div style="margin-top:12px">
    <div class="hint" style="margin-bottom:6px">${i18n("同一组采样时刻的光谱与颜色（左＝刚被照亮，右＝掠地最红）：")}</div>
    <div class="ray">${sw}</div>
  </div>
  <div style="margin-top:14px">
    <div class="hint" style="margin-bottom:2px">${i18n("本地云底被照亮的时段（火烧云三角）：")}</div>
    ${tl}
  </div>
  <div class="hint" style="margin-top:4px">
    光路模型：z(x)=h+x·tanθ+x²/(2R)，沿该抛物线对 400–700nm 共 61 个波长做消光积分；
    瑞利散射 σ∝λ⁻⁴（海平面 550nm 消光系数 ${(RAY_OD550_V / H_RAY).toFixed(4)} /km，标高 ${H_RAY} km），
    气溶胶米散射 σ∝λ⁻${ANGSTROM}。CIE 1931 色度换算后按亮度归一，得到可比较的色相与饱和度。
  </div>`;
}

function renderNotes(r) {
  const n = r.notes || [];
  $("#notes").innerHTML = n.length
    ? n.map(x => `<div class="note n-${x[0]}">${x[1]}</div>`).join("")
    : `<div class="note n-ok">${i18n("本时段各要素齐全，未发现明显缺失或异常。")}</div>`;
}

/* ---------------------------------------------------------------------------
   分享卡（B1）：把当前结论画成一张 PNG，供直接转发给同行人。
   真实使用场景就是"今晚要不要去看晚霞" —— 用户需要的是能发出去的一张图，而不是一段 URL。
   实现是**纯 canvas 手绘**：不引任何外部库（单文件约束），数据全部取自 State.result，
   因此**零取数、离线可用**。像素密度取 2 倍，缩略图与放大看都清楚。
   所有颜色/文案都复用页面同一套来源（gradeColor / ENS_CONF_BANDS / conclOf），
   卡片与页面不会说出两个不同的结论。 */

const CARD_W = 780, CARD_H = 400;

/* 圆角矩形：不依赖 ctx.roundRect（老一点的浏览器没有） */
function cardRR(c, x, y, w, h, rd) {
  c.beginPath();
  c.moveTo(x + rd, y);
  c.arcTo(x + w, y, x + w, y + h, rd);
  c.arcTo(x + w, y + h, x, y + h, rd);
  c.arcTo(x, y + h, x, y, rd);
  c.arcTo(x, y, x + w, y, rd);
  c.closePath();
}
/* #rrggbb + alpha → rgba()（比 8 位 hex 写法稳妥） */
function cardA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
}
/* 超宽就截断加省略号 —— 长城市名/经纬度串不会把排版顶出画布 */
function cardFit(c, s, maxW) {
  if (c.measureText(s).width <= maxW) return s;
  let i = s.length;
  while (i > 1 && c.measureText(s.slice(0, i) + "…").width > maxW) i--;
  return s.slice(0, i) + "…";
}

function shareCard() {
  const r = State.result;
  if (!r) { alert(i18n("请先完成一次预报，再保存图片。")); return; }

  const S = 2;
  const cv = document.createElement("canvas");
  cv.width = CARD_W * S; cv.height = CARD_H * S;
  const c = cv.getContext("2d");
  if (!c) return;
  c.scale(S, S);
  const FAM = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif';
  const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace';
  const f = (w, s, mono) => w + " " + s + "px " + (mono ? MONO : FAM);

  const grade = gradeOf(r.Q), gc = gradeColor(grade);
  const isAM = r.period === "am";
  const cfb = confText(r.conf || ensConfOf(r.dvI));

  /* 背景与顶部等级色条 */
  const bg = c.createLinearGradient(0, 0, CARD_W, CARD_H);
  bg.addColorStop(0, "#fff8f4"); bg.addColorStop(.55, "#ffffff"); bg.addColorStop(1, "#f6f9ff");
  c.fillStyle = bg; c.fillRect(0, 0, CARD_W, CARD_H);
  c.fillStyle = gc; c.fillRect(0, 0, CARD_W, 8);

  /* 概率环 */
  const cx = 122, cy = 200, R = 72;
  c.lineCap = "round"; c.lineWidth = 15;
  c.strokeStyle = "#eceff5";
  c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
  const p01 = clamp01(r.P / 100);
  if (p01 > 0.002) {
    c.strokeStyle = gc;
    c.beginPath(); c.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p01); c.stroke();
  }
  c.textAlign = "center"; c.textBaseline = "middle";
  c.fillStyle = "#1f2733"; c.font = f(800, 40, true);
  c.fillText(Math.round(r.P) + "%", cx, cy - 9);
  c.fillStyle = "#8b96a5"; c.font = f(500, 13);
  c.fillText(i18n("出现概率"), cx, cy + 25);

  /* 右侧文字块 */
  const x0 = 232, maxW = CARD_W - x0 - 36;
  c.textAlign = "left";
  c.fillStyle = "#1f2733"; c.font = f(700, 25);
  c.fillText(cardFit(c, r.name + " · " + r.dateStr + " " + i18n(isAM ? "朝霞" : "晚霞"), maxW), x0, 84);

  /* 分数 + 等级药丸。数字用等宽体（对齐好看），"分"单独用无衬线 ——
     等宽字体里中文占两倍宽度，写在一起会变成 "27  分" 那种夸张的字距。 */
  const qNum = String(Math.round(r.Q));
  c.fillStyle = gc; c.font = f(800, 38, true);
  c.fillText(qNum, x0, 142);
  const qw = c.measureText(qNum).width;
  c.font = f(700, 19);
  const qUnit = i18n("分");
  const uw = c.measureText(qUnit).width;
  c.fillText(qUnit, x0 + qw + 7, 143);
  const pillTxt = i18n("观赏质量") + " " + i18n(grade);
  c.font = f(700, 14);
  const pw = c.measureText(pillTxt).width + 26;
  const px = x0 + qw + 7 + uw + 16;
  cardRR(c, px, 126, pw, 30, 15);
  c.fillStyle = cardA(gc, .12); c.fill();
  c.strokeStyle = cardA(gc, .34); c.lineWidth = 1; c.stroke();
  c.fillStyle = gc; c.textAlign = "center";
  c.fillText(pillTxt, px + pw / 2, 142);

  /* 结论句 */
  c.textAlign = "left";
  c.fillStyle = "#1f2733"; c.font = f(700, 18);
  c.fillText(cardFit(c, conclOf(r.P) + i18n("（{v}）", { v: pct(r.P) }), maxW), x0, 190);

  /* 细节行 */
  const p = r.sRT.primary;
  const rows = [
    i18n("载霞云层 {v}", { v: i18n(p.type) }) + " · " +
      i18n("覆盖 {v}", { v: Math.round(p.cover) + "%" }) + " · " +
      i18n("云底") + " " + uAlt(p.base * 1000),
    i18n("云边界") + " " + (isNum(r.sRT.d) ? uDist(r.sRT.d) : i18n("无明显边界")) +
      " · " + i18n("等效云底") + " " + uAlt(r.sRT.hEff * 1000) + " · AOD " + n1(r.aodUse, 2),
    i18n("可信度 {v}", { v: cfb.lv }) + i18n("（{v}）", { v: cfb.txt + (isNum(r.dvI) ? i18n("，ΔI {v}", { v: Math.round(r.dvI) }) : "") }),
    "GFS " + Math.round(r.parts[0].I) + " · " +
      r.parts.slice(1).map(x => ({ ec: "EC ", rt: i18n("光追 ") }[x.k] + Math.round(x.I))).join(" · ") +
      " · " + i18n("综合 I {v}", { v: Math.round(mixedIndex(r.P, r.Q)) })
  ];
  c.font = f(500, 14);
  rows.forEach((s, i) => {
    c.fillStyle = i === 2 ? cfb.color : "#5b6675";
    c.fillText(cardFit(c, s, maxW), x0, 228 + i * 26);
  });

  /* 页脚 */
  c.strokeStyle = "#e9edf3"; c.lineWidth = 1;
  c.beginPath(); c.moveTo(40, 344); c.lineTo(CARD_W - 40, 344); c.stroke();
  c.fillStyle = "#9aa4b2"; c.font = f(500, 12);
  c.fillText(cardFit(c, i18n("霞光预报 · 数据源 Open-Meteo（GFS / ECMWF-IFS / CAMS 气溶胶）· 结论仅供观赏参考"), CARD_W - 80), 40, 372);
  c.textAlign = "right";
  c.fillText(r.leadH > 0 ? i18n("预报时效约 {n} 小时", { n: Math.round(r.leadH) }) : i18n("实况 / 历史分析场"), CARD_W - 40, 372);

  /* 落地：toBlob + <a download>，对象 URL 用完即撤 */
  cv.toBlob(b => {
    if (!b) return;
    const safe = String(r.name).replace(/[\\/:*?"<>|]/g, "").trim() || i18n("点位");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = i18n("霞光预报") + "_" + safe + "_" + r.dateStr + "_" + i18n(isAM ? "朝霞" : "晚霞") + ".png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, "image/png");
}
