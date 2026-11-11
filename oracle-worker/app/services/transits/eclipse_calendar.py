"""
JYOTISH ENGINE - ECLIPSE CALENDAR
When is the next eclipse and how does it hit this person's chart.
"""

from datetime import datetime
from typing import Dict, List
from ..core.constants import RASHI_NAMES

# Approximate upcoming eclipse dates (pre-computed, update periodically)
ECLIPSES = [
    {'date': '2026-02-17', 'type': 'Annular Solar', 'rashi': 10, 'degree': 28},
    {'date': '2026-03-03', 'type': 'Total Lunar', 'rashi': 4, 'degree': 12},
    {'date': '2026-08-12', 'type': 'Partial Solar', 'rashi': 4, 'degree': 19},
    {'date': '2026-08-28', 'type': 'Total Lunar', 'rashi': 10, 'degree': 4},
    {'date': '2027-02-06', 'type': 'Annular Solar', 'rashi': 9, 'degree': 17},
    {'date': '2027-02-20', 'type': 'Penumbral Lunar', 'rashi': 4, 'degree': 2},
    {'date': '2027-07-18', 'type': 'Penumbral Lunar', 'rashi': 9, 'degree': 25},
    {'date': '2027-08-02', 'type': 'Total Solar', 'rashi': 3, 'degree': 9},
    {'date': '2028-01-12', 'type': 'Partial Lunar', 'rashi': 3, 'degree': 22},
    {'date': '2028-01-26', 'type': 'Annular Solar', 'rashi': 9, 'degree': 6},
]


class EclipseCalendar:
    def __init__(self, engine):
        self.engine = engine
        self.natal = engine.planets

    def get_upcoming_eclipses(self) -> List[Dict]:
        now = datetime.now()
        upcoming = []
        for ecl in ECLIPSES:
            ecl_date = datetime.strptime(ecl['date'], '%Y-%m-%d')
            if ecl_date > now:
                impact = self._check_impact(ecl)
                upcoming.append({
                    'date': ecl['date'],
                    'type': ecl['type'],
                    'rashi': RASHI_NAMES[ecl['rashi']],
                    'degree': ecl['degree'],
                    'personal_impact': impact,
                })
        return upcoming[:6]

    def _check_impact(self, eclipse: Dict) -> Dict:
        ecl_rashi = eclipse['rashi']
        impacts = []

        for planet in ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']:
            p_rashi = self.natal.get(planet, {}).get('rashi', -1)
            if p_rashi == ecl_rashi:
                impacts.append({
                    'planet': planet,
                    'type': 'Direct hit',
                    'effect': f'Eclipse on natal {planet} — {planet} significations disrupted then renewed',
                })
            elif ((p_rashi - ecl_rashi) % 12) + 1 == 7:
                impacts.append({
                    'planet': planet,
                    'type': 'Opposition',
                    'effect': f'Eclipse opposes natal {planet} — tension in {planet} matters',
                })

        asc_rashi = self.engine.ascendant_rashi
        asc_house_hit = ((ecl_rashi - asc_rashi) % 12) + 1

        severity = 'High' if impacts else 'Low'

        return {
            'house_affected': asc_house_hit,
            'planets_hit': impacts,
            'severity': severity,
            'advice': 'Avoid major decisions around this date. Focus on inner work.' if severity == 'High'
                      else 'Minimal direct impact. General caution advised.',
        }

    def generate_eclipse_report(self) -> Dict:
        upcoming = self.get_upcoming_eclipses()
        high_impact = [e for e in upcoming if e['personal_impact']['severity'] == 'High']
        return {
            'upcoming_eclipses': upcoming,
            'high_impact_count': len(high_impact),
            'next_significant': high_impact[0] if high_impact else None,
        }


def get_eclipse_calendar(engine):
    return EclipseCalendar(engine).generate_eclipse_report()
