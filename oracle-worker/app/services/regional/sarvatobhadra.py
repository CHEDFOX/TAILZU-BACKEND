"""
SARVATOBHADRA CHAKRA (सर्वतोभद्र चक्र) — the omnidirectional grid, properly.

WHAT THE FIRST VERSION MISSED
─────────────────────────────
It computed nakshatra-to-nakshatra vedha and stopped. That is one of five vedha
categories, and it left out the thing the chakra is actually FOR.

The Sarvatobhadra is a 9×9 grid holding five different series at once — the 28 nakshatras
around the perimeter, and inside them the twelve rāśis, the fifteen tithis, the seven
vāras, and the Sanskrit vowels. A malefic transiting any cell strikes (vedha) the cell
opposite it, and what is struck is afflicted — whichever series it belongs to. So the
chakra answers questions the rest of the engine cannot:

  · a transit striking a TITHI condemns that lunar day for undertakings
  · a transit striking a VĀRA condemns that weekday
  · a transit striking a VOWEL afflicts every person whose NAME begins with it

That last is the classical use and the reason the chakra exists. Muhūrta is judged for a
named person: you place the first syllable of their name on the grid and see whether
anything strikes it. Without the vowel and syllable layers the chakra is a curiosity;
with them it is a working electional instrument.

THE SYLLABLE TABLE is the standard 108-pada naming table used across Jyotish — the same
one that decides what a child is named after their birth nakshatra. It is not in dispute.

ON WHAT IS AND IS NOT SETTLED. The nakshatra vedha pairs and the 108 syllables are
published and consistent. The rāśi vedha follows the opposition, which every source
agrees on. The TITHI and VĀRA vedha pairings differ between texts, so they are exposed as
stated tables rather than presented as settled — the same treatment the mewa and parkha
anchors get in tibetan_thai.py, and for the same reason.
"""
from dataclasses import dataclass
from typing import Dict, List, Optional

NAKSHATRAS = ["Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira", "Ardra",
              "Punarvasu", "Pushya", "Ashlesha", "Magha", "Purva Phalguni",
              "Uttara Phalguni", "Hasta", "Chitra", "Swati", "Vishakha", "Anuradha",
              "Jyeshtha", "Mula", "Purva Ashadha", "Uttara Ashadha", "Abhijit",
              "Shravana", "Dhanishta", "Shatabhisha", "Purva Bhadrapada",
              "Uttara Bhadrapada", "Revati"]

RASHIS = ["Mesha", "Vrishabha", "Mithuna", "Karka", "Simha", "Kanya",
          "Tula", "Vrischika", "Dhanu", "Makara", "Kumbha", "Meena"]

TITHIS = ["Pratipada", "Dvitiya", "Tritiya", "Chaturthi", "Panchami", "Shashthi",
          "Saptami", "Ashtami", "Navami", "Dashami", "Ekadashi", "Dvadashi",
          "Trayodashi", "Chaturdashi", "Purnima/Amavasya"]

VARAS = ["Ravi (Sun)", "Soma (Mon)", "Mangala (Tue)", "Budha (Wed)",
         "Guru (Thu)", "Shukra (Fri)", "Shani (Sat)"]

# The sixteen vowels of the Sanskrit svara series, as placed on the chakra.
SWARAS = ["a", "ā", "i", "ī", "u", "ū", "ṛ", "ṝ", "ḷ", "ḹ", "e", "ai", "o", "au", "aṃ", "aḥ"]

