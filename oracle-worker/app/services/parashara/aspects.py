"""
JYOTISH ENGINE - PLANETARY ASPECTS (DRISHTI)
Full and partial aspects, special aspects
"""

from typing import Dict, List, Tuple
from ..core.constants import PLANETS, RASHIS, RASHI_NAMES


class PlanetaryAspects:
    """
    Calculate planetary aspects (Graha Drishti)
    
    In Vedic astrology:
    - All planets aspect the 7th house fully (100%)
    - Mars has special aspects on 4th and 8th (100%)
    - Jupiter has special aspects on 5th and 9th (100%)
    - Saturn has special aspects on 3rd and 10th (100%)
    - Rahu/Ketu aspect 5th, 7th, 9th (like Jupiter)
    """
    
    # Full aspects (100%)
    FULL_ASPECTS = {
        'Sun': [7],
        'Moon': [7],
        'Mars': [4, 7, 8],
        'Mercury': [7],
        'Jupiter': [5, 7, 9],
        'Venus': [7],
        'Saturn': [3, 7, 10],
        'Rahu': [5, 7, 9],
        'Ketu': [5, 7, 9],
    }
    
    # Partial aspects (Parashara - used in some calculations)
    # Format: {house_distance: percentage}
    PARTIAL_ASPECTS = {
        3: 25,   # 1/4 aspect
        4: 75,   # 3/4 aspect
        5: 50,   # 1/2 aspect
        8: 75,   # 3/4 aspect
        9: 50,   # 1/2 aspect
        10: 25,  # 1/4 aspect
    }
    
    @classmethod
    def get_aspect_strength(cls, planet: str, house_distance: int) -> float:
        """
        Get aspect strength as percentage (0-100)
        
        Args:
            planet: Planet name
            house_distance: Distance from planet's house (1-12)
        
        Returns:
            Aspect strength as percentage
        """
        # Normalize house distance
        house_distance = ((house_distance - 1) % 12) + 1
        
        full_aspects = cls.FULL_ASPECTS.get(planet, [7])
        
        if house_distance in full_aspects:
            return 100.0
        
        # For Parashara partial aspects
        return cls.PARTIAL_ASPECTS.get(house_distance, 0.0)
    
    @classmethod
    def get_houses_aspected(cls, planet: str, planet_house: int, 
                           include_partial: bool = False) -> List[Dict]:
        """
        Get list of houses aspected by a planet
        
        Args:
            planet: Planet name
            planet_house: House where planet is placed (1-12)
            include_partial: Include partial aspects
        
        Returns:
            List of dicts with house number and aspect strength
        """
        aspected = []
        full_aspects = cls.FULL_ASPECTS.get(planet, [7])
        
        for aspect in full_aspects:
            target_house = ((planet_house - 1 + aspect) % 12) + 1
            aspected.append({
                'house': target_house,
                'strength': 100.0,
                'type': 'full'
            })
        
        if include_partial:
            for house_dist, strength in cls.PARTIAL_ASPECTS.items():
                if house_dist not in full_aspects:
                    target_house = ((planet_house - 1 + house_dist) % 12) + 1
                    aspected.append({
                        'house': target_house,
                        'strength': strength,
                        'type': 'partial'
                    })
        
        return sorted(aspected, key=lambda x: x['house'])
    
    @classmethod
    def get_rashis_aspected(cls, planet: str, planet_rashi: int,
                           include_partial: bool = False) -> List[Dict]:
        """
        Get list of rashis aspected by a planet
        
        Args:
            planet: Planet name
            planet_rashi: Rashi where planet is placed (0-11)
            include_partial: Include partial aspects
        
        Returns:
            List of dicts with rashi index, name and aspect strength
        """
        aspected = []
        full_aspects = cls.FULL_ASPECTS.get(planet, [7])
        
        for aspect in full_aspects:
            target_rashi = (planet_rashi + aspect) % 12
            aspected.append({
                'rashi': target_rashi,
                'rashi_name': RASHI_NAMES[target_rashi],
                'strength': 100.0,
                'type': 'full'
            })
        
        if include_partial:
            for house_dist, strength in cls.PARTIAL_ASPECTS.items():
                if house_dist not in full_aspects:
                    target_rashi = (planet_rashi + house_dist) % 12
                    aspected.append({
                        'rashi': target_rashi,
                        'rashi_name': RASHI_NAMES[target_rashi],
                        'strength': strength,
                        'type': 'partial'
                    })
        
        return sorted(aspected, key=lambda x: x['rashi'])
    
    @classmethod
    def is_planet_aspected_by(cls, target_planet_house: int, 
                              aspecting_planet: str, 
                              aspecting_planet_house: int) -> Tuple[bool, float]:
        """
        Check if target planet is aspected by another planet
        
        Returns:
            Tuple of (is_aspected, strength)
        """
        house_distance = ((target_planet_house - aspecting_planet_house) % 12)
        if house_distance == 0:
            house_distance = 12
        
        # Check from aspecting planet's perspective
        aspect_distance = ((target_planet_house - aspecting_planet_house - 1) % 12) + 1
        
        full_aspects = cls.FULL_ASPECTS.get(aspecting_planet, [7])
        
        if aspect_distance in full_aspects:
            return (True, 100.0)
        
        partial = cls.PARTIAL_ASPECTS.get(aspect_distance, 0)
        if partial > 0:
            return (True, partial)
        
        return (False, 0.0)
    
    @classmethod
    def get_all_aspects_on_house(cls, house: int, planets: Dict) -> List[Dict]:
        """
        Get all planetary aspects falling on a specific house
        
        Args:
            house: Target house (1-12)
            planets: Dict of planets with their house positions
        
        Returns:
            List of aspects with planet name and strength
        """
        aspects = []
        
        for planet_name, planet_data in planets.items():
            planet_house = planet_data.get('house', 1)
            
            is_aspected, strength = cls.is_planet_aspected_by(
                house, planet_name, planet_house
            )
            
            if is_aspected:
                aspects.append({
                    'planet': planet_name,
                    'from_house': planet_house,
                    'strength': strength,
                    'type': 'full' if strength == 100 else 'partial',
                    'nature': PLANETS.get(planet_name, {}).get('nature', 'Neutral'),
                })
        
        return aspects
    
    @classmethod
    def get_all_aspects_on_planet(cls, target_planet: str, target_house: int,
                                  planets: Dict) -> List[Dict]:
        """
        Get all aspects falling on a specific planet
        
        Args:
            target_planet: Name of target planet
            target_house: House of target planet
            planets: Dict of all planets with their house positions
        
        Returns:
            List of aspects with planet name and strength
        """
        aspects = []
        
        for planet_name, planet_data in planets.items():
            if planet_name == target_planet:
                continue
            
            planet_house = planet_data.get('house', 1)
            
            is_aspected, strength = cls.is_planet_aspected_by(
                target_house, planet_name, planet_house
            )
            
            if is_aspected:
                aspects.append({
                    'aspecting_planet': planet_name,
                    'from_house': planet_house,
                    'strength': strength,
                    'type': 'full' if strength == 100 else 'partial',
                    'nature': PLANETS.get(planet_name, {}).get('nature', 'Neutral'),
                })
        
        return aspects
    
    @classmethod
    def calculate_aspect_strength_score(cls, aspects: List[Dict]) -> Dict:
        """
        Calculate net aspect strength on a house or planet
        
        Args:
            aspects: List of aspects from get_all_aspects_on_house/planet
        
        Returns:
            Dict with benefic/malefic scores and net result
        """
        benefic_score = 0
        malefic_score = 0
        
        for aspect in aspects:
            strength = aspect.get('strength', 0) / 100
            nature = aspect.get('nature', 'Neutral')
            
            if nature == 'Benefic':
                benefic_score += strength
            elif nature == 'Malefic':
                malefic_score += strength
        
        return {
            'benefic_aspects': round(benefic_score, 2),
            'malefic_aspects': round(malefic_score, 2),
            'net_score': round(benefic_score - malefic_score, 2),
            'predominant': 'Benefic' if benefic_score > malefic_score else 
                          'Malefic' if malefic_score > benefic_score else 'Neutral',
        }
    
    @classmethod
    def generate_aspect_table(cls, planets: Dict) -> Dict:
        """
        Generate complete aspect table for all planets
        
        Args:
            planets: Dict of planets with house positions
        
        Returns:
            Matrix showing which planet aspects which
        """
        planet_names = list(planets.keys())
        aspect_table = {}
        
        for planet_name in planet_names:
            planet_house = planets[planet_name].get('house', 1)
            aspect_table[planet_name] = {
                'aspects_houses': [],
                'aspects_planets': [],
                'aspected_by': [],
            }
            
            # Houses aspected
            aspect_table[planet_name]['aspects_houses'] = cls.get_houses_aspected(
                planet_name, planet_house
            )
            
            # Planets aspected
            for other_planet in planet_names:
                if other_planet == planet_name:
                    continue
                other_house = planets[other_planet].get('house', 1)
                is_aspected, strength = cls.is_planet_aspected_by(
                    other_house, planet_name, planet_house
                )
                if is_aspected:
                    aspect_table[planet_name]['aspects_planets'].append({
                        'planet': other_planet,
                        'strength': strength,
                    })
            
            # Aspected by
            aspect_table[planet_name]['aspected_by'] = cls.get_all_aspects_on_planet(
                planet_name, planet_house, planets
            )
        
        return aspect_table
    
    @classmethod
    def get_mutual_aspects(cls, planets: Dict) -> List[Dict]:
        """
        Find all mutual aspects between planets
        
        Returns:
            List of mutual aspect pairs
        """
        mutual = []
        planet_names = list(planets.keys())
        
        for i, p1 in enumerate(planet_names):
            for p2 in planet_names[i+1:]:
                h1 = planets[p1].get('house', 1)
                h2 = planets[p2].get('house', 1)
                
                # Check if p1 aspects p2
                p1_aspects_p2, str1 = cls.is_planet_aspected_by(h2, p1, h1)
                # Check if p2 aspects p1
                p2_aspects_p1, str2 = cls.is_planet_aspected_by(h1, p2, h2)
                
                if p1_aspects_p2 and p2_aspects_p1:
                    mutual.append({
                        'planet1': p1,
                        'planet2': p2,
                        'planet1_strength': str1,
                        'planet2_strength': str2,
                        'combined_strength': (str1 + str2) / 2,
                        'significance': cls._get_mutual_aspect_significance(p1, p2),
                    })
        
        return mutual
    
    @classmethod
    def _get_mutual_aspect_significance(cls, p1: str, p2: str) -> str:
        """Get significance of mutual aspect between two planets"""
        nature1 = PLANETS.get(p1, {}).get('nature', 'Neutral')
        nature2 = PLANETS.get(p2, {}).get('nature', 'Neutral')
        
        if nature1 == 'Benefic' and nature2 == 'Benefic':
            return 'Highly Auspicious - mutual benefic exchange'
        elif nature1 == 'Malefic' and nature2 == 'Malefic':
            return 'Challenging - mutual malefic pressure'
        else:
            return 'Mixed - balancing influences'


