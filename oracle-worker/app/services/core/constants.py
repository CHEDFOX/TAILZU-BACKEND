"""
JYOTISH ENGINE - MASTER CONSTANTS
World-Class Vedic Astrology System
All astrological constants in one place
"""

# ═══════════════════════════════════════════════════════════════════════════
# RASHIS (ZODIAC SIGNS)
# ═══════════════════════════════════════════════════════════════════════════

RASHIS = {
    0: {'name': 'Aries', 'sanskrit': 'Mesha', 'hindi': 'मेष', 'symbol': '♈',
        'element': 'Fire', 'quality': 'Movable', 'ruler': 'Mars', 'gender': 'Male',
        'direction': 'East', 'tattva': 'Agni', 'limb': 'Head'},
    1: {'name': 'Taurus', 'sanskrit': 'Vrishabha', 'hindi': 'वृषभ', 'symbol': '♉',
        'element': 'Earth', 'quality': 'Fixed', 'ruler': 'Venus', 'gender': 'Female',
        'direction': 'South', 'tattva': 'Prithvi', 'limb': 'Face'},
    2: {'name': 'Gemini', 'sanskrit': 'Mithuna', 'hindi': 'मिथुन', 'symbol': '♊',
        'element': 'Air', 'quality': 'Dual', 'ruler': 'Mercury', 'gender': 'Male',
        'direction': 'West', 'tattva': 'Vayu', 'limb': 'Arms'},
    3: {'name': 'Cancer', 'sanskrit': 'Karka', 'hindi': 'कर्क', 'symbol': '♋',
        'element': 'Water', 'quality': 'Movable', 'ruler': 'Moon', 'gender': 'Female',
        'direction': 'North', 'tattva': 'Jala', 'limb': 'Chest'},
    4: {'name': 'Leo', 'sanskrit': 'Simha', 'hindi': 'सिंह', 'symbol': '♌',
        'element': 'Fire', 'quality': 'Fixed', 'ruler': 'Sun', 'gender': 'Male',
        'direction': 'East', 'tattva': 'Agni', 'limb': 'Stomach'},
    5: {'name': 'Virgo', 'sanskrit': 'Kanya', 'hindi': 'कन्या', 'symbol': '♍',
        'element': 'Earth', 'quality': 'Dual', 'ruler': 'Mercury', 'gender': 'Female',
        'direction': 'South', 'tattva': 'Prithvi', 'limb': 'Waist'},
    6: {'name': 'Libra', 'sanskrit': 'Tula', 'hindi': 'तुला', 'symbol': '♎',
        'element': 'Air', 'quality': 'Movable', 'ruler': 'Venus', 'gender': 'Male',
        'direction': 'West', 'tattva': 'Vayu', 'limb': 'Below Navel'},
    7: {'name': 'Scorpio', 'sanskrit': 'Vrischika', 'hindi': 'वृश्चिक', 'symbol': '♏',
        'element': 'Water', 'quality': 'Fixed', 'ruler': 'Mars', 'gender': 'Female',
        'direction': 'North', 'tattva': 'Jala', 'limb': 'Genitals'},
    8: {'name': 'Sagittarius', 'sanskrit': 'Dhanu', 'hindi': 'धनु', 'symbol': '♐',
        'element': 'Fire', 'quality': 'Dual', 'ruler': 'Jupiter', 'gender': 'Male',
        'direction': 'East', 'tattva': 'Agni', 'limb': 'Thighs'},
    9: {'name': 'Capricorn', 'sanskrit': 'Makara', 'hindi': 'मकर', 'symbol': '♑',
        'element': 'Earth', 'quality': 'Movable', 'ruler': 'Saturn', 'gender': 'Female',
        'direction': 'South', 'tattva': 'Prithvi', 'limb': 'Knees'},
    10: {'name': 'Aquarius', 'sanskrit': 'Kumbha', 'hindi': 'कुम्भ', 'symbol': '♒',
         'element': 'Air', 'quality': 'Fixed', 'ruler': 'Saturn', 'gender': 'Male',
         'direction': 'West', 'tattva': 'Vayu', 'limb': 'Ankles'},
    11: {'name': 'Pisces', 'sanskrit': 'Meena', 'hindi': 'मीन', 'symbol': '♓',
         'element': 'Water', 'quality': 'Dual', 'ruler': 'Jupiter', 'gender': 'Female',
         'direction': 'North', 'tattva': 'Jala', 'limb': 'Feet'},
}

RASHI_NAMES = [r['name'] for r in RASHIS.values()]
RASHI_LORDS = ['Mars', 'Venus', 'Mercury', 'Moon', 'Sun', 'Mercury', 
               'Venus', 'Mars', 'Jupiter', 'Saturn', 'Saturn', 'Jupiter']


# ═══════════════════════════════════════════════════════════════════════════
# NAKSHATRAS (27 LUNAR MANSIONS)
# ═══════════════════════════════════════════════════════════════════════════

