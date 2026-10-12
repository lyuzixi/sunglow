# -*- coding: utf-8 -*-
import io, os, re, subprocess
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = r"C:/Users/郭秀仪/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
tpl = io.open(os.path.join(BASE, "index.html"), encoding="utf-8").read()
pat = re.compile(r'<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)</script>')
b0 = pat.findall(tpl)[0]
har = io.open(os.path.join(BASE, "_check", "harness.js"), encoding="utf-8").read()
p = os.path.join(BASE, "_scratch", "_check", "selfrun.js")
io.open(p, "w", encoding="utf-8").write(b0 + "\n" + har)
r = subprocess.run([NODE, p], capture_output=True, text=True, encoding="utf-8", errors="replace")
print(r.stdout)
if r.stderr.strip(): print("STDERR:", r.stderr[:3000])
print("FAIL 计数:", r.stdout.count("FAIL"))
