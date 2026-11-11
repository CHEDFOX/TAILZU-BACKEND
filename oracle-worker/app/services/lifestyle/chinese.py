"""
CHINESE (BaZi / Feng Shui) — today's practical guidance.

From the chart's favourable element (Yong Shen) we give the lucky colour to
wear, the lucky direction and number; from today's day-pillar element vs the
Day Master, whether today supports or drains them; the day's clash animal to
be wary of; and the year's Tai Sui (Grand Duke) direction not to face/disturb.

Defensive: BaZi computation is wrapped; missing values degrade a field.
"""

from datetime import datetime
from typing import Dict, Optional


def _safe(fn, default=None):
    try:
        r = fn()
        return r if r is not None else default
    except Exception:
        return default


ELEMENT = {
    'Wood':  {'colors': 'green, teal',          'direction': 'East',   'numbers': '3, 4', 'shape': 'tall/columnar', 'foods': 'sour, green leafy'},
    'Fire':  {'colors': 'red, purple, orange',  'direction': 'South',  'numbers': '9',    'shape': 'triangular',    'foods': 'bitter, warming'},
    'Earth': {'colors': 'yellow, brown, beige', 'direction': 'Centre / North-East & South-West', 'numbers': '2, 5, 8', 'shape': 'square/flat', 'foods': 'sweet, root vegetables'},
    'Metal': {'colors': 'white, gold, grey',    'direction': 'West',   'numbers': '6, 7', 'shape': 'round/metallic', 'foods': 'pungent, white'},
    'Water': {'colors': 'black, deep blue',     'direction': 'North',  'numbers': '1',    'shape': 'wavy/flowing',  'foods': 'salty, dark'},
}

# 12 earthly-branch animals in order + their direct clash (opposite)
ANIMALS = ['Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake', 'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Pig']
CLASH = {'Rat': 'Horse', 'Ox': 'Goat', 'Tiger': 'Monkey', 'Rabbit': 'Rooster',
         'Dragon': 'Dog', 'Snake': 'Pig', 'Horse': 'Rat', 'Goat': 'Ox',
         'Monkey': 'Tiger', 'Rooster': 'Rabbit', 'Dog': 'Dragon', 'Pig': 'Snake'}
# Tai Sui — each year-animal's seat direction (the Grand Duke); facing its
# opposite or disturbing this sector is inauspicious for the year.
ANIMAL_DIRECTION = {
    'Rat': 'North', 'Ox': 'North-North-East', 'Tiger': 'East-North-East', 'Rabbit': 'East',
    'Dragon': 'East-South-East', 'Snake': 'South-South-East', 'Horse': 'South', 'Goat': 'South-South-West',
    'Monkey': 'West-South-West', 'Rooster': 'West', 'Dog': 'West-North-West', 'Pig': 'North-North-West',
}
GENERATES = {'Wood': 'Fire', 'Fire': 'Earth', 'Earth': 'Metal', 'Metal': 'Water', 'Water': 'Wood'}
CONTROLS = {'Wood': 'Earth', 'Earth': 'Water', 'Water': 'Fire', 'Fire': 'Metal', 'Metal': 'Wood'}


def _year_animal(year: int) -> str:
    # 2008 = Rat (start of cycle reference); 12-year cycle
    return ANIMALS[(year - 2008) % 12]


def _bazi(birth_dt):
    from app.services.chinese.bazi import BaZiChart
    return BaZiChart(birth_dt)


def today_guidance(engine, when: Optional[datetime] = None) -> Dict:
    now = when or (engine.local_now() if hasattr(engine, 'local_now') else datetime.now())
    out: Dict = {'date': now.strftime('%A, %d %B %Y')}

    birth_dt = _safe(lambda: engine.birth_dt)
    bal = {}
    if birth_dt is not None:
        bal = _safe(lambda: _bazi(birth_dt).get_element_balance(), {}) or {}
    dm = bal.get('day_master_element', '')
    fav = bal.get('favorable_element', '') or dm
    out['day_master'] = dm
    out['favorable_element'] = fav
    fe = ELEMENT.get(fav, {})
    out['wear_colors'] = fe.get('colors', '')
    out['lucky_direction'] = fe.get('direction', '')
    out['lucky_numbers'] = fe.get('numbers', '')
    out['supportive_foods'] = fe.get('foods', '')

    # Today's day-pillar element vs the Day Master — supportive / draining
    day_pillars = _safe(lambda: _bazi(now).get_four_pillars(), {}) or {}
    day_p = day_pillars.get('day', {}) if isinstance(day_pillars, dict) else {}
    today_el = ((day_p.get('stem', {}) or {}).get('element', '')) if isinstance(day_p, dict) else ''
    today_animal = ((day_p.get('branch', {}) or {}).get('animal', '')) if isinstance(day_p, dict) else ''
    out['today_element'] = today_el
    out['today_animal'] = today_animal
    if today_el and dm:
        if today_el == dm or GENERATES.get(today_el) == dm:
            out['today_for_you'] = 'supportive — your element is fed today'
        elif CONTROLS.get(today_el) == dm:
            out['today_for_you'] = 'demanding — today pushes against your element; pace yourself'
        elif CONTROLS.get(dm) == today_el:
            out['today_for_you'] = 'productive — a good day to act and spend energy'
        else:
            out['today_for_you'] = 'neutral'
    if today_animal:
        out['day_clash_animal'] = CLASH.get(today_animal, '')

    # Tai Sui — this year's Grand Duke direction (avoid facing/disturbing)
    yr_animal = _year_animal(now.year)
    out['year_animal'] = yr_animal
    out['tai_sui_direction'] = ANIMAL_DIRECTION.get(yr_animal, '')
    return out


def briefing(engine, when: Optional[datetime] = None) -> str:
    g = today_guidance(engine, when)
    lines = [f"CHINESE TODAY — {g.get('date','')}"]
    if g.get('favorable_element'):
        lines.append(f"Day Master {g.get('day_master','?')}; favourable element {g['favorable_element']} → "
                     f"wear {g.get('wear_colors','')}, lucky direction {g.get('lucky_direction','')}, "
                     f"numbers {g.get('lucky_numbers','')}, foods {g.get('supportive_foods','')}.")
    if g.get('today_for_you'):
        lines.append(f"Today's energy ({g.get('today_element','')} {g.get('today_animal','')}): {g['today_for_you']}.")
    if g.get('day_clash_animal'):
        lines.append(f"The day clashes with the {g['day_clash_animal']} — those born in its year should keep today low-stakes.")
    if g.get('tai_sui_direction'):
        lines.append(f"This is the year of the {g.get('year_animal','')}; the Tai Sui sits in the {g['tai_sui_direction']} — "
                     "avoid facing it directly or breaking ground there.")
    return "\n".join(lines)
