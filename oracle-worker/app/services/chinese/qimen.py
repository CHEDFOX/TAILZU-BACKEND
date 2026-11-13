"""
QI MEN DUN JIA (奇門遁甲) — "the Mysterious Gates, Hiding the Jia".

The most elaborate of the Three Styles (三式), and historically the most restricted: a
court method for choosing the moment and direction of an action. Where BaZi reads a life
and Liu Yao answers a question, Qi Men reads a MOMENT as a nine-palace map of space, and
is consulted to decide where to stand, which way to face, and when to move.

A chart is four superimposed plates over the nine Luo Shu palaces:

  地盤 EARTH   the Three Wonders (三奇 乙丙丁) and Six Instruments (六儀 戊己庚辛壬癸),
               distributed from the ju palace — fixed for the whole two-hour period
  天盤 HEAVEN  the same stems carried by the Nine Stars, rotated so the duty chief lands
               on the palace holding the hour's stem
  八門 DOORS   the Eight Doors, rotated by the duty envoy's movement
  八神 SPIRITS the Eight Spirits, counted from the duty chief

CONVENTIONS CHOSEN, AND WHY IT MATTERS
──────────────────────────────────────
Qi Men has more forks than any other system here, and implementations that disagree are
not thereby wrong. This module uses:

  • 拆補法 (chai bu) for yuan selection — the majority method. 置閏法 (zhi run) inserts an
    intercalary period and yields different ju on some days.
  • 轉盤 (rotating plate) for the heaven plate — the common method. 飛盤 (flying plate)
    moves stems by palace number instead and produces a different chart.
  • Center palace (5) has no door; its duty falls to palace 2, the standard 寄宮 substitution.

Each is recorded in the provenance entry's `assumptions`, because a user comparing this
chart to one from another app deserves to know the difference is a school, not a bug.
"""
from typing import Dict, List, Tuple

STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"]
BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"]

# ─── The nine palaces, Luo Shu ────────────────────────────────────────────
#   4 9 2
#   3 5 7
#   8 1 6
PALACES = {
    1: {"trigram": "坎", "direction": "N",  "element": "water"},
    2: {"trigram": "坤", "direction": "SW", "element": "earth"},
    3: {"trigram": "震", "direction": "E",  "element": "wood"},
    4: {"trigram": "巽", "direction": "SE", "element": "wood"},
    5: {"trigram": "中", "direction": "C",  "element": "earth"},
    6: {"trigram": "乾", "direction": "NW", "element": "metal"},
    7: {"trigram": "兌", "direction": "W",  "element": "metal"},
    8: {"trigram": "艮", "direction": "NE", "element": "earth"},
    9: {"trigram": "離", "direction": "S",  "element": "fire"},
}

# Nine Stars in their home palaces.
STARS = {1: "天蓬", 2: "天芮", 3: "天沖", 4: "天輔", 5: "天禽",
         6: "天心", 7: "天柱", 8: "天任", 9: "天英"}
STAR_GLOSS = {
    "天蓬": "Tian Peng — water, theft and risk; bold ventures, gambling, danger",
    "天芮": "Tian Rui — earth, illness and study; the teacher and the disease",
    "天沖": "Tian Chong — wood, movement and force; travel, dispute, speed",
    "天輔": "Tian Fu — wood, culture and support; study, counsel, refinement",
    "天禽": "Tian Qin — earth, the centre; stability, the pivot",
    "天心": "Tian Xin — metal, medicine and leadership; healing, decision",
    "天柱": "Tian Zhu — metal, obstruction and speech; destruction, argument",
    "天任": "Tian Ren — earth, endurance and property; patience, land",
    "天英": "Tian Ying — fire, brilliance and display; fame, blood, impatience",
}

# Eight Doors in their home palaces. Palace 5 has none.
DOORS = {1: "休門", 2: "死門", 3: "傷門", 4: "杜門",
         6: "開門", 7: "驚門", 8: "生門", 9: "景門"}
