"""
BURMESE MAHABOTE (မဟာဘုတ်) — the seven-house chart, not just the day-lord.

WHAT WAS HERE BEFORE
────────────────────
A seven-row weekday lookup. It returned one line — "Tuesday, Inga, Mars, the Lion" — and
that was the whole system. Correct as far as it went, and about a seventh of Mahabote.

Mahabote is a CHART. Seven houses, seven planets, and the reading comes from which planet
lands in which house: where your losses are, where your power is, where the buried money
is, where death sits. The day-lord alone tells you none of that.

THE CONSTRUCTION, AND WHAT IS CERTAIN ABOUT IT
──────────────────────────────────────────────
Certain, and not in dispute:
  · the seven house names and their meanings
  · the eight day-lords, Wednesday split into a day half and a night half ruled by Rahu —
    which Burmese practice shares with Thai and which has no Indian counterpart
  · that the chart is built from TWO inputs, the birth weekday and the Burmese-era year
  · that the Burmese year is the Gregorian year less 638

Not settled between sources: the exact rotation — which planet anchors the wheel, which
direction it counts, and whether the year-remainder or the day-lord sets the starting
house. Published Burmese almanacs and the English-language accounts of them disagree, and
several give a worked example without giving the rule.

So the rotation is a STATED PARAMETER with a documented default, exactly as the mewa and
parkha anchors are in regional/tibetan_thai.py. `ROTATION` says which convention is in
force; a caller following a different almanac passes its own and gets that almanac's
chart. What this module will not do is pick one silently and present it as the tradition —
that is how the old Zi Wei implementation came to be confidently wrong in every particular,
and the fix for that is stating the assumption, not hiding it better.
"""
from dataclasses import dataclass, field
from typing import Dict, Optional

# (day, Burmese romanized, planet, animal, direction, element, seed) — Sunday..Saturday,
# with Wednesday-night (Rahu) appended as the eighth.
DAYS = [
    ("Sunday", "Taninganwe", "Sun", "Garuda", "Northeast", "Fire", "radiant, proud, a natural centre — the ruler"),
    ("Monday", "Taninla", "Moon", "Tiger", "East", "Earth", "gentle, nurturing, changeable — the caretaker"),
    ("Tuesday", "Inga", "Mars", "Lion", "Southeast", "Fire", "fierce, driven, competitive — the warrior"),
    ("Wednesday", "Buddahu", "Mercury", "Tusked Elephant", "South", "Water", "clever, communicative, adaptable — the messenger"),
    ("Thursday", "Kyathabade", "Jupiter", "Rat", "West", "Air", "wise, generous, expansive — the teacher"),
    ("Friday", "Thaukkya", "Venus", "Guinea Pig", "North", "Water", "warm, artistic, loving — the harmoniser"),
    ("Saturday", "Sanay", "Saturn", "Naga", "Southwest", "Earth", "deep, patient, enduring — the ascetic"),
]
# The eighth day-lord. Burmese practice divides Wednesday at noon; the afternoon and night
# belong to Rahu, and a person born then is a Rahu person, not a Mercury one.
RAHU_DAY = ("Wednesday (night)", "Yahu", "Rahu", "Tuskless Elephant", "Northwest", "Air",
            "unruly, magnetic, disruptive — the one who breaks the pattern")

# (name, Burmese, meaning) — the seven houses, in their cycle order.
HOUSES = [
    ("Binga", "ဘင်္ဂ", "loss and dissolution — what drains away, and what you must stop defending"),
    ("Ahtun", "အထွန်း", "rising — what lifts you, and the years it lifts you in"),
    ("Yaza", "ရာဇ", "the king — power, office, the authority you can actually hold"),
    ("Adipati", "အဓိပတိ", "the ruler — leadership and prosperity; the strongest house of the seven"),
    ("Marana", "မရဏ", "death — endings, danger, and the thing that must be let go of"),
    ("Thike", "သိုက်", "buried treasure — hidden wealth, inheritance, what is found rather than earned"),
    ("Puti", "ပုတိ", "decay — what rots if neglected; the slow, unglamorous weakness"),
]

# The seven planets in the Burmese weekday order used to fill the wheel.
PLANET_ORDER = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn"]

PLANET_SEED = {
    "Sun": "authority, the father, standing and the eye of the life",
    "Moon": "the mother, feeling, the body and the household",
    "Mars": "force, conflict, courage, brothers and machinery",
    "Mercury": "speech, trade, learning and the quick hand",
    "Jupiter": "teachers, law, children, wealth and good repute",
    "Venus": "love, pleasure, art, women and what is enjoyed",
    "Saturn": "labour, delay, land, endurance and old age",
    "Rahu": "the irregular — foreign things, appetite, sudden reversal",
}

# ── the rotation, stated ──────────────────────────────────────────────────────
# `anchor`      which planet sits in house index 0 before the offset is applied
# `direction`   +1 counts the planets forward round the wheel, -1 backward
# `offset_from` "year" takes the offset from the Burmese-year remainder alone;
#               "year_and_day" adds the weekday index, which is the other common reading
ROTATION = {"anchor": "Sun", "direction": 1, "offset_from": "year"}

BURMESE_ERA_OFFSET = 638


