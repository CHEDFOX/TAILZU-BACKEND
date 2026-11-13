"""
JYOTISH ENGINE - MANGLIK DOSHA
Mars affliction analysis for marriage
"""

from typing import Dict, List
from ..core.constants import RASHIS


class ManglikAnalysis:
    """
    Analyze Manglik (Kuja) Dosha
    
    Manglik Dosha occurs when Mars is in:
    - 1st house (Lagna)
    - 4th house (Sukha)
    - 7th house (Kalatra)
    - 8th house (Mrityu)
    - 12th house (Vyaya)
    
    Some traditions also include 2nd house
    """
    
    # Houses that cause Manglik Dosha
    MANGLIK_HOUSES = [1, 4, 7, 8, 12]
    MANGLIK_HOUSES_EXTENDED = [1, 2, 4, 7, 8, 12]
    
    # Cancellation conditions
    CANCELLATION_CONDITIONS = [
        "Mars in own sign (Aries or Scorpio)",
        "Mars in exaltation (Capricorn)",
        "Mars aspected by benefic Jupiter",
        "Mars conjunct benefic planet",
        "Mars in Kendra of benefic",
        "Both partners have Manglik Dosha",
        "Person born on Tuesday",
        "Mars in Leo in 7th or 8th house",
    ]
    
    def __init__(self, planets: Dict, ascendant_rashi: int, birth_weekday: int = None):
        """
        Initialize with chart data
        
        Args:
            planets: Dict of planet positions with 'house' and 'rashi'
            ascendant_rashi: Ascendant rashi index (0-11)
            birth_weekday: Day of birth (0=Monday, 1=Tuesday, etc.)
        """
        self.planets = planets
        self.asc_rashi = ascendant_rashi
        self.birth_weekday = birth_weekday
        
        self.mars_house = planets.get('Mars', {}).get('house', 1)
        self.mars_rashi = planets.get('Mars', {}).get('rashi', 0)
    
    def check_manglik_from_lagna(self) -> Dict:
        """Check Manglik Dosha from Lagna (Ascendant)"""
        is_manglik = self.mars_house in self.MANGLIK_HOUSES
        
        return {
            'reference': 'Lagna',
            'mars_house': self.mars_house,
            'is_manglik': is_manglik,
            'severity': self._get_severity(self.mars_house) if is_manglik else None,
        }
    
    def check_manglik_from_moon(self) -> Dict:
        """Check Manglik Dosha from Moon"""
        moon_rashi = self.planets.get('Moon', {}).get('rashi', 0)
        mars_from_moon = ((self.mars_rashi - moon_rashi) % 12) + 1
        
        is_manglik = mars_from_moon in self.MANGLIK_HOUSES
        
        return {
            'reference': 'Moon',
            'mars_house_from_moon': mars_from_moon,
            'is_manglik': is_manglik,
            'severity': self._get_severity(mars_from_moon) if is_manglik else None,
        }
    
    def check_manglik_from_venus(self) -> Dict:
        """Check Manglik Dosha from Venus (marriage significator)"""
        venus_rashi = self.planets.get('Venus', {}).get('rashi', 0)
        mars_from_venus = ((self.mars_rashi - venus_rashi) % 12) + 1
        
        is_manglik = mars_from_venus in self.MANGLIK_HOUSES
        
        return {
            'reference': 'Venus',
            'mars_house_from_venus': mars_from_venus,
            'is_manglik': is_manglik,
            'severity': self._get_severity(mars_from_venus) if is_manglik else None,
        }
    
    def _get_severity(self, house: int) -> str:
        """Determine severity based on house"""
        if house == 7:
            return 'High'  # 7th house is most severe
        elif house == 8:
            return 'High'  # 8th house is severe
        elif house in [1, 4]:
            return 'Medium'
        elif house in [2, 12]:
            return 'Low'
        return 'Low'
    
    def check_cancellations(self) -> List[Dict]:
        """Check if Manglik Dosha is cancelled"""
        cancellations = []
        
        # 1. Mars in own sign (Aries=0 or Scorpio=7)
        if self.mars_rashi in [0, 7]:
            cancellations.append({
                'condition': 'Mars in own sign',
                'details': f"Mars in {RASHIS[self.mars_rashi]['name']}",
                'strength': 'Full cancellation',
            })
        
        # 2. Mars exalted (Capricorn=9)
        if self.mars_rashi == 9:
            cancellations.append({
                'condition': 'Mars exalted',
                'details': 'Mars in Capricorn',
                'strength': 'Full cancellation',
            })
        
        # 3. Mars debilitated (Cancer=3) - some say this reduces dosha
        if self.mars_rashi == 3:
            cancellations.append({
                'condition': 'Mars debilitated',
                'details': 'Mars in Cancer reduces aggression',
                'strength': 'Partial cancellation',
            })
        
        # 4. Jupiter aspect on Mars
        jupiter_house = self.planets.get('Jupiter', {}).get('house', 1)
        mars_house = self.mars_house
        jupiter_aspects = [5, 7, 9]  # Jupiter's special aspects
        
        for aspect in jupiter_aspects:
            aspected_house = ((jupiter_house + aspect - 1) % 12) + 1
            if aspected_house == mars_house:
                cancellations.append({
                    'condition': 'Jupiter aspects Mars',
                    'details': f"Jupiter from {jupiter_house}th aspects Mars in {mars_house}th",
                    'strength': 'Significant reduction',
                })
                break
        
        # 5. Born on Tuesday
        if self.birth_weekday == 1:  # Tuesday
            cancellations.append({
                'condition': 'Born on Tuesday',
                'details': "Mars' day reduces Manglik effects",
                'strength': 'Partial cancellation',
            })
        
        # 6. Mars conjunct Jupiter or Venus
        jupiter_rashi = self.planets.get('Jupiter', {}).get('rashi', -1)
        venus_rashi = self.planets.get('Venus', {}).get('rashi', -1)
        
        if self.mars_rashi == jupiter_rashi:
            cancellations.append({
                'condition': 'Mars conjunct Jupiter',
                'details': 'Benefic conjunction reduces malefic effects',
                'strength': 'Significant reduction',
            })
        
        if self.mars_rashi == venus_rashi:
            cancellations.append({
                'condition': 'Mars conjunct Venus',
                'details': 'Marriage significator conjunction',
                'strength': 'Partial cancellation',
            })
        
        # 7. Mars in Leo in 7th or 8th
        if self.mars_rashi == 4 and self.mars_house in [7, 8]:  # Leo=4
            cancellations.append({
                'condition': 'Mars in Leo in 7th/8th',
                'details': 'Leo placement reduces malefic effects',
                'strength': 'Partial cancellation',
            })
        
        return cancellations
    
    def get_dosha_strength(self) -> str:
        """Calculate net dosha strength after cancellations"""
        from_lagna = self.check_manglik_from_lagna()
        from_moon = self.check_manglik_from_moon()
        cancellations = self.check_cancellations()
        
        # Count positive results
        manglik_count = sum([
            from_lagna['is_manglik'],
            from_moon['is_manglik'],
        ])
        
        if manglik_count == 0:
            return 'No Dosha'
        
        # Check cancellations
        full_cancellations = sum(1 for c in cancellations if 'Full' in c['strength'])
        partial_cancellations = len(cancellations) - full_cancellations
        
        if full_cancellations > 0:
            return 'Cancelled'
        elif partial_cancellations >= 2:
            return 'Mild'
        elif manglik_count == 1:
            return 'Partial'
        else:
            return 'Full'
    
    def full_analysis(self) -> Dict:
        """Complete Manglik Dosha analysis"""
        from_lagna = self.check_manglik_from_lagna()
        from_moon = self.check_manglik_from_moon()
        from_venus = self.check_manglik_from_venus()
        cancellations = self.check_cancellations()
        strength = self.get_dosha_strength()
        
        is_manglik = from_lagna['is_manglik'] or from_moon['is_manglik']
        
        # Recommendations
        if strength == 'No Dosha':
            recommendation = 'No Manglik Dosha. No special precautions needed.'
        elif strength == 'Cancelled':
            recommendation = 'Manglik Dosha is cancelled. Marriage can proceed normally.'
        elif strength == 'Mild':
            recommendation = 'Mild Manglik Dosha. Simple remedies recommended.'
        elif strength == 'Partial':
            recommendation = 'Partial Manglik Dosha. Match with another Manglik or perform remedies.'
        else:
            recommendation = 'Full Manglik Dosha. Match with Manglik partner strongly recommended.'
        
        # Remedies if needed
        remedies = []
        if is_manglik and strength not in ['No Dosha', 'Cancelled']:
            remedies = [
                'Kumbh Vivah (symbolic marriage to pot/tree)',
                'Chanting Mangal mantra',
                'Wearing coral gemstone (after consultation)',
                'Fasting on Tuesdays',
                'Donation of red items on Tuesday',
                'Marriage after age 28 (natural reduction)',
            ]
        
        return {
            'is_manglik': is_manglik,
            'dosha_strength': strength,
            'analysis': {
                'from_lagna': from_lagna,
                'from_moon': from_moon,
                'from_venus': from_venus,
            },
            'cancellations': cancellations,
            'has_cancellation': len(cancellations) > 0,
            'recommendation': recommendation,
            'remedies': remedies,
            'mars_position': {
                'house': self.mars_house,
                'rashi': RASHIS[self.mars_rashi]['name'],
            },
        }


