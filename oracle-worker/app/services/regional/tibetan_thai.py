"""
TIBETAN (Jungtsi) and THAI (Horasat), plus the Korean and Vietnamese variants.

Four regional systems that are commonly and wrongly folded into their larger neighbours.

TIBETAN elemental astrology (nag-rtsis / jung-tsi) is Chinese in ancestry — the twelve
animals and five elements are the same — but adds two layers Chinese practice does not
have: the nine MEWA (numbered squares) and the eight PARKHA (trigrams), which together
govern the five personal forces a Tibetan reading is actually about. It also sits beside
a wholly separate Indian-derived layer (kar-rtsis) used for the calendar. Calling it
"Tibetan Chinese astrology" misses everything that makes it a distinct practice.

THAI Horasat is Indian-derived and sidereal, but its distinguishing feature is native:
Wednesday is divided into a day half and a night half, giving EIGHT day-lords rather than
seven, with Rahu governing Wednesday night. Everything downstream — the eight-fold house
scheme, the day colours, the birthday Buddha — follows from that division.

SAJU and TU VI are Korean and Vietnamese continuations of BaZi and Zi Wei Dou Shu. They
are not merely translations, and the differences are recorded here rather than assumed away.
"""
from typing import Dict, List, Optional

# ═══════════════════════════════════════════════════════════════════════════
# TIBETAN
# ═══════════════════════════════════════════════════════════════════════════

ANIMALS = ["Mouse", "Ox", "Tiger", "Rabbit", "Dragon", "Snake",
           "Horse", "Sheep", "Monkey", "Bird", "Dog", "Pig"]
ELEMENTS = ["Wood", "Fire", "Earth", "Iron", "Water"]

MEWA = [
    (1, "White", "beginnings, clarity, the opening of a path"),
    (2, "Black", "obstruction, what must be cleared before progress"),
    (3, "Blue", "conflict and its resolution; the disputed matter"),
    (4, "Green", "growth, increase, what flourishes if tended"),
    (5, "Yellow", "the centre; stability, and stagnation if held too long"),
    (6, "White", "authority, protection, the support of elders"),
    (7, "Red", "force and danger; energy that cuts either way"),
    (8, "White", "accumulation, wealth, what gathers and remains"),
    (9, "Maroon", "completion and its dissolution; endings that release"),
]

PARKHA = [
    ("Li", "fire", "brilliance, recognition, what is seen"),
    ("Khon", "earth", "the mother, the ground, receptivity"),
    ("Da", "iron", "joy, speech, exchange"),
    ("Khen", "iron", "the father, authority, heaven"),
    ("Kham", "water", "depth, danger, what must be crossed"),
    ("Gin", "earth", "the mountain, stillness, the threshold"),
    ("Zin", "wood", "thunder, movement, the shock that wakes"),
    ("Zon", "wood", "wind, gradual influence, penetration"),
]

# The five personal forces a Tibetan reading judges. This is the layer that has no
# Chinese counterpart and it is what the system is actually for.
FORCES = {
    "srog": "life-force — vitality itself, the first thing checked",
    "lu": "body — physical health and constitution",
    "wangthang": "personal power — capacity, influence, standing",
    "lungta": "windhorse — luck, momentum, how favourably things fall out",
    "la": "soul — the protective spirit-force, the most vulnerable of the five",
}

# The animal's natural element (khams). This part is not disputed: the four trines each
# carry an element and the four "earth" animals hold the corners.
ANIMAL_ELEMENT = {
    "Tiger": "Wood", "Rabbit": "Wood",
    "Horse": "Fire", "Snake": "Fire",
    "Monkey": "Iron", "Bird": "Iron",
    "Mouse": "Water", "Pig": "Water",
    "Dragon": "Earth", "Sheep": "Earth", "Dog": "Earth", "Ox": "Earth",
}

# The Tibetan five phases. Iron stands where Chinese practice says Metal.
_PRODUCES = {"Wood": "Fire", "Fire": "Earth", "Earth": "Iron", "Iron": "Water", "Water": "Wood"}
_CONTROLS = {"Wood": "Earth", "Earth": "Water", "Water": "Fire", "Fire": "Iron", "Iron": "Wood"}
_PRODUCED_BY = {v: k for k, v in _PRODUCES.items()}
_CONTROLLED_BY = {v: k for k, v in _CONTROLS.items()}

# How each force's element is derived from the life element. The five wu-xing relations
# map one-to-one onto the five forces, which is the presentation used by the Men-Tsee-Khang
# summaries in circulation — but almanacs DO differ here, so this is a parameter with a
# stated default rather than a constant, exactly as the mewa and parkha anchors are.
FORCE_DERIVATION = {
    "srog": "self",            # the life element itself
    "lu": "produces",          # what the life element generates
    "wangthang": "produced_by",  # what generates it
    "lungta": "controls",      # what it overcomes
    "la": "controlled_by",     # what overcomes it — hence the most exposed
}

