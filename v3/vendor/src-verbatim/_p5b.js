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
  /* F4 本地校准块：**独立渲染**，只写 #calibHead / #calibStat 两个容器 ——
     结论卡的大字号概率、等级、结论句都由 renderHero 画，这里一个字都不碰。
     "本地校准不回改模型"这条纪律在代码上的落点就是这句"两段代码互不写对方的
     DOM"，而不是靠约定。 */
  renderCalibBox();
  /* 有结果了才放开分享卡按钮（初始 disabled 写在模板里） */
  const b = $("#shareCard");
  if (b) b.disabled = false;
}

/* =========================================================================
   F4 · 本地校准块（结论卡里那一条）
   -------------------------------------------------------------------------
   三种状态，共用一层外壳（外壳在模板里是静态的，所以 #calibOff / #calibClear
   在 `applyPrefs()` 跑的时候就已经存在，能像别的偏好一样被铺初值）：
     · 可标注（事件已过去）→ 提问 + 六档按钮，选中态取自已有记录
     · 不可标注（未来时段）→ 只说明"等事后回来标"
     · 统计行 → 样本够给**校准值**，不够给**进度**
   ========================================================================= */
function calibMarkName(a) {
  if (a < 0) return i18n("没看到（无法判断）");
  if (a === 0) return i18n("没有霞");
  if (a === 1) return i18n("很淡，勉强可见");
  if (a === 2) return i18n("一般，能看");
  if (a === 3) return i18n("很好");
  return i18n("非常壮观");
}
/* 偏差必须带符号："偏差 18 个百分点"与"偏差 -18 个百分点"是相反的结论。 */
function calibSigned(v) { return (v >= 0 ? "+" : "-") + Math.round(Math.abs(v)); }
function hideCalibBox() { const b = $("#calibBox"); if (b) b.hidden = true; }

