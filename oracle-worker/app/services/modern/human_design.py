"""
HUMAN DESIGN and GENE KEYS — a 1987 synthesis, dated honestly.

Human Design maps the 64 I Ching hexagrams onto the zodiac, computes two charts (birth,
and a second at 88° of solar arc before it), and reads which of nine centres are DEFINED by
connected channels. From the defined centres come a Type, a Strategy and an Authority.

It composes four systems this platform already computes — the Yijing, the tropical chart,
the chakra scheme and the Kabbalistic tree — which is why it is cheap to build here and
expensive to build anywhere else.

ON PROVENANCE, WHICH MATTERS MORE HERE THAN ANYWHERE ELSE IN THE PLATFORM
────────────────────────────────────────────────────────────────────────
Human Design originates in a mystical experience reported by Alan Krishna Robert Kraków
(Ra Uru Hu) on Ibiza in January 1987. That is its actual origin and the system does not
hide it — but presentations of it routinely imply ancient descent it does not have, by
listing the four traditions it borrows from as though it came down through them.

It did not. It is a modern synthesis, thirty-eight years old, and saying so plainly costs
nothing and is a differentiator in a field that usually blurs exactly this. The provenance
entry records the 1987 date and the revelatory origin as fact, without endorsing or
dismissing either.

THE GATE WHEEL
──────────────
The mandala anchors gate 41 at the start of its sequence and the 64 gates each span
5.625° (360/64), subdivided into 6 lines of 0.9375°. The wheel order below is asserted at
import to be a permutation of 1-64 — that catches a corrupted table, but it does NOT
verify the ORDER against an official source, which a user relying on this should do.
"""
from typing import Dict, List, Set, Tuple

GATE_SPAN = 360.0 / 64.0        # 5.625°
LINE_SPAN = GATE_SPAN / 6.0     # 0.9375°
DESIGN_ARC = 88.0               # degrees of solar arc before birth

# The mandala order, beginning where gate 41 begins.
WHEEL = [41, 19, 13, 49, 30, 55, 37, 63, 22, 36,
         25, 17, 21, 51, 42, 3, 27, 24, 2, 23,
         8, 20, 16, 35, 45, 12, 15, 52, 39, 53,
         62, 56, 31, 33, 7, 4, 29, 59, 40, 64,
         47, 6, 46, 18, 48, 57, 32, 50, 28, 44,
         1, 43, 14, 34, 9, 5, 26, 11, 10, 58,
         38, 54, 61, 60]
assert sorted(WHEEL) == list(range(1, 65)), "gate wheel is not a permutation of 1–64"

# Where gate 41 begins, in tropical longitude. ~2° Aquarius.
WHEEL_START = 302.0

CENTERS = {
    "head": ("Head / Crown", "pressure to make sense of things — inspiration and doubt"),
    "ajna": ("Ajna", "conceptualising — how the mind processes and holds certainty"),
    "throat": ("Throat", "expression and manifestation — everything funnels here"),
    "g": ("G / Identity", "direction and love — who one is and where one is going"),
    "heart": ("Heart / Ego", "willpower and worth — the only centre that can promise"),
    "spleen": ("Spleen", "instinct, immunity, survival — awareness in the present moment"),
    "sacral": ("Sacral", "life force and work capacity — the motor that responds"),
    "solar": ("Solar Plexus", "emotion as a wave — clarity comes over time, never at once"),
    "root": ("Root", "adrenalised pressure — stress, drive, the urge to be done"),
}

GATE_CENTER = {}
for _c, _gates in {
    "head": [64, 61, 63],
    "ajna": [47, 24, 4, 17, 43, 11],
    "throat": [62, 23, 56, 35, 12, 45, 33, 8, 31, 20, 16],
    "g": [7, 1, 13, 25, 46, 2, 15, 10],
    "heart": [21, 40, 26, 51],
    "spleen": [48, 57, 44, 50, 32, 28, 18],
    "sacral": [34, 5, 14, 29, 59, 9, 3, 42, 27],
    "solar": [6, 37, 22, 36, 30, 55, 49],
    "root": [53, 60, 52, 19, 39, 41, 58, 38, 54],
}.items():
    for _g in _gates:
        GATE_CENTER[_g] = _c
assert len(GATE_CENTER) == 64, f"gate→centre map covers {len(GATE_CENTER)}, expected 64"

