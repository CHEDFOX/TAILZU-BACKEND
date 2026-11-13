"""
WESTERN ASTROLOGY — PROFILES & INTERPRETATION
Sign archetypes, planet-in-sign meanings, house themes.
"""

from typing import Dict

SIGN_PROFILES = {
    "Aries": {
        "archetype": "The Pioneer", "element": "Fire", "modality": "Cardinal",
        "ruling_planet": "Mars", "polarity": "Yang",
        "traits": ["courageous", "independent", "impulsive", "competitive", "honest"],
        "shadow": ["impatient", "aggressive", "self-centered"],
        "body_part": "Head", "color": "Red", "stone": "Diamond",
    },
    "Taurus": {
        "archetype": "The Builder", "element": "Earth", "modality": "Fixed",
        "ruling_planet": "Venus", "polarity": "Yin",
        "traits": ["reliable", "patient", "sensual", "determined", "practical"],
        "shadow": ["stubborn", "possessive", "materialistic"],
        "body_part": "Throat/Neck", "color": "Green", "stone": "Emerald",
    },
    "Gemini": {
        "archetype": "The Messenger", "element": "Air", "modality": "Mutable",
        "ruling_planet": "Mercury", "polarity": "Yang",
        "traits": ["curious", "adaptable", "witty", "communicative", "versatile"],
        "shadow": ["inconsistent", "superficial", "restless"],
        "body_part": "Arms/Lungs", "color": "Yellow", "stone": "Agate",
    },
    "Cancer": {
        "archetype": "The Nurturer", "element": "Water", "modality": "Cardinal",
        "ruling_planet": "Moon", "polarity": "Yin",
        "traits": ["nurturing", "intuitive", "protective", "empathetic", "tenacious"],
        "shadow": ["moody", "clingy", "oversensitive"],
        "body_part": "Chest/Stomach", "color": "Silver", "stone": "Pearl",
    },
    "Leo": {
        "archetype": "The Sovereign", "element": "Fire", "modality": "Fixed",
        "ruling_planet": "Sun", "polarity": "Yang",
        "traits": ["generous", "confident", "creative", "warm", "dramatic"],
        "shadow": ["arrogant", "attention-seeking", "domineering"],
        "body_part": "Heart/Spine", "color": "Gold", "stone": "Ruby",
    },
    "Virgo": {
        "archetype": "The Analyst", "element": "Earth", "modality": "Mutable",
        "ruling_planet": "Mercury", "polarity": "Yin",
        "traits": ["analytical", "precise", "helpful", "modest", "diligent"],
        "shadow": ["critical", "anxious", "perfectionist"],
        "body_part": "Intestines", "color": "Navy", "stone": "Sapphire",
    },
    "Libra": {
        "archetype": "The Diplomat", "element": "Air", "modality": "Cardinal",
        "ruling_planet": "Venus", "polarity": "Yang",
        "traits": ["balanced", "charming", "fair-minded", "social", "artistic"],
        "shadow": ["indecisive", "people-pleasing", "avoidant"],
        "body_part": "Kidneys/Lower Back", "color": "Pink", "stone": "Opal",
    },
    "Scorpio": {
        "archetype": "The Alchemist", "element": "Water", "modality": "Fixed",
        "ruling_planet": "Pluto", "polarity": "Yin",
        "traits": ["intense", "perceptive", "transformative", "passionate", "strategic"],
        "shadow": ["jealous", "controlling", "secretive"],
        "body_part": "Reproductive organs", "color": "Dark Red", "stone": "Topaz",
    },
    "Sagittarius": {
        "archetype": "The Explorer", "element": "Fire", "modality": "Mutable",
        "ruling_planet": "Jupiter", "polarity": "Yang",
        "traits": ["adventurous", "optimistic", "philosophical", "honest", "free-spirited"],
        "shadow": ["reckless", "tactless", "commitment-phobic"],
        "body_part": "Hips/Thighs", "color": "Purple", "stone": "Turquoise",
    },
    "Capricorn": {
        "archetype": "The Authority", "element": "Earth", "modality": "Cardinal",
        "ruling_planet": "Saturn", "polarity": "Yin",
        "traits": ["ambitious", "disciplined", "responsible", "pragmatic", "patient"],
        "shadow": ["cold", "rigid", "workaholic"],
        "body_part": "Knees/Bones", "color": "Brown", "stone": "Garnet",
    },
    "Aquarius": {
        "archetype": "The Visionary", "element": "Air", "modality": "Fixed",
        "ruling_planet": "Uranus", "polarity": "Yang",
        "traits": ["innovative", "humanitarian", "independent", "intellectual", "original"],
        "shadow": ["detached", "rebellious", "unpredictable"],
        "body_part": "Ankles/Circulation", "color": "Electric Blue", "stone": "Amethyst",
    },
    "Pisces": {
        "archetype": "The Mystic", "element": "Water", "modality": "Mutable",
        "ruling_planet": "Neptune", "polarity": "Yin",
        "traits": ["compassionate", "intuitive", "imaginative", "spiritual", "gentle"],
        "shadow": ["escapist", "boundary-less", "martyr-like"],
        "body_part": "Feet", "color": "Sea Green", "stone": "Aquamarine",
    },
}

