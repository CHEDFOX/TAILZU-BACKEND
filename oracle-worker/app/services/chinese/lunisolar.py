"""
CHINESE LUNISOLAR CALENDAR — new moons, solar terms, and the leap-month rule.

Zi Wei Dou Shu is placed from the LUNAR month and the LUNAR day, not the civil ones.
The old ziwei.py passed the Gregorian month and day straight into its placement
formulas, which is why its results were wrong by up to a month and a half regardless of
what the rest of the algorithm did. Fixing the star placement without fixing the
calendar underneath it would have been pointless.

`cnlunar` is in requirements.txt and can do the conversion, but it does not expose the
solar terms, and Zi Wei's Five Elements Bureau needs the sexagenary month pillar, which
turns at the solar terms rather than at the new moon. So this is written out rather than
delegated — and being dependency-free, it can actually be tested.

THE RULES, which are arithmetic once you have the astronomy:
  · A lunar month begins on the day of an astronomical new moon, in China Standard Time.
  · Month 11 is the month containing the December solstice.
  · Between one month 11 and the next there are 12 or 13 new moons. When there are 13,
    the year has a leap month: the FIRST month of that run which contains no zhongqi
    (major solar term — a solar longitude that is a multiple of 30°) takes the number of
    the month before it and is marked leap.

ACCURACY, stated plainly: solar longitude here is Meeus's low-precision series, good to
about 0.01°, or roughly fifteen minutes of time. New moon times are Meeus chapter 49,
good to a few seconds. Both are far inside the tolerance for deciding which DAY an event
falls on, which is all the calendar needs — except on the rare occasion when a new moon
or a solar term falls within minutes of local midnight. Chinese calendar authorities
resolve those from a full ephemeris; a handful of dates per century can differ. That is a
real limitation and it is not hidden.

Timezone: UTC+8 throughout. China standardised on it in 1929; before that the calendar
was computed for Beijing local mean time (UTC+7:46), so pre-1929 dates can be a day out
near a midnight boundary. Also honest, also rare.
"""
import math
from dataclasses import dataclass
from typing import List, Tuple

CHINA_TZ_OFFSET = 8.0 / 24.0        # UTC+8, as a fraction of a day
SYNODIC_MONTH = 29.530588861

# The calendar's civil day boundary. China computes at UTC+8 and Vietnam at UTC+7, and
# that one hour is not cosmetic: a new moon falling between 23:00 and 24:00 Hanoi time is
# already the next day in Beijing, so the Vietnamese lunar month starts a day earlier and
# Tết lands a day off Chinese New Year. It has happened repeatedly — 1985, 2007 — and a
# Tử Vi chart built on the Chinese calendar is simply the wrong chart on those years.
# Module-level rather than threaded through every signature, because the whole call graph
# below (new moons, solstices, zhongqi, month bracketing) has to agree on one boundary.
_TZ_OFFSET = CHINA_TZ_OFFSET


class calendar_zone:
    """Compute inside a different civil-day boundary.

        with calendar_zone(7):          # Vietnam
            ld = lunar_date(2007, 2, 17)

    Not thread-safe by design — it mutates module state — so callers that need
    concurrency should compute the date and pass the result on, not hold the context open.
    """

    def __init__(self, utc_offset_hours: float):
        self.offset = float(utc_offset_hours) / 24.0
        self._prev = None

    def __enter__(self):
        global _TZ_OFFSET
        self._prev = _TZ_OFFSET
        _TZ_OFFSET = self.offset
        return self

    def __exit__(self, *exc):
        global _TZ_OFFSET
        _TZ_OFFSET = self._prev
        return False

STEMS = ["Jia", "Yi", "Bing", "Ding", "Wu", "Ji", "Geng", "Xin", "Ren", "Gui"]
STEMS_CN = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"]
BRANCHES = ["Zi", "Chou", "Yin", "Mao", "Chen", "Si",
            "Wu", "Wei", "Shen", "You", "Xu", "Hai"]
