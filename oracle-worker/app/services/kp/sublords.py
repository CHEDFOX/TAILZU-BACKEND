"""
JYOTISH ENGINE - KP SYSTEM (KRISHNAMURTI PADDHATI)
Sub-lord based prediction system
"""

from typing import Dict, List
from ..core.constants import (
    NAKSHATRAS, VIMSHOTTARI_YEARS, VIMSHOTTARI_ORDER
)
from ..core.utils import get_nakshatra_from_longitude


class KPSystem:
    """
    Krishnamurti Paddhati (KP) Astrology System
    
    Key concepts:
    1. Sub-lord theory - Each nakshatra divided into 9 subs
    2. Cuspal sub-lords - Most important for predictions
    3. Significators - Planets signifying houses
    4. Ruling Planets - For timing and verification
    """
    
    # KP Ayanamsa (slightly different from Lahiri)
    KP_AYANAMSA_BASE = 23.0833  # As of 1900
    
    # Sub-division of nakshatras
    # Each nakshatra (13°20') divided into 9 parts proportional to Vimshottari years
    # Total nakshatra = 800 minutes, divided by dasha years
    
    def __init__(self, planets: Dict, cusps: Dict = None):
        """
        Initialize KP calculator
        
        Args:
            planets: Dict with planet longitudes
            cusps: Dict with house cusp longitudes (Placidus)
        """
        self.planets = planets
        self.cusps = cusps or {}
    
    def get_nakshatra_lord(self, longitude: float) -> str:
        """Get nakshatra lord (Star Lord)"""
        nakshatra = get_nakshatra_from_longitude(longitude)
        return NAKSHATRAS[nakshatra]['ruler']
    
    def get_sub_lord(self, longitude: float) -> Dict:
        """
        Calculate Sub-Lord for a given longitude
        
        Each nakshatra (13°20' = 800') is divided into 9 subs
        proportional to Vimshottari dasha years
        """
        # Nakshatra span in degrees
        nakshatra_span = 360 / 27  # 13.333...
        
        # Position within nakshatra
        nakshatra_num = int(longitude / nakshatra_span)
        degree_in_nakshatra = longitude % nakshatra_span
        
        # Nakshatra lord
        nakshatra_lord = NAKSHATRAS[nakshatra_num]['ruler']
        
        # Find starting position in Vimshottari order
        start_index = VIMSHOTTARI_ORDER.index(nakshatra_lord)
        
        # Calculate sub-divisions
        # Each sub is proportional to dasha years / 120 * nakshatra_span
        total_years = sum(VIMSHOTTARI_YEARS.values())  # 120
        
        accumulated = 0
        sub_lord = nakshatra_lord
        sub_start = 0
        sub_end = 0
        
        for i in range(9):
            planet = VIMSHOTTARI_ORDER[(start_index + i) % 9]
            sub_span = (VIMSHOTTARI_YEARS[planet] / total_years) * nakshatra_span
            sub_end = accumulated + sub_span
            
            if accumulated <= degree_in_nakshatra < sub_end:
                sub_lord = planet
                sub_start = accumulated
                break
            
            accumulated = sub_end
        
        # Calculate sub-sub lord (for more precision)
        degree_in_sub = degree_in_nakshatra - sub_start
        sub_span = (VIMSHOTTARI_YEARS[sub_lord] / total_years) * nakshatra_span
        
        sub_sub_lord = self._calculate_sub_sub(degree_in_sub, sub_span, sub_lord)
        
        return {
            'longitude': round(longitude, 4),
            'nakshatra': NAKSHATRAS[nakshatra_num]['name'],
            'nakshatra_lord': nakshatra_lord,
            'sub_lord': sub_lord,
            'sub_sub_lord': sub_sub_lord,
            'degree_in_nakshatra': round(degree_in_nakshatra, 4),
        }
    
    def _calculate_sub_sub(self, degree_in_sub: float, sub_span: float, sub_lord: str) -> str:
        """Calculate sub-sub lord"""
        start_index = VIMSHOTTARI_ORDER.index(sub_lord)
        total_years = 120
        
        accumulated = 0
        for i in range(9):
            planet = VIMSHOTTARI_ORDER[(start_index + i) % 9]
            sub_sub_span = (VIMSHOTTARI_YEARS[planet] / total_years) * sub_span
            
            if accumulated <= degree_in_sub < accumulated + sub_sub_span:
                return planet
            
            accumulated += sub_sub_span
        
        return sub_lord
    
    def get_planet_significators(self, planet: str) -> Dict:
        """
        Get houses signified by a planet (KP Significators)
        
        A planet signifies houses through:
        1. Occupation - House it occupies
        2. Ownership - Houses it rules
        3. Star lord - Houses occupied/owned by its star lord
        """
        planet_data = self.planets.get(planet, {})
        longitude = planet_data.get('longitude', 0)
        house = planet_data.get('house', 1)
        rashi = planet_data.get('rashi', 0)
        
        # Get nakshatra lord
        nak_lord = self.get_nakshatra_lord(longitude)
        nak_lord_data = self.planets.get(nak_lord, {})
        nak_lord_house = nak_lord_data.get('house', 1)
        
        # Houses owned by planet
        from ..core.constants import RASHI_LORDS
        owned_houses = []
        for h in range(1, 13):
            if self.cusps:
                cusp_rashi = int(self.cusps.get(h, 0) / 30)
            else:
                cusp_rashi = (rashi + h - 1) % 12
            
            if RASHI_LORDS[cusp_rashi] == planet:
                owned_houses.append(h)
        
        # Houses owned by nakshatra lord
        nak_lord_owned = []
        for h in range(1, 13):
            if self.cusps:
                cusp_rashi = int(self.cusps.get(h, 0) / 30)
            else:
                cusp_rashi = (rashi + h - 1) % 12
            
            if RASHI_LORDS[cusp_rashi] == nak_lord:
                nak_lord_owned.append(h)
        
        # All signified houses
        signified = list(set([house] + owned_houses + [nak_lord_house] + nak_lord_owned))
        signified.sort()
        
        return {
            'planet': planet,
            'occupies': house,
            'owns': owned_houses,
            'nakshatra_lord': nak_lord,
            'nak_lord_occupies': nak_lord_house,
            'nak_lord_owns': nak_lord_owned,
            'signifies': signified,
        }
    
    def get_house_significators(self, house: int) -> Dict:
        """
        Get all planets signifying a house
        
        Strongest to weakest:
        1. Planets in star of occupants
        2. Occupants of house
        3. Planets in star of owner
        4. Owner of house
        """
        significators = {
            'level_1': [],  # Planets in star of occupants
            'level_2': [],  # Occupants
            'level_3': [],  # Planets in star of owner
            'level_4': [],  # Owner
        }
        
        # Find occupants
        occupants = []
        for planet, data in self.planets.items():
            if data.get('house') == house:
                occupants.append(planet)
        
        significators['level_2'] = occupants
        
        # Find owner
        if self.cusps and house in self.cusps:
            from ..core.constants import RASHI_LORDS
            cusp_rashi = int(self.cusps[house] / 30)
            owner = RASHI_LORDS[cusp_rashi]
            significators['level_4'] = [owner]
        
        # Find planets in star of occupants
        for planet, data in self.planets.items():
            nak_lord = self.get_nakshatra_lord(data.get('longitude', 0))
            if nak_lord in occupants:
                significators['level_1'].append(planet)
        
        # Find planets in star of owner
        if significators['level_4']:
            owner = significators['level_4'][0]
            for planet, data in self.planets.items():
                nak_lord = self.get_nakshatra_lord(data.get('longitude', 0))
                if nak_lord == owner:
                    significators['level_3'].append(planet)
        
        return significators
    
    def get_cuspal_sub_lords(self) -> Dict:
        """
        Get sub-lords of all house cusps
        Most important in KP for predictions
        """
        if not self.cusps:
            return {'error': 'Cusps not provided'}
        
        cuspal_sub_lords = {}
        for house in range(1, 13):
            cusp_long = self.cusps.get(house, 0)
            sub_lord_data = self.get_sub_lord(cusp_long)
            
            cuspal_sub_lords[house] = {
                'cusp_longitude': round(cusp_long, 4),
                'nakshatra': sub_lord_data['nakshatra'],
                'nakshatra_lord': sub_lord_data['nakshatra_lord'],
                'sub_lord': sub_lord_data['sub_lord'],
                'sub_sub_lord': sub_lord_data['sub_sub_lord'],
            }
        
        return cuspal_sub_lords
    
    def analyze_event_promise(self, house: int) -> Dict:
        """
        Check if an event (house) is promised in the chart
        
        KP Rule: Event is promised if:
        1. Cuspal sub-lord signifies the house
        2. Cuspal sub-lord is not retrograde in unfavorable position
        """
        if not self.cusps:
            return {'error': 'Cusps required for KP analysis'}
        
        cusp_long = self.cusps.get(house, 0)
        sub_lord_data = self.get_sub_lord(cusp_long)
        sub_lord = sub_lord_data['sub_lord']
        
        # Get significators of sub-lord
        significators = self.get_planet_significators(sub_lord)
        
        # Check if sub-lord signifies the house
        is_promised = house in significators['signifies']
        
        # Check for negating houses (6, 8, 12 from house)
        negating_houses = [(house + 5) % 12 or 12, (house + 7) % 12 or 12, (house + 11) % 12 or 12]
        has_negation = any(h in significators['signifies'] for h in negating_houses)
        
        return {
            'house': house,
            'cusp_sub_lord': sub_lord,
            'sub_lord_signifies': significators['signifies'],
            'is_promised': is_promised,
            'has_negation': has_negation,
            'verdict': 'Promised' if is_promised and not has_negation 
                      else 'Denied' if not is_promised 
                      else 'Delayed/Difficult',
        }