function renderCalibBox() {
  const box = $("#calibBox");
  if (!box) return;
  const r = State.result;
  /* 快照模式下隐藏：快照是**别人**分享来的结论，你未必真去过那个地方 ——
     把它标成自己的实况会污染你自己的校准。（模板上另有 data-snaphide 兜底。） */
  if (!r || State.snap || State.calibOff) { box.hidden = true; return; }
  box.hidden = false;

  const cur = calibFind(r.lat, r.lon, r.dateStr, r.period);
  const st = calibStats(r.lat, r.lon, r.P);
  const head = $("#calibHead"), stat = $("#calibStat");

  if (head) head.innerHTML = calibCanAnnotate(r)
    ? `<div class="cbq">${i18n("这次实际看到霞了吗？")}</div>
       <div class="cbseg" role="group" id="calibSeg" aria-label="${esc(i18n("实况回填：点一档记录这次实际看到的情况"))}">` +
      CALIB_MARKS.map(a => {
        const on = !!(cur && cur.a === a);
        return `<button type="button" data-a="${a}" class="${on ? "on" : ""}"
          aria-pressed="${on ? "true" : "false"}">${esc(calibMarkName(a))}</button>`;
      }).join("") +
      `</div>
       <div class="cbhint">${i18n("「实际出现」按标注 ≥「一般，能看」计 —— 与概率 P 的口径（出现可观赏霞光）对齐。")}</div>`
    : `<div class="cbq cbquiet">${i18n("本次是未来时段的预报，等事后回来再标注实况。")}</div>`;

  if (stat) stat.innerHTML = st.enough
    ? `<div class="cbsh"><b>${i18n("本地校准")}</b><span>${i18n("只统计你自己标注的数据，不会回改模型结论")}</span></div>
       <div class="cbsr">${i18n("模型在 {lo}–{hi}% 这一档平均报 {pred}%；你标注的 {n} 次实况中实际出现 {obs}%（{hit} 次），偏差 {d} 个百分点。该位置共 {m} 次标注。", {
         lo: st.lo, hi: st.hi, pred: Math.round(st.pred), n: st.nBucket,
         obs: Math.round(st.obs), hit: st.hit, d: calibSigned(st.delta), m: st.nAll })}</div>`
    : `<div class="cbsr cbprog">${i18n("已记录 {n} 次实况标注（本机）；累计满 {m} 次、且当前这一档至少有 {k} 次后显示本地校准。", {
         n: st.nAll, m: CALIB_MIN_N, k: CALIB_MIN_BUCKET })}</div>`;
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

/* =========================================================================
   轴标签适配（fitAxis）
   -------------------------------------------------------------------------
   四道分界各挂一枚「名称 + 时刻」，标签宽度随语言与字号变化：手机 374px 上
   中文四枚勉强排开，英文（Sunset 18:00 · Civil dusk 18:20 …）必然挤作一团。
   任何"按字符数估宽"的写法在换语言时都会失准，所以全部**实测矩形**，阶梯降级：
     ① 先全部居中于自己的分界；越出面板的改为朝内锚定（左越界→左锚，右越界→右锚）；
     ② 仍有重叠或越界 → 隐去名称只留时刻（.tonly）；
     ③ 仍挤 → 按「与最近邻居的间隙」从小到大舍弃中间标签（.off）。
   首尾两枚（日落·天黑 / 日出·天亮）是这条轴的两个锚点，**永不舍弃**。
   幂等：开头先清掉上一轮的降级状态再重测 —— resize / 换语言后直接重跑即可。
   ========================================================================= */
let fitAxisT = 0;
function fitAxis() {
  const ax = $("#hero .skyaxis");
  if (!ax) return;
  const mk = [...ax.querySelectorAll(".mk")];
  if (!mk.length) return;
  ax.classList.remove("tonly");
  mk.forEach(e => e.classList.remove("off", "an-l", "an-r"));
  const box = ax.getBoundingClientRect();
  const live = () => mk.filter(e => !e.classList.contains("off"))
    .map(e => ({ e, r: e.getBoundingClientRect() }));
  const outOf = rs => rs.filter(x => x.r.left < box.left - 0.5 || x.r.right > box.right + 0.5);
  const overlap = rs => rs.some((a, i) => rs.some((b, j) => j > i &&
    a.r.left < b.r.right - 0.5 && a.r.right > b.r.left + 0.5));
  /* ① 越界改锚：让标签回到面板里来 */
  outOf(live()).forEach(x => x.e.classList.add(x.r.left < box.left ? "an-l" : "an-r"));
  /* ② 名称降级：名称是"哪个阶段"，时刻才是这条轴的主角 */
  if (outOf(live()).length || overlap(live())) ax.classList.add("tonly");
  /* ③ 舍弃与邻居最贴近的中间标签，直到不再重叠（首尾不动） */
  while (outOf(live()).length || overlap(live())) {
    const mids = mk.filter(e => !e.classList.contains("off") && e.classList.contains("mid"));
    if (!mids.length) break;
    const rs = live();
    let worst = null, worstGap = Infinity;
    mids.forEach(e => {
      const r = rs.find(x => x.e === e).r;
      const gap = rs.filter(x => x.e !== e).reduce((g, x) =>
        Math.min(g, x.r.left < r.left ? r.left - x.r.right : x.r.left - r.right), Infinity);
      if (gap < worstGap) { worstGap = gap; worst = e; }
    });
    if (!worst) break;
    worst.classList.add("off");
  }
}
/* resize 重跑适配。守卫 typeof window：run_self 会在 Node 里裸载本文件
   （无 window），顶层挂监听会把纯函数自测炸掉（实测 2026-10-17）。 */
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("resize", () => {
    clearTimeout(fitAxisT);
    fitAxisT = setTimeout(fitAxis, 120);
  });
}

