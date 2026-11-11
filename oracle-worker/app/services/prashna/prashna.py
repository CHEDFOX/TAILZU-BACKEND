"""
JYOTISH ENGINE - PRASHNA (HORARY) ASTROLOGY
Cast a chart for the MOMENT a question is asked.
No birth data required.

Principles:
1. The moment of asking IS the birth of the question
2. Moon is the primary significator (represents the querent's mind)
3. Lagna lord shows the querent, 7th lord shows the outcome
4. Applying aspects = events coming, separating = events passed
5. Moon's last aspect shows what happened, next aspect shows what will happen

Use cases:
- "Should I take this job?" → cast chart NOW → analyze
- Users who don't know their birth time
- Quick yes/no answers backed by real calculation
"""

from datetime import datetime
from typing import Dict
from ..core.constants import (
    PLANETS, RASHIS, RASHI_LORDS, RASHI_NAMES,
    KENDRA_HOUSES, TRIKONA_HOUSES, DUSTHANA_HOUSES,
)
from ..core.ephemeris import get_ephemeris

# Moon's speed threshold (degrees/day) — fast Moon = quick results
MOON_FAST_THRESHOLD = 13.0  # Average is ~13.2 deg/day
MOON_SLOW_THRESHOLD = 12.0

# Benefic/Malefic for Prashna
PRASHNA_BENEFICS = {'Jupiter', 'Venus', 'Mercury', 'Moon'}
PRASHNA_MALEFICS = {'Sun', 'Mars', 'Saturn', 'Rahu', 'Ketu'}

# Question category → house mapping for Prashna
PRASHNA_HOUSES = {
    'general':      {'house': 1, 'karaka': 'Moon'},
    'wealth':       {'house': 2, 'karaka': 'Jupiter'},
    'job':          {'house': 10, 'karaka': 'Saturn'},
    'marriage':     {'house': 7, 'karaka': 'Venus'},
    'love':         {'house': 5, 'karaka': 'Venus'},
    'children':     {'house': 5, 'karaka': 'Jupiter'},
    'health':       {'house': 1, 'karaka': 'Sun'},
    'education':    {'house': 4, 'karaka': 'Jupiter'},
    'travel':       {'house': 9, 'karaka': 'Jupiter'},
    'foreign':      {'house': 12, 'karaka': 'Rahu'},
    'property':     {'house': 4, 'karaka': 'Mars'},
    'legal':        {'house': 6, 'karaka': 'Mars'},
    'business':     {'house': 7, 'karaka': 'Mercury'},
    'exam':         {'house': 5, 'karaka': 'Mercury'},
    'lost_object':  {'house': 2, 'karaka': 'Moon'},
    'relationship': {'house': 7, 'karaka': 'Venus'},
    'spiritual':    {'house': 9, 'karaka': 'Jupiter'},
    'investment':   {'house': 5, 'karaka': 'Jupiter'},
}


