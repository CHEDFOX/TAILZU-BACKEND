"""
TAI YI SHEN SHU (太乙神數) — the third of the Three Styles.

Where Qi Men reads a moment and Da Liu Ren reads a question, Tai Yi reads an ERA. It is a
mundane system: its subject is the state, the campaign, the flood and the dynasty, and its
unit of movement is years rather than hours. Historically it was the most restricted of
the three — possession of Tai Yi texts was periodically a criminal matter, on the reasoning
that a method for predicting the fall of governments is of interest chiefly to people
planning one.

A SHORTER MODULE THAN THE OTHER TWO, DELIBERATELY
─────────────────────────────────────────────────
Tai Yi is the least well transmitted of the Three Styles. The 十六神 positions and the
host/guest architecture are stable across sources. Almost everything downstream is not:

  • The 積年 epoch differs between the 太乙金鏡式經 and later compilations, by margins
    large enough to change which palace Tai Yi occupies in a given year.
  • The rules for 計神, 始擊 and the 三基/五福 apparatus vary by lineage.
  • Several surviving texts are partial, and reconstructions disagree about the gaps.

So this module computes the part that is well attested — the sixteen positions, Tai Yi's
movement through the eight palaces at three years each, and the host/guest structure — and
declines the rest rather than inventing a resolution. `epoch_year` is a REQUIRED, explicit
parameter for exactly that reason: the caller states which reckoning they are using, and
the chart carries it, so two charts from different traditions can never be silently
compared.
"""
from typing import Dict, List

BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"]

# ─── 十六神 — the sixteen divine positions ────────────────────────────────
# Twelve branches interleaved with the four corner trigrams, running clockwise from 子
# (north). These are stable across the surviving sources.
SIXTEEN = [
    ("子", "地主", "Earth Lord — the ground itself, the populace"),
    ("丑", "陽德", "Yang Virtue — open beneficence, visible merit"),
    ("艮", "和德", "Harmonised Virtue — reconciliation, the treaty"),
    ("寅", "呂申", "Lü Shen — repetition, the returning matter"),
    ("卯", "高叢", "High Thicket — density, obstruction, the crowd"),
    ("辰", "太陽", "Great Yang — the sovereign, full exposure"),
    ("巽", "大炅", "Great Brightness — clarity, revelation, the signal"),
    ("巳", "大神", "Great Spirit — the numinous, what exceeds calculation"),
    ("午", "大威", "Great Awe — force displayed, the army in the field"),
    ("未", "天道", "Heaven's Way — the course events take of themselves"),
    ("坤", "大武", "Great Martial — the campaign, decisive violence"),
    ("申", "武德", "Martial Virtue — disciplined force, the just war"),
    ("酉", "太簇", "Tai Cu — gathering, assembly, the muster"),
    ("戌", "陰主", "Yin Lord — the hidden power, the minister behind the throne"),
    ("乾", "陰德", "Yin Virtue — unseen merit, benefit that is not announced"),
    ("亥", "大義", "Great Rightness — principle, the cause held to be just"),
]

# ─── The eight palaces Tai Yi occupies ────────────────────────────────────
# Tai Yi does not enter the centre. It rests three years in each of the eight, so a full
# circuit is twenty-four years and three circuits make one 紀 of seventy-two.
PALACE_ORDER = [1, 8, 3, 4, 9, 2, 7, 6]          # Luo Shu, clockwise from north
PALACE_NAMES = {1: "坎 N", 2: "坤 SW", 3: "震 E", 4: "巽 SE",
                6: "乾 NW", 7: "兌 W", 8: "艮 NE", 9: "離 S"}

YEARS_PER_PALACE = 3
CIRCUIT_YEARS = YEARS_PER_PALACE * len(PALACE_ORDER)     # 24
JI_YEARS = CIRCUIT_YEARS * 3                             # 72 — one 紀

# ─── Host and guest ───────────────────────────────────────────────────────
# The defining structure of Tai Yi: every situation has a 主 (host — the established
# party, the defender, the incumbent) and a 客 (guest — the arriving party, the attacker,
# the challenger). The method's characteristic judgement is which of the two the
# configuration favours, which is why it was a military and dynastic instrument.
ROLES = {
    "host": ("主", "the established party — defender, incumbent, the one already in place"),
    "guest": ("客", "the arriving party — attacker, challenger, the one making the move"),
}


def accumulated_years(year: int, epoch_year: int) -> int:
    """Years elapsed since the stated epoch. Negative before it.

    `epoch_year` is required and not defaulted: the surviving texts do not agree on the
    epoch, and a silent default would let two incompatible reckonings be compared as
    though they were the same."""
    return int(year) - int(epoch_year)