NAKSHATRAS = {
    0: {'name': 'Ashwini', 'hindi': 'अश्विनी', 'ruler': 'Ketu', 'deity': 'Ashwini Kumaras',
        'symbol': 'Horse head', 'gana': 'Deva', 'guna': 'Rajas', 'animal': 'Horse',
        'yoni': 'Male Horse', 'nadi': 'Vata', 'tatva': 'Earth', 'varna': 'Vaishya'},
    1: {'name': 'Bharani', 'hindi': 'भरणी', 'ruler': 'Venus', 'deity': 'Yama',
        'symbol': 'Yoni', 'gana': 'Manushya', 'guna': 'Rajas', 'animal': 'Elephant',
        'yoni': 'Male Elephant', 'nadi': 'Pitta', 'tatva': 'Earth', 'varna': 'Mleccha'},
    2: {'name': 'Krittika', 'hindi': 'कृत्तिका', 'ruler': 'Sun', 'deity': 'Agni',
        'symbol': 'Razor', 'gana': 'Rakshasa', 'guna': 'Rajas', 'animal': 'Goat',
        'yoni': 'Female Goat', 'nadi': 'Kapha', 'tatva': 'Earth', 'varna': 'Brahmin'},
    3: {'name': 'Rohini', 'hindi': 'रोहिणी', 'ruler': 'Moon', 'deity': 'Brahma',
        'symbol': 'Cart', 'gana': 'Manushya', 'guna': 'Rajas', 'animal': 'Serpent',
        'yoni': 'Male Serpent', 'nadi': 'Kapha', 'tatva': 'Earth', 'varna': 'Shudra'},
    4: {'name': 'Mrigashira', 'hindi': 'मृगशिरा', 'ruler': 'Mars', 'deity': 'Soma',
        'symbol': 'Deer head', 'gana': 'Deva', 'guna': 'Tamas', 'animal': 'Serpent',
        'yoni': 'Female Serpent', 'nadi': 'Pitta', 'tatva': 'Earth', 'varna': 'Vaishya'},
    5: {'name': 'Ardra', 'hindi': 'आर्द्रा', 'ruler': 'Rahu', 'deity': 'Rudra',
        'symbol': 'Teardrop', 'gana': 'Manushya', 'guna': 'Tamas', 'animal': 'Dog',
        'yoni': 'Female Dog', 'nadi': 'Vata', 'tatva': 'Water', 'varna': 'Butcher'},
    6: {'name': 'Punarvasu', 'hindi': 'पुनर्वसु', 'ruler': 'Jupiter', 'deity': 'Aditi',
        'symbol': 'Quiver', 'gana': 'Deva', 'guna': 'Sattva', 'animal': 'Cat',
        'yoni': 'Female Cat', 'nadi': 'Vata', 'tatva': 'Water', 'varna': 'Vaishya'},
    7: {'name': 'Pushya', 'hindi': 'पुष्य', 'ruler': 'Saturn', 'deity': 'Brihaspati',
        'symbol': 'Flower', 'gana': 'Deva', 'guna': 'Tamas', 'animal': 'Goat',
        'yoni': 'Male Goat', 'nadi': 'Pitta', 'tatva': 'Water', 'varna': 'Kshatriya'},
    8: {'name': 'Ashlesha', 'hindi': 'आश्लेषा', 'ruler': 'Mercury', 'deity': 'Sarpa',
        'symbol': 'Serpent', 'gana': 'Rakshasa', 'guna': 'Sattva', 'animal': 'Cat',
        'yoni': 'Male Cat', 'nadi': 'Kapha', 'tatva': 'Water', 'varna': 'Mleccha'},
    9: {'name': 'Magha', 'hindi': 'मघा', 'ruler': 'Ketu', 'deity': 'Pitris',
        'symbol': 'Throne', 'gana': 'Rakshasa', 'guna': 'Tamas', 'animal': 'Rat',
        'yoni': 'Male Rat', 'nadi': 'Kapha', 'tatva': 'Water', 'varna': 'Shudra'},
    10: {'name': 'Purva Phalguni', 'hindi': 'पूर्वा फाल्गुनी', 'ruler': 'Venus', 'deity': 'Bhaga',
         'symbol': 'Hammock', 'gana': 'Manushya', 'guna': 'Rajas', 'animal': 'Rat',
         'yoni': 'Female Rat', 'nadi': 'Pitta', 'tatva': 'Water', 'varna': 'Brahmin'},
    11: {'name': 'Uttara Phalguni', 'hindi': 'उत्तरा फाल्गुनी', 'ruler': 'Sun', 'deity': 'Aryaman',
         'symbol': 'Bed', 'gana': 'Manushya', 'guna': 'Rajas', 'animal': 'Cow',
         'yoni': 'Male Cow', 'nadi': 'Vata', 'tatva': 'Fire', 'varna': 'Kshatriya'},
    12: {'name': 'Hasta', 'hindi': 'हस्त', 'ruler': 'Moon', 'deity': 'Savitar',
         'symbol': 'Hand', 'gana': 'Deva', 'guna': 'Rajas', 'animal': 'Buffalo',
         'yoni': 'Female Buffalo', 'nadi': 'Vata', 'tatva': 'Fire', 'varna': 'Vaishya'},
    13: {'name': 'Chitra', 'hindi': 'चित्रा', 'ruler': 'Mars', 'deity': 'Vishwakarma',
         'symbol': 'Pearl', 'gana': 'Rakshasa', 'guna': 'Tamas', 'animal': 'Tiger',
         'yoni': 'Female Tiger', 'nadi': 'Pitta', 'tatva': 'Fire', 'varna': 'Vaishya'},
    14: {'name': 'Swati', 'hindi': 'स्वाती', 'ruler': 'Rahu', 'deity': 'Vayu',
         'symbol': 'Coral', 'gana': 'Deva', 'guna': 'Tamas', 'animal': 'Buffalo',
         'yoni': 'Male Buffalo', 'nadi': 'Kapha', 'tatva': 'Fire', 'varna': 'Butcher'},
    15: {'name': 'Vishakha', 'hindi': 'विशाखा', 'ruler': 'Jupiter', 'deity': 'Indra-Agni',
         'symbol': 'Arch', 'gana': 'Rakshasa', 'guna': 'Sattva', 'animal': 'Tiger',
         'yoni': 'Male Tiger', 'nadi': 'Kapha', 'tatva': 'Fire', 'varna': 'Mleccha'},
    16: {'name': 'Anuradha', 'hindi': 'अनुराधा', 'ruler': 'Saturn', 'deity': 'Mitra',
         'symbol': 'Lotus', 'gana': 'Deva', 'guna': 'Tamas', 'animal': 'Deer',
         'yoni': 'Female Deer', 'nadi': 'Pitta', 'tatva': 'Fire', 'varna': 'Shudra'},
    17: {'name': 'Jyeshtha', 'hindi': 'ज्येष्ठा', 'ruler': 'Mercury', 'deity': 'Indra',
         'symbol': 'Earring', 'gana': 'Rakshasa', 'guna': 'Sattva', 'animal': 'Deer',
         'yoni': 'Male Deer', 'nadi': 'Vata', 'tatva': 'Air', 'varna': 'Vaishya'},
    18: {'name': 'Mula', 'hindi': 'मूल', 'ruler': 'Ketu', 'deity': 'Nirriti',
         'symbol': 'Root', 'gana': 'Rakshasa', 'guna': 'Tamas', 'animal': 'Dog',
         'yoni': 'Male Dog', 'nadi': 'Vata', 'tatva': 'Air', 'varna': 'Butcher'},
    19: {'name': 'Purva Ashadha', 'hindi': 'पूर्वाषाढ़ा', 'ruler': 'Venus', 'deity': 'Apas',
         'symbol': 'Fan', 'gana': 'Manushya', 'guna': 'Rajas', 'animal': 'Monkey',
         'yoni': 'Male Monkey', 'nadi': 'Pitta', 'tatva': 'Air', 'varna': 'Brahmin'},
    20: {'name': 'Uttara Ashadha', 'hindi': 'उत्तराषाढ़ा', 'ruler': 'Sun', 'deity': 'Vishwadeva',
         'symbol': 'Tusk', 'gana': 'Manushya', 'guna': 'Rajas', 'animal': 'Mongoose',
         'yoni': 'Male Mongoose', 'nadi': 'Kapha', 'tatva': 'Air', 'varna': 'Kshatriya'},
    21: {'name': 'Shravana', 'hindi': 'श्रवण', 'ruler': 'Moon', 'deity': 'Vishnu',
         'symbol': 'Ear', 'gana': 'Deva', 'guna': 'Rajas', 'animal': 'Monkey',
         'yoni': 'Female Monkey', 'nadi': 'Kapha', 'tatva': 'Air', 'varna': 'Mleccha'},
    22: {'name': 'Dhanishta', 'hindi': 'धनिष्ठा', 'ruler': 'Mars', 'deity': 'Vasus',
         'symbol': 'Drum', 'gana': 'Rakshasa', 'guna': 'Tamas', 'animal': 'Lion',
         'yoni': 'Female Lion', 'nadi': 'Pitta', 'tatva': 'Ether', 'varna': 'Vaishya'},
    23: {'name': 'Shatabhisha', 'hindi': 'शतभिषा', 'ruler': 'Rahu', 'deity': 'Varuna',
         'symbol': 'Circle', 'gana': 'Rakshasa', 'guna': 'Tamas', 'animal': 'Horse',
         'yoni': 'Female Horse', 'nadi': 'Vata', 'tatva': 'Ether', 'varna': 'Butcher'},
    24: {'name': 'Purva Bhadrapada', 'hindi': 'पूर्वाभाद्रपद', 'ruler': 'Jupiter', 'deity': 'Aja Ekapada',
         'symbol': 'Sword', 'gana': 'Manushya', 'guna': 'Sattva', 'animal': 'Lion',
         'yoni': 'Male Lion', 'nadi': 'Vata', 'tatva': 'Ether', 'varna': 'Brahmin'},
    25: {'name': 'Uttara Bhadrapada', 'hindi': 'उत्तराभाद्रपद', 'ruler': 'Saturn', 'deity': 'Ahirbudhnya',
         'symbol': 'Twins', 'gana': 'Manushya', 'guna': 'Tamas', 'animal': 'Cow',
         'yoni': 'Female Cow', 'nadi': 'Pitta', 'tatva': 'Ether', 'varna': 'Kshatriya'},
    26: {'name': 'Revati', 'hindi': 'रेवती', 'ruler': 'Mercury', 'deity': 'Pushan',
         'symbol': 'Fish', 'gana': 'Deva', 'guna': 'Sattva', 'animal': 'Elephant',
         'yoni': 'Female Elephant', 'nadi': 'Kapha', 'tatva': 'Ether', 'varna': 'Shudra'},
}