class RulingPlanets:
    """
    Calculate Ruling Planets (RP) for timing
    Used for verification and timing of events
    """
    
    def __init__(self, datetime_obj, moon_longitude: float, ascendant_longitude: float):
        """
        Initialize with current moment data
        """
        self.dt = datetime_obj
        self.moon_long = moon_longitude
        self.asc_long = ascendant_longitude
    
    def calculate(self) -> Dict:
        """
        Calculate 5 Ruling Planets:
        1. Day Lord
        2. Moon Sign Lord
        3. Moon Star Lord
        4. Lagna Sign Lord
        5. Lagna Star Lord
        """
        from ..core.constants import VARA_LORDS, RASHI_LORDS
        
        # Day Lord
        weekday = (self.dt.weekday() + 1) % 7
        day_lord = VARA_LORDS[weekday]
        
        # Moon Sign Lord
        moon_rashi = int(self.moon_long / 30)
        moon_sign_lord = RASHI_LORDS[moon_rashi]
        
        # Moon Star Lord
        moon_nakshatra = get_nakshatra_from_longitude(self.moon_long)
        moon_star_lord = NAKSHATRAS[moon_nakshatra]['ruler']
        
        # Lagna Sign Lord
        asc_rashi = int(self.asc_long / 30)
        lagna_sign_lord = RASHI_LORDS[asc_rashi]
        
        # Lagna Star Lord
        asc_nakshatra = get_nakshatra_from_longitude(self.asc_long)
        lagna_star_lord = NAKSHATRAS[asc_nakshatra]['ruler']
        
        # All ruling planets (unique)
        all_rps = list(set([day_lord, moon_sign_lord, moon_star_lord, 
                           lagna_sign_lord, lagna_star_lord]))
        
        return {
            'day_lord': day_lord,
            'moon_sign_lord': moon_sign_lord,
            'moon_star_lord': moon_star_lord,
            'lagna_sign_lord': lagna_sign_lord,
            'lagna_star_lord': lagna_star_lord,
            'ruling_planets': all_rps,
            'strongest': self._find_strongest(all_rps),
        }
    
    def _find_strongest(self, rps: List[str]) -> str:
        """Find strongest ruling planet (appears most)"""
        # Count occurrences
        counts = {}
        for rp in rps:
            counts[rp] = counts.get(rp, 0) + 1
        
        # Return most frequent
        return max(counts, key=counts.get) if counts else ''
    
    def verify_significators(self, event_significators: List[str]) -> Dict:
        """
        Verify if event significators match ruling planets
        Strong match = event likely to happen soon
        """
        rps = self.calculate()
        ruling = set(rps['ruling_planets'])
        event = set(event_significators)
        
        common = ruling.intersection(event)
        match_percentage = len(common) / max(len(event), 1) * 100
        
        return {
            'ruling_planets': list(ruling),
            'event_significators': list(event),
            'common_planets': list(common),
            'match_percentage': round(match_percentage, 1),
            'verdict': 'Strong Match' if match_percentage >= 60 
                      else 'Moderate Match' if match_percentage >= 30 
                      else 'Weak Match',
        }


# Convenience functions
def get_sub_lord(longitude: float, planets: Dict = None) -> Dict:
    """Quick function to get sub-lord"""
    kp = KPSystem(planets or {})
    return kp.get_sub_lord(longitude)

def analyze_house_kp(house: int, planets: Dict, cusps: Dict) -> Dict:
    """Analyze house using KP"""
    kp = KPSystem(planets, cusps)
    return kp.analyze_event_promise(house)
