"""
JYOTISH ENGINE - JAIMINI KARAKAS
Chara (Variable) Karaka system
"""

from typing import Dict, List
from ..core.constants import RASHIS, RASHI_NAMES


class JaiminiKarakas:
    """
    Calculate Jaimini Chara Karakas
    
    8 Chara Karakas (variable significators) based on degrees:
    1. Atmakaraka (AK) - Soul, self (highest degree)
    2. Amatyakaraka (AmK) - Minister, career
    3. Bhratrikaraka (BK) - Siblings
    4. Matrikaraka (MK) - Mother
    5. Pitrikaraka (PiK) - Father
    6. Putrakaraka (PuK) - Children
    7. Gnatikaraka (GK) - Relatives, enemies
    8. Darakaraka (DK) - Spouse (lowest degree)
    
    Only 7 planets used: Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn
    (Rahu sometimes included as 8th)
    """
    
    KARAKA_NAMES = [
        'Atmakaraka',      # AK - Soul
        'Amatyakaraka',    # AmK - Career/Minister
        'Bhratrikaraka',   # BK - Siblings
        'Matrikaraka',     # MK - Mother
        'Pitrikaraka',     # PiK - Father
        'Putrakaraka',     # PuK - Children
        'Gnatikaraka',     # GK - Relatives/Enemies
        'Darakaraka',      # DK - Spouse
    ]
    
    KARAKA_MEANINGS = {
        'Atmakaraka': {
            'short': 'AK',
            'signifies': 'Soul, self, ego, overall life path',
            'house_analysis': 'Most important planet, shows soul\'s desire',
        },
        'Amatyakaraka': {
            'short': 'AmK',
            'signifies': 'Career, profession, minister, advisor',
            'house_analysis': 'Shows career path and professional success',
        },
        'Bhratrikaraka': {
            'short': 'BK',
            'signifies': 'Siblings, courage, younger brothers/sisters',
            'house_analysis': 'Shows relationship with siblings',
        },
        'Matrikaraka': {
            'short': 'MK',
            'signifies': 'Mother, nurturing, home, emotions',
            'house_analysis': 'Shows relationship with mother',
        },
        'Pitrikaraka': {
            'short': 'PiK',
            'signifies': 'Father, authority, guidance',
            'house_analysis': 'Shows relationship with father',
        },
        'Putrakaraka': {
            'short': 'PuK',
            'signifies': 'Children, creativity, intelligence',
            'house_analysis': 'Shows children and creative potential',
        },
        'Gnatikaraka': {
            'short': 'GK',
            'signifies': 'Relatives, enemies, diseases, obstacles',
            'house_analysis': 'Shows struggles and competition',
        },
        'Darakaraka': {
            'short': 'DK',
            'signifies': 'Spouse, partner, marriage',
            'house_analysis': 'Most important for marriage analysis',
        },
    }
    
    def __init__(self, planets: Dict, include_rahu: bool = True):
        """
        Initialize with planet positions
        
        Args:
            planets: Dict with planet longitudes
            include_rahu: Whether to include Rahu as 8th karaka
        """
        self.planets = planets
        self.include_rahu = include_rahu
        self.karakas = self._calculate_karakas()
    
    def _get_degree_in_sign(self, longitude: float) -> float:
        """Get degree within sign (0-30)"""
        return longitude % 30
    
    def _calculate_karakas(self) -> Dict:
        """
        Calculate Chara Karakas
        Sort planets by degree in sign (highest to lowest)
        """
        # Planets for Jaimini (7 or 8)
        planet_list = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']
        if self.include_rahu:
            planet_list.append('Rahu')
        
        # Get degrees in sign for each planet
        planet_degrees = []
        for planet in planet_list:
            longitude = self.planets.get(planet, {}).get('longitude', 0)
            degree = self._get_degree_in_sign(longitude)
            planet_degrees.append({
                'planet': planet,
                'longitude': longitude,
                'degree_in_sign': degree,
                'rashi': int(longitude / 30),
            })
        
        # Sort by degree (highest first)
        sorted_planets = sorted(planet_degrees, key=lambda x: x['degree_in_sign'], reverse=True)
        
        # Assign karakas (use only as many as we have planets)
        karakas = {}
        num_karakas = min(len(self.KARAKA_NAMES), len(sorted_planets))
        
        for i in range(num_karakas):
            karaka_name = self.KARAKA_NAMES[i]
            planet_data = sorted_planets[i]
            karakas[karaka_name] = {
                'planet': planet_data['planet'],
                'degree': round(planet_data['degree_in_sign'], 2),
                'rashi': planet_data['rashi'],
                'rashi_name': RASHI_NAMES[planet_data['rashi']],
                'meaning': self.KARAKA_MEANINGS[karaka_name]['signifies'],
                'short': self.KARAKA_MEANINGS[karaka_name]['short'],
            }
        
        # If we have 7 planets, Darakaraka is the same as Gnatikaraka
        if num_karakas == 7 and 'Gnatikaraka' in karakas:
            karakas['Darakaraka'] = karakas['Gnatikaraka'].copy()
            karakas['Darakaraka']['meaning'] = self.KARAKA_MEANINGS['Darakaraka']['signifies']
            karakas['Darakaraka']['short'] = 'DK'
        
        return karakas
    
    def get_atmakaraka(self) -> Dict:
        """Get Atmakaraka (soul significator) - most important"""
        return self.karakas.get('Atmakaraka', {})
    
    def get_darakaraka(self) -> Dict:
        """Get Darakaraka (spouse significator)"""
        return self.karakas.get('Darakaraka', {})
    
    def get_all_karakas(self) -> Dict:
        """Get all Chara Karakas"""
        return self.karakas
    
    def get_karaka_for_planet(self, planet: str) -> str:
        """Find which karaka a planet represents"""
        for karaka_name, data in self.karakas.items():
            if data['planet'] == planet:
                return karaka_name
        return None
    
    def analyze_karakamsa(self, navamsa_ascendant: int) -> Dict:
        """
        Analyze Karakamsa (Atmakaraka's Navamsa position)
        Very important in Jaimini for life purpose
        """
        ak = self.get_atmakaraka()
        ak_planet = ak.get('planet')
        
        # Get AK's navamsa position
        from ..charts.divisional_charts import DivisionalCharts
        ak_longitude = self.planets.get(ak_planet, {}).get('longitude', 0)
        ak_navamsa = DivisionalCharts.calculate_d9(ak_longitude)
        
        # Karakamsa is the sign where AK is placed in Navamsa
        karakamsa = ak_navamsa
        
        # Swamsa is Karakamsa counted from Navamsa Lagna
        swamsa_house = ((karakamsa - navamsa_ascendant) % 12) + 1
        
        # Interpret Karakamsa
        karakamsa_meanings = {
            0: 'Aries - Leadership, independent work, sports',
            1: 'Taurus - Arts, finance, beauty industry',
            2: 'Gemini - Communication, writing, media',
            3: 'Cancer - Nurturing, real estate, food',
            4: 'Leo - Government, entertainment, politics',
            5: 'Virgo - Service, healing, analysis',
            6: 'Libra - Law, relationships, diplomacy',
            7: 'Scorpio - Research, occult, transformation',
            8: 'Sagittarius - Teaching, religion, philosophy',
            9: 'Capricorn - Business, administration, structure',
            10: 'Aquarius - Technology, social work, innovation',
            11: 'Pisces - Spirituality, arts, healing',
        }
        
        return {
            'atmakaraka': ak_planet,
            'karakamsa_rashi': karakamsa,
            'karakamsa_name': RASHI_NAMES[karakamsa],
            'swamsa_house': swamsa_house,
            'life_purpose': karakamsa_meanings.get(karakamsa, ''),
        }
    
    def marriage_analysis(self) -> Dict:
        """
        Jaimini marriage analysis using Darakaraka
        """
        dk = self.get_darakaraka()
        dk_planet = dk.get('planet')
        dk_rashi = dk.get('rashi', 0)
        
        # Spouse characteristics based on DK planet
        spouse_traits = {
            'Sun': 'Authoritative, proud, leadership qualities, government connection',
            'Moon': 'Emotional, nurturing, caring, fluctuating moods',
            'Mars': 'Energetic, aggressive, athletic, independent',
            'Mercury': 'Intelligent, communicative, youthful, business-minded',
            'Jupiter': 'Wise, religious, learned, good character',
            'Venus': 'Beautiful, artistic, luxurious, romantic',
            'Saturn': 'Mature, serious, hardworking, older spouse',
        }
        
        # Spouse from DK rashi
        rashi_traits = {
            0: 'Independent, energetic',
            1: 'Beautiful, stable, artistic',
            2: 'Intelligent, communicative',
            3: 'Emotional, caring, domestic',
            4: 'Proud, creative, leadership',
            5: 'Service-oriented, analytical',
            6: 'Balanced, diplomatic, beautiful',
            7: 'Intense, secretive, transformative',
            8: 'Religious, philosophical, foreign',
            9: 'Ambitious, practical, career-focused',
            10: 'Unique, humanitarian, intellectual',
            11: 'Spiritual, artistic, compassionate',
        }
        
        return {
            'darakaraka': dk_planet,
            'dk_rashi': RASHI_NAMES[dk_rashi],
            'spouse_traits': spouse_traits.get(dk_planet, ''),
            'spouse_from_rashi': rashi_traits.get(dk_rashi, ''),
            'dk_degree': dk.get('degree'),
        }
    
    def career_analysis(self) -> Dict:
        """
        Jaimini career analysis using Amatyakaraka
        """
        amk = self.karakas.get('Amatyakaraka', {})
        amk_planet = amk.get('planet')
        amk_rashi = amk.get('rashi', 0)
        
        career_by_planet = {
            'Sun': 'Government, administration, politics, leadership',
            'Moon': 'Public dealing, hospitality, nursing, liquids',
            'Mars': 'Military, police, surgery, engineering, sports',
            'Mercury': 'Business, communication, writing, accounting',
            'Jupiter': 'Teaching, law, religion, finance, counseling',
            'Venus': 'Arts, entertainment, luxury goods, fashion',
            'Saturn': 'Labor, mining, real estate, slow/steady work',
        }
        
        return {
            'amatyakaraka': amk_planet,
            'amk_rashi': RASHI_NAMES[amk_rashi],
            'career_indication': career_by_planet.get(amk_planet, ''),
            'amk_degree': amk.get('degree'),
        }


