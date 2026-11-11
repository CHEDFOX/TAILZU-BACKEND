"""
BPHS Chapter 43 — Shodhya Pinda
Numerical strength derived from reduced (sodhita) Ashtakavarga.
Used for longevity calculations and planet strength ranking.

Three pindas:
1. Graha Pinda — from planet's own AV chart
2. Rashi Pinda — from sign position
3. Shodhya Pinda — combined final value
"""
from typing import Dict

# Rashi multipliers per BPHS
RASHI_MULTIPLIERS = {
    0: 7, 1: 10, 2: 8, 3: 4, 4: 10, 5: 6,
    6: 7, 7: 8, 8: 9, 9: 5, 10: 11, 11: 12,
}

# Planet multipliers for graha pinda
GRAHA_MULTIPLIERS = {
    'Sun': 5, 'Moon': 5, 'Mars': 8, 'Mercury': 5,
    'Jupiter': 10, 'Venus': 7, 'Saturn': 5,
}


def calculate_shodhya_pinda(sodhita_av: Dict, planets: Dict) -> Dict:
    """
    Calculate Shodhya Pinda from reduced (sodhita) AV data.
    sodhita_av: output from av_sodhana.calculate_sodhana_for_all()
    planets: planet data with rashi positions
    """
    results = {}

    for planet_name in ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']:
        planet_av = sodhita_av.get(planet_name, {})
        reduced_bindus = planet_av.get('reduced_bindus', [0] * 12)

        if len(reduced_bindus) != 12:
            continue

        # 1. Graha Pinda — sum of (reduced bindus * graha multiplier for each contributing planet)
        # Simplified: sum of reduced bindus * planet's own multiplier
        graha_pinda = sum(reduced_bindus) * GRAHA_MULTIPLIERS.get(planet_name, 5) / 12

        # 2. Rashi Pinda — reduced bindu in planet's occupied sign * rashi multiplier
        planet_rashi = planets.get(planet_name, {}).get('rashi', 0)
        rashi_bindu = reduced_bindus[planet_rashi] if planet_rashi < 12 else 0
        rashi_pinda = rashi_bindu * RASHI_MULTIPLIERS.get(planet_rashi, 7)

        # 3. Shodhya Pinda — sum of both
        shodhya_pinda = round(graha_pinda + rashi_pinda, 2)

        results[planet_name] = {
            'planet': planet_name,
            'graha_pinda': round(graha_pinda, 2),
            'rashi_pinda': round(rashi_pinda, 2),
            'shodhya_pinda': shodhya_pinda,
            'planet_rashi': planet_rashi,
            'reduced_bindu_in_rashi': rashi_bindu,
            'total_reduced_bindus': sum(reduced_bindus),
        }

    # Rank by shodhya pinda
    ranked = sorted(results.values(), key=lambda x: x['shodhya_pinda'], reverse=True)
    for i, r in enumerate(ranked):
        results[r['planet']]['rank'] = i + 1

    return {
        'planets': results,
        'strongest': ranked[0]['planet'] if ranked else 'Unknown',
        'weakest': ranked[-1]['planet'] if ranked else 'Unknown',
        'ranking': [{'planet': r['planet'], 'pinda': r['shodhya_pinda']} for r in ranked],
    }

