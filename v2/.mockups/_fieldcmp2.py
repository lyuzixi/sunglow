# -*- coding: utf-8 -*-
"""色面方案决策图：同一批真实采样值，6 种方案并排"""
import json, math
from PIL import Image, ImageDraw, ImageFont
FONT = ImageFont.truetype(r"C:/Windows/Fonts/msyh.ttc", 15)

P = r"D:\wbfile\sunglow\v2\.mockups\.build\pts.json"
d = json.load(open(P, encoding="utf-8"))
pts = d["pts"]
lat0 = sum(p["lat"] for p in pts) / len(pts)
lon0 = sum(p["lon"] for p in pts) / len(pts)
coslat = max(0.2, math.cos(math.radians(lat0)))
KX, KY = 111.32 * coslat, 110.574

KM = [((p["lon"] - lon0) * KX, (p["lat"] - lat0) * KY, p["v"], p["name"]) for p in pts]
xs = [q[0] for q in KM]; ys = [q[1] for q in KM]
PAD = 250.0
x0, x1 = min(xs) - PAD, max(xs) + PAD
y0, y1 = min(ys) - PAD, max(ys) + PAD
PX = 5.0  # km per pixel
W = int((x1 - x0) / PX); H = int((y1 - y0) / PX)

RAMP = ["#ffffff", "#fff7b0", "#ffe44d", "#ffc220", "#ff9520", "#fa6a16", "#ee3c15", "#d51313"]
def h2r(h): return tuple(int(h[i:i+2], 16) for i in (1, 3, 5))
RGB = [h2r(c) for c in RAMP]

def color_at(v, banded):
    v = max(0.0, min(100.0, v))
    x = v / 100 * (len(RGB) - 1)
    if banded:
        b = max(0, min(6, int(v / 100 * 7)))
        x = ((b + 0.5) / 7) * (len(RGB) - 1)
    i = max(0, min(len(RGB) - 2, int(x)))
    f = x - i
    a, b = RGB[i], RGB[i + 1]
    return tuple(round(a[k] + (b[k] - a[k]) * f) for k in range(3))

def idw(x, y, src, lam):
    sw = sv = 0.0
    for (X, Y, v, _n) in src:
        dd = (x - X) ** 2 + (y - Y) ** 2
        w = 1.0 / (dd + lam * lam)
        sw += w; sv += w * v
    return sv / sw if sw else 0.0

# 趋势 + 残差：大尺度 λ=140，残差 λ=72 折 0.7
LAM_T, LAM_R, ALPHA = 140.0, 72.0, 0.70
TREND = [idw(X, Y, KM, LAM_T) for (X, Y, _v, _n) in KM]
RES = [(X, Y, v - TREND[i], n) for i, (X, Y, v, n) in enumerate(KM)]

def render(mode, banded):
    im = Image.new("RGB", (W, H), (248, 248, 250))
    px = im.load()
    for j in range(H):
        yy = y1 - (j + 0.5) * PX
        for i in range(W):
            xx = x0 + (i + 0.5) * PX
            if mode == "lam30":
                v = idw(xx, yy, KM, 30.0)
            elif mode == "lam60":
                v = idw(xx, yy, KM, 60.0)
            elif mode == "lam90":
                v = idw(xx, yy, KM, 90.0)
            else:  # trend
                v = idw(xx, yy, KM, LAM_T) + ALPHA * idw(xx, yy, RES, LAM_R)
            px[i, j] = color_at(v, banded)
    dr = ImageDraw.Draw(im)
    for (X, Y, v, n) in KM:
        cx = (X - x0) / PX; cy = (y1 - Y) / PX
        if 0 <= cx < W and 0 <= cy < H:
            dr.ellipse([cx - 1.8, cy - 1.8, cx + 1.8, cy + 1.8], fill=(25, 25, 35))
    return im

panels = [
    ("① 现状 平滑半径30km + 7档", "lam30", True),
    ("② 平滑半径90km + 7档", "lam90", True),
    ("③ 趋势+残差 + 7档", "trend", True),
    ("④ 现状 平滑半径30km + 连续", "lam30", False),
    ("⑤ 平滑半径60km + 连续", "lam60", False),
    ("⑥ 趋势+残差 + 连续", "trend", False),
]
TITLE = 24
PADG = 8
sheet = Image.new("RGB", (W * 3 + PADG * 4, (H + TITLE) * 2 + PADG * 3), (255, 255, 255))
dr = ImageDraw.Draw(sheet)
for k, (name, mode, banded) in enumerate(panels):
    im = render(mode, banded)
    cx = PADG + (k % 3) * (W + PADG)
    cy = PADG + (k // 3) * (H + TITLE + PADG)
    dr.text((cx + 4, cy + 4), name, fill=(10, 10, 20), font=FONT)
    sheet.paste(im, (cx, cy + TITLE))
out = r"D:\wbfile\sunglow\v2\.mockups\.shots\field-options.png"
sheet.save(out)
print("saved", out, sheet.size)

# 峰值保留 / 全场误差
def at(mode, X, Y):
    if mode == "trend":
        return idw(X, Y, KM, LAM_T) + ALPHA * idw(X, Y, RES, LAM_R)
    return idw(X, Y, KM, {"lam30": 30.0, "lam60": 60.0, "lam90": 90.0}[mode])

print("\n方案            采样点MAE   厦门峰(真值85.5)   峰值保留")
for mode in ("lam30", "lam60", "lam90", "trend"):
    errs = [abs(at(mode, X, Y) - v) for (X, Y, v, _n) in KM]
    xm = next((X, Y) for (X, Y, v, n) in KM if "厦门" in n)
    vx = at(mode, xm[0], xm[1])
    print("  %-10s %8.2f %14.1f %11.0f%%" % (mode, sum(errs)/len(errs), vx, vx/85.5*100))
