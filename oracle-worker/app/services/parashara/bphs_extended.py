"""
BPHS EXTENDED — Divisional Interpretations, D60 Names, Mrityu Bhaga, Bhrigu Bindu
"""
from typing import Dict, List
from ..core.constants import RASHI_NAMES, RASHI_LORDS

# ═══════════════════════════════════════════════════════════════
# D60 SHASHTIAMSA — 60 Names with Past-Life Meanings
# ═══════════════════════════════════════════════════════════════
D60_DIVISIONS = [
    ("Ghora", "Terrible", "Past life of violence or cruelty — karmic debt through suffering"),
    ("Rakshasa", "Demon", "Past life of exploitation — must serve others now"),
    ("Deva", "Divine", "Past life of devotion — blessed with spiritual inclination"),
    ("Kubera", "Wealthy", "Past life of generosity — born into comfort"),
    ("Yaksha", "Nature spirit", "Past life connected to nature — healing abilities"),
    ("Kinnara", "Celestial musician", "Past life of art — creative gifts carried forward"),
    ("Bhrashta", "Fallen", "Past life of broken vows — trust issues in this life"),
    ("Kulaghna", "Family destroyer", "Past karmic family conflicts — must heal lineage"),
    ("Garala", "Poison", "Past life of deception — must cultivate honesty"),
    ("Agni", "Fire", "Past life of passion — intense drive, transformative power"),
    ("Maya", "Illusion", "Past life of spiritual seeking — sees through appearances"),
    ("Purishaka", "Generous", "Past life of giving — receives help from unexpected sources"),
    ("Apampathi", "Water lord", "Past life near water — emotional depth, intuition"),
    ("Marut", "Wind god", "Past life of movement — restless but adaptable"),
    ("Kaala", "Time/Death", "Past life of endings — understands impermanence deeply"),
    ("Sarpa", "Serpent", "Past life of kundalini/hidden knowledge — occult abilities"),
    ("Amrita", "Nectar", "Past life of healing — natural healer, longevity"),
    ("Indu", "Moon", "Past life of nurturing — emotional intelligence, empathy"),
    ("Mridu", "Soft", "Past life of gentleness — artistic, sensitive nature"),
    ("Komala", "Tender", "Past life of beauty — attractive, refined sensibilities"),
    ("Heramba", "Protector", "Past life of guardianship — protective, responsible"),
    ("Brahma", "Creator", "Past life of knowledge — intellectual gifts, teaching"),
    ("Vishnu", "Preserver", "Past life of sustaining — stability, steady growth"),
    ("Maheshwara", "Destroyer/Transformer", "Past life of transformation — spiritual power"),
    ("Deva", "Divine", "Blessed past — smooth path in areas this D60 touches"),
    ("Ardra", "Moist/Fresh", "Past life of renewal — ability to start fresh"),
    ("Kalinasha", "Destroyer of Kali", "Past life warrior for dharma — courage under pressure"),
    ("Kshitipala", "Earth protector", "Past life of land/property — real estate karma"),
    ("Kamalakara", "Lotus maker", "Past life of beauty creation — artistic mastery"),
    ("Gulika", "Son of Saturn", "Past life of restriction — must earn everything"),
    ("Mrithyu", "Death", "Past life ended abruptly — fear of loss, resilience"),
    ("Kaala", "Time", "Past life of patience — delayed but certain results"),
    ("Davagni", "Forest fire", "Past life of destruction — transformative experiences"),
    ("Ghora", "Terrible", "Heavy past karma — life of purification"),
    ("Yama", "Lord of Death", "Past life of judgment — strong sense of justice"),
    ("Kantaka", "Thorn", "Past life of obstacles — develops perseverance"),
    ("Sudha", "Nectar", "Past life of purity — spiritual gifts"),
    ("Amrita", "Immortal", "Past life of spiritual achievement — protected"),
    ("Purnachandra", "Full Moon", "Past life of completion — born with wholeness"),
    ("Vishada", "Bright", "Past life of clarity — intellectual brilliance"),
    ("Kulapreeta", "Family joy", "Past life of family devotion — blessed family life"),
    ("Vamshakshaya", "Lineage end", "Past life of family ending — must build new"),
    ("Utpata", "Calamity", "Past life of disaster — survival instincts strong"),
    ("Kaala", "Time", "Past karma of waiting — patience rewarded"),
    ("Saumya", "Gentle", "Past life of peace — harmonious disposition"),
    ("Komala", "Soft", "Past life of refinement — aesthetic sensibility"),
    ("Sheetala", "Cool", "Past life of calm — emotional stability"),
    ("Karala", "Fierce", "Past life of intensity — powerful personality"),
    ("Dandayudha", "Staff weapon", "Past life of authority — leadership ability"),
    ("Nirmala", "Pure", "Past life of virtue — clean conscience"),
    ("Saumya", "Auspicious", "Past life of good deeds — fortunate circumstances"),
    ("Kroora", "Cruel", "Past life of harshness — learning compassion"),
    ("Atisheetala", "Very cool", "Past life of detachment — spiritual objectivity"),
    ("Amrita", "Nectar", "Blessed past — longevity and health"),
    ("Payodhi", "Ocean", "Past life of depth — vast inner world"),
    ("Brahma", "Creator", "Past life of creation — manifesting ability"),
    ("Chandrarekha", "Moon ray", "Past life of beauty — charisma and grace"),
    ("Vayu", "Wind", "Past life of freedom — independence, travel"),
    ("Dhanada", "Wealth giver", "Past life of prosperity — financial blessings"),
    ("Pinakin", "Shiva's bow", "Past life of spiritual warrior — protective power"),
]

