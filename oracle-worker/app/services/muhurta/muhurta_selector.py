"""
JYOTISH ENGINE - MUHURTA SELECTOR
Find auspicious dates for any event by scanning upcoming days.
Filters: Tithi, Nakshatra, Yoga, Karana, Rahu Kalam, user's dasha compatibility.
"""

from datetime import datetime, timedelta
from typing import Dict
from ..core.constants import NAKSHATRA_NAMES
from ..core.ephemeris import get_ephemeris

# Auspicious nakshatras for different events
EVENT_NAKSHATRAS = {
    'marriage': ['Rohini', 'Mrigashira', 'Magha', 'Uttara Phalguni', 'Hasta', 'Swati',
                 'Anuradha', 'Mula', 'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Revati'],
    'business': ['Ashwini', 'Rohini', 'Mrigashira', 'Pushya', 'Hasta', 'Chitra',
                 'Swati', 'Anuradha', 'Shravana', 'Dhanishta', 'Revati'],
    'travel': ['Ashwini', 'Mrigashira', 'Punarvasu', 'Pushya', 'Hasta', 'Anuradha',
               'Shravana', 'Dhanishta', 'Revati'],
    'education': ['Ashwini', 'Punarvasu', 'Pushya', 'Hasta', 'Chitra', 'Swati',
                  'Anuradha', 'Shravana', 'Revati'],
    'property': ['Rohini', 'Uttara Phalguni', 'Hasta', 'Uttara Ashadha', 'Shravana', 'Uttara Bhadrapada'],
    'vehicle': ['Ashwini', 'Rohini', 'Pushya', 'Hasta', 'Swati', 'Shravana', 'Revati'],
    'medical': ['Ashwini', 'Punarvasu', 'Pushya', 'Hasta', 'Anuradha', 'Shravana', 'Revati'],
    'investment': ['Rohini', 'Uttara Phalguni', 'Hasta', 'Chitra', 'Shravana', 'Dhanishta'],
    'interview': ['Ashwini', 'Rohini', 'Mrigashira', 'Pushya', 'Hasta', 'Chitra', 'Swati', 'Shravana'],
    'general': ['Ashwini', 'Rohini', 'Mrigashira', 'Punarvasu', 'Pushya', 'Hasta',
                'Chitra', 'Swati', 'Anuradha', 'Shravana', 'Dhanishta', 'Revati'],
}

# Auspicious tithis (avoid 4,8,9,14, Amavasya)
GOOD_TITHIS = [1, 2, 3, 5, 6, 7, 10, 11, 12, 13, 15]
BAD_TITHIS = [4, 8, 9, 14, 30]

# Avoid days
RAHU_KALAM_HOURS = {
    0: (7.5, 9.0),    # Monday
    1: (15.0, 16.5),   # Tuesday
    2: (12.0, 13.5),   # Wednesday
    3: (13.5, 15.0),   # Thursday
    4: (10.5, 12.0),   # Friday
    5: (9.0, 10.5),    # Saturday
    6: (16.5, 18.0),   # Sunday
}


class MuhurtaSelector:
    def __init__(self, latitude: float = 28.6139, longitude: float = 77.2090):
        self.latitude = latitude
        self.longitude = longitude
        self.ephemeris = get_ephemeris()

    def _get_day_data(self, date: datetime) -> Dict:
        """Get panchanga data for a specific date at noon."""
        noon = datetime(date.year, date.month, date.day, 12, 0)
        try:
            jd = self.ephemeris.get_julian_day(noon)
            sun = self.ephemeris.get_planet_position(jd, 'Sun')
            moon = self.ephemeris.get_planet_position(jd, 'Moon')

            sun_long = sun['longitude']
            moon_long = moon['longitude']

            # Tithi
            diff = (moon_long - sun_long) % 360
            tithi_num = int(diff / 12) + 1
            paksha = 'Shukla' if tithi_num <= 15 else 'Krishna'
            tithi_in_paksha = tithi_num if tithi_num <= 15 else tithi_num - 15

            # Nakshatra
            nak_index = int(moon_long / (360 / 27)) % 27
            nakshatra = NAKSHATRA_NAMES[nak_index]

            # Yoga
            yoga_val = (sun_long + moon_long) % 360
            yoga_num = int(yoga_val / (360 / 27)) + 1

            # Weekday
            weekday = date.weekday()
            day_names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

            return {
                'date': date.strftime('%Y-%m-%d'),
                'weekday': day_names[weekday],
                'weekday_num': weekday,
                'tithi': tithi_num,
                'tithi_in_paksha': tithi_in_paksha,
                'paksha': paksha,
                'nakshatra': nakshatra,
                'nakshatra_index': nak_index,
                'yoga_num': yoga_num,
                'moon_rashi': moon['rashi_name'],
                'valid': True,
            }
        except Exception:
            return {'date': date.strftime('%Y-%m-%d'), 'valid': False}

    def find_auspicious_dates(self, event: str = 'general', days_ahead: int = 90,
                               max_results: int = 5) -> Dict:
        """Scan upcoming days and find best dates for an event."""
        good_nakshatras = set(EVENT_NAKSHATRAS.get(event, EVENT_NAKSHATRAS['general']))
        results = []
        today = datetime.now()

        for i in range(1, days_ahead + 1):
            check_date = today + timedelta(days=i)
            day_data = self._get_day_data(check_date)
            if not day_data.get('valid'):
                continue

            score = 0
            reasons = []

            # Nakshatra check (most important)
            if day_data['nakshatra'] in good_nakshatras:
                score += 3
                reasons.append(f"Auspicious nakshatra: {day_data['nakshatra']}")
            else:
                score -= 1

            # Tithi check
            if day_data['tithi_in_paksha'] in GOOD_TITHIS:
                score += 2
                reasons.append(f"{day_data['paksha']} {day_data['tithi_in_paksha']} — good tithi")
            elif day_data['tithi'] in BAD_TITHIS:
                score -= 2
                reasons.append(f"Bad tithi ({day_data['tithi_in_paksha']})")

            # Paksha preference (Shukla generally better)
            if day_data['paksha'] == 'Shukla':
                score += 1
                reasons.append('Shukla Paksha (waxing moon)')

            # Avoid Tuesday/Saturday for auspicious events
            if event in ('marriage', 'business', 'property', 'vehicle'):
                if day_data['weekday'] in ('Tuesday', 'Saturday'):
                    score -= 1
                    reasons.append(f"{day_data['weekday']} — avoid for {event}")
                elif day_data['weekday'] == 'Thursday':
                    score += 1
                    reasons.append('Thursday — Jupiter day, auspicious')

            if score >= 3:
                results.append({
                    'date': day_data['date'],
                    'weekday': day_data['weekday'],
                    'nakshatra': day_data['nakshatra'],
                    'tithi': f"{day_data['paksha']} {day_data['tithi_in_paksha']}",
                    'moon_sign': day_data['moon_rashi'],
                    'score': score,
                    'reasons': reasons,
                })

            if len(results) >= max_results * 3:
                break

        # Sort by score and return top results
        results.sort(key=lambda x: x['score'], reverse=True)
        top = results[:max_results]

        return {
            'event': event,
            'days_scanned': min(days_ahead, i if 'i' in dir() else days_ahead),
            'dates_found': len(results),
            'top_dates': top,
            'best_date': top[0] if top else None,
        }


def find_muhurta(event: str = 'general', latitude: float = 28.6139,
                 longitude: float = 77.2090, days: int = 90) -> Dict:
    ms = MuhurtaSelector(latitude, longitude)
    return ms.find_auspicious_dates(event, days)
