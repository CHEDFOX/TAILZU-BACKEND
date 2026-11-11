"""
BPHS Chapter 45 — Planetary Avasthas (States)
1. Bala-Mrita (Age) — degree in sign
2. Deeptadi (Brightness) — dignity
3. Lajjitadi (Shame) — co-occupants
4. Shayan (Activity) — degree ranges
"""
from typing import Dict, List

BALA_MRITA_RESULTS = {
    'Bala': {'strength': 0.25, 'description': 'Infant state — minimal results'},
    'Kumara': {'strength': 0.50, 'description': 'Youth state — moderate results'},
    'Yuva': {'strength': 1.00, 'description': 'Adult state — full results'},
    'Vriddha': {'strength': 0.50, 'description': 'Old state — declining results'},
    'Mrita': {'strength': 0.10, 'description': 'Dead state — negligible results'},
}

ODD_SIGN_RANGES = [(0,6,'Bala'),(6,12,'Kumara'),(12,18,'Yuva'),(18,24,'Vriddha'),(24,30,'Mrita')]
EVEN_SIGN_RANGES = [(0,6,'Mrita'),(6,12,'Vriddha'),(12,18,'Yuva'),(18,24,'Kumara'),(24,30,'Bala')]

def get_bala_mrita_avastha(longitude: float, rashi: int) -> Dict:
    deg = longitude % 30
    is_odd = rashi % 2 == 0
    for s, e, name in (ODD_SIGN_RANGES if is_odd else EVEN_SIGN_RANGES):
        if s <= deg < e:
            info = BALA_MRITA_RESULTS[name]
            return {'avastha': name, 'strength_factor': info['strength'], 'description': info['description'], 'degree_in_sign': round(deg, 2), 'is_odd_sign': is_odd}
    return {'avastha': 'Yuva', 'strength_factor': 1.0, 'description': 'Default', 'degree_in_sign': round(deg, 2), 'is_odd_sign': is_odd}

DEEPTADI_STATES = {
    'Deepta': {'strength': 1.0, 'meaning': 'Shining — exalted, excellent results'},
    'Swastha': {'strength': 0.9, 'meaning': 'Content — own sign, very good results'},
    'Mudita': {'strength': 0.75, 'meaning': 'Happy — friend sign, good results'},
    'Shanta': {'strength': 0.6, 'meaning': 'Calm — benefic varga, decent results'},
    'Shakta': {'strength': 0.5, 'meaning': 'Capable — retrograde, delayed results'},
    'Deena': {'strength': 0.3, 'meaning': 'Sad — neutral sign, mixed results'},
    'Vikala': {'strength': 0.15, 'meaning': 'Disabled — combust, very weak results'},
    'Khala': {'strength': 0.1, 'meaning': 'Wicked — enemy sign, negative results'},
    'Kopa': {'strength': 0.05, 'meaning': 'Angry — debilitated, harmful results'},
}

def get_deeptadi_avastha(planet_data: Dict, dignity: Dict = None) -> Dict:
    if not dignity:
        dignity = {}
    if dignity.get('is_exalted'): state = 'Deepta'
    elif dignity.get('is_own_sign') or dignity.get('is_moolatrikona'): state = 'Swastha'
    elif dignity.get('is_friend_sign'): state = 'Mudita'
    elif dignity.get('combustion', {}).get('is_combust'): state = 'Vikala'
    elif planet_data.get('is_retrograde'): state = 'Shakta'
    elif dignity.get('is_enemy_sign'): state = 'Khala'
    elif dignity.get('is_debilitated'): state = 'Kopa'
    else: state = 'Deena'
    info = DEEPTADI_STATES[state]
    return {'avastha': state, 'strength_factor': info['strength'], 'meaning': info['meaning']}

def get_lajjitadi_avastha(planet: str, house: int, cooccupants: List[str]) -> Dict:
    malefics = ['Saturn', 'Mars', 'Rahu', 'Ketu']
    benefics = ['Jupiter', 'Venus', 'Mercury']
    states = []
    if house == 5:
        mal = [p for p in cooccupants if p in malefics]
        if mal:
            states.append({'avastha': 'Lajjita', 'meaning': 'Ashamed — in 5th with malefics', 'strength_factor': 0.3, 'trigger': f'In 5th with {", ".join(mal)}'})
    if 'Sun' in cooccupants and planet != 'Sun':
        states.append({'avastha': 'Kshobhita', 'meaning': 'Agitated — conjunct Sun', 'strength_factor': 0.25, 'trigger': 'Conjunct Sun'})
    ben = [p for p in cooccupants if p in benefics and p != planet]
    if ben:
        states.append({'avastha': 'Mudita', 'meaning': 'Happy — conjunct benefics', 'strength_factor': 0.85, 'trigger': f'Conjunct {", ".join(ben)}'})
    if not states:
        states.append({'avastha': 'Neutral', 'meaning': 'No special state', 'strength_factor': 1.0, 'trigger': 'None'})
    return {'states': states, 'primary': states[0]}

SHAYAN_STATES = [
    (0,3.33,'Shayana','Lying down — passive',0.3),(3.33,6.67,'Upavesha','Sitting — ready',0.5),
    (6.67,10,'Netrapani','Observing',0.6),(10,13.33,'Prakasha','Illuminating — active',0.9),
    (13.33,16.67,'Gamana','Walking — moving',0.8),(16.67,20,'Agamana','Returning',0.7),
    (20,23.33,'Sabha','In assembly — social',0.85),(23.33,26.67,'Agama','Arriving',0.75),
    (26.67,30,'Bhojana','Eating — absorbing',0.65),
]

def get_shayan_avastha(longitude: float) -> Dict:
    deg = longitude % 30
    for s, e, name, meaning, strength in SHAYAN_STATES:
        if s <= deg < e:
            return {'avastha': name, 'meaning': meaning, 'strength_factor': strength, 'degree': round(deg, 2)}
    return {'avastha': 'Shayana', 'meaning': 'Lying down', 'strength_factor': 0.3, 'degree': round(deg, 2)}

def calculate_all_avasthas(planets: Dict, dignity_data: Dict = None) -> Dict:
    results = {}
    house_occ = {}
    for name, data in planets.items():
        if name in ('Ascendant', 'Asc'): continue
        h = data.get('house', 1)
        house_occ.setdefault(h, []).append(name)
    for name, data in planets.items():
        if name in ('Ascendant', 'Asc'): continue
        lng = data.get('longitude', 0)
        rashi = data.get('rashi', 0)
        house = data.get('house', 1)
        p_dig = None
        if dignity_data:
            p_dig = dignity_data.get('planets', dignity_data).get(name, {})
        co = [p for p in house_occ.get(house, []) if p != name]
        bm = get_bala_mrita_avastha(lng, rashi)
        dp = get_deeptadi_avastha(data, p_dig)
        lj = get_lajjitadi_avastha(name, house, co)
        sh = get_shayan_avastha(lng)
        results[name] = {'planet': name, 'bala_mrita': bm, 'deeptadi': dp, 'lajjitadi': lj, 'shayan': sh}
    return results