def check_manglik_compatibility(person1_planets: Dict, person1_asc: int,
                                 person2_planets: Dict, person2_asc: int) -> Dict:
    """
    Check Manglik compatibility between two people
    Both being Manglik cancels the dosha
    """
    person1 = ManglikAnalysis(person1_planets, person1_asc)
    person2 = ManglikAnalysis(person2_planets, person2_asc)
    
    p1_analysis = person1.full_analysis()
    p2_analysis = person2.full_analysis()
    
    both_manglik = p1_analysis['is_manglik'] and p2_analysis['is_manglik']
    neither_manglik = not p1_analysis['is_manglik'] and not p2_analysis['is_manglik']
    
    if both_manglik:
        compatibility = 'Good'
        explanation = 'Both partners are Manglik - doshas cancel each other'
    elif neither_manglik:
        compatibility = 'Good'
        explanation = 'Neither partner has Manglik Dosha'
    else:
        manglik_person = 'Person 1' if p1_analysis['is_manglik'] else 'Person 2'
        non_manglik = 'Person 2' if p1_analysis['is_manglik'] else 'Person 1'
        
        # Check if cancelled
        manglik_analysis = p1_analysis if p1_analysis['is_manglik'] else p2_analysis
        if manglik_analysis['dosha_strength'] in ['Cancelled', 'Mild']:
            compatibility = 'Acceptable'
            explanation = f'{manglik_person} has Manglik Dosha but it is reduced/cancelled'
        else:
            compatibility = 'Challenging'
            explanation = f'{manglik_person} has Manglik Dosha, {non_manglik} does not - remedies needed'
    
    return {
        'person1': {
            'is_manglik': p1_analysis['is_manglik'],
            'strength': p1_analysis['dosha_strength'],
        },
        'person2': {
            'is_manglik': p2_analysis['is_manglik'],
            'strength': p2_analysis['dosha_strength'],
        },
        'compatibility': compatibility,
        'explanation': explanation,
        'both_manglik': both_manglik,
    }
