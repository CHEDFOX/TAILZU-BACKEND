"""
PLANETARY COMBUSTION (Asta)
When a planet is too close to the Sun, it loses its significations.
"""

from typing import Dict

COMBUSTION_ORBS = {
    "Moon": 12.0, "Mars": 17.0, "Mercury": 14.0,
    "Jupiter": 11.0, "Venus": 10.0, "Saturn": 15.0,
}

COMBUSTION_EFFECTS = {
    "Moon": {
        "domain": "emotions, mind, mother",
        "effect": "emotional turbulence, restless mind, complicated relationship with mother",
        "severity_note": "Moon combustion is the most personally felt",
    },
    "Mars": {
        "domain": "courage, drive, siblings, property",
        "effect": "suppressed aggression, difficulties asserting oneself",
        "severity_note": "Mars combustion weakens initiative",
    },
    "Mercury": {
        "domain": "intellect, communication, business",
        "effect": "unclear thinking, miscommunication, analytical ability overshadowed",
        "severity_note": "Mercury combustion impacts career in communication fields",
    },
    "Jupiter": {
        "domain": "wisdom, luck, children, teacher",
        "effect": "diminished fortune, poor advice from mentors, spiritual confusion",
        "severity_note": "Jupiter combustion reduces protective grace",
    },
    "Venus": {
        "domain": "love, marriage, beauty, luxury",
        "effect": "love life carries a burning quality, intense but painful attractions",
        "severity_note": "Venus combustion is a primary indicator of marriage difficulties",
    },
    "Saturn": {
        "domain": "discipline, career structure, longevity",
        "effect": "career instability, difficulty sustaining long-term commitments",
        "severity_note": "Saturn combustion undermines slow-building structures",
    },
}


def analyze_combustion(planets: Dict) -> Dict:
    sun_long = planets.get("Sun", {}).get("longitude", 0)
    combust_planets = []
    safe_planets = []

    for planet, orb in COMBUSTION_ORBS.items():
        p_data = planets.get(planet, {})
        p_long = p_data.get("longitude", 0)
        diff = abs(sun_long - p_long)
        if diff > 180:
            diff = 360 - diff

        is_combust = diff <= orb
        is_retro = p_data.get("retrograde", False)

        if is_combust:
            ratio = diff / orb
            if ratio < 0.3:
                severity = "severe"
            elif ratio < 0.6:
                severity = "moderate"
            else:
                severity = "mild"
            if is_retro and severity != "mild":
                severity = {"severe": "moderate", "moderate": "mild"}.get(severity, severity)

            effects = COMBUSTION_EFFECTS.get(planet, {})
            combust_planets.append({
                "planet": planet,
                "distance_from_sun": round(diff, 2),
                "orb_limit": orb,
                "severity": severity,
                "retrograde": is_retro,
                "house": p_data.get("house", 0),
                "rashi": p_data.get("rashi_name", ""),
                "domain": effects.get("domain", ""),
                "effect": effects.get("effect", ""),
                "severity_note": effects.get("severity_note", ""),
            })
        else:
            safe_planets.append({"planet": planet, "distance_from_sun": round(diff, 2)})

    severe_count = sum(1 for p in combust_planets if p["severity"] == "severe")
    moderate_count = sum(1 for p in combust_planets if p["severity"] == "moderate")

    if severe_count >= 2:
        overall = "Multiple severe combustions - several life areas significantly weakened"
    elif severe_count == 1:
        pn = [p["planet"] for p in combust_planets if p["severity"] == "severe"][0]
        overall = "Severe combustion of " + pn + " - " + COMBUSTION_EFFECTS[pn]["domain"] + " area deeply affected"
    elif moderate_count >= 2:
        overall = "Multiple moderate combustions - scattered weakening"
    elif combust_planets:
        overall = "Mild combustion present - subtle influence"
    else:
        overall = "No combustion - all planets maintain full strength"

    return {
        "combust_planets": combust_planets,
        "safe_planets": safe_planets,
        "total_combust": len(combust_planets),
        "severe_count": severe_count,
        "summary": overall,
    }


def format_for_oracle(combustion_data: Dict) -> str:
    if combustion_data["total_combust"] == 0:
        return ""
    lines = []
    for p in combustion_data["combust_planets"]:
        sev = p["severity"].upper()
        lines.append(p["planet"] + " COMBUST (" + sev + ", " + str(p["distance_from_sun"]) + " deg from Sun): " + p["effect"])
    return "COMBUSTION: " + " | ".join(lines)
