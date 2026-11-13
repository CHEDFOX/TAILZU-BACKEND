"""
FIRDARIA (فردار, Persian fardār) — the Persian time-lord periods.

The oldest surviving planetary-period system in the Western tradition and the one that
travelled furthest: Abū Maʿshar and the Baghdad astrologers carried it out of Sasanian
Persia into Arabic astrology, from there into Latin Europe, and it is the direct ancestor
of the time-lord revival in modern traditional practice. It is also the missing sibling
of a system this platform already computes in depth — Vedic daśās — and the comparison is
worth having, because the two answer the same question from unrelated premises.

THE SCHEME

Seventy-five years divided among nine lords, each ruling a stretch of life. The ORDER
depends on whether the Sun was above the horizon at birth:

  DAY birth    Sun 10 · Venus 8 · Mercury 13 · Moon 9 · Saturn 11 · Jupiter 12 · Mars 7
  NIGHT birth  Moon 9 · Saturn 11 · Jupiter 12 · Mars 7 · Sun 10 · Venus 8 · Mercury 13

then the North Node 3 and the South Node 2 for both, totalling 75. Past 75 the sequence
restarts, which matters for anyone the app is likely to be read by.

Each planetary period divides into SEVEN sub-periods of equal length, running in the same
sequence and beginning with the period's own lord. The nodes do not subdivide — the
majority position, and the one Bonatti follows.

DAY OR NIGHT is computed from the Sun's actual altitude at the birth moment and place,
not from a clock rule. "Before 6pm" is wrong at high latitude and wrong in summer
everywhere, and it is the single input this system is most sensitive to: a birth on the
wrong side of the horizon gets an entirely different sequence of lords for its whole life.
"""
import math
from dataclasses import dataclass
from typing import Dict, List, Optional

DAY_ORDER = [("Sun", 10), ("Venus", 8), ("Mercury", 13), ("Moon", 9),
             ("Saturn", 11), ("Jupiter", 12), ("Mars", 7),
             ("North Node", 3), ("South Node", 2)]
NIGHT_ORDER = [("Moon", 9), ("Saturn", 11), ("Jupiter", 12), ("Mars", 7),
               ("Sun", 10), ("Venus", 8), ("Mercury", 13),
               ("North Node", 3), ("South Node", 2)]
TOTAL_YEARS = 75

# The seven that subdivide, in the traditional descending order.
SUB_SEQUENCE = ["Sun", "Venus", "Mercury", "Moon", "Saturn", "Jupiter", "Mars"]

LORD_SEED = {
    "Sun": "authority, the father, recognition, health and the eye of the life",
    "Venus": "love, pleasure, art, women, ornament and what is enjoyed",
    "Mercury": "learning, trade, writing, siblings, travel and the quick hand",
    "Moon": "the mother, the body, the public, change and the domestic ground",
    "Saturn": "labour, restriction, land, old age, endurance and slow returns",
    "Jupiter": "law, wealth, teachers, children, expansion and good repute",
    "Mars": "conflict, surgery, courage, brothers, fire and forced separations",
    "North Node": "increase without measure — swelling, appetite, foreign things",
    "South Node": "decrease and release — loss that lightens, withdrawal, the spiritual turn",
}


# ══════════════════════════════════════════════════════════════════════════════
# sect: was the Sun above the horizon
# ══════════════════════════════════════════════════════════════════════════════

def sun_altitude(jd_ut: float, latitude: float, longitude: float) -> float:
    """The Sun's altitude in degrees, for a UT Julian Day and a place.

    Pure trigonometry on the low-precision solar position: accurate to well under a
    degree, which is far tighter than needed to answer 'up or down'. Only a birth within
    a couple of minutes of sunrise or sunset is genuinely ambiguous, and that ambiguity
    is real rather than an artefact of the approximation."""
    from app.services.chinese.lunisolar import solar_longitude
    lam = math.radians(solar_longitude(jd_ut))
    eps = math.radians(23.439291 - 0.0130042 * ((jd_ut - 2451545.0) / 36525.0))
    # Ecliptic → equatorial.
    ra = math.atan2(math.cos(eps) * math.sin(lam), math.cos(lam))
    dec = math.asin(math.sin(eps) * math.sin(lam))
    # Greenwich mean sidereal time, in degrees.
    d = jd_ut - 2451545.0
    gmst = (280.46061837 + 360.98564736629 * d) % 360.0
    lst = math.radians((gmst + float(longitude)) % 360.0)
    h = lst - ra
    phi = math.radians(float(latitude))
    alt = math.asin(math.sin(phi) * math.sin(dec)
                    + math.cos(phi) * math.cos(dec) * math.cos(h))
    return math.degrees(alt)


