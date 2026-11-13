"""
WESTERN ASTROLOGY — COMPATIBILITY (Synastry)
Cross-chart aspects between two people's natal charts.
"""

from typing import Dict, List
from .chart import WesternChart, WESTERN_PLANETS, ASPECTS, ASPECT_NATURE


class WesternCompatibility:
    """Synastry analysis between two Western charts."""

    def __init__(self, chart1: WesternChart, chart2: WesternChart):
        self.chart1 = chart1
        self.chart2 = chart2
        chart1._ensure_calculated()
        chart2._ensure_calculated()

    def get_synastry_aspects(self) -> List[Dict]:
        """Calculate all inter-chart aspects."""
        aspects = []
        for p1_name in WESTERN_PLANETS:
            p1 = self.chart1.planets.get(p1_name, {})
            l1 = p1.get('longitude', 0)
            for p2_name in WESTERN_PLANETS:
                p2 = self.chart2.planets.get(p2_name, {})
                l2 = p2.get('longitude', 0)

                diff = abs(l1 - l2)
                if diff > 180:
                    diff = 360 - diff

                for asp_name, asp_angle, asp_orb in ASPECTS[:6]:  # Major + quincunx
                    orb_actual = abs(diff - asp_angle)
                    if orb_actual <= asp_orb:
                        aspects.append({
                            'person1_planet': p1_name,
                            'person2_planet': p2_name,
                            'aspect': asp_name,
                            'orb': round(orb_actual, 2),
                            'nature': ASPECT_NATURE[asp_name],
                            'strength': round(1.0 - (orb_actual / asp_orb), 2),
                            'interpretation': self._interpret(p1_name, p2_name, asp_name),
                        })
                        break

        aspects.sort(key=lambda a: a['orb'])
        return aspects

    def _interpret(self, p1: str, p2: str, aspect: str) -> str:
        """Brief interpretation of a synastry aspect."""
        pair = frozenset([p1, p2])
        nature = ASPECT_NATURE.get(aspect, 'neutral')

        if pair == frozenset(['Sun', 'Moon']):
            return "Deep emotional bond — classic soul-mate indicator" if nature == 'harmonious' else "Push-pull dynamic between ego and emotions"
        if pair == frozenset(['Venus', 'Mars']):
            return "Strong physical and romantic attraction" if nature != 'challenging' else "Intense passion with friction"
        if pair == frozenset(['Sun', 'Venus']):
            return "Natural affection and admiration"
        if pair == frozenset(['Moon', 'Venus']):
            return "Emotional comfort and tenderness"
        if pair == frozenset(['Sun', 'Mars']):
            return "Energizing but competitive dynamic"
        if pair == frozenset(['Moon', 'Saturn']):
            return "Stabilizing but potentially restrictive emotional bond"
        if pair == frozenset(['Venus', 'Jupiter']):
            return "Generous, expansive love and shared joy"
        if pair == frozenset(['Sun', 'Jupiter']):
            return "Mutual growth, optimism, and encouragement"
        if pair == frozenset(['Mars', 'Saturn']):
            return "Frustrating blockages or disciplined teamwork"

        if nature == 'harmonious':
            return f"{p1}-{p2} flows easily"
        elif nature == 'challenging':
            return f"{p1}-{p2} creates growth through tension"
        return f"{p1}-{p2} interaction"

    def get_compatibility_score(self) -> Dict:
        """Calculate overall compatibility score."""
        aspects = self.get_synastry_aspects()
        harmony = sum(1 for a in aspects if a['nature'] == 'harmonious')
        challenge = sum(1 for a in aspects if a['nature'] == 'challenging')
        total = max(len(aspects), 1)

        # Key aspects (Sun-Moon, Venus-Mars, etc.)
        key_aspects = [a for a in aspects if
                       frozenset([a['person1_planet'], a['person2_planet']]) in [
                           frozenset(['Sun', 'Moon']), frozenset(['Venus', 'Mars']),
                           frozenset(['Sun', 'Venus']), frozenset(['Moon', 'Venus']),
                       ]]

        score = min(100, int((harmony / total) * 70 + len(key_aspects) * 10))

        if score >= 75:
            verdict = "Highly compatible — natural resonance"
        elif score >= 55:
            verdict = "Good compatibility with growth areas"
        elif score >= 40:
            verdict = "Mixed — attraction with significant challenges"
        else:
            verdict = "Challenging — requires conscious effort"

        return {
            'score': score,
            'verdict': verdict,
            'total_aspects': len(aspects),
            'harmonious': harmony,
            'challenging': challenge,
            'key_aspects': key_aspects,
        }

    def generate_synastry_report(self) -> Dict:
        """Full synastry report."""
        big3_1 = self.chart1.get_big_three()
        big3_2 = self.chart2.get_big_three()
        aspects = self.get_synastry_aspects()
        score = self.get_compatibility_score()

        # Element compatibility
        e1 = self.chart1.get_element_balance()['dominant_element']
        e2 = self.chart2.get_element_balance()['dominant_element']
        compatible_elements = {
            ('Fire', 'Air'), ('Air', 'Fire'), ('Earth', 'Water'), ('Water', 'Earth'),
            ('Fire', 'Fire'), ('Air', 'Air'), ('Earth', 'Earth'), ('Water', 'Water'),
        }
        element_compat = (e1, e2) in compatible_elements

        return {
            'system': 'Western Synastry',
            'person1': big3_1,
            'person2': big3_2,
            'aspects': aspects,
            'score': score,
            'element_compatibility': {
                'person1': e1, 'person2': e2, 'compatible': element_compat,
            },
            'strongest_connections': aspects[:5],
            'challenges': [a for a in aspects if a['nature'] == 'challenging'][:5],
        }
