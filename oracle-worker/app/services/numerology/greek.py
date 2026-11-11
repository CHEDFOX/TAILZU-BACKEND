"""
ISOPSEPHY (ἰσοψηφία) — Greek letter-value mathematics.

The Greek counterpart to Hebrew gematria, and the older attested practice of the two in
surviving inscriptions — there is graffiti at Pompeii ("I love her whose number is 545")
that only works if the writer expected a stranger to do the arithmetic.

Twenty-seven values across twenty-four current letters plus three archaic ones kept
solely for their numerals: digamma/stigma (6), koppa (90) and sampi (900). Without those
three the hundreds do not line up and every value above 500 comes out wrong, which is the
usual error in casual implementations.

Self-verifying against the famous values, asserted at import:
  Ἰησοῦς = 888 · χξϛ = 666 · λόγος = 373 · ἀμήν = 99 · ἀγάπη = 93 · Ζεύς = 612

Accents, breathings and the iota subscript carry no numeric weight and are stripped;
final sigma (ς) is sigma. Both are the standard treatment and both are places where a
naive implementation silently drops letters instead.
"""
import unicodedata
from dataclasses import dataclass
from typing import List, Tuple

VALUES = {
    'α': 1, 'β': 2, 'γ': 3, 'δ': 4, 'ε': 5, 'ϝ': 6, 'ϛ': 6, 'ζ': 7, 'η': 8, 'θ': 9,
    'ι': 10, 'κ': 20, 'λ': 30, 'μ': 40, 'ν': 50, 'ξ': 60, 'ο': 70, 'π': 80,
    'ϙ': 90, 'ϟ': 90,
    'ρ': 100, 'σ': 200, 'ς': 200, 'τ': 300, 'υ': 400, 'φ': 500, 'χ': 600,
    'ψ': 700, 'ω': 800, 'ϡ': 900,
}

# The classical planetary/elemental resonance of a digital root, kept in the same shape
# the Hebrew module uses so the two can be read side by side.
ROOTS = {
    1: ("Monad", "the point — origin, unity, what cannot be divided"),
    2: ("Dyad", "the line — division, otherness, the first tension"),
    3: ("Triad", "the plane — harmony, the resolution of two into one"),
    4: ("Tetrad", "the solid — matter, the four elements, what is built"),
    5: ("Pentad", "the living — marriage of odd and even, the human figure"),
    6: ("Hexad", "the perfect number — equal to the sum of its parts, wholeness"),
    7: ("Heptad", "the virgin number — the seven spheres, what governs time"),
    8: ("Ogdoad", "the cube — justice, the fixed stars, reciprocity"),
    9: ("Ennead", "the horizon — completion before return, the limit of number"),
}


def _strip(text: str) -> str:
    """Lower-case and remove diacritics, keeping only letters that carry a value."""
    d = unicodedata.normalize('NFD', str(text or '').lower())
    return ''.join(c for c in d if not unicodedata.combining(c))


@dataclass
class Isopsephy:
    text: str
    value: int
    reduced: int
    root_name: str
    root_seed: str
    letters: List[Tuple[str, int]]

    def as_dict(self) -> dict:
        return {'system': 'isopsephy', 'text': self.text, 'value': self.value,
                'reduced': self.reduced, 'root': self.root_name,
                'meaning': self.root_seed,
                'letters': [{'letter': l, 'value': v} for l, v in self.letters]}


def _root(n: int) -> int:
    n = abs(int(n))
    while n > 9:
        n = sum(int(d) for d in str(n))
    return n or 9


def isopsephy(text: str) -> Isopsephy:
    """The isopsephic value of a Greek word or phrase."""
    letters = [(c, VALUES[c]) for c in unicodedata.normalize('NFC', _strip(text))
               if c in VALUES]
    total = sum(v for _, v in letters)
    r = _root(total) if total else 0
    name, seed = ROOTS.get(r, ('—', ''))
    return Isopsephy(text=str(text or ''), value=total, reduced=r,
                     root_name=name, root_seed=seed, letters=letters)


# The values that make this checkable rather than merely plausible.
assert isopsephy('Ἰησοῦς').value == 888, 'Iesous should be 888'
assert isopsephy('χξϛ').value == 666, 'chi-xi-stigma should be 666'
assert isopsephy('λόγος').value == 373, 'logos should be 373'
assert isopsephy('ἀμήν').value == 99, 'amen should be 99'
assert isopsephy('ἀγάπη').value == 93, 'agape should be 93'
assert isopsephy('Ζεύς').value == 612, 'Zeus should be 612'