# Rashi Drishti (Sign aspects - used in Jaimini)
class RashiAspects:
    """
    Calculate Rashi Drishti (Sign-based aspects)
    Used in Jaimini astrology
    
    Rules:
    - Movable signs aspect Fixed signs (except adjacent)
    - Fixed signs aspect Movable signs (except adjacent)
    - Dual signs aspect each other
    """
    
    @classmethod
    def get_rashi_aspect(cls, rashi1: int, rashi2: int) -> bool:
        """
        Check if rashi1 aspects rashi2 (Jaimini)
        """
        quality1 = RASHIS[rashi1]['quality']
        quality2 = RASHIS[rashi2]['quality']
        
        # Adjacent signs don't aspect each other
        if abs(rashi1 - rashi2) == 1 or abs(rashi1 - rashi2) == 11:
            return False
        
        # Same sign doesn't aspect itself
        if rashi1 == rashi2:
            return False
        
        # Movable aspects Fixed (except adjacent)
        if quality1 == 'Movable' and quality2 == 'Fixed':
            return True
        
        # Fixed aspects Movable (except adjacent)
        if quality1 == 'Fixed' and quality2 == 'Movable':
            return True
        
        # Dual aspects Dual
        if quality1 == 'Dual' and quality2 == 'Dual':
            return True
        
        return False
    
    @classmethod
    def get_rashis_aspected_by_rashi(cls, rashi: int) -> List[int]:
        """Get all rashis aspected by given rashi"""
        aspected = []
        for i in range(12):
            if cls.get_rashi_aspect(rashi, i):
                aspected.append(i)
        return aspected


# Convenience functions
def get_aspects(planet: str) -> List[int]:
    """Get list of houses aspected by planet"""
    return PlanetaryAspects.FULL_ASPECTS.get(planet, [7])

def aspects_house(planet: str, from_house: int, to_house: int) -> bool:
    """Check if planet aspects a house from its position"""
    distance = ((to_house - from_house - 1) % 12) + 1
    return distance in PlanetaryAspects.FULL_ASPECTS.get(planet, [7])
