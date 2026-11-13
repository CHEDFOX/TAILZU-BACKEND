"""
BPHS Chapter 44 — Maraka (Death-inflicting) Analysis
2nd and 7th houses/lords are maraka sthanas.
Their dashas can indicate health crises or end of life.
"""
from typing import Dict

SIGN_LORDS = {
    0: 'Mars', 1: 'Venus', 2: 'Mercury', 3: 'Moon', 4: 'Sun', 5: 'Mercury',
    6: 'Venus', 7: 'Mars', 8: 'Jupiter', 9: 'Saturn', 10: 'Saturn', 11: 'Jupiter',
}


def calculate_maraka(planets: Dict, ascendant_rashi: int) -> Dict:
    # 2nd house sign and lord
    second_sign = (ascendant_rashi + 1) % 12
    second_lord = SIGN_LORDS[second_sign]

    # 7th house sign and lord
    seventh_sign = (ascendant_rashi + 6) % 12
    seventh_lord = SIGN_LORDS[seventh_sign]

    maraka_planets = set()
    maraka_details = []

    # Primary marakas — 2nd and 7th lords
    maraka_planets.add(second_lord)
    maraka_details.append({
        'planet': second_lord,
        'type': 'primary',
        'reason': f'Lord of 2nd house ({_sign_name(second_sign)})',
        'severity': 'high',
    })

    maraka_planets.add(seventh_lord)
    maraka_details.append({
        'planet': seventh_lord,
        'type': 'primary',
        'reason': f'Lord of 7th house ({_sign_name(seventh_sign)})',
        'severity': 'high',
    })

    # Planets occupying 2nd house
    for name, data in planets.items():
        if name in ('Ascendant', 'Asc'):
            continue
        house = data.get('house', 1)
        if house == 2 and name not in maraka_planets:
            maraka_planets.add(name)
            maraka_details.append({
                'planet': name,
                'type': 'occupant',
                'reason': 'Occupies 2nd house (maraka sthana)',
                'severity': 'medium',
            })
        if house == 7 and name not in maraka_planets:
            maraka_planets.add(name)
            maraka_details.append({
                'planet': name,
                'type': 'occupant',
                'reason': 'Occupies 7th house (maraka sthana)',
                'severity': 'medium',
            })

    # Secondary marakas — planets associated with 2nd/7th lords
    # 8th lord is also considered dangerous
    eighth_sign = (ascendant_rashi + 7) % 12
    eighth_lord = SIGN_LORDS[eighth_sign]
    if eighth_lord not in maraka_planets:
        maraka_details.append({
            'planet': eighth_lord,
            'type': 'secondary',
            'reason': f'Lord of 8th house ({_sign_name(eighth_sign)}) — longevity significator',
            'severity': 'medium',
        })

    # Badhaka (obstruction) lords
    # Movable ascendant: 11th lord is badhaka
    # Fixed ascendant: 9th lord is badhaka
    # Dual ascendant: 7th lord is badhaka
    asc_type = _sign_type(ascendant_rashi)
    if asc_type == 'movable':
        badhaka_house = 11
    elif asc_type == 'fixed':
        badhaka_house = 9
    else:
        badhaka_house = 7

    badhaka_sign = (ascendant_rashi + badhaka_house - 1) % 12
    badhaka_lord = SIGN_LORDS[badhaka_sign]
    maraka_details.append({
        'planet': badhaka_lord,
        'type': 'badhaka',
        'reason': f'Badhaka lord ({badhaka_house}th house) for {asc_type} ascendant',
        'severity': 'medium',
    })

    # Determine most dangerous dasha periods
    dangerous_periods = []
    for md in maraka_details:
        if md['severity'] == 'high':
            dangerous_periods.append({
                'planet': md['planet'],
                'danger_level': 'high',
                'note': f"Dasha of {md['planet']} — primary maraka period. Health vigilance needed.",
            })

    return {
        'second_lord': second_lord,
        'seventh_lord': seventh_lord,
        'eighth_lord': eighth_lord,
        'badhaka_lord': badhaka_lord,
        'maraka_planets': list(maraka_planets),
        'details': maraka_details,
        'dangerous_periods': dangerous_periods,
        'total_marakas': len(maraka_details),
    }


def _sign_name(index: int) -> str:
    names = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces']
    return names[index % 12]


def _sign_type(index: int) -> str:
    movable = [0, 3, 6, 9]  # Aries, Cancer, Libra, Capricorn
    fixed = [1, 4, 7, 10]   # Taurus, Leo, Scorpio, Aquarius
    if index in movable: return 'movable'
    if index in fixed: return 'fixed'
    return 'dual'

