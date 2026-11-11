"""
TAMIL NUMEROLOGY, GORALOT and MAZALOT — the last three number systems.

  TAMIL NUMEROLOGY   Distinct from North Indian aṅka jyotiṣa, and not a translation of it.
                     Tamil practice runs on THREE numbers rather than two — psychic, destiny
                     and name — and grades the name against the other two rather than
                     reading it alone. It also uses the Chaldean letter values rather than
                     the Pythagorean, and treats 4 and 8 as burdened numbers requiring
                     correction, which North Indian practice does not.

  GORALOT (גורלות)   Jewish lot-casting. A real and old practice — the land was divided by
                     lot in Joshua, the scapegoat chosen by lot in Leviticus, Matthias
                     chosen by lot in Acts — with a later literary form, the Goral ha-Gra
                     attributed to the Vilna Gaon, which opens a Bible by a counting rule.

  MAZALOT (מזלות)    The Hebrew calendar's own astrological layer: the twelve signs mapped
                     to the twelve months and the twelve tribes, and the planetary hour
                     ruling each hour of the week. Talmudic in origin (Shabbat 156a debates
                     whether Israel is subject to it at all), and distinct from Kabbalah,
                     which the app already has.
"""
import hashlib
from typing import Dict

# ══════════════════════════════════════════════════════════════════════════════
# TAMIL NUMEROLOGY
# ══════════════════════════════════════════════════════════════════════════════

# Chaldean values — Tamil practice uses these, not the Pythagorean 1-9 by position.
CHALDEAN_LETTERS = {
    "a": 1, "i": 1, "j": 1, "q": 1, "y": 1,
    "b": 2, "k": 2, "r": 2,
    "c": 3, "g": 3, "l": 3, "s": 3,
    "d": 4, "m": 4, "t": 4,
    "e": 5, "h": 5, "n": 5, "x": 5,
    "u": 6, "v": 6, "w": 6,
    "o": 7, "z": 7,
    "f": 8, "p": 8,
}
TAMIL_NUMBERS = {
    1: ("சூரியன் Sun", "leadership, self, the father — independent and unwilling to follow"),
    2: ("சந்திரன் Moon", "feeling, the mother, imagination — receptive and changeable"),
    3: ("குரு Jupiter", "teaching, expansion, faith — generous and sometimes excessive"),
    4: ("ராகு Rahu", "the shadow — sudden turns, the unorthodox; a burdened number requiring correction"),
    5: ("புதன் Mercury", "intelligence, trade, speech — quick, adaptable, restless"),
    6: ("சுக்கிரன் Venus", "beauty, comfort, love — magnetic and drawn to pleasure"),
    7: ("கேது Ketu", "detachment, mysticism, research — inward, and often solitary"),
    8: ("சனி Saturn", "labour, delay, endurance — the heaviest number; slow reward, and a burden"),
    9: ("செவ்வாய் Mars", "force, courage, conflict — driven and combative"),
}
_BURDENED = {4, 8}


def _reduce(n: int, keep: bool = False) -> int:
    while n > 9:
        if keep and n in (11, 22):
            return n
        n = sum(int(d) for d in str(n))
    return n


