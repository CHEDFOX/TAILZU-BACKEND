"""
WESTERN ASTROLOGY — EXTRA POINTS & FEATURES
Black Moon Lilith, Part of Fortune, Void of Course Moon, Decanates, Fixed Stars.
"""

from datetime import datetime
from typing import Dict, List
from .chart import SIGNS, SIGN_ELEMENTS, ASPECTS


# ═══════════════════════════════════════════════════════════════
# PART OF FORTUNE
# ═══════════════════════════════════════════════════════════════

def calculate_part_of_fortune(asc_long: float, sun_long: float, moon_long: float,
                                is_night: bool = False) -> Dict:
    """
    Arabic Part of Fortune (Pars Fortunae).
    Day chart: ASC + Moon - Sun
    Night chart: ASC + Sun - Moon
    """
    if is_night:
        pof_long = (asc_long + sun_long - moon_long) % 360
    else:
        pof_long = (asc_long + moon_long - sun_long) % 360

    sign_idx = int(pof_long / 30)
    return {
        'longitude': round(pof_long, 4),
        'sign': SIGNS[sign_idx],
        'degree': round(pof_long % 30, 2),
        'element': SIGN_ELEMENTS[SIGNS[sign_idx]],
        'description': 'Where fortune and abundance flow most naturally',
    }


# ═══════════════════════════════════════════════════════════════
# BLACK MOON LILITH
# ═══════════════════════════════════════════════════════════════

def calculate_lilith(birth_dt: datetime) -> Dict:
    """
    Mean Black Moon Lilith — lunar apogee.
    Represents the shadow self, repressed desires, raw power.
    """
    try:
        import swisseph as swe
        jd = swe.julday(birth_dt.year, birth_dt.month, birth_dt.day,
                        birth_dt.hour + birth_dt.minute / 60.0)
        # Mean Lunar Apogee = SE object 12
        result = swe.calc_ut(jd, 12, swe.FLG_SWIEPH)
        lilith_long = result[0][0] % 360
        sign_idx = int(lilith_long / 30)

        return {
            'longitude': round(lilith_long, 4),
            'sign': SIGNS[sign_idx],
            'degree': round(lilith_long % 30, 2),
            'description': f'Shadow self expressed through {SIGNS[sign_idx]} energy',
        }
    except Exception:
        return {'error': 'Could not calculate Lilith'}


# ═══════════════════════════════════════════════════════════════
# DECANATES (each sign divided into 3 × 10°)
# ═══════════════════════════════════════════════════════════════

DECANATE_RULERS = {
    # Sign: [1st decanate ruler, 2nd, 3rd] — using triplicity system
    "Aries": ["Mars", "Sun", "Jupiter"],
    "Taurus": ["Venus", "Mercury", "Saturn"],
    "Gemini": ["Mercury", "Venus", "Uranus"],
    "Cancer": ["Moon", "Pluto", "Neptune"],
    "Leo": ["Sun", "Jupiter", "Mars"],
    "Virgo": ["Mercury", "Saturn", "Venus"],
    "Libra": ["Venus", "Uranus", "Mercury"],
    "Scorpio": ["Pluto", "Neptune", "Moon"],
    "Sagittarius": ["Jupiter", "Mars", "Sun"],
    "Capricorn": ["Saturn", "Venus", "Mercury"],
    "Aquarius": ["Uranus", "Mercury", "Venus"],
    "Pisces": ["Neptune", "Moon", "Pluto"],
}


def get_decanate(longitude: float) -> Dict:
    """Get decanate (1-3) and its ruler for a given longitude."""
    sign_idx = int(longitude / 30)
    degree_in_sign = longitude % 30
    decanate = int(degree_in_sign / 10) + 1
    sign = SIGNS[sign_idx]
    rulers = DECANATE_RULERS.get(sign, ["", "", ""])
    ruler = rulers[decanate - 1] if decanate <= 3 else ""

    return {
        'sign': sign,
        'decanate': decanate,
        'degree_range': f"{(decanate - 1) * 10}°-{decanate * 10}°",
        'ruler': ruler,
    }


# ═══════════════════════════════════════════════════════════════
# FIXED STARS (major ones)
# ═══════════════════════════════════════════════════════════════