DOOR_GLOSS = {
    "休門": "Rest — recuperation, seeking help, quiet approaches",
    "生門": "Life — growth, wealth, anything that should increase",
    "傷門": "Injury — harm, debt collection, hunting, competition",
    "杜門": "Block — concealment, hiding, escape, avoiding notice",
    "景門": "View — display, documents, examinations, being seen",
    "死門": "Death — endings, burial, stagnation; avoid for new starts",
    "驚門": "Fright — alarm, litigation, disturbance, sudden news",
    "開門": "Open — beginnings, officials, travel, opening a business",
}
# Door movement walks the eight non-centre palaces in Luo Shu order.
_DOOR_RING = [1, 2, 3, 4, 6, 7, 8, 9]
_CENTER_SUBSTITUTE = 2          # 寄宮 — the centre's duty falls to palace 2

# Eight Spirits, counted from the duty chief.
SPIRITS = ["值符", "螣蛇", "太陰", "六合", "白虎", "玄武", "九地", "九天"]
SPIRIT_GLOSS = {
    "值符": "Chief — the highest authority present; noble help",
    "螣蛇": "Snake — the strange, anxiety, entanglement, dreams",
    "太陰": "Moon — concealment, the private, a hidden helper",
    "六合": "Harmony — union, negotiation, matchmaking, agreement",
    "白虎": "White Tiger — force, injury, the military, decisive violence",
    "玄武": "Dark Warrior — theft, deception, what is stolen or hidden",
    "九地": "Nine Earth — stillness, defence, holding position",
    "九天": "Nine Heaven — expansion, advance, high ambition",
}

# ─── Ju (局) selection ─────────────────────────────────────────────────────
# Solar terms in calendar order. Yang dun runs 冬至→芒種, yin dun 夏至→大雪.
SOLAR_TERMS = ["立春", "雨水", "驚蟄", "春分", "清明", "穀雨",
               "立夏", "小滿", "芒種", "夏至", "小暑", "大暑",
               "立秋", "處暑", "白露", "秋分", "寒露", "霜降",
               "立冬", "小雪", "大雪", "冬至", "小寒", "大寒"]

# (yang?, (upper, middle, lower)) — the classical mnemonics, e.g. 冬至驚蟄一七四.
JU_TABLE = {
    "冬至": (True,  (1, 7, 4)), "小寒": (True,  (2, 8, 5)), "大寒": (True,  (3, 9, 6)),
    "立春": (True,  (8, 5, 2)), "雨水": (True,  (9, 6, 3)), "驚蟄": (True,  (1, 7, 4)),
    "春分": (True,  (3, 9, 6)), "清明": (True,  (4, 1, 7)), "穀雨": (True,  (5, 2, 8)),
    "立夏": (True,  (4, 1, 7)), "小滿": (True,  (5, 2, 8)), "芒種": (True,  (6, 3, 9)),
    "夏至": (False, (9, 3, 6)), "小暑": (False, (8, 2, 5)), "大暑": (False, (7, 1, 4)),
    "立秋": (False, (2, 5, 8)), "處暑": (False, (1, 4, 7)), "白露": (False, (9, 3, 6)),
    "秋分": (False, (7, 1, 4)), "寒露": (False, (6, 9, 3)), "霜降": (False, (5, 8, 2)),
    "立冬": (False, (6, 9, 3)), "小雪": (False, (5, 8, 2)), "大雪": (False, (4, 7, 1)),
}
assert set(JU_TABLE) == set(SOLAR_TERMS), "ju table and solar term list disagree"

# 符頭 — the yuan is read from the branch of the governing 甲 or 己 day.
_YUAN_BY_BRANCH = {
    "子": 0, "午": 0, "卯": 0, "酉": 0,      # 上元 upper
    "寅": 1, "申": 1, "巳": 1, "亥": 1,      # 中元 middle
    "辰": 2, "戌": 2, "丑": 2, "未": 2,      # 下元 lower
}
_YUAN_NAMES = ["上元", "中元", "下元"]

