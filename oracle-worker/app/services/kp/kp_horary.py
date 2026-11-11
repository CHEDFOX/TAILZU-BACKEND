"""
KP HORARY — Number-Based Prashna System (1-249)

The querent thinks of a number between 1 and 249.
That number maps to a specific degree of the zodiac (sub-lord level).
A chart is cast with that degree as the ascendant.
The sub-lord of the relevant cusp decides YES or NO.

This is the purest form of KP — no birth data needed.
"""

from datetime import datetime
from typing import Dict
from ..core.constants import RASHI_NAMES, NAKSHATRA_NAMES, NAKSHATRA_LORDS, RASHI_LORDS

DASHA_SEQUENCE = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury']
VIMSHOTTARI_YEARS = {
    'Ketu': 7, 'Venus': 20, 'Sun': 6, 'Moon': 10, 'Mars': 7,
    'Rahu': 18, 'Jupiter': 16, 'Saturn': 19, 'Mercury': 17,
}
TOTAL_YEARS = 120

HORARY_EVENTS = {
    'marriage':       {'primary': 7, 'supporting': [2, 11], 'negating': [6, 12]},
    'love':           {'primary': 5, 'supporting': [7, 11], 'negating': [6, 8]},
    'career':         {'primary': 10, 'supporting': [2, 6, 11], 'negating': [5, 8, 12]},
    'job_change':     {'primary': 10, 'supporting': [2, 6, 9, 11], 'negating': [5, 8]},
    'wealth':         {'primary': 2, 'supporting': [6, 10, 11], 'negating': [5, 8, 12]},
    'children':       {'primary': 5, 'supporting': [2, 11], 'negating': [4, 10]},
    'health':         {'primary': 1, 'supporting': [5, 11], 'negating': [6, 8, 12]},
    'education':      {'primary': 4, 'supporting': [9, 11], 'negating': [3, 8]},
    'travel':         {'primary': 9, 'supporting': [3, 12], 'negating': [4, 11]},
    'property':       {'primary': 4, 'supporting': [11, 12], 'negating': [3, 5, 10]},
    'litigation':     {'primary': 7, 'supporting': [1, 6, 11], 'negating': [12]},
    'business':       {'primary': 7, 'supporting': [2, 10, 11], 'negating': [6, 8, 12]},
    'lost_object':    {'primary': 2, 'supporting': [6, 11], 'negating': [8, 12]},
    'general':        {'primary': 1, 'supporting': [9, 10, 11], 'negating': [6, 8, 12]},
}


def _build_249_table():
    """Build the complete 1-249 sub-lord table (27 nakshatras × 9 subs = 243 entries)."""
    nak_span = 360.0 / 27
    table = []
    number = 1
    for nak_idx in range(27):
        nak_start = nak_idx * nak_span
        nak_lord = NAKSHATRA_LORDS[nak_idx]
        lord_start_idx = DASHA_SEQUENCE.index(nak_lord)
        accumulated = 0.0
        for sub_i in range(9):
            sub_planet = DASHA_SEQUENCE[(lord_start_idx + sub_i) % 9]
            sub_span = nak_span * (VIMSHOTTARI_YEARS[sub_planet] / TOTAL_YEARS)
            start_deg = nak_start + accumulated
            end_deg = start_deg + sub_span
            sign_idx = int(start_deg / 30) % 12
            table.append({
                'number': number, 'start_deg': round(start_deg, 4),
                'end_deg': round(end_deg, 4), 'sign': RASHI_NAMES[sign_idx],
                'sign_lord': RASHI_LORDS[sign_idx], 'star': NAKSHATRA_NAMES[nak_idx],
                'star_lord': nak_lord, 'sub_lord': sub_planet,
            })
            number += 1
            accumulated += sub_span
    return table


KP_249_TABLE = _build_249_table()


def get_sub_entry(number: int) -> Dict:
    idx = max(0, min(number - 1, len(KP_249_TABLE) - 1))
    return KP_249_TABLE[idx]


def _get_sub_lord(longitude: float) -> str:
    nak_span = 360.0 / 27
    nak_idx = int(longitude / nak_span) % 27
    pos_in_nak = longitude % nak_span
    nak_lord = NAKSHATRA_LORDS[nak_idx]
    start_idx = DASHA_SEQUENCE.index(nak_lord)
    accumulated = 0.0
    for i in range(9):
        planet = DASHA_SEQUENCE[(start_idx + i) % 9]
        sub_span = nak_span * (VIMSHOTTARI_YEARS[planet] / TOTAL_YEARS)
        if accumulated + sub_span > pos_in_nak:
            return planet
        accumulated += sub_span
    return nak_lord


