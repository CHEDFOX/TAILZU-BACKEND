"""
JYOTISH ENGINE - DIVISIONAL CHARTS (VARGAS)
D1 to D60 calculations
"""

from typing import Dict
from ..core.constants import RASHIS, RASHI_NAMES, DIVISIONAL_CHARTS
from ..core.utils import get_rashi_from_longitude


class DivisionalCharts:
    """
    Calculate all 16 main divisional charts (Shodasavarga)
    """
    
    @staticmethod
    def calculate_d1(longitude: float) -> int:
        """D1 - Rashi Chart (Birth Chart)"""
        return get_rashi_from_longitude(longitude)
    
    @staticmethod
    def calculate_d2(longitude: float) -> int:
        """
        D2 - Hora Chart (Wealth)
        First 15° = Sun's hora (Leo), Last 15° = Moon's hora (Cancer)
        For odd signs: 0-15° Leo, 15-30° Cancer
        For even signs: 0-15° Cancer, 15-30° Leo
        """
        sign = int(longitude / 30)
        degree = longitude % 30
        
        if sign % 2 == 0:  # Odd signs (Aries=0 is odd in Vedic)
            return 4 if degree < 15 else 3  # Leo or Cancer
        else:  # Even signs
            return 3 if degree < 15 else 4  # Cancer or Leo
    
    @staticmethod
    def calculate_d3(longitude: float) -> int:
        """
        D3 - Drekkana Chart (Siblings, Courage)
        Each sign divided into 3 parts of 10°
        1st Drekkana: Same sign
        2nd Drekkana: 5th from sign
        3rd Drekkana: 9th from sign
        """
        sign = int(longitude / 30)
        degree = longitude % 30
        
        if degree < 10:
            return sign
        elif degree < 20:
            return (sign + 4) % 12
        else:
            return (sign + 8) % 12
    
    @staticmethod
    def calculate_d4(longitude: float) -> int:
        """
        D4 - Chaturthamsa Chart (Fortune, Property)
        Each sign divided into 4 parts of 7.5°
        """
        sign = int(longitude / 30)
        degree = longitude % 30
        part = int(degree / 7.5)
        
        if sign % 2 == 0:  # Odd signs
            return (sign + part * 3) % 12
        else:  # Even signs
            return (sign + 9 + part * 3) % 12
    
    @staticmethod
    def calculate_d5(longitude: float) -> int:
        """
        D5 - Panchamsa (Spiritual Inclination)
        Each sign divided into 5 parts of 6°
        """
        sign = int(longitude / 30)
        degree = longitude % 30
        part = int(degree / 6)
        
        # Movable signs start from Aries
        # Fixed signs start from Sagittarius
        # Dual signs start from Leo
        quality = RASHIS[sign]['quality']
        
        if quality == 'Movable':
            return (0 + part) % 12  # Start from Aries
        elif quality == 'Fixed':
            return (8 + part) % 12  # Start from Sagittarius
        else:  # Dual
            return (4 + part) % 12  # Start from Leo
    
    @staticmethod
    def calculate_d6(longitude: float) -> int:
        """
        D6 - Shashthamsa (Health)
        Each sign divided into 6 parts of 5°
        """
        sign = int(longitude / 30)
        degree = longitude % 30
        part = int(degree / 5)
        
        if sign % 2 == 0:  # Odd signs
            return part % 12
        else:  # Even signs
            return (6 + part) % 12
    
    @staticmethod
    def calculate_d7(longitude: float) -> int:
        """
        D7 - Saptamsa Chart (Children, Progeny)
        Each sign divided into 7 parts of 4°17'8.57"
        """
        sign = int(longitude / 30)
        degree = longitude % 30
        part = int(degree / (30/7))
        
        if sign % 2 == 0:  # Odd signs - start from same sign
            return (sign + part) % 12
        else:  # Even signs - start from 7th sign
            return (sign + 6 + part) % 12
    
    @staticmethod
    def calculate_d8(longitude: float) -> int:
        """
        D8 - Ashtamsa (Longevity)
        Each sign divided into 8 parts of 3°45'
        """
        sign = int(longitude / 30)
        degree = longitude % 30
        part = int(degree / 3.75)
        
        # Movable: start from Aries
        # Fixed: start from Sagittarius
        # Dual: start from Leo
        quality = RASHIS[sign]['quality']
        
        if quality == 'Movable':
            return part % 12
        elif quality == 'Fixed':
            return (8 + part) % 12
        else:
            return (4 + part) % 12
    
    @staticmethod
    def calculate_d9(longitude: float) -> int:
        """
        D9 - Navamsa Chart (Spouse, Dharma, Soul)
        Most important divisional chart
        Each sign divided into 9 parts of 3°20'
        """
        # Each navamsa = 3.333... degrees
        navamsa_num = int(longitude / 3.333333) % 108
        return navamsa_num % 12
    
    @staticmethod
    def calculate_d10(longitude: float) -> int:
        """
        D10 - Dasamsa Chart (Career, Profession)
        Each sign divided into 10 parts of 3°
        """
        sign = int(longitude / 30)
        degree = longitude % 30
        part = int(degree / 3)
        
        if sign % 2 == 0:  # Odd signs - start from same sign
            return (sign + part) % 12
        else:  # Even signs - start from 9th sign
            return (sign + 8 + part) % 12
    
    @staticmethod
    def calculate_d11(longitude: float) -> int:
        """
        D11 - Ekadasamsa (Gains)
        Each sign divided into 11 parts of 2°43'38"
        """
        sign = int(longitude / 30)
        degree = longitude % 30
        part = int(degree / (30/11))
        
        if sign % 2 == 0:  # Odd signs
            return (sign + part) % 12
        else:
            return (sign + 6 + part) % 12
    
    @staticmethod
    def calculate_d12(longitude: float) -> int:
        """
        D12 - Dwadasamsa Chart (Parents)
        Each sign divided into 12 parts of 2°30'
        """
        sign = int(longitude / 30)
        degree = longitude % 30
        part = int(degree / 2.5)
        
        return (sign + part) % 12
    
    @staticmethod
    def calculate_d16(longitude: float) -> int:
        """
        D16 - Shodasamsa Chart (Vehicles, Luxuries, Happiness)
        Each sign divided into 16 parts of 1°52'30"
        """
        sign = int(longitude / 30)
        degree = longitude % 30
        part = int(degree / 1.875)
        
        # Movable: Aries, Fixed: Leo, Dual: Sagittarius
        quality = RASHIS[sign]['quality']
        
        if quality == 'Movable':
            return part % 12
        elif quality == 'Fixed':
            return (4 + part) % 12
        else:
            return (8 + part) % 12
    
    @staticmethod
    def calculate_d20(longitude: float) -> int:
        """
        D20 - Vimsamsa Chart (Spiritual Progress)
        Each sign divided into 20 parts of 1°30'
        """
        sign = int(longitude / 30)
        degree = longitude % 30
        part = int(degree / 1.5)
        
        # Movable: Aries, Fixed: Sagittarius, Dual: Leo
        quality = RASHIS[sign]['quality']
        
        if quality == 'Movable':
            return part % 12
        elif quality == 'Fixed':
            return (8 + part) % 12
        else:
            return (4 + part) % 12
    
    @staticmethod
    def calculate_d24(longitude: float) -> int:
        """
        D24 - Chaturvimsamsa Chart (Education, Learning)
        Each sign divided into 24 parts of 1°15'
        """
        sign = int(longitude / 30)
        degree = longitude % 30
        part = int(degree / 1.25)
        
        if sign % 2 == 0:  # Odd signs - start from Leo
            return (4 + part) % 12
        else:  # Even signs - start from Cancer
            return (3 + part) % 12
    
    @staticmethod
    def calculate_d27(longitude: float) -> int:
        """
        D27 - Bhamsa/Nakshatramsa Chart (Strength, Weakness)
        Each sign divided into 27 parts of 1°6'40"
        """
        sign = int(longitude / 30)
        degree = longitude % 30
        part = int(degree / (30/27))
        
        element = RASHIS[sign]['element']
        
        if element == 'Fire':
            return part % 12
        elif element == 'Earth':
            return (3 + part) % 12
        elif element == 'Air':
            return (6 + part) % 12
        else:  # Water
            return (9 + part) % 12
    
    @staticmethod
    def calculate_d30(longitude: float) -> int:
        """
        D30 - Trimsamsa Chart (Misfortunes, Evils)
        Different calculation for odd and even signs
        """
        sign = int(longitude / 30)
        degree = longitude % 30
        
        if sign % 2 == 0:  # Odd signs
            if degree < 5:
                return 0  # Aries (Mars)
            elif degree < 10:
                return 10  # Aquarius (Saturn)
            elif degree < 18:
                return 8  # Sagittarius (Jupiter)
            elif degree < 25:
                return 2  # Gemini (Mercury)
            else:
                return 6  # Libra (Venus)
        else:  # Even signs (reversed)
            if degree < 5:
                return 1  # Taurus (Venus)
            elif degree < 12:
                return 5  # Virgo (Mercury)
            elif degree < 20:
                return 11  # Pisces (Jupiter)
            elif degree < 25:
                return 9  # Capricorn (Saturn)
            else:
                return 7  # Scorpio (Mars)
    
    @staticmethod
    def calculate_d40(longitude: float) -> int:
        """
        D40 - Khavedamsa Chart (Auspicious/Inauspicious Effects)
        Each sign divided into 40 parts of 0°45'
        """
        sign = int(longitude / 30)
        degree = longitude % 30
        part = int(degree / 0.75)
        
        if sign % 2 == 0:  # Odd signs - start from Aries
            return part % 12
        else:  # Even signs - start from Libra
            return (6 + part) % 12
    
    @staticmethod
    def calculate_d45(longitude: float) -> int:
        """
        D45 - Akshavedamsa Chart (General Indications)
        Each sign divided into 45 parts of 0°40'
        """
        sign = int(longitude / 30)
        degree = longitude % 30
        part = int(degree / (30/45))
        
        # Movable: Aries, Fixed: Leo, Dual: Sagittarius
        quality = RASHIS[sign]['quality']
        
        if quality == 'Movable':
            return part % 12
        elif quality == 'Fixed':
            return (4 + part) % 12
        else:
            return (8 + part) % 12
    
    @staticmethod
    def calculate_d60(longitude: float) -> int:
        """
        D60 - Shashtiamsa Chart (Past Karma, Root Cause)
        Most subtle divisional chart
        Each sign divided into 60 parts of 0°30'
        """
        sign = int(longitude / 30)
        degree = longitude % 30
        part = int(degree / 0.5)
        
        return (sign + part) % 12
    
    @classmethod
    def calculate_division(cls, longitude: float, division: int) -> int:
        """
        Calculate any divisional chart position
        """
        methods = {
            1: cls.calculate_d1,
            2: cls.calculate_d2,
            3: cls.calculate_d3,
            4: cls.calculate_d4,
            5: cls.calculate_d5,
            6: cls.calculate_d6,
            7: cls.calculate_d7,
            8: cls.calculate_d8,
            9: cls.calculate_d9,
            10: cls.calculate_d10,
            11: cls.calculate_d11,
            12: cls.calculate_d12,
            16: cls.calculate_d16,
            20: cls.calculate_d20,
            24: cls.calculate_d24,
            27: cls.calculate_d27,
            30: cls.calculate_d30,
            40: cls.calculate_d40,
            45: cls.calculate_d45,
            60: cls.calculate_d60,
        }
        
        method = methods.get(division)
        if method:
            return method(longitude)
        else:
            # Generic calculation for unsupported divisions
            degree_in_sign = longitude % 30
            part = int(degree_in_sign / (30 / division))
            return (int(longitude / 30) + part) % 12
    
    @classmethod
    def generate_divisional_chart(cls, planets: Dict, division: int) -> Dict:
        """
        Generate complete divisional chart for all planets
        
        Args:
            planets: Dict of planet positions with 'longitude' key
            division: Divisional chart number (1-60)
        
        Returns:
            Dict with planet positions in that division
        """
        chart = {
            'division': division,
            'name': DIVISIONAL_CHARTS.get(f'D{division}', {}).get('name', f'D{division}'),
            'purpose': DIVISIONAL_CHARTS.get(f'D{division}', {}).get('purpose', ''),
            'planets': {}
        }
        
        for planet_name, planet_data in planets.items():
            longitude = planet_data.get('longitude', 0)
            div_rashi = cls.calculate_division(longitude, division)
            
            chart['planets'][planet_name] = {
                'rashi': div_rashi,
                'rashi_name': RASHI_NAMES[div_rashi],
                'original_longitude': longitude,
            }
        
        return chart
    
    @classmethod
    def generate_all_vargas(cls, planets: Dict) -> Dict[str, Dict]:
        """
        Generate all 16 main divisional charts (Shodasavarga)
        """
        divisions = [1, 2, 3, 4, 7, 9, 10, 12, 16, 20, 24, 27, 30, 40, 45, 60]
        
        vargas = {}
        for div in divisions:
            chart_name = f'D{div}'
            vargas[chart_name] = cls.generate_divisional_chart(planets, div)
        
        return vargas
    
    @classmethod
    def get_varga_vimshopaka(cls, planets: Dict) -> Dict[str, float]:
        """
        Calculate Vimshopaka Bala (20-point strength) based on divisional positions
        Uses Shadvarga (6 charts) or Shodasavarga (16 charts)
        """
        # Shadvarga divisions and their weights
        shadvarga = {
            1: 6,   # D1 - Rashi
            2: 2,   # D2 - Hora
            3: 4,   # D3 - Drekkana
            9: 5,   # D9 - Navamsa
            12: 2,  # D12 - Dwadasamsa
            30: 1,  # D30 - Trimsamsa
        }
        
        vimshopaka = {}
        
        for planet_name, planet_data in planets.items():
            longitude = planet_data.get('longitude', 0)
            planet_score = 0
            
            for div, weight in shadvarga.items():
                div_rashi = cls.calculate_division(longitude, div)
                
                # Check if planet is in own sign, exalted, etc. in this division
                # Simplified: just count positions for now
                # Full implementation would check dignity in each division
                
                # For now, give base points
                planet_score += weight * 0.5  # 50% base
            
            vimshopaka[planet_name] = round(planet_score, 2)
        
        return vimshopaka


# Convenience functions
def get_navamsa(longitude: float) -> int:
    """Quick function to get Navamsa rashi"""
    return DivisionalCharts.calculate_d9(longitude)

def get_dasamsa(longitude: float) -> int:
    """Quick function to get Dasamsa rashi"""
    return DivisionalCharts.calculate_d10(longitude)

def get_all_divisions(longitude: float) -> Dict[str, int]:
    """Get all divisional positions for a single longitude"""
    divisions = [1, 2, 3, 4, 7, 9, 10, 12, 16, 20, 24, 27, 30, 40, 45, 60]
    
    result = {}
    for div in divisions:
        rashi = DivisionalCharts.calculate_division(longitude, div)
        result[f'D{div}'] = {
            'rashi': rashi,
            'rashi_name': RASHI_NAMES[rashi]
        }
    
    return result
