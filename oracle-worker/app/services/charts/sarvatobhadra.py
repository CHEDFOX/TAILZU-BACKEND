"""
JYOTISH ENGINE - SARVATOBHADRA CHAKRA
28-nakshatra grid for transit vedha analysis.
Shows which nakshatras are affected when a planet transits a specific nakshatra.

Used to determine: "When Saturn transits Pushya, which natal nakshatras feel the impact?"
"""

from typing import Dict, List

# Vedha (affliction) pairs — when planet transits one, the other is affected
# Based on Sarvatobhadra Chakra grid positions
VEDHA_PAIRS = {
    'Ashwini': ['Magha', 'Mula'],
    'Bharani': ['Purva Phalguni', 'Purva Ashadha'],
    'Krittika': ['Uttara Phalguni', 'Uttara Ashadha'],
    'Rohini': ['Hasta', 'Shravana'],
    'Mrigashira': ['Chitra', 'Dhanishta'],
    'Ardra': ['Swati', 'Shatabhisha'],
    'Punarvasu': ['Vishakha', 'Purva Bhadrapada'],
    'Pushya': ['Anuradha', 'Uttara Bhadrapada'],
    'Ashlesha': ['Jyeshtha', 'Revati'],
    'Magha': ['Ashwini', 'Mula'],
    'Purva Phalguni': ['Bharani', 'Purva Ashadha'],
    'Uttara Phalguni': ['Krittika', 'Uttara Ashadha'],
    'Hasta': ['Rohini', 'Shravana'],
    'Chitra': ['Mrigashira', 'Dhanishta'],
    'Swati': ['Ardra', 'Shatabhisha'],
    'Vishakha': ['Punarvasu', 'Purva Bhadrapada'],
    'Anuradha': ['Pushya', 'Uttara Bhadrapada'],
    'Jyeshtha': ['Ashlesha', 'Revati'],
    'Mula': ['Ashwini', 'Magha'],
    'Purva Ashadha': ['Bharani', 'Purva Phalguni'],
    'Uttara Ashadha': ['Krittika', 'Uttara Phalguni'],
    'Shravana': ['Rohini', 'Hasta'],
    'Dhanishta': ['Mrigashira', 'Chitra'],
    'Shatabhisha': ['Ardra', 'Swati'],
    'Purva Bhadrapada': ['Punarvasu', 'Vishakha'],
    'Uttara Bhadrapada': ['Pushya', 'Anuradha'],
    'Revati': ['Ashlesha', 'Jyeshtha'],
}


class SarvatobhadraChakra:
    def __init__(self, natal_planets: Dict):
        self.natal_planets = natal_planets

    def get_natal_nakshatras(self) -> Dict:
        """Get nakshatra of each natal planet."""
        result = {}
        for planet, data in self.natal_planets.items():
            nak = data.get('nakshatra_name', '')
            if nak:
                result[planet] = nak
        return result

    def check_vedha(self, transit_nakshatra: str) -> List[Dict]:
        """Check which natal planets are affected by a transit in given nakshatra."""
        affected = VEDHA_PAIRS.get(transit_nakshatra, [])
        natal_naks = self.get_natal_nakshatras()

        impacts = []
        for planet, nak in natal_naks.items():
            if nak in affected:
                impacts.append({
                    'natal_planet': planet,
                    'natal_nakshatra': nak,
                    'transit_nakshatra': transit_nakshatra,
                    'type': 'Vedha (Affliction)',
                    'effect': f'{planet} in {nak} receives vedha from transit in {transit_nakshatra}',
                })

        return impacts

    def analyze_current_vedhas(self, transit_planets: Dict) -> Dict:
        """Check all current transit vedhas on natal chart."""
        all_vedhas = []
        for planet, data in transit_planets.items():
            t_nak = data.get('nakshatra_name', '')
            if t_nak:
                vedhas = self.check_vedha(t_nak)
                for v in vedhas:
                    v['transit_planet'] = planet
                    all_vedhas.append(v)

        return {
            'system': 'Sarvatobhadra Chakra',
            'vedhas': all_vedhas,
            'total_vedhas': len(all_vedhas),
            'affected_planets': list(set(v['natal_planet'] for v in all_vedhas)),
        }


def analyze_sarvatobhadra(natal_planets, transit_planets):
    sc = SarvatobhadraChakra(natal_planets)
    return sc.analyze_current_vedhas(transit_planets)
