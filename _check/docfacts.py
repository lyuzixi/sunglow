# -*- coding: utf-8 -*-
"""文档↔代码一致性核对（docfacts）。

为什么要有这个脚本：项目里散落着大量"可机读的事实值" —— 源码行数、产物字节数、
源码常量、探针断言条数 —— 它们被手抄进 README / 阶段性总结，然后随代码改动而漂移，
而**没有任何断言守着它们**。已经实际发生过两次：
  ① `assemble.py` 的输出被重定向到 /dev/null，文档里记下的是**中间态**字节数；
  ② 手机端 4 批 + B14 让 `_p6.js` 长了 83 行，文档里的行数表没人回头改。
这类事故的特点是**静默** —— 不影响运行，只让文档慢慢变成谎话。

三条设计纪律（每条都是踩过的坑的直接对策）：

 1. **只校验可机读的事实**。判"这句注释讲得对不对"是人的事，不进本表。
 2. **失配必须响**：某条声明在文档里**找不到**时，报 `STALE（未找到声明）`，**不能静默通过**。
    判据本身失效时的绿灯是骗人的 —— 与 `mobileprobe` 里那个 `probeInViewport` 守卫同思路。
 3. **只断「等于」**。范围/约数不进这张表，见 §排除清单。

事实来源：
  - 文件系统：源码行数（`_p*.js` / `tpl/template.html`）、产物字节数
  - 源码正则：`const` 常量值（支持 `A = B` 形式的别名，按名字回溯）
  - 探针输出：`_check/.facts.json` —— 由 `all.py` 从各探针打印的 `FACTS {...}` 行汇总。
    **该文件记着产生它的探针源码 sha1**；源码改了而 facts 没重跑 ⇒ 报 STALE，
    不拿上一次的数字冒充真相。

用法：
    python _check/docfacts.py          # 核对（有失败则 exit 1）
    python _check/docfacts.py --list   # 只列事实与声明位置，不判定
"""
import hashlib
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECK = os.path.join(BASE, "_check")
PRODUCT = "index.html"
FACTS_JSON = os.path.join(CHECK, ".facts.json")

# ---------- 排除清单（写在这里，免得下次有人以为忘了） ----------
# 这些量**故意不进本表**，理由都是"不是"等于"关系，断死会逼人去改文档凑数"：
#   额度 ≈ 65 / ≈ 171 / ≈ 129 / ≈ 236 加权调用   —— 估算值，随坐标数与变量数浮动
#   栅格 217×200 = 43,400 格                      —— 随纬度变，广州只是当前默认城市
#   地图缓存 56.8 KB / 单点缓存 754,398 字符       —— 运行时实测值，源码里读不出来
#   可信度纱覆盖 21.6% / 凸包长边 509 km 等        —— 实测统计量
#   各探针"约 40 s / 215 s"这类耗时                —— 机器相关
# 它们**没有**可机读的事实源，写进来只会变成第二份手工维护的数字。

# ---------------------------------------------------------------- 事实提取

SRCFILES = ["_p2.js", "_p3.js", "_p4.js", "_p5.js", "_p5b.js", "_p6.js"]


def read(path):
    with open(os.path.join(BASE, path), encoding="utf-8") as f:
        return f.read()


def wc_l(path):
    """按 `wc -l` 的口径数行（数换行符，与文档里抄的数字同源）。"""
    return read(path).count("\n")


def all_source():
    return "\n".join(read(p) for p in SRCFILES)


_alias_cache = {}


def const(name, src=None):
    """从源码里取 `const name = <literal>;` 的值；值是标识符时按名字回溯一层。

    只认字面量（数字/字符串）与别名，不认表达式 —— 本表只服务"可机读的事实"。
    """
    src = src if src is not None else all_source()
    if name in _alias_cache:
        return _alias_cache[name]
    m = re.search(r"^\s*const\s+" + re.escape(name) + r"\s*=\s*([^;]+);", src, re.M)
    if not m:
        return None
    raw = m.group(1).strip()
    # 去掉行尾注释
    raw = re.sub(r"\s*//.*$", "", raw).strip()
    val = _lit(raw)
    if val is None and re.fullmatch(r"[A-Za-z_$][\w$]*", raw):
        val = const(raw, src)          # 别名：A = B
    _alias_cache[name] = val
    return val


