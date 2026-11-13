"""
THE THREE CHINESE SYSTEMS THE INDEX STILL LISTED AS ABSENT.

  GUO LAO XING ZONG (果老星宗) — China's HOROSCOPIC astrology, and the answer to a
  question the rest of this codebase quietly raises: what did Chinese astrology look like
  before BaZi took over? It looked like this. Twelve houses, eleven moving bodies, and the
  28 mansions — recognisably the same family as Hellenistic and Indian practice, because
  it descends from the same transmission through Buddhist translation. BaZi displaced it
  so thoroughly that it is now the obscure one, which is a historical accident rather than
  a judgement on the method.

  Its eleven bodies are the seven visible plus FOUR invisible: 羅睺 Rahu and 計都 Ketu (the
  lunar nodes, straight from Indian astronomy), 月孛 Yuebei (the lunar apogee — a real
  astronomical point, computed here from actual apsidal motion), and 紫氣 Ziqi (a
  hypothetical with roughly a 28-year period and no physical referent, which the sources
  are open about).

  TIE BAN SHEN SHU (鐵板神數) — the Iron Plate. Famous for two things: alarming accuracy
  about a person's family, and total secrecy about how it works. The mechanism derives
  condition-numbers from the pillars and indexes a book of some twelve thousand verses.
  The DERIVATION is computed here with its parameters stated; the verse book is
  lineage-held and is not reproduced, because it is not public and no honest
  reconstruction of it exists.

  SAN HE (三合) — the Three Harmonies school of feng shui, and the other half of the
  practice from Flying Star's Xuan Kong. Where Xuan Kong reads time, San He reads FORM and
  WATER: the four celestial animals of the landform, the trinities of the 24 mountains,
  and above all the water exit, judged against the twelve stages of the dragon. A site
  that Xuan Kong approves and San He condemns is a real disagreement between schools, not
  a contradiction to be averaged away.
"""
from typing import Dict, Optional

from .lunisolar import BRANCHES, BRANCHES_CN, gregorian_to_jd, lunar_date

# ══════════════════════════════════════════════════════════════════════════════
# GUO LAO XING ZONG
# ══════════════════════════════════════════════════════════════════════════════

GUOLAO_HOUSES = [
    ("命宮", "Life", "the self, and the shape the whole chart takes"),
    ("財帛", "Wealth", "money and movable property"),
    ("兄弟", "Siblings", "brothers, sisters and peers"),
    ("田宅", "Property", "land, house, and what is fixed"),
    ("男女", "Children", "offspring and what one generates"),
    ("奴僕", "Servants", "subordinates and those who work for one"),
    ("妻妾", "Spouse", "marriage and the partner"),
    ("疾厄", "Illness", "the body and its afflictions"),
    ("遷移", "Travel", "movement, and life away from home"),
    ("官祿", "Office", "rank, profession and standing"),
    ("福德", "Fortune", "merit, ease and inner life"),
    ("相貌", "Appearance", "the face, bearing, and how one is perceived"),
]

GUOLAO_BODIES = {
    "太陽": ("Sun", "the father, rank, and the vital force"),
    "太陰": ("Moon", "the mother, the body, and what is received"),
    "水星": ("Mercury", "learning, speech, and the quick hand"),
    "金星": ("Venus", "women, ornament, and what is enjoyed"),
    "火星": ("Mars", "conflict, fire, and forced separation"),
    "木星": ("Jupiter", "office, teachers, and good fortune"),
    "土星": ("Saturn", "labour, land, and slow returns"),
    "羅睺": ("Rahu — north lunar node", "the swallowing head; excess, foreign things, eclipse"),
    "計都": ("Ketu — south lunar node", "the severed tail; loss, renunciation, the hidden"),
    "月孛": ("Yuebei — lunar apogee", "grief and obstruction; the slow malefic of this system"),
    "紫氣": ("Ziqi — the purple vapour", "the great benefic; nobility and unearned favour"),
}

_SIDEREAL_SIGNS = ["娵訾 Zi", "降婁 Lou", "大梁 Liang", "實沈 Chen", "鶉首 Shou",
                   "鶉火 Huo", "鶉尾 Wei", "壽星 Xing", "大火 Da Huo", "析木 Mu",
                   "星紀 Ji", "玄枵 Xiao"]


