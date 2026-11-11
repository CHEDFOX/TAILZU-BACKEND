"""
JYOTISH ENGINE - DEEP TRANSIT ANALYSIS
- Gochar predictions per planet per house from Moon
- Sade Sati phase analysis (rising/peak/setting)
- Retrograde effects
- Eclipse impact on natal chart
"""

from typing import Dict, List
from ..core.constants import (
    PLANETS, RASHI_NAMES,
)

# Classical Gochar (transit) effects: planet transiting Nth house from Moon
GOCHAR_EFFECTS = {
    'Jupiter': {
        1: ('Expenses, travel, health issues', 'Negative'),
        2: ('Wealth, family happiness, speech improves', 'Positive'),
        3: ('Obstacles, enemies, position change', 'Negative'),
        4: ('Domestic problems, vehicle issues, sadness', 'Negative'),
        5: ('Children prosperity, intelligence, new connections', 'Positive'),
        6: ('Victory over enemies, health improves, debts clear', 'Positive'),
        7: ('Marriage, partnership, travel, spouse happiness', 'Positive'),
        8: ('Obstacles, delays, health caution, legal issues', 'Negative'),
        9: ('Fortune, promotion, religious activities, father', 'Positive'),
        10: ('Career challenges, demotion risk, travel', 'Negative'),
        11: ('Income increase, gains, desires fulfilled, good news', 'Positive'),
        12: ('Expenses, travel, loss, change of place', 'Negative'),
    },
    'Saturn': {
        1: ('Health issues, slow progress, hard work (Sade Sati)', 'Negative'),
        2: ('Financial pressure, family problems, speech issues', 'Negative'),
        3: ('Gains, promotion, courage, victory over enemies', 'Positive'),
        4: ('Domestic stress, mother health, property loss', 'Negative'),
        5: ('Children issues, speculation loss, mind stress', 'Negative'),
        6: ('Victory, debts clear, health improves, enemy defeated', 'Positive'),
        7: ('Marriage stress, partnership issues, travel', 'Negative'),
        8: ('Health crisis, accidents, chronic issues, obstacles', 'Negative'),
        9: ('Obstacles in fortune, father issues, religious doubts', 'Negative'),
        10: ('Career change, hard work rewarded eventually', 'Mixed'),
        11: ('Income, gains, property, desires fulfilled', 'Positive'),
        12: ('Expenses, hospital, foreign travel, isolation', 'Negative'),
    },
    'Rahu': {
        1: ('Health confusion, identity crisis, foreign influence', 'Negative'),
        2: ('Financial confusion, family discord, unusual expenses', 'Negative'),
        3: ('Courage in unusual ways, technology gains, adventure', 'Positive'),
        4: ('Home changes, property through unusual means', 'Mixed'),
        5: ('Speculation risk, children worry, unconventional romance', 'Negative'),
        6: ('Victory through technology, enemies confused', 'Positive'),
        7: ('Unusual partnerships, foreign spouse/business', 'Mixed'),
        8: ('Hidden dangers, sudden events, insurance matters', 'Negative'),
        9: ('Foreign travel, unconventional beliefs, guru confusion', 'Mixed'),
        10: ('Career in technology/foreign, sudden rise or fall', 'Mixed'),
        11: ('Gains through technology, foreign friends, desires fulfilled', 'Positive'),
        12: ('Foreign residence, expenses, spiritual confusion', 'Mixed'),
    },
}

SADE_SATI_PHASES = {
    'rising': {
        'houses_from_moon': 12,
        'duration': '~2.5 years',
        'description': 'Saturn enters 12th from Moon. Beginning phase.',
        'effects': 'Expenses increase, sleep issues, mental stress begins. Foundation for transformation.',
        'severity': 'Moderate',
    },
    'peak': {
        'houses_from_moon': 1,
        'duration': '~2.5 years',
        'description': 'Saturn transits over Moon. Most intense phase.',
        'effects': 'Maximum pressure on mind and emotions. Health, career, relationship all tested. Deepest transformation.',
        'severity': 'High',
    },
    'setting': {
        'houses_from_moon': 2,
        'duration': '~2.5 years',
        'description': 'Saturn in 2nd from Moon. Concluding phase.',
        'effects': 'Financial pressure, family stress, speech issues. But lessons integrating. Relief approaching.',
        'severity': 'Moderate',
    },
}

