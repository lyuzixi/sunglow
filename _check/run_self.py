# -*- coding: utf-8 -*-
import io, os, re, subprocess
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = r"C:/Users/郭秀仪/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
tpl = io.open(os.path.join(BASE, "index.html"), encoding="utf-8").read()
pat = re.compile(r'<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)</script>')
# 按内容取块（不按序号）：产物第 0 块是 <head> 的主题引导脚本，它要用 document，
# 在 Node 里求值必抛 ReferenceError；而序号取块在加块时会**静默错位**，
# 更坏的是"拼起来交给 node 跑"这类用法：脚本一抛错 stdout 就空，
# 而判据是"数 FAIL 行"—— 空输出被数成 0 个 FAIL，于是变成**假绿**。
blk = [b for b in pat.findall(tpl) if "function jget" in b]
if not blk:
    print("抽不到含 jget 的脚本块（产物结构变了？）")
    print("FAIL 计数: 1")
    raise SystemExit(1)
b0 = blk[0]
har = io.open(os.path.join(BASE, "_check", "harness.js"), encoding="utf-8").read()
p = os.path.join(BASE, "_scratch", "_check", "selfrun.js")
io.open(p, "w", encoding="utf-8").write(b0 + "\n" + har)
r = subprocess.run([NODE, p], capture_output=True, text=True, encoding="utf-8", errors="replace")
print(r.stdout)
if r.stderr.strip(): print("STDERR:", r.stderr[:3000])
# 崩溃也要算失败：脚本抛错时 stdout 里一行 FAIL 都没有，
# 光数 FAIL 行会把它数成 0 = 假绿（这一次就是这么被发现的）。
_nfail = r.stdout.count("FAIL") + (1 if r.returncode else 0)
if r.returncode:
    print("!! node 退出码 %d（脚本崩了），已计入失败" % r.returncode)
print("FAIL 计数:", _nfail)
raise SystemExit(1 if _nfail else 0)
