"""
KP EXTENDED — Sensitive Points, Progression, Marriage Matching, Profession,
Cuspal Interlinks, Lost Object Direction, Ruling Planet Timing, Rectification
"""
from datetime import datetime, timedelta
from typing import Dict, List

# ═══════════════════════════════════════════════════════════════
# SENSITIVE POINT CALENDAR
# ═══════════════════════════════════════════════════════════════
def calculate_sensitive_points(engine, months: int = 12) -> Dict:
    """Pre-compute dates when transit planets cross cuspal sub-lord degrees."""
    from .kp_complete import KPComplete
    kpc = KPComplete(engine)
    cusps = kpc.get_placidus_cusps()
    
    sensitive_degrees = {}
    for h in range(1, 13):
        c = cusps.get(h, {})
        sensitive_degrees[h] = c.get('longitude', 0)
    
    triggers = []
    # The nearest each slow planet comes to any cusp in the window. When nothing
    # crosses within the orb the answer is "none", and saying how near the nearest
    # came is the useful part of it — an empty list read as missing data.
    closest = {}
    try:
        from ..core.ephemeris import get_ephemeris
        eph = get_ephemeris('LAHIRI')
        now = datetime.now()
        
        for planet in ['Jupiter', 'Saturn', 'Rahu']:
            for day_offset in range(0, months * 30, 7):
                check_date = now + timedelta(days=day_offset)
                jd = eph.get_julian_day(check_date)
                pos = eph.get_planet_position(jd, planet)
                t_long = pos.get('longitude', 0)
                
                for h, deg in sensitive_degrees.items():
                    diff = abs(t_long - deg)
                    if diff > 180: diff = 360 - diff
                    best = closest.get(planet)
                    if best is None or diff < best['distance']:
                        closest[planet] = {'planet': planet, 'house': h, 'distance': round(diff, 2),
                                           'date': check_date.strftime('%Y-%m-%d')}
                    if diff <= 2.0:
                        triggers.append({
                            'date': check_date.strftime('%Y-%m-%d'),
                            'planet': planet, 'house': h,
                            'distance': round(diff, 2),
                            'event': f'{planet} crosses H{h} cusp — event trigger window',
                        })
    except Exception:
        pass
    
    triggers.sort(key=lambda t: t['date'])
    return {'triggers': triggers[:30], 'months_scanned': months, 'orb': 2.0,
            'closest': sorted(closest.values(), key=lambda c: c['distance'])}

# ═══════════════════════════════════════════════════════════════
# KP MARRIAGE MATCHING
# ═══════════════════════════════════════════════════════════════
def kp_marriage_match(engine1, engine2) -> Dict:
    """Compare 7th CSL of both charts for KP compatibility."""
    from .kp_complete import KPComplete
    kpc1 = KPComplete(engine1)
    kpc2 = KPComplete(engine2)
    
    cusps1 = kpc1.get_placidus_cusps()
    cusps2 = kpc2.get_placidus_cusps()
    
    csl7_1 = cusps1.get(7, {}).get('sub_lord', '')
    csl7_2 = cusps2.get(7, {}).get('sub_lord', '')
    
    # Check what houses each 7th CSL signifies
    sig1 = kpc1.get_planet_significators(csl7_1) if csl7_1 else {}
    sig2 = kpc2.get_planet_significators(csl7_2) if csl7_2 else {}
    
    h1 = set(sig1.get('all_signified_houses', []))
    h2 = set(sig2.get('all_signified_houses', []))
    
    marriage_houses = {2, 7, 11}
    denial_houses = {6, 12}
    
    p1_marriage = h1 & marriage_houses
    p1_denial = h1 & denial_houses
    p2_marriage = h2 & marriage_houses
    p2_denial = h2 & denial_houses
    
    if p1_marriage and p2_marriage and not p1_denial and not p2_denial:
        verdict = 'Highly Compatible — both 7th CSLs promise marriage'
        score = 90
    elif (p1_marriage or p2_marriage) and not (p1_denial and p2_denial):
        verdict = 'Compatible with effort — one chart strongly supports'
        score = 65
    elif p1_denial and p2_denial:
        verdict = 'Challenging — both charts show marital difficulty'
        score = 30
    else:
        verdict = 'Mixed — requires deeper analysis'
        score = 50
    
    return {
        'person1_7th_csl': csl7_1, 'person1_signifies': sorted(h1),
        'person2_7th_csl': csl7_2, 'person2_signifies': sorted(h2),
        'score': score, 'verdict': verdict,
    }

