"""
BPHS CH.45-50 — DASHA EFFECTS

What does each planet's dasha mean based on what it rules?
This is NOT timing (we have that). This is INTERPRETATION.
"Sun dasha for Libra ascendant = 11th lord running = gains period"

The dasha lord's house ownership + placement + strength determines effects.
"""

from typing import Dict, List
from ..core.constants import RASHI_LORDS, PLANETS


def get_dasha_effect(engine, dasha_lord: str) -> Dict:
    """
    What does this dasha lord's period mean for this chart?
    Based on BPHS principles of house lordship and placement.
    """
    asc = engine.ascendant_rashi
    planet_data = engine.planets.get(dasha_lord, {})
    house = planet_data.get('house', 1)
    rashi = planet_data.get('rashi', 0)
    
    # What houses does this planet rule?
    owned_houses = []
    for h in range(1, 13):
        sign = (asc + h - 1) % 12
        if RASHI_LORDS[sign] == dasha_lord:
            owned_houses.append(h)
    
    # For Rahu/Ketu — they don't own houses, give results of dispositor + house
    if dasha_lord in ('Rahu', 'Ketu'):
        dispositor = RASHI_LORDS[rashi]
        disp_houses = []
        for h in range(1, 13):
            sign = (asc + h - 1) % 12
            if RASHI_LORDS[sign] == dispositor:
                disp_houses.append(h)
        
        return {
            'dasha_lord': dasha_lord,
            'houses_ruled': [],
            'placed_in_house': house,
            'dispositor': dispositor,
            'dispositor_houses': disp_houses,
            'themes': _get_house_themes(disp_houses + [house]),
            'text': f'{dasha_lord} dasha activates H{house} themes + {dispositor} results (houses {disp_houses})',
            'source': 'BPHS 30.16 (Rahu/Ketu give dispositor results)',
        }
    
    # Dignity
    pd = PLANETS.get(dasha_lord, {})
    is_exalted = rashi == pd.get('exalted')
    is_own = rashi in pd.get('owns', [])
    is_debilitated = rashi == pd.get('debilitated')
    
    # BPHS principle: Strong dasha lord in good houses = excellent results
    # Weak dasha lord in bad houses = suffering in those areas
    strength = 'strong' if (is_exalted or is_own) else 'weak' if is_debilitated else 'moderate'
    
    good_houses = [1, 2, 4, 5, 7, 9, 10, 11]
    bad_houses = [6, 8, 12]
    
    placement_quality = 'good' if house in good_houses else 'challenging'
    
    # Functional nature for this ascendant
    kendra_lords = []
    trikona_lords = []
    dusthana_lords = []
    for h in owned_houses:
        if h in [1, 4, 7, 10]:
            kendra_lords.append(h)
        if h in [1, 5, 9]:
            trikona_lords.append(h)
        if h in [6, 8, 12]:
            dusthana_lords.append(h)
    
    # Determine overall dasha quality
    if kendra_lords and trikona_lords:
        nature = 'yogakaraka'
        quality_text = f'YOGAKARAKA dasha — rules both kendra ({kendra_lords}) and trikona ({trikona_lords}). Excellent period for authority and fortune.'
    elif trikona_lords and not dusthana_lords:
        nature = 'very_beneficial'
        quality_text = f'Trikona lord dasha — rules fortune houses ({owned_houses}). Blessed period.'
    elif kendra_lords and not dusthana_lords:
        nature = 'beneficial'
        quality_text = f'Kendra lord dasha — rules action houses ({owned_houses}). Period of achievement.'
    elif dusthana_lords and not (kendra_lords or trikona_lords):
        nature = 'difficult'
        quality_text = f'Dusthana lord dasha — rules challenging houses ({owned_houses}). Period of obstacles, health issues, or losses.'
    elif dusthana_lords and kendra_lords:
        nature = 'mixed_challenging'
        quality_text = f'Mixed dasha — rules both kendra ({kendra_lords}) and dusthana ({dusthana_lords}). Results depend on strength.'
    else:
        nature = 'mixed'
        quality_text = f'Dasha lord rules houses {owned_houses}. Mixed results.'
    
    # Strength modifier
    if strength == 'strong':
        quality_text += f' {dasha_lord} is {("exalted" if is_exalted else "in own sign")} — amplifies all results.'
    elif strength == 'weak':
        quality_text += f' {dasha_lord} is debilitated — diminishes positive and intensifies negative results.'
    
    themes = _get_house_themes(owned_houses + [house])
    
    return {
        'dasha_lord': dasha_lord,
        'houses_ruled': owned_houses,
        'placed_in_house': house,
        'strength': strength,
        'nature': nature,
        'themes': themes,
        'text': quality_text,
        'source': 'BPHS Ch.45-50 (Dasha effects)',
    }


def get_current_dasha_interpretation(engine) -> Dict:
    """Full interpretation of current running dasha."""
    try:
        dasha = engine.get_vimshottari_dasha()
    except Exception:
        return {'error': 'Could not calculate dasha'}
    
    maha_lord = dasha.get('mahadasha', {}).get('lord', '')
    antar_lord = dasha.get('antardasha', {}).get('lord', '')
    prat_lord = dasha.get('pratyantardasha', {}).get('lord', '')
    
    maha_effect = get_dasha_effect(engine, maha_lord) if maha_lord else {}
    antar_effect = get_dasha_effect(engine, antar_lord) if antar_lord else {}
    prat_effect = get_dasha_effect(engine, prat_lord) if prat_lord else {}
    
    return {
        'dasha_string': dasha.get('dasha_string', ''),
        'mahadasha': maha_effect,
        'antardasha': antar_effect,
        'pratyantardasha': prat_effect,
        'combined_themes': list(set(
            maha_effect.get('themes', []) + 
            antar_effect.get('themes', []) + 
            prat_effect.get('themes', [])
        )),
    }


def _get_house_themes(houses: List[int]) -> List[str]:
    """Map house numbers to life themes."""
    THEMES = {
        1: 'self, body, personality',
        2: 'wealth, family, speech',
        3: 'courage, siblings, communication',
        4: 'mother, home, property, education',
        5: 'children, intelligence, romance',
        6: 'enemies, disease, service',
        7: 'marriage, partnerships, business',
        8: 'transformation, occult, longevity',
        9: 'fortune, father, dharma, travel',
        10: 'career, authority, fame',
        11: 'gains, income, desires',
        12: 'losses, foreign, spirituality, moksha',
    }
    themes = []
    for h in set(houses):
        if h in THEMES:
            themes.append(THEMES[h])
    return themes
