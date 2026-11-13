"""
TITHI PRAVESH (Tithi Solar Return)
Cast chart when the Sun-Moon angle from birth repeats each year.
Considered more accurate than traditional solar return by Sanjay Rath school.

The annual chart is cast for the exact moment when:
  (Sun longitude - Moon longitude) = natal (Sun - Moon) angle
in the same lunar month as birth.
"""

from datetime import datetime, timedelta
from typing import Dict
from ..core.ephemeris import get_ephemeris


def _sun_moon_angle(sun_long: float, moon_long: float) -> float:
    """Tithi angle = Moon - Sun, normalized to 0-360."""
    return (moon_long - sun_long) % 360


def _find_tithi_pravesh_moment(birth_sun: float, birth_moon: float,
                                year: int, latitude: float, longitude: float) -> datetime:
    """
    Find the exact moment in the given year when the Sun-Moon angle
    matches the birth tithi angle. Search around the solar return date.
    """
    eph = get_ephemeris()
    target_angle = _sun_moon_angle(birth_sun, birth_moon)

    # Start searching 15 days before approximate solar return
    search_start = datetime(year, 1, 1)

    # Find when Sun reaches birth Sun longitude this year
    # Binary search across the year
    birth_sun_norm = birth_sun % 360

    # Coarse search: check every day
    best_date = None
    best_diff = 999

    # Search entire year in 6-hour steps
    current = datetime(year, 1, 1)
    end = datetime(year, 12, 31)
    prev_diff = None

    while current <= end:
        planets = eph.get_transits_for_date(current)
        sun_l = planets["Sun"]["longitude"]
        moon_l = planets["Moon"]["longitude"]
        current_angle = _sun_moon_angle(sun_l, moon_l)

        diff = abs(current_angle - target_angle)
        if diff > 180:
            diff = 360 - diff

        if diff < best_diff:
            best_diff = diff
            best_date = current

        # If we crossed the target (diff was decreasing, now increasing)
        if prev_diff is not None and diff > prev_diff and prev_diff < 5:
            # Refine with hourly search around best_date
            refine_start = best_date - timedelta(hours=12)
            refine_end = best_date + timedelta(hours=12)
            refine = refine_start
            while refine <= refine_end:
                p2 = eph.get_transits_for_date(refine)
                s2 = p2["Sun"]["longitude"]
                m2 = p2["Moon"]["longitude"]
                a2 = _sun_moon_angle(s2, m2)
                d2 = abs(a2 - target_angle)
                if d2 > 180:
                    d2 = 360 - d2
                if d2 < best_diff:
                    best_diff = d2
                    best_date = refine
                refine += timedelta(minutes=30)

            if best_diff < 2:
                break  # Close enough

            # Reset and keep searching (there can be multiple matches per year)
            prev_diff = None
            current += timedelta(days=25)  # Skip ahead past this lunation
            continue

        prev_diff = diff
        current += timedelta(hours=6)

    return best_date