BRANCHES_CN = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"]
BRANCH_ANIMALS = ["Rat", "Ox", "Tiger", "Rabbit", "Dragon", "Snake",
                  "Horse", "Goat", "Monkey", "Rooster", "Dog", "Pig"]

# The 24 solar terms, starting at solar longitude 315° (Lichun). Even indices here are
# the JIEQI (sectional, which start the sexagenary months); odd are the ZHONGQI (major,
# which the leap rule tests for).
SOLAR_TERMS = [
    ("Lichun", "立春", "spring begins", 315), ("Yushui", "雨水", "rain water", 330),
    ("Jingzhe", "惊蛰", "insects wake", 345), ("Chunfen", "春分", "spring equinox", 0),
    ("Qingming", "清明", "clear and bright", 15), ("Guyu", "谷雨", "grain rain", 30),
    ("Lixia", "立夏", "summer begins", 45), ("Xiaoman", "小满", "grain buds", 60),
    ("Mangzhong", "芒种", "grain in ear", 75), ("Xiazhi", "夏至", "summer solstice", 90),
    ("Xiaoshu", "小暑", "minor heat", 105), ("Dashu", "大暑", "major heat", 120),
    ("Liqiu", "立秋", "autumn begins", 135), ("Chushu", "处暑", "heat ends", 150),
    ("Bailu", "白露", "white dew", 165), ("Qiufen", "秋分", "autumn equinox", 180),
    ("Hanlu", "寒露", "cold dew", 195), ("Shuangjiang", "霜降", "frost descends", 210),
    ("Lidong", "立冬", "winter begins", 225), ("Xiaoxue", "小雪", "minor snow", 240),
    ("Daxue", "大雪", "major snow", 255), ("Dongzhi", "冬至", "winter solstice", 270),
    ("Xiaohan", "小寒", "minor cold", 285), ("Dahan", "大寒", "major cold", 300),
]


# ══════════════════════════════════════════════════════════════════════════════
# calendar arithmetic
# ══════════════════════════════════════════════════════════════════════════════

def gregorian_to_jd(year: int, month: int, day: int, hour: float = 0.0) -> float:
    """Julian Day for a Gregorian date. Fractional day from `hour` (0-24)."""
    y, m = int(year), int(month)
    if m <= 2:
        y -= 1
        m += 12
    a = y // 100
    b = 2 - a + a // 4
    jd = (math.floor(365.25 * (y + 4716)) + math.floor(30.6001 * (m + 1))
          + int(day) + b - 1524.5)
    return jd + float(hour) / 24.0


def jd_to_gregorian(jd: float) -> Tuple[int, int, int, float]:
    """(year, month, day, hour) from a Julian Day."""
    z = math.floor(jd + 0.5)
    f = (jd + 0.5) - z
    if z < 2299161:
        a = z
    else:
        alpha = math.floor((z - 1867216.25) / 36524.25)
        a = z + 1 + alpha - math.floor(alpha / 4)
    b = a + 1524
    c = math.floor((b - 122.1) / 365.25)
    d = math.floor(365.25 * c)
    e = math.floor((b - d) / 30.6001)
    day = b - d - math.floor(30.6001 * e) + f
    month = e - 1 if e < 14 else e - 13
    year = c - 4716 if month > 2 else c - 4715
    di = int(math.floor(day))
    return int(year), int(month), di, (day - di) * 24.0


