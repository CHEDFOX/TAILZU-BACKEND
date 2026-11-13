"""
JYOTISH ENGINE - TAJIKA / VARSHAPHAL (ANNUAL HOROSCOPE)
Solar return chart + Tajika Yogas + Muntha + Year Lord.

Varshaphal = Chart cast for exact moment Sun returns to birth longitude each year.
Used for annual predictions — "How will 2027 be?"

Includes:
- Solar return chart calculation
- Muntha (progressed point, 1 sign/year)
- Varshesh (Year Lord) determination
- 16 Tajika Yogas
- Annual house strength analysis
- Sahams (Tajika Lots)
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional
from ..core.constants import (
    PLANETS, RASHI_LORDS, RASHI_NAMES,
    KENDRA_HOUSES, TRIKONA_HOUSES, DUSTHANA_HOUSES,
    SEVEN_PLANETS,
)
from ..core.ephemeris import get_ephemeris


# Weekday-based Year Lords (Varshesh)
WEEKDAY_LORDS = {
    0: 'Moon',     # Monday
    1: 'Mars',     # Tuesday
    2: 'Mercury',  # Wednesday
    3: 'Jupiter',  # Thursday
    4: 'Venus',    # Friday
    5: 'Saturn',   # Saturday
    6: 'Sun',      # Sunday
}

# Tajika aspect orbs (degrees)
TAJIKA_ASPECTS = {
    0: {'name': 'Conjunction', 'nature': 'Strong', 'orb': 8},
    60: {'name': 'Sextile', 'nature': 'Friendly', 'orb': 5},
    90: {'name': 'Square', 'nature': 'Inimical', 'orb': 6},
    120: {'name': 'Trine', 'nature': 'Friendly', 'orb': 7},
    180: {'name': 'Opposition', 'nature': 'Inimical', 'orb': 7},
}

# Pancha-vargeeya Bala (5-fold strength in Tajika)
HARSHA_BALA = {
    'Sun': 'Leo', 'Moon': 'Cancer', 'Mars': 'Aries',
    'Mercury': 'Virgo', 'Jupiter': 'Sagittarius',
    'Venus': 'Taurus', 'Saturn': 'Aquarius',
}


class Varshaphal:
    """
    Complete annual horoscope using Tajika system.
    """

    def __init__(self, engine, year: int):
        """
        Args:
            engine: JyotishEngine instance (birth chart)
            year: Year to calculate Varshaphal for (e.g., 2027)
        """
        self.engine = engine
        self.year = year
        self.birth_sun_longitude = engine.planets['Sun']['longitude']
        self.birth_datetime = engine.birth_local
        self.latitude = engine.latitude
        self.longitude = engine.longitude
        self.asc_rashi = engine.ascendant_rashi
        self.ephemeris = get_ephemeris()

        self._solar_return_dt = None
        self._annual_chart = None

    def get_solar_return_datetime(self) -> datetime:
        """
        Find exact moment Sun returns to birth longitude in the given year.
        Uses iterative search with Swiss Ephemeris.
        """
        if self._solar_return_dt is not None:
            return self._solar_return_dt

        target_long = self.birth_sun_longitude
        birth_year = self.birth_datetime.year
        years_elapsed = self.year - birth_year

        # Start searching from approximate date (birthday in target year)
        approx_dt = datetime(
            self.year,
            self.birth_datetime.month,
            min(self.birth_datetime.day, 28),  # Safe day
            self.birth_datetime.hour,
            self.birth_datetime.minute,
        )

        # Iterate to find exact return (binary search)
        dt = approx_dt - timedelta(days=5)  # Start 5 days before
        step = 1.0  # Start with 1-day steps

        best_dt = dt
        best_diff = 999.0

        for precision_round in range(4):
            # Each round increases precision
            if precision_round == 0:
                step, num_steps = 1.0, 20
            elif precision_round == 1:
                step, num_steps = 0.04167, 48  # 1-hour steps
            elif precision_round == 2:
                step, num_steps = 0.00069, 120  # 1-minute steps
            else:
                step, num_steps = 0.0000116, 120  # ~1-second steps

            search_start = best_dt - timedelta(days=step * 2)
            best_diff = 999.0

            for i in range(num_steps):
                check_dt = search_start + timedelta(days=step * i)
                try:
                    jd = self.ephemeris.get_julian_day(check_dt)
                    sun_pos = self.ephemeris.get_planet_position(jd, 'Sun')
                    current_long = sun_pos['longitude']

                    diff = abs(current_long - target_long)
                    if diff > 180:
                        diff = 360 - diff

                    if diff < best_diff:
                        best_diff = diff
                        best_dt = check_dt
                except Exception:
                    continue

        self._solar_return_dt = best_dt
        return best_dt

    def get_annual_chart(self) -> Dict:
        """Generate chart for the solar return moment."""
        if self._annual_chart is not None:
            return self._annual_chart

        sr_dt = self.get_solar_return_datetime()
        jd = self.ephemeris.get_julian_day(sr_dt)

        # Get all planet positions at solar return
        planets = {}
        for planet_name in SEVEN_PLANETS + ['Rahu', 'Ketu']:
            try:
                pos = self.ephemeris.get_planet_position(jd, planet_name)
                rashi = pos.get('rashi', 0)
                # Calculate house from annual ascendant
                planets[planet_name] = pos
            except Exception:
                continue

        # Get ascendant at solar return
        try:
            from ..core.ephemeris import swe
            flags = swe.FLG_SIDEREAL
            houses, angles = swe.houses_ex(jd, self.latitude, self.longitude, b'W', flags)
            asc_long = angles[0]
            asc_rashi = int(asc_long / 30) % 12
        except Exception:
            asc_long = 0.0
            asc_rashi = 0

        # Calculate houses for each planet
        for pname, pdata in planets.items():
            p_rashi = pdata.get('rashi', 0)
            pdata['house'] = ((p_rashi - asc_rashi) % 12) + 1

        self._annual_chart = {
            'datetime': sr_dt.isoformat(),
            'julian_day': jd,
            'ascendant': {
                'longitude': round(asc_long, 4),
                'rashi': asc_rashi,
                'rashi_name': RASHI_NAMES[asc_rashi],
                'degree': round(asc_long % 30, 2),
            },
            'planets': planets,
            'year': self.year,
        }
        return self._annual_chart

    def get_muntha(self) -> Dict:
        """
        Calculate Muntha — progressed point moving 1 sign per year.
        Muntha sign = (Ascendant rashi + years elapsed) mod 12.
        """
        years = self.year - self.birth_datetime.year
        muntha_rashi = (self.asc_rashi + years) % 12
        chart = self.get_annual_chart()
        annual_asc = chart['ascendant']['rashi']
        muntha_house = ((muntha_rashi - annual_asc) % 12) + 1

        # Muntha in Kendra/Trikona = good, in Dusthana = challenging
        if muntha_house in KENDRA_HOUSES + TRIKONA_HOUSES:
            strength = 'Strong'
            effects = 'Favorable year, growth and opportunities'
        elif muntha_house in DUSTHANA_HOUSES:
            strength = 'Weak'
            effects = 'Challenging year, obstacles and health concerns'
        else:
            strength = 'Moderate'
            effects = 'Mixed year, some gains and some struggles'

        muntha_lord = RASHI_LORDS[muntha_rashi]
        lord_house = chart['planets'].get(muntha_lord, {}).get('house', 1)

        return {
            'rashi': muntha_rashi,
            'rashi_name': RASHI_NAMES[muntha_rashi],
            'house': muntha_house,
            'lord': muntha_lord,
            'lord_house': lord_house,
            'strength': strength,
            'effects': effects,
            'years_elapsed': years,
        }

    def get_year_lord(self) -> Dict:
        """
        Determine Varshesh (Year Lord) based on weekday of solar return.
        The Year Lord's strength determines the overall quality of the year.
        """
        sr_dt = self.get_solar_return_datetime()
        weekday = sr_dt.weekday()  # 0=Monday in Python
        year_lord = WEEKDAY_LORDS[weekday]

        chart = self.get_annual_chart()
        lord_data = chart['planets'].get(year_lord, {})
        lord_house = lord_data.get('house', 1)
        lord_rashi = lord_data.get('rashi', 0)

        # Strength assessment
        is_exalted = lord_rashi == PLANETS.get(year_lord, {}).get('exalted')
        is_own = lord_rashi in PLANETS.get(year_lord, {}).get('owns', [])
        is_debilitated = lord_rashi == PLANETS.get(year_lord, {}).get('debilitated')
        in_kendra = lord_house in KENDRA_HOUSES
        in_dusthana = lord_house in DUSTHANA_HOUSES

        if is_exalted or (is_own and in_kendra):
            strength = 'Very Strong'
            prediction = 'Excellent year — success, recognition, achievements'
        elif is_own or in_kendra:
            strength = 'Strong'
            prediction = 'Good year — steady progress, favorable outcomes'
        elif is_debilitated or in_dusthana:
            strength = 'Weak'
            prediction = 'Difficult year — obstacles, delays, health caution needed'
        else:
            strength = 'Moderate'
            prediction = 'Average year — mixed results, effort needed for gains'

        return {
            'planet': year_lord,
            'weekday': sr_dt.strftime('%A'),
            'house': lord_house,
            'rashi': lord_rashi,
            'rashi_name': RASHI_NAMES[lord_rashi],
            'strength': strength,
            'is_exalted': is_exalted,
            'is_own_sign': is_own,
            'is_debilitated': is_debilitated,
            'prediction': prediction,
        }

    def check_tajika_yogas(self) -> List[Dict]:
        """
        Check all 16 Tajika Yogas in the annual chart.
        Based on applying/separating aspects between planets.
        """
        yogas = []
        chart = self.get_annual_chart()
        planets = chart['planets']

        planet_list = [p for p in SEVEN_PLANETS if p in planets]

        for i, p1 in enumerate(planet_list):
            for p2 in planet_list[i+1:]:
                lon1 = planets[p1].get('longitude', 0)
                lon2 = planets[p2].get('longitude', 0)
                speed1 = planets[p1].get('speed', 0)
                speed2 = planets[p2].get('speed', 0)

                diff = abs(lon1 - lon2)
                if diff > 180:
                    diff = 360 - diff

                # Check each Tajika aspect
                for aspect_deg, asp_info in TAJIKA_ASPECTS.items():
                    orb = asp_info['orb']
                    if abs(diff - aspect_deg) <= orb:
                        # Determine if applying or separating
                        faster = p1 if abs(speed1) > abs(speed2) else p2
                        slower = p2 if faster == p1 else p1

                        # Simplified: check if faster planet is approaching slower
                        faster_lon = planets[faster]['longitude']
                        slower_lon = planets[slower]['longitude']
                        applying = self._is_applying(faster_lon, slower_lon, planets[faster].get('speed', 0))

                        yoga = self._classify_tajika_yoga(
                            p1, p2, faster, slower, applying,
                            asp_info, diff, aspect_deg
                        )
                        if yoga:
                            yogas.append(yoga)

        # Check Musaripha (transfer of light)
        musaripha = self._check_musaripha(planets, planet_list)
        yogas.extend(musaripha)

        return yogas

    def _is_applying(self, faster_lon: float, slower_lon: float, speed: float) -> bool:
        """Check if faster planet is approaching slower."""
        diff = slower_lon - faster_lon
        if diff < -180: diff += 360
        if diff > 180: diff -= 360
        return (diff > 0 and speed > 0) or (diff < 0 and speed < 0)

    def _classify_tajika_yoga(self, p1, p2, faster, slower, applying, asp_info, diff, aspect_deg) -> Optional[Dict]:
        """Classify which Tajika Yoga is formed."""
        asp_name = asp_info['name']
        asp_nature = asp_info['nature']

        # 1. Ithasala — applying aspect between two planets (most important)
        if applying and asp_nature in ('Strong', 'Friendly'):
            return {
                'name': 'Ithasala Yoga',
                'type': 'Tajika',
                'planets': [p1, p2],
                'aspect': asp_name,
                'description': f'{faster} applying {asp_name.lower()} to {slower}',
                'effects': f'Success in matters of {faster} and {slower}. Wish fulfillment.',
                'strength': 'Strong' if aspect_deg in (0, 120) else 'Moderate',
                'is_negative': False,
            }

        # 2. Ishrapha — separating aspect (opportunity missed)
        if not applying and asp_nature in ('Strong', 'Friendly'):
            return {
                'name': 'Ishrapha Yoga',
                'type': 'Tajika',
                'planets': [p1, p2],
                'aspect': asp_name,
                'description': f'{faster} separating from {asp_name.lower()} with {slower}',
                'effects': 'Missed opportunity, event that almost happened but slipped away.',
                'strength': 'Moderate',
                'is_negative': True,
            }

        # 3. Nakta — applying aspect but one planet retrograde
        chart = self.get_annual_chart()
        p1_retro = chart['planets'].get(p1, {}).get('retrograde', False)
        p2_retro = chart['planets'].get(p2, {}).get('retrograde', False)

        if applying and (p1_retro or p2_retro) and not (p1_retro and p2_retro):
            return {
                'name': 'Nakta Yoga',
                'type': 'Tajika',
                'planets': [p1, p2],
                'description': f'Applying aspect with retrograde planet ({p1 if p1_retro else p2})',
                'effects': 'Delayed success, event happens after initial setback or reversal.',
                'strength': 'Moderate',
                'is_negative': False,
            }

        # 4. Yamaya — applying inimical aspect
        if applying and asp_nature == 'Inimical':
            return {
                'name': 'Yamaya Yoga',
                'type': 'Tajika',
                'planets': [p1, p2],
                'aspect': asp_name,
                'description': f'{faster} applying {asp_name.lower()} to {slower} (inimical)',
                'effects': 'Conflict, opposition, difficulty in related matters.',
                'strength': 'Strong',
                'is_negative': True,
            }

        # 5. Manaau — separating inimical aspect (conflict resolving)
        if not applying and asp_nature == 'Inimical':
            return {
                'name': 'Manaau Yoga',
                'type': 'Tajika',
                'planets': [p1, p2],
                'description': f'{faster} separating from {asp_name.lower()} with {slower}',
                'effects': 'Conflict resolving, opposition fading, relief from difficulties.',
                'strength': 'Moderate',
                'is_negative': False,
            }

        return None

    def _check_musaripha(self, planets: Dict, planet_list: List[str]) -> List[Dict]:
        """
        Musaripha (Transfer of Light):
        Fast planet separating from one and applying to another, transferring energy.
        """
        yogas = []
        for fast in ['Moon', 'Mercury', 'Venus']:
            if fast not in planets:
                continue
            fast_lon = planets[fast].get('longitude', 0)
            fast_speed = planets[fast].get('speed', 0)

            separated_from = None
            applying_to = None

            for other in planet_list:
                if other == fast:
                    continue
                other_lon = planets[other].get('longitude', 0)
                diff = abs(fast_lon - other_lon)
                if diff > 180:
                    diff = 360 - diff

                if diff < 15:
                    if self._is_applying(fast_lon, other_lon, fast_speed):
                        applying_to = other
                    else:
                        separated_from = other

            if separated_from and applying_to:
                yogas.append({
                    'name': 'Musaripha Yoga (Transfer of Light)',
                    'type': 'Tajika',
                    'planets': [separated_from, fast, applying_to],
                    'description': f'{fast} transfers light from {separated_from} to {applying_to}',
                    'effects': f'Success through intermediary. {fast} connects {separated_from} and {applying_to} energies.',
                    'strength': 'Moderate',
                    'is_negative': False,
                })

        return yogas

    def get_annual_house_strength(self) -> Dict:
        """Analyze strength of each house in the annual chart."""
        chart = self.get_annual_chart()
        annual_asc = chart['ascendant']['rashi']
        planets = chart['planets']
        result = {}

        for house in range(1, 13):
            house_rashi = (annual_asc + house - 1) % 12
            lord = RASHI_LORDS[house_rashi]
            lord_data = planets.get(lord, {})
            lord_house = lord_data.get('house', 1)

            occupants = [p for p, d in planets.items() if d.get('house') == house]
            benefic_occ = [p for p in occupants if p in {'Jupiter', 'Venus', 'Mercury', 'Moon'}]
            malefic_occ = [p for p in occupants if p in {'Sun', 'Mars', 'Saturn', 'Rahu', 'Ketu'}]

            if lord_house in KENDRA_HOUSES + TRIKONA_HOUSES and benefic_occ:
                strength = 'Strong'
            elif lord_house in DUSTHANA_HOUSES or (malefic_occ and not benefic_occ):
                strength = 'Weak'
            else:
                strength = 'Moderate'

            result[house] = {
                'rashi': house_rashi,
                'rashi_name': RASHI_NAMES[house_rashi],
                'lord': lord,
                'lord_house': lord_house,
                'occupants': occupants,
                'strength': strength,
            }

        return result

    def get_sahams(self) -> Dict:
        """
        Calculate key Sahams (Tajika Lots / Arabic Parts).
        Saham = Point A + Point B - Point C (mod 360).
        """
        chart = self.get_annual_chart()
        planets = chart['planets']
        asc_long = chart['ascendant']['longitude']

        def saham(a, b, c):
            val = (a + b - c) % 360
            rashi = int(val / 30) % 12
            return {
                'longitude': round(val, 2),
                'rashi': rashi,
                'rashi_name': RASHI_NAMES[rashi],
                'degree': round(val % 30, 2),
            }

        sun = planets.get('Sun', {}).get('longitude', 0)
        moon = planets.get('Moon', {}).get('longitude', 0)
        mars = planets.get('Mars', {}).get('longitude', 0)
        jup = planets.get('Jupiter', {}).get('longitude', 0)
        ven = planets.get('Venus', {}).get('longitude', 0)
        sat = planets.get('Saturn', {}).get('longitude', 0)
        mer = planets.get('Mercury', {}).get('longitude', 0)

        return {
            'punya': {'name': 'Punya Saham (Fortune)', **saham(moon, sun, asc_long)},
            'vidya': {'name': 'Vidya Saham (Education)', **saham(mer, sun, asc_long)},
            'yasas': {'name': 'Yasas Saham (Fame)', **saham(jup, moon, asc_long)},
            'mitra': {'name': 'Mitra Saham (Friends)', **saham(jup, mer, asc_long)},
            'vivaha': {'name': 'Vivaha Saham (Marriage)', **saham(ven, sat, asc_long)},
            'putra': {'name': 'Putra Saham (Children)', **saham(jup, moon, asc_long)},
            'karma': {'name': 'Karma Saham (Career)', **saham(sat, sun, asc_long)},
            'roga': {'name': 'Roga Saham (Disease)', **saham(sat, mars, asc_long)},
        }

    def generate_full_varshaphal(self) -> Dict:
        """Generate complete annual horoscope report."""
        chart = self.get_annual_chart()
        muntha = self.get_muntha()
        year_lord = self.get_year_lord()
        tajika_yogas = self.check_tajika_yogas()
        house_strength = self.get_annual_house_strength()
        sahams = self.get_sahams()

        # Overall assessment
        positive_factors = 0
        negative_factors = 0

        if year_lord['strength'] in ('Strong', 'Very Strong'):
            positive_factors += 2
        elif year_lord['strength'] == 'Weak':
            negative_factors += 2

        if muntha['strength'] == 'Strong':
            positive_factors += 1
        elif muntha['strength'] == 'Weak':
            negative_factors += 1

        positive_yogas = sum(1 for y in tajika_yogas if not y.get('is_negative', False))
        negative_yogas = sum(1 for y in tajika_yogas if y.get('is_negative', False))
        positive_factors += positive_yogas
        negative_factors += negative_yogas

        strong_houses = sum(1 for h in house_strength.values() if h['strength'] == 'Strong')
        weak_houses = sum(1 for h in house_strength.values() if h['strength'] == 'Weak')
        positive_factors += strong_houses
        negative_factors += weak_houses

        total = positive_factors + negative_factors
        if total == 0:
            score = 50
        else:
            score = round((positive_factors / total) * 100)

        if score >= 70:
            overall = 'Excellent Year'
            summary = 'A highly favorable year with strong planetary support. Pursue goals actively.'
        elif score >= 55:
            overall = 'Good Year'
            summary = 'A generally positive year. Progress in most areas with manageable challenges.'
        elif score >= 40:
            overall = 'Mixed Year'
            summary = 'A year of both opportunities and obstacles. Careful planning needed.'
        elif score >= 25:
            overall = 'Challenging Year'
            summary = 'A difficult year requiring patience and remedies. Growth through adversity.'
        else:
            overall = 'Difficult Year'
            summary = 'A year of significant challenges. Focus on health and damage control.'

        return {
            'year': self.year,
            'solar_return': chart['datetime'],
            'annual_ascendant': chart['ascendant'],
            'muntha': muntha,
            'year_lord': year_lord,
            'tajika_yogas': tajika_yogas,
            'house_strength': house_strength,
            'sahams': sahams,
            'overall': {
                'rating': overall,
                'score': score,
                'summary': summary,
                'positive_factors': positive_factors,
                'negative_factors': negative_factors,
            },
            'annual_planets': {
                name: {
                    'rashi': data.get('rashi_name', ''),
                    'house': data.get('house', 1),
                    'degree': round(data.get('longitude', 0) % 30, 2),
                    'retrograde': data.get('retrograde', False),
                }
                for name, data in chart['planets'].items()
            },
        }


def generate_varshaphal(engine, year: int) -> Dict:
    """Convenience function."""
    vp = Varshaphal(engine, year)
    return vp.generate_full_varshaphal()
