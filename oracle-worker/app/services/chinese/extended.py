"""
CHINESE EXTENDED — Da Yun onset, Xiao Yun, Monthly/Daily pillar overlay,
Hidden Stems strength, 10 Gods interaction, Date Selection, Name Analysis,
Feng Shui basics, Chinese Medical Astrology
"""
from datetime import datetime
from typing import Dict, List
from .bazi import BaZiChart, HEAVENLY_STEMS, EARTHLY_BRANCHES, ELEMENTS_CYCLE, \
    ELEMENT_NAMES, GENERATES, CONTROLS

# ═══════════════════════════════════════════════════════════════
# PROPER DA YUN ONSET AGE
# ═══════════════════════════════════════════════════════════════
def calculate_dayun_onset(birth_dt: datetime, year_stem: int, gender: str = "male") -> Dict:
    """
    Calculate exact Da Yun onset age from distance to nearest solar term.
    Yang stem + male = count forward to next Jie Qi.
    Yin stem + male = count backward to previous Jie Qi.
    3 days = 1 year of Da Yun onset age.
    """
    yang = year_stem % 2 == 0
    is_male = gender.lower() in ('male', 'm')
    forward = (yang and is_male) or (not yang and not is_male)
    
    try:
        import swisseph as swe
        jd = swe.julday(birth_dt.year, birth_dt.month, birth_dt.day,
                        birth_dt.hour + birth_dt.minute / 60.0)
        sun = swe.calc_ut(jd, 0, swe.FLG_SWIEPH)[0][0] % 360
        
        # Solar term boundaries are every 15° of Sun's tropical longitude
        if forward:
            next_term = ((int(sun / 15) + 1) * 15) % 360
            # Find when Sun reaches next_term
            for day in range(1, 45):
                test_jd = jd + day
                test_sun = swe.calc_ut(test_jd, 0, swe.FLG_SWIEPH)[0][0] % 360
                if abs(test_sun - next_term) < 1.0 or (next_term == 0 and test_sun > 350):
                    days_to_term = day
                    break
            else:
                days_to_term = 15
        else:
            prev_term = (int(sun / 15) * 15) % 360
            for day in range(1, 45):
                test_jd = jd - day
                test_sun = swe.calc_ut(test_jd, 0, swe.FLG_SWIEPH)[0][0] % 360
                if abs(test_sun - prev_term) < 1.0:
                    days_to_term = day
                    break
            else:
                days_to_term = 15
        
        onset_age = days_to_term / 3.0
    except Exception:
        onset_age = 6.0  # Default fallback
    
    return {
        'onset_age': round(onset_age, 1),
        'onset_years': int(onset_age),
        'onset_months': int((onset_age % 1) * 12),
        'direction': 'forward' if forward else 'backward',
        'gender': gender,
    }

# ═══════════════════════════════════════════════════════════════
# XIAO YUN (小运) — Small Luck (childhood before Da Yun)
# ═══════════════════════════════════════════════════════════════
def calculate_xiao_yun(birth_dt: datetime, year_stem: int, hour_branch: int,
                         onset_age: int, gender: str = "male") -> List[Dict]:
    """Small luck periods from birth until Da Yun kicks in."""
    yang = year_stem % 2 == 0
    is_male = gender.lower() in ('male', 'm')
    forward = (yang and is_male) or (not yang and not is_male)
    
    periods = []
    current_branch = hour_branch
    for age in range(1, onset_age + 1):
        if forward:
            current_branch = (current_branch + 1) % 12
        else:
            current_branch = (current_branch - 1) % 12
        
        branch_info = EARTHLY_BRANCHES[current_branch]
        periods.append({
            'age': age, 'branch': branch_info[0], 'animal': branch_info[2],
            'element': branch_info[3].split()[1],
        })
    
    return periods