# ═══════════════════════════════════════════════════════════════
# KP PROFESSION DETERMINATION
# ═══════════════════════════════════════════════════════════════
PROFESSION_MAP = {
    'Sun': {'govt': True, 'fields': ['Government', 'Administration', 'Medicine', 'Politics']},
    'Moon': {'govt': False, 'fields': ['Nursing', 'Hospitality', 'Dairy', 'Travel', 'Public relations']},
    'Mars': {'govt': True, 'fields': ['Military', 'Police', 'Surgery', 'Engineering', 'Sports']},
    'Mercury': {'govt': False, 'fields': ['Commerce', 'Writing', 'Teaching', 'IT', 'Accounting']},
    'Jupiter': {'govt': True, 'fields': ['Education', 'Law', 'Banking', 'Religion', 'Consulting']},
    'Venus': {'govt': False, 'fields': ['Arts', 'Entertainment', 'Fashion', 'Luxury', 'Beauty']},
    'Saturn': {'govt': True, 'fields': ['Mining', 'Real estate', 'Agriculture', 'Labor', 'Iron/Steel']},
    'Rahu': {'govt': False, 'fields': ['Foreign companies', 'Technology', 'Research', 'Aviation', 'Unconventional']},
    'Ketu': {'govt': False, 'fields': ['Spirituality', 'Healing', 'Occult', 'Languages', 'Detective work']},
}

def kp_profession(engine) -> Dict:
    """Determine profession from 10th CSL and its significations."""
    from .kp_complete import KPComplete
    kpc = KPComplete(engine)
    cusps = kpc.get_placidus_cusps()
    
    csl10 = cusps.get(10, {}).get('sub_lord', '')
    csl6 = cusps.get(6, {}).get('sub_lord', '')
    
    prof10 = PROFESSION_MAP.get(csl10, {})
    prof6 = PROFESSION_MAP.get(csl6, {})
    
    fields = list(set(prof10.get('fields', []) + prof6.get('fields', [])))
    is_govt = prof10.get('govt', False)
    service_or_business = 'Service' if csl6 in ['Saturn', 'Sun', 'Jupiter'] else 'Business/Self-employed'
    
    return {
        '10th_csl': csl10, '6th_csl': csl6,
        'nature': service_or_business, 'government': is_govt,
        'fields': fields[:6],
        'primary': fields[0] if fields else 'General',
    }

# ═══════════════════════════════════════════════════════════════
# CUSPAL INTERLINKS
# ═══════════════════════════════════════════════════════════════
def find_cuspal_interlinks(engine) -> List[Dict]:
    """Find when two cusp sub-lords signify each other's houses."""
    from .kp_complete import KPComplete
    kpc = KPComplete(engine)
    cusps = kpc.get_placidus_cusps()
    
    interlinks = []
    for h1 in range(1, 13):
        csl1 = cusps.get(h1, {}).get('sub_lord', '')
        if not csl1: continue
        sig1 = set(kpc.get_planet_significators(csl1).get('all_signified_houses', []))
        
        for h2 in range(h1 + 1, 13):
            csl2 = cusps.get(h2, {}).get('sub_lord', '')
            if not csl2: continue
            sig2 = set(kpc.get_planet_significators(csl2).get('all_signified_houses', []))
            
            if h2 in sig1 and h1 in sig2:
                interlinks.append({
                    'house1': h1, 'csl1': csl1,
                    'house2': h2, 'csl2': csl2,
                    'meaning': f'H{h1} and H{h2} are interlinked — events in these areas are connected',
                })
    
    return interlinks

# ═══════════════════════════════════════════════════════════════
# LOST OBJECT DIRECTION
# ═══════════════════════════════════════════════════════════════
SIGN_DIRECTIONS = {
    0: 'East', 1: 'South', 2: 'West', 3: 'North',
    4: 'East', 5: 'South', 6: 'West', 7: 'North',
    8: 'East', 9: 'South', 10: 'West', 11: 'North',
}

