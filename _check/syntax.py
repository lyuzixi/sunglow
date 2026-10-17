# -*- coding: utf-8 -*-
import io, os, re, subprocess, sys
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = r"C:/Users/郭秀仪/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
tpl = io.open(os.path.join(BASE, "index.html"), encoding="utf-8").read()
pat = re.compile(r'<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)</script>')
blocks = [m.group(1) for m in pat.finditer(tpl)]
print("内联 script 块数：%d" % len(blocks))
ok = True
for i, b in enumerate(blocks):
    p = os.path.join(BASE, "_scratch", "_check", "chk%d.js" % i)
    io.open(p, "w", encoding="utf-8").write(b)
    r = subprocess.run([NODE, "--check", p], capture_output=True, text=True)
    print("  块 %d  %d 字符  -> %s" % (i, len(b), "OK" if r.returncode == 0 else "FAIL"))
    if r.returncode != 0:
        ok = False
        print(r.stderr[:2000])
# ---------- 源文件无 CRLF（行尾机制化 · 工作区层守门员） ----------
# .gitattributes 的 clean filter 只保证 **blob** 干净；编辑工具往工作区写入的 CR
# 会被 diff 掩盖（实测 git diff 对纯 LF blob 容忍工作区 CRLF，numstat 看不出来），
# 但 assemble.py 的 rd(newline='') 会把 CR 忠实带进产物字节 —— docfacts 的
# product.bytes / 行数事实随之失真。这里把污染从「组装后才发现」提前到探针层。
SRC_FOR_EOL = ["_pi18n.js", "_p2.js", "_p3.js", "_p4.js", "_p5.js", "_p5b.js", "_p6.js",
               os.path.join("tpl", "template.html"), os.path.join("tpl", "404.html")]
for f in SRC_FOR_EOL:
    if b"\r" in open(os.path.join(BASE, f), "rb").read():
        print("FAIL 源文件含 CRLF：%s —— 编辑工具写入了 CR，会被 assemble 原样带进产物" % f)
        ok = False
if ok:
    print("源文件无 CRLF：%d 个全 LF" % len(SRC_FOR_EOL))

sys.exit(0 if ok else 1)