def is_day_birth(year: int, month: int, day: int, hour: int, minute: int,
                 latitude: float, longitude: float, tz_offset_hours: float = 0.0) -> Dict:
    """Whether the Sun was above the horizon. `tz_offset_hours` converts local clock time
    to UT; pass 0 only if the time given is already UT."""
    from app.services.chinese.lunisolar import gregorian_to_jd
    jd = gregorian_to_jd(int(year), int(month), int(day),
                         float(hour) + float(minute) / 60.0 - float(tz_offset_hours))
    alt = sun_altitude(jd, latitude, longitude)
    return {"is_day": alt > 0.0, "sun_altitude": round(alt, 3),
            "marginal": abs(alt) < 1.0,
            "note": ("Within a degree of the horizon — sect is genuinely uncertain here "
                     "and the whole sequence of lords turns on it."
                     if abs(alt) < 1.0 else "")}


# ══════════════════════════════════════════════════════════════════════════════
# the periods
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class Period:
    lord: str
    sub_lord: Optional[str]
    from_age: float
    to_age: float
    meaning: str
    sub_meaning: str = ""
    cycle: int = 0          # which 75-year turn this belongs to

    def as_dict(self) -> Dict:
        return {"lord": self.lord, "sub_lord": self.sub_lord,
                "from_age": round(self.from_age, 3), "to_age": round(self.to_age, 3),
                "meaning": self.meaning, "sub_meaning": self.sub_meaning,
                "cycle": self.cycle}


def periods(is_day: bool, cycles: int = 2) -> List[Period]:
    """The full period sequence with sub-periods, running `cycles` × 75 years.

    Boundaries are computed from the cycle base rather than accumulated, so the second
    turn starts at exactly 75.0. Accumulating sevenths of thirteen years lands a hair
    under, and anything keying off `age // 75` then reads the second cycle as the first."""
    order = DAY_ORDER if is_day else NIGHT_ORDER
    out: List[Period] = []
    for c in range(max(1, int(cycles))):
        base = float(c * TOTAL_YEARS)
        elapsed = 0.0
        for lord, length in order:
            start = base + elapsed
            if lord in SUB_SEQUENCE:
                s0 = SUB_SEQUENCE.index(lord)
                span = length / 7.0
                for i in range(7):
                    sub = SUB_SEQUENCE[(s0 + i) % 7]
                    out.append(Period(lord=lord, sub_lord=sub,
                                      from_age=start + i * span,
                                      to_age=start + (i + 1) * span,
                                      meaning=LORD_SEED[lord],
                                      sub_meaning=LORD_SEED[sub], cycle=c))
            else:
                # The nodes rule undivided.
                out.append(Period(lord=lord, sub_lord=None, from_age=start,
                                  to_age=start + length, meaning=LORD_SEED[lord],
                                  cycle=c))
            elapsed += float(length)
    return out


def at_age(age: float, is_day: bool) -> Optional[Period]:
    """The period and sub-period running at a given age."""
    a = float(age)
    cycles = int(a // TOTAL_YEARS) + 2
    for p in periods(is_day, cycles):
        if p.from_age <= a < p.to_age:
            return p
    return None


def report(year: int, month: int, day: int, hour: int, minute: int,
           latitude: float, longitude: float, tz_offset_hours: float = 0.0,
           current_age: Optional[float] = None) -> Dict:
    """The firdaria of a birth: sect, the current lord, and the sequence."""
    import datetime
    sect = is_day_birth(year, month, day, hour, minute, latitude, longitude, tz_offset_hours)
    if current_age is None:
        today = datetime.date.today()
        current_age = (today - datetime.date(int(year), int(month), int(day))).days / 365.2425
    cur = at_age(current_age, sect["is_day"])
    seq = periods(sect["is_day"], cycles=int(current_age // TOTAL_YEARS) + 2)
    majors, seen = [], set()
    for p in seq:
        key = (p.lord, p.cycle)
        if key in seen:
            continue
        seen.add(key)
        same = [q for q in seq if (q.lord, q.cycle) == key]
        majors.append({"lord": p.lord, "cycle": p.cycle,
                       "from_age": round(same[0].from_age, 2),
                       "to_age": round(same[-1].to_age, 2), "meaning": LORD_SEED[p.lord]})
    return {
        "system": "Firdaria (Persian fardār)",
        "sect": {"is_day_birth": sect["is_day"], **sect},
        "age": round(float(current_age), 2),
        "current": cur.as_dict() if cur else None,
        "major_periods": majors,
        "total_cycle_years": TOTAL_YEARS,
        "note": ("Order follows sect; sub-periods divide each planetary term into seven "
                 "and begin with its own lord. The nodes rule undivided (Bonatti)."),
    }


# Structural checks: both sequences must total 75 years and cover the nine lords.
assert sum(n for _, n in DAY_ORDER) == TOTAL_YEARS
assert sum(n for _, n in NIGHT_ORDER) == TOTAL_YEARS
assert {l for l, _ in DAY_ORDER} == {l for l, _ in NIGHT_ORDER}
assert abs(periods(True, 1)[-1].to_age - TOTAL_YEARS) < 1e-9
assert abs(periods(False, 1)[-1].to_age - TOTAL_YEARS) < 1e-9