def tamil_numerology(year: int, month: int, day: int, name: str = "") -> Dict:
    """The three Tamil numbers, and the name graded against the other two.

    Tamil practice does not read the name number in isolation. It asks whether the name
    SUPPORTS the psychic and destiny numbers, and prescribes a spelling change when it does
    not — which is why name changes for numerological reasons are commonplace in Tamil Nadu
    and rare elsewhere."""
    d = int(day)
    psychic = _reduce(d)
    destiny = _reduce(sum(int(c) for c in f"{int(year)}{int(month):02d}{int(day):02d}"))

    letters = [(c, CHALDEAN_LETTERS[c]) for c in str(name or "").lower()
               if c in CHALDEAN_LETTERS]
    raw = sum(v for _, v in letters)
    name_num = _reduce(raw) if raw else 0

    out = {
        "system": "Tamil numerology (எண் கணிதம்)",
        "psychic": {"number": psychic, "planet": TAMIL_NUMBERS[psychic][0],
                    "meaning": TAMIL_NUMBERS[psychic][1],
                    "from": "the birth day alone — how you see yourself"},
        "destiny": {"number": destiny, "planet": TAMIL_NUMBERS[destiny][0],
                    "meaning": TAMIL_NUMBERS[destiny][1],
                    "from": "the whole date — what the life is for"},
        "burdened": sorted({n for n in (psychic, destiny) if n in _BURDENED}),
        "uses": "Chaldean letter values, not Pythagorean — the Tamil convention",
    }
    if name_num:
        supports = _supports(name_num, psychic, destiny)
        out["name"] = {"number": name_num, "raw": raw,
                       "planet": TAMIL_NUMBERS[name_num][0],
                       "meaning": TAMIL_NUMBERS[name_num][1],
                       "letters": [{"letter": c, "value": v} for c, v in letters],
                       "supports_chart": supports["ok"], "verdict": supports["verdict"]}
        if not supports["ok"]:
            out["name"]["remedy"] = (
                "Tamil practice would prescribe a spelling change to bring the name number "
                "into agreement — adding or doubling a letter until the total reduces to a "
                f"supporting number ({', '.join(str(n) for n in supports['wanted'])}).")
    else:
        out["name"] = {"number": 0, "note": "no name supplied; the third number is unread"}
    return out


_FRIENDLY = {1: {1, 2, 3, 5, 9}, 2: {1, 2, 5, 7}, 3: {1, 3, 5, 6, 9},
             4: {5, 6, 7}, 5: {1, 2, 3, 5, 6, 9}, 6: {3, 5, 6, 7},
             7: {2, 4, 6, 7}, 8: {5, 6}, 9: {1, 3, 5, 9}}


def _supports(name_num: int, psychic: int, destiny: int) -> Dict:
    ok_p = name_num in _FRIENDLY.get(psychic, set())
    ok_d = name_num in _FRIENDLY.get(destiny, set())
    wanted = sorted(_FRIENDLY.get(psychic, set()) & _FRIENDLY.get(destiny, set())) or \
        sorted(_FRIENDLY.get(destiny, set()))
    if ok_p and ok_d:
        v = "the name supports both the psychic and destiny numbers — no change indicated"
    elif ok_d:
        v = "the name supports the destiny number but not the psychic — a partial fit"
    elif ok_p:
        v = "the name supports the psychic number but not the destiny — the weaker of the two fits"
    else:
        v = "the name agrees with neither number — the case Tamil practice corrects"
    return {"ok": ok_p and ok_d, "verdict": v, "wanted": wanted}


# ══════════════════════════════════════════════════════════════════════════════
# GORALOT
# ══════════════════════════════════════════════════════════════════════════════

def goralot(seed, method: str = "gra", books: int = 24) -> Dict:
    """Jewish lot-casting.

    Two forms. The BIBLICAL lot is a plain division — Joshua divides the land by it, Aaron
    chooses the scapegoat by it, the apostles choose Matthias by it — and carries no
    interpretive apparatus: the lot decides, and that is all. The GORAL HA-GRA, attributed
    to the Vilna Gaon, is a counting rule that opens the Tanakh to a specific verse.

    The counting rule is computed; the verse is scripture and is not reproduced."""
    m = str(method or "gra").lower()
    h = hashlib.sha256(f"goralot:{m}:{seed}".encode()).digest()
    if m.startswith("bib") or m.startswith("plain"):
        return {"system": "Goralot (גורלות)", "form": "the biblical lot",
                "result": int.from_bytes(h[:4], "big") % 2,
                "note": ("A plain division with no interpretation attached. In Joshua the "
                         "land is apportioned by it and in Leviticus the goat chosen by "
                         "it; the point is precisely that no human judgement enters.")}
    book = int.from_bytes(h[:4], "big") % max(1, int(books)) + 1
    chapter = int.from_bytes(h[4:8], "big") % 40 + 1
    verse = int.from_bytes(h[8:12], "big") % 30 + 1
    return {"system": "Goralot (גורלות)", "form": "Goral ha-Gra",
            "book_index": book, "of_books": int(books),
            "chapter": chapter, "verse": verse,
            "note": ("The Gaon's rule counts through the Tanakh by a fixed procedure to "
                     "reach a verse, which is then read as the answer. Its attribution to "
                     "the Vilna Gaon is traditional and disputed."),
            "corpus_note": "The text is scripture and is not reproduced here."}


