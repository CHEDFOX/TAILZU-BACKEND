"""
JYOTISH ENGINE - DAILY PERSONALIZED RITUAL + BIORHYTHM
Personalized to THEIR chart + today's transits.
"""

from datetime import date
from typing import Dict
from math import sin, pi
from ..core.constants import PLANETS as PLANET_DATA

RAHU_KALAM = {
    0: '07:30-09:00', 1: '15:00-16:30', 2: '12:00-13:30',
    3: '13:30-15:00', 4: '10:30-12:00', 5: '09:00-10:30', 6: '16:30-18:00',
}

DAY_PLANET = {
    0: 'Moon', 1: 'Mars', 2: 'Mercury', 3: 'Jupiter',
    4: 'Venus', 5: 'Saturn', 6: 'Sun',
}

DAY_COLOR = {
    0: 'White', 1: 'Red', 2: 'Green', 3: 'Yellow',
    4: 'White/Pink', 5: 'Black/Navy', 6: 'Orange/Red',
}

DAY_DEITY = {
    0: 'Lord Shiva', 1: 'Lord Hanuman', 2: 'Lord Vishnu/Ganesha',
    3: 'Lord Vishnu/Jupiter', 4: 'Goddess Lakshmi', 5: 'Lord Shani/Hanuman',
    6: 'Lord Surya',
}


class DailyRitual:
    def __init__(self, engine):
        self.engine = engine
        self.planets = engine.planets
        self.asc_rashi = engine.ascendant_rashi
        self.birth_date = engine.birth_local

    def get_daily_ritual(self, target_date: date = None) -> Dict:
        if target_date is None:
            target_date = date.today()

        weekday = target_date.weekday()
        day_planet = DAY_PLANET[weekday]
        day_color = DAY_COLOR[weekday]
        day_deity = DAY_DEITY[weekday]
        rahu_kalam = RAHU_KALAM[weekday]

        # Dasha lord mantra
        try:
            dasha = self.engine.get_vimshottari_dasha()
            maha_lord = dasha.get('mahadasha', {}).get('lord', 'Jupiter')
        except Exception:
            maha_lord = 'Jupiter'

        # Lucky number from personal day
        from ..numerology.core import NumerologyEngine, _reduce_to_root
        bd = self.birth_date
        ne = NumerologyEngine(birth_date=date(bd.year, bd.month, bd.day))
        try:
            pd = ne.get_personal_day(target_date)
            lucky_number = pd.get('personal_day', 1)
        except Exception:
            lucky_number = _reduce_to_root(target_date.day)

        # Moon sign today for general mood
        moon_rashi = self.planets.get('Moon', {}).get('rashi_name', 'Aries')

        ritual = {
            'date': target_date.strftime('%Y-%m-%d'),
            'day': target_date.strftime('%A'),
            'day_planet': day_planet,
            'morning': {
                'color_to_wear': day_color,
                'deity': day_deity,
                'mantra': f'Chant {maha_lord} beej mantra 108 times',
                'activity': f'Offer water to Sun at sunrise. Meditate on {day_deity}.',
            },
            'timing': {
                'rahu_kalam': rahu_kalam,
                'avoid_during_rahu': 'No new beginnings, signing, travel starts',
                'best_hours': f'Before Rahu Kalam and after sunset',
            },
            'lucky': {
                'number': lucky_number,
                'color': day_color,
                'direction': PLANET_DATA.get(day_planet, {}).get('direction', 'East'),
            },
            'evening': {
                'practice': f'Light diya for {day_deity}. Recite Hanuman Chalisa if Tuesday/Saturday.',
                'diet': 'Eat light. Avoid non-veg on Tuesday and Saturday.',
            },
            'dasha_lord': maha_lord,
        }

        return {
            'system': 'daily_ritual',
            'category': 'guidance',
            'triggers': ['today', 'daily', 'ritual', 'what should i do', 'lucky'],
            'ritual': ritual,
            'confidence': 0.85,
        }


class Biorhythm:
    """23-day physical, 28-day emotional, 33-day intellectual cycles."""

    def __init__(self, birth_date: date):
        self.birth_date = birth_date

    def calculate(self, target_date: date = None) -> Dict:
        if target_date is None:
            target_date = date.today()

        days_alive = (target_date - self.birth_date).days

        physical = sin(2 * pi * days_alive / 23) * 100
        emotional = sin(2 * pi * days_alive / 28) * 100
        intellectual = sin(2 * pi * days_alive / 33) * 100

        def status(val):
            if val > 50: return 'Peak'
            elif val > 0: return 'Rising'
            elif val > -50: return 'Declining'
            else: return 'Low'

        overall = (physical + emotional + intellectual) / 3

        return {
            'system': 'biorhythm',
            'category': 'wellness',
            'triggers': ['biorhythm', 'energy', 'cycle'],
            'date': target_date.strftime('%Y-%m-%d'),
            'days_alive': days_alive,
            'physical': {'value': round(physical, 1), 'status': status(physical), 'cycle': '23 days'},
            'emotional': {'value': round(emotional, 1), 'status': status(emotional), 'cycle': '28 days'},
            'intellectual': {'value': round(intellectual, 1), 'status': status(intellectual), 'cycle': '33 days'},
            'overall': round(overall, 1),
            'overall_status': status(overall),
            'advice': 'High energy day — take on challenges' if overall > 30
                      else 'Low energy — rest and routine tasks' if overall < -30
                      else 'Mixed energy — moderate activities',
            'confidence': 0.65,
        }


def get_daily_ritual(engine, target_date=None):
    return DailyRitual(engine).get_daily_ritual(target_date)

def get_biorhythm(birth_date, target_date=None):
    return Biorhythm(birth_date).calculate(target_date)