NAKSHATRA_NAMES = [n['name'] for n in NAKSHATRAS.values()]
NAKSHATRA_LORDS = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury'] * 3


# ═══════════════════════════════════════════════════════════════════════════
# PLANETS (GRAHAS)
# ═══════════════════════════════════════════════════════════════════════════

PLANETS = {
    'Sun': {
        'sanskrit': 'Surya', 'hindi': 'सूर्य', 'symbol': '☉', 'swe_id': 0,
        'nature': 'Malefic', 'gender': 'Male', 'element': 'Fire',
        'owns': [4], 'exalted': 0, 'exalted_degree': 10, 'debilitated': 6, 'debilitated_degree': 10,
        'moolatrikona': 4, 'moolatrikona_start': 0, 'moolatrikona_end': 20,
        'friends': ['Moon', 'Mars', 'Jupiter'], 'enemies': ['Venus', 'Saturn'], 'neutral': ['Mercury'],
        'aspects': [7], 'dig_bala': 10, 'karaka': ['Soul', 'Father', 'Authority', 'Government'],
        'gem': 'Ruby', 'metal': 'Gold', 'color': 'Red', 'day': 'Sunday', 'direction': 'East',
        'body': ['Heart', 'Eyes', 'Bones', 'Head'], 'taste': 'Pungent', 'age': 50,
    },
    'Moon': {
        'sanskrit': 'Chandra', 'hindi': 'चंद्र', 'symbol': '☽', 'swe_id': 1,
        'nature': 'Benefic', 'gender': 'Female', 'element': 'Water',
        'owns': [3], 'exalted': 1, 'exalted_degree': 3, 'debilitated': 7, 'debilitated_degree': 3,
        'moolatrikona': 1, 'moolatrikona_start': 3, 'moolatrikona_end': 30,
        'friends': ['Sun', 'Mercury'], 'enemies': [], 'neutral': ['Mars', 'Jupiter', 'Venus', 'Saturn'],
        'aspects': [7], 'dig_bala': 4, 'karaka': ['Mind', 'Mother', 'Emotions', 'Public'],
        'gem': 'Pearl', 'metal': 'Silver', 'color': 'White', 'day': 'Monday', 'direction': 'Northwest',
        'body': ['Mind', 'Blood', 'Breast', 'Fluids'], 'taste': 'Salty', 'age': 70,
    },
    'Mars': {
        'sanskrit': 'Mangal', 'hindi': 'मंगल', 'symbol': '♂', 'swe_id': 4,
        'nature': 'Malefic', 'gender': 'Male', 'element': 'Fire',
        'owns': [0, 7], 'exalted': 9, 'exalted_degree': 28, 'debilitated': 3, 'debilitated_degree': 28,
        'moolatrikona': 0, 'moolatrikona_start': 0, 'moolatrikona_end': 12,
        'friends': ['Sun', 'Moon', 'Jupiter'], 'enemies': ['Mercury'], 'neutral': ['Venus', 'Saturn'],
        'aspects': [4, 7, 8], 'dig_bala': 10, 'karaka': ['Courage', 'Siblings', 'Property', 'Energy'],
        'gem': 'Coral', 'metal': 'Copper', 'color': 'Red', 'day': 'Tuesday', 'direction': 'South',
        'body': ['Blood', 'Muscles', 'Marrow', 'Head'], 'taste': 'Bitter', 'age': 16,
    },
    'Mercury': {
        'sanskrit': 'Budha', 'hindi': 'बुध', 'symbol': '☿', 'swe_id': 2,
        'nature': 'Benefic', 'gender': 'Neutral', 'element': 'Earth',
        'owns': [2, 5], 'exalted': 5, 'exalted_degree': 15, 'debilitated': 11, 'debilitated_degree': 15,
        'moolatrikona': 5, 'moolatrikona_start': 16, 'moolatrikona_end': 20,
        'friends': ['Sun', 'Venus'], 'enemies': ['Moon'], 'neutral': ['Mars', 'Jupiter', 'Saturn'],
        'aspects': [7], 'dig_bala': 1, 'karaka': ['Intelligence', 'Communication', 'Business'],
        'gem': 'Emerald', 'metal': 'Brass', 'color': 'Green', 'day': 'Wednesday', 'direction': 'North',
        'body': ['Nervous System', 'Skin', 'Speech'], 'taste': 'Mixed', 'age': 12,
    },
    'Jupiter': {
        'sanskrit': 'Guru', 'hindi': 'गुरु', 'symbol': '♃', 'swe_id': 5,
        'nature': 'Benefic', 'gender': 'Male', 'element': 'Ether',
        'owns': [8, 11], 'exalted': 3, 'exalted_degree': 5, 'debilitated': 9, 'debilitated_degree': 5,
        'moolatrikona': 8, 'moolatrikona_start': 0, 'moolatrikona_end': 10,
        'friends': ['Sun', 'Moon', 'Mars'], 'enemies': ['Mercury', 'Venus'], 'neutral': ['Saturn'],
        'aspects': [5, 7, 9], 'dig_bala': 1, 'karaka': ['Wisdom', 'Children', 'Husband', 'Wealth'],
        'gem': 'Yellow Sapphire', 'metal': 'Gold', 'color': 'Yellow', 'day': 'Thursday', 'direction': 'Northeast',
        'body': ['Liver', 'Fat', 'Ears'], 'taste': 'Sweet', 'age': 30,
    },
    'Venus': {
        'sanskrit': 'Shukra', 'hindi': 'शुक्र', 'symbol': '♀', 'swe_id': 3,
        'nature': 'Benefic', 'gender': 'Female', 'element': 'Water',
        'owns': [1, 6], 'exalted': 11, 'exalted_degree': 27, 'debilitated': 5, 'debilitated_degree': 27,
        'moolatrikona': 6, 'moolatrikona_start': 0, 'moolatrikona_end': 15,
        'friends': ['Mercury', 'Saturn'], 'enemies': ['Sun', 'Moon'], 'neutral': ['Mars', 'Jupiter'],
        'aspects': [7], 'dig_bala': 4, 'karaka': ['Love', 'Wife', 'Marriage', 'Luxury', 'Vehicles'],
        'gem': 'Diamond', 'metal': 'Silver', 'color': 'White', 'day': 'Friday', 'direction': 'Southeast',
        'body': ['Reproductive', 'Face', 'Eyes'], 'taste': 'Sour', 'age': 25,
    },
    'Saturn': {
        'sanskrit': 'Shani', 'hindi': 'शनि', 'symbol': '♄', 'swe_id': 6,
        'nature': 'Malefic', 'gender': 'Neutral', 'element': 'Air',
        'owns': [9, 10], 'exalted': 6, 'exalted_degree': 20, 'debilitated': 0, 'debilitated_degree': 20,
        'moolatrikona': 10, 'moolatrikona_start': 0, 'moolatrikona_end': 20,
        'friends': ['Mercury', 'Venus'], 'enemies': ['Sun', 'Moon', 'Mars'], 'neutral': ['Jupiter'],
        'aspects': [3, 7, 10], 'dig_bala': 7, 'karaka': ['Karma', 'Longevity', 'Servants', 'Sorrow'],
        'gem': 'Blue Sapphire', 'metal': 'Iron', 'color': 'Black', 'day': 'Saturday', 'direction': 'West',
        'body': ['Bones', 'Teeth', 'Legs'], 'taste': 'Astringent', 'age': 100,
    },
    'Rahu': {
        'sanskrit': 'Rahu', 'hindi': 'राहु', 'symbol': '☊', 'swe_id': 11,
        'nature': 'Malefic', 'gender': 'Male', 'element': 'Air',
        'owns': [], 'exalted': 1, 'exalted_degree': 20, 'debilitated': 7, 'debilitated_degree': 20,
        'moolatrikona': None, 'moolatrikona_start': None, 'moolatrikona_end': None,
        'friends': ['Mercury', 'Venus', 'Saturn'], 'enemies': ['Sun', 'Moon', 'Mars'], 'neutral': ['Jupiter'],
        'aspects': [5, 7, 9], 'dig_bala': None, 'karaka': ['Obsession', 'Foreign', 'Illusion', 'Technology'],
        'gem': 'Hessonite', 'metal': 'Lead', 'color': 'Smoky', 'day': None, 'direction': 'Southwest',
        'body': ['Head'], 'taste': None, 'age': None,
    },
    'Ketu': {
        'sanskrit': 'Ketu', 'hindi': 'केतु', 'symbol': '☋', 'swe_id': None,
        'nature': 'Malefic', 'gender': 'Neutral', 'element': 'Fire',
        'owns': [], 'exalted': 7, 'exalted_degree': 20, 'debilitated': 1, 'debilitated_degree': 20,
        'moolatrikona': None, 'moolatrikona_start': None, 'moolatrikona_end': None,
        'friends': ['Mars', 'Jupiter'], 'enemies': ['Moon'], 'neutral': ['Sun', 'Mercury', 'Venus', 'Saturn'],
        'aspects': [5, 7, 9], 'dig_bala': None, 'karaka': ['Spirituality', 'Liberation', 'Past Karma'],
        'gem': "Cat's Eye", 'metal': 'Lead', 'color': 'Grey', 'day': None, 'direction': 'Northeast',
        'body': ['Feet'], 'taste': None, 'age': None,
    },
}

