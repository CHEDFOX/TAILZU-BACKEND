"""
BPHS CHAPTER 30 — UPAPADA LAGNA

Upapada = Arudha of 12th house.
BPHS says marriage should be judged from Upapada.
The 2nd from Upapada determines the nature and longevity of marriage.

Calculation: Count from 12th lord to 12th house. Same distance from 
12th house = Upapada sign. Exception: if result is 1st or 7th from 
12th house, take the 10th from it instead.
"""

from typing import Dict, List
from ..core.constants import RASHI_LORDS, RASHI_NAMES, PLANETS


def calculate_upapada(engine) -> Dict:
    """
    Calculate Upapada Lagna per BPHS Ch.30.
    
    Method: 
    1. Find 12th house sign
    2. Find 12th lord's sign
    3. Count from 12th house sign to 12th lord's sign = X signs
    4. Count X signs from 12th lord's sign = Upapada sign
    5. Exception: If Upapada = 12th house sign or 7th from it, take 10th from result
    """
    asc = engine.ascendant_rashi
    
    # 12th house sign
    sign_12 = (asc + 11) % 12
    
    # 12th lord
    lord_12 = RASHI_LORDS[sign_12]
    
    # 12th lord's sign (where it's placed)
    lord_12_sign = engine.planets.get(lord_12, {}).get('rashi', 0)
    
    # Count from 12th house sign to 12th lord's sign
    distance = (lord_12_sign - sign_12) % 12
    
    # Upapada = same distance from 12th lord's sign
    upapada_sign = (lord_12_sign + distance) % 12
    
    # Exception: if upapada = 12th house or 7th from 12th house
    seventh_from_12 = (sign_12 + 6) % 12
    if upapada_sign == sign_12 or upapada_sign == seventh_from_12:
        upapada_sign = (upapada_sign + 9) % 12  # Take 10th from result
    
    # 2nd from Upapada — determines marriage quality and longevity
    second_from_upa = (upapada_sign + 1) % 12
    second_lord = RASHI_LORDS[second_from_upa]
    
    # Planets in 2nd from Upapada
    upa_house = (upapada_sign - asc) % 12 + 1
    second_house = (second_from_upa - asc) % 12 + 1
    
    planets_in_upa = [p for p in engine.planets 
                      if engine.planets[p].get('rashi') == upapada_sign]
    planets_in_2nd = [p for p in engine.planets 
                      if engine.planets[p].get('rashi') == second_from_upa]
    
    return {
        'upapada_sign': upapada_sign,
        'upapada_sign_name': RASHI_NAMES[upapada_sign],
        'upapada_house': upa_house,
        'upapada_lord': RASHI_LORDS[upapada_sign],
        'second_from_upapada': second_from_upa,
        'second_sign_name': RASHI_NAMES[second_from_upa],
        'second_house': second_house,
        'second_lord': second_lord,
        'planets_in_upapada': planets_in_upa,
        'planets_in_2nd_from_upa': planets_in_2nd,
        'lord_12': lord_12,
        'lord_12_sign': lord_12_sign,
    }


