"""
JYOTISH ENGINE - TIME-BASED SYSTEMS
- Choghadiya (sub-muhurta periods)
- Hora (planetary hours)
- Abhijit Muhurta (universal auspicious window)
- Tithi-based personality and predictions
"""

from datetime import datetime
from typing import Dict

# Choghadiya names and nature
CHOGHADIYA_DAY = {
    0: [('Udveg', 'Sun', 'Bad'), ('Char', 'Venus', 'Good'), ('Labh', 'Mercury', 'Good'),
        ('Amrit', 'Moon', 'Best'), ('Kaal', 'Saturn', 'Bad'), ('Shubh', 'Jupiter', 'Good'),
        ('Rog', 'Mars', 'Bad'), ('Udveg', 'Sun', 'Bad')],
    1: [('Char', 'Venus', 'Good'), ('Labh', 'Mercury', 'Good'), ('Amrit', 'Moon', 'Best'),
        ('Kaal', 'Saturn', 'Bad'), ('Shubh', 'Jupiter', 'Good'), ('Rog', 'Mars', 'Bad'),
        ('Udveg', 'Sun', 'Bad'), ('Char', 'Venus', 'Good')],
    2: [('Labh', 'Mercury', 'Good'), ('Amrit', 'Moon', 'Best'), ('Kaal', 'Saturn', 'Bad'),
        ('Shubh', 'Jupiter', 'Good'), ('Rog', 'Mars', 'Bad'), ('Udveg', 'Sun', 'Bad'),
        ('Char', 'Venus', 'Good'), ('Labh', 'Mercury', 'Good')],
    3: [('Amrit', 'Moon', 'Best'), ('Kaal', 'Saturn', 'Bad'), ('Shubh', 'Jupiter', 'Good'),
        ('Rog', 'Mars', 'Bad'), ('Udveg', 'Sun', 'Bad'), ('Char', 'Venus', 'Good'),
        ('Labh', 'Mercury', 'Good'), ('Amrit', 'Moon', 'Best')],
    4: [('Shubh', 'Jupiter', 'Good'), ('Rog', 'Mars', 'Bad'), ('Udveg', 'Sun', 'Bad'),
        ('Char', 'Venus', 'Good'), ('Labh', 'Mercury', 'Good'), ('Amrit', 'Moon', 'Best'),
        ('Kaal', 'Saturn', 'Bad'), ('Shubh', 'Jupiter', 'Good')],
    5: [('Rog', 'Mars', 'Bad'), ('Udveg', 'Sun', 'Bad'), ('Char', 'Venus', 'Good'),
        ('Labh', 'Mercury', 'Good'), ('Amrit', 'Moon', 'Best'), ('Kaal', 'Saturn', 'Bad'),
        ('Shubh', 'Jupiter', 'Good'), ('Rog', 'Mars', 'Bad')],
    6: [('Kaal', 'Saturn', 'Bad'), ('Shubh', 'Jupiter', 'Good'), ('Rog', 'Mars', 'Bad'),
        ('Udveg', 'Sun', 'Bad'), ('Char', 'Venus', 'Good'), ('Labh', 'Mercury', 'Good'),
        ('Amrit', 'Moon', 'Best'), ('Kaal', 'Saturn', 'Bad')],
}

# Planetary hours sequence
HORA_SEQUENCE = ['Sun', 'Venus', 'Mercury', 'Moon', 'Saturn', 'Jupiter', 'Mars']
DAY_START_HORA = {6: 'Sun', 0: 'Moon', 1: 'Mars', 2: 'Mercury', 3: 'Jupiter', 4: 'Venus', 5: 'Saturn'}

