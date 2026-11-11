"""
KP ADVANCED — Sub-sub-sub lord, Full Stellar Theory, 30+ Events, Medical Diagnosis
"""

from typing import Dict
from ..core.constants import NAKSHATRA_LORDS

DASHA_SEQUENCE = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury']
VIMSHOTTARI_YEARS = {
    'Ketu': 7, 'Venus': 20, 'Sun': 6, 'Moon': 10, 'Mars': 7,
    'Rahu': 18, 'Jupiter': 16, 'Saturn': 19, 'Mercury': 17,
}
TOTAL_YEARS = 120

# ═══════════════════════════════════════════════════════════════
# SUB-SUB-SUB LORD (4th level)
# ═══════════════════════════════════════════════════════════════

def get_sub_sub_sub_lord(longitude: float) -> str:
    """Calculate 4th level sub-lord for extreme precision."""
    nak_span = 360.0 / 27

    # Level 1: Star lord
    nak_idx = int(longitude / nak_span) % 27
    pos_in_nak = longitude % nak_span

    # Level 2: Sub lord
    nak_lord = NAKSHATRA_LORDS[nak_idx]
    start_idx = DASHA_SEQUENCE.index(nak_lord)
    accumulated = 0.0
    sub_lord = nak_lord
    sub_span = nak_span
    sub_start = 0.0
    for i in range(9):
        planet = DASHA_SEQUENCE[(start_idx + i) % 9]
        span = nak_span * (VIMSHOTTARI_YEARS[planet] / TOTAL_YEARS)
        if accumulated + span > pos_in_nak:
            sub_lord = planet
            sub_span = span
            sub_start = accumulated
            break
        accumulated += span

    # Level 3: Sub-sub lord
    pos_in_sub = pos_in_nak - sub_start
    ss_start_idx = DASHA_SEQUENCE.index(sub_lord)
    accumulated = 0.0
    ss_lord = sub_lord
    ss_span = sub_span
    ss_start = 0.0
    for i in range(9):
        planet = DASHA_SEQUENCE[(ss_start_idx + i) % 9]
        span = sub_span * (VIMSHOTTARI_YEARS[planet] / TOTAL_YEARS)
        if accumulated + span > pos_in_sub:
            ss_lord = planet
            ss_span = span
            ss_start = accumulated
            break
        accumulated += span

    # Level 4: Sub-sub-sub lord
    pos_in_ss = pos_in_sub - ss_start
    sss_start_idx = DASHA_SEQUENCE.index(ss_lord)
    accumulated = 0.0
    for i in range(9):
        planet = DASHA_SEQUENCE[(sss_start_idx + i) % 9]
        span = ss_span * (VIMSHOTTARI_YEARS[planet] / TOTAL_YEARS)
        if accumulated + span > pos_in_ss:
            return planet
        accumulated += span
    return ss_lord


def get_four_level_chain(longitude: float) -> Dict:
    """Get complete 4-level chain: Star → Sub → Sub-sub → Sub-sub-sub."""
    nak_span = 360.0 / 27
    nak_idx = int(longitude / nak_span) % 27
    star_lord = NAKSHATRA_LORDS[nak_idx]

    # sublords.get_sub_lord returns a dict that already carries the sub-sub lord.
    # This imported a get_sub_sub_lord that sublords never defined, so the import
    # raised and the four-level chain — the whole of KP's finest precision — never
    # ran for anyone.
    from .sublords import get_sub_lord
    sl = get_sub_lord(longitude) or {}
    sub = sl.get('sub_lord') if isinstance(sl, dict) else sl
    sub_sub = sl.get('sub_sub_lord') if isinstance(sl, dict) else None
    sub_sub_sub = get_sub_sub_sub_lord(longitude)

    return {
        'star_lord': star_lord,
        'sub_lord': sub,
        'sub_sub_lord': sub_sub,
        'sub_sub_sub_lord': sub_sub_sub,
    }


