"""
ABORIGINAL AUSTRALIAN SKY KNOWLEDGE — and the line this module will not cross.

The world's oldest continuous astronomical tradition, kept for tens of thousands of years
by hundreds of distinct nations with distinct languages and distinct skies. It belongs in
this index. It also cannot be treated the way the rest of the index treats its material,
and the reasons are specific rather than decorative:

  1. THERE IS NO "ABORIGINAL ASTROLOGY". Not a lost one — no such thing. This is seasonal,
     navigational and ceremonial knowledge: when to burn, when the eels run, when to
     travel, what the sky is telling you about the land. It does not read a person from
     a birth date, and there is no tradition here to compute one from. Anything sold as an
     "Aboriginal star sign" is fabrication.

  2. MUCH OF IT IS RESTRICTED. Knowledge is held by particular people, released at
     particular stages of initiation, and often specific to gender or to Country. Some of
     what has been published was published without consent. This module carries only
     material that the relevant communities have themselves put into the public domain —
     principally the seasonal calendars developed WITH communities by the CSIRO and by
     Aboriginal-led organisations, and the Emu in the Sky, which is widely and openly
     taught by Aboriginal astronomers.

  3. IT IS NOT ONE SYSTEM. The Yolŋu of Arnhem Land, the D'harawal of Sydney, the
     Boorong of Victoria and the Kaurna of Adelaide keep different calendars for different
     Country. Presenting a single "Aboriginal calendar" would erase exactly the diversity
     that makes it remarkable. The calendars here are named to their nations.

So: what is computed is the SEASON on a named nation's calendar, and the visibility of the
Emu — both of which are public, both of which are about land and sky rather than about a
person. Nothing here takes a birth date and returns a character.
"""
from dataclasses import dataclass
from typing import Dict

# ── D'harawal (Sydney basin) — six seasons, published by the D'harawal community ──
DHARAWAL = [
    ((1, 1), (2, 28), "Parra'dowee", "Great Eel time",
     "warm and wet; the eels are ready to journey to the sea. Time of Kai'arrey — the "
     "rain that must fall before the burrawang seeds are gathered"),
    ((3, 1), (4, 30), "Burran", "Kangaroo time",
     "hot and dry; the lillipilli fruit ripens. Men's business, and the time the "
     "boo'kerrikin flowers say the cold is coming"),
    ((5, 1), (6, 30), "Marrai'gang", "Quoll time",
     "wet and cooling; the marrai'gang cries for a mate. The lillipilli fruit is finished"),
    ((7, 1), (8, 31), "Burrugin", "Echidna time",
     "cold and short days; the echidnas move in trains. The burringoa flowers — do NOT "
     "eat shellfish now, a rule that tracks the poisonous algal blooms of the cold months"),
    ((9, 1), (10, 31), "Wiritjiribin", "Lyrebird time",
     "cold and windy becoming warm; the lyrebird sings and builds. The marrai'uo flowers, "
     "and the fish move into the rivers"),
    ((11, 1), (12, 31), "Ngoonungi", "Flying fox time",
     "warm and wet; the grey-headed flying foxes gather over Sydney at dusk. Ceremony time"),
]

# ── Yolŋu (north-east Arnhem Land) — six seasons ──
YOLNGU = [
    ((12, 1), (3, 31), "Bärra'mirri", "the growth season",
     "the north-west monsoon; heavy rain, everything grows, and travel is hard"),
    ((4, 1), (5, 31), "Mayaltha", "the flowering",
     "the rain eases and plants flower; the beginning of the dry"),
    ((6, 1), (6, 30), "Midawarr", "the fruiting / harvest",
     "cool and clear; fruits ripen and food is abundant"),
    ((7, 1), (8, 31), "Dharratharramirri", "the early dry",
     "cold nights and the south-east wind; burning begins, and the stringybark flowers"),
    ((9, 1), (10, 31), "Rarrandharr", "the main dry",
     "hot and dry; the hottest and driest stretch, and the time of ceremony"),
    ((11, 1), (11, 30), "Gunmul", "the build-up",
     "humid and still before the monsoon; thunder without rain"),
]

# ── Boorong (Wergaia, north-west Victoria) — a star-focused tradition ──
BOORONG_STARS = {
    "Neilloan": ("Vega", "the mallee-fowl. Its appearance in the sky tells when the mallee "
                 "hen is building her mound — a direct calendar for a food source"),
    "Warepil": ("Sirius", "the wedge-tailed eagle, and one of the great ancestral beings"),
    "Collowgullouric War": ("Eta Carinae", "the wife of Warepil. The Boorong recorded her "
                            "as a bright red star — Eta Carinae's 1843 outburst — which is "
                            "an observational record of a variable star made by people the "
                            "recording astronomer did not credit"),
    "Marpeankurrk": ("Arcturus", "she who found the wood-ant larvae; her appearance marks "
                     "when that food is available"),
    "Won": ("the Boomerang", "the constellation Corona Australis"),
    "Tourchingboiongerra": ("the Coalsack and nearby", "the two nesting birds"),
}


@dataclass
class Season:
    nation: str
    name: str
    english: str
    description: str


