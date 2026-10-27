/* ---------------- confidence / reasons / risks ---------------- */
function confidence(lead, sourceKind, w) {
  let c;
  if (sourceKind === "direct") {
    c = 0.74;
    if (w.spread != null) c -= Math.min(0.15, w.spread / 400);
    return clamp(c, 0.2, 0.9);
  }
  c = 0.86 - 0.058 * Math.max(0, lead);
  if (w.spread != null) c -= Math.min(0.22, w.spread / 280);
  if (w.aod == null) c -= 0.08;
  return clamp(c, 0.15, 0.95);
}

function reasons(w, r) {
  const f = r.features, out = [];
  if (f.canvas < 0.20) out.push({ k: "neg", t: "缺少可被照亮的云层：中高空云量不足以形成幕布" });
  else if (f.canvas < 0.45) out.push({ k: "warn", t: "云量偏少，只有局部云块可能被染色" });
  else out.push({ k: "pos", t: "中高空云层配置良好，具备大面积受光条件" });

  if (f.horizon < 0.55) out.push({ k: "neg", t: "太阳方向低云遮挡明显，光路被切断（上游低云 " + Math.round(w.cc_low_up || 0) + "%）" });
  else if (f.horizon < 0.8) out.push({ k: "warn", t: "上游低云偏多，地平线附近光路存在不确定性" });

  if (f.purity < 0.55) out.push({ k: "neg", t: "空气通透度不足：气溶胶消光或湿度偏高，颜色会发灰" });
  else if (f.purity > 0.85) out.push({ k: "pos", t: "大气洁净干燥，瑞利散射占主导，颜色更纯" });

  if (f.light < 0.02) out.push({ k: "neg", t: "到达云底的直射光已极弱，接近地球阴影边界" });
  else if (f.light < 0.06) out.push({ k: "warn", t: "云底较低，受光时间窗口短、亮度有限" });
  else out.push({ k: "pos", t: "云底受光充分，亮度条件良好" });

  if ((w.precip || 0) >= 0.2) out.push({ k: "neg", t: "事件时段有降水，云系厚度大、透光性差" });
  return out;
}

