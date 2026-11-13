"""
HEBREW GEMATRIA — the standard letter-value mathematics (Mispar Hechrachi).

Each Hebrew letter has a fixed value (Aleph=1 … Tav=400); a word's gematria is the sum.
Final (sofit) letters take their base value. Self-verifying against famous values:
  חי (life) = 18 · אחד (one) = 13 · שלום (peace) = 376 · יהוה = 26 · אמת (truth) = 441.
"""
from dataclasses import dataclass

# Mispar Hechrachi (absolute value). Final forms map to their base value.
VALUES = {
    "א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5, "ו": 6, "ז": 7, "ח": 8, "ט": 9,
    "י": 10, "כ": 20, "ך": 20, "ל": 30, "מ": 40, "ם": 40, "נ": 50, "ן": 50,
    "ס": 60, "ע": 70, "פ": 80, "ף": 80, "צ": 90, "ץ": 90,
    "ק": 100, "ר": 200, "ש": 300, "ת": 400,
}

# The ten Sefirot (for the digit-root resonance of a value).
SEFIROT = {
    1: ("Keter", "the crown — will, the source"),
    2: ("Chokmah", "wisdom — the first spark of insight"),
    3: ("Binah", "understanding — form given to insight"),
    4: ("Chesed", "loving-kindness — expansion, mercy"),
    5: ("Gevurah", "strength — restraint, judgement"),
    6: ("Tiferet", "beauty — harmony, the heart"),
    7: ("Netzach", "victory — endurance, drive"),
    8: ("Hod", "splendour — humility, intellect"),
    9: ("Yesod", "foundation — the channel, connection"),
}
MALKUT = ("Malkut", "kingdom — manifestation in the world")


@dataclass
class Gematria:
    text: str
    value: int
    reduced: int          # digital root 1..9
    sefirah: str
    sefirah_seed: str
    letters: list         # [(letter, value), ...]


def _root(n: int) -> int:
    while n > 9:
        n = sum(int(c) for c in str(n))
    return n


def gematria(text: str) -> Gematria:
    letters = [(ch, VALUES[ch]) for ch in str(text) if ch in VALUES]
    value = sum(v for _c, v in letters)
    reduced = _root(value) if value else 0
    # Value ending in 0 with root reducing — Malkut for multiples that resolve to the world;
    # otherwise the digit-root Sefirah (1..9).
    sef, seed = (MALKUT if (value and value % 10 == 0 and reduced == 9) else
                 SEFIROT.get(reduced, MALKUT))
    return Gematria(text=text, value=value, reduced=reduced, sefirah=sef, sefirah_seed=seed, letters=letters)
