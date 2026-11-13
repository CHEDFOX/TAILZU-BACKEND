"""
JYOTISH ENGINE - TIME QUERY ENGINE
Query ANY date/period for complete astrological analysis.
"""

from datetime import datetime, date, timedelta
from typing import Dict
from ..core.constants import RASHI_NAMES
from ..core.ephemeris import get_ephemeris

DASHA_ORDER = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury']

GOCHAR_EFFECTS = {
    'Jupiter': {
        1: ('Expenses, travel', -1), 2: ('Wealth, family', 2), 3: ('Obstacles', -1),
        4: ('Domestic issues', -1), 5: ('Children, intelligence', 2), 6: ('Victory, health', 2),
        7: ('Marriage, partnership', 2), 8: ('Obstacles, delays', -1), 9: ('Fortune, promotion', 2),
        10: ('Career challenges', -1), 11: ('Income, gains', 2), 12: ('Expenses', -1),
    },
    'Saturn': {
        1: ('Health, slow progress', -2), 2: ('Financial pressure', -1), 3: ('Gains, promotion', 2),
        4: ('Domestic stress', -1), 5: ('Mind stress', -1), 6: ('Victory, health', 2),
        7: ('Marriage stress', -1), 8: ('Health crisis', -2), 9: ('Obstacles', -1),
        10: ('Career change', 0), 11: ('Income, property', 2), 12: ('Expenses', -1),
    },
    'Rahu': {
        1: ('Identity confusion', -1), 2: ('Financial confusion', -1), 3: ('Courage, tech', 1),
        4: ('Home changes', 0), 5: ('Speculation risk', -1), 6: ('Victory', 1),
        7: ('Unusual partnerships', 0), 8: ('Hidden dangers', -1), 9: ('Foreign travel', 0),
        10: ('Career shift', 0), 11: ('Gains through tech', 1), 12: ('Foreign, expenses', 0),
    },
}