def get_d60_interpretation(longitude: float) -> Dict:
    """Get D60 Shashtiamsa name and past-life meaning."""
    d60_idx = int((longitude % 30) / 0.5) % 60
    if d60_idx < len(D60_DIVISIONS):
        name, meaning, karma = D60_DIVISIONS[d60_idx]
    else:
        name, meaning, karma = "Unknown", "", ""
    return {'division': d60_idx + 1, 'name': name, 'meaning': meaning, 'past_life': karma}

def get_all_d60(planets: Dict) -> Dict:
    """Get D60 for all planets."""
    result = {}
    for name in ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']:
        lon = planets.get(name, {}).get('longitude', 0)
        result[name] = get_d60_interpretation(lon)
    return result

# ═══════════════════════════════════════════════════════════════
# REMAINING DIVISIONAL INTERPRETATIONS (D2, D16, D20, D27, D30, D40, D45)
# ═══════════════════════════════════════════════════════════════
VARGA_THEMES = {
    'D2':  {'name': 'Hora', 'theme': 'Wealth & Sustenance', 'houses': [2, 11], 'key_planets': ['Jupiter', 'Venus', 'Moon']},
    'D16': {'name': 'Shodasamsa', 'theme': 'Vehicles, Comforts & Luxuries', 'houses': [4], 'key_planets': ['Venus', 'Moon', 'Jupiter']},
    'D20': {'name': 'Vimsamsa', 'theme': 'Spiritual Progress & Upasana', 'houses': [5, 9, 12], 'key_planets': ['Jupiter', 'Saturn', 'Ketu']},
    'D27': {'name': 'Bhamsa', 'theme': 'Physical Strength & Stamina', 'houses': [1, 6], 'key_planets': ['Mars', 'Sun', 'Saturn']},
    'D30': {'name': 'Trimsamsa', 'theme': 'Evils, Misfortune & Downfall', 'houses': [6, 8, 12], 'key_planets': ['Saturn', 'Mars', 'Rahu']},
    'D40': {'name': 'Khavedamsa', 'theme': 'Paternal Legacy & Auspiciousness', 'houses': [9, 10], 'key_planets': ['Sun', 'Jupiter']},
    'D45': {'name': 'Akshavedamsa', 'theme': 'Maternal Legacy & General Fortune', 'houses': [4], 'key_planets': ['Moon', 'Venus']},
}

def interpret_divisional(engine, division: str) -> Dict:
    """Interpret a divisional chart beyond planet positions."""
    from ..charts.divisional_charts import DivisionalCharts
    theme = VARGA_THEMES.get(division, {})
    div_num = int(division[1:])
    
    varga_planets = DivisionalCharts.generate_divisional_chart(engine.planets, div_num)
    asc_rashi = engine.ascendant_rashi
    
    key_findings = []
    for planet in theme.get('key_planets', []):
        vp = varga_planets.get(planet, {})
        v_rashi = vp.get('rashi', 0) if isinstance(vp, dict) else vp
        v_house = ((v_rashi - asc_rashi) % 12) + 1 if isinstance(v_rashi, int) else 1
        
        dignity = 'strong' if v_rashi in [engine.planets.get(planet, {}).get('rashi', -1)] else 'placed'
        key_findings.append(f"{planet} in {RASHI_NAMES[v_rashi % 12] if isinstance(v_rashi, int) else '?'} (H{v_house})")
    
    return {
        'chart': division, 'name': theme.get('name', ''), 'theme': theme.get('theme', ''),
        'key_planets': key_findings, 'relevant_houses': theme.get('houses', []),
    }

