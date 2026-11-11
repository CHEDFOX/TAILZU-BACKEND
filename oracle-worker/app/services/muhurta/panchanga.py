"""
JYOTISH ENGINE - PANCHANGA & MUHURTA
Five limbs of time + Electional astrology
"""

from datetime import datetime
from typing import Dict, List
from ..core.constants import (
    TITHIS, VARAS, VARA_LORDS, YOGAS_PANCHANGA,
    NAKSHATRAS
)
from ..core.utils import get_nakshatra_from_longitude


class Panchanga:
    """
    Calculate Panchanga (5 limbs of time)
    
    1. Tithi - Lunar day (30 per month)
    2. Vara - Weekday (7)
    3. Nakshatra - Lunar mansion (27)
    4. Yoga - Luni-solar combination (27)
    5. Karana - Half-tithi (11 types, 60 per month)
    """
    
    def __init__(self, sun_longitude: float, moon_longitude: float, 
                 datetime_obj: datetime):
        """
        Initialize with Sun/Moon positions and datetime
        """
        self.sun_long = sun_longitude
        self.moon_long = moon_longitude
        self.dt = datetime_obj
    
    def calculate_tithi(self) -> Dict:
        """
        Calculate Tithi (Lunar Day)
        Tithi = (Moon - Sun) / 12
        30 tithis per lunar month
        """
        diff = (self.moon_long - self.sun_long) % 360
        tithi_num = int(diff / 12) + 1
        
        # Determine paksha (fortnight)
        if tithi_num <= 15:
            paksha = 'Shukla'  # Waxing
            tithi_in_paksha = tithi_num
        else:
            paksha = 'Krishna'  # Waning
            tithi_in_paksha = tithi_num - 15
        
        tithi_name = TITHIS[tithi_num - 1]
        
        # Tithi characteristics
        characteristics = {
            1: {'nature': 'Good', 'activity': 'New beginnings'},
            2: {'nature': 'Good', 'activity': 'Auspicious works'},
            3: {'nature': 'Good', 'activity': 'Aggressive actions'},
            4: {'nature': 'Bad', 'activity': 'Avoid important work'},
            5: {'nature': 'Good', 'activity': 'Lakshmi puja, wealth'},
            6: {'nature': 'Mixed', 'activity': 'Enemies, conflicts'},
            7: {'nature': 'Good', 'activity': 'Travel, vehicles'},
            8: {'nature': 'Bad', 'activity': 'Avoid important work'},
            9: {'nature': 'Bad', 'activity': 'Aggressive actions only'},
            10: {'nature': 'Good', 'activity': 'All auspicious works'},
            11: {'nature': 'Good', 'activity': 'Fasting, spiritual'},
            12: {'nature': 'Mixed', 'activity': 'Charity, donations'},
            13: {'nature': 'Good', 'activity': 'Friendship, love'},
            14: {'nature': 'Bad', 'activity': 'Avoid major decisions'},
            15: {'nature': 'Good', 'activity': 'Full/New Moon day'},
        }
        
        char_key = tithi_in_paksha
        char = characteristics.get(char_key, {'nature': 'Mixed', 'activity': 'General'})
        
        return {
            'tithi_number': tithi_num,
            'tithi_in_paksha': tithi_in_paksha,
            'tithi_name': tithi_name,
            'paksha': paksha,
            'nature': char['nature'],
            'recommended_activity': char['activity'],
        }
    
    def calculate_vara(self) -> Dict:
        """
        Calculate Vara (Weekday)
        """
        weekday = self.dt.weekday()
        # Python: Monday=0, Vedic: Sunday=0
        vedic_weekday = (weekday + 1) % 7
        
        vara_name = VARAS[vedic_weekday]
        vara_lord = VARA_LORDS[vedic_weekday]
        
        # Vara characteristics
        vara_nature = {
            0: {'nature': 'Malefic-Benefic', 'good_for': 'Authority, father, health'},
            1: {'nature': 'Benefic', 'good_for': 'Mind, mother, travel'},
            2: {'nature': 'Malefic', 'good_for': 'War, surgery, aggression'},
            3: {'nature': 'Benefic', 'good_for': 'Education, business, communication'},
            4: {'nature': 'Benefic', 'good_for': 'Marriage, religion, wealth'},
            5: {'nature': 'Benefic', 'good_for': 'Love, arts, luxury'},
            6: {'nature': 'Malefic', 'good_for': 'Hard work, discipline'},
        }
        
        char = vara_nature.get(vedic_weekday, {})
        
        return {
            'vara': vara_name,
            'vara_lord': vara_lord,
            'vedic_weekday': vedic_weekday,
            'nature': char.get('nature', 'Mixed'),
            'good_for': char.get('good_for', ''),
        }
    
    def calculate_nakshatra(self) -> Dict:
        """
        Calculate Nakshatra (Lunar Mansion)
        Based on Moon's position
        """
        nakshatra_num = get_nakshatra_from_longitude(self.moon_long)
        nakshatra = NAKSHATRAS[nakshatra_num]
        
        # Calculate pada
        nakshatra_span = 360 / 27
        degree_in_nakshatra = self.moon_long % nakshatra_span
        pada = int(degree_in_nakshatra / (nakshatra_span / 4)) + 1
        
        return {
            'nakshatra_number': nakshatra_num + 1,
            'nakshatra_name': nakshatra['name'],
            'nakshatra_lord': nakshatra['ruler'],
            'pada': pada,
            'deity': nakshatra['deity'],
            'gana': nakshatra['gana'],
            'nature': 'Auspicious' if nakshatra['gana'] == 'Deva' else 
                     'Mixed' if nakshatra['gana'] == 'Manushya' else 'Challenging',
        }
    
    def calculate_yoga(self) -> Dict:
        """
        Calculate Yoga (Luni-Solar Combination)
        Yoga = (Sun + Moon) / (360/27)
        27 yogas
        """
        total = (self.sun_long + self.moon_long) % 360
        yoga_num = int(total / (360 / 27))
        
        yoga_name = YOGAS_PANCHANGA[yoga_num]
        
        # Yoga natures
        auspicious_yogas = [
            'Priti', 'Ayushman', 'Saubhagya', 'Shobhana', 'Sukarma',
            'Dhriti', 'Harshana', 'Siddhi', 'Shiva', 'Siddha',
            'Sadhya', 'Shubha', 'Shukla', 'Brahma', 'Indra'
        ]
        
        inauspicious_yogas = [
            'Vishkumbha', 'Atiganda', 'Shula', 'Ganda', 'Vyaghata',
            'Vajra', 'Vyatipata', 'Parigha', 'Vaidhriti'
        ]
        
        if yoga_name in auspicious_yogas:
            nature = 'Auspicious'
        elif yoga_name in inauspicious_yogas:
            nature = 'Inauspicious'
        else:
            nature = 'Mixed'
        
        return {
            'yoga_number': yoga_num + 1,
            'yoga_name': yoga_name,
            'nature': nature,
        }
    
    def calculate_karana(self) -> Dict:
        """
        Calculate Karana (Half-Tithi)
        60 karanas per lunar month
        """
        diff = (self.moon_long - self.sun_long) % 360
        karana_num = int(diff / 6)  # Each karana = 6 degrees
        
        # Karana names cycle
        # First karana of Shukla Pratipada is always Kimstughna
        # Then 7 movable karanas repeat: Bava, Balava, Kaulava, Taitila, Gara, Vanija, Vishti
        # Last 4 are fixed: Shakuni, Chatushpada, Naga, Kimstughna
        
        if karana_num == 0:
            karana_name = 'Kimstughna'
        elif karana_num >= 57:
            fixed_karanas = ['Shakuni', 'Chatushpada', 'Naga', 'Kimstughna']
            karana_name = fixed_karanas[karana_num - 57]
        else:
            movable_karanas = ['Bava', 'Balava', 'Kaulava', 'Taitila', 'Gara', 'Vanija', 'Vishti']
            karana_name = movable_karanas[(karana_num - 1) % 7]
        
        # Vishti (Bhadra) karana is inauspicious
        nature = 'Inauspicious' if karana_name == 'Vishti' else 'Auspicious'
        
        return {
            'karana_number': karana_num + 1,
            'karana_name': karana_name,
            'nature': nature,
        }
    
    def get_full_panchanga(self) -> Dict:
        """Get complete Panchanga"""
        return {
            'datetime': self.dt.isoformat(),
            'tithi': self.calculate_tithi(),
            'vara': self.calculate_vara(),
            'nakshatra': self.calculate_nakshatra(),
            'yoga': self.calculate_yoga(),
            'karana': self.calculate_karana(),
        }


