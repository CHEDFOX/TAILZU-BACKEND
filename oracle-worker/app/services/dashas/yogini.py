"""
JYOTISH ENGINE - YOGINI DASHA
36-year planetary period system
Faster, more immediate results than Vimshottari
"""

from datetime import datetime, timedelta
from typing import Dict, List
from ..core.constants import YOGINI_YEARS, YOGINI_ORDER, YOGINI_PLANETS, YOGINI_TOTAL
from ..core.utils import get_nakshatra_from_longitude


class YoginiDasha:
    """
    Calculate Yogini Dasha periods
    8 Yoginis, 36-year cycle
    Based on Moon's nakshatra at birth
    """
    
    # Yogini details
    YOGINI_INFO = {
        'Mangala': {'planet': 'Moon', 'years': 1, 'nature': 'Auspicious', 'deity': 'Mangala'},
        'Pingala': {'planet': 'Sun', 'years': 2, 'nature': 'Mixed', 'deity': 'Pingala'},
        'Dhanya': {'planet': 'Jupiter', 'years': 3, 'nature': 'Auspicious', 'deity': 'Dhanya'},
        'Bhramari': {'planet': 'Mars', 'years': 4, 'nature': 'Inauspicious', 'deity': 'Bhramari'},
        'Bhadrika': {'planet': 'Mercury', 'years': 5, 'nature': 'Auspicious', 'deity': 'Bhadrika'},
        'Ulka': {'planet': 'Saturn', 'years': 6, 'nature': 'Inauspicious', 'deity': 'Ulka'},
        'Siddha': {'planet': 'Venus', 'years': 7, 'nature': 'Auspicious', 'deity': 'Siddha'},
        'Sankata': {'planet': 'Rahu', 'years': 8, 'nature': 'Inauspicious', 'deity': 'Sankata'},
    }
    
    # Nakshatra to Yogini mapping
    NAKSHATRA_YOGINI = {
        0: 'Mangala',    # Ashwini
        1: 'Pingala',    # Bharani
        2: 'Dhanya',     # Krittika
        3: 'Bhramari',   # Rohini
        4: 'Bhadrika',   # Mrigashira
        5: 'Ulka',       # Ardra
        6: 'Siddha',     # Punarvasu
        7: 'Sankata',    # Pushya
        8: 'Mangala',    # Ashlesha
        9: 'Pingala',    # Magha
        10: 'Dhanya',    # Purva Phalguni
        11: 'Bhramari',  # Uttara Phalguni
        12: 'Bhadrika',  # Hasta
        13: 'Ulka',      # Chitra
        14: 'Siddha',    # Swati
        15: 'Sankata',   # Vishakha
        16: 'Mangala',   # Anuradha
        17: 'Pingala',   # Jyeshtha
        18: 'Dhanya',    # Mula
        19: 'Bhramari',  # Purva Ashadha
        20: 'Bhadrika',  # Uttara Ashadha
        21: 'Ulka',      # Shravana
        22: 'Siddha',    # Dhanishta
        23: 'Sankata',   # Shatabhisha
        24: 'Mangala',   # Purva Bhadrapada
        25: 'Pingala',   # Uttara Bhadrapada
        26: 'Dhanya',    # Revati
    }
    
    def __init__(self, moon_longitude: float, birth_datetime: datetime):
        """
        Initialize with Moon position and birth time
        """
        self.moon_longitude = moon_longitude
        self.birth_dt = birth_datetime
        
        # Calculate nakshatra and initial yogini
        self.nakshatra = get_nakshatra_from_longitude(moon_longitude)
        self.birth_yogini = self.NAKSHATRA_YOGINI[self.nakshatra]
        
        # Calculate balance
        self.dasha_balance = self._calculate_dasha_balance()
    
    def _calculate_dasha_balance(self) -> float:
        """Calculate remaining years of first yogini dasha"""
        nakshatra_span = 360 / 27
        degree_in_nakshatra = self.moon_longitude % nakshatra_span
        portion_remaining = 1 - (degree_in_nakshatra / nakshatra_span)
        
        yogini_years = YOGINI_YEARS[self.birth_yogini]
        return yogini_years * portion_remaining
    
    def get_yogini_sequence(self) -> List[str]:
        """Get yogini sequence starting from birth yogini"""
        start_index = YOGINI_ORDER.index(self.birth_yogini)
        sequence = []
        
        for i in range(8):
            index = (start_index + i) % 8
            sequence.append(YOGINI_ORDER[index])
        
        return sequence
    
    def calculate_mahadasha_periods(self, years_to_calculate: int = 100) -> List[Dict]:
        """Calculate Yogini Mahadasha periods"""
        periods = []
        current_date = self.birth_dt
        sequence = self.get_yogini_sequence()
        
        # First dasha with balance
        first_yogini = sequence[0]
        first_end = current_date + timedelta(days=self.dasha_balance * 365.25)
        
        periods.append({
            'yogini': first_yogini,
            'planet': YOGINI_PLANETS[first_yogini],
            'start': current_date,
            'end': first_end,
            'years': round(self.dasha_balance, 2),
            'nature': self.YOGINI_INFO[first_yogini]['nature'],
            'is_birth_dasha': True,
        })
        
        current_date = first_end
        total_years = self.dasha_balance
        
        # Subsequent dashas
        cycle = 0
        while total_years < years_to_calculate:
            for i, yogini in enumerate(YOGINI_ORDER):
                if cycle == 0 and i <= YOGINI_ORDER.index(self.birth_yogini):
                    continue
                
                if total_years >= years_to_calculate:
                    break
                
                years = YOGINI_YEARS[yogini]
                end_date = current_date + timedelta(days=years * 365.25)
                
                periods.append({
                    'yogini': yogini,
                    'planet': YOGINI_PLANETS[yogini],
                    'start': current_date,
                    'end': end_date,
                    'years': years,
                    'nature': self.YOGINI_INFO[yogini]['nature'],
                    'cycle': cycle + 1,
                })
                
                current_date = end_date
                total_years += years
            
            cycle += 1
        
        return periods
    
    def calculate_antardasha(self, main_yogini: str, 
                             start_date: datetime, years: float) -> List[Dict]:
        """Calculate Antardasha within a Yogini Mahadasha"""
        antardashas = []
        start_index = YOGINI_ORDER.index(main_yogini)
        current_date = start_date
        
        for i in range(8):
            antar_yogini = YOGINI_ORDER[(start_index + i) % 8]
            antar_years = (years * YOGINI_YEARS[antar_yogini]) / YOGINI_TOTAL
            antar_days = antar_years * 365.25
            
            end_date = current_date + timedelta(days=antar_days)
            
            antardashas.append({
                'yogini': antar_yogini,
                'planet': YOGINI_PLANETS[antar_yogini],
                'start': current_date,
                'end': end_date,
                'days': round(antar_days, 1),
                'nature': self.YOGINI_INFO[antar_yogini]['nature'],
            })
            
            current_date = end_date
        
        return antardashas
    
    def get_current_dasha(self, query_date: datetime = None) -> Dict:
        """Get current running Yogini dasha"""
        if query_date is None:
            query_date = datetime.now()
        
        mahadashas = self.calculate_mahadasha_periods()
        
        current_maha = None
        for maha in mahadashas:
            if maha['start'] <= query_date < maha['end']:
                current_maha = maha
                break
        
        if not current_maha:
            return {'error': 'Date outside range'}
        
        # Get antardashas
        antardashas = self.calculate_antardasha(
            current_maha['yogini'],
            current_maha['start'],
            current_maha['years']
        )
        
        current_antar = None
        for antar in antardashas:
            if antar['start'] <= query_date < antar['end']:
                current_antar = antar
                break
        
        if not current_antar:
            current_antar = antardashas[0]
        
        return {
            'system': 'Yogini',
            'query_date': query_date.isoformat(),
            'mahadasha': {
                'yogini': current_maha['yogini'],
                'planet': current_maha['planet'],
                'nature': current_maha['nature'],
                'start': current_maha['start'].isoformat(),
                'end': current_maha['end'].isoformat(),
                'years_total': current_maha['years'],
            },
            'antardasha': {
                'yogini': current_antar['yogini'],
                'planet': current_antar['planet'],
                'nature': current_antar['nature'],
                'start': current_antar['start'].isoformat(),
                'end': current_antar['end'].isoformat(),
            },
            'dasha_string': f"{current_maha['yogini']}-{current_antar['yogini']}",
            'combined_nature': self._combine_natures(current_maha['nature'], current_antar['nature']),
        }
    
    def _combine_natures(self, nature1: str, nature2: str) -> str:
        """Combine two yogini natures"""
        if nature1 == 'Auspicious' and nature2 == 'Auspicious':
            return 'Very Favorable'
        elif nature1 == 'Inauspicious' and nature2 == 'Inauspicious':
            return 'Challenging'
        else:
            return 'Mixed Results'
    
    def compare_with_vimshottari(self, vimshottari_dasha: Dict) -> Dict:
        """Compare Yogini results with Vimshottari"""
        yogini = self.get_current_dasha()
        
        return {
            'yogini': {
                'main': yogini['mahadasha']['yogini'],
                'planet': yogini['mahadasha']['planet'],
                'nature': yogini['mahadasha']['nature'],
            },
            'vimshottari': {
                'main': vimshottari_dasha.get('mahadasha', {}).get('lord'),
            },
            'agreement': yogini['mahadasha']['planet'] == vimshottari_dasha.get('mahadasha', {}).get('lord'),
            'interpretation': self._interpret_comparison(yogini, vimshottari_dasha),
        }
    
    def _interpret_comparison(self, yogini: Dict, vimshottari: Dict) -> str:
        """Interpret comparison between two dasha systems"""
        yogini_nature = yogini['mahadasha']['nature']
        
        if yogini_nature == 'Auspicious':
            return 'Yogini indicates favorable immediate results'
        elif yogini_nature == 'Inauspicious':
            return 'Yogini indicates some challenges in the short term'
        else:
            return 'Mixed influences indicated by Yogini'


# Convenience function
def calculate_yogini(moon_longitude: float, birth_datetime: datetime) -> Dict:
    """Quick function to calculate current Yogini dasha"""
    calculator = YoginiDasha(moon_longitude, birth_datetime)
    return calculator.get_current_dasha()
