"""
ALCHEMY — the Great Work as a birth lens (psychological / symbolic, not literal).

The seven metals are the seven classical planets; the Great Work is the transmutation
of the base metal (the prima materia you're born with — your chart ruler) into GOLD (the
realised Self, the Sun). The operation you're working is read from the element of your
Sun. All correspondences are the canonical ones (metal↔planet, the seven operations, the
four colour phases of the opus).
"""
from datetime import datetime

# planet → (metal, seed) — the canonical seven metals of the seven planets.
METALS = {
    "Saturn":  ("Lead",       "the heavy prima materia — limitation, density, the weight to be redeemed"),
    "Jupiter": ("Tin",        "expansion, benevolence, the metal of growth and fortune"),
    "Mars":    ("Iron",       "will and edge — forged in fire, the metal of the warrior"),
    "Sun":     ("Gold",       "the incorruptible Self — the goal of the whole Work"),
    "Venus":   ("Copper",     "love and beauty, the conductive heart, Aphrodite's metal"),
    "Mercury": ("Quicksilver","the fluid mind — the spirit that dissolves and unites, Mercurius himself"),
    "Moon":    ("Silver",     "the reflective soul — the lunar water, feeling and dream"),
}

# The seven operations of the opus, in order, with the colour phase each belongs to.
OPERATIONS = [
    ("Calcination",  "Nigredo (blackening)", "burning away ego and dross in the fire of trial"),
    ("Dissolution",  "Nigredo (blackening)", "letting the ashes dissolve in water — surrender, the wash of feeling"),
    ("Separation",   "Albedo (whitening)",   "sifting the true from the false, keeping only what is real"),
    ("Conjunction",  "Albedo (whitening)",   "the inner marriage — opposites reunited into a new whole"),
    ("Fermentation", "Citrinitas (yellowing)","new life stirs in the matter — inspiration, the spark returns"),
    ("Distillation", "Citrinitas (yellowing)","raising and refining the essence again and again"),
    ("Coagulation",  "Rubedo (reddening)",   "the Self made solid and real — the gold, the stone, the wedding"),
]

# Traditional (seven-planet) rulership of each sign → the person's base metal-planet.
_SIGN_RULER = {
    "Aries": "Mars", "Taurus": "Venus", "Gemini": "Mercury", "Cancer": "Moon",
    "Leo": "Sun", "Virgo": "Mercury", "Libra": "Venus", "Scorpio": "Mars",
    "Sagittarius": "Jupiter", "Capricorn": "Saturn", "Aquarius": "Saturn", "Pisces": "Jupiter",
}

_ELEMENT = {
    "Aries": "Fire", "Leo": "Fire", "Sagittarius": "Fire",
    "Taurus": "Earth", "Virgo": "Earth", "Capricorn": "Earth",
    "Gemini": "Air", "Libra": "Air", "Aquarius": "Air",
    "Cancer": "Water", "Scorpio": "Water", "Pisces": "Water",
}
# The element of the Sun points to the operation now most alive.
_ELEMENT_OP = {"Fire": 0, "Water": 1, "Air": 5, "Earth": 6}   # index into OPERATIONS


class AlchemyReading:
    def __init__(self, planet, metal, metal_seed, operation, sun_sign, asc_sign):
        self.planet = planet
        self.metal = metal
        self.metal_seed = metal_seed
        self.operation = operation      # (name, phase, seed)
        self.sun_sign = sun_sign
        self.asc_sign = asc_sign


def alchemy(year, month, day, hour=12, minute=0, lat=28.6, lng=77.2):
    from app.services.western.chart import WesternChart, SIGNS
    ch = WesternChart(datetime(int(year), int(month), int(day), int(hour), int(minute)),
                      float(lat), float(lng))
    ch._ensure_calculated()
    asc_sign = SIGNS[int(ch._ascendant // 30)]
    sun_sign = (ch._planets.get("Sun", {}) or {}).get("sign", "Leo")
    planet = _SIGN_RULER.get(asc_sign, "Sun")
    metal, seed = METALS[planet]
    op = OPERATIONS[_ELEMENT_OP.get(_ELEMENT.get(sun_sign, "Fire"), 0)]
    return AlchemyReading(planet, metal, seed, op, sun_sign, asc_sign)


if __name__ == "__main__":
    r = alchemy(1990, 5, 15, 10, 30, 28.61, 77.20)
    print(f"base metal: {r.metal} ({r.planet}) | operation: {r.operation[0]} — {r.operation[1]}")
    print(f"asc {r.asc_sign} · sun {r.sun_sign}")
    assert len(METALS) == 7 and len(OPERATIONS) == 7
    print("structure OK")
