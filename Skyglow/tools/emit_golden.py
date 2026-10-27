"""Emit golden vectors from the Python reference implementation.

`data/golden.json` is the frozen target that `tools/check_golden.mjs` checks the
browser bundle against. Regenerate only when the physics/model intentionally
changes:

    python tools/emit_golden.py --regen
"""
import datetime as dt
import json
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

from core import model, nn, solar, spectrum  # noqa: E402

GOLDEN = os.path.join(HERE, "data", "golden.json")

CASES = [
    # label, lat, lon, (y, m, d), tz, mode, weather
    ("上海·秋末晚霞", 31.2304, 121.4737, (2026, 10, 18), 8, "sunset",
     {"cc_low": 20, "cc_mid": 45, "cc_high": 80, "cc_low_up": 30, "cc_mid_up": 40,
      "rh": 76, "blh": 900, "aod": 0.18, "vis": None, "precip": 0.0}),
    ("珠峰·夏至朝霞", 28.14, 86.85, (2026, 6, 21), 8, "sunrise",
     {"cc_low": 5, "cc_mid": 10, "cc_high": 95, "cc_low_up": 8, "cc_mid_up": 12,
      "rh": 40, "blh": 3000, "aod": 0.06, "vis": 30000, "precip": 0.0}),
    ("北京·隆冬阴云", 39.9042, 116.4074, (2026, 1, 15), 8, "sunset",
     {"cc_low": 90, "cc_mid": 70, "cc_high": 30, "cc_low_up": 88, "cc_mid_up": 65,
      "rh": 95, "blh": 400, "aod": 0.6, "vis": None, "precip": 0.8}),
    ("赤道·春分无云", 0.0, 0.0, (2026, 3, 20), 0, "sunset",
     {"cc_low": 0, "cc_mid": 0, "cc_high": 0, "cc_low_up": 0, "cc_mid_up": 0,
      "rh": 60, "blh": 600, "aod": 0.15, "vis": None, "precip": 0.0}),
    ("悉尼·夏至晚霞", -33.87, 151.21, (2026, 12, 21), 11, "sunset",
     {"cc_low": 35, "cc_mid": 60, "cc_high": 70, "cc_low_up": 40, "cc_mid_up": 55,
      "rh": 65, "blh": 1200, "aod": 0.25, "vis": 20000, "precip": 0.0}),
    ("特罗姆瑟·春分", 69.6492, 18.9553, (2026, 3, 20), 1, "sunset",
     {"cc_low": 15, "cc_mid": 35, "cc_high": 55, "cc_low_up": 20, "cc_mid_up": 30,
      "rh": 70, "blh": 700, "aod": 0.10, "vis": None, "precip": 0.0}),
    ("乌斯怀亚·冬至朝霞", -54.8019, -68.3030, (2026, 6, 21), -3, "sunrise",
     {"cc_low": 45, "cc_mid": 55, "cc_high": 60, "cc_low_up": 50, "cc_mid_up": 50,
      "rh": 82, "blh": 500, "aod": 0.12, "vis": 15000, "precip": 0.2}),
    ("拉萨·高原洁净", 29.6520, 91.1721, (2026, 11, 5), 8, "sunset",
     {"cc_low": 8, "cc_mid": 22, "cc_high": 88, "cc_low_up": 10, "cc_mid_up": 20,
      "rh": 25, "blh": 2200, "aod": 0.02, "vis": None, "precip": 0.0}),
    ("新加坡·高气溶胶", 1.3521, 103.8198, (2026, 4, 10), 8, "sunrise",
     {"cc_low": 60, "cc_mid": 75, "cc_high": 40, "cc_low_up": 65, "cc_mid_up": 70,
      "rh": 92, "blh": 650, "aod": 0.9, "vis": 6000, "precip": 0.5}),
    ("漠河·极寒降雪", 52.9705, 122.5388, (2026, 1, 15), 8, "sunrise",
     {"cc_low": 95, "cc_mid": 88, "cc_high": 20, "cc_low_up": 95, "cc_mid_up": 85,
      "rh": 98, "blh": 250, "aod": 1.1, "vis": None, "precip": 2.0}),
]


def build_case(label, lat, lon, ymd, tz, mode, w):
    y, mo, d = ymd
    ev = solar.event_times(lat, lon, dt.date(y, mo, d), tz, which=mode)[mode]
    if ev is None:
        raise SystemExit("no %s event for %s on %s" % (mode, label, ymd))
    elev, az = solar.solar_position(lat, lon, ev)
    r = model.assess(w, elev, mode, model.load_model())
    f = model.features_from_weather(w, elev)
    feats = [w.get("cc_low") or 0, w.get("cc_mid") or 0, w.get("cc_high") or 0,
             w.get("cc_low_up") or 0, w.get("cc_mid_up") or 0,
             w.get("rh") or 0, w.get("blh") or 0, elev,
             f["canvas"], f["canvas_high"], f["light"], f["horizon"],
             f["purity"], f["aod"], f["precip"]]
    p_nn = nn.predict(feats)
    dl = spectrum.deck_light(8.6 + 0.45 * 1.6, elev, w["aod"])
    return {
        "label": label, "lat": lat, "lon": lon, "date": [y, mo, d],
        "tz": tz, "mode": mode, "w": w,
        "event_ms": int(ev.timestamp() * 1000),
        "sun_elev": elev, "sun_az": az,
        "prob": r["probability"], "index": r["index"], "grade": r["grade"],
        "rgb": r["colour"]["rgb"], "lum": r["colour"]["luminance"],
        "features": r["features"],
        "nn": p_nn,
        "deck": {"lum": dl["lum"], "rgb": dl["rgb"], "tangent": dl["tangent_km"],
                 "m_ray": dl["m_ray"], "m_aer": dl["m_aer"]},
    }


def main():
    cases = [build_case(*c) for c in CASES]
    doc = {"version": 1, "source": "python core (ridge-v2.1 / mlp-15-8-4-1)",
           "cases": cases}
    regen = "--regen" in sys.argv
    if regen:
        with open(GOLDEN, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, indent=1)
        print("wrote %s (%d cases)" % (GOLDEN, len(cases)))
    else:
        print("golden has %d cases (use --regen to rewrite)" % len(cases))


if __name__ == "__main__":
    main()