CHANNELS = [
    (1, 8, "Inspiration"), (2, 14, "The Beat"), (3, 60, "Mutation"), (4, 63, "Logic"),
    (5, 15, "Rhythm"), (6, 59, "Mating"), (7, 31, "The Alpha"), (9, 52, "Concentration"),
    (10, 20, "Awakening"), (10, 34, "Exploration"), (10, 57, "Perfected Form"),
    (11, 56, "Curiosity"), (12, 22, "Openness"), (13, 33, "The Prodigal"),
    (16, 48, "The Wavelength"), (17, 62, "Acceptance"), (18, 58, "Judgment"),
    (19, 49, "Synthesis"), (20, 34, "Charisma"), (20, 57, "The Brain Wave"),
    (21, 45, "Money"), (23, 43, "Structuring"), (24, 61, "Awareness"),
    (25, 51, "Initiation"), (26, 44, "Surrender"), (27, 50, "Preservation"),
    (28, 38, "Struggle"), (29, 46, "Discovery"), (30, 41, "Recognition"),
    (32, 54, "Transformation"), (34, 57, "Power"), (35, 36, "Transitoriness"),
    (37, 40, "Community"), (39, 55, "Emoting"), (42, 53, "Maturation"),
    (47, 64, "Abstraction"),
]
assert len(CHANNELS) == 36, f"{len(CHANNELS)} channels, expected 36"

MOTORS = {"sacral", "heart", "solar", "root"}

PROFILE_LINES = {
    1: ("Investigator", "needs a foundation; researches until secure"),
    2: ("Hermit", "natural talent that emerges when called out of seclusion"),
    3: ("Martyr", "learns by trial and error; discovery through what does not work"),
    4: ("Opportunist", "moves through network and friendship; influence by relationship"),
    5: ("Heretic", "projected upon; expected to provide practical solutions"),
    6: ("Role Model", "lives in three phases, becoming an example in the third"),
}


