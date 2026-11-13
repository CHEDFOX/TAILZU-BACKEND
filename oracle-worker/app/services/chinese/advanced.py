"""
CHINESE ADVANCED — Na Yin, 12 Life Stages, Yong Shen, Extended Stars, Fan Yin/Fu Yin
"""

from typing import Dict, List
from .bazi import HEAVENLY_STEMS, EARTHLY_BRANCHES, ELEMENT_NAMES, GENERATES, CONTROLS

# ═══════════════════════════════════════════════════════════════
# NA YIN (纳音) — 60 Poetic Element Names
# ═══════════════════════════════════════════════════════════════

NA_YIN_TABLE = [
    "Ocean Gold", "Ocean Gold",        # Jia-Zi, Yi-Chou
    "Furnace Fire", "Furnace Fire",     # Bing-Yin, Ding-Mao
    "Forest Wood", "Forest Wood",       # Wu-Chen, Ji-Si
    "Roadside Earth", "Roadside Earth", # Geng-Wu, Xin-Wei
    "Sword Metal", "Sword Metal",       # Ren-Shen, Gui-You
    "Mountain Fire", "Mountain Fire",   # Jia-Xu, Yi-Hai
    "Stream Water", "Stream Water",     # Bing-Zi, Ding-Chou
    "City Wall Earth", "City Wall Earth", # Wu-Yin, Ji-Mao
    "White Wax Metal", "White Wax Metal", # Geng-Chen, Xin-Si
    "Willow Wood", "Willow Wood",       # Ren-Wu, Gui-Wei
    "Spring Water", "Spring Water",     # Jia-Shen, Yi-You
    "Mountain Earth", "Mountain Earth", # Bing-Xu, Ding-Hai
    "Lightning Fire", "Lightning Fire", # Wu-Zi, Ji-Chou
    "Pine Wood", "Pine Wood",           # Geng-Yin, Xin-Mao
    "Long River Water", "Long River Water", # Ren-Chen, Gui-Si
    "Sand Gold", "Sand Gold",           # Jia-Wu, Yi-Wei
    "Mountain Fire", "Mountain Fire",   # Bing-Shen, Ding-You
    "Flat Ground Wood", "Flat Ground Wood", # Wu-Xu, Ji-Hai
    "Wall Earth", "Wall Earth",         # Geng-Zi, Xin-Chou
    "Metal Foil", "Metal Foil",         # Ren-Yin, Gui-Mao
    "Lantern Fire", "Lantern Fire",     # Jia-Chen, Yi-Si
    "Sky River Water", "Sky River Water", # Bing-Wu, Ding-Wei
    "Post Earth", "Post Earth",         # Wu-Shen, Ji-You
    "Hairpin Metal", "Hairpin Metal",   # Geng-Xu, Xin-Hai
    "Mulberry Wood", "Mulberry Wood",   # Ren-Zi, Gui-Chou
    "Great Stream Water", "Great Stream Water", # Jia-Yin, Yi-Mao
    "Sand Earth", "Sand Earth",         # Bing-Chen, Ding-Si
    "Skyfire", "Skyfire",               # Wu-Wu, Ji-Wei
    "Pomegranate Wood", "Pomegranate Wood", # Geng-Shen, Xin-You
    "Great Ocean Water", "Great Ocean Water", # Ren-Xu, Gui-Hai
]

NA_YIN_ELEMENTS = {
    "Gold": "Metal", "Metal": "Metal", "Foil": "Metal", "Hairpin": "Metal", "Wax": "Metal", "Sword": "Metal", "Sand": "Metal",
    "Fire": "Fire", "Lightning": "Fire", "Lantern": "Fire", "Skyfire": "Fire", "Mountain Fire": "Fire", "Furnace": "Fire",
    "Wood": "Wood", "Pine": "Wood", "Willow": "Wood", "Pomegranate": "Wood", "Mulberry": "Wood", "Forest": "Wood", "Flat": "Wood",
    "Water": "Water", "Stream": "Water", "Spring": "Water", "River": "Water", "Ocean": "Water", "Great": "Water",
    "Earth": "Earth", "Wall": "Earth", "Roadside": "Earth", "City": "Earth", "Post": "Earth",
}


