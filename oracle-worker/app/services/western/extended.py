"""
WESTERN EXTENDED — Traditional Dignities, Asteroids, Planetary Nodes, Prenatal,
Davison Chart, Synastry Overlays, Electional, Decennials
"""
from datetime import datetime, timedelta
from typing import Dict, List
from .chart import SIGNS, SIGN_ELEMENTS, TRADITIONAL_RULERS, WESTERN_PLANETS

# ═══════════════════════════════════════════════════════════════
# 5-TIER ESSENTIAL DIGNITIES
# ═══════════════════════════════════════════════════════════════
TRIPLICITY_RULERS = {
    'Fire':  {'day': 'Sun', 'night': 'Jupiter', 'participating': 'Saturn'},
    'Earth': {'day': 'Venus', 'night': 'Moon', 'participating': 'Mars'},
    'Air':   {'day': 'Saturn', 'night': 'Mercury', 'participating': 'Jupiter'},
    'Water': {'day': 'Venus', 'night': 'Mars', 'participating': 'Moon'},
}

# Egyptian Terms/Bounds (degrees per sign, 5 rulers)
TERMS = {
    'Aries': [('Jupiter', 6), ('Venus', 12), ('Mercury', 20), ('Mars', 25), ('Saturn', 30)],
    'Taurus': [('Venus', 8), ('Mercury', 14), ('Jupiter', 22), ('Saturn', 27), ('Mars', 30)],
    'Gemini': [('Mercury', 6), ('Jupiter', 12), ('Venus', 17), ('Mars', 24), ('Saturn', 30)],
    'Cancer': [('Mars', 7), ('Venus', 13), ('Mercury', 19), ('Jupiter', 26), ('Saturn', 30)],
    'Leo': [('Jupiter', 6), ('Venus', 11), ('Saturn', 18), ('Mercury', 24), ('Mars', 30)],
    'Virgo': [('Mercury', 7), ('Venus', 17), ('Jupiter', 21), ('Mars', 28), ('Saturn', 30)],
    'Libra': [('Saturn', 6), ('Mercury', 14), ('Jupiter', 21), ('Venus', 28), ('Mars', 30)],
    'Scorpio': [('Mars', 7), ('Venus', 11), ('Mercury', 19), ('Jupiter', 24), ('Saturn', 30)],
    'Sagittarius': [('Jupiter', 12), ('Venus', 17), ('Mercury', 21), ('Saturn', 26), ('Mars', 30)],
    'Capricorn': [('Mercury', 7), ('Jupiter', 14), ('Venus', 22), ('Saturn', 26), ('Mars', 30)],
    'Aquarius': [('Mercury', 7), ('Venus', 13), ('Jupiter', 20), ('Mars', 25), ('Saturn', 30)],
    'Pisces': [('Venus', 12), ('Jupiter', 16), ('Mercury', 19), ('Mars', 28), ('Saturn', 30)],
}

# Face/Decan rulers (Chaldean order)
FACE_RULERS = {i: ['Mars','Sun','Venus','Mercury','Moon','Saturn','Jupiter',
                    'Mars','Sun','Venus','Mercury','Moon','Saturn','Jupiter',
                    'Mars','Sun','Venus','Mercury','Moon','Saturn','Jupiter',
                    'Mars','Sun','Venus','Mercury','Moon','Saturn','Jupiter',
                    'Mars','Sun','Venus','Mercury','Moon','Saturn','Jupiter','Mars','Sun'] for i in range(36)}
CHALDEAN_FACES = ['Mars','Sun','Venus','Mercury','Moon','Saturn','Jupiter'] * 6

def get_term_ruler(sign: str, degree: float) -> str:
    terms = TERMS.get(sign, [])
    for ruler, end_deg in terms:
        if degree < end_deg:
            return ruler
    return terms[-1][0] if terms else ''

def get_face_ruler(longitude: float) -> str:
    face_idx = int(longitude / 10) % 36
    return CHALDEAN_FACES[face_idx] if face_idx < len(CHALDEAN_FACES) else ''

