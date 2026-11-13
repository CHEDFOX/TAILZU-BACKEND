"""
POLYNESIAN MOON RECKONING — the Hawaiian ʻōlelo pō and the Māori maramataka.

The great navigational cultures of the Pacific kept time by the moon's nights rather
than by a solar month, and each of the thirty nights carries a name, a character and a
practical verdict: what to plant on it, what to fish for, whether to go out at all. This
is a working calendar that fed people, not a symbolic one, and it is still consulted.

WHAT IS COMPUTED

The Hawaiian month runs in three ANAHULU of ten nights each — hoʻonui (waxing), poepoe
(full) and emi (waning) — and the night is found from the moon's actual age, computed
from the true new moon via `chinese.lunisolar`, not from a fixed thirtieth of a synodic
month. The synodic month is 29.53 days, so a naive division drifts by most of a night by
the end of the month, which is precisely where the important nights are.

Note that the ʻOle nights recur in more than one anahulu. That is correct and not a
duplication: ʻOle means "nothing" and marks the barren nights in each phase, so the name
returns wherever the phase does.

ON THE MĀORI SIDE, HONESTLY: maramataka names and their verdicts vary substantially
between iwi — Te Whānau-ā-Apanui, Ngāpuhi and Ngāi Tahu do not keep the same list, and
several nights are differently placed. Presenting one iwi's calendar as "the Māori
calendar" would be a real misrepresentation of a living tradition, so the widely
published nights are given as PARALLELS to the Hawaiian reckoning with that variation
stated, rather than as a computed system of their own.

Both cultures reckon a night as beginning at sunset. A date given here is the civil date
the night BEGINS on.
"""
import math
from typing import Dict, List

# (name, anahulu, verdict) — the thirty nights, in order from the first crescent.
PO = [
    ("Hilo", "hoʻonui", "the twisted thread — the new crescent; a thin, quiet night for planning"),
    ("Hoaka", "hoʻonui", "faint arch — casting shadows; a night said to frighten fish away"),
    ("Kūkahi", "hoʻonui", "standing first — good for planting; work begun now stands"),
    ("Kūlua", "hoʻonui", "standing second — steady growth; continue what was begun"),
    ("Kūkolu", "hoʻonui", "standing third — the last of the Kū nights; finish setting things"),
    ("Kūpau", "hoʻonui", "standing finished — the Kū nights end; close the planting"),
    ("ʻOlekūkahi", "hoʻonui", "nothing, first — barren; rough seas, poor fishing, do not plant"),
    ("ʻOlekūlua", "hoʻonui", "nothing, second — still barren; a night for rest and repair"),
    ("ʻOlekūkolu", "hoʻonui", "nothing, third — the tide runs strong; stay in"),
    ("ʻOlepau", "hoʻonui", "nothing finished — the barren run ends; prepare again"),
    ("Huna", "poepoe", "hidden — for what grows underground; roots and secrets"),
    ("Mōhalu", "poepoe", "unfolding — flowers open; a night for beauty and for gods"),
    ("Hua", "poepoe", "fruit, egg — abundant; everything that bears fruit prospers"),
    ("Akua", "poepoe", "the god — the moon is round; sacred, powerful, and not to be wasted"),
    ("Hoku", "poepoe", "full — the great fishing night; the moon sets after sunrise"),
    ("Māhealani", "poepoe", "the full brightness — abundance; the finest night of the month"),
    ("Kulu", "poepoe", "to drop — the moon begins to wane; offerings and letting go"),
    ("Lāʻaukūkahi", "poepoe", "tree standing first — for medicine, gathering herbs, healing"),
    ("Lāʻaukūlua", "poepoe", "tree standing second — medicine continues; good for planting trees"),
    ("Lāʻaupau", "poepoe", "tree finished — last of the Lāʻau nights; complete the gathering"),
    ("ʻOlekūkahi", "emi", "nothing, first — barren again; the waning ʻOle nights, avoid effort"),
    ("ʻOlekūlua", "emi", "nothing, second — unproductive; mend nets, do not set them"),
    ("ʻOlepau", "emi", "nothing finished — the barren nights end; the month turns down"),
    ("Kāloakūkahi", "emi", "long, standing first — good for fishing; the Kāloa nights begin"),
    ("Kāloakūlua", "emi", "long, standing second — a night for Kanaloa and the deep ocean"),
    ("Kāloapau", "emi", "long, finished — the last Kāloa; deep-sea work concludes"),
    ("Kāne", "emi", "the god Kāne — sacred, for fresh water and for prayer; no work"),
    ("Lono", "emi", "the god Lono — rain, agriculture, fertility; a good planting night"),
    ("Mauli", "emi", "last breath — the moon is nearly gone; a night for the dying year"),
    ("Muku", "emi", "cut off — the dark; the month ends and nothing is begun"),
]