def gate_of(longitude: float) -> Dict:
    """Gate and line for a tropical longitude."""
    lon = (float(longitude) - WHEEL_START) % 360.0
    idx = int(lon // GATE_SPAN)
    within = lon - idx * GATE_SPAN
    line = int(within // LINE_SPAN) + 1
    gate = WHEEL[idx]
    return {"gate": gate, "line": min(line, 6), "center": GATE_CENTER[gate],
            "degrees_into_gate": round(within, 4)}


def defined_centers(gates: Set[int]) -> Dict:
    """Which centres are defined, and by which channels."""
    active = set(gates)
    made = [(a, b, n) for a, b, n in CHANNELS if a in active and b in active]
    defined = set()
    for a, b, _ in made:
        defined.add(GATE_CENTER[a])
        defined.add(GATE_CENTER[b])
    return {
        "defined": sorted(defined),
        "undefined": sorted(set(CENTERS) - defined),
        "channels": [{"gates": [a, b], "name": n,
                      "connects": [GATE_CENTER[a], GATE_CENTER[b]]}
                     for a, b, n in made],
    }


def _connected_to_throat(made: List[Tuple], start: str) -> bool:
    """Is a centre linked to the throat through defined channels?"""
    adj: Dict[str, Set[str]] = {}
    for a, b, _ in made:
        ca, cb = GATE_CENTER[a], GATE_CENTER[b]
        adj.setdefault(ca, set()).add(cb)
        adj.setdefault(cb, set()).add(ca)
    seen, stack = set(), [start]
    while stack:
        c = stack.pop()
        if c == "throat":
            return True
        if c in seen:
            continue
        seen.add(c)
        stack.extend(adj.get(c, ()))
    return False


def hd_type(gates: Set[int]) -> Dict:
    """Type, strategy and authority from the defined centres."""
    d = defined_centers(gates)
    defined = set(d["defined"])
    made = [(a, b, n) for a, b, n in CHANNELS if a in gates and b in gates]

    if not defined:
        t, strategy = "Reflector", "wait a full lunar cycle before deciding"
    elif "sacral" in defined:
        motor_to_throat = any(_connected_to_throat(made, m)
                              for m in MOTORS & defined)
        if motor_to_throat and "throat" in defined:
            t, strategy = ("Manifesting Generator",
                           "respond first, then inform before acting")
        else:
            t, strategy = "Generator", "wait to respond"
    else:
        motor_to_throat = any(_connected_to_throat(made, m) for m in MOTORS & defined)
        if motor_to_throat and "throat" in defined:
            t, strategy = "Manifestor", "inform before you act"
        else:
            t, strategy = "Projector", "wait for the invitation"

    # Authority, in the fixed hierarchy.
    if "solar" in defined:
        auth = ("Emotional", "no truth in the moment — wait out the wave before deciding")
    elif "sacral" in defined:
        auth = ("Sacral", "the gut response in the moment, before the mind speaks")
    elif "spleen" in defined:
        auth = ("Splenic", "the first quiet instinct; it speaks once and does not repeat")
    elif "heart" in defined:
        auth = ("Ego", "what one genuinely has the will for")
    elif "g" in defined:
        auth = ("Self-Projected", "hear your own direction by speaking it aloud")
    elif t == "Reflector":
        auth = ("Lunar", "a full 28-day cycle, and trusted company to talk it through")
    else:
        auth = ("Mental/Environmental", "clarity comes from the right environment and from "
                                        "talking, not from deciding alone")

    return {
        "type": t, "strategy": strategy,
        "authority": auth[0], "authority_detail": auth[1],
        "defined_centers": d["defined"], "undefined_centers": d["undefined"],
        "channels": d["channels"],
        "definition_count": len(d["defined"]),
    }


def profile(personality_sun_line: int, design_sun_line: int) -> Dict:
    p, d = int(personality_sun_line), int(design_sun_line)
    pn, pg = PROFILE_LINES.get(p, ("?", ""))
    dn, dg = PROFILE_LINES.get(d, ("?", ""))
    return {"profile": f"{p}/{d}", "personality": {"line": p, "name": pn, "meaning": pg},
            "design": {"line": d, "name": dn, "meaning": dg}}


def chart(personality_longitudes: Dict[str, float],
          design_longitudes: Dict[str, float]) -> Dict:
    """Full bodygraph from two sets of longitudes.

    The design set must be computed at 88° of SOLAR ARC before birth — roughly 88 days,
    but the arc is what defines it, not the day count."""
    p_gates = {k: gate_of(v) for k, v in (personality_longitudes or {}).items()}
    d_gates = {k: gate_of(v) for k, v in (design_longitudes or {}).items()}
    all_gates = {g["gate"] for g in p_gates.values()} | {g["gate"] for g in d_gates.values()}

    t = hd_type(all_gates)
    prof = None
    if "sun" in p_gates and "sun" in d_gates:
        prof = profile(p_gates["sun"]["line"], d_gates["sun"]["line"])

    return {
        "personality": p_gates, "design": d_gates,
        "active_gates": sorted(all_gates),
        **t,
        "profile": prof,
        "provenance": ("Human Design was formulated by Ra Uru Hu (Alan Krishna Robert "
                       "Kraków) following a reported mystical experience on Ibiza in "
                       "January 1987. It borrows from the Yijing, tropical astrology, the "
                       "chakra system and Kabbalah, but it does not descend from them — "
                       "it is a modern synthesis, and presentations implying ancient "
                       "lineage are inaccurate."),
        "design_arc": DESIGN_ARC,
    }


# ═══════════════════════════════════════════════════════════════════════════
# GENE KEYS
# ═══════════════════════════════════════════════════════════════════════════

GENE_KEYS_NOTE = (
    "Gene Keys (Richard Rudd, 2009) uses the SAME 64 gates and the same two charts as "
    "Human Design, from which it directly derives — Rudd was a Human Design student. Its "
    "contribution is the three-level reading of each key (Shadow / Gift / Siddhi) and the "
    "sequences built from specific gate positions. It is NOT independent testimony from "
    "Human Design and must never be counted as a second system agreeing."
)

GENE_KEY_SPHERES = [
    ("life_work", "Personality Sun", "how you are here to work and be seen"),
    ("evolution", "Personality Earth", "the challenge that drives your growth"),
    ("radiance", "Design Sun", "your physical health and vitality"),
    ("purpose", "Design Earth", "the ground beneath everything else"),
]


def gene_keys(personality: Dict[str, Dict], design: Dict[str, Dict]) -> Dict:
    """The four primary spheres of the Activation Sequence."""
    out = []
    for key, source, meaning in GENE_KEY_SPHERES:
        src = personality if source.startswith("Personality") else design
        body = "sun" if source.endswith("Sun") else "earth"
        g = src.get(body)
        if g:
            out.append({"sphere": key, "from": source, "meaning": meaning,
                        "gate": g["gate"], "line": g["line"]})
    return {"spheres": out, "levels": ["Shadow", "Gift", "Siddhi"],
            "note": GENE_KEYS_NOTE}