def get_triplicity_ruler(sign: str, is_day: bool) -> str:
    element = SIGN_ELEMENTS.get(sign, 'Fire')
    trip = TRIPLICITY_RULERS.get(element, {})
    return trip.get('day' if is_day else 'night', '')

def calculate_essential_dignity_score(planet: str, sign: str, degree: float, is_day: bool) -> Dict:
    """Full 5-tier essential dignity scoring."""
    score = 0
    dignities = []
    
    # Domicile (+5)
    if TRADITIONAL_RULERS.get(sign) == planet:
        score += 5; dignities.append('Domicile (+5)')
    # Exaltation (+4)
    EXALT = {'Sun':'Aries','Moon':'Taurus','Mercury':'Virgo','Venus':'Pisces',
             'Mars':'Capricorn','Jupiter':'Cancer','Saturn':'Libra'}
    if EXALT.get(planet) == sign:
        score += 4; dignities.append('Exaltation (+4)')
    # Triplicity (+3)
    if get_triplicity_ruler(sign, is_day) == planet:
        score += 3; dignities.append('Triplicity (+3)')
    # Term (+2)
    if get_term_ruler(sign, degree) == planet:
        score += 2; dignities.append('Term (+2)')
    # Face (+1)
    longitude = SIGNS.index(sign) * 30 + degree if sign in SIGNS else degree
    if get_face_ruler(longitude) == planet:
        score += 1; dignities.append('Face (+1)')
    # Detriment (-5)
    DETRI = {'Sun':'Aquarius','Moon':'Capricorn','Mercury':'Sagittarius','Venus':'Aries',
             'Mars':'Libra','Jupiter':'Gemini','Saturn':'Cancer'}
    if DETRI.get(planet) == sign:
        score -= 5; dignities.append('Detriment (-5)')
    # Fall (-4)
    FALL = {'Sun':'Libra','Moon':'Scorpio','Mercury':'Pisces','Venus':'Virgo',
            'Mars':'Cancer','Jupiter':'Capricorn','Saturn':'Aries'}
    if FALL.get(planet) == sign:
        score -= 4; dignities.append('Fall (-4)')
    
    if not dignities:
        dignities.append('Peregrine (0)')
    
    return {'planet': planet, 'sign': sign, 'score': score, 'dignities': dignities}

def calculate_all_dignities(planets: Dict, is_day: bool) -> Dict:
    result = {}
    for name in WESTERN_PLANETS:
        p = planets.get(name, {})
        result[name] = calculate_essential_dignity_score(
            name, p.get('sign', 'Aries'), p.get('degree', 15), is_day)
    return result

# ═══════════════════════════════════════════════════════════════
# ALMUTEN
# ═══════════════════════════════════════════════════════════════
def calculate_almuten(planets: Dict, asc_long: float, mc_long: float, is_day: bool) -> Dict:
    """Find the Almuten — planet with highest total essential dignity across key points."""
    key_points = {
        'Ascendant': asc_long, 'MC': mc_long,
        'Sun': planets.get('Sun', {}).get('longitude', 0),
        'Moon': planets.get('Moon', {}).get('longitude', 0),
        'PNL': planets.get('Moon', {}).get('longitude', 0),  # Prenatal lunation approx
    }
    
    totals = {p: 0 for p in WESTERN_PLANETS[:7]}
    for point_name, lon in key_points.items():
        sign = SIGNS[int(lon / 30) % 12]
        deg = lon % 30
        for planet in WESTERN_PLANETS[:7]:
            d = calculate_essential_dignity_score(planet, sign, deg, is_day)
            totals[planet] += d['score']
    
    almuten = max(totals, key=totals.get)
    return {'almuten': almuten, 'score': totals[almuten], 'all_scores': totals}

