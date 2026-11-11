"""
EVOLUTIONARY ASTROLOGY (Jeff Green, Steven Forrest).

A modern school, not a technique: it uses ordinary tropical placements but reads them
through a specific frame — Pluto as the seat of the soul's evolutionary intention, the
lunar nodes as the past and the direction out of it, and the chart as a record of
unfinished business rather than a set of predictions.

Green and Forrest founded it jointly in the 1980s and later split over method, so
"evolutionary astrology" names two related schools rather than one. The split is recorded
because the two read the nodes differently and a user told only one framing is being given
half the field.

WHAT MAKES IT A DISTINCT SYSTEM AND NOT A STYLE
───────────────────────────────────────────────
Its claims are structural, not decorative:
  • Pluto's house and sign describe what the soul is working on across lifetimes
  • the South Node and its ruler describe the entrenched pattern
  • the North Node and its ruler describe the resolution, which is not a goal to achieve
    but a direction to move
  • Pluto's polarity point — the opposite degree — is the intended growth

It is emphatically NOT predictive, and it is the one school here that refuses prediction
on principle. Any consensus that includes it should carry that: it is not testimony about
what will happen.
"""
from typing import Dict, Optional

SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
         "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"]

TRADITIONAL_RULER = {"Aries": "Mars", "Taurus": "Venus", "Gemini": "Mercury",
                     "Cancer": "Moon", "Leo": "Sun", "Virgo": "Mercury",
                     "Libra": "Venus", "Scorpio": "Pluto", "Sagittarius": "Jupiter",
                     "Capricorn": "Saturn", "Aquarius": "Uranus", "Pisces": "Neptune"}

PLUTO_HOUSE = {
    1: "identity itself — the soul is working on how it shows up and asserts existence",
    2: "self-worth and resources — value that does not depend on what is owned",
    3: "mind and communication — how meaning is made and exchanged",
    4: "roots and belonging — the inherited emotional foundation",
    5: "creative selfhood — the right to be a particular person and be seen as one",
    6: "work and adjustment — service, health, and the humility of the ordinary",
    7: "the other — projection, partnership, and what is disowned into another person",
    8: "merging and loss — intimacy, shared resources, the material of transformation",
    9: "meaning and belief — the frameworks used to make life intelligible",
    10: "role and standing — the public function and its cost",
    11: "the collective — one's part in something larger, and alienation from it",
    12: "dissolution — the unconscious, surrender, and what cannot be controlled",
}

SOUTH_NODE = {
    "meaning": "the entrenched pattern — what is already deeply known and over-relied on",
    "warning": ("Not a past life to be reported as fact. Read as the pattern the person "
                "defaults to under pressure, which is checkable against their life; the "
                "past-life framing is the school's language, not a claim this platform "
                "makes about history."),
}
NORTH_NODE = {
    "meaning": "the direction out — unfamiliar, uncomfortable, and where growth is",
    "warning": ("Not a goal to be achieved and then finished. The school reads it as a "
                "direction of travel, and treating it as a destination misreads it."),
}


def _sign(lon: float) -> str:
    return SIGNS[int(float(lon) % 360 // 30)]


def polarity_point(longitude: float) -> Dict:
    """Pluto's polarity point — the opposite degree, read as the intended growth."""
    lon = float(longitude) % 360.0
    opp = (lon + 180.0) % 360.0
    return {"degree": round(opp, 4), "sign": _sign(opp),
            "meaning": ("The direction of the soul's intended movement, opposite the "
                        "entrenched Plutonian pattern.")}


def paradigm(pluto_lon: float, pluto_house: int,
             south_node_lon: float, south_node_house: int,
             north_node_house: Optional[int] = None,
             ruler_positions: Optional[Dict[str, Dict]] = None) -> Dict:
    """The evolutionary reading's four structural pieces."""
    p_sign = _sign(pluto_lon)
    sn_sign = _sign(south_node_lon)
    nn_sign = _sign(float(south_node_lon) + 180.0)
    nn_house = north_node_house or ((int(south_node_house) + 5) % 12) + 1

    out = {
        "pluto": {
            "sign": p_sign, "house": int(pluto_house),
            "evolutionary_intention": PLUTO_HOUSE.get(int(pluto_house), ""),
            "polarity_point": polarity_point(pluto_lon),
        },
        "south_node": {
            "sign": sn_sign, "house": int(south_node_house),
            "ruler": TRADITIONAL_RULER[sn_sign],
            **SOUTH_NODE,
        },
        "north_node": {
            "sign": nn_sign, "house": nn_house,
            "ruler": TRADITIONAL_RULER[nn_sign],
            **NORTH_NODE,
        },
        "schools": {
            "green": "Jeff Green — reads the nodes through Pluto's polarity as the "
                     "governing axis; more systematised, more explicitly reincarnational.",
            "forrest": "Steven Forrest — reads the nodal axis more independently and "
                       "frames past-life language as metaphor rather than claim.",
            "note": "The two split over method in the 1990s. Neither is the standard.",
        },
        "not_predictive": ("Evolutionary astrology declines prediction on principle — it "
                           "describes intention and pattern, not events. Do not admit it "
                           "as testimony about what will happen."),
    }
    if ruler_positions:
        for node in ("south_node", "north_node"):
            r = out[node]["ruler"]
            if r in ruler_positions:
                out[node]["ruler_position"] = ruler_positions[r]
    return out


assert len(PLUTO_HOUSE) == 12
assert polarity_point(0.0)["sign"] == "Libra"
assert _sign(0) == "Aries" and _sign(359) == "Pisces"
