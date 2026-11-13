"""
COMPLETE JAIMINI SYSTEM
All 12 Arudha Padas, Upapada Lagna, Swamsa, Jaimini Rashi Aspects,
Jaimini-specific Yogas, and Jaimini Chara Dasha conditions.
"""

from typing import Dict, List

RASHI_NAMES = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
               "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"]
RASHI_LORDS_MAP = {
    0: 'Mars', 1: 'Venus', 2: 'Mercury', 3: 'Moon', 4: 'Sun', 5: 'Mercury',
    6: 'Venus', 7: 'Mars', 8: 'Jupiter', 9: 'Saturn', 10: 'Saturn', 11: 'Jupiter'
}


def _lord_of_house(house: int, asc_rashi: int) -> str:
    return RASHI_LORDS_MAP.get((asc_rashi + house - 1) % 12, '')


def _planet_house(planets: Dict, name: str) -> int:
    return planets.get(name, {}).get('house', 0)


def _planet_rashi(planets: Dict, name: str) -> int:
    return planets.get(name, {}).get('rashi', 0)


# ═══════════════════════════════════════════════════════════════
# ALL 12 ARUDHA PADAS
# ═══════════════════════════════════════════════════════════════

ARUDHA_NAMES = {
    1: ('Arudha Lagna (AL)', 'How the world perceives you — public image, status projection'),
    2: ('Dhana Pada (A2)', 'Perceived wealth and resources'),
    3: ('Vikrama Pada (A3)', 'Perceived courage, siblings image'),
    4: ('Sukha Pada (A4)', 'Perceived happiness, property image'),
    5: ('Mantra Pada (A5)', 'Perceived intelligence, children image'),
    6: ('Roga Pada (A6)', 'Perceived enemies, health image'),
    7: ('Dara Pada (A7)', 'Perceived partnerships, spouse image'),
    8: ('Mrityu Pada (A8)', 'Perceived vulnerabilities'),
    9: ('Dharma Pada (A9)', 'Perceived fortune, guru image'),
    10: ('Rajya Pada (A10)', 'Perceived career, authority'),
    11: ('Labha Pada (A11)', 'Perceived gains, social network'),
    12: ('Vyaya Pada (A12)', 'Perceived losses, expenses pattern'),
}


def calculate_all_arudha_padas(planets: Dict, asc_rashi: int) -> Dict:
    """
    Calculate all 12 Arudha Padas.
    Formula: Count from house to its lord, then count same distance from lord.
    Exception: If result is 1st or 7th from house, move to 10th house from that.
    """
    padas = {}

    for house in range(1, 13):
        house_rashi = (asc_rashi + house - 1) % 12
        lord = RASHI_LORDS_MAP[house_rashi]
        lord_rashi = _planet_rashi(planets, lord)

        # Count from house rashi to lord rashi
        count = (lord_rashi - house_rashi) % 12

        # Count same from lord rashi
        pada_rashi = (lord_rashi + count) % 12

        # Exception rule: if pada falls in same house or 7th from it
        pada_house_from_original = (pada_rashi - house_rashi) % 12
        if pada_house_from_original == 0:
            pada_rashi = (house_rashi + 9) % 12  # 10th from house
        elif pada_house_from_original == 6:
            pada_rashi = (house_rashi + 3) % 12  # 4th from house

        pada_house = ((pada_rashi - asc_rashi) % 12) + 1
        name, meaning = ARUDHA_NAMES.get(house, (f'A{house}', ''))

        padas[f'A{house}'] = {
            'name': name,
            'rashi': RASHI_NAMES[pada_rashi],
            'rashi_index': pada_rashi,
            'house': pada_house,
            'lord': lord,
            'meaning': meaning,
        }

    return padas


# ═══════════════════════════════════════════════════════════════
# UPAPADA LAGNA
# ═══════════════════════════════════════════════════════════════