def _mean_node(jd: float) -> float:
    """The Moon's mean ascending node — Rahu. Real astronomy, retrograde ~18.6 years."""
    t = (jd - 2451545.0) / 36525.0
    return (125.0445479 - 1934.1362891 * t + 0.0020754 * t * t) % 360.0


def _lunar_apogee(jd: float) -> float:
    """The Moon's mean apogee — Yuebei. The apsidal line advances in about 8.85 years.

    A REAL astronomical point, unlike Ziqi, and this is worth marking: the system mixes
    genuine positions with a hypothetical, and the sources do not hide which is which."""
    t = (jd - 2451545.0) / 36525.0
    perigee = (83.3532465 + 4069.0137287 * t - 0.0103200 * t * t) % 360.0
    return (perigee + 180.0) % 360.0


def _ziqi(jd: float, period_years: float = 28.0, epoch_longitude: float = 0.0) -> float:
    """Ziqi — the purple vapour. Hypothetical, with a stated period.

    There is no body here. The sources give it roughly a 28-year cycle; the period and the
    epoch are exposed as parameters because different lineages seat it differently and a
    hidden constant would present one lineage's convention as astronomy."""
    days = jd - 2451545.0
    return (float(epoch_longitude) + 360.0 * days / (float(period_years) * 365.2422)) % 360.0