# ═══════════════════════════════════════════════════════════════
# HAYZ / HALB
# ═══════════════════════════════════════════════════════════════
def check_hayz(planets: Dict, is_day: bool) -> Dict:
    """Check planetary condition — Hayz (ideal) or contrary."""
    DIURNAL = {'Sun', 'Jupiter', 'Saturn'}
    NOCTURNAL = {'Moon', 'Venus', 'Mars'}
    MASCULINE = {0, 2, 4, 6, 8, 10}  # Aries, Gemini, Leo, Libra, Sag, Aquarius
    
    results = {}
    for name in WESTERN_PLANETS[:7]:
        p = planets.get(name, {})
        sign_idx = p.get('sign_index', 0)
        house = p.get('house', 1)
        above = house <= 6
        
        is_masc_sign = sign_idx in MASCULINE
        is_diurnal = name in DIURNAL
        
        if is_diurnal and is_day and above and is_masc_sign:
            condition = 'In Hayz (perfect condition)'
        elif not is_diurnal and not is_day and not above and not is_masc_sign:
            condition = 'In Hayz (perfect condition)'
        elif (is_diurnal and is_day) or (not is_diurnal and not is_day):
            condition = 'In Halb (partial condition)'
        else:
            condition = 'Contrary to sect (weakened)'
        
        results[name] = {'condition': condition, 'diurnal': is_diurnal, 'above_horizon': above}
    return results

# ═══════════════════════════════════════════════════════════════
# PLANETARY JOYS
# ═══════════════════════════════════════════════════════════════
PLANETARY_JOYS = {
    'Mercury': 1, 'Moon': 3, 'Venus': 5, 'Mars': 6,
    'Sun': 9, 'Jupiter': 11, 'Saturn': 12,
}

def check_planetary_joys(planets: Dict) -> List[Dict]:
    results = []
    for planet, joy_house in PLANETARY_JOYS.items():
        actual = planets.get(planet, {}).get('house', 0)
        in_joy = actual == joy_house
        results.append({'planet': planet, 'joy_house': joy_house, 'actual_house': actual,
                       'in_joy': in_joy,
                       'effect': f'{planet} rejoices in H{joy_house} — enhanced expression' if in_joy else ''})
    return results

# ═══════════════════════════════════════════════════════════════
# ASTEROIDS (Ceres, Pallas, Juno, Vesta)
# ═══════════════════════════════════════════════════════════════
# Swiss Ephemeris BODY numbers (SE_CERES … SE_VESTA), used as they are. The code
# added AST_OFFSET (10000) to them, which addresses numbered MINOR PLANETS — #17
# Thetis, #18 Melpomene, #19 Fortuna, #20 Massalia — each needing its own file that
# no server has, so the section was always empty (and wrong had it ever run).
ASTEROID_IDS = {'Ceres': 17, 'Pallas': 18, 'Juno': 19, 'Vesta': 20}
ASTEROID_MEANINGS = {
    'Ceres': 'Nurturing, food, harvest, mother-child bond, loss and return',
    'Pallas': 'Strategy, wisdom, pattern recognition, creative intelligence, justice',
    'Juno': 'Committed partnerships, marriage equality, loyalty, betrayal',
    'Vesta': 'Sacred flame, devotion, focus, sexuality, self-sufficiency',
}

def calculate_asteroids(birth_dt: datetime) -> Dict:
    try:
        import swisseph as swe
        from app.services.core import ephemeris as _eph   # sets the ephemeris path
        swe.set_ephe_path(_eph.EPHE_PATH)
        jd = swe.julday(birth_dt.year, birth_dt.month, birth_dt.day,
                        birth_dt.hour + birth_dt.minute / 60.0)
        results = {}
        for name, swe_id in ASTEROID_IDS.items():
            result = swe.calc_ut(jd, swe_id, swe.FLG_SWIEPH)
            lon = result[0][0] % 360
            sign_idx = int(lon / 30)
            results[name] = {
                'longitude': round(lon, 2), 'sign': SIGNS[sign_idx],
                'degree': round(lon % 30, 2), 'meaning': ASTEROID_MEANINGS.get(name, ''),
            }
        return results
    except Exception as e:
        print(f"[asteroids] not computed: {str(e)[:160]}")
        return {}

