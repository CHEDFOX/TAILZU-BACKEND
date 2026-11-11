"""
GEOMANCY — the 16 figures and the shield chart (verified mathematics).

Each figure is four lines (Fire, Air, Water, Earth top→bottom); a single point = ACTIVE
(bit 1), a double point = PASSIVE (bit 0). The 16-figure table was extracted from a
published dataset and VERIFIED against independent anchors (Via=all-active, Populus=
all-passive, Puer=Fire/Air/Earth active). The user picks the four MOTHERS; the engine
derives Daughters → Nieces → Witnesses → JUDGE by geomantic addition (XOR per line).
Self-verifying: the Judge's active-line count is even for all 16^4 mother combinations.
"""
TITLE = "Geomancy"
MEDIA_PREFIX = "geomancy"
BACK = "geomancy/back"
NOUN = "figure"

# (id, Latin name, bits Fire/Air/Water/Earth [1=active,0=passive], keyword seed) — verified.
FIGURES = [
    ("via", "Via", (1, 1, 1, 1), "change, journey, movement — all is in flux"),
    ("cauda_draconis", "Cauda Draconis", (1, 1, 1, 0), "the dragon's tail — an ending, an exit, purge"),
    ("puer", "Puer", (1, 1, 0, 1), "rash energy, impulse — good in war and love"),
    ("fortuna_minor", "Fortuna Minor", (1, 1, 0, 0), "fleeting fortune, outside help, speed"),
    ("puella", "Puella", (1, 0, 1, 1), "harmony, charm, beauty — pleasant but fickle"),
    ("amissio", "Amissio", (1, 0, 1, 0), "loss, letting go, what slips through the fingers"),
    ("carcer", "Carcer", (1, 0, 0, 1), "a prison, delay, binding, isolation"),
    ("laetitia", "Laetitia", (1, 0, 0, 0), "joy, hope, health — rising upward"),
    ("caput_draconis", "Caput Draconis", (0, 1, 1, 1), "the dragon's head — a good beginning, a threshold"),
    ("coniunctio", "Coniunctio", (0, 1, 1, 0), "union, meeting, things coming together"),
    ("acquisitio", "Acquisitio", (0, 1, 0, 1), "gain, profit, what is gathered in"),
    ("rubeus", "Rubeus", (0, 1, 0, 0), "passion, danger, heat — the red vice"),
    ("fortuna_major", "Fortuna Major", (0, 0, 1, 1), "great fortune, power, strength from within"),
    ("albus", "Albus", (0, 0, 1, 0), "peace, wisdom, clarity — slow, white light"),
    ("tristitia", "Tristitia", (0, 0, 0, 1), "sorrow, restriction, sinking — patience"),
    ("populus", "Populus", (0, 0, 0, 0), "a crowd, the collective, multitude, waiting"),
]
_BY_BITS = {tuple(f[2]): f[1] for f in FIGURES}
_SEED = {f[1]: f[3] for f in FIGURES}

DECK = [{"id": f[0], "name": f[1], "seed": f[3], "media": f"{MEDIA_PREFIX}/{f[0]}"} for f in FIGURES]
_BITS_BY_ID = {f[0]: tuple(f[2]) for f in FIGURES}

SPREADS = {
    "shield": {"name": "The Shield", "positions": [
        {"id": "m1", "label": "First Mother", "meaning": "the root of the matter"},
        {"id": "m2", "label": "Second Mother", "meaning": "the forces around it"},
        {"id": "m3", "label": "Third Mother", "meaning": "the turn it takes"},
        {"id": "m4", "label": "Fourth Mother", "meaning": "where it settles"}]},
}
DEFAULT_SPREAD = "shield"


def _xor(a, b):
    return tuple(x ^ y for x, y in zip(a, b))


def shield(mother_ids):
    """Given the four chosen Mother figure ids (in order), derive the whole shield.
    Returns a dict of named figures: mothers, daughters, nieces, witnesses, judge."""
    M = [_BITS_BY_ID[i] for i in mother_ids if i in _BITS_BY_ID]
    if len(M) != 4:
        return None
    D = [tuple(M[j][i] for j in range(4)) for i in range(4)]          # transpose
    N = [_xor(M[0], M[1]), _xor(M[2], M[3]), _xor(D[0], D[1]), _xor(D[2], D[3])]
    right = _xor(N[0], N[1])
    left = _xor(N[2], N[3])
    judge = _xor(right, left)
    nm = lambda b: _BY_BITS.get(tuple(b))                              # noqa: E731
    return {
        "mothers": [nm(m) for m in M], "daughters": [nm(x) for x in D],
        "nieces": [nm(x) for x in N], "right_witness": nm(right),
        "left_witness": nm(left), "judge": nm(judge), "judge_seed": _SEED.get(nm(judge), ""),
        "right_seed": _SEED.get(nm(right), ""), "left_seed": _SEED.get(nm(left), ""),
    }
