"""
WESTERN HELLENISTIC TECHNIQUES
The revival techniques reshaping modern Western astrology:
Profections, Zodiacal Releasing, Sect, Arabic Parts, Bounds, Antiscia.
"""

from datetime import datetime
from typing import Dict
from .chart import SIGNS, SIGN_ELEMENTS, TRADITIONAL_RULERS

# ═══════════════════════════════════════════════════════════════
# ANNUAL PROFECTIONS
# ═══════════════════════════════════════════════════════════════

def calculate_profections(birth_dt: datetime, target_date: datetime = None) -> Dict:
    """
    Annual Profections: each year of life activates the next house.
    Age 0 = H1, Age 1 = H2, ... Age 12 = H1 again.
    The activated house's ruler becomes the "Lord of the Year."
    """
    now = target_date or datetime.utcnow()
    age = now.year - birth_dt.year
    if (now.month, now.day) < (birth_dt.month, birth_dt.day):
        age -= 1

    profected_house = (age % 12) + 1

    return {
        'age': age,
        'profected_house': profected_house,
        'description': f'Age {age}: House {profected_house} activated',
        'theme': _profection_theme(profected_house),
    }


def calculate_profections_with_chart(birth_dt: datetime, asc_sign_idx: int,
                                       target_date: datetime = None) -> Dict:
    """Profections with natal chart data for complete interpretation."""
    now = target_date or datetime.utcnow()
    age = now.year - birth_dt.year
    if (now.month, now.day) < (birth_dt.month, birth_dt.day):
        age -= 1

    profected_house = (age % 12) + 1
    profected_sign_idx = (asc_sign_idx + profected_house - 1) % 12
    profected_sign = SIGNS[profected_sign_idx]
    time_lord = TRADITIONAL_RULERS.get(profected_sign, '')

    return {
        'age': age,
        'profected_house': profected_house,
        'profected_sign': profected_sign,
        'time_lord': time_lord,
        'time_lord_meaning': f'{time_lord} is your Lord of the Year — all {time_lord} transits are amplified',
        'theme': _profection_theme(profected_house),
        'element': SIGN_ELEMENTS.get(profected_sign, ''),
    }


def _profection_theme(house: int) -> str:
    themes = {
        1: "Self, identity, new beginnings, body, appearance",
        2: "Money, possessions, values, self-worth",
        3: "Communication, siblings, short travel, learning",
        4: "Home, family, roots, inner foundation",
        5: "Creativity, romance, children, joy, risk",
        6: "Health, daily work, service, habits, pets",
        7: "Partnerships, marriage, contracts, open conflict",
        8: "Transformation, shared resources, death/rebirth, psychology",
        9: "Travel, higher education, philosophy, beliefs, publishing",
        10: "Career, public reputation, authority, achievement",
        11: "Friends, community, hopes, social causes, networks",
        12: "Solitude, spirituality, hidden enemies, karma, endings",
    }
    return themes.get(house, '')


# ═══════════════════════════════════════════════════════════════
# SECT (Day/Night Chart)
# ═══════════════════════════════════════════════════════════════

def calculate_sect(sun_house: int, planets: Dict) -> Dict:
    """
    Sect: Day chart (Sun above horizon) vs Night chart (Sun below).
    Day charts: Sun, Jupiter, Saturn are the favored team.
    Night charts: Moon, Venus, Mars are the favored team.
    The sect benefic is your greatest ally; sect malefic is your challenge.
    """
    is_day = sun_house <= 6  # Houses 1-6 = above horizon

    if is_day:
        benefic_of_sect = 'Jupiter'
        malefic_of_sect = 'Saturn'
        benefic_contrary = 'Venus'
        malefic_contrary = 'Mars'
        luminary = 'Sun'
    else:
        benefic_of_sect = 'Venus'
        malefic_of_sect = 'Mars'
        benefic_contrary = 'Jupiter'
        malefic_contrary = 'Saturn'
        luminary = 'Moon'

    return {
        'is_day_chart': is_day,
        'chart_type': 'Day Chart' if is_day else 'Night Chart',
        'luminary': luminary,
        'benefic_of_sect': {
            'planet': benefic_of_sect,
            'role': 'Greatest ally — most helpful planet in your chart',
            'house': planets.get(benefic_of_sect, {}).get('house', 0),
        },
        'malefic_of_sect': {
            'planet': malefic_of_sect,
            'role': 'Managed challenge — difficulty you can work with',
            'house': planets.get(malefic_of_sect, {}).get('house', 0),
        },
        'benefic_contrary': {
            'planet': benefic_contrary,
            'role': 'Secondary benefic — helpful but less aligned',
            'house': planets.get(benefic_contrary, {}).get('house', 0),
        },
        'malefic_contrary': {
            'planet': malefic_contrary,
            'role': 'Most difficult planet — hardest lessons come through this',
            'house': planets.get(malefic_contrary, {}).get('house', 0),
        },
    }


