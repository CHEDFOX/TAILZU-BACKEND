"""
SAJU PALJA (사주팔자) — Korean four-pillar astrology.

Not BaZi with Korean labels on it. Korea received the four-pillar method and then spent
six centuries developing it in its own direction, and three of those differences change
the CHART rather than the vocabulary:

  1. THE CLOCK IS WRONG, AND KOREAN PRACTICE CORRECTS IT.
     Korea keeps UTC+9, which is the meridian of 135°E — a line that runs through Japan,
     not Korea. Seoul sits at 126.98°E, about eight degrees west, so Korean clock time
     runs roughly 32 minutes ahead of true solar time. Since the hour pillar turns on
     two-hour boundaries, any birth within half an hour of an odd hour is in the WRONG
     PILLAR unless corrected, and the hour pillar is a quarter of the chart. Korean
     practitioners apply this correction as a matter of course; Chinese BaZi software
     does not, because for China it does not arise.

  2. THE OFFSET HAS CHANGED FIVE TIMES.
     Korea has used UTC+8:30 twice — 1908-1912 and 1954-1961 — and UTC+9 otherwise, with
     daylight saving in scattered years. A birth in 1957 corrected as though the country
     were on UTC+9 lands thirty minutes out on top of the longitude error. The full
     history is applied here rather than assumed away.

  3. GYEOKGUK (격국) IS THE ORGANISING IDEA.
     Korean practice reads the chart through its STRUCTURE — which of the ten gods the
     month branch's principal qi makes — and treats that as the frame everything else
     hangs on. Chinese practice weights the useful god (용신/用神) more and the pattern
     less. Same data, genuinely different reading order, and a Saju reading that does not
     name the gyeokguk is not recognisably Saju.

The ten gods, the twelve life stages and the pattern names are given in Korean because
that is the tradition being computed. Where a term is shared with the Chinese source the
hanja is shown too, so nothing pretends to be more separate than it is.
"""
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from app.services.chinese.lunisolar import (
    BRANCHES, BRANCHES_CN, STEMS, STEMS_CN, gregorian_to_jd, lunar_date, solar_longitude,
)

SEOUL_LONGITUDE = 126.978

# Korean standard time, as actually legislated. (start_year, start_month, start_day, offset_hours)
_KST_HISTORY = [
    (1908, 4, 1, 8.5),      # Korean Empire adopts UTC+8:30
    (1912, 1, 1, 9.0),      # Japanese colonial administration moves to UTC+9
    (1954, 3, 21, 8.5),     # Republic of Korea restores UTC+8:30
    (1961, 8, 10, 9.0),     # returned to UTC+9, and unchanged since
]

STEM_ELEMENT = ["Wood", "Wood", "Fire", "Fire", "Earth", "Earth",
                "Metal", "Metal", "Water", "Water"]
ELEMENT_KO = {"Wood": "목(木)", "Fire": "화(火)", "Earth": "토(土)",
              "Metal": "금(金)", "Water": "수(水)"}
STEMS_KO = ["갑", "을", "병", "정", "무", "기", "경", "신", "임", "계"]
BRANCHES_KO = ["자", "축", "인", "묘", "진", "사", "오", "미", "신", "유", "술", "해"]

_PRODUCES = {"Wood": "Fire", "Fire": "Earth", "Earth": "Metal",
             "Metal": "Water", "Water": "Wood"}
_CONTROLS = {"Wood": "Earth", "Earth": "Water", "Water": "Fire",
             "Fire": "Metal", "Metal": "Wood"}

# 지장간 — the hidden stems of each branch, principal qi (본기) LAST.
HIDDEN_STEMS = {
    0: [8, 9], 1: [9, 7, 5], 2: [4, 2, 0], 3: [0, 1], 4: [1, 9, 4], 5: [4, 6, 2],
    6: [2, 5, 3], 7: [3, 1, 5], 8: [4, 8, 6], 9: [6, 7], 10: [7, 3, 4], 11: [4, 0, 8],
}

