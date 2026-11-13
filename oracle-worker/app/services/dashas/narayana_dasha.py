"""
JYOTISH ENGINE - NARAYANA DASHA
Jaimini sign-based dasha used by K.N. Rao school.
Similar to Chara but uses different calculation for dasha years.
Based on the stronger between Lagna lord's sign and 7th from it.
"""

from datetime import datetime, timedelta
from typing import Dict, List
from ..core.constants import RASHI_LORDS, RASHI_NAMES

ODD_SIGNS = {0, 2, 4, 6, 8, 10}


class NarayanaDasha:
    def __init__(self, planets: Dict, ascendant_rashi: int, birth_datetime: datetime):
        self.planets = planets
        self.asc_rashi = ascendant_rashi
        self.birth_dt = birth_datetime

    def _is_odd(self, rashi: int) -> bool:
        return rashi in ODD_SIGNS

    def _planet_rashi(self, planet: str) -> int:
        return self.planets.get(planet, {}).get('rashi', 0)

    def _count_planets_in_sign(self, rashi: int) -> int:
        return sum(1 for p, d in self.planets.items() if d.get('rashi') == rashi)

    def _sign_strength(self, rashi: int) -> int:
        """Strength of sign for Narayana Dasha ordering."""
        lord = RASHI_LORDS[rashi]
        lord_rashi = self._planet_rashi(lord)
        planets_count = self._count_planets_in_sign(rashi)
        
        # Strength = planets in sign + lord's placement quality
        score = planets_count * 2
        lord_house = ((lord_rashi - rashi) % 12) + 1
        if lord_house in [1, 4, 7, 10]: score += 3
        elif lord_house in [1, 5, 9]: score += 2
        return score

    def calculate_dasha_years(self, rashi: int) -> int:
        """Calculate years using Narayana method."""
        lord = RASHI_LORDS[rashi]
        lord_rashi = self._planet_rashi(lord)

        if self._is_odd(rashi):
            distance = (lord_rashi - rashi) % 12
        else:
            distance = (rashi - lord_rashi) % 12

        years = distance if distance > 0 else 12
        return min(years, 12)

    def get_sequence(self) -> List[int]:
        """Narayana Dasha sequence from Lagna."""
        if self._is_odd(self.asc_rashi):
            return [(self.asc_rashi + i) % 12 for i in range(12)]
        else:
            return [(self.asc_rashi - i) % 12 for i in range(12)]

    def calculate_periods(self) -> List[Dict]:
        sequence = self.get_sequence()
        periods = []
        current_date = self.birth_dt

        for cycle in range(2):
            for rashi in sequence:
                years = self.calculate_dasha_years(rashi)
                end_date = current_date + timedelta(days=int(years * 365.25))
                occupants = [p for p, d in self.planets.items() if d.get('rashi') == rashi]
                periods.append({
                    'rashi': rashi, 'rashi_name': RASHI_NAMES[rashi],
                    'lord': RASHI_LORDS[rashi], 'years': years,
                    'start': current_date.strftime('%Y-%m-%d'),
                    'end': end_date.strftime('%Y-%m-%d'),
                    'start_dt': current_date, 'end_dt': end_date,
                    'occupants': occupants, 'cycle': cycle + 1,
                })
                current_date = end_date
        return periods

    def get_current_dasha(self, query_date: datetime = None) -> Dict:
        if query_date is None:
            query_date = datetime.now()
        periods = self.calculate_periods()
        current = periods[0]
        for p in periods:
            if p['start_dt'] <= query_date < p['end_dt']:
                current = p
                break
        return {
            'system': 'Narayana Dasha',
            'current': {
                'rashi': current['rashi_name'], 'lord': current['lord'],
                'years': current['years'], 'start': current['start'],
                'end': current['end'], 'occupants': current['occupants'],
            },
            'dasha_string': f"ND: {current['rashi_name']}",
        }


def calculate_narayana(planets, asc_rashi, birth_dt):
    nd = NarayanaDasha(planets, asc_rashi, birth_dt)
    return nd.get_current_dasha()