def get_na_yin(stem_idx: int, branch_idx: int) -> Dict:
    """Get Na Yin for a stem-branch pair."""
    sexagenary = (stem_idx * 12 + branch_idx) % 60
    # Map to pair index (each Na Yin covers 2 pillars)
    pair_idx = sexagenary % 60
    if pair_idx < len(NA_YIN_TABLE):
        name = NA_YIN_TABLE[pair_idx]
    else:
        name = "Unknown"

    element = name.split()[-1] if name != "Unknown" else "Unknown"
    return {
        'na_yin': name,
        'element': element,
        'description': f"{name} — the poetic quality of this pillar's energy",
    }


def get_all_na_yin(pillars: Dict) -> Dict:
    """Get Na Yin for all four pillars."""
    result = {}
    for p_name in ['year', 'month', 'day', 'hour']:
        p = pillars.get(p_name, {})
        stem = p.get('stem', 0) if isinstance(p, dict) and 'stem' in p else 0
        branch = p.get('branch', 0) if isinstance(p, dict) and 'branch' in p else 0
        # Handle nested structure
        if isinstance(stem, dict):
            stem_idx = list(range(10))[0]  # fallback
        else:
            stem_idx = stem
        if isinstance(branch, dict):
            branch_idx = 0
        else:
            branch_idx = branch
        result[p_name] = get_na_yin(stem_idx, branch_idx)
    return result


# ═══════════════════════════════════════════════════════════════
# 12 LIFE STAGES (长生十二宫)
# ═══════════════════════════════════════════════════════════════

LIFE_STAGES = [
    ("Chang Sheng", "长生", "Birth/Growth", "New beginnings, vitality, fresh start"),
    ("Mu Yu", "沐浴", "Bathing", "Vulnerability, exposure, mistakes, learning"),
    ("Guan Dai", "冠带", "Capping", "Coming of age, preparation, building"),
    ("Lin Guan", "临官", "Career", "Peak energy, career establishment, authority"),
    ("Di Wang", "帝旺", "Emperor", "Maximum power, success, dominance"),
    ("Shuai", "衰", "Decline", "First decline, conserving, wisdom from experience"),
    ("Bing", "病", "Illness", "Weakness, vulnerability, need for rest"),
    ("Si", "死", "Death", "Ending, transformation, letting go"),
    ("Mu", "墓", "Tomb", "Storage, inheritance, hidden resources"),
    ("Jue", "绝", "Extinction", "Complete ending, void, emptiness before rebirth"),
    ("Tai", "胎", "Embryo", "Conception, potential, seeds forming"),
    ("Yang", "养", "Nurturing", "Gestation, preparation for birth, incubation"),
]

# Starting branch for each Yang stem (Life Stage sequence start)
YANG_STAGE_START = {
    'Jia': 11,  # Yang Wood starts at Hai
    'Bing': 2,  # Yang Fire starts at Yin
    'Wu': 2,    # Yang Earth starts at Yin
    'Geng': 5,  # Yang Metal starts at Si
    'Ren': 8,   # Yang Water starts at Shen
}
# Yin stems go in reverse direction
YIN_STAGE_START = {
    'Yi': 6,    # Yin Wood starts at Wu
    'Ding': 9,  # Yin Fire starts at You
    'Ji': 9,    # Yin Earth starts at You
    'Xin': 0,   # Yin Metal starts at Zi
    'Gui': 3,   # Yin Water starts at Mao
}


