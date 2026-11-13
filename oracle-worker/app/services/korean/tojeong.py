"""
TOJEONG BIGYEOL (토정비결) — the Korean annual almanac.

Not astrology and not Saju. A separate book, attributed to Yi Ji-ham (이지함, 1517-1578),
whose pen name Tojeong gives it its title, and consulted at lunar New Year by a very large
share of the Korean population — historically most of it. Where Saju reads a life,
Tojeong answers one question: what does THIS year hold, and what does each month of it
hold. It is the most widely used divination system in Korea and it has no Chinese
equivalent, which is why it cannot be folded into anything else in this codebase.

THE METHOD, which is pure arithmetic on the lunar calendar:

  상괘 (upper) = (this year's 태세수 + Korean age) mod 8      → 1-8
  중괘 (middle) = (the birth lunar month's length + 월건수) mod 6  → 1-6
  하괘 (lower) = (the birth lunar day + 일진수) mod 3          → 1-3

The 수 are the traditional numbers of the sexagenary stems and branches. Eight by six by
three is 144, and the book holds exactly 144 verses, each with twelve monthly readings
beneath it — 1,872 in total. The number IS the divination; the verse is its expression.

WHAT THIS COMPUTES AND WHAT IT DOES NOT. The gwae number is computed exactly, and that
is the part that is arithmetic. The 1,872 verses are a sixteenth-century Korean literary
corpus in classical Chinese with Korean glosses; they are not reproduced here, because
paraphrasing them from memory would produce something that reads like Tojeong and is not.
What is given instead is the exact number, the meaning each component carries, and the
structural reading the three parts make together — which is what a practitioner reads
before turning to the verse.

Note that Tojeong uses SESSSEUM NAI (세는나이), the Korean age reckoning in which a baby
is one at birth and everyone gains a year at New Year — not the age since the birthday.
South Korea legislated international age for administrative use in 2023, but Tojeong is
computed the old way, and using the wrong one shifts the upper gwae.
"""
from dataclasses import dataclass
from typing import Dict, Optional

from app.services.chinese.lunisolar import (
    BRANCHES, BRANCHES_CN, STEMS, STEMS_CN, lunar_date,
)

# 천간수 — the stem numbers. Paired: 갑기 9, 을경 8, 병신 7, 정임 6, 무계 5.
STEM_NUMBER = {0: 9, 5: 9, 1: 8, 6: 8, 2: 7, 7: 7, 3: 6, 8: 6, 4: 5, 9: 5}
# 지지수 — the branch numbers. 자오 9, 축미 8, 인신 7, 묘유 6, 진술 5, 사해 4.
BRANCH_NUMBER = {0: 9, 6: 9, 1: 8, 7: 8, 2: 7, 8: 7, 3: 6, 9: 6, 4: 5, 10: 5, 5: 4, 11: 4}

# 상괘 — the eight, read as the year's overall weather.
UPPER = {
    1: ("일", "동풍해동 東風解凍", "the east wind thaws the ice — a frozen thing begins to move"),
    2: ("이", "망월대운 望月待雲", "watching the moon, waiting on cloud — the good is there but obscured"),
    3: ("삼", "고목봉춘 枯木逢春", "the dead tree meets spring — unlikely revival, late reward"),
    4: ("사", "금의야행 錦衣夜行", "brocade worn at night — merit real but unseen; recognition delayed"),
    5: ("오", "학수고대 鶴首苦待", "the crane cranes its neck — long waiting, and it does resolve"),
    6: ("육", "우순풍조 雨順風調", "rain in season, wind in measure — the smooth year, nothing forced"),
    7: ("칠", "심산맹호 深山猛虎", "the tiger in the deep mountain — power without an arena; restlessness"),
    8: ("팔", "선인지로 仙人指路", "the immortal points the road — help arrives from someone above you"),
}
# 중괘 — the six, read as the shape of the year's affairs.
MIDDLE = {
    1: ("일", "구름이 걷힌다 — obstruction lifting; what was blocked opens"),
    2: ("이", "두 마음 — division; two paths, and the cost of taking neither"),
    3: ("삼", "귀인이 돕는다 — a benefactor; the year turns on another person"),
    4: ("사", "재물이 오간다 — money moves, in and out; watch the outflow"),
    5: ("오", "구설이 있다 — talk and dispute; the tongue is the year's danger"),
    6: ("육", "안정과 수확 — settlement and harvest; hold rather than reach"),
}
# 하괘 — the three, read as the year's disposition.
LOWER = {
    1: ("일", "길 吉 — favourable; move, begin, commit"),
    2: ("이", "평 平 — even; neither push nor retreat, maintain"),
    3: ("삼", "흉 凶 — guarded; defend what you have, start nothing large"),
}