# 십성 — the ten gods, in Korean.
TEN_GODS = {
    "bigyeon": ("비견", "比肩", "the peer — equals, rivals, and the self reflected back"),
    "geopjae": ("겁재", "劫財", "the robber of wealth — competition that costs, and reckless allies"),
    "siksin": ("식신", "食神", "the eating god — output, appetite, craft, and quiet productivity"),
    "sanggwan": ("상관", "傷官", "the hurting officer — brilliance that will not obey; talent against authority"),
    "pyeonjae": ("편재", "偏財", "indirect wealth — money in motion, opportunity, the father, risk"),
    "jeongjae": ("정재", "正財", "direct wealth — earned income, the wife, what is held and counted"),
    "pyeongwan": ("편관", "偏官", "the seven killings — pressure, discipline imposed, danger and command"),
    "jeonggwan": ("정관", "正官", "the direct officer — legitimate authority, office, the husband, rules"),
    "pyeonin": ("편인", "偏印", "indirect resource — unorthodox learning, intuition, the stepmother"),
    "jeongin": ("정인", "正印", "direct resource — orthodox learning, protection, the mother"),
}

# 십이운성 — the twelve stages of the life cycle.
LIFE_STAGES = [
    ("장생", "長生", "birth — fresh, hopeful, still unformed"),
    ("목욕", "沐浴", "bathing — exposed, unstable, prone to indulgence"),
    ("관대", "冠帶", "the cap and sash — coming of age, ambition outrunning skill"),
    ("건록", "建祿", "the salary — competence and independence; standing on one's own"),
    ("제왕", "帝旺", "the emperor — the peak, and the arrogance that lives there"),
    ("쇠", "衰", "decline — the first ebb; wisdom arrives as force leaves"),
    ("병", "病", "illness — vulnerability, sensitivity, sympathy for others"),
    ("사", "死", "death — stillness, thought, the end of striving"),
    ("묘", "墓", "the tomb — storage, inheritance, what is buried and kept"),
    ("절", "絕", "severance — the lowest point, cut off, and therefore free"),
    ("태", "胎", "conception — the unseen beginning, potential without form"),
    ("양", "養", "nurture — sheltered growth before emergence"),
]
# 장생 branch and direction per day stem: yang stems run forward, yin stems backward.
_STAGE_START = {0: (11, 1), 1: (6, -1), 2: (2, 1), 3: (9, -1), 4: (2, 1),
                5: (9, -1), 6: (5, 1), 7: (0, -1), 8: (8, 1), 9: (3, -1)}

GYEOKGUK_SPECIAL = {
    "geonrok": ("건록격", "建祿格", "the salary structure — the month holds your own element in "
                "its own polarity. Self-made, independent, and poorly suited to being managed"),
    "yangin": ("양인격", "羊刃格", "the blade structure — your own element at its most extreme. "
               "Great force, and a sharpness that cuts the holder as readily as anyone else"),
}


def korean_utc_offset(year: int, month: int, day: int) -> float:
    """The legal Korean clock offset on a date."""
    d = (int(year), int(month), int(day))
    off = 8.5 if d < (1908, 4, 1) else 9.0
    for y, m, dd, o in _KST_HISTORY:
        if d >= (y, m, dd):
            off = o
    return off


