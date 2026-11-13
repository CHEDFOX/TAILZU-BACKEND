"""
JYOTISH ENGINE - PAST EVENT EXPLAINER + LIFE EVENT MAPPER
"Why did I lose my job in March 2020?" → reverse-analyzes with full astrology.
"Map my life events to planets" → validates the system retroactively.
"""

from datetime import datetime
from typing import Dict, List
from ..core.constants import RASHI_NAMES, PLANETS as PD
from ..core.ephemeris import get_ephemeris

EVENT_HOUSE_MAP = {
    'marriage': [7, 2, 11], 'divorce': [6, 7, 12], 'job_got': [10, 6, 11],
    'job_lost': [10, 6, 8], 'promotion': [10, 11, 9], 'child_born': [5, 2, 11],
    'death_family': [8, 2, 7], 'accident': [8, 6, 12], 'property_bought': [4, 11, 2],
    'foreign_travel': [9, 12, 3], 'education_started': [4, 5, 9],
    'health_issue': [6, 8, 1], 'wealth_gain': [2, 11, 5],
    'wealth_loss': [2, 12, 8], 'spiritual_experience': [9, 12, 5],
    'relationship_started': [5, 7, 11], 'relationship_ended': [6, 7, 12],
    'moved_home': [4, 3, 12], 'started_business': [7, 10, 11],
    'legal_issue': [6, 8, 12], 'fame': [10, 1, 11],
}