# ═══════════════════════════════════════════════════════════════
# PLANETARY NODES (all planets)
# ═══════════════════════════════════════════════════════════════
# Mean node longitudes (epoch 2000, approximate)
PLANET_NODE_LONGITUDES = {
    'Mercury': (48.3, 228.3), 'Venus': (76.7, 256.7), 'Mars': (49.6, 229.6),
    'Jupiter': (100.5, 280.5), 'Saturn': (113.6, 293.6),
    'Uranus': (74.0, 254.0), 'Neptune': (131.8, 311.8), 'Pluto': (110.4, 290.4),
}

def get_planetary_nodes() -> Dict:
    results = {}
    for planet, (nn, sn) in PLANET_NODE_LONGITUDES.items():
        results[planet] = {
            'north_node': {'longitude': nn, 'sign': SIGNS[int(nn/30)%12], 'degree': round(nn%30, 1)},
            'south_node': {'longitude': sn, 'sign': SIGNS[int(sn/30)%12], 'degree': round(sn%30, 1)},
            'meaning': f'{planet} karma axis — growth through {SIGNS[int(nn/30)%12]}, release through {SIGNS[int(sn/30)%12]}',
        }
    return results

# ═══════════════════════════════════════════════════════════════
# PRENATAL ECLIPSE & LUNATION
# ═══════════════════════════════════════════════════════════════
def find_prenatal_lunation(birth_dt: datetime) -> Dict:
    try:
        import swisseph as swe
        jd = swe.julday(birth_dt.year, birth_dt.month, birth_dt.day,
                        birth_dt.hour + birth_dt.minute / 60.0)
        # Search backward for New/Full Moon
        for day_offset in range(1, 30):
            test_jd = jd - day_offset
            sun = swe.calc_ut(test_jd, 0, swe.FLG_SWIEPH)[0][0] % 360
            moon = swe.calc_ut(test_jd, 1, swe.FLG_SWIEPH)[0][0] % 360
            diff = abs(sun - moon)
            if diff > 180: diff = 360 - diff
            
            if diff < 5:  # Near New Moon
                sign = SIGNS[int(moon / 30) % 12]
                y, m, d, h = swe.revjul(test_jd)
                return {'type': 'Prenatal New Moon', 'sign': sign, 'degree': round(moon % 30, 1),
                        'date': f'{int(y)}-{int(m):02d}-{int(d):02d}',
                        'meaning': 'Born in waxing phase — building, initiating personality'}
            if abs(diff - 180) < 5:  # Near Full Moon
                sign = SIGNS[int(moon / 30) % 12]
                y, m, d, h = swe.revjul(test_jd)
                return {'type': 'Prenatal Full Moon', 'sign': sign, 'degree': round(moon % 30, 1),
                        'date': f'{int(y)}-{int(m):02d}-{int(d):02d}',
                        'meaning': 'Born in waning phase — releasing, fulfilling personality'}
        return {}
    except Exception:
        return {}

# ═══════════════════════════════════════════════════════════════
# DAVISON CHART
# ═══════════════════════════════════════════════════════════════
def calculate_davison(birth_dt1: datetime, lat1: float, lon1: float,
                       birth_dt2: datetime, lat2: float, lon2: float) -> Dict:
    """Davison Relationship Chart — midpoint of two birth dates/times/places."""
    from .chart import WesternChart
    
    # Midpoint of timestamps
    ts1 = birth_dt1.timestamp()
    ts2 = birth_dt2.timestamp()
    mid_ts = (ts1 + ts2) / 2
    mid_dt = datetime.fromtimestamp(mid_ts)
    mid_lat = (lat1 + lat2) / 2
    mid_lon = (lon1 + lon2) / 2
    
    dav = WesternChart(mid_dt, mid_lat, mid_lon)
    report = dav.generate_full_report()
    report['type'] = 'Davison Relationship Chart'
    report['midpoint_date'] = mid_dt.isoformat()
    return report