# ═══════════════════════════════════════════════════════════════
# MONTHLY / DAILY PILLAR OVERLAY
# ═══════════════════════════════════════════════════════════════
def get_current_pillar_overlay(birth_chart: BaZiChart) -> Dict:
    """Current month and day pillars interacting with natal chart."""
    now = datetime.now()
    current = BaZiChart(now)
    current._ensure_calculated()
    natal = birth_chart
    natal._ensure_calculated()
    
    # Current month pillar
    cm_stem = current._pillars['month']['stem']
    cm_branch = current._pillars['month']['branch']
    
    # Current day pillar
    cd_stem = current._pillars['day']['stem']
    cd_branch = current._pillars['day']['branch']
    
    # Check interactions with natal branches
    natal_branches = [natal._pillars[p]['branch'] for p in ['year', 'month', 'day', 'hour']]
    
    from .interactions import SIX_CLASHES, SIX_HARMONIES
    
    month_clashes = []
    month_harmonies = []
    day_clashes = []
    day_harmonies = []
    
    for nb in natal_branches:
        for b1, b2, _, animals, _ in SIX_CLASHES:
            if (cm_branch == b1 and nb == b2) or (cm_branch == b2 and nb == b1):
                month_clashes.append(animals)
            if (cd_branch == b1 and nb == b2) or (cd_branch == b2 and nb == b1):
                day_clashes.append(animals)
        for b1, b2, _, animals, _, _ in SIX_HARMONIES:
            if (cm_branch == b1 and nb == b2) or (cm_branch == b2 and nb == b1):
                month_harmonies.append(animals)
            if (cd_branch == b1 and nb == b2) or (cd_branch == b2 and nb == b1):
                day_harmonies.append(animals)
    
    cm_info = HEAVENLY_STEMS[cm_stem]
    cm_b_info = EARTHLY_BRANCHES[cm_branch]
    cd_info = HEAVENLY_STEMS[cd_stem]
    cd_b_info = EARTHLY_BRANCHES[cd_branch]
    
    return {
        'current_month': f'{cm_info[2]} / {cm_b_info[2]}',
        'current_day': f'{cd_info[2]} / {cd_b_info[2]}',
        'month_clashes': month_clashes, 'month_harmonies': month_harmonies,
        'day_clashes': day_clashes, 'day_harmonies': day_harmonies,
        'month_outlook': 'Challenging' if month_clashes else 'Harmonious' if month_harmonies else 'Neutral',
        'day_outlook': 'Challenging' if day_clashes else 'Harmonious' if day_harmonies else 'Neutral',
    }

# ═══════════════════════════════════════════════════════════════
# HIDDEN STEMS WITH STRENGTH PERCENTAGES
# ═══════════════════════════════════════════════════════════════
HIDDEN_STEM_STRENGTHS = {
    "Zi": [("Gui", 100)],
    "Chou": [("Ji", 60), ("Gui", 30), ("Xin", 10)],
    "Yin": [("Jia", 60), ("Bing", 30), ("Wu", 10)],
    "Mao": [("Yi", 100)],
    "Chen": [("Wu", 60), ("Yi", 30), ("Gui", 10)],
    "Si": [("Bing", 60), ("Wu", 30), ("Geng", 10)],
    "Wu": [("Ding", 70), ("Ji", 30)],
    "Wei": [("Ji", 60), ("Ding", 30), ("Yi", 10)],
    "Shen": [("Geng", 60), ("Ren", 30), ("Wu", 10)],
    "You": [("Xin", 100)],
    "Xu": [("Wu", 60), ("Xin", 30), ("Ding", 10)],
    "Hai": [("Ren", 70), ("Jia", 30)],
}

def get_hidden_stems_with_strength(pillars: Dict) -> Dict:
    """Get hidden stems with exact strength percentages for each pillar."""
    result = {}
    for p_name in ['year', 'month', 'day', 'hour']:
        branch_idx = pillars[p_name]['branch']
        branch_name = EARTHLY_BRANCHES[branch_idx][0]
        stems = HIDDEN_STEM_STRENGTHS.get(branch_name, [])
        result[p_name] = [{'stem': s, 'strength_pct': pct,
                           'element': next((hs[2] for hs in HEAVENLY_STEMS if hs[0] == s), '')}
                          for s, pct in stems]
    return result

# ═══════════════════════════════════════════════════════════════
# 10 GODS INTERACTION MATRIX
# ═══════════════════════════════════════════════════════════════
TEN_GODS_INTERACTIONS = {
    ('Direct Officer', 'Eating God'): 'Authority suppresses creativity — career limits self-expression',
    ('Direct Officer', 'Hurting Officer'): 'Authority clashes with rebellion — conflict with bosses',
    ('7 Killings', 'Direct Resource'): 'Pressure channeled through learning — growth through hardship',
    ('7 Killings', 'Eating God'): 'Eating God controls 7K — creative solution to pressure',
    ('Direct Wealth', 'Rob Wealth'): 'Money attracts competition — wealth shared or lost to rivals',
    ('Indirect Wealth', 'Companion'): 'Speculative wealth + peers — business partnerships',
    ('Direct Resource', 'Direct Wealth'): 'Learning vs earning — can not have both easily',
    ('Hurting Officer', 'Direct Wealth'): 'Creativity generates money — talent monetization',
    ('Eating God', 'Indirect Wealth'): 'Creative output generates unexpected income',
    ('Companion', '7 Killings'): 'Friends face pressure together — group challenges',
}

