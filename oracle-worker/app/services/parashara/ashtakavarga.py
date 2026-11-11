"""
JYOTISH ENGINE - ASHTAKAVARGA SYSTEM
Transit strength calculation using bindus (points)

Each planet contributes bindus (benefic points) to houses
Based on positions from 7 planets + Lagna
"""

from typing import Dict, List
from ..core.constants import RASHI_NAMES


class AshtakavargaCalculator:
    """
    Calculate Bhinnashtakavarga (individual) and Sarvashtakavarga (combined)
    
    Each planet gives bindus (1 point) or no bindu (0) to each house
    Based on its position from other planets and lagna
    """
    
    # Benefic positions for each planet from other planets
    # Format: {planet: {contributing_planet: [houses where bindu is given]}}
    
    BINDU_POSITIONS = {
        'Sun': {
            'Sun': [1, 2, 4, 7, 8, 9, 10, 11],
            'Moon': [3, 6, 10, 11],
            'Mars': [1, 2, 4, 7, 8, 9, 10, 11],
            'Mercury': [3, 5, 6, 9, 10, 11, 12],
            'Jupiter': [5, 6, 9, 11],
            'Venus': [6, 7, 12],
            'Saturn': [1, 2, 4, 7, 8, 9, 10, 11],
            'Lagna': [3, 4, 6, 10, 11, 12],
        },
        'Moon': {
            'Sun': [3, 6, 7, 8, 10, 11],
            'Moon': [1, 3, 6, 7, 10, 11],
            'Mars': [2, 3, 5, 6, 9, 10, 11],
            'Mercury': [1, 3, 4, 5, 7, 8, 10, 11],
            'Jupiter': [1, 4, 7, 8, 10, 11, 12],
            'Venus': [3, 4, 5, 7, 9, 10, 11],
            'Saturn': [3, 5, 6, 11],
            'Lagna': [3, 6, 10, 11],
        },
        'Mars': {
            'Sun': [3, 5, 6, 10, 11],
            'Moon': [3, 6, 11],
            'Mars': [1, 2, 4, 7, 8, 10, 11],
            'Mercury': [3, 5, 6, 11],
            'Jupiter': [6, 10, 11, 12],
            'Venus': [6, 8, 11, 12],
            'Saturn': [1, 4, 7, 8, 9, 10, 11],
            'Lagna': [1, 3, 6, 10, 11],
        },
        'Mercury': {
            'Sun': [5, 6, 9, 11, 12],
            'Moon': [2, 4, 6, 8, 10, 11],
            'Mars': [1, 2, 4, 7, 8, 9, 10, 11],
            'Mercury': [1, 3, 5, 6, 9, 10, 11, 12],
            'Jupiter': [6, 8, 11, 12],
            'Venus': [1, 2, 3, 4, 5, 8, 9, 11],
            'Saturn': [1, 2, 4, 7, 8, 9, 10, 11],
            'Lagna': [1, 2, 4, 6, 8, 10, 11],
        },
        'Jupiter': {
            'Sun': [1, 2, 3, 4, 7, 8, 9, 10, 11],
            'Moon': [2, 5, 7, 9, 11],
            'Mars': [1, 2, 4, 7, 8, 10, 11],
            'Mercury': [1, 2, 4, 5, 6, 9, 10, 11],
            'Jupiter': [1, 2, 3, 4, 7, 8, 10, 11],
            'Venus': [2, 5, 6, 9, 10, 11],
            'Saturn': [3, 5, 6, 12],
            'Lagna': [1, 2, 4, 5, 6, 7, 9, 10, 11],
        },
        'Venus': {
            'Sun': [8, 11, 12],
            'Moon': [1, 2, 3, 4, 5, 8, 9, 11, 12],
            'Mars': [3, 5, 6, 9, 11, 12],
            'Mercury': [3, 5, 6, 9, 11],
            'Jupiter': [5, 8, 9, 10, 11],
            'Venus': [1, 2, 3, 4, 5, 8, 9, 10, 11],
            'Saturn': [3, 4, 5, 8, 9, 10, 11],
            'Lagna': [1, 2, 3, 4, 5, 8, 9, 11],
        },
        'Saturn': {
            'Sun': [1, 2, 4, 7, 8, 10, 11],
            'Moon': [3, 6, 11],
            'Mars': [3, 5, 6, 10, 11, 12],
            'Mercury': [6, 8, 9, 10, 11, 12],
            'Jupiter': [5, 6, 11, 12],
            'Venus': [6, 11, 12],
            'Saturn': [3, 5, 6, 11],
            'Lagna': [1, 3, 4, 6, 10, 11],
        },
    }
    
    def __init__(self, planets: Dict, ascendant_rashi: int):
        """
        Initialize calculator
        
        Args:
            planets: Dict of planets with 'rashi' key (0-11)
            ascendant_rashi: Ascendant rashi index (0-11)
        """
        self.planets = planets
        self.asc_rashi = ascendant_rashi
        
        # Store planet rashis for easy access
        self.planet_rashis = {
            planet: data.get('rashi', 0)
            for planet, data in planets.items()
        }
        self.planet_rashis['Lagna'] = ascendant_rashi
    
    def _get_house_from_planet(self, from_rashi: int, to_rashi: int) -> int:
        """Calculate house number of to_rashi from from_rashi"""
        return ((to_rashi - from_rashi) % 12) + 1
    
    def calculate_bhinnashtakavarga(self, planet: str) -> Dict:
        """
        Calculate Bhinnashtakavarga for one planet
        
        Returns:
            Dict with bindus for each rashi (0-11)
        """
        if planet not in self.BINDU_POSITIONS:
            return {'error': f'No Ashtakavarga data for {planet}'}
        
        bindu_rules = self.BINDU_POSITIONS[planet]
        
        # Initialize bindus for all 12 rashis
        rashis_bindus = {i: 0 for i in range(12)}
        
        # For each contributing planet/lagna
        contributors = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Lagna']
        
        for contributor in contributors:
            if contributor not in bindu_rules:
                continue
            
            # Get position of contributor
            contrib_rashi = self.planet_rashis.get(contributor, 0)
            
            # Get houses where this contributor gives bindus
            bindu_houses = bindu_rules[contributor]
            
            # Convert houses to rashis and add bindus
            for house in bindu_houses:
                target_rashi = (contrib_rashi + house - 1) % 12
                rashis_bindus[target_rashi] += 1
        
        # Calculate total and average
        total = sum(rashis_bindus.values())
        
        return {
            'planet': planet,
            'bindus_by_rashi': rashis_bindus,
            'bindus_by_rashi_named': {
                RASHI_NAMES[i]: rashis_bindus[i] for i in range(12)
            },
            'total_bindus': total,
            'average': round(total / 12, 2),
            'max_bindu_rashi': max(rashis_bindus, key=rashis_bindus.get),
            'min_bindu_rashi': min(rashis_bindus, key=rashis_bindus.get),
        }
    
    def calculate_sarvashtakavarga(self) -> Dict:
        """
        Calculate Sarvashtakavarga (combined chart)
        Sum of all planet's bindus for each rashi
        
        Maximum possible per rashi: 56 (8 contributors × 7 planets)
        Total possible: 337
        """
        # Initialize combined bindus
        sarva_bindus = {i: 0 for i in range(12)}
        
        # Calculate for each planet and sum
        planet_charts = {}
        seven_planets = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']
        
        for planet in seven_planets:
            bav = self.calculate_bhinnashtakavarga(planet)
            planet_charts[planet] = bav
            
            for rashi, bindus in bav['bindus_by_rashi'].items():
                sarva_bindus[rashi] += bindus
        
        total = sum(sarva_bindus.values())
        
        # Categorize rashis by strength
        strong_rashis = [r for r, b in sarva_bindus.items() if b >= 28]
        weak_rashis = [r for r, b in sarva_bindus.items() if b < 22]
        
        return {
            'bindus_by_rashi': sarva_bindus,
            'bindus_by_rashi_named': {
                RASHI_NAMES[i]: sarva_bindus[i] for i in range(12)
            },
            'total_bindus': total,
            'average_per_rashi': round(total / 12, 2),
            'strong_rashis': [RASHI_NAMES[r] for r in strong_rashis],
            'weak_rashis': [RASHI_NAMES[r] for r in weak_rashis],
            'max_bindu_rashi': RASHI_NAMES[max(sarva_bindus, key=sarva_bindus.get)],
            'min_bindu_rashi': RASHI_NAMES[min(sarva_bindus, key=sarva_bindus.get)],
            'planet_charts': planet_charts,
        }
    
    def get_transit_strength(self, planet: str, transit_rashi: int) -> Dict:
        """
        Get strength of a planet transiting a specific rashi
        Based on Bhinnashtakavarga
        
        Args:
            planet: Transiting planet
            transit_rashi: Rashi being transited (0-11)
        
        Returns:
            Dict with bindu count and interpretation
        """
        bav = self.calculate_bhinnashtakavarga(planet)
        bindus = bav['bindus_by_rashi'].get(transit_rashi, 0)
        
        # Interpretation
        if bindus >= 5:
            strength = 'Excellent'
            interpretation = 'Very favorable transit, strong positive results'
        elif bindus == 4:
            strength = 'Good'
            interpretation = 'Favorable transit, positive results expected'
        elif bindus == 3:
            strength = 'Average'
            interpretation = 'Mixed results, neutral transit'
        elif bindus == 2:
            strength = 'Weak'
            interpretation = 'Challenging transit, some difficulties'
        else:
            strength = 'Very Weak'
            interpretation = 'Difficult transit, obstacles and delays'
        
        return {
            'planet': planet,
            'transit_rashi': transit_rashi,
            'rashi_name': RASHI_NAMES[transit_rashi],
            'bindus': bindus,
            'max_possible': 8,
            'strength': strength,
            'interpretation': interpretation,
        }
    
    def predict_favorable_transits(self, planet: str) -> List[Dict]:
        """
        Find most favorable rashis for a planet's transit
        
        Returns:
            List of rashis sorted by bindu count
        """
        bav = self.calculate_bhinnashtakavarga(planet)
        
        rashis_ranked = sorted(
            bav['bindus_by_rashi'].items(),
            key=lambda x: x[1],
            reverse=True
        )
        
        return [
            {
                'rashi': rashi,
                'rashi_name': RASHI_NAMES[rashi],
                'bindus': bindus,
                'strength': 'Strong' if bindus >= 4 else 'Moderate' if bindus >= 3 else 'Weak',
            }
            for rashi, bindus in rashis_ranked
        ]
    
    def analyze_house_strength(self) -> Dict:
        """
        Analyze strength of each house based on Sarvashtakavarga
        """
        sav = self.calculate_sarvashtakavarga()
        
        house_strength = {}
        for house in range(1, 13):
            house_rashi = (self.asc_rashi + house - 1) % 12
            bindus = sav['bindus_by_rashi'][house_rashi]
            
            if bindus >= 30:
                category = 'Very Strong'
            elif bindus >= 26:
                category = 'Strong'
            elif bindus >= 22:
                category = 'Average'
            elif bindus >= 18:
                category = 'Weak'
            else:
                category = 'Very Weak'
            
            house_strength[house] = {
                'house': house,
                'rashi': house_rashi,
                'rashi_name': RASHI_NAMES[house_rashi],
                'bindus': bindus,
                'category': category,
            }
        
        return house_strength
    
    def kakshya_analysis(self, planet: str, longitude: float) -> Dict:
        """
        Kakshya (sub-division) analysis
        Each rashi divided into 8 parts of 3°45' each
        Each part ruled by a planet
        
        Order: Saturn, Jupiter, Mars, Sun, Venus, Mercury, Moon, Lagna
        """
        rashi = int(longitude / 30)
        degree_in_rashi = longitude % 30
        
        kakshya_size = 30 / 8  # 3.75 degrees
        kakshya_num = int(degree_in_rashi / kakshya_size)
        
        kakshya_lords = ['Saturn', 'Jupiter', 'Mars', 'Sun', 'Venus', 'Mercury', 'Moon', 'Lagna']
        kakshya_lord = kakshya_lords[kakshya_num]
        
        # Check if planet gets bindu in this kakshya
        bav = self.calculate_bhinnashtakavarga(planet)
        bindus_in_rashi = bav['bindus_by_rashi'].get(rashi, 0)
        
        return {
            'planet': planet,
            'rashi': rashi,
            'rashi_name': RASHI_NAMES[rashi],
            'kakshya_number': kakshya_num + 1,
            'kakshya_lord': kakshya_lord,
            'degree_range': f"{kakshya_num * kakshya_size:.2f}° - {(kakshya_num + 1) * kakshya_size:.2f}°",
            'bindus_in_rashi': bindus_in_rashi,
        }


# Convenience functions
def calculate_ashtakavarga(planets: Dict, ascendant_rashi: int) -> Dict:
    """Quick function to calculate full Ashtakavarga"""
    calculator = AshtakavargaCalculator(planets, ascendant_rashi)
    return calculator.calculate_sarvashtakavarga()

def get_transit_bindu(planets: Dict, ascendant_rashi: int, 
                      transit_planet: str, transit_rashi: int) -> int:
    """Quick function to get transit bindu count"""
    calculator = AshtakavargaCalculator(planets, ascendant_rashi)
    result = calculator.get_transit_strength(transit_planet, transit_rashi)
    return result['bindus']
