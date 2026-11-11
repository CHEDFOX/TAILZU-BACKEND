"""
VEDIC (Jyotish) — today's practical guidance.

From the weekday's ruling planet we give the colour to wear, the metal, the
direction to face and the deity/charity; from the chart's ascendant lord, the
gemstone that supports the person; from the transit Moon vs the birth star, the
Tara Bala (whether today is personally auspicious); plus Disha Shool (the
direction NOT to begin travel today) and today's good/avoid windows.

Defensive throughout — any missing engine value degrades one field, never raises.
"""

from datetime import datetime
from typing import Dict, Optional


def _safe(fn, default=None):
    try:
        r = fn()
        return r if r is not None else default
    except Exception:
        return default


# python weekday(): Mon=0 … Sun=6  →  ruling planet
WEEKDAY_LORD = {0: 'Moon', 1: 'Mars', 2: 'Mercury', 3: 'Jupiter', 4: 'Venus', 5: 'Saturn', 6: 'Sun'}

PLANET = {
    'Sun':     {'colors': 'red, orange, deep gold', 'metal': 'gold or copper', 'direction': 'East',       'deity': 'Surya / Shiva',        'gem': 'ruby',           'number': 1, 'day': 'Sunday',    'charity': 'wheat, jaggery, copper to the needy at dawn'},
    'Moon':    {'colors': 'white, cream, silver',   'metal': 'silver',         'direction': 'North-West', 'deity': 'Chandra / Parvati',    'gem': 'pearl',          'number': 2, 'day': 'Monday',    'charity': 'rice, milk, white cloth'},
    'Mars':    {'colors': 'red, coral',             'metal': 'copper',         'direction': 'South',      'deity': 'Hanuman / Kartikeya',  'gem': 'red coral',      'number': 9, 'day': 'Tuesday',   'charity': 'red lentils, jaggery, red cloth'},
    'Mercury': {'colors': 'green, emerald',         'metal': 'bronze or gold', 'direction': 'North',      'deity': 'Vishnu / Budha',       'gem': 'emerald',        'number': 5, 'day': 'Wednesday', 'charity': 'green gram, green cloth to students'},
    'Jupiter': {'colors': 'yellow, gold',           'metal': 'gold',           'direction': 'North-East', 'deity': 'Brihaspati / Vishnu',  'gem': 'yellow sapphire','number': 3, 'day': 'Thursday',  'charity': 'turmeric, chana dal, books, gold'},
    'Venus':   {'colors': 'white, pink, pastels',   'metal': 'silver',         'direction': 'South-East', 'deity': 'Lakshmi / Shukra',     'gem': 'diamond',        'number': 6, 'day': 'Friday',    'charity': 'white cloth, sugar, rice, perfume'},
    'Saturn':  {'colors': 'black, dark blue',       'metal': 'iron',           'direction': 'West',       'deity': 'Shani / Hanuman',      'gem': 'blue sapphire',  'number': 8, 'day': 'Saturday',  'charity': 'black sesame, mustard oil, iron, to labourers'},
}

SIGN_LORD = {
    'Aries': 'Mars', 'Mesha': 'Mars', 'Taurus': 'Venus', 'Vrishabha': 'Venus',
    'Gemini': 'Mercury', 'Mithuna': 'Mercury', 'Cancer': 'Moon', 'Karka': 'Moon',
    'Leo': 'Sun', 'Simha': 'Sun', 'Virgo': 'Mercury', 'Kanya': 'Mercury',
    'Libra': 'Venus', 'Tula': 'Venus', 'Scorpio': 'Mars', 'Vrishchika': 'Mars',
    'Sagittarius': 'Jupiter', 'Dhanu': 'Jupiter', 'Capricorn': 'Saturn', 'Makara': 'Saturn',
    'Aquarius': 'Saturn', 'Kumbha': 'Saturn', 'Pisces': 'Jupiter', 'Meena': 'Jupiter',
}

# Disha Shool — the direction NOT to begin a journey on a given weekday (Mon=0…Sun=6)
DISHA_SHOOL = {0: 'East', 5: 'East', 6: 'West', 4: 'West', 1: 'North', 2: 'North', 3: 'South'}

# Tara Bala — counting the transit Moon's nakshatra from the birth star, in 9s
TARA = [
    ('Janma',  'caution — guard the body and big risks'),
    ('Sampat', 'wealth & gain — very favourable'),
    ('Vipat',  'danger — avoid new or risky ventures'),
    ('Kshema', 'well-being — favourable, secure'),
    ('Pratyak','obstacles — postpone the important'),
    ('Sadhaka','accomplishment — favourable for effort'),
    ('Vadha',  'resistance — avoid anything decisive'),
    ('Mitra',  'friendly — supportive day'),
    ('Param Mitra', 'most friendly — excellent day'),
]
TARA_GOOD = {1, 3, 5, 7, 8}        # indices (1-based) that are auspicious
NAK_SPAN = 360.0 / 27.0


