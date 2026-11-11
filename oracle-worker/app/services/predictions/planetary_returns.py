"""
JYOTISH ENGINE - PLANETARY RETURN TRACKER
Track Saturn Return (~29yr), Jupiter Return (~12yr), Rahu Return (~18yr).
These are life-changing periods. Push notification triggers.
"""

from datetime import datetime
from typing import Dict
from ..core.constants import RASHI_NAMES

RETURN_CYCLES = {
    'Saturn': {
        'years': 29.5,
        'name': 'Saturn Return',
        'description': 'Complete restructuring of life. Career, relationships, identity all tested.',
        'ages': [29, 58, 87],
        'duration': '~2.5 years',
        'effects': 'Major life transitions, maturity forced, karmic reckoning. If foundations are weak, they break. If strong, they solidify.',
        'advice': 'Accept responsibility. Let go of what does not serve. Build what is real.',
    },
    'Jupiter': {
        'years': 11.86,
        'name': 'Jupiter Return',
        'description': 'Expansion, growth, new opportunities cycle.',
        'ages': [12, 24, 36, 48, 60, 72, 84],
        'duration': '~1 year',
        'effects': 'Doors open, luck increases, teachers appear, beliefs expand. Growth in wisdom and wealth.',
        'advice': 'Say yes to opportunities. Expand your horizons. Be generous.',
    },
    'Rahu': {
        'years': 18.6,
        'name': 'Rahu Return (Nodal Return)',
        'description': 'Destiny shifts. Past desires resurface. Major karmic cycle completion.',
        'ages': [18, 37, 56, 74],
        'duration': '~18 months',
        'effects': 'Obsessive desires shift. Old patterns complete. New karmic direction begins. Can feel chaotic.',
        'advice': 'Embrace change. Release old obsessions. Trust the new direction.',
    },
    'Ketu': {
        'years': 18.6,
        'name': 'Ketu Return',
        'description': 'Spiritual awakening cycle. Letting go of past attachments.',
        'ages': [18, 37, 56, 74],
        'duration': '~18 months',
        'effects': 'Detachment from material. Spiritual insights. Loss that leads to liberation.',
        'advice': 'Meditate. Release. Trust the process of letting go.',
    },
}


class PlanetaryReturns:
    def __init__(self, engine):
        self.engine = engine
        self.birth_year = engine.birth_local.year
        self.birth_dt = engine.birth_local
        self.natal_planets = engine.planets

    def get_all_returns(self) -> Dict:
        """Check status of all major planetary returns."""
        current_age = datetime.now().year - self.birth_year
        results = {}

        for planet, info in RETURN_CYCLES.items():
            natal_rashi = self.natal_planets.get(planet, {}).get('rashi', 0)

            # Find current transit position
            try:
                transit = self.engine.ephemeris.get_current_transits()
                transit_rashi = transit.get(planet, {}).get('rashi', 0)
            except Exception:
                transit_rashi = 0

            is_return = natal_rashi == transit_rashi
            approaching = ((transit_rashi - natal_rashi) % 12) in (10, 11)

            # Find next return age
            next_return_age = None
            for age in info['ages']:
                if age > current_age:
                    next_return_age = age
                    break

            # Find previous return age
            prev_return_age = None
            for age in reversed(info['ages']):
                if age <= current_age:
                    prev_return_age = age
                    break

            years_to_next = (next_return_age - current_age) if next_return_age else None

            status = 'ACTIVE NOW' if is_return else 'APPROACHING' if approaching else 'Not active'

            results[planet] = {
                'name': info['name'],
                'natal_rashi': RASHI_NAMES[natal_rashi],
                'transit_rashi': RASHI_NAMES[transit_rashi],
                'is_active': is_return,
                'is_approaching': approaching,
                'status': status,
                'current_age': current_age,
                'next_return_age': next_return_age,
                'years_to_next': years_to_next,
                'previous_return_age': prev_return_age,
                'cycle_years': info['years'],
                'duration': info['duration'],
                'effects': info['effects'],
                'advice': info['advice'],
            }

        # Priority alerts
        alerts = []
        for planet, data in results.items():
            if data['is_active']:
                alerts.append({
                    'type': 'ACTIVE',
                    'planet': planet,
                    'message': f"{data['name']} is ACTIVE — {data['effects'][:80]}",
                    'priority': 'High',
                })
            elif data['is_approaching']:
                alerts.append({
                    'type': 'APPROACHING',
                    'planet': planet,
                    'message': f"{data['name']} approaching — prepare for {data['effects'][:60]}",
                    'priority': 'Medium',
                })
            elif data['years_to_next'] and data['years_to_next'] <= 2:
                alerts.append({
                    'type': 'UPCOMING',
                    'planet': planet,
                    'message': f"{data['name']} in ~{data['years_to_next']} years at age {data['next_return_age']}",
                    'priority': 'Low',
                })

        return {
            'returns': results,
            'alerts': alerts,
            'current_age': current_age,
        }


def track_planetary_returns(engine):
    pr = PlanetaryReturns(engine)
    return pr.get_all_returns()
