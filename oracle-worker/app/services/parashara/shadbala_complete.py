"""
JYOTISH ENGINE - SHADBALA COMPLETE (6-fold strength)
Proper Shadbala: Sthana + Dig + Kala + Chestha + Naisargika + Drik = total out of 100.
"""

from typing import Dict
from ..core.constants import PLANETS

DIG_BALA_HOUSES = {
    'Sun': 10, 'Mars': 10, 'Jupiter': 1, 'Mercury': 1,
    'Moon': 4, 'Venus': 4, 'Saturn': 7,
}

NAISARGIKA_BALA = {
    'Sun': 60, 'Moon': 51.43, 'Mars': 17.14, 'Mercury': 25.71,
    'Jupiter': 34.28, 'Venus': 42.86, 'Saturn': 8.57,
}


class ShadbalaComplete:
    def __init__(self, engine):
        self.engine = engine
        self.planets = engine.planets
        self.asc_rashi = engine.ascendant_rashi

    def _sthana_bala(self, planet: str) -> float:
        """Positional strength."""
        r = self.planets.get(planet, {}).get('rashi', 0)
        pd = PLANETS.get(planet, {})
        if r == pd.get('exalted'): return 60
        if r in pd.get('owns', []): return 45
        mt = pd.get('moolatrikona', pd.get('owns', []))
        if isinstance(mt, (list, tuple)) and r in mt: return 40
        elif isinstance(mt, int) and r == mt: return 40
        friends = pd.get('friends', [])
        friend_signs = []
        for f in friends:
            friend_signs.extend(PLANETS.get(f, {}).get('owns', []))
        if r in friend_signs: return 30
        if r == pd.get('debilitated'): return 5
        return 20

    def _dig_bala(self, planet: str) -> float:
        """Directional strength."""
        if planet in ('Rahu', 'Ketu'): return 30
        ideal_house = DIG_BALA_HOUSES.get(planet, 1)
        actual_house = self.planets.get(planet, {}).get('house', 1)
        distance = abs(actual_house - ideal_house)
        if distance > 6: distance = 12 - distance
        return max(0, 60 - (distance * 10))

    def _kala_bala(self, planet: str) -> float:
        """Temporal strength (simplified)."""
        h = self.planets.get(planet, {}).get('house', 1)
        if planet in ('Sun', 'Jupiter', 'Venus'):
            return 40 if h <= 6 else 20
        elif planet in ('Moon', 'Mars', 'Saturn'):
            return 40 if h > 6 else 20
        return 30

    def _chestha_bala(self, planet: str) -> float:
        """Motional strength."""
        if planet in ('Sun', 'Moon', 'Rahu', 'Ketu'): return 30
        speed = abs(self.planets.get(planet, {}).get('speed', 0))
        retro = self.planets.get(planet, {}).get('retrograde', False)
        if retro: return 60  # Retrograde = strong in Shadbala
        if speed > 1: return 45
        if speed > 0.5: return 35
        return 20

    def _naisargika_bala(self, planet: str) -> float:
        """Natural strength."""
        return NAISARGIKA_BALA.get(planet, 30)

    def _drik_bala(self, planet: str) -> float:
        """Aspectual strength (simplified)."""
        h = self.planets.get(planet, {}).get('house', 1)
        score = 30
        for other in self.planets:
            if other == planet: continue
            oh = self.planets[other].get('house', 1)
            if oh == h:
                if other in ('Jupiter', 'Venus'): score += 10
                elif other in ('Saturn', 'Mars', 'Rahu'): score -= 10
        return max(0, min(60, score))

    def calculate_shadbala(self, planet: str) -> Dict:
        if planet in ('Rahu', 'Ketu'):
            return {
                'planet': planet, 'total': 30, 'percentage': 50,
                'grade': 'N/A (Node)', 'components': {},
            }

        sthana = self._sthana_bala(planet)
        dig = self._dig_bala(planet)
        kala = self._kala_bala(planet)
        chestha = self._chestha_bala(planet)
        naisargika = self._naisargika_bala(planet)
        drik = self._drik_bala(planet)

        total = sthana + dig + kala + chestha + naisargika + drik
        pct = min(100, int(total / 3.6))

        if pct >= 70: grade = 'Very Strong'
        elif pct >= 55: grade = 'Strong'
        elif pct >= 40: grade = 'Average'
        elif pct >= 25: grade = 'Weak'
        else: grade = 'Very Weak'

        return {
            'planet': planet,
            'components': {
                'sthana_bala': round(sthana, 1),
                'dig_bala': round(dig, 1),
                'kala_bala': round(kala, 1),
                'chestha_bala': round(chestha, 1),
                'naisargika_bala': round(naisargika, 1),
                'drik_bala': round(drik, 1),
            },
            'total': round(total, 1),
            'percentage': pct,
            'grade': grade,
        }

    def calculate_all(self) -> Dict:
        results = {}
        for planet in ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']:
            results[planet] = self.calculate_shadbala(planet)
        strongest = max(results.values(), key=lambda x: x['total'])
        weakest = min(results.values(), key=lambda x: x['total'])
        return {
            'planets': results,
            'strongest': strongest['planet'],
            'weakest': weakest['planet'],
            'summary': f"Strongest: {strongest['planet']} ({strongest['grade']}), Weakest: {weakest['planet']} ({weakest['grade']})",
        }


def calculate_shadbala(engine):
    return ShadbalaComplete(engine).calculate_all()
