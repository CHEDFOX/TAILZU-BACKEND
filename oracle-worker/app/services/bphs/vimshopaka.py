"""
BPHS Chapter 16 — Vimshopaka Bala
20-point strength from planet's dignity across 16 divisional charts.
The definitive classical measure of planetary strength.
"""
from typing import Dict

# BPHS specifies 4 Varga groups with different weights
# Shadvarga (6 charts), Saptavarga (7), Dashavarga (10), Shodashavarga (16)

SHODASHAVARGA_WEIGHTS = {
    'D1': 3.5, 'D2': 1.0, 'D3': 1.0, 'D4': 0.5, 'D7': 0.5,
    'D9': 3.0, 'D10': 0.5, 'D12': 0.5, 'D16': 0.5, 'D20': 0.5,
    'D24': 0.5, 'D27': 0.5, 'D30': 1.0, 'D40': 0.5, 'D45': 0.5,
    'D60': 5.0,
}

DASHAVARGA_WEIGHTS = {
    'D1': 3.0, 'D2': 1.5, 'D3': 1.5, 'D7': 1.5, 'D9': 3.0,
    'D10': 1.5, 'D12': 1.5, 'D16': 1.5, 'D30': 1.5, 'D60': 3.0,
}

SAPTAVARGA_WEIGHTS = {
    'D1': 5.0, 'D2': 2.0, 'D3': 3.0, 'D7': 2.5, 'D9': 4.5,
    'D12': 2.0, 'D30': 1.0,
}

SHADVARGA_WEIGHTS = {
    'D1': 6.0, 'D2': 2.0, 'D3': 4.0, 'D9': 5.0, 'D12': 2.0, 'D30': 1.0,
}

# Dignity scores for vimshopaka
DIGNITY_SCORES = {
    'exalted': 20,
    'moolatrikona': 18,
    'own_sign': 15,
    'great_friend': 12,
    'friend_sign': 10,
    'neutral_sign': 8,
    'enemy_sign': 5,
    'great_enemy': 3,
    'debilitated': 2,
}

SIGN_LORDS = {
    0: 'Mars', 1: 'Venus', 2: 'Mercury', 3: 'Moon', 4: 'Sun', 5: 'Mercury',
    6: 'Venus', 7: 'Mars', 8: 'Jupiter', 9: 'Saturn', 10: 'Saturn', 11: 'Jupiter',
}

EXALTATION = {'Sun': 0, 'Moon': 1, 'Mars': 9, 'Mercury': 5, 'Jupiter': 3, 'Venus': 11, 'Saturn': 6}
DEBILITATION = {'Sun': 6, 'Moon': 7, 'Mars': 3, 'Mercury': 11, 'Jupiter': 9, 'Venus': 5, 'Saturn': 0}
OWN_SIGNS = {
    'Sun': [4], 'Moon': [3], 'Mars': [0, 7], 'Mercury': [2, 5],
    'Jupiter': [8, 11], 'Venus': [1, 6], 'Saturn': [9, 10],
}
MOOLATRIKONA = {'Sun': 4, 'Moon': 1, 'Mars': 0, 'Mercury': 5, 'Jupiter': 8, 'Venus': 6, 'Saturn': 10}

FRIENDS = {
    'Sun': ['Moon', 'Mars', 'Jupiter'],
    'Moon': ['Sun', 'Mercury'],
    'Mars': ['Sun', 'Moon', 'Jupiter'],
    'Mercury': ['Sun', 'Venus'],
    'Jupiter': ['Sun', 'Moon', 'Mars'],
    'Venus': ['Mercury', 'Saturn'],
    'Saturn': ['Mercury', 'Venus'],
}

ENEMIES = {
    'Sun': ['Venus', 'Saturn'],
    'Moon': [],
    'Mars': ['Mercury'],
    'Mercury': ['Moon'],
    'Jupiter': ['Mercury', 'Venus'],
    'Venus': ['Sun', 'Moon'],
    'Saturn': ['Sun', 'Moon', 'Mars'],
}


def _get_dignity_in_sign(planet: str, sign_index: int) -> str:
    if planet in ('Rahu', 'Ketu'):
        return 'neutral_sign'
    if EXALTATION.get(planet) == sign_index:
        return 'exalted'
    if DEBILITATION.get(planet) == sign_index:
        return 'debilitated'
    if MOOLATRIKONA.get(planet) == sign_index:
        return 'moolatrikona'
    if sign_index in OWN_SIGNS.get(planet, []):
        return 'own_sign'
    lord = SIGN_LORDS.get(sign_index, '')
    if lord in FRIENDS.get(planet, []):
        return 'friend_sign'
    if lord in ENEMIES.get(planet, []):
        return 'enemy_sign'
    return 'neutral_sign'


