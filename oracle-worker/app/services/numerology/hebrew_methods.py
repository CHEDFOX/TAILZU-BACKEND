"""
GEMATRIA — the other methods.

`hebrew.py` computes Mispar Hechrachi, the absolute value, which is what "gematria"
usually means in casual use. It is one method of roughly seventy, and the traditional
literature does not treat them as variants of a default — a word is read across SEVERAL
methods, and an equivalence that holds in one and not another is itself the finding.
Computing only Hechrachi is like owning one lens and calling it the telescope.

The ten implemented here are the ones actually used in the sources, not an arbitrary
subset:

  Hechrachi   הכרחי    absolute — aleph 1 … tav 400. The default.
  Gadol       גדול     large — finals take 500-900 rather than their base value.
  Katan       קטן      small — every letter reduced to 1-9 (its digits without zeros).
  Siduri      סידורי   ordinal — position in the alphabet, 1-22.
  Ne'elam     נעלם     hidden — the letter's NAME spelled out, minus the letter itself.
  Musafi      מוספי    added — the absolute value plus the count of letters.
  Kolel       כולל     inclusive — absolute plus one for the word as a whole.
  Bone'eh     בונה     building — a running cumulative sum, letter by letter.
  Meshulash   משולש    cubed — each letter's value cubed.
  Atbash      אתב״ש    the reversal cipher — aleph↔tav, bet↔shin. Not a value method but
                       a substitution, and it is the one the prophets used: Sheshach in
                       Jeremiah 25:26 is Bavel under Atbash, which is how the verse is read.

Self-verifying at import against values that are fixed in the literature:
  חי = 18 · אחד = 13 · יהוה = 26 (Hechrachi) · אמת = 441
  Katan of יהוה = 8 · Siduri of יהוה = 26 · Atbash of בבל = ששך
"""
from dataclasses import dataclass
from typing import Dict, List, Tuple

from .hebrew import VALUES

# The 22 letters in alphabetical order, with the five finals folded onto their bases.
ALPHABET = ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י", "כ", "ל",
            "מ", "נ", "ס", "ע", "פ", "צ", "ק", "ר", "ש", "ת"]
FINALS = {"ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ"}
# Mispar Gadol gives the finals their own high values.
GADOL_FINALS = {"ך": 500, "ם": 600, "ן": 700, "ף": 800, "ץ": 900}
ORDINAL = {c: i + 1 for i, c in enumerate(ALPHABET)}

# The spelled-out name of each letter, for Mispar Ne'elam.
LETTER_NAMES = {
    "א": "אלף", "ב": "בית", "ג": "גימל", "ד": "דלת", "ה": "הא", "ו": "ואו",
    "ז": "זין", "ח": "חית", "ט": "טית", "י": "יוד", "כ": "כף", "ל": "למד",
    "מ": "מם", "נ": "נון", "ס": "סמך", "ע": "עין", "פ": "פא", "צ": "צדי",
    "ק": "קוף", "ר": "ריש", "ש": "שין", "ת": "תו",
}

METHOD_INFO = {
    "hechrachi": ("מספר הכרחי", "Absolute", "the standard value; aleph 1 through tav 400"),
    "gadol": ("מספר גדול", "Large", "final forms take 500-900 — the same word can carry two values"),
    "katan": ("מספר קטן", "Small", "every letter reduced to a single digit; strips the order of magnitude"),
    "katan_mispari": ("מספר קטן מספרי", "Small reduced", "Katan reduced again to one digit"),
    "siduri": ("מספר סידורי", "Ordinal", "position in the alphabet, 1 to 22"),
    "neelam": ("מספר נעלם", "Hidden", "the value of each letter's spelled NAME, less the letter itself"),
    "musafi": ("מספר מוספי", "Added", "absolute value plus the number of letters"),
    "kolel": ("מספר כולל", "Inclusive", "absolute value plus one, counting the word as a unit"),
    "boneeh": ("מספר בונה", "Building", "a running cumulative sum — each letter carries all before it"),
    "meshulash": ("מספר משולש", "Cubed", "each letter's value cubed"),
}


def _clean(text: str) -> str:
    """Hebrew letters only, in order. Vowel points and punctuation carry no value."""
    return "".join(c for c in str(text or "") if c in VALUES or c in FINALS)


def _base(c: str) -> str:
    return FINALS.get(c, c)


def hechrachi(text: str) -> int:
    return sum(VALUES[c] for c in _clean(text) if c in VALUES)


def gadol(text: str) -> int:
    return sum(GADOL_FINALS.get(c, VALUES.get(c, 0)) for c in _clean(text))


def katan(text: str) -> int:
    """Each letter reduced to 1-9 — 400 becomes 4, 30 becomes 3."""
    total = 0
    for c in _clean(text):
        v = VALUES.get(c, 0)
        while v > 9:
            v = sum(int(d) for d in str(v)) if v % 10 else v // 10
        total += v
    return total


def katan_mispari(text: str) -> int:
    """Katan reduced again to a single digit. A distinct method, not a formatting of the
    last one: Katan of יהוה is 17, Katan Mispari is 8, and the sources cite both."""
    v = katan(text)
    while v > 9:
        v = sum(int(d) for d in str(v))
    return v


def siduri(text: str) -> int:
    return sum(ORDINAL.get(_base(c), 0) for c in _clean(text))


def neelam(text: str) -> int:
    """The spelled-out name of each letter, minus the letter itself — what is 'hidden'
    inside it."""
    total = 0
    for c in _clean(text):
        b = _base(c)
        nm = LETTER_NAMES.get(b)
        if nm:
            total += sum(VALUES[x] for x in nm if x in VALUES) - VALUES.get(b, 0)
    return total