def _delta_t(year: float) -> float:
    """TD - UT in seconds (Espenak & Meeus polynomials). Only the modern branches
    matter for birth data, but the tails keep historical dates from going wild."""
    y = float(year)
    if 2005 <= y <= 2050:
        t = y - 2000
        return 62.92 + 0.32217 * t + 0.005589 * t * t
    if 1986 <= y < 2005:
        t = y - 2000
        return (63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3
                + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5)
    if 1961 <= y < 1986:
        t = y - 1975
        return 45.45 + 1.067 * t - t ** 2 / 260.0 - t ** 3 / 718.0
    if 1941 <= y < 1961:
        t = y - 1950
        return 29.07 + 0.407 * t - t ** 2 / 233.0 + t ** 3 / 2547.0
    if 1920 <= y < 1941:
        t = y - 1920
        return 21.20 + 0.84493 * t - 0.076100 * t ** 2 + 0.0020936 * t ** 3
    if 1900 <= y < 1920:
        t = y - 1900
        return (-2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3
                - 0.000197 * t ** 4)
    if 1860 <= y < 1900:
        t = y - 1860
        return (7.62 + 0.5737 * t - 0.251754 * t ** 2 + 0.01680668 * t ** 3
                - 0.0004473624 * t ** 4 + t ** 5 / 233174.0)
    if 2050 < y <= 2150:
        return -20 + 32 * ((y - 1820) / 100.0) ** 2 - 0.5628 * (2150 - y)
    u = (y - 1820) / 100.0
    return -20 + 32 * u * u


def _norm360(x: float) -> float:
    return x % 360.0


def solar_longitude(jd_tt: float) -> float:
    """Apparent geocentric longitude of the Sun, in degrees, for a TT Julian Day.
    Meeus ch. 25 low-precision — about 0.01°."""
    t = (jd_tt - 2451545.0) / 36525.0
    l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t * t
    m = math.radians(_norm360(357.52911 + 35999.05029 * t - 0.0001537 * t * t))
    c = ((1.914602 - 0.004817 * t - 0.000014 * t * t) * math.sin(m)
         + (0.019993 - 0.000101 * t) * math.sin(2 * m)
         + 0.000289 * math.sin(3 * m))
    true_long = l0 + c
    omega = math.radians(125.04 - 1934.136 * t)
    return _norm360(true_long - 0.00569 - 0.00478 * math.sin(omega))


def new_moon_k(k: float) -> float:
    """Julian Day (TT) of the new moon numbered k. k=0 is the new moon of 2000 Jan 6.
    Meeus ch. 49, full periodic terms plus the fourteen A-corrections."""
    t = k / 1236.85
    t2, t3, t4 = t * t, t ** 3, t ** 4
    jde = (2451550.09766 + 29.530588861 * k + 0.00015437 * t2
           - 0.000000150 * t3 + 0.00000000073 * t4)
    e = 1 - 0.002516 * t - 0.0000074 * t2
    m = math.radians(_norm360(2.5534 + 29.10535670 * k - 0.0000014 * t2 - 0.00000011 * t3))
    mp = math.radians(_norm360(201.5643 + 385.81693528 * k + 0.0107582 * t2
                               + 0.00001238 * t3 - 0.000000058 * t4))
    f = math.radians(_norm360(160.7108 + 390.67050284 * k - 0.0016118 * t2
                              - 0.00000227 * t3 + 0.000000011 * t4))
    om = math.radians(_norm360(124.7746 - 1.56375588 * k + 0.0020672 * t2 + 0.00000215 * t3))

    corr = (-0.40720 * math.sin(mp)
            + 0.17241 * e * math.sin(m)
            + 0.01608 * math.sin(2 * mp)
            + 0.01039 * math.sin(2 * f)
            + 0.00739 * e * math.sin(mp - m)
            - 0.00514 * e * math.sin(mp + m)
            + 0.00208 * e * e * math.sin(2 * m)
            - 0.00111 * math.sin(mp - 2 * f)
            - 0.00057 * math.sin(mp + 2 * f)
            + 0.00056 * e * math.sin(2 * mp + m)
            - 0.00042 * math.sin(3 * mp)
            + 0.00042 * e * math.sin(m + 2 * f)
            + 0.00038 * e * math.sin(m - 2 * f)
            - 0.00024 * e * math.sin(2 * mp - m)
            - 0.00017 * math.sin(om)
            - 0.00007 * math.sin(mp + 2 * m)
            + 0.00004 * math.sin(2 * mp - 2 * f)
            + 0.00004 * math.sin(3 * m)
            + 0.00003 * math.sin(mp + m - 2 * f)
            + 0.00003 * math.sin(2 * mp + 2 * f)
            - 0.00003 * math.sin(mp + m + 2 * f)
            + 0.00003 * math.sin(mp - m + 2 * f)
            - 0.00002 * math.sin(mp - m - 2 * f)
            - 0.00002 * math.sin(3 * mp + m)
            + 0.00002 * math.sin(4 * mp))

    a = [299.77 + 0.107408 * k - 0.009173 * t2, 251.88 + 0.016321 * k,
         251.83 + 26.651886 * k, 349.42 + 36.412478 * k, 84.66 + 18.206239 * k,
         141.74 + 53.303771 * k, 207.14 + 2.453732 * k, 154.84 + 7.306860 * k,
         34.52 + 27.261239 * k, 207.19 + 0.121824 * k, 291.34 + 1.844379 * k,
         161.72 + 24.198154 * k, 239.56 + 25.513099 * k, 331.55 + 3.592518 * k]
    w = [0.000325, 0.000165, 0.000164, 0.000126, 0.000110, 0.000062, 0.000060,
         0.000056, 0.000047, 0.000042, 0.000040, 0.000037, 0.000035, 0.000023]
    extra = sum(wi * math.sin(math.radians(_norm360(ai))) for ai, wi in zip(a, w))
    return jde + corr + extra


