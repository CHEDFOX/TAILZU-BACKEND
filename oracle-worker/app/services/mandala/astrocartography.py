"""
ASTROCARTOGRAPHY — Planetary lines across the globe.
"""
import math
from typing import Dict
from ..core.ephemeris import get_ephemeris

LINE_PLANETS = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn"]
LAT_SAMPLES = list(range(-60, 65, 5))
BENEFICS = {"Jupiter", "Venus", "Mercury", "Moon"}
MALEFICS = {"Sun", "Mars", "Saturn"}

ANGLE_MEANING = {
    "ASC": {"keyword": "identity", "benefic": "Personal magnetism amplified.", "malefic": "Intense self-confrontation."},
    "DSC": {"keyword": "relationships", "benefic": "Partnerships flourish.", "malefic": "Relationships teach hard lessons."},
    "MC":  {"keyword": "career", "benefic": "Career peak location.", "malefic": "High visibility, high stakes."},
    "IC":  {"keyword": "roots", "benefic": "Deep emotional nourishment.", "malefic": "Confronts family patterns."},
}

PLANET_FLAVOR = {
    "Sun": "authority, visibility", "Moon": "emotional life, belonging",
    "Mars": "drive, conflict", "Mercury": "communication, business",
    "Jupiter": "growth, opportunity", "Venus": "love, beauty",
    "Saturn": "discipline, karmic lessons",
}

