# -*- coding: utf-8 -*-
"""把 JS 片段与内联数据组装为单文件 HTML。

S1：模板与产物彻底分离 ——
  · 模板   tpl/template.html   只有 HTML + CSS + 3 个内联 <script> 占位块
  · 片段   _pi18n.js + _p2.js … _p6.js   按顺序填进第 0 / 第 2 个脚本块
    （`_pi18n.js` 必须排在最前：它声明全局 `i18n()` 与 `LANGS`，
      后面每个片段都可能在自己的顶层语句里用到？不 —— 顶层的 `const` 初始化
      确实会用到，见 `_p4.js` 的 QUALITY_LABEL 之类；放在首位可避免 TDZ。）
  · 数据   refs/*.txt          内联进第 0 个脚本块的占位符
  · 产物   index.html

除了主产物，另出一个 **404.html**（模板 `tpl/404.html`）。静态托管（Cloudflare
Pages / GitHub Pages / 对象存储）在**路径匹配不到任何文件**时会去取站点根下的
`404.html` 并以 404 状态返回 —— 这是纯静态站唯一的"路由兜底"，没有前端路由
可用。代价是它会在**任意深度**的 URL 下被返回，所以页内所有地址必须写成
站点根的绝对形式（`__SITE_BASE__`），不能写相对路径。

改造前 assemble.py 把**上一轮的产物**当模板读，然后原地覆写同一个文件：
一旦产物被手工改过、或某次组装中途失败，模板就被污染了，而且没有任何东西
可以回滚。现在模板是唯一、稳定的版式来源，产物可以随时删掉重新生成。

（方案里写的是把产物输出到 dist/。实际保留在项目根目录，文件名定为
 index.html —— 这是静态托管的**默认文档名**：同一份自包含产物既能本地双击
 打开，也能直接丢进任意静态托管 / GitHub Pages 当站点入口（不必再配首页
 映射）；顺带避开中文文件名在托管上的 URL 编码与大小写不一致问题。
 代价是"产物名"散落在构建脚本与各探针里，改名必须同步：本文件的 OUT / wr，
 mkpreview.py 的读取，以及 syntax / run_self / datacheck / timeoutprobe /
 aodscale / docfacts 的读取路径。）
"""
import base64
import io
import os
import re
import struct
import sys
import zlib

BASE = os.path.dirname(os.path.abspath(__file__))
TPL = os.path.join(BASE, "tpl", "template.html")
OUT = os.path.join(BASE, "index.html")

# ---- 第二个产物：404 页（模板 + 站点根路径占位符），见文件头说明。
TPL404 = os.path.join(BASE, "tpl", "404.html")
OUT404 = os.path.join(BASE, "404.html")

PARTS = ["_pi18n.js", "_p2.js", "_p3.js", "_p4.js", "_p5.js", "_p5b.js", "_p6.js"]
DATA = ["refs/CN_CITIES_RAW.txt", "refs/MAP_CITIES_RAW.txt",
        "refs/GLOBAL_CITIES_RAW.txt", "refs/GL_ALIAS_RAW.txt"]
HOLES = ["/*__CN_CITIES__*/", "/*__MAP_CITIES__*/", "/*__GLOBAL_CITIES__*/", "/*__GL_ALIAS__*/"]

# 第五个占位符在 _p6.js 里（不在 block0）：0.5° 高程网格，供 D2 的跨地形插值使用。
# 文件还没生成时保留占位符原样 —— 前端检测到占位符会令 ELEV = null，自动退化为
# "整行单段"（即改造前的行为），不会报错、也不影响其它功能。
ELEV_HOLE = "/*__ELEV_GRID__*/"
ELEV_FILE = "refs/ELEV_GRID_RAW.txt"

SCRIPT_RE = re.compile(r'<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)</script>')

