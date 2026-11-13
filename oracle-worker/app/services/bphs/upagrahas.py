"""
UPAGRAHAS — the sub-planets of BPHS, which this engine did not compute.

Rahu and Ketu, the chhaya grahas, have always been here: real bodies from the
true node, with dignity, aspects, dashas and readings. The upagrahas were not
here at all. The one name that appeared anywhere was Gulika, and only as GULIKA
KALAM — a band of the day the muhurta feature avoids. That is the time-band, not
the sub-planet: no longitude, no rashi, no house, nothing a chart can read.

There are two families and they are calculated in completely different ways.

── THE FIVE FROM THE SUN (Parashara, Ch. 3) ────────────────────────────────────
Pure arithmetic on the Sun's longitude, so they cost nothing and cannot fail:

    Dhuma      = Sun + 133°20′
    Vyatipata  = 360° − Dhuma
    Parivesha  = Vyatipata + 180°
    Indrachapa = 360° − Parivesha
    Upaketu    = Indrachapa + 16°40′

The chain closes on itself: substituting through gives Upaketu = Sun − 30°
exactly, which is the check the tests assert. They are computed on the SIDEREAL
Sun and stay sidereal, because every offset is a rotation and a rotation commutes
with the ayanamsa.

── THE FIVE FROM TIME (the Kaala-velas) ────────────────────────────────────────
These are not positions of anything. Each is the ASCENDANT at a particular
moment of the birth day, so each needs the real sunrise and sunset of the place:

    Kaala          the Sun's portion          Mrityu     Mars'
    Ardhaprahara   Mercury's                  Yamaghantaka  Jupiter's
    Gulika/Mandi   Saturn's

The day from sunrise to sunset is divided into eight equal parts, and so is the
night from sunset to the next sunrise. Seven parts carry a lord; the eighth
carries none — it belongs to Rahu and is why the sequence stops at seven. For a
DAY birth the first part is ruled by the lord of the weekday; for a NIGHT birth
by the lord of the FIFTH weekday from it, and both then run in weekday order.

Two conventions exist for which instant to take, and this returns both rather
than choosing: Gulika from the START of Saturn's part (BPHS as usually read) and
Maandi from its END (the Kerala usage). They differ by an eighth of the day and
are often several degrees apart, so silently picking one would be an opinion
dressed as a calculation.

THE VEDIC DAY BEGINS AT SUNRISE. A birth at 01:00 belongs to the previous
weekday and to that day's night, and using the calendar weekday instead is the
classic way to get every one of these wrong by one lord.
"""
from datetime import datetime, timedelta
from typing import Dict, Optional

import swisseph as swe

# Weekday order from Sunday, and each day's lord. The parts run in this order
# from whichever lord starts.
_LORDS = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn"]

# Which lord's part each sub-planet is taken from, and what the texts hang on it.
_VELAS = {
    "Kaala":        ("Sun",     "The Sun's portion — the hour's weight, what the day itself imposes."),
    "Mrityu":       ("Mars",    "Mars' portion — the cut, the accident, the thing that ends abruptly."),
    "Ardhaprahara": ("Mercury", "Mercury's portion — the half-watch, dealings and errands that go astray."),
    "Yamaghantaka": ("Jupiter", "Jupiter's portion — the bell of Yama; counsel that arrives too late."),
    "Gulika":       ("Saturn",  "Saturn's son, the heaviest of them — where a chart drags, delays and hardens."),
}

_SUN_CHAIN_NOTES = {
    "Dhuma":      "Smoke — where the chart is obscured, and grief that does not clear.",
    "Vyatipata":  "The fall — sudden reversal, the calamity that arrives out of order.",
    "Parivesha":  "The halo — a ring around a light: protection, and also confinement.",
    "Indrachapa": "Indra's bow — the rainbow: promise that is beautiful and does not last.",
    "Upaketu":    "The little banner — loss of direction, and the end of a matter.",
}


def _norm(x: float) -> float:
    return x % 360.0


def sun_upagrahas(sun_longitude: float) -> Dict[str, float]:
    """The five from the Sun, as longitudes in the same frame as the Sun given."""
    dhuma = _norm(sun_longitude + 133 + 20 / 60)
    vyatipata = _norm(360 - dhuma)
    parivesha = _norm(vyatipata + 180)
    indrachapa = _norm(360 - parivesha)
    upaketu = _norm(indrachapa + 16 + 40 / 60)
    return {"Dhuma": dhuma, "Vyatipata": vyatipata, "Parivesha": parivesha,
            "Indrachapa": indrachapa, "Upaketu": upaketu}


def _jd(dt: datetime) -> float:
    return swe.julday(dt.year, dt.month, dt.day,
                      dt.hour + dt.minute / 60 + dt.second / 3600)


def _rise_set(jd_start: float, lat: float, lon: float, what: int) -> Optional[float]:
    """The next sunrise or sunset after jd_start, as a Julian day, or None.

    BIT_DISC_CENTER with no refraction: the classical definition is the centre of
    the disc on the horizon, and the almanac default (upper limb, refracted) puts
    sunrise a couple of minutes earlier. Two minutes moves an eighth-part boundary
    by fifteen seconds, which is under a minute of arc on the ascendant — but the
    convention should still be the one the texts mean.
    """
    try:
        flag = swe.BIT_DISC_CENTER | swe.BIT_NO_REFRACTION
        res = swe.rise_trans(jd_start, swe.SUN, what | flag, (lon, lat, 0.0))
        # pyswisseph returns (retflag, (tret...)) — a negative retflag means the
        # event does not occur (polar day or night), which is a real answer.
        if isinstance(res, tuple) and len(res) >= 2 and res[0] >= 0:
            return res[1][0]
    except Exception:
        pass
    return None