def _in_range(m: int, d: int, start, end) -> bool:
    (sm, sd), (em, ed) = start, end
    a, b, x = (sm, sd), (em, ed), (int(m), int(d))
    if a <= b:
        return a <= x <= b
    return x >= a or x <= b          # wraps the year


def season(month: int, day: int, nation: str = "dharawal") -> Dict:
    """The season on a named nation's calendar.

    Named to the nation deliberately — these are different calendars for different Country,
    not regional variants of one."""
    n = str(nation or "dharawal").lower()
    table, label, source = (
        (YOLNGU, "Yolŋu (north-east Arnhem Land)",
         "Published by Yolŋu communities with the Bureau of Meteorology's Indigenous "
         "Weather Knowledge project.")
        if n.startswith("yol") else
        (DHARAWAL, "D'harawal (Sydney basin)",
         "Published by the D'harawal community through Frances Bodkin's work.")
    )
    for start, end, name, english, desc in table:
        if _in_range(month, day, start, end):
            return {"system": "Aboriginal seasonal calendar", "nation": label,
                    "season": name, "english": english, "description": desc,
                    "source": source,
                    "note": ("A calendar of LAND and SKY, not of persons. It says what the "
                             "country is doing now — it does not describe someone born now.")}
    return {"system": "Aboriginal seasonal calendar", "nation": label,
            "season": None, "note": "date outside the tabulated ranges"}


def emu_in_the_sky(month: int) -> Dict:
    """The Emu in the Sky — the dark-cloud constellation in the Milky Way.

    The best-known piece of Aboriginal sky knowledge and openly taught, including by
    Aboriginal astronomers. It is a DARK constellation: the shape is the dust lanes between
    the stars, from the Coalsack as the head down through Scorpius. Its changing posture
    through the year is a calendar for emu breeding — when the emu appears to be running,
    the birds are laying; when it settles, the eggs are ready to collect."""
    m = int(month)
    if 4 <= m <= 6:
        posture, reading = ("running — the head and neck rise in the evening sky, body "
                            "trailing", "the emus are mating and laying; eggs are coming")
    elif 7 <= m <= 9:
        posture, reading = ("sitting — the emu appears settled on the horizon",
                            "the eggs are in the nest and ready to collect; the classic "
                            "signal, and the reason the constellation is a calendar")
    elif 10 <= m <= 12:
        posture, reading = ("low and fading — the body sinks toward the horizon",
                            "the chicks have hatched; the birds are raising them")
    else:
        posture, reading = ("faint — the emu is largely below the horizon in the evening",
                            "the quiet part of the cycle")
    return {"system": "Emu in the Sky (dark constellation)",
            "month": m, "posture": posture, "reading": reading,
            "what_it_is": ("A dark-cloud constellation: the figure is made of the dust "
                           "lanes in the Milky Way, not of stars. The head is the Coalsack, "
                           "beside the Southern Cross; the body and legs run through "
                           "Scorpius and Sagittarius."),
            "note": ("Openly taught, including by Aboriginal astronomers, which is why it "
                     "is included here. Read as a seasonal indicator for emu breeding, "
                     "which is what it is for.")}


def boorong_stars() -> Dict:
    """The Boorong star names, and the observational record they contain."""
    return {"system": "Boorong sky knowledge (Wergaia, north-west Victoria)",
            "stars": {k: {"identification": v[0], "meaning": v[1]}
                      for k, v in BOORONG_STARS.items()},
            "significance": ("The Boorong record of Collowgullouric War as a bright red "
                             "star is an observation of Eta Carinae during its 1843 "
                             "outburst — an astronomical record made by Aboriginal "
                             "observers and written down by William Stanbridge in 1857 "
                             "without their being credited as its source."),
            "note": "Recorded 1857; the Boorong themselves were dispossessed within a generation."}


def position() -> Dict:
    """Why this module computes seasons and not birth charts. Returned so the pipeline can
    say it rather than only having it in a docstring."""
    return {
        "system": "Aboriginal Australian sky knowledge",
        "computes": ["seasonal calendars for named nations", "the Emu in the Sky's "
                     "seasonal posture", "recorded Boorong star identifications"],
        "does_not_compute": "anything from a birth date",
        "why": ("There is no Aboriginal astrology to compute. This is seasonal, "
                "navigational and ceremonial knowledge about land and sky — not a system "
                "for reading a person. Any 'Aboriginal star sign' is invented."),
        "restriction": ("Much of this knowledge is held by particular people and released "
                        "through initiation, and some published material was published "
                        "without consent. Only material the relevant communities have "
                        "themselves made public is carried here."),
        "diversity": ("Hundreds of nations, hundreds of skies. The calendars are named to "
                      "their nations rather than merged, because merging them would erase "
                      "the thing that makes the tradition remarkable."),
    }


assert len(DHARAWAL) == 6 and len(YOLNGU) == 6
for _m in range(1, 13):
    assert season(_m, 15, "dharawal").get("season"), f"D'harawal has a gap at month {_m}"
    assert season(_m, 15, "yolngu").get("season"), f"Yolŋu has a gap at month {_m}"