# 地图代理地址。腾讯地图的 key 不能进产物（单文件 HTML，谁都能看到 key），
# 所以地图请求要走中转端点，端点地址由**部署环境**在构建时注入：
#   TMAP_SERVICE_HOST 设了 → 注入该值（自行部署：https://你的域名/_TMapService，
#                            由 functions/_TMapService/[[path]].js 提供）
#   没设                  → 回落成 WorkBuddy 预览环境认识的 __WB_* 形态，
#                            也就是本改动之前的行为，开发预览完全不受影响
# 产物里不允许留下这个占位符：前端 isMapProxyPlaceholder() 靠它判断
# "地图其实是部署没配"，留着就等于把"没配"伪装成"配好了"。
TMAP_HOLE = "__TMAP_SERVICE_HOST__"
TMAP_DEV_FALLBACK = ("http://127.0.0.1:__WB_HTTP_PORT__"
                     "/_TMapService/_wbt/__WB_TMAP_SECRET__")

# ---- 图标。单文件产物的硬约束是"不能引外部图片文件"，所以图标必须内联成 data-URI。
# 两个形态都要，原因很实际：
#   · SVG  给浏览器 favicon 用（矢量、极小、几行文本就能维护）；
#   · PNG  给 apple-touch-icon 用 —— iOS **不支持** SVG 格式的 apple-touch-icon，
#          给它 SVG 等于写了一条会被静默忽略的声明。所以真的需要一张位图。
# PNG 用纯 stdlib 手工编码（zlib + struct），不依赖 Pillow：
# assemble.py 会被不同解释器调用（本项目就有两个 Python），少一个依赖少一类"在我这能跑"。
ICON_SVG_HOLE = "__ICON_SVG__"
ICON_PNG_HOLE = "__ICON_PNG180__"
ICON_PX = 180

# ---- 站点根路径（只给 404 页用）。
# 404 页会被托管平台套在**任意深度**的未知路径下返回，页内地址必须是站点根的
# 绝对形式：写相对地址会按**请求的那个 URL** 解析（请求 /a/b → 解析成 /a/index.html），
# 越深的错链错得越离谱；写死 "/" 又照顾不到部署在子路径下的站点
# （GitHub Pages 的项目页是 /仓库名/）。所以跟地图代理走同一条路 —— 构建期注入：
#   SITE_BASE 设了 → 用它（缺首尾斜杠由脚本补，只写 "sunglow" 也认）
#   没设            → "/"（站点在域名根下：Cloudflare Pages、自定义域名都是这种）
SITE_BASE_HOLE = "__SITE_BASE__"

_SKY_STOPS = [(0.00, (255, 207, 107)), (0.55, (244, 121, 31)), (1.00, (168, 32, 13))]


def _sky_rgb(t):
    """天空渐变：顶部浅金 → 中部橙 → 底部深红（与 SVG 里那三条 stop 同色）。"""
    for i in range(1, len(_SKY_STOPS)):
        t0, c0 = _SKY_STOPS[i - 1]
        t1, c1 = _SKY_STOPS[i]
        if t <= t1:
            f = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
            return tuple(int(round(c0[k] + (c1[k] - c0[k]) * f)) for k in range(3))
    return _SKY_STOPS[-1][1]


def icon_svg():
    """favicon 的内联 SVG data-URI。

    `#` 在 data-URI 里是片段分隔符，必须写成 %23 —— 写成裸 `#` 会让浏览器把
    `%23ffcf6b` 之后的内容当成 URL 片段丢掉，结果是"图标一片空白、控制台无报错"。
    图形与 icon_png() 一致：落日渐变 + 半沉入地平线的太阳（半径扫过 180°）。"""
    svg = ("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>"
           "<defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'>"
           "<stop offset='0' stop-color='%23ffcf6b'/>"
           "<stop offset='.55' stop-color='%23f4791f'/>"
           "<stop offset='1' stop-color='%23a8200d'/>"
           "</linearGradient></defs>"
           "<rect width='64' height='64' fill='url(%23g)'/>"
           "<path d='M22 40A18 18 0 0 1 58 40z' fill='%23fff2cc'/>"
           "</svg>")
    return "data:image/svg+xml," + svg