def kaala_velas(birth_utc: datetime, lat: float, lon: float, ephemeris) -> Dict[str, Dict]:
    """The five time-born sub-planets, each as the ascendant of its own moment.

    `birth_utc` is UT, as everything downstream of the engine's timezone handling
    is. Returns {} when the day cannot be bounded — above the arctic circle there
    can be no sunrise to divide, and an invented one would be worse than silence.
    """
    jd_birth = _jd(birth_utc)

    # The day this birth belongs to, which starts at the sunrise BEFORE it.
    prev_rise = _rise_set(jd_birth - 1.5, lat, lon, swe.CALC_RISE)
    while prev_rise is not None:
        nxt = _rise_set(prev_rise + 0.01, lat, lon, swe.CALC_RISE)
        if nxt is None or nxt > jd_birth:
            break
        prev_rise = nxt
    if prev_rise is None:
        return {}

    sunset = _rise_set(prev_rise, lat, lon, swe.CALC_SET)
    next_rise = _rise_set(prev_rise + 0.01, lat, lon, swe.CALC_RISE)
    if sunset is None or next_rise is None:
        return {}

    by_day = jd_birth < sunset
    start, end = (prev_rise, sunset) if by_day else (sunset, next_rise)
    part = (end - start) / 8.0

    # The weekday of the SUNRISE that opened this day, not of the clock date.
    y, m, d, _h = swe.revjul(prev_rise)
    weekday = (datetime(int(y), int(m), int(d)).weekday() + 1) % 7   # 0 = Sunday
    first = weekday if by_day else (weekday + 4) % 7                 # the 5th weekday
    order = [_LORDS[(first + i) % 7] for i in range(7)]              # the 8th has no lord

    out: Dict[str, Dict] = {}
    for name, (lord, note) in _VELAS.items():
        if lord not in order:
            continue
        i = order.index(lord)
        moments = {"": start + i * part}
        if name == "Gulika":
            # Both conventions, named apart. See the header.
            moments = {"Gulika": start + i * part, "Maandi": start + (i + 1) * part}
        for label, jd in ({name: moments[""]} if "" in moments else moments).items():
            # AN ASCENDANT CAN SIMPLY NOT EXIST. Placidus is undefined above the
            # polar circle and Swiss Ephemeris raises rather than guessing, so a
            # birth in Tromsø would otherwise take this whole call down — and
            # with it any reading that asked for the sub-planets. One that cannot
            # be computed is left out; the rest still answer.
            try:
                asc = ephemeris.get_ascendant(jd, lat, lon)
            except Exception:
                continue
            yy, mm, dd, hh = swe.revjul(jd)
            out[label] = {
                "longitude": asc["longitude"],
                "rashi": asc["rashi"],
                "rashi_name": asc["rashi_name"],
                "degree_in_rashi": asc["degree_in_rashi"],
                "nakshatra_name": asc["nakshatra_name"],
                "pada": asc["pada"],
                "lord_of_part": lord,
                "part_index": i + 1,
                "born_by": "day" if by_day else "night",
                "moment_utc": (datetime(int(yy), int(mm), int(dd))
                               + timedelta(hours=float(hh))).isoformat(timespec="minutes"),
                "note": note if label != "Maandi" else
                        "Saturn's portion taken at its END — the Kerala reading of Gulika.",
            }
    return out


def all_upagrahas(birth_utc: datetime, lat: float, lon: float,
                  sun_longitude: float, ephemeris, asc_rashi: Optional[int] = None) -> Dict:
    """Both families, with a house for each when the ascendant's sign is known."""
    out: Dict[str, Dict] = {}

    # The same fields the kaala five carry, so a reading never has to ask which
    # family a sub-planet came from before it can name where it stands.
    try:
        from app.services.core.constants import RASHI_NAMES, NAKSHATRA_NAMES
    except Exception:                                  # pragma: no cover
        RASHI_NAMES = NAKSHATRA_NAMES = None

    for name, lon_deg in sun_upagrahas(sun_longitude).items():
        rashi = int(lon_deg // 30)
        nak = int(lon_deg // (360 / 27))
        out[name] = {
            "longitude": lon_deg,
            "rashi": rashi,
            "rashi_name": RASHI_NAMES[rashi] if RASHI_NAMES else "",
            "degree_in_rashi": lon_deg % 30,
            "nakshatra_name": NAKSHATRA_NAMES[nak] if NAKSHATRA_NAMES else "",
            "pada": int((lon_deg % (360 / 27)) // (360 / 108)) + 1,
            "family": "solar",
            "note": _SUN_CHAIN_NOTES[name],
        }

    for name, data in kaala_velas(birth_utc, lat, lon, ephemeris).items():
        out[name] = {**data, "family": "kaala"}

    if asc_rashi is not None:
        for v in out.values():
            v["house"] = ((v["rashi"] - asc_rashi) % 12) + 1

    return out