def interpret_all_remaining_vargas(engine) -> Dict:
    """Interpret D2, D16, D20, D27, D30, D40, D45, D60."""
    result = {}
    for div in ['D2', 'D16', 'D20', 'D27', 'D30', 'D40', 'D45']:
        result[div] = interpret_divisional(engine, div)
    result['D60'] = {'chart': 'D60', 'name': 'Shashtiamsa', 'theme': 'Past Life Karma',
                      'planets': get_all_d60(engine.planets)}
    return result

# ═══════════════════════════════════════════════════════════════
# MRITYU BHAGA — Death Degrees
# ═══════════════════════════════════════════════════════════════
MRITYU_BHAGA_DEGREES = {
    'Sun':     [20, 9, 12, 6, 8, 24, 16, 17, 22, 2, 3, 23],
    'Moon':    [26, 12, 13, 25, 24, 11, 26, 14, 13, 25, 5, 12],
    'Mars':    [19, 28, 25, 23, 29, 28, 14, 21, 2, 15, 11, 6],
    'Mercury': [15, 14, 13, 12, 8, 18, 20, 10, 21, 22, 7, 5],
    'Jupiter': [19, 29, 12, 27, 6, 4, 13, 10, 17, 11, 15, 28],
    'Venus':   [28, 15, 11, 17, 10, 13, 4, 6, 27, 12, 29, 19],
    'Saturn':  [10, 4, 7, 9, 12, 16, 3, 18, 28, 14, 13, 15],
}

def check_mrityu_bhaga(planets: Dict) -> List[Dict]:
    """Check if any planet is at its Mrityu Bhaga (death degree)."""
    results = []
    for planet, degrees in MRITYU_BHAGA_DEGREES.items():
        p = planets.get(planet, {})
        rashi = p.get('rashi', 0)
        deg = p.get('longitude', 0) % 30
        mb_deg = degrees[rashi] if rashi < 12 else 15
        diff = abs(deg - mb_deg)
        if diff <= 1.0:
            results.append({
                'planet': planet, 'degree': round(deg, 1), 'mrityu_bhaga': mb_deg,
                'distance': round(diff, 2), 'severity': 'Exact' if diff < 0.5 else 'Close',
                'effect': f'{planet} at death degree — vulnerability in {planet} significations',
            })
    return results

# ═══════════════════════════════════════════════════════════════
# BHRIGU BINDU
# ═══════════════════════════════════════════════════════════════
def calculate_bhrigu_bindu(planets: Dict) -> Dict:
    """
    Bhrigu Bindu = midpoint of Rahu and Moon.
    When Jupiter transits this point, major positive events trigger.
    When Saturn transits, challenges manifest.
    """
    rahu_long = planets.get('Rahu', {}).get('longitude', 0)
    moon_long = planets.get('Moon', {}).get('longitude', 0)
    
    diff = rahu_long - moon_long
    if diff > 180: diff -= 360
    elif diff < -180: diff += 360
    bb = (moon_long + diff / 2) % 360
    
    bb_rashi = int(bb / 30) % 12
    bb_nak_idx = int(bb / (360/27)) % 27
    from ..core.constants import NAKSHATRA_NAMES
    
    return {
        'longitude': round(bb, 2), 'sign': RASHI_NAMES[bb_rashi],
        'degree': round(bb % 30, 2), 'nakshatra': NAKSHATRA_NAMES[bb_nak_idx],
        'interpretation': f'Bhrigu Bindu at {round(bb % 30, 1)}° {RASHI_NAMES[bb_rashi]}. Jupiter transit over this degree triggers major positive events. Saturn transit brings challenges.',
    }

# ═══════════════════════════════════════════════════════════════
# 108 NAKSHATRA PADA ARCHETYPES
# ═══════════════════════════════════════════════════════════════
PADA_NAVAMSA = [
    # Each nakshatra has 4 padas, each pada falls in a navamsa sign
    # Ashwini P1=Aries, P2=Taurus, P3=Gemini, P4=Cancer
    # etc. — navamsa signs cycle through all 12 starting from the fire signs
]

