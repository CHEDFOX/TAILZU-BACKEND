"""
TỬ VI ĐẨU SỐ — Vietnamese purple star astrology.

Vietnam took Zi Wei Dou Shu from China and then diverged from it in a way that is not a
matter of translation: **the two countries do not share a calendar.**

Vietnam computes its lunar calendar at UTC+7 and China at UTC+8. A new moon falling in
the hour between 23:00 and midnight Hanoi time has already become the next day in
Beijing, so the Vietnamese month begins a day earlier. Tử Vi is placed from the LUNAR
month and the LUNAR day, so on those years every star in the chart moves.

This is not hypothetical. Over 1975-2035 the two calendars part three times:

    1985   China 20 Feb   Vietnam 21 Jan   — a full month apart, on a leap-month split
    2007   China 18 Feb   Vietnam 17 Feb
    2030   China  3 Feb   Vietnam  2 Feb

1985 is the case that settles the argument. The leap month falls in a different place, so
Tết Ất Sửu and Chinese New Year are thirty days apart, and a Vietnamese chart built on
the Chinese calendar that year is not a slightly different chart — it is somebody else's.
This module therefore computes inside the Vietnamese civil-day boundary rather than
relabelling a Chinese chart, which is the only reason it deserves to exist separately.

Beyond the calendar: the star and palace names are Vietnamese (Sino-Vietnamese readings
of the same characters, so they map one-to-one), and Vietnamese practice speaks of chính
tinh — the fourteen major stars — against phụ tinh, the auxiliaries, more sharply than
Chinese practice does. The placement mathematics is shared, and this module says so
rather than manufacturing differences that are not there.
"""
from dataclasses import dataclass
from typing import Dict, List

from app.services.chinese.lunisolar import calendar_zone

VIETNAM_UTC_OFFSET = 7

# Vietnamese readings of the fourteen chính tinh, in the engine's key order.
STAR_VI = {
    "Zi Wei": ("Tử Vi", "紫微", "đế tinh — the emperor: authority, dignity, the final say"),
    "Tian Ji": ("Thiên Cơ", "天機", "the strategist — intelligence, planning, restlessness"),
    "Tai Yang": ("Thái Dương", "太陽", "the sun — giving outward, public life, the father"),
    "Wu Qu": ("Vũ Khúc", "武曲", "the general — wealth taken by will; decisive and solitary"),
    "Tian Tong": ("Thiên Đồng", "天同", "the blessing — ease, enjoyment, the late bloomer"),
    "Lian Zhen": ("Liêm Trinh", "廉貞", "the judge — principle and politics; complication in love"),
    "Tian Fu": ("Thiên Phủ", "天府", "the treasury — accumulation, caution, reliable wealth"),
    "Tai Yin": ("Thái Âm", "太陰", "the moon — property, refinement, the mother, private life"),
    "Tan Lang": ("Tham Lang", "貪狼", "the wolf — desire, charm, appetite, and skill"),
    "Ju Men": ("Cự Môn", "巨門", "the great gate — the mouth: argument, analysis, suspicion"),
    "Tian Xiang": ("Thiên Tướng", "天相", "the minister — service, diplomacy, the seal of office"),
    "Tian Liang": ("Thiên Lương", "天梁", "the roof beam — shelter, seniority, old principles"),
    "Qi Sha": ("Thất Sát", "七殺", "the seven killings — risk, command, reform by force"),
    "Po Jun": ("Phá Quân", "破軍", "the army breaker — demolition before building"),
}

PALACE_VI = {
    "Life": ("Mệnh", "命", "the self — the shape of the whole life"),
    "Siblings": ("Huynh Đệ", "兄弟", "brothers and sisters, peers"),
    "Spouse": ("Phu Thê", "夫妻", "marriage and the partner"),
    "Children": ("Tử Tức", "子息", "children, and what you raise"),
    "Wealth": ("Tài Bạch", "財帛", "money as it flows"),
    "Health": ("Tật Ách", "疾厄", "the body and its crises"),
    "Travel": ("Thiên Di", "遷移", "movement, the world outside, life abroad"),
    "Friends": ("Nô Bộc", "奴僕", "subordinates, colleagues, the social field"),
    "Career": ("Quan Lộc", "官祿", "office, profession, standing"),
    "Property": ("Điền Trạch", "田宅", "land, home, the estate"),
    "Fortune": ("Phúc Đức", "福德", "inner life, pleasure, peace"),
    "Parents": ("Phụ Mẫu", "父母", "father and mother, elders"),
}

TRANSFORM_VI = {
    "Hua Lu": ("Hóa Lộc", "化祿", "salary — what comes easily"),
    "Hua Quan": ("Hóa Quyền", "化權", "power — what you can push through"),
    "Hua Ke": ("Hóa Khoa", "化科", "repute — what you are known for"),
    "Hua Ji": ("Hóa Kỵ", "化忌", "obstruction — what snags and will not let go"),
}

BUREAU_VI = {"Water": "Thủy nhị cục", "Wood": "Mộc tam cục", "Metal": "Kim tứ cục",
             "Earth": "Thổ ngũ cục", "Fire": "Hỏa lục cục"}


