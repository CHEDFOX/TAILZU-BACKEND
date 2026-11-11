"""
JYOTISH ENGINE - TIMEZONE UTILITIES
Accurate timezone detection based on coordinates AND date
Handles DST, historical changes, all countries
"""

from datetime import datetime, timedelta
from typing import Optional, Tuple

try:
    from timezonefinder import TimezoneFinder
    import pytz
    TIMEZONE_LIBS_AVAILABLE = True
except ImportError:
    TIMEZONE_LIBS_AVAILABLE = False


# Fallback timezone data (used if libraries not installed)
FALLBACK_TIMEZONES = {
    # (min_lon, max_lon, min_lat, max_lat, offset, name)
    'india': (68, 97, 6, 36, 5.5, "Asia/Kolkata"),
    'nepal': (80, 88, 26, 30, 5.75, "Asia/Kathmandu"),
    'pakistan': (61, 77, 23, 37, 5.0, "Asia/Karachi"),
    'bangladesh': (88, 92, 20, 27, 6.0, "Asia/Dhaka"),
    'usa_east': (-85, -67, 25, 47, -5.0, "America/New_York"),
    'usa_central': (-105, -85, 25, 49, -6.0, "America/Chicago"),
    'usa_pacific': (-125, -115, 32, 49, -8.0, "America/Los_Angeles"),
    'uk': (-8, 2, 50, 60, 0.0, "Europe/London"),
    'uae': (51, 56, 22, 26, 4.0, "Asia/Dubai"),
    'japan': (124, 146, 24, 46, 9.0, "Asia/Tokyo"),
    'australia_east': (140, 154, -44, -10, 10.0, "Australia/Sydney"),
}


class TimezoneManager:
    """
    Accurate timezone detection for any location and date
    """
    
    def __init__(self):
        if TIMEZONE_LIBS_AVAILABLE:
            self.tf = TimezoneFinder()
        else:
            self.tf = None
    
    def get_timezone_name(self, latitude: float, longitude: float) -> str:
        """
        Get timezone name (e.g., 'Asia/Kolkata') from coordinates
        """
        if self.tf:
            tz_name = self.tf.timezone_at(lat=latitude, lng=longitude)
            if tz_name:
                return tz_name
        
        # Fallback
        return self._fallback_timezone_name(latitude, longitude)
    
    def _fallback_timezone_name(self, latitude: float, longitude: float) -> str:
        """Fallback timezone detection"""
        for region, (min_lon, max_lon, min_lat, max_lat, offset, tz_name) in FALLBACK_TIMEZONES.items():
            if min_lon <= longitude <= max_lon and min_lat <= latitude <= max_lat:
                return tz_name
        
        # Ultimate fallback: calculate from longitude
        offset = round(longitude / 15.0)
        return f"Etc/GMT{-offset:+d}" if offset != 0 else "Etc/GMT"
    
    def get_utc_offset(self, latitude: float, longitude: float, 
                       local_datetime: datetime) -> Tuple[float, str, bool]:
        """
        Get UTC offset for a specific location AND date
        
        Args:
            latitude: Location latitude
            longitude: Location longitude
            local_datetime: The local date and time (needed for DST)
        
        Returns:
            Tuple of (offset_hours, timezone_name, is_dst)
        """
        tz_name = self.get_timezone_name(latitude, longitude)
        
        if TIMEZONE_LIBS_AVAILABLE:
            try:
                tz = pytz.timezone(tz_name)
                
                # Localize the datetime to this timezone
                local_dt = tz.localize(local_datetime, is_dst=None)
                
                # Get offset
                utc_offset = local_dt.utcoffset()
                offset_hours = utc_offset.total_seconds() / 3600
                
                # Check if DST
                is_dst = bool(local_dt.dst())
                
                return offset_hours, tz_name, is_dst
                
            except Exception as e:
                print(f"Timezone error: {e}")
                # Fall through to fallback
        
        # Fallback: use fixed offset
        offset = self._get_fallback_offset(latitude, longitude)
        return offset, tz_name, False
    
    def _get_fallback_offset(self, latitude: float, longitude: float) -> float:
        """Get fallback offset without date consideration"""
        for region, (min_lon, max_lon, min_lat, max_lat, offset, tz_name) in FALLBACK_TIMEZONES.items():
            if min_lon <= longitude <= max_lon and min_lat <= latitude <= max_lat:
                return offset
        
        # Calculate from longitude
        return round(longitude / 15.0 * 2) / 2
    
    def local_to_utc(self, local_datetime: datetime, latitude: float, 
                     longitude: float, timezone_offset: Optional[float] = None) -> datetime:
        """
        Convert local time to UTC, considering DST and historical changes
        
        Args:
            local_datetime: Birth time in local timezone
            latitude: Birth latitude
            longitude: Birth longitude
            timezone_offset: Optional explicit override
        
        Returns:
            datetime in UTC
        """
        if timezone_offset is not None:
            # Use provided offset
            utc_dt = local_datetime - timedelta(hours=timezone_offset)
            return utc_dt
        
        # Auto-detect timezone and offset
        offset_hours, tz_name, is_dst = self.get_utc_offset(latitude, longitude, local_datetime)
        utc_dt = local_datetime - timedelta(hours=offset_hours)
        
        return utc_dt
    
    def get_timezone_info(self, latitude: float, longitude: float, 
                          local_datetime: datetime) -> dict:
        """
        Get complete timezone information
        """
        offset_hours, tz_name, is_dst = self.get_utc_offset(latitude, longitude, local_datetime)
        
        # Format offset string
        hours = int(offset_hours)
        minutes = int((offset_hours - hours) * 60)
        if minutes:
            offset_str = f"UTC{hours:+d}:{abs(minutes):02d}"
        else:
            offset_str = f"UTC{hours:+d}" if hours else "UTC"
        
        return {
            'timezone_name': tz_name,
            'offset_hours': offset_hours,
            'offset_string': offset_str,
            'is_dst': is_dst,
            'dst_note': 'Daylight Saving Time active' if is_dst else '',
        }


# Singleton instance
_tz_manager = None

def get_timezone_manager() -> TimezoneManager:
    global _tz_manager
    if _tz_manager is None:
        _tz_manager = TimezoneManager()
    return _tz_manager


# Convenience functions
def get_timezone_offset(latitude: float, longitude: float, 
                        local_datetime: datetime = None) -> Tuple[float, str]:
    """Get timezone offset for location (and optionally date)"""
    manager = get_timezone_manager()
    if local_datetime is None:
        local_datetime = datetime.now()
    offset, name, _ = manager.get_utc_offset(latitude, longitude, local_datetime)
    return offset, name


def local_to_utc(local_datetime: datetime, latitude: float, longitude: float,
                 timezone_offset: Optional[float] = None) -> datetime:
    """Convert local time to UTC"""
    manager = get_timezone_manager()
    return manager.local_to_utc(local_datetime, latitude, longitude, timezone_offset)


def get_timezone_info(latitude: float, longitude: float, 
                      local_datetime: datetime) -> dict:
    """Get complete timezone info"""
    manager = get_timezone_manager()
    return manager.get_timezone_info(latitude, longitude, local_datetime)