def calculate_upapada(planets: Dict, asc_rashi: int) -> Dict:
    """
    Upapada Lagna (UL) = Arudha of 12th house.
    This is the KEY spouse indicator in Jaimini.
    2nd from UL shows longevity of marriage.
    """
    padas = calculate_all_arudha_padas(planets, asc_rashi)
    ul = padas.get('A12', {})

    ul_rashi = ul.get('rashi_index', 0)
    ul_lord = RASHI_LORDS_MAP.get(ul_rashi, '')
    second_from_ul = (ul_rashi + 1) % 12
    second_lord = RASHI_LORDS_MAP.get(second_from_ul, '')

    # Planets in UL
    ul_house = ul.get('house', 12)
    occupants_ul = [n for n, d in planets.items() if d.get('house') == ul_house]

    return {
        'upapada_sign': ul.get('rashi', ''),
        'upapada_house': ul_house,
        'upapada_lord': ul_lord,
        'upapada_lord_house': _planet_house(planets, ul_lord),
        'occupants': occupants_ul,
        'second_from_ul': RASHI_NAMES[second_from_ul],
        'second_lord': second_lord,
        'second_lord_house': _planet_house(planets, second_lord),
        'spouse_indication': _interpret_upapada(ul_rashi, ul_lord, occupants_ul),
        'marriage_longevity': _interpret_second_from_ul(second_lord, planets),
    }


def _interpret_upapada(rashi: int, lord: str, occupants: list) -> str:
    element_map = {0: 'Fire', 1: 'Earth', 2: 'Air', 3: 'Water', 4: 'Fire', 5: 'Earth',
                   6: 'Air', 7: 'Water', 8: 'Fire', 9: 'Earth', 10: 'Air', 11: 'Water'}
    element = element_map.get(rashi, '')
    sign = RASHI_NAMES[rashi]
    parts = [f"Spouse indicated through {sign} ({element}) energy"]
    if 'Venus' in occupants:
        parts.append("Venus in UL: attractive, artistic spouse")
    if 'Jupiter' in occupants:
        parts.append("Jupiter in UL: wise, cultured spouse")
    if 'Saturn' in occupants:
        parts.append("Saturn in UL: mature, serious spouse, possible delay")
    if 'Mars' in occupants:
        parts.append("Mars in UL: passionate, assertive spouse")
    return ". ".join(parts)


def _interpret_second_from_ul(lord: str, planets: Dict) -> str:
    h = _planet_house(planets, lord)
    if h in [1, 4, 7, 10]:
        return f"2nd from UL lord {lord} in kendra H{h}: stable, long marriage"
    elif h in [6, 8, 12]:
        return f"2nd from UL lord {lord} in dusthana H{h}: marriage faces challenges"
    return f"2nd from UL lord {lord} in H{h}: moderate marital stability"


# ═══════════════════════════════════════════════════════════════
# SWAMSA (Atmakaraka in Navamsa)
# ═══════════════════════════════════════════════════════════════

def calculate_swamsa(planets: Dict, navamsa_planets: Dict = None) -> Dict:
    """
    Swamsa = sign where Atmakaraka sits in Navamsa.
    Reveals soul's true purpose and spiritual direction.
    """
    # Find Atmakaraka (planet with highest degree)
    ak = None
    max_deg = -1
    for name in ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']:
        deg = planets.get(name, {}).get('longitude', 0) % 30
        if deg > max_deg:
            max_deg = deg
            ak = name

    if not ak:
        return {}

    ak_navamsa_rashi = -1
    if navamsa_planets and ak in navamsa_planets:
        ak_navamsa_rashi = navamsa_planets[ak].get('rashi', -1)
    else:
        # Calculate navamsa sign from longitude
        ak_long = planets.get(ak, {}).get('longitude', 0)
        navamsa_num = int((ak_long % 30) / (30 / 9))
        rashi = int(ak_long / 30)
        ak_navamsa_rashi = (rashi * 9 + navamsa_num) % 12 if navamsa_num < 9 else rashi

    swamsa_purposes = {
        0: "Leadership, pioneering, independent path",
        1: "Wealth creation, beauty, sensual mastery",
        2: "Communication, writing, teaching",
        3: "Nurturing, emotional wisdom, motherhood",
        4: "Authority, governance, creative expression",
        5: "Service, healing, analytical mastery",
        6: "Partnerships, diplomacy, justice",
        7: "Occult research, transformation, mystery",
        8: "Philosophy, teaching, guru path",
        9: "Administration, discipline, corporate leadership",
        10: "Social reform, innovation, humanitarian work",
        11: "Spiritual surrender, mysticism, charity",
    }

    return {
        'atmakaraka': ak,
        'ak_degree': round(max_deg, 2),
        'swamsa_sign': RASHI_NAMES[ak_navamsa_rashi] if 0 <= ak_navamsa_rashi < 12 else 'Unknown',
        'soul_purpose': swamsa_purposes.get(ak_navamsa_rashi, ''),
    }