def korean_age(birth_year: int, for_year: int) -> int:
    """세는나이 — one at birth, and a year added at every New Year."""
    return int(for_year) - int(birth_year) + 1


@dataclass
class Tojeong:
    year: int
    gwae: str                 # e.g. "434"
    upper: int
    middle: int
    lower: int
    korean_age: int
    year_pillar: str
    birth_lunar: str
    detail: Dict

    def as_dict(self) -> Dict:
        u, m, l = UPPER[self.upper], MIDDLE[self.middle], LOWER[self.lower]
        return {
            "system": "Tojeong Bigyeol (토정비결)",
            "for_year": self.year, "gwae": self.gwae,
            "korean_age": self.korean_age, "year_pillar": self.year_pillar,
            "birth_lunar": self.birth_lunar,
            "upper": {"number": self.upper, "korean": u[0], "phrase": u[1], "meaning": u[2]},
            "middle": {"number": self.middle, "korean": m[0], "meaning": m[1]},
            "lower": {"number": self.lower, "korean": l[0], "meaning": l[1]},
            "detail": self.detail,
            "corpus_note": ("The gwae number is computed exactly; it is the divination. "
                            "The 144 verses and their 1,872 monthly readings are a "
                            "16th-century Korean text and are not reproduced here — a "
                            "paraphrase would read like Tojeong without being it."),
        }

    def summary(self) -> str:
        u, m, l = UPPER[self.upper], MIDDLE[self.middle], LOWER[self.lower]
        return "\n".join([
            f"토정비결 {self.year} — 괘 {self.gwae}  (세는나이 {self.korean_age}세)",
            f"태세 {self.year_pillar} · 생일 {self.birth_lunar}",
            "",
            f"상괘 {self.upper} — {u[1]}",
            f"     {u[2]}",
            f"중괘 {self.middle} — {m[1]}",
            f"하괘 {self.lower} — {l[1]}",
            "",
            f"One of 144. The verse itself is not reproduced; the number is the reading.",
        ])


def tojeong(birth_year: int, birth_month: int, birth_day: int,
            for_year: Optional[int] = None) -> Tojeong:
    """The Tojeong gwae for a birth, in a given year.

    `birth_*` is the civil (Gregorian) birth date — it is converted to the lunar date
    internally, since every term in the formula is lunar."""
    import datetime
    fy = int(for_year) if for_year else datetime.date.today().year

    bl = lunar_date(int(birth_year), int(birth_month), int(birth_day), 12)
    # 태세 — the sexagenary pillar of the year being divined, taken at its lunar new year.
    ys = (fy - 4) % 10
    yb = (fy - 4) % 12
    taese = STEM_NUMBER[ys] + BRANCH_NUMBER[yb]

    age = korean_age(birth_year, fy)
    upper = (taese + age) % 8 or 8
    # 월건 — the birth month's own pillar; 생월수 is the length of that lunar month.
    wolgeon = STEM_NUMBER[bl.month_stem] + BRANCH_NUMBER[bl.month_branch]
    middle = (bl.month_days + wolgeon) % 6 or 6
    # 일진 — the birth day's pillar.
    iljin = STEM_NUMBER[bl.day_stem] + BRANCH_NUMBER[bl.day_branch]
    lower = (bl.day + iljin) % 3 or 3

    return Tojeong(
        year=fy, gwae=f"{upper}{middle}{lower}", upper=upper, middle=middle, lower=lower,
        korean_age=age,
        year_pillar=f"{STEMS[ys]}{BRANCHES[yb]} ({STEMS_CN[ys]}{BRANCHES_CN[yb]})",
        birth_lunar=bl.label,
        detail={"taese_su": taese, "wolgeon_su": wolgeon, "iljin_su": iljin,
                "birth_month_days": bl.month_days, "birth_lunar_day": bl.day,
                "of_possible": 144},
    )


# The gwae space must be exactly 144, and every part must stay in range for any input.
_seen = set()
for _u in range(1, 9):
    for _m in range(1, 7):
        for _l in range(1, 4):
            _seen.add(f"{_u}{_m}{_l}")
assert len(_seen) == 144, "the Tojeong gwae space is 8 x 6 x 3 = 144"
assert set(UPPER) == set(range(1, 9)) and set(MIDDLE) == set(range(1, 7)) \
    and set(LOWER) == set(range(1, 4)), "a gwae component is missing its table entry"
