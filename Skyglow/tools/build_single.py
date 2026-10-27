"""Assemble the Skyglow P0 single-file page.

    python tools/build_single.py

Inputs (read-only):
    web/tpl.html          shell + style/script placeholders
    web/styles.css        warm UI styles
    js/data/params.js     MODEL / NN literals
    js/core/*.js          algorithm + data + orchestration modules
    js/ui/*.js            DOM / canvas UI modules
Output:
    Skyglow/index.html    one self-contained HTML, double-click friendly
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "index.html")
TPL = os.path.join(HERE, "web", "tpl.html")
CSS = os.path.join(HERE, "web", "styles.css")

CORE = [
    "util", "solar", "spectrum", "model", "nn", "meteo", "weatherapi",
    "hints", "geocode", "store", "glowmap", "service",
]
UI = ["maps", "analysis", "app", "toc"]
DATA = [os.path.join(HERE, "js", "data", "params.js")]
VALIDATION = os.path.join(HERE, "data", "validation.json")
NN_METRICS = os.path.join(HERE, "data", "nn_metrics.json")
CHINA = os.path.join(HERE, "web", "china.json")

MAX_KB = 900


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def read_js(kind, name):
    return read(os.path.join(HERE, "js", kind, name + ".js"))


def check(html):
    errs = []
    if re.search(r"<script[^>]*\bsrc=", html, re.I):
        errs.append("仍有外链 <script src=>")
    if re.search(r"<link[^>]*rel=[\"']stylesheet", html, re.I):
        errs.append("仍有外链样式 <link rel=stylesheet>")
    if re.search(r"fetch\(\s*[\"'`]/api", html):
        errs.append("仍有 fetch('/api...') 网络调用")
    if "/api/" in html:
        errs.append("仍有 /api/ 路径残留")
    if re.search(r"\btype=[\"']module[\"']", html):
        errs.append("仍有 type=module（file:// 不可用）")
    if "/*__" in html:
        errs.append("仍有未替换的占位符")
    if not re.search(r"const MODEL\s*=", html):
        errs.append("缺少内联 MODEL")
    if not re.search(r"const NN\s*=", html):
        errs.append("缺少内联 NN")
    if "var CHINA_GEO =" not in html:
        errs.append("缺少内联省界 CHINA_GEO")
    if "var VALIDATION =" not in html:
        errs.append("缺少内联回测 VALIDATION")
    if "var NN_METRICS =" not in html:
        errs.append("缺少内联神经网络指标 NN_METRICS")
    return errs


def main():
    html = read(TPL)
    css = read(CSS)
    data = "\n".join(read(p) for p in DATA)
    # 回测验证与神经网络指标：JSON 即合法 JS 字面量，直接内联为 var
    data += "\nvar VALIDATION = " + read(VALIDATION).strip() + ";\n"
    data += "\nvar NN_METRICS = " + read(NN_METRICS).strip() + ";\n"
    # 省界内联为 var（var 才会挂到 window，maps.js 通过 window.CHINA_GEO 读取）
    data += "\nvar CHINA_GEO = " + read(CHINA).strip() + ";\n"
    core = "\n".join(read_js("core", m) for m in CORE)
    ui = "\n".join(read_js("ui", m) for m in UI)

    html = html.replace("/*__STYLE__*/", css)
    html = html.replace("/*__DATA__*/", data)
    html = html.replace("/*__CORE__*/", core)
    html = html.replace("/*__UI__*/", ui)

    errs = check(html)
    if errs:
        for e in errs:
            print("✗ " + e, file=sys.stderr)
        return 1
    if len(html.encode("utf-8")) > MAX_KB * 1024:
        print("✗ 产物超过 %d KB 预算" % MAX_KB, file=sys.stderr)
        return 1

    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    print("wrote %s" % OUT)
    print("  size : %.1f KB" % (os.path.getsize(OUT) / 1024))
    print("  core : %s" % ", ".join(CORE))
    print("  ui   : %s" % ", ".join(UI))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
