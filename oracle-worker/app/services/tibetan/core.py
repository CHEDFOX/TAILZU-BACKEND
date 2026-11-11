"""
TIBETAN ASTROLOGY — the birth-year sign (element · gender · animal · Rabjung cycle).

Reproduces the vedika-io/xalen-ephemeris Rabjung computation (60-year cycle from 1027
CE = Fire-Female-Hare). VERIFIED against its anchors: 1027 = Fire-Female-Hare (Rabjung 1),
2024 = Wood-Male-Dragon. Animal from the 12-cycle (index 0 = Hare); element/gender from
the sexagenary stem (year-4)%10.
"""
from dataclasses import dataclass

ANIMALS = [
    ("Hare", "gentle, artistic, diplomatic, sensitive"),
    ("Dragon", "powerful, visionary, charismatic, proud"),
    ("Snake", "wise, intuitive, private, transformative"),
    ("Horse", "free, energetic, independent, restless"),
    ("Sheep", "kind, creative, gentle, empathic"),
    ("Monkey", "clever, playful, inventive, quick"),
    ("Bird", "sharp, proud, precise, expressive"),
    ("Dog", "loyal, honest, protective, just"),
    ("Pig", "generous, sincere, steadfast, warm"),
    ("Mouse", "resourceful, charming, shrewd, adaptable"),
    ("Ox", "patient, dependable, strong, methodical"),
    ("Tiger", "bold, passionate, courageous, rebellious"),
]
ELEMENTS = [
    ("Wood", "growth, flexibility, vision, compassion"),
    ("Fire", "warmth, brilliance, transformation, passion"),
    ("Earth", "stability, nourishment, patience, grounding"),
    ("Iron", "strength, precision, clarity, resolve"),
    ("Water", "depth, adaptability, wisdom, flow"),
]


@dataclass
class TibetanYear:
    element: str
    element_seed: str
    gender: str          # Male / Female
    animal: str
    animal_seed: str
    rabjung_cycle: int   # 1-based
    year_in_cycle: int   # 1..60
    sign: str            # "Fire Female Hare"


def tibetan_year(year: int) -> TibetanYear:
    y = int(year)
    offset = (y - 1027) % 60
    rabjung = (y - 1027) // 60 + 1
    animal, aseed = ANIMALS[offset % 12]
    stem_idx = (y - 4) % 10
    element, eseed = ELEMENTS[stem_idx // 2]
    gender = "Male" if stem_idx % 2 == 0 else "Female"
    return TibetanYear(element=element, element_seed=eseed, gender=gender, animal=animal,
                       animal_seed=aseed, rabjung_cycle=rabjung, year_in_cycle=offset + 1,
                       sign=f"{element} {gender} {animal}")


def full(year: int, gender: str = "male", for_year=None) -> dict:
    """Everything Tibetan practice reads for a birth year, from both halves of it.

    The Rabjung cycle and the year's gender live here; the mewa, the parkha and the five
    forces live in `regional.tibetan_thai`, which is where the deeper nag-rtsis layer was
    built. Neither module is wrong and neither is complete, so callers that want a whole
    reading had to know to make two calls and merge them. This is that merge, in one place.
    """
    t = tibetan_year(year)
    out = {
        "year": int(year), "sign": t.sign, "animal": t.animal, "element": t.element,
        "gender": t.gender, "rabjung_cycle": t.rabjung_cycle,
        "year_in_cycle": t.year_in_cycle,
        "animal_seed": t.animal_seed, "element_seed": t.element_seed,
    }
    try:
        from app.services.regional.tibetan_thai import tibetan_year as _deep, five_forces
        d = _deep(int(year), gender)
        out["mewa"] = d.get("mewa")
        out["parkha"] = d.get("parkha")
        out["forces"] = five_forces(int(year), for_year)
        out["caveat"] = d.get("caveat")
        out["anchors"] = d.get("anchors")
    except Exception:
        # The year sign alone is still a valid, verified reading; the deeper layer
        # dropping out should not take it down with it.
        pass
    return out