def analyze_ten_gods_matrix(ten_gods: Dict) -> List[Dict]:
    """Analyze interactions between the 10 Gods in the chart."""
    gods_present = []
    for pillar, god in ten_gods.items():
        if pillar != 'day' and isinstance(god, str):
            clean = god.split(' (')[0] if ' (' in god else god
            gods_present.append((pillar, clean))
    
    interactions = []
    for i, (p1, g1) in enumerate(gods_present):
        for p2, g2 in gods_present[i+1:]:
            key1 = (g1, g2)
            key2 = (g2, g1)
            meaning = TEN_GODS_INTERACTIONS.get(key1) or TEN_GODS_INTERACTIONS.get(key2)
            if meaning:
                interactions.append({
                    'god1': g1, 'pillar1': p1, 'god2': g2, 'pillar2': p2,
                    'interaction': meaning,
                })
    
    return interactions

# ═══════════════════════════════════════════════════════════════
# CHINESE DATE SELECTION (择日)
# ═══════════════════════════════════════════════════════════════
def select_auspicious_date(dm_element: str, event: str = "general",
                             days_ahead: int = 30) -> List[Dict]:
    """Find auspicious dates based on Day Master element and event type."""
    favorable = GENERATES.get(dm_element, dm_element)  # What generates DM
    unfavorable_elem = CONTROLS.get(dm_element) if CONTROLS.get(dm_element) else ''
    
    results = []
    for day_offset in range(1, days_ahead + 1):
        check_date = datetime.now() + __import__('datetime').timedelta(days=day_offset)
        day_chart = BaZiChart(check_date)
        day_chart._ensure_calculated()
        
        day_stem = day_chart._pillars['day']['stem']
        day_element = ELEMENTS_CYCLE[day_stem]
        day_branch = day_chart._pillars['day']['branch']
        day_animal = EARTHLY_BRANCHES[day_branch][2]
        
        score = 50
        factors = []
        
        if day_element == favorable:
            score += 20; factors.append(f'{day_element} day supports your {dm_element}')
        elif day_element == unfavorable_elem:
            score -= 15; factors.append(f'{day_element} day controls your {dm_element}')
        
        # Avoid Rat-Horse, Tiger-Monkey etc clash days
        if day_branch in [0, 6] and event == 'marriage':
            score -= 10; factors.append('Clash axis day — avoid for marriage')
        
        if score >= 60:
            results.append({
                'date': check_date.strftime('%Y-%m-%d'),
                'day': check_date.strftime('%A'),
                'stem': HEAVENLY_STEMS[day_stem][2],
                'animal': day_animal, 'element': day_element,
                'score': min(95, score), 'factors': factors,
            })
    
    results.sort(key=lambda r: -r['score'])
    return results[:10]

# ═══════════════════════════════════════════════════════════════
# CHINESE NAME ANALYSIS (Stroke Count)
# ═══════════════════════════════════════════════════════════════
NAME_NUMBER_ELEMENTS = {
    1: 'Wood', 2: 'Wood', 3: 'Fire', 4: 'Fire', 5: 'Earth',
    6: 'Earth', 7: 'Metal', 8: 'Metal', 9: 'Water', 0: 'Water',
}
NAME_NUMBER_LUCK = {
    1: 'Auspicious', 3: 'Auspicious', 5: 'Auspicious', 6: 'Auspicious',
    7: 'Auspicious', 8: 'Auspicious', 11: 'Auspicious', 13: 'Auspicious',
    15: 'Auspicious', 16: 'Auspicious', 21: 'Auspicious', 23: 'Auspicious',
    24: 'Auspicious', 25: 'Auspicious', 31: 'Auspicious', 32: 'Auspicious',
    33: 'Auspicious', 35: 'Auspicious', 37: 'Auspicious', 41: 'Auspicious',
    2: 'Inauspicious', 4: 'Inauspicious', 9: 'Inauspicious', 10: 'Inauspicious',
    14: 'Inauspicious', 19: 'Inauspicious', 20: 'Inauspicious', 22: 'Inauspicious',
    26: 'Inauspicious', 27: 'Inauspicious', 28: 'Inauspicious', 34: 'Inauspicious',
    36: 'Inauspicious', 40: 'Inauspicious', 42: 'Inauspicious', 44: 'Inauspicious',
}