def get_pada_archetype(nakshatra_idx: int, pada: int) -> Dict:
    """Get the archetype for a specific nakshatra pada (1 of 108)."""
    from ..core.constants import NAKSHATRA_NAMES, NAKSHATRA_LORDS
    nak = NAKSHATRA_NAMES[nakshatra_idx % 27]
    lord = NAKSHATRA_LORDS[nakshatra_idx % 27]
    
    # Navamsa sign for this pada
    total_pada = nakshatra_idx * 4 + (pada - 1)
    navamsa_sign_idx = total_pada % 12
    navamsa_sign = RASHI_NAMES[navamsa_sign_idx]
    navamsa_lord = RASHI_LORDS[navamsa_sign_idx]
    
    # Element of navamsa
    elements = ['Fire', 'Earth', 'Air', 'Water']
    element = elements[navamsa_sign_idx % 4]
    
    # Pada characteristics
    pada_nature = ['Dharma (purpose)', 'Artha (wealth)', 'Kama (desire)', 'Moksha (liberation)']
    nature = pada_nature[(pada - 1) % 4]
    
    return {
        'nakshatra': nak, 'pada': pada, 'lord': lord,
        'navamsa_sign': navamsa_sign, 'navamsa_lord': navamsa_lord,
        'element': element, 'nature': nature,
        'archetype_number': total_pada + 1,
        'description': f'{nak} Pada {pada}: {nature} orientation through {navamsa_sign} ({element}). Ruled by {lord}, sub-ruled by {navamsa_lord}.',
    }

def get_all_planet_padas(planets: Dict) -> Dict:
    """Get pada archetype for each planet."""
    result = {}
    for name in ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu']:
        p = planets.get(name, {})
        nak_idx = int(p.get('longitude', 0) / (360/27)) % 27
        pada = int((p.get('longitude', 0) % (360/27)) / (360/108)) + 1
        if pada > 4: pada = 4
        result[name] = get_pada_archetype(nak_idx, pada)
    return result

# ═══════════════════════════════════════════════════════════════
# PANCHA PAKSHI SHASTRA
# ═══════════════════════════════════════════════════════════════
PAKSHI_BIRDS = ['Vulture', 'Owl', 'Crow', 'Cock', 'Peacock']
PAKSHI_ACTIVITIES = ['Eating', 'Walking', 'Ruling', 'Sleeping', 'Dying']

# Birth star group → bird assignment
NAKSHATRA_TO_BIRD = {
    0: 0, 1: 1, 2: 2, 3: 3, 4: 4,  # Ashwini-Mrigashira
    5: 0, 6: 1, 7: 2, 8: 3, 9: 4,  # Ardra-Magha
    10: 0, 11: 1, 12: 2, 13: 3, 14: 4,  # P.Phalguni-Swati
    15: 0, 16: 1, 17: 2, 18: 3, 19: 4,  # Vishakha-P.Ashadha
    20: 0, 21: 1, 22: 2, 23: 3, 24: 4,  # U.Ashadha-P.Bhadra
    25: 0, 26: 1,  # U.Bhadra-Revati
}

def get_pancha_pakshi(moon_nakshatra_idx: int, is_day: bool = None, now=None,
                      sunrise: float = None, sunset: float = None) -> Dict:
    """Get Pancha Pakshi bird and current activity.

    The day (sunrise to sunset) and the night are each five yamas, and the bird
    changes activity with each. `now` is LOCAL time at the chart's place with its
    real sunrise and sunset; with none given it falls back to the server clock and
    a 06:00–18:00 day, as before."""
    from datetime import datetime
    bird_idx = NAKSHATRA_TO_BIRD.get(moon_nakshatra_idx % 27, 0)
    birth_bird = PAKSHI_BIRDS[bird_idx]

    now = now or datetime.now()
    sr = 6.0 if sunrise is None else float(sunrise)
    ss = 18.0 if sunset is None else float(sunset)
    hour = now.hour + now.minute / 60
    if is_day is None:
        is_day = sr <= hour < ss
    day_len = max(ss - sr, 0.1)
    night_len = 24 - day_len
    if is_day:
        activity_idx = min(int(max(hour - sr, 0) / (day_len / 5)), 4)
    else:
        since = hour - ss if hour >= ss else hour + 24 - ss
        activity_idx = min(int(since / (night_len / 5)), 4)
    
    current_activity = PAKSHI_ACTIVITIES[(bird_idx + activity_idx) % 5]
    
    activity_advice = {
        'Eating': 'Good for acquiring, learning, consuming information',
        'Walking': 'Good for travel, movement, physical activity',
        'Ruling': 'Best time — authority, decisions, important actions',
        'Sleeping': 'Rest, avoid major decisions, meditate',
        'Dying': 'Worst time — avoid new ventures, be cautious',
    }
    
    return {
        'birth_bird': birth_bird, 'current_activity': current_activity,
        'advice': activity_advice.get(current_activity, ''),
        'is_ruling': current_activity == 'Ruling',
        'is_dying': current_activity == 'Dying',
    }