def _get_varga_sign(planet_longitude: float, varga_num: int) -> int:
    sign = int(planet_longitude / 30)
    degree = planet_longitude % 30

    if varga_num == 1:
        return sign
    elif varga_num == 2:  # Hora
        return 3 if degree < 15 else 4  # Moon or Sun
    elif varga_num == 3:  # Drekkana
        third = int(degree / 10)
        offsets = [0, 4, 8]
        return (sign + offsets[third]) % 12
    elif varga_num == 4:  # Chaturthamsa
        q = int(degree / 7.5)
        return (sign + q * 3) % 12
    elif varga_num == 7:  # Saptamsa
        part = int(degree / (30 / 7))
        if part >= 7:
            part = 6
        if sign % 2 == 0:  # odd sign
            return (sign + part) % 12
        else:
            return (sign + 6 + part) % 12
    elif varga_num == 9:  # Navamsa
        part = int(degree / (30 / 9))
        if part >= 9:
            part = 8
        fire_start = {0: 0, 1: 9, 2: 6, 3: 3}
        element = sign % 4
        start = fire_start.get(element, 0)
        return (start + part) % 12
    elif varga_num == 10:  # Dasamsa
        part = int(degree / 3)
        if part >= 10:
            part = 9
        if sign % 2 == 0:
            return (sign + part) % 12
        else:
            return (sign + 9 + part) % 12
    elif varga_num == 12:  # Dwadasamsa
        part = int(degree / 2.5)
        if part >= 12:
            part = 11
        return (sign + part) % 12
    elif varga_num == 16:  # Shodasamsa
        part = int(degree / (30 / 16))
        if part >= 16:
            part = 15
        return (sign + part) % 12
    elif varga_num == 20:  # Vimsamsa
        part = int(degree / 1.5)
        if part >= 20:
            part = 19
        return (sign + part) % 12
    elif varga_num == 24:  # Chaturvimsamsa
        part = int(degree / 1.25)
        if part >= 24:
            part = 23
        return (sign + part) % 12
    elif varga_num == 27:  # Saptavimsamsa
        part = int(degree / (30 / 27))
        if part >= 27:
            part = 26
        return (sign + part) % 12
    elif varga_num == 30:  # Trimsamsa
        if sign % 2 == 0:  # odd
            if degree < 5: return 0  # Aries
            elif degree < 10: return 10  # Aquarius
            elif degree < 18: return 8  # Sagittarius
            elif degree < 25: return 2  # Gemini
            else: return 6  # Libra
        else:  # even
            if degree < 5: return 1  # Taurus
            elif degree < 12: return 5  # Virgo
            elif degree < 20: return 11  # Pisces
            elif degree < 25: return 9  # Capricorn
            else: return 7  # Scorpio
    elif varga_num == 40:  # Khavedamsa
        part = int(degree / 0.75)
        if part >= 40:
            part = 39
        return (sign + part) % 12
    elif varga_num == 45:  # Akshavedamsa
        part = int(degree / (30 / 45))
        if part >= 45:
            part = 44
        return (sign + part) % 12
    elif varga_num == 60:  # Shashtiamsa
        part = int(degree / 0.5)
        if part >= 60:
            part = 59
        return (sign + part) % 12
    return sign


def calculate_vimshopaka(planets: Dict, scheme: str = 'shodashavarga') -> Dict:
    weights = {
        'shodashavarga': SHODASHAVARGA_WEIGHTS,
        'dashavarga': DASHAVARGA_WEIGHTS,
        'saptavarga': SAPTAVARGA_WEIGHTS,
        'shadvarga': SHADVARGA_WEIGHTS,
    }.get(scheme, SHODASHAVARGA_WEIGHTS)

    total_weight = sum(weights.values())
    results = {}

    for name, data in planets.items():
        if name in ('Ascendant', 'Asc', 'Rahu', 'Ketu'):
            continue

        longitude = data.get('longitude', 0)
        weighted_sum = 0
        varga_details = {}

        for varga_key, weight in weights.items():
            varga_num = int(varga_key[1:])
            varga_sign = _get_varga_sign(longitude, varga_num)
            dignity = _get_dignity_in_sign(name, varga_sign)
            score = DIGNITY_SCORES.get(dignity, 8)
            weighted_score = (score / 20) * weight
            weighted_sum += weighted_score
            varga_details[varga_key] = {
                'sign': varga_sign,
                'dignity': dignity,
                'raw_score': score,
                'weighted': round(weighted_score, 3),
            }

        vimshopaka = round((weighted_sum / total_weight) * 20, 2)

        results[name] = {
            'planet': name,
            'vimshopaka': vimshopaka,
            'max': 20,
            'percentage': round(vimshopaka / 20 * 100, 1),
            'classification': _classify(vimshopaka),
            'scheme': scheme,
            'varga_details': varga_details,
        }

    return results


def _classify(score: float) -> str:
    if score >= 18: return 'Excellent'
    if score >= 15: return 'Very Good'
    if score >= 12: return 'Good'
    if score >= 10: return 'Average'
    if score >= 5: return 'Weak'
    return 'Very Weak'
