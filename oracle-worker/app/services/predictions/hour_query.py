"""
JYOTISH ENGINE - HOUR-LEVEL QUERY
"My meeting is at 3pm tomorrow — will it go well?"
"""

from datetime import datetime
from typing import Dict
from ..core.constants import RASHI_NAMES
from ..core.ephemeris import get_ephemeris

HORA_SEQUENCE = ['Sun', 'Venus', 'Mercury', 'Moon', 'Saturn', 'Jupiter', 'Mars']
DAY_START = {6: 'Sun', 0: 'Moon', 1: 'Mars', 2: 'Mercury', 3: 'Jupiter', 4: 'Venus', 5: 'Saturn'}

CHOGHADIYA_DAY = {
    0: ['Char', 'Labh', 'Amrit', 'Kaal', 'Shubh', 'Rog', 'Udveg', 'Char'],
    1: ['Labh', 'Amrit', 'Kaal', 'Shubh', 'Rog', 'Udveg', 'Char', 'Labh'],
    2: ['Amrit', 'Kaal', 'Shubh', 'Rog', 'Udveg', 'Char', 'Labh', 'Amrit'],
    3: ['Shubh', 'Rog', 'Udveg', 'Char', 'Labh', 'Amrit', 'Kaal', 'Shubh'],
    4: ['Rog', 'Udveg', 'Char', 'Labh', 'Amrit', 'Kaal', 'Shubh', 'Rog'],
    5: ['Udveg', 'Char', 'Labh', 'Amrit', 'Kaal', 'Shubh', 'Rog', 'Udveg'],
    6: ['Kaal', 'Shubh', 'Rog', 'Udveg', 'Char', 'Labh', 'Amrit', 'Kaal'],
}

CHOG_NATURE = {'Amrit': 3, 'Shubh': 2, 'Labh': 2, 'Char': 1, 'Rog': -1, 'Udveg': -1, 'Kaal': -2}

HORA_GOOD_FOR = {
    'Sun': 'Government, authority, meetings with bosses, medical',
    'Moon': 'Travel, public dealings, creativity, starting journeys',
    'Mars': 'Competition, surgery, sports, property deals, confrontation',
    'Mercury': 'Business, signing contracts, communication, interviews, exams',
    'Jupiter': 'Religious acts, teaching, legal matters, finance, auspicious events',
    'Venus': 'Romance, art, beauty, luxury purchases, entertainment',
    'Saturn': 'Labour work, discipline, mining, serving, routine tasks',
}


class HourQuery:
    def __init__(self, engine):
        self.engine = engine
        self.natal = engine.planets
        self.asc_rashi = engine.ascendant_rashi
        self.ephemeris = get_ephemeris()

    def analyze_hour(self, target_dt: datetime, activity: str = 'general') -> Dict:
        """Full analysis of a specific hour."""
        hour = target_dt.hour + target_dt.minute / 60
        weekday = target_dt.weekday()

        # Hora and choghadiya on the real sunrise and sunset of that day at the
        # chart's place (target_dt is local time there). Both counted from 06:00.
        try:
            _, sr, ss = self.engine._local_sun(target_dt)
        except Exception:
            sr, ss = 6.0, 18.0
        from app.services.muhurta.time_systems import hora_at
        current_hora = hora_at(target_dt, sr, ss)['lord']

        # Choghadiya
        day_duration = max(ss - sr, 0.1) / 8
        chog_idx = min(7, int((hour - sr) / day_duration))
        if chog_idx < 0: chog_idx = 0
        chog_list = CHOGHADIYA_DAY.get(weekday, CHOGHADIYA_DAY[0])
        current_chog = chog_list[chog_idx] if chog_idx < len(chog_list) else 'Char'
        chog_score = CHOG_NATURE.get(current_chog, 0)

        # Rahu Kalam check
        rahu_periods = {
            0: (7.5, 9), 1: (15, 16.5), 2: (12, 13.5),
            3: (13.5, 15), 4: (10.5, 12), 5: (9, 10.5), 6: (16.5, 18),
        }
        rk = rahu_periods.get(weekday, (0, 0))
        in_rahu_kalam = rk[0] <= hour <= rk[1]

        # Moon position at that hour
        try:
            jd = self.ephemeris.get_julian_day(target_dt)
            moon_pos = self.ephemeris.get_planet_position(jd, 'Moon')
            moon_nak = moon_pos.get('nakshatra_name', '')
            moon_rashi = RASHI_NAMES[moon_pos.get('rashi', 0)]
        except Exception:
            moon_nak = ''
            moon_rashi = ''

        # Score
        score = 50
        score += chog_score * 10
        if in_rahu_kalam:
            score -= 20
        if current_hora in ('Jupiter', 'Venus', 'Mercury'):
            score += 10
        elif current_hora in ('Saturn', 'Mars'):
            score -= 5

        # Activity-specific scoring
        activity_hora = {
            'meeting': ['Mercury', 'Jupiter'], 'interview': ['Mercury', 'Jupiter', 'Sun'],
            'travel': ['Moon', 'Venus'], 'signing': ['Mercury', 'Jupiter'],
            'medical': ['Sun', 'Mars'], 'romance': ['Venus', 'Moon'],
            'exam': ['Mercury', 'Jupiter'], 'business': ['Mercury', 'Venus'],
            'prayer': ['Jupiter', 'Venus'], 'property': ['Mars', 'Venus', 'Saturn'],
        }
        good_horas = activity_hora.get(activity, ['Jupiter', 'Venus', 'Mercury'])
        if current_hora in good_horas:
            score += 15

        score = max(0, min(100, score))

        if score >= 70: verdict = 'Excellent time'
        elif score >= 55: verdict = 'Good time'
        elif score >= 40: verdict = 'Average — proceed with caution'
        elif score >= 25: verdict = 'Not ideal — postpone if possible'
        else: verdict = 'Poor time — strongly avoid'

        return {
            'datetime': target_dt.strftime('%Y-%m-%d %H:%M'),
            'activity': activity,
            'hora': current_hora,
            'hora_good_for': HORA_GOOD_FOR.get(current_hora, ''),
            'choghadiya': current_chog,
            'choghadiya_nature': 'Best' if chog_score >= 3 else 'Good' if chog_score >= 1 else 'Bad',
            'in_rahu_kalam': in_rahu_kalam,
            'moon_nakshatra': moon_nak,
            'moon_rashi': moon_rashi,
            'score': score,
            'verdict': verdict,
            'warnings': ['RAHU KALAM ACTIVE — avoid new beginnings'] if in_rahu_kalam else [],
            'advice': f'{current_hora} hora is {"perfect" if current_hora in good_horas else "not ideal"} for {activity}. '
                      f'{current_chog} choghadiya is {"auspicious" if chog_score > 0 else "inauspicious"}. '
                      f'{"CAUTION: Rahu Kalam active." if in_rahu_kalam else ""}',
        }


def analyze_hour(engine, target_dt, activity='general'):
    return HourQuery(engine).analyze_hour(target_dt, activity)
