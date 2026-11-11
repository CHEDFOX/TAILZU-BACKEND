"""
JYOTISH ENGINE - FUTURE TRANSIT CALCULATOR
"When will Saturn enter your 7th house?" — scans ahead and finds dates.
"""

from datetime import datetime, timedelta
from typing import Dict, List
from ..core.constants import RASHI_NAMES
from ..core.ephemeris import get_ephemeris


class FutureTransitCalculator:
    def __init__(self, engine):
        self.engine = engine
        self.moon_rashi = engine.planets.get('Moon', {}).get('rashi', 0)
        self.asc_rashi = engine.ascendant_rashi
        self.ephemeris = get_ephemeris()

    def find_planet_transit_dates(self, planet: str, target_house_from_moon: int,
                                   months_ahead: int = 36) -> Dict:
        """Find when a planet will transit a specific house from Moon."""
        target_rashi = (self.moon_rashi + target_house_from_moon - 1) % 12
        entries = []
        now = datetime.now()
        step_days = 7 if planet in ('Jupiter', 'Saturn', 'Rahu', 'Ketu') else 3

        prev_in_sign = False
        entry_date = None

        for day_offset in range(0, months_ahead * 30, step_days):
            check_date = now + timedelta(days=day_offset)
            try:
                jd = self.ephemeris.get_julian_day(check_date)
                pos = self.ephemeris.get_planet_position(jd, planet)
                current_rashi = pos.get('rashi', 0)
                in_sign = current_rashi == target_rashi

                if in_sign and not prev_in_sign:
                    entry_date = check_date
                elif not in_sign and prev_in_sign and entry_date:
                    entries.append({
                        'entry': entry_date.strftime('%Y-%m-%d'),
                        'exit': check_date.strftime('%Y-%m-%d'),
                        'duration_days': (check_date - entry_date).days,
                        'rashi': RASHI_NAMES[target_rashi],
                    })
                    entry_date = None

                prev_in_sign = in_sign
            except Exception:
                continue

        if entry_date:
            entries.append({
                'entry': entry_date.strftime('%Y-%m-%d'),
                'exit': 'Beyond scan range',
                'rashi': RASHI_NAMES[target_rashi],
            })

        return {
            'planet': planet,
            'target_house': target_house_from_moon,
            'target_rashi': RASHI_NAMES[target_rashi],
            'transits': entries,
            'next_entry': entries[0] if entries else None,
        }

    def find_all_major_transits(self, months: int = 24) -> Dict:
        """Find upcoming major transits of Jupiter, Saturn, Rahu."""
        results = {}
        for planet in ['Jupiter', 'Saturn', 'Rahu']:
            planet_transits = []
            try:
                now = datetime.now()
                jd = self.ephemeris.get_julian_day(now)
                pos = self.ephemeris.get_planet_position(jd, planet)
                current_rashi = pos.get('rashi', 0)

                prev_rashi = current_rashi
                for day_offset in range(7, months * 30, 7):
                    check_date = now + timedelta(days=day_offset)
                    jd2 = self.ephemeris.get_julian_day(check_date)
                    pos2 = self.ephemeris.get_planet_position(jd2, planet)
                    new_rashi = pos2.get('rashi', 0)

                    if new_rashi != prev_rashi:
                        house_from_moon = ((new_rashi - self.moon_rashi) % 12) + 1
                        house_from_lagna = ((new_rashi - self.asc_rashi) % 12) + 1
                        planet_transits.append({
                            'date': check_date.strftime('%Y-%m-%d'),
                            'from_rashi': RASHI_NAMES[prev_rashi],
                            'to_rashi': RASHI_NAMES[new_rashi],
                            'house_from_moon': house_from_moon,
                            'house_from_lagna': house_from_lagna,
                        })
                    prev_rashi = new_rashi
            except Exception:
                pass

            results[planet] = planet_transits

        return {
            'major_transits': results,
            'months_scanned': months,
        }

    def find_double_transit_windows(self, house: int, months: int = 36) -> List[Dict]:
        """Find when Jupiter AND Saturn both aspect a house — event trigger."""
        target_rashi = (self.asc_rashi + house - 1) % 12
        jup_aspects = [0, 4, 6, 8]  # Conjunction, 5th, 7th, 9th
        sat_aspects = [0, 2, 6, 9]  # Conjunction, 3rd, 7th, 10th

        jup_activates = set()
        sat_activates = set()

        for asp in jup_aspects:
            jup_activates.add((target_rashi - asp) % 12)
        for asp in sat_aspects:
            sat_activates.add((target_rashi - asp) % 12)

        windows = []
        now = datetime.now()

        for day_offset in range(0, months * 30, 14):
            check_date = now + timedelta(days=day_offset)
            try:
                jd = self.ephemeris.get_julian_day(check_date)
                jup_pos = self.ephemeris.get_planet_position(jd, 'Jupiter')
                sat_pos = self.ephemeris.get_planet_position(jd, 'Saturn')

                jup_rashi = jup_pos.get('rashi', 0)
                sat_rashi = sat_pos.get('rashi', 0)

                jup_active = jup_rashi in jup_activates
                sat_active = sat_rashi in sat_activates

                if jup_active and sat_active:
                    windows.append({
                        'date': check_date.strftime('%Y-%m-%d'),
                        'jupiter_in': RASHI_NAMES[jup_rashi],
                        'saturn_in': RASHI_NAMES[sat_rashi],
                        'target_house': house,
                    })
            except Exception:
                continue

        # Consolidate into date ranges
        if windows:
            ranges = []
            start = windows[0]['date']
            prev = windows[0]['date']
            for w in windows[1:]:
                prev = w['date']
            ranges.append({'start': start, 'end': prev, 'house': house})
            return ranges

        return []


def calculate_future_transits(engine, months=24):
    ftc = FutureTransitCalculator(engine)
    return ftc.find_all_major_transits(months)
