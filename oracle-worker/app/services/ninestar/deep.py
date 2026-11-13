"""
NINE STAR KI — the chart, the tendency star, and directionology.

`core.py` gives the principal (year) star and `numerology/chinese.py` adds the month and
annual stars with an element forecast. Both are correct as far as they go, and neither
reaches the two things Nine Star Ki is mainly USED for in practice:

  KEISHA (傾斜) — the tendency star. The principal star describes how a person appears;
  the month star how they were shaped; the keisha is the emotional undertow, and it is
  found geometrically, not from a table — you locate the month star inside the birth-year
  chart, and read whichever star natively owns that palace.

  DIRECTIONOLOGY (方位) — the five afflicted directions of a year or month. This is the
  system's operational half: it is what a practitioner is consulted about before moving
  house, travelling or signing somewhere. Without it the app can describe a person's
  character and cannot answer the question the tradition exists to answer.

THE MOVING SQUARE
─────────────────
Everything here is the Lo Shu magic square with a different number in the centre. With 5
central it is the base arrangement; putting star n in the centre shifts every palace by
(n - 5). One line of arithmetic, and it generates all nine charts — which is why this is
a computation rather than nine hard-coded grids.

Month boundaries are the SETSU — the sectional solar terms — and they are computed from
the actual solar longitude via `chinese.lunisolar`, not from the fixed "4th to 8th of the
month" approximations. The setsu drift by a day or two across the years and a birth on
the 4th of February is exactly the case where that matters.
"""
from dataclasses import dataclass
from typing import Dict, List, Optional

from .core import STARS

# The base Lo Shu, star 5 central. Compass palace → the star that natively owns it.
BASE_SQUARE = {'SE': 4, 'S': 9, 'SW': 2, 'E': 3, 'C': 5, 'W': 7, 'NE': 8, 'N': 1, 'NW': 6}
OPPOSITE = {'N': 'S', 'S': 'N', 'E': 'W', 'W': 'E',
            'NE': 'SW', 'SW': 'NE', 'SE': 'NW', 'NW': 'SE'}
PALACE_ORDER = ['SE', 'S', 'SW', 'E', 'C', 'W', 'NE', 'N', 'NW']

# The twelve branches around the compass, for the year-breaker direction.
BRANCH_DIRECTION = ['N', 'NNE', 'ENE', 'E', 'ESE', 'SSE',
                    'S', 'SSW', 'WSW', 'W', 'WNW', 'NNW']
_OPP16 = {'N': 'S', 'NNE': 'SSW', 'ENE': 'WSW', 'E': 'W', 'ESE': 'WNW', 'SSE': 'NNW',
          'S': 'N', 'SSW': 'NNE', 'WSW': 'ENE', 'W': 'E', 'WNW': 'ESE', 'NNW': 'SSE'}

# Which of the nine months of the solar year a principal star's February begins on.
# Groups {1,4,7} → 8, {2,5,8} → 2, {3,6,9} → 5, then descending month by month.
_FEB_START = {1: 8, 4: 8, 7: 8, 2: 2, 5: 2, 8: 2, 3: 5, 6: 5, 9: 5}


def square_for(centre: int) -> Dict[str, int]:
    """The nine palaces when `centre` occupies the middle."""
    shift = int(centre) - 5
    return {p: ((s + shift - 1) % 9) + 1 for p, s in BASE_SQUARE.items()}


def palace_of(centre: int, star: int) -> str:
    """Which palace a star occupies in the chart with `centre` in the middle."""
    sq = square_for(centre)
    return next(p for p, s in sq.items() if s == int(star))


def year_star(solar_year: int) -> int:
    """The principal star of a solar year. Descends by one each year."""
    raw = (11 - (int(solar_year) % 9)) % 9
    return 9 if raw == 0 else raw


# ══════════════════════════════════════════════════════════════════════════════
# solar-year and solar-month boundaries, from the real terms
# ══════════════════════════════════════════════════════════════════════════════

# The twelve SETSU that open the Nine Ki months, as solar longitudes. Index 0 is
# risshun (立春, 315°), which also opens the solar YEAR.
_SETSU_LONGITUDES = [315, 345, 15, 45, 75, 105, 135, 165, 195, 225, 255, 285]
_SETSU_NAMES = ['Risshun', 'Keichitsu', 'Seimei', 'Rikka', 'Boshu', 'Shosho',
                'Risshu', 'Hakuro', 'Kanro', 'Ritto', 'Taisetsu', 'Shokan']


def _setsu_days(gregorian_year: int) -> List[int]:
    """The twelve setsu of a solar year as integer day numbers, ascending from risshun."""
    from app.services.chinese.lunisolar import solar_term_jd, _tt_to_china_day
    out = []
    for i, lon in enumerate(_SETSU_LONGITUDES):
        # Risshun through Taisetsu fall in `gregorian_year`; Shokan falls in the next.
        y = gregorian_year + 1 if lon == 285 else gregorian_year
        out.append(_tt_to_china_day(solar_term_jd(y, float(lon))))
    return out


