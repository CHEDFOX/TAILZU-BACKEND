"""
PERSONAL TRANSIT CALENDAR v2
Fixed data wiring to actual Ashtakavarga + FutureTransit structures.
"""

from datetime import datetime, timedelta
from typing import Dict

RASHI_NAMES = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
               "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"]

PLANET_DOMAINS = {
    "Sun": "authority, father, career visibility",
    "Moon": "emotions, mother, mental peace",
    "Mars": "energy, courage, property, siblings",
    "Mercury": "communication, business, intellect",
    "Jupiter": "wisdom, luck, children, expansion",
    "Venus": "love, marriage, luxury, arts",
    "Saturn": "discipline, career structure, karma",
    "Rahu": "obsession, foreign, unconventional gains",
    "Ketu": "spirituality, detachment, liberation",
}

HOUSE_EFFECTS = {
    1: {"kw": "self", "good": "fresh energy, new beginnings", "bad": "health strain"},
    2: {"kw": "wealth", "good": "income boost, family harmony", "bad": "financial stress"},
    3: {"kw": "courage", "good": "bold moves succeed", "bad": "restlessness"},
    4: {"kw": "peace", "good": "domestic harmony, property", "bad": "emotional turbulence"},
    5: {"kw": "creativity", "good": "romance, children, speculation", "bad": "risky decisions"},
    6: {"kw": "enemies", "good": "victory over opponents", "bad": "debts, illness"},
    7: {"kw": "partnership", "good": "marriage, contracts", "bad": "relationship strain"},
    8: {"kw": "transformation", "good": "inheritance, depth", "bad": "sudden setbacks"},
    9: {"kw": "fortune", "good": "luck, travel, higher learning", "bad": "faith crisis"},
    10: {"kw": "career", "good": "promotion, recognition", "bad": "career pressure"},
    11: {"kw": "gains", "good": "income surge, wishes fulfilled", "bad": "unfulfilled desires"},
    12: {"kw": "loss/liberation", "good": "spiritual growth, foreign travel", "bad": "expenses, isolation"},
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


class TransitCalendar:

    def __init__(self, engine):
        self.engine = engine
        self.asc_rashi = engine.ascendant_rashi
        self.moon_rashi = engine.planets.get("Moon", {}).get("rashi", 1)

        # Load SAV bindus per sign
        try:
            sav = engine.get_ashtakavarga()
            self.sav_bindus = sav.get("bindus_by_rashi_named", {})
        except Exception:
            self.sav_bindus = {}

        # Load future major transits
        try:
            ft = engine.get_future_transits(12)
            self.major_transits = ft.get("major_transits", {})
        except Exception:
            self.major_transits = {}

    def generate_calendar(self, months: int = 6) -> Dict:
        now = datetime.now()
        calendar_months = []

        for m in range(months):
            target = now + timedelta(days=m * 30)
            month_data = self._analyze_month(target)
            calendar_months.append(month_data)

        # Extract key dates from major transits
        key_dates = self._extract_key_dates()

        scores = [m["score"] for m in calendar_months]
        avg = sum(scores) / len(scores) if scores else 50

        if avg >= 65:
            verdict = "Strongly favorable period ahead"
        elif avg >= 55:
            verdict = "Generally positive with some challenges"
        elif avg >= 45:
            verdict = "Mixed period requiring careful navigation"
        else:
            verdict = "Challenging period — patience and remedies advised"

        return {
            "months": calendar_months,
            "key_dates": key_dates[:15],
            "period_score": round(avg),
            "period_verdict": verdict,
            "generated_at": now.isoformat(),
            "months_covered": months,
        }

    def _get_transit_house(self, transit_rashi: int) -> int:
        """Get house number from Moon (Gochara style)."""
        return ((transit_rashi - self.moon_rashi) % 12) + 1

    def _get_sav_score(self, rashi_name: str) -> int:
        """Get SAV bindu count for a sign. Average is ~28."""
        return self.sav_bindus.get(rashi_name, 28)

    def _analyze_month(self, target_date: datetime) -> Dict:
        month_name = target_date.strftime("%B %Y")
        short = target_date.strftime("%b")

        # Get transits for this date
        try:
            transit_data = self.engine.get_transit_for_date(target_date)
            # transit_analysis contains per-planet info
            t_analysis = transit_data.get("transit_analysis", {})
        except Exception:
            t_analysis = {}

        # Also get raw transit positions
        try:
            raw_transits = self.engine.ephemeris.get_transits_for_date(target_date)
        except Exception:
            raw_transits = {}

        planet_effects = []
        total_weighted_score = 0
        total_weight = 0

        slow_planets = ["Jupiter", "Saturn", "Rahu", "Ketu", "Mars", "Venus"]

        for planet in ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"]:
            p_data = raw_transits.get(planet, {})
            t_rashi = p_data.get("rashi", 0)
            rashi_name = p_data.get("rashi_name", "")

            if not t_rashi:
                continue

            house = self._get_transit_house(t_rashi)
            sav_score = self._get_sav_score(rashi_name)
            fav_houses = FAVORABLE_HOUSES.get(planet, [])
            is_favorable = house in fav_houses

            # Score: combine house favorability + SAV bindus
            # SAV average is 28. Above = strong sign, below = weak
            sav_factor = (sav_score - 28) / 10  # ranges roughly -0.8 to +0.8

            if is_favorable:
                base = 7
            else:
                base = 3

            planet_score = max(1, min(10, base + round(sav_factor * 3)))

            # Weight by planetary speed (slow = more impact)
            weight = {"Jupiter": 3, "Saturn": 3, "Rahu": 2.5, "Ketu": 2.5,
                       "Mars": 1.5, "Venus": 1.5, "Mercury": 1, "Sun": 1, "Moon": 0.5}
            w = weight.get(planet, 1)

            total_weighted_score += planet_score * w
            total_weight += w

            # Include slow planets in summary
            if planet in slow_planets:
                h_info = HOUSE_EFFECTS.get(house, {})
                planet_effects.append({
                    "planet": planet,
                    "house": house,
                    "rashi": rashi_name,
                    "house_keyword": h_info.get("kw", ""),
                    "effect": h_info.get("good" if is_favorable else "bad", ""),
                    "favorable": is_favorable,
                    "sav_bindus": sav_score,
                    "score": planet_score,
                })

        # Normalize to 0-100
        if total_weight > 0:
            normalized = round((total_weighted_score / total_weight) * 10)
        else:
            normalized = 50
        normalized = max(15, min(90, normalized))

        # Sign changes this month
        month_events = self._events_in_month(target_date)

        # Theme
        if normalized >= 70:
            theme = "Expansion and opportunity"
        elif normalized >= 60:
            theme = "Steady progress"
        elif normalized >= 50:
            theme = "Navigate with awareness"
        elif normalized >= 40:
            theme = "Patience required"
        else:
            theme = "Caution and inner work"

        # Best/avoid activities from planet effects
        good_effects = [e for e in planet_effects if e["favorable"]]
        bad_effects = [e for e in planet_effects if not e["favorable"]]
        best_for = ", ".join(e["house_keyword"] for e in good_effects[:3]) if good_effects else "reflection, planning"
        avoid = ", ".join(e["house_keyword"] for e in bad_effects[:2]) if bad_effects else "nothing specific"

        return {
            "month": month_name,
            "short": short,
            "score": normalized,
            "theme": theme,
            "planet_effects": planet_effects,
            "events": month_events,
            "best_for": best_for,
            "avoid": "caution with " + avoid if bad_effects else avoid,
        }

    def _events_in_month(self, target_date: datetime) -> list:
        """Find major transit sign changes in this month."""
        month = target_date.month
        year = target_date.year
        events = []

        for planet, changes in self.major_transits.items():
            if not isinstance(changes, list):
                continue
            for change in changes:
                try:
                    d = datetime.strptime(change.get("date", ""), "%Y-%m-%d")
                    if d.month == month and d.year == year:
                        to_rashi = change.get("to_rashi", "")
                        from_rashi = change.get("from_rashi", "")

                        # Calculate house for native
                        to_rashi_num = RASHI_NAMES.index(to_rashi) + 1 if to_rashi in RASHI_NAMES else 0
                        house = self._get_transit_house(to_rashi_num) if to_rashi_num else 0
                        h_info = HOUSE_EFFECTS.get(house, {})
                        is_fav = house in FAVORABLE_HOUSES.get(planet, [])

                        events.append({
                            "date": d.strftime("%b %d"),
                            "planet": planet,
                            "from_sign": from_rashi,
                            "to_sign": to_rashi,
                            "house": house,
                            "house_keyword": h_info.get("kw", ""),
                            "favorable": is_fav,
                            "impact": h_info.get("good" if is_fav else "bad", ""),
                        })
                except Exception:
                    continue
        return events

    def _extract_key_dates(self) -> list:
        """Most important transit dates across all months."""
        key_dates = []

        for planet, changes in self.major_transits.items():
            if not isinstance(changes, list):
                continue
            importance = {"Jupiter": "HIGH", "Saturn": "HIGH", "Rahu": "HIGH",
                          "Ketu": "HIGH", "Mars": "MEDIUM"}.get(planet, "LOW")
            if importance == "LOW":
                continue

            for change in changes:
                to_rashi = change.get("to_rashi", "")
                to_rashi_num = RASHI_NAMES.index(to_rashi) + 1 if to_rashi in RASHI_NAMES else 0
                house = self._get_transit_house(to_rashi_num) if to_rashi_num else 0
                h_info = HOUSE_EFFECTS.get(house, {})
                is_fav = house in FAVORABLE_HOUSES.get(planet, [])

                sav = self._get_sav_score(to_rashi)

                key_dates.append({
                    "date": change.get("date", ""),
                    "planet": planet,
                    "event": planet + " enters " + to_rashi,
                    "house": house,
                    "house_keyword": h_info.get("kw", ""),
                    "impact": h_info.get("good" if is_fav else "bad", ""),
                    "favorable": is_fav,
                    "importance": importance,
                    "sav_bindus": sav,
                    "domain": PLANET_DOMAINS.get(planet, ""),
                })

        order = {"HIGH": 0, "MEDIUM": 1}
        key_dates.sort(key=lambda x: (order.get(x["importance"], 2), x.get("date", "")))
        return key_dates

    def format_for_oracle(self) -> str:
        try:
            cal = self.generate_calendar(3)
            lines = ["TRANSIT CALENDAR (next 3 months):"]
            for m in cal["months"]:
                lines.append(f"  {m['short']}: {m['score']}/100 — {m['theme']}. Best: {m['best_for']}")
            if cal["key_dates"]:
                lines.append("KEY TRANSIT DATES:")
                for kd in cal["key_dates"][:5]:
                    f = "FAVORABLE" if kd["favorable"] else "CHALLENGING"
                    lines.append(f"  {kd['date']}: {kd['event']} H{kd['house']} {kd['house_keyword']} ({f}, SAV:{kd['sav_bindus']})")
            return "\n".join(lines)
        except Exception:
            return ""
