"""
AZTEC TONALPOHUALLI — the 260-day sacred calendar (20 day-signs × 13 numbers).

Alfonso Caso correlation: 13 August 1521 (Julian) = JD 2276827.5 = 1 Coatl (Serpent),
day-sign index 4. Verified against that anchor and the day after (2 Miquiztli). Uses the
same Julian-Day machinery as the Maya engine; JDN is calendar-independent, so a modern
Gregorian birth date maps correctly.
"""
from dataclasses import dataclass
from app.services.mayan.core import gregorian_to_jdn

ANCHOR_JDN = 2276827          # floor(2276827.5) — Caso anchor
ANCHOR_SIGN_INDEX = 4         # Coatl
ANCHOR_NUMBER = 1

# (Nahuatl, English, keyword seed) — the 20 day-signs in order.
DAY_SIGNS = [
    ("Cipactli", "Crocodile", "primal energy, the beginning, protective nurture"),
    ("Ehecatl", "Wind", "breath, movement, change, communication"),
    ("Calli", "House", "rest, reflection, the inner sanctuary"),
    ("Cuetzpalin", "Lizard", "survival, regeneration, agility"),
    ("Coatl", "Serpent", "life-force, transformation, wisdom"),
    ("Miquiztli", "Death", "transformation, the ancestors, release"),
    ("Mazatl", "Deer", "grace, sensitivity, the path"),
    ("Tochtli", "Rabbit", "fertility, abundance, playfulness, luck"),
    ("Atl", "Water", "emotion, purification, the flow"),
    ("Itzcuintli", "Dog", "loyalty, the guide, the companion"),
    ("Ozomatli", "Monkey", "play, art, joy, the trickster"),
    ("Malinalli", "Grass", "tenacity, resilience, healing"),
    ("Acatl", "Reed", "authority, directness, a channel for spirit"),
    ("Ocelotl", "Jaguar", "the warrior, the night, instinct, the shaman"),
    ("Cuauhtli", "Eagle", "vision, freedom, the higher view, courage"),
    ("Cozcacuauhtli", "Vulture", "long life, wisdom, cleansing, the elder"),
    ("Ollin", "Movement", "change, the turning, synchronicity"),
    ("Tecpatl", "Flint", "truth, the blade, cutting clarity"),
    ("Quiahuitl", "Rain", "renewal, fertility, sudden blessing"),
    ("Xochitl", "Flower", "beauty, art, love, the flowering soul"),
]


@dataclass
class Tonalpohualli:
    number: int          # 1..13
    sign: str            # Nahuatl
    sign_english: str
    sign_seed: str
    day: str             # "1 Coatl"
    jdn: int


def tonalpohualli(year: int, month: int, day: int) -> Tonalpohualli:
    jdn = gregorian_to_jdn(int(year), int(month), int(day))
    diff = jdn - ANCHOR_JDN
    sign_idx = (ANCHOR_SIGN_INDEX + diff) % 20
    number = (ANCHOR_NUMBER - 1 + diff) % 13 + 1
    sign, eng, seed = DAY_SIGNS[sign_idx]
    return Tonalpohualli(number=number, sign=sign, sign_english=eng, sign_seed=seed,
                         day=f"{number} {sign}", jdn=jdn)