def guo_lao(year: int, month: int, day: int, hour: int = 12, minute: int = 0,
            longitudes: Optional[Dict[str, float]] = None,
            ascendant: Optional[float] = None,
            ayanamsa: float = 24.0) -> Dict:
    """A Guo Lao chart.

    `longitudes` supplies TROPICAL positions for the seven visible bodies (from the
    Western engine); the four invisible are computed here. Everything is then shifted to
    the sidereal frame this system uses, which is why the ayanamsa is a parameter rather
    than a constant — Chinese practice and Indian practice do not use the same value."""
    jd = gregorian_to_jd(int(year), int(month), int(day),
                         float(hour) + float(minute) / 60.0)
    ay = float(ayanamsa)

    pos: Dict[str, float] = {}
    src = {k.lower(): v for k, v in (longitudes or {}).items()}
    for cn, key in (("太陽", "sun"), ("太陰", "moon"), ("水星", "mercury"),
                    ("金星", "venus"), ("火星", "mars"), ("木星", "jupiter"),
                    ("土星", "saturn")):
        if key in src:
            pos[cn] = (float(src[key]) - ay) % 360.0

    rahu = _mean_node(jd)
    pos["羅睺"] = (rahu - ay) % 360.0
    pos["計都"] = (rahu + 180.0 - ay) % 360.0
    pos["月孛"] = (_lunar_apogee(jd) - ay) % 360.0
    pos["紫氣"] = (_ziqi(jd) - ay) % 360.0

    asc = ((float(ascendant) - ay) % 360.0) if ascendant is not None else None
    houses = {}
    if asc is not None:
        base = int(asc // 30)
        for i, (cn, en, meaning) in enumerate(GUOLAO_HOUSES):
            sign_idx = (base - i) % 12          # houses run clockwise from the Ascendant
            occupants = [b for b, lon in pos.items() if int(lon // 30) == sign_idx]
            houses[en] = {"chinese": cn, "meaning": meaning,
                          "sign": _SIDEREAL_SIGNS[sign_idx],
                          "bodies": [{"chinese": b, "name": GUOLAO_BODIES[b][0],
                                      "means": GUOLAO_BODIES[b][1],
                                      "degree": round(pos[b] % 30, 2)} for b in occupants]}

    return {
        "system": "Guo Lao Xing Zong (果老星宗)",
        "positions": {k: {"longitude": round(v, 3), "sign": _SIDEREAL_SIGNS[int(v // 30)],
                          "name": GUOLAO_BODIES[k][0], "means": GUOLAO_BODIES[k][1],
                          "real_body": k not in ("紫氣",)}
                      for k, v in sorted(pos.items(), key=lambda kv: kv[1])},
        "houses": houses or None,
        "ayanamsa": ay,
        "note": ("China's horoscopic tradition, displaced by BaZi rather than disproved by "
                 "it. Eleven bodies: the seven visible, the two lunar nodes, the lunar "
                 "apogee — all real — and Ziqi, which is hypothetical and is flagged as "
                 "such in every position it returns."),
        "requires": ("Tropical longitudes for the seven visible bodies must be supplied; "
                     "without them only the four invisible are computed."),
    }


# ══════════════════════════════════════════════════════════════════════════════
# TIE BAN SHEN SHU
# ══════════════════════════════════════════════════════════════════════════════

# The derivation coefficients. STATED, and adjustable: lineages differ, and a hidden
# constant here would be presenting one school's secret as the method.
TIEBAN_COEFFICIENTS = {"year": 120, "month": 12, "day": 360, "hour": 12, "offset": 0}


def tie_ban(year: int, month: int, day: int, hour: int = 12, minute: int = 0,
            coefficients: Optional[Dict[str, int]] = None,
            verses: int = 12000) -> Dict:
    """The Iron Plate condition-number derivation.

    Tie Ban's reputation rests on naming a querent's siblings and parents from the chart,
    and its method is genuinely secret — transmitted within lineages, with the
    coefficients treated as the valuable part. What is public is the SHAPE: the four
    pillars are converted to numbers, combined by a set of multipliers, and the results
    index verses in a book of about twelve thousand.

    That shape is computed here with the coefficients stated as parameters. The verse book
    is not reproduced and no reconstruction of it is offered: it is a closed text, and
    inventing verses that sound like Tie Ban would be exactly the sin this catalogue was
    built to correct."""
    c = dict(TIEBAN_COEFFICIENTS)
    c.update(coefficients or {})
    ld = lunar_date(int(year), int(month), int(day), int(hour), int(minute))

    y = (ld.year_stem + 1) * (ld.year_branch + 1)
    m = (ld.month_stem + 1) * (ld.month_branch + 1)
    d = (ld.day_stem + 1) * (ld.day_branch + 1)
    h = (ld.hour_stem + 1) * (ld.hour_branch + 1)

    raw = y * c["year"] + m * c["month"] + d * c["day"] + h * c["hour"] + c["offset"]
    primary = (raw % int(verses)) + 1
    # The secondary conditions — the passes that narrow a reading in practice.
    secondary = [((raw * k) % int(verses)) + 1 for k in (3, 7, 11, 13)]

    return {
        "system": "Tie Ban Shen Shu (鐵板神數)",
        "pillar_numbers": {"year": y, "month": m, "day": d, "hour": h},
        "condition_number": primary, "of_verses": int(verses),
        "secondary_conditions": secondary,
        "coefficients": c,
        "lunar": ld.label,
        "limit": ("The condition numbers are computed from the stated coefficients. The "
                  "twelve-thousand-verse book they index is lineage-held and is NOT "
                  "reproduced — it is a closed text, and no honest public reconstruction "
                  "of it exists. Coefficients differ between lineages, so a number is "
                  "only meaningful against the set that produced it."),
    }


# ══════════════════════════════════════════════════════════════════════════════
# SAN HE
# ══════════════════════════════════════════════════════════════════════════════

# The four trinities of the 24 mountains — the backbone of San He.
SANHE_TRINITIES = {
    "water": {"branches": [8, 0, 4], "chinese": "申子辰", "birth": 8,
              "meaning": "the water frame — wealth by flow, trade and movement"},
    "wood": {"branches": [11, 3, 7], "chinese": "亥卯未", "birth": 11,
             "meaning": "the wood frame — growth, scholarship and lineage"},
    "fire": {"branches": [2, 6, 10], "chinese": "寅午戌", "birth": 2,
             "meaning": "the fire frame — fame, rank and rapid rise"},
    "metal": {"branches": [5, 9, 1], "chinese": "巳酉丑", "birth": 5,
              "meaning": "the metal frame — authority, arms and hard wealth"},
}

# 十二長生 — the twelve stages, applied to WATER rather than to a person.
TWELVE_STAGES = [
    ("長生", "birth", "water arriving from here brings vigour and new fortune"),
    ("沐浴", "bathing", "unstable; a water exit here brings scandal and loss through women"),
    ("冠帶", "capping", "young ambition; adequate, not strong"),
    ("臨官", "office", "excellent — a水口 here supports rank and wealth"),
    ("帝旺", "prosperity", "the peak; strongest arrival, worst exit"),
    ("衰", "decline", "acceptable exit — the classical 衰方 discharge"),
    ("病", "illness", "water leaving here brings sickness to the household"),
    ("死", "death", "the worst exit; wasting and bereavement"),
    ("墓", "tomb", "the standard exit in San He — water should be buried, not spilled"),
    ("絕", "severance", "cut off; sudden ruin"),
    ("胎", "conception", "hidden potential; weak either way"),
    ("養", "nurture", "mild; supports children and continuity"),
]

CELESTIAL_ANIMALS = {
    "azure_dragon": ("青龍", "left flank, seen facing out — the male side; should be higher, "
                     "longer and more embracing than the tiger"),
    "white_tiger": ("白虎", "right flank — the female side; should be lower and quieter than "
                    "the dragon, and a tiger that overtops the dragon is the classical fault"),
    "vermilion_bird": ("朱雀", "the front — open ground and water; should be bright, level "
                       "and unobstructed"),
    "black_tortoise": ("玄武", "the rear — the mountain at the back; should be solid, high "
                       "and unbroken, since it is the support"),
}


def san_he(sitting_branch: int, water_exit_branch: int,
           landform: Optional[Dict[str, str]] = None) -> Dict:
    """A San He judgement — the form-and-water school.

    The site's frame comes from the trinity its sitting direction belongs to; the water
    exit is then judged by which of the twelve stages it falls on, counting from the
    frame's birth point. This is the school's central operation, and it is why San He and
    Xuan Kong can disagree about the same house: they are reading different things."""
    s = int(sitting_branch) % 12
    w = int(water_exit_branch) % 12

    frame_key = next((k for k, v in SANHE_TRINITIES.items() if s in v["branches"]), None)
    if frame_key is None:
        # A stem or corner mountain — assign by the nearest branch trinity.
        frame_key = next(k for k, v in SANHE_TRINITIES.items()
                         if (s + 1) % 12 in v["branches"] or (s - 1) % 12 in v["branches"])
    frame = SANHE_TRINITIES[frame_key]

    stage_idx = (w - frame["birth"]) % 12
    cn, en, verdict = TWELVE_STAGES[stage_idx]
    good = en in ("office", "tomb", "decline", "birth", "nurture")

    out = {
        "system": "San He (三合)",
        "sitting": {"branch": BRANCHES[s], "chinese": BRANCHES_CN[s]},
        "frame": {"element": frame_key, "chinese": frame["chinese"],
                  "meaning": frame["meaning"],
                  "birth_point": BRANCHES[frame["birth"]]},
        "water_exit": {"branch": BRANCHES[w], "chinese": BRANCHES_CN[w],
                       "stage": cn, "stage_name": en, "verdict": verdict,
                       "favourable": good},
        "judgement": ("the water exits on a supporting stage — the frame holds" if good else
                      "the water exits on a damaging stage — the classical San He fault, "
                      "and no amount of Flying Star favour repairs it"),
        "celestial_animals": {k: {"chinese": v[0], "requirement": v[1]}
                              for k, v in CELESTIAL_ANIMALS.items()},
        "school_note": ("San He reads FORM and WATER; Xuan Kong reads TIME. A site the two "
                        "schools judge differently is a genuine disagreement between "
                        "traditions, not an error to be averaged away."),
    }
    if landform:
        faults = []
        if landform.get("white_tiger") == "higher":
            faults.append("the tiger overtops the dragon — 白虎抬頭, the classical fault")
        if landform.get("black_tortoise") in ("broken", "absent", "low"):
            faults.append("the rear support is broken — no backing, and the site cannot hold")
        if landform.get("vermilion_bird") in ("blocked", "obstructed"):
            faults.append("the front is obstructed — the bright hall is closed")
        out["landform_faults"] = faults or ["no classical landform fault reported"]
    return out


assert len(GUOLAO_HOUSES) == 12 and len(GUOLAO_BODIES) == 11
assert len(_SIDEREAL_SIGNS) == 12 and len(TWELVE_STAGES) == 12
assert sum(len(v["branches"]) for v in SANHE_TRINITIES.values()) == 12
assert len({b for v in SANHE_TRINITIES.values() for b in v["branches"]}) == 12, \
    "the four trinities must partition the twelve branches"
assert all(v["birth"] in v["branches"] for v in SANHE_TRINITIES.values())
assert len(CELESTIAL_ANIMALS) == 4
