"""
TỨ TRỤ (四柱) — Vietnamese four-pillar astrology.

The fourth of the East Asian pillar traditions, and it differs from the Chinese source in
the same way Tử Vi does — through the CALENDAR — plus one thing of its own.

  THE CALENDAR. Vietnam computes at UTC+7. The month pillar turns on the solar terms and
  the year pillar on lunar new year, and both are evaluated in Vietnamese civil time, so
  on the years the two calendars part (1985 by a full month, 2007 and 2030 by a day) the
  year pillar itself differs. A Tứ Trụ chart built on the Chinese calendar is wrong on
  those years, not approximately right.

  THE HOUR. Vietnam keeps UTC+7, whose meridian is 105°E — and that line runs through
  Vietnam, near Hanoi. So unlike Korea, Vietnamese clock time is broadly correct and needs
  only a small local correction, largest in the south: Ho Chi Minh City sits at 106.7°E,
  about seven minutes ahead. Vietnam also ran on UTC+8 during parts of the war years in
  the south, which shifts an hour pillar outright for anyone born there then.

  THE VOCABULARY. Thập Thần — the ten gods — in Vietnamese, and the Vietnamese practice of
  reading dụng thần (the useful god) with more weight than the pattern, which is closer to
  the Chinese emphasis than to the Korean.

This is a sibling of Saju and Shichū Suimei, not a copy of any of them: four traditions
from one source, each with its own clock, its own calendar and its own reading order.
"""
import math
from dataclasses import dataclass
from typing import Dict, Optional

from app.services.chinese.lunisolar import (
    BRANCHES_CN, STEMS_CN, calendar_zone, gregorian_to_jd, lunar_date,
)

VIETNAM_UTC_OFFSET = 7
HANOI_LONGITUDE = 105.85
SAIGON_LONGITUDE = 106.70
VN_MERIDIAN = 105.0

STEMS_VI = ["Giáp", "Ất", "Bính", "Đinh", "Mậu", "Kỷ", "Canh", "Tân", "Nhâm", "Quý"]
BRANCHES_VI = ["Tý", "Sửu", "Dần", "Mão", "Thìn", "Tỵ",
               "Ngọ", "Mùi", "Thân", "Dậu", "Tuất", "Hợi"]
ANIMALS_VI = ["chuột (rat)", "trâu (buffalo)", "hổ (tiger)", "mèo (CAT)", "rồng (dragon)",
              "rắn (snake)", "ngựa (horse)", "dê (goat)", "khỉ (monkey)", "gà (rooster)",
              "chó (dog)", "lợn (pig)"]

STEM_ELEMENT = ["Mộc", "Mộc", "Hỏa", "Hỏa", "Thổ", "Thổ", "Kim", "Kim", "Thủy", "Thủy"]
ELEMENT_EN = {"Mộc": "Wood", "Hỏa": "Fire", "Thổ": "Earth", "Kim": "Metal", "Thủy": "Water"}

_PRODUCES = {"Mộc": "Hỏa", "Hỏa": "Thổ", "Thổ": "Kim", "Kim": "Thủy", "Thủy": "Mộc"}
_CONTROLS = {"Mộc": "Thổ", "Thổ": "Thủy", "Thủy": "Hỏa", "Hỏa": "Kim", "Kim": "Mộc"}

# Thập Thần — the ten gods in Vietnamese.
THAP_THAN = {
    "ty_kien": ("Tỷ Kiên", "比肩", "the peer — equals and rivals; self-reliance and stubbornness"),
    "kiep_tai": ("Kiếp Tài", "劫財", "the wealth-robber — costly rivalry, reckless allies"),
    "thuc_than": ("Thực Thần", "食神", "the eating god — output, ease, appetite, craft"),
    "thuong_quan": ("Thương Quan", "傷官", "the hurting officer — talent that will not obey"),
    "thien_tai": ("Thiên Tài", "偏財", "shifting wealth — opportunity, the father, risk"),
    "chinh_tai": ("Chính Tài", "正財", "steady wealth — salary, the wife, what is counted"),
    "that_sat": ("Thất Sát", "七殺", "the seven killings — imposed pressure, danger, command"),
    "chinh_quan": ("Chính Quan", "正官", "the proper officer — authority, office, the husband"),
    "thien_an": ("Thiên Ấn", "偏印", "the sideways seal — unorthodox learning, intuition"),
    "chinh_an": ("Chính Ấn", "正印", "the proper seal — orthodox learning, the mother"),
}

