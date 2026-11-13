"""
KP (Krishnamurti Paddhati) — the ruling planets of NOW.

KP picks the favourable moment by the "ruling planets" of the instant: the day
lord (weekday), the Moon's sign lord and star (nakshatra) lord right now. When
these agree with a benefic the moment is favourable for a decision; the same
planets lend their colour and direction. A light, now-dependent layer that
complements the cuspal-sub-lord prediction work.

Defensive throughout; never raises.
"""

from datetime import datetime
from typing import Dict, Optional


def _safe(fn, default=None):
    try:
        r = fn()
        return r if r is not None else default
    except Exception:
        return default


WEEKDAY_LORD = {0: 'Moon', 1: 'Mars', 2: 'Mercury', 3: 'Jupiter', 4: 'Venus', 5: 'Saturn', 6: 'Sun'}

# colour + direction lent by each ruling planet (shared with the Vedic palette)
PLANET = {
    'Sun':     {'color': 'red/orange',  'direction': 'East'},
    'Moon':    {'color': 'white',       'direction': 'North-West'},
    'Mars':    {'color': 'red',         'direction': 'South'},
    'Mercury': {'color': 'green',       'direction': 'North'},
    'Jupiter': {'color': 'yellow',      'direction': 'North-East'},
    'Venus':   {'color': 'white/pink',  'direction': 'South-East'},
    'Saturn':  {'color': 'blue/black',  'direction': 'West'},
    'Rahu':    {'color': 'smoky grey',  'direction': 'South-West'},
    'Ketu':    {'color': 'multi/brown', 'direction': 'flag'},
}
BENEFIC = {'Jupiter', 'Venus', 'Mercury', 'Moon'}

# 27 nakshatra → ruling (star) lord, in order from Ashwini
NAK_LORDS = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury'] * 3
NAK_SPAN = 360.0 / 27.0
SIGN_LORD = {
    'Aries': 'Mars', 'Taurus': 'Venus', 'Gemini': 'Mercury', 'Cancer': 'Moon',
    'Leo': 'Sun', 'Virgo': 'Mercury', 'Libra': 'Venus', 'Scorpio': 'Mars',
    'Sagittarius': 'Jupiter', 'Capricorn': 'Saturn', 'Aquarius': 'Saturn', 'Pisces': 'Jupiter',
}


def today_guidance(engine, when: Optional[datetime] = None) -> Dict:
    now = when or (engine.local_now() if hasattr(engine, 'local_now') else datetime.now())
    day_lord = WEEKDAY_LORD.get(now.weekday(), 'Sun')
    out: Dict = {'date': now.strftime('%A, %d %B %Y'), 'day_lord': day_lord}

    rps = [day_lord]
    transits = _safe(lambda: engine.get_transit_positions, {})
    transits = transits() if callable(transits) else (transits or {})
    if not isinstance(transits, dict):
        transits = {}
    t_moon = transits.get('Moon', {}) if isinstance(transits.get('Moon'), dict) else {}

    # Moon sign lord
    msign = t_moon.get('sign') or t_moon.get('rashi_name') or ''
    moon_sign_lord = SIGN_LORD.get(msign, '')
    if moon_sign_lord:
        out['moon_sign'] = msign
        out['moon_sign_lord'] = moon_sign_lord
        rps.append(moon_sign_lord)

    # Moon star (nakshatra) lord
    try:
        idx = int(float(t_moon.get('longitude')) / NAK_SPAN) % 27
        star_lord = NAK_LORDS[idx]
        out['moon_star_lord'] = star_lord
        rps.append(star_lord)
    except Exception:
        pass

    rps = list(dict.fromkeys([r for r in rps if r]))   # de-dup, keep order
    out['ruling_planets'] = rps
    benefic_hits = [r for r in rps if r in BENEFIC]
    out['moment_quality'] = ('favourable for decisions' if len(benefic_hits) >= 2
                             else 'mixed — neutral moment' if benefic_hits
                             else 'better to wait for a softer hour')
    # colour/direction lent by the strongest ruling planet (first benefic, else day lord)
    lead = benefic_hits[0] if benefic_hits else day_lord
    out['favorable_color'] = PLANET.get(lead, {}).get('color', '')
    out['favorable_direction'] = PLANET.get(lead, {}).get('direction', '')
    return out


def briefing(engine, when: Optional[datetime] = None) -> str:
    g = today_guidance(engine, when)
    lines = [f"KP RULING PLANETS NOW — {g.get('date','')}"]
    lines.append("Ruling planets: " + ", ".join(g.get('ruling_planets', [])) + ".")
    if g.get('moon_sign_lord'):
        lines.append(f"Moon in {g.get('moon_sign','')} (lord {g['moon_sign_lord']})"
                     + (f", star lord {g['moon_star_lord']}" if g.get('moon_star_lord') else '') + ".")
    lines.append(f"Moment: {g.get('moment_quality','')}. "
                 f"Favourable colour {g.get('favorable_color','')}, direction {g.get('favorable_direction','')}.")
    return "\n".join(lines)
