"""
DA LIU REN (大六壬) — the second of the Three Styles.

Where Qi Men maps a moment onto space, Da Liu Ren maps it onto RELATION. A chart is built
by turning a heaven plate of twelve branches over a fixed earth plate until the month
general sits on the hour, then reading four pairs (四課 the Four Lessons) off the day's
stem and branch, and extracting from them three stages (三傳 the Three Transmissions) that
describe how the matter begins, develops and ends.

It is the most argued-over of the three, and the argument is productive: the nine methods
(九宗門) for extracting the transmissions are a decision procedure for what to do when the
simple rule is ambiguous, and they are why the system is considered the scholar's method.

WHAT THIS MODULE IMPLEMENTS
───────────────────────────
  賊剋法 (zei ke)   the primary rule — a single controlling relation decides
  比用法 (bi yong)  the tie-break by stem polarity when several qualify
  伏吟 / 返吟       the two degenerate plates, detected and named

The remaining methods — 涉害, 遙剋, 昴星, 別責, 八專 — are DETECTED and named but not
resolved, and the chart says so explicitly rather than silently guessing. A wrong
transmission is worse than an acknowledged gap, because the whole reading hangs off it.
"""
from typing import Dict, List, Optional

STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"]
BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"]

ELEM = {"子": "water", "丑": "earth", "寅": "wood", "卯": "wood", "辰": "earth",
        "巳": "fire", "午": "fire", "未": "earth", "申": "metal", "酉": "metal",
        "戌": "earth", "亥": "water"}
STEM_ELEM = {"甲": "wood", "乙": "wood", "丙": "fire", "丁": "fire", "戊": "earth",
             "己": "earth", "庚": "metal", "辛": "metal", "壬": "water", "癸": "water"}
STEM_YANG = {s: (i % 2 == 0) for i, s in enumerate(STEMS)}
CONTROLS = {"wood": "earth", "earth": "water", "water": "fire",
            "fire": "metal", "metal": "wood"}

# 寄宮 — each day stem lodges in a branch, since the plate carries branches only.
LODGING = {"甲": "寅", "乙": "辰", "丙": "巳", "丁": "未", "戊": "巳",
           "己": "未", "庚": "申", "辛": "戌", "壬": "亥", "癸": "丑"}

# 月將 — the month general, by the 中氣 the sun has passed. Runs BACKWARD through the
# branches, because it tracks the sun against the zodiac rather than the civil month.
MONTH_GENERAL = {
    "雨水": ("亥", "登明"), "春分": ("戌", "河魁"), "穀雨": ("酉", "從魁"),
    "小滿": ("申", "傳送"), "夏至": ("未", "小吉"), "大暑": ("午", "勝光"),
    "處暑": ("巳", "太乙"), "秋分": ("辰", "天罡"), "霜降": ("卯", "太沖"),
    "小雪": ("寅", "功曹"), "冬至": ("丑", "大吉"), "大寒": ("子", "神后"),
}

# 十二天將 — the twelve generals, in their fixed order from 貴人.
GENERALS = ["貴人", "螣蛇", "朱雀", "六合", "勾陳", "青龍",
            "天空", "白虎", "太常", "玄武", "太陰", "天后"]
GENERAL_GLOSS = {
    "貴人": "Noble — patronage, authority, the person who can decide",
    "螣蛇": "Snake — anxiety, the uncanny, entanglement, fire",
    "朱雀": "Vermilion Bird — speech, documents, litigation, news",
    "六合": "Harmony — union, negotiation, marriage, agreement",
    "勾陳": "Hook — land, delay, obstruction, disputes over property",
    "青龍": "Azure Dragon — wealth, growth, celebration",
    "天空": "Void — emptiness, deceit, promises unkept",
    "白虎": "White Tiger — injury, illness, roads, sudden force",
    "太常": "Constant — food, clothing, custom, steady matters",
    "玄武": "Dark Warrior — theft, concealment, what goes missing",
    "太陰": "Moon — the private, hidden help, women's matters",
    "天后": "Queen — intimacy, the domestic, hidden affection",
}
# 貴人 placement — 甲戊庚牛羊, 乙己鼠猴鄉, 丙丁豬雞位, 壬癸兔蛇藏, 六辛逢馬虎.
# (day noble used between sunrise and sunset, night noble otherwise)
NOBLE = {"甲": ("丑", "未"), "戊": ("丑", "未"), "庚": ("丑", "未"),
         "乙": ("子", "申"), "己": ("子", "申"),
         "丙": ("亥", "酉"), "丁": ("亥", "酉"),
         "壬": ("卯", "巳"), "癸": ("卯", "巳"),
         "辛": ("午", "寅")}


