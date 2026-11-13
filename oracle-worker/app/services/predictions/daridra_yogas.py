"""
BPHS CH.42 — COMBINATIONS FOR PENURY (Daridra Yogas)

Poverty-indicating yogas. The opposite of Dhana Yogas.
"""

from typing import List, Dict
from ..core.constants import RASHI_LORDS, PLANETS


def check_daridra_yogas(engine) -> List[Dict]:
    """Check for poverty/penury yogas from BPHS Ch.42."""
    asc = engine.ascendant_rashi
    yogas = []
    
    def lord(h): return RASHI_LORDS[(asc + h - 1) % 12]
    def house(p): return engine.planets.get(p, {}).get('house', 1)
    
    lord1 = lord(1)
    lord2 = lord(2)
    lord5 = lord(5)
    lord9 = lord(9)
    lord11 = lord(11)
    lord12 = lord(12)
    
    # BPHS 42.2: Lagna lord in 12th + 12th lord in lagna with maraka → penniless
    if house(lord1) == 12 and house(lord12) == 1:
        yogas.append({
            'text': f'Lagna lord {lord1} in 12th + 12th lord {lord12} in 1st → exchange causes financial ruin',
            'source': 'BPHS 42.2',
            'nature': 'negative',
        })
    
    # BPHS 42.3: Lords of 5th and 9th in dusthana → fortune denied
    if house(lord5) in [6, 8, 12] and house(lord9) in [6, 8, 12]:
        yogas.append({
            'text': f'5th lord {lord5} in H{house(lord5)} + 9th lord {lord9} in H{house(lord9)} — both fortune lords in dusthana → fortune denied',
            'source': 'BPHS 42.3',
            'nature': 'negative',
        })
    
    # BPHS: 2nd and 11th lords in 6/8/12 → wealth denied
    if house(lord2) in [6, 8, 12] and house(lord11) in [6, 8, 12]:
        yogas.append({
            'text': f'2nd lord {lord2} in H{house(lord2)} + 11th lord {lord11} in H{house(lord11)} — both wealth lords in dusthana → wealth denied',
            'source': 'BPHS 42',
            'nature': 'negative',
        })
    
    # BPHS: Jupiter + Mars in debilitation → penury despite effort
    jup_debil = engine.planets.get('Jupiter', {}).get('rashi') == PLANETS.get('Jupiter', {}).get('debilitated')
    mars_debil = engine.planets.get('Mars', {}).get('rashi') == PLANETS.get('Mars', {}).get('debilitated')
    if jup_debil and mars_debil:
        yogas.append({
            'text': 'Jupiter AND Mars both debilitated → extreme poverty despite effort',
            'source': 'BPHS 42 / Phaladeepika',
            'nature': 'negative',
        })
    
    # Kemadruma Yoga: Moon without planets on either side
    # BUT check cancellation conditions FIRST (BPHS)
    moon_h = house('Moon')
    moon_r = engine.planets.get('Moon', {}).get('rashi', 0)
    prev_h = moon_h - 1 if moon_h > 1 else 12
    next_h = moon_h + 1 if moon_h < 12 else 1
    planets_adjacent = [p for p in engine.planets 
                       if p not in ('Moon', 'Rahu', 'Ketu') and 
                       engine.planets[p].get('house') in (prev_h, next_h)]
    if not planets_adjacent:
        # Check CANCELLATION conditions before declaring Kemadruma
        cancelled = False
        cancel_reasons = []
        
        # Cancel 1: Any planet in kendra from Moon's SIGN
        for p in ['Sun', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']:
            p_r = engine.planets.get(p, {}).get('rashi', 0)
            dist = (p_r - moon_r) % 12
            if dist in [0, 3, 6, 9]:
                cancelled = True
                cancel_reasons.append(f'{p} in kendra from Moon')
        
        # Cancel 2: Moon in kendra from Lagna
        if moon_h in [1, 4, 7, 10]:
            cancelled = True
            cancel_reasons.append('Moon in kendra from Lagna')
        
        # Cancel 3: Moon aspected by Jupiter
        from ..core.constants import PLANETS as PLANET_DATA
        jup_h = house('Jupiter')
        for asp in PLANET_DATA.get('Jupiter', {}).get('aspects', [7]):
            target = ((jup_h + asp - 1) % 12) + 1
            if target == moon_h:
                cancelled = True
                cancel_reasons.append('Jupiter aspects Moon')
        
        # Cancel 4: Full Moon (waxing Moon near full)
        sun_long = engine.planets.get('Sun', {}).get('longitude', 0)
        moon_long = engine.planets.get('Moon', {}).get('longitude', 0)
        diff = (moon_long - sun_long) % 360
        if 120 < diff < 240:  # Moon is bright (near full)
            cancelled = True
            cancel_reasons.append('Moon is bright/near full')
        
        if cancelled:
            yogas.append({
                'text': f'Kemadruma Yoga present BUT CANCELLED: {", ".join(cancel_reasons)}',
                'source': 'BPHS (Kemadruma cancellation)',
                'nature': 'neutral',
            })
        else:
            yogas.append({
                'text': 'Kemadruma Yoga — Moon alone without adjacent planets, no cancellation → poverty and humiliation',
                'source': 'BPHS / Phaladeepika 15.8',
                'nature': 'negative',
            })
    
    # Shakata Yoga: Jupiter in 6th/8th/12th from Moon
    jup_h = house('Jupiter')
    from_moon = ((jup_h - moon_h) % 12) + 1
    if from_moon in [6, 8, 12]:
        yogas.append({
            'text': f'Shakata Yoga — Jupiter in {from_moon}th from Moon → alternating fortune, instability',
            'source': 'Phaladeepika',
            'nature': 'negative',
        })
    
    return yogas