def get_upapada_marriage_rules(engine) -> List[Dict]:
    """
    BPHS Ch.30 slokas 7-23: Marriage effects from Upapada.
    Returns list of fired rules with text and source.
    """
    upa = calculate_upapada(engine)
    rules = []
    
    planets_2nd = upa['planets_in_2nd_from_upa']
    second_lord = upa['second_lord']
    second_lord_data = engine.planets.get(second_lord, {})
    
    # Helper
    def is_benefic(p):
        return p in ('Jupiter', 'Venus', 'Mercury', 'Moon')
    
    def is_malefic(p):
        return p in ('Saturn', 'Mars', 'Rahu', 'Ketu', 'Sun')
    
    def is_strong(p):
        pd = PLANETS.get(p, {})
        r = engine.planets.get(p, {}).get('rashi', 0)
        return r == pd.get('exalted') or r in pd.get('owns', [])
    
    def is_weak(p):
        pd = PLANETS.get(p, {})
        r = engine.planets.get(p, {}).get('rashi', 0)
        return r == pd.get('debilitated')
    
    # BPHS 30.7-12: Benefic in 2nd from Upapada → good marriage
    benefics_2nd = [p for p in planets_2nd if is_benefic(p)]
    malefics_2nd = [p for p in planets_2nd if is_malefic(p)]
    
    if benefics_2nd:
        rules.append({
            'text': f'Benefics {benefics_2nd} in 2nd from Upapada → good results from marriage',
            'source': 'BPHS 30.7-12',
            'nature': 'positive',
        })
    
    # BPHS 30.7-12: Malefic in 2nd from Upapada + debilitated → destruction of marriage
    debilitated_2nd = [p for p in planets_2nd if is_weak(p)]
    if malefics_2nd and debilitated_2nd:
        rules.append({
            'text': f'Malefic {malefics_2nd} + debilitated planet in 2nd from Upapada → destruction of marriage',
            'source': 'BPHS 30.7-12',
            'nature': 'denial',
        })
    elif malefics_2nd:
        rules.append({
            'text': f'Malefics {malefics_2nd} in 2nd from Upapada → marriage troubled',
            'source': 'BPHS 30.7-12',
            'nature': 'negative',
        })
    
    # BPHS 30.7-12: Exalted planet in 2nd from Upapada → many marriages/relationships
    exalted_2nd = [p for p in planets_2nd if is_strong(p)]
    if exalted_2nd:
        rules.append({
            'text': f'Exalted {exalted_2nd} in 2nd from Upapada → multiple marriages or many relationships',
            'source': 'BPHS 30.7-12',
            'nature': 'positive',
        })
    
    # BPHS 30.13-15: If 7th lord or Venus in own house → wife lives long
    venus_data = engine.planets.get('Venus', {})
    venus_own = venus_data.get('rashi', -1) in PLANETS.get('Venus', {}).get('owns', [])
    if venus_own:
        rules.append({
            'text': 'Venus in own sign → wife/marriage endures long',
            'source': 'BPHS 30.13-15',
            'nature': 'positive',
        })
    
    # BPHS 30.16: Saturn + Rahu in 2nd from Upapada → loss of wife through death and slander
    if 'Saturn' in planets_2nd and 'Rahu' in planets_2nd:
        rules.append({
            'text': 'Saturn + Rahu in 2nd from Upapada → loss of wife through death or slander',
            'source': 'BPHS 30.16',
            'nature': 'denial',
        })
    
    # BPHS 30.19-22: Specific planet effects in 2nd from Upapada
    planet_effects = {
        'Sun': 'separation due to high fevers, bone disorders of spouse',
        'Mars': 'separation through accidents, blood disorders, fiery temperament',
        'Mercury': 'verbal warfare with spouse, excessive speech damages marriage',
        'Jupiter': 'break due to childlessness or excess weight',
        'Saturn': 'spouse sickly with chronic disease',
    }
    
    for p, effect in planet_effects.items():
        if p in planets_2nd:
            rules.append({
                'text': f'{p} in 2nd from Upapada → {effect}',
                'source': 'BPHS 30.19-22',
                'nature': 'negative',
            })
    
    # Upapada lord strong → marriage supported
    upa_lord = upa['upapada_lord']
    if is_strong(upa_lord):
        rules.append({
            'text': f'Upapada lord {upa_lord} strong → marriage foundation strong',
            'source': 'BPHS 30 (Upapada lord)',
            'nature': 'positive',
        })
    elif is_weak(upa_lord):
        rules.append({
            'text': f'Upapada lord {upa_lord} debilitated → marriage foundation weak',
            'source': 'BPHS 30 (Upapada lord)',
            'nature': 'negative',
        })
    
    # Second lord from Upapada in own house → wife lives to old age
    second_lord_own = second_lord_data.get('rashi', -1) in PLANETS.get(second_lord, {}).get('owns', [])
    if second_lord_own:
        rules.append({
            'text': f'2nd lord from Upapada ({second_lord}) in own sign → spouse lives long',
            'source': 'BPHS 30.7-12',
            'nature': 'positive',
        })
    
    # Planets in Upapada itself — describe spouse nature
    for p in upa['planets_in_upapada']:
        if p == 'Jupiter':
            rules.append({'text': 'Jupiter in Upapada → wise, virtuous spouse', 'source': 'BPHS 30', 'nature': 'positive'})
        elif p == 'Venus':
            rules.append({'text': 'Venus in Upapada → beautiful, loving spouse', 'source': 'BPHS 30', 'nature': 'positive'})
        elif p == 'Saturn':
            rules.append({'text': 'Saturn in Upapada → older or sickly spouse, delayed marriage', 'source': 'BPHS 30', 'nature': 'negative'})
        elif p == 'Rahu':
            rules.append({'text': 'Rahu in Upapada → foreign or unconventional spouse', 'source': 'BPHS 30', 'nature': 'mixed'})
        elif p == 'Ketu':
            rules.append({'text': 'Ketu in Upapada → spiritual or detached spouse', 'source': 'BPHS 30', 'nature': 'mixed'})
        elif p == 'Mars':
            rules.append({'text': 'Mars in Upapada → aggressive or passionate spouse', 'source': 'BPHS 30', 'nature': 'mixed'})
    
    return rules