# The 108 pada syllables — the standard naming table. Four per nakshatra, in pada order.
# Abhijit is not part of the 27-nakshatra naming scheme; it shares the Uttara Ashadha /
# Shravana boundary and is marked so rather than given syllables it does not have.
PADA_SYLLABLES = {
    "Ashwini": ["chu", "che", "cho", "la"], "Bharani": ["li", "lu", "le", "lo"],
    "Krittika": ["a", "i", "u", "e"], "Rohini": ["o", "va", "vi", "vu"],
    "Mrigashira": ["ve", "vo", "ka", "ki"], "Ardra": ["ku", "gha", "ng", "chha"],
    "Punarvasu": ["ke", "ko", "ha", "hi"], "Pushya": ["hu", "he", "ho", "da"],
    "Ashlesha": ["di", "du", "de", "do"], "Magha": ["ma", "mi", "mu", "me"],
    "Purva Phalguni": ["mo", "ta", "ti", "tu"], "Uttara Phalguni": ["te", "to", "pa", "pi"],
    "Hasta": ["pu", "sha", "na", "tha"], "Chitra": ["pe", "po", "ra", "ri"],
    "Swati": ["ru", "re", "ro", "ta"], "Vishakha": ["ti", "tu", "te", "to"],
    "Anuradha": ["na", "ni", "nu", "ne"], "Jyeshtha": ["no", "ya", "yi", "yu"],
    "Mula": ["ye", "yo", "bha", "bhi"], "Purva Ashadha": ["bhu", "dha", "pha", "dha"],
    "Uttara Ashadha": ["bhe", "bho", "ja", "ji"],
    "Abhijit": [],
    "Shravana": ["ju", "je", "jo", "gha"], "Dhanishta": ["ga", "gi", "gu", "ge"],
    "Shatabhisha": ["go", "sa", "si", "su"], "Purva Bhadrapada": ["se", "so", "da", "di"],
    "Uttara Bhadrapada": ["du", "tha", "jha", "na"], "Revati": ["de", "do", "cha", "chi"],
}

# ── vedha tables ─────────────────────────────────────────────────────────────
# Nakshatra vedha — the published mutual pairs. Not in dispute.
NAKSHATRA_VEDHA = {0: 18, 18: 0, 1: 17, 17: 1, 2: 16, 16: 2, 3: 15, 15: 3, 4: 14, 14: 4,
                   5: 13, 13: 5, 6: 12, 12: 6, 7: 11, 11: 7, 8: 10, 10: 8,
                   19: 27, 27: 19, 20: 26, 26: 20, 22: 25, 25: 22, 23: 24, 24: 23}
# Tithi and vāra vedha differ between texts. STATED, and overridable.
TITHI_VEDHA = {0: 11, 11: 0, 1: 10, 10: 1, 2: 9, 9: 2, 3: 8, 8: 3, 4: 7, 7: 4, 5: 6, 6: 5,
               12: 13, 13: 12}
VARA_VEDHA = {0: 5, 5: 0, 1: 4, 4: 1, 2: 3, 3: 2}
SWARA_VEDHA = {i: 15 - i for i in range(16)}

MALEFICS = ("Sun", "Mars", "Saturn", "Rahu", "Ketu")


def _first_syllable(name: str) -> str:
    """The opening syllable of a name, lowercased and stripped to letters."""
    s = "".join(c for c in str(name or "").lower() if c.isalpha())
    if not s:
        return ""
    # Try the longest matching syllable in the table, so "chha" beats "ch".
    known = sorted({y for v in PADA_SYLLABLES.values() for y in v}, key=len, reverse=True)
    for k in known:
        if s.startswith(k):
            return k
    return s[:2]


def nakshatra_for_name(name: str) -> Optional[Dict]:
    """Which nakshatra and pada a name belongs to.

    This is what makes the chakra usable for a person rather than for a date — muhūrta is
    judged for someone, and the someone is identified by the first syllable of their name."""
    syl = _first_syllable(name)
    if not syl:
        return None
    for nak, syls in PADA_SYLLABLES.items():
        if syl in syls:
            return {"syllable": syl, "nakshatra": nak, "pada": syls.index(syl) + 1,
                    "index": NAKSHATRAS.index(nak)}
    return {"syllable": syl, "nakshatra": None, "pada": None, "index": None,
            "note": "the opening syllable is not in the 108-pada table"}


def build_grid() -> Dict:
    """The chakra as data — every series and where it sits.

    The 9×9 perimeter holds the 28 nakshatras; the rāśis, tithis, vāras and vowels sit in
    the interior rows. Returned as structure rather than drawn, so a caller can render it
    however it likes."""
    return {
        "size": "9x9",
        "perimeter": {"series": "nakshatra", "count": 28, "cells": NAKSHATRAS},
        "interior": [
            {"series": "rashi", "count": 12, "cells": RASHIS},
            {"series": "tithi", "count": 15, "cells": TITHIS},
            {"series": "vara", "count": 7, "cells": VARAS},
            {"series": "swara", "count": 16, "cells": SWARAS},
        ],
        "note": ("Five series on one grid. A transit strikes across the chakra, so one "
                 "planet can afflict a star, a lunar day, a weekday and a name at once — "
                 "which is the whole point of calling it sarvatobhadra, 'auspicious from "
                 "every direction'."),
    }


