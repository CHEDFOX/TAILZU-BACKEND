"""
SHICHŪ SUIMEI (四柱推命) — Japanese four-pillar astrology.

Japan received the four-pillar method through the Edo period and developed one refinement
that Chinese and Korean practice do not share, and it is not cosmetic:

  ZŌKAN (蔵干) IS READ BY DEPTH INTO THE MONTH.
  Every branch hides two or three stems. Chinese practice generally takes the principal
  one; Japanese practice asks HOW MANY DAYS have passed since the setsu-iri (節入り) that
  opened the solar month, and reads whichever hidden stem governs that stretch of days.
  A birth on the third day of the Tiger month reads Wu; on the twentieth, Jia. Same
  branch, different governing stem, different ten-god, different chart. This is the
  distinguishing move of the Japanese tradition and the reason a Suimei reading and a
  BaZi reading of the same birth can disagree about what the chart even IS.

  The setsu boundaries come from real solar longitude via chinese.lunisolar, so the day
  count is exact rather than assumed from a fixed calendar date.

TIME. Japan keeps UTC+9, whose meridian is 135°E — and that line runs through Akashi, so
Japanese clock time is genuinely correct for central Japan and needs no wholesale
correction of the kind Korea requires. But Tokyo sits at 139.69°E, about nineteen minutes
ahead of the meridian, and Fukuoka about nineteen behind, so Japanese practice applies a
local correction anyway. Both the longitude term and the equation of time are applied
here; the default longitude is Tokyo.

The ten gods are given as TSŪHENSEI (通変星), which is the Japanese term, with their
Japanese readings. Where a character is shared with the Chinese source it is shown, since
the descent is real and worth seeing.
"""
import math
from dataclasses import dataclass
from typing import Dict

from app.services.chinese.lunisolar import (
    BRANCHES, BRANCHES_CN, STEMS, STEMS_CN, gregorian_to_jd, lunar_date,
)

TOKYO_LONGITUDE = 139.6917
JST_MERIDIAN = 135.0

STEMS_JA = ["きのえ", "きのと", "ひのえ", "ひのと", "つちのえ",
            "つちのと", "かのえ", "かのと", "みずのえ", "みずのと"]
BRANCHES_JA = ["ね", "うし", "とら", "う", "たつ", "み",
               "うま", "ひつじ", "さる", "とり", "いぬ", "い"]
STEM_ELEMENT = ["Wood", "Wood", "Fire", "Fire", "Earth", "Earth",
                "Metal", "Metal", "Water", "Water"]
ELEMENT_JA = {"Wood": "木", "Fire": "火", "Earth": "土", "Metal": "金", "Water": "水"}

_PRODUCES = {"Wood": "Fire", "Fire": "Earth", "Earth": "Metal",
             "Metal": "Water", "Water": "Wood"}
_CONTROLS = {"Wood": "Earth", "Earth": "Water", "Water": "Fire",
             "Fire": "Metal", "Metal": "Wood"}

# 通変星 — the ten gods in Japanese.
TSUHENSEI = {
    "hiken": ("比肩", "ひけん", "the peer — self-reliance, equals, and stubbornness"),
    "gouzai": ("劫財", "ごうざい", "the wealth-robber — rivalry that costs; bold and expensive"),
    "shokujin": ("食神", "しょくじん", "the eating god — appetite, ease, craft, natural output"),
    "shoukan": ("傷官", "傷官 しょうかん", "the wounded officer — sharp talent that resists authority"),
    "henzai": ("偏財", "へんざい", "shifting wealth — opportunity, circulation, the father"),
    "seizai": ("正財", "せいざい", "steady wealth — salary, thrift, what is counted"),
    "henkan": ("偏官", "へんかん", "the seven killings — imposed pressure, danger, command"),
    "seikan": ("正官", "せいかん", "the proper officer — legitimate authority, order, duty"),
    "hennin": ("偏印", "へんいん", "the sideways seal — unorthodox learning, intuition"),
    "injyu": ("印綬", "いんじゅ", "the seal ribbon — orthodox learning, protection, the mother"),
}

# 十二運 — the twelve fortunes.
JUNIUN = [
    ("長生", "ちょうせい", "birth — fresh and unformed"),
    ("沐浴", "もくよく", "bathing — unstable, exposed, indulgent"),
    ("冠帯", "かんたい", "the cap — ambition ahead of skill"),
    ("建禄", "けんろく", "the stipend — competence, standing alone"),
    ("帝旺", "ていおう", "the emperor — the peak, and its arrogance"),
    ("衰", "すい", "decline — the first ebb"),
    ("病", "びょう", "illness — sensitivity and sympathy"),
    ("死", "し", "death — stillness and thought"),
    ("墓", "ぼ", "the tomb — storage, what is kept"),
    ("絶", "ぜつ", "severance — the lowest point, and freedom"),
    ("胎", "たい", "conception — potential without form"),
    ("養", "よう", "nurture — sheltered growth"),
]
_JUNIUN_START = {0: (11, 1), 1: (6, -1), 2: (2, 1), 3: (9, -1), 4: (2, 1),
                 5: (9, -1), 6: (5, 1), 7: (0, -1), 8: (8, 1), 9: (3, -1)}

