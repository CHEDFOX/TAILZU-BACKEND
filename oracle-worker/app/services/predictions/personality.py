"""
JYOTISH ENGINE - PERSONALITY PROFILING
- Nakshatra personality (27 × 4 padas = 108 profiles)
- Rashi (Moon sign) personality
- Dasha personality shifts
"""

from typing import Dict
from ..core.constants import RASHI_NAMES, NAKSHATRAS

RASHI_PERSONALITY = {
    0: {'sign': 'Aries', 'element': 'Fire', 'quality': 'Cardinal',
        'traits': 'Pioneering, courageous, competitive, impatient, leader, direct, energetic',
        'strengths': 'Courage, initiative, enthusiasm, honesty',
        'weaknesses': 'Impulsive, aggressive, short-tempered, self-centered',
        'career': 'Military, sports, entrepreneurship, surgery, police, engineering',
        'love_style': 'Passionate, direct, falls fast, needs independence'},
    1: {'sign': 'Taurus', 'element': 'Earth', 'quality': 'Fixed',
        'traits': 'Stable, sensual, stubborn, reliable, patient, luxury-loving, artistic',
        'strengths': 'Patience, reliability, determination, artistic sense',
        'weaknesses': 'Stubborn, possessive, materialistic, resistant to change',
        'career': 'Banking, agriculture, art, music, food industry, luxury goods',
        'love_style': 'Loyal, sensual, possessive, slow to commit but devoted'},
    2: {'sign': 'Gemini', 'element': 'Air', 'quality': 'Mutable',
        'traits': 'Intellectual, communicative, versatile, restless, witty, dual nature',
        'strengths': 'Communication, adaptability, intelligence, humor',
        'weaknesses': 'Inconsistent, superficial, anxious, gossip-prone',
        'career': 'Writing, journalism, teaching, sales, IT, trading',
        'love_style': 'Flirtatious, needs mental stimulation, variety-seeking'},
    3: {'sign': 'Cancer', 'element': 'Water', 'quality': 'Cardinal',
        'traits': 'Nurturing, emotional, protective, intuitive, home-loving, moody',
        'strengths': 'Empathy, intuition, loyalty, nurturing nature',
        'weaknesses': 'Moody, clingy, oversensitive, manipulative when hurt',
        'career': 'Nursing, hospitality, real estate, cooking, psychology',
        'love_style': 'Deeply caring, needs security, family-oriented, romantic'},
    4: {'sign': 'Leo', 'element': 'Fire', 'quality': 'Fixed',
        'traits': 'Dramatic, generous, proud, loyal, creative, attention-seeking, regal',
        'strengths': 'Leadership, generosity, creativity, confidence',
        'weaknesses': 'Arrogant, stubborn, needs constant attention, bossy',
        'career': 'Entertainment, politics, management, luxury brands, gold',
        'love_style': 'Grand romantic, loyal, demanding, lavish in love'},
    5: {'sign': 'Virgo', 'element': 'Earth', 'quality': 'Mutable',
        'traits': 'Analytical, perfectionist, health-conscious, service-oriented, critical',
        'strengths': 'Analysis, attention to detail, service, health awareness',
        'weaknesses': 'Over-critical, worry-prone, perfectionist anxiety',
        'career': 'Medicine, accounting, editing, research, quality control',
        'love_style': 'Shows love through service, practical, slow to trust'},
    6: {'sign': 'Libra', 'element': 'Air', 'quality': 'Cardinal',
        'traits': 'Diplomatic, balanced, aesthetic, indecisive, partnership-oriented',
        'strengths': 'Diplomacy, fairness, aesthetic sense, charm',
        'weaknesses': 'Indecisive, people-pleasing, avoids confrontation',
        'career': 'Law, diplomacy, fashion, art, counseling, mediation',
        'love_style': 'Romantic idealist, needs partnership, harmonious'},
    7: {'sign': 'Scorpio', 'element': 'Water', 'quality': 'Fixed',
        'traits': 'Intense, transformative, secretive, powerful, passionate, magnetic',
        'strengths': 'Depth, loyalty, investigation, transformation power',
        'weaknesses': 'Jealous, secretive, vengeful, obsessive',
        'career': 'Research, detective, psychology, surgery, occult, insurance',
        'love_style': 'All or nothing, deeply loyal, possessive, passionate'},
    8: {'sign': 'Sagittarius', 'element': 'Fire', 'quality': 'Mutable',
        'traits': 'Philosophical, adventurous, optimistic, blunt, freedom-loving',
        'strengths': 'Optimism, wisdom, adventure, honesty, humor',
        'weaknesses': 'Tactless, irresponsible, over-promising, restless',
        'career': 'Teaching, travel, publishing, law, religion, sports',
        'love_style': 'Freedom-loving, adventurous, honest, commitment-shy initially'},
    9: {'sign': 'Capricorn', 'element': 'Earth', 'quality': 'Cardinal',
        'traits': 'Ambitious, disciplined, practical, cautious, traditional, hardworking',
        'strengths': 'Discipline, ambition, patience, responsibility',
        'weaknesses': 'Cold, pessimistic, rigid, workaholic, status-obsessed',
        'career': 'Government, management, construction, mining, banking, politics',
        'love_style': 'Slow, traditional, loyal, provider, shows love through stability'},
    10: {'sign': 'Aquarius', 'element': 'Air', 'quality': 'Fixed',
         'traits': 'Humanitarian, eccentric, independent, intellectual, detached, innovative',
         'strengths': 'Innovation, humanitarianism, independence, intellect',
         'weaknesses': 'Emotionally detached, stubborn, unpredictable, aloof',
         'career': 'Technology, science, social work, astrology, aviation',
         'love_style': 'Unconventional, needs space, intellectual connection first'},
    11: {'sign': 'Pisces', 'element': 'Water', 'quality': 'Mutable',
         'traits': 'Intuitive, compassionate, dreamy, artistic, spiritual, escapist',
         'strengths': 'Compassion, intuition, creativity, spirituality',
         'weaknesses': 'Escapist, victim mentality, boundary issues, addictive tendencies',
         'career': 'Arts, music, healing, charity, spirituality, cinema',
         'love_style': 'Deeply romantic, sacrificing, dreamy, soul-connection seeking'},
}

