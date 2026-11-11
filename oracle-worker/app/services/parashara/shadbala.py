"""
JYOTISH ENGINE - SHADBALA (SIX-FOLD STRENGTH)
Complete planetary strength calculation system

Six components:
1. Sthana Bala (Positional Strength)
2. Dig Bala (Directional Strength)
3. Kala Bala (Temporal Strength)
4. Chesta Bala (Motional Strength)
5. Naisargika Bala (Natural Strength)
6. Drik Bala (Aspectual Strength)
"""

from typing import Dict
from datetime import datetime
from ..core.constants import PLANETS, RASHI_LORDS


class ShadbalaCalculator:
    """
    Calculate complete Shadbala for all planets
    Results in Rupas (1 Rupa = 60 Virupas)
    """
    
    # Minimum required Shadbala (in Rupas)
    MINIMUM_SHADBALA = {
        'Sun': 6.5,
        'Moon': 6.0,
        'Mars': 5.0,
        'Mercury': 7.0,
        'Jupiter': 6.5,
        'Venus': 5.5,
        'Saturn': 5.0,
    }
    
    # Natural strength order (Naisargika Bala)
    NAISARGIKA_BALA = {
        'Sun': 60.0,
        'Moon': 51.43,
        'Mars': 17.14,
        'Mercury': 25.71,
        'Jupiter': 34.29,
        'Venus': 42.86,
        'Saturn': 8.57,
    }
    
    def __init__(self, planets: Dict, ascendant: Dict, birth_datetime: datetime,
                 latitude: float, longitude: float):
        """
        Initialize Shadbala calculator
        
        Args:
            planets: Dict of planet data with longitude, rashi, house, speed
            ascendant: Dict with rashi index
            birth_datetime: Birth date and time
            latitude: Birth latitude
            longitude: Birth longitude
        """
        self.planets = planets
        self.asc_rashi = ascendant.get('rashi', ascendant.get('rashi_index', 0))
        self.birth_dt = birth_datetime
        self.latitude = latitude
        self.longitude = longitude
    
    # ═══════════════════════════════════════════════════════════════════════
    # 1. STHANA BALA (POSITIONAL STRENGTH)
    # ═══════════════════════════════════════════════════════════════════════
    
    def calculate_sthana_bala(self, planet: str) -> Dict:
        """
        Positional strength - 5 sub-components:
        1. Uccha Bala (Exaltation strength)
        2. Saptavargaja Bala (Divisional chart strength)
        3. Ojhayugmarasyamsa Bala (Odd-even sign strength)
        4. Kendradi Bala (Angular house strength)
        5. Drekkana Bala (Decanate strength)
        """
        planet_data = self.planets.get(planet, {})
        longitude = planet_data.get('longitude', 0)
        rashi = planet_data.get('rashi', 0)
        house = planet_data.get('house', 1)
        
        # 1. Uccha Bala (Exaltation Strength)
        uccha_bala = self._calculate_uccha_bala(planet, longitude)
        
        # 2. Saptavargaja Bala (7 divisional charts strength)
        saptavargaja_bala = self._calculate_saptavargaja_bala(planet, longitude)
        
        # 3. Ojhayugmarasyamsa Bala (Odd-Even strength)
        ojha_bala = self._calculate_ojha_bala(planet, rashi, longitude)
        
        # 4. Kendradi Bala (Angular strength)
        kendradi_bala = self._calculate_kendradi_bala(house)
        
        # 5. Drekkana Bala (Decanate strength)
        drekkana_bala = self._calculate_drekkana_bala(planet, longitude)
        
        total = uccha_bala + saptavargaja_bala + ojha_bala + kendradi_bala + drekkana_bala
        
        return {
            'uccha_bala': round(uccha_bala, 2),
            'saptavargaja_bala': round(saptavargaja_bala, 2),
            'ojhayugma_bala': round(ojha_bala, 2),
            'kendradi_bala': round(kendradi_bala, 2),
            'drekkana_bala': round(drekkana_bala, 2),
            'total': round(total, 2),
        }
    
    def _calculate_uccha_bala(self, planet: str, longitude: float) -> float:
        """
        Exaltation strength
        Maximum at exaltation point, zero at debilitation point
        """
        planet_info = PLANETS.get(planet, {})
        exalt_rashi = planet_info.get('exalted')
        exalt_degree = planet_info.get('exalted_degree', 0)
        
        if exalt_rashi is None:
            return 30.0  # Rahu/Ketu get neutral
        
        # Exaltation point in absolute longitude
        exalt_long = exalt_rashi * 30 + exalt_degree
        
        # Debilitation is 180° away
        debil_long = (exalt_long + 180) % 360
        
        # Calculate distance from debilitation point
        diff = abs(longitude - debil_long)
        if diff > 180:
            diff = 360 - diff
        
        # Max 60 virupas at exaltation, 0 at debilitation
        uccha_bala = (diff / 180) * 60
        
        return uccha_bala
    
    def _calculate_saptavargaja_bala(self, planet: str, longitude: float) -> float:
        """
        Strength from 7 divisional charts (D1, D2, D3, D7, D9, D12, D30)
        Check dignity in each division
        """
        from ..charts.divisional_charts import DivisionalCharts
        
        divisions = [1, 2, 3, 7, 9, 12, 30]
        total_points = 0
        
        for div in divisions:
            div_rashi = DivisionalCharts.calculate_division(longitude, div)
            
            # Check dignity in this division
            dignity_points = self._get_dignity_points(planet, div_rashi)
            total_points += dignity_points
        
        # Maximum is 7 * 30 = 210, normalize to 0-45 virupas
        return (total_points / 210) * 45
    
    def _get_dignity_points(self, planet: str, rashi: int) -> float:
        """Get dignity points for planet in rashi"""
        planet_info = PLANETS.get(planet, {})
        
        # Moolatrikona: 45 points
        if planet_info.get('moolatrikona') == rashi:
            return 45
        
        # Own sign: 30 points
        if rashi in planet_info.get('owns', []):
            return 30
        
        # Exalted: 20 points (already counted in uccha bala)
        if planet_info.get('exalted') == rashi:
            return 20
        
        # Great friend: 22.5 points
        sign_lord = RASHI_LORDS[rashi]
        if sign_lord in planet_info.get('friends', []):
            return 22.5
        
        # Neutral: 15 points
        if sign_lord not in planet_info.get('enemies', []):
            return 15
        
        # Enemy: 7.5 points
        if sign_lord in planet_info.get('enemies', []):
            return 7.5
        
        # Debilitated: 3.75 points
        if planet_info.get('debilitated') == rashi:
            return 3.75
        
        return 15  # Default neutral
    
    def _calculate_ojha_bala(self, planet: str, rashi: int, longitude: float) -> float:
        """
        Odd-Even sign and navamsa strength
        Male planets strong in odd signs, female in even
        """
        from ..charts.divisional_charts import DivisionalCharts
        
        # Determine planet gender
        gender = PLANETS.get(planet, {}).get('gender', 'Male')
        
        # Rashi odd/even (0=Aries=odd)
        rashi_odd = rashi % 2 == 0
        
        # Navamsa odd/even
        navamsa = DivisionalCharts.calculate_d9(longitude)
        navamsa_odd = navamsa % 2 == 0
        
        points = 0
        
        if gender == 'Male':
            if rashi_odd:
                points += 15
            if navamsa_odd:
                points += 15
        else:  # Female
            if not rashi_odd:
                points += 15
            if not navamsa_odd:
                points += 15
        
        return points
    
    def _calculate_kendradi_bala(self, house: int) -> float:
        """
        Angular house strength
        Kendra (1,4,7,10): 60 virupas
        Panapara (2,5,8,11): 30 virupas
        Apoklima (3,6,9,12): 15 virupas
        """
        if house in [1, 4, 7, 10]:
            return 60
        elif house in [2, 5, 8, 11]:
            return 30
        else:
            return 15
    
    def _calculate_drekkana_bala(self, planet: str, longitude: float) -> float:
        """
        Decanate strength
        Male planets strong in 1st drekkana
        Neutral in 2nd
        Female in 3rd
        """
        degree_in_sign = longitude % 30
        
        if degree_in_sign < 10:
            drekkana = 1
        elif degree_in_sign < 20:
            drekkana = 2
        else:
            drekkana = 3
        
        gender = PLANETS.get(planet, {}).get('gender', 'Male')
        
        if gender == 'Male' and drekkana == 1:
            return 15
        elif gender == 'Female' and drekkana == 3:
            return 15
        elif drekkana == 2:
            return 7.5
        else:
            return 0
    
    # ═══════════════════════════════════════════════════════════════════════
    # 2. DIG BALA (DIRECTIONAL STRENGTH)
    # ═══════════════════════════════════════════════════════════════════════
    
    def calculate_dig_bala(self, planet: str) -> float:
        """
        Directional strength based on house position
        Each planet is strongest in a specific direction/house
        
        Sun/Mars: 10th house (South)
        Moon/Venus: 4th house (North)
        Mercury/Jupiter: 1st house (East)
        Saturn: 7th house (West)
        """
        dig_bala_houses = {
            'Sun': 10,
            'Moon': 4,
            'Mars': 10,
            'Mercury': 1,
            'Jupiter': 1,
            'Venus': 4,
            'Saturn': 7,
        }
        
        strong_house = dig_bala_houses.get(planet)
        if strong_house is None:
            return 0  # Rahu/Ketu
        
        actual_house = self.planets.get(planet, {}).get('house', 1)
        
        # Calculate distance from strong house
        # 0 distance = 60 virupas, 6 houses away = 0 virupas
        distance = abs(actual_house - strong_house)
        if distance > 6:
            distance = 12 - distance
        
        dig_bala = 60 * (1 - distance / 6)
        
        return round(dig_bala, 2)
    
    # ═══════════════════════════════════════════════════════════════════════
    # 3. KALA BALA (TEMPORAL STRENGTH)
    # ═══════════════════════════════════════════════════════════════════════
    
    def calculate_kala_bala(self, planet: str) -> Dict:
        """
        Temporal strength - 6 sub-components:
        1. Nathonnatha Bala (Day/Night strength)
        2. Paksha Bala (Lunar fortnight strength)
        3. Tribhaga Bala (4-hour period strength)
        4. Varsha Bala (Year lord strength)
        5. Masa Bala (Month lord strength)
        6. Dina Bala (Day lord strength)
        7. Hora Bala (Hour lord strength)
        """
        # 1. Nathonnatha Bala (Day/Night)
        nathonnatha = self._calculate_nathonnatha_bala(planet)
        
        # 2. Paksha Bala (Lunar fortnight) - only for Moon
        paksha = self._calculate_paksha_bala(planet)
        
        # 3. Tribhaga Bala (4-hour period)
        tribhaga = self._calculate_tribhaga_bala(planet)
        
        # 4-7. Temporal lords (simplified)
        hora_etc = self._calculate_hora_bala(planet)
        
        total = nathonnatha + paksha + tribhaga + hora_etc
        
        return {
            'nathonnatha_bala': round(nathonnatha, 2),
            'paksha_bala': round(paksha, 2),
            'tribhaga_bala': round(tribhaga, 2),
            'hora_bala': round(hora_etc, 2),
            'total': round(total, 2),
        }
    
    def _calculate_nathonnatha_bala(self, planet: str) -> float:
        """
        Day/Night strength
        Moon, Mars, Saturn strong at night
        Sun, Jupiter, Venus strong during day
        Mercury always strong
        """
        hour = self.birth_dt.hour
        is_day = 6 <= hour < 18  # Simplified day/night
        
        day_planets = ['Sun', 'Jupiter', 'Venus']
        night_planets = ['Moon', 'Mars', 'Saturn']
        
        if planet == 'Mercury':
            return 60  # Always strong
        elif planet in day_planets:
            return 60 if is_day else 0
        elif planet in night_planets:
            return 0 if is_day else 60
        
        return 30  # Rahu/Ketu neutral
    
    def _calculate_paksha_bala(self, planet: str) -> float:
        """
        Lunar fortnight strength
        Moon gets strength based on phase
        Benefics strong in Shukla Paksha (waxing)
        Malefics strong in Krishna Paksha (waning)
        """
        if planet not in ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']:
            return 0
        
        # Calculate Moon phase
        sun_long = self.planets.get('Sun', {}).get('longitude', 0)
        moon_long = self.planets.get('Moon', {}).get('longitude', 0)
        
        diff = (moon_long - sun_long) % 360
        
        # Shukla Paksha: 0-180, Krishna Paksha: 180-360
        is_shukla = diff < 180
        
        benefics = ['Jupiter', 'Venus', 'Moon', 'Mercury']
        malefics = ['Sun', 'Mars', 'Saturn']
        
        if planet == 'Moon':
            # Moon's paksha bala based on phase
            if is_shukla:
                return (diff / 180) * 60
            else:
                return ((360 - diff) / 180) * 60
        elif planet in benefics:
            return 60 if is_shukla else 0
        elif planet in malefics:
            return 0 if is_shukla else 60
        
        return 30
    
    def _calculate_tribhaga_bala(self, planet: str) -> float:
        """
        4-hour period strength
        Day divided into 3 parts, night into 3 parts
        Different planets rule each part
        """
        hour = self.birth_dt.hour
        
        # Simplified: assign based on hour
        # Day: 6-10 (Mercury), 10-14 (Sun), 14-18 (Saturn)
        # Night: 18-22 (Moon), 22-2 (Venus), 2-6 (Mars)
        
        tribhaga_lords = {
            (6, 10): 'Mercury',
            (10, 14): 'Sun',
            (14, 18): 'Saturn',
            (18, 22): 'Moon',
            (22, 26): 'Venus',  # 22-2
            (2, 6): 'Mars',
        }
        
        for (start, end), lord in tribhaga_lords.items():
            adj_hour = hour if hour >= 6 else hour + 24
            if start <= adj_hour < end:
                if planet == lord:
                    return 60
                break
        
        return 0
    
    def _calculate_hora_bala(self, planet: str) -> float:
        """
        Simplified hora/year/month/day lord strength
        """
        weekday = self.birth_dt.weekday()
        
        # Day lords (Monday=0 in Python, but Sunday=0 in Vedic)
        day_lords = ['Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Sun']
        vedic_weekday = (weekday + 1) % 7
        day_lord = day_lords[vedic_weekday]
        
        if planet == day_lord:
            return 45
        
        return 15  # Base points
    
    # ═══════════════════════════════════════════════════════════════════════
    # 4. CHESTA BALA (MOTIONAL STRENGTH)
    # ═══════════════════════════════════════════════════════════════════════
    
    def calculate_chesta_bala(self, planet: str) -> float:
        """
        Motional strength based on planetary speed/retrogression
        
        Retrograde planets are considered strong
        Fast-moving planets are strong
        Sun and Moon don't have chesta bala
        """
        if planet in ['Sun', 'Moon']:
            return 0  # Not applicable
        
        speed = self.planets.get(planet, {}).get('speed', 0)
        is_retrograde = speed < 0
        
        if planet in ['Rahu', 'Ketu']:
            return 30  # Always retrograde, neutral strength
        
        # Retrograde = strong
        if is_retrograde:
            return 60
        
        # Check relative speed (simplified)
        avg_speeds = {
            'Mars': 0.5,
            'Mercury': 1.2,
            'Jupiter': 0.08,
            'Venus': 1.0,
            'Saturn': 0.03,
        }
        
        avg_speed = avg_speeds.get(planet, 0.5)
        
        if speed > avg_speed:
            return 45  # Fast moving
        elif speed > avg_speed * 0.5:
            return 30  # Normal
        else:
            return 15  # Slow
    
    # ═══════════════════════════════════════════════════════════════════════
    # 5. NAISARGIKA BALA (NATURAL STRENGTH)
    # ═══════════════════════════════════════════════════════════════════════
    
    def calculate_naisargika_bala(self, planet: str) -> float:
        """
        Natural/Inherent strength
        Fixed values based on luminosity
        Sun > Moon > Venus > Jupiter > Mercury > Mars > Saturn
        """
        return self.NAISARGIKA_BALA.get(planet, 0)
    
    # ═══════════════════════════════════════════════════════════════════════
    # 6. DRIK BALA (ASPECTUAL STRENGTH)
    # ═══════════════════════════════════════════════════════════════════════
    
    def calculate_drik_bala(self, planet: str) -> float:
        """
        Aspectual strength
        Benefic aspects add strength
        Malefic aspects reduce strength
        """
        from .aspects import PlanetaryAspects
        
        planet_house = self.planets.get(planet, {}).get('house', 1)
        
        benefics = ['Jupiter', 'Venus', 'Mercury', 'Moon']
        malefics = ['Sun', 'Mars', 'Saturn', 'Rahu', 'Ketu']
        
        benefic_aspects = 0
        malefic_aspects = 0
        
        for other_planet, data in self.planets.items():
            if other_planet == planet:
                continue
            
            other_house = data.get('house', 1)
            is_aspected, strength = PlanetaryAspects.is_planet_aspected_by(
                planet_house, other_planet, other_house
            )
            
            if is_aspected:
                if other_planet in benefics:
                    benefic_aspects += strength / 100
                elif other_planet in malefics:
                    malefic_aspects += strength / 100
        
        # Net aspectual strength (-60 to +60)
        drik_bala = (benefic_aspects - malefic_aspects) * 30
        
        # Normalize to 0-60 range
        drik_bala = max(0, min(60, drik_bala + 30))
        
        return round(drik_bala, 2)
    
    # ═══════════════════════════════════════════════════════════════════════
    # TOTAL SHADBALA
    # ═══════════════════════════════════════════════════════════════════════
    
    def calculate_total_shadbala(self, planet: str) -> Dict:
        """
        Calculate complete Shadbala for a planet
        """
        sthana = self.calculate_sthana_bala(planet)
        dig = self.calculate_dig_bala(planet)
        kala = self.calculate_kala_bala(planet)
        chesta = self.calculate_chesta_bala(planet)
        naisargika = self.calculate_naisargika_bala(planet)
        drik = self.calculate_drik_bala(planet)
        
        total_virupas = (
            sthana['total'] + 
            dig + 
            kala['total'] + 
            chesta + 
            naisargika + 
            drik
        )
        
        total_rupas = total_virupas / 60
        
        minimum_required = self.MINIMUM_SHADBALA.get(planet, 5.0)
        is_strong = total_rupas >= minimum_required
        strength_ratio = total_rupas / minimum_required
        
        return {
            'planet': planet,
            'sthana_bala': sthana,
            'dig_bala': round(dig, 2),
            'kala_bala': kala,
            'chesta_bala': round(chesta, 2),
            'naisargika_bala': round(naisargika, 2),
            'drik_bala': round(drik, 2),
            'total_virupas': round(total_virupas, 2),
            'total_rupas': round(total_rupas, 2),
            'minimum_required': minimum_required,
            'is_strong': is_strong,
            'strength_ratio': round(strength_ratio, 2),
            'strength_category': self._get_strength_category(strength_ratio),
        }
    
    def _get_strength_category(self, ratio: float) -> str:
        """Categorize strength based on ratio"""
        if ratio >= 1.5:
            return 'Very Strong'
        elif ratio >= 1.2:
            return 'Strong'
        elif ratio >= 1.0:
            return 'Adequate'
        elif ratio >= 0.75:
            return 'Weak'
        else:
            return 'Very Weak'
    
    def calculate_all_planets_shadbala(self) -> Dict:
        """
        Calculate Shadbala for all 7 planets
        """
        results = {}
        seven_planets = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']
        
        for planet in seven_planets:
            results[planet] = self.calculate_total_shadbala(planet)
        
        # Sort by strength
        sorted_planets = sorted(
            results.items(),
            key=lambda x: x[1]['total_rupas'],
            reverse=True
        )
        
        # Find strongest and weakest
        strongest = sorted_planets[0][0]
        weakest = sorted_planets[-1][0]
        
        return {
            'planets': results,
            'ranking': [p[0] for p in sorted_planets],
            'strongest_planet': strongest,
            'weakest_planet': weakest,
            'summary': {
                planet: {
                    'rupas': results[planet]['total_rupas'],
                    'category': results[planet]['strength_category'],
                }
                for planet in seven_planets
            }
        }


# Convenience function
def calculate_shadbala(planets: Dict, ascendant: Dict, 
                       birth_datetime: datetime, latitude: float, 
                       longitude: float) -> Dict:
    """Quick function to calculate Shadbala"""
    calculator = ShadbalaCalculator(planets, ascendant, birth_datetime, latitude, longitude)
    return calculator.calculate_all_planets_shadbala()