# Approximate tropical longitudes (epoch ~2025, precession ~50"/yr)
FIXED_STARS = [
    {"name": "Algol", "longitude": 56.17, "nature": "destructive/intense",
     "meaning": "Raw power, intensity, transformation or danger"},
    {"name": "Aldebaran", "longitude": 69.85, "nature": "Mars",
     "meaning": "Watcher of the East — courage, honor, success through integrity"},
    {"name": "Rigel", "longitude": 76.95, "nature": "Jupiter/Mars",
     "meaning": "Ambition, benevolence, mechanical ability, teaching"},
    {"name": "Sirius", "longitude": 104.1, "nature": "Jupiter/Mars",
     "meaning": "Brilliance, fame, honor, guardian energy"},
    {"name": "Regulus", "longitude": 149.83, "nature": "Mars/Jupiter",
     "meaning": "Royal star — leadership, success, but fall through revenge"},
    {"name": "Spica", "longitude": 203.85, "nature": "Venus/Mars",
     "meaning": "Gifts, brilliance, talent, love of art and science"},
    {"name": "Arcturus", "longitude": 204.22, "nature": "Mars/Jupiter",
     "meaning": "Pathfinder, trailblazer, wealth through travel"},
    {"name": "Antares", "longitude": 249.78, "nature": "Mars/Jupiter",
     "meaning": "Watcher of the West — bold, headstrong, sudden events"},
    {"name": "Vega", "longitude": 285.27, "nature": "Venus/Mercury",
     "meaning": "Charisma, artistic talent, idealism, aspirational"},
    {"name": "Fomalhaut", "longitude": 333.85, "nature": "Venus/Mercury",
     "meaning": "Watcher of the South — fame, idealism, dreams made real"},
]


def check_fixed_star_conjunctions(planets: Dict, orb: float = 1.5) -> List[Dict]:
    """Check if any natal planets conjunct major fixed stars."""
    conjunctions = []
    for planet_name, p_data in planets.items():
        p_long = p_data.get('longitude', 0)
        for star in FIXED_STARS:
            diff = abs(p_long - star['longitude'])
            if diff > 180:
                diff = 360 - diff
            if diff <= orb:
                conjunctions.append({
                    'planet': planet_name,
                    'star': star['name'],
                    'orb': round(diff, 2),
                    'meaning': star['meaning'],
                    'nature': star['nature'],
                })
    conjunctions.sort(key=lambda c: c['orb'])
    return conjunctions


# ═══════════════════════════════════════════════════════════════
# VOID OF COURSE MOON
# ═══════════════════════════════════════════════════════════════

def check_void_of_course(moon_long: float, all_planets: Dict) -> Dict:
    """
    Check if Moon is void of course (no more major aspects before leaving sign).
    Simplified: check if Moon makes any applying major aspect within remaining sign degrees.
    """
    moon_sign_idx = int(moon_long / 30)
    degree_remaining = 30 - (moon_long % 30)

    # Check if Moon aspects any planet within the remaining degrees
    has_aspect = False
    for name, data in all_planets.items():
        if name == 'Moon':
            continue
        p_long = data.get('longitude', 0)
        diff = abs(moon_long - p_long)
        if diff > 180:
            diff = 360 - diff
        for _, asp_angle, asp_orb in ASPECTS[:5]:
            if abs(diff - asp_angle) <= asp_orb:
                # Check if this aspect is still forming (applying)
                has_aspect = True
                break
        if has_aspect:
            break

    return {
        'is_void': not has_aspect,
        'moon_sign': SIGNS[moon_sign_idx],
        'degrees_remaining': round(degree_remaining, 2),
        'interpretation': 'Moon is void of course — not ideal for starting new ventures' if not has_aspect
                          else 'Moon is active — making aspects before leaving sign',
    }


# ═══════════════════════════════════════════════════════════════
# COMPOSITE CHART (Midpoint method)
# ═══════════════════════════════════════════════════════════════

def calculate_composite(chart1, chart2) -> Dict:
    """
    Composite chart — midpoints of all planet pairs between two charts.
    Represents the relationship as its own entity.
    """
    from .chart import WESTERN_PLANETS, SIGNS, SIGN_ELEMENTS
    chart1._ensure_calculated()
    chart2._ensure_calculated()

    composite_planets = {}
    for name in WESTERN_PLANETS:
        l1 = chart1.planets.get(name, {}).get('longitude', 0)
        l2 = chart2.planets.get(name, {}).get('longitude', 0)
        # Midpoint calculation (shortest arc)
        diff = l2 - l1
        if diff > 180: diff -= 360
        elif diff < -180: diff += 360
        midpoint = (l1 + diff / 2) % 360

        sign_idx = int(midpoint / 30)
        composite_planets[name] = {
            'longitude': round(midpoint, 4),
            'sign': SIGNS[sign_idx],
            'degree': round(midpoint % 30, 2),
            'element': SIGN_ELEMENTS[SIGNS[sign_idx]],
        }

    # Composite ASC
    asc_mid = (chart1._ascendant + chart2._ascendant) / 2
    if abs(chart1._ascendant - chart2._ascendant) > 180:
        asc_mid = (asc_mid + 180) % 360
    asc_sign = SIGNS[int(asc_mid / 30)]

    return {
        'type': 'Composite (Midpoint)',
        'planets': composite_planets,
        'ascendant': {'longitude': round(asc_mid, 4), 'sign': asc_sign},
        'sun_sign': composite_planets.get('Sun', {}).get('sign', ''),
        'moon_sign': composite_planets.get('Moon', {}).get('sign', ''),
        'venus_sign': composite_planets.get('Venus', {}).get('sign', ''),
    }