DASHA_PERSONALITY = {
    'Sun': {'shift': 'Confident, authoritative, ego-centered, wants recognition', 'focus': 'Self, career, authority, father'},
    'Moon': {'shift': 'Emotional, nurturing, sensitive, public-oriented', 'focus': 'Mind, mother, home, public'},
    'Mars': {'shift': 'Aggressive, action-oriented, competitive, impatient', 'focus': 'Property, siblings, courage, conflict'},
    'Mercury': {'shift': 'Intellectual, communicative, business-minded, curious', 'focus': 'Education, business, communication'},
    'Jupiter': {'shift': 'Wise, philosophical, expansive, optimistic, generous', 'focus': 'Wisdom, children, wealth, teaching'},
    'Venus': {'shift': 'Romantic, artistic, luxury-seeking, pleasure-oriented', 'focus': 'Love, marriage, arts, vehicles'},
    'Saturn': {'shift': 'Disciplined, serious, hardworking, burdened, patient', 'focus': 'Karma, service, hard work, delays'},
    'Rahu': {'shift': 'Restless, obsessive, ambitious, confused, unconventional', 'focus': 'Foreign, technology, obsession, illusion'},
    'Ketu': {'shift': 'Detached, spiritual, introspective, letting go', 'focus': 'Spirituality, past karma, liberation'},
}


class PersonalityEngine:
    def __init__(self, engine):
        self.engine = engine
        self.planets = engine.planets
        self.moon_rashi = engine.planets.get('Moon', {}).get('rashi', 0)
        self.moon_nakshatra = engine.planets.get('Moon', {}).get('nakshatra_name', '')
        self.asc_rashi = engine.ascendant_rashi

    def get_moon_sign_personality(self) -> Dict:
        return {
            'moon_sign': RASHI_NAMES[self.moon_rashi],
            **RASHI_PERSONALITY.get(self.moon_rashi, {}),
        }

    def get_ascendant_personality(self) -> Dict:
        return {
            'ascendant': RASHI_NAMES[self.asc_rashi],
            'description': 'How the world sees you',
            **RASHI_PERSONALITY.get(self.asc_rashi, {}),
        }

    def get_nakshatra_personality(self) -> Dict:
        nak_name = self.moon_nakshatra
        for idx, ndata in NAKSHATRAS.items():
            if ndata['name'] == nak_name:
                return {
                    'nakshatra': nak_name,
                    'ruler': ndata.get('ruler', ''),
                    'deity': ndata.get('deity', ''),
                    'gana': ndata.get('gana', ''),
                    'animal': ndata.get('animal', ''),
                    'symbol': ndata.get('symbol', ''),
                    'nadi': ndata.get('nadi', ''),
                }
        return {'nakshatra': nak_name}

    def get_dasha_personality(self) -> Dict:
        dasha = self.engine.get_vimshottari_dasha()
        maha_lord = dasha.get('mahadasha', {}).get('lord', '')
        antar_lord = dasha.get('antardasha', {}).get('lord', '')
        maha_p = DASHA_PERSONALITY.get(maha_lord, {})
        antar_p = DASHA_PERSONALITY.get(antar_lord, {})
        return {
            'current_dasha': f'{maha_lord}/{antar_lord}',
            'mahadasha_influence': maha_p,
            'antardasha_influence': antar_p,
            'combined': f'Currently {maha_p.get("shift", "")}. Sub-influence of {antar_p.get("shift", "")}.',
        }

    def generate_full_personality(self) -> Dict:
        return {
            'moon_sign': self.get_moon_sign_personality(),
            'ascendant': self.get_ascendant_personality(),
            'nakshatra': self.get_nakshatra_personality(),
            'dasha_personality': self.get_dasha_personality(),
        }


def get_personality(engine) -> Dict:
    pe = PersonalityEngine(engine)
    return pe.generate_full_personality()