PLANET_NAMES = list(PLANETS.keys())
PLANET_ORDER = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu']
SEVEN_PLANETS = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']


# ═══════════════════════════════════════════════════════════════════════════
# HOUSES (BHAVAS)
# ═══════════════════════════════════════════════════════════════════════════

HOUSES = {
    1: {'name': 'Lagna', 'sanskrit': 'Tanu Bhava', 'meaning': 'Self',
        'signifies': ['Body', 'Personality', 'Health', 'Appearance', 'Birth', 'Character', 'Fame'],
        'karaka': 'Sun', 'category': 'Kendra'},
    2: {'name': 'Dhana', 'sanskrit': 'Dhana Bhava', 'meaning': 'Wealth',
        'signifies': ['Money', 'Family', 'Speech', 'Food', 'Right Eye', 'Death', 'Face'],
        'karaka': 'Jupiter', 'category': 'Panapara'},
    3: {'name': 'Sahaja', 'sanskrit': 'Sahaja Bhava', 'meaning': 'Siblings',
        'signifies': ['Siblings', 'Courage', 'Communication', 'Short Travel', 'Arms', 'Skills', 'Writing'],
        'karaka': 'Mars', 'category': 'Apoklima'},
    4: {'name': 'Sukha', 'sanskrit': 'Sukha Bhava', 'meaning': 'Happiness',
        'signifies': ['Mother', 'Home', 'Property', 'Vehicles', 'Peace', 'Education', 'Chest'],
        'karaka': 'Moon', 'category': 'Kendra'},
    5: {'name': 'Putra', 'sanskrit': 'Putra Bhava', 'meaning': 'Children',
        'signifies': ['Children', 'Intelligence', 'Romance', 'Creativity', 'Speculation', 'Mantra', 'Past Merit'],
        'karaka': 'Jupiter', 'category': 'Trikona'},
    6: {'name': 'Ripu', 'sanskrit': 'Ari Bhava', 'meaning': 'Enemies',
        'signifies': ['Enemies', 'Debts', 'Disease', 'Service', 'Obstacles', 'Maternal Uncle', 'Wounds'],
        'karaka': 'Mars', 'category': 'Dusthana'},
    7: {'name': 'Kalatra', 'sanskrit': 'Kalatra Bhava', 'meaning': 'Spouse',
        'signifies': ['Marriage', 'Partner', 'Business', 'Contracts', 'Foreign Travel', 'Public Image'],
        'karaka': 'Venus', 'category': 'Kendra'},
    8: {'name': 'Mrityu', 'sanskrit': 'Randhra Bhava', 'meaning': 'Death',
        'signifies': ['Death', 'Longevity', 'Transformation', 'Inheritance', 'Secrets', 'Occult', 'Chronic Disease'],
        'karaka': 'Saturn', 'category': 'Dusthana'},
    9: {'name': 'Dharma', 'sanskrit': 'Dharma Bhava', 'meaning': 'Fortune',
        'signifies': ['Father', 'Guru', 'Religion', 'Luck', 'Higher Learning', 'Long Travel', 'Philosophy'],
        'karaka': 'Jupiter', 'category': 'Trikona'},
    10: {'name': 'Karma', 'sanskrit': 'Karma Bhava', 'meaning': 'Action',
         'signifies': ['Career', 'Profession', 'Status', 'Authority', 'Government', 'Fame', 'Knees'],
         'karaka': 'Sun', 'category': 'Kendra'},
    11: {'name': 'Labha', 'sanskrit': 'Labha Bhava', 'meaning': 'Gains',
         'signifies': ['Income', 'Gains', 'Friends', 'Elder Siblings', 'Desires Fulfilled', 'Ankles'],
         'karaka': 'Jupiter', 'category': 'Upachaya'},
    12: {'name': 'Vyaya', 'sanskrit': 'Vyaya Bhava', 'meaning': 'Loss',
         'signifies': ['Loss', 'Expenses', 'Foreign', 'Liberation', 'Sleep', 'Left Eye', 'Bed Pleasures'],
         'karaka': 'Saturn', 'category': 'Dusthana'},
}