class KPHorary:
    """KP Horary analysis using number 1-249."""

    def __init__(self, number: int, question: str = "", category: str = "general",
                 latitude: float = 28.6, longitude: float = 77.2):
        self.number = max(1, min(249, number))
        self.question = question
        self.category = category if category in HORARY_EVENTS else "general"
        self.latitude = latitude
        self.longitude = longitude
        self.query_time = datetime.now()
        self._entry = get_sub_entry(self.number)
        self._asc_long = (self._entry['start_deg'] + self._entry['end_deg']) / 2.0

    def _build_cusps(self) -> Dict:
        cusps = {}
        for i in range(12):
            cusp_long = (self._asc_long + i * 30) % 360
            sign_idx = int(cusp_long / 30) % 12
            nak_idx = int(cusp_long / (360 / 27)) % 27
            cusps[i + 1] = {
                'longitude': round(cusp_long, 4), 'sign': RASHI_NAMES[sign_idx],
                'sign_lord': RASHI_LORDS[sign_idx], 'star': NAKSHATRA_NAMES[nak_idx],
                'star_lord': NAKSHATRA_LORDS[nak_idx],
                'sub_lord': _get_sub_lord(cusp_long),
            }
        return cusps

    def _get_transit_planets(self) -> Dict:
        try:
            from ..core.ephemeris import get_ephemeris
            eph = get_ephemeris('LAHIRI')
            planets = eph.get_current_transits()
            asc_rashi = int(self._asc_long / 30) % 12
            result = {}
            for name in ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu']:
                p = planets.get(name, {})
                p_rashi = p.get('rashi', 0)
                house = ((p_rashi - asc_rashi) % 12) + 1
                result[name] = {
                    'house': house, 'sign': p.get('rashi_name', ''),
                    'star_lord': NAKSHATRA_LORDS[int(p.get('longitude', 0) / (360 / 27)) % 27],
                    'sub_lord': _get_sub_lord(p.get('longitude', 0)),
                    'retrograde': p.get('retrograde', False),
                }
            return result
        except Exception:
            return {}

    def _ruling_planets(self) -> Dict:
        try:
            from ..core.ephemeris import get_ephemeris
            eph = get_ephemeris('LAHIRI')
            jd = eph.get_julian_day(self.query_time)
            moon = eph.get_planet_position(jd, 'Moon')
            ml = moon['longitude']
            day_lords = {0: 'Moon', 1: 'Mars', 2: 'Mercury', 3: 'Jupiter',
                         4: 'Venus', 5: 'Saturn', 6: 'Sun'}
            dl = day_lords[self.query_time.weekday()]
            rps = list(dict.fromkeys([
                dl, RASHI_LORDS[int(ml / 30) % 12],
                NAKSHATRA_LORDS[int(ml / (360/27)) % 27],
                _get_sub_lord(ml), self._entry['sign_lord'], self._entry['star_lord']
            ]))
            return {'ruling_planets': rps, 'day_lord': dl}
        except Exception:
            return {'ruling_planets': [], 'day_lord': ''}

    def analyze(self) -> Dict:
        event_cfg = HORARY_EVENTS[self.category]
        primary = event_cfg['primary']
        supporting = event_cfg['supporting']
        negating = event_cfg['negating']

        cusps = self._build_cusps()
        planets = self._get_transit_planets()

        csl = cusps.get(primary, {}).get('sub_lord', '')
        csl_data = planets.get(csl, {})
        csl_house = csl_data.get('house', 0)
        csl_star = csl_data.get('star_lord', '')
        csl_star_house = planets.get(csl_star, {}).get('house', 0)

        csl_signified = set(filter(None, [csl_house, csl_star_house]))
        promise_set = set([primary] + supporting)
        denial_set = set(negating)
        favorable = csl_signified & promise_set
        unfavorable = csl_signified & denial_set

        if favorable and not unfavorable:
            verdict, conf = 'YES', min(80 + len(favorable) * 5, 95)
            reason = f"CSL {csl} (H{csl_house}) signifies favorable houses {sorted(favorable)}"
        elif unfavorable and not favorable:
            verdict, conf = 'NO', min(75 + len(unfavorable) * 5, 90)
            reason = f"CSL {csl} (H{csl_house}) signifies unfavorable houses {sorted(unfavorable)}"
        elif favorable and unfavorable:
            verdict = 'YES with delays' if len(favorable) >= len(unfavorable) else 'Unlikely'
            conf = 50
            reason = f"CSL {csl} signifies both favorable {sorted(favorable)} and unfavorable {sorted(unfavorable)}"
        else:
            verdict, conf = 'Uncertain', 40
            reason = f"CSL {csl} does not strongly connect to relevant houses"

        rp = self._ruling_planets()
        return {
            'number': self.number, 'question': self.question, 'category': self.category,
            'ascendant': {'sign': self._entry['sign'], 'star': self._entry['star'], 'sub': self._entry['sub_lord']},
            'primary_house': primary, 'cusp_sub_lord': csl, 'csl_house': csl_house,
            'verdict': verdict, 'confidence_pct': conf, 'reasoning': reason,
            'ruling_planets': rp, 'cusps': cusps,
        }