# Birth Tithi personality
TITHI_PERSONALITY = {
    1: {'name': 'Pratipada', 'nature': 'Unstable', 'personality': 'Pioneering, restless, initiator, but inconsistent'},
    2: {'name': 'Dwitiya', 'nature': 'Stable', 'personality': 'Nurturing, family-oriented, wealth-conscious, artistic'},
    3: {'name': 'Tritiya', 'nature': 'Stable', 'personality': 'Courageous, adventurous, siblings important, communicator'},
    4: {'name': 'Chaturthi', 'nature': 'Unstable', 'personality': 'Aggressive, argumentative, but conquers obstacles'},
    5: {'name': 'Panchami', 'nature': 'Stable', 'personality': 'Intelligent, creative, romantic, fond of learning'},
    6: {'name': 'Shashthi', 'nature': 'Stable', 'personality': 'Victorious over enemies, health-conscious, competitive'},
    7: {'name': 'Saptami', 'nature': 'Stable', 'personality': 'Partnership-oriented, diplomatic, travels frequently'},
    8: {'name': 'Ashtami', 'nature': 'Unstable', 'personality': 'Transformative, secretive, occult interest, struggles then rises'},
    9: {'name': 'Navami', 'nature': 'Unstable', 'personality': 'Aggressive, creates enemies, but dharmic warrior'},
    10: {'name': 'Dashami', 'nature': 'Stable', 'personality': 'Career-focused, authoritative, righteous, famous'},
    11: {'name': 'Ekadashi', 'nature': 'Stable', 'personality': 'Devoted, fasting ability, gains, friends help, spiritual'},
    12: {'name': 'Dwadashi', 'nature': 'Stable', 'personality': 'Generous, charitable, spiritual, expenses on good causes'},
    13: {'name': 'Trayodashi', 'nature': 'Stable', 'personality': 'Lucky, victorious, friendships, social, joyful'},
    14: {'name': 'Chaturdashi', 'nature': 'Unstable', 'personality': 'Fierce, angry, but extremely talented, destroys opposition'},
    15: {'name': 'Purnima', 'nature': 'Stable', 'personality': 'Complete, luminous, popular, emotional, public figure'},
    30: {'name': 'Amavasya', 'nature': 'Unstable', 'personality': 'Introspective, hidden power, spiritual, ancestors connection'},
}


def _hhmm(h: float) -> str:
    h = h % 24
    m = int(round(h * 60))
    return f"{(m // 60) % 24:02d}:{m % 60:02d}"


def hora_at(local: datetime, sunrise: float = 6.0, sunset: float = 18.0) -> Dict:
    """The planetary hour at a LOCAL moment, on that place's real sunrise and sunset.

    A hora is a twelfth of the day (sunrise to sunset) or of the night (sunset to
    the next sunrise), not a clock hour. The day's first hora belongs to its
    weekday lord and each next one follows the Chaldean order in HORA_SEQUENCE.
    Before sunrise it is still the previous day's night. Two implementations used
    to disagree with each other and with this: one counted clock hours from a
    06:00 sunrise, the other also stepped through the WEEKDAY order instead of the
    hora order, and both read the server's clock as the reader's local time."""
    cur = local.hour + local.minute / 60 + local.second / 3600
    day_len = max(min(sunset - sunrise, 23.9), 0.1)
    night_len = 24 - day_len
    weekday = local.weekday()
    if sunrise <= cur < sunset:
        seg, elapsed, base = day_len / 12, cur - sunrise, 0
        start0 = sunrise
    else:
        if cur < sunrise:
            weekday = (weekday - 1) % 7
            elapsed = cur + 24 - sunset
        else:
            elapsed = cur - sunset
        seg, base, start0 = night_len / 12, 12, sunset
    j = min(int(elapsed / seg), 11)
    k = base + j
    day_lord = DAY_START_HORA[weekday]
    lord = HORA_SEQUENCE[(HORA_SEQUENCE.index(day_lord) + k) % 7]
    start = start0 + j * seg
    return {
        "lord": lord, "day_lord": day_lord, "number": k + 1, "is_day": k < 12,
        "start": _hhmm(start), "end": _hhmm(start + seg),
        "minutes_remaining": max(0, int(round(((j + 1) * seg - elapsed) * 60))),
    }


