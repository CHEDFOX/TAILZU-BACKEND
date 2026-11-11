"""
JYOTISH ENGINE - BHAVA CHALIT (CUSP-BASED) CHART
The most important chart after D1 for prediction accuracy.

In Rashi chart: planets are placed by sign.
In Bhava Chalit: planets are placed by house cusps (equal house from Ascendant degree).

A planet at 29° Aries with Ascendant at 15° Taurus:
  - Rashi chart: House 12 (Aries is 12th from Taurus)
  - Bhava Chalit: Could shift to House 11 or stay in 12 depending on cusp

This difference changes predictions for ~20% of planets.
"""

from typing import Dict, List
from ..core.constants import RASHI_NAMES, RASHI_LORDS


class BhavaChalit:
    """
    Equal House Bhava Chalit Calculator.
    
    Uses Ascendant degree as midpoint of 1st house.
    Each house spans 30°, centered on the cusp.
    """

    def __init__(self, planets: Dict, ascendant: Dict):
        """
        Args:
            planets: Dict of planet data with 'longitude', 'rashi', 'house', etc.
            ascendant: Dict with 'longitude' (absolute degree 0-360)
        """
        self.planets = planets
        self.asc_longitude = ascendant.get('longitude', 0.0)
        self.asc_rashi = ascendant.get('rashi', ascendant.get('rashi_index', 0))
        self._cusps = None
        self._bhava_planets = None

    def get_cusps(self) -> List[Dict]:
        """
        Calculate equal house cusps.
        Ascendant degree = midpoint of 1st house.
        Each cusp starts 15° before the house midpoint.
        """
        if self._cusps is not None:
            return self._cusps

        cusps = []
        for house in range(1, 13):
            # Midpoint of each house
            mid = (self.asc_longitude + (house - 1) * 30) % 360
            # Start of house (15° before midpoint)
            start = (mid - 15) % 360
            # End of house (15° after midpoint)
            end = (mid + 15) % 360

            # Determine rashi at midpoint
            mid_rashi = int(mid / 30) % 12

            cusps.append({
                'house': house,
                'midpoint': round(mid, 4),
                'start': round(start, 4),
                'end': round(end, 4),
                'rashi': mid_rashi,
                'rashi_name': RASHI_NAMES[mid_rashi],
                'degree_in_rashi': round(mid % 30, 2),
            })

        self._cusps = cusps
        return cusps

    def get_bhava_house(self, longitude: float) -> int:
        """
        Determine which Bhava house a planet falls in based on cusps.
        
        Args:
            longitude: Absolute longitude of planet (0-360)
        
        Returns:
            House number (1-12)
        """
        cusps = self.get_cusps()

        for cusp in cusps:
            start = cusp['start']
            end = cusp['end']

            if start < end:
                # Normal case: start < end
                if start <= longitude < end:
                    return cusp['house']
            else:
                # Wraps around 360/0
                if longitude >= start or longitude < end:
                    return cusp['house']

        # Fallback (shouldn't reach here)
        return 1

    def generate_bhava_chalit(self) -> Dict:
        """
        Generate complete Bhava Chalit chart.
        Returns planet positions by cusp-based houses + shift analysis.
        """
        cusps = self.get_cusps()
        bhava_planets = {}
        shifts = []

        for planet_name, planet_data in self.planets.items():
            longitude = planet_data.get('longitude', 0.0)
            rashi_house = planet_data.get('house', 1)
            bhava_house = self.get_bhava_house(longitude)

            shifted = rashi_house != bhava_house

            bhava_planets[planet_name] = {
                'longitude': longitude,
                'rashi_house': rashi_house,
                'bhava_house': bhava_house,
                'shifted': shifted,
                'rashi': planet_data.get('rashi', 0),
                'rashi_name': planet_data.get('rashi_name', ''),
                'degree_in_rashi': round(longitude % 30, 2),
            }

            if shifted:
                shifts.append({
                    'planet': planet_name,
                    'from_house': rashi_house,
                    'to_house': bhava_house,
                    'significance': self._get_shift_significance(
                        planet_name, rashi_house, bhava_house
                    ),
                })

        # Build house occupancy for Bhava chart
        house_occupancy = {h: [] for h in range(1, 13)}
        for planet_name, data in bhava_planets.items():
            house_occupancy[data['bhava_house']].append(planet_name)

        return {
            'cusps': cusps,
            'planets': bhava_planets,
            'house_occupancy': house_occupancy,
            'shifts': shifts,
            'total_shifts': len(shifts),
            'shifted_planets': [s['planet'] for s in shifts],
            'analysis': self._analyze_shifts(shifts),
        }

    def _get_shift_significance(self, planet: str, from_h: int, to_h: int) -> str:
        """Explain what a planet shifting houses means."""
        significances = {
            # Planet moving to/from key houses
            (1,): f'{planet} shifts {"to" if to_h == 1 else "from"} Lagna — changes self/health predictions',
            (7,): f'{planet} shifts {"to" if to_h == 7 else "from"} 7th — changes marriage/partnership predictions',
            (10,): f'{planet} shifts {"to" if to_h == 10 else "from"} 10th — changes career predictions',
            (2,): f'{planet} shifts {"to" if to_h == 2 else "from"} 2nd — changes wealth/speech predictions',
            (5,): f'{planet} shifts {"to" if to_h == 5 else "from"} 5th — changes children/intelligence predictions',
            (4,): f'{planet} shifts {"to" if to_h == 4 else "from"} 4th — changes home/mother/property predictions',
            (9,): f'{planet} shifts {"to" if to_h == 9 else "from"} 9th — changes fortune/father predictions',
        }

        for houses, sig in significances.items():
            if to_h in houses or from_h in houses:
                return sig

        return f'{planet} moves from house {from_h} to house {to_h} — affects prediction focus'

    def _analyze_shifts(self, shifts: List[Dict]) -> Dict:
        """High-level analysis of what the shifts mean."""
        if not shifts:
            return {
                'summary': 'No planets shifted between Rashi and Bhava Chalit charts.',
                'impact': 'Low',
                'detail': 'Rashi chart predictions are reliable as-is for this horoscope.',
            }

        planet_names = [s['planet'] for s in shifts]
        high_impact = any(
            s['from_house'] in [1, 7, 10] or s['to_house'] in [1, 7, 10]
            for s in shifts
        )

        return {
            'summary': f'{len(shifts)} planet(s) shifted: {", ".join(planet_names)}. '
                       f'Bhava Chalit should be used for prediction alongside Rashi chart.',
            'impact': 'High' if high_impact else 'Moderate' if len(shifts) >= 2 else 'Low',
            'detail': '; '.join(s['significance'] for s in shifts),
        }

    def get_bhava_lords(self) -> Dict:
        """
        Get lord of each Bhava based on cusp rashi.
        This can differ from Rashi chart house lords.
        """
        cusps = self.get_cusps()
        lords = {}
        for cusp in cusps:
            house = cusp['house']
            rashi = cusp['rashi']
            lords[house] = {
                'lord': RASHI_LORDS[rashi],
                'rashi': rashi,
                'rashi_name': RASHI_NAMES[rashi],
                'cusp_degree': cusp['midpoint'],
            }
        return lords

    def get_bhava_madhya_sandhi(self) -> Dict:
        """
        Calculate Bhava Madhya (midpoint) and Sandhi (junction) for each house.
        Madhya = strongest point of house.
        Sandhi = weakest point (junction between houses).
        """
        cusps = self.get_cusps()
        result = {}

        for i, cusp in enumerate(cusps):
            next_cusp = cusps[(i + 1) % 12]

            result[cusp['house']] = {
                'madhya': cusp['midpoint'],
                'sandhi_start': cusp['start'],
                'sandhi_end': cusp['end'],
                'next_sandhi': next_cusp['start'],
            }

        return result

    def planet_strength_in_bhava(self, planet: str) -> Dict:
        """
        How strong is a planet in its Bhava position?
        Planets near Bhava Madhya (midpoint) are strongest.
        Planets near Sandhi (junction) are weakest.
        """
        if planet not in self.planets:
            return {'strength': 'Unknown'}

        longitude = self.planets[planet].get('longitude', 0.0)
        bhava_house = self.get_bhava_house(longitude)
        cusps = self.get_cusps()
        cusp = cusps[bhava_house - 1]

        # Distance from midpoint
        mid = cusp['midpoint']
        dist = abs(longitude - mid)
        if dist > 180:
            dist = 360 - dist

        # Max distance from midpoint to edge is 15°
        if dist <= 5:
            strength = 'Very Strong'
            desc = f'{planet} near Bhava Madhya — full house strength'
        elif dist <= 10:
            strength = 'Strong'
            desc = f'{planet} in middle zone of house — good strength'
        elif dist <= 13:
            strength = 'Moderate'
            desc = f'{planet} approaching Sandhi — diminished strength'
        else:
            strength = 'Weak (Sandhi)'
            desc = f'{planet} at Bhava Sandhi — borderline, weak expression'

        return {
            'planet': planet,
            'bhava_house': bhava_house,
            'distance_from_madhya': round(dist, 2),
            'strength': strength,
            'description': desc,
        }

    def all_planet_bhava_strengths(self) -> Dict:
        """Get Bhava strength for all planets."""
        return {
            planet: self.planet_strength_in_bhava(planet)
            for planet in self.planets
        }


def generate_bhava_chalit(planets: Dict, ascendant: Dict) -> Dict:
    """Convenience function."""
    bc = BhavaChalit(planets, ascendant)
    return bc.generate_bhava_chalit()
