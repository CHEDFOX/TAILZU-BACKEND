"""
PYTHAGOREAN (WESTERN) NUMEROLOGY — the full Western name+date system.

The Vedic engine (core.py) already gives Mulank / Bhagyank / Namank with Vedic
(planetary) meaning. This module adds the Western Pythagorean layer that the
oracle adapter references but core.py never computed:

  • Life Path        — the birth-date number, Western framing (master-aware)
  • Birthday number  — the day of birth itself
  • Expression /     — full birth name, ALL letters (a.k.a. Destiny)
    Destiny
  • Soul Urge        — vowels only (Heart's Desire)
  • Personality      — consonants only
  • Maturity         — Life Path + Expression (who you grow into)
  • Karmic Debt      — 13 / 14 / 16 / 19 surfacing inside any core number
  • Karmic Lessons   — number-values MISSING from the name
  • Hidden Passion   — the most-frequent number-value in the name
  • Pinnacles &       — the four life periods (numbers + age windows)
    Challenges
  • Bridge numbers   — Life Path↔Expression and Soul Urge↔Personality gaps

Pure stdlib. Entry point: pythagorean_report(name, birth_date) -> Dict.
"""

from datetime import date
from typing import Dict, List, Optional, Tuple

# Pythagorean letter → value (A=1 … I=9, wrapping). Western standard.
PYTH: Dict[str, int] = {
    'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6, 'G': 7, 'H': 8, 'I': 9,
    'J': 1, 'K': 2, 'L': 3, 'M': 4, 'N': 5, 'O': 6, 'P': 7, 'Q': 8, 'R': 9,
    'S': 1, 'T': 2, 'U': 3, 'V': 4, 'W': 5, 'X': 6, 'Y': 7, 'Z': 8,
}

MASTERS = {11, 22, 33}
VOWELS = set('AEIOU')

# The four karmic-debt numbers and the burden each carries.
KARMIC_DEBT = {
    13: ('13/4', 'Hard work avoided in a past cycle — success now demands focus, order and not cutting corners.'),
    14: ('14/5', 'Freedom abused before — must master moderation, not let appetite and change run wild.'),
    16: ('16/7', 'Ego and love misused — repeated humbling rebuilds the self on honest, spiritual ground.'),
    19: ('19/1', 'Power and self-reliance misused — must learn to stand alone without trampling others.'),
}

# Short keyword themes per single-digit / master number (the LLM writes prose;
# these are anchors only).
THEME = {
    1: 'leadership, independence, beginnings',
    2: 'partnership, sensitivity, balance',
    3: 'expression, creativity, joy',
    4: 'work, order, foundation',
    5: 'freedom, change, the senses',
    6: 'love, responsibility, home',
    7: 'depth, analysis, the inner search',
    8: 'power, money, mastery',
    9: 'compassion, completion, the wider world',
    11: 'vision, intuition, illumination (master)',
    22: 'the master builder — dreams made real',
    33: 'the master teacher — healing through love',
}


def _reduce1(n: int) -> int:
    """Reduce to a single digit 1-9 (no master preservation)."""
    while n > 9:
        n = sum(int(d) for d in str(n))
    return n


def _resolve(total: int, keep_master: bool = True) -> Tuple[int, Optional[int]]:
    """Reduce `total`; flag a karmic-debt number if 13/14/16/19 appears en route.
    Returns (final_number, karmic_debt_or_None)."""
    debt = None
    n = total
    while n > 9:
        if n in KARMIC_DEBT:
            debt = n
        if keep_master and n in MASTERS:
            break
        n = sum(int(d) for d in str(n))
    return n, debt


