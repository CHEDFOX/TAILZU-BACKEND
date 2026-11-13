"""
BPHS Chapter 17 — Graha Yuddha (Planetary War)
When two planets (Mars/Mercury/Jupiter/Venus/Saturn) are within 1 degree.
The one with higher longitude (or brightness) wins. Loser is weakened.
Sun, Moon, Rahu, Ketu are excluded from planetary war.
"""
from typing import Dict

WAR_PLANETS = ['Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']

# Natural brightness order (brightest to dimmest per BPHS)
BRIGHTNESS_ORDER = {'Venus': 5, 'Jupiter': 4, 'Mars': 3, 'Mercury': 2, 'Saturn': 1}


def calculate_graha_yuddha(planets: Dict) -> Dict:
    wars = []
    war_planets = {}

    candidates = []
    for name in WAR_PLANETS:
        if name in planets:
            candidates.append({
                'name': name,
                'longitude': planets[name].get('longitude', 0),
                'brightness': BRIGHTNESS_ORDER.get(name, 0),
            })

    # Check all pairs
    for i in range(len(candidates)):
        for j in range(i + 1, len(candidates)):
            p1 = candidates[i]
            p2 = candidates[j]

            diff = abs(p1['longitude'] - p2['longitude'])
            # Handle 360 wraparound
            if diff > 180:
                diff = 360 - diff

            if diff <= 1.0:
                # Determine winner — brighter planet wins per BPHS
                if p1['brightness'] > p2['brightness']:
                    winner, loser = p1, p2
                elif p2['brightness'] > p1['brightness']:
                    winner, loser = p2, p1
                else:
                    # Same brightness (shouldn't happen) — higher longitude wins
                    if p1['longitude'] > p2['longitude']:
                        winner, loser = p1, p2
                    else:
                        winner, loser = p2, p1

                war = {
                    'planet1': p1['name'],
                    'planet2': p2['name'],
                    'separation': round(diff, 4),
                    'winner': winner['name'],
                    'loser': loser['name'],
                    'winner_effect': f"{winner['name']} gains strength from winning planetary war",
                    'loser_effect': f"{loser['name']} is weakened — results diminished significantly",
                    'winner_strength_bonus': 1.15,
                    'loser_strength_penalty': 0.5,
                }
                wars.append(war)

                war_planets[winner['name']] = {'role': 'winner', 'bonus': 1.15, 'opponent': loser['name']}
                war_planets[loser['name']] = {'role': 'loser', 'penalty': 0.5, 'opponent': winner['name']}

    return {
        'has_war': len(wars) > 0,
        'wars': wars,
        'affected_planets': war_planets,
        'total_wars': len(wars),
    }
