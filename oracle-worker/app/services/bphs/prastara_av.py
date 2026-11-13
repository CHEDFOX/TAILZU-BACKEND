"""
BPHS Chapter 43 — Prastara Ashtakavarga
Individual planet contribution tables showing which planet
contributes bindus to which sign. Essential for transit timing.
Each of 7 planets + ascendant contributes 0 or 1 bindu per sign
for each of 7 planets' charts.
"""
from typing import Dict

SIGN_LORDS = {
    0: 'Mars', 1: 'Venus', 2: 'Mercury', 3: 'Moon', 4: 'Sun', 5: 'Mercury',
    6: 'Venus', 7: 'Mars', 8: 'Jupiter', 9: 'Saturn', 10: 'Saturn', 11: 'Jupiter',
}

# Benefic positions from each planet/ascendant for each planet's chart
# Format: BENEFIC_POSITIONS[chart_planet][contributing_planet] = list of houses from contributing planet where bindu is given
# Per BPHS standard rules

BENEFIC_POSITIONS = {
    'Sun': {
        'Sun': [1,2,4,7,8,9,10,11],
        'Moon': [3,6,10,11],
        'Mars': [1,2,4,7,8,9,10,11],
        'Mercury': [3,5,6,9,10,11,12],
        'Jupiter': [5,6,9,11],
        'Venus': [6,7,12],
        'Saturn': [1,2,4,7,8,9,10,11],
        'Ascendant': [3,4,6,10,11,12],
    },
    'Moon': {
        'Sun': [3,6,7,8,10,11],
        'Moon': [1,3,6,7,10,11],
        'Mars': [2,3,5,6,9,10,11],
        'Mercury': [1,3,4,5,7,8,10,11],
        'Jupiter': [1,4,7,8,10,11,12],
        'Venus': [3,4,5,7,9,10,11],
        'Saturn': [3,5,6,11],
        'Ascendant': [3,6,10,11],
    },
    'Mars': {
        'Sun': [3,5,6,10,11],
        'Moon': [3,6,11],
        'Mars': [1,2,4,7,8,10,11],
        'Mercury': [3,5,6,11],
        'Jupiter': [6,10,11,12],
        'Venus': [6,8,11,12],
        'Saturn': [1,4,7,8,9,10,11],
        'Ascendant': [1,3,6,10,11],
    },
    'Mercury': {
        'Sun': [5,6,9,11,12],
        'Moon': [2,4,6,8,10,11],
        'Mars': [1,2,4,7,8,9,10,11],
        'Mercury': [1,3,5,6,9,10,11,12],
        'Jupiter': [6,8,11,12],
        'Venus': [1,2,3,4,5,8,9,11],
        'Saturn': [1,2,4,7,8,9,10,11],
        'Ascendant': [1,2,4,6,8,10,11],
    },
    'Jupiter': {
        'Sun': [1,2,3,4,7,8,9,10,11],
        'Moon': [2,5,7,9,11],
        'Mars': [1,2,4,7,8,10,11],
        'Mercury': [1,2,4,5,6,9,10,11],
        'Jupiter': [1,2,3,4,7,8,10,11],
        'Venus': [2,5,6,9,10,11],
        'Saturn': [3,5,6,12],
        'Ascendant': [1,2,4,5,6,7,9,10,11],
    },
    'Venus': {
        'Sun': [8,11,12],
        'Moon': [1,2,3,4,5,8,9,11,12],
        'Mars': [3,5,6,9,11,12],
        'Mercury': [3,5,6,9,11],
        'Jupiter': [5,8,9,10,11],
        'Venus': [1,2,3,4,5,8,9,10,11],
        'Saturn': [3,4,5,8,9,10,11],
        'Ascendant': [1,2,3,4,5,8,9,11],
    },
    'Saturn': {
        'Sun': [1,2,4,7,8,10,11],
        'Moon': [3,6,11],
        'Mars': [3,5,6,10,11,12],
        'Mercury': [6,8,9,10,11,12],
        'Jupiter': [5,6,11,12],
        'Venus': [6,11,12],
        'Saturn': [3,5,6,11],
        'Ascendant': [1,3,4,6,10,11],
    },
}


def calculate_prastara(planets: Dict) -> Dict:
    """Calculate Prastara Ashtakavarga for all 7 planets."""
    # Get house positions
    positions = {}
    for name, data in planets.items():
        if name in ('Ascendant', 'Asc'):
            positions['Ascendant'] = data.get('house', 1) if isinstance(data, dict) else 1
        elif name in BENEFIC_POSITIONS or name in ['Sun','Moon','Mars','Mercury','Jupiter','Venus','Saturn']:
            positions[name] = data.get('house', 1)

    asc_house = positions.get('Ascendant', 1)
    results = {}

    for chart_planet in ['Sun','Moon','Mars','Mercury','Jupiter','Venus','Saturn']:
        if chart_planet not in BENEFIC_POSITIONS:
            continue

        # Initialize 12 signs with empty contributors
        prastara = [{} for _ in range(12)]
        bindus = [0] * 12

        for contributor in ['Sun','Moon','Mars','Mercury','Jupiter','Venus','Saturn','Ascendant']:
            benefic_houses = BENEFIC_POSITIONS[chart_planet].get(contributor, [])

            if contributor == 'Ascendant':
                base = asc_house
            else:
                base = positions.get(contributor, 1)

            for bh in benefic_houses:
                target_sign = (base + bh - 2) % 12
                prastara[target_sign][contributor] = 1
                bindus[target_sign] += 1

        results[chart_planet] = {
            'bindus': bindus,
            'total': sum(bindus),
            'prastara': prastara,
            'contributors_per_sign': [
                {
                    'sign_index': i,
                    'bindu_count': bindus[i],
                    'contributors': [k for k, v in prastara[i].items() if v == 1],
                }
                for i in range(12)
            ],
        }

    # SAV (sum of all)
    sav = [0] * 12
    for planet, data in results.items():
        for i in range(12):
            sav[i] += data['bindus'][i]

    results['SAV'] = {
        'bindus': sav,
        'total': sum(sav),
    }

    return results