def musafi(text: str) -> int:
    return hechrachi(text) + len(_clean(text))


def kolel(text: str) -> int:
    return hechrachi(text) + 1


def boneeh(text: str) -> int:
    """A running sum: the first letter counted once, the second twice, and so on."""
    letters = _clean(text)
    return sum(VALUES.get(c, 0) * (len(letters) - i) for i, c in enumerate(letters))


def meshulash(text: str) -> int:
    return sum(VALUES.get(c, 0) ** 3 for c in _clean(text))


# Word-final forms. Applied to Atbash output so the result is orthographically valid
# Hebrew rather than a letter sequence: Bavel enciphers to Sheshach, and Sheshach is
# written ששך with a final kaf, which is how it appears in Jeremiah.
_TO_FINAL = {"כ": "ך", "מ": "ם", "נ": "ן", "פ": "ף", "צ": "ץ"}


def atbash(text: str) -> str:
    """The reversal cipher — aleph for tav, bet for shin, and so on inward.

    Not a value but a substitution, and the oldest attested of these: Jeremiah writes
    Sheshach where he means Babylon, and the verse is only legible through it."""
    out = []
    for c in str(text or ""):
        b = FINALS.get(c, c)
        out.append(ALPHABET[22 - ORDINAL[b]] if b in ORDINAL else c)
    # Re-apply final forms at the end of each run of Hebrew letters.
    for i, c in enumerate(out):
        if c in _TO_FINAL:
            nxt = out[i + 1] if i + 1 < len(out) else ""
            if not (nxt in ORDINAL or nxt in FINALS):
                out[i] = _TO_FINAL[c]
    return "".join(out)


_METHODS = {
    "hechrachi": hechrachi, "gadol": gadol, "katan": katan,
    "katan_mispari": katan_mispari, "siduri": siduri,
    "neelam": neelam, "musafi": musafi, "kolel": kolel, "boneeh": boneeh,
    "meshulash": meshulash,
}


@dataclass
class MultiGematria:
    text: str
    values: Dict[str, int]
    atbash: str
    letters: List[Tuple[str, int]]

    def as_dict(self) -> Dict:
        return {
            "system": "gematria (multiple methods)", "text": self.text,
            "methods": {k: {"value": v, "hebrew": METHOD_INFO[k][0],
                            "english": METHOD_INFO[k][1], "meaning": METHOD_INFO[k][2]}
                        for k, v in self.values.items()},
            "atbash": {"result": self.atbash, "hebrew": "אתב״ש",
                       "meaning": "the reversal cipher — a substitution rather than a value"},
            "letters": [{"letter": l, "value": v} for l, v in self.letters],
        }

    def summary(self) -> str:
        lines = [f"גימטריה of {self.text}"]
        for k, v in self.values.items():
            h, e, m = METHOD_INFO[k]
            lines.append(f"  {h:14s} {e:10s} {v:>8d}   {m}")
        lines.append(f"  {'אתב״ש':14s} {'Atbash':10s} {self.atbash:>8s}   reversal cipher")
        return "\n".join(lines)


def all_methods(text: str) -> MultiGematria:
    """Every method at once — which is how the sources actually read a word."""
    letters = [(c, VALUES.get(c, GADOL_FINALS.get(c, 0))) for c in _clean(text)]
    return MultiGematria(text=str(text or ""),
                         values={k: f(text) for k, f in _METHODS.items()},
                         atbash=atbash(text), letters=letters)


def equivalences(a: str, b: str) -> Dict:
    """Which methods make two words equal.

    This is the actual use. A pair equal under several methods is a strong reading; a pair
    equal under only one is a weak one, and the traditional literature is explicit about
    the difference. Returning the agreeing methods rather than a yes/no keeps that."""
    ma, mb = all_methods(a), all_methods(b)
    agree = [k for k in _METHODS if ma.values[k] == mb.values[k]]
    return {
        "a": str(a), "b": str(b),
        "agree_in": agree, "agreement_count": len(agree), "of_methods": len(_METHODS),
        "values_a": ma.values, "values_b": mb.values,
        "strength": ("strong" if len(agree) >= 3 else
                     "moderate" if len(agree) == 2 else
                     "weak" if len(agree) == 1 else "none"),
        "note": ("Equivalence under one method alone is the weakest kind of reading; the "
                 "sources weigh a pair by how many methods hold it."),
    }


# Fixed values from the literature.
assert hechrachi("חי") == 18, "chai should be 18"
assert hechrachi("אחד") == 13, "echad should be 13"
assert hechrachi("יהוה") == 26, "the tetragrammaton should be 26"
assert hechrachi("אמת") == 441, "emet should be 441"
assert hechrachi("שלום") == 376, "shalom should be 376"
assert siduri("יהוה") == 26, "ordinal of the tetragrammaton should be 26"
assert katan("יהוה") == 17, "katan of the tetragrammaton should be 17 (1+5+6+5)"
assert katan_mispari("יהוה") == 8, "katan mispari reduces that 17 to 8"
assert katan("ת") == 4 and katan("ל") == 3, "katan strips zeros: 400->4, 30->3"
assert atbash("בבל") == "ששך", "Atbash of Bavel should give Sheshach (Jer. 25:26)"
assert gadol("ץ") == 900 and hechrachi("ץ") == 90, "finals must differ between gadol and hechrachi"
assert len(ALPHABET) == 22 and len(LETTER_NAMES) == 22
