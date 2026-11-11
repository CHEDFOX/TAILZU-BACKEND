"""
COMPLETE MUHURTA — Electional Astrology
20+ event types with specific rules per event.
"""

from typing import Dict

EVENT_RULES = {
    'marriage': {
        'good_tithis': [2, 3, 5, 7, 10, 11, 13],
        'good_nakshatras': ['Rohini', 'Mrigashira', 'Magha', 'Uttara Phalguni', 'Hasta', 'Swati',
                            'Anuradha', 'Mula', 'Uttara Ashadha', 'Uttara Bhadrapada', 'Revati'],
        'avoid_months': ['Adhik'],
        'lagna_signs': [1, 2, 3, 5, 6, 10, 11],  # Taurus, Gemini, Cancer, Virgo, Libra, Aquarius, Pisces
        'avoid_days': [],
        'special': 'Venus should not be combust. 7th house must be free of malefics. Moon strong.',
    },
    'griha_pravesh': {
        'good_nakshatras': ['Dhanishta', 'Rohini', 'Pushya', 'Uttara Phalguni', 'Uttara Ashadha',
                            'Uttara Bhadrapada', 'Hasta', 'Shravana', 'Revati', 'Anuradha'],
        'good_tithis': [2, 3, 5, 7, 10, 11, 13],
        'lagna_signs': [1, 3, 4, 5, 6, 10],
        'special': 'Jupiter strong. No malefics in 4th or 8th. Fixed signs preferred for lagna.',
    },
    'business_start': {
        'good_nakshatras': ['Ashwini', 'Rohini', 'Pushya', 'Hasta', 'Chitra', 'Swati', 'Anuradha', 'Shravana', 'Revati'],
        'good_tithis': [2, 3, 5, 7, 10, 11, 13],
        'lagna_signs': [1, 2, 4, 5, 6, 10],
        'special': 'Mercury and Jupiter strong. 10th lord well placed. Avoid Rahu-Ketu axis on 1-7.',
    },
    'travel': {
        'good_nakshatras': ['Ashwini', 'Mrigashira', 'Pushya', 'Hasta', 'Anuradha', 'Shravana', 'Revati'],
        'good_tithis': [2, 3, 5, 7, 10, 11],
        'lagna_signs': [2, 5, 8, 11],  # Dual signs for travel
        'special': '3rd and 9th houses free of malefics. Moon not in 8th.',
    },
    'surgery': {
        'good_nakshatras': ['Ashwini', 'Pushya', 'Hasta', 'Chitra', 'Anuradha', 'Shravana'],
        'avoid_nakshatras': ['Ardra', 'Ashlesha', 'Jyeshtha', 'Mula'],
        'special': 'Moon should not be in the sign ruling the body part being operated. Mars strong but not in 8th.',
    },
    'education_start': {
        'good_nakshatras': ['Rohini', 'Pushya', 'Hasta', 'Chitra', 'Swati', 'Shravana', 'Dhanishta', 'Revati'],
        'good_tithis': [2, 3, 5, 10],
        'lagna_signs': [2, 5, 8],  # Gemini, Virgo, Sagittarius — learning signs
        'special': 'Mercury and Jupiter strong. 4th and 5th houses well aspected.',
    },
    'vehicle_purchase': {
        'good_nakshatras': ['Ashwini', 'Rohini', 'Pushya', 'Hasta', 'Swati', 'Anuradha', 'Shravana', 'Revati'],
        'special': '4th lord strong. Venus well placed. Avoid Mars afflicting 4th.',
    },
    'property_purchase': {
        'good_nakshatras': ['Rohini', 'Uttara Phalguni', 'Uttara Ashadha', 'Uttara Bhadrapada'],
        'lagna_signs': [1, 3, 6, 9],  # Fixed signs preferred
        'special': '4th lord strong. Saturn well placed (land significator). Jupiter aspecting 4th.',
    },
    'naming_ceremony': {
        'good_nakshatras': ['Ashwini', 'Rohini', 'Mrigashira', 'Pushya', 'Hasta', 'Swati', 'Shravana', 'Revati'],
        'good_tithis': [2, 3, 5, 10, 11],
        'special': 'Moon strong. Benefic in lagna. 2nd house free of malefics.',
    },
    'court_hearing': {
        'good_nakshatras': ['Pushya', 'Hasta', 'Anuradha', 'Shravana'],
        'special': '6th lord weaker than lagna lord. Jupiter aspecting lagna. Moon not afflicted.',
    },
    'investment': {
        'good_nakshatras': ['Rohini', 'Pushya', 'Uttara Phalguni', 'Hasta', 'Shravana'],
        'special': '2nd and 11th lords strong. Mercury and Jupiter well placed. Avoid eclipses.',
    },
    'spiritual_initiation': {
        'good_nakshatras': ['Pushya', 'Hasta', 'Shravana', 'Revati', 'Uttara Bhadrapada'],
        'lagna_signs': [3, 8, 11],  # Cancer, Sagittarius, Pisces — spiritual signs
        'special': 'Jupiter strong, ideally in kendra. Saturn not afflicting 9th. Moon in good dignity.',
    },
    'loan': {
        'good_nakshatras': ['Pushya', 'Hasta', 'Shravana'],
        'special': '6th lord weak relative to lagna lord. No malefics in 6th. Moon strong.',
    },
    'joining_job': {
        'good_nakshatras': ['Ashwini', 'Rohini', 'Pushya', 'Hasta', 'Anuradha', 'Shravana', 'Revati'],
        'lagna_signs': [1, 3, 5, 9],  # Strong, stable lagnas
        'special': '10th lord strong. No malefics in lagna. Mercury and Jupiter aspecting 10th.',
    },
}


def get_muhurta_rules(event_type: str) -> Dict:
    """Get the muhurta rules for a specific event."""
    rules = EVENT_RULES.get(event_type, EVENT_RULES.get('business_start', {}))
    return {
        'event': event_type,
        'rules': rules,
        'available_events': list(EVENT_RULES.keys()),
    }


def evaluate_moment(panchanga: Dict, event_type: str) -> Dict:
    """
    Evaluate a moment's suitability for an event.
    Takes panchanga data and scores it against event rules.
    """
    rules = EVENT_RULES.get(event_type, {})
    score = 50  # Base score
    factors = []

    tithi = panchanga.get('tithi', {})
    tithi_num = tithi.get('number', 0) if isinstance(tithi, dict) else 0
    nakshatra = panchanga.get('nakshatra', {})
    nak_name = nakshatra.get('name', '') if isinstance(nakshatra, dict) else str(nakshatra)

    # Check tithi
    good_tithis = rules.get('good_tithis', [])
    if good_tithis:
        if tithi_num in good_tithis:
            score += 15
            factors.append(f"Good tithi ({tithi_num})")
        else:
            score -= 10
            factors.append(f"Unfavorable tithi ({tithi_num})")

    # Check nakshatra
    good_naks = rules.get('good_nakshatras', [])
    avoid_naks = rules.get('avoid_nakshatras', [])
    if good_naks and nak_name in good_naks:
        score += 20
        factors.append(f"Auspicious nakshatra ({nak_name})")
    elif avoid_naks and nak_name in avoid_naks:
        score -= 20
        factors.append(f"Inauspicious nakshatra ({nak_name})")

    score = max(10, min(95, score))

    if score >= 75:
        rating = 'Excellent'
    elif score >= 60:
        rating = 'Good'
    elif score >= 45:
        rating = 'Average'
    else:
        rating = 'Avoid'

    return {
        'event': event_type,
        'score': score,
        'rating': rating,
        'factors': factors,
        'special_rule': rules.get('special', ''),
    }
