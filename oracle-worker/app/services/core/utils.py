"""
JYOTISH ENGINE - UTILITY FUNCTIONS
Common calculations and helpers
"""

from datetime import datetime
from typing import Dict, Tuple


def normalize_longitude(longitude: float) -> float:
    """Normalize longitude to 0-360 range"""
    while longitude < 0:
        longitude += 360
    while longitude >= 360:
        longitude -= 360
    return longitude


def get_rashi_from_longitude(longitude: float) -> int:
    """Get rashi index (0-11) from longitude"""
    return int(normalize_longitude(longitude) / 30)


def get_degree_in_rashi(longitude: float) -> float:
    """Get degree within rashi (0-30)"""
    return normalize_longitude(longitude) % 30


def get_nakshatra_from_longitude(longitude: float) -> int:
    """Get nakshatra index (0-26) from longitude"""
    return int(normalize_longitude(longitude) / 13.333333) % 27


def get_nakshatra_pada(longitude: float) -> int:
    """Get nakshatra pada (1-4) from longitude"""
    nak_degree = normalize_longitude(longitude) % 13.333333
    return int(nak_degree / 3.333333) + 1


def get_house_from_position(planet_rashi: int, ascendant_rashi: int) -> int:
    """Calculate house number from planet rashi and ascendant"""
    return ((planet_rashi - ascendant_rashi) % 12) + 1


def calculate_aspect_strength(aspecting_planet: str, aspect_house: int) -> float:
    """
    Calculate aspect strength based on planet and house distance
    Returns value 0-1 (1 = full aspect)
    """
    from .constants import PLANETS
    
    planet_info = PLANETS.get(aspecting_planet, {})
    special_aspects = planet_info.get('aspects', [7])
    
    if aspect_house in special_aspects:
        return 1.0
    elif aspect_house == 7:  # All planets have 7th aspect
        return 1.0
    else:
        return 0.0


def is_retrograde(planet_speed: float) -> bool:
    """Check if planet is retrograde based on speed"""
    return planet_speed < 0


def calculate_shadbala_component(value: float, max_value: float) -> float:
    """Normalize a shadbala component to rupas"""
    return (value / max_value) * 60 if max_value > 0 else 0


def degrees_to_dms(degrees: float) -> Tuple[int, int, int]:
    """Convert decimal degrees to degrees, minutes, seconds"""
    d = int(degrees)
    m = int((degrees - d) * 60)
    s = int(((degrees - d) * 60 - m) * 60)
    return (d, m, s)


def dms_to_degrees(d: int, m: int, s: int) -> float:
    """Convert degrees, minutes, seconds to decimal degrees"""
    return d + m/60 + s/3600


def julian_day_to_datetime(jd: float) -> datetime:
    """Convert Julian Day to Python datetime"""
    # Algorithm from Meeus
    jd = jd + 0.5
    z = int(jd)
    f = jd - z
    
    if z < 2299161:
        a = z
    else:
        alpha = int((z - 1867216.25) / 36524.25)
        a = z + 1 + alpha - int(alpha / 4)
    
    b = a + 1524
    c = int((b - 122.1) / 365.25)
    d = int(365.25 * c)
    e = int((b - d) / 30.6001)
    
    day = b - d - int(30.6001 * e)
    
    if e < 14:
        month = e - 1
    else:
        month = e - 13
    
    if month > 2:
        year = c - 4716
    else:
        year = c - 4715
    
    # Calculate time
    hours = f * 24
    hour = int(hours)
    minutes = (hours - hour) * 60
    minute = int(minutes)
    second = int((minutes - minute) * 60)
    
    return datetime(year, month, day, hour, minute, second)


def datetime_to_julian_day(dt: datetime) -> float:
    """Convert Python datetime to Julian Day"""
    year = dt.year
    month = dt.month
    day = dt.day + dt.hour/24 + dt.minute/1440 + dt.second/86400
    
    if month <= 2:
        year -= 1
        month += 12
    
    a = int(year / 100)
    b = 2 - a + int(a / 4)
    
    jd = int(365.25 * (year + 4716)) + int(30.6001 * (month + 1)) + day + b - 1524.5
    return jd


def get_ayanamsa(jd: float, ayanamsa_type: int = 1) -> float:
    """
    Calculate ayanamsa for given Julian Day
    ayanamsa_type: 1=Lahiri (default), 3=Raman, 5=KP
    """
    # Simplified Lahiri calculation
    # For precise values, use Swiss Ephemeris
    t = (jd - 2451545.0) / 36525.0  # Julian centuries from J2000
    
    # Lahiri ayanamsa (approximate)
    ayanamsa = 23.85 + 0.0137 * (jd - 2415020) / 365.25
    
    return ayanamsa


