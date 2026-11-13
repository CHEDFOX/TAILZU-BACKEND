"""
WETON (Java) — the 35-day cycle and the arithmetic of neptu.

A weton is the pairing of the seven-day week with the five-day pasaran market week. The
two run together and repeat every 35 days, and a person's weton is the pair they were born
under. It remains in daily use across Java for choosing wedding dates, opening businesses
and judging a match.

Its distinguishing feature is that it is ARITHMETIC. Each day and each pasaran carries a
neptu — a number — and Javanese practice adds them. A person's neptu is one number; a
couple's is the sum of two; the judgement comes from that sum's remainder. There is no
sky in it at all, which makes it independent testimony in a way most calendrical systems
are not.

SYSTEMS DIFFER, AND THE MODULE SAYS WHICH IT USED
─────────────────────────────────────────────────
Several divisors are in use for compatibility — mod 7, mod 8 and mod 9 all appear in
Primbon literature with different result names. This module implements the common mod-7
and mod-8 readings and labels each, rather than presenting one as the answer.
"""
from typing import Dict

DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"]
PASARAN = ["Legi", "Pahing", "Pon", "Wage", "Kliwon"]

NEPTU_DAY = {"Minggu": 5, "Senin": 4, "Selasa": 3, "Rabu": 7,
             "Kamis": 8, "Jumat": 6, "Sabtu": 9}
NEPTU_PASARAN = {"Legi": 5, "Pahing": 9, "Pon": 7, "Wage": 4, "Kliwon": 8}

# mod 8 — the widely-cited marriage reading
PAL_8 = [
    ("Pesthi", "settled — a household that finds its footing and keeps it"),
    ("Pegat", "separation — recurring difficulty over money, distance or infidelity"),
    ("Ratu", "sovereign — a respected match, often envied by others"),
    ("Jodoh", "matched — the pair accept each other's faults; long and settled"),
    ("Topo", "ascetic — hard at the beginning, easier once established"),
    ("Tinari", "fortunate — sufficiency comes without great struggle"),
    ("Padu", "quarrelsome — frequent argument, though not usually ending in separation"),
    ("Sujanan", "strife — quarrels and the risk of betrayal"),
]

# mod 7 — the older 'pal' reading, phrased as the character of the household
PAL_7 = [
    ("Pesthi", "steady and settled"),
    ("Wasesa Segara", "wide-hearted, forgiving, capable of absorbing trouble"),
    ("Tunggak Semi", "resilient — cut back, it grows again"),
    ("Satriya Wibawa", "dignified, honoured, carrying authority"),
    ("Sumur Sinaba", "a well people come to — sought out for help and counsel"),
    ("Bumi Kapetak", "hard-working and enduring, but prone to being taken for granted"),
    ("Satriya Wirang", "prone to public embarrassment; traditionally offset by ritual"),
]


def weton(day_index: int, pasaran_index: int) -> Dict:
    """A weton from the day of week (0 = Minggu) and pasaran (0 = Legi)."""
    d = DAYS[int(day_index) % 7]
    p = PASARAN[int(pasaran_index) % 5]
    n = NEPTU_DAY[d] + NEPTU_PASARAN[p]
    return {
        "day": d, "pasaran": p, "name": f"{d} {p}",
        "neptu": {"day": NEPTU_DAY[d], "pasaran": NEPTU_PASARAN[p], "total": n},
        "cycle_position": (int(day_index) % 7, int(pasaran_index) % 5),
    }


def from_ordinal(days_since_epoch: int, day_offset: int = 0,
                 pasaran_offset: int = 0) -> Dict:
    """Weton from a running day count. Offsets anchor both cycles and must come from a
    known reference date — the pasaran has no astronomical anchor."""
    n = int(days_since_epoch)
    return weton(n + int(day_offset), n + int(pasaran_offset))


def compatibility(neptu_a: int, neptu_b: int) -> Dict:
    """The classical match arithmetic, in both common divisors."""
    total = int(neptu_a) + int(neptu_b)
    i8 = total % 8
    i7 = total % 7
    n8, g8 = PAL_8[i8]
    n7, g7 = PAL_7[i7]
    return {
        "neptu_a": int(neptu_a), "neptu_b": int(neptu_b), "total": total,
        "mod_8": {"remainder": i8, "name": n8, "reading": g8,
                  "note": "the widely-cited marriage reading"},
        "mod_7": {"remainder": i7, "name": n7, "reading": g7,
                  "note": "the older pal reading, describing the household's character"},
        "caveat": ("Primbon literature uses mod 7, 8 and 9 with different result sets. "
                   "Both common readings are given rather than one being presented as "
                   "the answer — they can disagree, and that disagreement is real."),
    }


def good_days(neptu: int) -> Dict:
    """Days traditionally favoured and avoided for someone of this neptu.

    The common rule works from the neptu's own remainder — days whose neptu sums with the
    person's to an auspicious total are chosen for undertakings."""
    favoured, avoided = [], []
    for d in DAYS:
        for p in PASARAN:
            t = int(neptu) + NEPTU_DAY[d] + NEPTU_PASARAN[p]
            if t % 8 in (0, 3, 5):        # Pesthi, Jodoh, Tinari
                favoured.append(f"{d} {p}")
            elif t % 8 in (1, 7):          # Pegat, Sujanan
                avoided.append(f"{d} {p}")
    return {"neptu": int(neptu), "favoured": favoured, "avoided": avoided,
            "basis": "mod-8 pal; other divisors give different lists"}


def summary(w: Dict) -> str:
    if not w:
        return ""
    return (f"WETON — {w['name']}, neptu {w['neptu']['total']} "
            f"({w['neptu']['day']} + {w['neptu']['pasaran']})")


assert weton(0, 0)["neptu"]["total"] == 10        # Minggu Legi = 5 + 5
assert weton(6, 1)["neptu"]["total"] == 18        # Sabtu Pahing = 9 + 9
assert len(PAL_8) == 8 and len(PAL_7) == 7