# House Categories
KENDRA_HOUSES = [1, 4, 7, 10]  # Angular houses
TRIKONA_HOUSES = [1, 5, 9]     # Trinal houses (1 is both)
DUSTHANA_HOUSES = [6, 8, 12]   # Evil houses
UPACHAYA_HOUSES = [3, 6, 10, 11]  # Growth houses
MARAKA_HOUSES = [2, 7]         # Death-inflicting houses
PANAPARA_HOUSES = [2, 5, 8, 11]  # Succedent houses
APOKLIMA_HOUSES = [3, 6, 9, 12]  # Cadent houses


# ═══════════════════════════════════════════════════════════════════════════
# DASHA SYSTEMS
# ═══════════════════════════════════════════════════════════════════════════

# Vimshottari Dasha (120 years)
VIMSHOTTARI_YEARS = {
    'Ketu': 7, 'Venus': 20, 'Sun': 6, 'Moon': 10, 'Mars': 7,
    'Rahu': 18, 'Jupiter': 16, 'Saturn': 19, 'Mercury': 17
}
VIMSHOTTARI_ORDER = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury']
VIMSHOTTARI_TOTAL = 120

# Ashtottari Dasha (108 years)
ASHTOTTARI_YEARS = {
    'Sun': 6, 'Moon': 15, 'Mars': 8, 'Mercury': 17, 'Saturn': 10,
    'Jupiter': 19, 'Rahu': 12, 'Venus': 21
}
ASHTOTTARI_ORDER = ['Sun', 'Moon', 'Mars', 'Mercury', 'Saturn', 'Jupiter', 'Rahu', 'Venus']
ASHTOTTARI_TOTAL = 108

