"""
BPHS Chapter 36 — Sannyasa Yogas (Renunciation) & Pravrajya Yogas (Spiritual Seeker)
Combinations indicating detachment, renunciation, or spiritual path.
"""
from typing import Dict


def calculate_sannyasa_yogas(planets: Dict, ascendant_rashi: int = 0) -> Dict:
    yogas = []
    house_occ = {}
    for name, data in planets.items():
        if name in ('Ascendant', 'Asc'):
            continue
        h = data.get('house', 1)
        house_occ.setdefault(h, []).append(name)

    # ═══ SANNYASA YOGA ═══
    # 1. Four or more planets in one house
    for house, occupants in house_occ.items():
        if len(occupants) >= 4:
            yogas.append({
                'name': 'Sannyasa Yoga',
                'type': 'sannyasa',
                'description': f'{len(occupants)} planets in house {house} — strong renunciation tendency',
                'planets': occupants,
                'house': house,
                'strength': 'strong' if len(occupants) >= 5 else 'moderate',
            })

    # 2. Saturn aspects/conjuncts Moon lord (10th lord)
    moon_house = planets.get('Moon', {}).get('house', 1)
    saturn_house = planets.get('Saturn', {}).get('house', 1)
    saturn_aspects = [saturn_house]
    # Saturn's special aspects: 3rd, 7th, 10th from itself
    saturn_aspects.extend([(saturn_house + offset - 1) % 12 + 1 for offset in [3, 7, 10]])
    if moon_house in saturn_aspects:
        yogas.append({
            'name': 'Shani-Chandra Sannyasa',
            'type': 'sannyasa',
            'description': 'Saturn aspects Moon — detachment from material comforts',
            'planets': ['Saturn', 'Moon'],
            'strength': 'moderate',
        })

    # 3. Ketu in 12th house
    ketu_house = planets.get('Ketu', {}).get('house', 0)
    if ketu_house == 12:
        yogas.append({
            'name': 'Moksha Yoga',
            'type': 'sannyasa',
            'description': 'Ketu in 12th — natural spiritual liberation tendency',
            'planets': ['Ketu'],
            'house': 12,
            'strength': 'strong',
        })

    # 4. Jupiter and Ketu conjunction
    jup_house = planets.get('Jupiter', {}).get('house', 0)
    if jup_house == ketu_house and jup_house > 0:
        yogas.append({
            'name': 'Guru-Ketu Yoga',
            'type': 'pravrajya',
            'description': 'Jupiter conjunct Ketu — deep spiritual wisdom, renunciation of ego',
            'planets': ['Jupiter', 'Ketu'],
            'house': jup_house,
            'strength': 'strong',
        })

    # ═══ PRAVRAJYA YOGAS ═══
    # 1. Sun strong and alone in kendra/trikona with no aspects
    sun_house = planets.get('Sun', {}).get('house', 0)
    if sun_house in [1,4,5,7,9,10]:
        sun_alone = len(house_occ.get(sun_house, [])) == 1
        if sun_alone:
            yogas.append({
                'name': 'Surya Pravrajya',
                'type': 'pravrajya',
                'description': 'Solitary Sun in kendra/trikona — independent spiritual seeker',
                'planets': ['Sun'],
                'house': sun_house,
                'strength': 'moderate',
            })

    # 2. Moon in Ketu nakshatra (Ashwini, Magha, Moola) in 12th/4th/8th
    moon_nak = planets.get('Moon', {}).get('nakshatra', '')
    ketu_nakshatras = ['Ashwini', 'Magha', 'Moola']
    if moon_nak in ketu_nakshatras and moon_house in [4, 8, 12]:
        yogas.append({
            'name': 'Chandra Pravrajya',
            'type': 'pravrajya',
            'description': f'Moon in {moon_nak} in house {moon_house} — soul inclined toward liberation',
            'planets': ['Moon'],
            'house': moon_house,
            'strength': 'strong',
        })

    # 3. Multiple planets in 12th house
    twelfth_planets = house_occ.get(12, [])
    if len(twelfth_planets) >= 3:
        yogas.append({
            'name': 'Dwadasha Pravrajya',
            'type': 'pravrajya',
            'description': f'{len(twelfth_planets)} planets in 12th — strong pull toward transcendence',
            'planets': twelfth_planets,
            'house': 12,
            'strength': 'strong',
        })

    has_sannyasa = any(y['type'] == 'sannyasa' for y in yogas)
    has_pravrajya = any(y['type'] == 'pravrajya' for y in yogas)

    return {
        'yogas': yogas,
        'total': len(yogas),
        'has_sannyasa': has_sannyasa,
        'has_pravrajya': has_pravrajya,
        'overall': 'Strong spiritual/renunciation tendency' if (has_sannyasa or has_pravrajya) else 'No significant renunciation combinations',
    }

