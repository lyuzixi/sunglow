# -*- coding: utf-8 -*-
"""一键回归：按序跑全套探针，输出一张总表。

为什么要有这个脚本：改完代码要按序手动跑 21 个探针，漏跑一个，"全绿"就变成一句
没有依据的话（历史上真发生过：改了取数相关代码却忘了重跑），而且每个探针的
"失败信号"写法都不一样 —— 有的看退出码，有的只在 stdout 里打一行 "FAIL 计数: N"
却始终 exit 0。judge() 把这些差异统一收口。

用法：
    python _check/all.py            # 总表（失败时附该探针的尾部输出）
    python _check/all.py -v         # 连每个探针的完整输出一起打印
    python _check/all.py -k cdp     # 只跑名字里含 cdp 的
    python _check/all.py --fast     # cdp 只跑**快段**（跳过最慢的几段，见下）

`--fast` 的语义（C2 改过）：原先它是"把 cdp 整段删掉"，代价是**端到端覆盖一并没了**
（而那正是 cdp 存在的理由）。现在改成给 cdp 传 `CDP_SEG=fast`：它照常起浏览器、
照常跑完前中段的全部断言，只跳过耗时最长的那几段（跳过名单与实测耗时都打在
cdp 自己的"分段耗时"表里）。也就是说：**快，但仍然端到端**。
为什么不做并行：每个探针各起一个 Chrome、各占一个固定调试端口，并行必然 EADDRINUSE
（已踩过）。省时间的唯一正路是"少做真正慢的那几段"。

不进本序列的脚本（会花真实额度，或依赖环境）：
    consistency.js  —— 花真实额度（单点 65 + 地图 171），核对"单点 vs 地图"口径时手动跑
    shotdefault.js  —— 花真实额度，仅用于截图留档
    pointcache.js   —— 单点缓存 18 项，独立跑（不依赖浏览器全流程）
    mapaudit.js     —— 已进序列；它对 8 个沿海/内陆城市做一次扫描，走缓存、零新增额度
    perfprobe.js    —— 绘制性能基线（CDP CPU 节流），只测量、不判成败，独立跑
    tzprobe.js      —— 依赖 Open-Meteo 实时接口；日额度耗尽时会 429 失败（环境问题非代码），
                       所以只作观察项，不计入成败

**事实行汇总（FACTS）**：各探针在末尾打印一行 `FACTS {"assertions":N,"fail":M}`，
本脚本把它们连同**探针源码的 sha1** 一起写进 `_check/.facts.json`（增量合并，`-k` 单跑
只刷新被跑到的那些）。`docfacts` 读它来核对"文档里写的断言条数"，并在**探针源码已变、
事实行没重跑**时报 STALE —— 不拿上一次的数字冒充真相。
"""
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import time

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECK = os.path.join(BASE, "_check")
FACTS_JSON = os.path.join(CHECK, ".facts.json")
NODE = r"C:/Users/郭秀仪/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
if not os.path.exists(NODE):
    NODE = "node"