def get_life_stages(day_stem_idx: int) -> Dict:
    """
    Calculate 12 Life Stages for the Day Stem.
    Yang stems go forward through branches, Yin stems go backward.
    """
    stem_info = HEAVENLY_STEMS[day_stem_idx]
    stem_name = stem_info[0]
    is_yang = day_stem_idx % 2 == 0

    if is_yang:
        start_branch = YANG_STAGE_START.get(stem_name, 0)
        direction = 1
    else:
        start_branch = YIN_STAGE_START.get(stem_name, 0)
        direction = -1

    stages = {}
    for i, (pinyin, chinese, english, meaning) in enumerate(LIFE_STAGES):
        branch_idx = (start_branch + i * direction) % 12
        animal = EARTHLY_BRANCHES[branch_idx][2]
        stages[pinyin] = {
            'stage': english,
            'chinese': chinese,
            'branch': animal,
            'branch_index': branch_idx,
            'meaning': meaning,
            'order': i + 1,
        }

    return {
        'day_stem': stem_info[2],
        'direction': 'forward' if is_yang else 'backward',
        'stages': stages,
    }


# ═══════════════════════════════════════════════════════════════
# YONG SHEN (用神) — Useful God / JI SHEN (忌神) — Jealous God
# ═══════════════════════════════════════════════════════════════

def calculate_yong_shen(day_master_element: str, element_counts: Dict,
                          dm_strength: str) -> Dict:
    """
    Yong Shen = the most needed element to balance the chart.
    Ji Shen = the most harmful element.

    Weak DM needs: same element (support) or resource (what generates it).
    Strong DM needs: output (what it generates) or wealth (what it controls).
    """
    if dm_strength == 'Strong':
        # Strong DM needs to be drained or controlled
        yong = GENERATES.get(day_master_element, 'Wood')  # Output element
        ji = day_master_element  # Too much of self is bad
        xi = CONTROLS.get(day_master_element, 'Earth')  # Wealth element (also drains)
        chou = [e for e in ELEMENT_NAMES if CONTROLS.get(e) == day_master_element]
        chou_element = chou[0] if chou else ''
    else:
        # Weak DM needs support
        resource_elements = [e for e in ELEMENT_NAMES if GENERATES.get(e) == day_master_element]
        yong = resource_elements[0] if resource_elements else day_master_element
        ji = CONTROLS.get(day_master_element, 'Wood') if CONTROLS.get(day_master_element) else ''
        xi = day_master_element  # Same element supports
        chou_element = GENERATES.get(day_master_element, '')

    return {
        'yong_shen': yong,
        'yong_meaning': f'{yong} — the element you most need; pursue, wear, and surround yourself with it',
        'xi_shen': xi,
        'xi_meaning': f'{xi} — secondary helpful element',
        'ji_shen': ji,
        'ji_meaning': f'{ji} — harmful element; reduce exposure to it',
        'chou_shen': chou_element,
        'chou_meaning': f'{chou_element} — element of conflict' if chou_element else '',
        'dm_strength': dm_strength,
    }


# ═══════════════════════════════════════════════════════════════
# FAN YIN (伏吟) / FU YIN (反吟)
# ═══════════════════════════════════════════════════════════════

def check_fan_fu_yin(pillars: Dict) -> Dict:
    """
    Fan Yin (伏吟): Same pillar appears twice (e.g., two Jia-Zi pillars).
    Fu Yin (反吟): Clashing pillar appears (e.g., Jia-Zi and Geng-Wu).
    Both indicate repetitive karmic patterns.
    """
    results = {'fan_yin': [], 'fu_yin': []}
    pillar_names = ['year', 'month', 'day', 'hour']

    for i in range(4):
        for j in range(i + 1, 4):
            si, sj = pillars[pillar_names[i]]['stem'], pillars[pillar_names[j]]['stem']
            bi, bj = pillars[pillar_names[i]]['branch'], pillars[pillar_names[j]]['branch']

            # Fan Yin: identical stem AND branch
            if si == sj and bi == bj:
                results['fan_yin'].append({
                    'pillars': [pillar_names[i], pillar_names[j]],
                    'meaning': 'Same pillar repeats — cyclical patterns, things return',
                })

            # Fu Yin: stem clashes AND branch clashes
            stem_clash = abs(si - sj) == 4 or abs(si - sj) == 6  # Approximate
            branch_clash = abs(bi - bj) == 6
            if stem_clash and branch_clash:
                results['fu_yin'].append({
                    'pillars': [pillar_names[i], pillar_names[j]],
                    'meaning': 'Opposing pillars — internal conflict, push-pull dynamics',
                })

    return results


