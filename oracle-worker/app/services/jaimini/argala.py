"""
JYOTISH ENGINE - ARGALA (JAIMINI PLANETARY INTERVENTION)
How planets INTERVENE on houses.

Primary Argala: Planets in 2nd, 4th, 11th from a house
Secondary Argala: Planet in 5th from a house
Obstruction (Virodha): Planets in 3rd, 10th, 12th block the argala

If argala has MORE planets than its obstruction → argala prevails.
This shows which houses receive SUPPORT and which are BLOCKED.
"""

from typing import Dict, List
from ..core.constants import HOUSES


class ArgalaAnalysis:
    def __init__(self, planets: Dict, ascendant_rashi: int):
        self.planets = planets
        self.asc_rashi = ascendant_rashi

    def h(self, planet: str) -> int:
        return self.planets.get(planet, {}).get('house', 1)

    def pih(self, house: int) -> List[str]:
        return [p for p in self.planets if self.h(p) == house]

    def _house_n_from(self, base_house: int, n: int) -> int:
        return ((base_house + n - 2) % 12) + 1

    def analyze_argala_for_house(self, house: int) -> Dict:
        """Analyze all argalas (interventions) on a specific house."""

        # Primary Argala sources and their obstructions
        argala_pairs = [
            {'from': 2, 'obstruction': 12, 'type': 'Primary (2nd)', 'nature': 'Wealth/Resource support'},
            {'from': 4, 'obstruction': 10, 'type': 'Primary (4th)', 'nature': 'Happiness/Comfort support'},
            {'from': 11, 'obstruction': 3, 'type': 'Primary (11th)', 'nature': 'Gains/Desire support'},
            {'from': 5, 'obstruction': 9, 'type': 'Secondary (5th)', 'nature': 'Intelligence/Merit support'},
        ]

        results = []
        net_support = 0

        for pair in argala_pairs:
            source_house = self._house_n_from(house, pair['from'])
            obstruct_house = self._house_n_from(house, pair['obstruction'])

            source_planets = self.pih(source_house)
            obstruct_planets = self.pih(obstruct_house)

            # Argala prevails if source has more planets than obstruction
            if len(source_planets) > len(obstruct_planets):
                status = 'Active'
                net_support += 1
            elif len(source_planets) > 0 and len(source_planets) == len(obstruct_planets):
                status = 'Contested'
            elif len(source_planets) > 0:
                status = 'Obstructed'
                net_support -= 1
            else:
                status = 'None'

            if source_planets or obstruct_planets:
                results.append({
                    'type': pair['type'],
                    'nature': pair['nature'],
                    'source_house': source_house,
                    'source_planets': source_planets,
                    'obstruction_house': obstruct_house,
                    'obstruction_planets': obstruct_planets,
                    'status': status,
                })

        if net_support >= 2:
            overall = 'Strongly Supported'
        elif net_support >= 1:
            overall = 'Supported'
        elif net_support <= -1:
            overall = 'Obstructed'
        else:
            overall = 'Neutral'

        return {
            'house': house,
            'house_meaning': HOUSES.get(house, {}).get('signifies', [])[:3],
            'argalas': results,
            'net_support': net_support,
            'overall': overall,
        }

    def analyze_all_houses(self) -> Dict:
        """Analyze argala for all 12 houses."""
        analysis = {}
        supported = []
        obstructed = []

        for house in range(1, 13):
            result = self.analyze_argala_for_house(house)
            analysis[house] = result
            if result['overall'] in ('Strongly Supported', 'Supported'):
                supported.append(house)
            elif result['overall'] == 'Obstructed':
                obstructed.append(house)

        return {
            'system': 'Argala (Jaimini Intervention)',
            'house_analysis': analysis,
            'supported_houses': supported,
            'obstructed_houses': obstructed,
            'summary': f'{len(supported)} houses supported, {len(obstructed)} obstructed',
        }


def analyze_argala(planets, asc_rashi):
    a = ArgalaAnalysis(planets, asc_rashi)
    return a.analyze_all_houses()