def solar_position(year: int, month: int, day: int) -> Dict:
    """The solar year and solar-month index (0 = the risshun month) of a date.

    Falls back to the conventional fixed cutoffs if the ephemeris path raises, so a
    calendar problem degrades the answer instead of failing the request."""
    from app.services.chinese.lunisolar import gregorian_to_jd
    import math
    jd = int(math.floor(gregorian_to_jd(int(year), int(month), int(day)) + 0.5))
    try:
        for sy in (int(year), int(year) - 1):
            setsu = _setsu_days(sy)
            if setsu[0] <= jd < _setsu_days(sy + 1)[0]:
                idx = max(i for i, s in enumerate(setsu) if s <= jd)
                return {'solar_year': sy, 'month_index': idx,
                        'setsu': _SETSU_NAMES[idx], 'exact': True}
    except Exception:
        pass
    m, d = int(month), int(day)
    approx = {2: 4, 3: 6, 4: 5, 5: 6, 6: 6, 7: 7, 8: 8, 9: 8, 10: 8, 11: 7, 12: 7, 1: 6}
    if d < approx.get(m, 1):
        m = 12 if m == 1 else m - 1
    sy = int(year) - 1 if (int(month) == 1 or (int(month) == 2 and int(day) < 4)) else int(year)
    idx = (m - 2) % 12
    return {'solar_year': sy, 'month_index': idx, 'setsu': _SETSU_NAMES[idx], 'exact': False}


def month_star(principal: int, month_index: int) -> int:
    """The month star, descending from the principal star's February value."""
    start = _FEB_START[int(principal)]
    return ((start - int(month_index) - 1) % 9) + 1


# ══════════════════════════════════════════════════════════════════════════════
# the reading
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class NineStarChart:
    principal: int
    month: int
    tendency: int
    solar_year: int
    month_index: int
    setsu: str
    exact_terms: bool

    def _s(self, n):
        name, elem, direction, trigram, seed = STARS[n]
        return {'star': n, 'name': name, 'element': elem, 'direction': direction,
                'trigram': trigram, 'meaning': seed}

    def as_dict(self) -> Dict:
        return {
            'principal_star': self._s(self.principal),
            'month_star': self._s(self.month),
            'tendency_star': self._s(self.tendency),
            'solar_year': self.solar_year,
            'solar_month': {'index': self.month_index, 'setsu': self.setsu,
                            'from_exact_solar_terms': self.exact_terms},
            'natal_square': square_for(self.principal),
            'roles': {
                'principal': 'how you appear to others and how you meet the world',
                'month': 'how you were formed — the inherited, private character',
                'tendency': 'the emotional undertow, strongest under pressure',
            },
        }


def chart(year: int, month: int, day: int) -> NineStarChart:
    """The three stars of a birth."""
    pos = solar_position(year, month, day)
    p = year_star(pos['solar_year'])
    m = month_star(p, pos['month_index'])
    # Keisha: locate the month star inside the birth-year chart, then read whichever star
    # natively owns that palace. A month star in the centre has no palace to own, and by
    # convention the person takes the principal star as their tendency.
    pal = palace_of(p, m)
    t = p if pal == 'C' else BASE_SQUARE[pal]
    return NineStarChart(principal=p, month=m, tendency=t, solar_year=pos['solar_year'],
                         month_index=pos['month_index'], setsu=pos['setsu'],
                         exact_terms=pos.get('exact', False))


def directions(personal_star: int, for_year: int) -> Dict:
    """The afflicted directions of a year, for one person.

    Five of them, and they are not interchangeable — the first two afflict everybody
    alike, the next two are personal, and the last follows the year's branch."""
    ys = year_star(int(for_year))
    sq = square_for(ys)
    five = next(p for p, s in sq.items() if s == 5)
    mine = next(p for p, s in sq.items() if s == int(personal_star))
    branch_dir = BRANCH_DIRECTION[(int(for_year) - 4) % 12]

    out = [
        {'name': 'Five Yellow Killing', 'japanese': '五黄殺', 'direction': five,
         'scope': 'everyone',
         'meaning': 'slow ruin from your own choices — decay that sets in and compounds'},
        {'name': 'Anken Killing', 'japanese': '暗剣殺', 'direction': OPPOSITE.get(five),
         'scope': 'everyone',
         'meaning': 'the blade in the dark — sudden trouble arriving from outside, not of your making'},
        {'name': 'Honmei Killing', 'japanese': '本命殺', 'direction': mine,
         'scope': 'personal',
         'meaning': 'your own star sits here — moving toward it strains your health and judgement'},
        {'name': 'Honmeiteki Killing', 'japanese': '本命的殺', 'direction': OPPOSITE.get(mine),
         'scope': 'personal',
         'meaning': 'facing your own star — losses through others, and plans that fail to land'},
        {'name': 'Year Breaker', 'japanese': '歳破', 'direction': _OPP16.get(branch_dir),
         'scope': 'everyone',
         'meaning': 'against the year\'s own branch — broken agreements, contracts that unwind'},
    ]
    if five == 'C':
        out[0]['direction'] = None
        out[0]['note'] = 'Five is central this year, so it afflicts no compass direction.'
        out[1]['direction'] = None
        out[1]['note'] = 'No Five Yellow direction, so no Anken opposite either.'
    if mine == 'C':
        out[2]['direction'] = None
        out[2]['note'] = 'Your star is central this year — a year to stay put and consolidate.'
        out[3]['direction'] = None

    afflicted = {d['direction'] for d in out if d['direction']}
    free = [p for p in PALACE_ORDER
            if p != 'C' and p not in afflicted
            and not any(str(d['direction'] or '').startswith(p) for d in out)]
    return {
        'year': int(for_year), 'year_star': ys, 'your_star': int(personal_star),
        'square': sq, 'afflicted': out, 'unafflicted': free,
        'note': ('Directionology is judged from where you START, and applies to moves, '
                 'long journeys and relocations — not to a walk to the shops.'),
    }


def full_report(year: int, month: int, day: int, for_year: Optional[int] = None) -> Dict:
    """The three stars plus this year's directions."""
    import datetime
    c = chart(year, month, day)
    fy = int(for_year) if for_year else datetime.date.today().year
    return {'system': 'Nine Star Ki (九星気学)', **c.as_dict(),
            'directionology': directions(c.principal, fy)}