def _tt_to_china_day(jd_tt: float) -> int:
    """The China-time civil day (as an integer JD at midnight) containing a TT instant."""
    y = 2000 + (jd_tt - 2451545.0) / 365.25
    jd_ut = jd_tt - _delta_t(y) / 86400.0
    return int(math.floor(jd_ut + _TZ_OFFSET + 0.5))


def new_moon_days(jd_start: float, jd_end: float) -> List[int]:
    """Integer China-time days of every new moon in a JD range, ascending."""
    k0 = math.floor((jd_start - 2451550.09766) / SYNODIC_MONTH) - 2
    k1 = math.ceil((jd_end - 2451550.09766) / SYNODIC_MONTH) + 2
    out = []
    k = k0
    while k <= k1:
        d = _tt_to_china_day(new_moon_k(k))
        if not out or d > out[-1]:
            out.append(d)
        k += 1
    return [d for d in out if jd_start - 40 <= d <= jd_end + 40]


def solar_term_jd(year: int, target_longitude: float) -> float:
    """TT Julian Day when the Sun reaches a longitude, in or near a given year.
    Newton iteration on the low-precision series; converges in three or four passes."""
    tgt = _norm360(target_longitude)
    # Seed: the Sun covers ~0.9856°/day and is at ~280° on Jan 1.
    approx = gregorian_to_jd(int(year), 1, 1) + ((tgt - 280.0) % 360.0) / 0.98565
    jd = approx
    for _ in range(8):
        diff = (solar_longitude(jd) - tgt + 180.0) % 360.0 - 180.0
        if abs(diff) < 1e-7:
            break
        jd -= diff / 0.98565
    return jd


def _december_solstice_day(year: int) -> int:
    """China-time day of the December solstice (solar longitude 270°) of `year`."""
    jd = solar_term_jd(year, 270.0)
    # The seed can land a year early or late for longitudes near the wrap; pull it back.
    while jd_to_gregorian(jd)[0] < year:
        jd += 365.2422
    while jd_to_gregorian(jd)[0] > year:
        jd -= 365.2422
    for _ in range(6):
        diff = (solar_longitude(jd) - 270.0 + 180.0) % 360.0 - 180.0
        if abs(diff) < 1e-7:
            break
        jd -= diff / 0.98565
    return _tt_to_china_day(jd)


def _zhongqi_days(jd_from: float, jd_to: float) -> List[int]:
    """China-time days of every major solar term (longitude ≡ 0 mod 30) in a range."""
    out = set()
    y0 = jd_to_gregorian(jd_from)[0] - 1
    y1 = jd_to_gregorian(jd_to)[0] + 1
    for y in range(y0, y1 + 1):
        for lon in range(0, 360, 30):
            jd = solar_term_jd(y, float(lon))
            if jd_from - 2 <= jd <= jd_to + 2:
                out.add(_tt_to_china_day(jd))
    return sorted(out)