HOUSE_THEMES = {
    1: {"theme": "Self & Identity", "keywords": ["appearance", "personality", "first impressions", "vitality"]},
    2: {"theme": "Values & Possessions", "keywords": ["money", "self-worth", "material security", "talents"]},
    3: {"theme": "Communication & Mind", "keywords": ["siblings", "short trips", "learning", "writing"]},
    4: {"theme": "Home & Roots", "keywords": ["family", "mother", "emotional foundation", "real estate"]},
    5: {"theme": "Creativity & Romance", "keywords": ["children", "romance", "play", "self-expression"]},
    6: {"theme": "Health & Service", "keywords": ["daily routine", "work", "health habits", "pets"]},
    7: {"theme": "Partnerships", "keywords": ["marriage", "business partners", "contracts", "open enemies"]},
    8: {"theme": "Transformation & Shared Resources", "keywords": ["death/rebirth", "intimacy", "inheritance", "psychology"]},
    9: {"theme": "Philosophy & Expansion", "keywords": ["higher education", "travel", "beliefs", "publishing"]},
    10: {"theme": "Career & Public Image", "keywords": ["ambition", "reputation", "authority", "father"]},
    11: {"theme": "Community & Future", "keywords": ["friends", "groups", "hopes", "social causes"]},
    12: {"theme": "Unconscious & Spirituality", "keywords": ["solitude", "hidden enemies", "karma", "dreams"]},
}


class WesternProfiles:
    """Interpretive layer for Western chart data."""

    def __init__(self, chart):
        self.chart = chart
        self.chart._ensure_calculated()

    def get_sun_profile(self) -> Dict:
        sun = self.chart.planets.get('Sun', {})
        sign = sun.get('sign', 'Aries')
        profile = SIGN_PROFILES.get(sign, {})
        return {
            'sign': sign, 'degree': sun.get('degree', 0), 'house': sun.get('house', 1),
            'archetype': profile.get('archetype', ''),
            'core_identity': f"Your essential self expresses through {sign} energy — {', '.join(profile.get('traits', [])[:3])}",
            'house_theme': HOUSE_THEMES.get(sun.get('house', 1), {}).get('theme', ''),
            'dignity': sun.get('dignity', 'Peregrine'),
        }

    def get_moon_profile(self) -> Dict:
        moon = self.chart.planets.get('Moon', {})
        sign = moon.get('sign', 'Cancer')
        profile = SIGN_PROFILES.get(sign, {})
        return {
            'sign': sign, 'degree': moon.get('degree', 0), 'house': moon.get('house', 1),
            'emotional_nature': f"Your emotional world is {sign} — {', '.join(profile.get('traits', [])[:3])}",
            'needs': profile.get('traits', []),
            'shadow': profile.get('shadow', []),
        }

    def get_rising_profile(self) -> Dict:
        big_three = self.chart.get_big_three()
        sign = big_three['rising_sign']
        profile = SIGN_PROFILES.get(sign, {})
        return {
            'sign': sign, 'degree': big_three['ascendant_degree'],
            'archetype': profile.get('archetype', ''),
            'first_impression': f"You come across as {', '.join(profile.get('traits', [])[:3])}",
            'chart_ruler': big_three['chart_ruler'],
            'ruler_house': big_three['chart_ruler_house'],
        }

    def get_full_profile(self) -> Dict:
        return {
            'sun': self.get_sun_profile(),
            'moon': self.get_moon_profile(),
            'rising': self.get_rising_profile(),
            'element_balance': self.chart.get_element_balance(),
            'sign_profiles': SIGN_PROFILES,
            'house_themes': HOUSE_THEMES,
        }