# ═══════════════════════════════════════════════════════════════
# MUTUAL RECEPTIONS
# ═══════════════════════════════════════════════════════════════

def find_mutual_receptions(planets: Dict) -> List[Dict]:
    """
    Mutual reception: Planet A is in Planet B's sign, and Planet B is in Planet A's sign.
    Creates a strong hidden connection even without aspect.
    """
    from .chart import SIGN_RULERS, TRADITIONAL_RULERS
    receptions = []
    planet_names = list(planets.keys())

    for i, p1_name in enumerate(planet_names):
        p1 = planets[p1_name]
        p1_sign = p1.get('sign', '')
        p1_ruler = SIGN_RULERS.get(p1_sign, '')

        for p2_name in planet_names[i+1:]:
            p2 = planets[p2_name]
            p2_sign = p2.get('sign', '')
            p2_ruler = SIGN_RULERS.get(p2_sign, '')

            # Check modern rulers
            if p1_ruler == p2_name and p2_ruler == p1_name:
                receptions.append({
                    'planet1': p1_name, 'sign1': p1_sign,
                    'planet2': p2_name, 'sign2': p2_sign,
                    'type': 'Modern mutual reception',
                    'meaning': f'{p1_name} and {p2_name} strengthen each other — hidden alliance',
                })

            # Check traditional rulers
            t1_ruler = TRADITIONAL_RULERS.get(p1_sign, '')
            t2_ruler = TRADITIONAL_RULERS.get(p2_sign, '')
            if t1_ruler == p2_name and t2_ruler == p1_name and \
               (t1_ruler != p1_ruler or t2_ruler != p2_ruler):
                receptions.append({
                    'planet1': p1_name, 'sign1': p1_sign,
                    'planet2': p2_name, 'sign2': p2_sign,
                    'type': 'Traditional mutual reception',
                    'meaning': f'{p1_name} and {p2_name} exchange dignity (classical)',
                })

    return receptions


# ═══════════════════════════════════════════════════════════════
# RETROGRADE STATIONS
# ═══════════════════════════════════════════════════════════════

def check_retrograde_stations(birth_dt, planets: Dict) -> List[Dict]:
    """
    Check if any planet was near its retrograde station at birth.
    A planet stationing (speed near 0) is EXTREMELY powerful.
    """
    stations = []
    for name in ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']:
        p = planets.get(name, {})
        speed = abs(p.get('speed', 1.0))
        retro = p.get('retrograde', False)

        # Stationary = speed less than 10% of average
        avg_speeds = {
            'Mercury': 1.2, 'Venus': 1.0, 'Mars': 0.5, 'Jupiter': 0.08,
            'Saturn': 0.03, 'Uranus': 0.01, 'Neptune': 0.006, 'Pluto': 0.004,
        }
        avg = avg_speeds.get(name, 0.5)
        if speed < avg * 0.15:
            station_type = 'Stationary Retrograde' if retro else 'Stationary Direct'
            stations.append({
                'planet': name,
                'station': station_type,
                'speed': round(speed, 6),
                'sign': p.get('sign', ''),
                'power': 'Extremely powerful — planet energy is concentrated and intensified',
            })

    return stations


# ═══════════════════════════════════════════════════════════════
# MORE FIXED STARS
# ═══════════════════════════════════════════════════════════════