def _classify(name: str) -> List[Dict]:
    """Per-letter classification. Y is a vowel only when it has no vowel neighbour
    inside its own word (the common deterministic rule)."""
    out: List[Dict] = []
    for word in name.upper().split():
        letters = [c for c in word if c.isalpha()]
        for i, c in enumerate(letters):
            if c in VOWELS:
                kind = 'vowel'
            elif c == 'Y':
                prev_v = i > 0 and letters[i - 1] in VOWELS
                next_v = i < len(letters) - 1 and letters[i + 1] in VOWELS
                kind = 'consonant' if (prev_v or next_v) else 'vowel'
            else:
                kind = 'consonant'
            out.append({'letter': c, 'value': PYTH.get(c, 0), 'kind': kind})
    return out


def _annot(number: int, debt: Optional[int] = None) -> Dict:
    d = {'number': number, 'is_master': number in MASTERS, 'theme': THEME.get(number, '')}
    if debt:
        d['karmic_debt'] = KARMIC_DEBT[debt][0]
        d['karmic_debt_meaning'] = KARMIC_DEBT[debt][1]
    return d


# ═══════════════════════════════════════════════════════════════
# DATE-BASED NUMBERS
# ═══════════════════════════════════════════════════════════════

def life_path(d: date) -> Dict:
    """Western Life Path — month, day, year each reduced, summed, reduced.
    Master numbers preserved; karmic debt flagged."""
    m, day, y = _reduce1(d.month), _reduce1(d.day), _reduce1(d.year)
    total = m + day + y
    num, debt = _resolve(total)
    out = _annot(num, debt)
    out['calculation'] = f'{d.month}/{d.day}/{d.year} → {m}+{day}+{y} = {total} → {num}'
    return out


def birthday_number(d: date) -> Dict:
    """The day of birth itself — a specific gift/talent. Karmic if 13/14/16/19."""
    num, debt = _resolve(d.day)
    out = _annot(num, debt)
    out['day'] = d.day
    return out


# ═══════════════════════════════════════════════════════════════
# NAME-BASED NUMBERS
# ═══════════════════════════════════════════════════════════════

def expression(name: str) -> Dict:
    """Expression / Destiny — ALL letters of the full birth name."""
    letters = _classify(name)
    total = sum(l['value'] for l in letters)
    num, debt = _resolve(total)
    out = _annot(num, debt)
    out['aka'] = 'Destiny'
    out['compound'] = total
    return out


def soul_urge(name: str) -> Dict:
    """Soul Urge / Heart's Desire — vowels only."""
    total = sum(l['value'] for l in _classify(name) if l['kind'] == 'vowel')
    num, debt = _resolve(total)
    out = _annot(num, debt)
    out['aka'] = "Heart's Desire"
    out['compound'] = total
    return out


def personality(name: str) -> Dict:
    """Personality — consonants only (the outer self others first meet)."""
    total = sum(l['value'] for l in _classify(name) if l['kind'] == 'consonant')
    num, debt = _resolve(total)
    out = _annot(num, debt)
    out['compound'] = total
    return out


def karmic_lessons(name: str) -> Dict:
    """Number-values (1-9) entirely ABSENT from the name = lessons to learn."""
    present = {l['value'] for l in _classify(name) if l['value']}
    missing = [n for n in range(1, 10) if n not in present]
    return {
        'missing': missing,
        'lessons': {n: THEME.get(n, '') for n in missing},
        'count': len(missing),
    }


def hidden_passion(name: str) -> Dict:
    """The most-frequent number-value in the name — an intense, driving talent."""
    counts: Dict[int, int] = {}
    for l in _classify(name):
        if l['value']:
            counts[l['value']] = counts.get(l['value'], 0) + 1
    if not counts:
        return {'numbers': [], 'frequency': 0, 'theme': {}}
    peak = max(counts.values())
    nums = sorted(n for n, c in counts.items() if c == peak)
    return {'numbers': nums, 'frequency': peak, 'theme': {n: THEME.get(n, '') for n in nums}}


# ═══════════════════════════════════════════════════════════════
# COMBINED / DERIVED
# ═══════════════════════════════════════════════════════════════

