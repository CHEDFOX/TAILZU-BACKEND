"""
ANDEAN / INCA RECKONING — the wata, its twelve months, and the three worlds.

WHAT IS HONESTLY KNOWN, STATED FIRST
────────────────────────────────────
The Inca kept no writing the Spanish could read, and the calendar was recorded only after
the conquest, by chroniclers — Guaman Poma, Cobo, Polo de Ondegardo, Betanzos — who
disagree with each other. The twelve month-names and their festivals are well attested and
consistent across those sources. The FINER structure is not: the ceque system of 328
huacas radiating from the Qorikancha almost certainly encoded a ritual calendar, but its
reconstruction (Zuidema's, chiefly) is contested and cannot be computed with confidence.

So this module gives the month, the festival, the agricultural work and the solar anchors —
all attested — and does NOT invent a natal doctrine. There is no securely recorded Inca
system of reading a person's character from their birth date, and asserting one would be
manufacturing a tradition rather than computing one. What a birth gets here is the season
it arrived in and the world-layer scheme, which is what the sources actually support.

THE SOLAR ANCHORS ARE REAL
The Inca tracked the solstices with the sucanca — pillars on the horizon above Cusco —
precisely enough to time the state festivals by them. Those are computed here from actual
solar longitude rather than assigned to fixed dates, which is the one part of this that
can be made exact. Note the hemisphere: the June solstice is midwinter in Cusco, and Inti
Raymi is a MIDWINTER festival, not a midsummer one.
"""
from dataclasses import dataclass
from typing import Dict, Optional

# (quechua, gloss, gregorian month, festival, agricultural work)
MONTHS = [
    ("Qhapaq Raymi", "the magnificent festival", 12,
     "the great festival of the Sun; the huarachikuy, initiation of noble youths",
     "young maize tended; the rains established"),
    ("Kamay", "the month of penance", 1,
     "fasting and penance; the ritual scattering of ashes into the rivers",
     "maize hilled and guarded against frost"),
    ("Hatun Pukuy", "the great ripening", 2,
     "offerings of gold and silver to the huacas",
     "the crops swell; the heaviest rains"),
    ("Pacha Pukuy", "the earth ripening", 3,
     "sacrifice of brown llamas; flowers offered",
     "the earth at its greenest; first fruits appear"),
    ("Ayriwa", "the dance of the young maize", 4,
     "Inka Raymi; the ripe maize honoured with song",
     "maize ripens and is guarded from birds"),
    ("Aymuray", "the harvest song", 5,
     "the maize carried home in procession; the harvest festival",
     "the great harvest; storehouses filled"),
    ("Inti Raymi", "the festival of the Sun", 6,
     "the greatest festival — the MIDWINTER solstice, when the Sun is called back",
     "fields rest; the ground is turned"),
    ("Anta Sitwa", "the copper festival", 7,
     "land redistributed; irrigation canals cleaned and blessed",
     "the driest month; ground prepared for sowing"),
    ("Qhapaq Sitwa", "the solemn purification", 8,
     "sacrifices for a good sowing; the earth opened",
     "the sowing begins — the most important agricultural month"),
    ("Quya Raymi", "the festival of the Queen", 9,
     "the Sitwa purification — sickness driven from Cusco by torchlight",
     "sowing continues; the first rains awaited"),
    ("Uma Raymi", "the festival of water", 10,
     "the rain-calling; black llamas tethered without food to weep for rain",
     "the rains must come or the year fails"),
    ("Ayamarka", "the carrying of the dead", 11,
     "the ancestors brought out, fed and paraded; the festival of the dead",
     "the rains arrive; the young maize is planted"),
]

# The three worlds of Andean cosmology, and the animal that carries each.
PACHA = [
    ("Hanan Pacha", "the world above", "Kuntur — the condor",
     "the upper world of the sun, moon and stars; what is aspired to and what watches"),
    ("Kay Pacha", "this world", "Puma — the puma",
     "the present world of the living; strength, action, the here and now"),
    ("Uku Pacha", "the world within", "Amaru — the serpent",
     "the inner and lower world of the dead, the seed and the root; memory and origin"),
]

SUYUS = [
    ("Chinchaysuyu", "northwest", "the jaguar quarter — trade, the coast, expansion"),
    ("Antisuyu", "northeast", "the forest quarter — the Amazon, the wild, the unknown"),
    ("Qullasuyu", "southeast", "the altiplano quarter — herds, silver, endurance"),
    ("Kuntisuyu", "southwest", "the ocean quarter — the desert coast, the setting sun"),
]

