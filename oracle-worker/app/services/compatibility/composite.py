"""
COMPOSITE CHART
Midpoint chart for a relationship — not about each individual,
but about the relationship ITSELF.

Each planet in the composite = midpoint of both people's planet.
This chart predicts when the RELATIONSHIP faces challenges,
not when each person does.
"""

from typing import Dict


def _midpoint(long1: float, long2: float) -> float:
    """Calculate the shorter midpoint between two longitudes."""
    diff = abs(long1 - long2)
    if diff > 180:
        # Take the shorter arc
        mid = ((long1 + long2) / 2 + 180) % 360
    else:
        mid = (long1 + long2) / 2
    return mid % 360


RASHI_NAMES = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
               "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"]


def _rashi_from_long(longitude: float) -> int:
    return int(longitude / 30) + 1


def _rashi_name(longitude: float) -> str:
    idx = int(longitude / 30) % 12
    return RASHI_NAMES[idx]


def _house_from_asc(planet_rashi: int, asc_rashi: int) -> int:
    return ((planet_rashi - asc_rashi) % 12) + 1


class CompositeChart:

    def __init__(self, engine1, engine2):
        """
        engine1, engine2: JyotishEngine instances for each person.
        """
        self.e1 = engine1
        self.e2 = engine2
        self.composite_planets = {}
        self.composite_asc = {}
        self._calculate()

    def _calculate(self):
        """Calculate midpoint for every planet and ascendant."""
        planets1 = self.e1.planets
        planets2 = self.e2.planets

        # Composite Ascendant
        asc1 = self.e1.ascendant.get("longitude", 0)
        asc2 = self.e2.ascendant.get("longitude", 0)
        comp_asc_long = _midpoint(asc1, asc2)
        comp_asc_rashi = _rashi_from_long(comp_asc_long)

        self.composite_asc = {
            "longitude": round(comp_asc_long, 4),
            "rashi": comp_asc_rashi,
            "rashi_name": _rashi_name(comp_asc_long),
            "degree": round(comp_asc_long % 30, 2),
        }

        # Composite planets
        for planet in ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"]:
            p1 = planets1.get(planet, {}).get("longitude", 0)
            p2 = planets2.get(planet, {}).get("longitude", 0)
            mid = _midpoint(p1, p2)
            rashi = _rashi_from_long(mid)
            house = _house_from_asc(rashi, comp_asc_rashi)

            self.composite_planets[planet] = {
                "longitude": round(mid, 4),
                "rashi": rashi,
                "rashi_name": _rashi_name(mid),
                "degree": round(mid % 30, 2),
                "house": house,
                "person1_longitude": round(p1, 4),
                "person2_longitude": round(p2, 4),
            }

    def generate_composite_report(self) -> Dict:
        """Full composite chart analysis."""
        analysis = self._analyze()

        return {
            "composite_ascendant": self.composite_asc,
            "composite_planets": self.composite_planets,
            "analysis": analysis,
        }

    def _analyze(self) -> Dict:
        """Analyze the composite chart for relationship themes."""
        asc_rashi = self.composite_asc["rashi"]
        results = {}

        # Sun = identity of the relationship
        sun = self.composite_planets.get("Sun", {})
        sun_house = sun.get("house", 0)
        results["identity"] = {
            "planet": "Sun",
            "house": sun_house,
            "meaning": self._sun_house_meaning(sun_house),
        }

        # Moon = emotional bond
        moon = self.composite_planets.get("Moon", {})
        moon_house = moon.get("house", 0)
        results["emotional_bond"] = {
            "planet": "Moon",
            "house": moon_house,
            "meaning": self._moon_house_meaning(moon_house),
        }

        # Venus = love expression
        venus = self.composite_planets.get("Venus", {})
        venus_house = venus.get("house", 0)
        results["love_expression"] = {
            "planet": "Venus",
            "house": venus_house,
            "meaning": self._venus_house_meaning(venus_house),
        }

        # Mars = passion and conflict
        mars = self.composite_planets.get("Mars", {})
        mars_house = mars.get("house", 0)
        results["passion_conflict"] = {
            "planet": "Mars",
            "house": mars_house,
            "meaning": self._mars_house_meaning(mars_house),
        }

        # Saturn = commitment and challenges
        saturn = self.composite_planets.get("Saturn", {})
        saturn_house = saturn.get("house", 0)
        results["commitment"] = {
            "planet": "Saturn",
            "house": saturn_house,
            "meaning": self._saturn_house_meaning(saturn_house),
        }

        # Jupiter = growth together
        jupiter = self.composite_planets.get("Jupiter", {})
        jupiter_house = jupiter.get("house", 0)
        results["growth"] = {
            "planet": "Jupiter",
            "house": jupiter_house,
            "meaning": self._jupiter_house_meaning(jupiter_house),
        }

        # 7th house status (relationship house)
        h7_planets = [p for p, d in self.composite_planets.items() if d.get("house") == 7]
        results["seventh_house"] = {
            "planets_in_7th": h7_planets,
            "meaning": "Strong partnership focus" if h7_planets else "Partnership defined by 7th lord placement",
        }

        # Overall score
        good_placements = 0
        good_houses = [1, 2, 4, 5, 7, 9, 10, 11]
        for planet in ["Sun", "Moon", "Venus", "Jupiter"]:
            if self.composite_planets.get(planet, {}).get("house", 0) in good_houses:
                good_placements += 1

        bad_houses = [6, 8, 12]
        stress_count = 0
        for planet in ["Mars", "Saturn", "Rahu"]:
            if self.composite_planets.get(planet, {}).get("house", 0) in [1, 4, 7, 8]:
                stress_count += 1

        if good_placements >= 3 and stress_count <= 1:
            overall = "Strong relationship foundation"
            score = 75
        elif good_placements >= 2:
            overall = "Good potential with some work needed"
            score = 60
        elif stress_count >= 2:
            overall = "Challenging dynamics — requires conscious effort"
            score = 40
        else:
            overall = "Complex relationship — growth through friction"
            score = 50

        results["overall"] = {"rating": overall, "score": score}

        return results

    def _sun_house_meaning(self, house):
        m = {
            1: "Relationship centered on shared identity and mutual recognition",
            2: "Relationship builds shared resources and values",
            3: "Communication and intellectual exchange define the bond",
            4: "Home and emotional security are the foundation",
            5: "Creative, romantic, playful connection — feels destined",
            6: "Relationship requires daily effort and service to each other",
            7: "Partnership itself is the purpose — strong marriage indicator",
            8: "Deeply transformative bond — intense and potentially obsessive",
            9: "Philosophical connection — shared beliefs and exploration",
            10: "Public couple — career-oriented partnership or power couple",
            11: "Friendship-based love — shared dreams and social circles",
            12: "Spiritual or hidden connection — karmic, possibly secretive",
        }
        return m.get(house, "Unique relationship dynamic")

    def _moon_house_meaning(self, house):
        m = {
            1: "Deep emotional mirroring — you feel each other instantly",
            4: "Nurturing bond — feels like coming home",
            5: "Emotionally playful and creative together",
            7: "Emotional needs met through partnership",
            8: "Intense emotional depths — transformative but heavy",
            10: "Emotions expressed through shared ambitions",
            12: "Unspoken emotional bond — psychic connection",
        }
        return m.get(house, "Emotional connection through house " + str(house) + " themes")

    def _venus_house_meaning(self, house):
        m = {
            1: "Love is naturally expressed — easy affection",
            5: "Romantic, passionate, creative love — best Venus placement",
            7: "Love through committed partnership — marriage-oriented",
            9: "Love grows through shared adventures and beliefs",
            11: "Love expressed through friendship and shared visions",
            12: "Love is private, spiritual, or sacrificial",
        }
        return m.get(house, "Love expressed through house " + str(house) + " themes")

    def _mars_house_meaning(self, house):
        m = {
            1: "High physical attraction but prone to arguments",
            4: "Conflicts around home and emotional security",
            7: "Passionate but combative in partnership",
            8: "Intense power struggles but transformative intimacy",
            10: "Competitive around career — can be productive",
        }
        return m.get(house, "Energy and drive channeled through house " + str(house))

    def _saturn_house_meaning(self, house):
        m = {
            1: "Serious relationship — feels fated and heavy",
            4: "Commitment through building a home together",
            7: "Strong marriage commitment but feels like duty",
            10: "Relationship defined by shared career or public status",
            11: "Long-term friendship underlies the bond",
        }
        return m.get(house, "Commitment and structure through house " + str(house))

    def _jupiter_house_meaning(self, house):
        m = {
            1: "Mutual growth and optimism — expansive bond",
            5: "Growing through shared creativity and joy",
            7: "Blessed partnership — wisdom through togetherness",
            9: "Spiritual growth together — teacher-student dynamic",
            11: "Expanding each other's social world and dreams",
        }
        return m.get(house, "Growth and expansion through house " + str(house))

    def format_for_oracle(self) -> str:
        """Compact summary for Oracle briefing."""
        try:
            report = self.generate_composite_report()
            a = report["analysis"]
            overall = a.get("overall", {})
            lines = [
                f"COMPOSITE CHART: {overall.get('rating', 'unknown')} (score: {overall.get('score', '?')})",
                f"  Relationship identity (Sun H{a['identity']['house']}): {a['identity']['meaning'][:80]}",
                f"  Emotional bond (Moon H{a['emotional_bond']['house']}): {a['emotional_bond']['meaning'][:80]}",
                f"  Love style (Venus H{a['love_expression']['house']}): {a['love_expression']['meaning'][:80]}",
                f"  Commitment (Saturn H{a['commitment']['house']}): {a['commitment']['meaning'][:80]}",
            ]
            return "\n".join(lines)
        except Exception:
            return ""
