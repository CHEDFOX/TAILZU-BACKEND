"""
JYOTISH ENGINE - REAL-TIME DASHBOARD
One call = complete snapshot of THIS MOMENT for this person.
"""

from datetime import datetime, date
from typing import Dict
from ..numerology.core import NumerologyEngine

DAY_PLANET = {0: 'Moon', 1: 'Mars', 2: 'Mercury', 3: 'Jupiter', 4: 'Venus', 5: 'Saturn', 6: 'Sun'}
RAHU_KALAM = {0: '07:30-09:00', 1: '15:00-16:30', 2: '12:00-13:30', 3: '13:30-15:00', 4: '10:30-12:00', 5: '09:00-10:30', 6: '16:30-18:00'}


class RealtimeDashboard:
    def __init__(self, engine):
        self.engine = engine

    def snapshot(self) -> Dict:
        now = datetime.now()
        today = date.today()
        weekday = now.weekday()

        # Dasha
        try:
            dasha = self.engine.get_vimshottari_dasha()
            dasha_str = f"{dasha['mahadasha']['lord']}/{dasha['antardasha']['lord']}"
        except Exception:
            dasha_str = 'Unknown'

        # Pratyantar
        try:
            prat = self.engine.get_pratyantar_dasha()
            prat_str = prat.get('dasha_string', dasha_str)
        except Exception:
            prat_str = dasha_str

        # Hora
        try:
            timing = self.engine.get_daily_timing()
            hora = timing.get('hora', {}).get('current_hora', '')
            chog = timing.get('choghadiya', {}).get('current', {})
            chog_name = chog.get('name', '') if chog else ''
            chog_nature = chog.get('nature', '') if chog else ''
            abhijit = timing.get('abhijit_muhurta', {})
        except Exception:
            hora = ''
            chog_name = ''
            chog_nature = ''
            abhijit = {}

        # Numerology personal day
        try:
            bd = self.engine.birth_local
            ne = NumerologyEngine(birth_date=date(bd.year, bd.month, bd.day))
            pd = ne.get_personal_day(today)
            personal_num = pd.get('personal_day', 0)
        except Exception:
            personal_num = 0

        # Active yogas
        try:
            yt = self.engine.get_yoga_timing()
            active_yogas = [y['name'] for y in yt if y.get('is_active_now')][:5]
        except Exception:
            active_yogas = []

        # Sade Sati
        try:
            td = self.engine.get_transit_deep()
            sade_sati = td.get('sade_sati', {}).get('phase', 'Not Active')
            retro_count = len(td.get('retrogrades', []))
        except Exception:
            sade_sati = 'Unknown'
            retro_count = 0

        # Biorhythm
        try:
            bio = self.engine.get_biorhythm()
            bio_overall = bio.get('overall', 0)
            bio_status = bio.get('overall_status', '')
        except Exception:
            bio_overall = 0
            bio_status = ''

        # Planetary returns
        try:
            pr = self.engine.get_planetary_returns()
            active_returns = [a['message'][:50] for a in pr.get('alerts', []) if a['priority'] in ('High', 'Medium')]
        except Exception:
            active_returns = []

        # Eclipse proximity
        try:
            ec = self.engine.get_eclipse_calendar()
            next_eclipse = ec['upcoming_eclipses'][0] if ec['upcoming_eclipses'] else None
            eclipse_impact = ec.get('high_impact_count', 0)
        except Exception:
            next_eclipse = None
            eclipse_impact = 0

        # Color and lucky
        from ..numerology.core import NUMBER_MEANINGS
        num_data = NUMBER_MEANINGS.get(personal_num, {})

        return {
            'timestamp': now.isoformat(),
            'day': now.strftime('%A'),
            'day_planet': DAY_PLANET.get(weekday, ''),
            'rahu_kalam': RAHU_KALAM.get(weekday, ''),
            'current_hora': hora,
            'choghadiya': {'name': chog_name, 'nature': chog_nature},
            'abhijit_muhurta': abhijit,
            'dasha': prat_str,
            'personal_day_number': personal_num,
            'lucky_color': num_data.get('color', ''),
            'lucky_direction': num_data.get('direction', ''),
            'active_yogas': active_yogas,
            'sade_sati': sade_sati,
            'retrogrades_active': retro_count,
            'biorhythm': {'score': bio_overall, 'status': bio_status},
            'planetary_alerts': active_returns[:3],
            'eclipse_proximity': {
                'next': next_eclipse.get('date', '') if next_eclipse else 'None soon',
                'high_impact': eclipse_impact,
            },
            'quick_advice': self._generate_advice(chog_nature, hora, sade_sati, bio_overall),
        }

    def _generate_advice(self, chog: str, hora: str, sade_sati: str, bio: float) -> str:
        parts = []
        if chog == 'Best':
            parts.append('Excellent moment for new beginnings')
        elif chog == 'Bad':
            parts.append('Avoid starting important work right now')
        elif chog == 'Good':
            parts.append('Good time for productive activities')

        if hora in ('Jupiter', 'Venus'):
            parts.append(f'{hora} hora — auspicious for finance and relationships')
        elif hora in ('Saturn', 'Mars'):
            parts.append(f'{hora} hora — focus on discipline and routine tasks')

        if 'Peak' in sade_sati:
            parts.append('Sade Sati peak — extra patience needed')

        if bio > 50:
            parts.append('High biorhythm — take on challenges')
        elif bio < -30:
            parts.append('Low biorhythm — rest and recharge')

        return '. '.join(parts) if parts else 'Normal period — proceed with awareness'


def get_realtime_dashboard(engine):
    return RealtimeDashboard(engine).snapshot()