# ═══════════════════════════════════════════════════════════════
# 30+ EVENT TYPES
# ═══════════════════════════════════════════════════════════════

KP_EVENTS_EXTENDED = {
    'marriage':         {'primary': 7, 'supporting': [2, 11], 'negating': [6, 12]},
    'love_affair':      {'primary': 5, 'supporting': [7, 11], 'negating': [6, 8]},
    'career_start':     {'primary': 10, 'supporting': [2, 6, 11], 'negating': [5, 8, 12]},
    'government_job':   {'primary': 10, 'supporting': [6, 9, 11], 'negating': [5, 8, 12]},
    'private_job':      {'primary': 10, 'supporting': [2, 6, 7], 'negating': [5, 8]},
    'own_business':     {'primary': 7, 'supporting': [2, 10, 11], 'negating': [6, 8, 12]},
    'promotion':        {'primary': 10, 'supporting': [2, 6, 11], 'negating': [5, 8]},
    'transfer':         {'primary': 3, 'supporting': [10, 12], 'negating': [4, 11]},
    'wealth_gain':      {'primary': 2, 'supporting': [6, 10, 11], 'negating': [5, 8, 12]},
    'childbirth':       {'primary': 5, 'supporting': [2, 11], 'negating': [4, 10]},
    'pregnancy':        {'primary': 5, 'supporting': [2, 11], 'negating': [1, 4]},
    'education':        {'primary': 4, 'supporting': [9, 11], 'negating': [3, 8]},
    'exam_success':     {'primary': 4, 'supporting': [9, 11], 'negating': [3, 8, 12]},
    'foreign_travel':   {'primary': 9, 'supporting': [3, 12], 'negating': [4, 11]},
    'foreign_settle':   {'primary': 12, 'supporting': [3, 9], 'negating': [4, 11]},
    'property_buy':     {'primary': 4, 'supporting': [11, 12], 'negating': [3, 5, 10]},
    'property_sell':    {'primary': 3, 'supporting': [5, 10], 'negating': [4, 11]},
    'vehicle':          {'primary': 4, 'supporting': [11], 'negating': [3, 12]},
    'court_win':        {'primary': 6, 'supporting': [1, 11], 'negating': [7, 12]},
    'court_loss':       {'primary': 12, 'supporting': [6, 8], 'negating': [1, 11]},
    'disease_onset':    {'primary': 6, 'supporting': [1, 8, 12], 'negating': [5, 11]},
    'recovery':         {'primary': 11, 'supporting': [1, 5], 'negating': [6, 8, 12]},
    'surgery':          {'primary': 8, 'supporting': [6, 12], 'negating': [1, 5, 11]},
    'debt_clearance':   {'primary': 11, 'supporting': [2, 6], 'negating': [8, 12]},
    'loan_approval':    {'primary': 6, 'supporting': [8, 12], 'negating': [5, 11]},
    'spiritual':        {'primary': 9, 'supporting': [5, 12], 'negating': [3, 6]},
    'lost_object':      {'primary': 2, 'supporting': [6, 11], 'negating': [8, 12]},
    'missing_person':   {'primary': 2, 'supporting': [6, 11], 'negating': [8, 12]},
    'imprisonment':     {'primary': 12, 'supporting': [6, 8], 'negating': [1, 11]},
    'release':          {'primary': 11, 'supporting': [1, 3], 'negating': [6, 8, 12]},
    'inheritance':      {'primary': 8, 'supporting': [2, 4], 'negating': [12]},
    'partnership':      {'primary': 7, 'supporting': [2, 11], 'negating': [6, 8]},
    'divorce':          {'primary': 6, 'supporting': [1, 12], 'negating': [2, 7, 11]},
}


# ═══════════════════════════════════════════════════════════════
# KP MEDICAL DIAGNOSIS
# ═══════════════════════════════════════════════════════════════