def _lit(raw):
    if re.fullmatch(r"-?\d+(?:\.\d+)?", raw):
        return float(raw) if "." in raw else int(raw)
    m = re.fullmatch(r"['\"]([^'\"]*)['\"]", raw)
    if m:
        return m.group(1)
    return None


def probe_facts():
    """读 all.py 汇总出来的探针事实行。返回 (dict, 备注)；文件缺失/过期时给备注。"""
    if not os.path.exists(FACTS_JSON):
        return {}, "未找到 %s（还没跑过 _check/all.py）" % os.path.relpath(FACTS_JSON, BASE)
    try:
        with open(FACTS_JSON, encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        return {}, "读 %s 失败：%s" % (os.path.relpath(FACTS_JSON, BASE), e)

    out, stale = {}, []
    for name, rec in (data.get("probes") or {}).items():
        src = rec.get("src")
        want = rec.get("sha1")
        if src:
            p = os.path.join(CHECK, src)
            if not os.path.exists(p):
                stale.append("%s（源文件 %s 不存在）" % (name, src))
                continue
            got = hashlib.sha1(open(p, "rb").read()).hexdigest()
            if got != want:
                stale.append(name)
                continue
        out[name] = rec
    note = None
    if stale:
        note = ("以下探针的**源码已变**但事实行没跟着重跑（%s）—— 请重跑 `python _check/all.py`；"
                "本次**不拿旧数字当真相**" % "、".join(stale))
    return out, note


# ---------------------------------------------------------------- 声明表

# (事实 key, 说明, [(文档文件, 正则, [捕获组...])])
# 捕获组里的数字/文本会被去掉千分位后与事实值比较。正则**必须**能命中 —— 命中不了报 STALE。
DECL = [
    # ---- 源码行数（阶段性总结 §3.1） ----
    ("src.total", "源码总行数", [("阶段性总结.md", r"源码 \*\*([\d,]+) 行\*\*", [1])]),
    ("src._p2", "`_p2.js` 行数", [("阶段性总结.md", r"`_p2` (\d+)", [1])]),
    ("src._p3", "`_p3.js` 行数", [("阶段性总结.md", r"`_p3` (\d+)", [1])]),
    ("src._p4", "`_p4.js` 行数", [("阶段性总结.md", r"`_p4` (\d+)", [1])]),
    ("src._p5", "`_p5.js` 行数", [("阶段性总结.md", r"`_p5` (\d+)", [1])]),
    ("src._p5b", "`_p5b.js` 行数", [("阶段性总结.md", r"`_p5b` (\d+)", [1])]),
    ("src._p6", "`_p6.js` 行数", [("阶段性总结.md", r"`_p6` \*\*([\d,]+)\*\*", [1])]),
    ("src.tpl", "`template.html` 行数",
     [("阶段性总结.md", r"`template` \*\*([\d,]+)\*\*", [1])]),

    # ---- 产物 ----
    ("product.bytes", "产物字节数",
     [("阶段性总结.md", r"\*\*([\d,]+) 字节\*\*", [1])]),

    # ---- 常量（阶段性总结 §四/§六 与 README §1/§5） ----
    ("const.FIELD_STEP", "`FIELD_STEP` 栅格分辨率",
     [("阶段性总结.md", r"`FIELD_STEP = ([\d.]+)`", [1])]),
    ("const.N_BANDS", "`N_BANDS` 分档数",
     [("阶段性总结.md", r"`N_BANDS = (\d+)`", [1])]),
    ("const.MAP_RADIUS_KM", "局部网格半径",
     [("阶段性总结.md", r"半径 (\d+) km / 间距", [1])]),
    ("const.MAP_GRID_KM", "局部网格间距",
     [("阶段性总结.md", r"半径 \d+ km / 间距 (\d+) km", [1])]),
    ("const.POINT_CACHE_MAX", "单点缓存上限",
     [("阶段性总结.md", r"`POINT_CACHE_MAX = (\d+)`", [1])]),
    ("const.MAP_DATA_MAX", "地图 LRU 日期数",
     [("阶段性总结.md", r"LRU (\d+) 日期 \+ 跨地点总闸门", [1])]),
    ("const.MAP_CACHE_MAX", "地图跨地点总闸门",
     [("阶段性总结.md", r"LRU \d+ 日期 \+ 跨地点总闸门 (\d+) 条", [1])]),
    ("const.FIELD_OUT_KM", "凸包外羽化长度",
     [("阶段性总结.md", r"凸包\*\* \+ (\d+) km 羽化", [1]),
      ("README.md", r"`FIELD_OUT_KM`（(\d+) km）", [1])]),
    ("const.FIELD_FULL", "悬停卡「距离」阈值",
     [("README.md", r"`FIELD_FULL` = (\d+) km", [1])]),
    ("const.FIELD_REACH_KM", "取值半径",
     [("阶段性总结.md", r"取值半径 (\d+) km", [1]),
      ("README.md", r"取值半径 `FIELD_REACH_KM`（(\d+) km）", [1])]),
    ("const.CONT_PX", "等值线线宽（屏幕像素）",
     [("README.md", r"描一条 (\d+) px 等值线", [1])]),
    ("const.TREND_DAYS", "趋势窗口天数",
     [("阶段性总结.md", r"趋势窗口 \d+ → (\d+) 天", [1])]),
    ("const.W_ENS", "多模型权重 `W_ENS`",
     [("README.md", r"`W_ENS = ([\d.]+) / ([\d.]+) / ([\d.]+)`", [1, 2, 3])]),

    # ---- 探针断言条数（事实源 = _check/.facts.json） ----
    ("probe.zoomprobe", "`zoomprobe` 断言条数",
     [("阶段性总结.md", r"`zoomprobe` \*\*(\d+) 项", [1])]),
    ("probe.timeoutprobe", "`timeoutprobe` 断言条数",
     [("阶段性总结.md", r"`timeoutprobe` \*\*(\d+) 项", [1])]),
    ("probe.mapaudit", "`mapaudit` 断言条数",
     [("阶段性总结.md", r"`mapaudit` \*\*(\d+) 条", [1]),
      ("README.md", r"`mapaudit\.js`[^\n]*?\*\*(\d+) 条", [1])]),
    ("probe.mobileprobe", "`mobileprobe` 断言条数",
     [("阶段性总结.md", r"`mobileprobe` \*\*(\d+) 条", [1]),
      ("README.md", r"`mobileprobe\.js`[^\n]*?\*\*(\d+) 条", [1])]),
    ("probe.persistprobe", "`persistprobe` 断言条数",
     [("README.md", r"`persistprobe\.js`[^\n]*?\*\*(\d+) 条", [1])]),
    ("probe.a11yprobe", "`a11yprobe` 断言条数",
     [("README.md", r"`a11yprobe\.js`[^\n]*?\*\*(\d+) 条", [1])]),

    # ---- 一键序列规模 ----
    ("suite.size", "`all.py` 序列项数",
     [("README.md", r"总表（(\d+) 项）", [1])]),
]


def build_truth(pf):
    """算出全部事实的真值。取不到的置 None（会被报成 FACTS-MISSING）。"""
    t = {}
    t["src.total"] = sum(wc_l(p) for p in SRCFILES) + wc_l("tpl/template.html")
    for p, key in [("_p2.js", "src._p2"), ("_p3.js", "src._p3"), ("_p4.js", "src._p4"),
                   ("_p5.js", "src._p5"), ("_p5b.js", "src._p5b"), ("_p6.js", "src._p6"),
                   ("tpl/template.html", "src.tpl")]:
        t[key] = wc_l(p)
    t["product.bytes"] = os.path.getsize(os.path.join(BASE, PRODUCT))
    for name in ["FIELD_STEP", "N_BANDS", "MAP_RADIUS_KM", "MAP_GRID_KM", "POINT_CACHE_MAX",
                 "MAP_DATA_MAX", "MAP_CACHE_MAX", "FIELD_OUT_KM", "FIELD_FULL",
                 "FIELD_REACH_KM", "CONT_PX", "TREND_DAYS"]:
        t["const." + name] = const(name)
    w = const("W_ENS")
    t["const.W_ENS"] = None
    if isinstance(w, dict):
        pass
    # W_ENS 是对象字面量，_lit 认不出 —— 单独取三个数字
    m = re.search(r"const\s+W_ENS\s*=\s*\{([^}]*)\}", all_source())
    if m:
        nums = re.findall(r"[\d.]+", m.group(1))
        if len(nums) == 3:
            t["const.W_ENS"] = nums

    t["probe.zoomprobe"] = _probe(pf, "zoomprobe")
    t["probe.timeoutprobe"] = _probe(pf, "timeoutprobe")
    t["probe.mapaudit"] = _probe(pf, "mapaudit")
    t["probe.mobileprobe"] = _probe(pf, "mobileprobe")
    t["probe.persistprobe"] = _probe(pf, "persistprobe")
    t["probe.a11yprobe"] = _probe(pf, "a11yprobe")
    t["suite.size"] = suite_size()
    return t


def _probe(pf, name):
    rec = pf.get(name)
    return None if not rec else rec.get("assertions")


def suite_size():
    """数 all.py 的 SUITE 项数（数 `("name", "file", "desc")` 形态的元组）。"""
    src = read("_check/all.py")
    m = re.search(r"SUITE\s*=\s*\[(.*?)\n\]", src, re.S)
    if not m:
        return None
    return len(re.findall(r'^\s*\("', m.group(1), re.M))


def norm(s):
    return str(s).replace(",", "").replace(" ", "").strip()


def main():
    listing = "--list" in sys.argv
    pf, pf_note = probe_facts()
    truth = build_truth(pf)
    cache = {}
    fails, stale = [], []

    for key, desc, sites in DECL:
        got = truth.get(key)
        for fname, rx, groups in sites:
            if fname not in cache:
                cache[fname] = read(fname)
            text = cache[fname]
            m = re.search(rx, text)
            if not m:
                stale.append((key, desc, fname, rx))
                continue
            if got is None:
                continue
            want = [norm(got)] if not isinstance(got, list) else [norm(x) for x in got]
            have = [norm(m.group(g)) for g in groups]
            mark = "ok  " if have == want else "FAIL"
            print("  %s %-22s %-11s 文档 %-14s 实际 %s"
                  % (mark, key, fname, "/".join(have), "/".join(want)))
            if have != want:
                fails.append((key, desc, fname, "/".join(have), "/".join(want)))

    print("-" * 74)
    missing = [k for k, v in truth.items() if v is None]
    for k in missing:
        print("  MISS 事实取不到：%s（源码里没读到，或探针事实行缺失）" % k)
    for key, desc, fname, rx in stale:
        print("  STALE 未找到声明：%s ← %s 里的 %s" % (key, fname, rx))
    if pf_note:
        print("  STALE 探针事实行：%s" % pf_note)
    nfail = len(fails) + len(stale) + len(missing)
    print("  核对 %d 条声明 · 不一致 %d · 未找到声明 %d · 事实缺失 %d"
          % (sum(len(s) for _, _, s in DECL), len(fails), len(stale), len(missing)))
    print("FAIL 计数: %d" % nfail)
    return 1 if nfail else 0


if __name__ == "__main__":
    sys.exit(main())
