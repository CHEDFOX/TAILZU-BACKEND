"""
BPHS CH.40 — LONGEVITY DETERMINATION (3-Pair Method)

Three pairs determine longevity category:
Pair 1: Lagna Lord + 8th Lord
Pair 2: Lagna + Moon
Pair 3: Hora Lagna + Saturn

Each pair classified as: Short (Alpayu), Medium (Madhyayu), Long (Purnayu)
Based on their placement in Movable/Fixed/Dual signs.

Final: Majority of the 3 pairs determines longevity category.
Short: 0-32 years | Medium: 32-64 years | Long: 64-100+ years
"""

from typing import Dict
from ..core.constants import RASHI_LORDS, RASHI_NAMES


# Sign modality
def _sign_type(rashi_index):
    """Movable=0(Aries,Cancer,Libra,Cap), Fixed=1(Tau,Leo,Sco,Aqu), Dual=2(Gem,Vir,Sag,Pis)"""
    return rashi_index % 3  # 0=Movable, 1=Fixed, 2=Dual


def _pair_result(type1, type2):
    """
    BPHS Ch.40 — 3-pair longevity from sign modalities:
    Both Movable = Short
    Both Fixed = Medium  
    Both Dual = Long
    Movable + Fixed = Long
    Movable + Dual = Short
    Fixed + Dual = Medium
    """
    pair = tuple(sorted([type1, type2]))
    
    LONGEVITY_MAP = {
        (0, 0): 'short',      # Both Movable
        (1, 1): 'medium',     # Both Fixed
        (2, 2): 'long',       # Both Dual
        (0, 1): 'long',       # Movable + Fixed
        (0, 2): 'short',      # Movable + Dual
        (1, 2): 'medium',     # Fixed + Dual
    }
    
    return LONGEVITY_MAP.get(pair, 'medium')


def calculate_longevity(engine) -> Dict:
    """
    BPHS Ch.40: 3-pair longevity determination.
    """
    asc_rashi = engine.ascendant_rashi
    moon_rashi = engine.planets.get('Moon', {}).get('rashi', 0)
    saturn_rashi = engine.planets.get('Saturn', {}).get('rashi', 0)
    
    # Lords
    lord1 = RASHI_LORDS[asc_rashi]
    lord1_rashi = engine.planets.get(lord1, {}).get('rashi', 0)
    
    lord8_sign = (asc_rashi + 7) % 12
    lord8 = RASHI_LORDS[lord8_sign]
    lord8_rashi = engine.planets.get(lord8, {}).get('rashi', 0)
    
    # Pair 1: Lagna Lord sign type + 8th Lord sign type
    pair1 = _pair_result(_sign_type(lord1_rashi), _sign_type(lord8_rashi))
    
    # Pair 2: Lagna sign type + Moon sign type
    pair2 = _pair_result(_sign_type(asc_rashi), _sign_type(moon_rashi))
    
    # Pair 3: Saturn sign type + Hora Lagna sign type
    # Simplified Hora Lagna using Sun position
    sun_rashi = engine.planets.get('Sun', {}).get('rashi', 0)
    pair3 = _pair_result(_sign_type(saturn_rashi), _sign_type(sun_rashi))
    
    # Majority determines result
    counts = {'short': 0, 'medium': 0, 'long': 0}
    for p in [pair1, pair2, pair3]:
        counts[p] += 1
    
    # Find majority
    if counts['short'] >= 2:
        result = 'short'
        years = '0-32 years'
        description = 'Alpayu (short life) indicated. Remedial measures recommended.'
    elif counts['long'] >= 2:
        result = 'long'
        years = '64-100+ years'
        description = 'Purnayu (full life) indicated. Long and healthy life promised.'
    else:
        result = 'medium'
        years = '32-64 years'
        description = 'Madhyayu (medium life) indicated.'
    
    # BPHS correction factors that UPGRADE longevity category
    upgrades = []
    downgrades = []
    
    # Lagna lord in kendra/trikona → extends life
    lord1_h = engine.planets.get(lord1, {}).get('house', 1)
    if lord1_h in [1, 4, 7, 10, 5, 9, 11]:
        upgrades.append(f'Lagna lord {lord1} in H{lord1_h} (good house) → extends life')
    
    # Jupiter aspects Lagna → body protected
    from ..core.constants import PLANETS as PD
    jup_h = engine.planets.get('Jupiter', {}).get('house', 1)
    for asp in PD.get('Jupiter', {}).get('aspects', [7]):
        target = ((jup_h + asp - 1) % 12) + 1
        if target == 1:
            upgrades.append(f'Jupiter from H{jup_h} aspects Lagna → divine protection')
    
    # Saturn strong (own/exalted) → Ayushkaraka strong
    sat_rashi = engine.planets.get('Saturn', {}).get('rashi', 0)
    sat_pd = PD.get('Saturn', {})
    if sat_rashi == sat_pd.get('exalted') or sat_rashi in sat_pd.get('owns', []):
        upgrades.append('Saturn (Ayushkaraka) strong → extends life')
    
    # 8th lord = Lagna lord → special self-protection
    if lord1 == lord8:
        upgrades.append(f'{lord1} rules both 1st and 8th → self-protective longevity')
    
    # Malefics in 8th without benefic aspect → reduces
    mal_8 = [p for p in ['Saturn', 'Mars', 'Rahu', 'Ketu']
             if engine.planets.get(p, {}).get('house') == 8]
    if len(mal_8) >= 2:
        downgrades.append(f'Heavy malefics {mal_8} in 8th → health crises reduce life')
    
    # 8th lord debilitated → weakens longevity
    lord8_rashi = engine.planets.get(lord8, {}).get('rashi', 0)
    lord8_pd = PD.get(lord8, {})
    if lord8_rashi == lord8_pd.get('debilitated'):
        downgrades.append(f'8th lord {lord8} debilitated → longevity weakened')
    
    # Apply upgrades/downgrades
    if len(upgrades) >= 2 and result != 'long':
        result = 'long' if result == 'medium' else 'medium'
        years = '64-100+ years' if result == 'long' else '32-64 years'
        description = f'Upgraded from base due to: {"; ".join(upgrades[:2])}'
    elif len(downgrades) >= 2 and result != 'short':
        result = 'short' if result == 'medium' else 'medium'
        years = '0-32 years' if result == 'short' else '32-64 years'
        description = f'Downgraded from base due to: {"; ".join(downgrades[:2])}'
    
    return {
        'pair1': {'lords': f'{lord1} (1L) + {lord8} (8L)', 'result': pair1},
        'pair2': {'lords': f'Lagna ({RASHI_NAMES[asc_rashi]}) + Moon ({RASHI_NAMES[moon_rashi]})', 'result': pair2},
        'pair3': {'lords': f'Saturn ({RASHI_NAMES[saturn_rashi]}) + Sun ({RASHI_NAMES[sun_rashi]})', 'result': pair3},
        'category': result,
        'years': years,
        'description': description,
        'source': 'BPHS Ch.40 (Three-pair longevity method)',
        'upgrades': upgrades,
        'downgrades': downgrades,
    }