def taiyi_palace(year: int, epoch_year: int) -> Dict:
    """Which palace Tai Yi occupies, and where it is in its cycles."""
    acc = accumulated_years(year, epoch_year)
    step = (acc // YEARS_PER_PALACE) % len(PALACE_ORDER)
    palace = PALACE_ORDER[step]
    return {
        "accumulated_years": acc,
        "palace": palace,
        "palace_name": PALACE_NAMES[palace],
        "year_in_palace": (acc % YEARS_PER_PALACE) + 1,
        "circuit": (acc // CIRCUIT_YEARS) + 1,
        "year_in_ji": (acc % JI_YEARS) + 1,
        "ji": (acc // JI_YEARS) + 1,
    }


def _calc(acc: int, offset: int) -> Dict:
    """A 算 (calculation) — host or guest — reduced into the sixteen positions.

    The host reckons from the accumulated year directly; the guest from it displaced.
    Both are read as a position among the sixteen and as a remainder, since a calculation
    that divides evenly is read differently from one that does not."""
    n = acc + offset
    pos = n % len(SIXTEEN)
    branch, name, gloss = SIXTEEN[pos]
    return {"value": n, "position_index": pos, "position": branch,
            "name": name, "meaning": gloss,
            "divides_evenly": n % len(SIXTEEN) == 0}


def chart(year: int, epoch_year: int, guest_offset: int = 1) -> Dict:
    """A Tai Yi chart for a year.

    `guest_offset` is exposed rather than fixed because the displacement between host and
    guest reckonings is one of the points on which sources differ."""
    ty = taiyi_palace(year, epoch_year)
    acc = ty["accumulated_years"]
    host = _calc(acc, 0)
    guest = _calc(acc, guest_offset)

    # The characteristic judgement: which party the configuration favours. Read from
    # whether host and guest fall in the same half of the sixteen, and which is nearer
    # Tai Yi's own position.
    same_half = (host["position_index"] < 8) == (guest["position_index"] < 8)
    dist_h = min((host["position_index"] - PALACE_ORDER.index(ty["palace"])) % 16,
                 (PALACE_ORDER.index(ty["palace"]) - host["position_index"]) % 16)
    dist_g = min((guest["position_index"] - PALACE_ORDER.index(ty["palace"])) % 16,
                 (PALACE_ORDER.index(ty["palace"]) - guest["position_index"]) % 16)

    if dist_h < dist_g:
        favoured, why = "host", "the host's reckoning stands nearer Tai Yi's palace"
    elif dist_g < dist_h:
        favoured, why = "guest", "the guest's reckoning stands nearer Tai Yi's palace"
    else:
        favoured, why = "neither", "host and guest stand equidistant — the matter is undecided"

    return {
        "year": int(year), "epoch_year": int(epoch_year),
        "taiyi": ty,
        "host": {**host, "role": ROLES["host"][1], "mark": ROLES["host"][0]},
        "guest": {**guest, "role": ROLES["guest"][1], "mark": ROLES["guest"][0]},
        "same_half": same_half,
        "favoured": favoured,
        "favoured_reason": why,
        "scope": "mundane — states, campaigns, eras. Not a personal reading.",
        "caveats": [
            "The 積年 epoch differs between the 太乙金鏡式經 and later compilations; this "
            "chart is valid only against the epoch given, which is recorded above.",
            "The 計神, 始擊 and 三基/五福 apparatus varies by lineage and is not computed "
            "here.",
            "Tai Yi is a MUNDANE method. Applying it to an individual is a category error "
            "the tradition itself does not make.",
        ],
    }


def sixteen_positions() -> List[Dict]:
    return [{"branch": b, "name": n, "meaning": g} for b, n, g in SIXTEEN]


def summary(c: Dict) -> str:
    if not c:
        return ""
    ty = c["taiyi"]
    return "\n".join([
        f"TAI YI SHEN SHU — year {c['year']} (epoch {c['epoch_year']}, "
        f"accumulated {ty['accumulated_years']})",
        f"  太乙 in {ty['palace_name']}, year {ty['year_in_palace']} of 3 · "
        f"circuit {ty['circuit']} · 紀 {ty['ji']}, year {ty['year_in_ji']} of 72",
        f"  主 host  {c['host']['position']} {c['host']['name']} — {c['host']['meaning']}",
        f"  客 guest {c['guest']['position']} {c['guest']['name']} — {c['guest']['meaning']}",
        f"  favours: {c['favoured']} ({c['favoured_reason']})",
        f"  {c['scope']}",
    ])
