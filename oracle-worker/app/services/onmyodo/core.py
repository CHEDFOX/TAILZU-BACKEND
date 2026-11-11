"""
ONMYŌDŌ (陰陽道) — the Japanese way of yin and yang, as a day-quality system.

Onmyōdō arrived from Tang China in the seventh century, was made a state office under
the Onmyōryō, and then developed for a thousand years in a direction Chinese practice did
not take. What survives in daily Japanese life is the KOYOMI — the almanac — and its
verdict on what a given day is fit for. Wedding halls still charge more for a Taian and
crematoria still close on Tomobiki, which makes this the most quietly load-bearing
divination system in any developed economy.

WHAT IS COMPUTED

  ROKUYŌ (六曜) — the six-day cycle, and the one every Japanese calendar prints. It is
  not a weekday cycle: it is `(lunar month + lunar day) mod 6`, which means it RESETS at
  each new moon and therefore jumps. That reset is the whole character of the system and
  it is why rokuyō cannot be derived from a Gregorian date alone. This module has a real
  lunisolar calendar underneath it, so the value is exact rather than tabulated.

  The rule is self-checking: it forces lunar months 1 and 7 to open on Senshō, 2 and 8 on
  Tomobiki, 3 and 9 on Senbu, 4 and 10 on Butsumetsu, 5 and 11 on Taian, 6 and 12 on
  Shakkō. That is the published table, reproduced by the formula rather than stored, and
  it is asserted at import.

  JŪNICHOKU (十二直) — the twelve day-officers, older than rokuyō and more precise about
  what a day suits. Indexed by the day branch against the SOLAR-term month branch, so it
  turns at the sekki rather than at the new moon.

  NIKKŌ NASSHIN (納音) — the day's na-yin element, shared with the Chinese engine.

  NIJŪHASSHUKU (二十八宿) — the twenty-eight lunar mansions. The continuous-cycle
  reckoning is used, with the anchor exposed as a parameter: Japanese almanacs differ on
  whether the count runs unbroken or restarts at certain solar terms, and a value quoted
  without its anchor is not checkable. Stated, not hidden.
"""
from dataclasses import dataclass
from typing import Dict

# (romaji, kanji, verdict) — indexed by (lunar_month + lunar_day) mod 6.
ROKUYO = [
    ("Taian", "大安", "the great peace — the most auspicious day; weddings and openings"),
    ("Shakkō", "赤口", "only the hour around noon is safe; a day of fire and blades"),
    ("Senshō", "先勝", "haste wins — the morning is fortunate, the afternoon is not"),
    ("Tomobiki", "友引", "pulling friends — good for company, forbidden for funerals"),
    ("Senbu", "先負", "haste loses — keep still in the morning, act after noon"),
    ("Butsumetsu", "仏滅", "the Buddha's death — the worst day; begin nothing"),
]

# (romaji, kanji, what the day is fit for) — the twelve officers, in order.
JUNICHOKU = [
    ("Taru", "建", "establishing — the best day to begin, but not to open ground"),
    ("Nozoku", "除", "removing — clearing, cleaning, healing, exorcism"),
    ("Mitsu", "満", "fullness — marriage, moving in, planting; not medicine"),
    ("Taira", "平", "levelling — the even day; travel and settling disputes"),
    ("Sadan", "定", "fixing — contracts and marriage; not travel or lawsuits"),
    ("Toru", "執", "grasping — sowing and hiring; not money moving out"),
    ("Yaburu", "破", "breaking — cutting ties and demolition only"),
    ("Ayabu", "危", "danger — the timid day; avoid heights, water and risk"),
    ("Naru", "成", "completing — building and opening; not disputes"),
    ("Osan", "納", "storing — receiving and harvesting; not marriage"),
    ("Hiraku", "開", "opening — study, building, marriage; not burial"),
    ("Tojiru", "閉", "closing — burial and sealing; nothing begun"),
]

# The twenty-eight mansions, in cycle order, with their Japanese readings.
NIJUHASSHUKU = [
    ("Sui", "角"), ("Kō", "亢"), ("Tei", "氐"), ("Bō", "房"), ("Shin", "心"),
    ("Bi", "尾"), ("Ki", "箕"), ("To", "斗"), ("Gyū", "牛"), ("Jo", "女"),
    ("Kyo", "虚"), ("Ki", "危"), ("Shitsu", "室"), ("Heki", "壁"), ("Kei", "奎"),
    ("Rō", "婁"), ("I", "胃"), ("Bō", "昴"), ("Hitsu", "畢"), ("Shi", "觜"),
    ("Shin", "参"), ("Sei", "井"), ("Ki", "鬼"), ("Ryū", "柳"), ("Sei", "星"),
    ("Chō", "張"), ("Yoku", "翼"), ("Shin", "軫"),
]