def _nak_index(longitude) -> Optional[int]:
    try:
        return int(float(longitude) / NAK_SPAN) % 27
    except Exception:
        return None


def today_guidance(engine, when: Optional[datetime] = None) -> Dict:
    now = when or (engine.local_now() if hasattr(engine, 'local_now') else datetime.now())
    wd = now.weekday()
    lord = WEEKDAY_LORD.get(wd, 'Sun')
    p = PLANET.get(lord, {})
    out: Dict = {
        'date': now.strftime('%A, %d %B %Y'),
        'day_lord': lord,
        'wear_colors': p.get('colors', ''),
        'metal': p.get('metal', ''),
        'face_direction': p.get('direction', ''),
        'deity': p.get('deity', ''),
        'lucky_number': p.get('number', ''),
        'charity': p.get('charity', ''),
        'disha_shool': DISHA_SHOOL.get(wd, ''),
    }

    # Gemstone that supports the person — ascendant (lagna) lord's stone
    asc = _safe(lambda: engine.ascendant, {}) or {}
    asc_sign = asc.get('rashi_name') or asc.get('sign') or ''
    lagna_lord = SIGN_LORD.get(asc_sign, '')
    if lagna_lord:
        out['ascendant'] = asc_sign
        out['lagna_lord'] = lagna_lord
        out['supportive_gem'] = (PLANET.get(lagna_lord, {}) or {}).get('gem', '')

    # Tara Bala — is today personally auspicious (transit Moon star vs birth star)
    planets = _safe(lambda: engine.planets, {}) or {}
    natal_moon = planets.get('Moon', {}) if isinstance(planets.get('Moon'), dict) else {}
    transits = _safe(lambda: engine.get_transit_positions, {})
    transits = transits() if callable(transits) else (transits or {})
    if not isinstance(transits, dict):
        transits = {}
    t_moon = transits.get('Moon', {}) if isinstance(transits.get('Moon'), dict) else {}
    bi = _nak_index(natal_moon.get('longitude'))
    ti = _nak_index(t_moon.get('longitude'))
    if bi is not None and ti is not None:
        count = ((ti - bi) % 27) + 1
        tara_num = ((count - 1) % 9) + 1
        name, meaning = TARA[tara_num - 1]
        out['tara_bala'] = {
            'tara': name, 'number': tara_num,
            'verdict': 'auspicious' if tara_num in TARA_GOOD else 'inauspicious',
            'meaning': meaning,
        }

    # Today's good / avoid windows (reuse the muhurta engine)
    m = _safe(lambda: engine.get_muhurta(now), {}) or {}
    if isinstance(m, dict):
        ab = (m.get('auspicious', {}) or {}).get('abhijit', {}) or {}
        bad = m.get('inauspicious', {}) or {}

        def _win(d):
            s, e = (d or {}).get('start_time'), (d or {}).get('end_time')
            return f"{s} – {e}" if s and e else ''
        out['best_window'] = _win(ab)
        out['avoid_window'] = {
            'rahu_kalam': _win(bad.get('rahu_kalam')),
            'yamaganda': _win(bad.get('yamaganda')),
        }
    return out


def briefing(engine, when: Optional[datetime] = None) -> str:
    g = today_guidance(engine, when)
    lines = [f"VEDIC TODAY — {g.get('date','')} (day of {g.get('day_lord','')})"]
    lines.append(f"Wear {g.get('wear_colors','')}; metal {g.get('metal','')}; "
                 f"face {g.get('face_direction','')} for important work; lucky number {g.get('lucky_number','')}.")
    if g.get('supportive_gem'):
        lines.append(f"Ascendant {g.get('ascendant','')} (lord {g.get('lagna_lord','')}) — supportive gem: {g['supportive_gem']}.")
    if g.get('disha_shool'):
        lines.append(f"Disha Shool: avoid starting travel toward the {g['disha_shool']} today.")
    tb = g.get('tara_bala')
    if tb:
        lines.append(f"Tara Bala: {tb['tara']} ({tb['verdict']}) — {tb['meaning']}.")
    if g.get('best_window'):
        lines.append(f"Best window today (Abhijit): {g['best_window']}.")
    av = g.get('avoid_window') or {}
    avparts = [f"{k.replace('_',' ')} {v}" for k, v in av.items() if v]
    if avparts:
        lines.append("Avoid: " + "; ".join(avparts) + ".")
    lines.append(f"Devotion/charity for {g.get('day_lord','')}: {g.get('charity','')} (deity {g.get('deity','')}).")
    return "\n".join(lines)
