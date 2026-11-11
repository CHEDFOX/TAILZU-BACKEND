"""
BPHS Chapter 34 — Nabhasa Yogas
32 yogas based on planet distribution across houses.
Groups: Ashraya (3), Dala (2), Akriti (20), Sankhya (7)
"""
from typing import Dict, List


def _get_occupied_houses(planets: Dict) -> List[int]:
    houses = set()
    for name, data in planets.items():
        if name in ('Ascendant', 'Asc'):
            continue
        houses.add(data.get('house', 1))
    return sorted(houses)


def _get_house_occupants(planets: Dict) -> Dict[int, List[str]]:
    occ = {}
    for name, data in planets.items():
        if name in ('Ascendant', 'Asc'):
            continue
        h = data.get('house', 1)
        occ.setdefault(h, []).append(name)
    return occ


def _are_in_kendras(houses: List[int]) -> bool:
    kendras = {1, 4, 7, 10}
    return all(h in kendras for h in houses)


def _are_in_panapharas(houses: List[int]) -> bool:
    pan = {2, 5, 8, 11}
    return all(h in pan for h in houses)


def _are_in_apoklimas(houses: List[int]) -> bool:
    apo = {3, 6, 9, 12}
    return all(h in apo for h in houses)


def _count_consecutive(houses: List[int]) -> int:
    if not houses:
        return 0
    max_consec = 1
    current = 1
    extended = sorted(houses) + [h + 12 for h in sorted(houses)]
    for i in range(1, len(extended)):
        if extended[i] - extended[i-1] == 1:
            current += 1
            max_consec = max(max_consec, current)
        else:
            current = 1
    return max_consec


def calculate_nabhasa_yogas(planets: Dict) -> Dict:
    occupied = _get_occupied_houses(planets)
    house_occ = _get_house_occupants(planets)
    num_occupied = len(occupied)
    yogas = []

    # ═══ SANKHYA YOGAS (by count of occupied houses) ═══
    sankhya_map = {
        1: ('Gola', 'All planets in one house — extreme focus, narrow life'),
        2: ('Yuga', 'Planets in 2 houses — dual nature, polarized life'),
        3: ('Shoola', 'Planets in 3 houses — sharp focus, trident energy'),
        4: ('Kedara', 'Planets in 4 houses — farmer yoga, hard work brings results'),
        5: ('Pasha', 'Planets in 5 houses — bondage, attached to outcomes'),
        6: ('Dama', 'Planets in 6 houses — generous, charitable nature'),
        7: ('Veena', 'Planets in 7 houses — artistic, musical, balanced'),
    }
    if num_occupied in sankhya_map:
        name, desc = sankhya_map[num_occupied]
        yogas.append({'name': name, 'type': 'Sankhya', 'description': desc, 'houses': occupied})

    # ═══ ASHRAYA YOGAS (angular distribution) ═══
    if _are_in_kendras(occupied):
        yogas.append({'name': 'Rajju', 'type': 'Ashraya', 'description': 'All planets in kendras — strong, active, leadership', 'houses': occupied})
    if _are_in_panapharas(occupied):
        yogas.append({'name': 'Musala', 'type': 'Ashraya', 'description': 'All planets in panapharas — steady, accumulative, persistent', 'houses': occupied})
    if _are_in_apoklimas(occupied):
        yogas.append({'name': 'Nala', 'type': 'Ashraya', 'description': 'All planets in apoklimas — spiritual, detached, wandering', 'houses': occupied})

    # ═══ DALA YOGAS (half-chart) ═══
    upper = [h for h in occupied if h in [1,2,3,4,5,6,7]]
    lower = [h for h in occupied if h in [7,8,9,10,11,12]]
    if len(upper) == len(occupied) and len(occupied) >= 5:
        yogas.append({'name': 'Mala', 'type': 'Dala', 'description': 'Planets in upper half — visible, public life, recognition', 'houses': occupied})
    if len(lower) == len(occupied) and len(occupied) >= 5:
        yogas.append({'name': 'Sarpa', 'type': 'Dala', 'description': 'Planets in lower half — private, hidden, inner life', 'houses': occupied})

    # ═══ AKRITI YOGAS (shape patterns) ═══
    # Yupa — all in 1,2,3,4 (first quadrant)
    q1 = [h for h in occupied if h in [1,2,3]]
    q2 = [h for h in occupied if h in [4,5,6]]
    q3 = [h for h in occupied if h in [7,8,9]]
    q4 = [h for h in occupied if h in [10,11,12]]

    if len(q1) >= 5:
        yogas.append({'name': 'Yupa', 'type': 'Akriti', 'description': 'Sacrificial post — devoted, ritualistic, selfless', 'houses': occupied})
    if len(q2) >= 5:
        yogas.append({'name': 'Ishu', 'type': 'Akriti', 'description': 'Arrow — focused, goal-oriented, sharp', 'houses': occupied})
    if len(q3) >= 5:
        yogas.append({'name': 'Shakti', 'type': 'Akriti', 'description': 'Spear — powerful, penetrating, warrior energy', 'houses': occupied})
    if len(q4) >= 5:
        yogas.append({'name': 'Danda', 'type': 'Akriti', 'description': 'Staff — authoritative, disciplined, commanding', 'houses': occupied})

    # Gada — planets in 2 adjacent kendras
    kendra_pairs = [(1,4), (4,7), (7,10), (10,1)]
    for k1, k2 in kendra_pairs:
        if k1 in occupied and k2 in occupied:
            adj_planets = len(house_occ.get(k1, [])) + len(house_occ.get(k2, []))
            if adj_planets >= 5:
                yogas.append({'name': 'Gada', 'type': 'Akriti', 'description': 'Mace — strong, martial, decisive', 'houses': [k1, k2]})
                break

    # Shakata — planets only in 1 and 7 (opposition)
    if set(occupied).issubset({1, 7}):
        yogas.append({'name': 'Shakata', 'type': 'Akriti', 'description': 'Cart — ups and downs in fortune, fluctuating life', 'houses': occupied})

    # Chakra — all planets in alternate houses
    if all(h % 2 == 1 for h in occupied) or all(h % 2 == 0 for h in occupied):
        if num_occupied >= 4:
            yogas.append({'name': 'Chakra', 'type': 'Akriti', 'description': 'Wheel — powerful ruler, commanding authority', 'houses': occupied})

    # Consecutive house patterns
    consec = _count_consecutive(occupied)
    if consec >= 7:
        yogas.append({'name': 'Ardha Chandra', 'type': 'Akriti', 'description': 'Half moon — famous, prosperous, commanding', 'houses': occupied})
    elif consec >= 5:
        yogas.append({'name': 'Chapa', 'type': 'Akriti', 'description': 'Bow — brave, wealthy in middle age', 'houses': occupied})

    if not yogas:
        yogas.append({'name': 'Samanya', 'type': 'None', 'description': 'No special Nabhasa yoga — ordinary distribution', 'houses': occupied})

    return {
        'yogas': yogas,
        'total': len(yogas),
        'occupied_houses': occupied,
        'num_occupied': num_occupied,
    }