PRINCIPLES = {
    "ayni": "reciprocity — nothing is given that is not returned; the debt that binds a community",
    "minka": "collective work — the labour a community owes itself",
    "yanantin": "complementary opposition — pairs that need each other to be whole, not to be resolved",
    "pachakuti": "the turning over of world and time — upheaval that resets the order",
}


@dataclass
class AndeanDate:
    month_name: str
    month_gloss: str
    festival: str
    agriculture: str
    index: int
    solar_note: str
    days_to_solstice: Optional[int]

    def as_dict(self) -> Dict:
        return {"system": "Andean / Inca (wata)", "month": self.month_name,
                "meaning": self.month_gloss, "festival": self.festival,
                "agriculture": self.agriculture, "month_index": self.index + 1,
                "solar": self.solar_note, "days_to_next_solstice": self.days_to_solstice}


def _solstice_days(year: int) -> Dict[str, int]:
    """Integer day numbers of the year's solstices and equinoxes, from real solar
    longitude rather than fixed dates."""
    from app.services.chinese.lunisolar import solar_term_jd, jd_to_gregorian
    import math
    out = {}
    for key, lon in (("march_equinox", 0.0), ("june_solstice", 90.0),
                     ("september_equinox", 180.0), ("december_solstice", 270.0)):
        jd = solar_term_jd(int(year), lon)
        while jd_to_gregorian(jd)[0] < int(year):
            jd += 365.2422
        while jd_to_gregorian(jd)[0] > int(year):
            jd -= 365.2422
        out[key] = int(math.floor(jd + 0.5))
    return out


def andean_date(year: int, month: int, day: int) -> AndeanDate:
    """The Inca month for a civil date, with its solar position.

    The month/Gregorian correspondence is the Guaman Poma alignment, which is the one
    most consistently attested. Chroniclers differ by up to a month on where the year
    begins, so this is a stated alignment rather than a certainty."""
    from app.services.chinese.lunisolar import gregorian_to_jd
    import math
    idx = next(i for i, m in enumerate(MONTHS) if m[2] == int(month))
    q, gloss, _, festival, agri = MONTHS[idx]

    jd = int(math.floor(gregorian_to_jd(int(year), int(month), int(day)) + 0.5))
    sol = _solstice_days(int(year))
    nxt = min((v - jd for v in sol.values() if v >= jd), default=None)
    if nxt is None:
        nxt = min(v - jd for v in _solstice_days(int(year) + 1).values())

    near = min(sol.items(), key=lambda kv: abs(kv[1] - jd))
    delta = jd - near[1]
    when = "on" if delta == 0 else (f"{abs(delta)} days after" if delta > 0
                                    else f"{abs(delta)} days before")
    note = (f"{when} the {near[0].replace('_', ' ')} — "
            + ("midwinter in the Andes, when Inti Raymi calls the Sun back"
               if near[0] == "june_solstice" else
               "midsummer in the Andes, the season of Qhapaq Raymi"
               if near[0] == "december_solstice" else
               "an equinox, marked at Cusco by the sucanca pillars"))
    return AndeanDate(month_name=q, month_gloss=gloss, festival=festival,
                      agriculture=agri, index=idx, solar_note=note,
                      days_to_solstice=int(nxt))


def birth(year: int, month: int, day: int) -> Dict:
    """The Andean reading of a birth date — the season it arrived in, and the world-layers.

    Deliberately not a character reading. No securely recorded Inca doctrine reads
    personality from a birth date, and inventing one to fill the slot would be the
    opposite of what this platform is for."""
    d = andean_date(year, month, day)
    return {
        **d.as_dict(),
        "three_worlds": [{"name": n, "gloss": g, "animal": a, "meaning": m}
                         for n, g, a, m in PACHA],
        "suyus": [{"name": n, "direction": dd, "meaning": m} for n, dd, m in SUYUS],
        "principles": PRINCIPLES,
        "caveat": ("The Inca calendar survives only through post-conquest chroniclers who "
                   "disagree on where the year begins. The months and festivals are well "
                   "attested; the ceque ritual calendar is reconstructed and contested. "
                   "There is no recorded Inca natal astrology, so none is offered here."),
    }


assert len(MONTHS) == 12
assert sorted(m[2] for m in MONTHS) == list(range(1, 13)), "each Gregorian month maps once"