# Yogini Dasha (36 years)
YOGINI_YEARS = {
    'Mangala': 1, 'Pingala': 2, 'Dhanya': 3, 'Bhramari': 4,
    'Bhadrika': 5, 'Ulka': 6, 'Siddha': 7, 'Sankata': 8
}
YOGINI_ORDER = ['Mangala', 'Pingala', 'Dhanya', 'Bhramari', 'Bhadrika', 'Ulka', 'Siddha', 'Sankata']
YOGINI_PLANETS = {
    'Mangala': 'Moon', 'Pingala': 'Sun', 'Dhanya': 'Jupiter', 'Bhramari': 'Mars',
    'Bhadrika': 'Mercury', 'Ulka': 'Saturn', 'Siddha': 'Venus', 'Sankata': 'Rahu'
}
YOGINI_TOTAL = 36

# Kalachakra Dasha
KALACHAKRA_GROUPS = {
    'Savya': [0, 1, 2, 9, 10, 11, 18, 19, 20],  # Forward nakshatras
    'Apsavya': [3, 4, 5, 12, 13, 14, 21, 22, 23, 6, 7, 8, 15, 16, 17, 24, 25, 26]  # Backward
}


# ═══════════════════════════════════════════════════════════════════════════
# DIVISIONAL CHARTS (VARGAS)
# ═══════════════════════════════════════════════════════════════════════════

