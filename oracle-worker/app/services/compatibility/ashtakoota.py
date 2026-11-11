"""
JYOTISH ENGINE - ASHTAKOOTA COMPATIBILITY
36-point marriage matching system
"""

from typing import Dict
from ..core.constants import (
    NAKSHATRA_NAMES, RASHI_NAMES,
    RASHI_VARNA, NAKSHATRA_GANA, NAKSHATRA_YONI
)
from ..core.utils import get_nakshatra_from_longitude, get_rashi_from_longitude


class AshtakootaMatch:
    """
    Calculate Ashtakoota (8-fold) compatibility
    
    8 Kootas:
    1. Varna (1 point) - Spiritual compatibility
    2. Vashya (2 points) - Mutual attraction/control
    3. Tara (3 points) - Destiny/luck
    4. Yoni (4 points) - Sexual compatibility
    5. Graha Maitri (5 points) - Mental compatibility
    6. Gana (6 points) - Temperament
    7. Bhakoot (7 points) - Love and family
    8. Nadi (8 points) - Health and genes
    
    Total: 36 points
    Minimum recommended: 18 points
    """
    
    # Vashya groups
    VASHYA_GROUPS = {
        'Manava': [2, 5, 8, 11],  # Gemini, Virgo, Sagittarius, Pisces (Human)
        'Vanachara': [0, 4, 8],    # Aries, Leo, Sagittarius (Wild)
        'Chatushpada': [1, 9, 10], # Taurus, Capricorn, Aquarius (Quadruped)
        'Jalchar': [3, 7, 11],     # Cancer, Scorpio, Pisces (Water)
        'Keet': [7],               # Scorpio (Insect)
    }
    
    # Yoni compatibility matrix
    YONI_ENEMIES = {
        'Horse': 'Buffalo',
        'Buffalo': 'Horse',
        'Elephant': 'Lion',
        'Lion': 'Elephant',
        'Dog': 'Deer',
        'Deer': 'Dog',
        'Cat': 'Rat',
        'Rat': 'Cat',
        'Serpent': 'Mongoose',
        'Mongoose': 'Serpent',
        'Monkey': 'Goat',
        'Goat': 'Monkey',
        'Cow': 'Tiger',
        'Tiger': 'Cow',
    }
    
    # Nadi types
    NAKSHATRA_NADI = {
        0: 'Vata', 1: 'Pitta', 2: 'Kapha',
        3: 'Kapha', 4: 'Pitta', 5: 'Vata',
        6: 'Vata', 7: 'Pitta', 8: 'Kapha',
        9: 'Kapha', 10: 'Pitta', 11: 'Vata',
        12: 'Vata', 13: 'Pitta', 14: 'Kapha',
        15: 'Kapha', 16: 'Pitta', 17: 'Vata',
        18: 'Vata', 19: 'Pitta', 20: 'Kapha',
        21: 'Kapha', 22: 'Pitta', 23: 'Vata',
        24: 'Vata', 25: 'Pitta', 26: 'Kapha',
    }
    
    def __init__(self, boy_moon_long: float, girl_moon_long: float):
        """
        Initialize with Moon positions
        
        Args:
            boy_moon_long: Boy's Moon longitude (0-360)
            girl_moon_long: Girl's Moon longitude (0-360)
        """
        self.boy_moon = boy_moon_long
        self.girl_moon = girl_moon_long
        
        # Calculate nakshatra and rashi
        self.boy_nakshatra = get_nakshatra_from_longitude(boy_moon_long)
        self.girl_nakshatra = get_nakshatra_from_longitude(girl_moon_long)
        self.boy_rashi = get_rashi_from_longitude(boy_moon_long)
        self.girl_rashi = get_rashi_from_longitude(girl_moon_long)
    
    def calculate_varna(self) -> Dict:
        """
        1. Varna Koota (1 point)
        Spiritual/ego compatibility
        Boy's varna should be >= Girl's varna
        
        Varna order: Brahmin > Kshatriya > Vaishya > Shudra
        """
        varna_order = {'Brahmin': 4, 'Kshatriya': 3, 'Vaishya': 2, 'Shudra': 1}
        
        boy_varna = RASHI_VARNA.get(self.boy_rashi, 'Shudra')
        girl_varna = RASHI_VARNA.get(self.girl_rashi, 'Shudra')
        
        boy_score = varna_order[boy_varna]
        girl_score = varna_order[girl_varna]
        
        points = 1 if boy_score >= girl_score else 0
        
        return {
            'koota': 'Varna',
            'max_points': 1,
            'points': points,
            'boy_varna': boy_varna,
            'girl_varna': girl_varna,
            'description': 'Spiritual compatibility' if points == 1 else 'Varna mismatch',
        }
    
    def calculate_vashya(self) -> Dict:
        """
        2. Vashya Koota (2 points)
        Mutual attraction and control
        """
        def get_vashya_type(rashi):
            for vtype, rashis in self.VASHYA_GROUPS.items():
                if rashi in rashis:
                    return vtype
            return 'Manava'
        
        boy_vashya = get_vashya_type(self.boy_rashi)
        girl_vashya = get_vashya_type(self.girl_rashi)
        
        # Same vashya = 2 points
        if boy_vashya == girl_vashya:
            points = 2
        # One controls other = 1 point
        elif (boy_vashya == 'Manava' and girl_vashya in ['Chatushpada', 'Vanachara']) or \
             (girl_vashya == 'Manava' and boy_vashya in ['Chatushpada', 'Vanachara']):
            points = 1
        # Same rashi = 2 points
        elif self.boy_rashi == self.girl_rashi:
            points = 2
        else:
            points = 0.5
        
        return {
            'koota': 'Vashya',
            'max_points': 2,
            'points': points,
            'boy_vashya': boy_vashya,
            'girl_vashya': girl_vashya,
            'description': 'Good mutual attraction' if points >= 1.5 else 'Moderate attraction',
        }
    
    def calculate_tara(self) -> Dict:
        """
        3. Tara Koota (3 points)
        Destiny and luck compatibility
        Based on nakshatra distance
        """
        # Count from girl's nakshatra to boy's
        distance = ((self.boy_nakshatra - self.girl_nakshatra) % 27) + 1
        
        # Tara cycle repeats every 9 nakshatras
        tara_position = ((distance - 1) % 9) + 1
        
        # Auspicious taras: 1, 3, 5, 7 (Janma, Vipat, Pratyak, Mitra)
        # Inauspicious: 2, 4, 6, 8, 9 (Sampat, Kshema, Sadhana, Vadha, Param Mitra)
        # Actually: 2, 4, 6, 8, 9 are good; 3, 5, 7 are bad
        
        if tara_position in [1, 3, 5, 7]:
            points = 0
            is_good = False
        else:
            points = 3
            is_good = True
        
        # If both ways are checked, average
        distance_rev = ((self.girl_nakshatra - self.boy_nakshatra) % 27) + 1
        tara_position_rev = ((distance_rev - 1) % 9) + 1
        
        if tara_position_rev in [2, 4, 6, 8, 9]:
            points = 3 if points == 3 else 1.5
        
        return {
            'koota': 'Tara',
            'max_points': 3,
            'points': points,
            'boy_to_girl_tara': tara_position,
            'girl_to_boy_tara': tara_position_rev,
            'description': 'Favorable destiny' if points >= 2 else 'Some challenges in destiny',
        }
    
    def calculate_yoni(self) -> Dict:
        """
        4. Yoni Koota (4 points)
        Sexual/physical compatibility
        Based on animal symbols of nakshatras
        """
        boy_yoni = NAKSHATRA_YONI.get(self.boy_nakshatra, ('Horse', 'Male'))
        girl_yoni = NAKSHATRA_YONI.get(self.girl_nakshatra, ('Horse', 'Female'))
        
        boy_animal = boy_yoni[0]
        girl_animal = girl_yoni[0]
        boy_gender = boy_yoni[1]
        girl_gender = girl_yoni[1]
        
        # Same animal = 4 points
        if boy_animal == girl_animal:
            points = 4
            desc = 'Excellent physical compatibility'
        # Enemy animals = 0 points
        elif self.YONI_ENEMIES.get(boy_animal) == girl_animal:
            points = 0
            desc = 'Challenging physical compatibility'
        # Same gender = 2 points
        elif boy_gender == girl_gender:
            points = 2
            desc = 'Moderate compatibility'
        # Different animals, different gender = 3 points
        else:
            points = 3
            desc = 'Good compatibility'
        
        return {
            'koota': 'Yoni',
            'max_points': 4,
            'points': points,
            'boy_yoni': f"{boy_animal} ({boy_gender})",
            'girl_yoni': f"{girl_animal} ({girl_gender})",
            'description': desc,
        }
    
    def calculate_graha_maitri(self) -> Dict:
        """
        5. Graha Maitri (5 points)
        Mental and intellectual compatibility
        Based on Moon sign lords' friendship
        """
        from ..core.constants import RASHI_LORDS, PLANETS
        
        boy_lord = RASHI_LORDS[self.boy_rashi]
        girl_lord = RASHI_LORDS[self.girl_rashi]
        
        # Check friendship
        boy_friends = PLANETS.get(boy_lord, {}).get('friends', [])
        boy_enemies = PLANETS.get(boy_lord, {}).get('enemies', [])
        girl_friends = PLANETS.get(girl_lord, {}).get('friends', [])
        girl_enemies = PLANETS.get(girl_lord, {}).get('enemies', [])
        
        # Same lord = 5 points
        if boy_lord == girl_lord:
            points = 5
            relation = 'Same'
        # Mutual friends = 5 points
        elif girl_lord in boy_friends and boy_lord in girl_friends:
            points = 5
            relation = 'Mutual Friends'
        # One friend, one neutral = 4 points
        elif girl_lord in boy_friends or boy_lord in girl_friends:
            points = 4
            relation = 'Friendly'
        # Both neutral = 3 points
        elif girl_lord not in boy_enemies and boy_lord not in girl_enemies:
            points = 3
            relation = 'Neutral'
        # One enemy = 1 point
        elif girl_lord in boy_enemies or boy_lord in girl_enemies:
            points = 1
            relation = 'One Enemy'
        # Mutual enemies = 0 points
        else:
            points = 0
            relation = 'Mutual Enemies'
        
        return {
            'koota': 'Graha Maitri',
            'max_points': 5,
            'points': points,
            'boy_lord': boy_lord,
            'girl_lord': girl_lord,
            'relationship': relation,
            'description': 'Good mental compatibility' if points >= 3 else 'Mental differences',
        }
    
    def calculate_gana(self) -> Dict:
        """
        6. Gana Koota (6 points)
        Temperament compatibility
        Deva (divine), Manushya (human), Rakshasa (demon)
        """
        boy_gana = NAKSHATRA_GANA.get(self.boy_nakshatra, 'Manushya')
        girl_gana = NAKSHATRA_GANA.get(self.girl_nakshatra, 'Manushya')
        
        # Same gana = 6 points
        if boy_gana == girl_gana:
            points = 6
        # Deva-Manushya = 5 points
        elif {boy_gana, girl_gana} == {'Deva', 'Manushya'}:
            points = 5
        # Manushya-Rakshasa = 1 point
        elif {boy_gana, girl_gana} == {'Manushya', 'Rakshasa'}:
            points = 1
        # Deva-Rakshasa = 0 points
        else:
            points = 0
        
        return {
            'koota': 'Gana',
            'max_points': 6,
            'points': points,
            'boy_gana': boy_gana,
            'girl_gana': girl_gana,
            'description': 'Compatible temperaments' if points >= 4 else 'Temperament differences',
        }
    
    def calculate_bhakoot(self) -> Dict:
        """
        7. Bhakoot Koota (7 points)
        Love, family welfare, finances
        Based on Moon sign positions from each other
        """
        # Distance from boy to girl
        distance = ((self.girl_rashi - self.boy_rashi) % 12) + 1
        
        # Inauspicious combinations (Bhakoot Dosha)
        # 2/12, 5/9, 6/8 are bad
        bad_combinations = [
            (2, 12), (12, 2),
            (5, 9), (9, 5),
            (6, 8), (8, 6),
        ]
        
        reverse_distance = ((self.boy_rashi - self.girl_rashi) % 12) + 1
        
        if (distance, reverse_distance) in bad_combinations or \
           (reverse_distance, distance) in bad_combinations:
            points = 0
            has_dosha = True
        else:
            points = 7
            has_dosha = False
        
        return {
            'koota': 'Bhakoot',
            'max_points': 7,
            'points': points,
            'boy_to_girl': distance,
            'girl_to_boy': reverse_distance,
            'has_dosha': has_dosha,
            'description': 'Good for family life' if points == 7 else 'Bhakoot Dosha present',
        }
    
    def calculate_nadi(self) -> Dict:
        """
        8. Nadi Koota (8 points) - Most important
        Health and genetic compatibility
        Same Nadi = Nadi Dosha (serious)
        """
        boy_nadi = self.NAKSHATRA_NADI.get(self.boy_nakshatra, 'Vata')
        girl_nadi = self.NAKSHATRA_NADI.get(self.girl_nakshatra, 'Vata')
        
        # Same Nadi = 0 points (Nadi Dosha)
        if boy_nadi == girl_nadi:
            points = 0
            has_dosha = True
            desc = 'Nadi Dosha - Same Nadi is inauspicious for progeny'
        else:
            points = 8
            has_dosha = False
            desc = 'Different Nadi - Good for health and progeny'
        
        return {
            'koota': 'Nadi',
            'max_points': 8,
            'points': points,
            'boy_nadi': boy_nadi,
            'girl_nadi': girl_nadi,
            'has_dosha': has_dosha,
            'description': desc,
        }
    
    def calculate_total(self) -> Dict:
        """
        Calculate all 8 kootas and total score
        """
        varna = self.calculate_varna()
        vashya = self.calculate_vashya()
        tara = self.calculate_tara()
        yoni = self.calculate_yoni()
        graha_maitri = self.calculate_graha_maitri()
        gana = self.calculate_gana()
        bhakoot = self.calculate_bhakoot()
        nadi = self.calculate_nadi()
        
        total_points = (
            varna['points'] + vashya['points'] + tara['points'] +
            yoni['points'] + graha_maitri['points'] + gana['points'] +
            bhakoot['points'] + nadi['points']
        )
        
        # Determine compatibility level
        if total_points >= 28:
            compatibility = 'Excellent'
            recommendation = 'Highly recommended for marriage'
        elif total_points >= 21:
            compatibility = 'Good'
            recommendation = 'Good match, recommended'
        elif total_points >= 18:
            compatibility = 'Average'
            recommendation = 'Acceptable with some remedies'
        elif total_points >= 14:
            compatibility = 'Below Average'
            recommendation = 'Not recommended without remedies'
        else:
            compatibility = 'Poor'
            recommendation = 'Not recommended'
        
        # Check for major doshas
        doshas = []
        if nadi['has_dosha']:
            doshas.append('Nadi Dosha')
        if bhakoot['has_dosha']:
            doshas.append('Bhakoot Dosha')
        if gana['points'] == 0:
            doshas.append('Gana Dosha')
        
        return {
            'boy': {
                'moon_nakshatra': NAKSHATRA_NAMES[self.boy_nakshatra],
                'moon_rashi': RASHI_NAMES[self.boy_rashi],
            },
            'girl': {
                'moon_nakshatra': NAKSHATRA_NAMES[self.girl_nakshatra],
                'moon_rashi': RASHI_NAMES[self.girl_rashi],
            },
            'kootas': {
                'varna': varna,
                'vashya': vashya,
                'tara': tara,
                'yoni': yoni,
                'graha_maitri': graha_maitri,
                'gana': gana,
                'bhakoot': bhakoot,
                'nadi': nadi,
            },
            'total_points': round(total_points, 1),
            'max_points': 36,
            'percentage': round((total_points / 36) * 100, 1),
            'compatibility': compatibility,
            'recommendation': recommendation,
            'doshas': doshas,
            'has_major_dosha': len(doshas) > 0,
        }


# Convenience function
def calculate_compatibility(boy_moon: float, girl_moon: float) -> Dict:
    """Quick function to calculate marriage compatibility"""
    calculator = AshtakootaMatch(boy_moon, girl_moon)
    return calculator.calculate_total()