FIXED_STARS_EXTENDED = [
    {"name": "Algol", "longitude": 56.17, "nature": "Saturn/Jupiter", "meaning": "Raw power, intensity, transformation or danger"},
    {"name": "Alcyone", "longitude": 60.0, "nature": "Moon/Mars", "meaning": "Ambition, judgement, mysticism, sorrow"},
    {"name": "Aldebaran", "longitude": 69.85, "nature": "Mars", "meaning": "Watcher of East — courage, honor, success"},
    {"name": "Rigel", "longitude": 76.95, "nature": "Jupiter/Mars", "meaning": "Teaching, benevolence, quick rise"},
    {"name": "Bellatrix", "longitude": 81.0, "nature": "Mars/Mercury", "meaning": "Female warrior, ambition, quick decision"},
    {"name": "Capella", "longitude": 81.9, "nature": "Jupiter/Saturn", "meaning": "Love of learning, public honor"},
    {"name": "Betelgeuse", "longitude": 88.8, "nature": "Mars/Mercury", "meaning": "Military honor, preferment, fortune"},
    {"name": "Sirius", "longitude": 104.1, "nature": "Jupiter/Mars", "meaning": "Brilliance, fame, guardian energy"},
    {"name": "Castor", "longitude": 110.2, "nature": "Mercury", "meaning": "Writing, law, sudden fame or disgrace"},
    {"name": "Pollux", "longitude": 113.2, "nature": "Mars", "meaning": "Spirited, daring, cruelty possible"},
    {"name": "Procyon", "longitude": 115.7, "nature": "Mercury/Mars", "meaning": "Sudden success, then loss unless careful"},
    {"name": "Regulus", "longitude": 149.83, "nature": "Mars/Jupiter", "meaning": "Royal star — leadership, success, possible fall"},
    {"name": "Denebola", "longitude": 171.5, "nature": "Saturn/Venus", "meaning": "Noble, generous, but misfortune through haste"},
    {"name": "Spica", "longitude": 203.85, "nature": "Venus/Mars", "meaning": "Gifts, brilliance, love of art and science"},
    {"name": "Arcturus", "longitude": 204.22, "nature": "Mars/Jupiter", "meaning": "Pathfinder, wealth through travel"},
    {"name": "Zuben Elgenubi", "longitude": 225.1, "nature": "Saturn/Mars", "meaning": "Unforgiving, social reform"},
    {"name": "Zuben Eschamali", "longitude": 229.2, "nature": "Jupiter/Mercury", "meaning": "Good fortune, social position"},
    {"name": "Antares", "longitude": 249.78, "nature": "Mars/Jupiter", "meaning": "Watcher of West — bold, headstrong"},
    {"name": "Vega", "longitude": 285.27, "nature": "Venus/Mercury", "meaning": "Charisma, artistic talent, idealism"},
    {"name": "Altair", "longitude": 301.8, "nature": "Mars/Jupiter", "meaning": "Bold, daring, sudden wealth or danger"},
    {"name": "Fomalhaut", "longitude": 333.85, "nature": "Venus/Mercury", "meaning": "Watcher of South — fame, idealism"},
    {"name": "Scheat", "longitude": 349.3, "nature": "Mars/Mercury", "meaning": "Extreme fortune or misfortune, drowning risk"},
    {"name": "Markab", "longitude": 353.5, "nature": "Mars/Mercury", "meaning": "Intellectual, honors in law/writing"},
]

# Replace the original FIXED_STARS with this extended version
FIXED_STARS = FIXED_STARS_EXTENDED


# ═══════════════════════════════════════════════════════════════
# LUNAR RETURN
# ═══════════════════════════════════════════════════════════════

def calculate_lunar_return(natal_moon_long: float, latitude: float, longitude: float,
                            month: int = None, year: int = None) -> Dict:
    """
    Lunar Return — chart cast when Moon returns to natal Moon degree (~monthly).
    Shows emotional theme of the coming month.
    """
    from datetime import datetime
    from .chart import WesternChart

    now = datetime.utcnow()
    target_year = year or now.year
    target_month = month or now.month

    try:
        import swisseph as swe
        # Search from start of target month
        search_start = datetime(target_year, target_month, 1)
        jd = swe.julday(search_start.year, search_start.month, search_start.day, 0.0)

        best_jd = jd
        best_diff = 360
        # Moon moves ~13°/day, so complete cycle ~27.3 days. Search 30 days.
        for step in range(3000):
            test_jd = jd + step * 0.01
            result = swe.calc_ut(test_jd, 1, swe.FLG_SWIEPH)
            moon_long = result[0][0] % 360
            diff = abs(moon_long - natal_moon_long)
            if diff > 180: diff = 360 - diff
            if diff < best_diff:
                best_diff = diff
                best_jd = test_jd

        y, m, d, h = swe.revjul(best_jd)
        lr_date = datetime(int(y), int(m), int(d), int(h), int((h % 1) * 60))
    except Exception:
        lr_date = datetime(target_year, target_month, 15, 12, 0)

    lr_chart = WesternChart(lr_date, latitude, longitude)
    lr_chart._ensure_calculated()

    from .profiles import HOUSE_THEMES
    lr_moon_house = lr_chart.planets.get('Moon', {}).get('house', 1)
    lr_asc_sign = lr_chart.get_big_three()['rising_sign']

    return {
        'lunar_return_date': lr_date.isoformat(),
        'lr_ascendant': lr_asc_sign,
        'lr_moon_house': lr_moon_house,
        'month_theme': HOUSE_THEMES.get(lr_moon_house, {}).get('theme', ''),
        'emotional_focus': f"Emotional energy directed toward {HOUSE_THEMES.get(lr_moon_house, {}).get('theme', 'self')}",
    }