DIVISIONAL_CHARTS = {
    'D1':  {'name': 'Rashi', 'division': 1, 'purpose': 'Physical body, general life'},
    'D2':  {'name': 'Hora', 'division': 2, 'purpose': 'Wealth and money'},
    'D3':  {'name': 'Drekkana', 'division': 3, 'purpose': 'Siblings, courage'},
    'D4':  {'name': 'Chaturthamsa', 'division': 4, 'purpose': 'Fortune, property'},
    'D5':  {'name': 'Panchamsa', 'division': 5, 'purpose': 'Spiritual merit'},
    'D6':  {'name': 'Shashthamsa', 'division': 6, 'purpose': 'Health'},
    'D7':  {'name': 'Saptamsa', 'division': 7, 'purpose': 'Children, progeny'},
    'D8':  {'name': 'Ashtamsa', 'division': 8, 'purpose': 'Longevity'},
    'D9':  {'name': 'Navamsa', 'division': 9, 'purpose': 'Spouse, dharma, soul'},
    'D10': {'name': 'Dasamsa', 'division': 10, 'purpose': 'Career, profession'},
    'D11': {'name': 'Ekadasamsa', 'division': 11, 'purpose': 'Gains'},
    'D12': {'name': 'Dwadasamsa', 'division': 12, 'purpose': 'Parents'},
    'D16': {'name': 'Shodasamsa', 'division': 16, 'purpose': 'Vehicles, happiness'},
    'D20': {'name': 'Vimsamsa', 'division': 20, 'purpose': 'Spiritual progress'},
    'D24': {'name': 'Chaturvimsamsa', 'division': 24, 'purpose': 'Education, learning'},
    'D27': {'name': 'Bhamsa', 'division': 27, 'purpose': 'Strength, weakness'},
    'D30': {'name': 'Trimsamsa', 'division': 30, 'purpose': 'Misfortunes, evils'},
    'D40': {'name': 'Khavedamsa', 'division': 40, 'purpose': 'Auspicious effects'},
    'D45': {'name': 'Akshavedamsa', 'division': 45, 'purpose': 'General indications'},
    'D60': {'name': 'Shashtiamsa', 'division': 60, 'purpose': 'Past karma, root cause'},
}


# ═══════════════════════════════════════════════════════════════════════════
# ASHTAKOOTA (COMPATIBILITY MATCHING)
# ═══════════════════════════════════════════════════════════════════════════

ASHTAKOOTA = {
    'Varna': {'max_points': 1, 'importance': 'Spiritual compatibility'},
    'Vashya': {'max_points': 2, 'importance': 'Mutual attraction'},
    'Tara': {'max_points': 3, 'importance': 'Destiny, luck'},
    'Yoni': {'max_points': 4, 'importance': 'Sexual compatibility'},
    'Graha Maitri': {'max_points': 5, 'importance': 'Mental compatibility'},
    'Gana': {'max_points': 6, 'importance': 'Temperament'},
    'Bhakoot': {'max_points': 7, 'importance': 'Love, family welfare'},
    'Nadi': {'max_points': 8, 'importance': 'Health, genes'},
}
ASHTAKOOTA_TOTAL = 36

# Varna (Caste)
VARNA_ORDER = ['Brahmin', 'Kshatriya', 'Vaishya', 'Shudra']
RASHI_VARNA = {
    0: 'Kshatriya', 1: 'Vaishya', 2: 'Shudra', 3: 'Brahmin',
    4: 'Kshatriya', 5: 'Vaishya', 6: 'Shudra', 7: 'Brahmin',
    8: 'Kshatriya', 9: 'Vaishya', 10: 'Shudra', 11: 'Brahmin',
}

# Gana (Temperament)
NAKSHATRA_GANA = {
    0: 'Deva', 1: 'Manushya', 2: 'Rakshasa', 3: 'Manushya', 4: 'Deva', 5: 'Manushya',
    6: 'Deva', 7: 'Deva', 8: 'Rakshasa', 9: 'Rakshasa', 10: 'Manushya', 11: 'Manushya',
    12: 'Deva', 13: 'Rakshasa', 14: 'Deva', 15: 'Rakshasa', 16: 'Deva', 17: 'Rakshasa',
    18: 'Rakshasa', 19: 'Manushya', 20: 'Manushya', 21: 'Deva', 22: 'Rakshasa', 23: 'Rakshasa',
    24: 'Manushya', 25: 'Manushya', 26: 'Deva',
}

