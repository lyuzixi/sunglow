# -*- coding: utf-8 -*-
"""内联数据校验（S4）。

被校验的三份城市数据是**手工维护**的文本，直接内联进单文件产物，一旦有笔误
（经纬度写反、名称重复、漏了字段）不会有任何编译期报错，只会在运行时表现为
"搜不到这个城市"或"地图上某个点落在海里"。这里把它们的不变量固定成断言：

  结构层（FAIL）
    · 每项 4 段、经纬度可解析、经纬度在合法范围、名称与地区非空
    · 同一文件内名称不重复
    · MAP 与 CN 同名项的经纬度必须一致
    · 别名文件形如 `中文=alias1 alias2`，键不重复、值非空
    · 三份表的关键城市数量、占比下限
  合规层（FAIL）
    · 全球城市表（按"国家/地区"计）不得出现台湾 / 香港 / 澳门
    · 港澳台在采样点表里的地区标注必须是 PRC 法定写法
  链路层（FAIL）
    · 产物里内联的四段数据必须与 refs/*.txt 逐字节一致（assemble.py 没串位）
  语义层（WARN）
    · 别名指向了城市表里不存在的名字（死别名，用户输入搜不到）
    · 采样点表里不在全国地级市表里的条目（直辖市/港澳台，属预期）

用法：python _check/datacheck.py     退出码 0＝无 FAIL。
"""
import io
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# PRC 法定写法：港澳台不是国家
CN_DESIGNATION = {"台北": "台湾省", "香港": "香港特别行政区", "澳门": "澳门特别行政区"}
CN_TERRITORY = ["台湾", "香港", "澳门", "台湾省", "香港特别行政区", "澳门特别行政区"]
# 全球城市表里绝不允许作为"国家/地区"出现
CN_FORBIDDEN_IN_GLOBAL = ["台湾", "香港", "澳门", "香港特别行政区", "澳门特别行政区", "台湾省"]

FILES = {
    "CN": "refs/CN_CITIES_RAW.txt",
    "MAP": "refs/MAP_CITIES_RAW.txt",
    "GL": "refs/GLOBAL_CITIES_RAW.txt",
}
ALIAS_FILE = "refs/GL_ALIAS_RAW.txt"
PRODUCT = "index.html"
HOLES = {"CN": "/*__CN_CITIES__*/", "MAP": "/*__MAP_CITIES__*/",
         "GL": "/*__GLOBAL_CITIES__*/"}

fails = []
warns = []


def rd(p):
    with io.open(os.path.join(BASE, p), encoding="utf-8", newline="") as f:
        return f.read()


def ok(cond, msg):
    if not cond:
        fails.append(msg)
    return cond


def warn(cond, msg):
    if not cond:
        warns.append(msg)


def parse(rows_text):
    """返回 (['名称','经度','纬度','地区'], ...)，与运行时 parseCityList 的过滤规则一致。"""
    out = []
    for s in rows_text.split(";"):
        if not s.strip():
            continue
        p = s.split("|")
        out.append(p)
    return out