def kp_lost_object(engine) -> Dict:
    """Determine direction and recovery of lost object."""
    from .kp_complete import KPComplete
    kpc = KPComplete(engine)
    cusps = kpc.get_placidus_cusps()
    
    csl2 = cusps.get(2, {}).get('sub_lord', '')
    csl4 = cusps.get(4, {}).get('sub_lord', '')
    csl11 = cusps.get(11, {}).get('sub_lord', '')
    
    csl2_rashi = engine.planets.get(csl2, {}).get('rashi', 0)
    direction = SIGN_DIRECTIONS.get(csl2_rashi, 'Unknown')
    
    sig11 = set(kpc.get_planet_significators(csl11).get('all_signified_houses', []))
    recovery = bool(sig11 & {2, 6, 11})
    
    return {
        'direction': direction,
        'will_be_found': recovery,
        '2nd_csl': csl2, '11th_csl': csl11,
        'advice': f'Look towards {direction}. {"Recovery is likely" if recovery else "Recovery is doubtful"}.',
    }

# ═══════════════════════════════════════════════════════════════
# RULING PLANET HOURLY TIMING
# ═══════════════════════════════════════════════════════════════
def get_rp_timing(engine) -> Dict:
    """When ruling planets align with significators in the current hour."""
    from .kp_complete import KPComplete
    kpc = KPComplete(engine)
    rp = kpc.get_ruling_planets()
    rp_set = set(rp.get('ruling_planets', []))
    
    now = datetime.now()
    day_lords = {0: 'Moon', 1: 'Mars', 2: 'Mercury', 3: 'Jupiter',
                 4: 'Venus', 5: 'Saturn', 6: 'Sun'}
    current_day = day_lords[now.weekday()]
    
    hora_sequence = ['Sun', 'Venus', 'Mercury', 'Moon', 'Saturn', 'Jupiter', 'Mars']
    hora_idx = (hora_sequence.index(current_day) + now.hour) % 7
    current_hora = hora_sequence[hora_idx]
    
    rp_active_now = current_hora in rp_set and current_day in rp_set
    
    return {
        'ruling_planets': sorted(rp_set),
        'current_day_lord': current_day,
        'current_hora_lord': current_hora,
        'rp_active': rp_active_now,
        'interpretation': 'Ruling planets active in this hour — events are triggered NOW' if rp_active_now
                         else 'Ruling planets not fully active this hour — wait for alignment',
    }

# ═══════════════════════════════════════════════════════════════
# KP RECTIFICATION (simplified)
# ═══════════════════════════════════════════════════════════════
def kp_rectify(birth_data: Dict, events: List[Dict]) -> Dict:
    """
    Given life events, test different ascendant sub-lords
    to find which birth time produces the correct significator pattern.
    """
    from ..jyotish_engine import JyotishEngine
    from .kp_complete import KPComplete
    
    results = []
    base_hour = birth_data.get('hour', 12)
    base_minute = birth_data.get('minute', 0)
    
    # Test ±30 minutes in 2-minute steps
    for offset in range(-30, 31, 2):
        test_minute = base_minute + offset
        test_hour = base_hour
        if test_minute >= 60:
            test_hour += 1
            test_minute -= 60
        elif test_minute < 0:
            test_hour -= 1
            test_minute += 60
        
        try:
            test_dt = datetime(birth_data['year'], birth_data['month'], birth_data['day'],
                              test_hour % 24, test_minute)
            test_engine = JyotishEngine(test_dt, birth_data['lat'], birth_data['lng'])
            kpc = KPComplete(test_engine)
            cusps = kpc.get_placidus_cusps()
            
            # Score: how many events match the significator pattern
            score = 0
            for event in events:
                event_type = event.get('type', 'marriage')
                event_houses = {
                    'marriage': [2, 7, 11], 'career': [2, 6, 10, 11],
                    'child': [2, 5, 11], 'education': [4, 9, 11],
                }.get(event_type, [1, 11])
                
                primary_house = event_houses[0]
                csl = cusps.get(primary_house, {}).get('sub_lord', '')
                if csl:
                    sig = set(kpc.get_planet_significators(csl).get('all_signified_houses', []))
                    if sig & set(event_houses):
                        score += 1
            
            results.append({
                'time': f'{test_hour:02d}:{test_minute:02d}',
                'offset': offset,
                'asc_sub_lord': cusps.get(1, {}).get('sub_lord', ''),
                'score': score,
            })
        except Exception:
            continue
    
    results.sort(key=lambda r: -r['score'])
    best = results[0] if results else {}
    
    return {
        'best_time': best.get('time', ''),
        'best_asc_sub': best.get('asc_sub_lord', ''),
        'score': best.get('score', 0),
        'top_3': results[:3],
        'events_tested': len(events),
    }