@dataclass
class Mahabote:
    # The original fields, unchanged — existing callers read these directly.
    day: str
    burmese: str
    planet: str
    animal: str
    direction: str
    element: str
    seed: str
    # The chart.
    burmese_year: int = 0
    remainder: int = 0
    houses: Dict[str, dict] = field(default_factory=dict)     # house name -> {planet, …}
    planets: Dict[str, str] = field(default_factory=dict)     # planet -> house name
    own_house: str = ""
    own_house_meaning: str = ""
    rotation: Dict = field(default_factory=dict)

    def summary(self) -> str:
        lines = [f"{self.burmese} — {self.day}, ruled by {self.planet} ({self.animal}, "
                 f"{self.element}, {self.direction})",
                 f"Burmese year {self.burmese_year}, remainder {self.remainder}",
                 f"Day-lord {self.planet} sits in {self.own_house} — {self.own_house_meaning}",
                 "", "THE SEVEN HOUSES:"]
        for name, _, meaning in HOUSES:
            h = self.houses.get(name, {})
            lines.append(f"  {name:8s} {h.get('planet', '—'):8s} — {meaning}")
        return "\n".join(lines)

    def as_dict(self) -> dict:
        return {
            "system": "Mahabote (မဟာဘုတ်)",
            "day": self.day, "burmese": self.burmese, "day_lord": self.planet,
            "animal": self.animal, "direction": self.direction,
            "element": self.element, "meaning": self.seed,
            "burmese_year": self.burmese_year, "remainder": self.remainder,
            "own_house": self.own_house, "own_house_meaning": self.own_house_meaning,
            "houses": self.houses, "planets": self.planets,
            "rotation": self.rotation,
            "caveat": ("House names and the eight day-lords are not in dispute. The "
                       "rotation that places the planets is — sources disagree, so it is "
                       "a stated parameter here. This chart is valid against the rotation "
                       "it declares."),
        }


def _weekday_sunday0(year, month, day):
    # Zeller-free: Python date; isoweekday Mon=1..Sun=7 -> Sunday=0
    import datetime
    iso = datetime.date(int(year), int(month), int(day)).isoweekday()
    return iso % 7


def burmese_year(year: int, month: int, day: int) -> int:
    """The Burmese-era year. The era turns at Thingyan in mid-April, so a birth in the
    first third of the Gregorian year still belongs to the previous Burmese one."""
    by = int(year) - BURMESE_ERA_OFFSET
    if (int(month), int(day)) < (4, 17):
        by -= 1
    return by


def build_chart(weekday_index: int, by: int, rotation: Optional[Dict] = None) -> Dict:
    """Place the seven planets in the seven houses.

    The remainder of the Burmese year over seven sets how far the planetary wheel is
    turned against the fixed house wheel. Which planet starts, and which way it turns,
    come from `rotation` — see the module docstring for why that is a parameter."""
    r = dict(ROTATION)
    r.update(rotation or {})
    rem = int(by) % 7

    offset = rem if r["offset_from"] == "year" else (rem + int(weekday_index)) % 7
    start = PLANET_ORDER.index(r["anchor"])
    step = 1 if int(r["direction"]) >= 0 else -1

    houses, planets = {}, {}
    for i, (hname, hburmese, hmeaning) in enumerate(HOUSES):
        p = PLANET_ORDER[(start + step * (i + offset)) % 7]
        houses[hname] = {"planet": p, "burmese": hburmese, "meaning": hmeaning,
                         "planet_meaning": PLANET_SEED[p]}
        planets[p] = hname
    return {"houses": houses, "planets": planets, "remainder": rem, "rotation": r}


def mahabote(year, month, day, hour: Optional[int] = None,
             rotation: Optional[Dict] = None) -> Mahabote:
    """The full Mahabote chart for a birth.

    `hour` is optional and only matters for Wednesday: a birth from noon onward belongs to
    Rahu rather than Mercury, which changes the day-lord and therefore the whole reading.
    Without it a Wednesday birth is taken as the Mercury half, which is the safer default
    but is a real assumption."""
    idx = _weekday_sunday0(year, month, day)
    rahu = idx == 3 and hour is not None and int(hour) >= 12
    d = RAHU_DAY if rahu else DAYS[idx]

    by = burmese_year(year, month, day)
    chart = build_chart(idx, by, rotation)

    # Rahu does not hold a house of its own in the seven-house wheel; a Rahu-born reads
    # from Mercury's house, since Rahu governs the other half of Mercury's day.
    lord_for_house = "Mercury" if rahu else d[2]
    own = chart["planets"].get(lord_for_house, "")
    own_meaning = chart["houses"].get(own, {}).get("meaning", "")

    return Mahabote(
        day=d[0], burmese=d[1], planet=d[2], animal=d[3], direction=d[4],
        element=d[5], seed=d[6],
        burmese_year=by, remainder=chart["remainder"],
        houses=chart["houses"], planets=chart["planets"],
        own_house=own, own_house_meaning=own_meaning, rotation=chart["rotation"],
    )


# Structure, which is checkable even where the rotation is not: every chart must place
# all seven planets in all seven houses, one each, for every year and every convention.
for _by in range(1300, 1400):
    for _off in ("year", "year_and_day"):
        for _dir in (1, -1):
            for _wd in range(7):
                _c = build_chart(_wd, _by, {"offset_from": _off, "direction": _dir})
                assert sorted(_c["planets"]) == sorted(PLANET_ORDER), "a planet is missing"
                assert len(_c["houses"]) == 7, "a house is empty"
                assert len({h["planet"] for h in _c["houses"].values()}) == 7, \
                    "two planets share a house"
