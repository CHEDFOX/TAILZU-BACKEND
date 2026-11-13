"""
Sunrise and sunset for a place and a local date, from Swiss Ephemeris.

Every muhurta hour in the day (Rahu kalam, Yamaganda, Gulika, Abhijit, the
choghadiya) is a fraction of the span from sunrise to sunset. Until this module
the span was assumed to run 06:00–18:00 everywhere, every day, so a believer in
Mumbai in October (sunrise 06:31) was told Rahu kalam began at 15:00 when it
began at 15:27, and someone in Delhi in June (05:24) was off the other way. A
printed panchang has the right hours; the app has to match it to be trusted.

    sun_times(date_local, lat, lng, tz_offset_hours) -> {'sunrise': 6.52, 'sunset': 18.43}

Hours are decimal local hours on the given local date. Polar days and nights
(no rise or set) fall back to 06:00/18:00 so nothing downstream divides by zero.
"""
from datetime import datetime, date as _date
from typing import Dict, Union

import swisseph as swe

_FALLBACK = {'sunrise': 6.0, 'sunset': 18.0}


def _local_hour(jd_ut: float, tz_offset: float) -> float:
    y, m, d, h = swe.revjul(jd_ut + tz_offset / 24.0)
    return h


def sun_times(when: Union[datetime, _date], lat: float, lng: float, tz_offset: float) -> Dict[str, float]:
    """Decimal local hours of sunrise and sunset on the LOCAL calendar day of `when`."""
    try:
        d = when if isinstance(when, _date) and not isinstance(when, datetime) else when.date()
        # 0h local on that date, as UT
        jd0 = swe.julday(d.year, d.month, d.day, 0.0) - tz_offset / 24.0
        geopos = (float(lng), float(lat), 0.0)
        flags = swe.FLG_SWIEPH
        rise = swe.rise_trans(jd0, swe.SUN, swe.CALC_RISE, geopos, 0.0, 0.0, flags)
        sett = swe.rise_trans(jd0, swe.SUN, swe.CALC_SET, geopos, 0.0, 0.0, flags)
        if rise[0] != 0 or sett[0] != 0:
            return dict(_FALLBACK)
        jd_rise, jd_set = rise[1][0], sett[1][0]
        if jd_set < jd_rise:                       # the set found belongs to the previous day
            sett = swe.rise_trans(jd_rise, swe.SUN, swe.CALC_SET, geopos, 0.0, 0.0, flags)
            if sett[0] != 0:
                return dict(_FALLBACK)
            jd_set = sett[1][0]
        sr, ss = _local_hour(jd_rise, tz_offset), _local_hour(jd_set, tz_offset)
        if ss <= sr:
            ss += 24.0
        if not (2.0 < sr < 11.0) or not (13.0 < ss < 23.0):
            return dict(_FALLBACK)
        return {'sunrise': round(sr, 4), 'sunset': round(ss, 4)}
    except Exception:
        return dict(_FALLBACK)
