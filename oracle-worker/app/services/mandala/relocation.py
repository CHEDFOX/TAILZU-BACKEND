"""
RELOCATION CHART — How geography reshapes your birth chart.
"""
from ..core.constants import RASHI_NAMES
from ..core.ephemeris import get_ephemeris
from .cities_db import CITIES as WORLD_CITIES

# WORLD_CITIES imported from cities_db


HOUSE_CAREER = {1:5,2:3,3:2,4:0,5:3,6:4,7:4,8:-2,9:4,10:10,11:6,12:-3}
HOUSE_LOVE = {1:3,2:2,3:1,4:4,5:7,6:-2,7:10,8:3,9:3,10:0,11:5,12:-1}
HOUSE_HEALTH = {1:10,2:2,3:3,4:3,5:2,6:-5,7:0,8:-6,9:4,10:1,11:3,12:-4}
HOUSE_WEALTH = {1:3,2:10,3:1,4:4,5:5,6:2,7:3,8:3,9:5,10:4,11:8,12:-3}
HOUSE_SPIRITUAL = {1:3,2:0,3:1,4:5,5:6,6:2,7:0,8:7,9:10,10:0,11:2,12:8}
BENEFICS = {"Jupiter","Venus","Mercury","Moon"}

class RelocationChart:
    def __init__(self, engine):
        self.engine = engine
        self.birth_dt = engine.birth_dt
        self.natal_asc_rashi = engine.ascendant_rashi
        self.natal_planets = engine.planets
        self.birth_lat = engine.latitude
        self.birth_lng = engine.longitude
        self.ephemeris = get_ephemeris()
        self.jd = self.ephemeris.get_julian_day(self.birth_dt)

    def _get_relocated_asc(self, lat, lng):
        try:
            asc = self.ephemeris.get_ascendant(self.jd, lat, lng)
            return asc["rashi"]
        except Exception:
            return self.natal_asc_rashi

    def analyze_location(self, lat, lng, city_name="Location"):
        new_asc = self._get_relocated_asc(lat, lng)
        shifts = {}
        for planet, data in self.natal_planets.items():
            if planet == "Ascendant": continue
            old_h = data.get("house", 1)
            new_h = ((data.get("rashi", 0) - new_asc) % 12) + 1
            shifts[planet] = {"old_house": old_h, "new_house": new_h, "shifted": old_h != new_h, "sign": data.get("rashi_name", "")}
            if old_h != new_h:
                shifts[planet]["impact"] = self._assess(planet, old_h, new_h)
        scores = self._score(new_asc, shifts)
        changes = []
        for p, s in shifts.items():
            if not s["shifted"]: continue
            oh, nh = s["old_house"], s["new_house"]
            if nh in (1,4,7,10) and oh not in (1,4,7,10):
                changes.append(f"{p} to H{nh} (Kendra) — angular power")
            elif nh in (6,8,12) and oh not in (6,8,12):
                changes.append(f"{p} to H{nh} (Dusthana) — challenged")
            elif oh in (6,8,12) and nh not in (6,8,12):
                changes.append(f"{p} escapes H{oh} to H{nh} — liberated")
        return {
            "city": city_name, "coordinates": {"lat": lat, "lng": lng},
            "natal_ascendant": RASHI_NAMES[self.natal_asc_rashi],
            "relocated_ascendant": RASHI_NAMES[new_asc],
            "relocated_asc_rashi": new_asc,
            "ascendant_changed": new_asc != self.natal_asc_rashi,
            "planet_shifts": shifts, "planets_shifted": sum(1 for s in shifts.values() if s["shifted"]),
            "scores": scores, "overall_score": scores.get("overall", 50),
            "rating": self._rating(scores.get("overall", 50)), "key_changes": changes,
        }

    def full_relocation_report(self, lat=None, lng=None, city_name=None):
        if lat is None or lng is None:
            if city_name and city_name in WORLD_CITIES:
                c = WORLD_CITIES[city_name]
                lat, lng = c["lat"], c["lng"]
            else:
                lat, lng = self.birth_lat, self.birth_lng
                city_name = city_name or "Birth location"
        a = self.analyze_location(lat, lng, city_name or "Location")
        s = a["scores"]
        a["best_for"] = max(["career","love","health","wealth","spiritual"], key=lambda k: s.get(k,0))
        a["worst_for"] = min(["career","love","health","wealth","spiritual"], key=lambda k: s.get(k,0))
        return a

    def rank_cities(self, purpose="overall", cities=None):
        if cities is None: cities = list(WORLD_CITIES.keys())
        results = []
        for city in cities:
            c = WORLD_CITIES.get(city)
            if not c: continue
            a = self.analyze_location(c["lat"], c["lng"], city)
            score = a["scores"].get(purpose, a["scores"].get("overall", 50))
            results.append({"city": city, "country": c.get("country",""), "score": score,
                "rating": self._rating(score), "ascendant": a["relocated_ascendant"],
                "planets_shifted": a["planets_shifted"],
                "key_change": a["key_changes"][0] if a["key_changes"] else ""})
        results.sort(key=lambda x: x["score"], reverse=True)
        return {"purpose": purpose, "ranking": results, "best_city": results[0] if results else {},
                "top_5": results[:5], "avoid": results[-3:] if len(results)>=3 else []}

    def _score(self, new_asc, shifts):
        scores = {"career":50,"love":50,"health":50,"wealth":50,"spiritual":50}
        maps = {"career":HOUSE_CAREER,"love":HOUSE_LOVE,"health":HOUSE_HEALTH,"wealth":HOUSE_WEALTH,"spiritual":HOUSE_SPIRITUAL}
        for planet, s in shifts.items():
            if planet in ("Ascendant","Rahu","Ketu"): continue
            nh = s["new_house"]
            m = 1.2 if planet in BENEFICS else 0.8
            for area, hm in maps.items():
                scores[area] += int(hm.get(nh, 0) * m)
        for k in scores: scores[k] = max(0, min(100, scores[k]))
        scores["overall"] = int(scores["career"]*0.25+scores["love"]*0.2+scores["health"]*0.2+scores["wealth"]*0.2+scores["spiritual"]*0.15)
        return scores

    def _assess(self, planet, old_h, new_h):
        if new_h in (1,4,7,10) and old_h not in (1,4,7,10): return "strengthened"
        if new_h in (6,8,12) and old_h not in (6,8,12): return "weakened"
        if old_h in (6,8,12) and new_h not in (6,8,12): return "liberated"
        return "shifted"

    @staticmethod
    def _rating(score):
        if score >= 75: return "Excellent"
        if score >= 60: return "Good"
        if score >= 45: return "Average"
        return "Challenging"