def analyze_chinese_name(name: str, favorable_element: str = "") -> Dict:
    """Analyze name by stroke count and element compatibility."""
    total_strokes = sum(len(char.encode('utf-8')) for char in name if ord(char) > 127)
    if total_strokes == 0:
        total_strokes = len(name)
    
    name_element = NAME_NUMBER_ELEMENTS.get(total_strokes % 10, 'Earth')
    luck = NAME_NUMBER_LUCK.get(total_strokes, 'Neutral')
    
    compat = ''
    if favorable_element:
        if name_element == favorable_element:
            compat = 'Excellent — name element matches favorable element'
        elif GENERATES.get(name_element) == favorable_element:
            compat = 'Good — name generates favorable element'
        elif CONTROLS.get(name_element) == favorable_element:
            compat = 'Poor — name controls favorable element'
        else:
            compat = 'Neutral'
    
    return {
        'name': name, 'strokes': total_strokes, 'element': name_element,
        'luck_rating': luck, 'element_compatibility': compat,
        'favorable_element': favorable_element,
    }

# ═══════════════════════════════════════════════════════════════
# FENG SHUI — 8 MANSIONS + FLYING STARS (simplified)
# ═══════════════════════════════════════════════════════════════
def get_feng_shui_directions(dm_element: str) -> Dict:
    """8 Mansions — East/West group based on Day Master element."""
    east_group = {'Wood', 'Fire', 'Water'}
    west_group = {'Earth', 'Metal'}
    
    group = 'East' if dm_element in east_group else 'West'
    
    if group == 'East':
        favorable = ['East', 'Southeast', 'South', 'North']
        unfavorable = ['West', 'Northwest', 'Southwest', 'Northeast']
    else:
        favorable = ['West', 'Northwest', 'Southwest', 'Northeast']
        unfavorable = ['East', 'Southeast', 'South', 'North']
    
    return {
        'group': f'{group} Group', 'element': dm_element,
        'favorable_directions': favorable, 'unfavorable_directions': unfavorable,
        'best_sleeping': favorable[0], 'best_working': favorable[1],
        'best_door': favorable[2], 'avoid': unfavorable[0],
    }

# ═══════════════════════════════════════════════════════════════
# CHINESE MEDICAL ASTROLOGY (BaZi → TCM)
# ═══════════════════════════════════════════════════════════════
TCM_ORGANS = {
    'Wood': {'yin': 'Liver', 'yang': 'Gallbladder', 'emotion': 'Anger',
             'sense': 'Eyes', 'tissue': 'Tendons', 'taste': 'Sour'},
    'Fire': {'yin': 'Heart', 'yang': 'Small Intestine', 'emotion': 'Joy/Anxiety',
             'sense': 'Tongue', 'tissue': 'Blood vessels', 'taste': 'Bitter'},
    'Earth': {'yin': 'Spleen', 'yang': 'Stomach', 'emotion': 'Worry',
              'sense': 'Mouth', 'tissue': 'Muscles', 'taste': 'Sweet'},
    'Metal': {'yin': 'Lungs', 'yang': 'Large Intestine', 'emotion': 'Grief',
              'sense': 'Nose', 'tissue': 'Skin', 'taste': 'Pungent'},
    'Water': {'yin': 'Kidneys', 'yang': 'Bladder', 'emotion': 'Fear',
              'sense': 'Ears', 'tissue': 'Bones', 'taste': 'Salty'},
}

def chinese_medical_analysis(element_counts: Dict, dm_element: str, dm_strength: str) -> Dict:
    """Map BaZi elements to TCM organ strengths and vulnerabilities."""
    vulnerabilities = []
    strengths = []
    
    for element in ELEMENT_NAMES:
        count = element_counts.get(element, 0)
        organs = TCM_ORGANS.get(element, {})
        
        if count == 0:
            vulnerabilities.append({
                'element': element, 'organs': f"{organs.get('yin', '')}/{organs.get('yang', '')}",
                'risk': f"Missing {element} — {organs.get('yin', '')} and {organs.get('yang', '')} vulnerable",
                'emotion': f"Prone to {organs.get('emotion', '')}",
                'remedy': f"Add {element} foods ({organs.get('taste', '')} flavor), stimulate {organs.get('sense', '')}",
            })
        elif count >= 3:
            strengths.append({
                'element': element, 'organs': f"{organs.get('yin', '')}/{organs.get('yang', '')}",
                'note': f"Excess {element} — {organs.get('yin', '')} overactive, may cause {organs.get('emotion', '')}",
            })
    
    dm_organs = TCM_ORGANS.get(dm_element, {})
    
    return {
        'day_master_organ': dm_organs,
        'vulnerabilities': vulnerabilities,
        'strengths': strengths,
        'dietary_advice': f"Focus on {', '.join(TCM_ORGANS.get(e, {}).get('taste', '') for e in ELEMENT_NAMES if element_counts.get(e, 0) == 0)} flavors" if any(element_counts.get(e, 0) == 0 for e in ELEMENT_NAMES) else 'Balanced diet recommended',
    }