# ═══════════════════════════════════════════════════════════════
# ARABIC PARTS (LOTS)
# ═══════════════════════════════════════════════════════════════

def calculate_arabic_parts(asc: float, planets: Dict, is_night: bool = False) -> Dict:
    """
    Arabic Parts (Lots) — sensitive points calculated from 3 chart factors.
    Day formula: ASC + Planet1 - Planet2
    Night formula: ASC + Planet2 - Planet1 (reversed)
    """
    sun = planets.get('Sun', {}).get('longitude', 0)
    moon = planets.get('Moon', {}).get('longitude', 0)
    mars = planets.get('Mars', {}).get('longitude', 0)
    venus = planets.get('Venus', {}).get('longitude', 0)
    jupiter = planets.get('Jupiter', {}).get('longitude', 0)
    saturn = planets.get('Saturn', {}).get('longitude', 0)
    mercury = planets.get('Mercury', {}).get('longitude', 0)

    def _calc(a, b, reverse_night=True):
        if is_night and reverse_night:
            return (asc + b - a) % 360
        return (asc + a - b) % 360

    def _sign(lon):
        return SIGNS[int(lon / 30) % 12]

    parts = {}
    definitions = [
        ('Fortune', moon, sun, 'Material fortune, body, livelihood'),
        ('Spirit', sun, moon, 'Mind, soul, intellect, purpose'),
        ('Eros', venus, mars, 'Desire, passion, what you crave'),
        ('Necessity', mercury, mars, 'Hardship, struggle, compulsion'),
        ('Courage', mars, moon, 'Boldness, daring, physical bravery'),
        ('Victory', jupiter, mars, 'Success in competition, triumph'),
        ('Nemesis', saturn, mars, 'Enemies, hidden opposition, downfall risk'),
        ('Marriage', venus, saturn, 'Marriage, committed partnerships'),
        ('Children', jupiter, saturn, 'Children, fertility, legacy'),
        ('Father', sun, saturn, 'Father, authority figures, inheritance'),
        ('Mother', moon, venus, 'Mother, nurturing, emotional bonds'),
        ('Siblings', mercury, jupiter, 'Siblings, peers, close allies'),
        ('Career', saturn, moon, 'Career, public standing, ambition'),
        ('Death', saturn, moon, 'Mortality, endings, transformation'),
        ('Illness', mars, saturn, 'Disease, health vulnerabilities'),
        ('Travel', mercury, moon, 'Journeys, movement, relocation'),
        ('Friends', moon, mercury, 'Friendships, alliances, networks'),
        ('Commerce', mercury, venus, 'Trade, business, transactions'),
        ('Faith', sun, moon, 'Beliefs, religion, spirituality'),
        ('Basis', sun, jupiter, 'Foundation, what you build upon'),
    ]

    for name, a, b, meaning in definitions:
        lon = _calc(a, b)
        parts[name] = {
            'longitude': round(lon, 2),
            'sign': _sign(lon),
            'degree': round(lon % 30, 2),
            'meaning': meaning,
        }

    return parts


# ═══════════════════════════════════════════════════════════════
# ANTISCIA & CONTRA-ANTISCIA
# ═══════════════════════════════════════════════════════════════

def calculate_antiscia(planets: Dict) -> Dict:
    """
    Antiscia: mirror point across Cancer-Capricorn axis (0°/360°).
    Contra-antiscia: mirror across Aries-Libra axis (90°/270°).
    If one planet's antiscion conjuncts another planet, there's a hidden connection.
    """
    results = {'antiscia': {}, 'contra_antiscia': {}, 'hidden_connections': []}

    for name, data in planets.items():
        lon = data.get('longitude', 0)
        # Antiscion = mirror across 0 Cancer / 0 Capricorn (lon 90°/270°)
        anti = (360 - lon + 180) % 360  # Simplified: 180° - longitude reflected
        contra = (360 - lon) % 360

        results['antiscia'][name] = {
            'original': round(lon, 2),
            'antiscion': round(anti, 2),
            'antiscion_sign': SIGNS[int(anti / 30) % 12],
        }
        results['contra_antiscia'][name] = {
            'contra': round(contra, 2),
            'contra_sign': SIGNS[int(contra / 30) % 12],
        }

    # Check for connections (antiscion of one conjuncts another)
    planet_names = list(planets.keys())
    for i, p1 in enumerate(planet_names):
        anti1 = results['antiscia'][p1]['antiscion']
        for p2 in planet_names[i+1:]:
            lon2 = planets[p2].get('longitude', 0)
            diff = abs(anti1 - lon2)
            if diff > 180:
                diff = 360 - diff
            if diff <= 3.0:
                results['hidden_connections'].append({
                    'planet1': p1, 'planet2': p2,
                    'type': 'Antiscia conjunction',
                    'orb': round(diff, 2),
                    'meaning': f'{p1} and {p2} share a hidden sympathetic connection',
                })

    return results


# ═══════════════════════════════════════════════════════════════
# ZODIACAL RELEASING (simplified)
# ═══════════════════════════════════════════════════════════════

