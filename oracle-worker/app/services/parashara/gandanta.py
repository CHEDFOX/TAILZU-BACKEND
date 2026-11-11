"""
GANDANTA ANALYSIS
Karmic knot at water-fire sign junctions.
Last 3d20m of water sign + first 3d20m of fire sign.
"""

from typing import Dict

GANDANTA_ZONES = [
    (116.6667, 123.3333, "Cancer", "Leo",
     "emotional security dissolving into self-expression"),
    (236.6667, 243.3333, "Scorpio", "Sagittarius",
     "death-rebirth energy transforming into wisdom seeking"),
    (356.6667, 360.0, "Pisces", "Aries",
     "cosmic dissolution meeting raw new beginning"),
    (0.0, 3.3333, "Pisces", "Aries",
     "cosmic dissolution meeting raw new beginning"),
]

GANDANTA_EFFECTS = {
    "Moon": "Deep existential restlessness. The mind oscillates between two modes. Spiritual practice is survival, not optional.",
    "Sun": "Identity crisis at a deep level. The father figure may be absent or transformative.",
    "Mars": "Courage tested at karmic levels. Physical danger in specific periods. Must channel intense energy wisely.",
    "Mercury": "The intellect carries a wound. Communication has an intensity others find unsettling or magnetic.",
    "Jupiter": "Wisdom comes through crisis, not study. The guru figure is absent or flawed. Faith is earned.",
    "Venus": "Love carries karmic weight. Relationships are the crucible for spiritual transformation.",
    "Saturn": "Karma is concentrated and accelerated. Life lessons come faster and harder than for others.",
    "Rahu": "Obsessive karmic pull toward unfinished past-life desires. The craving carries both poison and medicine.",
    "Ketu": "Spiritual detachment is forced, not chosen. The person may feel alienated from ordinary life.",
    "Ascendant": "The entire life is lived at a Gandanta edge. Nothing settles permanently. The person IS the karmic knot.",
}


def analyze_gandanta(planets: Dict) -> Dict:
    gandanta_planets = []
    bodies = ["Sun", "Moon", "Mars", "Mercury", "Jupiter",
              "Venus", "Saturn", "Rahu", "Ketu", "Ascendant"]

    for body in bodies:
        p_data = planets.get(body, {})
        longitude = p_data.get("longitude", 0) % 360
        zone = _find_zone(longitude)
        if zone:
            depth = _calc_depth(longitude, zone)
            if depth > 0.6:
                severity = "deep"
            elif depth > 0.3:
                severity = "moderate"
            else:
                severity = "mild"

            gandanta_planets.append({
                "planet": body,
                "longitude": round(longitude, 4),
                "degree_in_sign": round(longitude % 30, 2),
                "rashi": p_data.get("rashi_name", ""),
                "house": p_data.get("house", 0),
                "gandanta_zone": zone[2] + "-" + zone[3],
                "theme": zone[4],
                "depth": round(depth, 2),
                "severity": severity,
                "karmic_effect": GANDANTA_EFFECTS.get(body, "Karmic intensity in this domain."),
            })

    if not gandanta_planets:
        summary = "No Gandanta placements."
    else:
        names = [p["planet"] for p in gandanta_planets]
        moon_g = any(p["planet"] == "Moon" for p in gandanta_planets)
        asc_g = any(p["planet"] == "Ascendant" for p in gandanta_planets)
        if moon_g and asc_g:
            summary = "Both Moon AND Ascendant in Gandanta. Deeply karmic chart."
        elif moon_g:
            summary = "Moon in Gandanta. Emotional core sits at a karmic junction."
        elif asc_g:
            summary = "Ascendant in Gandanta. Whole life carries karmic knot quality."
        else:
            summary = "Gandanta: " + ", ".join(names) + ". Karmic intensity in those domains."

    return {
        "gandanta_planets": gandanta_planets,
        "total_gandanta": len(gandanta_planets),
        "summary": summary,
        "has_moon_gandanta": any(p["planet"] == "Moon" for p in gandanta_planets),
        "has_asc_gandanta": any(p["planet"] == "Ascendant" for p in gandanta_planets),
    }


def _find_zone(longitude):
    for zone in GANDANTA_ZONES:
        if zone[0] <= longitude <= zone[1]:
            return zone
    return None


def _calc_depth(longitude, zone):
    total = zone[1] - zone[0]
    if total <= 0:
        return 0
    pos = longitude - zone[0]
    ratio = pos / total
    return 1.0 - abs(ratio - 0.5) * 2


def format_for_oracle(gandanta_data: Dict) -> str:
    if gandanta_data["total_gandanta"] == 0:
        return ""
    lines = []
    for p in gandanta_data["gandanta_planets"]:
        lines.append(p["planet"] + " IN GANDANTA (" + p["gandanta_zone"] + ", " + p["severity"] + "): " + p["karmic_effect"][:120])
    return "GANDANTA: " + " | ".join(lines)