class Astrocartography:
    def __init__(self, engine):
        self.engine = engine
        self.birth_dt = engine.birth_dt
        self.birth_lat = engine.latitude
        self.birth_lng = engine.longitude
        self.ephemeris = get_ephemeris()
        self.jd = self.ephemeris.get_julian_day(self.birth_dt)
        self._positions = {}
        for planet in LINE_PLANETS:
            pos = self.ephemeris.get_planet_position(self.jd, planet)
            self._positions[planet] = {
                "tropical_longitude": pos.get("tropical_longitude", pos["longitude"]),
                "longitude": pos["longitude"],
                "rashi_name": pos["rashi_name"],
            }

    def calculate_all_lines(self) -> Dict:
        lines = {}
        for planet in LINE_PLANETS:
            trop = self._positions[planet]["tropical_longitude"]
            mc_lng = self._ra_to_lng(trop)
            ic_lng = self._norm(mc_lng + 180)
            asc_pts = []
            for lat in LAT_SAMPLES:
                lng = self._find_asc_lng(trop, lat)
                if lng is not None:
                    asc_pts.append({"lat": lat, "lng": lng})
            dsc_pts = [{"lat": p["lat"], "lng": self._norm(p["lng"] + 180)} for p in asc_pts]
            lines[planet] = {
                "lines": {
                    "MC": {"points": [{"lat": l, "lng": mc_lng} for l in LAT_SAMPLES], "longitude": mc_lng},
                    "IC": {"points": [{"lat": l, "lng": ic_lng} for l in LAT_SAMPLES], "longitude": ic_lng},
                    "ASC": {"points": asc_pts},
                    "DSC": {"points": dsc_pts},
                },
                "sign": self._positions[planet]["rashi_name"],
                "nature": "benefic" if planet in BENEFICS else "malefic",
                "flavor": PLANET_FLAVOR.get(planet, ""),
            }
        return lines

    def find_power_zones(self, lines) -> list:
        zones = []
        planets = list(lines.keys())
        for i, p1 in enumerate(planets):
            for p2 in planets[i+1:]:
                for a1 in ["MC", "ASC"]:
                    for a2 in ["MC", "ASC"]:
                        pts1 = lines[p1]["lines"].get(a1, {}).get("points", [])
                        pts2 = lines[p2]["lines"].get(a2, {}).get("points", [])
                        for pt1 in pts1:
                            for pt2 in pts2:
                                if abs(pt1["lat"] - pt2["lat"]) < 3:
                                    ld = abs(self._norm(pt1["lng"] - pt2["lng"]))
                                    if ld < 5 or ld > 355:
                                        bb = lines[p1]["nature"] == "benefic" and lines[p2]["nature"] == "benefic"
                                        bm = lines[p1]["nature"] == "malefic" and lines[p2]["nature"] == "malefic"
                                        q = "highly favorable" if bb else ("intense" if bm else "mixed")
                                        zones.append({"lat": round((pt1["lat"]+pt2["lat"])/2,1), "lng": round((pt1["lng"]+pt2["lng"])/2,1), "planets": [p1,p2], "angles": [a1,a2], "quality": q})
        unique = []
        for z in zones:
            if not any(abs(z["lat"]-u["lat"])<5 and abs(z["lng"]-u["lng"])<10 for u in unique):
                unique.append(z)
        return sorted(unique, key=lambda z: 0 if z["quality"]=="highly favorable" else 1)[:12]

    def find_line_crossings(self, lines) -> list:
        crossings = []
        for planet, data in lines.items():
            mc_pts = data["lines"].get("MC", {}).get("points", [])
            asc_pts = data["lines"].get("ASC", {}).get("points", [])
            for mc in mc_pts:
                for asc in asc_pts:
                    if abs(mc["lat"]-asc["lat"])<3:
                        ld = abs(self._norm(mc["lng"]-asc["lng"]))
                        if ld < 5 or ld > 355:
                            crossings.append({"planet": planet, "lat": round((mc["lat"]+asc["lat"])/2,1), "lng": round((mc["lng"]+asc["lng"])/2,1), "angles": ["MC","ASC"], "intensity": "very high"})
        return crossings[:8]

    def get_strongest_line(self, lines) -> dict:
        closest = None
        min_d = float("inf")
        for planet, data in lines.items():
            for angle, ld in data["lines"].items():
                for pt in ld.get("points", []):
                    d = self._dist(self.birth_lat, self.birth_lng, pt["lat"], pt["lng"])
                    if d < min_d:
                        min_d = d
                        m = ANGLE_MEANING.get(angle, {})
                        closest = {"planet": planet, "angle": angle, "distance_deg": round(min_d,1), "keyword": m.get("keyword",""), "effect": m.get("benefic" if planet in BENEFICS else "malefic", "")}
        return closest or {}

    def summarize(self, lines, zones) -> str:
        s = self.get_strongest_line(lines)
        if not s: return ""
        parts = [f"Birth location closest to {s['planet']} {s['angle']} line ({s['keyword']})."]
        fav = [z for z in zones if z["quality"]=="highly favorable"]
        if fav:
            z = fav[0]
            parts.append(f"Power zone: {z['planets'][0]}-{z['planets'][1]} near {z['lat']}N, {z['lng']}E.")
        return " ".join(parts)

    def _ra_to_lng(self, trop_long):
        from ..core.ephemeris import swe
        gst = swe.sidtime(self.jd)
        ra_h = trop_long / 15.0
        return self._norm((ra_h - gst) * 15.0)

    def _find_asc_lng(self, trop_long, latitude):
        try:
            obl = 23.4393
            obl_r = math.radians(obl)
            lat_r = math.radians(latitude)
            ecl_r = math.radians(trop_long)
            decl = math.asin(math.sin(obl_r) * math.sin(ecl_r))
            if abs(latitude) > 66: return None
            cv = -math.tan(lat_r) * math.tan(decl)
            if abs(cv) > 1: return None
            ad = math.degrees(math.acos(cv))
            ra = math.degrees(math.atan2(math.sin(ecl_r)*math.cos(obl_r), math.cos(ecl_r)))
            oa = ra - ad
            from ..core.ephemeris import swe
            gst = swe.sidtime(self.jd)
            return self._norm((oa/15.0 - gst) * 15.0)
        except Exception:
            return None

    @staticmethod
    def _norm(lng):
        while lng > 180: lng -= 360
        while lng < -180: lng += 360
        return round(lng, 2)

    @staticmethod
    def _dist(lat1, lng1, lat2, lng2):
        dl = lat2-lat1
        dn = (lng2-lng1)*math.cos(math.radians((lat1+lat2)/2))
        return math.sqrt(dl**2+dn**2)
