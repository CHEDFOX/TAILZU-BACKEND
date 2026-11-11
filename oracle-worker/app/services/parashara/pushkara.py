"""
JYOTISH ENGINE - PUSHKARA NAVAMSA & BHAGA
Special lucky degrees. Planet at Pushkara = divine protection.
"""

from typing import Dict
from ..core.constants import RASHI_NAMES

# Pushkara Navamsa degrees (specific navamsa divisions that are lucky)
# These are the navamsa positions considered most auspicious
PUSHKARA_NAVAMSAS = {
    (0, 3): True, (0, 8): True,  # Aries: Cancer & Sagittarius navamsa
    (1, 1): True, (1, 6): True,  # Taurus: Taurus & Libra navamsa
    (2, 4): True, (2, 9): True,  # Gemini: Leo & Capricorn
    (3, 2): True, (3, 7): True,  # Cancer: Gemini & Scorpio
    (4, 5): True, (4, 10): True, # Leo: Virgo & Aquarius
    (5, 3): True, (5, 8): True,  # Virgo: Cancer & Sagittarius
    (6, 1): True, (6, 6): True,  # Libra: Taurus & Libra
    (7, 4): True, (7, 9): True,  # Scorpio: Leo & Capricorn
    (8, 2): True, (8, 7): True,  # Sagittarius: Gemini & Scorpio
    (9, 5): True, (9, 10): True, # Capricorn: Virgo & Aquarius
    (10, 3): True, (10, 8): True, # Aquarius: Cancer & Sagittarius
    (11, 1): True, (11, 6): True, # Pisces: Taurus & Libra
}

# Pushkara Bhaga (specific lucky degrees within each sign)
PUSHKARA_BHAGA = {
    0: 21, 1: 14, 2: 18, 3: 8, 4: 19, 5: 9,
    6: 24, 7: 11, 8: 23, 9: 14, 10: 19, 11: 9,
}


class PushkaraAnalysis:
    def __init__(self, engine):
        self.planets = engine.planets

    def check_pushkara(self) -> Dict:
        results = []
        for planet, data in self.planets.items():
            rashi = data.get('rashi', 0)
            degree = data.get('longitude', 0) % 30
            navamsa_index = int(degree / (30/9))

            # Pushkara Navamsa check
            is_pushkara_nav = (rashi, navamsa_index) in PUSHKARA_NAVAMSAS

            # Pushkara Bhaga check
            pb_degree = PUSHKARA_BHAGA.get(rashi, 0)
            is_pushkara_bhaga = abs(degree - pb_degree) < 1.0

            if is_pushkara_nav or is_pushkara_bhaga:
                results.append({
                    'planet': planet,
                    'rashi': RASHI_NAMES[rashi],
                    'degree': round(degree, 2),
                    'pushkara_navamsa': is_pushkara_nav,
                    'pushkara_bhaga': is_pushkara_bhaga,
                    'significance': f'{planet} has divine protection — '
                                    f'{"Pushkara Navamsa" if is_pushkara_nav else ""}'
                                    f'{" + " if is_pushkara_nav and is_pushkara_bhaga else ""}'
                                    f'{"Pushkara Bhaga" if is_pushkara_bhaga else ""}',
                })

        return {
            'pushkara_planets': results,
            'count': len(results),
            'has_pushkara': len(results) > 0,
        }


def check_pushkara(engine):
    return PushkaraAnalysis(engine).check_pushkara()
