"""
DIRECTION COMPASS — Which directions serve you.
"""
from ..core.constants import RASHI_LORDS
from ..core.ephemeris import get_ephemeris

DIRECTIONS = ["East","Southeast","South","Southwest","West","Northwest","North","Northeast"]

PLANET_DIRECTION = {
    "Sun":"East","Venus":"Southeast","Mars":"South","Rahu":"Southwest",
    "Saturn":"West","Moon":"Northwest","Mercury":"North","Jupiter":"Northeast","Ketu":"Northeast",
}

DIRECTION_QUALITIES = {
    "East": {"deity":"Indra","element":"Air","theme":"New beginnings, vitality"},
    "Southeast": {"deity":"Agni","element":"Fire","theme":"Energy, transformation"},
    "South": {"deity":"Yama","element":"Fire","theme":"Fame, recognition"},
    "Southwest": {"deity":"Nirrti","element":"Earth","theme":"Stability, grounding"},
    "West": {"deity":"Varuna","element":"Water","theme":"Gains, completion"},
    "Northwest": {"deity":"Vayu","element":"Air","theme":"Movement, change"},
    "North": {"deity":"Kubera","element":"Water","theme":"Wealth, opportunity"},
    "Northeast": {"deity":"Ishana","element":"Ether","theme":"Spirituality, wisdom"},
}

LIFE_AREA_HOUSES = {"career":[10,6],"love":[7,5],"wealth":[2,11],"health":[1,6],"spiritual":[9,12]}

class DirectionCompass:
    def __init__(self, engine):
        self.engine = engine
        self.planets = engine.planets
        self.asc_rashi = engine.ascendant_rashi
        self.ephemeris = get_ephemeris()

    def full_compass(self):
        scores = {d: 0 for d in DIRECTIONS}
        d_planets = {d: [] for d in DIRECTIONS}
        for planet, data in self.planets.items():
            if planet == "Ascendant": continue
            d = PLANET_DIRECTION.get(planet)
            if not d: continue
            is_b = planet in ("Jupiter","Venus","Mercury","Moon")
            scores[d] += 10 if is_b else 3
            d_planets[d].append(planet)
            for i in range(12):
                if RASHI_LORDS[(self.asc_rashi+i)%12] == planet:
                    h = i+1
                    if h in (1,5,9): scores[d] += 8
                    elif h in (4,7,10): scores[d] += 5
                    elif h in (6,8,12): scores[d] -= 5
        mn, mx = min(scores.values()), max(scores.values())
        rng = max(mx-mn, 1)
        for d in DIRECTIONS: scores[d] = int(((scores[d]-mn)/rng)*80+10)

        life = {}
        for area, houses in LIFE_AREA_HOUSES.items():
            best_d, best_s = "East", 0
            for h in houses:
                lord = RASHI_LORDS[(self.asc_rashi+h-1)%12]
                ld = PLANET_DIRECTION.get(lord, "East")
                if scores.get(ld, 0) > best_s:
                    best_s = scores[ld]
                    best_d = ld
            life[area] = {"direction": best_d, "score": best_s}

        transit_hot = []
        try:
            transits = self.ephemeris.get_current_transits()
            for planet, data in transits.items():
                if planet in ("Rahu","Ketu"): continue
                d = PLANET_DIRECTION.get(planet)
                if d:
                    th = ((data["rashi"]-self.asc_rashi)%12)+1
                    if th in (1,4,7,10): transit_hot.append(d)
        except Exception: pass

        compass = sorted([{"direction":d,"score":scores[d],"planets":d_planets[d],
            "deity":DIRECTION_QUALITIES[d]["deity"],"element":DIRECTION_QUALITIES[d]["element"],
            "theme":DIRECTION_QUALITIES[d]["theme"],"transit_active":d in transit_hot}
            for d in DIRECTIONS], key=lambda x:x["score"], reverse=True)

        p = compass[0]["direction"] if compass else "East"
        s = compass[1]["direction"] if len(compass)>1 else "North"
        a = compass[-1]["direction"] if compass else "South"
        return {"compass":compass,"primary_direction":p,"secondary_direction":s,
            "avoid_direction":a,"life_areas":life,"transit_hot":transit_hot,
            "summary":f"Face {p} for strength. {s} supports growth. Avoid {a} for beginnings."}
