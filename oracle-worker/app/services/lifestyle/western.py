"""
WESTERN — today's practical guidance.

The day's planetary ruler (Chaldean) gives the colour / metal / herb / gem and
theme; the planetary HOUR gives what the current stretch favours; the Moon
phase gives the rhythm (begin / build / culminate / release); and retrograde
flags warn what to defer. Planetary hours use an equal-hour approximation from a
~6am sunrise — framed as approximate.

Self-contained tables + light engine reads; never raises.
"""

from datetime import datetime
from typing import Dict, Optional


def _safe(fn, default=None):
    try:
        r = fn()
        return r if r is not None else default
    except Exception:
        return default


# weekday (Mon=0…Sun=6) → Chaldean day ruler
WEEKDAY_RULER = {0: 'Moon', 1: 'Mars', 2: 'Mercury', 3: 'Jupiter', 4: 'Venus', 5: 'Saturn', 6: 'Sun'}
# Chaldean order (slowest→fastest) used to walk the planetary hours
CHALDEAN = ['Saturn', 'Jupiter', 'Mars', 'Sun', 'Venus', 'Mercury', 'Moon']

PLANET = {
    'Sun':     {'colors': 'gold, orange', 'metal': 'gold',   'herb': 'bay, sunflower, frankincense', 'gem': 'citrine, amber',      'theme': 'vitality, recognition, the self'},
    'Moon':    {'colors': 'silver, white','metal': 'silver', 'herb': 'jasmine, willow, mugwort',     'gem': 'moonstone, pearl',    'theme': 'emotion, home, intuition'},
    'Mars':    {'colors': 'red, scarlet', 'metal': 'iron',   'herb': 'nettle, garlic, pepper',       'gem': 'ruby, garnet',        'theme': 'drive, courage, action'},
    'Mercury': {'colors': 'yellow, mixed','metal': 'mercury','herb': 'lavender, dill, fennel',       'gem': 'agate, citrine',      'theme': 'communication, trade, learning'},
    'Jupiter': {'colors': 'royal blue, purple', 'metal': 'tin', 'herb': 'sage, cedar, nutmeg',       'gem': 'sapphire, amethyst',  'theme': 'growth, luck, generosity'},
    'Venus':   {'colors': 'green, pink',  'metal': 'copper', 'herb': 'rose, vervain, thyme',         'gem': 'emerald, rose quartz','theme': 'love, beauty, pleasure'},
    'Saturn':  {'colors': 'black, grey',  'metal': 'lead',   'herb': 'comfrey, cypress, myrrh',      'gem': 'onyx, jet',           'theme': 'discipline, structure, endings'},
}

# Synodic month from a known new moon (2000-01-06 18:14 UTC ≈ JD reference)
_SYNODIC = 29.530588
_NEW_MOON_REF = datetime(2000, 1, 6, 18, 14)


def _moon_phase(now: datetime) -> Dict:
    days = (now - _NEW_MOON_REF).total_seconds() / 86400.0
    age = days % _SYNODIC
    frac = age / _SYNODIC
    if frac < 0.03 or frac > 0.97:
        name, guide = 'New Moon', 'begin, set intentions, plant seeds'
    elif frac < 0.22:
        name, guide = 'Waxing Crescent', 'take first steps, gather momentum'
    elif frac < 0.28:
        name, guide = 'First Quarter', 'push through resistance, commit, decide'
    elif frac < 0.47:
        name, guide = 'Waxing Gibbous', 'refine, adjust, persevere'
    elif frac < 0.53:
        name, guide = 'Full Moon', 'culminate, celebrate, or release what is ripe'
    elif frac < 0.72:
        name, guide = 'Waning Gibbous', 'share, give back, express gratitude'
    elif frac < 0.78:
        name, guide = 'Last Quarter', 'let go, forgive, clear the decks'
    else:
        name, guide = 'Waning Crescent', 'rest, retreat, restore before the new cycle'
    return {'phase': name, 'guidance': guide, 'age_days': round(age, 1)}


def _planetary_hour(now: datetime, sunrise: float = 6.0, sunset: float = 18.0) -> Dict:
    """The planetary hour: a twelfth of the real day or night, its ruler walking the
    Chaldean order from the day ruler (the same scheme as the Vedic hora)."""
    from app.services.muhurta.time_systems import hora_at
    h = hora_at(now, sunrise, sunset)
    return {'ruler': h['lord'], 'hour_index': h['number'], 'theme': PLANET.get(h['lord'], {}).get('theme', '')}


def _sun_for(engine, now) -> tuple:
    """(sunrise, sunset) at the chart's place on `now`'s local day, else 06:00/18:00."""
    try:
        _, sr, ss = engine._local_sun(now)
        return sr, ss
    except Exception:
        return 6.0, 18.0


def today_guidance(engine, when: Optional[datetime] = None) -> Dict:
    now = when or (engine.local_now() if hasattr(engine, 'local_now') else datetime.now())
    ruler = WEEKDAY_RULER.get(now.weekday(), 'Sun')
    p = PLANET.get(ruler, {})
    out: Dict = {
        'date': now.strftime('%A, %d %B %Y'),
        'day_ruler': ruler,
        'wear_colors': p.get('colors', ''),
        'metal': p.get('metal', ''),
        'herb': p.get('herb', ''),
        'gem': p.get('gem', ''),
        'day_theme': p.get('theme', ''),
        'moon': _moon_phase(now),
        'planetary_hour': _planetary_hour(now, *(_sun_for(engine, now))),
    }

    # Retrograde flags from current transits, if the engine exposes them
    transits = _safe(lambda: engine.get_transit_positions, {})
    transits = transits() if callable(transits) else (transits or {})
    if isinstance(transits, dict) and transits:
        retro = [name for name, d in transits.items()
                 if isinstance(d, dict) and (d.get('retrograde') or d.get('is_retrograde'))]
        out['retrograde'] = retro
        out['mercury_retrograde'] = 'Mercury' in retro
        t_moon = transits.get('Moon', {}) if isinstance(transits.get('Moon'), dict) else {}
        if t_moon.get('sign') or t_moon.get('rashi_name'):
            out['moon_sign'] = t_moon.get('sign') or t_moon.get('rashi_name')
    return out


def briefing(engine, when: Optional[datetime] = None) -> str:
    g = today_guidance(engine, when)
    lines = [f"WESTERN TODAY — {g.get('date','')} (ruled by {g.get('day_ruler','')})"]
    lines.append(f"Wear {g.get('wear_colors','')}; metal {g.get('metal','')}; "
                 f"gem {g.get('gem','')}; herb/scent {g.get('herb','')}. Theme: {g.get('day_theme','')}.")
    mo = g.get('moon', {})
    if mo:
        lines.append(f"Moon: {mo.get('phase','')} — {mo.get('guidance','')}"
                     + (f" (in {g['moon_sign']})" if g.get('moon_sign') else '') + ".")
    ph = g.get('planetary_hour', {})
    if ph:
        lines.append(f"Planetary hour now (~): {ph.get('ruler','')} — favours {ph.get('theme','')}.")
    if g.get('mercury_retrograde'):
        lines.append("Mercury is retrograde — recheck contracts, devices and travel; revise rather than launch.")
    elif g.get('retrograde'):
        lines.append("Retrograde now: " + ", ".join(g['retrograde']) + ".")
    return "\n".join(lines)