# 蔵干深浅 — which hidden stem governs, by days elapsed since the setsu-iri.
# branch -> [(through_day, stem_index, phase), ...]
ZOKAN = {
    0:  [(10, 8, "余気"), (30, 9, "本気")],
    1:  [(9, 9, "余気"), (12, 7, "中気"), (30, 5, "本気")],
    2:  [(7, 4, "余気"), (14, 2, "中気"), (30, 0, "本気")],
    3:  [(10, 0, "余気"), (30, 1, "本気")],
    4:  [(9, 1, "余気"), (12, 9, "中気"), (30, 4, "本気")],
    5:  [(5, 4, "余気"), (14, 6, "中気"), (30, 2, "本気")],
    6:  [(10, 2, "余気"), (19, 5, "中気"), (30, 3, "本気")],
    7:  [(9, 3, "余気"), (12, 1, "中気"), (30, 5, "本気")],
    8:  [(7, 4, "余気"), (14, 8, "中気"), (30, 6, "本気")],
    9:  [(10, 6, "余気"), (30, 7, "本気")],
    10: [(9, 7, "余気"), (12, 3, "中気"), (30, 4, "本気")],
    11: [(7, 4, "余気"), (14, 0, "中気"), (30, 8, "本気")],
}
_SETSU_LONGITUDES = [315, 345, 15, 45, 75, 105, 135, 165, 195, 225, 255, 285]