# ═══════════════════════════════════════════════════════════════
# COMPLETE GRAHA SHANTI (Remedial Specifications)
# ═══════════════════════════════════════════════════════════════
GRAHA_SHANTI = {
    'Sun': {'mantra': 'Om Hraam Hreem Hroum Sah Suryaya Namah', 'count': 7000,
            'gemstone': 'Ruby', 'weight_min_ct': 3, 'finger': 'Ring', 'metal': 'Gold',
            'day': 'Sunday', 'direction': 'East', 'hora': 'Sun',
            'donation': 'Wheat, jaggery, red cloth, copper', 'deity': 'Lord Shiva/Surya Dev',
            'fast': 'Sunday fast', 'color': 'Red/Copper', 'rudraksha': '1 Mukhi or 12 Mukhi'},
    'Moon': {'mantra': 'Om Shraam Shreem Shroum Sah Chandraya Namah', 'count': 11000,
             'gemstone': 'Pearl', 'weight_min_ct': 4, 'finger': 'Little', 'metal': 'Silver',
             'day': 'Monday', 'direction': 'Northwest', 'hora': 'Moon',
             'donation': 'Rice, white cloth, silver, milk', 'deity': 'Goddess Parvati/Shiva',
             'fast': 'Monday fast', 'color': 'White/Silver', 'rudraksha': '2 Mukhi'},
    'Mars': {'mantra': 'Om Kraam Kreem Kroum Sah Bhaumaya Namah', 'count': 10000,
             'gemstone': 'Red Coral', 'weight_min_ct': 5, 'finger': 'Ring', 'metal': 'Gold/Copper',
             'day': 'Tuesday', 'direction': 'South', 'hora': 'Mars',
             'donation': 'Red lentils, red cloth, copper, jaggery', 'deity': 'Lord Hanuman/Kartikeya',
             'fast': 'Tuesday fast', 'color': 'Red', 'rudraksha': '3 Mukhi'},
    'Mercury': {'mantra': 'Om Braam Breem Broum Sah Budhaya Namah', 'count': 9000,
                'gemstone': 'Emerald', 'weight_min_ct': 3, 'finger': 'Little', 'metal': 'Gold',
                'day': 'Wednesday', 'direction': 'North', 'hora': 'Mercury',
                'donation': 'Green moong dal, green cloth, bronze', 'deity': 'Lord Vishnu',
                'fast': 'Wednesday fast', 'color': 'Green', 'rudraksha': '4 Mukhi'},
    'Jupiter': {'mantra': 'Om Graam Greem Groum Sah Gurave Namah', 'count': 19000,
                'gemstone': 'Yellow Sapphire', 'weight_min_ct': 3, 'finger': 'Index', 'metal': 'Gold',
                'day': 'Thursday', 'direction': 'Northeast', 'hora': 'Jupiter',
                'donation': 'Yellow cloth, turmeric, chana dal, gold', 'deity': 'Lord Brihaspati/Vishnu',
                'fast': 'Thursday fast', 'color': 'Yellow', 'rudraksha': '5 Mukhi'},
    'Venus': {'mantra': 'Om Draam Dreem Droum Sah Shukraya Namah', 'count': 16000,
              'gemstone': 'Diamond', 'weight_min_ct': 0.5, 'finger': 'Middle/Ring', 'metal': 'Platinum/Silver',
              'day': 'Friday', 'direction': 'Southeast', 'hora': 'Venus',
              'donation': 'White rice, white clothes, perfume, sugar', 'deity': 'Goddess Lakshmi',
              'fast': 'Friday fast', 'color': 'White/Pink', 'rudraksha': '6 Mukhi'},
    'Saturn': {'mantra': 'Om Praam Preem Proum Sah Shanaischaraya Namah', 'count': 23000,
               'gemstone': 'Blue Sapphire', 'weight_min_ct': 3, 'finger': 'Middle', 'metal': 'Iron/Silver',
               'day': 'Saturday', 'direction': 'West', 'hora': 'Saturn',
               'donation': 'Black sesame, mustard oil, iron, black cloth', 'deity': 'Lord Shani/Hanuman',
               'fast': 'Saturday fast', 'color': 'Black/Dark Blue', 'rudraksha': '7 Mukhi or 14 Mukhi'},
    'Rahu': {'mantra': 'Om Bhraam Bhreem Bhroum Sah Rahave Namah', 'count': 18000,
             'gemstone': 'Hessonite (Gomed)', 'weight_min_ct': 4, 'finger': 'Middle', 'metal': 'Silver',
             'day': 'Saturday', 'direction': 'Southwest', 'hora': 'Rahu',
             'donation': 'Blue/black cloth, mustard, coconut', 'deity': 'Goddess Durga',
             'fast': 'Saturday fast', 'color': 'Smoky Blue', 'rudraksha': '8 Mukhi'},
    'Ketu': {'mantra': 'Om Sraam Sreem Sroum Sah Ketave Namah', 'count': 17000,
             'gemstone': "Cat's Eye (Lehsunia)", 'weight_min_ct': 3, 'finger': 'Ring', 'metal': 'Gold',
             'day': 'Tuesday', 'direction': 'Southwest', 'hora': 'Ketu',
             'donation': 'Blanket, seven grains, dog food', 'deity': 'Lord Ganesha',
             'fast': 'Tuesday/Saturday', 'color': 'Grey/Brown', 'rudraksha': '9 Mukhi'},
}