# House → Body part mapping (KP specific)
KP_BODY_PARTS = {
    1: "Head, brain, skull",
    2: "Face, right eye, teeth, throat",
    3: "Neck, shoulders, arms, right ear",
    4: "Chest, lungs, heart, breasts",
    5: "Stomach, upper abdomen, liver",
    6: "Lower abdomen, intestines, kidneys",
    7: "Lower back, bladder, reproductive",
    8: "Genitals, rectum, chronic diseases",
    9: "Hips, thighs, arteries",
    10: "Knees, bones, joints, skin",
    11: "Calves, ankles, left ear, circulation",
    12: "Feet, left eye, sleep disorders, hospitalization",
}

# Planet → Disease tendency
KP_PLANET_DISEASES = {
    'Sun': "Heart, eyes, bones, fever, blood pressure",
    'Moon': "Mental health, cold, cough, water retention, stomach",
    'Mars': "Blood disorders, surgery, burns, inflammation, accidents",
    'Mercury': "Nervous system, skin, speech, lungs, anxiety",
    'Jupiter': "Liver, diabetes, obesity, tumors, ear problems",
    'Venus': "Reproductive, kidneys, throat, diabetes, STDs",
    'Saturn': "Chronic diseases, bones, joints, depression, paralysis",
    'Rahu': "Mysterious diseases, poisoning, phobias, obsession",
    'Ketu': "Viral infections, skin diseases, surgery, spiritual crisis",
}


def kp_medical_diagnosis(engine) -> Dict:
    """
    KP Medical Analysis:
    6th CSL → type of disease
    8th CSL → severity and chronic nature
    12th CSL → hospitalization
    1st CSL → constitution
    """
    try:
        from .kp_complete import KPComplete
        kpc = KPComplete(engine)
        cusps = kpc.get_placidus_cusps()

        csl_6 = cusps.get(6, {}).get('sub_lord', '')
        csl_8 = cusps.get(8, {}).get('sub_lord', '')
        csl_12 = cusps.get(12, {}).get('sub_lord', '')
        csl_1 = cusps.get(1, {}).get('sub_lord', '')

        # Body part vulnerable
        csl_6_data = engine.planets.get(csl_6, {})
        csl_6_house = csl_6_data.get('house', 6)

        return {
            'constitution': f"1st CSL {csl_1}: {KP_PLANET_DISEASES.get(csl_1, '')}",
            'disease_tendency': f"6th CSL {csl_6}: {KP_PLANET_DISEASES.get(csl_6, '')}",
            'vulnerable_area': KP_BODY_PARTS.get(csl_6_house, ''),
            'chronic_risk': f"8th CSL {csl_8}: {KP_PLANET_DISEASES.get(csl_8, '')}",
            'hospitalization': f"12th CSL {csl_12}: {'risk present' if csl_12 in ['Saturn', 'Rahu', 'Ketu'] else 'low risk'}",
            'body_part_map': KP_BODY_PARTS,
        }
    except Exception:
        return {}


# ═══════════════════════════════════════════════════════════════
# FULL STELLAR THEORY
# ═══════════════════════════════════════════════════════════════

def stellar_theory_analysis(engine) -> Dict:
    """
    KP Stellar Theory: A planet in the star of X BEHAVES as X.
    It delivers the results of X's signified houses, not its own.
    The sub-lord then decides whether the delivery is positive or negative.
    """
    planets = engine.planets
    results = {}

    for name in ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu']:
        p = planets.get(name, {})
        p_long = p.get('longitude', 0)
        nak_idx = int(p_long / (360 / 27)) % 27
        star_lord = NAKSHATRA_LORDS[nak_idx]

        star_lord_data = planets.get(star_lord, {})
        star_lord_house = star_lord_data.get('house', 0)

        results[name] = {
            'planet': name,
            'house': p.get('house', 0),
            'star_lord': star_lord,
            'star_lord_house': star_lord_house,
            'behavior': f"{name} behaves as {star_lord} (H{star_lord_house})",
            'delivery': f"Delivers results of H{star_lord_house} matters",
        }

    return results