def calculate_dasha_balance(moon_longitude: float, dasha_lord: str) -> float:
    """
    Calculate remaining dasha balance at birth
    Returns years remaining in first dasha
    """
    from .constants import VIMSHOTTARI_YEARS, NAKSHATRA_LORDS
    
    nakshatra = get_nakshatra_from_longitude(moon_longitude)
    nak_degree = moon_longitude % 13.333333
    
    # Portion of nakshatra traversed
    portion_traversed = nak_degree / 13.333333
    
    # Remaining portion
    portion_remaining = 1 - portion_traversed
    
    # Dasha years for nakshatra lord
    nak_lord = NAKSHATRA_LORDS[nakshatra]
    dasha_years = VIMSHOTTARI_YEARS.get(nak_lord, 0)
    
    # Remaining years
    return dasha_years * portion_remaining


def get_tithi(sun_longitude: float, moon_longitude: float) -> Tuple[int, str]:
    """
    Calculate tithi from Sun and Moon positions
    Returns (tithi_number 1-30, tithi_name)
    """
    from .constants import TITHIS
    
    diff = normalize_longitude(moon_longitude - sun_longitude)
    tithi_index = int(diff / 12)
    
    return (tithi_index + 1, TITHIS[tithi_index])


def get_yoga_panchanga(sun_longitude: float, moon_longitude: float) -> Tuple[int, str]:
    """
    Calculate yoga from Sun and Moon positions
    Returns (yoga_number 1-27, yoga_name)
    """
    from .constants import YOGAS_PANCHANGA
    
    total = normalize_longitude(sun_longitude + moon_longitude)
    yoga_index = int(total / (360/27))
    
    return (yoga_index + 1, YOGAS_PANCHANGA[yoga_index])


def get_karana(sun_longitude: float, moon_longitude: float) -> Tuple[int, str]:
    """
    Calculate karana from Sun and Moon positions
    Returns (karana_number 1-60, karana_name)
    """
    from .constants import KARANAS
    
    diff = normalize_longitude(moon_longitude - sun_longitude)
    karana_index = int(diff / 6)
    
    # Map to karana names (complex cycle)
    if karana_index == 0:
        name = 'Kimstughna'
    elif karana_index == 57:
        name = 'Shakuni'
    elif karana_index == 58:
        name = 'Chatushpada'
    elif karana_index == 59:
        name = 'Naga'
    else:
        name = KARANAS[(karana_index - 1) % 7]
    
    return (karana_index + 1, name)


def calculate_planetary_war(planet1_long: float, planet2_long: float) -> bool:
    """
    Check if two planets are in planetary war (within 1 degree)
    """
    diff = abs(normalize_longitude(planet1_long) - normalize_longitude(planet2_long))
    if diff > 180:
        diff = 360 - diff
    return diff <= 1.0


def calculate_combustion(planet_longitude: float, sun_longitude: float, planet_name: str) -> bool:
    """
    Check if planet is combust (too close to Sun)
    """
    combustion_degrees = {
        'Moon': 12, 'Mars': 17, 'Mercury': 14, 'Jupiter': 11,
        'Venus': 10, 'Saturn': 15
    }
    
    orb = combustion_degrees.get(planet_name, 0)
    if orb == 0:
        return False
    
    diff = abs(normalize_longitude(planet_longitude) - normalize_longitude(sun_longitude))
    if diff > 180:
        diff = 360 - diff
    
    return diff <= orb


def get_weekday(dt: datetime) -> Tuple[int, str]:
    """
    Get weekday (Vara) for given date
    Returns (index 0-6, name)
    """
    from .constants import VARAS
    
    weekday_index = dt.weekday()
    # Convert Python weekday (Monday=0) to Vedic (Sunday=0)
    vedic_index = (weekday_index + 1) % 7
    
    return (vedic_index, VARAS[vedic_index])


def get_hora_lord(dt: datetime) -> str:
    """
    Get hora (planetary hour) lord for given datetime
    """
    from .constants import VARA_LORDS
    
    # Get weekday lord
    weekday = (dt.weekday() + 1) % 7
    day_lord = VARA_LORDS[weekday]
    
    # Calculate hora number (24 horas per day)
    hours_from_sunrise = dt.hour + dt.minute/60  # Simplified, assumes 6 AM sunrise
    hora_number = int(hours_from_sunrise)
    
    # Hora lord sequence
    hora_order = ['Saturn', 'Jupiter', 'Mars', 'Sun', 'Venus', 'Mercury', 'Moon']
    start_index = hora_order.index(day_lord)
    
    lord_index = (start_index + hora_number) % 7
    return hora_order[lord_index]