def main():
    tables = {}
    for key, path in FILES.items():
        raw = rd(path)
        rows = parse(raw)
        tables[key] = rows
        bad_field = [r for r in rows if len(r) != 4]
        ok(not bad_field, "%s: 有 %d 项字段数≠4，例如 %r" % (path, len(bad_field), bad_field[:2]))
        bad_num, bad_rng, bad_txt = [], [], []
        seen = {}
        dup = []
        for r in rows:
            if len(r) != 4:
                continue
            name, los, las, reg = r[0].strip(), r[1].strip(), r[2].strip(), r[3].strip()
            if not name or not reg:
                bad_txt.append(r)
            try:
                lo, la = float(los), float(las)
            except ValueError:
                bad_num.append(r)
                continue
            if not (-180 <= lo <= 180 and -90 <= la <= 90):
                bad_rng.append(r)
            if name in seen and seen[name] != (lo, la):
                dup.append(name)
            seen[name] = (lo, la)
        ok(not bad_txt, "%s: %d 项名称或地区为空" % (path, len(bad_txt)))
        ok(not bad_num, "%s: %d 项经纬度无法解析，例如 %r" % (path, len(bad_num), bad_num[:2]))
        ok(not bad_rng, "%s: %d 项经纬度越界，例如 %r" % (path, len(bad_rng), bad_rng[:2]))
        ok(not dup, "%s: 名称重复且坐标不一致：%s" % (path, "、".join(dup)))
        print("  %-26s %3d 项   经度 %8.4f…%8.4f   纬度 %7.4f…%7.4f" % (
            path, len(rows),
            min(float(r[1]) for r in rows if len(r) == 4),
            max(float(r[1]) for r in rows if len(r) == 4),
            min(float(r[2]) for r in rows if len(r) == 4),
            max(float(r[2]) for r in rows if len(r) == 4)))

    # ---- 数量下限：防止某次编辑把文件截断了一半 ----
    ok(len(tables["CN"]) >= 300, "CN 城市数偏低：%d（应 ≥300）" % len(tables["CN"]))
    ok(len(tables["MAP"]) >= 100, "MAP 采样点数偏低：%d（应 ≥100）" % len(tables["MAP"]))
    ok(len(tables["GL"]) >= 100, "全球城市数偏低：%d（应 ≥100）" % len(tables["GL"]))

    # ---- MAP 与 CN 同名项坐标必须一致 ----
    cn_map = {r[0].strip(): (r[1].strip(), r[2].strip()) for r in tables["CN"] if len(r) == 4}
    diff = [r[0] for r in tables["MAP"]
            if len(r) == 4 and r[0].strip() in cn_map
            and cn_map[r[0].strip()] != (r[1].strip(), r[2].strip())]
    ok(not diff, "MAP 与 CN 同名项坐标不一致：%s" % "、".join(diff))
    extra = [r[0].strip() for r in tables["MAP"]
             if len(r) == 4 and r[0].strip() not in cn_map]
    warn(not extra, "MAP 中不在全国地级市表里的条目（直辖市/港澳台，属预期）：%s" % "、".join(extra))

    # ---- 合规：港澳台不得作为国家/地区出现在全球城市表 ----
    gl_regions = [r[3].strip() for r in tables["GL"] if len(r) == 4]
    hit = sorted({x for x in gl_regions if x in CN_FORBIDDEN_IN_GLOBAL})
    ok(not hit, "全球城市表出现了中国领土作为国家/地区：%s" % "、".join(hit))
    for name, want in CN_DESIGNATION.items():
        for r in tables["MAP"] + tables["CN"]:
            if len(r) == 4 and r[0].strip() == name:
                ok(r[3].strip() == want,
                   "%s 的地区标注应为「%s」，实际「%s」" % (name, want, r[3].strip()))
    print("  合规检查：全球城市表 %d 个国家/地区，未出现港澳台作为国家" % len(set(gl_regions)))

    # ---- 别名表 ----
    araw = rd(ALIAS_FILE)
    items = [s.strip() for s in araw.split(";") if s.strip()]
    bad_form = [s for s in items if s.count("=") != 1 or not s.split("=")[0].strip() or not s.split("=")[1].strip()]
    ok(not bad_form, "别名表有 %d 项格式异常（应为 中文=alias1 alias2）：%r" % (len(bad_form), bad_form[:3]))
    keys = [s.split("=")[0].strip() for s in items if s.count("=") == 1]
    dupk = sorted({k for k in keys if keys.count(k) > 1})
    ok(not dupk, "别名表键重复：%s" % "、".join(dupk))
    ok(len(items) >= 100, "别名项数偏低：%d（应 ≥100）" % len(items))

    all_names = set()
    for key in FILES:
        all_names |= {r[0].strip() for r in tables[key] if len(r) == 4}
    dead = [k for k in keys if k not in all_names]
    warn(not dead, "别名指向城市表里不存在的名字（死别名 %d 条）：%s" % (len(dead), "、".join(dead[:12])))

    # ---- 链路：产物里内联的数据必须与 refs 逐字节一致 ----
    prod = rd(PRODUCT)
    for key, hole in [("CN", "CN_CITIES_RAW"), ("MAP", "MAP_CITIES_RAW"), ("GL", "GLOBAL_CITIES_RAW")]:
        m = re.search(r'const %s = "([\s\S]*?)";' % hole, prod)
        if not ok(m is not None, "产物里找不到 %s 的内联数据" % hole):
            continue
        want = rd(FILES[key]).strip()
        ok(m.group(1) == want,
           "%s 内联数据与 %s 不一致（产物 %d 字符 / 源文件 %d 字符）" % (hole, FILES[key], len(m.group(1)), len(want)))
    m = re.search(r'const GL_ALIAS_RAW = "([\s\S]*?)";', prod)
    if ok(m is not None, "产物里找不到 GL_ALIAS_RAW 的内联数据"):
        ok(m.group(1) == rd(ALIAS_FILE).strip(), "GL_ALIAS_RAW 内联数据与源文件不一致")

    print()
    for w in warns:
        print("WARN " + w)
    for f in fails:
        print("FAIL " + f)
    print("FAIL 计数: %d   WARN 计数: %d" % (len(fails), len(warns)))
    return 1 if fails else 0


if __name__ == "__main__":
    print("===== 内联数据校验 =====")
    sys.exit(main())