# (名字, 文件, 说明[, 环境变量])  —— 顺序即依赖顺序：先静态语法，再纯函数，最后才是起浏览器的重活。
# 末尾两项的顺序不能动：
#   mobileprobe 的 FACTS 行是 docfacts 的事实源之一，docfacts 必须排在它后面。
SUITE = [
    ("syntax",       "syntax.py",       "4 个内联 script 块语法"),
    ("globals",      "globals.js",      "跨脚本块命名冲突（静默覆盖 / 词法冲突）"),
    ("run_self",     "run_self.py",     "色阶/等级纯函数自测"),
    ("datacheck",    "datacheck.py",    "内联城市表不变量 + 港澳台合规"),
    ("localgrid",    "localgrid.js",    "局部网格几何 / 缓存闸门"),
    ("timeoutprobe", "timeoutprobe.js", "jget 超时 + 429 双分类"),
    ("zoomprobe",    "zoomprobe.js",    "缩放×颜色 + 值场双重差分"),
    ("raceprobe",    "raceprobe.js",    "快速切换日期的竞态"),
    ("cachesize",    "cachesize.js",    "缓存与请求明细账目"),
    ("cdp",          "cdp.js",          "端到端全流程（合成数据）"),
    ("mapaudit",     "mapaudit.js",     "地图模块审计（掩膜/榜单/提示卡/方位环）"),
    # 窄屏矩阵：同一份探针跑两个视口。360×640 是国内安卓的常见下限，
    # 390×844 是 iPhone 常规机型；两条都跑才能挡住"只在某一个宽度下成立"的断言。
    ("mobileprobe",  "mobileprobe.js",  "手机端适配审计（390×844 · 触摸模拟）"),
    ("mobileprobe360", "mobileprobe.js", "手机端适配审计（360×640 窄屏下限）",
     {"VW": "360", "VH": "640"}),
    ("persistprobe", "persistprobe.js", "状态持久化（B1 偏好 / B2 趋势缓存，跨加载）"),
    ("a11yprobe",    "a11yprobe.js",    "无障碍（焦点可见/对比度/可访问名）"),
    ("xssprobe",     "xssprobe.js",     "XSS 防护（转义/白名单/载荷 URL 端到端）"),
    ("i18nprobe",     "i18nprobe.js",    "多语言（词典键覆盖/切换/往返/优先级）"),
    ("darkprobe",     "darkprobe.js",    "深色模式（令牌/跟随系统/覆盖/持久化/双扫描仪）"),
    ("spotprobe",     "spotprobe.js",    "F3 最佳窗口 / F2 多观测点（额度纪律与失效边界）"),
    ("snapprobe",     "snapprobe.js",    "F5 结果快照（零额度 / 失效 / 恶意载荷 / 坏输入）"),
    # F1 探针要自己跑 assemble.py（构建三套产物），所以把当前解释器传进去。
    ("pwaprobe",      "pwaprobe.js",     "F1 离线 / PWA（单文件约束仍成立 + 离线真能打开 + 不缓存气象）",
     {"PY": sys.executable}),
    ("404probe",     "404probe.js",     "404 页（深路径渲染/桌面+窄屏/两个出口）"),
    ("docfacts",     "docfacts.py",     "文档↔代码一致性（行数/字节/常量/探针条数）"),
]

OBSERVE = [
    ("tzprobe",       "依赖 Open-Meteo 实时接口，日额度耗尽时会 429（环境问题）"),
    ("consistency",   "核对「单点 vs 地图」口径，花真实额度 ~236"),
    ("shotdefault",   "默认城市截图留档，花真实额度"),
]

FAIL_RE = re.compile(r"FAIL\s*(?:计数)?[:：]\s*(\d+)")
NFail_RE = re.compile(r"失败\s*(\d+)\s*项")
NPASS_RE = re.compile(r"(?:PASS|通过)\s*[:：]?\s*(\d+)")
FACTS_RE = re.compile(r"^FACTS\s+(\{.*\})\s*$", re.M)