class TimeSystems:
    def __init__(self, date: datetime = None, latitude: float = 28.6139,
                 sunrise_hour: float = None, sunset_hour: float = None):
        # `date` is LOCAL time at the place the sunrise belongs to. Callers that know
        # the place pass its real sunrise and sunset (muhurta/suntimes.py); 06:00 and
        # 18:00 remain only as the fallback for callers that do not.
        self.date = date or datetime.now()
        self.latitude = latitude
        self.sunrise_hour = 6.0 if sunrise_hour is None else float(sunrise_hour)
        self.sunset_hour = 18.0 if sunset_hour is None else float(sunset_hour)

    def get_choghadiya(self) -> Dict:
        """Get current and upcoming Choghadiya periods."""
        weekday = self.date.weekday()
        day_chog = CHOGHADIYA_DAY.get(weekday, CHOGHADIYA_DAY[0])

        day_duration = (self.sunset_hour - self.sunrise_hour) / 8  # 8 periods in day
        current_hour = self.date.hour + self.date.minute / 60

        periods = []
        current_period = None
        for i, (name, lord, nature) in enumerate(day_chog):
            start = self.sunrise_hour + (i * day_duration)
            end = start + day_duration
            period = {
                'name': name, 'lord': lord, 'nature': nature,
                'start': f'{int(start):02d}:{int((start % 1) * 60):02d}',
                'end': f'{int(end):02d}:{int((end % 1) * 60):02d}',
                'is_current': start <= current_hour < end,
            }
            periods.append(period)
            if period['is_current']:
                current_period = period

        return {
            'current': current_period,
            'periods': periods,
            'date': self.date.strftime('%Y-%m-%d'),
        }

    def get_hora(self) -> Dict:
        """Get current planetary hour (Hora) — see hora_at."""
        h = hora_at(self.date, self.sunrise_hour, self.sunset_hour)
        current_planet = h["lord"]

        good_for = {
            'Sun': 'Government work, authority matters, father',
            'Moon': 'Travel, public dealings, mother, emotions',
            'Mars': 'Surgery, competition, property, courage',
            'Mercury': 'Business, communication, writing, study',
            'Jupiter': 'Religious acts, teaching, legal, finance',
            'Venus': 'Romance, arts, beauty, luxury purchases',
            'Saturn': 'Labor, discipline, mining, serving poor',
        }

        return {
            'current_hora': current_planet,
            'good_for': good_for.get(current_planet, ''),
            'hora_number': h['number'],
            'day_lord': h['day_lord'],
            'start': h['start'],
            'end': h['end'],
            'minutes_remaining': h['minutes_remaining'],
            'is_day': h['is_day'],
        }

    def get_abhijit_muhurta(self) -> Dict:
        """
        Abhijit Muhurta — the universally auspicious 48-minute window.
        Occurs around local noon (11:36 AM to 12:24 PM approximately).
        """
        # The 8th of the day's 15 muhurtas, on the real sunrise and sunset.
        muhurta = (self.sunset_hour - self.sunrise_hour) / 15
        abhijit_start = self.sunrise_hour + 7 * muhurta
        abhijit_end = abhijit_start + muhurta

        current_hour = self.date.hour + self.date.minute / 60
        is_active = abhijit_start <= current_hour <= abhijit_end

        return {
            'start': _hhmm(abhijit_start),
            'end': _hhmm(abhijit_end),
            'is_active': is_active,
            'description': 'Universally auspicious window — good for any new beginning',
            'note': 'Abhijit Muhurta overrides most inauspicious factors',
        }

    def get_tithi_personality(self, tithi_number: int) -> Dict:
        """Get personality profile based on birth Tithi."""
        if tithi_number > 15:
            tithi_number = tithi_number - 15  # Krishna Paksha maps to same tithis
        data = TITHI_PERSONALITY.get(tithi_number, TITHI_PERSONALITY[1])
        return data

    def generate_daily_timing(self) -> Dict:
        return {
            'date': self.date.strftime('%Y-%m-%d %H:%M'),
            'choghadiya': self.get_choghadiya(),
            'hora': self.get_hora(),
            'abhijit_muhurta': self.get_abhijit_muhurta(),
        }


def get_daily_timing(date: datetime = None) -> Dict:
    ts = TimeSystems(date)
    return ts.generate_daily_timing()
