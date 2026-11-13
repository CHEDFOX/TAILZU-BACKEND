"""
JYOTISH ENGINE - SWISS EPHEMERIS WRAPPER
Professional astronomical calculations
"""

import swisseph as swe
from datetime import datetime
from typing import Dict
from .constants import PLANETS, RASHI_NAMES, NAKSHATRA_NAMES, AYANAMSA
from .utils import (
    normalize_longitude, get_rashi_from_longitude, 
    get_nakshatra_from_longitude, get_nakshatra_pada,
    get_degree_in_rashi
)


# Initialize Swiss Ephemeris. The repo ships the data files it needs beyond the
# planets (ephe/seas_18.se1: Ceres, Pallas, Juno, Vesta for 1800-2399) so they work
# on every server; /usr/share/ephe is still searched for anything installed there.
# Planet positions are unaffected: those files (sepl_*) are not shipped, and
# without them Swiss Ephemeris uses its built-in Moshier ephemeris as before.
import os as _os
EPHE_PATH = _os.pathsep.join([_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'ephe'),
                              '/usr/share/ephe'])
swe.set_ephe_path(EPHE_PATH)


def houses_safe(jd: float, lat: float, lng: float, system=b'P', flags=None):
    """swe.houses / swe.houses_ex that cannot fail on latitude.

    Placidus and Koch are undefined above about 66° latitude, and swe.houses RAISES
    there rather than returning — so nobody born in northern Norway, Finland, Alaska
    or Murmansk could have a chart at all: the Vedic engine asks Placidus for its
    ascendant. The ascendant and MC (ascmc) are the same in every house system, so
    where the asked system is undefined this falls back to Porphyry, which is defined
    everywhere, and the angles stay exact."""
    sysb = system if isinstance(system, bytes) else str(system).encode()
    try:
        return (swe.houses_ex(jd, lat, lng, sysb, flags) if flags is not None
                else swe.houses(jd, lat, lng, sysb))
    except Exception:
        return (swe.houses_ex(jd, lat, lng, b'O', flags) if flags is not None
                else swe.houses(jd, lat, lng, b'O'))


