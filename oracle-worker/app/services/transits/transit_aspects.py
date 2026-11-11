"""
JYOTISH ENGINE - TRANSIT-TO-NATAL ASPECTS
When transiting Jupiter trines natal Venus = romance window.
"""

from typing import Dict, List


class TransitNatalAspects:
    def __init__(self, engine):
        self.engine = engine
        self.natal = engine.planets

    def check_aspects(self, transit_planets: Dict = None) -> List[Dict]:
        if transit_planets is None:
            try:
                transit_planets = self.engine.ephemeris.get_current_transits()
            except Exception:
                return []

        aspects = []
        aspect_angles = {0: 'Conjunction', 60: 'Sextile', 90: 'Square', 120: 'Trine', 180: 'Opposition'}

        for t_planet in ['Jupiter', 'Saturn', 'Mars', 'Venus', 'Mercury']:
            t_lon = transit_planets.get(t_planet, {}).get('longitude', 0)
            for n_planet in self.natal:
                if t_planet == n_planet:
                    continue
                n_lon = self.natal[n_planet].get('longitude', 0)
                diff = abs(t_lon - n_lon)
                if diff > 180:
                    diff = 360 - diff

                for angle, name in aspect_angles.items():
                    orb = 8 if angle in (0, 180) else 6
                    if abs(diff - angle) <= orb:
                        nature = 'Benefic' if name in ('Trine', 'Sextile', 'Conjunction') and t_planet in ('Jupiter', 'Venus') else \
                                 'Malefic' if name in ('Square', 'Opposition') and t_planet in ('Saturn', 'Mars') else 'Mixed'
                        aspects.append({
                            'transit_planet': t_planet,
                            'natal_planet': n_planet,
                            'aspect': name,
                            'orb': round(abs(diff - angle), 1),
                            'nature': nature,
                            'effect': self._get_effect(t_planet, n_planet, name),
                        })

        aspects.sort(key=lambda x: x['orb'])
        return aspects

    def _get_effect(self, transit: str, natal: str, aspect: str) -> str:
        effects = {
            ('Jupiter', 'Venus', 'Conjunction'): 'Romance, marriage, luxury, artistic success',
            ('Jupiter', 'Venus', 'Trine'): 'Harmonious love, financial blessing, beauty',
            ('Jupiter', 'Sun', 'Conjunction'): 'Career promotion, recognition, confidence boost',
            ('Jupiter', 'Moon', 'Conjunction'): 'Emotional fulfillment, mother blessing, peace',
            ('Jupiter', 'Mercury', 'Conjunction'): 'Education success, business expansion, writing',
            ('Saturn', 'Sun', 'Conjunction'): 'Career pressure, authority challenges, discipline forced',
            ('Saturn', 'Moon', 'Conjunction'): 'Emotional heaviness, depression risk, patience needed',
            ('Saturn', 'Venus', 'Conjunction'): 'Relationship test, delayed love, mature partner',
            ('Saturn', 'Mars', 'Square'): 'Frustration, blocked energy, accidents risk',
            ('Mars', 'Venus', 'Conjunction'): 'Passion surge, new romance, creative fire',
            ('Venus', 'Jupiter', 'Trine'): 'Financial gain, love blessing, social success',
        }
        key = (transit, natal, aspect)
        return effects.get(key, f'{transit} {aspect.lower()} natal {natal} — {natal} matters activated')


def check_transit_aspects(engine):
    return TransitNatalAspects(engine).check_aspects()
