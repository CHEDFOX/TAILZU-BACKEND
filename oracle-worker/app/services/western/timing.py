"""
WESTERN ASTROLOGY — TIMING SYSTEMS
Secondary Progressions, Solar Return, Solar Arc Directions.
These are the primary Western timing tools (equivalent of Dasha in Vedic).
"""

from datetime import datetime, timedelta
from typing import Dict
from .chart import WesternChart, WESTERN_PLANETS, SIGNS, SIGN_ELEMENTS, ASPECTS, ASPECT_NATURE


class SecondaryProgressions:
    """
    Secondary Progressions (day-for-a-year).
    Each day after birth = one year of life.
    The progressed chart reveals inner psychological development.
    """

    def __init__(self, natal_chart: WesternChart, target_date: datetime = None):
        self.natal = natal_chart
        self.natal._ensure_calculated()
        self.target = target_date or datetime.utcnow()
        self._progressed = None

    def _calculate_progressed_date(self) -> datetime:
        """Birth date + (age in years as days) = progressed date."""
        age_days = (self.target - self.natal.birth_dt).days
        age_years = age_days / 365.25
        progressed_offset = timedelta(days=age_years)
        return self.natal.birth_dt + progressed_offset

    def get_progressed_chart(self) -> Dict:
        """Calculate the full progressed chart."""
        if self._progressed:
            return self._progressed

        prog_date = self._calculate_progressed_date()
        prog_chart = WesternChart(prog_date, self.natal.latitude, self.natal.longitude)
        prog_chart._ensure_calculated()

        # Key progressed positions
        prog_planets = {}
        for name in ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars']:
            p = prog_chart.planets.get(name, {})
            n = self.natal.planets.get(name, {})
            prog_planets[name] = {
                'natal_sign': n.get('sign', ''),
                'progressed_sign': p.get('sign', ''),
                'progressed_degree': p.get('degree', 0),
                'progressed_house': p.get('house', 0),
                'sign_changed': n.get('sign', '') != p.get('sign', ''),
            }

        # Progressed aspects to natal
        prog_to_natal = []
        for p_name in ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars']:
            p_long = prog_chart.planets.get(p_name, {}).get('longitude', 0)
            for n_name in WESTERN_PLANETS:
                n_long = self.natal.planets.get(n_name, {}).get('longitude', 0)
                diff = abs(p_long - n_long)
                if diff > 180:
                    diff = 360 - diff
                for asp_name, asp_angle, asp_orb in ASPECTS[:5]:
                    orb = abs(diff - asp_angle)
                    if orb <= 1.5:  # Tight orbs for progressions
                        prog_to_natal.append({
                            'progressed': p_name, 'natal': n_name,
                            'aspect': asp_name, 'orb': round(orb, 2),
                            'nature': ASPECT_NATURE[asp_name],
                        })
                        break

        # Progressed Moon sign — changes every ~2.5 years, most active progressed factor
        prog_moon = prog_chart.planets.get('Moon', {})
        moon_sign = prog_moon.get('sign', '')
        moon_house = prog_moon.get('house', 0)

        self._progressed = {
            'progressed_date': prog_date.isoformat(),
            'age_years': round((self.target - self.natal.birth_dt).days / 365.25, 1),
            'planets': prog_planets,
            'progressed_moon': {
                'sign': moon_sign, 'house': moon_house,
                'element': SIGN_ELEMENTS.get(moon_sign, ''),
                'theme': f"Emotional focus on {SIGN_ELEMENTS.get(moon_sign, '')} matters (H{moon_house})",
            },
            'aspects_to_natal': prog_to_natal,
            'sign_changes': [n for n, d in prog_planets.items() if d['sign_changed']],
        }
        return self._progressed