def remember_facts(name, fn, path, out):
    """把探针打印的 `FACTS {...}` 行连同**探针源码 sha1** 记进 _check/.facts.json。

    增量合并：`-k mobileprobe` 单跑只刷新被跑到的条目，其余保留旧值 —— 但每条都记着
    产生它的源码指纹，所以"源码变了、事实行没重跑"会被 docfacts 判成 STALE 而不是静默沿用。
    """
    m = FACTS_RE.search(out or "")
    if not m:
        return
    try:
        rec = json.loads(m.group(1))
    except Exception:
        return
    rec["src"] = fn
    rec["sha1"] = hashlib.sha1(open(path, "rb").read()).hexdigest()
    rec["ts"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    data = {}
    if os.path.exists(FACTS_JSON):
        try:
            with open(FACTS_JSON, encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = {}
    data.setdefault("probes", {})[name] = rec
    try:
        with open(FACTS_JSON, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=True)
    except Exception as e:
        print("      ! 写 .facts.json 失败：%s" % e)


def judge(code, out):
    """统一判成败。返回 (ok, 备注)。

    三类信号：
      1) 退出码非 0 —— syntax / localgrid / timeoutprobe / zoomprobe / raceprobe /
                        datacheck / mapaudit
      2) "FAIL 计数: N" —— run_self.py（它会一直 exit 0）、localgrid.js、timeoutprobe.js
      3) "失败 N 项"   —— zoomprobe.js / mapaudit.js
    cachesize.js 是纯报表（不判成败）。
    mapaudit.js 三条通路都通：退出码 + 结论行的「失败 N 项」/「PASS N」。

    **cdp.js 曾经是个陷阱**：它无论如何都 exit 0，而它的失败文案是
    "FAIL 下一批存在未通过的项" —— 既不含 "FAIL 计数" 也不含 "失败 N 项"，
    连文本兜底都命中不了。结果一次真实的 FAIL 被报成了 9/9 全绿。
    现已让 cdp.js 自己登记所有以 FAIL 开头的行，末尾打 "FAIL 计数: N"
    并把结果反映到退出码上 —— 两条通路都能抓到。
    """
    notes = []
    ok = True

    m = NFail_RE.search(out)
    if m:
        n = int(m.group(1))
        notes.append("%d 项失败" % n)
        if n:
            ok = False
    else:
        m = FAIL_RE.search(out)
        if m:
            n = int(m.group(1))
            notes.append("FAIL %d" % n)
            if n:
                ok = False

    if code != 0:
        ok = False
        notes.append("exit %d" % code)

    if "FATAL" in out:
        ok = False
        notes.append("FATAL")

    if not notes:
        p = NPASS_RE.search(out)
        notes.append(("PASS %s" % p.group(1)) if p else "无断言计数")

    return ok, " · ".join(notes)


def tail(out, n=26):
    lines = [x for x in out.rstrip().splitlines() if x.strip()]
    return "\n".join(lines[-n:])


def main():
    argv = sys.argv[1:]
    verbose = "-v" in argv or "--verbose" in argv
    fast = "--fast" in argv
    kw = None
    if "-k" in argv:
        i = argv.index("-k")
        if i + 1 < len(argv):
            kw = argv[i + 1]

    suite = SUITE
    if kw:
        suite = [x for x in suite if kw.lower() in x[0].lower()]

    print("=" * 74)
    print("霞光预报 · 一键回归    产物：index.html")
    print("=" * 74)

    rows = []
    bad = 0
    for entry in suite:
        name, fn, desc = entry[0], entry[1], entry[2]
        env = dict(entry[3]) if len(entry) > 3 else {}
        if fast and name == "cdp":
            env["CDP_SEG"] = "fast"
            desc += " · 快段"
        path = os.path.join(CHECK, fn)
        if not os.path.exists(path):
            rows.append((name, None, "缺文件", 0.0, ""))
            bad += 1
            continue
        cmd = [NODE, path] if fn.endswith(".js") else [sys.executable, path]
        run_env = None
        if env:
            run_env = dict(os.environ)
            run_env.update(env)
        t0 = time.time()
        try:
            r = subprocess.run(cmd, cwd=BASE, capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=900, env=run_env)
            out = (r.stdout or "") + (r.stderr or "")
            code = r.returncode
        except subprocess.TimeoutExpired:
            out, code = "FATAL 超时（>900s）", 1
        dt = time.time() - t0

        remember_facts(name, fn, path, out)

        ok, note = judge(code, out)
        if not ok:
            bad += 1
        rows.append((name, ok, note, dt, out))

        mark = "PASS" if ok else "FAIL"
        print("  %-16s %-4s %6.1fs  %s" % (name, mark, dt, desc))
        if not ok:
            print("      └─ %s" % note)
        if verbose and out.strip():
            print("\n".join("      | " + l for l in out.rstrip().splitlines()))
            print()

    print("-" * 74)
    n = len(rows)
    print("  合计 %d 项：%d PASS · %d FAIL" % (n, n - bad, bad))

    for name, ok, note, dt, out in rows:
        if ok is False:
            print("\n" + "=" * 74)
            print("失败详情 · %s（%s）" % (name, note))
            print("=" * 74)
            print(tail(out))

    if bad:
        print("\n观察项（未计入）：")
        for a, b in OBSERVE:
            print("  %-14s %s" % (a, b))
        return 1

    print("\n  全绿。观察项（未计入）：" + " / ".join(a for a, _ in OBSERVE))
    return 0


if __name__ == "__main__":
    sys.exit(main())