class TithiPravesh:

    def __init__(self, engine, year: int = None):
        self.engine = engine
        self.year = year or datetime.now().year
        self.birth_sun = engine.planets["Sun"]["longitude"]
        self.birth_moon = engine.planets["Moon"]["longitude"]
        self.latitude = engine.latitude
        self.longitude = engine.longitude

    def generate_annual_chart(self) -> Dict:
        """Generate Tithi Pravesh chart for the given year."""
        from ..jyotish_engine import JyotishEngine

        # Find the exact moment
        tp_moment = _find_tithi_pravesh_moment(
            self.birth_sun, self.birth_moon,
            self.year, self.latitude, self.longitude
        )

        if not tp_moment:
            return {"error": "Could not find Tithi Pravesh moment"}

        # Cast chart for that moment at birth location
        tp_engine = JyotishEngine(tp_moment, self.latitude, self.longitude)
        tp_chart = tp_engine.get_rashi_chart()
        tp_planets = tp_chart["planets"]
        tp_asc = tp_chart["ascendant"]

        # Analyze the annual chart
        analysis = self._analyze_tp_chart(tp_engine, tp_planets, tp_asc)

        # Compare with Varshaphal for cross-validation
        cross_validation = self._cross_validate(analysis)

        return {
            "year": self.year,
            "tithi_pravesh_moment": tp_moment.isoformat(),
            "tp_ascendant": tp_asc.get("rashi_name", ""),
            "tp_ascendant_lord": self._get_lord(tp_asc.get("rashi", 0)),
            "birth_tithi_angle": round(_sun_moon_angle(self.birth_sun, self.birth_moon), 2),
            "analysis": analysis,
            "cross_validation": cross_validation,
            "planets_summary": {
                p: {
                    "rashi": d.get("rashi_name", ""),
                    "house": d.get("house", 0),
                }
                for p, d in tp_planets.items()
                if p in ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn"]
            },
        }

    def _analyze_tp_chart(self, tp_engine, planets: Dict, ascendant: Dict) -> Dict:
        """Analyze the Tithi Pravesh chart for the year."""

        asc_rashi = ascendant.get("rashi", 0)
        asc_lord = self._get_lord(asc_rashi)

        # Lagna lord placement — most important factor
        lagna_lord_data = planets.get(asc_lord, {})
        ll_house = lagna_lord_data.get("house", 0)

        ll_strong_houses = [1, 2, 4, 5, 7, 9, 10, 11]
        ll_is_strong = ll_house in ll_strong_houses

        # Year lord = planet ruling the weekday of TP moment
        tp_moment_str = tp_engine.birth_local
        weekday = tp_moment_str.weekday()
        weekday_lords = ["Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Sun"]
        year_lord = weekday_lords[weekday]
        yl_data = planets.get(year_lord, {})
        yl_house = yl_data.get("house", 0)

        # Moon placement — emotional tenor of the year
        moon_house = planets.get("Moon", {}).get("house", 0)

        # Key house analysis
        areas = {}
        house_lords = {}
        for h in range(1, 13):
            lord_rashi = ((asc_rashi - 1 + h - 1) % 12) + 1
            lord = self._get_lord(lord_rashi)
            lord_data = planets.get(lord, {})
            lord_house = lord_data.get("house", 0)
            house_lords[h] = {"lord": lord, "placed_in": lord_house}

        # Career (10th)
        h10 = house_lords.get(10, {})
        career_good = h10.get("placed_in", 0) in [1, 2, 4, 5, 9, 10, 11]
        areas["career"] = "favorable" if career_good else "challenging"

        # Wealth (2nd, 11th)
        h2 = house_lords.get(2, {})
        h11 = house_lords.get(11, {})
        wealth_good = (h2.get("placed_in", 0) in ll_strong_houses) or (h11.get("placed_in", 0) in ll_strong_houses)
        areas["wealth"] = "favorable" if wealth_good else "moderate"

        # Relationships (7th)
        h7 = house_lords.get(7, {})
        rel_good = h7.get("placed_in", 0) in [1, 2, 4, 5, 7, 9, 11]
        areas["relationships"] = "favorable" if rel_good else "challenging"

        # Health (1st, 6th)
        health_good = ll_is_strong
        areas["health"] = "strong" if health_good else "needs attention"

        # Overall score
        favorable_count = sum(1 for v in areas.values() if v in ("favorable", "strong"))
        if favorable_count >= 3:
            overall = "excellent"
            score = 80
        elif favorable_count >= 2:
            overall = "good"
            score = 65
        elif favorable_count >= 1:
            overall = "mixed"
            score = 50
        else:
            overall = "challenging"
            score = 35

        return {
            "overall_rating": overall,
            "score": score,
            "lagna_lord": asc_lord,
            "lagna_lord_house": ll_house,
            "lagna_lord_strong": ll_is_strong,
            "year_lord": year_lord,
            "year_lord_house": yl_house,
            "moon_house": moon_house,
            "areas": areas,
        }

    def _cross_validate(self, tp_analysis: Dict) -> Dict:
        """Compare Tithi Pravesh with Varshaphal."""
        try:
            vp = self.engine.get_annual_prediction(self.year)
            vp_score = vp.get("score", 50)
            tp_score = tp_analysis.get("score", 50)

            agreement = abs(vp_score - tp_score) < 20

            if agreement:
                confidence = "HIGH — both systems agree"
                final_score = round((vp_score + tp_score) / 2)
            else:
                confidence = "SPLIT — systems disagree, use caution"
                final_score = round((vp_score + tp_score) / 2)

            return {
                "varshaphal_score": vp_score,
                "tithi_pravesh_score": tp_score,
                "combined_score": final_score,
                "agreement": agreement,
                "confidence": confidence,
            }
        except Exception:
            return {"confidence": "Varshaphal comparison unavailable"}

    def _get_lord(self, rashi: int) -> str:
        lords = {
            1: "Mars", 2: "Venus", 3: "Mercury", 4: "Moon",
            5: "Sun", 6: "Mercury", 7: "Venus", 8: "Mars",
            9: "Jupiter", 10: "Saturn", 11: "Saturn", 12: "Jupiter",
        }
        return lords.get(rashi, "Sun")

    def format_for_oracle(self) -> str:
        try:
            tp = self.generate_annual_chart()
            a = tp.get("analysis", {})
            cv = tp.get("cross_validation", {})
            lines = [
                f"TITHI PRAVESH {self.year}: {a.get('overall_rating', 'unknown')} year (score: {a.get('score', '?')})",
                f"  TP Ascendant: {tp.get('tp_ascendant', '?')}, Year Lord: {a.get('year_lord', '?')} in H{a.get('year_lord_house', '?')}",
            ]
            areas = a.get("areas", {})
            for area, verdict in areas.items():
                lines.append(f"  {area}: {verdict}")
            if cv.get("confidence"):
                lines.append(f"  Cross-validation: {cv['confidence']}")
            return "\n".join(lines)
        except Exception:
            return ""
