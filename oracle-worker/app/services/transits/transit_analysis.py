"""
JYOTISH ENGINE - TRANSIT ANALYSIS
Real-time and predictive transit calculations
"""

from datetime import datetime
from typing import Dict, List
from ..core.constants import RASHI_NAMES
from ..core.utils import get_rashi_from_longitude


class TransitAnalyzer:
    """
    Analyze planetary transits over natal chart
    
    Key concepts:
    1. Gochar (Transit) - Current planet positions
    2. Vedha - Obstruction points
    3. Double Transit - Jupiter + Saturn confirmation
    4. Ashtakavarga Transit - Bindu-based strength
    """
    
    # Vedha points - obstruction from these houses nullifies good transit
    VEDHA_POINTS = {
        'Sun': {3: 9, 6: 12, 10: 4, 11: 5},
        'Moon': {1: 5, 3: 9, 6: 12, 7: 2, 10: 4, 11: 8},
        'Mars': {3: 12, 6: 9, 11: 5},
        'Mercury': {2: 5, 4: 3, 6: 9, 8: 1, 10: 8, 11: 12},
        'Jupiter': {2: 12, 5: 4, 7: 3, 9: 10, 11: 8},
        'Venus': {1: 8, 2: 7, 3: 1, 4: 10, 5: 9, 8: 5, 9: 11, 11: 6, 12: 3},
        'Saturn': {3: 12, 6: 9, 11: 5},
    }
    
    # Good transit houses from Moon
    GOOD_TRANSIT_HOUSES = {
        'Sun': [3, 6, 10, 11],
        'Moon': [1, 3, 6, 7, 10, 11],
        'Mars': [3, 6, 11],
        'Mercury': [2, 4, 6, 8, 10, 11],
        'Jupiter': [2, 5, 7, 9, 11],
        'Venus': [1, 2, 3, 4, 5, 8, 9, 11, 12],
        'Saturn': [3, 6, 11],
        'Rahu': [3, 6, 10, 11],
        'Ketu': [3, 6, 10, 11],
    }
    
    def __init__(self, natal_planets: Dict, natal_ascendant: int):
        """
        Initialize with natal chart data
        
        Args:
            natal_planets: Birth chart planet positions
            natal_ascendant: Birth ascendant rashi (0-11)
        """
        self.natal = natal_planets
        self.natal_asc = natal_ascendant
        self.natal_moon = natal_planets.get('Moon', {}).get('rashi', 0)
    
    def get_transit_house_from_moon(self, transit_rashi: int) -> int:
        """Get transit house counted from natal Moon"""
        return ((transit_rashi - self.natal_moon) % 12) + 1
    
    def get_transit_house_from_lagna(self, transit_rashi: int) -> int:
        """Get transit house counted from natal Lagna"""
        return ((transit_rashi - self.natal_asc) % 12) + 1
    
    def analyze_single_transit(self, planet: str, transit_longitude: float) -> Dict:
        """
        Analyze single planet's transit
        """
        transit_rashi = get_rashi_from_longitude(transit_longitude)
        house_from_moon = self.get_transit_house_from_moon(transit_rashi)
        house_from_lagna = self.get_transit_house_from_lagna(transit_rashi)
        
        # Check if good house
        good_houses = self.GOOD_TRANSIT_HOUSES.get(planet, [])
        is_good_from_moon = house_from_moon in good_houses
        
        # Check Vedha
        has_vedha = False
        vedha_planet = None
        vedha_points = self.VEDHA_POINTS.get(planet, {})
        
        if house_from_moon in vedha_points:
            vedha_house = vedha_points[house_from_moon]
            # Check if any planet is in vedha house from Moon
            for p, data in self.natal.items():
                p_house = self.get_transit_house_from_moon(data.get('rashi', 0))
                if p_house == vedha_house:
                    has_vedha = True
                    vedha_planet = p
                    break
        
        # Transit over natal planets
        natal_conjunctions = []
        for natal_planet, natal_data in self.natal.items():
            if natal_data.get('rashi') == transit_rashi:
                natal_conjunctions.append(natal_planet)
        
        # Determine effect
        if is_good_from_moon and not has_vedha:
            effect = 'Favorable'
        elif is_good_from_moon and has_vedha:
            effect = 'Obstructed (Vedha)'
        elif house_from_moon in [6, 8, 12]:
            effect = 'Challenging'
        else:
            effect = 'Neutral'
        
        return {
            'planet': planet,
            'transit_rashi': transit_rashi,
            'transit_rashi_name': RASHI_NAMES[transit_rashi],
            'house_from_moon': house_from_moon,
            'house_from_lagna': house_from_lagna,
            'is_good_house': is_good_from_moon,
            'has_vedha': has_vedha,
            'vedha_by': vedha_planet,
            'natal_conjunctions': natal_conjunctions,
            'effect': effect,
        }
    
    def analyze_all_transits(self, transit_planets: Dict) -> Dict:
        """
        Analyze all current transits
        
        Args:
            transit_planets: Current planet positions
        """
        analysis = {}
        favorable_count = 0
        challenging_count = 0
        
        for planet in ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu']:
            transit_data = transit_planets.get(planet, {})
            longitude = transit_data.get('longitude', 0)
            
            result = self.analyze_single_transit(planet, longitude)
            analysis[planet] = result
            
            if result['effect'] == 'Favorable':
                favorable_count += 1
            elif result['effect'] == 'Challenging':
                challenging_count += 1
        
        # Overall assessment
        if favorable_count >= 5:
            overall = 'Highly Favorable Period'
        elif favorable_count >= 3:
            overall = 'Generally Favorable'
        elif challenging_count >= 4:
            overall = 'Challenging Period'
        else:
            overall = 'Mixed Period'
        
        return {
            'transits': analysis,
            'favorable_count': favorable_count,
            'challenging_count': challenging_count,
            'overall': overall,
        }
    
    def check_double_transit(self, transit_planets: Dict, target_house: int) -> Dict:
        """
        Check Double Transit (Dwi-Graha Gochar)
        
        Event happens when BOTH Jupiter AND Saturn aspect a house
        Most important transit rule for major events
        """
        jupiter_long = transit_planets.get('Jupiter', {}).get('longitude', 0)
        saturn_long = transit_planets.get('Saturn', {}).get('longitude', 0)
        
        jupiter_rashi = get_rashi_from_longitude(jupiter_long)
        saturn_rashi = get_rashi_from_longitude(saturn_long)
        
        # Jupiter aspects: 5, 7, 9 from its position
        # Saturn aspects: 3, 7, 10 from its position
        
        jupiter_aspects = [(jupiter_rashi + a - 1) % 12 for a in [1, 5, 7, 9]]
        saturn_aspects = [(saturn_rashi + a - 1) % 12 for a in [1, 3, 7, 10]]
        
        # Target house rashi
        target_rashi = (self.natal_asc + target_house - 1) % 12
        
        jupiter_touches = target_rashi in jupiter_aspects
        saturn_touches = target_rashi in saturn_aspects
        
        double_transit = jupiter_touches and saturn_touches
        
        return {
            'target_house': target_house,
            'target_rashi': RASHI_NAMES[target_rashi],
            'jupiter_position': RASHI_NAMES[jupiter_rashi],
            'jupiter_aspects': [RASHI_NAMES[r] for r in jupiter_aspects],
            'jupiter_touches': jupiter_touches,
            'saturn_position': RASHI_NAMES[saturn_rashi],
            'saturn_aspects': [RASHI_NAMES[r] for r in saturn_aspects],
            'saturn_touches': saturn_touches,
            'double_transit_active': double_transit,
            'interpretation': f"Double transit {'IS' if double_transit else 'NOT'} active on house {target_house}",
        }
    
    def find_double_transit_periods(self, target_house: int, 
                                     start_date: datetime,
                                     months_ahead: int = 24) -> List[Dict]:
        """
        Find future periods when double transit activates a house
        Requires ephemeris calculations
        """
        # This would need ephemeris integration
        # Placeholder for future implementation
        return [{
            'note': 'Requires ephemeris integration for future calculations',
            'target_house': target_house,
        }]
    
    def analyze_sade_sati(self, transit_saturn_rashi: int) -> Dict:
        """
        Analyze Sade Sati (Saturn's 7.5 year transit)
        
        Sade Sati occurs when Saturn transits:
        - 12th from Moon (Rising phase)
        - Moon sign (Peak phase)
        - 2nd from Moon (Setting phase)
        """
        saturn_from_moon = ((transit_saturn_rashi - self.natal_moon) % 12) + 1
        
        phases = {
            12: {'phase': 'Rising', 'intensity': 'Beginning', 'years': '0-2.5'},
            1: {'phase': 'Peak', 'intensity': 'Maximum', 'years': '2.5-5'},
            2: {'phase': 'Setting', 'intensity': 'Ending', 'years': '5-7.5'},
        }
        
        is_sade_sati = saturn_from_moon in [12, 1, 2]
        phase_info = phases.get(saturn_from_moon, {})
        
        # Small Panoti (Dhaiya) - Saturn in 4th or 8th
        is_dhaiya = saturn_from_moon in [4, 8]
        
        return {
            'saturn_transit_rashi': RASHI_NAMES[transit_saturn_rashi],
            'natal_moon_rashi': RASHI_NAMES[self.natal_moon],
            'saturn_from_moon': saturn_from_moon,
            'is_sade_sati': is_sade_sati,
            'sade_sati_phase': phase_info.get('phase', 'Not Active'),
            'intensity': phase_info.get('intensity', 'None'),
            'is_dhaiya': is_dhaiya,
            'dhaiya_type': 'Ashtama Shani' if saturn_from_moon == 8 else 
                          'Ardha Ashtama' if saturn_from_moon == 4 else None,
            'recommendation': self._get_saturn_recommendation(saturn_from_moon),
        }
    
    def _get_saturn_recommendation(self, saturn_from_moon: int) -> str:
        """Get recommendation based on Saturn transit"""
        if saturn_from_moon in [12, 1, 2]:
            return "Sade Sati active - Focus on karma, patience, and spiritual growth"
        elif saturn_from_moon == 8:
            return "Ashtama Shani - Be cautious with health and avoid risky ventures"
        elif saturn_from_moon == 4:
            return "Ardha Ashtama - Mental stress possible, maintain peace at home"
        elif saturn_from_moon in [3, 6, 11]:
            return "Favorable Saturn transit - Good for achievements and gains"
        else:
            return "Neutral Saturn transit"
    
    def analyze_jupiter_transit(self, transit_jupiter_rashi: int) -> Dict:
        """
        Analyze Jupiter's transit (most benefic)
        """
        jupiter_from_moon = ((transit_jupiter_rashi - self.natal_moon) % 12) + 1
        jupiter_from_lagna = ((transit_jupiter_rashi - self.natal_asc) % 12) + 1
        
        good_houses = [2, 5, 7, 9, 11]
        is_favorable = jupiter_from_moon in good_houses
        
        house_effects = {
            1: 'Health concerns, expenses',
            2: 'Wealth gains, family harmony',
            3: 'Obstacles, courage needed',
            4: 'Mental stress, property issues',
            5: 'Excellent! Children, romance, gains',
            6: 'Enemies defeated, health needs care',
            7: 'Excellent for marriage, partnerships',
            8: 'Obstacles, delays',
            9: 'Best! Luck, spirituality, fortune',
            10: 'Career challenges',
            11: 'Excellent! All desires fulfilled',
            12: 'Expenses, spiritual growth',
        }
        
        return {
            'jupiter_transit_rashi': RASHI_NAMES[transit_jupiter_rashi],
            'house_from_moon': jupiter_from_moon,
            'house_from_lagna': jupiter_from_lagna,
            'is_favorable': is_favorable,
            'effect': house_effects.get(jupiter_from_moon, ''),
            'duration': '~13 months per sign',
        }
    
    def get_current_transit_summary(self, transit_planets: Dict) -> Dict:
        """
        Get comprehensive transit summary
        """
        all_transits = self.analyze_all_transits(transit_planets)
        
        saturn_rashi = get_rashi_from_longitude(
            transit_planets.get('Saturn', {}).get('longitude', 0)
        )
        jupiter_rashi = get_rashi_from_longitude(
            transit_planets.get('Jupiter', {}).get('longitude', 0)
        )
        
        sade_sati = self.analyze_sade_sati(saturn_rashi)
        jupiter = self.analyze_jupiter_transit(jupiter_rashi)
        
        # Key houses to check double transit
        double_transit_7 = self.check_double_transit(transit_planets, 7)  # Marriage
        double_transit_10 = self.check_double_transit(transit_planets, 10)  # Career
        
        return {
            'transit_analysis': all_transits,
            'sade_sati': sade_sati,
            'jupiter_transit': jupiter,
            'double_transit': {
                'house_7_marriage': double_transit_7['double_transit_active'],
                'house_10_career': double_transit_10['double_transit_active'],
            },
            'overall_period': all_transits['overall'],
        }


# Convenience functions
def analyze_transits(natal_planets: Dict, natal_asc: int, transit_planets: Dict) -> Dict:
    """Quick function to analyze transits"""
    analyzer = TransitAnalyzer(natal_planets, natal_asc)
    return analyzer.get_current_transit_summary(transit_planets)

def check_sade_sati(natal_moon_rashi: int, saturn_rashi: int) -> bool:
    """Quick check for Sade Sati"""
    saturn_from_moon = ((saturn_rashi - natal_moon_rashi) % 12) + 1
    return saturn_from_moon in [12, 1, 2]
