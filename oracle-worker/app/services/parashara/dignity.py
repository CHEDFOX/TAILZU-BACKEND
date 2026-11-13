"""
JYOTISH ENGINE - PLANETARY DIGNITY
Exaltation, Debilitation, Own Sign, Moolatrikona, Friends/Enemies
"""

from typing import Dict
from ..core.constants import PLANETS, RASHIS, RASHI_LORDS


class PlanetaryDignity:
    """
    Calculate planetary dignity and strength based on sign placement
    """
    
    # Friendship table (Naisargika Maitri)
    NATURAL_FRIENDS = {
        'Sun': ['Moon', 'Mars', 'Jupiter'],
        'Moon': ['Sun', 'Mercury'],
        'Mars': ['Sun', 'Moon', 'Jupiter'],
        'Mercury': ['Sun', 'Venus'],
        'Jupiter': ['Sun', 'Moon', 'Mars'],
        'Venus': ['Mercury', 'Saturn'],
        'Saturn': ['Mercury', 'Venus'],
        'Rahu': ['Mercury', 'Venus', 'Saturn'],
        'Ketu': ['Mars', 'Jupiter'],
    }
    
    NATURAL_ENEMIES = {
        'Sun': ['Venus', 'Saturn'],
        'Moon': [],
        'Mars': ['Mercury'],
        'Mercury': ['Moon'],
        'Jupiter': ['Mercury', 'Venus'],
        'Venus': ['Sun', 'Moon'],
        'Saturn': ['Sun', 'Moon', 'Mars'],
        'Rahu': ['Sun', 'Moon', 'Mars'],
        'Ketu': ['Moon'],
    }
    
    @classmethod
    def get_dignity(cls, planet: str, rashi: int, degree: float = 15.0) -> Dict:
        """
        Get complete dignity information for a planet in a sign
        
        Returns:
            Dict with dignity type, strength multiplier, and details
        """
        planet_info = PLANETS.get(planet, {})
        
        result = {
            'planet': planet,
            'rashi': rashi,
            'rashi_name': RASHIS[rashi]['name'],
            'dignity': 'Neutral',
            'dignity_type': 'neutral',
            'strength': 1.0,
            'is_exalted': False,
            'is_debilitated': False,
            'is_own_sign': False,
            'is_moolatrikona': False,
            'is_friend_sign': False,
            'is_enemy_sign': False,
            'is_neutral_sign': False,
            'special_notes': [],
        }
        
        # Check Exaltation
        if planet_info.get('exalted') == rashi:
            result['dignity'] = 'Exalted'
            result['dignity_type'] = 'exalted'
            result['is_exalted'] = True
            result['strength'] = 1.5
            
            # Check if at exact exaltation degree
            exalt_deg = planet_info.get('exalted_degree', 0)
            if abs(degree - exalt_deg) <= 1:
                result['strength'] = 1.75
                result['special_notes'].append('At exact exaltation degree - maximum strength')
            
            return result
        
        # Check Debilitation
        if planet_info.get('debilitated') == rashi:
            result['dignity'] = 'Debilitated'
            result['dignity_type'] = 'debilitated'
            result['is_debilitated'] = True
            result['strength'] = 0.25
            
            # Check if at exact debilitation degree
            debil_deg = planet_info.get('debilitated_degree', 0)
            if abs(degree - debil_deg) <= 1:
                result['strength'] = 0.1
                result['special_notes'].append('At exact debilitation degree - minimum strength')
            
            return result
        
        # Check Moolatrikona (before own sign check)
        mool_sign = planet_info.get('moolatrikona')
        mool_start = planet_info.get('moolatrikona_start', 0)
        mool_end = planet_info.get('moolatrikona_end', 30)
        
        if mool_sign == rashi and mool_start <= degree <= mool_end:
            result['dignity'] = 'Moolatrikona'
            result['dignity_type'] = 'moolatrikona'
            result['is_moolatrikona'] = True
            result['strength'] = 1.35
            return result
        
        # Check Own Sign
        if rashi in planet_info.get('owns', []):
            result['dignity'] = 'Own Sign'
            result['dignity_type'] = 'own_sign'
            result['is_own_sign'] = True
            result['strength'] = 1.25
            return result
        
        # Check Friend/Enemy/Neutral sign
        sign_lord = RASHI_LORDS[rashi]
        
        if sign_lord in cls.NATURAL_FRIENDS.get(planet, []):
            result['dignity'] = "Friend's Sign"
            result['dignity_type'] = 'friend_sign'
            result['is_friend_sign'] = True
            result['strength'] = 1.1
        elif sign_lord in cls.NATURAL_ENEMIES.get(planet, []):
            result['dignity'] = "Enemy's Sign"
            result['dignity_type'] = 'enemy_sign'
            result['is_enemy_sign'] = True
            result['strength'] = 0.75
        else:
            result['dignity'] = "Neutral Sign"
            result['dignity_type'] = 'neutral_sign'
            result['is_neutral_sign'] = True
            result['strength'] = 1.0
        
        return result
    
    @classmethod
    def get_temporary_friendship(cls, planet1: str, planet1_rashi: int,
                                  planet2: str, planet2_rashi: int) -> str:
        """
        Calculate temporary friendship based on house distance
        
        Planets in 2, 3, 4, 10, 11, 12 from each other are temporary friends
        Planets in 1, 5, 6, 7, 8, 9 from each other are temporary enemies
        """
        distance = ((planet2_rashi - planet1_rashi) % 12) + 1
        
        if distance in [2, 3, 4, 10, 11, 12]:
            return 'Temporary Friend'
        else:
            return 'Temporary Enemy'
    
    @classmethod
    def get_compound_friendship(cls, planet1: str, planet1_rashi: int,
                                 planet2: str, planet2_rashi: int) -> Dict:
        """
        Calculate compound (Panchadha) friendship
        Combines natural and temporary friendship
        
        Returns:
            Dict with friendship type and strength
        """
        # Get natural relationship
        if planet2 in cls.NATURAL_FRIENDS.get(planet1, []):
            natural = 'Friend'
        elif planet2 in cls.NATURAL_ENEMIES.get(planet1, []):
            natural = 'Enemy'
        else:
            natural = 'Neutral'
        
        # Get temporary relationship
        temp = cls.get_temporary_friendship(planet1, planet1_rashi, planet2, planet2_rashi)
        temp_type = 'Friend' if 'Friend' in temp else 'Enemy'
        
        # Combine for Panchadha Maitri
        compound_map = {
            ('Friend', 'Friend'): ('Intimate Friend', 1.0),
            ('Friend', 'Enemy'): ('Neutral', 0.5),
            ('Neutral', 'Friend'): ('Friend', 0.75),
            ('Neutral', 'Enemy'): ('Enemy', 0.25),
            ('Enemy', 'Friend'): ('Neutral', 0.5),
            ('Enemy', 'Enemy'): ('Bitter Enemy', 0.0),
        }
        
        compound, strength = compound_map.get((natural, temp_type), ('Neutral', 0.5))
        
        return {
            'planet1': planet1,
            'planet2': planet2,
            'natural_relationship': natural,
            'temporary_relationship': temp_type,
            'compound_relationship': compound,
            'strength': strength,
        }
    
    @classmethod
    def check_combustion(cls, planet: str, planet_long: float, sun_long: float) -> Dict:
        """
        Check if planet is combust (too close to Sun)
        """
        combustion_orbs = {
            'Moon': 12,
            'Mars': 17,
            'Mercury': 14,  # 12 when retrograde
            'Jupiter': 11,
            'Venus': 10,    # 8 when retrograde
            'Saturn': 15,
        }
        
        orb = combustion_orbs.get(planet, 0)
        if orb == 0:
            return {'is_combust': False, 'planet': planet}
        
        # Calculate angular distance
        diff = abs(planet_long - sun_long)
        if diff > 180:
            diff = 360 - diff
        
        is_combust = diff <= orb
        
        return {
            'planet': planet,
            'is_combust': is_combust,
            'distance_from_sun': round(diff, 2),
            'combustion_orb': orb,
            'combustion_strength': max(0, 1 - (diff / orb)) if is_combust else 0,
        }
    
    @classmethod
    def check_planetary_war(cls, planet1: str, long1: float,
                            planet2: str, long2: float) -> Dict:
        """
        Check if two planets are in planetary war (Graha Yuddha)
        Within 1 degree of each other
        """
        # Only applies to 5 planets (not Sun, Moon, Rahu, Ketu)
        war_planets = ['Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']
        
        if planet1 not in war_planets or planet2 not in war_planets:
            return {'in_war': False}
        
        diff = abs(long1 - long2)
        if diff > 180:
            diff = 360 - diff
        
        in_war = diff <= 1.0
        
        if not in_war:
            return {'in_war': False}
        
        # Determine winner (planet with lower longitude wins in north)
        # Simplified: check which planet is "ahead"
        winner = planet1 if long1 < long2 else planet2
        loser = planet2 if winner == planet1 else planet1
        
        return {
            'in_war': True,
            'planet1': planet1,
            'planet2': planet2,
            'separation': round(diff, 4),
            'winner': winner,
            'loser': loser,
            'notes': f'{winner} wins the planetary war against {loser}',
        }
    
    @classmethod
    def get_directional_strength(cls, planet: str, house: int) -> Dict:
        """
        Calculate Dig Bala (Directional Strength)
        Planets are strong in specific houses/directions
        """
        dig_bala_houses = {
            'Sun': 10,      # Strong in 10th (South)
            'Moon': 4,      # Strong in 4th (North)
            'Mars': 10,     # Strong in 10th (South)
            'Mercury': 1,   # Strong in 1st (East)
            'Jupiter': 1,   # Strong in 1st (East)
            'Venus': 4,     # Strong in 4th (North)
            'Saturn': 7,    # Strong in 7th (West)
        }
        
        strong_house = dig_bala_houses.get(planet)
        
        if strong_house is None:
            return {'planet': planet, 'dig_bala': 0, 'has_dig_bala': False}
        
        # Calculate strength based on distance from strong house
        # Maximum at strong house, minimum at opposite
        distance = abs(house - strong_house)
        if distance > 6:
            distance = 12 - distance
        
        # Strength is maximum (60 virupas) at dig bala house
        # Zero at opposite house
        strength = 60 * (1 - distance / 6)
        
        return {
            'planet': planet,
            'house': house,
            'dig_bala_house': strong_house,
            'dig_bala': round(strength, 2),
            'has_dig_bala': house == strong_house,
            'is_dig_bala_weak': distance >= 5,
        }
    
    @classmethod
    def analyze_all_planets(cls, planets: Dict, ascendant_rashi: int) -> Dict:
        """
        Analyze dignity for all planets
        
        Args:
            planets: Dict with planet data including 'longitude' and 'rashi'
            ascendant_rashi: Ascendant rashi index
        
        Returns:
            Complete dignity analysis for all planets
        """
        analysis = {}
        sun_long = planets.get('Sun', {}).get('longitude', 0)
        
        for planet_name, planet_data in planets.items():
            rashi = planet_data.get('rashi', 0)
            longitude = planet_data.get('longitude', 0)
            degree = longitude % 30
            house = ((rashi - ascendant_rashi) % 12) + 1
            
            # Get basic dignity
            dignity = cls.get_dignity(planet_name, rashi, degree)
            
            # Check combustion
            combustion = cls.check_combustion(planet_name, longitude, sun_long)
            
            # Get directional strength
            dig_bala = cls.get_directional_strength(planet_name, house)
            
            analysis[planet_name] = {
                **dignity,
                'house': house,
                'combustion': combustion,
                'directional_strength': dig_bala,
            }
        
        # Check planetary wars
        planet_list = list(planets.keys())
        wars = []
        for i, p1 in enumerate(planet_list):
            for p2 in planet_list[i+1:]:
                war = cls.check_planetary_war(
                    p1, planets[p1].get('longitude', 0),
                    p2, planets[p2].get('longitude', 0)
                )
                if war.get('in_war'):
                    wars.append(war)
        
        return {
            'planets': analysis,
            'planetary_wars': wars,
        }


# Convenience functions
def get_dignity(planet: str, rashi: int) -> str:
    """Quick function to get dignity type"""
    result = PlanetaryDignity.get_dignity(planet, rashi)
    return result['dignity']

def is_exalted(planet: str, rashi: int) -> bool:
    """Check if planet is exalted"""
    return PLANETS.get(planet, {}).get('exalted') == rashi

def is_debilitated(planet: str, rashi: int) -> bool:
    """Check if planet is debilitated"""
    return PLANETS.get(planet, {}).get('debilitated') == rashi

def is_own_sign(planet: str, rashi: int) -> bool:
    """Check if planet is in own sign"""
    return rashi in PLANETS.get(planet, {}).get('owns', [])