# ═══════════════════════════════════════════════════════════════
# EXTENDED SYMBOLIC STARS (30+)
# ═══════════════════════════════════════════════════════════════

def get_extended_stars(year_branch: int, day_stem: int, day_branch: int,
                       branches: List[int]) -> Dict:
    """Calculate 30+ symbolic stars."""
    stars = {}

    # Tian De (天德) — Heavenly Virtue (by month branch)
    TIAN_DE = {2: 7, 3: 8, 4: 9, 5: 10, 6: 11, 7: 0, 8: 1, 9: 2, 10: 3, 11: 4, 0: 5, 1: 6}

    # Yue De (月德) — Monthly Virtue
    YUE_DE = {2: 'Ren', 3: 'Geng', 4: 'Bing', 5: 'Jia', 6: 'Ren', 7: 'Geng',
              8: 'Bing', 9: 'Jia', 10: 'Ren', 11: 'Geng', 0: 'Bing', 1: 'Jia'}

    # Yang Ren (羊刃) — Blade Star (by day stem)
    YANG_REN = {0: 3, 1: 4, 2: 6, 3: 7, 4: 6, 5: 7, 6: 9, 7: 10, 8: 0, 9: 1}
    yr_branch = YANG_REN.get(day_stem, -1)
    stars['yang_ren'] = {
        'name': 'Blade Star (羊刃)',
        'present': yr_branch in branches,
        'meaning': 'Powerful but dangerous — great courage, risk of injury or conflict' if yr_branch in branches else '',
    }

    # Lu Shen (禄神) — Prosperity Star (by day stem)
    LU_SHEN = {0: 2, 1: 3, 2: 5, 3: 6, 4: 5, 5: 6, 6: 8, 7: 9, 8: 11, 9: 0}
    ls_branch = LU_SHEN.get(day_stem, -1)
    stars['lu_shen'] = {
        'name': 'Prosperity Star (禄神)',
        'present': ls_branch in branches,
        'meaning': 'Natural prosperity and career success' if ls_branch in branches else '',
    }

    # Hua Gai (华盖) — Canopy Star (by year branch)
    HUA_GAI = {0: 4, 1: 1, 2: 10, 3: 7, 4: 4, 5: 1, 6: 10, 7: 7, 8: 4, 9: 1, 10: 10, 11: 7}
    hg_branch = HUA_GAI.get(year_branch, -1)
    stars['hua_gai'] = {
        'name': 'Canopy Star (华盖)',
        'present': hg_branch in branches,
        'meaning': 'Spiritual depth, artistic talent, tendency toward solitude' if hg_branch in branches else '',
    }

    # Jiang Xing (将星) — General Star (by year branch)
    JIANG_XING = {0: 0, 1: 9, 2: 6, 3: 3, 4: 0, 5: 9, 6: 6, 7: 3, 8: 0, 9: 9, 10: 6, 11: 3}
    jx_branch = JIANG_XING.get(year_branch, -1)
    stars['jiang_xing'] = {
        'name': 'General Star (将星)',
        'present': jx_branch in branches,
        'meaning': 'Leadership ability, authority, military/command potential' if jx_branch in branches else '',
    }

    # Hong Yan (红艳) — Red Beauty Star (by day stem)
    HONG_YAN = {0: 6, 1: 8, 2: 2, 3: 7, 4: 4, 5: 4, 6: 10, 7: 9, 8: 0, 9: 5}
    hy_branch = HONG_YAN.get(day_stem, -1)
    stars['hong_yan'] = {
        'name': 'Red Beauty (红艳)',
        'present': hy_branch in branches,
        'meaning': 'Romantic allure, beauty, but potential for scandal' if hy_branch in branches else '',
    }

    # Tian Yi (天医) — Heavenly Doctor
    TIAN_YI = {0: 1, 1: 0, 2: 11, 3: 10, 4: 9, 5: 8, 6: 7, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2}
    ty_branch = TIAN_YI.get(year_branch, -1)
    stars['tian_yi'] = {
        'name': 'Heavenly Doctor (天医)',
        'present': ty_branch in branches,
        'meaning': 'Healing ability, medical talent, recovery power' if ty_branch in branches else '',
    }

    # Wang Shen (亡神) — Death Spirit
    WANG_SHEN = {0: 5, 1: 2, 2: 11, 3: 8, 4: 5, 5: 2, 6: 11, 7: 8, 8: 5, 9: 2, 10: 11, 11: 8}
    ws_branch = WANG_SHEN.get(year_branch, -1)
    stars['wang_shen'] = {
        'name': 'Death Spirit (亡神)',
        'present': ws_branch in branches,
        'meaning': 'Spiritual sensitivity, possible danger periods, psychic awareness' if ws_branch in branches else '',
    }

    # Jie Sha (劫煞) — Robbery Star
    JIE_SHA = {0: 5, 1: 2, 2: 11, 3: 8, 4: 5, 5: 2, 6: 11, 7: 8, 8: 5, 9: 2, 10: 11, 11: 8}
    js_branch = JIE_SHA.get(year_branch, -1)
    stars['jie_sha'] = {
        'name': 'Robbery Star (劫煞)',
        'present': js_branch in branches,
        'meaning': 'Risk of theft or loss, but also sharp intelligence' if js_branch in branches else '',
    }

    # Tai Ji (太极) — Supreme Ultimate (by day stem)
    TAI_JI = {0: [0, 6], 1: [0, 6], 2: [2, 8], 3: [2, 8], 4: [2, 8, 0, 6],
              5: [2, 8, 0, 6], 6: [4, 10], 7: [4, 10], 8: [4, 10], 9: [4, 10]}
    tj_branches = TAI_JI.get(day_stem, [])
    stars['tai_ji'] = {
        'name': 'Supreme Ultimate (太极)',
        'present': any(b in branches for b in tj_branches),
        'meaning': 'Philosophical depth, connection to the source, spiritual wisdom' if any(b in branches for b in tj_branches) else '',
    }

    # Count present stars
    present_count = sum(1 for s in stars.values() if s.get('present'))
    absent_count = sum(1 for s in stars.values() if not s.get('present'))

    return {
        'stars': stars,
        'present_count': present_count,
        'total_checked': len(stars),
        'summary': f'{present_count} of {len(stars)} extended stars present',
    }


# ═══════════════════════════════════════════════════════════════
# PUBLIC API
# ═══════════════════════════════════════════════════════════════

def get_complete_chinese_advanced(chart) -> Dict:
    """Run all advanced Chinese analysis."""
    chart._ensure_calculated()
    pillars_raw = chart._pillars
    day_stem = pillars_raw['day']['stem']
    day_branch = pillars_raw['day']['branch']
    year_branch = pillars_raw['year']['branch']
    branches = [pillars_raw[p]['branch'] for p in ['year', 'month', 'day', 'hour']]

    dm = chart.get_day_master()
    elements = chart.get_element_balance()

    return {
        'na_yin': get_all_na_yin(pillars_raw),
        'life_stages': get_life_stages(day_stem),
        'yong_shen': calculate_yong_shen(dm['element'], elements['counts'], elements['day_master_strength']),
        'fan_fu_yin': check_fan_fu_yin(pillars_raw),
        'extended_stars': get_extended_stars(year_branch, day_stem, day_branch, branches),
    }