# ═══════════════════════════════════════════════════════════════
# JAIMINI RASHI ASPECTS
# ═══════════════════════════════════════════════════════════════

def get_jaimini_aspects() -> Dict:
    """
    Jaimini aspects are SIGN-based, not planet-based.
    Movable signs aspect Fixed signs (except adjacent).
    Fixed signs aspect Movable signs (except adjacent).
    Dual signs aspect other Dual signs.
    """
    movable = [0, 3, 6, 9]    # Ari, Can, Lib, Cap
    fixed = [1, 4, 7, 10]     # Tau, Leo, Sco, Aqu
    dual = [2, 5, 8, 11]      # Gem, Vir, Sag, Pis

    aspects = {}
    for r in range(12):
        aspected = []
        if r in movable:
            aspected = [f for f in fixed if abs(r - f) != 1 and abs(r - f) != 11]
        elif r in fixed:
            aspected = [m for m in movable if abs(r - m) != 1 and abs(r - m) != 11]
        elif r in dual:
            aspected = [d for d in dual if d != r]
        aspects[RASHI_NAMES[r]] = [RASHI_NAMES[a] for a in aspected]

    return aspects


# ═══════════════════════════════════════════════════════════════
# JAIMINI YOGAS
# ═══════════════════════════════════════════════════════════════

def check_jaimini_yogas(planets: Dict, asc_rashi: int) -> List[Dict]:
    """Jaimini-specific yogas based on karakas and padas."""
    yogas = []

    # Find karakas
    karakas = {}
    sorted_planets = sorted(
        [(n, planets[n].get('longitude', 0) % 30) for n in
         ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']],
        key=lambda x: -x[1]
    )
    karaka_names = ['Atmakaraka', 'Amatyakaraka', 'Bhratrikaraka', 'Matrikaraka',
                    'Putrakaraka', 'Gnatikaraka', 'Darakaraka']
    for i, (name, deg) in enumerate(sorted_planets):
        if i < len(karaka_names):
            karakas[karaka_names[i]] = name

    ak = karakas.get('Atmakaraka', '')
    amk = karakas.get('Amatyakaraka', '')
    dk = karakas.get('Darakaraka', '')

    # AK-AmK conjunction or mutual aspect → Raja Yoga
    if ak and amk:
        if _planet_house(planets, ak) == _planet_house(planets, amk):
            yogas.append({'name': 'Jaimini Raja Yoga (AK-AmK conjunct)',
                         'description': f'{ak} (soul) with {amk} (career) — destined for authority',
                         'planets': [ak, amk], 'strength': 'Strong'})

    # DK in kendra from AK → happy marriage
    if ak and dk:
        ak_h = _planet_house(planets, ak)
        dk_h = _planet_house(planets, dk)
        diff = abs(ak_h - dk_h) % 12
        if diff in [0, 3, 6, 9]:
            yogas.append({'name': 'Jaimini Marriage Yoga (DK kendra from AK)',
                         'description': f'{dk} (spouse) in kendra from {ak} (soul) — harmonious marriage',
                         'planets': [ak, dk], 'strength': 'Strong'})

    # AK in 1st or 5th or 9th → spiritually evolved soul
    if ak:
        ak_h = _planet_house(planets, ak)
        if ak_h in [1, 5, 9]:
            yogas.append({'name': 'Jaimini Spiritual Yoga',
                         'description': f'{ak} (Atmakaraka) in trikona H{ak_h} — evolved soul, dharmic life',
                         'planets': [ak], 'strength': 'Good'})

    return yogas


# ═══════════════════════════════════════════════════════════════
# PUBLIC API
# ═══════════════════════════════════════════════════════════════

def get_complete_jaimini(planets: Dict, asc_rashi: int, navamsa_planets: Dict = None) -> Dict:
    """Complete Jaimini analysis."""
    return {
        'arudha_padas': calculate_all_arudha_padas(planets, asc_rashi),
        'upapada': calculate_upapada(planets, asc_rashi),
        'swamsa': calculate_swamsa(planets, navamsa_planets),
        'jaimini_aspects': get_jaimini_aspects(),
        'jaimini_yogas': check_jaimini_yogas(planets, asc_rashi),
    }
