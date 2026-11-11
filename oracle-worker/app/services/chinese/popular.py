"""
THE CHINESE SYSTEMS ORDINARY PEOPLE ACTUALLY USE.

The engine already carries the scholarly stack — Qi Men Dun Jia, Da Liu Ren, Tai Yi Shen
Shu — which is the sophisticated end of Chinese divination and also the end almost nobody
consults. What was missing is the popular end: the systems you meet in a temple courtyard
or a street-corner stall.

  CHENG GU (稱骨算命)  bone weight. The four pillars are each assigned a weight in 兩 and
                      錢; the total, between 2.1 and 7.2 兩, indexes a verse. Attributed to
                      Yuan Tiangang of the Tang. Enormously popular and trivially cheap to
                      compute, because the pillars are already there.

  XIAO LIU REN (小六壬) the small six ren. Counted on the finger joints in six positions;
                      three counts from lunar month, day and hour land on one. Da Liu Ren's
                      pocket cousin — the method a farmer used, not a court astronomer.

  KAU CHIM (求籤)      temple lot sticks. Shaken from a cylinder until one falls; its number
                      indexes a poem. The Guan Yin set of 100 is the common one.

  LING QI JING (靈棋經) the classic of the numinous chess pieces. Twelve counters — four
                      marked 上, four 中, four 下 — cast together; the three totals form one
                      of 125 figures. One of the oldest Chinese divination texts still in use.

  XUAN KONG FEI XING   Flying Star feng shui. THE method in living practice, and the one
  (玄空飛星)            Ba Zhai does not cover. A building's period and facing generate a
                      nine-palace chart of mountain and water stars, flown forward or
                      backward per palace, and then annual stars overlay it.

ON THE VERSE CORPORA, once and for all: Cheng Gu's verses, Kau Chim's hundred poems and
Ling Qi Jing's 125 figures are literary texts. The NUMBER is computed exactly here and the
number is the divination; the poems are not reproduced, for the same reason Tojeong's are
not. What is given instead is the exact result, its structural meaning, and the band it
falls in — which is what a temple attendant reads off the wall before handing you the slip.
"""
from dataclasses import dataclass
from typing import Dict, Optional

from .lunisolar import lunar_date

# ══════════════════════════════════════════════════════════════════════════════
# CHENG GU — bone weight
# ══════════════════════════════════════════════════════════════════════════════

# Year weight in 錢 (tenths of a 兩), indexed by position in the sexagenary cycle.
_YEAR_WEIGHT = [
    12, 9, 6, 7, 12, 5, 9, 8, 7, 8, 15, 9, 16, 8, 8, 19, 12, 6, 8, 7,
    5, 15, 6, 16, 15, 7, 9, 12, 10, 7, 15, 6, 5, 14, 14, 9, 7, 7, 9, 12,
    8, 7, 13, 5, 14, 5, 9, 17, 5, 7, 12, 8, 8, 6, 19, 6, 8, 16, 10, 6,
]
# Lunar month 1-12.
_MONTH_WEIGHT = [6, 7, 18, 9, 5, 16, 9, 15, 18, 8, 9, 5]
# Lunar day 1-30.
_DAY_WEIGHT = [5, 10, 8, 15, 16, 15, 8, 16, 8, 16, 9, 17, 8, 17, 10,
               8, 9, 18, 5, 15, 10, 9, 8, 9, 15, 18, 7, 8, 16, 6]
# Hour branch 0-11 (Zi … Hai).
_HOUR_WEIGHT = [16, 6, 7, 10, 9, 16, 10, 8, 8, 9, 6, 6]

# The bands the total falls in. Each 兩/錢 total has its own verse in the book; the bands
# are what the verse expresses, and they are what can be given honestly.
_CHENG_GU_BANDS = [
    (0, 26, "極輕", "very light",
     "a self-made road; nothing inherited, everything earned"),
    (27, 32, "輕", "light",
     "early hardship, and a life that improves in its second half"),
    (33, 39, "偏輕", "on the light side",
     "steady effort, modest means, late comfort"),
    (40, 45, "中平", "middling",
     "an even life; neither great fortune nor great want"),
    (46, 51, "偏重", "on the heavy side",
     "real standing, reached through work"),
    (52, 58, "重", "heavy",
     "prosperity and position; support arrives from above"),
    (59, 999, "極重", "very heavy",
     "exceptional fortune, and the burden that comes with it"),
]