# ══════════════════════════════════════════════════════════════════════════════
# the lunar date
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class LunarDate:
    year: int                 # the sexagenary year this lunar date belongs to
    month: int                # 1-12
    day: int                  # 1-30
    is_leap_month: bool
    month_days: int           # 29 or 30 — Zi Wei's bureau tables care
    year_stem: int            # 0-9
    year_branch: int          # 0-11
    month_stem: int
    month_branch: int         # solar-term month, NOT the lunar month number
    day_stem: int
    day_branch: int
    hour_branch: int          # 0-11, the double-hour (Zi = 23:00-01:00)
    hour_stem: int
    jd: float                 # China-time integer day

    @property
    def year_pillar(self) -> str:
        return f"{STEMS[self.year_stem]}{BRANCHES[self.year_branch]}"

    @property
    def animal(self) -> str:
        return BRANCH_ANIMALS[self.year_branch]

    @property
    def label(self) -> str:
        lead = "leap " if self.is_leap_month else ""
        return f"lunar {lead}month {self.month}, day {self.day}"


def _month_starts_for(day_jd: int) -> Tuple[List[int], List[Tuple[int, bool]], int]:
    """The new-moon days bracketing a date, each tagged with its month number and leap
    flag. Returns (starts, [(month_no, is_leap)], index of the month containing day_jd).

    Built the way the rule is stated: anchor on the month 11 that contains the December
    solstice before this date, run to the next one, and if that span holds 13 months find
    the first without a zhongqi."""
    gy = jd_to_gregorian(float(day_jd))[0]

    # The month-11 anchor at or before this date. Usually the window opened by last
    # year's solstice, but a date in the days AFTER a December solstice already belongs
    # to the next window (back=-1), and one in early January to the previous (back=1).
    for back in (0, -1, 1):
        s_prev = _december_solstice_day(gy - 1 - back)
        s_next = _december_solstice_day(gy - back)
        nm = new_moon_days(float(s_prev) - 40, float(s_next) + 40)
        starts_prev = [d for d in nm if d <= s_prev]
        if not starts_prev:
            continue
        m11 = starts_prev[-1]                       # month 11 of the previous cycle
        after = [d for d in nm if d > m11]
        m11_next = None
        for d in after:
            if d <= s_next:
                m11_next = d
        if m11_next is None:
            continue
        if m11 <= day_jd < m11_next:
            break
    else:
        raise ValueError(f"could not bracket lunar year for JD {day_jd}")

    span = [m11] + [d for d in after if d <= m11_next]
    count = len(span) - 1                            # months from m11 up to (not incl) next m11

    labels: List[Tuple[int, bool]] = []
    if count <= 12:
        for i in range(len(span)):
            labels.append((((11 - 1 + i) % 12) + 1, False))
    else:
        zq = set(_zhongqi_days(float(m11) - 2, float(m11_next) + 2))
        leap_at = None
        for i in range(len(span) - 1):
            lo, hi = span[i], span[i + 1]
            if not any(lo <= z < hi for z in zq):
                leap_at = i
                break
        n = 11
        for i in range(len(span)):
            if leap_at is not None and i == leap_at:
                labels.append((((n - 2) % 12) + 1, True))   # repeats the previous number
            else:
                labels.append((((n - 1) % 12) + 1, False))
                n += 1

    idx = 0
    for i, d in enumerate(span):
        if d <= day_jd:
            idx = i
    return span, labels, idx


def _sexagenary_year(day_jd: int, month_no: int, is_leap: bool, span, labels) -> int:
    """The sexagenary year number. It turns at lunar month 1, not at January and not at
    Lichun — Zi Wei uses the lunar-new-year reckoning."""
    gy = jd_to_gregorian(float(day_jd))[0]
    # Find where month 1 of this lunar year starts.
    m1 = None
    for d, (mn, lp) in zip(span, labels):
        if mn == 1 and not lp:
            m1 = d
            break
    if m1 is not None and day_jd < m1:
        gy -= 1
    elif m1 is not None and jd_to_gregorian(float(m1))[0] > gy:
        gy -= 1
    return gy


