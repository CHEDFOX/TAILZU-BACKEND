from datetime import datetime
from typing import Dict
from ..core.constants import RASHI_NAMES, RASHI_LORDS
from ..core.ephemeris import get_ephemeris
from .mundane_engine import MUNDANE_HOUSES, PLANET_MUNDANE

class UniversalMundane:
    """
    Mundane astrology for ANY coordinate on Earth.
    No foundation chart needed. Three layers:
    1. Geodetic ascendant — permanent identity from longitude
    2. Sankranti chart — annual forecast from Aries ingress
    3. Current sky — real-time energy at that point
    """

    def __init__(self, engine):
        self.engine = engine
        self.ephemeris = get_ephemeris()
        self.personal_asc = engine.ascendant_rashi
        self.personal_planets = engine.planets

    def analyze_coordinate(self, lat, lng, name="") -> Dict:
        """Full mundane reading for any point on Earth."""
        if not name:
            name = f"{abs(lat):.1f}{'N' if lat>=0 else 'S'}, {abs(lng):.1f}{'E' if lng>=0 else 'W'}"

        geo = self._geodetic_chart(lng)
        sky = self._current_sky(lat, lng)
        sankranti = self._sankranti_chart(lat, lng)
        personal = self._personal_overlay(geo, sky)

        # Combine scores
        geo_score = geo.get("favorability", 50)
        sky_score = sky.get("energy_score", 50)
        combined = int(geo_score * 0.5 + sky_score * 0.3 + sankranti.get("year_score", 50) * 0.2)

        return {
            "location": name,
            "lat": lat, "lng": lng,
            "geodetic": geo,
            "current_sky": sky,
            "annual_forecast": sankranti,
            "personal_overlay": personal,
            "combined_score": combined,
            "rating": "Excellent" if combined >= 75 else ("Good" if combined >= 60 else ("Average" if combined >= 45 else "Challenging")),
            "summary": self._build_summary(name, geo, sky, sankranti, personal, combined),
        }

    def _geodetic_chart(self, lng) -> Dict:
        """Permanent astrological identity from longitude."""
        normalized = lng % 360
        if lng < 0: normalized = 360 + lng
        geo_asc_idx = int(normalized / 30) % 12
        geo_asc = RASHI_NAMES[geo_asc_idx]
        geo_lord = RASHI_LORDS[geo_asc_idx]

        # Run current transits through this geodetic ascendant
        try: transits = self.ephemeris.get_current_transits()
        except: transits = {}

        house_activations = {}
        transit_weather = []
        favorability = 50

        for planet, td in transits.items():
            tr = td.get("rashi", 0)
            house = ((tr - geo_asc_idx) % 12) + 1
            house_activations[house] = house_activations.get(house, [])
            house_activations[house].append(planet)

            if planet in ("Jupiter", "Saturn", "Rahu", "Ketu"):
                hi = MUNDANE_HOUSES.get(house, {})
                domain = hi.get("domain", "")

                if planet == "Jupiter":
                    if house in (1,2,5,9,11): favorability += 8
                    elif house in (6,8,12): favorability += 2
                    else: favorability += 5
                    tone = "expanding"
                elif planet == "Saturn":
                    if house in (3,6,10,11): favorability += 3
                    elif house in (1,4,7,8): favorability -= 5
                    else: favorability -= 2
                    tone = "pressuring"
                elif planet == "Rahu":
                    if house in (3,6,10,11): favorability += 3
                    else: favorability -= 3
                    tone = "disrupting"
                elif planet == "Ketu":
                    if house in (9,12): favorability += 3
                    else: favorability -= 2
                    tone = "detaching from"

                transit_weather.append({
                    "planet": planet, "house": house, "domain": domain,
                    "sign": td.get("rashi_name", ""), "tone": tone,
                    "reading": f"{planet} {tone} {domain} (H{house})",
                })

        favorability = max(10, min(95, favorability))

        # Determine which houses are strong/weak
        strong_houses = [h for h, planets in house_activations.items()
                        if any(p in ("Jupiter", "Venus") for p in planets)]
        stressed_houses = [h for h, planets in house_activations.items()
                          if any(p in ("Saturn", "Mars", "Rahu") for p in planets) and h in (1,4,7,8)]

        return {
            "geodetic_ascendant": geo_asc,
            "geodetic_lord": geo_lord,
            "transit_weather": transit_weather,
            "favorability": favorability,
            "strong_domains": [MUNDANE_HOUSES.get(h, {}).get("domain", "") for h in strong_houses],
            "stressed_domains": [MUNDANE_HOUSES.get(h, {}).get("domain", "") for h in stressed_houses],
        }

    def _current_sky(self, lat, lng) -> Dict:
        """What's overhead RIGHT NOW at this coordinate."""
        now = datetime.utcnow()
        jd = self.ephemeris.get_julian_day(now)

        try:
            asc_data = self.ephemeris.get_ascendant(jd, lat, lng)
            current_asc = asc_data.get("rashi", 0)
            current_asc_name = asc_data.get("rashi_name", RASHI_NAMES[current_asc])
        except:
            current_asc = 0
            current_asc_name = "Aries"

        try: transits = self.ephemeris.get_current_transits()
        except: transits = {}

        angular_planets = []
        energy_score = 50

        for planet, td in transits.items():
            tr = td.get("rashi", 0)
            house = ((tr - current_asc) % 12) + 1
            if house in (1, 4, 7, 10):  # angular = powerful
                is_benefic = planet in ("Jupiter", "Venus", "Mercury", "Moon")
                angular_planets.append({
                    "planet": planet, "house": house, "sign": td.get("rashi_name", ""),
                    "nature": "benefic" if is_benefic else "malefic",
                    "meaning": f"{planet} angular in H{house} — {'positive' if is_benefic else 'intense'} energy here now",
                })
                if is_benefic: energy_score += 8
                else: energy_score -= 3

        energy_score = max(10, min(95, energy_score))

        # Current hora (planetary hour)
        hour = now.hour
        hora_sequence = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn"]
        weekday = now.weekday()  # 0=Mon
        weekday_map = {0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 0}  # Mon=Moon, Tue=Mars...
        day_lord_idx = weekday_map.get(weekday, 0)
        hora_planet = hora_sequence[(day_lord_idx + hour) % 7]

        return {
            "current_ascendant": current_asc_name,
            "angular_planets": angular_planets,
            "energy_score": energy_score,
            "hora_planet": hora_planet,
            "hora_meaning": f"{hora_planet} hora — {PLANET_MUNDANE.get(hora_planet, '')}",
            "benefics_angular": sum(1 for p in angular_planets if p["nature"] == "benefic"),
            "malefics_angular": sum(1 for p in angular_planets if p["nature"] == "malefic"),
        }

    def _sankranti_chart(self, lat, lng) -> Dict:
        """Annual forecast from the last Aries ingress chart."""
        now = datetime.utcnow()
        year = now.year

        # Approximate Mesha Sankranti (Sun enters Aries sidereal ~April 14)
        sankranti_approx = datetime(year, 4, 14, 6, 0)
        if now < sankranti_approx:
            sankranti_approx = datetime(year - 1, 4, 14, 6, 0)

        jd = self.ephemeris.get_julian_day(sankranti_approx)

        try:
            asc_data = self.ephemeris.get_ascendant(jd, lat, lng)
            s_asc = asc_data.get("rashi", 0)
            s_asc_name = asc_data.get("rashi_name", RASHI_NAMES[s_asc])
            s_lord = RASHI_LORDS[s_asc]
        except:
            s_asc = 0; s_asc_name = "Aries"; s_lord = "Mars"

        # Get planet positions at sankranti
        year_themes = []
        year_score = 50
        try:
            for planet in ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"]:
                pos = self.ephemeris.get_planet_position(jd, planet)
                p_rashi = pos.get("rashi", 0)
                p_house = ((p_rashi - s_asc) % 12) + 1

                if planet in ("Jupiter", "Saturn", "Rahu"):
                    domain = MUNDANE_HOUSES.get(p_house, {}).get("domain", "")
                    if planet == "Jupiter":
                        year_themes.append(f"Jupiter in H{p_house} ({domain}) — year of expansion in {domain.lower()}")
                        if p_house in (1,2,5,9,11): year_score += 8
                    elif planet == "Saturn":
                        year_themes.append(f"Saturn in H{p_house} ({domain}) — year of restructuring in {domain.lower()}")
                        if p_house in (1,4,7,8): year_score -= 5
                    elif planet == "Rahu":
                        year_themes.append(f"Rahu in H{p_house} ({domain}) — year of disruption in {domain.lower()}")
        except: pass

        year_score = max(10, min(95, year_score))

        return {
            "sankranti_ascendant": s_asc_name,
            "sankranti_lord": s_lord,
            "year": sankranti_approx.year,
            "year_themes": year_themes,
            "year_score": year_score,
            "year_outlook": "Positive" if year_score >= 60 else ("Mixed" if year_score >= 45 else "Challenging"),
        }

    def _personal_overlay(self, geo, sky) -> Dict:
        """How this location's energy interacts with YOUR chart."""
        impacts = []

        # Check if geodetic ascendant matches any personal planet
        geo_asc = geo.get("geodetic_ascendant", "")
        geo_idx = RASHI_NAMES.index(geo_asc) if geo_asc in RASHI_NAMES else -1

        if geo_idx >= 0:
            for planet, pd in self.personal_planets.items():
                if planet == "Ascendant": continue
                if pd.get("rashi", -1) == geo_idx:
                    impacts.append({
                        "type": "geodetic_resonance",
                        "planet": planet,
                        "meaning": f"Your {planet} sits in this location's geodetic sign ({geo_asc}). Deep resonance — this place amplifies your {planet}.",
                    })

            # Check if personal ascendant matches geodetic
            if self.personal_asc == geo_idx:
                impacts.append({
                    "type": "ascendant_match",
                    "meaning": f"Your ascendant matches this location's geodetic sign. You ARE this place. Maximum resonance.",
                })

        # Check transit weather against personal houses
        for tw in geo.get("transit_weather", []):
            p = tw["planet"]
            nat_house = tw["house"]
            # Same transit hits which personal house?
            try:
                transits = self.ephemeris.get_current_transits()
                td = transits.get(p, {})
                tr = td.get("rashi", 0)
                personal_house = ((tr - self.personal_asc) % 12) + 1
                if nat_house == personal_house:
                    impacts.append({
                        "type": "house_sync",
                        "planet": p,
                        "house": nat_house,
                        "meaning": f"{p} hits H{nat_house} in BOTH this location AND your chart. {tw['domain']} events here directly affect your life.",
                    })
            except: pass

        # Score personal fit
        resonance_score = len(impacts) * 15
        resonance_score = min(100, max(0, 30 + resonance_score))

        return {
            "impacts": impacts[:8],
            "resonance_score": resonance_score,
            "total_connections": len(impacts),
            "verdict": "Deep personal connection" if resonance_score >= 70 else ("Moderate resonance" if resonance_score >= 45 else "Weak personal connection"),
        }

    def _build_summary(self, name, geo, sky, sankranti, personal, score):
        parts = [f"{name}: {geo['geodetic_ascendant']} geodetic sign."]
        tw = geo.get("transit_weather", [])
        if tw:
            parts.append(f"Current: {tw[0]['reading']}.")
        parts.append(f"Annual outlook: {sankranti['year_outlook']}.")
        sky_ang = sky.get("angular_planets", [])
        if sky_ang:
            parts.append(f"Right now: {sky_ang[0]['planet']} angular — {sky_ang[0]['meaning'][:40]}.")
        parts.append(f"Personal fit: {personal['verdict']} ({personal['resonance_score']}/100).")
        return " ".join(parts)