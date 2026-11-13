"""
JYOTISH ENGINE - 108 NAKSHATRA PADA PROFILES
Each of 27 nakshatras × 4 padas = 108 unique life profiles.
The Moon's pada at birth gives extremely specific personality + destiny reading.
"""

from typing import Dict
from ..core.constants import NAKSHATRAS, NAKSHATRA_NAMES

# Navamsa rashi for each pada (starting from Aries for Ashwini pada 1)
PADA_NAVAMSA = [
    'Aries', 'Taurus', 'Gemini', 'Cancer',     # Ashwini 1-4
    'Leo', 'Virgo', 'Libra', 'Scorpio',         # Bharani 1-4
    'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',  # Krittika 1-4
    'Aries', 'Taurus', 'Gemini', 'Cancer',      # Rohini 1-4
    'Leo', 'Virgo', 'Libra', 'Scorpio',         # Mrigashira 1-4
    'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',  # Ardra 1-4
    'Aries', 'Taurus', 'Gemini', 'Cancer',      # Punarvasu 1-4
    'Leo', 'Virgo', 'Libra', 'Scorpio',         # Pushya 1-4
    'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',  # Ashlesha 1-4
    'Aries', 'Taurus', 'Gemini', 'Cancer',      # Magha 1-4
    'Leo', 'Virgo', 'Libra', 'Scorpio',         # PPhalguni 1-4
    'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',  # UPhalguni 1-4
    'Aries', 'Taurus', 'Gemini', 'Cancer',      # Hasta 1-4
    'Leo', 'Virgo', 'Libra', 'Scorpio',         # Chitra 1-4
    'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',  # Swati 1-4
    'Aries', 'Taurus', 'Gemini', 'Cancer',      # Vishakha 1-4
    'Leo', 'Virgo', 'Libra', 'Scorpio',         # Anuradha 1-4
    'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',  # Jyeshtha 1-4
    'Aries', 'Taurus', 'Gemini', 'Cancer',      # Mula 1-4
    'Leo', 'Virgo', 'Libra', 'Scorpio',         # PAshadha 1-4
    'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',  # UAshadha 1-4
    'Aries', 'Taurus', 'Gemini', 'Cancer',      # Shravana 1-4
    'Leo', 'Virgo', 'Libra', 'Scorpio',         # Dhanishta 1-4
    'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',  # Shatabhisha 1-4
    'Aries', 'Taurus', 'Gemini', 'Cancer',      # PBhadrapada 1-4
    'Leo', 'Virgo', 'Libra', 'Scorpio',         # UBhadrapada 1-4
    'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',  # Revati 1-4
]

# Detailed pada profiles (27 nakshatras × 4 padas)
PADA_PROFILES = {
    ('Ashwini', 1): {'navamsa': 'Aries', 'profile': 'Fearless pioneer, natural leader, quick healer. First to act, first to succeed. Physical stamina exceptional.', 'career': 'Emergency medicine, sports, military leadership', 'sound': 'Chu'},
    ('Ashwini', 2): {'navamsa': 'Taurus', 'profile': 'Healing through wealth and resources. Practical approach to miracles. Steady, reliable first responder.', 'career': 'Veterinary, pharmacy, luxury healing', 'sound': 'Che'},
    ('Ashwini', 3): {'navamsa': 'Gemini', 'profile': 'Intellectual healer. Communicates healing wisdom. Writes about health. Quick mind, quick hands.', 'career': 'Medical writing, health journalism, therapy', 'sound': 'Cho'},
    ('Ashwini', 4): {'navamsa': 'Cancer', 'profile': 'Nurturing healer. Emotionally attuned to suffering. Home remedies expert. Maternal healing energy.', 'career': 'Nursing, pediatrics, home healthcare', 'sound': 'La'},
    ('Bharani', 1): {'navamsa': 'Leo', 'profile': 'Dramatic creator. Transforms through art. Bold, unafraid of taboos. Creative fire. Natural entertainer.', 'career': 'Film, drama, creative director', 'sound': 'Li'},
    ('Bharani', 2): {'navamsa': 'Virgo', 'profile': 'Disciplined transformer. Methodical approach to deep subjects. Research-oriented. Detailed, precise.', 'career': 'Forensics, research, accounting', 'sound': 'Lu'},
    ('Bharani', 3): {'navamsa': 'Libra', 'profile': 'Balanced approach to extremes. Diplomatic in crisis. Aesthetic sense even in darkness. Partnership-oriented.', 'career': 'Counseling, diplomacy, law', 'sound': 'Le'},
    ('Bharani', 4): {'navamsa': 'Scorpio', 'profile': 'Deepest transformer. Unflinching in face of death and rebirth. Occult mastery. Intense, magnetic, powerful.', 'career': 'Surgery, occult, crisis management', 'sound': 'Lo'},
    ('Krittika', 1): {'navamsa': 'Sagittarius', 'profile': 'Philosophical fire. Burns for truth and justice. Teacher who cuts through illusion. Righteous anger.', 'career': 'Law, preaching, activism', 'sound': 'A'},
    ('Krittika', 2): {'navamsa': 'Capricorn', 'profile': 'Disciplined flame. Structured purification. Authority through fire. Government cook. Practical warrior.', 'career': 'Government, military cooking, structured healing', 'sound': 'Ee'},
    ('Krittika', 3): {'navamsa': 'Aquarius', 'profile': 'Humanitarian fire. Burns for collective good. Innovative purification. Technology meets tradition.', 'career': 'Social activism, tech innovation, reformer', 'sound': 'U'},
    ('Krittika', 4): {'navamsa': 'Pisces', 'profile': 'Spiritual flame. Fire of compassion. Sacrificial nature. Burns ego for liberation. Temple priest.', 'career': 'Religious leadership, spiritual teaching', 'sound': 'Ea'},
    ('Rohini', 1): {'navamsa': 'Aries', 'profile': 'Creative pioneer. First to create beauty. Fashion innovator. Artistic courage. Bold aesthetics.', 'career': 'Fashion design, art direction, beauty startup', 'sound': 'O'},
    ('Rohini', 2): {'navamsa': 'Taurus', 'profile': 'Pure creator. Most artistic pada. Music, beauty, luxury incarnate. Sensual, grounded, abundant.', 'career': 'Music, luxury goods, agriculture, cooking', 'sound': 'Va'},
    ('Rohini', 3): {'navamsa': 'Gemini', 'profile': 'Communicative creator. Writes beautifully. Sells beauty. Marketing genius. Dual creative talent.', 'career': 'Marketing, advertising, content creation', 'sound': 'Vi'},
    ('Rohini', 4): {'navamsa': 'Cancer', 'profile': 'Nurturing creator. Creates home beauty. Interior design. Cooking as art. Emotional creativity.', 'career': 'Interior design, hospitality, catering', 'sound': 'Vo'},
}