class TimeQueryEngine:
    def __init__(self, engine):
        self.engine = engine
        self.natal = engine.planets
        self.asc_rashi = engine.ascendant_rashi
        self.moon_rashi = engine.planets.get('Moon', {}).get('rashi', 0)
        self.birth_dt = engine.birth_local
        self.ephemeris = get_ephemeris()

    def query_date(self, target_date: datetime) -> Dict:
        positions = self._get_positions_at_date(target_date)
        dasha_info = self._get_dasha_at_date(target_date)
        gochar = self._get_gochar(positions)
        aspects = self._get_aspects(positions)
        double_transit = self._check_double_transit(positions)
        age = target_date.year - self.birth_dt.year

        sudarshana_house = ((age - 1) % 12) + 1 if age > 0 else 1

        try:
            from ..numerology.core import NumerologyEngine
            bd = self.birth_dt
            ne = NumerologyEngine(birth_date=date(bd.year, bd.month, bd.day))
            py = ne.get_personal_year(target_date.year)
            pm = ne.get_personal_month(target_date.year, target_date.month)
        except Exception:
            py = {'personal_year': 5}
            pm = {'personal_month': 5}

        score = self._calculate_period_score(dasha_info, gochar, aspects, double_transit)
        themes = self._extract_themes(dasha_info, gochar, double_transit)

        return {
            'query_date': target_date.strftime('%Y-%m-%d'),
            'age_at_date': age,
            'planetary_positions': {
                p: {'rashi': RASHI_NAMES[d.get('rashi', 0)],
                    'house_from_moon': ((d.get('rashi', 0) - self.moon_rashi) % 12) + 1}
                for p, d in positions.items()
            },
            'dasha': dasha_info,
            'gochar': gochar,
            'transit_aspects': aspects[:5],
            'double_transit': double_transit,
            'sudarshana': {'house': sudarshana_house, 'age': age},
            'numerology': {'personal_year': py.get('personal_year', ''), 'personal_month': pm.get('personal_month', '')},
            'score': score,
            'themes': themes,
            'overall': 'Excellent' if score >= 75 else 'Good' if score >= 60 else 'Mixed' if score >= 45 else 'Challenging' if score >= 30 else 'Difficult',
        }

    def query_period(self, start_date: datetime, end_date: datetime) -> Dict:
        total_days = (end_date - start_date).days
        if total_days <= 0:
            return {'error': 'End date must be after start date'}
        sample_dates = [start_date]
        current = start_date
        while current < end_date:
            current += timedelta(days=30)
            if current < end_date:
                sample_dates.append(current)
        sample_dates.append(end_date)
        samples = [self.query_date(sd) for sd in sample_dates]
        avg_score = sum(s['score'] for s in samples) / len(samples)
        best = max(samples, key=lambda x: x['score'])
        worst = min(samples, key=lambda x: x['score'])
        all_themes = set()
        for s in samples:
            all_themes.update(s.get('themes', []))
        return {
            'period': f"{start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}",
            'duration_days': total_days, 'samples': len(samples),
            'average_score': round(avg_score),
            'overall': 'Excellent' if avg_score >= 75 else 'Good' if avg_score >= 60 else 'Mixed' if avg_score >= 45 else 'Challenging',
            'best_period': {'date': best['query_date'], 'score': best['score']},
            'worst_period': {'date': worst['query_date'], 'score': worst['score']},
            'themes': sorted(all_themes),
            'start_analysis': samples[0], 'end_analysis': samples[-1],
        }

    def query_month(self, year: int, month: int) -> Dict:
        start = datetime(year, month, 1)
        end = datetime(year, month + 1, 1) - timedelta(days=1) if month < 12 else datetime(year + 1, 1, 1) - timedelta(days=1)
        return self.query_period(start, end)

    def query_year(self, year: int) -> Dict:
        months = []
        for m in range(1, 13):
            analysis = self.query_date(datetime(year, m, 15))
            months.append({
                'month': m, 'month_name': datetime(year, m, 1).strftime('%B'),
                'score': analysis['score'], 'overall': analysis['overall'],
                'dasha': analysis['dasha'].get('dasha_string', ''),
                'themes': analysis['themes'][:2],
            })
        avg = sum(m['score'] for m in months) / 12
        best = max(months, key=lambda x: x['score'])
        worst = min(months, key=lambda x: x['score'])
        return {
            'year': year, 'average_score': round(avg),
            'overall': 'Excellent' if avg >= 75 else 'Good' if avg >= 60 else 'Mixed' if avg >= 45 else 'Challenging',
            'months': months,
            'best_month': {'month': best['month_name'], 'score': best['score']},
            'worst_month': {'month': worst['month_name'], 'score': worst['score']},
        }

    def _get_positions_at_date(self, dt):
        try:
            jd = self.ephemeris.get_julian_day(dt)
            positions = {}
            for planet in ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu']:
                try:
                    positions[planet] = self.ephemeris.get_planet_position(jd, planet)
                except Exception:
                    pass
            return positions
        except Exception:
            return {}

    def _get_dasha_at_date(self, dt):
        try:
            dasha = self.engine.get_vimshottari_dasha()
            maha = dasha.get('mahadasha', {}).get('lord', '')
            antar = dasha.get('antardasha', {}).get('lord', '')
            try:
                a_end = datetime.fromisoformat(dasha.get('antardasha', {}).get('end', '2000-01-01'))
                if dt > a_end:
                    idx = DASHA_ORDER.index(antar)
                    antar = DASHA_ORDER[(idx + 1) % 9]
            except Exception:
                pass
            return {'mahadasha': maha, 'antardasha': antar, 'dasha_string': f'{maha}/{antar}'}
        except Exception:
            return {'dasha_string': 'Unknown', 'mahadasha': '', 'antardasha': ''}

    def _get_gochar(self, positions):
        results = {}
        for planet in ['Jupiter', 'Saturn', 'Rahu']:
            p_rashi = positions.get(planet, {}).get('rashi', 0)
            h = ((p_rashi - self.moon_rashi) % 12) + 1
            effects = GOCHAR_EFFECTS.get(planet, {}).get(h, ('General', 0))
            results[planet] = {'rashi': RASHI_NAMES[p_rashi], 'house_from_moon': h, 'effects': effects[0], 'score': effects[1]}
        return results

    def _get_aspects(self, positions):
        aspects = []
        angles = {0: 'Conjunction', 120: 'Trine', 90: 'Square', 180: 'Opposition'}
        for t_p in ['Jupiter', 'Saturn', 'Mars']:
            t_lon = positions.get(t_p, {}).get('longitude', 0)
            for n_p in self.natal:
                n_lon = self.natal[n_p].get('longitude', 0)
                diff = abs(t_lon - n_lon)
                if diff > 180: diff = 360 - diff
                for angle, name in angles.items():
                    if abs(diff - angle) <= 8:
                        nature = 'Benefic' if name in ('Trine', 'Conjunction') and t_p == 'Jupiter' else 'Malefic' if name in ('Square', 'Opposition') and t_p in ('Saturn', 'Mars') else 'Mixed'
                        aspects.append({'transit': t_p, 'natal': n_p, 'aspect': name, 'nature': nature})
        return aspects

    def _check_double_transit(self, positions):
        jup_r = positions.get('Jupiter', {}).get('rashi', 0)
        sat_r = positions.get('Saturn', {}).get('rashi', 0)
        jup_asp = {jup_r, (jup_r+4)%12, (jup_r+6)%12, (jup_r+8)%12}
        sat_asp = {sat_r, (sat_r+2)%12, (sat_r+6)%12, (sat_r+9)%12}
        overlap = jup_asp & sat_asp
        houses = [((r - self.asc_rashi) % 12) + 1 for r in overlap]
        meanings = {1:'Self',2:'Wealth',3:'Courage',4:'Property',5:'Children',6:'Victory',7:'Marriage',8:'Transformation',9:'Fortune',10:'Career',11:'Gains',12:'Foreign'}
        return {'active_houses': sorted(houses), 'meanings': [meanings.get(h,'') for h in sorted(houses)], 'count': len(houses)}

    def _calculate_period_score(self, dasha, gochar, aspects, dt):
        score = 50
        for p, d in gochar.items():
            score += d.get('score', 0) * 5
        for a in aspects[:5]:
            if a['nature'] == 'Benefic': score += 3
            elif a['nature'] == 'Malefic': score -= 3
        good = [h for h in dt.get('active_houses', []) if h in [2,5,7,9,10,11]]
        bad = [h for h in dt.get('active_houses', []) if h in [6,8,12]]
        score += len(good) * 3 - len(bad) * 2
        maha = dasha.get('mahadasha', '')
        if maha in ('Jupiter', 'Venus', 'Mercury'): score += 5
        elif maha in ('Saturn', 'Rahu', 'Ketu'): score -= 3
        return max(0, min(100, score))

    def _extract_themes(self, dasha, gochar, dt):
        themes = []
        house_theme = {7:'Marriage/Partnership',10:'Career change',2:'Financial gains',11:'Financial gains',9:'Fortune/Travel',5:'Children/Creativity',4:'Property/Home',12:'Foreign/Spiritual',6:'Health attention',8:'Transformation'}
        for h in dt.get('active_houses', []):
            if h in house_theme: themes.append(house_theme[h])
        for p, d in gochar.items():
            if d.get('score', 0) >= 2: themes.append(f'{p} favorable')
            elif d.get('score', 0) <= -2: themes.append(f'{p} challenging')
        maha = dasha.get('mahadasha', '')
        if maha: themes.append(f'{maha} dasha energy')
        return themes[:6]


def query_time_period(engine, start, end=None):
    tq = TimeQueryEngine(engine)
    if end: return tq.query_period(start, end)
    return tq.query_date(start)