def is_planet_strong_in_sign(planet: str, rashi_index: int) -> Dict[str, any]:
    """
    Check planet's dignity in a sign
    Returns dict with dignity type and strength
    """
    from .constants import PLANETS
    
    planet_info = PLANETS.get(planet, {})
    
    result = {
        'dignity': 'neutral',
        'strength': 1.0,
        'own_sign': False,
        'exalted': False,
        'debilitated': False,
        'moolatrikona': False,
        'friend_sign': False,
        'enemy_sign': False,
    }
    
    # Check exaltation
    if planet_info.get('exalted') == rashi_index:
        result['dignity'] = 'exalted'
        result['strength'] = 1.5
        result['exalted'] = True
        return result
    
    # Check debilitation
    if planet_info.get('debilitated') == rashi_index:
        result['dignity'] = 'debilitated'
        result['strength'] = 0.5
        result['debilitated'] = True
        return result
    
    # Check own sign
    if rashi_index in planet_info.get('owns', []):
        result['dignity'] = 'own_sign'
        result['strength'] = 1.25
        result['own_sign'] = True
        return result
    
    # Check moolatrikona
    if planet_info.get('moolatrikona') == rashi_index:
        result['dignity'] = 'moolatrikona'
        result['strength'] = 1.35
        result['moolatrikona'] = True
        return result
    
    # Check friend/enemy signs
    from .constants import RASHI_LORDS
    sign_lord = RASHI_LORDS[rashi_index]
    
    if sign_lord in planet_info.get('friends', []):
        result['dignity'] = 'friend_sign'
        result['strength'] = 1.1
        result['friend_sign'] = True
    elif sign_lord in planet_info.get('enemies', []):
        result['dignity'] = 'enemy_sign'
        result['strength'] = 0.75
        result['enemy_sign'] = True
    
    return result


def calculate_divisional_position(longitude: float, division: int) -> int:
    """
    Calculate position in a divisional chart
    Returns rashi index (0-11) in that division
    """
    if division == 1:  # D1 - Rashi
        return int(longitude / 30) % 12
    
    elif division == 9:  # D9 - Navamsa
        pada = int(longitude / 3.333333) % 108
        return pada % 12
    
    elif division == 10:  # D10 - Dasamsa
        degree_in_sign = longitude % 30
        part = int(degree_in_sign / 3)  # 10 parts of 3 degrees each
        base_sign = int(longitude / 30)
        
        if base_sign % 2 == 0:  # Odd signs (0=Aries is odd in Vedic)
            return (base_sign + part) % 12
        else:  # Even signs
            return (base_sign + 9 + part) % 12
    
    elif division == 2:  # D2 - Hora
        degree_in_sign = longitude % 30
        sign = int(longitude / 30)
        if degree_in_sign < 15:
            return 4 if sign % 2 == 0 else 3  # Leo or Cancer
        else:
            return 3 if sign % 2 == 0 else 4
    
    elif division == 3:  # D3 - Drekkana
        degree_in_sign = longitude % 30
        sign = int(longitude / 30)
        part = int(degree_in_sign / 10)
        return (sign + part * 4) % 12
    
    elif division == 7:  # D7 - Saptamsa
        degree_in_sign = longitude % 30
        sign = int(longitude / 30)
        part = int(degree_in_sign / (30/7))
        if sign % 2 == 0:  # Odd signs
            return (sign + part) % 12
        else:  # Even signs
            return (sign + 6 + part) % 12
    
    elif division == 12:  # D12 - Dwadasamsa
        degree_in_sign = longitude % 30
        sign = int(longitude / 30)
        part = int(degree_in_sign / 2.5)
        return (sign + part) % 12
    
    else:
        # Generic calculation for other divisions
        degree_in_sign = longitude % 30
        part_size = 30 / division
        part = int(degree_in_sign / part_size)
        base_sign = int(longitude / 30)
        return (base_sign + part) % 12


def format_longitude(longitude: float, include_nakshatra: bool = True) -> str:
    """
    Format longitude as readable string
    Example: "15°23'45\" Aries (Ashwini 2)"
    """
    from .constants import RASHI_NAMES, NAKSHATRA_NAMES
    
    rashi = get_rashi_from_longitude(longitude)
    degree_in_rashi = get_degree_in_rashi(longitude)
    d, m, s = degrees_to_dms(degree_in_rashi)
    
    result = f"{d}°{m}'{s}\" {RASHI_NAMES[rashi]}"
    
    if include_nakshatra:
        nak = get_nakshatra_from_longitude(longitude)
        pada = get_nakshatra_pada(longitude)
        result += f" ({NAKSHATRA_NAMES[nak]} {pada})"
    
    return result
