# -*- coding: utf-8 -*-
"""牛眼诊断：读真实采样值，复现色面插值，量化「每点一个圆盘」的伪影"""
import json, math, collections, sys

P = r"D:\wbfile\sunglow\v2\.mockups\.build\pts.json"
d = json.load(open(P, encoding="utf-8"))
pts = d["pts"]
print("维度", d["dim"], "模型", d["model"], "点数", len(pts))

# ---- 1. 值分布：有没有一堆点共享同一个异常值（评分塌底） ----
vs = [round(p["v"], 2) for p in pts]
cnt = collections.Counter(vs)
print("\n[1] 值分布（众数）:")
for v, n in cnt.most_common(8):
    print("   v=%-6s ×%d" % (v, n))
print("   min=%.1f max=%.1f 中位=%.1f" % (min(vs), max(vs), sorted(vs)[len(vs)//2]))
# P/Q 组合重复
pq = collections.Counter((round(p["P"], 3), round(p["Q"], 3)) for p in pts)
print("   P/Q 组合重复 top3:", pq.most_common(3))

# ---- 2. 局部极值：谁在自己的邻居圈里是孤峰/孤谷 ----
lat0 = sum(p["lat"] for p in pts) / len(pts)
coslat = max(0.2, math.cos(math.radians(lat0)))
def km(a, b):
    dx = (a["lon"] - b["lon"]) * 111.32 * coslat
    dy = (a["lat"] - b["lat"]) * 110.574
    return math.hypot(dx, dy)

R_NB = 200.0
ext = []
for i, p in enumerate(pts):
    nb = [(km(p, q), q) for j, q in enumerate(pts) if j != i and km(p, q) <= R_NB]
    if not nb:
        continue
    dmin = min(n for n, _ in nb)
    hi = max(q["v"] for _, q in nb)
    lo = min(q["v"] for _, q in nb)
    if p["v"] >= hi + 6:
        ext.append(("峰", p["v"] - hi, dmin, p))
    elif p["v"] <= lo - 6:
        ext.append(("谷", lo - p["v"], dmin, p))
ext.sort(key=lambda t: -t[1])
print("\n[2] 200km 邻域内的孤立极值点（|差| > 6 分）: 共 %d 个" % len(ext))
for kind, dv, dmin, p in ext[:12]:
    print("   %s %-22s v=%5.1f 孤立度 %5.1f 分  最近邻 %5.0f km  (%.2f,%.2f)"
          % (kind, p["name"], p["v"], dv, dmin, p["lat"], p["lon"]))

# ---- 3. 单点主导半径：w_p(d)=Σw_others(d) 的解（对称近似用最近邻间距） ----
print("\n[3] 当前正则化 λ=30km、格距 120km 时，单点「盘子」半径估计:")
dp = sorted(km(p, q) for i, p in enumerate(pts) for j, q in enumerate(pts) if i < j)
print("   点间距: 最近 %.0f km / 中位 %.0f km / 最远 %.0f km"
      % (dp[0], dp[len(dp)//2], dp[-1]))
lam = 30.0
for D in (60, 90, 120):
    # 沿连线：w_home(d) = w_nb(D-d)，解 d
    lo_, hi_ = 1e-6, D
    f = lambda x: 1/(x*x+lam*lam) - 1/((D-x)**2+lam*lam)
    for _ in range(60):
        m = (lo_+hi_)/2
        if f(m) > 0: lo_ = m
        else: hi_ = m
    print("   邻点距 %3.0f km → 主场半径 %4.1f km（直径 %4.1f km = 屏上 %3.0f px @1069km/878px）"
          % (D, lo_, lo_*2, lo_*2/1069*878))

# ---- 4. 换个判据：把整条 200km 剖面打印出来，看是否「平台 + 陡沿」 ----
print("\n[4] 穿过最极端点的剖面试样（步长 10km，看平台/陡沿）:")
if ext:
    kind, dv, dmin, p0 = ext[0]
    nb = sorted(((km(p0, q), q) for q in pts if q is not p0), key=lambda t: t[0])[0]
    far, q0 = nb
    print("   %s → 最近邻 %s (%.0f km, v=%.1f)" % (p0["name"], q0["name"], far, q0["v"]))
    out = []
    for t in range(0, int(far) + 1, 10):
        r = t / far if far else 0
        la = p0["lat"] + (q0["lat"] - p0["lat"]) * r
        lo_ = p0["lon"] + (q0["lon"] - p0["lon"]) * r
        sw = sv = 0.0
        for q in pts:
            dx = (lo_ - q["lon"]) * 111.32 * coslat
            dy = (la - q["lat"]) * 110.574
            w = 1 / (dx*dx + dy*dy + 900)
            sw += w; sv += w * q["v"]
        out.append("%2dkm:%5.1f" % (t, sv/sw))
    print("   " + "  ".join(out))
