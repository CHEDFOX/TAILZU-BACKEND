"""
JYOTISH ENGINE - PRATYANTAR DASHA (3rd level)
Narrows timing from months to WEEKS.
Mahadasha → Antardasha → Pratyantar Dasha
"""

from datetime import datetime, timedelta
from typing import Dict

VIMSHOTTARI_YEARS = {
    'Ketu': 7, 'Venus': 20, 'Sun': 6, 'Moon': 10, 'Mars': 7,
    'Rahu': 18, 'Jupiter': 16, 'Saturn': 19, 'Mercury': 17,
}
DASHA_ORDER = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury']
TOTAL_YEARS = 120


class PratyantarDasha:
    def __init__(self, engine):
        self.engine = engine

    def calculate_pratyantar(self) -> Dict:
        """Calculate current Pratyantar (3rd level) dasha."""
        try:
            dasha = self.engine.get_vimshottari_dasha()
        except Exception:
            return {'error': 'Could not get dasha data'}

        maha = dasha.get('mahadasha', {})
        antar = dasha.get('antardasha', {})
        maha_lord = maha.get('lord', 'Jupiter')
        antar_lord = antar.get('lord', 'Saturn')

        # Parse antardasha start/end
        try:
            antar_start = datetime.fromisoformat(antar.get('start', '2000-01-01'))
            antar_end = datetime.fromisoformat(antar.get('end', '2000-01-01'))
        except Exception:
            return {'error': 'Could not parse antardasha dates'}

        antar_days = (antar_end - antar_start).days
        antar_years_val = VIMSHOTTARI_YEARS.get(antar_lord, 10)

        # Calculate pratyantar periods within this antardasha
        start_idx = DASHA_ORDER.index(antar_lord)
        pratyantars = []
        current_start = antar_start

        for i in range(9):
            prat_lord = DASHA_ORDER[(start_idx + i) % 9]
            prat_years = VIMSHOTTARI_YEARS[prat_lord]
            # Proportion: (antar_years * prat_years) / total_years^2 * total_antar_days
            proportion = (antar_years_val * prat_years) / (TOTAL_YEARS * TOTAL_YEARS)
            # But simpler: proportional share within antardasha
            share = prat_years / TOTAL_YEARS
            prat_days = int(antar_days * share)
            if prat_days < 1:
                prat_days = 1

            prat_end = current_start + timedelta(days=prat_days)

            pratyantars.append({
                'lord': prat_lord,
                'start': current_start.strftime('%Y-%m-%d'),
                'end': prat_end.strftime('%Y-%m-%d'),
                'days': prat_days,
                'is_current': current_start <= datetime.now() < prat_end,
            })

            current_start = prat_end

        # Find current pratyantar
        current_prat = None
        for p in pratyantars:
            if p['is_current']:
                current_prat = p
                break

        if not current_prat and pratyantars:
            current_prat = pratyantars[0]

        return {
            'mahadasha': maha_lord,
            'antardasha': antar_lord,
            'pratyantar': current_prat['lord'] if current_prat else 'Unknown',
            'dasha_string': f"{maha_lord}/{antar_lord}/{current_prat['lord'] if current_prat else '?'}",
            'current_pratyantar': current_prat,
            'all_pratyantars': pratyantars,
            'timing_precision': f"Current period: {current_prat['start']} to {current_prat['end']}" if current_prat else '',
        }


def get_pratyantar(engine):
    return PratyantarDasha(engine).calculate_pratyantar()