@dataclass
class TuVi:
    palaces: List[Dict]
    life_palace: str
    body_palace: str
    bureau: Dict
    lunar: Dict
    transformations: List[Dict]
    calendar_note: str

    def as_dict(self) -> Dict:
        return {"system": "Tử Vi Đẩu Số", "palaces": self.palaces,
                "life_palace": self.life_palace, "body_palace": self.body_palace,
                "bureau": self.bureau, "lunar": self.lunar,
                "transformations": self.transformations,
                "calendar": self.calendar_note}

    def summary(self) -> str:
        lines = [
            f"Tử Vi Đẩu Số — âm lịch {self.lunar['label']} ({self.lunar['year_pillar']})",
            f"Cục: {self.bureau['vietnamese']} ({self.bureau['number']})",
            f"Thân cư: {self.body_palace}",
            "",
            "MƯỜI HAI CUNG (the twelve palaces):",
        ]
        for p in self.palaces:
            stars = ", ".join(s["vietnamese"] for s in p["stars"]) or "vô chính diệu"
            lines.append(f"  {p['vietnamese']:12s} [{p['branch']}] {stars}")
        lines.append("")
        lines.append("TỨ HÓA (the four transformations):")
        for t in self.transformations:
            lines.append(f"  {t['vietnamese']}: {t['star']} tại {t['palace']}")
        lines.append("")
        lines.append(self.calendar_note)
        return "\n".join(lines)


def tu_vi(year: int, month: int, day: int, hour: int = 12, minute: int = 0,
          gender: str = "male") -> TuVi:
    """A Tử Vi chart, computed in the Vietnamese calendar.

    The `calendar_zone(7)` context is the point of this function: it makes the lunar month
    and day Vietnamese rather than Chinese, which on a divergence year changes every
    placement in the chart."""
    import datetime
    from app.services.chinese.ziwei import ZiWeiChart

    dt = datetime.datetime(int(year), int(month), int(day), int(hour), int(minute))
    with calendar_zone(VIETNAM_UTC_OFFSET):
        chart = ZiWeiChart(dt, gender)
        chart._build()
        ld = chart.lunar
        palaces = []
        for p in sorted(chart.palaces, key=lambda x: (x.index - chart.life_index) % 12):
            vi_name, vi_han, vi_meaning = PALACE_VI[p.name]
            palaces.append({
                "vietnamese": vi_name, "han": vi_han, "meaning": vi_meaning,
                "english": p.name, "branch": p.branch, "stem": p.stem,
                "is_body": p.is_body,
                "stars": [{"vietnamese": STAR_VI[s["name"]][0],
                           "han": STAR_VI[s["name"]][1],
                           "meaning": STAR_VI[s["name"]][2],
                           "english": s["name"],
                           "brightness": s["brightness_cn"]} for s in p.major],
                "decade": p.decade,
            })
        trans = []
        for t in chart.transformations:
            vi = TRANSFORM_VI.get(t["name"])
            pal = next((q.name for q in chart.palaces if q.index == t["palace_index"]), "")
            trans.append({"vietnamese": vi[0] if vi else t["name"],
                          "han": vi[1] if vi else "",
                          "meaning": vi[2] if vi else t["meaning"],
                          "star": STAR_VI.get(t["star"], (t["star"],))[0],
                          "palace": PALACE_VI.get(pal, (pal,))[0]})
        body = next((PALACE_VI[q.name][0] for q in chart.palaces if q.is_body), "")
        bureau = {"element": chart.bureau_element, "number": chart.bureau_no,
                  "vietnamese": BUREAU_VI[chart.bureau_element]}
        lunar = {"label": ld.label, "year_pillar": ld.year_pillar, "animal": ld.animal,
                 "month": ld.month, "day": ld.day, "is_leap": ld.is_leap_month}

    # Was this a year the two calendars parted? Worth saying on the chart itself.
    note = _calendar_note(int(year), int(month), int(day))
    return TuVi(palaces=palaces, life_palace=PALACE_VI["Life"][0], body_palace=body,
                bureau=bureau, lunar=lunar, transformations=trans, calendar_note=note)


def _calendar_note(year: int, month: int, day: int) -> str:
    """Whether the Vietnamese and Chinese lunar dates differ for this birth."""
    from app.services.chinese.lunisolar import lunar_date
    try:
        cn = lunar_date(year, month, day, 12)
        with calendar_zone(VIETNAM_UTC_OFFSET):
            vn = lunar_date(year, month, day, 12)
        if (cn.month, cn.day, cn.is_leap_month) != (vn.month, vn.day, vn.is_leap_month):
            return (f"Computed in the Vietnamese calendar (UTC+7). NOTE: the Chinese "
                    f"calendar puts this birth at {cn.label} — a different lunar date, so "
                    f"a chart built on the Chinese calendar would place every star "
                    f"elsewhere. Vietnamese practice uses the Vietnamese calendar.")
        return "Computed in the Vietnamese calendar (UTC+7); on this date it agrees with the Chinese."
    except Exception:
        return "Computed in the Vietnamese calendar (UTC+7)."


def calendar_divergences(from_year: int = 1975, to_year: int = 2035) -> List[Dict]:
    """The years Tết and Chinese New Year fall on different days.

    Exposed because it is the module's justification and should be checkable rather than
    asserted in a docstring."""
    from app.services.chinese.lunisolar import chinese_new_year
    out = []
    for y in range(int(from_year), int(to_year) + 1):
        cn = chinese_new_year(y)
        with calendar_zone(VIETNAM_UTC_OFFSET):
            vn = chinese_new_year(y)
        if cn != vn:
            out.append({"year": y,
                        "china": f"{cn[1]:02d}-{cn[2]:02d}",
                        "vietnam": f"{vn[1]:02d}-{vn[2]:02d}",
                        "days_apart": abs((cn[1] - vn[1]) * 30 + (cn[2] - vn[2]))})
    return out


assert len(STAR_VI) == 14, "the fourteen chính tinh"
assert len(PALACE_VI) == 12, "the twelve cung"