# The six 旬 (ten-day periods), each headed by a 甲 day hidden under an instrument.
XUN_SHOU = [("甲子", "戊"), ("甲戌", "己"), ("甲申", "庚"),
            ("甲午", "辛"), ("甲辰", "壬"), ("甲寅", "癸")]

# Earth-plate stem order, laid from the ju palace.
_PLATE_ORDER = ["戊", "己", "庚", "辛", "壬", "癸", "丁", "丙", "乙"]
WONDERS = {"乙": "日奇 sun wonder", "丙": "月奇 moon wonder", "丁": "星奇 star wonder"}


def _sexagenary_index(stem: str, branch: str) -> int:
    """Position 0-59 in the jiazi cycle for a stem-branch pair."""
    si, bi = STEMS.index(stem), BRANCHES.index(branch)
    for n in range(60):
        if n % 10 == si and n % 12 == bi:
            return n
    raise ValueError(f"{stem}{branch} is not a valid sexagenary pair")


def _xun_of(stem: str, branch: str) -> Tuple[str, str, int]:
    """Which 旬 a pillar belongs to: (head, hidden instrument, position 0-9 within it)."""
    n = _sexagenary_index(stem, branch)
    idx = n // 10
    head, instrument = XUN_SHOU[idx]
    return head, instrument, n % 10


def fu_tou_branch(day_stem: str, day_branch: str) -> str:
    """The branch of the 符頭 governing this day — the most recent 甲 or 己 day.

    Stems 甲(0) and 己(5) head the five-day periods, so stepping back to the nearest of
    them gives the period this day sits in."""
    si = STEMS.index(day_stem)
    back = si % 5                      # distance to the previous 甲 or 己
    bi = (BRANCHES.index(day_branch) - back) % 12
    return BRANCHES[bi]


def select_ju(solar_term: str, day_stem: str, day_branch: str) -> Dict:
    """Yin/yang dun, yuan and ju number for a day."""
    if solar_term not in JU_TABLE:
        return {}
    yang, trio = JU_TABLE[solar_term]
    ft = fu_tou_branch(day_stem, day_branch)
    yuan = _YUAN_BY_BRANCH[ft]
    return {
        "solar_term": solar_term,
        "yang_dun": yang,
        "dun": "陽遁" if yang else "陰遁",
        "yuan": _YUAN_NAMES[yuan],
        "yuan_index": yuan,
        "fu_tou_branch": ft,
        "ju": trio[yuan],
        "label": f"{'陽' if yang else '陰'}遁{trio[yuan]}局 · {solar_term} {_YUAN_NAMES[yuan]}",
    }


def earth_plate(ju: int, yang: bool) -> Dict[int, str]:
    """The Six Instruments and Three Wonders across the nine palaces.

    戊 opens at the ju palace; the rest follow in Luo Shu order, forward for yang dun and
    backward for yin."""
    step = 1 if yang else -1
    out = {}
    for i, stem in enumerate(_PLATE_ORDER):
        palace = ((ju - 1 + step * i) % 9) + 1
        out[palace] = stem
    return out


def _rotate_ring(ring: List[int], start_palace: int, target_palace: int,
                 mapping: Dict[int, str]) -> Dict[int, str]:
    """Move a ring-borne set so the item at `start_palace` lands on `target_palace`."""
    if start_palace not in ring or target_palace not in ring:
        return dict(mapping)
    shift = ring.index(target_palace) - ring.index(start_palace)
    out = {}
    for i, p in enumerate(ring):
        src = ring[(i - shift) % len(ring)]
        if src in mapping:
            out[p] = mapping[src]
    return out