# Yoni (Sexual compatibility)
NAKSHATRA_YONI = {
    0: ('Horse', 'Male'), 1: ('Elephant', 'Male'), 2: ('Goat', 'Female'), 
    3: ('Serpent', 'Male'), 4: ('Serpent', 'Female'), 5: ('Dog', 'Female'),
    6: ('Cat', 'Female'), 7: ('Goat', 'Male'), 8: ('Cat', 'Male'),
    9: ('Rat', 'Male'), 10: ('Rat', 'Female'), 11: ('Cow', 'Male'),
    12: ('Buffalo', 'Female'), 13: ('Tiger', 'Female'), 14: ('Buffalo', 'Male'),
    15: ('Tiger', 'Male'), 16: ('Deer', 'Female'), 17: ('Deer', 'Male'),
    18: ('Dog', 'Male'), 19: ('Monkey', 'Male'), 20: ('Mongoose', 'Male'),
    21: ('Monkey', 'Female'), 22: ('Lion', 'Female'), 23: ('Horse', 'Female'),
    24: ('Lion', 'Male'), 25: ('Cow', 'Female'), 26: ('Elephant', 'Female'),
}


# ═══════════════════════════════════════════════════════════════════════════
# PANCHANGA (FIVE LIMBS OF TIME)
# ═══════════════════════════════════════════════════════════════════════════

TITHIS = [
    'Pratipada', 'Dwitiya', 'Tritiya', 'Chaturthi', 'Panchami',
    'Shashthi', 'Saptami', 'Ashtami', 'Navami', 'Dashami',
    'Ekadashi', 'Dwadashi', 'Trayodashi', 'Chaturdashi', 'Purnima',
    'Pratipada', 'Dwitiya', 'Tritiya', 'Chaturthi', 'Panchami',
    'Shashthi', 'Saptami', 'Ashtami', 'Navami', 'Dashami',
    'Ekadashi', 'Dwadashi', 'Trayodashi', 'Chaturdashi', 'Amavasya',
]

VARAS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
VARA_LORDS = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']

KARANAS = [
    'Bava', 'Balava', 'Kaulava', 'Taitila', 'Gara', 'Vanija', 'Vishti',
    'Shakuni', 'Chatushpada', 'Naga', 'Kimstughna',
]

YOGAS_PANCHANGA = [
    'Vishkumbha', 'Priti', 'Ayushman', 'Saubhagya', 'Shobhana',
    'Atiganda', 'Sukarma', 'Dhriti', 'Shula', 'Ganda',
    'Vriddhi', 'Dhruva', 'Vyaghata', 'Harshana', 'Vajra',
    'Siddhi', 'Vyatipata', 'Variyan', 'Parigha', 'Shiva',
    'Siddha', 'Sadhya', 'Shubha', 'Shukla', 'Brahma',
    'Indra', 'Vaidhriti',
]


# ═══════════════════════════════════════════════════════════════════════════
# AYANAMSA VALUES
# ═══════════════════════════════════════════════════════════════════════════

AYANAMSA = {
    'LAHIRI': 1,
    'RAMAN': 3,
    'KRISHNAMURTI': 5,
    'YUKTESHWAR': 7,
    'JN_BHASIN': 8,
    'TRUE_CHITRA': 27,
    'TRUE_REVATI': 28,
    'SS_CITRA': 21,
}


# ═══════════════════════════════════════════════════════════════════════════
# UTILITY FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════

def get_rashi_lord(rashi_index):
    """Get the lord of a rashi"""
    return RASHI_LORDS[rashi_index]

def get_nakshatra_lord(nakshatra_index):
    """Get the lord of a nakshatra"""
    return NAKSHATRA_LORDS[nakshatra_index]

def get_planet_info(planet_name):
    """Get complete info about a planet"""
    return PLANETS.get(planet_name, {})

def get_house_info(house_number):
    """Get complete info about a house"""
    return HOUSES.get(house_number, {})

def is_benefic(planet_name):
    """Check if planet is naturally benefic"""
    return PLANETS.get(planet_name, {}).get('nature') == 'Benefic'

def is_malefic(planet_name):
    """Check if planet is naturally malefic"""
    return PLANETS.get(planet_name, {}).get('nature') == 'Malefic'

def get_aspects(planet_name):
    """Get aspects of a planet"""
    return PLANETS.get(planet_name, {}).get('aspects', [7])

def longitude_to_rashi(longitude):
    """Convert longitude to rashi index (0-11)"""
    return int(longitude / 30) % 12

def longitude_to_nakshatra(longitude):
    """Convert longitude to nakshatra index (0-26)"""
    return int(longitude / (360/27)) % 27

def longitude_to_pada(longitude):
    """Convert longitude to nakshatra pada (1-4)"""
    nak_long = longitude % (360/27)
    return int(nak_long / (360/108)) % 4 + 1

def get_navamsa_rashi(longitude):
    """Get navamsa (D9) rashi from longitude"""
    pada = int(longitude / (360/108)) % 108
    return pada % 12
