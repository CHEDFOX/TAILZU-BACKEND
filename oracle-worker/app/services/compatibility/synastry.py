"""
JYOTISH ENGINE - RELATIONSHIP SYNASTRY
Deep composite analysis between ANY two charts.
Not just marriage — business partners, friends, parent-child.
"""

from typing import Dict, List
from ..core.constants import RASHI_NAMES


class Synastry:
    def __init__(self, engine1, engine2):
        """
        Args:
            engine1: First person's JyotishEngine
            engine2: Second person's JyotishEngine
        """
        self.e1 = engine1
        self.e2 = engine2
        self.p1 = engine1.planets
        self.p2 = engine2.planets

    def _moon_compatibility(self) -> Dict:
        m1_rashi = self.p1.get('Moon', {}).get('rashi', 0)
        m2_rashi = self.p2.get('Moon', {}).get('rashi', 0)
        dist = ((m2_rashi - m1_rashi) % 12) + 1

        if dist in (1, 5, 9):
            compat = 'Excellent — Trikona (natural harmony)'
            score = 9
        elif dist in (4, 7, 10):
            compat = 'Good — Kendra (dynamic but productive)'
            score = 7
        elif dist in (2, 12):
            compat = 'Moderate — Adjacent (familiarity)'
            score = 5
        elif dist in (3, 11):
            compat = 'Fair — Growth houses (can improve)'
            score = 4
        elif dist in (6, 8):
            compat = 'Challenging — Dusthana (friction, needs work)'
            score = 2
        else:
            compat = 'Neutral'
            score = 5

        return {
            'person1_moon': RASHI_NAMES[m1_rashi],
            'person2_moon': RASHI_NAMES[m2_rashi],
            'distance': dist,
            'compatibility': compat,
            'score': score,
        }

    def _planet_overlays(self) -> List[Dict]:
        """Where person 2's planets fall in person 1's houses."""
        overlays = []
        for planet, data in self.p2.items():
            p2_rashi = data.get('rashi', 0)
            house_in_p1 = ((p2_rashi - self.e1.ascendant_rashi) % 12) + 1
            impact = {
                1: 'Strong personal impact, changes self-perception',
                2: 'Financial/family influence',
                3: 'Communication, courage influence',
                4: 'Home, emotional comfort influence',
                5: 'Romance, creativity, children influence',
                6: 'Health, service, competition influence',
                7: 'Partnership, marriage influence',
                8: 'Transformation, deep bonding influence',
                9: 'Fortune, philosophical influence',
                10: 'Career, status influence',
                11: 'Friendship, gains, desires influence',
                12: 'Spiritual, expenses, hidden influence',
            }
            if planet in ('Sun', 'Moon', 'Venus', 'Jupiter', 'Mars'):
                overlays.append({
                    'planet': planet,
                    'falls_in_house': house_in_p1,
                    'impact': impact.get(house_in_p1, ''),
                })
        return overlays

    def _dasha_sync(self) -> Dict:
        """Check if both people are in compatible dashas."""
        try:
            d1 = self.e1.get_vimshottari_dasha()
            d2 = self.e2.get_vimshottari_dasha()

            m1 = d1.get('mahadasha', {}).get('lord', '')
            m2 = d2.get('mahadasha', {}).get('lord', '')

            from ..core.constants import PLANETS
            friends1 = PLANETS.get(m1, {}).get('friends', [])
            enemies1 = PLANETS.get(m1, {}).get('enemies', [])

            if m2 in friends1:
                sync = 'Harmonious — both dashas support each other'
                score = 8
            elif m2 in enemies1:
                sync = 'Conflicting — dasha lords are enemies'
                score = 3
            elif m1 == m2:
                sync = 'Same dasha lord — similar life phase'
                score = 7
            else:
                sync = 'Neutral — independent dasha periods'
                score = 5

            return {
                'person1_dasha': m1,
                'person2_dasha': m2,
                'sync': sync,
                'score': score,
            }
        except Exception:
            return {'sync': 'Could not calculate', 'score': 5}

    def _ascendant_compatibility(self) -> Dict:
        a1 = self.e1.ascendant_rashi
        a2 = self.e2.ascendant_rashi
        dist = ((a2 - a1) % 12) + 1

        if dist in (1, 5, 9):
            compat = 'Excellent — natural alignment'
            score = 9
        elif dist in (4, 7, 10):
            compat = 'Dynamic — productive tension'
            score = 6
        elif dist in (6, 8):
            compat = 'Challenging — different worldviews'
            score = 3
        else:
            compat = 'Moderate'
            score = 5

        return {
            'person1_asc': RASHI_NAMES[a1],
            'person2_asc': RASHI_NAMES[a2],
            'distance': dist,
            'compatibility': compat,
            'score': score,
        }

    def generate_synastry(self) -> Dict:
        moon = self._moon_compatibility()
        asc = self._ascendant_compatibility()
        overlays = self._planet_overlays()
        dasha = self._dasha_sync()

        total_score = (moon['score'] + asc['score'] + dasha['score']) / 3
        total_score = round(total_score * 10)  # Scale to 100

        if total_score >= 75:
            verdict = 'Excellent Compatibility'
        elif total_score >= 60:
            verdict = 'Good Compatibility'
        elif total_score >= 45:
            verdict = 'Average Compatibility — needs effort'
        elif total_score >= 30:
            verdict = 'Challenging — significant differences'
        else:
            verdict = 'Difficult — fundamental misalignment'

        return {
            'system': 'Synastry (Deep Compatibility)',
            'moon_compatibility': moon,
            'ascendant_compatibility': asc,
            'planet_overlays': overlays,
            'dasha_sync': dasha,
            'overall_score': total_score,
            'verdict': verdict,
        }


def analyze_synastry(engine1, engine2):
    s = Synastry(engine1, engine2)
    return s.generate_synastry()
