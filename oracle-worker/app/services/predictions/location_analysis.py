"""
JYOTISH ENGINE - LOCATION ANALYSIS (Astrocartography)
"Should I move to Bangalore or stay in Jaipur?"
Different cities activate different houses based on relocated chart.
"""

from typing import Dict, List
from ..core.constants import RASHI_NAMES, RASHI_LORDS
from ..core.ephemeris import get_ephemeris

MAJOR_CITIES = {
    'Delhi': {'lat': 28.61, 'lng': 77.21, 'direction': 'North'},
    'Mumbai': {'lat': 19.07, 'lng': 72.88, 'direction': 'West'},
    'Bangalore': {'lat': 12.97, 'lng': 77.59, 'direction': 'South'},
    'Chennai': {'lat': 13.08, 'lng': 80.27, 'direction': 'South'},
    'Kolkata': {'lat': 22.57, 'lng': 88.36, 'direction': 'East'},
    'Hyderabad': {'lat': 17.38, 'lng': 78.49, 'direction': 'South'},
    'Pune': {'lat': 18.52, 'lng': 73.86, 'direction': 'West'},
    'Ahmedabad': {'lat': 23.02, 'lng': 72.57, 'direction': 'West'},
    'Jaipur': {'lat': 26.91, 'lng': 75.79, 'direction': 'North'},
    'Lucknow': {'lat': 26.85, 'lng': 80.95, 'direction': 'North'},
    'London': {'lat': 51.51, 'lng': -0.13, 'direction': 'Northwest'},
    'New York': {'lat': 40.71, 'lng': -74.01, 'direction': 'West'},
    'Dubai': {'lat': 25.20, 'lng': 55.27, 'direction': 'West'},
    'Singapore': {'lat': 1.35, 'lng': 103.82, 'direction': 'Southeast'},
    'Toronto': {'lat': 43.65, 'lng': -79.38, 'direction': 'Northwest'},
    'Sydney': {'lat': -33.87, 'lng': 151.21, 'direction': 'Southeast'},
}


class LocationAnalysis:
    def __init__(self, engine):
        self.engine = engine
        self.birth_dt = engine.birth_dt
        self.natal_asc_rashi = engine.ascendant_rashi
        self.natal_planets = engine.planets
        self.ephemeris = get_ephemeris()

    def analyze_city(self, city_name: str, lat: float = None, lng: float = None) -> Dict:
        """Analyze how a city affects your chart."""
        if lat is None or lng is None:
            city_data = MAJOR_CITIES.get(city_name, {})
            lat = city_data.get('lat', 28.61)
            lng = city_data.get('lng', 77.21)

        # Recalculate ascendant for new location
        try:
            jd = self.ephemeris.get_julian_day(self.birth_dt)
            from ..core.ephemeris import swe
            flags = swe.FLG_SIDEREAL
            houses, angles = swe.houses_ex(jd, lat, lng, b'W', flags)
            new_asc_long = angles[0]
            new_asc_rashi = int(new_asc_long / 30) % 12
        except Exception:
            new_asc_rashi = self.natal_asc_rashi

        asc_changed = new_asc_rashi != self.natal_asc_rashi

        # How planets fall in new houses
        changes = {}
        for planet, data in self.natal_planets.items():
            p_rashi = data.get('rashi', 0)
            old_house = data.get('house', 1)
            new_house = ((p_rashi - new_asc_rashi) % 12) + 1
            if old_house != new_house:
                changes[planet] = {
                    'old_house': old_house, 'new_house': new_house,
                    'impact': self._house_shift_impact(planet, old_house, new_house),
                }

        # Score the location
        score = 50
        new_10th_lord = RASHI_LORDS[(new_asc_rashi + 9) % 12]
        new_10th_house_planets = [p for p in self.natal_planets
                                   if ((self.natal_planets[p].get('rashi', 0) - new_asc_rashi) % 12) + 1 == 10]

        # Career boost if benefics in 10th
        for p in new_10th_house_planets:
            if p in ('Jupiter', 'Venus', 'Mercury'): score += 10
            elif p in ('Saturn', 'Rahu'): score -= 5

        # Check 1st house strength
        new_1st_planets = [p for p in self.natal_planets
                           if ((self.natal_planets[p].get('rashi', 0) - new_asc_rashi) % 12) + 1 == 1]
        for p in new_1st_planets:
            if p in ('Jupiter', 'Venus'): score += 8
            elif p in ('Saturn', 'Rahu', 'Ketu'): score -= 5

        score = max(0, min(100, score))

        return {
            'city': city_name,
            'coordinates': {'lat': lat, 'lng': lng},
            'natal_ascendant': RASHI_NAMES[self.natal_asc_rashi],
            'relocated_ascendant': RASHI_NAMES[new_asc_rashi],
            'ascendant_changed': asc_changed,
            'house_changes': changes,
            'planets_shifted': len(changes),
            'score': score,
            'rating': 'Excellent' if score >= 70 else 'Good' if score >= 55 else 'Average' if score >= 40 else 'Challenging',
        }

    def compare_cities(self, cities: List[str] = None) -> Dict:
        """Compare multiple cities."""
        if cities is None:
            cities = ['Delhi', 'Mumbai', 'Bangalore', 'Hyderabad', 'Pune']

        results = {}
        for city in cities:
            results[city] = self.analyze_city(city)

        ranked = sorted(results.items(), key=lambda x: x[1]['score'], reverse=True)

        return {
            'cities': results,
            'best_city': ranked[0][0] if ranked else '',
            'best_score': ranked[0][1]['score'] if ranked else 0,
            'ranking': [{'city': c, 'score': d['score'], 'rating': d['rating']} for c, d in ranked],
        }

    def _house_shift_impact(self, planet: str, old_h: int, new_h: int) -> str:
        if new_h in (1, 4, 7, 10) and old_h not in (1, 4, 7, 10):
            return f'{planet} moves to Kendra — strengthened'
        elif new_h in (6, 8, 12) and old_h not in (6, 8, 12):
            return f'{planet} moves to Dusthana — weakened'
        elif old_h in (6, 8, 12) and new_h not in (6, 8, 12):
            return f'{planet} escapes Dusthana — improvement'
        return f'{planet} shifts house position'


def analyze_location(engine, city, lat=None, lng=None):
    return LocationAnalysis(engine).analyze_city(city, lat, lng)

def compare_locations(engine, cities=None):
    return LocationAnalysis(engine).compare_cities(cities)