def icon_png(n=ICON_PX):
    """生成 n×n RGBA 的 PNG 字节串（纯 stdlib）。

    图形：整幅竖直渐变 + 一个只画上半部分的太阳（下半被地平线切掉）——
    "半沉入地平线的太阳"在 32px 下仍能认出，而纯色块或细线条不能。
    不做圆角：iOS 会对 apple-touch-icon 套自己的超椭圆遮罩，画了也是白画；
    浏览器侧用的是 SVG 那个，两者不必长得完全一样。
    """
    hz = n * 62 // 100                       # 地平线所在行
    scx, scy, sr = (n - 1) / 2.0, hz, n * 21 // 100

    raw = bytearray()
    for y in range(n):
        raw.append(0)                        # PNG 每行的 filter 字节：0 = None
        sky = _sky_rgb(y / (n - 1.0))
        # 太阳边缘按到圆心的距离做 2px 羽化，否则缩小到 32px 会有明显锯齿
        for x in range(n):
            r, g, b = sky
            if y <= hz:
                d = ((x - scx) ** 2 + (y - scy) ** 2) ** 0.5
                if d <= sr:
                    a = 235.0 if d <= sr - 2 else 235.0 * max(0.0, sr - d) / 2.0
                    k = a / 255.0
                    r = int(round(r * (1 - k) + 255 * k))
                    g = int(round(g * (1 - k) + 242 * k))
                    b = int(round(b * (1 - k) + 204 * k))
            raw += bytes((r, g, b, 255))

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))


def rd(p):
    """按原始字节语义读文本：newline='' 保留源文件里的换行，避免组装时被悄悄改写。"""
    with io.open(os.path.join(BASE, p), encoding="utf-8", newline="") as f:
        return f.read()


def wr(p, s):
    with io.open(os.path.join(BASE, p), "w", encoding="utf-8", newline="") as f:
        f.write(s)