class NakshatraProfiles:
    def __init__(self, engine):
        self.engine = engine
        moon = engine.planets.get('Moon', {})
        self.moon_longitude = moon.get('longitude', 0)
        from ..core.utils import get_nakshatra_from_longitude, get_nakshatra_pada
        from ..core.constants import NAKSHATRA_NAMES
        nak_idx = get_nakshatra_from_longitude(self.moon_longitude)
        self.moon_nak = moon.get('nakshatra_name', '') or NAKSHATRA_NAMES[nak_idx]
        self.moon_pada = moon.get('pada', None) or get_nakshatra_pada(self.moon_longitude)

    def get_moon_pada_profile(self) -> Dict:
        """Get detailed profile for birth Moon's nakshatra pada."""
        key = (self.moon_nak, self.moon_pada)
        profile = PADA_PROFILES.get(key, None)

        # Calculate pada index for navamsa
        nak_index = 0
        for i, name in enumerate(NAKSHATRA_NAMES):
            if name == self.moon_nak:
                nak_index = i
                break
        pada_index = nak_index * 4 + (self.moon_pada - 1)
        navamsa = PADA_NAVAMSA[pada_index] if pada_index < len(PADA_NAVAMSA) else 'Unknown'

        # Nakshatra data
        nak_data = NAKSHATRAS.get(nak_index, {})

        if profile:
            return {
                'nakshatra': self.moon_nak,
                'pada': self.moon_pada,
                'navamsa_rashi': navamsa,
                'ruler': nak_data.get('ruler', ''),
                'deity': nak_data.get('deity', ''),
                'symbol': nak_data.get('symbol', ''),
                'gana': nak_data.get('gana', ''),
                'animal': nak_data.get('animal', ''),
                'nadi': nak_data.get('nadi', ''),
                'profile': profile['profile'],
                'career_hint': profile.get('career', ''),
                'name_sound': profile.get('sound', ''),
            }
        else:
            # Generic profile from nakshatra data
            return {
                'nakshatra': self.moon_nak,
                'pada': self.moon_pada,
                'navamsa_rashi': navamsa,
                'ruler': nak_data.get('ruler', ''),
                'deity': nak_data.get('deity', ''),
                'symbol': nak_data.get('symbol', ''),
                'gana': nak_data.get('gana', ''),
                'animal': nak_data.get('animal', ''),
                'nadi': nak_data.get('nadi', ''),
                'profile': f'{self.moon_nak} Pada {self.moon_pada} in {navamsa} Navamsa. '
                           f'Ruled by {nak_data.get("ruler", "Unknown")}, '
                           f'deity {nak_data.get("deity", "Unknown")}.',
                'career_hint': 'Based on nakshatra lord and navamsa qualities',
                'name_sound': '',
            }

    def get_all_planet_pada_info(self) -> Dict:
        """Get pada info for all planets."""
        results = {}
        for planet, data in self.engine.planets.items():
            nak = data.get('nakshatra_name', '')
            pada = data.get('pada', 1)
            nak_index = 0
            for i, name in enumerate(NAKSHATRA_NAMES):
                if name == nak:
                    nak_index = i
                    break
            pada_index = nak_index * 4 + (pada - 1)
            navamsa = PADA_NAVAMSA[pada_index] if pada_index < len(PADA_NAVAMSA) else 'Unknown'

            results[planet] = {
                'nakshatra': nak,
                'pada': pada,
                'navamsa': navamsa,
                'ruler': NAKSHATRAS.get(nak_index, {}).get('ruler', ''),
            }
        return results


def get_nakshatra_profile(engine) -> Dict:
    np = NakshatraProfiles(engine)
    return {
        'moon_profile': np.get_moon_pada_profile(),
        'all_planets': np.get_all_planet_pada_info(),
    }
