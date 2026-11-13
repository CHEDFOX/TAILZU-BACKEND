"""
JYOTISH ENGINE - VASTU SHASTRA
Direction recommendations based on chart analysis.
"""

from typing import Dict, List
from ..core.constants import RASHI_LORDS, PLANETS

RASHI_DIRECTION = {
    0: 'East', 1: 'South', 2: 'West', 3: 'North',
    4: 'East', 5: 'South', 6: 'West', 7: 'North',
    8: 'East', 9: 'South', 10: 'West', 11: 'North',
}

PLANET_DIRECTION = {
    'Sun': 'East', 'Moon': 'Northwest', 'Mars': 'South',
    'Mercury': 'North', 'Jupiter': 'Northeast', 'Venus': 'Southeast',
    'Saturn': 'West', 'Rahu': 'Southwest', 'Ketu': 'Northeast',
}

DIRECTION_DEITY = {
    'East': {'deity': 'Indra', 'element': 'Air', 'effects': 'Growth, vitality, new beginnings'},
    'West': {'deity': 'Varuna', 'element': 'Water', 'effects': 'Stability, gains, relaxation'},
    'North': {'deity': 'Kubera', 'element': 'Water', 'effects': 'Wealth, career, opportunity'},
    'South': {'deity': 'Yama', 'element': 'Fire', 'effects': 'Fame, recognition, strength'},
    'Northeast': {'deity': 'Shiva', 'element': 'Ether', 'effects': 'Spirituality, wisdom, purity'},
    'Southeast': {'deity': 'Agni', 'element': 'Fire', 'effects': 'Cooking, energy, warmth'},
    'Southwest': {'deity': 'Nirrti', 'element': 'Earth', 'effects': 'Stability, grounding, authority'},
    'Northwest': {'deity': 'Vayu', 'element': 'Air', 'effects': 'Movement, guests, change'},
}

ROOM_PLACEMENT = {
    'master_bedroom': {'ideal': 'Southwest', 'avoid': 'Northeast', 'reason': 'Southwest gives stability to head of house'},
    'kitchen': {'ideal': 'Southeast', 'avoid': 'Northeast', 'reason': 'Agni deity rules Southeast'},
    'puja_room': {'ideal': 'Northeast', 'avoid': 'South', 'reason': 'Northeast is Ishanya corner — most sacred'},
    'study_room': {'ideal': 'Northeast or West', 'avoid': 'South', 'reason': 'North for intellect, West for discipline'},
    'living_room': {'ideal': 'North or East', 'avoid': 'Southwest', 'reason': 'Social energy flows best in North/East'},
    'bathroom': {'ideal': 'Northwest', 'avoid': 'Northeast', 'reason': 'Never pollute Northeast'},
    'main_door': {'ideal': 'East or North', 'avoid': 'South', 'reason': 'East brings Sun, North brings wealth'},
    'office': {'ideal': 'North or West', 'avoid': 'Southeast', 'reason': 'North for wealth, West for stability'},
    'children_room': {'ideal': 'West or Northwest', 'avoid': 'Southwest', 'reason': 'Growth energy for children'},
    'guest_room': {'ideal': 'Northwest', 'avoid': 'Southwest', 'reason': 'Northwest ensures guests dont overstay'},
}


class VastuAnalysis:
    def __init__(self, engine):
        self.engine = engine
        self.planets = engine.planets
        self.asc_rashi = engine.ascendant_rashi

    def get_lucky_directions(self) -> Dict:
        l1 = RASHI_LORDS[(self.asc_rashi) % 12]
        l1_dir = PLANET_DIRECTION.get(l1, 'East')
        l10 = RASHI_LORDS[(self.asc_rashi + 9) % 12]
        career_dir = PLANET_DIRECTION.get(l10, 'North')
        l7 = RASHI_LORDS[(self.asc_rashi + 6) % 12]
        relationship_dir = PLANET_DIRECTION.get(l7, 'West')
        l2 = RASHI_LORDS[(self.asc_rashi + 1) % 12]
        wealth_dir = PLANET_DIRECTION.get(l2, 'North')
        l4 = RASHI_LORDS[(self.asc_rashi + 3) % 12]
        home_dir = PLANET_DIRECTION.get(l4, 'North')
        l9 = RASHI_LORDS[(self.asc_rashi + 8) % 12]
        fortune_dir = PLANET_DIRECTION.get(l9, 'East')

        return {
            'primary_lucky': l1_dir,
            'career_direction': career_dir,
            'relationship_direction': relationship_dir,
            'wealth_direction': wealth_dir,
            'home_direction': home_dir,
            'fortune_direction': fortune_dir,
            'explanation': {
                'primary': f'Lagna lord {l1} rules {l1_dir} — face this for overall luck',
                'career': f'10th lord {l10} rules {career_dir} — face this while working',
                'wealth': f'2nd lord {l2} rules {wealth_dir} — place cash/locker here',
                'fortune': f'9th lord {l9} rules {fortune_dir} — place puja here',
            },
        }

    def get_sleeping_direction(self) -> Dict:
        l4 = RASHI_LORDS[(self.asc_rashi + 3) % 12]
        l4_dir = PLANET_DIRECTION.get(l4, 'South')
        return {
            'head_direction': 'South' if l4_dir in ('South', 'Southwest') else 'East',
            'avoid': 'North (head pointing North disturbs magnetic field)',
            'recommendation': f'Sleep with head towards South or East. 4th lord {l4} suggests {l4_dir} energy.',
        }

    def get_room_placement(self) -> Dict:
        return ROOM_PLACEMENT

    def get_direction_remedies(self) -> List[Dict]:
        remedies = []
        for planet in self.planets:
            if planet in ('Rahu', 'Ketu'):
                continue
            r = self.planets[planet].get('rashi', 0)
            if r == PLANETS.get(planet, {}).get('debilitated'):
                direction = PLANET_DIRECTION.get(planet, '')
                dir_info = DIRECTION_DEITY.get(direction, {})
                remedies.append({
                    'planet': planet,
                    'weak_direction': direction,
                    'remedy': f'Strengthen {direction} corner. Place {planet} yantra.',
                    'deity': dir_info.get('deity', ''),
                })
        return remedies

    def generate_vastu_report(self) -> Dict:
        return {
            'system': 'vastu',
            'category': 'guidance',
            'triggers': ['direction', 'vastu', 'home', 'house', 'facing', 'room'],
            'lucky_directions': self.get_lucky_directions(),
            'sleeping': self.get_sleeping_direction(),
            'room_placement': self.get_room_placement(),
            'direction_remedies': self.get_direction_remedies(),
            'confidence': 0.75,
        }


def analyze_vastu(engine):
    return VastuAnalysis(engine).generate_vastu_report()
