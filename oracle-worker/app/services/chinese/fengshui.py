"""
FENG SHUI — Ba Zhai (八宅) and Xuan Kong Flying Star (玄空飛星).

The platform already carries Indian vastu. These are the Chinese methods, and they are not
the same discipline: vastu works from the Vastu Purusha mandala and fixed directional
deities, while Ba Zhai works from a personal gua number and Flying Star from a building's
construction period and facing. A house can be excellent under one and poor under the other
with no contradiction, because they measure different things.

TWO SCHOOLS THAT DISAGREE
─────────────────────────
Ba Zhai is a FORM school method: it matches a person to directions and never changes.
Flying Star is a COMPASS school method: it is time-bound, and the same building has
different stars in different periods. Practitioners of each are often dismissive of the
other. Both are implemented; neither is presented as correcting the other.
"""
from typing import Dict

# ═══════════════════════════════════════════════════════════════════════════
# BA ZHAI — Eight Mansions
# ═══════════════════════════════════════════════════════════════════════════

GUA_TRIGRAM = {1: ("Kan", "坎", "N", "water"), 2: ("Kun", "坤", "SW", "earth"),
               3: ("Zhen", "震", "E", "wood"), 4: ("Xun", "巽", "SE", "wood"),
               6: ("Qian", "乾", "NW", "metal"), 7: ("Dui", "兌", "W", "metal"),
               8: ("Gen", "艮", "NE", "earth"), 9: ("Li", "離", "S", "fire")}

EAST_GROUP = {1, 3, 4, 9}
WEST_GROUP = {2, 6, 7, 8}

# The four favourable and four unfavourable directions for each gua.
# (sheng_qi, tian_yi, yan_nian, fu_wei, huo_hai, wu_gui, liu_sha, jue_ming)
_BAZHAI = {
    1: ("SE", "E", "S", "N", "W", "NE", "NW", "SW"),
    3: ("S", "N", "SE", "E", "SW", "NW", "NE", "W"),
    4: ("N", "S", "E", "SE", "NW", "SW", "W", "NE"),
    9: ("E", "SE", "N", "S", "NE", "W", "SW", "NW"),
    2: ("NE", "W", "NW", "SW", "E", "SE", "S", "N"),
    6: ("W", "NE", "SW", "NW", "SE", "E", "N", "S"),
    7: ("NW", "SW", "NE", "W", "N", "S", "E", "SE"),
    8: ("SW", "NW", "W", "NE", "S", "N", "SE", "E"),
}

DIRECTION_MEANING = {
    "sheng_qi": ("生氣 Sheng Qi", "life breath — vitality, advancement, reputation; the "
                 "strongest direction, used for the main door and the desk"),
    "tian_yi": ("天醫 Tian Yi", "heavenly doctor — health and recovery; used for the bed, "
                "especially during illness"),
    "yan_nian": ("延年 Yan Nian", "long life — relationships and harmony; used for the "
                 "bed in a marriage"),
    "fu_wei": ("伏位 Fu Wei", "stability — clarity and peace; used for study and meditation"),
    "huo_hai": ("禍害 Huo Hai", "mishaps — minor accidents, delays, irritation"),
    "wu_gui": ("五鬼 Wu Gui", "five ghosts — theft, fire, betrayal, quarrels"),
    "liu_sha": ("六煞 Liu Sha", "six killings — legal trouble, scandal, loss"),
    "jue_ming": ("絕命 Jue Ming", "total loss — the most inauspicious; health and "
                 "livelihood both"),
}
_KEYS = ("sheng_qi", "tian_yi", "yan_nian", "fu_wei",
         "huo_hai", "wu_gui", "liu_sha", "jue_ming")


def gua_number(solar_year: int, gender: str) -> Dict:
    """The personal gua (kua) number.

    Uses the CHINESE SOLAR year, which begins at Li Chun around 4 February. A birth on
    20 January belongs to the previous solar year, and using the Gregorian year there is
    the most common error in gua calculation."""
    y = int(solar_year)
    digits = sum(int(c) for c in str(abs(y)))
    while digits > 9:
        digits = sum(int(c) for c in str(digits))

    male = gender.lower().startswith("m")
    if male:
        g = 11 - digits
        if g > 9:
            g -= 9
        if g == 5:
            g = 2
    else:
        g = 4 + digits
        if g > 9:
            g -= 9
        if g == 5:
            g = 8

    name, cn, home, elem = GUA_TRIGRAM[g]
    group = "East" if g in EAST_GROUP else "West"
    dirs = _BAZHAI[g]
    return {
        "gua": g, "gender": gender, "solar_year": y,
        "trigram": name, "chinese": cn, "home_direction": home, "element": elem,
        "group": group,
        "compatible_group": sorted(EAST_GROUP if group == "East" else WEST_GROUP),
        "directions": {k: {"direction": dirs[i], "name": DIRECTION_MEANING[k][0],
                           "meaning": DIRECTION_MEANING[k][1],
                           "auspicious": i < 4}
                       for i, k in enumerate(_KEYS)},
        "note": ("Based on the Chinese solar year beginning at Li Chun (~4 Feb), not the "
                 "Gregorian year. A January birth uses the previous year."),
    }