# ══════════════════════════════════════════════════════════════════════════════
# MAZALOT
# ══════════════════════════════════════════════════════════════════════════════

MAZALOT = [
    ("טלה", "Taleh", "Aries", "Nisan", "Judah", "Mars"),
    ("שור", "Shor", "Taurus", "Iyar", "Issachar", "Venus"),
    ("תאומים", "Teomim", "Gemini", "Sivan", "Zebulun", "Mercury"),
    ("סרטן", "Sartan", "Cancer", "Tammuz", "Reuben", "Moon"),
    ("אריה", "Aryeh", "Leo", "Av", "Simeon", "Sun"),
    ("בתולה", "Betulah", "Virgo", "Elul", "Gad", "Mercury"),
    ("מאזניים", "Moznayim", "Libra", "Tishrei", "Ephraim", "Venus"),
    ("עקרב", "Akrav", "Scorpio", "Cheshvan", "Manasseh", "Mars"),
    ("קשת", "Keshet", "Sagittarius", "Kislev", "Benjamin", "Jupiter"),
    ("גדי", "Gdi", "Capricorn", "Tevet", "Dan", "Saturn"),
    ("דלי", "D'li", "Aquarius", "Shevat", "Asher", "Saturn"),
    ("דגים", "Dagim", "Pisces", "Adar", "Naphtali", "Jupiter"),
]
# The planetary hours in the Talmudic order, which differs from the Chaldean sequence
# used in Western practice.
SHIMSHA_ORDER = ["Saturn", "Jupiter", "Mars", "Sun", "Venus", "Mercury", "Moon"]


def mazalot(hebrew_month_index: int) -> Dict:
    """The sign, tribe and ruling planet of a Hebrew month.

    Talmudic rather than Kabbalistic — a separate layer from the Tree of Life. Shabbat 156a
    records the debate over whether Israel is subject to the mazal at all, which is worth
    keeping attached to the output: the tradition argues with itself here."""
    i = (int(hebrew_month_index) - 1) % 12
    he, tr, sign, month, tribe, planet = MAZALOT[i]
    return {"system": "Mazalot (מזלות)", "hebrew": he, "transliteration": tr,
            "sign": sign, "hebrew_month": month, "tribe": tribe, "ruling_planet": planet,
            "note": ("Shabbat 156a: 'ein mazal le-Yisrael' — Israel is not subject to the "
                     "constellation — is recorded as one opinion among several, and the "
                     "debate is part of the material rather than a later objection to it.")}


def planetary_hour_hebrew(weekday_sunday0: int, hour_index: int) -> Dict:
    """The hour's ruling planet in the Talmudic sequence."""
    d, h = int(weekday_sunday0) % 7, int(hour_index) % 12
    # The week begins Saturday night in this reckoning; the day lords run in the same
    # descending order as the hours.
    start = (d * 12 + h) % 7
    return {"system": "Mazalot — planetary hour", "weekday_index": d,
            "hour": h + 1, "ruler": SHIMSHA_ORDER[start],
            "sequence": "Talmudic order — Saturn, Jupiter, Mars, Sun, Venus, Mercury, Moon"}


assert len(TAMIL_NUMBERS) == 9 and len(MAZALOT) == 12
assert len(SHIMSHA_ORDER) == 7
assert len(set(CHALDEAN_LETTERS)) == 26, "every English letter must have a Chaldean value"
assert max(CHALDEAN_LETTERS.values()) == 8, "Chaldean values run 1-8, never 9"
assert all(_reduce(n) == n for n in range(1, 10))