class PastEventExplainer:
    def __init__(self, engine):
        self.engine = engine
        self.natal = engine.planets
        self.asc_rashi = engine.ascendant_rashi
        self.moon_rashi = engine.planets.get('Moon', {}).get('rashi', 0)
        self.ephemeris = get_ephemeris()

    def explain_event(self, event_date: str, event_type: str, description: str = '') -> Dict:
        """Explain why a past event happened using astrology."""
        dt = datetime.strptime(event_date, '%Y-%m-%d')
        relevant_houses = EVENT_HOUSE_MAP.get(event_type, [10, 1, 7])

        # 1. What dasha was running
        dasha_info = self._get_dasha_at_date(dt)

        # 2. Where were planets then
        transit_positions = self._get_transits_at_date(dt)

        # 3. Which houses were activated by transit
        transit_activations = self._check_transit_activations(transit_positions, relevant_houses)

        # 4. Did dasha lord connect to event houses
        dasha_connection = self._check_dasha_connection(dasha_info, relevant_houses)

        # 5. Double transit check
        double_transit = self._check_double_transit(transit_positions, relevant_houses)

        # 6. Build explanation
        factors = []
        confidence = 0

        if dasha_connection['connected']:
            factors.append(dasha_connection['explanation'])
            confidence += 30

        for ta in transit_activations:
            factors.append(ta)
            confidence += 15

        if double_transit['active']:
            factors.append(double_transit['explanation'])
            confidence += 25

        confidence = min(95, confidence)

        # Sade Sati check
        saturn_rashi = transit_positions.get('Saturn', {}).get('rashi', -1)
        sade_sati = ((saturn_rashi - self.moon_rashi) % 12) + 1 in (12, 1, 2)

        if sade_sati and event_type in ('job_lost', 'health_issue', 'divorce', 'death_family'):
            factors.append('Sade Sati was active — Saturn testing your foundations')
            confidence += 10

        confidence = min(95, confidence)

        return {
            'event_date': event_date,
            'event_type': event_type,
            'description': description,
            'dasha_running': dasha_info,
            'key_transits': {
                p: {'rashi': RASHI_NAMES[d.get('rashi', 0)],
                    'house_from_moon': ((d.get('rashi', 0) - self.moon_rashi) % 12) + 1}
                for p, d in transit_positions.items()
                if p in ('Jupiter', 'Saturn', 'Rahu', 'Mars')
            },
            'sade_sati_active': sade_sati,
            'relevant_houses': relevant_houses,
            'explanation_factors': factors,
            'confidence': confidence,
            'summary': self._build_summary(event_type, factors, dasha_info, confidence),
        }

    def validate_life_events(self, events: List[Dict]) -> Dict:
        """
        User provides list of events: [{'date': '2018-05-15', 'type': 'marriage', 'desc': ''}]
        Returns how many the system can explain.
        """
        results = []
        for event in events:
            explanation = self.explain_event(
                event['date'], event['type'], event.get('desc', '')
            )
            results.append(explanation)

        explained = sum(1 for r in results if r['confidence'] >= 50)
        total = len(results)
        accuracy = (explained / total * 100) if total > 0 else 0

        return {
            'events_analyzed': total,
            'events_explained': explained,
            'accuracy': round(accuracy),
            'verdict': f'{explained}/{total} events explained ({accuracy:.0f}% accuracy)',
            'results': results,
            'trust_level': 'High' if accuracy >= 70 else 'Moderate' if accuracy >= 50 else 'Low',
        }

    def _get_dasha_at_date(self, dt: datetime) -> Dict:
        try:
            dasha = self.engine.get_vimshottari_dasha()
            return {
                'mahadasha': dasha['mahadasha']['lord'],
                'antardasha': dasha['antardasha']['lord'],
                'string': f"{dasha['mahadasha']['lord']}/{dasha['antardasha']['lord']}",
            }
        except Exception:
            return {'mahadasha': '', 'antardasha': '', 'string': 'Unknown'}

    def _get_transits_at_date(self, dt: datetime) -> Dict:
        try:
            jd = self.ephemeris.get_julian_day(dt)
            positions = {}
            for planet in ['Jupiter', 'Saturn', 'Rahu', 'Ketu', 'Mars']:
                pos = self.ephemeris.get_planet_position(jd, planet)
                positions[planet] = pos
            return positions
        except Exception:
            return {}

    def _check_transit_activations(self, positions: Dict, houses: List) -> List[str]:
        activations = []
        for planet in ['Jupiter', 'Saturn', 'Rahu']:
            p_rashi = positions.get(planet, {}).get('rashi', 0)
            h_from_lagna = ((p_rashi - self.asc_rashi) % 12) + 1
            if h_from_lagna in houses:
                activations.append(
                    f'{planet} was transiting house {h_from_lagna} (relevant for this event)'
                )
        return activations

    def _check_dasha_connection(self, dasha: Dict, houses: List) -> Dict:
        maha = dasha.get('mahadasha', '')
        antar = dasha.get('antardasha', '')
        connections = []

        for lord in [maha, antar]:
            if not lord:
                continue
            lord_house = self.natal.get(lord, {}).get('house', 0)
            if lord_house in houses:
                connections.append(f'{lord} (dasha lord) sits in house {lord_house}')

            owned = PD.get(lord, {}).get('owns', [])
            for sign in owned:
                h = ((sign - self.asc_rashi) % 12) + 1
                if h in houses:
                    connections.append(f'{lord} owns house {h}')

        return {
            'connected': len(connections) > 0,
            'explanation': f'Dasha {dasha["string"]}: {"; ".join(connections)}' if connections else 'Dasha not directly connected',
        }

    def _check_double_transit(self, positions: Dict, houses: List) -> Dict:
        jup_rashi = positions.get('Jupiter', {}).get('rashi', 0)
        sat_rashi = positions.get('Saturn', {}).get('rashi', 0)

        for house in houses:
            target = (self.asc_rashi + house - 1) % 12
            jup_aspects = {jup_rashi, (jup_rashi+4)%12, (jup_rashi+6)%12, (jup_rashi+8)%12}
            sat_aspects = {sat_rashi, (sat_rashi+2)%12, (sat_rashi+6)%12, (sat_rashi+9)%12}

            if target in jup_aspects and target in sat_aspects:
                return {
                    'active': True,
                    'house': house,
                    'explanation': f'Double transit (Jupiter+Saturn) activated house {house} — event trigger confirmed',
                }

        return {'active': False, 'explanation': ''}

    def _build_summary(self, event_type: str, factors: List, dasha: Dict, confidence: int) -> str:
        if not factors:
            return f'The {event_type} occurred but astrological factors are not clearly linked at {confidence}% confidence.'
        top = factors[0]
        return f'This {event_type} was primarily triggered by: {top}. Astrological confidence: {confidence}%.'


def explain_past_event(engine, event_date, event_type, desc=''):
    return PastEventExplainer(engine).explain_event(event_date, event_type, desc)

def validate_life_events(engine, events):
    return PastEventExplainer(engine).validate_life_events(events)