def heaven_plate(month_general: str, hour_branch: str) -> Dict[str, str]:
    """Turn the heaven plate so the month general sits on the hour branch.

    Returns earth branch → the heaven branch resting above it."""
    off = (BRANCHES.index(month_general) - BRANCHES.index(hour_branch)) % 12
    return {b: BRANCHES[(BRANCHES.index(b) + off) % 12] for b in BRANCHES}


def _generals(day_stem: str, daytime: bool, plate: Dict[str, str]) -> Dict[str, str]:
    """Seat the twelve generals, starting from 貴人 on its branch.

    They run clockwise when the noble sits in the yang half of the plate (亥→辰) and
    counter-clockwise in the yin half — the standard rule."""
    day_n, night_n = NOBLE[day_stem]
    noble_earth = day_n if daytime else night_n
    # the general sits on the EARTH position whose heaven branch is the noble branch
    seat = next((e for e, h in plate.items() if h == noble_earth), noble_earth)
    forward = BRANCHES.index(seat) >= BRANCHES.index("亥") or BRANCHES.index(seat) <= BRANCHES.index("辰")
    step = 1 if forward else -1
    out = {}
    si = BRANCHES.index(seat)
    for i, g in enumerate(GENERALS):
        out[BRANCHES[(si + step * i) % 12]] = g
    return out


def four_lessons(day_stem: str, day_branch: str, plate: Dict[str, str]) -> List[Dict]:
    """The Four Lessons — two from the stem's lodging, two from the day branch."""
    lodge = LODGING[day_stem]
    l1_up = plate[lodge]
    l2_up = plate[l1_up]
    l3_up = plate[day_branch]
    l4_up = plate[l3_up]
    return [
        {"n": 1, "lower": lodge, "upper": l1_up, "from": f"stem {day_stem} lodged in {lodge}"},
        {"n": 2, "lower": l1_up, "upper": l2_up, "from": "the first lesson's upper"},
        {"n": 3, "lower": day_branch, "upper": l3_up, "from": f"day branch {day_branch}"},
        {"n": 4, "lower": l3_up, "upper": l4_up, "from": "the third lesson's upper"},
    ]


def _relation(upper: str, lower: str) -> Optional[str]:
    """Which way control runs between a lesson's two branches."""
    eu, el = ELEM[upper], ELEM[lower]
    if CONTROLS.get(el) == eu:
        return "zei"      # 下賊上 — the lower steals the upper; the stronger signal
    if CONTROLS.get(eu) == el:
        return "ke"       # 上剋下 — the upper controls the lower
    return None