RETROGRADE_EFFECTS = {
    'Mercury': {
        'general': 'Communication breakdowns, technology glitches, travel delays',
        'natal_effect': 'Revisiting old contracts, reconnecting with past contacts',
        'duration': '~3 weeks, 3-4 times per year',
        'advice': 'Avoid signing contracts, double-check communications, backup data',
    },
    'Venus': {
        'general': 'Relationship review, past loves return, beauty/fashion issues',
        'natal_effect': 'Reassessing values and relationships, delayed romance',
        'duration': '~40 days, every 18 months',
        'advice': 'Do not start new relationships, avoid cosmetic procedures',
    },
    'Mars': {
        'general': 'Suppressed anger, delayed actions, mechanical failures',
        'natal_effect': 'Old conflicts resurface, energy blockages',
        'duration': '~2 months, every 2 years',
        'advice': 'Avoid confrontation, redirect energy to exercise',
    },
    'Jupiter': {
        'general': 'Internal growth, reviewing beliefs, delayed expansion',
        'natal_effect': 'Spiritual introspection, delayed fortune manifests internally',
        'duration': '~4 months, annually',
        'advice': 'Good for inner study, not for launching new ventures',
    },
    'Saturn': {
        'general': 'Karmic review, past responsibilities resurface, structure testing',
        'natal_effect': 'Old karmas activate, delayed rewards or punishments',
        'duration': '~4.5 months, annually',
        'advice': 'Complete pending obligations, do not start new commitments',
    },
}