def get_graha_shanti(planet: str) -> Dict:
    """Get complete remedial specifications for a planet."""
    return GRAHA_SHANTI.get(planet, {})

def get_full_graha_shanti(weak_planets: List[str]) -> Dict:
    """Get remedial for all weak/afflicted planets."""
    remedies = {}
    for planet in weak_planets:
        remedies[planet] = get_graha_shanti(planet)
    return remedies

# ═══════════════════════════════════════════════════════════════
# REMAINING TAJIKA YOGAS (extend existing varshaphal)
# ═══════════════════════════════════════════════════════════════
ADDITIONAL_TAJIKA_YOGAS = {
    'Kamboola': 'Moon applies to aspect with queried lord — strong YES with Moon support',
    'Gairi_Kamboola': 'Moon separating from queried lord — delayed YES',
    'Khalasara': 'Both significators cadent (6/8/12) — complete denial',
    'Radda': 'Significator retrograde and separating — reversal, cancellation',
    'Duhphali_Kuttha': 'Significator in fall or combust — event happens but with suffering',
    'Dutthotta_Davira': 'Significator moving from fall to exaltation — event after initial failure',
    'Tambira': 'Significator in friend sign — easy accomplishment through allies',
    'Kuttha': 'Both significators weak — event denied or meaningless if it happens',
    'Durpha': 'Faster planet past exact aspect — just missed, wait for next cycle',
    'Manaau': 'Separating aspect with collection of light — third party facilitates',
    'Induvara': 'Moon in kendra — general success and protection for the year',
}

# ═══════════════════════════════════════════════════════════════
# REMAINING SAHAMS
# ═══════════════════════════════════════════════════════════════
ADDITIONAL_SAHAMS = {
    'pitri': ('Pitri Saham (Father)', 'Saturn', 'Sun'),
    'matri': ('Matri Saham (Mother)', 'Moon', 'Venus'),
    'bhratri': ('Bhratri Saham (Siblings)', 'Jupiter', 'Mars'),
    'bandhu': ('Bandhu Saham (Relatives)', 'Mercury', 'Moon'),
    'raj': ('Raj Saham (Authority)', 'Saturn', 'Sun'),
    'maran': ('Maran Saham (Death)', 'Moon', 'Saturn'),
    'paradesh': ('Paradesh Saham (Foreign)', 'Mercury', 'Mars'),
    'jaldosh': ('Jaldosh Saham (Water Danger)', 'Moon', 'Saturn'),
}