def true_solar_time(year: int, month: int, day: int, hour: int, minute: int,
                    longitude: float = SEOUL_LONGITUDE) -> Dict:
    """Clock time corrected to true local solar time.

    Two corrections. The longitude term compares the birthplace to the meridian the clock
    is actually keeping. The equation of time is the Sun's own irregularity, worth up to
    about sixteen minutes; Korean practice includes it, and near an hour boundary it
    decides the pillar on its own."""
    off = korean_utc_offset(year, month, day)
    meridian = off * 15.0
    lon_minutes = (float(longitude) - meridian) * 4.0

    # Equation of time, in minutes, from the standard low-precision series.
    import math
    jd = gregorian_to_jd(year, month, day, float(hour) + float(minute) / 60.0 - off)
    n = jd - 2451545.0
    g = math.radians((357.528 + 0.9856003 * n) % 360.0)
    lam = math.radians((280.47 + 0.9856003 * n) % 360.0)
    eot = (-7.655 * math.sin(g) + 9.873 * math.sin(2 * lam + 3.588))

    total = lon_minutes + eot
    raw = int(hour) * 60 + int(minute) + total
    corrected_h = int(raw // 60) % 24
    day_shift = int(raw // 60) // 24
    return {"clock_offset": off, "longitude_minutes": round(lon_minutes, 2),
            "equation_of_time_minutes": round(eot, 2),
            "total_correction_minutes": round(total, 2),
            "corrected_hour": corrected_h, "corrected_minute": int(raw % 60),
            "day_shift": day_shift}


def _ten_god(day_stem: int, other: int) -> str:
    de, oe = STEM_ELEMENT[day_stem], STEM_ELEMENT[other]
    same_pol = (day_stem % 2) == (other % 2)
    if de == oe:
        return "bigyeon" if same_pol else "geopjae"
    if _PRODUCES[de] == oe:
        return "siksin" if same_pol else "sanggwan"
    if _CONTROLS[de] == oe:
        return "pyeonjae" if same_pol else "jeongjae"
    if _CONTROLS[oe] == de:
        return "pyeongwan" if same_pol else "jeonggwan"
    return "pyeonin" if same_pol else "jeongin"


def _life_stage(day_stem: int, branch: int) -> Tuple[str, str, str]:
    start, direction = _STAGE_START[day_stem]
    return LIFE_STAGES[(direction * (branch - start)) % 12]


@dataclass
class Saju:
    pillars: Dict[str, Dict]
    day_master: Dict
    ten_gods: Dict[str, str]
    elements: Dict[str, int]
    strength: str
    gyeokguk: Dict
    yongsin: Dict
    life_stages: Dict[str, Tuple]
    daeun: List[Dict]
    time_correction: Dict
    lunar: Dict

    def as_dict(self) -> Dict:
        return {
            "system": "Saju Palja (사주팔자)",
            "pillars": self.pillars, "day_master": self.day_master,
            "ten_gods": {k: {"key": v, "korean": TEN_GODS[v][0], "hanja": TEN_GODS[v][1],
                             "meaning": TEN_GODS[v][2]} for k, v in self.ten_gods.items()},
            "elements": self.elements, "day_master_strength": self.strength,
            "gyeokguk": self.gyeokguk, "yongsin": self.yongsin,
            "life_stages": {k: {"korean": v[0], "hanja": v[1], "meaning": v[2]}
                            for k, v in self.life_stages.items()},
            "daeun": self.daeun, "time_correction": self.time_correction,
            "lunar": self.lunar,
        }

    def summary(self) -> str:
        p = self.pillars
        lines = [
            "사주 (four pillars) — 시 · 일 · 월 · 년",
            "  " + "   ".join(f"{p[k]['korean']}({p[k]['stem_cn']}{p[k]['branch_cn']})"
                              for k in ("hour", "day", "month", "year")),
            f"일간 day master: {self.day_master['korean']} "
            f"{self.day_master['element_ko']} — {self.strength}",
            f"격국 structure: {self.gyeokguk['korean']} — {self.gyeokguk['meaning']}",
            f"용신 useful god: {self.yongsin['element_ko']} — {self.yongsin['why']}",
            "",
            "십성 ten gods:",
        ]
        for pos in ("year", "month", "day", "hour"):
            g = self.ten_gods.get(pos)
            if g:
                lines.append(f"  {pos:6s} {TEN_GODS[g][0]} ({TEN_GODS[g][1]}) — {TEN_GODS[g][2]}")
        lines.append("")
        lines.append("오행 elements: " + " · ".join(
            f"{ELEMENT_KO[e]} {n}" for e, n in self.elements.items()))
        lines.append("")
        lines.append("대운 great luck:")
        for d in self.daeun[:8]:
            mark = "  <-- current" if d.get("current") else ""
            lines.append(f"  {d['from_age']:>3}-{d['to_age']:<3} {d['korean']} "
                         f"({d['stem_cn']}{d['branch_cn']}) {TEN_GODS[d['ten_god']][0]}{mark}")
        return "\n".join(lines)


def saju(year: int, month: int, day: int, hour: int = 12, minute: int = 0,
         gender: str = "male", longitude: float = SEOUL_LONGITUDE,
         current_age: Optional[int] = None) -> Saju:
    """A full Saju chart from a Korean clock time."""
    import datetime

    tc = true_solar_time(year, month, day, hour, minute, longitude)
    ch, cm = tc["corrected_hour"], tc["corrected_minute"]
    base = datetime.date(int(year), int(month), int(day)) + datetime.timedelta(days=tc["day_shift"])

    ld = lunar_date(base.year, base.month, base.day, ch, cm)
    pillars = {}
    for key, (s, b) in (("year", (ld.year_stem, ld.year_branch)),
                        ("month", (ld.month_stem, ld.month_branch)),
                        ("day", (ld.day_stem, ld.day_branch)),
                        ("hour", (ld.hour_stem, ld.hour_branch))):
        pillars[key] = {
            "stem": STEMS[s], "branch": BRANCHES[b],
            "stem_cn": STEMS_CN[s], "branch_cn": BRANCHES_CN[b],
            "korean": STEMS_KO[s] + BRANCHES_KO[b],
            "stem_index": s, "branch_index": b,
            "element": STEM_ELEMENT[s], "element_ko": ELEMENT_KO[STEM_ELEMENT[s]],
            "hidden_stems": [STEMS[h] for h in HIDDEN_STEMS[b]],
        }

    dm = ld.day_stem
    day_master = {"stem": STEMS[dm], "hanja": STEMS_CN[dm], "korean": STEMS_KO[dm],
                  "element": STEM_ELEMENT[dm], "element_ko": ELEMENT_KO[STEM_ELEMENT[dm]],
                  "polarity": "양(陽)" if dm % 2 == 0 else "음(陰)"}

    gods = {k: _ten_god(dm, v["stem_index"]) for k, v in pillars.items() if k != "day"}
    gods["day"] = "bigyeon"

    # Element census across the visible stems and every hidden stem.
    elements = {e: 0 for e in ("Wood", "Fire", "Earth", "Metal", "Water")}
    for v in pillars.values():
        elements[STEM_ELEMENT[v["stem_index"]]] += 1
        for h in HIDDEN_STEMS[v["branch_index"]]:
            elements[STEM_ELEMENT[h]] += 1

    de = STEM_ELEMENT[dm]
    support = elements[de] + elements[_inv_produces(de)]
    strength = "신강 (strong)" if support >= 5 else \
               "신약 (weak)" if support <= 3 else "중화 (balanced)"

    gyeok = _gyeokguk(dm, ld.month_branch, pillars)
    yong = _yongsin(de, strength, elements)
    stages = {k: _life_stage(dm, v["branch_index"]) for k, v in pillars.items()}

    if current_age is None:
        current_age = datetime.date.today().year - int(year)
    daeun = _daeun(ld, dm, gender, base, current_age)

    return Saju(pillars=pillars, day_master=day_master, ten_gods=gods, elements=elements,
                strength=strength, gyeokguk=gyeok, yongsin=yong, life_stages=stages,
                daeun=daeun, time_correction=tc,
                lunar={"label": ld.label, "year_pillar": ld.year_pillar,
                       "animal": ld.animal, "is_leap_month": ld.is_leap_month})


def _inv_produces(e: str) -> str:
    """What produces `e` — the mother element."""
    return {v: k for k, v in _PRODUCES.items()}[e]


def _inv_controls(e: str) -> str:
    """What controls `e` — the element that restrains it."""
    return {v: k for k, v in _CONTROLS.items()}[e]


def _gyeokguk(day_stem: int, month_branch: int, pillars: Dict) -> Dict:
    """격국 — the structure, from the month branch's principal qi.

    Korean practice reads the chart through this. When the month branch carries the day
    master's own element the ordinary ten-god patterns do not apply and the chart takes
    one of the two special structures instead."""
    principal = HIDDEN_STEMS[month_branch][-1]
    if STEM_ELEMENT[principal] == STEM_ELEMENT[day_stem]:
        key = "geonrok" if principal % 2 == day_stem % 2 else "yangin"
        ko, hanja, meaning = GYEOKGUK_SPECIAL[key]
        return {"key": key, "korean": ko, "hanja": hanja, "meaning": meaning,
                "from_branch": BRANCHES[month_branch], "special": True}
    g = _ten_god(day_stem, principal)
    ko, hanja, meaning = TEN_GODS[g]
    return {"key": g, "korean": ko + "격", "hanja": hanja + "格", "meaning": meaning,
            "from_branch": BRANCHES[month_branch],
            "principal_qi": STEMS[principal], "special": False}


def _yongsin(day_element: str, strength: str, elements: Dict[str, int]) -> Dict:
    """용신 — the element the chart most needs.

    A strong day master needs draining or restraining; a weak one needs feeding. The rule
    is simple and every school agrees on it; the disagreements are about the readings that
    follow, not this."""
    if strength.startswith("신강"):
        # What restrains the day master is the element that CONTROLS it (관살), not the
        # one it controls — those are opposite directions on the cycle, and taking the
        # wrong one hands a strong chart more of what it already has too much of.
        want = _inv_controls(day_element)
        why = ("the day master is strong, so the chart wants what RESTRAINS it (관살) — "
               "pressure, structure and demands from outside")
        alt = _PRODUCES[day_element]      # 식상 — the outlet that drains it
    elif strength.startswith("신약"):
        want = _inv_produces(day_element)
        why = ("the day master is weak, so the chart wants what FEEDS it — support, "
               "learning and backing")
        alt = day_element
    else:
        want = _PRODUCES[day_element]
        why = ("the chart is balanced, so it wants an outlet — what the day master "
               "produces, rather than more of it")
        alt = _CONTROLS[day_element]
    return {"element": want, "element_ko": ELEMENT_KO[want], "why": why,
            "secondary": alt, "secondary_ko": ELEMENT_KO[alt],
            "present_in_chart": elements.get(want, 0)}


def _daeun(ld, day_stem: int, gender: str, base_date, current_age: int) -> List[Dict]:
    """대운 — the ten-year luck pillars.

    They run forward for a yang-year man or yin-year woman and backward otherwise, from
    the month pillar. The starting age is set by the distance to the nearest solar term;
    approximated here in whole years, which is the common practice."""
    yang = ld.year_stem % 2 == 0
    male = (gender or "male").lower().startswith("m")
    forward = (yang and male) or (not yang and not male)

    # Days to the adjacent solar term, three days to the year.
    import math
    jd = int(math.floor(gregorian_to_jd(base_date.year, base_date.month, base_date.day) + 0.5))
    step = 1 if forward else -1
    d = 0
    while d < 46:
        sl = solar_longitude(float(jd + step * (d + 1)))
        prev = solar_longitude(float(jd + step * d))
        if int(((sl - 315.0) % 360.0) // 30.0) != int(((prev - 315.0) % 360.0) // 30.0):
            break
        d += 1
    start_age = max(1, round((d + 1) / 3.0))

    out = []
    for i in range(10):
        s = (ld.month_stem + step * (i + 1)) % 10
        b = (ld.month_branch + step * (i + 1)) % 12
        lo = start_age + i * 10
        out.append({
            "from_age": lo, "to_age": lo + 9, "order": i + 1,
            "stem": STEMS[s], "branch": BRANCHES[b],
            "stem_cn": STEMS_CN[s], "branch_cn": BRANCHES_CN[b],
            "korean": STEMS_KO[s] + BRANCHES_KO[b],
            "ten_god": _ten_god(day_stem, s),
            "element": STEM_ELEMENT[s],
            "current": lo <= current_age <= lo + 9,
        })
    return out