class Muhurta:
    """
    Muhurta (Electional Astrology) calculations
    Find auspicious times for activities
    """
    
    # Inauspicious periods
    RAHU_KALAM = {
        0: (4.5, 6.0),    # Sunday: 4:30 PM - 6:00 PM
        1: (7.5, 9.0),    # Monday: 7:30 AM - 9:00 AM
        2: (15.0, 16.5),  # Tuesday: 3:00 PM - 4:30 PM
        3: (12.0, 13.5),  # Wednesday: 12:00 PM - 1:30 PM
        4: (13.5, 15.0),  # Thursday: 1:30 PM - 3:00 PM
        5: (10.5, 12.0),  # Friday: 10:30 AM - 12:00 PM
        6: (9.0, 10.5),   # Saturday: 9:00 AM - 10:30 AM
    }
    
    YAMAGANDA = {
        0: (12.0, 13.5),  # Sunday
        1: (10.5, 12.0),  # Monday
        2: (9.0, 10.5),   # Tuesday
        3: (7.5, 9.0),    # Wednesday
        4: (6.0, 7.5),    # Thursday
        5: (15.0, 16.5),  # Friday
        6: (13.5, 15.0),  # Saturday
    }
    
    GULIKA = {
        0: (15.0, 16.5),  # Sunday
        1: (13.5, 15.0),  # Monday
        2: (12.0, 13.5),  # Tuesday
        3: (10.5, 12.0),  # Wednesday
        4: (9.0, 10.5),   # Thursday
        5: (7.5, 9.0),    # Friday
        6: (6.0, 7.5),    # Saturday
    }
    
    def __init__(self, date: datetime, sunrise_hour: float = 6.0, sunset_hour: float = None):
        """
        Initialize Muhurta calculator

        Args:
            date: the LOCAL date (its weekday picks the tables)
            sunrise_hour: local sunrise as a decimal hour (6.0 = 06:00)
            sunset_hour: local sunset as a decimal hour; None = sunrise + 12

        The classical tables above are written for a 06:00–18:00 day. Each period
        is one EIGHTH of the real day (sunrise → sunset), so the tables are read as
        segment indices and rebuilt on the real span — that is how a printed
        panchang arrives at its hours, and the only way the app's agree with it.
        """
        self.date = date
        self.sunrise = float(sunrise_hour)
        self.sunset = float(sunset_hour) if sunset_hour is not None else self.sunrise + 12.0
        if self.sunset <= self.sunrise:
            self.sunset = self.sunrise + 12.0
        self.day_length = self.sunset - self.sunrise
        self.part = self.day_length / 8.0
        self.weekday = (date.weekday() + 1) % 7  # Vedic weekday

    def _segment(self, base: tuple) -> tuple:
        """A (start, end) pair from the 06:00–18:00 tables → real local hours."""
        idx = round((base[0] - 6.0) / 1.5)
        start = self.sunrise + idx * self.part
        return start, start + self.part

    def get_rahu_kalam(self) -> Dict:
        """Get Rahu Kalam (inauspicious period)"""
        start, end = self._segment(self.RAHU_KALAM[self.weekday])
        
        return {
            'name': 'Rahu Kalam',
            'start_hour': start,
            'end_hour': end,
            'start_time': self._hour_to_time(start),
            'end_time': self._hour_to_time(end),
            'is_inauspicious': True,
            'avoid': 'New ventures, auspicious activities',
        }
    
    def get_yamaganda(self) -> Dict:
        """Get Yamaganda (inauspicious period)"""
        start, end = self._segment(self.YAMAGANDA[self.weekday])
        
        return {
            'name': 'Yamaganda',
            'start_hour': start,
            'end_hour': end,
            'start_time': self._hour_to_time(start),
            'end_time': self._hour_to_time(end),
            'is_inauspicious': True,
            'avoid': 'Travel, important decisions',
        }
    
    def get_gulika(self) -> Dict:
        """Get Gulika Kalam (inauspicious period)"""
        start, end = self._segment(self.GULIKA[self.weekday])
        
        return {
            'name': 'Gulika Kalam',
            'start_hour': start,
            'end_hour': end,
            'start_time': self._hour_to_time(start),
            'end_time': self._hour_to_time(end),
            'is_inauspicious': True,
            'avoid': 'Auspicious ceremonies',
        }
    
    def get_abhijit_muhurta(self) -> Dict:
        """
        Get Abhijit Muhurta (most auspicious)
        Middle 48 minutes around local noon
        """
        # The eighth of the day's fifteen muhurtas: one fifteenth of the real day,
        # centred on local midday (sunrise + half the day).
        noon = self.sunrise + self.day_length / 2.0
        half = self.day_length / 30.0
        start = noon - half
        end = noon + half

        return {
            'name': 'Abhijit Muhurta',
            'start_hour': start,
            'end_hour': end,
            'start_time': self._hour_to_time(start),
            'end_time': self._hour_to_time(end),
            'is_auspicious': True,
            'good_for': 'All auspicious activities, overrides other doshas',
        }
    
    def _hour_to_time(self, hour: float) -> str:
        """Convert decimal hour to time string"""
        h = int(hour)
        m = int((hour - h) * 60)
        return f"{h:02d}:{m:02d}"
    
    def is_time_auspicious(self, hour: float) -> Dict:
        """Check if a specific time is auspicious"""
        rahu = self.get_rahu_kalam()
        yama = self.get_yamaganda()
        gulika = self.get_gulika()
        abhijit = self.get_abhijit_muhurta()
        
        in_rahu = rahu['start_hour'] <= hour < rahu['end_hour']
        in_yama = yama['start_hour'] <= hour < yama['end_hour']
        in_gulika = gulika['start_hour'] <= hour < gulika['end_hour']
        in_abhijit = abhijit['start_hour'] <= hour < abhijit['end_hour']
        
        if in_abhijit:
            return {'is_auspicious': True, 'reason': 'Abhijit Muhurta', 'strength': 'Excellent'}
        elif in_rahu:
            return {'is_auspicious': False, 'reason': 'Rahu Kalam', 'strength': 'Avoid'}
        elif in_yama:
            return {'is_auspicious': False, 'reason': 'Yamaganda', 'strength': 'Avoid'}
        elif in_gulika:
            return {'is_auspicious': False, 'reason': 'Gulika Kalam', 'strength': 'Avoid'}
        else:
            return {'is_auspicious': True, 'reason': 'No dosha', 'strength': 'Good'}
    
    def get_all_muhurtas(self) -> Dict:
        """Get all muhurta information for the day"""
        return {
            'date': self.date.strftime('%Y-%m-%d'),
            'weekday': VARAS[self.weekday],
            'sunrise': self._hour_to_time(self.sunrise),
            'sunset': self._hour_to_time(self.sunset),
            'inauspicious': {
                'rahu_kalam': self.get_rahu_kalam(),
                'yamaganda': self.get_yamaganda(),
                'gulika': self.get_gulika(),
            },
            'auspicious': {
                'abhijit': self.get_abhijit_muhurta(),
            },
        }
    
    def find_good_muhurta(self, activity: str = 'general') -> List[Dict]:
        """
        Find good muhurta slots for an activity
        """
        good_slots = []
        
        rahu = self.get_rahu_kalam()
        yama = self.get_yamaganda()
        gulika = self.get_gulika()
        abhijit = self.get_abhijit_muhurta()
        
        # All bad periods
        bad_periods = [
            (rahu['start_hour'], rahu['end_hour']),
            (yama['start_hour'], yama['end_hour']),
            (gulika['start_hour'], gulika['end_hour']),
        ]
        
        # Find good windows between sunrise and sunset
        current = self.sunrise
        end_time = self.sunset
        
        while current < end_time:
            is_bad = False
            for start, end in bad_periods:
                if start <= current < end:
                    is_bad = True
                    current = end
                    break
            
            if not is_bad:
                # Find end of good period
                good_end = end_time
                for start, end in bad_periods:
                    if start > current and start < good_end:
                        good_end = start
                
                is_abhijit = abhijit['start_hour'] <= current < abhijit['end_hour']
                
                good_slots.append({
                    'start': self._hour_to_time(current),
                    'end': self._hour_to_time(good_end),
                    'quality': 'Excellent' if is_abhijit else 'Good',
                    'includes_abhijit': is_abhijit,
                })
                
                current = good_end
            
            current += 0.1  # Small increment to prevent infinite loop
        
        return good_slots


# Convenience functions
def get_panchanga(sun_long: float, moon_long: float, dt: datetime) -> Dict:
    """Quick function to get Panchanga"""
    calc = Panchanga(sun_long, moon_long, dt)
    return calc.get_full_panchanga()

def get_daily_muhurta(date: datetime) -> Dict:
    """Quick function to get daily Muhurta"""
    calc = Muhurta(date)
    return calc.get_all_muhurtas()