# ═══════════════════════════════════════════════════════════════
# SYNASTRY HOUSE OVERLAYS
# ═══════════════════════════════════════════════════════════════
def synastry_house_overlays(chart1, chart2) -> Dict:
    """Where partner's planets fall in your houses."""
    chart1._ensure_calculated()
    chart2._ensure_calculated()
    overlays = {}
    for name in WESTERN_PLANETS:
        p2_long = chart2.planets.get(name, {}).get('longitude', 0)
        house_in_p1 = chart1._house_from_cusps(p2_long, [chart1._houses[i+1]['cusp'] for i in range(12)])
        overlays[name] = {
            'partner_planet': name, 'partner_sign': chart2.planets.get(name, {}).get('sign', ''),
            'falls_in_your_house': house_in_p1,
        }
    return overlays

# ═══════════════════════════════════════════════════════════════
# DECENNIALS (Hellenistic Time-Lord)
# ═══════════════════════════════════════════════════════════════
DECENNIAL_SEQUENCE_DAY = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']
DECENNIAL_SEQUENCE_NIGHT = ['Moon', 'Sun', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']
DECENNIAL_YEARS = {'Sun': 10.9, 'Moon': 9.1, 'Mercury': 7.6, 'Venus': 8.2,
                    'Mars': 6.6, 'Jupiter': 11.5, 'Saturn': 10.7}

def calculate_decennials(birth_dt: datetime, is_day: bool) -> Dict:
    seq = DECENNIAL_SEQUENCE_DAY if is_day else DECENNIAL_SEQUENCE_NIGHT
    now = datetime.now()
    age = (now - birth_dt).days / 365.25
    
    periods = []
    accumulated = 0
    current = None
    for cycle in range(3):  # 3 full cycles
        for planet in seq:
            length = DECENNIAL_YEARS[planet]
            period = {'planet': planet, 'start_age': round(accumulated, 1),
                     'end_age': round(accumulated + length, 1), 'length': length}
            if accumulated <= age < accumulated + length:
                period['is_current'] = True
                current = period
            periods.append(period)
            accumulated += length
            if accumulated > age + 50:
                break
        if accumulated > age + 50:
            break
    
    return {'current': current, 'periods': periods[:14], 'system': 'Decennials (Valens)'}

# ═══════════════════════════════════════════════════════════════
# TERTIARY & CONVERSE PROGRESSIONS
# ═══════════════════════════════════════════════════════════════
def tertiary_progressions(natal_chart, target_date: datetime = None) -> Dict:
    """Tertiary: 1 day = 1 lunar month (~27.3 days)."""
    now = target_date or datetime.now()
    age_days = (now - natal_chart.birth_dt).days
    lunar_months = age_days / 27.3
    prog_offset = timedelta(days=lunar_months)
    prog_date = natal_chart.birth_dt + prog_offset
    
    from .chart import WesternChart
    tp = WesternChart(prog_date, natal_chart.latitude, natal_chart.longitude)
    tp._ensure_calculated()
    moon = tp.planets.get('Moon', {})
    return {
        'type': 'Tertiary Progressions', 'progressed_date': prog_date.isoformat(),
        'tertiary_moon_sign': moon.get('sign', ''), 'tertiary_moon_house': moon.get('house', 0),
    }

def converse_progressions(natal_chart, target_date: datetime = None) -> Dict:
    """Converse: same as secondary but going backward from birth."""
    now = target_date or datetime.now()
    age_days = (now - natal_chart.birth_dt).days
    age_years = age_days / 365.25
    conv_offset = timedelta(days=age_years)
    conv_date = natal_chart.birth_dt - conv_offset
    
    from .chart import WesternChart
    cp = WesternChart(conv_date, natal_chart.latitude, natal_chart.longitude)
    cp._ensure_calculated()
    moon = cp.planets.get('Moon', {})
    return {
        'type': 'Converse Progressions', 'converse_date': conv_date.isoformat(),
        'converse_moon_sign': moon.get('sign', ''), 'converse_moon_house': moon.get('house', 0),
        'meaning': 'Past-life and karmic material surfacing',
    }

# ═══════════════════════════════════════════════════════════════
# PROGRESSED LUNATION CYCLE
# ═══════════════════════════════════════════════════════════════
def progressed_lunation_cycle(natal_chart) -> Dict:
    """Track the ~30-year progressed Sun-Moon cycle."""
    from .timing import SecondaryProgressions
    sp = SecondaryProgressions(natal_chart)
    prog = sp.get_progressed_chart()
    
    # Get progressed Sun-Moon angle
    # The prog chart has natal positions shifted
    natal_sun = natal_chart.planets['Sun']['longitude']
    natal_moon = natal_chart.planets['Moon']['longitude']
    natal_diff = (natal_moon - natal_sun) % 360
    
    # Approximate progressed angle shift (~12° per year for Moon, ~1° for Sun)
    age = prog.get('age_years', 0)
    prog_diff = (natal_diff + age * 11) % 360  # ~11° more per year
    
    if prog_diff < 45:
        phase = 'New Moon phase — new beginnings, seeding'
    elif prog_diff < 90:
        phase = 'Crescent — emerging, building momentum'
    elif prog_diff < 135:
        phase = 'First Quarter — crisis in action, decisions'
    elif prog_diff < 180:
        phase = 'Gibbous — refining, analyzing, perfecting'
    elif prog_diff < 225:
        phase = 'Full Moon — culmination, awareness, harvest'
    elif prog_diff < 270:
        phase = 'Disseminating — sharing wisdom, teaching'
    elif prog_diff < 315:
        phase = 'Last Quarter — crisis in consciousness, letting go'
    else:
        phase = 'Balsamic — release, surrender, prepare for rebirth'
    
    return {'phase': phase, 'angle': round(prog_diff, 1), 'age': age,
            'next_new_moon_age': round(age + (360 - prog_diff) / 11, 1)}

# ═══════════════════════════════════════════════════════════════
# ELECTIONAL ASTROLOGY (Western)
# ═══════════════════════════════════════════════════════════════
def evaluate_electional_moment(birth_dt: datetime, lat: float, lon: float,
                                event_type: str = "general") -> Dict:
    """Evaluate current moment for starting a new venture (Western rules)."""
    from .chart import WesternChart
    from .extras import check_void_of_course
    now = datetime.now()
    chart = WesternChart(now, lat, lon)
    chart._ensure_calculated()
    
    score = 50
    factors = []
    
    moon = chart.planets.get('Moon', {})
    vom = check_void_of_course(moon.get('longitude', 0), chart.planets)
    if vom.get('is_void'):
        score -= 20; factors.append('Moon void of course — avoid starting')
    
    # Benefics in angular houses
    for p in ['Jupiter', 'Venus']:
        if chart.planets.get(p, {}).get('house', 0) in [1, 4, 7, 10]:
            score += 10; factors.append(f'{p} angular — favorable')
    
    # Malefics in angular houses
    for p in ['Mars', 'Saturn']:
        if chart.planets.get(p, {}).get('house', 0) in [1, 4, 7, 10]:
            score -= 10; factors.append(f'{p} angular — challenging')
    
    # Mercury retrograde
    if chart.planets.get('Mercury', {}).get('retrograde'):
        score -= 15; factors.append('Mercury retrograde — communications disrupted')
    
    moon_sign = moon.get('sign', '')
    if moon_sign in ['Taurus', 'Cancer', 'Leo', 'Libra', 'Sagittarius', 'Aquarius']:
        score += 5; factors.append(f'Moon in {moon_sign} — favorable sign')
    
    score = max(10, min(95, score))
    rating = 'Excellent' if score >= 75 else 'Good' if score >= 60 else 'Fair' if score >= 45 else 'Poor'
    
    return {'score': score, 'rating': rating, 'factors': factors, 'moon_sign': moon_sign,
            'void_of_course': vom.get('is_void', False)}