def three_transmissions(lessons: List[Dict], day_stem: str,
                        plate: Dict[str, str]) -> Dict:
    """Extract the Three Transmissions.

    賊剋 first: a single 下賊上 decides; failing that a single 上剋下. When several
    qualify, 比用 picks the one whose polarity matches the day stem. Anything the two
    rules cannot settle is NAMED, not guessed."""
    zei = [l for l in lessons if _relation(l["upper"], l["lower"]) == "zei"]
    ke = [l for l in lessons if _relation(l["upper"], l["lower"]) == "ke"]

    method = None
    initial = None
    note = ""

    if len(zei) == 1:
        initial, method = zei[0]["upper"], "賊剋法 (single 下賊上)"
    elif not zei and len(ke) == 1:
        initial, method = ke[0]["upper"], "賊剋法 (single 上剋下)"
    elif zei or ke:
        pool = zei or ke
        yang = STEM_YANG[day_stem]
        matched = [l for l in pool
                   if (BRANCHES.index(l["upper"]) % 2 == 0) == yang]
        if len(matched) == 1:
            initial, method = matched[0]["upper"], "比用法 (polarity match)"
        else:
            method = "涉害法 or later — not resolved"
            note = ("Several lessons qualify and polarity does not separate them. The "
                    "classical procedure continues through 涉害, 遙剋, 昴星, 別責 and 八專; "
                    "this module does not implement those and will not guess an initial "
                    "transmission it cannot justify.")
    else:
        method = "遙剋法 or 昴星法 — not resolved"
        note = ("No lesson shows a controlling relation, so the transmissions come from "
                "the distant-control or 昴星 procedures, which this module does not "
                "implement.")

    out = {"method": method, "note": note,
           "zei_count": len(zei), "ke_count": len(ke)}
    if initial:
        mid = plate[initial]
        last = plate[mid]
        out.update({
            "resolved": True,
            "initial": {"branch": initial, "stage": "初傳 — how the matter begins"},
            "middle": {"branch": mid, "stage": "中傳 — how it develops"},
            "final": {"branch": last, "stage": "末傳 — how it ends"},
        })
    else:
        out["resolved"] = False
    return out


def _degenerate(plate: Dict[str, str], lessons: List[Dict]) -> Optional[str]:
    """伏吟 (the plate unturned) and 返吟 (turned a full half) are read differently."""
    if all(h == e for e, h in plate.items()):
        return "伏吟 — the heaven plate rests on its own positions; matters are stuck, " \
               "nothing moves, and the transmissions are taken by the special rule."
    if all(BRANCHES.index(h) == (BRANCHES.index(e) + 6) % 12 for e, h in plate.items()):
        return "返吟 — the plate is exactly opposed; everything reverses, and what is " \
               "sought turns into its contrary."
    return None


def chart(month_general_term: str, day_stem: str, day_branch: str,
          hour_branch: str, daytime: bool = True) -> Dict:
    """Build a full Da Liu Ren chart.

    `month_general_term` is the 中氣 the sun has most recently passed (e.g. 冬至)."""
    if month_general_term not in MONTH_GENERAL:
        return {}
    mg, mg_name = MONTH_GENERAL[month_general_term]
    plate = heaven_plate(mg, hour_branch)
    lessons = four_lessons(day_stem, day_branch, plate)
    gens = _generals(day_stem, daytime, plate)
    tri = three_transmissions(lessons, day_stem, plate)
    deg = _degenerate(plate, lessons)

    for l in lessons:
        l["general"] = gens.get(l["upper"], "")
    if tri.get("resolved"):
        for k in ("initial", "middle", "final"):
            tri[k]["general"] = gens.get(tri[k]["branch"], "")
            tri[k]["element"] = ELEM[tri[k]["branch"]]

    return {
        "month_general": {"term": month_general_term, "branch": mg, "name": mg_name},
        "day": {"stem": day_stem, "branch": day_branch, "lodging": LODGING[day_stem]},
        "hour_branch": hour_branch,
        "daytime": daytime,
        "noble": NOBLE[day_stem][0 if daytime else 1],
        "heaven_plate": plate,
        "generals": gens,
        "four_lessons": lessons,
        "three_transmissions": tri,
        "degenerate": deg,
    }


def summary(c: Dict) -> str:
    if not c:
        return ""
    mg = c["month_general"]
    out = [f"DA LIU REN — month general {mg['branch']} ({mg['name']}) on hour "
           f"{c['hour_branch']}, day {c['day']['stem']}{c['day']['branch']}"]
    if c.get("degenerate"):
        out.append(f"  {c['degenerate']}")
    out.append("  四課:")
    for l in c["four_lessons"]:
        out.append(f"    {l['n']}. {l['upper']} over {l['lower']}  {l['general']:4} "
                   f"({l['from']})")
    t = c["three_transmissions"]
    out.append(f"  三傳 — {t['method']}")
    if t.get("resolved"):
        for k in ("initial", "middle", "final"):
            s = t[k]
            out.append(f"    {s['branch']} {s['general']:4} {s['element']:6} {s['stage']}")
    else:
        out.append(f"    unresolved. {t['note']}")
    return "\n".join(out)
