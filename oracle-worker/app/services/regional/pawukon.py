"""
PAWUKON (Bali) — the 210-day calendar of concurrent weeks.

Structurally unlike anything else in this platform. The Pawukon runs ten weeks AT THE SAME
TIME, of lengths one through ten, all advancing together. A day is not a position in one
cycle but the intersection of ten, and its character comes from the combination.

210 = 2 × 3 × 5 × 7, so the two-, three-, five- and seven-day weeks divide the cycle
cleanly and repeat exactly. The four-, eight- and nine-day weeks do NOT — they cannot,
since 210 is not divisible by 4, 8 or 9. Balinese practice resolves this by holding the
opening days of those weeks fixed at the start of each cycle, which is a genuine
irregularity in the calendar rather than an artefact of computing it.

WHAT IS COMPUTED AND WHAT IS NOT
────────────────────────────────
The clean weeks (eka, dwi, tri, panca, sad, sapta, dasa) and the thirty wuku are computed
exactly. The irregular weeks (catur, asta, sanga) are computed with the standard opening
rule and FLAGGED, because sources differ on exactly which opening days repeat.
"""
from typing import Dict

WUKU = ["Sinta", "Landep", "Ukir", "Kulantir", "Taulu", "Gumbreg",
        "Wariga", "Warigadian", "Julungwangi", "Sungsang", "Dungulan", "Kuningan",
        "Langkir", "Medangsia", "Pujut", "Pahang", "Krulut", "Merakih",
        "Tambir", "Medangkungan", "Matal", "Uye", "Menail", "Prangbakat",
        "Bala", "Ugu", "Wayang", "Kelawu", "Dukut", "Watugunung"]

TRIWARA = ["Pasah", "Beteng", "Kajeng"]
PANCAWARA = ["Umanis", "Paing", "Pon", "Wage", "Kliwon"]
SADWARA = ["Tungleh", "Aryang", "Urukung", "Paniron", "Was", "Maulu"]
SAPTAWARA = ["Redite", "Soma", "Anggara", "Buda", "Wraspati", "Sukra", "Saniscara"]
CATURWARA = ["Sri", "Laba", "Jaya", "Menala"]
ASTAWARA = ["Sri", "Indra", "Guru", "Yama", "Ludra", "Brahma", "Kala", "Uma"]
SANGAWARA = ["Dangu", "Jangur", "Gigis", "Nohan", "Ogan", "Erangan",
             "Urungan", "Tulus", "Dadi"]
DASAWARA = ["Pandita", "Pati", "Suka", "Duka", "Sri", "Manuh",
            "Manusa", "Raja", "Dewa", "Raksasa"]
DWIWARA = ["Menga", "Pepet"]
EKAWARA = ["Luang"]

# Urip — the numeric value each day-name carries. The dasawara and dwiwara are DERIVED
# from these sums rather than counted independently, which is why they stay consistent.
URIP_PANCA = {"Umanis": 5, "Paing": 9, "Pon": 7, "Wage": 4, "Kliwon": 8}
URIP_SAPTA = {"Redite": 5, "Soma": 4, "Anggara": 3, "Buda": 7,
              "Wraspati": 8, "Sukra": 6, "Saniscara": 9}

CYCLE = 210


def day(pawukon_day: int) -> Dict:
    """All ten weeks for a day, given its 0-based position in the 210-day cycle."""
    d = int(pawukon_day) % CYCLE

    sapta = SAPTAWARA[d % 7]
    panca = PANCAWARA[d % 5]
    urip = URIP_SAPTA[sapta] + URIP_PANCA[panca]

    # Irregular weeks — the opening days of the cycle are held fixed.
    catur = CATURWARA[2] if d < 3 else CATURWARA[(d - 3) % 4]
    asta = ASTAWARA[6] if d < 7 else ASTAWARA[(d - 7) % 8]
    sanga = SANGAWARA[0] if d < 4 else SANGAWARA[(d - 4) % 9]

    return {
        "pawukon_day": d,
        "wuku": {"index": d // 7 + 1, "name": WUKU[d // 7]},
        "weeks": {
            "ekawara": EKAWARA[0] if urip % 2 else None,
            "dwiwara": DWIWARA[urip % 2],
            "triwara": TRIWARA[d % 3],
            "caturwara": catur,
            "pancawara": panca,
            "sadwara": SADWARA[d % 6],
            "saptawara": sapta,
            "astawara": asta,
            "sangawara": sanga,
            "dasawara": DASAWARA[urip % 10],
        },
        "urip": {"pancawara": URIP_PANCA[panca], "saptawara": URIP_SAPTA[sapta],
                 "total": urip},
        "irregular": {
            "weeks": ["caturwara", "astawara", "sangawara"],
            "why": ("210 is not divisible by 4, 8 or 9, so these weeks cannot repeat "
                    "cleanly. Balinese practice holds their opening days fixed at the "
                    "start of each cycle; sources differ on exactly which days repeat, so "
                    "these three carry more uncertainty than the rest."),
        },
        "note": ("Kajeng Kliwon — Kajeng of the three-day week falling with Kliwon of the "
                 "five — is among the most significant conjunctions in Balinese practice."
                 if TRIWARA[d % 3] == "Kajeng" and panca == "Kliwon" else ""),
    }


def from_ordinal(days_since_epoch: int, epoch_offset: int = 0) -> Dict:
    """Pawukon day from a running day count. `epoch_offset` anchors the cycle and must be
    supplied by the caller from a known reference date — the cycle has no astronomical
    anchor, so it can only be fixed by observation."""
    return day((int(days_since_epoch) + int(epoch_offset)) % CYCLE)


def summary(d: Dict) -> str:
    if not d:
        return ""
    w = d["weeks"]
    out = [f"PAWUKON — day {d['pawukon_day']} of 210, wuku {d['wuku']['name']} "
           f"({d['wuku']['index']}/30)",
           f"  {w['saptawara']} {w['pancawara']} (urip {d['urip']['total']}) · "
           f"{w['triwara']} · {w['sadwara']} · {w['dasawara']}",
           f"  irregular: catur {w['caturwara']} · asta {w['astawara']} · "
           f"sanga {w['sangawara']}"]
    if d.get("note"):
        out.append(f"  {d['note']}")
    return "\n".join(out)


# Anchors: the clean weeks must repeat exactly across the cycle.
assert day(0)["weeks"]["saptawara"] == day(210)["weeks"]["saptawara"]
assert day(0)["weeks"]["pancawara"] == day(35)["weeks"]["pancawara"]
assert day(0)["wuku"]["name"] == "Sinta" and day(209)["wuku"]["name"] == "Watugunung"
