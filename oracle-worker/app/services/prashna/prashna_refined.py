"""
PRASHNA REFINEMENT — Ashtamangala Style
Adds classical Prashna rules to existing PrashnaKundli:
  1. Arudha of the question (which house maps to the query)
  2. Moon's strength and placement for yes/no verdict
  3. Lagna lord strength for timing confidence
  4. Mook Prashna (silent question) support

This WRAPS the existing PrashnaKundli, not replaces it.
"""

from typing import Dict

QUESTION_HOUSE_MAP = {
    "self": 1, "health": 1, "body": 1,
    "wealth": 2, "money": 2, "finances": 2, "income": 2,
    "siblings": 3, "courage": 3, "communication": 3,
    "mother": 4, "home": 4, "property": 4, "vehicle": 4, "peace": 4,
    "children": 5, "education": 5, "romance": 5, "creativity": 5, "love": 5,
    "enemies": 6, "disease": 6, "debt": 6, "legal": 6,
    "marriage": 7, "partner": 7, "spouse": 7, "business_partner": 7, "relationship": 7,
    "death": 8, "inheritance": 8, "longevity": 8, "transformation": 8, "accident": 8,
    "father": 9, "luck": 9, "travel": 9, "religion": 9, "higher_education": 9, "foreign": 9,
    "career": 10, "profession": 10, "status": 10, "job": 10,
    "gains": 11, "friends": 11, "wishes": 11, "elder_sibling": 11,
    "loss": 12, "expenses": 12, "spirituality": 12, "liberation": 12, "abroad": 12,
}

RASHI_LORDS = {
    1: "Mars", 2: "Venus", 3: "Mercury", 4: "Moon",
    5: "Sun", 6: "Mercury", 7: "Venus", 8: "Mars",
    9: "Jupiter", 10: "Saturn", 11: "Saturn", 12: "Jupiter",
}


