"""
JYOTISH ENGINE - WEEKLY FORECAST
7-day personalized prediction combining transit + dasha + numerology.
"""

from datetime import date, timedelta
from typing import Dict
from ..numerology.core import NumerologyEngine, _reduce_to_root

DAY_PLANET = {0: 'Moon', 1: 'Mars', 2: 'Mercury', 3: 'Jupiter', 4: 'Venus', 5: 'Saturn', 6: 'Sun'}
RAHU_KALAM = {0: '07:30-09:00', 1: '15:00-16:30', 2: '12:00-13:30', 3: '13:30-15:00', 4: '10:30-12:00', 5: '09:00-10:30', 6: '16:30-18:00'}


class WeeklyForecast:
    def __init__(self, engine):
        self.engine = engine
        self.birth_dt = engine.birth_local
        bd = self.birth_dt
        self.ne = NumerologyEngine(birth_date=date(bd.year, bd.month, bd.day))

    def generate_weekly(self, start_date: date = None) -> Dict:
        if start_date is None:
            start_date = date.today()

        days = []
        for i in range(7):
            d = start_date + timedelta(days=i)
            day_data = self._analyze_day(d)
            days.append(day_data)

        best = max(days, key=lambda x: x['score'])
        worst = min(days, key=lambda x: x['score'])

        return {
            'week_start': start_date.strftime('%Y-%m-%d'),
            'days': days,
            'best_day': {'date': best['date'], 'score': best['score'], 'reason': best['highlight']},
            'worst_day': {'date': worst['date'], 'score': worst['score'], 'reason': worst['highlight']},
        }

    def _analyze_day(self, d: date) -> Dict:
        weekday = d.weekday()
        day_planet = DAY_PLANET[weekday]
        day_name = d.strftime('%A')

        # Personal day number
        try:
            pd = self.ne.get_personal_day(d)
            personal_num = pd.get('personal_day', 1)
        except Exception:
            personal_num = _reduce_to_root(d.day)

        # Score based on day planet friendship with dasha lord
        try:
            dasha = self.engine.get_vimshottari_dasha()
            maha_lord = dasha.get('mahadasha', {}).get('lord', 'Jupiter')
        except Exception:
            maha_lord = 'Jupiter'

        from ..core.constants import PLANETS as PD
        friends = PD.get(maha_lord, {}).get('friends', [])
        enemies = PD.get(maha_lord, {}).get('enemies', [])

        score = 50
        highlight = ''

        if day_planet in friends or day_planet == maha_lord:
            score += 15
            highlight = f'{day_name} ruled by {day_planet} (friendly to your dasha lord {maha_lord})'
        elif day_planet in enemies:
            score -= 10
            highlight = f'{day_name} ruled by {day_planet} (enemy of your dasha lord {maha_lord})'
        else:
            highlight = f'{day_name} ruled by {day_planet} (neutral)'

        # Personal number bonus
        mulank = _reduce_to_root(self.birth_dt.day)
        from ..numerology.core import NUMBER_MEANINGS
        compat = NUMBER_MEANINGS.get(mulank, {}).get('compatible', [])
        if personal_num in compat:
            score += 10
        elif personal_num == mulank:
            score += 15

        score = max(0, min(100, score))

        return {
            'date': d.strftime('%Y-%m-%d'),
            'day': day_name,
            'day_planet': day_planet,
            'personal_number': personal_num,
            'rahu_kalam': RAHU_KALAM[weekday],
            'score': score,
            'highlight': highlight,
        }


def get_weekly_forecast(engine):
    return WeeklyForecast(engine).generate_weekly()