# Hidden stems (tàng can) — principal qi last.
HIDDEN = {0: [8, 9], 1: [9, 7, 5], 2: [4, 2, 0], 3: [0, 1], 4: [1, 9, 4], 5: [4, 6, 2],
          6: [2, 5, 3], 7: [3, 1, 5], 8: [4, 8, 6], 9: [6, 7], 10: [7, 3, 4], 11: [4, 0, 8]}


def vietnam_utc_offset(year: int, latitude: Optional[float] = None) -> float:
    """Vietnam's legal clock offset.

    The south ran on UTC+8 for stretches of the war years while the north kept UTC+7, so a
    southern birth in that window takes a different hour pillar. Latitude decides which
    side of the 17th parallel the birth falls on."""
    y = int(year)
    if latitude is not None and float(latitude) < 17.0 and 1960 <= y <= 1975:
        return 8.0
    return 7.0


def local_correction(year: int, month: int, day: int, hour: int, minute: int,
                     longitude: float = HANOI_LONGITUDE,
                     latitude: Optional[float] = None) -> Dict:
    """Clock time corrected to local apparent time. Small — the UTC+7 meridian crosses
    Vietnam — but not zero, and largest in the south."""
    off = vietnam_utc_offset(year, latitude)
    lon_minutes = (float(longitude) - off * 15.0) * 4.0
    jd = gregorian_to_jd(year, month, day, float(hour) + float(minute) / 60.0 - off)
    n = jd - 2451545.0
    g = math.radians((357.528 + 0.9856003 * n) % 360.0)
    lam = math.radians((280.47 + 0.9856003 * n) % 360.0)
    eot = -7.655 * math.sin(g) + 9.873 * math.sin(2 * lam + 3.588)
    total = lon_minutes + eot
    raw = int(hour) * 60 + int(minute) + total
    return {"clock_offset": off, "longitude_minutes": round(lon_minutes, 2),
            "equation_of_time_minutes": round(eot, 2),
            "total_correction_minutes": round(total, 2),
            "corrected_hour": int(raw // 60) % 24, "corrected_minute": int(raw % 60),
            "day_shift": int(raw // 60) // 24,
            "wartime_south": off == 8.0}


def _god(day_stem: int, other: int) -> str:
    de, oe = STEM_ELEMENT[day_stem], STEM_ELEMENT[other]
    same = (day_stem % 2) == (other % 2)
    if de == oe:
        return "ty_kien" if same else "kiep_tai"
    if _PRODUCES[de] == oe:
        return "thuc_than" if same else "thuong_quan"
    if _CONTROLS[de] == oe:
        return "thien_tai" if same else "chinh_tai"
    if _CONTROLS[oe] == de:
        return "that_sat" if same else "chinh_quan"
    return "thien_an" if same else "chinh_an"


@dataclass
class TuTru:
    pillars: Dict[str, Dict]
    day_master: Dict
    gods: Dict[str, str]
    elements: Dict[str, int]
    strength: str
    dung_than: Dict
    correction: Dict
    lunar: Dict
    calendar_note: str

    def as_dict(self) -> Dict:
        return {"system": "Tứ Trụ (四柱)", "pillars": self.pillars,
                "day_master": self.day_master,
                "thap_than": {k: {"key": v, "vietnamese": THAP_THAN[v][0],
                                  "han": THAP_THAN[v][1], "meaning": THAP_THAN[v][2]}
                              for k, v in self.gods.items()},
                "elements": self.elements, "strength": self.strength,
                "dung_than": self.dung_than, "correction": self.correction,
                "lunar": self.lunar, "calendar": self.calendar_note}

    def summary(self) -> str:
        p = self.pillars
        lines = [
            "Tứ Trụ — Năm · Tháng · Ngày · Giờ",
            "  " + "   ".join(p[k]["vietnamese"] for k in ("year", "month", "day", "hour")),
            f"Nhật chủ (day master): {self.day_master['vietnamese']} "
            f"{self.day_master['element']} ({ELEMENT_EN[self.day_master['element']]}) — {self.strength}",
            f"Dụng thần (useful god): {self.dung_than['element']} "
            f"({ELEMENT_EN[self.dung_than['element']]}) — {self.dung_than['why']}",
            "",
            "Thập Thần:",
        ]
        for pos in ("year", "month", "day", "hour"):
            g = self.gods.get(pos)
            if g:
                lines.append(f"  {pos:6s} {THAP_THAN[g][0]:12s} — {THAP_THAN[g][2]}")
        lines.append("")
        lines.append("Ngũ hành: " + " · ".join(f"{e} {n}" for e, n in self.elements.items()))
        lines.append("")
        lines.append(self.calendar_note)
        return "\n".join(lines)


def tu_tru(year: int, month: int, day: int, hour: int = 12, minute: int = 0,
           longitude: float = HANOI_LONGITUDE,
           latitude: Optional[float] = None) -> TuTru:
    """A Tứ Trụ chart, computed in the Vietnamese calendar and clock."""
    import datetime
    corr = local_correction(year, month, day, hour, minute, longitude, latitude)
    base = datetime.date(int(year), int(month), int(day)) + \
        datetime.timedelta(days=corr["day_shift"])

    with calendar_zone(VIETNAM_UTC_OFFSET):
        ld = lunar_date(base.year, base.month, base.day,
                        corr["corrected_hour"], corr["corrected_minute"])

    pillars = {}
    for key, (s, b) in (("year", (ld.year_stem, ld.year_branch)),
                        ("month", (ld.month_stem, ld.month_branch)),
                        ("day", (ld.day_stem, ld.day_branch)),
                        ("hour", (ld.hour_stem, ld.hour_branch))):
        pillars[key] = {"vietnamese": f"{STEMS_VI[s]} {BRANCHES_VI[b]}",
                        "han": f"{STEMS_CN[s]}{BRANCHES_CN[b]}",
                        "stem_index": s, "branch_index": b,
                        "element": STEM_ELEMENT[s],
                        "animal": ANIMALS_VI[b],
                        "hidden": [STEMS_VI[h] for h in HIDDEN[b]]}

    dm = ld.day_stem
    gods = {k: _god(dm, v["stem_index"]) for k, v in pillars.items() if k != "day"}
    gods["day"] = "ty_kien"

    elements = {e: 0 for e in ("Mộc", "Hỏa", "Thổ", "Kim", "Thủy")}
    for v in pillars.values():
        elements[STEM_ELEMENT[v["stem_index"]]] += 1
        for h in HIDDEN[v["branch_index"]]:
            elements[STEM_ELEMENT[h]] += 1

    de = STEM_ELEMENT[dm]
    mother = {v: k for k, v in _PRODUCES.items()}[de]
    support = elements[de] + elements[mother]
    strength = ("thân vượng (strong)" if support >= 5 else
                "thân nhược (weak)" if support <= 3 else "trung hòa (balanced)")

    if strength.startswith("thân vượng"):
        want = {v: k for k, v in _CONTROLS.items()}[de]
        why = "the day master is strong, so the chart wants what restrains it"
    elif strength.startswith("thân nhược"):
        want = mother
        why = "the day master is weak, so the chart wants what feeds it"
    else:
        want = _PRODUCES[de]
        why = "the chart is balanced, so it wants an outlet"

    return TuTru(
        pillars=pillars,
        day_master={"vietnamese": STEMS_VI[dm], "han": STEMS_CN[dm],
                    "element": STEM_ELEMENT[dm],
                    "polarity": "dương (yang)" if dm % 2 == 0 else "âm (yin)"},
        gods=gods, elements=elements, strength=strength,
        dung_than={"element": want, "why": why, "present": elements.get(want, 0)},
        correction=corr,
        lunar={"label": ld.label, "year_pillar": ld.year_pillar,
               "animal": ANIMALS_VI[ld.year_branch]},
        calendar_note=_calendar_note(int(year), int(month), int(day), corr))


def _calendar_note(year: int, month: int, day: int, corr: Dict) -> str:
    parts = ["Computed in the Vietnamese calendar (UTC+7) and clock."]
    if corr.get("wartime_south"):
        parts.append("NOTE: a southern birth in 1960-1975, when the south kept UTC+8 while "
                     "the north kept UTC+7 — the hour pillar depends on which.")
    try:
        cn = lunar_date(year, month, day, 12)
        with calendar_zone(VIETNAM_UTC_OFFSET):
            vn = lunar_date(year, month, day, 12)
        if cn.year_pillar != vn.year_pillar:
            parts.append(f"NOTE: the Chinese calendar gives a DIFFERENT YEAR PILLAR here "
                         f"({cn.year_pillar} vs {vn.year_pillar}) — the two calendars part "
                         f"on this date and the whole chart turns on it.")
        elif (cn.month, cn.day) != (vn.month, vn.day):
            parts.append(f"NOTE: the Chinese calendar puts this birth at {cn.label} rather "
                         f"than {vn.label}.")
    except Exception:
        pass
    parts.append("The Vietnamese zodiac keeps the CAT where China keeps the rabbit — a "
                 "genuine divergence, not a mistranslation.")
    return " ".join(parts)


assert len(STEMS_VI) == 10 and len(BRANCHES_VI) == 12 and len(ANIMALS_VI) == 12
assert len(THAP_THAN) == 10
assert "CAT" in ANIMALS_VI[3], "the Vietnamese fourth branch is the cat, not the rabbit"