class TransitDeep:
    def __init__(self, engine):
        self.engine = engine
        self.natal_planets = engine.planets
        self.asc_rashi = engine.ascendant_rashi
        self.moon_rashi = engine.planets.get('Moon', {}).get('rashi', 0)

    def _house_from_moon(self, transit_rashi: int) -> int:
        return ((transit_rashi - self.moon_rashi) % 12) + 1

    def analyze_gochar(self, transit_planets: Dict = None) -> Dict:
        """Detailed Gochar predictions for current transits from Moon."""
        if transit_planets is None:
            transit_planets = self.engine.ephemeris.get_current_transits()

        results = {}
        for planet in ['Jupiter', 'Saturn', 'Rahu']:
            t_rashi = transit_planets.get(planet, {}).get('rashi', 0)
            house_from_moon = self._house_from_moon(t_rashi)
            effects = GOCHAR_EFFECTS.get(planet, {}).get(house_from_moon, ('General transit', 'Mixed'))

            results[planet] = {
                'transit_rashi': RASHI_NAMES[t_rashi],
                'house_from_moon': house_from_moon,
                'effects': effects[0],
                'nature': effects[1],
                'rashi_name': RASHI_NAMES[t_rashi],
            }

        return results

    def analyze_sade_sati(self, transit_planets: Dict = None) -> Dict:
        """Detailed Sade Sati analysis with phase identification."""
        if transit_planets is None:
            transit_planets = self.engine.ephemeris.get_current_transits()

        saturn_rashi = transit_planets.get('Saturn', {}).get('rashi', 0)
        house_from_moon = self._house_from_moon(saturn_rashi)

        is_sade_sati = house_from_moon in (12, 1, 2)
        phase = None

        if house_from_moon == 12:
            phase = SADE_SATI_PHASES['rising']
            phase_name = 'Rising (1st Phase)'
        elif house_from_moon == 1:
            phase = SADE_SATI_PHASES['peak']
            phase_name = 'Peak (2nd Phase)'
        elif house_from_moon == 2:
            phase = SADE_SATI_PHASES['setting']
            phase_name = 'Setting (3rd Phase)'
        else:
            phase_name = 'Not Active'

        # Severity modifiers
        natal_saturn_strong = (self.natal_planets.get('Saturn', {}).get('rashi', 0) ==
                               PLANETS.get('Saturn', {}).get('exalted') or
                               self.natal_planets.get('Saturn', {}).get('rashi', 0) in
                               PLANETS.get('Saturn', {}).get('owns', []))
        natal_moon_strong = (self.natal_planets.get('Moon', {}).get('rashi', 0) ==
                             PLANETS.get('Moon', {}).get('exalted'))

        if natal_saturn_strong:
            severity_mod = 'Reduced (strong natal Saturn provides resilience)'
        elif natal_moon_strong:
            severity_mod = 'Reduced (strong natal Moon provides emotional resilience)'
        else:
            severity_mod = 'Full impact'

        return {
            'is_sade_sati': is_sade_sati,
            'phase': phase_name,
            'phase_details': phase,
            'saturn_transit': RASHI_NAMES[saturn_rashi],
            'house_from_moon': house_from_moon,
            'natal_moon': RASHI_NAMES[self.moon_rashi],
            'severity_modifier': severity_mod,
            'remedies': [
                'Recite Shani Chalisa on Saturdays',
                'Donate black sesame and mustard oil on Saturdays',
                'Serve elderly and disabled persons',
                'Wear dark blue/black on Saturdays',
                'Visit Shani temple',
            ] if is_sade_sati else [],
        }

    def analyze_retrogrades(self, transit_planets: Dict = None) -> List[Dict]:
        """Check which planets are currently retrograde and their effects."""
        if transit_planets is None:
            transit_planets = self.engine.ephemeris.get_current_transits()

        retro = []
        for planet in ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']:
            t_data = transit_planets.get(planet, {})
            if t_data.get('retrograde', False):
                effects = RETROGRADE_EFFECTS.get(planet, {})
                house_from_moon = self._house_from_moon(t_data.get('rashi', 0))
                retro.append({
                    'planet': planet,
                    'transit_rashi': RASHI_NAMES[t_data.get('rashi', 0)],
                    'house_from_moon': house_from_moon,
                    'general_effect': effects.get('general', ''),
                    'natal_effect': effects.get('natal_effect', ''),
                    'advice': effects.get('advice', ''),
                    'duration': effects.get('duration', ''),
                })

        return retro

    def analyze_eclipse_impact(self, transit_planets: Dict = None) -> Dict:
        """Check if Rahu/Ketu transit affects natal luminaries."""
        if transit_planets is None:
            transit_planets = self.engine.ephemeris.get_current_transits()

        rahu_rashi = transit_planets.get('Rahu', {}).get('rashi', 0)
        ketu_rashi = transit_planets.get('Ketu', {}).get('rashi', 0)
        natal_sun = self.natal_planets.get('Sun', {}).get('rashi', 0)
        natal_moon = self.natal_planets.get('Moon', {}).get('rashi', 0)

        impacts = []

        if rahu_rashi == natal_sun or ketu_rashi == natal_sun:
            node = 'Rahu' if rahu_rashi == natal_sun else 'Ketu'
            impacts.append({
                'type': 'Solar Eclipse Impact',
                'description': f'{node} transiting over natal Sun in {RASHI_NAMES[natal_sun]}',
                'effects': 'Father, authority, career, ego challenged. Identity transformation.',
                'duration': '~18 months',
                'severity': 'High',
            })

        if rahu_rashi == natal_moon or ketu_rashi == natal_moon:
            node = 'Rahu' if rahu_rashi == natal_moon else 'Ketu'
            impacts.append({
                'type': 'Lunar Eclipse Impact',
                'description': f'{node} transiting over natal Moon in {RASHI_NAMES[natal_moon]}',
                'effects': 'Mother, mind, emotions, public image disrupted. Mental transformation.',
                'duration': '~18 months',
                'severity': 'High',
            })

        # Check natal Rahu/Ketu axis transit
        natal_rahu = self.natal_planets.get('Rahu', {}).get('rashi', 0)
        if rahu_rashi == natal_rahu:
            impacts.append({
                'type': 'Rahu Return',
                'description': f'Rahu returning to natal position in {RASHI_NAMES[natal_rahu]}',
                'effects': 'Major life cycle completion. Past obsessions revisited. New desires emerge.',
                'duration': '~18 months',
                'severity': 'Moderate',
            })

        return {
            'active_impacts': impacts,
            'rahu_transit': RASHI_NAMES[rahu_rashi],
            'ketu_transit': RASHI_NAMES[ketu_rashi],
            'is_eclipse_affected': len(impacts) > 0,
        }

    def generate_full_transit_report(self, transit_planets: Dict = None) -> Dict:
        if transit_planets is None:
            transit_planets = self.engine.ephemeris.get_current_transits()
        return {
            'gochar': self.analyze_gochar(transit_planets),
            'sade_sati': self.analyze_sade_sati(transit_planets),
            'retrogrades': self.analyze_retrogrades(transit_planets),
            'eclipse_impact': self.analyze_eclipse_impact(transit_planets),
        }


def analyze_transits_deep(engine) -> Dict:
    td = TransitDeep(engine)
    return td.generate_full_transit_report()
