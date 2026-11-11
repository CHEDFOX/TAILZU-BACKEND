"""
DIVINATION — a registry of user-SELECTED reading systems, each a system-wise data file.

Every system exposes the same shape (TITLE, MEDIA_PREFIX, BACK, DECK, SPREADS,
DEFAULT_SPREAD, NOUN), so ONE generic feature router (app/services/features/divination.py)
and ONE frontend `deck` node serve them all. Adding a system = one data file here + one
line in SYSTEMS. Pure backend; the interaction philosophy is always "the user picks".
"""
from . import tarot, runes, ogham, lenormand, iching, geomancy

SYSTEMS = {
    "tarot": tarot,
    "runes": runes,
    "ogham": ogham,
    "lenormand": lenormand,
    "iching": iching,
    "geomancy": geomancy,
}


def get_system(sid: str):
    return SYSTEMS.get(sid)


def by_id(sid: str):
    m = SYSTEMS.get(sid)
    return {c["id"]: c for c in m.DECK} if m else {}
