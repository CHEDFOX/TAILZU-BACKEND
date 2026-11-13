"""
JYOTISH ENGINE - ASHTAKAVARGA TRANSIT SCORING
Personalized transit predictions using bindu scores.
Saturn in 3rd from Moon = generically good.
Saturn in 3rd from Moon with 1 bindu = actually bad for YOU.
"""

from typing import Dict
from ..core.constants import RASHI_NAMES


class AshtakavargaTransit:
    def __init__(self, engine):
        self.engine = engine
        self.planets = engine.planets
        self.moon_rashi = engine.planets.get('Moon', {}).get('rashi', 0)

    def _get_sarvashtakavarga(self) -> Dict:
        try:
            av = self.engine.get_ashtakavarga()
            return av.get('sarvashtakavarga', {}).get('signs', {})
        except Exception:
            return {}

    def _get_planet_ashtakavarga(self, planet: str) -> Dict:
        try:
            av = self.engine.get_ashtakavarga()
            return av.get('planets', {}).get(planet, {}).get('signs', {})
        except Exception:
            return {}

    def score_transit(self, transit_planet: str, transit_rashi: int) -> Dict:
        """Score a specific transit using Ashtakavarga bindus."""
        # Sarvashtakavarga score for the transit sign
        sav = self._get_sarvashtakavarga()
        sav_score = sav.get(transit_rashi, sav.get(str(transit_rashi), 28))

        # Planet-specific Ashtakavarga
        pav = self._get_planet_ashtakavarga(transit_planet)
        pav_score = pav.get(transit_rashi, pav.get(str(transit_rashi), 4))

        # House from Moon
        house_from_moon = ((transit_rashi - self.moon_rashi) % 12) + 1

        # Interpretation
        if isinstance(pav_score, (int, float)):
            if pav_score >= 5:
                quality = 'Excellent'
                description = f'{transit_planet} transiting sign with {pav_score} bindus — highly favorable for you'
            elif pav_score >= 4:
                quality = 'Good'
                description = f'{transit_planet} transiting sign with {pav_score} bindus — positive results'
            elif pav_score >= 3:
                quality = 'Average'
                description = f'{transit_planet} transiting sign with {pav_score} bindus — mixed results'
            elif pav_score >= 2:
                quality = 'Below Average'
                description = f'{transit_planet} transiting sign with {pav_score} bindus — challenging period'
            else:
                quality = 'Poor'
                description = f'{transit_planet} transiting sign with {pav_score} bindus — difficult, needs remedies'
        else:
            quality = 'Average'
            description = f'{transit_planet} transit in {RASHI_NAMES[transit_rashi]}'
            pav_score = 4

        return {
            'planet': transit_planet,
            'transit_rashi': RASHI_NAMES[transit_rashi],
            'house_from_moon': house_from_moon,
            'planet_bindus': pav_score,
            'sarva_bindus': sav_score,
            'quality': quality,
            'description': description,
        }

    def score_all_current_transits(self) -> Dict:
        """Score all current major transits using Ashtakavarga."""
        try:
            transits = self.engine.ephemeris.get_current_transits()
        except Exception:
            return {'error': 'Could not get current transits'}

        results = {}
        for planet in ['Jupiter', 'Saturn', 'Rahu', 'Mars', 'Venus', 'Mercury', 'Sun']:
            t_data = transits.get(planet, {})
            t_rashi = t_data.get('rashi', 0)
            results[planet] = self.score_transit(planet, t_rashi)

        # Best and worst transits
        scored = [(p, d) for p, d in results.items() if isinstance(d.get('planet_bindus'), (int, float))]
        if scored:
            best = max(scored, key=lambda x: x[1]['planet_bindus'])
            worst = min(scored, key=lambda x: x[1]['planet_bindus'])
        else:
            best = worst = None

        return {
            'transits': results,
            'best_transit': {'planet': best[0], 'quality': best[1]['quality']} if best else None,
            'worst_transit': {'planet': worst[0], 'quality': worst[1]['quality']} if worst else None,
        }

    def get_dasha_ashtakavarga_quality(self) -> Dict:
        """Rate current dasha period using Ashtakavarga."""
        try:
            dasha = self.engine.get_vimshottari_dasha()
            maha_lord = dasha['mahadasha']['lord']
            antar_lord = dasha['antardasha']['lord']
        except Exception:
            return {'error': 'Could not get dasha'}

        maha_pav = self._get_planet_ashtakavarga(maha_lord)
        antar_pav = self._get_planet_ashtakavarga(antar_lord)

        # Total bindus across all signs for each dasha lord
        maha_total = sum(v for v in maha_pav.values() if isinstance(v, (int, float)))
        antar_total = sum(v for v in antar_pav.values() if isinstance(v, (int, float)))

        # Average is 337/7 ≈ 48 per planet across 12 signs, so 4 per sign
        maha_quality = 'Strong' if maha_total >= 48 else 'Average' if maha_total >= 36 else 'Weak'
        antar_quality = 'Strong' if antar_total >= 48 else 'Average' if antar_total >= 36 else 'Weak'

        return {
            'mahadasha': {'lord': maha_lord, 'total_bindus': maha_total, 'quality': maha_quality},
            'antardasha': {'lord': antar_lord, 'total_bindus': antar_total, 'quality': antar_quality},
            'combined': f'{maha_lord} ({maha_quality}) / {antar_lord} ({antar_quality})',
        }


def score_ashtakavarga_transits(engine):
    at = AshtakavargaTransit(engine)
    return at.score_all_current_transits()