ZR_PERIODS = {
    'Aries': 15, 'Taurus': 8, 'Gemini': 20, 'Cancer': 25,
    'Leo': 19, 'Virgo': 20, 'Libra': 8, 'Scorpio': 15,
    'Sagittarius': 12, 'Capricorn': 27, 'Aquarius': 30, 'Pisces': 12,
}


def calculate_zodiacal_releasing(lot_sign: str, birth_dt: datetime,
                                   target_date: datetime = None) -> Dict:
    """
    Zodiacal Releasing from Lot of Fortune or Spirit.
    Level 1 periods run through signs from the Lot's sign.
    Period lengths are from Hellenistic tradition (Valens).
    """
    now = target_date or datetime.utcnow()
    start_idx = SIGNS.index(lot_sign) if lot_sign in SIGNS else 0
    age_years = (now - birth_dt).days / 365.25

    # Walk through Level 1 periods
    accumulated = 0
    current_period = None
    periods = []
    for i in range(24):  # 2 full cycles
        sign_idx = (start_idx + i) % 12
        sign = SIGNS[sign_idx]
        length = ZR_PERIODS[sign]
        period = {
            'sign': sign, 'start_age': round(accumulated, 1),
            'end_age': round(accumulated + length, 1),
            'length_years': length,
        }
        if accumulated <= age_years < accumulated + length:
            current_period = period
            current_period['is_current'] = True
            # Peak period check (angular signs from lot = peak)
            dist = (sign_idx - start_idx) % 12
            if dist in [0, 3, 6, 9]:
                current_period['peak'] = True
                current_period['peak_note'] = 'Angular from Lot — peak period of activation'
            else:
                current_period['peak'] = False
        periods.append(period)
        accumulated += length
        if accumulated > age_years + 60:
            break

    return {
        'lot_sign': lot_sign,
        'current_period': current_period,
        'periods': periods[:12],
        'system': 'Zodiacal Releasing (Valens)',
    }


# ═══════════════════════════════════════════════════════════════
# WESTERN HORARY (Lilly's Method — Simplified)
# ═══════════════════════════════════════════════════════════════

def western_horary_judgment(question_chart: Dict, question: str, category: str = "general") -> Dict:
    """
    Western Horary: chart cast at moment of question.
    Uses traditional rulerships, receptions, and house assignments.
    """
    querent_house = 1
    quesited_house = {
        'marriage': 7, 'career': 10, 'money': 2, 'health': 6,
        'travel': 9, 'property': 4, 'children': 5, 'enemy': 7,
        'lost_item': 2, 'general': 1,
    }.get(category, 1)

    planets = question_chart.get('planets', {})
    asc_sign = question_chart.get('big_three', {}).get('rising_sign', 'Aries')
    moon = planets.get('Moon', {})

    querent_ruler = TRADITIONAL_RULERS.get(asc_sign, 'Mars')
    quesited_sign_idx = (SIGNS.index(asc_sign) + quesited_house - 1) % 12
    quesited_sign = SIGNS[quesited_sign_idx]
    quesited_ruler = TRADITIONAL_RULERS.get(quesited_sign, '')

    # Simplified judgment
    querent_h = planets.get(querent_ruler, {}).get('house', 1)
    quesited_h = planets.get(quesited_ruler, {}).get('house', 1)

    # Moon applying to quesited ruler?
    moon_applying = False
    moon_long = moon.get('longitude', 0)
    q_long = planets.get(quesited_ruler, {}).get('longitude', 0)
    diff = abs(moon_long - q_long)
    if diff > 180:
        diff = 360 - diff
    if diff < 15 and moon.get('speed', 0) > 0:
        moon_applying = True

    # Verdict
    factors_yes = []
    factors_no = []

    if moon_applying:
        factors_yes.append(f"Moon applying to {quesited_ruler}")
    if querent_h == quesited_house:
        factors_yes.append(f"Querent ruler {querent_ruler} in quesited house {quesited_house}")
    if quesited_h == querent_house:
        factors_yes.append(f"Quesited ruler {quesited_ruler} in querent house")
    if moon.get('sign', '') in ['Scorpio']:
        factors_no.append("Moon in Via Combusta")
    if planets.get('Saturn', {}).get('house', 0) in [1, 7]:
        factors_no.append("Saturn afflicting question axis")

    if len(factors_yes) > len(factors_no):
        verdict = "YES — factors favor the outcome"
    elif len(factors_no) > len(factors_yes):
        verdict = "NO — significant obstacles"
    else:
        verdict = "UNCERTAIN — mixed indicators"

    return {
        'system': 'Western Horary (Lilly)',
        'querent_ruler': querent_ruler,
        'quesited_ruler': quesited_ruler,
        'quesited_house': quesited_house,
        'moon_applying': moon_applying,
        'factors_yes': factors_yes,
        'factors_no': factors_no,
        'verdict': verdict,
    }