class PrashnaRefined:

    def __init__(self, prashna_engine, category: str = "general"):
        """
        prashna_engine: existing PrashnaKundli or JyotishEngine cast for query moment.
        category: topic of the question (marriage, career, etc.)
        """
        self.engine = prashna_engine
        self.category = category.lower()
        self.planets = prashna_engine.planets if hasattr(prashna_engine, 'planets') else {}
        self.asc = prashna_engine.ascendant if hasattr(prashna_engine, 'ascendant') else {}

    def refine(self) -> Dict:
        """Apply classical Prashna rules for a sharper verdict."""

        asc_rashi = self.asc.get("rashi", 1)
        asc_lord = RASHI_LORDS.get(asc_rashi, "Sun")

        # 1. Find the query house (Arudha of the question)
        query_house = QUESTION_HOUSE_MAP.get(self.category, 7)  # default to 7th
        query_rashi = ((asc_rashi - 1 + query_house - 1) % 12) + 1
        query_lord = RASHI_LORDS.get(query_rashi, "Sun")

        # 2. Moon analysis — the key Prashna indicator
        moon = self.planets.get("Moon", {})
        moon_house = moon.get("house", 0)
        moon_rashi = moon.get("rashi", 0)
        moon_longitude = moon.get("longitude", 0)
        moon_degree = moon_longitude % 30

        # Moon in query house or aspecting it = strong YES
        moon_supports = moon_house == query_house
        # Moon in kendra (1,4,7,10) from query house = supportive
        moon_kendra = ((moon_house - query_house) % 12) in [0, 3, 6, 9]
        # Moon waxing = favorable, waning = unfavorable
        sun = self.planets.get("Sun", {})
        sun_long = sun.get("longitude", 0)
        moon_long = moon.get("longitude", 0)
        tithi_angle = (moon_long - sun_long) % 360
        moon_waxing = tithi_angle < 180
        # Moon in last 5 degrees (void of course approximation)
        moon_void = moon_degree > 25

        # 3. Lagna lord strength
        lagna_lord_data = self.planets.get(asc_lord, {})
        ll_house = lagna_lord_data.get("house", 0)
        ll_strong = ll_house in [1, 2, 4, 5, 7, 9, 10, 11]

        # 4. Query lord strength
        ql_data = self.planets.get(query_lord, {})
        ql_house = ql_data.get("house", 0)
        ql_strong = ql_house in [1, 2, 4, 5, 7, 9, 10, 11]

        # 5. Malefics in query house = obstruction
        malefics = ["Mars", "Saturn", "Rahu", "Ketu"]
        malefics_in_query = [p for p in malefics
                             if self.planets.get(p, {}).get("house", 0) == query_house]

        # 6. Benefics in query house = support
        benefics = ["Jupiter", "Venus", "Mercury", "Moon"]
        benefics_in_query = [p for p in benefics
                             if self.planets.get(p, {}).get("house", 0) == query_house]

        # ─── BUILD VERDICT ───

        yes_factors = 0
        no_factors = 0
        reasoning = []

        if moon_supports:
            yes_factors += 3
            reasoning.append("Moon directly in query house — strong YES signal")
        elif moon_kendra:
            yes_factors += 1
            reasoning.append("Moon in kendra from query — supportive")

        if moon_waxing:
            yes_factors += 1
            reasoning.append("Waxing Moon — growth energy, favorable")
        else:
            no_factors += 1
            reasoning.append("Waning Moon — declining energy, delays likely")

        if moon_void:
            no_factors += 2
            reasoning.append("Moon in late degrees — void energy, outcome uncertain")

        if ll_strong:
            yes_factors += 1
            reasoning.append("Lagna lord strong — querent has power to make it happen")
        else:
            no_factors += 1
            reasoning.append("Lagna lord weak — querent lacks agency in this matter")

        if ql_strong:
            yes_factors += 2
            reasoning.append("Query house lord well-placed — matter itself is favorable")
        else:
            no_factors += 1
            reasoning.append("Query house lord poorly placed — inherent difficulty")

        if benefics_in_query:
            yes_factors += len(benefics_in_query)
            reasoning.append("Benefic(s) in query house: " + ", ".join(benefics_in_query))
        if malefics_in_query:
            no_factors += len(malefics_in_query)
            reasoning.append("Malefic(s) in query house: " + ", ".join(malefics_in_query))

        # Final verdict
        total = yes_factors + no_factors
        if total == 0:
            total = 1

        confidence_pct = round((yes_factors / total) * 100)

        if confidence_pct >= 70:
            verdict = "YES — strongly indicated"
            timing = "sooner than expected"
        elif confidence_pct >= 55:
            verdict = "YES — with effort and patience"
            timing = "moderate delay, but achievable"
        elif confidence_pct >= 40:
            verdict = "UNCERTAIN — depends on actions taken"
            timing = "timing unclear, external factors at play"
        elif confidence_pct >= 25:
            verdict = "DIFFICULT — significant obstacles"
            timing = "major delays or alternative path needed"
        else:
            verdict = "NO — not supported at this time"
            timing = "not in the foreseeable period"

        return {
            "category": self.category,
            "query_house": query_house,
            "query_lord": query_lord,
            "query_lord_house": ql_house,
            "query_lord_strong": ql_strong,
            "lagna_lord": asc_lord,
            "lagna_lord_strong": ll_strong,
            "moon_house": moon_house,
            "moon_waxing": moon_waxing,
            "moon_void": moon_void,
            "moon_supports": moon_supports,
            "benefics_in_query": benefics_in_query,
            "malefics_in_query": malefics_in_query,
            "yes_factors": yes_factors,
            "no_factors": no_factors,
            "confidence_pct": confidence_pct,
            "verdict": verdict,
            "timing": timing,
            "reasoning": reasoning,
        }

    def format_for_oracle(self) -> str:
        r = self.refine()
        lines = [
            f"PRASHNA VERDICT ({self.category}): {r['verdict']} ({r['confidence_pct']}% confidence)",
            f"  Query H{r['query_house']} lord {r['query_lord']} in H{r['query_lord_house']} ({'strong' if r['query_lord_strong'] else 'weak'})",
            f"  Moon: H{r['moon_house']}, {'waxing' if r['moon_waxing'] else 'waning'}, {'void' if r['moon_void'] else 'active'}",
            f"  Timing: {r['timing']}",
        ]
        if r['reasoning']:
            lines.append("  Key: " + "; ".join(r['reasoning'][:3]))
        return "\n".join(lines)