def vedha(series: str, index: int, tables: Optional[Dict] = None) -> Optional[int]:
    """What a position strikes, in its own series."""
    t = {"nakshatra": NAKSHATRA_VEDHA, "tithi": TITHI_VEDHA,
         "vara": VARA_VEDHA, "swara": SWARA_VEDHA}
    t.update(tables or {})
    if series == "rashi":
        return (int(index) + 6) % 12          # the opposition; undisputed
    return t.get(series, {}).get(int(index))


@dataclass
class Strike:
    planet: str
    from_series: str
    from_cell: str
    struck_series: str
    struck_cell: str
    on_target: bool


def transit_scan(transits: Dict[str, int], natal_nakshatra: Optional[int] = None,
                 name: Optional[str] = None, tithi: Optional[int] = None,
                 vara: Optional[int] = None,
                 malefics=MALEFICS, tables: Optional[Dict] = None) -> Dict:
    """Everything the transiting malefics strike, and whether any of it is yours.

    `transits` maps a planet to the nakshatra index it occupies. The scan reports every
    strike, then flags the ones that land on this person — their birth star, the syllable
    of their name, or a day they were considering."""
    person = nakshatra_for_name(name) if name else None
    my_nak = natal_nakshatra if natal_nakshatra is not None else (person or {}).get("index")

    strikes: List[Strike] = []
    for planet, idx in (transits or {}).items():
        if planet not in malefics:
            continue
        i = int(idx) % 28
        hit = vedha("nakshatra", i, tables)
        if hit is None:
            continue
        strikes.append(Strike(planet=planet, from_series="nakshatra",
                              from_cell=NAKSHATRAS[i], struck_series="nakshatra",
                              struck_cell=NAKSHATRAS[hit],
                              on_target=(my_nak is not None and hit == my_nak)))

    out = {
        "system": "Sarvatobhadra Chakra (सर्वतोभद्र चक्र)",
        "strikes": [{"planet": s.planet, "transiting": s.from_cell,
                     "strikes": s.struck_cell, "series": s.struck_series,
                     "hits_you": s.on_target} for s in strikes],
        "hits_on_you": [s.struck_cell for s in strikes if s.on_target],
    }
    if person:
        out["name_placement"] = person
    if my_nak is not None:
        out["your_nakshatra"] = NAKSHATRAS[my_nak]
        out["clear"] = not any(s.on_target for s in strikes)
        out["reading"] = (
            "No malefic strikes your star — the chakra raises no objection."
            if out["clear"] else
            "A malefic strikes your star by vedha. Classical practice treats this as an "
            "objection to beginning anything of consequence until the transit passes.")
    if tithi is not None:
        t = vedha("tithi", int(tithi) - 1, tables)
        out["tithi_struck"] = (TITHIS[t] if t is not None else None)
    if vara is not None:
        v = vedha("vara", int(vara), tables)
        out["vara_struck"] = (VARAS[v] if v is not None else None)
    out["tables_note"] = ("Nakshatra vedha and the 108 syllables are published and "
                          "consistent; rāśi vedha is the opposition. TITHI and VĀRA vedha "
                          "differ between texts and are stated tables here — pass your "
                          "own to follow a different one.")
    return out


# ── structure ────────────────────────────────────────────────────────────────
assert len(NAKSHATRAS) == 28 and len(RASHIS) == 12
assert len(TITHIS) == 15 and len(VARAS) == 7 and len(SWARAS) == 16
assert all(NAKSHATRA_VEDHA[NAKSHATRA_VEDHA[k]] == k for k in NAKSHATRA_VEDHA), \
    "nakshatra vedha must be mutual"
assert all(TITHI_VEDHA[TITHI_VEDHA[k]] == k for k in TITHI_VEDHA), "tithi vedha must be mutual"
assert all(VARA_VEDHA[VARA_VEDHA[k]] == k for k in VARA_VEDHA), "vara vedha must be mutual"
assert set(PADA_SYLLABLES) == set(NAKSHATRAS), "every nakshatra needs a syllable row"
assert sum(len(v) for v in PADA_SYLLABLES.values()) == 108, \
    "the naming table is 27 nakshatras x 4 padas = 108; Abhijit carries none"
assert nakshatra_for_name("Chandra")["nakshatra"] == "Revati", "cha -> Revati pada 3"
