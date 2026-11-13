"""
WESTERN — MIDPOINTS (Cosmobiology) & HARMONIC CHARTS
"""

from typing import Dict, List
from .chart import SIGNS, WESTERN_PLANETS

# ═══════════════════════════════════════════════════════════════
# MIDPOINTS
# ═══════════════════════════════════════════════════════════════

def calculate_all_midpoints(planets: Dict) -> Dict:
    """
    Calculate midpoints for all planet pairs.
    A midpoint is the exact halfway point between two planets.
    When a transit or natal planet sits on a midpoint, it activates both planets.
    """
    midpoints = {}
    planet_names = [n for n in WESTERN_PLANETS if n in planets]

    for i, p1 in enumerate(planet_names):
        for p2 in planet_names[i+1:]:
            l1 = planets[p1].get('longitude', 0)
            l2 = planets[p2].get('longitude', 0)

            # Shortest arc midpoint
            diff = l2 - l1
            if diff > 180: diff -= 360
            elif diff < -180: diff += 360
            mid = (l1 + diff / 2) % 360

            sign_idx = int(mid / 30) % 12
            key = f"{p1}/{p2}"
            midpoints[key] = {
                'longitude': round(mid, 2),
                'sign': SIGNS[sign_idx],
                'degree': round(mid % 30, 2),
            }

    return midpoints


def find_midpoint_activations(midpoints: Dict, planets: Dict, orb: float = 1.5) -> List[Dict]:
    """Find natal planets sitting on midpoints (natal midpoint pictures)."""
    activations = []
    for key, mp_data in midpoints.items():
        mp_long = mp_data['longitude']
        p1, p2 = key.split('/')
        for name, data in planets.items():
            if name in (p1, p2):
                continue
            p_long = data.get('longitude', 0)
            diff = abs(mp_long - p_long)
            if diff > 180: diff = 360 - diff
            # Check conjunction and opposition to midpoint
            if diff <= orb:
                activations.append({
                    'planet': name, 'midpoint': key,
                    'aspect': 'conjunct', 'orb': round(diff, 2),
                    'meaning': _midpoint_meaning(p1, p2, name),
                })
            elif abs(diff - 90) <= orb:
                activations.append({
                    'planet': name, 'midpoint': key,
                    'aspect': 'square', 'orb': round(abs(diff - 90), 2),
                    'meaning': _midpoint_meaning(p1, p2, name),
                })

    activations.sort(key=lambda a: a['orb'])
    return activations


def _midpoint_meaning(p1: str, p2: str, activator: str) -> str:
    pair = frozenset([p1, p2])
    meanings = {
        frozenset(['Sun', 'Moon']): "core personality integration",
        frozenset(['Sun', 'Mars']): "drive, ambition, physical energy",
        frozenset(['Sun', 'Venus']): "love, beauty, creative expression",
        frozenset(['Sun', 'Jupiter']): "success, expansion, confidence",
        frozenset(['Sun', 'Saturn']): "discipline, limitation, authority",
        frozenset(['Moon', 'Venus']): "emotional love, aesthetic sense",
        frozenset(['Moon', 'Mars']): "emotional intensity, passion",
        frozenset(['Moon', 'Saturn']): "emotional restriction, responsibility",
        frozenset(['Venus', 'Mars']): "sexual expression, desire",
        frozenset(['Venus', 'Jupiter']): "abundance, generosity, joy",
        frozenset(['Mars', 'Saturn']): "controlled energy, frustration or discipline",
        frozenset(['Jupiter', 'Saturn']): "expansion vs contraction, career shifts",
    }
    base = meanings.get(pair, f"{p1}-{p2} themes")
    return f"{activator} activates {p1}/{p2}: {base}"


# ═══════════════════════════════════════════════════════════════
# HARMONIC CHARTS
# ═══════════════════════════════════════════════════════════════

HARMONIC_MEANINGS = {
    4: ('H4 — Effort & Action', 'What you work hard at, karmic action, effort required'),
    5: ('H5 — Creativity & Talent', 'Natural talent, creative gifts, what comes easily'),
    7: ('H7 — Inspiration & Idealism', 'What inspires you, romantic idealism, spiritual aspiration'),
    8: ('H8 — Manifestation', 'What you manifest in the world, practical power'),
    9: ('H9 — Joy & Spiritual Gifts', 'Spiritual talent, what brings deep joy, higher calling'),
    12: ('H12 — Hidden Patterns', 'Unconscious patterns, karmic debts'),
}


def calculate_harmonic(planets: Dict, harmonic: int) -> Dict:
    """
    Harmonic chart: multiply all longitudes by the harmonic number.
    H5 = creativity, H7 = inspiration, H9 = spiritual gifts.
    """
    harm_planets = {}
    for name, data in planets.items():
        lon = data.get('longitude', 0)
        harm_lon = (lon * harmonic) % 360
        sign_idx = int(harm_lon / 30) % 12
        harm_planets[name] = {
            'longitude': round(harm_lon, 2),
            'sign': SIGNS[sign_idx],
            'degree': round(harm_lon % 30, 2),
        }

    # Find conjunctions in harmonic (orb 8°)
    conjunctions = []
    names = list(harm_planets.keys())
    for i, p1 in enumerate(names):
        for p2 in names[i+1:]:
            diff = abs(harm_planets[p1]['longitude'] - harm_planets[p2]['longitude'])
            if diff > 180: diff = 360 - diff
            if diff <= 8:
                conjunctions.append({
                    'planet1': p1, 'planet2': p2,
                    'orb': round(diff, 2),
                })

    title, meaning = HARMONIC_MEANINGS.get(harmonic, (f'H{harmonic}', ''))
    return {
        'harmonic': harmonic,
        'title': title,
        'meaning': meaning,
        'planets': harm_planets,
        'conjunctions': conjunctions,
    }


def get_key_harmonics(planets: Dict) -> Dict:
    """Get H5 (creativity), H7 (inspiration), H9 (spiritual)."""
    return {
        'h5_creativity': calculate_harmonic(planets, 5),
        'h7_inspiration': calculate_harmonic(planets, 7),
        'h9_spiritual': calculate_harmonic(planets, 9),
    }