class Ephemeris:
    """
    Swiss Ephemeris wrapper for Vedic astrology calculations
    """
    
    def __init__(self, ayanamsa: str = 'LAHIRI'):
        """
        Initialize with specified ayanamsa
        """
        self.ayanamsa_name = ayanamsa
        self.ayanamsa_id = AYANAMSA.get(ayanamsa, 1)
        swe.set_sid_mode(self.ayanamsa_id)
    
    def get_julian_day(self, dt: datetime) -> float:
        """Convert datetime to Julian Day"""
        return swe.julday(
            dt.year, dt.month, dt.day,
            dt.hour + dt.minute/60 + dt.second/3600
        )
    
    def get_ayanamsa(self, jd: float) -> float:
        """Get ayanamsa value for Julian Day.

        The sidereal mode is process-global in Swiss Ephemeris, and it was set once,
        in __init__. Any other module that changed it — the Western chart set it to
        255 (SIDM_USER, ~92.9°) and only restored Lahiri if nothing raised in between
        — silently moved every Vedic position computed afterwards, for every user,
        by ~68°. So this chart's own mode is asserted every time it is read."""
        swe.set_sid_mode(self.ayanamsa_id)
        return swe.get_ayanamsa(jd)
    
    def get_planet_position(self, jd: float, planet: str) -> Dict:
        """
        Get complete position data for a planet
        Returns tropical and sidereal positions
        """
        planet_info = PLANETS.get(planet, {})
        swe_id = planet_info.get('swe_id')
        
        if swe_id is None:
            # Handle Ketu (opposite of Rahu)
            if planet == 'Ketu':
                rahu_data = self.get_planet_position(jd, 'Rahu')
                ketu_long = normalize_longitude(rahu_data['longitude'] + 180)
                return {
                    'planet': 'Ketu',
                    'longitude': ketu_long,
                    'latitude': -rahu_data['latitude'],
                    'distance': rahu_data['distance'],
                    'speed': rahu_data['speed'],
                    'retrograde': True,
                    'rashi': get_rashi_from_longitude(ketu_long),
                    'rashi_name': RASHI_NAMES[get_rashi_from_longitude(ketu_long)],
                    'degree_in_rashi': get_degree_in_rashi(ketu_long),
                    'nakshatra': get_nakshatra_from_longitude(ketu_long),
                    'nakshatra_name': NAKSHATRA_NAMES[get_nakshatra_from_longitude(ketu_long)],
                    'pada': get_nakshatra_pada(ketu_long),
                }
            return {}
        
        # Get tropical position
        flags = swe.FLG_SWIEPH | swe.FLG_SPEED
        result = swe.calc_ut(jd, swe_id, flags)
        
        tropical_long = result[0][0]
        latitude = result[0][1]
        distance = result[0][2]
        speed = result[0][3]
        
        # Convert to sidereal
        ayanamsa = self.get_ayanamsa(jd)
        sidereal_long = normalize_longitude(tropical_long - ayanamsa)
        
        # Calculate derived values
        rashi = get_rashi_from_longitude(sidereal_long)
        nakshatra = get_nakshatra_from_longitude(sidereal_long)
        
        return {
            'planet': planet,
            'longitude': sidereal_long,
            'tropical_longitude': tropical_long,
            'latitude': latitude,
            'distance': distance,
            'speed': speed,
            'retrograde': speed < 0,
            'rashi': rashi,
            'rashi_name': RASHI_NAMES[rashi],
            'degree_in_rashi': get_degree_in_rashi(sidereal_long),
            'nakshatra': nakshatra,
            'nakshatra_name': NAKSHATRA_NAMES[nakshatra],
            'pada': get_nakshatra_pada(sidereal_long),
        }
    
    def get_all_planets(self, jd: float) -> Dict[str, Dict]:
        """Get positions of all 9 planets"""
        planets = {}
        for planet in ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu']:
            planets[planet] = self.get_planet_position(jd, planet)
        return planets
    
    def get_ascendant(self, jd: float, latitude: float, longitude: float) -> Dict:
        """
        Calculate ascendant (Lagna) for given time and place
        """
        # Get house cusps using Placidus (we only need ASC)
        cusps, ascmc = houses_safe(jd, latitude, longitude, b'P')
        
        # Ascendant is first element of ascmc
        tropical_asc = ascmc[0]
        
        # Convert to sidereal
        ayanamsa = self.get_ayanamsa(jd)
        sidereal_asc = normalize_longitude(tropical_asc - ayanamsa)
        
        rashi = get_rashi_from_longitude(sidereal_asc)
        nakshatra = get_nakshatra_from_longitude(sidereal_asc)
        
        return {
            'longitude': sidereal_asc,
            'tropical_longitude': tropical_asc,
            'rashi': rashi,
            'rashi_name': RASHI_NAMES[rashi],
            'rashi_index': rashi,
            'degree_in_rashi': get_degree_in_rashi(sidereal_asc),
            'nakshatra': nakshatra,
            'nakshatra_name': NAKSHATRA_NAMES[nakshatra],
            'pada': get_nakshatra_pada(sidereal_asc),
        }
    
    def get_house_cusps(self, jd: float, latitude: float, longitude: float, 
                        system: str = 'W') -> Dict:
        """
        Calculate house cusps
        Systems: W=Whole Sign, P=Placidus, K=Koch, E=Equal
        """
        # For Whole Sign houses, we just need ascendant
        asc_data = self.get_ascendant(jd, latitude, longitude)
        asc_rashi = asc_data['rashi']
        
        if system == 'W':  # Whole Sign
            cusps = {}
            for i in range(12):
                house_num = i + 1
                rashi = (asc_rashi + i) % 12
                cusps[house_num] = {
                    'cusp_longitude': rashi * 30,
                    'rashi': rashi,
                    'rashi_name': RASHI_NAMES[rashi],
                }
            return cusps
        
        else:  # Placidus or other
            house_cusps, ascmc = houses_safe(jd, latitude, longitude, system)
            ayanamsa = self.get_ayanamsa(jd)
            
            cusps = {}
            for i, cusp in enumerate(house_cusps[:12], 1):
                sidereal_cusp = normalize_longitude(cusp - ayanamsa)
                rashi = get_rashi_from_longitude(sidereal_cusp)
                cusps[i] = {
                    'cusp_longitude': sidereal_cusp,
                    'rashi': rashi,
                    'rashi_name': RASHI_NAMES[rashi],
                    'degree_in_rashi': get_degree_in_rashi(sidereal_cusp),
                }
            return cusps
    
    def get_planet_house(self, planet_rashi: int, asc_rashi: int) -> int:
        """Calculate which house a planet occupies"""
        return ((planet_rashi - asc_rashi) % 12) + 1
    
    def generate_chart(self, dt: datetime, latitude: float, longitude: float) -> Dict:
        """
        Generate complete birth chart
        """
        jd = self.get_julian_day(dt)
        
        # Get ascendant
        ascendant = self.get_ascendant(jd, latitude, longitude)
        asc_rashi = ascendant['rashi']
        
        # Get all planets
        planets = self.get_all_planets(jd)
        
        # Add house positions to planets
        for planet_name, planet_data in planets.items():
            planet_data['house'] = self.get_planet_house(planet_data['rashi'], asc_rashi)
        
        # Get house cusps
        houses = self.get_house_cusps(jd, latitude, longitude)
        
        return {
            'datetime': dt.isoformat(),
            'julian_day': jd,
            'ayanamsa': self.get_ayanamsa(jd),
            'ayanamsa_name': self.ayanamsa_name,
            'latitude': latitude,
            'longitude': longitude,
            'ascendant': ascendant,
            'planets': planets,
            'houses': houses,
        }
    
    def get_current_transits(self) -> Dict[str, Dict]:
        """Get current planetary positions"""
        jd = self.get_julian_day(datetime.utcnow())
        return self.get_all_planets(jd)
    
    def get_transits_for_date(self, dt: datetime) -> Dict[str, Dict]:
        """Get planetary positions for any date"""
        jd = self.get_julian_day(dt)
        return self.get_all_planets(jd)
    
    def find_planet_ingress(self, planet: str, target_rashi: int, 
                           start_jd: float, direction: int = 1) -> float:
        """
        Find when planet enters a rashi
        direction: 1 = forward, -1 = backward
        Returns Julian Day of ingress
        """
        jd = start_jd
        step = direction * 1.0  # 1 day steps
        
        current_pos = self.get_planet_position(jd, planet)
        current_rashi = current_pos['rashi']
        
        # Search for rashi change
        max_iterations = 1000
        for _ in range(max_iterations):
            jd += step
            new_pos = self.get_planet_position(jd, planet)
            new_rashi = new_pos['rashi']
            
            if new_rashi == target_rashi and current_rashi != target_rashi:
                # Found ingress, refine with binary search
                return self._refine_ingress(planet, jd - step, jd, target_rashi)
            
            current_rashi = new_rashi
        
        return None
    
    def _refine_ingress(self, planet: str, jd_before: float, jd_after: float, 
                        target_rashi: int, precision: float = 0.0001) -> float:
        """Binary search to find precise ingress time"""
        while (jd_after - jd_before) > precision:
            jd_mid = (jd_before + jd_after) / 2
            pos = self.get_planet_position(jd_mid, planet)
            
            if pos['rashi'] == target_rashi:
                jd_after = jd_mid
            else:
                jd_before = jd_mid
        
        return jd_after
    
    def get_moon_phase(self, jd: float) -> Dict:
        """Calculate Moon phase"""
        sun = self.get_planet_position(jd, 'Sun')
        moon = self.get_planet_position(jd, 'Moon')
        
        diff = normalize_longitude(moon['longitude'] - sun['longitude'])
        
        # Determine phase
        if diff < 12:
            phase = 'New Moon'
        elif diff < 90:
            phase = 'Waxing Crescent'
        elif diff < 102:
            phase = 'First Quarter'
        elif diff < 168:
            phase = 'Waxing Gibbous'
        elif diff < 192:
            phase = 'Full Moon'
        elif diff < 258:
            phase = 'Waning Gibbous'
        elif diff < 282:
            phase = 'Last Quarter'
        else:
            phase = 'Waning Crescent'
        
        # Calculate tithi
        tithi_num = int(diff / 12) + 1
        
        return {
            'sun_moon_angle': diff,
            'phase': phase,
            'tithi_number': tithi_num,
            'illumination': (1 - abs(diff - 180) / 180) * 100,
        }


# Singleton instance
_ephemeris = None

def get_ephemeris(ayanamsa: str = 'LAHIRI') -> Ephemeris:
    """Get or create Ephemeris instance"""
    global _ephemeris
    if _ephemeris is None or _ephemeris.ayanamsa_name != ayanamsa:
        _ephemeris = Ephemeris(ayanamsa)
    return _ephemeris