class JaiminiAspects:
    """
    Jaimini Rashi Drishti (Sign-based aspects)
    
    Rules:
    - Movable signs aspect Fixed signs (except adjacent)
    - Fixed signs aspect Movable signs (except adjacent)
    - Dual signs aspect each other
    """
    
    @staticmethod
    def get_sign_quality(rashi: int) -> str:
        """Get quality of sign"""
        return RASHIS[rashi]['quality']
    
    @staticmethod
    def does_aspect(rashi1: int, rashi2: int) -> bool:
        """Check if rashi1 aspects rashi2"""
        if rashi1 == rashi2:
            return False
        
        # Adjacent signs don't aspect
        if abs(rashi1 - rashi2) == 1 or abs(rashi1 - rashi2) == 11:
            return False
        
        quality1 = JaiminiAspects.get_sign_quality(rashi1)
        quality2 = JaiminiAspects.get_sign_quality(rashi2)
        
        # Movable aspects Fixed
        if quality1 == 'Movable' and quality2 == 'Fixed':
            return True
        
        # Fixed aspects Movable
        if quality1 == 'Fixed' and quality2 == 'Movable':
            return True
        
        # Dual aspects Dual
        if quality1 == 'Dual' and quality2 == 'Dual':
            return True
        
        return False
    
    @staticmethod
    def get_aspected_signs(rashi: int) -> List[int]:
        """Get all signs aspected by given rashi"""
        aspected = []
        for i in range(12):
            if JaiminiAspects.does_aspect(rashi, i):
                aspected.append(i)
        return aspected
    
    @staticmethod
    def get_aspect_table() -> Dict:
        """Generate complete Jaimini aspect table"""
        table = {}
        for i in range(12):
            table[RASHI_NAMES[i]] = {
                'quality': JaiminiAspects.get_sign_quality(i),
                'aspects': [RASHI_NAMES[j] for j in JaiminiAspects.get_aspected_signs(i)],
            }
        return table