function renderHero(r) {
  const grade = gradeOf(r.Q);
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
  const partTxt = listJoin(r.parts.map(x => ({ gfs: "GFS", ec: "EC", rt: "光追" }[x.k] + " " + Math.round(x.I))));

  const concl = conclOf(r.P);
  /* 等级文案唯一取自 gradeOf / QUALITY_LABEL（阈值只在 QUALITY_BANDS 定义一次） */
  const qualTxt = i18n("观赏质量") + (QUALITY_LABEL[gradeOf(r.Q)] ? i18n(QUALITY_LABEL[gradeOf(r.Q)]) : "");

  /* 视觉方案 P1：结论卡 =
     天色带（这一天这一刻的真实天色）+ 衬线大字概率 + 一句结论 + 三个决策数；
     其余参数、算法指数与环境输入进默认收起的 <details>（heroFold）。
     折叠态来自 State.folds（偏好持久化，见 _p5.js 的 FOLD_KEYS）——
     每次重渲都按它现铺，因为 innerHTML 整段替换会丢掉 details 的 open。 */
  const kvIt = (k, v) => `<div class="it"><div class="k">${k}</div><div class="v">${v}</div></div>`;

  const band = skyBand(r);
  const reveal = !!band && !heroRevealed;
  if (band) heroRevealed = true;
  /* 柔光锚点：霞光窗口中心，无窗口时退回事件位置（视觉方案二 P1） */
  const glowX = band ? (band.win ? band.win.left + band.win.width / 2 : band.evPct) : 0;

  $("#hero").innerHTML = `
  ${band ? `<div class="sky${reveal ? " reveal" : ""}" role="img" style="--skyglow-x:${glowX.toFixed(2)}%"
      aria-label="${i18n("天色带：{ev} {t} 前后的曙暮光分段（民用 / 航海 / 天文）；薄纱表示低/中云遮挡", { ev: evName, t: evLocal })}">
      ${band.segs.map(s => `<span class="s ${s.cls}" style="flex:${s.m.toFixed(2)}" title="${s.title}"></span>`).join("")}
      ${band.veil ? `<span class="veil" style="background:linear-gradient(to right,${band.veil.map(v => "rgba(27,37,54," + v.a.toFixed(3) + ") " + v.p.toFixed(1) + "%").join(",")})"></span>` : ""}
      ${band.win ? `<span class="win" style="left:${band.win.left.toFixed(2)}%;width:${band.win.width.toFixed(2)}%"></span>` : ""}
      ${band.nowPct != null ? `<span class="now" style="left:${band.nowPct.toFixed(2)}%"></span>` : ""}
    </div>
    <div class="skyaxis${band.nowPct != null ? " two" : ""}">
      ${band.marks.map(m =>
        `<span class="mk ${m.kind}" style="left:${m.p.toFixed(2)}%"><i class="nm">${m.name}</i> <b>${m.t}</b></span>`).join("")}
      ${band.nowPct != null ? (() => {
        /* 锚点：右端右锚、左端左锚、中段居中 —— 三种情形下标签都贴着自己的刻度线，
           且都不会越出面板。阈值 12/88 对应"标签半宽约占带 12%"，与 11.5px 字号一致。 */
        const an = band.nowPct >= 88 ? "an-r" : band.nowPct <= 12 ? "an-l" : "an-m";
        /* 相对量只进 title：轴的正文保持绝对时刻，窄屏不因此被拉长。
           朝霞的参照是「天亮」（t18 在日出前），晚霞才是「天黑」。 */
        const d = band.darkDeltaMin;
        const rel = (d == null || !isFinite(d)) ? ""
          : (d >= 0 ? i18n(isAM ? "天亮已 {n} 分钟" : "天黑已 {n} 分钟", { n: Math.abs(d) })
                    : i18n(isAM ? "距天亮 {n} 分钟" : "距天黑 {n} 分钟", { n: Math.abs(d) }));
        return `<span class="nowlbl ${an}" style="left:${band.nowPct.toFixed(2)}%"
          title="${esc(rel)}">${i18n("现在")} ${band.nowLocal}</span>`;
      })() : ""}
    </div>` : ""}
  <div class="hero">
    <div class="hero-prob">
      <div class="hero-num">${Math.round(r.P)}<span>%</span></div>
      <div class="hero-lbl">${i18n("出现概率")}</div>
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
    </div>
  </div>
  <div class="kv hero-kv">
    ${kvIt(i18n("{ev}时刻（本地）", { ev: evName }), evLocal)}
    ${kvIt(i18n("{ev}方位角", { ev: evName }), Math.round(r.az) + "°")}
    ${kvIt(i18n("预计持续时间（头顶）"), fmtDur(r.sRT.geom.dur))}
  </div>
  <details class="fmore" id="heroFold">
    <summary>${i18n("更多参数与计算输入")}</summary>
    <div class="kv hero-kv">
      ${kvIt(i18n("日出日落线速度"), r.vSpd.toFixed(1) + " km/min")}
      ${kvIt(i18n("太阳高度角变化率"), r.omega.toFixed(3) + " °/min")}
      ${kvIt(i18n("霞光深入距离上限"), uDist(r.sRT.geom.xMax))}
      ${kvIt(i18n("云边界距离"), isNum(r.sRT.d) ? uDist(r.sRT.d) : "—")}
      ${kvIt(i18n("云底 / 等效云底"), uAlt(r.sRT.primary.base * 1000) + " / " + uAlt(r.sRT.hEff * 1000))}
      ${kvIt(i18n("光学等效地表高度"), uAlt(r.sRT.Heq * 1000))}
      ${kvIt("AOD(550nm)", n1(r.aodUse, 2))}
      ${kvIt(i18n("550nm 透射率"), r.sRT.peak.T550 < 0.01 ? r.sRT.peak.T550.toExponential(2) : r.sRT.peak.T550.toFixed(3))}
      ${kvIt(i18n("综合指数 I=0.55P+0.45Q"), Math.round(mixedIndex(r.P, r.Q)))}
    </div>
    <div class="hint" style="margin-top:9px">
      ${i18n("各算法综合指数 I（0–100，越高越好）：{parts} · 综合 {mix}", {
        parts: partTxt, mix: "<b>" + Math.round(mixedIndex(r.P, r.Q)) + "</b>" })}
    </div>
    ${envStrip(r)}
  </details>`;
  fitAxis();

/* 详情层的开合态：innerHTML 整段替换会丢掉 details 的 open，所以每次重渲都按
     State.folds 现铺一次（与 renderTrend 的 trendFold 同一手法）。 */
  const hf = $("#heroFold");
  if (hf && typeof State !== "undefined" && State.folds) hf.open = !!State.folds.heroFold;
}