class SolarReturn:
    """
    Solar Return — chart cast when Sun returns to exact natal degree each year.
    Shows the theme of the coming year.
    """

    def __init__(self, natal_chart: WesternChart, year: int = None):
        self.natal = natal_chart
        self.natal._ensure_calculated()
        self.year = year or datetime.now().year

    def _find_solar_return_date(self) -> datetime:
        """Find when Sun returns to natal Sun degree in the target year."""
        natal_sun_long = self.natal.planets['Sun']['longitude']

        # Start searching from birthday in target year
        birth_month = self.natal.birth_dt.month
        birth_day = min(self.natal.birth_dt.day, 28)
        search_start = datetime(self.year, birth_month, birth_day)

        import swisseph as swe
        jd = swe.julday(search_start.year, search_start.month, search_start.day, 12.0)

        # Search ±5 days in 0.01-day steps
        best_jd = jd
        best_diff = 360
        for step in range(-500, 500):
            test_jd = jd + step * 0.01
            result = swe.calc_ut(test_jd, 0, swe.FLG_SWIEPH | swe.FLG_SPEED)
            sun_long = result[0][0] % 360
            diff = abs(sun_long - (natal_sun_long + swe.get_ayanamsa(test_jd)))
            # Wait — Solar Return uses tropical, not sidereal
            diff = abs(result[0][0] % 360 - self.natal.planets['Sun'].get('longitude', 0))
            if diff > 180:
                diff = 360 - diff
            if diff < best_diff:
                best_diff = diff
                best_jd = test_jd

        # Convert JD back to datetime
        y, m, d, h = swe.revjul(best_jd)
        hour = int(h)
        minute = int((h - hour) * 60)
        try:
            return datetime(int(y), int(m), int(d), hour, minute)
        except Exception:
            return datetime(self.year, birth_month, birth_day, 12, 0)

    def generate_solar_return(self) -> Dict:
        """Generate Solar Return chart and interpretation."""
        try:
            sr_date = self._find_solar_return_date()
        except Exception:
            sr_date = datetime(self.year, self.natal.birth_dt.month,
                              min(self.natal.birth_dt.day, 28), 12, 0)

        sr_chart = WesternChart(sr_date, self.natal.latitude, self.natal.longitude)
        sr_chart._ensure_calculated()

        big_three = sr_chart.get_big_three()
        aspects = sr_chart.get_aspects()
        configs = sr_chart.get_configurations()

        # SR Ascendant sign = theme of the year
        # SR Moon house = emotional focus
        # SR Sun house = where energy goes
        sr_sun_house = sr_chart.planets.get('Sun', {}).get('house', 1)
        sr_moon_house = sr_chart.planets.get('Moon', {}).get('house', 1)

        from .profiles import HOUSE_THEMES
        sun_theme = HOUSE_THEMES.get(sr_sun_house, {}).get('theme', '')
        moon_theme = HOUSE_THEMES.get(sr_moon_house, {}).get('theme', '')

        return {
            'year': self.year,
            'solar_return_date': sr_date.isoformat(),
            'sr_ascendant': big_three['rising_sign'],
            'sr_sun_house': sr_sun_house,
            'sr_moon_sign': big_three['moon_sign'],
            'sr_moon_house': sr_moon_house,
            'year_theme': f"Energy directed toward {sun_theme}",
            'emotional_theme': f"Emotional focus on {moon_theme}",
            'aspects': aspects[:10],
            'configurations': configs,
            'chart_ruler': big_three['chart_ruler'],
        }


class SolarArcDirections:
    """
    Solar Arc Directions — each planet advances by the Sun's progressed motion per year.
    ~1° per year of life. Simple but powerful for timing major life events.
    """

    def __init__(self, natal_chart: WesternChart, target_date: datetime = None):
        self.natal = natal_chart
        self.natal._ensure_calculated()
        self.target = target_date or datetime.utcnow()

    def get_solar_arc(self) -> Dict:
        """Calculate solar arc directed positions and aspects."""
        age = (self.target - self.natal.birth_dt).days / 365.25
        arc = age * 0.9856  # Average Sun motion per day ≈ per year in SA

        directed_aspects = []
        for name in WESTERN_PLANETS:
            natal_long = self.natal.planets.get(name, {}).get('longitude', 0)
            directed_long = (natal_long + arc) % 360
            directed_sign = SIGNS[int(directed_long / 30)]

            # Check directed planet to natal planets
            for n_name in WESTERN_PLANETS:
                if n_name == name:
                    continue
                n_long = self.natal.planets[n_name]['longitude']
                diff = abs(directed_long - n_long)
                if diff > 180:
                    diff = 360 - diff
                for asp_name, asp_angle, _ in ASPECTS[:5]:
                    if abs(diff - asp_angle) <= 1.0:
                        directed_aspects.append({
                            'directed': name, 'natal': n_name,
                            'aspect': asp_name, 'orb': round(abs(diff - asp_angle), 2),
                            'directed_sign': directed_sign,
                        })
                        break

            # Check to natal angles
            for angle_name, angle_long in [('ASC', self.natal._ascendant), ('MC', self.natal._midheaven)]:
                diff = abs(directed_long - angle_long)
                if diff > 180:
                    diff = 360 - diff
                for asp_name, asp_angle, _ in ASPECTS[:3]:
                    if abs(diff - asp_angle) <= 1.0:
                        directed_aspects.append({
                            'directed': name, 'natal': angle_name,
                            'aspect': asp_name, 'orb': round(abs(diff - asp_angle), 2),
                        })
                        break

        return {
            'solar_arc_degrees': round(arc, 2),
            'age': round(age, 1),
            'directed_aspects': directed_aspects,
            'active_count': len(directed_aspects),
        }