def main():
    tpl = rd("tpl/template.html")
    parts = {p: rd(p) for p in PARTS}

    # ---- 脚本块归属：**除 _p6.js 之外的全部片段进块 0，_p6.js 单独进块 2**。
    # 这里原来写的是 `PARTS[:5]`（按"当时正好 5 个片段"硬编码）—— 加 `_pi18n.js`
    # 变 7 个之后，`_p5b.js` 被**静默丢在产物之外**：结果卡整块消失，而构建照常
    # 报 OK、语法检查照常通过（少一个片段不会报错，只会少东西）。
    # 抓到它的是 `xssprobe` 里那条"热点已转义：esc(r.name)" —— 它断言的字符串
    # 就在 _p5b.js 里。所以下面既改成语义切片，又加一条**结构性守卫**：
    # 块 0 的片段集合必须正好等于 PARTS 去掉最后一个。
    BLOCK2 = ["_p6.js"]
    block0_files = [p for p in PARTS if p not in BLOCK2]
    if block0_files != PARTS[:-1] or PARTS[-1] not in BLOCK2:
        print("脚本块归属异常：块 2 = %s，但 PARTS 的最后一个是 %s"
              % (BLOCK2, PARTS[-1]), file=sys.stderr)
        return 1

    # ---- 内联数据：四个占位符必须各出现一次，多了少了都说明数据文件与片段对不上
    block0 = "\n".join(parts[p] for p in block0_files)
    for hole, path in zip(HOLES, DATA):
        n = block0.count(hole)
        if n != 1:
            print("数据占位符异常：%s 出现 %d 次（应为 1）" % (hole, n), file=sys.stderr)
            return 1
        block0 = block0.replace(hole, rd(path).strip())

    # ---- 地图代理地址：模板里必须恰好一个占位符
    nt = tpl.count(TMAP_HOLE)
    if nt != 1:
        print("地图代理占位符异常：%s 出现 %d 次（应为 1）" % (TMAP_HOLE, nt), file=sys.stderr)
        return 1
    tmap_host = os.environ.get("TMAP_SERVICE_HOST") or TMAP_DEV_FALLBACK
    tpl = tpl.replace(TMAP_HOLE, tmap_host)

    # ---- 图标：两个占位符各恰好一次，注入后不留残迹
    png_b64 = base64.b64encode(icon_png()).decode("ascii")
    for hole, val, what in ((ICON_SVG_HOLE, icon_svg(), "SVG favicon"),
                            (ICON_PNG_HOLE, png_b64, "PNG apple-touch-icon")):
        nc = tpl.count(hole)
        if nc != 1:
            print("图标占位符异常：%s 出现 %d 次（应为 1）" % (hole, nc), file=sys.stderr)
            return 1
        tpl = tpl.replace(hole, val)
        print("%s：%d 字符（内联 data-URI）" % (what, len(val)))

    blocks = list(SCRIPT_RE.finditer(tpl))
    if len(blocks) != 3:
        print("模板里的内联脚本块数量异常：%d（应为 3）" % len(blocks), file=sys.stderr)
        return 1
    if "/*__BLOCK0__*/" not in blocks[0].group(1) or "/*__BLOCK2__*/" not in blocks[2].group(1):
        print("模板里的脚本占位标记缺失，可能被误编辑过", file=sys.stderr)
        return 1

    def fill(tpl_text, idx, content):
        b = list(SCRIPT_RE.finditer(tpl_text))[idx]
        return tpl_text[:b.start(1)] + content + tpl_text[b.end(1):]

    p6 = parts["_p6.js"]
    n6 = p6.count(ELEV_HOLE)
    if n6 != 1:
        print("高程占位符异常：%s 出现 %d 次（应为 1）" % (ELEV_HOLE, n6), file=sys.stderr)
        return 1
    if os.path.exists(os.path.join(BASE, ELEV_FILE)):
        p6 = p6.replace(ELEV_HOLE, rd(ELEV_FILE).strip())
    else:
        print("提示：%s 尚不存在，高程网格未注入（前端自动退化为整行单段）" % ELEV_FILE)

    out = fill(tpl, 2, "\n" + p6 + "\n")
    out = fill(out, 0, "\n" + block0 + "\n")
    # 注入失败的兜底：**配置那一行**绝不能留下占位符 —— 留着会被前端当成"部署没配"，
    # 而它其实只是构建脚本漏了替换。宁可在这里失败，也不要让产物静默带病出厂。
    # 注意判据只盯 `serviceHost: '<占位符>'` 这一处，不能在全文档里搜这个字符串：
    # _p6.js 的 isMapProxyPlaceholder() 正则里本来就有它（那是"识别残留"用的），
    # 全文档搜会把正常情况误判成失败。
    if ("serviceHost: '%s'" % TMAP_HOLE) in out:
        print("地图代理占位符未被替换：%s" % TMAP_HOLE, file=sys.stderr)
        return 1
    if ("serviceHost: '%s'" % tmap_host) not in out:
        print("地图代理地址注入后未出现在产物中：%s" % tmap_host, file=sys.stderr)
        return 1
    wr("index.html", out)
    src = "环境变量 TMAP_SERVICE_HOST" if os.environ.get("TMAP_SERVICE_HOST") else "本地预览回落值"
    print("地图代理地址取自%s：%s" % (src, tmap_host))
    print("OK -> %s  %d bytes" % (OUT, len(out.encode("utf-8"))))

    # ---- 第二个产物：404 页。图标与主页同一枚（同样必须内联，这页要能在任意
    # 路径下独立打开），站点根地址按部署环境注入。
    t404 = rd("tpl/404.html")
    for hole, val in ((ICON_SVG_HOLE, icon_svg()), (ICON_PNG_HOLE, png_b64)):
        nc = t404.count(hole)
        if nc != 1:
            print("404 模板图标占位符异常：%s 出现 %d 次（应为 1）" % (hole, nc), file=sys.stderr)
            return 1
        t404 = t404.replace(hole, val)
    site_base = os.environ.get("SITE_BASE") or "/"
    if not site_base.startswith("/"):
        site_base = "/" + site_base
    if not site_base.endswith("/"):
        site_base += "/"
    nb = t404.count(SITE_BASE_HOLE)
    if nb < 1:
        print("404 模板里没有站点根占位符：%s" % SITE_BASE_HOLE, file=sys.stderr)
        return 1
    t404 = t404.replace(SITE_BASE_HOLE, site_base)
    # 与地图代理同一条纪律：占位符**不允许残留**。留着会让"回首页"跳到一个
    # 字面量叫 __SITE_BASE__ 的地址上，而且这种错只在部署后才看得见。
    if SITE_BASE_HOLE in t404:
        print("站点根占位符替换后仍有残留：%s" % SITE_BASE_HOLE, file=sys.stderr)
        return 1
    wr("404.html", t404)
    print("OK -> %s  %d bytes（站点根 %s）" % (OUT404, len(t404.encode("utf-8")), site_base))
    return 0


if __name__ == "__main__":
    sys.exit(main())
