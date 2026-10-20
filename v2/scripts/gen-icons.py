# v2/scripts/gen-icons.py —— 生成 PWA 图标（手写 PNG：struct+zlib 编码扫描线，无 PIL）。
# 图案：深空蓝黑圆角矩形底（#070b14）+ 光谱渐变圆环（品红→琥珀→电离青，沿环渐变）
#       + 中心渐变圆点，无文字。另输出 64px favicon 的 data URI（404.html 内联用）。
import base64
import math
import struct
import zlib
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent.parent / "public"

MAG = (255.0, 77.0, 130.0)   # #ff4d82 品红
AMB = (255.0, 156.0, 63.0)   # #ff9c3f 琥珀
CYA = (46.0, 213.0, 232.0)   # #2ed5e8 电离青
BG = (7.0, 11.0, 20.0)       # #070b14 深空蓝黑


def _mix(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def spectrum_cyclic(t):
    """沿环的三段闭合渐变：品红→琥珀→电离青→品红。t∈[0,1)。"""
    t %= 1.0
    if t < 1.0 / 3.0:
        return _mix(MAG, AMB, t * 3.0)
    if t < 2.0 / 3.0:
        return _mix(AMB, CYA, (t - 1.0 / 3.0) * 3.0)
    return _mix(CYA, MAG, (t - 2.0 / 3.0) * 3.0)


def spectrum_linear(t):
    """圆点用的单向渐变：品红→琥珀→电离青。t∈[0,1]。"""
    t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
    if t < 0.5:
        return _mix(MAG, AMB, t * 2.0)
    return _mix(AMB, CYA, (t - 0.5) * 2.0)


def smoothstep(e0, e1, x):
    t = (x - e0) / (e1 - e0)
    if t <= 0.0:
        return 0.0
    if t >= 1.0:
        return 1.0
    return t * t * (3.0 - 2.0 * t)


def sd_round_rect(dx, dy, hw, hh, r):
    """圆角矩形有符号距离（内负外正），中心在 (dx,dy)=(0,0)。"""
    qx = abs(dx) - (hw - r)
    qy = abs(dy) - (hh - r)
    ax = qx if qx > 0.0 else 0.0
    ay = qy if qy > 0.0 else 0.0
    return math.sqrt(ax * ax + ay * ay) + min(max(qx, qy), 0.0) - r


def render(size):
    """渲染 size×size RGBA 行列表。逐像素解析抗锯齿（SDF/半径 smoothstep）。"""
    S = size
    c = S / 2.0
    corner = 0.215 * S     # 圆角半径
    ring_r = 0.285 * S     # 圆环中心线半径
    ring_hw = 0.0425 * S   # 圆环半宽
    dot_r = 0.112 * S      # 中心圆点半径
    aa = 0.7               # 边缘抗锯齿半宽（px）
    rows = []
    for y in range(S):
        dy = (y + 0.5) - c
        row = bytearray()
        for x in range(S):
            dx = (x + 0.5) - c

            # 底：深空蓝黑圆角矩形
            a_bg = 1.0 - smoothstep(-aa, aa, sd_round_rect(dx, dy, c, c, corner))
            r, g, b, a = BG[0], BG[1], BG[2], a_bg

            d = math.sqrt(dx * dx + dy * dy)

            # 光谱圆环：沿环（角向）渐变，再 alpha-over 到已画层
            cov = 1.0 - smoothstep(ring_hw - aa, ring_hw + aa, abs(d - ring_r))
            if cov > 0.0:
                t = (math.atan2(dy, dx) + math.pi) / (2.0 * math.pi) - 0.25
                cr, cg, cb = spectrum_cyclic(t)
                na = cov + a * (1.0 - cov)
                if na > 0.0:
                    inv = 1.0 - cov
                    r = (cr * cov + r * a * inv) / na
                    g = (cg * cov + g * a * inv) / na
                    b = (cb * cov + b * a * inv) / na
                    a = na

            # 中心渐变圆点：左上品红 → 右下电离青
            cov = 1.0 - smoothstep(dot_r - aa, dot_r + aa, d)
            if cov > 0.0:
                t = (dx + dy) / (2.8284 * dot_r) + 0.5
                cr, cg, cb = spectrum_linear(t)
                na = cov + a * (1.0 - cov)
                if na > 0.0:
                    inv = 1.0 - cov
                    r = (cr * cov + r * a * inv) / na
                    g = (cg * cov + g * a * inv) / na
                    b = (cb * cov + b * a * inv) / na
                    a = na

            def u8(v):
                v = int(v + 0.5)
                return 0 if v < 0 else (255 if v > 255 else v)

            row += bytes((u8(r), u8(g), u8(b), u8(a * 255.0)))
        rows.append(row)
    return rows


def png_bytes(size, rows):
    raw = bytearray()
    for row in rows:
        raw.append(0)          # 每行 filter type = None
        raw.extend(row)
    comp = zlib.compress(bytes(raw), 9)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", comp)
        + chunk(b"IEND", b"")
    )


def main():
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for name, size in (("icon-192.png", 192), ("icon-512.png", 512)):
        data = png_bytes(size, render(size))
        (PUBLIC / name).write_bytes(data)
        print(f"wrote {PUBLIC / name} ({size}x{size}, {len(data)} bytes)")

    # 404.html 内联 favicon 用的 data URI（自包含、零外链）。
    # 不落盘到 public/：Vite 会把 public/ 全部拷进 dist，临时文件不该混进产物。
    fav = png_bytes(64, render(64))
    uri = "data:image/png;base64," + base64.b64encode(fav).decode("ascii")
    print("FAVICON_DATA_URI_BEGIN")
    print(uri)
    print("FAVICON_DATA_URI_END")


if __name__ == "__main__":
    main()