ANAHULU = {
    "hoʻonui": "the waxing ten — the moon grows; nights of beginning and planting",
    "poepoe": "the round ten — the moon is full; nights of abundance and of the gods",
    "emi": "the waning ten — the moon shrinks; nights of gathering in and letting go",
}

# Widely published Māori nights, given as parallels only. Iwi differ; see the docstring.
MARAMATAKA_PARALLELS = {
    1: ("Whiro", "the dark and unstable night; ill-omened, nothing begun"),
    2: ("Tirea", "still poor for work; the moon barely shows"),
    3: ("Hoata", "good for planting; the crescent strengthens"),
    4: ("Ōue", "a good night; planting and fishing both favoured"),
    5: ("Okoro", "favourable; food-gathering does well"),
    15: ("Rākaunui", "the full moon — the most abundant night; fishing and planting alike"),
    16: ("Rākaumatohi", "still strong; a very good night"),
    17: ("Takirau", "good, but the tide begins to fall"),
    28: ("Ōtāne", "sacred to Tāne; a good night for forest work"),
    29: ("Ōrongonui", "sacred to Rongo; excellent for planting"),
    30: ("Mutuwhenua", "the moon is hidden; the land rests, nothing is done"),
}


def moon_age(year: int, month: int, day: int, hour: float = 12.0,
             tz_offset_hours: float = 0.0) -> float:
    """Days since the last true new moon, at the given instant."""
    from app.services.chinese.lunisolar import (
        gregorian_to_jd, new_moon_k, SYNODIC_MONTH, _delta_t)
    jd = gregorian_to_jd(int(year), int(month), int(day),
                         float(hour) - float(tz_offset_hours))
    k = math.floor((jd - 2451550.09766) / SYNODIC_MONTH) + 1
    # Walk back to the most recent new moon at or before this instant.
    while True:
        nm_tt = new_moon_k(k)
        nm_ut = nm_tt - _delta_t(2000 + (nm_tt - 2451545.0) / 365.25) / 86400.0
        if nm_ut <= jd:
            break
        k -= 1
    return jd - nm_ut


def night_of(year: int, month: int, day: int, hour: float = 20.0,
             tz_offset_hours: float = 0.0) -> Dict:
    """The Hawaiian night for a date. Defaults to 20:00 local, since a night is reckoned
    from sunset and the civil date it begins on is the one people mean."""
    age = moon_age(year, month, day, hour, tz_offset_hours)
    idx = min(int(math.floor(age)), 29)
    name, anahulu, verdict = PO[idx]
    par = MARAMATAKA_PARALLELS.get(idx + 1)
    out = {
        "system": "Hawaiian moon calendar (ʻōlelo pō)",
        "night": idx + 1,
        "name": name,
        "anahulu": anahulu,
        "anahulu_meaning": ANAHULU[anahulu],
        "meaning": verdict,
        "moon_age_days": round(age, 3),
        "date": f"{int(year):04d}-{int(month):02d}-{int(day):02d}",
    }
    if par:
        out["maori_parallel"] = {
            "name": par[0], "meaning": par[1],
            "caveat": "Maramataka names and verdicts differ between iwi; this is one "
                      "widely published reckoning, offered as a parallel only.",
        }
    return out


def month_nights(year: int, month: int, day: int = 1,
                 tz_offset_hours: float = 0.0) -> List[Dict]:
    """The thirty nights of the lunation containing a date, with their civil dates."""
    import datetime
    start = datetime.date(int(year), int(month), int(day))
    age = moon_age(start.year, start.month, start.day, 20.0, tz_offset_hours)
    first = start - datetime.timedelta(days=int(math.floor(age)))
    out = []
    for i in range(30):
        d = first + datetime.timedelta(days=i)
        name, anahulu, verdict = PO[i]
        out.append({"night": i + 1, "name": name, "anahulu": anahulu,
                    "meaning": verdict, "date": d.isoformat()})
    return out


def birth(year: int, month: int, day: int, hour: float = 12.0,
          tz_offset_hours: float = 0.0) -> Dict:
    """The night of the moon a person was born under."""
    n = night_of(year, month, day, hour, tz_offset_hours)
    return {**n, "note": ("Polynesian moon reckoning is a working calendar for planting, "
                          "fishing and voyaging. The night of a birth is read as the "
                          "character of that night, which is how the tradition uses it.")}


assert len(PO) == 30, "the Hawaiian month has thirty nights"
assert set(a for _, a, _ in PO) == set(ANAHULU), "every night belongs to an anahulu"
assert [a for _, a, _ in PO].count("hoʻonui") == 10
assert [a for _, a, _ in PO].count("poepoe") == 10
assert [a for _, a, _ in PO].count("emi") == 10
