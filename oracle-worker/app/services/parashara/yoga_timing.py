"""
JYOTISH ENGINE - YOGA TIMING
When does each yoga ACTIVATE? Based on dasha of involved planets.
"Gajakesari Yoga activates in Jupiter dasha + Jupiter transit on Moon."
"""

from typing import Dict, List


class YogaTiming:
    def __init__(self, engine):
        self.engine = engine

    def time_yogas(self) -> List[Dict]:
        """Add timing to each detected yoga."""
        try:
            yogas_data = self.engine.get_yogas()
            dasha = self.engine.get_vimshottari_dasha()
        except Exception:
            return []

        maha_lord = dasha.get('mahadasha', {}).get('lord', '')
        antar_lord = dasha.get('antardasha', {}).get('lord', '')
        maha_end = dasha.get('mahadasha', {}).get('end', '')
        antar_end = dasha.get('antardasha', {}).get('end', '')

        timed = []
        for cat, ylist in yogas_data.get('yogas', {}).items():
            for yoga in ylist:
                planets = yoga.get('planets', yoga.get('planet', ''))
                if isinstance(planets, str):
                    planets = [planets] if planets else []
                elif not isinstance(planets, list):
                    planets = []

                # Check if any yoga planet is current dasha lord
                is_active_now = any(p in (maha_lord, antar_lord) for p in planets)

                if is_active_now:
                    activation = 'ACTIVE NOW'
                    timing = f'Currently in {maha_lord}/{antar_lord} dasha'
                elif maha_lord in planets:
                    activation = 'Active in current Mahadasha'
                    timing = f'Active until {maha_end}'
                else:
                    # Find which dasha would activate this yoga
                    activation_lords = [p for p in planets if p in
                        ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu']]
                    if activation_lords:
                        activation = f'Activates in {"/".join(activation_lords)} dasha'
                        timing = f'Look for {activation_lords[0]} Mahadasha or Antardasha'
                    else:
                        activation = 'General influence'
                        timing = 'Active throughout life at varying intensity'

                timed.append({
                    'name': yoga['name'],
                    'type': yoga.get('type', cat),
                    'is_negative': yoga.get('is_negative', False),
                    'activation': activation,
                    'timing': timing,
                    'is_active_now': is_active_now,
                    'involved_planets': planets,
                })

        # Sort: active now first
        timed.sort(key=lambda x: (0 if x['is_active_now'] else 1, x['name']))
        return timed

    def get_active_yogas(self) -> List[Dict]:
        """Get only currently active yogas."""
        return [y for y in self.time_yogas() if y['is_active_now']]


def time_all_yogas(engine):
    return YogaTiming(engine).time_yogas()
