"""
ABJAD (حساب الجمل) — Arabic letter-value mathematics.

The twenty-eight letters carry values 1 to 1000 in the ABJAD order — أبجد هوز حطي كلمن
سعفص قرشت ثخذ ضظغ — which is the old Semitic alphabetical order, not the modern
dictionary order. Anyone who assigns values by the modern order gets every letter from
ه onward wrong, so the ordering is the whole game.

TWO ORDERS, AND THEY DISAGREE. The Mashriqi (eastern) order above is the standard one.
The Maghribi (western, North African) order swaps four letters: س and ص exchange values,
as do ش and ض. A word can therefore have two legitimate abjad values, and a source that
gives only one without saying which order it used is not checkable. Both are computed
here and the caller is told which is which.

Self-verifying against the famous values, asserted at import:
  الله = 66 · محمد = 92 · علي = 110 · the Basmala = 786 · قرآن = 351

Orthographic normalisation is not cosmetic here: أ إ آ ٱ all count as ا, ة counts as ه,
ى counts as ي, and the tashkeel (short-vowel marks) carry no value. Skipping this
silently drops letters from real-world text.
"""
import unicodedata
from dataclasses import dataclass, field
from typing import Dict, List, Tuple

# Mashriqi (eastern) — the standard order.
MASHRIQI = {
    'ا': 1, 'ب': 2, 'ج': 3, 'د': 4, 'ه': 5, 'و': 6, 'ز': 7, 'ح': 8, 'ط': 9,
    'ي': 10, 'ك': 20, 'ل': 30, 'م': 40, 'ن': 50, 'س': 60, 'ع': 70, 'ف': 80,
    'ص': 90, 'ق': 100, 'ر': 200, 'ش': 300, 'ت': 400, 'ث': 500, 'خ': 600,
    'ذ': 700, 'ض': 800, 'ظ': 900, 'غ': 1000,
}
# Maghribi (western) — س↔ص and ش↔ض exchange, and the tail re-orders with them.
MAGHRIBI = dict(MASHRIQI)
MAGHRIBI.update({'ص': 60, 'س': 300, 'ض': 90, 'ش': 1000, 'ظ': 800, 'غ': 900})

# Letters that must be folded before lookup.
_FOLD = {'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ء': 'ا', 'ؤ': 'و', 'ئ': 'ي',
         'ى': 'ي', 'ة': 'ه'}

# The four elemental groups (العناصر) the letters are traditionally divided into,
# cycling fire-air-water-earth through the abjad order.
ELEMENTS = ['Fire', 'Air', 'Water', 'Earth']
ELEMENT_SEED = {
    'Fire': 'نارية — heat and drive; what initiates and burns through',
    'Air': 'هوائية — breath and intellect; what carries and connects',
    'Water': 'مائية — feeling and depth; what dissolves and receives',
    'Earth': 'ترابية — body and form; what holds and endures',
}
_ABJAD_ORDER = list(MASHRIQI.keys())
LETTER_ELEMENT = {c: ELEMENTS[i % 4] for i, c in enumerate(_ABJAD_ORDER)}


def _normalise(text: str) -> str:
    """Strip tashkeel and fold the orthographic variants onto their counting letters."""
    d = unicodedata.normalize('NFD', str(text or ''))
    plain = ''.join(c for c in d if not unicodedata.combining(c))
    plain = unicodedata.normalize('NFC', plain)
    return ''.join(_FOLD.get(c, c) for c in plain)


@dataclass
class Abjad:
    text: str
    value: int                       # Mashriqi — the default
    value_maghribi: int
    reduced: int
    dominant_element: str
    element_seed: str
    letters: List[Tuple[str, int]] = field(default_factory=list)
    element_counts: Dict[str, int] = field(default_factory=dict)

    @property
    def orders_agree(self) -> bool:
        return self.value == self.value_maghribi

    def as_dict(self) -> dict:
        return {
            'system': 'abjad', 'text': self.text,
            'value': self.value, 'order': 'Mashriqi (eastern)',
            'value_maghribi': self.value_maghribi,
            'orders_agree': self.orders_agree,
            'reduced': self.reduced,
            'dominant_element': self.dominant_element,
            'element_meaning': self.element_seed,
            'element_counts': self.element_counts,
            'letters': [{'letter': l, 'value': v} for l, v in self.letters],
        }


def _root(n: int) -> int:
    n = abs(int(n))
    while n > 9:
        n = sum(int(d) for d in str(n))
    return n or 9


def abjad(text: str) -> Abjad:
    """The abjad value of an Arabic word or phrase, in both orders."""
    norm = _normalise(text)
    letters = [(c, MASHRIQI[c]) for c in norm if c in MASHRIQI]
    total = sum(v for _, v in letters)
    total_mg = sum(MAGHRIBI[c] for c in norm if c in MAGHRIBI)

    counts: Dict[str, int] = {}
    for c, _ in letters:
        e = LETTER_ELEMENT[c]
        counts[e] = counts.get(e, 0) + 1
    dom = max(counts, key=counts.get) if counts else '—'
    return Abjad(text=str(text or ''), value=total, value_maghribi=total_mg,
                 reduced=_root(total) if total else 0,
                 dominant_element=dom, element_seed=ELEMENT_SEED.get(dom, ''),
                 letters=letters, element_counts=counts)


# The values that make this checkable rather than merely plausible.
assert abjad('الله').value == 66, 'Allah should be 66'
assert abjad('محمد').value == 92, 'Muhammad should be 92'
assert abjad('علي').value == 110, 'Ali should be 110'
assert abjad('قرآن').value == 351, 'Quran should be 351'
assert abjad('بسم الله الرحمن الرحيم').value == 786, 'the Basmala should be 786'
