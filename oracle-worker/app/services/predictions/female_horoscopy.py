"""
BPHS CH.77-80 — FEMALE HOROSCOPY

Special rules for women's charts per BPHS.
Key differences from male chart reading:
- 7th house = husband (not wife)
- 8th house = mangalya (married state/longevity of husband)
- Jupiter = husband karaka (not Venus)
- Mars affliction = Manglik dosha (affects both genders)
"""

from typing import Dict, List
from ..core.constants import RASHI_LORDS, PLANETS


def get_female_specific_rules(engine) -> List[Dict]:
    """
    BPHS Ch.77-80: Rules specific to female horoscopy.
    These SUPPLEMENT (not replace) the general rules.
    """
    rules = []
    asc = engine.ascendant_rashi
    
    def lord(h): return RASHI_LORDS[(asc + h - 1) % 12]
    def house(p): return engine.planets.get(p, {}).get('house', 1)
    def rashi(p): return engine.planets.get(p, {}).get('rashi', 0)
    
    # Jupiter = husband karaka for women (not Venus)
    jup_h = house('Jupiter')
    jup_r = rashi('Jupiter')
    jup_pd = PLANETS.get('Jupiter', {})
    jup_strong = jup_r == jup_pd.get('exalted') or jup_r in jup_pd.get('owns', [])
    jup_weak = jup_r == jup_pd.get('debilitated')
    
    if jup_strong:
        rules.append({
            'text': 'Jupiter (husband karaka for women) strong → blessed marriage, good husband',
            'source': 'BPHS Ch.77 (Female horoscopy)',
            'nature': 'positive',
        })
    elif jup_weak:
        rules.append({
            'text': 'Jupiter (husband karaka for women) debilitated → husband faces challenges',
            'source': 'BPHS Ch.77',
            'nature': 'negative',
        })
    
    # 8th house = mangalya (married state)
    lord8 = lord(8)
    lord8_h = house(lord8)
    
    if lord8_h in [1, 4, 7, 10]:  # Kendra
        rules.append({
            'text': f'8th lord (mangalya) {lord8} in kendra H{lord8_h} → long married life',
            'source': 'BPHS Ch.78',
            'nature': 'positive',
        })
    elif lord8_h in [6, 8, 12]:
        rules.append({
            'text': f'8th lord (mangalya) {lord8} in dusthana H{lord8_h} → married life suffers',
            'source': 'BPHS Ch.78',
            'nature': 'negative',
        })
    
    # Malefics in 8th → widowhood or marital suffering
    mal_8 = [p for p in engine.planets if house(p) == 8 and p in ('Saturn', 'Mars', 'Rahu', 'Ketu')]
    if len(mal_8) >= 2:
        rules.append({
            'text': f'Multiple malefics {mal_8} in 8th → severe threat to married state',
            'source': 'BPHS Ch.79',
            'nature': 'negative',
        })
    
    # Venus strong for women → beauty, charm, happy domestic life
    venus_r = rashi('Venus')
    venus_strong = venus_r == PLANETS['Venus'].get('exalted') or venus_r in PLANETS['Venus'].get('owns', [])
    if venus_strong:
        rules.append({
            'text': 'Venus strong → beauty, charm, domestic happiness',
            'source': 'BPHS Ch.77',
            'nature': 'positive',
        })
    
    # Moon strong for women → emotional strength, good mother
    moon_r = rashi('Moon')
    moon_strong = moon_r == PLANETS['Moon'].get('exalted') or moon_r in PLANETS['Moon'].get('owns', [])
    if moon_strong:
        rules.append({
            'text': 'Moon strong → emotional strength, good mother, respected woman',
            'source': 'BPHS Ch.77',
            'nature': 'positive',
        })
    
    # 7th lord strong → good husband
    lord7 = lord(7)
    lord7_r = rashi(lord7)
    lord7_pd = PLANETS.get(lord7, {})
    lord7_strong = lord7_r == lord7_pd.get('exalted') or lord7_r in lord7_pd.get('owns', [])
    if lord7_strong:
        rules.append({
            'text': f'7th lord {lord7} strong → husband is prosperous and virtuous',
            'source': 'BPHS Ch.78',
            'nature': 'positive',
        })
    
    return rules
