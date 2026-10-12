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
sys.exit(0 if ok else 1)
