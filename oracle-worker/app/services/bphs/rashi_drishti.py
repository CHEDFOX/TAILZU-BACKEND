"""
BPHS Chapter 28 — Rashi Drishti (Sign Aspects)
Different from Graha Drishti (planetary aspects).
Based on sign modality:
- Movable signs aspect Fixed signs (except adjacent)
- Fixed signs aspect Movable signs (except adjacent)
- Dual signs aspect each other
"""
from typing import Dict, List

# Sign categories
MOVABLE = [0, 3, 6, 9]      # Aries, Cancer, Libra, Capricorn
FIXED = [1, 4, 7, 10]        # Taurus, Leo, Scorpio, Aquarius
DUAL = [2, 5, 8, 11]         # Gemini, Virgo, Sagittarius, Pisces

SIGN_NAMES = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo',
              'Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces']


def _get_sign_type(sign: int) -> str:
    if sign in MOVABLE: return 'movable'
    if sign in FIXED: return 'fixed'
    return 'dual'


def _are_adjacent(s1: int, s2: int) -> bool:
    diff = abs(s1 - s2)
    return diff == 1 or diff == 11


def get_rashi_drishti_targets(sign: int) -> List[int]:
    """Get all signs aspected by the given sign via rashi drishti."""
    sign_type = _get_sign_type(sign)
    targets = []

    if sign_type == 'movable':
        # Movable aspects all fixed signs except adjacent
        for f in FIXED:
            if not _are_adjacent(sign, f):
                targets.append(f)
    elif sign_type == 'fixed':
        # Fixed aspects all movable signs except adjacent
        for m in MOVABLE:
            if not _are_adjacent(sign, m):
                targets.append(m)
    else:
        # Dual aspects other dual signs
        for d in DUAL:
            if d != sign:
                targets.append(d)

    return sorted(targets)


def calculate_rashi_drishti(planets: Dict) -> Dict:
    """Calculate all rashi drishtis for all planets."""
    results = {}

    # Build sign occupancy
    sign_occupants = {}
    for name, data in planets.items():
        if name in ('Ascendant', 'Asc'):
            continue
        rashi = data.get('rashi', 0)
        sign_occupants.setdefault(rashi, []).append(name)

    for name, data in planets.items():
        if name in ('Ascendant', 'Asc'):
            continue

        rashi = data.get('rashi', 0)
        sign_type = _get_sign_type(rashi)
        targets = get_rashi_drishti_targets(rashi)

        # Find which planets are aspected
        aspected_planets = []
        for target_sign in targets:
            for occ in sign_occupants.get(target_sign, []):
                aspected_planets.append({
                    'planet': occ,
                    'sign': SIGN_NAMES[target_sign],
                    'sign_index': target_sign,
                })

        # Find which planets aspect this planet
        aspecting_planets = []
        for other_name, other_data in planets.items():
            if other_name in ('Ascendant', 'Asc') or other_name == name:
                continue
            other_rashi = other_data.get('rashi', 0)
            other_targets = get_rashi_drishti_targets(other_rashi)
            if rashi in other_targets:
                aspecting_planets.append({
                    'planet': other_name,
                    'sign': SIGN_NAMES[other_rashi],
                    'sign_index': other_rashi,
                })

        results[name] = {
            'planet': name,
            'sign': SIGN_NAMES[rashi],
            'sign_type': sign_type,
            'aspects_signs': [SIGN_NAMES[t] for t in targets],
            'aspects_planets': aspected_planets,
            'aspected_by': aspecting_planets,
            'total_aspects_given': len(aspected_planets),
            'total_aspects_received': len(aspecting_planets),
        }

    return results