/* =========================================================================
   天色带（视觉方案 P1）
   -------------------------------------------------------------------------
   把"这一天这一刻的天色"画成时间轴：按太阳高度角 0 / −6 / −12 / −18 度分段
   （白昼 / 民用 / 航海 / 天文 / 夜间），段宽＝该段**真实时长**（flex-grow 吃分钟数）。
   全部量来自 solarPosition() —— 同一份天文算法，没有手工比例。

   霞光窗口按 fireGeometry 的**真语义**锚定，不是"以事件为中心"：
     dur = (θfar − θnear) / |ω|，θnear＝云边界遮挡角、θfar＝地球遮挡角。
     晚霞：太阳继续下沉，θ 从 θnear 走到 θfar ⇒ 窗口整体在日落**之后**；
     朝霞：太阳回升，θ 从 θfar 回到 θnear ⇒ 窗口整体在日出**之前**。
   窗口若画错方位，带上那一截和"预计持续时间"就对不上了 —— 这是几何量的定义，不是排版。

   穿越时刻用二分求：高度角在事件附近单调，44 次二分远超需要。
   高纬极昼/极夜时某个穿越不存在 ⇒ 整条带返回 null（宁可没有，也不硬画假带）。
   ========================================================================= */
let heroRevealed = false;      /* 只让首帧播一次入场；之后的每次重渲都静默 */
function skyBand(r) {
  const isAM = r.period === "am";
  const evMs = isAM ? r.ev.riseMs : r.ev.setMs;
  if (!isNum(evMs)) return null;
  const lat = r.lat, lon = r.lon;
  const altOf = ms => solarPosition(ms, lat, lon).altitude;      /* 度 */
  const dir = isAM ? -1 : 1;                                     /* 朝霞向前、晚霞向后 */

  /* 求"高度角 = target 度"的穿越时刻；d 为搜索方向。
     两端同号（区间内无穿越）⇒ null —— 极昼/极夜时整条带不放。 */
  const cross = (target, d) => {
    let lo = evMs, hi = evMs + d * 6 * 3600000;
    const f = ms => altOf(ms) - target;
    if (!(f(lo) * f(hi) <= 0)) return null;
    for (let i = 0; i < 44; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) * f(lo) > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  /* 带的两端：事件前 +2°（朝阳侧）/ 事件后 −20°（入夜侧），方向相反 */
  const tEdge = cross(2, -dir);          /* 白昼那一端 */
  const t6 = cross(-6, dir), t12 = cross(-12, dir), t18 = cross(-18, dir), t20 = cross(-20, dir);
  if (!isNum(tEdge) || !isNum(t6) || !isNum(t12) || !isNum(t18) || !isNum(t20)) return null;

  const tStart = Math.min(tEdge, t20), tEnd = Math.max(tEdge, t20);
  const span = tEnd - tStart;
  if (!(span > 60000)) return null;

  /* 分段（按时间序排好，颜色取 --dusk-* 固定序列；title 是悬停解释） */
  /* 段名在**字面量处**过 i18n —— 传变量进函数再翻译会让静态扫描看不到那五个键
     （i18nprobe 会把它们报成孤儿键）。 */
  const seg = (cls, a, b, title) => ({
    cls: cls, m: Math.max(0.01, (b - a) / 60000), title: title
  });
  const segs = isAM
    ? [seg("s-night", tStart, t18, i18n("夜间")), seg("s-astro", t18, t12, i18n("天文曙暮光")),
       seg("s-naut", t12, t6, i18n("航海曙暮光")), seg("s-civil", t6, evMs, i18n("民用曙暮光")),
       seg("s-day", evMs, tEnd, i18n("白昼余晖"))]
    : [seg("s-day", tStart, evMs, i18n("白昼余晖")), seg("s-civil", evMs, t6, i18n("民用曙暮光")),
       seg("s-naut", t6, t12, i18n("航海曙暮光")), seg("s-astro", t12, t18, i18n("天文曙暮光")),
       seg("s-night", t18, tEnd, i18n("夜间"))];

  /* 霞光窗口：θnear（云边界）→ θfar（地球遮挡）之间的那段 —— 见函数头部的语义说明 */
  let win = null;
  const g = r.sRT.geom;
  if (g && g.ok && isNum(g.thNearDeg) && isNum(g.thFarDeg)) {
    /* 注意符号：thNear/thFar 是**俯角**（正数），而窗口对应的高度角是负的
       （-θnear … -θfar）。传正值会让二分找不到穿越 ⇒ 窗口恒为 null（踩过）。 */
    const a = cross(-g.thNearDeg, dir), b = cross(-g.thFarDeg, dir);
    if (isNum(a) && isNum(b)) {
      const ws = Math.max(tStart, Math.min(a, b)), we = Math.min(tEnd, Math.max(a, b));
      if (we > ws) {
        win = {
          left: (ws - tStart) / span * 100,
          width: (we - ws) / span * 100
        };
      }
    }
  }

  const localOf = ms => uClock(((ms + r.offsetS * 1000) / 3600000 % 24 + 24) % 24);

  /* P2：云量淡纹 —— 把 skyCloud 的逐时样本映射到带的横向百分比，不透明度 ∝ 遮挡云量。
     快照模式没有逐时切片（r.skyCloud 不存在）⇒ 整段跳过，带照常画。判空是硬要求。 */
  let veil = null;
  if (Array.isArray(r.skyCloud) && r.skyCloud.length >= 2) {
    const pts = r.skyCloud.map(s => ({
      p: clamp((s.t - tStart) / span * 100, 0, 100),
      a: 0.30 * clamp01(s.b / 100)
    })).sort((x, y) => x.p - y.p);
    veil = [{ p: 0, a: pts[0].a }].concat(pts, [{ p: 100, a: pts[pts.length - 1].a }]);
  }

  /* P2："现在"标记 —— 只有"所选日期＝今天"且此刻落在带内才画。
     日期用**点位时区**的墙钟判（与用户看到的 dateStr 同一口径），不是浏览器时区。 */
  let nowPct = null, nowLocal = null;
  const nowMs = Date.now();
  const todayStr = new Date(nowMs + r.offsetS * 1000).toISOString().slice(0, 10);
  if (r.dateStr === todayStr && nowMs >= tStart && nowMs <= tEnd) {
    nowPct = (nowMs - tStart) / span * 100;
    nowLocal = localOf(nowMs);
  }

  /* 轴上的两个真时刻：事件（左对齐）、天文曙暮光结束＝天黑（右对齐） */
  /* 四道分界的刻度（0 / −6 / −12 / −18°）：轴 = 一把时间尺，每道色块分界各挂
     「名称 + 时刻」。名称随时段转向 —— 晚霞是各段的**终**，朝霞是**始**；
     −18° 晚霞叫天黑、朝霞叫天亮。i18n 字面量直接写在三元里（静态扫描收三元
     实参里的全部字符串，见 i18nprobe 的 usedKeys）。 */
  const marks = [
    { p: (evMs - tStart) / span * 100, t: localOf(evMs), kind: "ev",
      name: isAM ? i18n("日出") : i18n("日落") },
    { p: (t6 - tStart) / span * 100, t: localOf(t6), kind: "mid",
      name: isAM ? i18n("渐亮") : i18n("渐暗") },
    { p: (t12 - tStart) / span * 100, t: localOf(t12), kind: "mid",
      name: isAM ? i18n("淡蓝") : i18n("深蓝") },
    { p: (t18 - tStart) / span * 100, t: localOf(t18), kind: "dark",
      name: isAM ? i18n("天亮") : i18n("天黑") }
  ].sort((a, b) => a.p - b.p);
  return {
    segs: segs, win: win, veil: veil, nowPct: nowPct, nowLocal: nowLocal,
    marks: marks,
    /* 现在距天黑多少分钟（正＝已过，负＝还没到）—— 只用于悬停提示，不进版面 */
    darkDeltaMin: nowPct == null ? null : Math.round((nowMs - t18) / 60000),
    evPct: (evMs - tStart) / span * 100,
    darkPct: (t18 - tStart) / span * 100,
    darkLocal: localOf(t18)
  };
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
      <div class="mnum">${Math.round(P)}<small>%</small></div>
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
  /* 视觉方案 P2：分享卡按新识别重画 —— 衬线标题与数字 + 天色带 + 云量薄纱；概率环退役
     （与网页 hero 一致）。字体栈与 --serif / --sans 同源，但 canvas 读不到 CSS 变量，
     只能写同一串（改栈时两处一起改）。天色/强调色**从令牌现读**，不复制色值。 */
  const SERIF = '"Songti SC","STSong","SimSun","Noto Serif CJK SC","Source Han Serif SC",serif';
  const SANS = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif';
  const f = (w, s, serif) => w + " " + s + "px " + (serif ? SERIF : SANS);
  const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  const grade = gradeOf(r.Q), gc = gradeColor(grade);
  const isAM = r.period === "am";
  const cfb = confText(r.conf || ensConfOf(r.dvI));
  const band = skyBand(r);

  /* 背景 + 等级色条（顶部 6px） */
  c.fillStyle = "#f7f8fa"; c.fillRect(0, 0, CARD_W, CARD_H);
  c.fillStyle = gc; c.fillRect(0, 0, CARD_W, 6);

  /* 天色带：与网页同一份 skyBand() 结果（分段 / 薄纱 / 窗口） */
  const BY = 6, BH = 54;
  if (band) {
    const totalM = band.segs.reduce((a, s) => a + s.m, 0) || 1;
    const DUSK = { "s-day": tok("--dusk-day"), "s-civil": tok("--dusk-civil"),
      "s-naut": tok("--dusk-nautical"), "s-astro": tok("--dusk-astro"), "s-night": tok("--dusk-night") };
    let x = 0;
    band.segs.forEach(s => {
      const w = s.m / totalM * CARD_W;
      c.fillStyle = DUSK[s.cls] || "#ccc";
      c.fillRect(x, BY, Math.ceil(w) + 0.5, BH);
      x += w;
    });
    /* 云量薄纱：同一个"0.30 × 遮挡云量"口径。**必须用渐变**——
       早先按 80 条矩形铺、各自 +0.5px 宽，重叠处透明度叠了两次，
       每 10px 一道深色竖缝（实拍抓到）。渐变由画布自己插值，没有接缝。 */
    if (band.veil) {
      const g = c.createLinearGradient(0, 0, CARD_W, 0);
      band.veil.forEach(v => g.addColorStop(Math.min(1, Math.max(0, v.p / 100)),
        "rgba(27,37,54," + v.a.toFixed(3) + ")"));
      c.fillStyle = g;
      c.fillRect(0, BY, CARD_W, BH);
    }
    /* 霞光窗口：橙条 + 白上沿（与网页同一处理） */
    if (band.win) {
      const wx = band.win.left / 100 * CARD_W;
      const ww = Math.max(3, band.win.width / 100 * CARD_W);
      c.fillStyle = tok("--acc") || "#e2601f";
      c.fillRect(wx, BY + BH - 4, ww, 4);
      c.fillStyle = "rgba(255,255,255,.85)";
      c.fillRect(wx, BY + BH - 4, ww, 1);
    }
    /* 轴：两个真时刻 */
    c.fillStyle = "#667081"; c.font = f(500, 12);
    c.textAlign = "left"; c.textBaseline = "alphabetic";
    const evT = isNum(isAM ? r.ev.riseMs : r.ev.setMs)
      ? uClock((((isAM ? r.ev.riseMs : r.ev.setMs) + r.offsetS * 1000) / 3600000 % 24 + 24) % 24) : "—";
    c.fillText(cardFit(c, i18n(isAM ? "日出" : "日落") + " " + evT, 160), band.evPct / 100 * CARD_W, 78);
    c.textAlign = "right";
    c.fillText(cardFit(c, i18n("天黑") + " " + band.darkLocal, 160), band.darkPct / 100 * CARD_W + 4, 78);
    c.textAlign = "left";
  }

  /* 左：概率（衬线大字）+ 标签 */
  c.fillStyle = "#1c2330"; c.font = f(800, 46, true); c.textAlign = "left";
  c.fillText(Math.round(r.P) + "%", 44, 156);
  c.fillStyle = "#8b96a5"; c.font = f(500, 12);
  c.fillText(i18n("出现概率"), 44, 176);

  /* 右：标题 / 日期 / 质量 / 结论 */
  const X = 252, maxW = CARD_W - X - 36;
  c.fillStyle = "#1c2330"; c.font = f(700, 25, true);
  c.fillText(cardFit(c, r.name, maxW), X, 104);
  c.fillStyle = "#8b96a5"; c.font = f(500, 13);
  c.fillText(r.dateStr + "　" + i18n(isAM ? "朝霞" : "晚霞"), X, 126);

  const qNum = String(Math.round(r.Q));
  c.fillStyle = gc; c.font = f(800, 34, true);
  c.fillText(qNum, X, 176);
  const qw = c.measureText(qNum).width;
  c.font = f(700, 17); c.fillStyle = "#1c2330";
  const qUnit = i18n("分");
  c.fillText(qUnit, X + qw + 6, 176);
  const uw = c.measureText(qUnit).width;
  const pillTxt = i18n("观赏质量") + " " + i18n(grade);
  c.font = f(700, 13);
  const pw = c.measureText(pillTxt).width + 24;
  const px = X + qw + 6 + uw + 14;
  cardRR(c, px, 154, pw, 28, 14);
  c.fillStyle = cardA(gc, .12); c.fill();
  c.strokeStyle = cardA(gc, .34); c.lineWidth = 1; c.stroke();
  c.fillStyle = gc; c.textAlign = "center";
  c.fillText(pillTxt, px + pw / 2, 172);
  c.textAlign = "left";

  /* 结论句（衬线 —— 应用唯一开口说的一次话） */
  c.fillStyle = "#1c2330"; c.font = f(600, 17, true);
  c.fillText(cardFit(c, conclOf(r.P) + i18n("（{v}）", { v: pct(r.P) }), maxW), X, 210);

  /* 细节行 */
  const p2 = r.sRT.primary;
  const rows = [
    i18n("载霞云层 {v}", { v: i18n(p2.type) }) + " · " +
      i18n("覆盖 {v}", { v: Math.round(p2.cover) + "%" }) + " · " +
      i18n("云底") + " " + uAlt(p2.base * 1000),
    i18n("云边界") + " " + (isNum(r.sRT.d) ? uDist(r.sRT.d) : i18n("无明显边界")) +
      " · " + i18n("等效云底") + " " + uAlt(r.sRT.hEff * 1000) + " · AOD " + n1(r.aodUse, 2),
    i18n("可信度 {v}", { v: cfb.lv }) + i18n("（{v}）", { v: cfb.txt + (isNum(r.dvI) ? i18n("，ΔI {v}", { v: Math.round(r.dvI) }) : "") }),
    "GFS " + Math.round(r.parts[0].I) + " · " +
      r.parts.slice(1).map(x => ({ ec: "EC ", rt: i18n("光追 ") }[x.k] + Math.round(x.I))).join(" · ") +
      " · " + i18n("综合 I {v}", { v: Math.round(mixedIndex(r.P, r.Q)) })
  ];
  c.font = f(500, 13.5);
  rows.forEach((s, k) => {
    c.fillStyle = k === 2 ? cfb.color : "#5b6675";
    c.fillText(cardFit(c, s, maxW), X, 242 + k * 23);
  });

  /* 页脚 */
  c.strokeStyle = "#e6eaf0"; c.lineWidth = 1;
  c.beginPath(); c.moveTo(40, 340); c.lineTo(CARD_W - 40, 340); c.stroke();
  c.fillStyle = "#9aa4b2"; c.font = f(500, 12);
  c.fillText(cardFit(c, i18n("霞光预报 · 数据源 Open-Meteo（GFS / ECMWF-IFS / CAMS 气溶胶）· 结论仅供观赏参考"), CARD_W - 200), 40, 366);
  c.textAlign = "right";
  c.fillText(r.leadH > 0 ? i18n("预报时效约 {n} 小时", { n: Math.round(r.leadH) }) : i18n("实况 / 历史分析场"), CARD_W - 40, 366);
  c.textAlign = "left";

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
