"""
VEDHA (OBSTRUCTION) FOR GOCHARA
Classical rule: a favorable transit can be NULLIFIED if another
planet occupies its vedha point.

Example: Jupiter transiting the 2nd house (favorable) is obstructed
if any planet transits the 12th house (vedha point for 2nd).

Without vedha checking, transit predictions overstate positive results.
"""

from typing import Dict

# Vedha pairs: {favorable_house: obstructing_house}
# From Brihat Parashara Hora Shastra and Phaladeepika
VEDHA_PAIRS = {
    1: 5,    # 1st obstructed by planet in 5th
    2: 12,   # 2nd obstructed by planet in 12th
    3: 9,    # 3rd obstructed by planet in 9th
    4: 10,   # 4th obstructed by planet in 10th
    5: 1,    # 5th obstructed by planet in 1st
    6: None, # 6th has no vedha (always effective)
    7: None, # varies by planet — simplified
    8: None, # 8th is malefic, no vedha needed
    9: 3,    # 9th obstructed by planet in 3rd
    10: 4,   # 10th obstructed by planet in 4th
    11: None,# 11th has no vedha (always effective)
    12: 2,   # 12th obstructed by planet in 2nd
}

# Sun and Moon have different vedha points
SUN_MOON_VEDHA = {
    1: 5, 2: 12, 3: 9, 4: 10, 5: 1,
    6: None, 7: None, 8: None,
    9: 3, 10: 4, 11: None, 12: 2,
}

# Saturn has special vedha (different from other planets)
SATURN_VEDHA = {
    1: 5, 2: 12, 3: 9, 4: 10, 5: 1,
    6: None, 7: None, 8: None,
    9: 3, 10: 4, 11: None, 12: 2,
}

FAVORABLE_HOUSES = {
    "Sun": [1, 2, 3, 5, 6, 9, 10, 11],
    "Moon": [1, 3, 6, 7, 10, 11],
    "Mars": [1, 2, 3, 5, 6, 9, 10, 11],
    "Mercury": [1, 2, 4, 6, 8, 10, 11],
    "Jupiter": [2, 5, 7, 9, 11],
    "Venus": [1, 2, 3, 4, 5, 8, 9, 11, 12],
    "Saturn": [3, 6, 11],
    "Rahu": [3, 6, 10, 11],
    "Ketu": [3, 6, 10, 11],
}


def check_vedha(transit_planets: Dict, natal_moon_rashi: int) -> Dict:
    """
    Check vedha obstruction for all transiting planets.
    transit_planets: {planet: {rashi: int, ...}}
    natal_moon_rashi: Moon's birth rashi (1-12), since Gochara is from Moon
    """
    results = []
    obstructed_count = 0
    effective_count = 0

    # Build map of which houses are occupied by transiting planets
    occupied_houses = {}
    for planet, data in transit_planets.items():
        t_rashi = data.get("rashi", 0)
        if not t_rashi:
            continue
        house = ((t_rashi - natal_moon_rashi) % 12) + 1
        if house not in occupied_houses:
            occupied_houses[house] = []
        occupied_houses[house].append(planet)

    # Check each planet
    for planet in ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"]:
        data = transit_planets.get(planet, {})
        t_rashi = data.get("rashi", 0)
        if not t_rashi:
            continue

        house = ((t_rashi - natal_moon_rashi) % 12) + 1
        favorable_houses = FAVORABLE_HOUSES.get(planet, [])
        is_favorable = house in favorable_houses

        # Get vedha point
        vedha_house = VEDHA_PAIRS.get(house)

        # Check if vedha point is occupied
        is_obstructed = False
        obstructing_planet = None

        if vedha_house and is_favorable:
            occupants = occupied_houses.get(vedha_house, [])
            # A planet cannot obstruct itself
            other_occupants = [p for p in occupants if p != planet]
            if other_occupants:
                is_obstructed = True
                obstructing_planet = other_occupants[0]
                obstructed_count += 1

        if is_favorable and not is_obstructed:
            effective_count += 1

        results.append({
            "planet": planet,
            "transit_house": house,
            "is_favorable": is_favorable,
            "vedha_house": vedha_house,
            "is_obstructed": is_obstructed,
            "obstructing_planet": obstructing_planet,
            "effective": is_favorable and not is_obstructed,
            "status": _get_status(is_favorable, is_obstructed),
        })

    # Summary
    if obstructed_count == 0 and effective_count > 3:
        summary = "No vedha obstructions. All favorable transits deliver full results."
    elif obstructed_count >= 3:
        summary = "Multiple vedha obstructions. Several favorable transits are blocked."
    elif obstructed_count > 0:
        blocked = [r["planet"] for r in results if r["is_obstructed"]]
        summary = "Vedha blocks " + ", ".join(blocked) + ". Their favorable effects are weakened."
    else:
        summary = "Few favorable transits active. Focus on inner development."

    return {
        "vedha_results": results,
        "obstructed_count": obstructed_count,
        "effective_favorable": effective_count,
        "summary": summary,
    }


def _get_status(is_favorable: bool, is_obstructed: bool) -> str:
    if is_favorable and not is_obstructed:
        return "EFFECTIVE — delivers full results"
    elif is_favorable and is_obstructed:
        return "OBSTRUCTED — favorable transit blocked by vedha"
    elif not is_favorable:
        return "UNFAVORABLE — challenging transit house"
    return "NEUTRAL"


def format_for_oracle(vedha_data: Dict) -> str:
    if vedha_data["obstructed_count"] == 0:
        return ""
    blocked = [r for r in vedha_data["vedha_results"] if r["is_obstructed"]]
    parts = []
    for b in blocked:
        parts.append(
            b["planet"] + " in H" + str(b["transit_house"]) +
            " (favorable) BLOCKED by " + str(b["obstructing_planet"]) +
            " in H" + str(b["vedha_house"])
        )
    return "VEDHA OBSTRUCTION: " + " | ".join(parts)
