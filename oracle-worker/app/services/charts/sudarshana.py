"""
JYOTISH ENGINE - SUDARSHANA CHAKRA
Triple-ring analysis from Lagna, Moon, and Sun simultaneously.
Each ring shows year-wise activation.

When a house is activated from ALL THREE references → extremely strong year for that area.
Sudarshana means "beautiful vision" — sees life from 3 perspectives at once.
"""

from typing import Dict, List
from ..core.constants import (
    RASHI_LORDS, RASHI_NAMES, HOUSES,
    KENDRA_HOUSES, TRIKONA_HOUSES,
)


class SudarshanChakra:
    """
    Triple-overlay chart analysis.
    Ring 1: From Lagna (physical/external life)
    Ring 2: From Moon (emotional/mental life)
    Ring 3: From Sun (soul/career/authority)
    """

    def __init__(self, planets: Dict, ascendant_rashi: int):
        self.planets = planets
        self.asc_rashi = ascendant_rashi
        self.moon_rashi = planets.get('Moon', {}).get('rashi', 0)
        self.sun_rashi = planets.get('Sun', {}).get('rashi', 0)

    def _house_from_ref(self, planet_rashi: int, ref_rashi: int) -> int:
        return ((planet_rashi - ref_rashi) % 12) + 1

    def _get_house_occupants(self, ref_rashi: int, house: int) -> List[str]:
        target_rashi = (ref_rashi + house - 1) % 12
        return [p for p, d in self.planets.items() if d.get('rashi') == target_rashi]

    def _get_house_lord(self, ref_rashi: int, house: int) -> str:
        target_rashi = (ref_rashi + house - 1) % 12
        return RASHI_LORDS[target_rashi]

    def get_year_prediction(self, year_number: int) -> Dict:
        """
        Predict themes for a specific year of life.
        Year 1 = 1st house, Year 2 = 2nd house, ... Year 13 = 1st house again.
        Sudarshana cycles every 12 years.
        """
        house = ((year_number - 1) % 12) + 1

        lagna_ring = self._analyze_ring('Lagna', self.asc_rashi, house)
        moon_ring = self._analyze_ring('Moon', self.moon_rashi, house)
        sun_ring = self._analyze_ring('Sun', self.sun_rashi, house)

        # Count how many rings activate this house strongly
        strong_count = sum(1 for r in [lagna_ring, moon_ring, sun_ring]
                          if r['strength'] in ('Strong', 'Very Strong'))

        if strong_count == 3:
            overall = 'Extremely Powerful Year'
            description = 'All three references activate this house — major life events guaranteed'
        elif strong_count == 2:
            overall = 'Strong Year'
            description = 'Two references support — significant developments expected'
        elif strong_count == 1:
            overall = 'Moderate Year'
            description = 'One reference active — some developments in this area'
        else:
            overall = 'Quiet Year'
            description = 'No strong activation — routine period for this area'

        house_meaning = HOUSES.get(house, {}).get('signifies', [])

        return {
            'year_number': year_number,
            'house': house,
            'house_meaning': house_meaning[:5],
            'lagna_ring': lagna_ring,
            'moon_ring': moon_ring,
            'sun_ring': sun_ring,
            'overall': overall,
            'strong_count': strong_count,
            'description': description,
        }

    def _analyze_ring(self, ring_name: str, ref_rashi: int, house: int) -> Dict:
        occupants = self._get_house_occupants(ref_rashi, house)
        lord = self._get_house_lord(ref_rashi, house)
        lord_rashi = self.planets.get(lord, {}).get('rashi', 0)
        lord_house_from_ref = self._house_from_ref(lord_rashi, ref_rashi)

        benefic_occ = [p for p in occupants if p in {'Jupiter', 'Venus', 'Mercury', 'Moon'}]
        malefic_occ = [p for p in occupants if p in {'Sun', 'Mars', 'Saturn', 'Rahu', 'Ketu'}]

        if benefic_occ and not malefic_occ:
            strength = 'Very Strong'
        elif lord_house_from_ref in KENDRA_HOUSES + TRIKONA_HOUSES:
            strength = 'Strong' if not malefic_occ else 'Moderate'
        elif malefic_occ and not benefic_occ:
            strength = 'Weak'
        else:
            strength = 'Moderate'

        return {
            'ring': ring_name,
            'rashi': RASHI_NAMES[(ref_rashi + house - 1) % 12],
            'lord': lord,
            'lord_house': lord_house_from_ref,
            'occupants': occupants,
            'strength': strength,
        }

    def get_life_overview(self, current_age: int) -> Dict:
        """Get Sudarshana overview for key life years."""
        current = self.get_year_prediction(current_age)
        next_year = self.get_year_prediction(current_age + 1)
        prev_year = self.get_year_prediction(current_age - 1) if current_age > 1 else None

        # Find next powerful year
        powerful_years = []
        for y in range(current_age, current_age + 12):
            pred = self.get_year_prediction(y)
            if pred['strong_count'] >= 2:
                powerful_years.append({'year': y, 'age': y, 'overall': pred['overall'],
                                       'house': pred['house']})

        return {
            'current_age': current_age,
            'current_year': current,
            'next_year': next_year,
            'previous_year': prev_year,
            'upcoming_powerful_years': powerful_years[:5],
        }

    def get_full_cycle(self) -> Dict:
        """Get complete 12-year Sudarshana cycle analysis."""
        cycle = {}
        for house in range(1, 13):
            lagna_occ = self._get_house_occupants(self.asc_rashi, house)
            moon_occ = self._get_house_occupants(self.moon_rashi, house)
            sun_occ = self._get_house_occupants(self.sun_rashi, house)

            lagna_lord = self._get_house_lord(self.asc_rashi, house)
            moon_lord = self._get_house_lord(self.moon_rashi, house)
            sun_lord = self._get_house_lord(self.sun_rashi, house)

            combined_planets = set(lagna_occ + moon_occ + sun_occ)

            cycle[house] = {
                'house': house,
                'house_name': HOUSES.get(house, {}).get('name', ''),
                'meaning': HOUSES.get(house, {}).get('signifies', [])[:4],
                'lagna': {'lord': lagna_lord, 'occupants': lagna_occ},
                'moon': {'lord': moon_lord, 'occupants': moon_occ},
                'sun': {'lord': sun_lord, 'occupants': sun_occ},
                'combined_influence': sorted(combined_planets),
                'activation_strength': len(combined_planets),
            }

        return {
            'system': 'Sudarshana Chakra',
            'lagna_rashi': RASHI_NAMES[self.asc_rashi],
            'moon_rashi': RASHI_NAMES[self.moon_rashi],
            'sun_rashi': RASHI_NAMES[self.sun_rashi],
            'cycle': cycle,
        }


def generate_sudarshana(planets: Dict, asc_rashi: int) -> Dict:
    sc = SudarshanChakra(planets, asc_rashi)
    return sc.get_full_cycle()