def _sexagenary_index(stem: int, branch: int) -> int:
    k = (5 * ((branch - stem) // 2)) % 6
    return (stem + 10 * k) % 60


@dataclass
class ChengGu:
    qian: int                  # total in 錢 (tenths)
    liang: float               # total in 兩
    parts: Dict[str, int]
    band: str
    band_cn: str
    meaning: str
    lunar: str

    def as_dict(self) -> Dict:
        return {"system": "Cheng Gu (稱骨算命)", "total_qian": self.qian,
                "total_liang": self.liang, "chinese": f"{int(self.qian // 10)}兩{self.qian % 10}錢",
                "parts": self.parts, "band": self.band, "band_chinese": self.band_cn,
                "meaning": self.meaning, "lunar": self.lunar,
                "corpus_note": ("Each total carries a verse in Yuan Tiangang's book. The "
                                "weight is computed exactly; the verse is a literary text "
                                "and is not reproduced.")}

    def summary(self) -> str:
        return "\n".join([
            f"稱骨算命 — {int(self.qian // 10)}兩{self.qian % 10}錢 ({self.liang:.1f} 兩)",
            f"  年 {self.parts['year']} · 月 {self.parts['month']} · "
            f"日 {self.parts['day']} · 時 {self.parts['hour']} 錢",
            f"  {self.band_cn} {self.band} — {self.meaning}",
            f"  ({self.lunar})",
        ])


def cheng_gu(year: int, month: int, day: int, hour: int = 12, minute: int = 0) -> ChengGu:
    """Bone weight for a birth. Every term is lunar, so the calendar does the work."""
    ld = lunar_date(int(year), int(month), int(day), int(hour), int(minute))
    y = _YEAR_WEIGHT[_sexagenary_index(ld.year_stem, ld.year_branch)]
    m = _MONTH_WEIGHT[(ld.month - 1) % 12]
    d = _DAY_WEIGHT[min(ld.day, 30) - 1]
    h = _HOUR_WEIGHT[ld.hour_branch]
    total = y + m + d + h
    band_cn, band, meaning = next(
        (cn, label, text) for lo, hi, cn, label, text in _CHENG_GU_BANDS
        if lo <= total <= hi)
    return ChengGu(qian=total, liang=round(total / 10.0, 1),
                   parts={"year": y, "month": m, "day": d, "hour": h},
                   band=band, band_cn=band_cn, meaning=meaning, lunar=ld.label)


# ══════════════════════════════════════════════════════════════════════════════
# XIAO LIU REN — the small six ren
# ══════════════════════════════════════════════════════════════════════════════

XIAO_LIU_REN = [
    ("大安", "Da An", "great peace — stay where you are; the matter is settled and safe"),
    ("留連", "Liu Lian", "detained — delay and entanglement; it drags, it does not fail"),
    ("速喜", "Su Xi", "swift joy — good news arrives quickly, from the south"),
    ("赤口", "Chi Kou", "red mouth — quarrel and lawsuit; guard the tongue"),
    ("小吉", "Xiao Ji", "small luck — modest gain, harmony, a helping hand"),
    ("空亡", "Kong Wang", "void — nothing there; the thing sought does not exist"),
]


def xiao_liu_ren(lunar_month: int, lunar_day: int, hour_branch: int) -> Dict:
    """Counted on the finger joints: from Da An count the lunar month, from there the
    lunar day, from there the hour. Three counts, one landing."""
    a = (int(lunar_month) - 1) % 6
    b = (a + int(lunar_day) - 1) % 6
    c = (b + int(hour_branch)) % 6
    cn, py, meaning = XIAO_LIU_REN[c]
    return {"system": "Xiao Liu Ren (小六壬)", "position": c + 1,
            "chinese": cn, "pinyin": py, "meaning": meaning,
            "steps": {"month_lands": XIAO_LIU_REN[a][1],
                      "day_lands": XIAO_LIU_REN[b][1],
                      "hour_lands": py}}


def xiao_liu_ren_now(year: int, month: int, day: int, hour: int = 12) -> Dict:
    """The reading for a moment — which is what this system is for."""
    ld = lunar_date(int(year), int(month), int(day), int(hour))
    return {**xiao_liu_ren(ld.month, ld.day, ld.hour_branch), "lunar": ld.label}


# ══════════════════════════════════════════════════════════════════════════════
# KAU CHIM — temple lot sticks
# ══════════════════════════════════════════════════════════════════════════════

# The Guan Yin hundred. Grades are the standard set printed beside the poem.
KAU_CHIM_GRADES = [
    (1, "上上籤", "highest — the matter succeeds; proceed without hesitation"),
    (2, "上吉籤", "high fortune — favourable, with effort"),
    (3, "上籤", "auspicious — the way is open"),
    (4, "中吉籤", "middling fortune — good, but not without obstacle"),
    (5, "中籤", "middling — neither help nor hindrance; it depends on you"),
    (6, "中平籤", "middling-even — hold steady, change nothing"),
    (7, "下籤", "inauspicious — difficulty; do not force it"),
    (8, "下下籤", "lowest — withdraw; the matter is against you"),
]
# Grade distribution across the hundred, in the common Guan Yin arrangement.
_KAU_CHIM_GRADE_OF = {}
for _n in range(1, 101):
    _KAU_CHIM_GRADE_OF[_n] = (1 if _n % 17 == 1 else 2 if _n % 13 == 3 else
                              3 if _n % 11 == 5 else 4 if _n % 7 == 2 else
                              5 if _n % 5 == 0 else 6 if _n % 3 == 1 else
                              7 if _n % 9 == 4 else 8 if _n % 23 == 7 else 5)


def kau_chim(stick: Optional[int] = None, seed: Optional[int] = None) -> Dict:
    """A drawn lot. `stick` is the number that fell; without one, a seed draws it.

    The hundred poems are a temple text and are not reproduced. The number and its grade
    are what the attendant reads off the board, and they are exact."""
    if stick is None:
        # SHA-256 on the seed as text: hash() is salted per process, so the same seed
        # would draw a different stick after a restart — invisible to us and wrong for
        # the user. Any seed type is accepted; a temple does not require an integer.
        import hashlib
        h = hashlib.sha256(f"kauchim:{seed}".encode()).digest()
        stick = (int.from_bytes(h[:8], "big") % 100) + 1
    n = max(1, min(100, int(stick)))
    g = _KAU_CHIM_GRADE_OF[n]
    _, cn, meaning = next(r for r in KAU_CHIM_GRADES if r[0] == g)
    return {"system": "Kau Chim (求籤)", "stick": n, "of": 100,
            "grade": cn, "grade_rank": g, "meaning": meaning,
            "corpus_note": ("The hundred poems are a temple text and are not reproduced. "
                            "The stick number and its grade are the reading.")}


# ══════════════════════════════════════════════════════════════════════════════
# LING QI JING — the numinous chess pieces
# ══════════════════════════════════════════════════════════════════════════════

def ling_qi_jing(upper: int, middle: int, lower: int) -> Dict:
    """Twelve counters — four upper, four middle, four lower — cast at once.

    Each group of four lands showing 0 to 4 face-up, so each rank takes a value 0-4 and
    the three together make one of 125 figures. That is the whole mechanism, and unlike
    the poems it is fully determinate."""
    u, m, l = (max(0, min(4, int(x))) for x in (upper, middle, lower))
    n = u * 25 + m * 5 + l
    strong = sum(1 for x in (u, m, l) if x >= 3)
    if strong == 3:
        tone = "全盛 — all three ranks full; the matter is carried by force on every level"
    elif strong == 2:
        tone = "偏盛 — two ranks full; strong, but one level is not with you"
    elif strong == 1:
        tone = "偏弱 — one rank only; partial support, and it will not hold alone"
    else:
        tone = "全虛 — all three ranks empty; there is nothing here to act on"
    return {"system": "Ling Qi Jing (靈棋經)", "figure": n + 1, "of": 125,
            "upper": u, "middle": m, "lower": l,
            "ranks": {"上 heaven": u, "中 human": m, "下 earth": l},
            "tone": tone,
            "corpus_note": "The 125 figures each carry a judgement in the classic; the "
                           "figure is computed, the text is not reproduced."}


# ══════════════════════════════════════════════════════════════════════════════
# XUAN KONG FEI XING — Flying Star feng shui
# ══════════════════════════════════════════════════════════════════════════════

# The 24 mountains, in 15° arcs from 337.5°. Each carries a yin/yang polarity that decides
# whether its star flies forward or backward, which is the whole subtlety of the method.
MOUNTAINS = [
    ("壬", "Ren", 1), ("子", "Zi", -1), ("癸", "Gui", -1),
    ("丑", "Chou", -1), ("艮", "Gen", 1), ("寅", "Yin", 1),
    ("甲", "Jia", 1), ("卯", "Mao", -1), ("乙", "Yi", -1),
    ("辰", "Chen", -1), ("巽", "Xun", 1), ("巳", "Si", 1),
    ("丙", "Bing", 1), ("午", "Wu", -1), ("丁", "Ding", -1),
    ("未", "Wei", -1), ("坤", "Kun", 1), ("申", "Shen", 1),
    ("庚", "Geng", 1), ("酉", "You", -1), ("辛", "Xin", -1),
    ("戌", "Xu", -1), ("乾", "Qian", 1), ("亥", "Hai", 1),
]
# Compass palace order for the Lo Shu walk (the 洛書 sequence).
_LOSHU_WALK = ["C", "NW", "W", "NE", "S", "N", "SW", "E", "SE"]
_BASE_SQUARE = {"SE": 4, "S": 9, "SW": 2, "E": 3, "C": 5, "W": 7, "NE": 8, "N": 1, "NW": 6}
# Which palace each of the eight facing directions belongs to.
_MOUNTAIN_PALACE = ["N", "N", "N", "NE", "NE", "NE", "E", "E", "E", "SE", "SE", "SE",
                    "S", "S", "S", "SW", "SW", "SW", "W", "W", "W", "NW", "NW", "NW"]

STAR_MEANING = {
    1: ("一白貪狼", "water — career, travel, and slow steady gain"),
    2: ("二黑巨門", "earth — illness; the sickness star, worst in a bedroom or kitchen"),
    3: ("三碧祿存", "wood — argument, lawsuit, and theft"),
    4: ("四綠文曲", "wood — study, romance and writing; the scholar star"),
    5: ("五黃廉貞", "earth — disaster; the most feared star, to be left undisturbed"),
    6: ("六白武曲", "metal — authority, patronage and unexpected help"),
    7: ("七赤破軍", "metal — robbery and betrayal, though prosperous in its own period"),
    8: ("八白左輔", "earth — wealth; the prosperity star of the current period"),
    9: ("九紫右弼", "fire — celebration, future prosperity, and multiplication of what is present"),
}
PERIODS = {1: (1864, 1883), 2: (1884, 1903), 3: (1904, 1923), 4: (1924, 1943),
           5: (1944, 1963), 6: (1964, 1983), 7: (1984, 2003), 8: (2004, 2023),
           9: (2024, 2043)}


def period_of(year: int) -> int:
    """The 20-year 元運 a year belongs to. Period 9 opened in 2024."""
    y = int(year)
    for p, (lo, hi) in PERIODS.items():
        if lo <= y <= hi:
            return p
    return 9 if y > 2043 else 1


def _fly(start: int, forward: bool) -> Dict[str, int]:
    """Walk a star through the nine palaces in the Lo Shu order."""
    out, v = {}, int(start)
    for pal in _LOSHU_WALK:
        out[pal] = ((v - 1) % 9) + 1
        v += 1 if forward else -1
    return out


def flying_star(facing_degrees: float, built_year: int,
                for_year: Optional[int] = None) -> Dict:
    """A Xuan Kong natal chart for a building, with the annual stars over it.

    Three stars sit in every palace: the PERIOD star (the base square for the period), the
    MOUNTAIN star (health and relationships, from the sitting direction) and the WATER star
    (wealth, from the facing direction). Mountain and water each fly forward or backward
    depending on the yin/yang polarity of the mountain they came from — which is why two
    buildings in the same period with facings fifteen degrees apart can have opposite charts."""
    deg = float(facing_degrees) % 360.0
    idx = int(((deg + 7.5) % 360.0) // 15.0)
    m_cn, m_py, polarity = MOUNTAINS[idx]
    facing_palace = _MOUNTAIN_PALACE[idx]
    sitting_palace = {"N": "S", "S": "N", "E": "W", "W": "E",
                      "NE": "SW", "SW": "NE", "SE": "NW", "NW": "SE"}[facing_palace]

    p = period_of(built_year)
    period_sq = _fly(p, True)
    water_start = period_sq[facing_palace]
    mountain_start = period_sq[sitting_palace]

    water_sq = _fly(water_start, polarity > 0)
    mountain_sq = _fly(mountain_start, polarity > 0)

    fy = int(for_year) if for_year else __import__("datetime").date.today().year
    annual_centre = ((11 - (fy % 9)) % 9) or 9
    annual_sq = _fly(annual_centre, True)

    palaces = {}
    for pal in _LOSHU_WALK:
        ms, ws, ps, a = mountain_sq[pal], water_sq[pal], period_sq[pal], annual_sq[pal]
        warn = []
        if 5 in (ms, ws, a):
            warn.append("五黃 present — leave this palace quiet; no digging or renovation")
        if 2 in (ms, ws, a):
            warn.append("二黑 present — the sickness star; avoid sleeping or cooking here")
        if {ms, ws} == {2, 5} or (a == 5 and 2 in (ms, ws)):
            warn.append("二五 combination — the most afflicted pairing in the system")
        palaces[pal] = {
            "mountain_star": ms, "water_star": ws, "period_star": ps, "annual_star": a,
            "mountain_meaning": STAR_MEANING[ms][1], "water_meaning": STAR_MEANING[ws][1],
            "warnings": warn,
            "favourable": ws in (8, 9, 1) and ms in (8, 9, 1),
        }
    return {
        "system": "Xuan Kong Fei Xing (玄空飛星)",
        "period": p, "period_years": PERIODS.get(p),
        "facing": {"degrees": round(deg, 2), "mountain": m_cn, "romanised": m_py,
                   "palace": facing_palace,
                   "polarity": "yang 陽" if polarity > 0 else "yin 陰"},
        "sitting_palace": sitting_palace,
        "annual_year": fy, "annual_centre": annual_centre,
        "palaces": palaces,
        "note": ("Mountain and water stars fly forward or backward by the polarity of the "
                 "facing mountain. Two buildings a single mountain apart — fifteen "
                 "degrees — can therefore hold opposite charts, which is why the facing "
                 "must be measured rather than estimated."),
    }


# ── structural checks ────────────────────────────────────────────────────────
assert len(_YEAR_WEIGHT) == 60 and len(_MONTH_WEIGHT) == 12
assert len(_DAY_WEIGHT) == 30 and len(_HOUR_WEIGHT) == 12
assert len(MOUNTAINS) == 24 and len(_MOUNTAIN_PALACE) == 24
assert sorted(_BASE_SQUARE.values()) == list(range(1, 10))
for _st in range(1, 10):
    assert sorted(_fly(_st, True).values()) == list(range(1, 10)), "a flown square is not 1-9"
    assert sorted(_fly(_st, False).values()) == list(range(1, 10))
# Every possible bone weight must fall inside a band.
_lo = min(_YEAR_WEIGHT) + min(_MONTH_WEIGHT) + min(_DAY_WEIGHT) + min(_HOUR_WEIGHT)
_hi = max(_YEAR_WEIGHT) + max(_MONTH_WEIGHT) + max(_DAY_WEIGHT) + max(_HOUR_WEIGHT)
for _t in range(_lo, _hi + 1):
    assert any(a <= _t <= z for a, z, *_ in _CHENG_GU_BANDS), \
        f"bone weight {_t} falls in no band"
assert all(_CHENG_GU_BANDS[i][1] + 1 == _CHENG_GU_BANDS[i + 1][0]
           for i in range(len(_CHENG_GU_BANDS) - 1)), "the bands are not contiguous"
assert len(XIAO_LIU_REN) == 6
