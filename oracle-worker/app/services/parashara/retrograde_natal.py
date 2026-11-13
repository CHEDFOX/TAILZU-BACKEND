"""
JYOTISH ENGINE - NATAL RETROGRADE ANALYSIS
Retrograde planets in birth chart = past-life karma significance.
"""

from typing import Dict

RETRO_MEANINGS = {
    'Mercury': {'karma': 'Past-life communication/education karma. May need to relearn, rethink.', 'effects': 'Delayed speech, unique thinking, revisits old ideas, strong inner voice'},
    'Venus': {'karma': 'Past-life relationship/beauty karma. Unfinished love from past life.', 'effects': 'Delayed romance, unconventional relationships, inner beauty over external'},
    'Mars': {'karma': 'Past-life aggression/action karma. Suppressed anger from past.', 'effects': 'Internalized anger, delayed initiatives, strong internal drive, strategic patience'},
    'Jupiter': {'karma': 'Past-life wisdom/dharma karma. Had spiritual knowledge before.', 'effects': 'Inner wisdom, unconventional beliefs, delayed fortune, philosophical depth'},
    'Saturn': {'karma': 'Past-life duty/karma overload. Carrying heavy past-life responsibilities.', 'effects': 'Internalized discipline, delayed career, works harder than others, eventual mastery'},
}


class RetrogradeNatal:
    def __init__(self, engine):
        self.planets = engine.planets

    def analyze(self) -> Dict:
        retro_planets = []
        for planet in ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']:
            if self.planets.get(planet, {}).get('retrograde', False):
                meaning = RETRO_MEANINGS.get(planet, {})
                retro_planets.append({
                    'planet': planet,
                    'house': self.planets[planet].get('house', 1),
                    'past_life_karma': meaning.get('karma', ''),
                    'effects': meaning.get('effects', ''),
                })

        return {
            'retrograde_count': len(retro_planets),
            'planets': retro_planets,
            'significance': 'High karmic chart' if len(retro_planets) >= 3 else
                           'Moderate karmic load' if len(retro_planets) >= 1 else
                           'Low karmic backlog — fresh start chart',
        }


def analyze_natal_retrogrades(engine):
    return RetrogradeNatal(engine).analyze()