class ArudhaPada:
    """
    Calculate Arudha Padas (A1-A12)
    Arudha = reflection/image of house
    
    Calculation:
    1. Find lord of house
    2. Count from house to lord's position
    3. Count same distance from lord
    4. That's the Arudha
    """
    
    def __init__(self, planets: Dict, ascendant_rashi: int):
        """
        Initialize with chart data
        """
        self.planets = planets
        self.asc_rashi = ascendant_rashi
    
    def _get_house_lord(self, house: int) -> str:
        """Get lord of a house"""
        from ..core.constants import RASHI_LORDS
        house_rashi = (self.asc_rashi + house - 1) % 12
        return RASHI_LORDS[house_rashi]
    
    def _get_planet_rashi(self, planet: str) -> int:
        """Get rashi of a planet"""
        return self.planets.get(planet, {}).get('rashi', 0)
    
    def calculate_arudha(self, house: int) -> Dict:
        """
        Calculate Arudha Pada for a house
        
        Special rules:
        - If Arudha falls in same house or 7th from it, move to 10th
        """
        house_rashi = (self.asc_rashi + house - 1) % 12
        lord = self._get_house_lord(house)
        lord_rashi = self._get_planet_rashi(lord)
        
        # Count from house to lord
        distance = ((lord_rashi - house_rashi) % 12) + 1
        
        # Count same from lord
        arudha_rashi = (lord_rashi + distance - 1) % 12
        
        # Exception: if arudha falls in same house or 7th
        if arudha_rashi == house_rashi:
            arudha_rashi = (house_rashi + 9) % 12  # 10th from house
        elif arudha_rashi == (house_rashi + 6) % 12:
            arudha_rashi = (house_rashi + 3) % 12  # 4th from house
        
        arudha_house = ((arudha_rashi - self.asc_rashi) % 12) + 1
        
        return {
            'house': house,
            'arudha_name': f'A{house}',
            'house_lord': lord,
            'lord_rashi': RASHI_NAMES[lord_rashi],
            'arudha_rashi': arudha_rashi,
            'arudha_rashi_name': RASHI_NAMES[arudha_rashi],
            'arudha_house': arudha_house,
        }
    
    def calculate_all_arudhas(self) -> Dict:
        """Calculate all 12 Arudha Padas"""
        arudhas = {}
        
        important_arudhas = {
            1: 'Arudha Lagna (AL) - Image in society',
            2: 'Dhana Pada - Wealth image',
            4: 'Sukha Pada - Happiness image',
            5: 'Mantra Pada - Children image',
            7: 'Dara Pada - Spouse image',
            9: 'Bhagya Pada - Luck image',
            10: 'Rajya Pada - Career image',
            11: 'Labha Pada - Gains image',
            12: 'Upapada (UL) - Marriage/2nd spouse',
        }
        
        for house in range(1, 13):
            arudha = self.calculate_arudha(house)
            arudha['significance'] = important_arudhas.get(house, '')
            arudhas[f'A{house}'] = arudha
        
        return arudhas
    
    def get_arudha_lagna(self) -> Dict:
        """Get Arudha Lagna (most important)"""
        return self.calculate_arudha(1)
    
    def get_upapada(self) -> Dict:
        """Get Upapada (A12 - marriage indicator)"""
        return self.calculate_arudha(12)


# Convenience functions
def calculate_karakas(planets: Dict) -> Dict:
    """Quick function to calculate Jaimini Karakas"""
    calc = JaiminiKarakas(planets)
    return calc.get_all_karakas()

def get_darakaraka(planets: Dict) -> Dict:
    """Get Darakaraka for marriage"""
    calc = JaiminiKarakas(planets)
    return calc.get_darakaraka()