def chart(solar_term: str, day_stem: str, day_branch: str,
          hour_stem: str, hour_branch: str) -> Dict:
    """Build the full Qi Men chart for a two-hour period."""
    sel = select_ju(solar_term, day_stem, day_branch)
    if not sel:
        return {}
    ju, yang = sel["ju"], sel["yang_dun"]
    earth = earth_plate(ju, yang)

    # The hour's 旬 gives the duty chief's home: the palace holding that instrument.
    _, instrument, pos_in_xun = _xun_of(hour_stem, hour_branch)
    chief_home = next((p for p, s in earth.items() if s == instrument), 5)

    # The duty chief flies to the palace holding the hour's own stem. 甲 never appears on
    # the plate — it hides under its instrument, which is the whole point of 遁甲 — so a
    # 甲 hour uses the instrument's palace.
    seek = instrument if hour_stem == "甲" else hour_stem
    target = next((p for p, s in earth.items() if s == seek), chief_home)

    # ─── Heaven plate: the stars carry the stems, rotating chief_home → target ───
    ring = _DOOR_RING
    ch = _CENTER_SUBSTITUTE if chief_home == 5 else chief_home
    tg = _CENTER_SUBSTITUTE if target == 5 else target
    heaven_stars = _rotate_ring(ring, ch, tg, {p: STARS[p] for p in ring})
    heaven_stems = _rotate_ring(ring, ch, tg, {p: earth[p] for p in ring})
    # 天禽 rides with 天芮 in the standard pairing.
    heaven_stars[_CENTER_SUBSTITUTE] = heaven_stars.get(_CENTER_SUBSTITUTE, "天芮") + "/天禽"

    # ─── Doors: the duty envoy moves from its home by the hour's place in the 旬 ───
    envoy_home = ch
    envoy_target = ring[(ring.index(envoy_home) + (pos_in_xun if yang else -pos_in_xun))
                        % len(ring)]
    doors = _rotate_ring(ring, envoy_home, envoy_target, {p: DOORS[p] for p in ring})

    # ─── Spirits: counted from the duty chief's landing palace ───
    spirits = {}
    step = 1 if yang else -1
    ti = ring.index(tg)
    for i, sp in enumerate(SPIRITS):
        spirits[ring[(ti + step * i) % len(ring)]] = sp

    palaces = {}
    for p in range(1, 10):
        info = dict(PALACES[p])
        info.update({
            "palace": p,
            "earth_stem": earth.get(p, ""),
            "heaven_stem": heaven_stems.get(p, ""),
            "star": heaven_stars.get(p, STARS[p] if p == 5 else ""),
            "door": doors.get(p, ""),
            "spirit": spirits.get(p, ""),
            "wonder": WONDERS.get(earth.get(p, ""), ""),
        })
        palaces[p] = info

    return {
        "selection": sel,
        "hour": {"stem": hour_stem, "branch": hour_branch,
                 "xun_instrument": instrument, "position_in_xun": pos_in_xun},
        "duty_chief": {"star": STARS.get(chief_home, ""), "home_palace": chief_home,
                       "landed_palace": target},
        "duty_envoy": {"door": DOORS.get(envoy_home, ""), "home_palace": envoy_home,
                       "landed_palace": envoy_target},
        "palaces": palaces,
        "conventions": {"yuan": "拆補法 (chai bu)", "plate": "轉盤 (rotating)",
                        "centre": "palace 5 has no door; duty falls to palace 2"},
    }


def summary(c: Dict) -> str:
    if not c:
        return ""
    s = c["selection"]
    out = [f"QI MEN DUN JIA — {s['label']}",
           f"  duty chief {c['duty_chief']['star']} palace "
           f"{c['duty_chief']['home_palace']}→{c['duty_chief']['landed_palace']} · "
           f"duty envoy {c['duty_envoy']['door']} palace "
           f"{c['duty_envoy']['home_palace']}→{c['duty_envoy']['landed_palace']}"]
    for p in (4, 9, 2, 3, 5, 7, 8, 1, 6):     # printed in Luo Shu square order
        d = c["palaces"][p]
        w = f" [{d['wonder']}]" if d["wonder"] else ""
        out.append(f"  {p} {d['trigram']}{d['direction']:3} "
                   f"heaven {d['heaven_stem'] or '—':2} earth {d['earth_stem'] or '—':2} "
                   f"{d['star'] or '—':9} {d['door'] or '—':4} {d['spirit'] or '—'}{w}")
    return "\n".join(out)