class PrashnaKundli:
    """
    Horary (Prashna) chart analysis.
    Cast for the moment of question — no birth data needed.
    """

    def __init__(self, question_time: datetime = None,
                 latitude: float = 28.6139, longitude: float = 77.2090):
        """
        Args:
            question_time: When the question was asked (defaults to NOW)
            latitude: Location latitude (defaults to Delhi)
            longitude: Location longitude
        """
        if question_time is None:
            question_time = datetime.utcnow()

        self.question_time = question_time
        self.latitude = latitude
        self.longitude = longitude
        self.ephemeris = get_ephemeris()
        self._chart = None

    def generate_chart(self) -> Dict:
        """Generate the Prashna chart for the question moment."""
        if self._chart is not None:
            return self._chart

        self._chart = self.ephemeris.generate_chart(
            self.question_time, self.latitude, self.longitude
        )
        return self._chart

    def get_planets(self) -> Dict:
        chart = self.generate_chart()
        return chart['planets']

    def get_ascendant(self) -> Dict:
        chart = self.generate_chart()
        return chart['ascendant']

    def get_asc_rashi(self) -> int:
        return self.get_ascendant().get('rashi', 0)

    def get_house_lord(self, house: int) -> str:
        asc = self.get_asc_rashi()
        rashi = (asc + house - 1) % 12
        return RASHI_LORDS[rashi]

    def get_planet_house(self, planet: str) -> int:
        return self.get_planets().get(planet, {}).get('house', 1)

    def get_planet_rashi(self, planet: str) -> int:
        return self.get_planets().get(planet, {}).get('rashi', 0)

    def get_planet_longitude(self, planet: str) -> float:
        return self.get_planets().get(planet, {}).get('longitude', 0.0)

    def is_strong(self, planet: str) -> bool:
        r = self.get_planet_rashi(planet)
        p = PLANETS.get(planet, {})
        return r == p.get('exalted') or r in p.get('owns', [])

    def analyze_moon(self) -> Dict:
        """
        Moon analysis — the most important factor in Prashna.
        Moon represents the querent's state of mind and question.
        """
        planets = self.get_planets()
        moon = planets.get('Moon', {})
        moon_h = self.get_planet_house('Moon')
        moon_rashi = self.get_planet_rashi('Moon')
        moon_nak = moon.get('nakshatra_name', '')
        moon_speed = moon.get('speed', 13.0)
        moon_long = self.get_planet_longitude('Moon')

        # Moon strength
        if self.is_strong('Moon'):
            strength = 'Strong'
        elif moon_h in DUSTHANA_HOUSES:
            strength = 'Weak'
        elif moon_h in KENDRA_HOUSES + TRIKONA_HOUSES:
            strength = 'Good'
        else:
            strength = 'Moderate'

        # Moon speed → timing of results
        if moon_speed > MOON_FAST_THRESHOLD:
            speed_meaning = 'Fast Moon — results come quickly'
        elif moon_speed < MOON_SLOW_THRESHOLD:
            speed_meaning = 'Slow Moon — results delayed'
        else:
            speed_meaning = 'Normal speed — moderate timeline'

        # Waxing or waning
        sun_long = self.get_planet_longitude('Sun')
        diff = (moon_long - sun_long) % 360
        waxing = diff < 180

        # Moon conjunctions in Prashna
        conjunctions = []
        for planet in planets:
            if planet == 'Moon':
                continue
            if self.get_planet_house(planet) == moon_h:
                nature = 'benefic' if planet in PRASHNA_BENEFICS else 'malefic'
                conjunctions.append({'planet': planet, 'nature': nature})

        return {
            'house': moon_h,
            'rashi': moon_rashi,
            'rashi_name': RASHI_NAMES[moon_rashi],
            'nakshatra': moon_nak,
            'strength': strength,
            'speed': round(moon_speed, 2),
            'speed_meaning': speed_meaning,
            'waxing': waxing,
            'waxing_meaning': 'Waxing Moon — favorable, growth' if waxing else 'Waning Moon — less favorable, decline',
            'conjunctions': conjunctions,
        }

    def yes_no_analysis(self, category: str = 'general') -> Dict:
        """
        Structured Yes/No answer engine.
        Uses multiple factors to determine answer with confidence.
        """
        config = PRASHNA_HOUSES.get(category, PRASHNA_HOUSES['general'])
        query_house = config['house']
        karaka = config['karaka']

        planets = self.get_planets()
        moon_data = self.analyze_moon()

        yes_score = 0
        no_score = 0
        factors = []

        # Factor 1: Lagna lord strength
        l1 = self.get_house_lord(1)
        l1_house = self.get_planet_house(l1)
        if l1_house in KENDRA_HOUSES + TRIKONA_HOUSES:
            yes_score += 2
            factors.append(f'Lagna lord {l1} in favorable house {l1_house} → YES')
        elif l1_house in DUSTHANA_HOUSES:
            no_score += 2
            factors.append(f'Lagna lord {l1} in dusthana {l1_house} → NO')
        else:
            yes_score += 1
            factors.append(f'Lagna lord {l1} in house {l1_house} → Neutral')

        # Factor 2: Query house lord
        ql = self.get_house_lord(query_house)
        ql_house = self.get_planet_house(ql)
        if ql_house in KENDRA_HOUSES + TRIKONA_HOUSES:
            yes_score += 2
            factors.append(f'{query_house}th lord {ql} in favorable house {ql_house} → YES')
        elif ql_house in DUSTHANA_HOUSES:
            no_score += 2
            factors.append(f'{query_house}th lord {ql} in dusthana {ql_house} → NO')
        else:
            yes_score += 1
            factors.append(f'{query_house}th lord {ql} in house {ql_house} → Neutral')

        # Factor 3: Moon strength and phase
        if moon_data['waxing'] and moon_data['strength'] in ('Strong', 'Good'):
            yes_score += 2
            factors.append(f'Waxing Moon in {moon_data["rashi_name"]} ({moon_data["strength"]}) → YES')
        elif not moon_data['waxing'] and moon_data['strength'] == 'Weak':
            no_score += 2
            factors.append(f'Waning weak Moon → NO')
        else:
            yes_score += 1
            factors.append(f'Moon: {moon_data["strength"]}, {"waxing" if moon_data["waxing"] else "waning"} → Neutral')

        # Factor 4: Benefics/Malefics in query house
        occ = [p for p in planets if self.get_planet_house(p) == query_house]
        ben_occ = [p for p in occ if p in PRASHNA_BENEFICS]
        mal_occ = [p for p in occ if p in PRASHNA_MALEFICS]
        if ben_occ and not mal_occ:
            yes_score += 2
            factors.append(f'Benefics {ben_occ} in {query_house}th house → Strong YES')
        elif mal_occ and not ben_occ:
            no_score += 2
            factors.append(f'Malefics {mal_occ} in {query_house}th house → Strong NO')
        elif ben_occ and mal_occ:
            yes_score += 1
            factors.append(f'Mixed planets in {query_house}th house → Uncertain')

        # Factor 5: Karaka strength
        karaka_h = self.get_planet_house(karaka)
        if self.is_strong(karaka):
            yes_score += 2
            factors.append(f'Karaka {karaka} is strong → YES')
        elif karaka_h in DUSTHANA_HOUSES:
            no_score += 1
            factors.append(f'Karaka {karaka} in dusthana → NO')

        # Factor 6: Ascendant degree — very early or very late = unreliable
        asc_degree = self.get_ascendant().get('longitude', 0) % 30
        if asc_degree < 3:
            factors.append('WARNING: Very early ascendant degree — question may be premature')
            yes_score -= 1
        elif asc_degree > 27:
            factors.append('WARNING: Very late ascendant degree — matter already decided')
            yes_score -= 1

        # Calculate answer
        total = yes_score + no_score
        if total == 0:
            answer = 'Uncertain'
            confidence = 0.5
        else:
            yes_pct = yes_score / total
            if yes_pct >= 0.65:
                answer = 'Yes'
                confidence = min(yes_pct, 0.90)
            elif yes_pct <= 0.35:
                answer = 'No'
                confidence = min(1 - yes_pct, 0.90)
            else:
                answer = 'Uncertain (Mixed signals)'
                confidence = 0.50

        return {
            'answer': answer,
            'confidence': round(confidence, 2),
            'yes_score': yes_score,
            'no_score': no_score,
            'category': category,
            'query_house': query_house,
            'karaka': karaka,
            'factors': factors,
            'moon': moon_data,
            'timing': moon_data['speed_meaning'],
        }

    def get_timing_indication(self) -> Dict:
        """When will the result manifest?"""
        moon = self.analyze_moon()
        moon_h = moon['house']

        # Timing based on Moon's house
        if moon_h in [1, 4, 7, 10]:  # Kendras
            time_frame = 'Soon (days to weeks)'
            unit = 'days'
        elif moon_h in [2, 5, 8, 11]:  # Panapara
            time_frame = 'Moderate (weeks to months)'
            unit = 'weeks'
        else:  # Apoklima (3, 6, 9, 12)
            time_frame = 'Delayed (months)'
            unit = 'months'

        # Refine by Moon speed
        if moon['speed'] > MOON_FAST_THRESHOLD:
            time_frame += ' — Fast Moon accelerates'
        elif moon['speed'] < MOON_SLOW_THRESHOLD:
            time_frame += ' — Slow Moon delays'

        # Rashi quality timing
        rashi_quality = RASHIS.get(moon['rashi'], {}).get('quality', 'Fixed')
        if rashi_quality == 'Movable':
            quality_hint = 'Movable sign — quick manifestation'
        elif rashi_quality == 'Fixed':
            quality_hint = 'Fixed sign — slow but certain'
        else:
            quality_hint = 'Dual sign — may happen in stages'

        return {
            'time_frame': time_frame,
            'unit': unit,
            'moon_speed': moon['speed'],
            'rashi_quality': quality_hint,
            'moon_house': moon_h,
        }

    def get_direction_indication(self) -> Dict:
        """Direction from which opportunity/result comes."""
        asc_rashi = self.get_asc_rashi()
        direction = RASHIS.get(asc_rashi, {}).get('direction', 'Unknown')
        moon_rashi = self.get_planet_rashi('Moon')
        moon_direction = RASHIS.get(moon_rashi, {}).get('direction', 'Unknown')

        return {
            'primary_direction': direction,
            'secondary_direction': moon_direction,
            'meaning': f'Look towards {direction} for primary results, {moon_direction} for secondary',
        }

    def generate_full_prashna(self, category: str = 'general') -> Dict:
        """Generate complete Prashna analysis."""
        chart = self.generate_chart()
        asc = self.get_ascendant()
        moon = self.analyze_moon()
        yes_no = self.yes_no_analysis(category)
        timing = self.get_timing_indication()
        direction = self.get_direction_indication()

        return {
            'question_time': self.question_time.isoformat(),
            'category': category,
            'ascendant': {
                'rashi': asc.get('rashi_name', ''),
                'degree': round(asc.get('longitude', 0) % 30, 2),
                'nakshatra': asc.get('nakshatra_name', ''),
            },
            'moon_analysis': moon,
            'answer': yes_no,
            'timing': timing,
            'direction': direction,
            'planets': {
                name: {
                    'rashi': data.get('rashi_name', ''),
                    'house': data.get('house', 1),
                    'retrograde': data.get('retrograde', False),
                }
                for name, data in self.get_planets().items()
            },
            'summary': self._build_summary(yes_no, timing, moon),
        }

    def _build_summary(self, yes_no: Dict, timing: Dict, moon: Dict) -> str:
        """Build human-readable summary for AI consumption."""
        answer = yes_no['answer']
        conf = yes_no['confidence']
        time_str = timing['time_frame']

        if answer == 'Yes':
            return (f'The Prashna chart indicates YES ({int(conf*100)}% confidence). '
                    f'Moon is {moon["strength"].lower()} and {"waxing" if moon["waxing"] else "waning"}. '
                    f'Timeline: {time_str}.')
        elif answer == 'No':
            return (f'The Prashna chart indicates NO ({int(conf*100)}% confidence). '
                    f'Moon is {moon["strength"].lower()} and {"waxing" if moon["waxing"] else "waning"}. '
                    f'Conditions not favorable at this time.')
        else:
            return (f'The Prashna chart shows MIXED signals ({int(conf*100)}% certainty). '
                    f'Moon is {moon["strength"].lower()}. '
                    f'Suggest waiting for clearer planetary alignment.')


def cast_prashna(category: str = 'general', latitude: float = 28.6139,
                 longitude: float = 77.2090) -> Dict:
    """Quick Prashna — cast chart for NOW and analyze."""
    pk = PrashnaKundli(latitude=latitude, longitude=longitude)
    return pk.generate_full_prashna(category)