# ═══════════════════════════════════════════════════════════════════════════
# XUAN KONG FLYING STAR
# ═══════════════════════════════════════════════════════════════════════════

LUOSHU = {1: "N", 2: "SW", 3: "E", 4: "SE", 5: "C", 6: "NW", 7: "W", 8: "NE", 9: "S"}
# The order stars walk when flying through the palaces.
FLY_ORDER = [5, 6, 7, 8, 9, 1, 2, 3, 4]

STAR_NATURE = {
    1: ("白 White", "water — career, wisdom; auspicious in the current period"),
    2: ("黑 Black", "earth — illness; the sickness star, unfavourable"),
    3: ("碧 Jade", "wood — argument and litigation; unfavourable"),
    4: ("綠 Green", "wood — scholarship and romance; favourable for study"),
    5: ("黃 Yellow", "earth — misfortune; the most destructive, avoid disturbing"),
    6: ("白 White", "metal — authority and helpful people"),
    7: ("赤 Red", "metal — robbery and betrayal; was favourable in period 7, now not"),
    8: ("白 White", "earth — wealth; was the prosperity star in period 8"),
    9: ("紫 Purple", "fire — future prosperity; the current period star from 2024"),
}

PERIODS = {1: (1864, 1883), 2: (1884, 1903), 3: (1904, 1923), 4: (1924, 1943),
           5: (1944, 1963), 6: (1964, 1983), 7: (1984, 2003), 8: (2004, 2023),
           9: (2024, 2043)}


def period_of(year: int) -> int:
    """The 20-year construction period a year falls in."""
    y = int(year)
    for p, (a, b) in PERIODS.items():
        if a <= y <= b:
            return p
    return 9 if y > 2043 else 1


def annual_star(year: int) -> Dict:
    """The star occupying the centre for a given year."""
    y = int(year)
    s = 9 - ((y - 2000) % 9)
    s = s if 1 <= s <= 9 else ((s - 1) % 9) + 1
    name, meaning = STAR_NATURE[s]
    return {"year": y, "star": s, "name": name, "meaning": meaning}


def _fly(center_star: int, reverse: bool = False) -> Dict[int, int]:
    """Send a star through the nine palaces from the centre."""
    out = {}
    # Palaces are visited in Luo Shu walking order beginning at the centre.
    walk = [5, 6, 7, 8, 9, 1, 2, 3, 4]
    for i, palace in enumerate(walk):
        step = -i if reverse else i
        s = ((center_star - 1 + step) % 9) + 1
        out[palace] = s
    return out


def natal_chart(construction_year: int, facing_degrees: float) -> Dict:
    """The building's flying star chart.

    The base star is the construction period; the mountain and water stars derive from the
    facing direction's palace. This module computes the base and annual layers and the
    facing palace; the mountain/water derivation depends on which of the three sub-palaces
    (元) the facing falls in and on replacement-star rules that differ between lineages,
    so those are reported as the facing palace rather than resolved into stars."""
    p = period_of(construction_year)
    face = float(facing_degrees) % 360.0
    # 24 mountains of 15° each; the eight palaces take three mountains apiece.
    mountain = int(face // 15)
    palace_seq = [1, 8, 3, 4, 9, 2, 7, 6]      # N, NE, E, SE, S, SW, W, NW
    palace = palace_seq[int(((face + 22.5) % 360) // 45)]
    sitting = palace_seq[(palace_seq.index(palace) + 4) % 8]

    base = _fly(p)
    return {
        "construction_year": int(construction_year),
        "period": p, "period_years": PERIODS[p],
        "facing_degrees": face,
        "facing_palace": {"palace": palace, "direction": LUOSHU[palace]},
        "sitting_palace": {"palace": sitting, "direction": LUOSHU[sitting]},
        "mountain_of_24": mountain + 1,
        "base_stars": {LUOSHU[k]: {"palace": k, "star": v,
                                   "name": STAR_NATURE[v][0],
                                   "meaning": STAR_NATURE[v][1]}
                       for k, v in base.items()},
        "not_computed": ("Mountain (山星) and water (向星) stars depend on which of the "
                         "three sub-divisions the facing falls in and on replacement-star "
                         "rules that differ between lineages. The facing and sitting "
                         "palaces are given; the derivation is left to a practitioner "
                         "rather than resolved by picking one lineage silently."),
    }


def summary(g: Dict) -> str:
    if not g or "gua" not in g:
        return ""
    d = g["directions"]
    good = [f"{d[k]['direction']} ({d[k]['name']})" for k in _KEYS[:4]]
    bad = [f"{d[k]['direction']}" for k in _KEYS[4:]]
    return "\n".join([
        f"BA ZHAI — gua {g['gua']} ({g['trigram']} {g['chinese']}), {g['group']} group",
        f"  favourable: {', '.join(good)}",
        f"  avoid: {', '.join(bad)}",
        f"  {g['note']}",
    ])


assert gua_number(1984, "male")["gua"] == 7
assert gua_number(1984, "female")["gua"] == 8
assert period_of(2024) == 9 and period_of(2010) == 8
assert annual_star(2024)["star"] == 3 and annual_star(2025)["star"] == 2
assert all(len(set(_fly(n).values())) == 9 for n in range(1, 10))