# Anchor for the continuous mansion count: JDN 2451545 (2000-01-01) taken as index 0.
# A PARAMETER, not a constant — see the module docstring.
SHUKU_ANCHOR_JDN = 2451545
SHUKU_ANCHOR_INDEX = 0


def rokuyo_of(lunar_month: int, lunar_day: int) -> Dict:
    """The six-day verdict for a lunar month and day."""
    name, kanji, verdict = ROKUYO[(int(lunar_month) + int(lunar_day)) % 6]
    return {"name": name, "kanji": kanji, "meaning": verdict}


def junichoku_of(day_branch: int, month_branch: int) -> Dict:
    """The day-officer, from the day branch against the solar-term month branch."""
    name, kanji, verdict = JUNICHOKU[(int(day_branch) - int(month_branch)) % 12]
    return {"name": name, "kanji": kanji, "meaning": verdict}


def shuku_of(jdn: int, anchor_jdn: int = SHUKU_ANCHOR_JDN,
             anchor_index: int = SHUKU_ANCHOR_INDEX) -> Dict:
    """The lunar mansion of a day, on the continuous count from a stated anchor."""
    i = (int(anchor_index) + (int(jdn) - int(anchor_jdn))) % 28
    romaji, kanji = NIJUHASSHUKU[i]
    return {"name": romaji, "kanji": kanji, "index": i + 1,
            "anchor": f"JDN {anchor_jdn} = index {anchor_index}"}


@dataclass
class OnmyodoDay:
    date: str
    lunar_label: str
    rokuyo: Dict
    junichoku: Dict
    shuku: Dict
    nayin: str
    day_pillar: str

    def as_dict(self) -> Dict:
        return {"system": "Onmyōdō (陰陽道)", "date": self.date,
                "lunar": self.lunar_label, "rokuyo": self.rokuyo,
                "junichoku": self.junichoku, "nijuhasshuku": self.shuku,
                "nayin": self.nayin, "day_pillar": self.day_pillar}


def day(year: int, month: int, day_: int, hour: int = 12) -> OnmyodoDay:
    """The almanac verdict for one civil date."""
    from app.services.chinese.lunisolar import lunar_date, STEMS, BRANCHES
    from app.services.chinese.ziwei import na_yin
    ld = lunar_date(int(year), int(month), int(day_), int(hour))
    return OnmyodoDay(
        date=f"{int(year):04d}-{int(month):02d}-{int(day_):02d}",
        lunar_label=ld.label,
        rokuyo=rokuyo_of(ld.month, ld.day),
        junichoku=junichoku_of(ld.day_branch, ld.month_branch),
        shuku=shuku_of(int(ld.jd)),
        nayin=na_yin(ld.day_stem, ld.day_branch),
        day_pillar=f"{STEMS[ld.day_stem]}{BRANCHES[ld.day_branch]}",
    )


def birth(year: int, month: int, day_: int, hour: int = 12) -> Dict:
    """The almanac reading of a BIRTH date — the day-quality a person was born into.

    Onmyōdō is a day-selection art rather than a natal one, so this is presented as what
    the day itself was, not as a claim about character. Saying otherwise would be
    inventing a natal doctrine the tradition does not have."""
    d = day(year, month, day_, hour)
    return {**d.as_dict(),
            "note": ("Onmyōdō judges DAYS, not birth charts. This is the quality of the "
                     "day you were born on as the almanac would have marked it — not a "
                     "natal reading, which the tradition does not make.")}


# The formula must reproduce the published month-opening table.
_EXPECTED_FIRSTS = {1: "Senshō", 7: "Senshō", 2: "Tomobiki", 8: "Tomobiki",
                    3: "Senbu", 9: "Senbu", 4: "Butsumetsu", 10: "Butsumetsu",
                    5: "Taian", 11: "Taian", 6: "Shakkō", 12: "Shakkō"}
for _m, _want in _EXPECTED_FIRSTS.items():
    assert rokuyo_of(_m, 1)["name"] == _want, (
        f"rokuyō: lunar month {_m} day 1 should open on {_want}")