_REL = {"self": lambda e: e, "produces": lambda e: _PRODUCES[e],
        "produced_by": lambda e: _PRODUCED_BY[e], "controls": lambda e: _CONTROLS[e],
        "controlled_by": lambda e: _CONTROLLED_BY[e]}


def _judge(force_element: str, year_element: str) -> Dict:
    """How a year's element treats one force."""
    if force_element == year_element:
        return {"state": "stable", "read": "the year matches it — steady, neither raised nor pressed"}
    if _PRODUCES.get(year_element) == force_element:
        return {"state": "strong", "read": "the year feeds it — this is where support arrives"}
    if _PRODUCES.get(force_element) == year_element:
        return {"state": "spent", "read": "it feeds the year — productive, but it drains"}
    if _CONTROLS.get(year_element) == force_element:
        return {"state": "weak", "read": "the year presses on it — the exposed point of the year"}
    if _CONTROLS.get(force_element) == year_element:
        return {"state": "dominant", "read": "it overcomes the year — force applies here"}
    return {"state": "neutral", "read": "no strong relation"}


def five_forces(birth_year: int, for_year: Optional[int] = None,
                derivation: Optional[Dict[str, str]] = None) -> Dict:
    """The five forces of a birth, and how a given year treats each.

    The forces were named in this module from the start and never computed, which left
    the layer that distinguishes Tibetan practice from Chinese as a glossary. This
    computes them: each force takes an element derived from the birth animal's life
    element, and is then judged against the target year's own element.

    `derivation` overrides the force→element mapping for a caller following a different
    almanac. The default is stated in FORCE_DERIVATION and is one presentation, not the
    only one — which is why it is overridable."""
    by = int(birth_year)
    animal = ANIMALS[(by - 4) % 12]
    life_element = ANIMAL_ELEMENT[animal]
    fy = int(for_year) if for_year else by
    year_element = ELEMENTS[((fy - 4) % 10) // 2]
    rules = dict(FORCE_DERIVATION)
    rules.update(derivation or {})

    out = {}
    for key, meaning in FORCES.items():
        rel = rules.get(key, "self")
        elem = _REL[rel](life_element)
        out[key] = {"element": elem, "meaning": meaning, "derived": rel,
                    **_judge(elem, year_element)}

    weakest = min(out.items(),
                  key=lambda kv: {"weak": 0, "spent": 1, "neutral": 2, "stable": 3,
                                  "dominant": 4, "strong": 5}[kv[1]["state"]])
    return {
        "birth_year": by, "animal": animal, "life_element": life_element,
        "for_year": fy, "year_element": year_element,
        "forces": out,
        "most_exposed": weakest[0],
        "derivation_note": ("Force→element derivation follows FORCE_DERIVATION; almanacs "
                            "differ, and a caller may pass its own."),
    }


def tibetan_year(year: int, gender: str = "male",
                 mewa_anchor_year: int = 2027, mewa_anchor_value: int = 1,
                 parkha_anchor_year: int = 2027, parkha_anchor_index: int = 0) -> Dict:
    """Animal, element, mewa and parkha for a birth year.

    The animal and element follow the 60-year cycle and are unambiguous. The MEWA and
    PARKHA anchors are REQUIRED PARAMETERS with stated defaults rather than hidden
    constants, because published tables disagree about the anchoring and the parkha
    additionally runs in opposite directions by gender. A caller using a different
    almanac supplies its anchor and gets that almanac's answer."""
    y = int(year)
    animal = ANIMALS[(y - 4) % 12]
    element = ELEMENTS[((y - 4) % 10) // 2]

    m_idx = (mewa_anchor_value - 1 - (y - mewa_anchor_year)) % 9
    mewa_n, mewa_colour, mewa_gloss = MEWA[m_idx]

    step = 1 if gender.lower().startswith("m") else -1
    p_idx = (parkha_anchor_index + step * (y - parkha_anchor_year)) % 8
    p_name, p_elem, p_gloss = PARKHA[p_idx]

    return {
        "year": y, "gender": gender,
        "animal": animal, "element": element,
        "sign": f"{element} {animal}",
        "mewa": {"number": mewa_n, "colour": mewa_colour, "meaning": mewa_gloss},
        "parkha": {"name": p_name, "element": p_elem, "meaning": p_gloss},
        # Computed against the birth year itself; pass a target year to five_forces() for
        # "how does THIS year treat me", which is what an almanac consultation asks.
        "forces": five_forces(y)["forces"],
        "anchors": {"mewa": f"{mewa_anchor_year}→{mewa_anchor_value}",
                    "parkha": f"{parkha_anchor_year}→{PARKHA[parkha_anchor_index][0]}",
                    "note": ("Published tables disagree on the anchoring. These are "
                             "parameters, not constants — a chart is valid against the "
                             "anchor it states.")},
        "caveat": ("Elemental astrology (nag-rtsis) only. The Indian-derived kar-rtsis "
                   "layer used for the Tibetan calendar is a separate system and is not "
                   "computed here."),
    }


# ═══════════════════════════════════════════════════════════════════════════
# THAI
# ═══════════════════════════════════════════════════════════════════════════

# Eight day-lords: Wednesday splits, and Rahu takes the night half.
THAI_DAYS = [
    ("Sunday", "Phra Athit", "Sun", "red", "Buddha in contemplation"),
    ("Monday", "Phra Chan", "Moon", "yellow", "Buddha calming the ocean"),
    ("Tuesday", "Phra Angkhan", "Mars", "pink", "the reclining Buddha"),
    ("Wednesday (day)", "Phra Phut", "Mercury", "green", "Buddha with the alms bowl"),
    ("Wednesday (night)", "Phra Rahu", "Rahu", "dark green", "Buddha in the forest with elephant and monkey"),
    ("Thursday", "Phra Phruhat", "Jupiter", "orange", "Buddha in meditation"),
    ("Friday", "Phra Suk", "Venus", "blue", "Buddha in contemplation, standing"),
    ("Saturday", "Phra Sao", "Saturn", "purple", "Buddha protected by the naga"),
]


def thai_day(day_index: int, night: bool = False) -> Dict:
    """The Thai day-lord. `day_index` 0 = Sunday. `night` matters only for Wednesday."""
    i = int(day_index) % 7
    if i == 3 and night:
        idx = 4
    elif i == 3:
        idx = 3
    else:
        idx = i if i < 3 else i + 1
    name, deva, planet, colour, buddha = THAI_DAYS[idx]
    return {
        "day": name, "deva": deva, "planet": planet,
        "colour": colour, "birthday_buddha": buddha,
        "lord_index": idx + 1, "of": 8,
        "note": ("Thai practice divides Wednesday into day and night halves, giving eight "
                 "day-lords rather than seven, with Rahu governing Wednesday night. This "
                 "is native to Thai astrology and has no Indian counterpart."),
    }


def thai_days() -> List[Dict]:
    return [{"day": d, "deva": dv, "planet": p, "colour": c, "birthday_buddha": b}
            for d, dv, p, c, b in THAI_DAYS]


# ═══════════════════════════════════════════════════════════════════════════
# SAJU (Korea) and TU VI (Vietnam)
# ═══════════════════════════════════════════════════════════════════════════

SAJU = {
    "name": "Saju Palja (사주팔자)",
    "parent": "four_pillars",
    "shares": "The same four pillars, ten gods, hidden stems and luck pillars as BaZi.",
    "differs": [
        "Korean practice weights the DAY PILLAR more heavily still, and reads the "
        "day branch (일지) for the spouse more directly than Chinese practice does.",
        "The 十二運星 twelve life-stages are used more prominently than in most Chinese "
        "lineages.",
        "Korean standard time is UTC+9 but Korea sits near 127°E, so local mean time runs "
        "about 30 minutes behind clock time — a correction that moves the hour pillar for "
        "births near a boundary, and one Korean practitioners apply routinely.",
    ],
    "independence_note": ("Saju is NOT independent testimony from BaZi. It is the same "
                          "computation with a different reading emphasis, and the "
                          "consensus engine must treat them as one line."),
}

TU_VI = {
    "name": "Tử Vi Đẩu Số",
    "parent": "ziwei_doushu",
    "shares": "The same twelve palaces and star-placement logic as Zi Wei Dou Shu.",
    "differs": [
        "Vietnamese practice uses a partly different star set and gives several stars "
        "different names and weights.",
        "The Vietnamese lunar calendar diverged from the Chinese in 1968 when Vietnam "
        "moved to UTC+7 — dates near a month boundary can differ by a day, which changes "
        "the entire palace layout.",
    ],
    "independence_note": ("Shares its substrate with Zi Wei Dou Shu and is not an "
                          "independent witness to it."),
}


def variant(name: str) -> Dict:
    return {"saju": SAJU, "tuvi": TU_VI, "tu_vi": TU_VI}.get((name or "").lower(), {})


assert len(THAI_DAYS) == 8 and len(MEWA) == 9 and len(PARKHA) == 8
assert tibetan_year(2024)["sign"] == "Wood Dragon"
assert tibetan_year(1984)["sign"] == "Wood Mouse"