def lunar_date(year: int, month: int, day: int, hour: int = 12, minute: int = 0) -> LunarDate:
    """The full lunar date and four pillars for a civil date and clock time.

    `hour` is local clock time at the birthplace. The double-hour branch is taken from it
    directly — Zi Wei is placed from the hour BRANCH, and every school agrees the branch
    follows local time rather than a zone offset."""
    day_jd = int(math.floor(gregorian_to_jd(year, month, day) + 0.5))

    # The Zi hour (23:00-01:00) belongs to the NEXT day for the day pillar. This matters:
    # a 23:30 birth takes the following day's stem, which moves the whole chart.
    h = int(hour)
    day_for_pillar = day_jd + 1 if h >= 23 else day_jd

    span, labels, idx = _month_starts_for(day_jd)
    month_no, is_leap = labels[idx]
    lday = day_jd - span[idx] + 1
    mdays = (span[idx + 1] - span[idx]) if idx + 1 < len(span) else 30

    sy = _sexagenary_year(day_jd, month_no, is_leap, span, labels)
    y_stem = (sy - 4) % 10
    y_branch = (sy - 4) % 12

    # The month pillar runs on SOLAR terms: the Yin month begins at Lichun (315°).
    sl = solar_longitude(float(day_jd))
    m_branch = (int(math.floor(((sl - 315.0) % 360.0) / 30.0)) + 2) % 12
    # Five Tigers Escaping: the Yin month's stem from the year stem.
    m_stem = ((y_stem % 5) * 2 + 2 + ((m_branch - 2) % 12)) % 10

    # Day pillar, on the standard JDN offsets: 2000-01-01 (JDN 2451545) was Wu-Wu.
    d_stem = (day_for_pillar + 9) % 10
    d_branch = (day_for_pillar + 1) % 12

    hb = 0 if h >= 23 else (h + 1) // 2
    # Five Rats Escaping: the Zi hour's stem from the day stem.
    h_stem = ((d_stem % 5) * 2 + hb) % 10

    return LunarDate(
        year=sy, month=month_no, day=lday, is_leap_month=is_leap, month_days=mdays,
        year_stem=y_stem, year_branch=y_branch, month_stem=m_stem, month_branch=m_branch,
        day_stem=d_stem, day_branch=d_branch, hour_branch=hb, hour_stem=h_stem,
        jd=float(day_jd),
    )


def chinese_new_year(gregorian_year: int) -> Tuple[int, int, int]:
    """(y, m, d) of lunar new year — month 1 day 1 — for a Gregorian year. Mostly a
    verification handle: these dates are published, so the calendar can be checked."""
    probe = int(math.floor(gregorian_to_jd(gregorian_year, 3, 1) + 0.5))
    span, labels, _ = _month_starts_for(probe)
    for d, (mn, lp) in zip(span, labels):
        if mn == 1 and not lp:
            y, m, dd, _ = jd_to_gregorian(float(d))
            return y, m, dd
    raise ValueError(f"no lunar month 1 found for {gregorian_year}")


def solar_terms_of(gregorian_year: int) -> List[dict]:
    """All 24 terms of a Gregorian year, with their China-time dates."""
    out = []
    for name, cn, gloss, lon in SOLAR_TERMS:
        jd = solar_term_jd(gregorian_year, float(lon))
        y, m, d, _ = jd_to_gregorian(float(_tt_to_china_day(jd)))
        if y != gregorian_year:
            continue
        out.append({"name": name, "chinese": cn, "meaning": gloss,
                    "longitude": lon, "date": f"{y:04d}-{m:02d}-{d:02d}",
                    "major": lon % 30 == 0 and (lon // 15) % 2 == 1})
    return sorted(out, key=lambda r: r["date"])