def maturity(life_path_num: int, expression_num: int) -> Dict:
    """Maturity / Realization — who you become after ~35. Life Path + Expression."""
    total = _reduce1(life_path_num) + _reduce1(expression_num)
    num, debt = _resolve(total)
    return _annot(num, debt)


def bridges(life_path_num: int, expression_num: int,
            soul_num: int, personality_num: int) -> Dict:
    """Bridge numbers — the gap (and how to close it) between core pairs."""
    lp, ex = _reduce1(life_path_num), _reduce1(expression_num)
    su, pe = _reduce1(soul_num), _reduce1(personality_num)
    return {
        'life_path_expression': abs(lp - ex),   # how to align purpose with action
        'soul_personality': abs(su - pe),        # how to align inner with outer self
    }


def pinnacles_challenges(d: date, life_path_num: int) -> Dict:
    """The four Pinnacles (opportunities) and four Challenges (lessons), with the
    age window each governs. Windows pivot on 36 − Life Path."""
    m, day, y = _reduce1(d.month), _reduce1(d.day), _reduce1(d.year)

    p1n = _resolve(m + day)[0]
    p2n = _resolve(day + y)[0]
    p3n = _resolve(p1n + p2n)[0]
    p4n = _resolve(m + y)[0]

    c1 = abs(m - day)
    c2 = abs(day - y)
    c3 = abs(c1 - c2)
    c4 = abs(m - y)

    lp = _reduce1(life_path_num)
    first_end = 36 - lp          # age the first pinnacle closes
    spans = [
        (0, first_end),
        (first_end + 1, first_end + 9),
        (first_end + 10, first_end + 18),
        (first_end + 19, None),  # None = rest of life
    ]

    def _window(i):
        a, b = spans[i]
        return {'age_start': a, 'age_end': b}

    pinnacles = [
        {'period': i + 1, **_annot(n), **_window(i)}
        for i, n in enumerate([p1n, p2n, p3n, p4n])
    ]
    challenges = [
        {'period': i + 1, 'number': n, 'theme': THEME.get(n, 'the lesson of zero — balance all energies') if n else 'balance all energies (0)', **_window(i)}
        for i, n in enumerate([c1, c2, c3, c4])
    ]
    return {'pinnacles': pinnacles, 'challenges': challenges, 'pivot_age': first_end}


# ═══════════════════════════════════════════════════════════════
# FULL REPORT
# ═══════════════════════════════════════════════════════════════

def pythagorean_report(name: str = '', birth_date: Optional[date] = None) -> Dict:
    """Everything the Western Pythagorean system computes, in one dict. Any input
    that is missing simply omits its section."""
    report: Dict = {'system': 'pythagorean'}

    if birth_date:
        lp = life_path(birth_date)
        report['life_path'] = lp
        report['birthday'] = birthday_number(birth_date)
        report['pinnacles_challenges'] = pinnacles_challenges(birth_date, lp['number'])

    if name:
        ex = expression(name)
        su = soul_urge(name)
        pe = personality(name)
        report['expression'] = ex
        report['soul_urge'] = su
        report['personality'] = pe
        report['karmic_lessons'] = karmic_lessons(name)
        report['hidden_passion'] = hidden_passion(name)
        if birth_date:
            report['maturity'] = maturity(report['life_path']['number'], ex['number'])
            report['bridges'] = bridges(report['life_path']['number'], ex['number'],
                                        su['number'], pe['number'])

    # Roll up every karmic-debt that surfaced across the core numbers.
    debts = []
    for key in ('life_path', 'birthday', 'expression', 'soul_urge', 'personality', 'maturity'):
        sec = report.get(key)
        if isinstance(sec, dict) and sec.get('karmic_debt'):
            debts.append({'in': key, 'debt': sec['karmic_debt'], 'meaning': sec['karmic_debt_meaning']})
    report['karmic_debts'] = debts

    return report