def local_solar_correction(year: int, month: int, day: int, hour: int, minute: int,
                           longitude: float = TOKYO_LONGITUDE) -> Dict:
    """Japanese clock time corrected to local apparent time.

    Small compared with Korea's — the JST meridian actually crosses Japan — but Tokyo
    still runs about nineteen minutes ahead of it, and near a two-hour boundary that
    decides the hour pillar."""
    lon_minutes = (float(longitude) - JST_MERIDIAN) * 4.0
    jd = gregorian_to_jd(year, month, day, float(hour) + float(minute) / 60.0 - 9.0)
    n = jd - 2451545.0
    g = math.radians((357.528 + 0.9856003 * n) % 360.0)
    lam = math.radians((280.47 + 0.9856003 * n) % 360.0)
    eot = -7.655 * math.sin(g) + 9.873 * math.sin(2 * lam + 3.588)
    total = lon_minutes + eot
    raw = int(hour) * 60 + int(minute) + total
    return {"longitude_minutes": round(lon_minutes, 2),
            "equation_of_time_minutes": round(eot, 2),
            "total_correction_minutes": round(total, 2),
            "corrected_hour": int(raw // 60) % 24, "corrected_minute": int(raw % 60),
            "day_shift": int(raw // 60) // 24}


def days_since_setsu(year: int, month: int, day: int) -> Dict:
    """節入りからの日数 — days elapsed since the sectional term that opened this month.

    This is the number the zōkan table is read against, so it is the load-bearing
    quantity in a Suimei chart, not a detail."""
    from app.services.chinese.lunisolar import solar_term_jd, _tt_to_china_day
    jd = int(math.floor(gregorian_to_jd(int(year), int(month), int(day)) + 0.5))
    best, best_name = None, None
    for lon in _SETSU_LONGITUDES:
        for y in (int(year) - 1, int(year), int(year) + 1):
            s = _tt_to_china_day(solar_term_jd(y, float(lon)))
            if s <= jd and (best is None or s > best):
                best, best_name = s, lon
    return {"days": (jd - best) + 1 if best is not None else 1,
            "setsu_longitude": best_name}


def zokan_for(branch: int, days: int) -> Dict:
    """The governing hidden stem for a branch, at a given depth into the month."""
    for through, stem, phase in ZOKAN[int(branch)]:
        if int(days) <= through:
            return {"stem": STEMS[stem], "hanja": STEMS_CN[stem], "stem_index": stem,
                    "phase": phase, "element": STEM_ELEMENT[stem],
                    "days_into_month": int(days)}
    through, stem, phase = ZOKAN[int(branch)][-1]
    return {"stem": STEMS[stem], "hanja": STEMS_CN[stem], "stem_index": stem,
            "phase": phase, "element": STEM_ELEMENT[stem], "days_into_month": int(days)}


def _tsuhensei(day_stem: int, other: int) -> str:
    de, oe = STEM_ELEMENT[day_stem], STEM_ELEMENT[other]
    same = (day_stem % 2) == (other % 2)
    if de == oe:
        return "hiken" if same else "gouzai"
    if _PRODUCES[de] == oe:
        return "shokujin" if same else "shoukan"
    if _CONTROLS[de] == oe:
        return "henzai" if same else "seizai"
    if _CONTROLS[oe] == de:
        return "henkan" if same else "seikan"
    return "hennin" if same else "injyu"


@dataclass
class Suimei:
    pillars: Dict[str, Dict]
    day_master: Dict
    tsuhensei: Dict[str, str]
    juniun: Dict[str, tuple]
    zokan: Dict
    setsu: Dict
    correction: Dict

    def as_dict(self) -> Dict:
        return {"system": "Shichū Suimei (四柱推命)", "pillars": self.pillars,
                "day_master": self.day_master,
                "tsuhensei": {k: {"key": v, "kanji": TSUHENSEI[v][0],
                                  "reading": TSUHENSEI[v][1], "meaning": TSUHENSEI[v][2]}
                              for k, v in self.tsuhensei.items()},
                "juniun": {k: {"kanji": v[0], "reading": v[1], "meaning": v[2]}
                           for k, v in self.juniun.items()},
                "zokan": self.zokan, "setsu": self.setsu, "correction": self.correction}

    def summary(self) -> str:
        p = self.pillars
        z = self.zokan
        lines = [
            "四柱推命 — 年 · 月 · 日 · 時",
            "  " + "   ".join(f"{p[k]['kanji']}" for k in ("year", "month", "day", "hour")),
            f"日干 day master: {self.day_master['kanji']} "
            f"({self.day_master['element_ja']}) {self.day_master['reading']}",
            "",
            f"節入りからの日数: {self.setsu['days']}日",
            f"月支蔵干 governing hidden stem: {z['hanja']} ({z['phase']}) — "
            f"the Japanese refinement; a different depth into the month gives a different stem",
            f"格 from zōkan: {TSUHENSEI[z['tsuhensei']][0]} ({TSUHENSEI[z['tsuhensei']][1]})",
            "",
            "通変星 (ten gods):",
        ]
        for pos in ("year", "month", "day", "hour"):
            g = self.tsuhensei.get(pos)
            if g:
                lines.append(f"  {pos:6s} {TSUHENSEI[g][0]} — {TSUHENSEI[g][2]}")
        lines.append("")
        lines.append("十二運:")
        for pos in ("year", "month", "day", "hour"):
            v = self.juniun.get(pos)
            if v:
                lines.append(f"  {pos:6s} {v[0]} ({v[1]}) — {v[2]}")
        return "\n".join(lines)


def suimei(year: int, month: int, day: int, hour: int = 12, minute: int = 0,
           longitude: float = TOKYO_LONGITUDE) -> Suimei:
    """A Shichū Suimei chart from a Japanese clock time."""
    import datetime
    corr = local_solar_correction(year, month, day, hour, minute, longitude)
    base = datetime.date(int(year), int(month), int(day)) + \
        datetime.timedelta(days=corr["day_shift"])
    ld = lunar_date(base.year, base.month, base.day,
                    corr["corrected_hour"], corr["corrected_minute"])

    pillars = {}
    for key, (s, b) in (("year", (ld.year_stem, ld.year_branch)),
                        ("month", (ld.month_stem, ld.month_branch)),
                        ("day", (ld.day_stem, ld.day_branch)),
                        ("hour", (ld.hour_stem, ld.hour_branch))):
        pillars[key] = {"kanji": f"{STEMS_CN[s]}{BRANCHES_CN[b]}",
                        "reading": f"{STEMS_JA[s]}{BRANCHES_JA[b]}",
                        "stem": STEMS[s], "branch": BRANCHES[b],
                        "stem_index": s, "branch_index": b,
                        "element": STEM_ELEMENT[s],
                        "element_ja": ELEMENT_JA[STEM_ELEMENT[s]]}

    dm = ld.day_stem
    setsu = days_since_setsu(base.year, base.month, base.day)
    z = zokan_for(ld.month_branch, setsu["days"])
    z["tsuhensei"] = _tsuhensei(dm, z["stem_index"])

    gods = {k: _tsuhensei(dm, v["stem_index"]) for k, v in pillars.items() if k != "day"}
    gods["day"] = "hiken"

    stages = {}
    for k, v in pillars.items():
        start, direction = _JUNIUN_START[dm]
        stages[k] = JUNIUN[(direction * (v["branch_index"] - start)) % 12]

    return Suimei(
        pillars=pillars,
        day_master={"kanji": STEMS_CN[dm], "reading": STEMS_JA[dm], "stem": STEMS[dm],
                    "element": STEM_ELEMENT[dm],
                    "element_ja": ELEMENT_JA[STEM_ELEMENT[dm]],
                    "polarity": "陽" if dm % 2 == 0 else "陰"},
        tsuhensei=gods, juniun=stages, zokan=z, setsu=setsu, correction=corr)


# Every branch's zōkan table must span the whole month and end on the principal qi.
for _b, _rows in ZOKAN.items():
    assert _rows[-1][0] >= 30, f"branch {_b} zokan does not cover the month"
    assert _rows[-1][2] == "本気", f"branch {_b} does not end on 本気"
    assert all(_rows[i][0] < _rows[i + 1][0] for i in range(len(_rows) - 1)), \
        f"branch {_b} zokan day ranges are not ascending"
assert len(JUNIUN) == 12 and len(TSUHENSEI) == 10
