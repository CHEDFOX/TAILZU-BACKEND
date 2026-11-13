"""
ANGEL NUMBERS — deterministic pattern detection + the documented meaning corpus.

Angel numbers are a modern numerology system: repeating or patterned number sequences
a person keeps noticing, each with an established meaning. The MATH here is exact
(pattern classification + digit reduction); the meanings are the standard angel-number
corpus, so the reading stays authentic to that system.
"""
from dataclasses import dataclass

# Root digit meanings (used for mixed numbers, via digital-root reduction).
DIGIT_MEANING = {
    0: "wholeness, the divine, a reset",
    1: "new beginnings, will, a fresh alignment",
    2: "balance, trust, partnership",
    3: "expression, creativity, support around you",
    4: "foundation, protection, steady work",
    5: "change, freedom, movement",
    6: "home, love, recalibrating toward the heart",
    7: "the spiritual path, insight, reward",
    8: "abundance, power, cycles that pay out",
    9: "completion, release, the end that frees",
}

# The canonical angel-number corpus (exact-match seeds).
ANGEL = {
    "000": "infinite potential and oneness — a clean slate with the divine",
    "111": "a manifestation portal — your thoughts are taking form, align them now",
    "222": "keep the faith — what you're building is balancing into place",
    "333": "guidance is near — create, speak, and trust the support around you",
    "444": "you are protected and held — your foundation is solid",
    "555": "a big change is moving in — release and let it carry you",
    "666": "recalibrate — you've tipped toward worry or the material; return to the heart",
    "777": "you're on your path — luck and spiritual reward are close",
    "888": "abundance and infinity — a cycle completes and pays you back",
    "999": "completion — a chapter closes so a truer one can open",
    "1010": "awakening and alignment — step consciously onto your path",
    "1111": "the manifestation gate — you are seen; set your intention",
    "1212": "keep going — you're crossing the bridge toward your purpose",
    "1234": "step by step — you're progressing in the right order",
    "1122": "build the dream now — vision meets partnership",
    "1133": "creative support surrounds you — speak your truth",
}


@dataclass
class AngelReading:
    number: str
    kind: str          # "corpus" | "repeating" | "sequence" | "mirror" | "mixed"
    seed: str
    root: int
    root_seed: str


def _digital_root(digits: str) -> int:
    n = sum(int(c) for c in digits) or 0
    while n > 9:
        n = sum(int(c) for c in str(n))
    return n


def angel_number(raw) -> AngelReading:
    digits = "".join(c for c in str(raw) if c.isdigit()) or "0"
    root = _digital_root(digits)
    root_seed = DIGIT_MEANING[root]

    if digits in ANGEL:
        return AngelReading(digits, "corpus", ANGEL[digits], root, root_seed)

    # repeating single digit (e.g. 55, 5555) → amplify that digit
    if len(set(digits)) == 1 and len(digits) >= 2:
        d = int(digits[0])
        return AngelReading(digits, "repeating",
                            f"a strong, amplified {d}: {DIGIT_MEANING[d]}", root, root_seed)
    # ascending / descending run (1234, 4321)
    seq_up = all(int(digits[i + 1]) - int(digits[i]) == 1 for i in range(len(digits) - 1))
    seq_dn = all(int(digits[i]) - int(digits[i + 1]) == 1 for i in range(len(digits) - 1))
    if len(digits) >= 3 and (seq_up or seq_dn):
        return AngelReading(digits, "sequence",
                            "a step-by-step progression — you are moving in order", root, root_seed)
    # mirror / palindrome (1221, 1441)
    if len(digits) >= 3 and digits == digits[::-1]:
        return AngelReading(digits, "mirror",
                            "a mirror — the outer and inner are reflecting each other", root, root_seed)
    # otherwise reduce to the root
    return AngelReading(digits, "mixed", f"its essence reduces to {root}: {root_seed}", root, root_seed)
