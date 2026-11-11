"""
NINE STAR KI (九星気学) — the Chinese/Japanese annual-star system.

Everyone carries a Principal (year) star 1-9, each tied to one of the five
elements and one of the eight trigrams + centre. The reigning ANNUAL star
changes every year and its element either feeds, drains, controls or matches
your own — that is the year's weather for you.

  • principal_star(date)        — your year star (solar year, ~Feb 4 cutoff)
  • monthly_star(date)          — the month star
  • annual_star(year)           — the star reigning over a calendar year
  • forecast(birth, year)       — your star vs the year's star, with the read
  • STARS                       — element / trigram / direction / colour table

The year star descends by one each solar year (… 9 → 8 → 1 → 9 …). We derive it
arithmetically so it is exact across the 1999↔2000 boundary.

Pure stdlib. Entry point: nine_star_report(birth_date, for_year=None) -> Dict.
"""

from datetime import date
from typing import Dict, Optional

# star → element, trigram, compass direction, colour, keyword
STARS = {
    1: {'element': 'Water', 'trigram': 'Kan (☵)',  'direction': 'North',     'colour': 'White',  'keyword': 'flow, depth, the hidden journey'},
    2: {'element': 'Earth', 'trigram': 'Kun (☷)',  'direction': 'Southwest', 'colour': 'Black',  'keyword': 'nurture, receptivity, service'},
    3: {'element': 'Wood',  'trigram': 'Chen (☳)', 'direction': 'East',      'colour': 'Jade',   'keyword': 'initiative, growth, the thunderclap'},
    4: {'element': 'Wood',  'trigram': 'Sun (☴)',  'direction': 'Southeast', 'colour': 'Green',  'keyword': 'influence, maturing, the wind'},
    5: {'element': 'Earth', 'trigram': 'Centre',   'direction': 'Centre',    'colour': 'Yellow', 'keyword': 'the pivot, power, the eye of change'},
    6: {'element': 'Metal', 'trigram': 'Chien (☰)','direction': 'Northwest', 'colour': 'White',  'keyword': 'leadership, principle, heaven'},
    7: {'element': 'Metal', 'trigram': 'Tui (☱)',  'direction': 'West',      'colour': 'Red',    'keyword': 'joy, pleasure, the lake'},
    8: {'element': 'Earth', 'trigram': 'Ken (☶)',  'direction': 'Northeast', 'colour': 'White',  'keyword': 'stillness, transition, the mountain'},
    9: {'element': 'Fire',  'trigram': 'Li (☲)',   'direction': 'South',     'colour': 'Purple', 'keyword': 'illumination, fame, clarity'},
}

# five-element productive and controlling cycles
_PRODUCES = {'Wood': 'Fire', 'Fire': 'Earth', 'Earth': 'Metal', 'Metal': 'Water', 'Water': 'Wood'}
_CONTROLS = {'Wood': 'Earth', 'Earth': 'Water', 'Water': 'Fire', 'Fire': 'Metal', 'Metal': 'Wood'}

# Month star tables: principal-star group → list of month stars (Feb…Jan, solar
# months). Groups: {1,4,7}, {2,5,8}, {3,6,9}. Index 0 = Feb, 11 = Jan.
_MONTH_TABLE = {
    frozenset({1, 4, 7}): [8, 7, 6, 5, 4, 3, 2, 1, 9, 8, 7, 6],
    frozenset({2, 5, 8}): [2, 1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 9],
    frozenset({3, 6, 9}): [5, 4, 3, 2, 1, 9, 8, 7, 6, 5, 4, 3],
}

# approximate solar-month start day (the setsu) for each month index Feb..Jan.
# Nine Ki months begin ~4th-7th; we use a fixed practical cutoff per month.
_SOLAR_MONTH_START = {2: 4, 3: 6, 4: 5, 5: 6, 6: 6, 7: 7, 8: 8, 9: 8, 10: 8, 11: 7, 12: 7, 1: 6}


def _solar_year(d: date) -> int:
    """The Nine Ki year flips at risshun (~Feb 4). Before that, prior year."""
    if d.month == 1 or (d.month == 2 and d.day < 4):
        return d.year - 1
    return d.year


def year_star(year: int) -> int:
    """Principal star for a (solar) year. Descends by one each year, exact across
    the millennium boundary: star = (2 − year) mod 9, mapped to 1-9."""
    star = (2 - (year % 9)) % 9
    return star or 9


def principal_star(d: date) -> Dict:
    star = year_star(_solar_year(d))
    return {'star': star, **STARS[star]}


def annual_star(year: Optional[int] = None) -> Dict:
    if year is None:
        from datetime import date as _d
        year = _d.today().year
    star = year_star(year)
    return {'year': year, 'star': star, **STARS[star]}


def _solar_month_index(d: date) -> int:
    """0 = Feb solar month … 11 = Jan solar month, using setsu cutoffs."""
    m = d.month
    if d.day < _SOLAR_MONTH_START.get(m, 1):
        m = 12 if m == 1 else m - 1   # before the setsu → previous solar month
    # map solar month (Feb=2 … Jan=1) to index 0..11
    return (m - 2) % 12


def monthly_star(d: date) -> Dict:
    p = year_star(_solar_year(d))
    table = next((t for grp, t in _MONTH_TABLE.items() if p in grp), None)
    if table is None:
        return {}
    star = table[_solar_month_index(d)]
    return {'star': star, **STARS[star]}


def _element_relation(personal: str, annual: str) -> Dict:
    """How the year's element treats yours, on the five-element cycles."""
    if personal == annual:
        return {'relation': 'same', 'tone': 'reinforcing',
                'read': 'The year shares your element — your nature is amplified; strengths and excesses both grow.'}
    if _PRODUCES.get(annual) == personal:
        return {'relation': 'annual_produces_you', 'tone': 'nourishing',
                'read': 'The year feeds you — support, growth and ease arrive; a time to receive and build.'}
    if _PRODUCES.get(personal) == annual:
        return {'relation': 'you_produce_annual', 'tone': 'giving',
                'read': 'You feed the year — productive but draining; you give a lot, so guard your reserves.'}
    if _CONTROLS.get(annual) == personal:
        return {'relation': 'annual_controls_you', 'tone': 'challenging',
                'read': 'The year presses on you — friction and tests; slow down, consolidate, avoid big risks.'}
    if _CONTROLS.get(personal) == annual:
        return {'relation': 'you_control_annual', 'tone': 'empowered',
                'read': 'You master the year — you can shape events and push initiatives with real force.'}
    return {'relation': 'neutral', 'tone': 'neutral', 'read': 'A neutral year — steady, neither lifted nor pressed.'}


def forecast(birth_date: date, for_year: Optional[int] = None) -> Dict:
    """Your principal star against the reigning annual star — the year's weather."""
    if for_year is None:
        from datetime import date as _d
        for_year = _d.today().year
    me = principal_star(birth_date)
    yr = annual_star(for_year)
    rel = _element_relation(me['element'], yr['element'])
    return {
        'year': for_year,
        'your_star': me,
        'annual_star': yr,
        **rel,
    }


def nine_star_report(birth_date: Optional[date] = None, for_year: Optional[int] = None) -> Dict:
    """Full Nine Star Ki snapshot for a person."""
    if not birth_date:
        return {'system': 'nine_star_ki', 'error': 'birth date required'}
    report = {
        'system': 'nine_star_ki',
        'principal_star': principal_star(birth_date),
        'monthly_star': monthly_star(birth_date),
        'forecast': forecast(birth_date, for_year),
    }
    return report
